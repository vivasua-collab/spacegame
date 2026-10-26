/// <reference types="bun-types" />
/**
 * Task 37 / D1 (G-01) tests: роли добывающих зданий в processExtraction.
 *
 * Контракт (docs/40-buildings.md §2 + каталог surface.json + docs/34-ores.md §3
 * + docs/31-resources.md §5.2):
 *   - mine (шахта)       — металлические руды (sourceBuildingId='mine');
 *   - quarry (карьер)    — неметаллические ресурсы (sourceBuildingId='quarry');
 *   - gas_extractor      — атмосферные газы (поверхность И слот — из атмосферы);
 *   - drilling_rig-руды  — post-MVP: базовым добытчикам недоступны;
 *   - H2O-ice (вода)     — R-27: добывается и шахтой, и карьером;
 *   - colony_hub         — базовая добыча (mine ∪ quarry ∪ вода) на 50% шахты.
 *
 * Дополнительно (найдено в Task 37): тождественные маппинги DIRECT_GAS_MAP
 * (He→He, Ne→Ne, Ar→Ar) раньше аннигилировали добытый газ.
 *
 * Все планеты — синтетические с ИЗВЕСТНЫМ составом залежей (не генерация).
 *
 * Run: bun test tests/economy/extraction-roles.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { processEconomyTick } from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { createDefaultWarehouse, getUsedCapacityByType } from '@/data/warehouse';
import { ATMOSPHERE_GAS_MAP, DIRECT_GAS_MAP } from '@/data/atmosphere-gases';
import type { Planet, HexCell, HexTerrain, EntityId, ProductionQueue, AtmosphericSlot, ResourceDeposit } from '@/core/types';

// Initialize baked lookups once for all tests (deterministic seed).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

/** Смешанная залежь: по одному представителю каждой роли + вода + газ. */
function mixedDeposits(): ResourceDeposit[] {
  return [
    { elementId: 'Fe-ore', availability: 0.5, quantity: 1000, depth: 1 },  // mine (metal_ore)
    { elementId: 'Si-ore', availability: 0.5, quantity: 1000, depth: 1 },  // quarry (nonmetal_ore)
    { elementId: 'Y-ore', availability: 0.5, quantity: 1000, depth: 4 },   // drilling_rig (deep_ore)
    { elementId: 'H2O-ice', availability: 0.5, quantity: 1000, depth: 1 }, // вода (R-27: mine+quarry)
  ];
}

interface MkOptions {
  buildingId?: string | null;
  buildingLevel?: number;
  terrain?: HexTerrain;
  atmosphere?: string;
  planetType?: string;
  deposits?: ResourceDeposit[];
  hexCount?: number;
  warehouseOverride?: Planet['warehouse'];
  extraHexes?: Array<{ buildingId: string | null; buildingLevel?: number; terrain?: HexTerrain; coord: { q: number; r: number } }>;
}

