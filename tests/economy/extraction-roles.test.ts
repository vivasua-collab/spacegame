/// <reference types="bun-types" />
/**
 * Task 37 / D1 (G-01) + ORE-POOLS-RUNTIME-01 (Issue #25): роли добывающих
 * зданий и ЕДИНЫЙ БЮДЖЕТ Добычи в processExtraction.
 *
 * Контракт (docs/40-buildings.md §2 + BakedOre.sourceBuildingId, docs/34 §3.8
 * + docs/31 §6/§7/§11 + docs/35 §2.7):
 *   - mine (шахта)       — металлические руды (sourceBuildingId='mine');
 *   - quarry (карьер)    — неметаллические ресурсы (sourceBuildingId='quarry');
 *   - gas_extractor      — атмосферные газы (поверхность И слот — из атмосферы,
 *                          НЕ из планетарных рудных пулов, docs/31 §9.3);
 *   - drilling_rig       — глубинные руды (deep_ore); порог —
 *                          BakedOre.minSourceLevel (R-36);
 *   - H2O-ice (вода)     — R-27: добывается и шахтой, и карьером;
 *   - colony_hub         — малый планетарный бюджет (50% baseRate) поверхностных
 *                          пулов (mine ∪ quarry ∪ вода); локальной добычи
 *                          «под своим гексом» больше нет (ORE-POOLS-DOCS-01).
 *
 * ORE-POOLS (Issue #25): руды — планетарные пулы (Planet.orePools); каждое
 * здание имеет ОДИН бюджет за тик, распределяемый планировщиком
 * «минимумы → пропорциональный излишек». В этих тестах минимумы резервов
 * заданы = 0 (роль-гейты проверяются изолированно от фазы A планировщика —
 * фаза A покрыта tests/economy/mining-scheduler.test.ts). При равных весах
 * пулов пропорциональное деление бюджета воспроизводит прежние числа
 * «1.0 × availability × множители» для двух равных кандидатов.
 *
 * Все планеты — синтетические с ИЗВЕСТНЫМ составом пулов (не генерация).
 *
 * Run: bun test tests/economy/extraction-roles.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { processEconomyTick } from '@/economy/engine';
import { setCurrentLookups, getCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { BUILDING_MAP } from '@/data/buildings';
import { createDefaultWarehouse, getUsedCapacityByType } from '@/data/warehouse';
import { ATMOSPHERE_GAS_MAP, DIRECT_GAS_MAP } from '@/data/atmosphere-gases';
import type { Planet, HexCell, HexTerrain, EntityId, ProductionQueue, AtmosphericSlot, PlanetOrePool, WarehouseReserve } from '@/core/types';

// Initialize baked lookups once for all tests (deterministic seed).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

/** Смешанные пулы: по одному представителю каждой роли + вода. */
function mixedPools(): PlanetOrePool[] {
  const mk = (oreId: string, tier: PlanetOrePool['tier']): PlanetOrePool => ({
    oreId, initialQuantity: 1000, remainingQuantity: 1000, availability: 0.5, tier,
  });
  return [
    mk('Fe-ore', 'profile'),   // mine (metal_ore)
    mk('Si-ore', 'rare'),      // quarry (nonmetal_ore)
    mk('Y-ore', 'ultra_rare'), // drilling_rig (deep_ore)
    mk('H2O-ice', 'rare'),     // вода (R-27: mine+quarry)
  ];
}

/** Резервы с нулевыми минимумами: фаза A планировщика отключена (роль-гейты изолированы). */
function zeroReserves(pools: PlanetOrePool[]): Record<string, WarehouseReserve> {
  return Object.fromEntries(pools.map((p) => [p.oreId, { resourceId: p.oreId, minimum: 0, priority: 1 }]));
}

interface MkOptions {
  buildingId?: string | null;
  buildingLevel?: number;
  terrain?: HexTerrain;
  atmosphere?: string;
  planetType?: string;
  pools?: PlanetOrePool[];
  hexCount?: number;
  warehouseOverride?: Planet['warehouse'];
  extraHexes?: Array<{ buildingId: string | null; buildingLevel?: number; terrain?: HexTerrain; coord: { q: number; r: number } }>;
}

