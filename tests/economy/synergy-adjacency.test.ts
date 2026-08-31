/// <reference types="bun-types" />
/**
 * R-SYNERGY v2 (Задача 24) tests: движок Синергии — ТИПОВЫЕ бонусы соседства.
 *
 * Проверяется (docs/40-buildings.md §5):
 *   - соседство axial-координат (6 направлений, симметрия);
 *   - типизация зданий (generator/extractor/processor/…, роль consumer);
 *   - подтипы: sameSubtypeOnly — разные подтипы не дают бонусов друг другу
 *     (mine ≠ quarry, solar_plant ≠ nuclear_reactor);
 *   - стекинг с убывающей отдачей §5.2 (value × Σ decay^i);
 *   - множители energy_consumption / energy_generation / mining_speed;
 *   - кластеры лабораторий §5.4 «на каждую» (средний агрегат);
 *   - синергия только на поверхности (слоты без смежности);
 *   - интеграция с resolveBonuses (research_rate);
 *   - R-24: чистые хелперы getBuildingEnergyOutput/Consumption (P1-26).
 *
 * Run: bun test tests/economy/synergy-adjacency.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  getNeighborIndices,
  countSynergyNeighbors,
  getSynergyBonusValue,
  getSynergyContribution,
  getProcessingSpeedMultiplier,
  getEnergyConsumptionMultiplier,
  getEnergyGenerationMultiplier,
  getMiningSpeedMultiplier,
  getLabClusterBoost,
  getActiveSynergiesForHex,
} from '@/economy/adjacency';
import {
  SYNERGY_RULES,
  getSynergyBuildingType,
  isEnergyConsumer,
} from '@/data/buildings/synergy';
import { resolveBonuses } from '@/research/bonus-resolver';
import { BUILDING_MAP } from '@/data/buildings';
import { getBuildingEnergyOutput, getBuildingEnergyConsumption } from '@/economy/engine';
import type { Planet, GameState, HexCell } from '@/core/types';

/** Построить планету с произвольным набором гексов (coords + buildingId). */
function makePlanet(hexes: Array<{ q: number; r: number; id?: string; level?: number }>): Planet {
  return {
    id: 'p1',
    systemId: 's1',
    name: 'Adjacency Test Planet',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1,
    temperature: 20,
    atmosphere: { type: 'standard', pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes: hexes.map((h) => ({
      coord: { q: h.q, r: h.r },
      terrain: 'plains' as const,
      buildingId: h.id ?? null,
      buildingLevel: h.id ? (h.level ?? 1) : 0,
      deposits: [],
    })),
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 0,
    owner: 'player',
  };
}

/** GameState c одной планетой (для resolveBonuses). */
function makeState(planet: Planet): GameState {
  return {
    time: { tick: 0, dayInYear: 0, year: 1 },
    speed: 1,
    phase: 'playing',
    galaxy: {
      id: 'g1', seed: 1,
      systems: [{ id: 's1', name: 'S', position: { x: 0, y: 0 }, binaryType: 'BINARY_NONE', stars: [], planets: [planet], asteroidFields: 0, jumpPoints: [], discovered: true, owner: null }],
      systemMap: new Map(),
      bakedModel: { createdAt: 'test', elements: [], oreSpecs: [], iceSpecs: [], atmosphericGases: [] } as never,
    },
    fleets: [],
    productionQueues: new Map(),
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map(),
    playerFactionId: 'player',
    researchState: {
      fundamentalLevels: { chemistry: 0, physics: 0, engineering: 0, biology_fund: 0, military_science: 0, xenoarchaeology: 0 },
      fundamentalRpInvested: {},
      rpBank: 0,
      researched: {},
      activeSlots: [],
      researchQueue: [],
      totalRpGenerated: 0,
    },
  } as GameState;
}

const HEXES_ROW = [
  { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 },
];

describe('R-SYNERGY — соседство гексов (getNeighborIndices)', () => {
  test('ряд: внутренний гекс имеет 2 соседей (+q идёт первым), крайний — 1', () => {
    const planet = makePlanet(HEXES_ROW.map((h) => ({ ...h, id: 'mine' })));
    expect(getNeighborIndices(planet, 0)).toEqual([1]);
    // Порядок направлений: (+1,0) → idx 3, затем (−1,0) → idx 1.
    expect(getNeighborIndices(planet, 2)).toEqual([3, 1]);
    expect(getNeighborIndices(planet, 4)).toEqual([3]);
  });

  test('все 6 направлений axial: центр ромба 3×3 → 6 соседей', () => {
    const coords = [
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
      { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 },
      { q: 0, r: 2 }, { q: 1, r: 2 }, { q: 2, r: 2 },
    ];
    const planet = makePlanet(coords.map((h) => ({ ...h, id: 'mine' })));
    // Центр (1,1) — индекс 4. Соседи: (0,1) i=3, (2,1) i=5, (1,0) i=1,
    // (1,2) i=7, (2,0) i=2, (0,2) i=6 → 6 шт.
    const neighbors = getNeighborIndices(planet, 4).sort((a, b) => a - b);
    expect(neighbors).toEqual([1, 2, 3, 5, 6, 7]);
  });

  test('несуществующий индекс / единственный гекс → []', () => {
    const planet = makePlanet([{ q: 0, r: 0 }]);
    expect(getNeighborIndices(planet, 99)).toEqual([]);
    expect(getNeighborIndices(planet, 0)).toEqual([]); // соседей нет — 1 гекс
  });
});

describe('R-SYNERGY v2 — типизация зданий (Задача 24)', () => {
  test('типы производные от category: energy→generator, extraction→extractor, processing→processor', () => {
    expect(getSynergyBuildingType('solar_plant')).toBe('generator');
    expect(getSynergyBuildingType('nuclear_reactor')).toBe('generator');
    expect(getSynergyBuildingType('mine')).toBe('extractor');
    expect(getSynergyBuildingType('quarry')).toBe('extractor');
    expect(getSynergyBuildingType('gas_extractor')).toBe('extractor');
    expect(getSynergyBuildingType('processor')).toBe('processor');
    expect(getSynergyBuildingType('synthesizer')).toBe('processor');
    expect(getSynergyBuildingType('refinery')).toBe('processor');
    expect(getSynergyBuildingType('laboratory')).toBe('research');
    expect(getSynergyBuildingType('warehouse')).toBe('storage');
    expect(getSynergyBuildingType('shipyard')).toBe('production');
    expect(getSynergyBuildingType('colony_hub')).toBe('colony');
  });

  test('роль consumer: eCon > 0; генераторы (eCon = 0) — НЕ потребители', () => {
    expect(isEnergyConsumer('mine')).toBe(true);       // eCon 2
    expect(isEnergyConsumer('laboratory')).toBe(true); // eCon 10
    expect(isEnergyConsumer('processor')).toBe(true);  // eCon 5
    // Подтипы генераторов не дают бонусов друг другу: ни solar, ни nuclear
    // не являются потребителями → power_grid/power_boost между ними не срабатывают.
    expect(isEnergyConsumer('solar_plant')).toBe(false);
    expect(isEnergyConsumer('nuclear_reactor')).toBe(false);
    expect(isEnergyConsumer(null)).toBe(false);
  });

  test('неизвестное здание → null-тип', () => {
    expect(getSynergyBuildingType('nonexistent_building')).toBeNull();
    expect(getSynergyBuildingType(null)).toBeNull();
  });
});

describe('R-SYNERGY v2 — mining_cluster (Задача 24: добыча ускоряет добычу)', () => {
  const miningRule = SYNERGY_RULES.find((r) => r.id === 'mining_cluster')!;

  test('шахта + 3 смежные шахты (тот же подтип) → 0.1 × (1 + 0.5 + 0.25) = 0.175', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'mine' },
      { q: 0, r: 1, id: 'mine' },
      { q: 1, r: -1, id: 'mine' },
    ]);
    expect(countSynergyNeighbors(planet, 0, miningRule)).toBe(3);
    expect(getSynergyBonusValue(planet, 0, miningRule)).toBeCloseTo(0.175, 6);
    expect(getMiningSpeedMultiplier(planet, 0)).toBeCloseTo(1.175, 6);
  });

  test('один сосед → полная величина (без затухания)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    expect(getMiningSpeedMultiplier(planet, 0)).toBeCloseTo(1.1, 6);
    expect(getMiningSpeedMultiplier(planet, 1)).toBeCloseTo(1.1, 6); // симметрия
  });

  test('ПОДТИПЫ: шахта + карьер (разные подтипы extractor) → НЕТ бонуса', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'quarry' },
    ]);
    expect(countSynergyNeighbors(planet, 0, miningRule)).toBe(0);
    expect(getMiningSpeedMultiplier(planet, 0)).toBe(1);
    expect(getMiningSpeedMultiplier(planet, 1)).toBe(1);
  });

  test('не-экстрактор (переработчик рядом с шахтами) → НЕТ mining_speed', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'processor' },
      { q: 1, r: 0, id: 'mine' },
      { q: 0, r: 1, id: 'mine' },
    ]);
    // Кросс-типовое правило mine_processor отложено (Задача 24) —
    // переработчик не получает ни mining_speed, ни processing_speed.
    expect(getSynergyContribution(planet, 0, 'mining_speed')).toBe(0);
    expect(getProcessingSpeedMultiplier(planet, 0)).toBe(1);
  });

  test('уровень 0 соседа не считается (docs §5.3.2)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'mine', level: 0 },
    ]);
    expect(getMiningSpeedMultiplier(planet, 0)).toBe(1);
  });
});