/** Минимальная планета с настраиваемым гексом/зданием/атмосферой. */
function makePlanet(opts: MkOptions = {}): Planet {
  const hexes: HexCell[] = [{
    coord: { q: 0, r: 0 },
    terrain: opts.terrain ?? ('plains' as HexTerrain),
    buildingId: opts.buildingId ?? null,
    buildingLevel: opts.buildingId ? (opts.buildingLevel ?? 1) : 0,
    deposits: opts.deposits ?? mixedDeposits(),
  }];
  for (const extra of opts.extraHexes ?? []) {
    hexes.push({
      coord: extra.coord,
      terrain: extra.terrain ?? ('plains' as HexTerrain),
      buildingId: extra.buildingId,
      buildingLevel: extra.buildingId ? (extra.buildingLevel ?? 1) : 0,
      deposits: [],
    });
  }
  return {
    id: 'p1' as EntityId,
    systemId: 's1' as EntityId,
    name: 'Extraction Roles Test',
    type: (opts.planetType ?? 'rocky') as Planet['type'],
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1,
    temperature: 15,
    atmosphere: { type: (opts.atmosphere ?? 'standard') as never, pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes,
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    resources: {},
    warehouse: opts.warehouseOverride ?? createDefaultWarehouse(),
    energyBalance: 1000,
    owner: 'player' as EntityId,
  };
}

function runTicks(planet: Planet, ticks: number): void {
  const queues = new Map<EntityId, ProductionQueue>();
  for (let i = 0; i < ticks; i++) processEconomyTick([planet], queues);
}

function depositQty(planet: Planet, elementId: string): number {
  return planet.hexes[0]!.deposits.find(d => d.elementId === elementId)?.quantity ?? -1;
}

describe('D1/G-01: роли поверхностных добытчиков (фильтр залежей)', () => {
  test('1. Шахта добывает ТОЛЬКО металлические руды + воду (R-27)', () => {
    const p = makePlanet({ buildingId: 'mine' });
    runTicks(p, 10);
    expect(p.resources['Fe-ore']).toBeCloseTo(10 * 1.0 * 0.5 * 1.15, 5); // 5.75
    expect(p.resources['H2O-ice']).toBeCloseTo(10 * 1.0 * 0.5 * 1.15, 5);
    expect(p.resources['Si-ore']).toBeUndefined(); // неметалл — карьер
    expect(p.resources['Y-ore']).toBeUndefined();  // глубинная — drilling_rig (post-MVP)
    expect(depositQty(p, 'Si-ore')).toBe(1000);    // залежи чужих ролей не тратятся
    expect(depositQty(p, 'Y-ore')).toBe(1000);
    expect(depositQty(p, 'Fe-ore')).toBeCloseTo(1000 - 5.75, 5);
  });

  test('2. Карьер добывает ТОЛЬКО неметаллические руды + воду', () => {
    const p = makePlanet({ buildingId: 'quarry' });
    runTicks(p, 10);
    // plains-бонус карьера 1.3 (каталог surface.json)
    expect(p.resources['Si-ore']).toBeCloseTo(10 * 1.0 * 0.5 * 1.15 * 1.3, 5); // 7.475
    expect(p.resources['H2O-ice']).toBeCloseTo(10 * 1.0 * 0.5 * 1.15 * 1.3, 5);
    expect(p.resources['Fe-ore']).toBeUndefined();
    expect(p.resources['Y-ore']).toBeUndefined();
    expect(depositQty(p, 'Fe-ore')).toBe(1000);
    expect(depositQty(p, 'Y-ore')).toBe(1000);
  });

  test('3. Глубинные руды drilling_rig недоступны НИ ОДНОМУ текущему добытчику', () => {
    // docs/31-resources.md §5.2: глубинная руда — drilling_rig (post-MVP)
    for (const b of ['mine', 'quarry', 'colony_hub'] as const) {
      const p = makePlanet({ buildingId: b });
      runTicks(p, 5);
      expect(p.resources['Y-ore'], `${b}`).toBeUndefined();
      expect(depositQty(p, 'Y-ore'), `${b}`).toBe(1000);
    }
  });

  test('4. Colony hub: базовая добыча mine ∪ quarry ∪ вода на 50% шахты', () => {
    const p = makePlanet({ buildingId: 'colony_hub' });
    runTicks(p, 10);
    // 0.5 (скорость хаба) × 0.5 (availability) × 1.1 (levelMult L1) = 0.275/тик
    expect(p.resources['Fe-ore']).toBeCloseTo(10 * 0.5 * 0.5 * 1.1, 5);
    expect(p.resources['Si-ore']).toBeCloseTo(10 * 0.5 * 0.5 * 1.1, 5);
    expect(p.resources['H2O-ice']).toBeCloseTo(10 * 0.5 * 0.5 * 1.1, 5);
    expect(p.resources['Y-ore']).toBeUndefined(); // глубинная добыча — не «базовые ресурсы»
  });

  test('5. Colony hub L3: levelMult 1 + 3×0.1 = 1.3', () => {
    const p = makePlanet({ buildingId: 'colony_hub', buildingLevel: 3 });
    runTicks(p, 10);
    expect(p.resources['Fe-ore']).toBeCloseTo(10 * 0.5 * 0.5 * 1.3, 5);
  });
});

describe('D1/G-01: газовый экстрактор — атмосфера, а не залежи', () => {
  test('6. Поверхностный экстрактор добывает газы АТМОСФЕРЫ (standard: Ar,N2,CO2,O2)', () => {
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'standard' });
    runTicks(p, 10);
    // 2.0 × 1.15 × 0.6 (standard) = 1.38/тик на газ
    const expected = 10 * 2.0 * 1.15 * 0.6;
    // N2→N и O2→O конвертируются 1:1 (DIRECT_GAS_MAP), CO2/Ar — сырые/чистые
    expect(p.resources['N']).toBeCloseTo(expected, 5);
    expect(p.resources['O']).toBeCloseTo(expected, 5);
    expect(p.resources['CO2']).toBeCloseTo(expected, 5);
    expect(p.resources['Ar']).toBeCloseTo(expected, 5); // тождественный газ НЕ аннигилирует
    // Залежи гекса не тронуты (экстрактор не рудник)
    for (const d of p.hexes[0]!.deposits) expect(d.quantity).toBe(1000);
    expect(p.resources['Fe-ore']).toBeUndefined();
  });

  test('7. Поверхностный экстрактор БЕЗ атмосферы ничего не добывает (P1-27)', () => {
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'none' });
    runTicks(p, 10);
    expect(Object.keys(p.resources).length).toBe(0);
    for (const d of p.hexes[0]!.deposits) expect(d.quantity).toBe(1000);
  });

  test('8. Набор газов = ATMOSPHERE_GAS_MAP для каждого типа атмосферы', () => {
    for (const [atmoType, gases] of Object.entries(ATMOSPHERE_GAS_MAP)) {
      const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: atmoType });
      runTicks(p, 3);
      const got = new Set(Object.keys(p.resources));
      const expected = new Set(gases.map(g => DIRECT_GAS_MAP[g] ?? g));
      expect([...got].sort(), atmoType).toEqual([...expected].sort());
    }
  });

  test('9. Атмосферный слот газового гиганта: эффективность 1.0 (P1-01)', () => {
    const p = makePlanet({
      buildingId: null, atmosphere: 'methane', planetType: 'gas_giant',
      deposits: [],
    });
    p.hexes = []; // у ГГ нет поверхности
    const slot: AtmosphericSlot = { index: 0, buildingId: 'gas_extractor', buildingLevel: 1 };
    p.atmosphericSlots = [slot];
    runTicks(p, 10);
    // methane: H2, CH4, NH3; ГГ ×1.0; H2→H конверсия
    const expected = 10 * 2.0 * 1.15 * 1.0;
    expect(p.resources['H']).toBeCloseTo(expected, 5);
    expect(p.resources['CH4']).toBeCloseTo(expected, 5);
    expect(p.resources['NH3']).toBeCloseTo(expected, 5);
  });

  test('10. Регрессия Task 37: He/Ne/Ar (тождественные DIRECT_GAS_MAP) не исчезают', () => {
    // inert: He, Ne, Ar, N2 — раньше вся добыча He/Ne/Ar аннигилировалась
    // в convertDirectAtmosphericElements (gasId === elementId перезапись)
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'inert' });
    runTicks(p, 10);
    const expected = 10 * 2.0 * 1.15 * 0.5; // inert efficiency 0.5
    expect(p.resources['He']).toBeCloseTo(expected, 5);
    expect(p.resources['Ne']).toBeCloseTo(expected, 5);
    expect(p.resources['Ar']).toBeCloseTo(expected, 5);
    expect(p.resources['N']).toBeCloseTo(expected, 5);
  });

  test('11. Поверхностный и слотовый экстракторы дают одинаковую скорость на одной планете', () => {
    // rocky-планета с атмосферой: поверхность против слота (случай невозможный
    // для реальной генерации, но контракт единый — extractAtmosphericGases)
    const pSlot = makePlanet({ buildingId: null, atmosphere: 'toxic', deposits: [] });
    pSlot.atmosphericSlots = [{ index: 0, buildingId: 'gas_extractor', buildingLevel: 1 }];
    const pSurface = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'toxic', deposits: [] });
    runTicks(pSlot, 10);
    runTicks(pSurface, 10);
    expect(pSurface.resources['N']).toBeCloseTo(pSlot.resources['N'] ?? 0, 5);
    expect(pSurface.resources['CO2']).toBeCloseTo(pSlot.resources['CO2'] ?? 0, 5);
    expect(pSurface.resources['NH3']).toBeCloseTo(pSlot.resources['NH3'] ?? 0, 5);
  });
});