/** Минимальная планета с настраиваемым зданием/пулами/атмосферой. */
function makePlanet(opts: MkOptions = {}): Planet {
  const pools = opts.pools ?? mixedPools();
  const hexes: HexCell[] = [{
    coord: { q: 0, r: 0 },
    terrain: opts.terrain ?? ('plains' as HexTerrain),
    buildingId: opts.buildingId ?? null,
    buildingLevel: opts.buildingId ? (opts.buildingLevel ?? 1) : 0,
  }];
  for (const extra of opts.extraHexes ?? []) {
    hexes.push({
      coord: extra.coord,
      terrain: extra.terrain ?? ('plains' as HexTerrain),
      buildingId: extra.buildingId,
      buildingLevel: extra.buildingId ? (extra.buildingLevel ?? 1) : 0,
    });
  }
  const baseWarehouse = opts.warehouseOverride ?? createDefaultWarehouse();
  const warehouse = opts.warehouseOverride
    ? baseWarehouse
    : { ...baseWarehouse, reserves: { ...baseWarehouse.reserves, ...zeroReserves(pools) } };
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
    orePools: pools,
    resources: {},
    warehouse,
    energyBalance: 1000,
    owner: 'player' as EntityId,
  };
}

function runTicks(planet: Planet, ticks: number): void {
  const queues = new Map<EntityId, ProductionQueue>();
  for (let i = 0; i < ticks; i++) processEconomyTick([planet], queues);
}

/** Остаток планетарного пула (недра). */
function poolQty(planet: Planet, oreId: string): number {
  return planet.orePools.find(p => p.oreId === oreId)?.remainingQuantity ?? -1;
}

describe('D1/G-01: роли поверхностных добытчиков (планетарные пулы)', () => {
  test('1. Шахта добывает ТОЛЬКО металлические руды + воду (R-27)', () => {
    const p = makePlanet({ buildingId: 'mine' });
    runTicks(p, 10);
    // Единый бюджет L1 = 1.15; два равных кандидата (Fe, H2O; веса по
    // remaining×availability равны) → по 0.575/тик каждому.
    expect(p.resources['Fe-ore']).toBeCloseTo(10 * 1.15 / 2, 5);
    expect(p.resources['H2O-ice']).toBeCloseTo(10 * 1.15 / 2, 5);
    expect(p.resources['Si-ore']).toBeUndefined(); // неметалл — карьер
    expect(p.resources['Y-ore']).toBeUndefined();  // глубинная — drilling_rig
    expect(poolQty(p, 'Si-ore')).toBe(1000);       // пулы чужих ролей не тратятся
    expect(poolQty(p, 'Y-ore')).toBe(1000);
    expect(poolQty(p, 'Fe-ore')).toBeCloseTo(1000 - 5.75, 5);
  });

  test('2. Карьер добывает ТОЛЬКО неметаллические руды + воду', () => {
    const p = makePlanet({ buildingId: 'quarry' });
    runTicks(p, 10);
    // plains-бонус карьера 1.3 (каталог surface.json): бюджет 1.15×1.3 = 1.495
    expect(p.resources['Si-ore']).toBeCloseTo(10 * 1.15 * 1.3 / 2, 5);
    expect(p.resources['H2O-ice']).toBeCloseTo(10 * 1.15 * 1.3 / 2, 5);
    expect(p.resources['Fe-ore']).toBeUndefined();
    expect(p.resources['Y-ore']).toBeUndefined();
    expect(poolQty(p, 'Fe-ore')).toBe(1000);
    expect(poolQty(p, 'Y-ore')).toBe(1000);
  });

  test('3. Глубинные руды drilling_rig недоступны НИ ОДНОМУ базовому добытчику', () => {
    // docs/31 §5.2: глубинная руда — drilling_rig. R-36: drilling_rig есть
    // в MVP — но mine/quarry/hub по-прежнему не добывают deep_ore.
    for (const b of ['mine', 'quarry', 'colony_hub'] as const) {
      const p = makePlanet({ buildingId: b });
      runTicks(p, 5);
      expect(p.resources['Y-ore'], `${b}`).toBeUndefined();
      expect(poolQty(p, 'Y-ore'), `${b}`).toBe(1000);
    }
  });

  test('4. Colony hub: малый общий бюджет поверхностных пулов (50% baseRate)', () => {
    const p = makePlanet({ buildingId: 'colony_hub' });
    runTicks(p, 10);
    // ORE-POOLS: один бюджет хаба 0.5×1.1 = 0.55 делится между ТРЕМЯ
    // поверхностными пулами (Fe, Si, H2O) — по 0.55/3 на каждого.
    // Глубинная Y-ore хабу недоступна; локальной добычи «под гексом» нет.
    const perOre = 10 * (0.5 * 1.1) / 3;
    expect(p.resources['Fe-ore']).toBeCloseTo(perOre, 5);
    expect(p.resources['Si-ore']).toBeCloseTo(perOre, 5);
    expect(p.resources['H2O-ice']).toBeCloseTo(perOre, 5);
    expect(p.resources['Y-ore']).toBeUndefined();
    // Сумма добытого всеми рудами за тик ≤ бюджет хаба (единый бюджет).
    const total = (p.resources['Fe-ore'] ?? 0) + (p.resources['Si-ore'] ?? 0) + (p.resources['H2O-ice'] ?? 0);
    expect(total).toBeCloseTo(10 * 0.55, 5);
  });

  test('5. Colony hub L3: levelMult 1 + 3×0.1 = 1.3', () => {
    const p = makePlanet({ buildingId: 'colony_hub', buildingLevel: 3 });
    runTicks(p, 10);
    expect(p.resources['Fe-ore']).toBeCloseTo(10 * (0.5 * 1.3) / 3, 5);
  });
});