describe('R-SYNERGY v2 — power_grid / power_boost (Задача 24: типы энергий)', () => {
  test('power_grid: потребитель (шахта) с 1 смежной ЭС → множитель 0.95', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'solar_plant' },
    ]);
    expect(getEnergyConsumptionMultiplier(planet, 0)).toBeCloseTo(0.95, 6);
  });

  test('power_grid: 2 смежные ЭС → 1 − (0.05 + 0.025) = 0.925', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'solar_plant' },
      { q: 0, r: 1, id: 'nuclear_reactor' },
    ]);
    expect(getEnergyConsumptionMultiplier(planet, 0)).toBeCloseTo(0.925, 6);
  });

  test('power_boost (НОВОЕ): ЭС с 1 смежным потребителем → генерация ×1.05', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'solar_plant' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    expect(getEnergyGenerationMultiplier(planet, 0)).toBeCloseTo(1.05, 6);
  });

  test('power_boost: 2 смежных потребителя → 1 + 0.05 + 0.025 = 1.075', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'nuclear_reactor' },
      { q: 1, r: 0, id: 'mine' },
      { q: 0, r: 1, id: 'processor' },
    ]);
    expect(getEnergyGenerationMultiplier(planet, 0)).toBeCloseTo(1.075, 6);
  });

  test('ПОДТИПЫ: солнечная + ядерная (оба generator) → НЕ бустят друг друга', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'solar_plant' },
      { q: 1, r: 0, id: 'nuclear_reactor' },
    ]);
    // Ни одна не потребитель → power_grid/power_boost между ними не действуют.
    expect(getEnergyGenerationMultiplier(planet, 0)).toBe(1);
    expect(getEnergyGenerationMultiplier(planet, 1)).toBe(1);
    expect(getEnergyConsumptionMultiplier(planet, 0)).toBe(1);
    expect(getEnergyConsumptionMultiplier(planet, 1)).toBe(1);
  });

  test('взаимность: ЭС бустит генерацию от потребителя, потребитель снижает потребление от ЭС', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'solar_plant' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    // У ЭС — бонус ГЕНЕРАЦИИ (power_boost), у шахты — снижение ПОТРЕБЛЕНИЯ (power_grid).
    expect(getEnergyGenerationMultiplier(planet, 0)).toBeCloseTo(1.05, 6);
    expect(getEnergyConsumptionMultiplier(planet, 1)).toBeCloseTo(0.95, 6);
    // Двусторонняя пара: ЭС не потребляет → у неё нет снижения потребления.
    expect(getEnergyConsumptionMultiplier(planet, 0)).toBe(1);
  });
});

