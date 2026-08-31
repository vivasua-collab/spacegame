/// <reference types="bun-types" />
/**
 * R-27 tests: авто-переработка базовых строительных ресурсов.
 *
 * Жалоба владельца 2026-08-31 №2/№3/№4: «при наличии 3-х переработчиков не
 * меняется количество кремния, железа» — переработка была только ручной
 * очередью. processAutoProcessing: universal processor автоматически
 * перерабатывает руды Fe/Si/Al/C/Cu/Ti в элементы.
 *
 * Проверяется:
 *   1. Universal L1: 1 тик = 2 ед. руды → элементы ×0.75 (yield), чистота 0.78.
 *   2. Резервный пол: руда НЕ расходуется ниже reserves.minimum.
 *   3. Все базовые рецепты (Si-ore → Si и т.д.).
 *   4. 3 переработчика = 3× скорость (жалоба «при наличии 3-х»).
 *   5. Уровень: L2 = ×1.15.
 *   6. Синергия mine_processor (R-27): смежная шахта = ×1.15.
 *   7. Специализация metal_smelting: только металлы, буст выхода (×1.0).
 *   8. Специализация gas_processing: НЕ участвует в авто-режиме.
 *   9. Энергогейт: energyBalance ≤ 0 → авто-переработка стоит.
 *  10. Ёмкость склада processed ограничивает выходы.
 *
 * Run: bun test tests/economy/auto-processing.test.ts
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import { processEconomyTick, recalcEnergyBalance, buildOnHex } from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { createDefaultWarehouse } from '@/data/warehouse';
import type { Planet, EntityId, ProductionQueue, HexCell, HexTerrain, ProcessorRecipeCategory } from '@/core/types';

// Initialize baked lookups once for all tests (deterministic seed).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

/**
 * Планета с гексами и опциональными зданиями/ресурсами.
 * hexDefs: список {q, r, id?, level?, processorType?, specialization?}.
 */