describe('D1/G-01: газовый экстрактор — атмосфера, а не планетарные пулы', () => {
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
    // Планетарные пулы не тронуты (экстрактор не рудник, docs/31 §9.3)
    for (const pool of p.orePools) expect(pool.remainingQuantity).toBe(1000);
    expect(p.resources['Fe-ore']).toBeUndefined();
  });

  test('7. Поверхностный экстрактор БЕЗ атмосферы ничего не добывает (P1-27)', () => {
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'none' });
    runTicks(p, 10);
    expect(Object.keys(p.resources).length).toBe(0);
    for (const pool of p.orePools) expect(pool.remainingQuantity).toBe(1000);
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
      pools: [],
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
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'inert' });
    runTicks(p, 10);
    const expected = 10 * 2.0 * 1.15 * 0.5; // inert efficiency 0.5
    expect(p.resources['He']).toBeCloseTo(expected, 5);
    expect(p.resources['Ne']).toBeCloseTo(expected, 5);
    expect(p.resources['Ar']).toBeCloseTo(expected, 5);
    expect(p.resources['N']).toBeCloseTo(expected, 5);
  });

  test('11. Поверхностный и слотовый экстракторы дают одинаковую скорость на одной планете', () => {
    const pSlot = makePlanet({ buildingId: null, atmosphere: 'toxic', pools: [] });
    pSlot.atmosphericSlots = [{ index: 0, buildingId: 'gas_extractor', buildingLevel: 1 }];
    const pSurface = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'toxic', pools: [] });
    runTicks(pSlot, 10);
    runTicks(pSurface, 10);
    expect(pSurface.resources['N']).toBeCloseTo(pSlot.resources['N'] ?? 0, 5);
    expect(pSurface.resources['CO2']).toBeCloseTo(pSlot.resources['CO2'] ?? 0, 5);
    expect(pSurface.resources['NH3']).toBeCloseTo(pSlot.resources['NH3'] ?? 0, 5);
  });
});