describe('R-SYNERGY — кластеры лабораторий §5.4 («на каждую», средний агрегат)', () => {
  test('2 смежные лаборатории: boostSum = 0.2, labCount = 2 → агрегат +10%', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 1, r: 0, id: 'laboratory' },
    ]);
    expect(getLabClusterBoost(planet)).toEqual({ boostSum: 0.2, labCount: 2 });
  });

  test('компактный кластер 2×2 (ромб): реальные hex-диагонали → boostSum = 0.65', () => {
    // В hex-топологии «2×2» (ромб (0,0),(1,0),(0,1),(1,1)) ЕСТЬ диагональная
    // смежность (1,0)↔(0,1) (направление −1,+1): две лаборатории имеют
    // по 3 смежных, две — по 2. docs §5.4 «по +15%» — идеализация ASCII;
    // фактический вклад: 0.15 + 0.175 + 0.175 + 0.15 = 0.65 → среднее +16.25%.
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 1, r: 0, id: 'laboratory' },
      { q: 0, r: 1, id: 'laboratory' },
      { q: 1, r: 1, id: 'laboratory' },
    ]);
    const { boostSum, labCount } = getLabClusterBoost(planet);
    expect(boostSum).toBeCloseTo(0.65, 6);
    expect(labCount).toBe(4);
  });

  test('линия 4 лабораторий: концы по 1 смежному, центральные по 2 → boostSum = 0.5, агрегат +12.5%', () => {
    // В hex-топологии 4 лаборатории с РОВНО 2 смежными у каждой невозможны
    // (минимальный цикл = 6 гексов). Линия: 0.1 + 0.15 + 0.15 + 0.1 = 0.5;
    // ромб (тест выше) — 0.65. docs §5.4 «по +15%» — идеализация ASCII-схемы.
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 1, r: 0, id: 'laboratory' },
      { q: 2, r: 0, id: 'laboratory' },
      { q: 3, r: 0, id: 'laboratory' },
    ]);
    const { boostSum, labCount } = getLabClusterBoost(planet);
    expect(boostSum).toBeCloseTo(0.5, 6);
    expect(labCount).toBe(4);
  });

  test('изолированные лаборатории разбавляют среднее (в знаменателе, вклад 0)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 1, r: 0, id: 'laboratory' }, // смежная пара
      { q: 5, r: 5, id: 'laboratory' }, // изолированная
    ]);
    expect(getLabClusterBoost(planet)).toEqual({ boostSum: 0.2, labCount: 3 });
  });

  test('слот-лаборатории считаются в labCount, но не дают смежности', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 1, r: 0, id: 'laboratory' },
    ]);
    planet.atmosphericSlots.push({ buildingId: 'laboratory', buildingLevel: 1 });
    expect(getLabClusterBoost(planet)).toEqual({ boostSum: 0.2, labCount: 3 });
  });

  test('уровень 0 не считается лабораторией', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory', level: 0 },
      { q: 1, r: 0, id: 'laboratory' },
    ]);
    expect(getLabClusterBoost(planet)).toEqual({ boostSum: 0, labCount: 1 });
  });

  test('интеграция с resolveBonuses: 2 смежные L1 → 1 + 0.02×2 + 0.10 = 1.14', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 1, r: 0, id: 'laboratory' },
    ]);
    expect(resolveBonuses(makeState(planet), 'research_rate')).toBeCloseTo(1.14, 5);
  });

  test('интеграция: лаборатории НЕ смежны → только сумма уровней, без кластера', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'laboratory' },
      { q: 2, r: 0, id: 'laboratory' },
    ]);
    expect(resolveBonuses(makeState(planet), 'research_rate')).toBeCloseTo(1.04, 5);
  });
});

