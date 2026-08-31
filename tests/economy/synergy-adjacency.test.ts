/// <reference types="bun-types" />
/**
 * R-SYNERGY (Задача 23) tests: движок Синергии — бонусы соседства.
 *
 * Проверяется (docs/40-buildings.md §5):
 *   - соседство axial-координат (6 направлений, симметрия);
 *   - стекинг с убывающей отдачей §5.2 (value × Σ decay^i);
 *   - множители processing_speed / energy_consumption;
 *   - кластеры лабораторий §5.4 «на каждую» (средний агрегат);
 *   - синергия только на поверхности (слоты без смежности);
 *   - интеграция с resolveBonuses (research_rate).
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
  getLabClusterBoost,
  getActiveSynergiesForHex,
} from '@/economy/adjacency';
import { SYNERGY_RULES } from '@/data/buildings/synergy';
import { resolveBonuses } from '@/research/bonus-resolver';
import { BUILDING_MAP } from '@/data/buildings';
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

describe('R-SYNERGY — стекинг с убывающей отдачей (§5.2)', () => {
  const mineRule = SYNERGY_RULES.find((r) => r.id === 'mine_processor')!;

  test('переработчик + 3 шахты → 0.15 × (1 + 0.5 + 0.25) = 0.2625 (пример из docs §5.2)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'processor' },
      { q: 1, r: 0, id: 'mine' },
      { q: 0, r: 1, id: 'mine' },
      { q: 1, r: -1, id: 'mine' },
    ]);
    // Соседи (0,0): (1,0), (0,1), (1,-1) — все три шахты.
    expect(countSynergyNeighbors(planet, 0, mineRule)).toBe(3);
    expect(getSynergyBonusValue(planet, 0, mineRule)).toBeCloseTo(0.2625, 6);
  });

  test('один сосед → полная величина (без затухания)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'processor' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    expect(getSynergyBonusValue(planet, 0, mineRule)).toBeCloseTo(0.15, 6);
  });

  test('нет подходящих соседей → 0', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'processor' },
      { q: 1, r: 0, id: 'laboratory' }, // лаборатория — не шахта
    ]);
    expect(countSynergyNeighbors(planet, 0, mineRule)).toBe(0);
    expect(getSynergyBonusValue(planet, 0, mineRule)).toBe(0);
  });

  test('вклад по метрике processing_speed (склад + шахта у переработчика)', () => {
    // Правила mine_processor (0.15) + warehouse_production (0.2) оба
    // действуют на переработчик со смежными шахтой и складом:
    // 0.15 + 0.2 = 0.35 → множитель 1.35.
    const planet = makePlanet([
      { q: 0, r: 0, id: 'processor' },
      { q: 1, r: 0, id: 'mine' },
      { q: 0, r: 1, id: 'warehouse' },
    ]);
    expect(getSynergyContribution(planet, 0, 'processing_speed')).toBeCloseTo(0.35, 6);
    expect(getProcessingSpeedMultiplier(planet, 0)).toBeCloseTo(1.35, 6);
  });
});

describe('R-SYNERGY — энергосбережение (power_grid §5.1/§5.3.5)', () => {
  test('здание с 1 смежной электростанцией → множитель 0.95', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'solar_plant' },
    ]);
    expect(getEnergyConsumptionMultiplier(planet, 0)).toBeCloseTo(0.95, 6);
  });

  test('2 смежные электростанции → 1 − (0.05 + 0.025) = 0.925', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'mine' },
      { q: 1, r: 0, id: 'solar_plant' },
      { q: 0, r: 1, id: 'nuclear_reactor' },
    ]);
    expect(getEnergyConsumptionMultiplier(planet, 0)).toBeCloseTo(0.925, 6);
  });

  test('электростанция сама себе бонус не даёт (потребление = 0)', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'solar_plant' },
      { q: 1, r: 0, id: 'nuclear_reactor' },
    ]);
    // Правило действует (source ["*"]), но применяется к потреблению
    // электростанции — расчёт множителя корректен (не NaN, не < 0).
    const mult = getEnergyConsumptionMultiplier(planet, 0);
    expect(mult).toBeGreaterThan(0);
    expect(mult).toBeLessThanOrEqual(1);
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
  test('переработчик со смежной шахтой: 1 активное правило с 1 соседом', () => {
    const planet = makePlanet([
      { q: 0, r: 0, id: 'processor' },
      { q: 1, r: 0, id: 'mine' },
    ]);
    const synergies = getActiveSynergiesForHex(planet, 0);
    expect(synergies.length).toBe(1);
    expect(synergies[0]!.rule.id).toBe('mine_processor');
    expect(synergies[0]!.neighbors).toBe(1);
    expect(synergies[0]!.bonus).toBeCloseTo(0.15, 6);
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

describe('R-SYNERGY — консистентность каталога', () => {
  test('лаборатория существует в каталоге (правило lab_cluster валидно)', () => {
    expect(BUILDING_MAP.has('laboratory')).toBe(true);
    expect(SYNERGY_RULES.length).toBe(4);
  });
});