describe('D1: единый бюджет добычи (уровень, местность, синергия, склад)', () => {
  test('12. Уровень шахты: L3/L1 = (1+3×0.15)/(1+1×0.15) = 1.45/1.15', () => {
    // Одиночный кандидат получает весь бюджет → множители видны напрямую.
    const soloPool = (): PlanetOrePool[] => [{ oreId: 'Fe-ore', initialQuantity: 1000, remainingQuantity: 1000, availability: 0.5, tier: 'profile' }];
    const p1 = makePlanet({ buildingId: 'mine', buildingLevel: 1, pools: soloPool() });
    const p3 = makePlanet({ buildingId: 'mine', buildingLevel: 3, pools: soloPool() });
    runTicks(p1, 10);
    runTicks(p3, 10);
    expect(p3.resources['Fe-ore']! / p1.resources['Fe-ore']!).toBeCloseTo(1.45 / 1.15, 5);
  });

  test('13. Местность: шахта на горах ×1.5 (terrainBonus каталога)', () => {
    const soloPool = (): PlanetOrePool[] => [{ oreId: 'Fe-ore', initialQuantity: 100000, remainingQuantity: 100000, availability: 0.5, tier: 'profile' }];
    const plainsP = makePlanet({ buildingId: 'mine', terrain: 'plains', pools: soloPool() });
    const mountP = makePlanet({ buildingId: 'mine', terrain: 'mountains', pools: soloPool() });
    runTicks(plainsP, 10);
    runTicks(mountP, 10);
    expect(mountP.resources['Fe-ore']! / plainsP.resources['Fe-ore']!).toBeCloseTo(1.5, 5);
  });

  test('14. Синергия mining_cluster: смежные шахты +10% к бюджету каждой (docs §5.1)', () => {
    // ORE-POOLS: обе шахты добывают ОДИН планетарный пул, поэтому сравниваем
    // ПАРЫ (смежные vs удалённые) при одинаковом числе зданий/пулов.
    const soloPool = (): PlanetOrePool[] => [{ oreId: 'Fe-ore', initialQuantity: 1000000, remainingQuantity: 1000000, availability: 0.5, tier: 'profile' }];
    const adjacent = makePlanet({
      buildingId: 'mine',
      pools: soloPool(),
      extraHexes: [{ buildingId: 'mine', coord: { q: 1, r: 0 } }],
    });
    const apart = makePlanet({
      buildingId: 'mine',
      pools: soloPool(),
      extraHexes: [{ buildingId: 'mine', coord: { q: 5, r: 0 } }],
    });
    runTicks(adjacent, 10);
    runTicks(apart, 10);
    expect(adjacent.resources['Fe-ore']! / apart.resources['Fe-ore']!).toBeCloseTo(1.1, 5);
  });

  test('15. Синергия mine≠quarry: разные подтипы НЕ бустят друг друга', () => {
    // Fe-ore добывает только шахта → добыча Fe отражает бюджет шахты;
    // присутствие карьера (другой подтип) не должно её увеличивать.
    const soloPool = (): PlanetOrePool[] => [{ oreId: 'Fe-ore', initialQuantity: 1000000, remainingQuantity: 1000000, availability: 0.5, tier: 'profile' }];
    const solo = makePlanet({ buildingId: 'mine', pools: soloPool() });
    const mixed = makePlanet({
      buildingId: 'mine',
      pools: soloPool(),
      extraHexes: [{ buildingId: 'quarry', coord: { q: 1, r: 0 } }],
    });
    runTicks(solo, 10);
    runTicks(mixed, 10);
    expect(mixed.resources['Fe-ore']! / solo.resources['Fe-ore']!).toBeCloseTo(1.0, 5);
  });

  test('16. Полный рудный склад: добыча останавливается, пул НЕ испаряется', () => {
    // Рудный склад (база 5000) почти заполнен Si-ore (4990) — для Fe-ore
    // остаётся ровно 10. Из пула вычитается только помещённый объём
    // (docs/31 §7.2.5: непомещённое сырьё НЕ расходует месторождение).
    const p = makePlanet({
      buildingId: 'mine',
      pools: [{ oreId: 'Fe-ore', initialQuantity: 1000, remainingQuantity: 1000, availability: 1.0, tier: 'profile' }],
    });
    p.resources['Si-ore'] = 4990; // другой тип руды занимает склад
    runTicks(p, 200); // бюджет 1.15/тик → 10 ед. доберутся за ~9 тиков, дальше стоп
    expect(p.resources['Fe-ore']).toBeCloseTo(10, 8);
    expect(poolQty(p, 'Fe-ore')).toBeCloseTo(990, 8); // ровно 10 добыто, ничего не исчезло
    const qBefore = poolQty(p, 'Fe-ore');
    runTicks(p, 50); // склад полон — пул дальше не тратится
    expect(poolQty(p, 'Fe-ore')).toBeCloseTo(qBefore, 8);
    expect(p.resources['Fe-ore']).toBeCloseTo(10, 8);
  });

  test('17. Полный газовый склад: экстрактор останавливается на пределе (2000)', () => {
    const p = makePlanet({ buildingId: 'gas_extractor', atmosphere: 'standard', pools: [] });
    runTicks(p, 3000); // 4 газа × 1.38/тик — газовый склад 2000 заполнится
    expect(getUsedCapacityByType(p, 'gas')).toBeLessThanOrEqual(2000 + 1e-6);
  });
});