describe('D1: модификаторы добычи (уровень, местность, синергия, склад)', () => {
  test('12. Уровень шахты: L3/L1 = (1+3×0.15)/(1+1×0.15) = 1.45/1.15', () => {
    const p1 = makePlanet({ buildingId: 'mine', buildingLevel: 1 });
    const p3 = makePlanet({ buildingId: 'mine', buildingLevel: 3 });
    runTicks(p1, 10);
    runTicks(p3, 10);
    expect(p3.resources['Fe-ore']! / p1.resources['Fe-ore']!).toBeCloseTo(1.45 / 1.15, 5);
  });

  test('13. Местность: шахта на горах ×1.5 (terrainBonus каталога)', () => {
    const plainsP = makePlanet({ buildingId: 'mine', terrain: 'plains' });
    const mountP = makePlanet({ buildingId: 'mine', terrain: 'mountains' });
    runTicks(plainsP, 10);
    runTicks(mountP, 10);
    expect(mountP.resources['Fe-ore']! / plainsP.resources['Fe-ore']!).toBeCloseTo(1.5, 5);
  });

  test('14. Синергия mining_cluster: смежная шахта +10% к скорости (docs §5.1)', () => {
    const solo = makePlanet({ buildingId: 'mine' });
    const paired = makePlanet({
      buildingId: 'mine',
      extraHexes: [{ buildingId: 'mine', coord: { q: 1, r: 0 } }],
    });
    runTicks(solo, 10);
    runTicks(paired, 10);
    expect(paired.resources['Fe-ore']! / solo.resources['Fe-ore']!).toBeCloseTo(1.1, 5);
  });

  test('15. Синергия mine≠quarry: разные подтипы НЕ бустят друг друга', () => {
    const solo = makePlanet({ buildingId: 'mine' });
    const mixed = makePlanet({
      buildingId: 'mine',
      extraHexes: [{ buildingId: 'quarry', coord: { q: 1, r: 0 } }],
    });
    runTicks(solo, 10);
    runTicks(mixed, 10);
    expect(mixed.resources['Fe-ore']! / solo.resources['Fe-ore']!).toBeCloseTo(1.0, 5);
  });

  test('16. Полный рудный склад: добыча останавливается, залежь НЕ испаряется', () => {
    // Рудный склад (база 5000) почти заполнен Si-ore (4990) — для Fe-ore
    // остаётся ровно 10. Вместимость считается по зданиям
    // (calculateWarehouseCapacities), поэтому заполняем ресурсами, не оверрайдом.
    const p = makePlanet({
      buildingId: 'mine',
      deposits: [{ elementId: 'Fe-ore', availability: 1.0, quantity: 1000, depth: 1 }],
    });
    p.resources['Si-ore'] = 4990; // другой тип руды занимает склад
    runTicks(p, 200); // 1.15/тик → 10 ед. доберутся за ~9 тиков, дальше стоп
    expect(p.resources['Fe-ore']).toBeCloseTo(10, 8);
    expect(depositQty(p, 'Fe-ore')).toBeCloseTo(990, 8); // ровно 10 добыто, ничего не исчезло
    const qBefore = depositQty(p, 'Fe-ore');
    runTicks(p, 50); // склад полон — залежь дальше не тратится
    expect(depositQty(p, 'Fe-ore')).toBeCloseTo(qBefore, 8);
    expect(p.resources['Fe-ore']).toBeCloseTo(10, 8);
  });

  test('17. Полный газовый склад: экстрактор останавливается на пределе (2000)', () => {
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'standard', deposits: [] });
    runTicks(p, 3000); // 4 газа × 1.38/тик — газовый склад 2000 заполнится
    expect(getUsedCapacityByType(p, 'gas')).toBeLessThanOrEqual(2000 + 1e-6);
  });
});
