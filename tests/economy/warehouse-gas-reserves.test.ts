/// <reference types="bun-types" />
/**
 * R-27 tests: склад v3.1 — газовый склад + принуждение резервов.
 *
 * Жалоба владельца 2026-08-31 №5/№6/№7:
 *   - «необходимо добавить хранилище газов» — атмосферные газы теперь в
 *     отдельном складе ('gas', базовая 2000), а не в рудном;
 *   - «газовый экстрактор сломал логику складов, всё замерло» — регрессия:
 *     газы больше не забивают рудный склад, добыча не встаёт;
 *   - «проверить ограничения минимального уровня хранения» — резервы
 *     (reserves.minimum) теперь ПРИНУЖДАЮТСЯ в canStoreResource: один тип
 *     руды не может занять место минимумов других.
 *
 * Run: bun test tests/economy/warehouse-gas-reserves.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  getWarehouseType,
  createDefaultWarehouse,
  calculateWarehouseCapacities,
  canStoreResource,
  getReserveDebt,
  getUsedCapacityByType,
  GAS_WAREHOUSE_BASE,
} from '@/data/warehouse';
import { processEconomyTick } from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import type { Planet, HexCell, HexTerrain, EntityId, AtmosphericSlot, ProductionQueue } from '@/core/types';

// Initialize baked lookups once for all tests (deterministic seed).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

/** Минимальная планета с пустыми гексами и складом по умолчанию. */
function makePlanet(
  resources: Record<string, number> = {},
  reserves: Record<string, { minimum: number; priority: number }> = {},
  capacitiesOverride?: { ore: number; processed: number; highTech: number; gas?: number },
): Planet {
  const hexes: HexCell[] = [{ q: 0, r: 0 }].map((h) => ({
    coord: { q: h.q, r: h.r },
    terrain: 'plains' as HexTerrain,
    buildingId: null,
    buildingLevel: 0,
    deposits: [],
  }));
  const base = createDefaultWarehouse();
  return {
    id: 'wh-planet' as EntityId,
    systemId: 'wh-system' as EntityId,
    name: 'Warehouse Test',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1,
    temperature: 15,
    atmosphere: { type: 'toxic', pressure: 5, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes,
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    resources: { ...resources },
    warehouse: {
      ...base,
      capacities: capacitiesOverride ?? base.capacities,
      reserves: Object.fromEntries(
        Object.entries(reserves).map(([id, r]) => [
          id,
          { resourceId: id, minimum: r.minimum, priority: r.priority },
        ]),
      ),
    },
    energyBalance: 100,
    owner: 'player' as EntityId,
  };
}

describe('R-27: тип склада (getWarehouseType v3.1)', () => {
  test('1. Сырые атмосферные газы → газовый склад', () => {
    for (const gas of ['H2', 'He', 'Ne', 'Ar', 'N2', 'O2', 'CO2', 'CH4', 'NH3', 'H2S', 'SO2']) {
      expect(getWarehouseType(gas)).toBe('gas');
    }
  });

  test('2. Лёд остаётся в рудном (твёрдые соединения)', () => {
    expect(getWarehouseType('H2O-ice')).toBe('ore');
    expect(getWarehouseType('CO2-ice')).toBe('ore');
  });

  test('3. Руды → рудный; элементы → переработанный; редкие → высокотех', () => {
    expect(getWarehouseType('Fe-ore')).toBe('ore');
    expect(getWarehouseType('NaCl')).toBe('ore');
    expect(getWarehouseType('Fe')).toBe('processed');
    expect(getWarehouseType('Si')).toBe('processed');
    expect(getWarehouseType('Au')).toBe('highTech');
    expect(getWarehouseType('microchip')).toBe('highTech');
  });
});

describe('R-27: газовый склад (вместимости v3.1)', () => {
  test('4. createDefaultWarehouse: gas = 2000, total = 12000', () => {
    const wh = createDefaultWarehouse();
    expect(wh.capacities.gas).toBe(2000);
    expect(wh.capacities.ore).toBe(5000);
    expect(wh.capacities.processed).toBe(3500);
    expect(wh.capacities.highTech).toBe(1500);
    expect(wh.totalCapacity).toBe(12000);
  });

  test('5. calculateWarehouseCapacities: gas считается всегда', () => {
    const planet = makePlanet();
    const caps = calculateWarehouseCapacities(planet);
    expect(caps.gas).toBe(GAS_WAREHOUSE_BASE);
    expect(caps.ore).toBe(5000);
  });

  test('6. Газы не занимают рудный склад: canStoreResource газа при полном рудном', () => {
    // Рудный склад заполнен целиком Fe-ore
    const planet = makePlanet({ 'Fe-ore': 5000 });
    expect(canStoreResource(planet, 'Fe-ore', 10)).toBe(0);
    // Рудный склад полон — но газ всё равно складывается (отдельный склад 2000)
    expect(canStoreResource(planet, 'CO2', 100)).toBe(100);
    expect(canStoreResource(planet, 'CO2', 2500)).toBe(2000);
  });

  test('7. Легаси-сейв без capacities.gas: фолбэк базы 2000', () => {
    const planet = makePlanet(
      {},
      {},
      { ore: 5000, processed: 3500, highTech: 1500 }, // gas: undefined
    );
    expect(canStoreResource(planet, 'CO2', 3000)).toBe(GAS_WAREHOUSE_BASE);
  });
});

describe('R-27: принуждение резервов (canStoreResource + getReserveDebt)', () => {
  test('8. getReserveDebt: долг = Σ дефицитов ДРУГИХ резервов того же склада', () => {
    const planet = makePlanet(
      { 'Fe-ore': 30, 'Si-ore': 50 },
      {
        'Fe-ore': { minimum: 60, priority: 8 },
        'Si-ore': { minimum: 50, priority: 8 },
        'Fe': { minimum: 36, priority: 7 }, // processed — другой склад
      },
    );
    // Для Fe-ore: долг = Si-ore (50−50=0, выполнен) → 0
    expect(getReserveDebt(planet, 'ore', 'Fe-ore')).toBe(0);
    // Для Si-ore: долг = Fe-ore (60−30=30)
    expect(getReserveDebt(planet, 'ore', 'Si-ore')).toBe(30);
    // Без исключения: 30
    expect(getReserveDebt(planet, 'ore')).toBe(30);
    // processed-склад: Fe (36−0=36)
    expect(getReserveDebt(planet, 'processed')).toBe(36);
  });

  test('9. Один тип руды не может занять место минимумов других (жалоба №6)', () => {
    // Свободно 100; Si-ore ниже минимума → долг 50; Fe-ore можно только 50
    const planet = makePlanet(
      { 'Fe-ore': 4900, 'Si-ore': 10 },
      {
        'Fe-ore': { minimum: 60, priority: 8 },
        'Si-ore': { minimum: 50, priority: 8 },
      },
    );
    expect(canStoreResource(planet, 'Fe-ore', 100)).toBe(50);
    // Но Si-ore ДОЛЖЕН влезть до своего минимума (свой резерв не ограничивает)
    expect(canStoreResource(planet, 'Si-ore', 40)).toBe(40);
  });

  test('10. Когда минимумы физически выполнены — долг 0', () => {
    const planet = makePlanet(
      { 'Fe-ore': 4950, 'Si-ore': 50 },
      {
        'Fe-ore': { minimum: 60, priority: 8 },
        'Si-ore': { minimum: 50, priority: 8 },
      },
    );
    // Оба минимума выполнены (Fe-ore 4950 ≥ 60, Si-ore 50 ≥ 50) → долга нет,
    // но склад физически полон → 0 места
    expect(getReserveDebt(planet, 'ore')).toBe(0);
    expect(canStoreResource(planet, 'Fe-ore', 100)).toBe(0);
  });

  test('11. Новые склады не меняют пороги: open_warehouse L1 → +1250, долг тот же', () => {
    const planet = makePlanet(
      { 'Fe-ore': 4900, 'Si-ore': 10 },
      {
        'Fe-ore': { minimum: 60, priority: 8 },
        'Si-ore': { minimum: 50, priority: 8 },
      },
    );
    // добавляем open_warehouse L1 (+1250 к рудному)
    const debtBefore = getReserveDebt(planet, 'ore', 'Fe-ore'); // = дефицит Si-ore: 50−10
    planet.hexes[0]!.buildingId = 'open_warehouse';
    planet.hexes[0]!.buildingLevel = 1;
    const caps = calculateWarehouseCapacities(planet);
    expect(caps.ore).toBe(6250);
    // Долг не изменился (пороги — свойство стартового склада, новый склад их не трогает)
    expect(getReserveDebt(planet, 'ore', 'Fe-ore')).toBe(debtBefore);
    expect(debtBefore).toBe(40);
    // Fe-ore можно доложить почти всё новое место: 6250 − 4910 used − 40 (долг Si-ore) = 1300
    expect(canStoreResource(planet, 'Fe-ore', 2000)).toBe(1300);
  });
});

describe('R-27: регрессия жалобы №7 — газовый экстрактор не «замораживает» колонию', () => {
  test('12. Toxic-атмосфера: 100 тиков экстрактора — рудный склад пуст, газы в газовом', () => {
    // Планета с газовым экстрактором в атмосферном слоте и рудной залежью
    const hexes: HexCell[] = [
      {
        coord: { q: 0, r: 0 },
        terrain: 'plains' as HexTerrain,
        buildingId: 'mine',
        buildingLevel: 1,
        deposits: [{ elementId: 'Fe-ore', availability: 1.0, quantity: 100000, depth: 1 }],
      },
    ];
    const slot: AtmosphericSlot = {
      index: 0,
      buildingId: 'gas_extractor',
      buildingLevel: 1,
    } as AtmosphericSlot;
    const planet: Planet = {
      ...makePlanet(),
      hexes,
      atmosphericSlots: [slot],
      atmosphere: { type: 'toxic', pressure: 5, composition: [] },
    };
    planet.energyBalance = 1000;

    const queues = new Map<EntityId, ProductionQueue>();
    for (let i = 0; i < 100; i++) {
      processEconomyTick([planet], queues);
    }

    // Добыча руды работала всё время (рудный склад не был забит газами)
    expect(planet.resources['Fe-ore']).toBeGreaterThan(50);
    // Газы накопились в газовом складе (toxic: N2 конвертируется в N, прочие — газ)
    const gasUsed = getUsedCapacityByType(planet, 'gas');
    expect(gasUsed).toBeGreaterThan(0);
    // Рудный склад содержит ТОЛЬКО руду (никаких CO2/NH3/H2S/SO2)
    const oreUsed = getUsedCapacityByType(planet, 'ore');
    expect(oreUsed).toBeCloseTo(planet.resources['Fe-ore'] ?? 0, 6);
  });
});