describe('R-SYNERGY — UI-хелпер (getActiveSynergiesForHex)', () => {
  test('шахта со смежной шахтой: mining_cluster активен с 1 соседом', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    const synergies = getActiveSynergiesForHex(planet, 0);
    expect(synergies.length).toBe(1);
    expect(synergies[0]!.rule.id).toBe('mining_cluster');
    expect(synergies[0]!.neighbors).toBe(1);
    expect(synergies[0]!.bonus).toBeCloseTo(0.1, 6);
  });

  test('солнечная станция со смежным потребителем: power_boost (генерация)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'solar_plant' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    const synergies = getActiveSynergiesForHex(planet, 0);
    expect(synergies.length).toBe(1);
    expect(synergies[0]!.rule.id).toBe('power_boost');
    expect(synergies[0]!.rule.bonusTarget).toBe('energy_generation');
    expect(synergies[0]!.bonus).toBeCloseTo(0.05, 6);
  });

  test('шахта со смежной ЭС: power_grid (энергопотребление), mining нет', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'solar_plant' },
    ]);
    const synergies = getActiveSynergiesForHex(planet, 0);
    expect(synergies.length).toBe(1);
    expect(synergies[0]!.rule.id).toBe('power_grid');
    expect(synergies[0]!.rule.bonusTarget).toBe('energy_consumption');
  });

  test('изолированное здание → пустой список', () => {
    const planet = makePlanet([{ q: 0, r: 0, id: 'processor' }]);
    expect(getActiveSynergiesForHex(planet, 0)).toEqual([]);
  });

  test('пустой гекс → пустой список', () => {
    const planet = makePlanet([{ q: 0, r: 0 }, { q: 1, r: 0, id: 'mine' }]);
    expect(getActiveSynergiesForHex(planet, 0)).toEqual([]);
  });
});