function makePlanet(
  hexDefs: Array<{
    q: number; r: number; id?: string; level?: number;
    processorType?: 'universal' | 'specialized';
    specialization?: ProcessorRecipeCategory; specializationLevel?: number;
  }>,
  resources: Record<string, number> = {},
  reserves: Record<string, { minimum: number; priority: number }> = {},
): Planet {
  const hexes: HexCell[] = hexDefs.map((h) => ({
    coord: { q: h.q, r: h.r },
    terrain: 'plains' as HexTerrain,
    buildingId: h.id ?? null,
    buildingLevel: h.id ? (h.level ?? 1) : 0,
    deposits: [],
    processorType: h.processorType,
    specialization: h.specialization,
    specializationLevel: h.specializationLevel,
  }));
  return {
    id: 'auto-planet' as EntityId,
    systemId: 'sys-1' as EntityId,
    name: 'Auto Processing Test',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1,
    temperature: 15,
    atmosphere: { type: 'standard', pressure: 1, composition: [] },
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
      ...createDefaultWarehouse(),
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

const queues = () => new Map<EntityId, ProductionQueue>();

describe('R-27: авто-переработка базовых строительных ресурсов', () => {
  test('1. Universal L1: 2 ед. Fe-ore за тик → Fe 1.05 + O 0.45 (×0.75)', () => {
    const planet = makePlanet(
      [{ q: 0, r: 0, id: 'processor', level: 1 }],
      { 'Fe-ore': 100 },
    );
    processEconomyTick([planet], queues());
    // fraction = (10/time=5)/10 = 0.2; Fe = 0.2 × 7 × 0.75 = 1.05; O = 0.2 × 3 × 0.75 = 0.45
    expect(planet.resources['Fe-ore']).toBeCloseTo(98, 6);
    expect(planet.resources['Fe']).toBeCloseTo(1.05, 6);
    expect(planet.resources['O']).toBeCloseTo(0.45, 6);
    expect(planet.resourcePurity?.['Fe']).toBeCloseTo(0.78, 6);
  });

  test('2. Резервный пол: руда НЕ расходуется ниже reserves.minimum', () => {
    const planet = makePlanet(
      [{ q: 0, r: 0, id: 'processor', level: 1 }],
      { 'Si-ore': 50 },
      { 'Si-ore': { minimum: 50, priority: 8 } },
    );
    processEconomyTick([planet], queues());
    expect(planet.resources['Si-ore']).toBeCloseTo(50, 6);
    expect(planet.resources['Si']).toBeUndefined();
  });

  test('3. Все базовые рецепты: Si-ore → Si, Al-ore → Al, C-ore → C', () => {
    const planet = makePlanet(
      [{ q: 0, r: 0, id: 'processor', level: 1 }],
      { 'Si-ore': 100, 'Al-ore': 100, 'C-ore': 100 },
    );
    processEconomyTick([planet], queues());
    // smelt_si: 10 → Si 4.7 + O 5.3; smelt_al: 10 → Al 5.3 + O 4.7; smelt_c: 10 → C 8 + H 0.5 + O 1.3 + S 0.2
    expect(planet.resources['Si-ore']).toBeCloseTo(98, 6);
    expect(planet.resources['Si']).toBeCloseTo(4.7 * 0.2 * 0.75, 6);
    expect(planet.resources['Al']).toBeCloseTo(5.3 * 0.2 * 0.75, 6);
    expect(planet.resources['C']).toBeCloseTo(8 * 0.2 * 0.75, 6);
  });

  test('4. 3 переработчика = 3× скорость (жалоба владельца)', () => {
    const planet = makePlanet(
      [
        { q: 0, r: 0, id: 'processor', level: 1 },
        { q: 1, r: 0, id: 'processor', level: 1 },
        { q: 0, r: 1, id: 'processor', level: 1 },
      ],
      { 'Fe-ore': 100 },
    );
    processEconomyTick([planet], queues());
    // 3 × 2 ед. (не смежны — синергии нет)
    expect(planet.resources['Fe-ore']).toBeCloseTo(94, 6);
    expect(planet.resources['Fe']).toBeCloseTo(7 * 0.6 * 0.75, 6);
  });

  test('5. Уровень: L2 = ×1.15', () => {
    const planet = makePlanet(
      [{ q: 0, r: 0, id: 'processor', level: 2 }],
      { 'Fe-ore': 100 },
    );
    processEconomyTick([planet], queues());
    // 2 × 1.15 = 2.3 ед. Fe-ore
    expect(planet.resources['Fe-ore']).toBeCloseTo(97.7, 6);
  });

  test('6. Синергия mine_processor: смежная шахта → ×1.15', () => {
    const planet = makePlanet(
      [
        { q: 0, r: 0, id: 'processor', level: 1 },
        { q: 1, r: 0, id: 'mine', level: 1 },
      ],
      { 'Fe-ore': 100 },
    );
    processEconomyTick([planet], queues());
    // 2 × 1.15 = 2.3 (mine не добывает — нет залежей, но синергия работает)
    expect(planet.resources['Fe-ore']).toBeCloseTo(97.7, 6);
  });

  test('7. Специализация metal_smelting: только металлы, буст выхода', () => {
    const planet = makePlanet(
      [{
        q: 0, r: 0, id: 'processor', level: 3,
        processorType: 'specialized', specialization: 'metal_smelting', specializationLevel: 1,
      }],
      { 'Fe-ore': 100, 'Si-ore': 100 },
    );
    processEconomyTick([planet], queues());
    // smelt_fe: fraction = 2 × 1.3 / 10 = 0.26; specialized yield = 1.0 → Fe = 0.26 × 7 = 1.82
    expect(planet.resources['Fe']).toBeCloseTo(7 * 0.26, 6);
    // smelt_si — nonmetal: специализированный metal_smelting его НЕ берёт
    expect(planet.resources['Si-ore']).toBeCloseTo(100, 6);
    expect(planet.resources['Si']).toBeUndefined();
  });

  test('8. Специализация gas_processing: НЕ участвует в авто-режиме', () => {
    const planet = makePlanet(
      [{
        q: 0, r: 0, id: 'processor', level: 3,
        processorType: 'specialized', specialization: 'gas_processing', specializationLevel: 1,
      }],
      { 'Fe-ore': 100 },
    );
    processEconomyTick([planet], queues());
    expect(planet.resources['Fe-ore']).toBeCloseTo(100, 6);
    expect(planet.resources['Fe']).toBeUndefined();
  });

  test('9. Энергогейт: energyBalance ≤ 0 → авто-переработка стоит', () => {
    const planet = makePlanet(
      [{ q: 0, r: 0, id: 'processor', level: 1 }],
      { 'Fe-ore': 100 },
    );
    planet.energyBalance = 0;
    processEconomyTick([planet], queues());
    expect(planet.resources['Fe-ore']).toBeCloseTo(100, 6);
    expect(planet.resources['Fe']).toBeUndefined();
  });

  test('10. Ёмкость processed склада ограничивает выходы', () => {
    const planet = makePlanet(
      [{ q: 0, r: 0, id: 'processor', level: 1 }],
      { 'Fe-ore': 100 },
    );
    // Заполнить processed почти целиком (3500 − 1.0)
    planet.resources['Si'] = 3499;
    processEconomyTick([planet], queues());
    // Итог ровно 3500: Fe добавился ровно в оставшийся 1.0 (O не влез — общий fraction урезан)
    // fraction ограничен: Fe ≤ available/1.05; O ≤ available/0.45 → доля по O: 1.0/0.45 fraction…
    const totalProcessed = planet.resources['Si']! + planet.resources['Fe']! + (planet.resources['O'] ?? 0) + (planet.resources['H'] ?? 0);
    expect(totalProcessed).toBeCloseTo(3500, 4);
    // Руда списана пропорционально фактической доле
    expect(planet.resources['Fe-ore']).toBeGreaterThan(98);
  });

  test('11. buildOnHex интеграция: процессор после постройки сразу перерабатывает', () => {
    const planet = makePlanet([{ q: 0, r: 0 }], { 'Fe-ore': 100, Fe: 50, Si: 50, C: 30, Al: 50, Ti: 20, Cu: 20 });
    expect(buildOnHex(planet, 0, 'processor')).toBe(true);
    // Стоимость постройки processor: Fe 8 + Si 5 + C 3
    expect(planet.resources['Fe']).toBeCloseTo(42, 6);
    // buildOnHex → recalcEnergyBalance: одиночный переработчик без генераторов
    // даёт баланс −6 (энергогейт корректно блокирует авто-режим). Подключаем
    // «сеть»: возвращаем положительный баланс, как в колонии с ЭС.
    planet.energyBalance = 100;
    processEconomyTick([planet], queues());
    // 42 + 1.05 (авто-переработка) = 43.05
    expect(planet.resources['Fe']).toBeCloseTo(43.05, 4);
  });
});