// ============ R-36: буровая установка (drilling_rig) — MVP ============

/** Все 10 руд спека-пула ultra_rare (docs/31 §2, вариант «а»). */
const SPEC_ULTRA_ORES = ULTRA_RARE_ELEMENTS.map(el => `${el}-ore`);

describe('R-36: буровая установка — глубокие руды планетарных пулов', () => {
  test('R1. Негатив: mine/quarry/colony_hub НЕ добывают НИ ОДНУ из 10 спековых руд', () => {
    const pools: PlanetOrePool[] = SPEC_ULTRA_ORES.map(oreId => ({
      oreId, initialQuantity: 1000, remainingQuantity: 1000, availability: 0.5, tier: 'ultra_rare' as const,
    }));
    for (const b of ['mine', 'quarry', 'colony_hub'] as const) {
      const p = makePlanet({ buildingId: b, pools });
      runTicks(p, 10);
      for (const oreId of SPEC_ULTRA_ORES) {
        expect(p.resources[oreId], `${b} / ${oreId}`).toBeUndefined();
      }
      // пулы не тратятся
      for (const pool of p.orePools) expect(pool.remainingQuantity, `${b} / ${pool.oreId}`).toBe(1000);
    }
  });

  test('R2. Позитив: буровая L10 извлекает КАЖДУЮ из 10 спековых руд', () => {
    for (const oreId of SPEC_ULTRA_ORES) {
      const p = makePlanet({
        buildingId: 'drilling_rig',
        buildingLevel: 10, // покрывает все minSourceLevel ≤ 8 (Re)
        pools: [{ oreId, initialQuantity: 1000, remainingQuantity: 1000, availability: 0.5, tier: 'ultra_rare' }],
      });
      runTicks(p, 10);
      // Единый бюджет L10: 1.0 × (1 + 10×0.15) = 2.5/тик (одиночный кандидат —
      // весь бюджет) → 25 за 10 тиков. availability — вес, не множитель бюджета.
      expect(p.resources[oreId], `${oreId} добыта буровой`).toBeCloseTo(25, 5);
      expect(poolQty(p, oreId), `${oreId} пул истощается`).toBeCloseTo(1000 - 25, 5);
    }
  });

  test('R3. Порог глубины: Re-ore (minSourceLevel 8) — L7 нет, L8 да', () => {
    for (const [level, extracted] of [[7, false], [8, true]] as const) {
      const p = makePlanet({
        buildingId: 'drilling_rig',
        buildingLevel: level,
        pools: [{ oreId: 'Re-ore', initialQuantity: 1000, remainingQuantity: 1000, availability: 0.5, tier: 'ultra_rare' }],
      });
      runTicks(p, 10);
      if (extracted) {
        // L8: бюджет 1.0 × (1 + 8×0.15) = 2.2/тик
        expect(p.resources['Re-ore'], `L${level}`).toBeCloseTo(22, 5);
      } else {
        expect(p.resources['Re-ore'], `L${level}`).toBeUndefined();
        expect(poolQty(p, 'Re-ore'), `L${level}: пул не тратится`).toBe(1000);
      }
    }
  });

  test('R4. Порог глубины: Y-ore (minSourceLevel 2) — L1 нет, L2 да; Ba-ore (1) — L1 да', () => {
    const mkPool = (oreId: string): PlanetOrePool[] => [{ oreId, initialQuantity: 1000, remainingQuantity: 1000, availability: 0.5, tier: 'ultra_rare' }];
    const y1 = makePlanet({ buildingId: 'drilling_rig', buildingLevel: 1, pools: mkPool('Y-ore') });
    runTicks(y1, 10);
    expect(y1.resources['Y-ore'], 'Y-ore L1 (порог 2)').toBeUndefined();

    const y2 = makePlanet({ buildingId: 'drilling_rig', buildingLevel: 2, pools: mkPool('Y-ore') });
    runTicks(y2, 10);
    expect(y2.resources['Y-ore'], 'Y-ore L2').toBeCloseTo(10 * 1.3, 5);

    const ba1 = makePlanet({ buildingId: 'drilling_rig', buildingLevel: 1, pools: mkPool('Ba-ore') });
    runTicks(ba1, 10);
    expect(ba1.resources['Ba-ore'], 'Ba-ore L1 (порог 1)').toBeCloseTo(10 * 1.15, 5);
  });

  test('R5. Каталог: drilling_rig — extraction/surface/10 уровней; у ВСЕХ deep_ore порог ≤ 10', () => {
    const def = BUILDING_MAP.get('drilling_rig');
    expect(def, 'drilling_rig в каталоге (data-driven surface.json)').toBeDefined();
    expect(def!.category).toBe('extraction');
    expect(def!.layer).toContain('surface');
    expect(def!.levels).toBe(10);

    const lookups = getCurrentLookups();
    for (const ore of lookups.oreMap.values()) {
      if (ore.sourceBuildingId === 'drilling_rig') {
        expect(ore.minSourceLevel, `${ore.id}: порог достижим`).toBeLessThanOrEqual(10);
      }
    }
  });

  test('R6. Регрессия порога: у ВСЕХ mine/quarry-руд minSourceLevel=1 (поведение L1 без изменений)', () => {
    const lookups = getCurrentLookups();
    for (const ore of lookups.oreMap.values()) {
      if (ore.sourceBuildingId === 'mine' || ore.sourceBuildingId === 'quarry') {
        expect(ore.minSourceLevel, `${ore.id}`).toBe(1);
      }
    }
  });

  test('R7. Синергия mining_cluster: две смежные буровые +10% (тот же подтип)', () => {
    // Сравнение пар (смежные vs удалённые) — обе буровые добывают один пул.
    const soloPool = (): PlanetOrePool[] => [{ oreId: 'Zr-ore', initialQuantity: 1000000, remainingQuantity: 1000000, availability: 0.5, tier: 'ultra_rare' }];
    const adjacent = makePlanet({
      buildingId: 'drilling_rig', buildingLevel: 3, pools: soloPool(),
      extraHexes: [{ buildingId: 'drilling_rig', buildingLevel: 1, coord: { q: 1, r: 0 } }],
    });
    const apart = makePlanet({
      buildingId: 'drilling_rig', buildingLevel: 3, pools: soloPool(),
      extraHexes: [{ buildingId: 'drilling_rig', buildingLevel: 1, coord: { q: 5, r: 0 } }],
    });
    runTicks(adjacent, 10);
    runTicks(apart, 10);
    // Zr-ore minSourceLevel 3 — L3 обеих буровых проходит порог
    expect(adjacent.resources['Zr-ore']! / apart.resources['Zr-ore']!).toBeCloseTo(1.1, 5);
  });
});