describe('R-24 — чистые хелперы энергии (единая формула engine + UI)', () => {
  test('solar_plant L1, L☉=1, R=1: 10 × 1.2 = 12/tick (НЕ «+10» из UI-хардкода)', () => {
    expect(getBuildingEnergyOutput('solar_plant', 1, 'surface', 1.0, 1.0)).toBeCloseTo(12, 6);
  });

  test('solar_plant L1, L☉=0.05 (M-звезда), R=1: 10 × 1.2 × 0.05 = 0.6/tick', () => {
    // Кейс владельца: «пишет +10, по факту меньше» — тусклая звезда.
    expect(getBuildingEnergyOutput('solar_plant', 1, 'surface', 0.05, 1.0)).toBeCloseTo(0.6, 6);
  });

  test('solar_plant L3, L☉=2, R=2: 10 × 1.6 × 2 / 2 = 16/tick', () => {
    expect(getBuildingEnergyOutput('solar_plant', 3, 'surface', 2.0, 2.0)).toBeCloseTo(16, 6);
  });

  test('solar_plant на орбите: ×1.2 (нет затухания атмосферы)', () => {
    expect(getBuildingEnergyOutput('solar_plant', 1, 'orbit', 1.0, 1.0)).toBeCloseTo(14.4, 6);
  });

  test('nuclear_reactor: 25 × (1 + L×0.2), без светимости', () => {
    expect(getBuildingEnergyOutput('nuclear_reactor', 1, 'surface', 0.01, 5.0)).toBeCloseTo(30, 6);
    expect(getBuildingEnergyOutput('nuclear_reactor', 2, 'surface', 3.0, 1.0)).toBeCloseTo(35, 6);
  });

  test('colony_hub: 5 × levelMult только на surface', () => {
    expect(getBuildingEnergyOutput('colony_hub', 1, 'surface', 1.0, 1.0)).toBeCloseTo(6, 6);
    expect(getBuildingEnergyOutput('colony_hub', 2, 'orbit', 1.0, 1.0)).toBe(0);
  });

  test('не-энергоблок / уровень 0 / неизвестное id → 0', () => {
    expect(getBuildingEnergyOutput('mine', 3, 'surface', 1.0, 1.0)).toBe(0);
    expect(getBuildingEnergyOutput('solar_plant', 0, 'surface', 1.0, 1.0)).toBe(0);
    expect(getBuildingEnergyOutput('nope', 1, 'surface', 1.0, 1.0)).toBe(0);
  });

  test('getBuildingEnergyConsumption: eCon × (1 + L×0.2)', () => {
    // Шахта eCon=2: L1 → 2.4; лаборатория eCon=10 L3 → 16.
    expect(getBuildingEnergyConsumption('mine', 1)).toBeCloseTo(2.4, 6);
    expect(getBuildingEnergyConsumption('laboratory', 3)).toBeCloseTo(16, 6);
    expect(getBuildingEnergyConsumption('solar_plant', 5)).toBe(0); // генератор
    expect(getBuildingEnergyConsumption('mine', 0)).toBe(0);
  });

  test('каталог: солнечная станция и ядерный реактор существуют (валидность правил)', () => {
    expect(BUILDING_MAP.has('solar_plant')).toBe(true);
    expect(BUILDING_MAP.has('nuclear_reactor')).toBe(true);
    expect(SYNERGY_RULES.length).toBe(4);
  });
});
