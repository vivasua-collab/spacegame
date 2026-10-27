/// <reference types="bun-types" />
/**
 * Этап 3а (R-41): юнит-тесты минимальной AI-модели.
 *
 * Покрывает (Issue #5, п.5 «Юнит-тесты типов/валидации модели и построения
 * perception snapshot»):
 * - валидация AIConfig и AIIntent (включая границу 3а: статус 'executed'
 *   невозможен — исполнение появится только в 3б);
 * - таблица частот обновления docs/70-ai.md §7.6 (easy 20 / normal 10 /
 *   hard 5 / insane 1);
 * - инертная intent-очередь: только накопление/валидация, без исполнятора;
 * - buildWorldModel: агрегаты, сортированные ключи/массивы (детерминизм),
 *   пустой мир;
 * - buildPerception: defensive copy — снапшот не содержит ссылок на
 *   GameState/AIWorldModel; мутация снапшота не трогает источник и наоборот.
 *
 * Run: bun test tests/ai/ai-model.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  AI_STATE_VERSION,
  AI_DIFFICULTY_UPDATE_INTERVAL,
  DEFAULT_AI_CONFIG,
  validateAIConfig,
  validateAIIntent,
  createIntentQueue,
  enqueueIntent,
} from '@/ai/types';
import { buildWorldModel, buildPerception } from '@/ai/perception';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState, Planet, StarSystem, FuelType } from '@/core/types';

// ─── Хелпер: минимальное синтетическое GameState ─────────

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq++;
  return `${prefix}_${idSeq}`;
}

const FUEL: Record<FuelType, number> = { chemical: 0, xenon: 0, hydrogen: 0, antimatter: 0 };

function planet(id: string, systemId: string, owner: string | null): Planet {
  return {
    id,
    systemId,
    name: `Planet ${id}`,
    type: 'rocky',
    size: 'small',
    radiusKm: 5000,
    density: 5.5,
    gravity: 1,
    temperature: 15,
    atmosphere: { type: 'none', pressure: 0, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes: [],
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 0,
    owner,
  };
}

function system(id: string, planetList: Planet[]): StarSystem {
  return {
    id,
    name: `System ${id}`,
    position: { x: 0, y: 0 },
    binaryType: 'BINARY_NONE',
    stars: [],
    planets: planetList,
    asteroidFields: 0,
    jumpPoints: [],
    discovered: false,
    owner: null,
  };
}

function syntheticState(overrides?: Partial<GameState>): GameState {
  const sysA = system('sysA', [
    planet('plA1', 'sysA', 'player'),
    planet('plA2', 'sysA', 'ai_1'),
  ]);
  const sysB = system('sysB', [planet('plB1', 'sysB', 'ai_1')]);
  const sysC = system('sysC', [planet('plC1', 'sysC', null)]);
  return {
    time: { tick: 100, dayInYear: 100, year: 1 },
    speed: 0,
    phase: 'playing',
    galaxy: {
      id: 'galaxy_test',
      seed: 42,
      systems: [sysC, sysB, sysA],
      systemMap: new Map(),
      bakedModel: {} as GameState['galaxy']['bakedModel'],
    },
    productionQueues: new Map(),
    fleets: [
      { id: 'f1', name: 'F1', shipIds: ['s1'], location: 'sysA', owner: 'player', orders: [], fuelStores: { ...FUEL } },
      { id: 'f2', name: 'F2', shipIds: [], location: 'sysB', owner: 'ai_1', orders: [], fuelStores: { ...FUEL } },
    ],
    playerFactionId: 'player',
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map([
      ['s1', { id: 's1', name: 'S1', designId: 'd1', hullId: 'h1', moduleIds: [], armor: 'light', hp: 10, maxHp: 10, fuel: { ...FUEL }, location: 'sysA', owner: 'player', designName: 'D1' }],
    ]),
    researchState: createDefaultResearchState(),
    ...overrides,
  };
}

// ─── AIConfig / difficulty ───────────────────────────────

describe('R-41 3а: AIConfig и сложность', () => {
  test('дефолтная конфигурация валидна: normal, интервал 10', () => {
    expect(validateAIConfig(DEFAULT_AI_CONFIG).ok).toBe(true);
    expect(DEFAULT_AI_CONFIG.difficulty).toBe('normal');
    expect(DEFAULT_AI_CONFIG.updateIntervalTicks).toBe(10);
    expect(DEFAULT_AI_CONFIG.maxControllersPerTick).toBeGreaterThan(0);
  });

  test('таблица частот обновления соответствует docs/70-ai.md §7.6', () => {
    expect(AI_DIFFICULTY_UPDATE_INTERVAL).toEqual({ easy: 20, normal: 10, hard: 5, insane: 1 });
  });

  test('валидные конфигурации всех уровней сложности проходят', () => {
    for (const difficulty of ['easy', 'normal', 'hard', 'insane'] as const) {
      const cfg = { difficulty, updateIntervalTicks: AI_DIFFICULTY_UPDATE_INTERVAL[difficulty], maxControllersPerTick: 8 };
      expect(validateAIConfig(cfg).ok).toBe(true);
    }
  });

  test('некорректные конфигурации отклоняются с перечнем ошибок', () => {
    expect(validateAIConfig(null).ok).toBe(false);
    expect(validateAIConfig('x').ok).toBe(false);
    expect(validateAIConfig({ difficulty: 'brutal', updateIntervalTicks: 10, maxControllersPerTick: 8 }).errors[0]).toContain('difficulty');
    expect(validateAIConfig({ difficulty: 'normal', updateIntervalTicks: 0, maxControllersPerTick: 8 }).errors[0]).toContain('updateIntervalTicks');
    expect(validateAIConfig({ difficulty: 'normal', updateIntervalTicks: 1.5, maxControllersPerTick: 8 }).ok).toBe(false);
    expect(validateAIConfig({ difficulty: 'normal', updateIntervalTicks: 10, maxControllersPerTick: -1 }).errors[0]).toContain('maxControllersPerTick');
  });
});

// ─── Инертная intent-очередь ─────────────────────────────

describe('R-41 3а: инертная intent-очередь', () => {
  const validIntent = {
    id: 'i1',
    action: 'expand' as const,
    targetId: 'sys_x',
    createdAtTick: 5,
    priority: 10,
    status: 'pending' as const,
  };

  test('валидное намерение проходит валидацию и добавляется в очередь', () => {
    expect(validateAIIntent(validIntent).ok).toBe(true);
    const queue = createIntentQueue('ai_1');
    const res = enqueueIntent(queue, validIntent);
    expect(res.ok).toBe(true);
    expect(queue.intents).toHaveLength(1);
  });

  test('граница 3а: статус executed невозможен (исполнение — 3б)', () => {
    const v = validateAIIntent({ ...validIntent, status: 'executed' });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain('status');
  });

  test('некорректные намерения отклоняются', () => {
    expect(validateAIIntent(null).ok).toBe(false);
    expect(validateAIIntent({ ...validIntent, id: '' }).ok).toBe(false);
    expect(validateAIIntent({ ...validIntent, action: 'conquer_world' }).errors[0]).toContain('action');
    expect(validateAIIntent({ ...validIntent, targetId: '' }).ok).toBe(false);
    expect(validateAIIntent({ ...validIntent, createdAtTick: -1 }).ok).toBe(false);
    expect(validateAIIntent({ ...validIntent, priority: Number.NaN }).ok).toBe(false);
  });

  test('дубликат id и переполнение отклоняются без бросков; очередь не исполняется', () => {
    const queue = createIntentQueue('ai_1', 2);
    expect(enqueueIntent(queue, validIntent).ok).toBe(true);
    const dup = enqueueIntent(queue, { ...validIntent });
    expect(dup.ok).toBe(false);
    expect(dup.errors[0]).toContain('уже в очереди');
    expect(enqueueIntent(queue, { ...validIntent, id: 'i2' }).ok).toBe(true);
    const over = enqueueIntent(queue, { ...validIntent, id: 'i3' });
    expect(over.ok).toBe(false);
    expect(over.errors[0]).toContain('переполнена');
    // Очередь — данные; исполнятора в 3а не существует (контракт).
    expect(queue.intents.every((i) => i.status === 'pending' || i.status === 'cancelled')).toBe(true);
  });
});

// ─── buildWorldModel ─────────────────────────────────────

describe('R-41 3а: buildWorldModel', () => {
  test('агрегаты корректны: владение системами по owner планет, счётчики', () => {
    const state = syntheticState();
    const wm = buildWorldModel(state);
    expect(wm.stateVersion).toBe(AI_STATE_VERSION);
    expect(wm.builtAtTick).toBe(100);
    expect(wm.systemCount).toBe(3);
    expect(wm.colonizedSystemCount).toBe(2);
    expect(wm.planetCountByOwner).toEqual({ ai_1: 2, player: 1 });
    expect(wm.fleetCountByOwner).toEqual({ ai_1: 1, player: 1 });
    expect(wm.shipCountByOwner).toEqual({ player: 1 });
    // Системы ai_1: массив отсортирован
    expect(wm.systemsByOwner.ai_1).toHaveLength(2);
    expect([...wm.systemsByOwner.ai_1!]).toEqual([...wm.systemsByOwner.ai_1!].sort());
  });

  test('детерминизм: ключи Record отсортированы при любом порядке входных систем', () => {
    const state = syntheticState();
    const wm = buildWorldModel(state);
    expect(Object.keys(wm.systemsByOwner)).toEqual(Object.keys(wm.systemsByOwner).sort());
    expect(Object.keys(wm.planetCountByOwner)).toEqual(Object.keys(wm.planetCountByOwner).sort());
    expect(Object.keys(wm.fleetCountByOwner)).toEqual(Object.keys(wm.fleetCountByOwner).sort());
    expect(Object.keys(wm.shipCountByOwner)).toEqual(Object.keys(wm.shipCountByOwner).sort());
  });

  test('пустой мир (без владельцев) даёт пустые агрегаты', () => {
    const state = syntheticState({
      galaxy: {
        id: 'gal',
        seed: 1,
        systems: [system('sys0', [planet('pl0', 'sys0', null)])],
        systemMap: new Map(),
        bakedModel: {} as GameState['galaxy']['bakedModel'],
      },
      fleets: [],
      ships: new Map(),
    });
    const wm = buildWorldModel(state);
    expect(wm.colonizedSystemCount).toBe(0);
    expect(wm.systemsByOwner).toEqual({});
    expect(wm.planetCountByOwner).toEqual({});
  });
});

// ─── buildPerception: defensive copy ─────────────────────

describe('R-41 3а: buildPerception — defensive copy и изоляция', () => {
  test('снапшот содержит копию ownedSystems, а не ссылку на world model', () => {
    const state = syntheticState();
    const wm = buildWorldModel(state);
    const snap = buildPerception(wm, 'ai_1', 100);
    expect(snap.factionId).toBe('ai_1');
    expect(snap.worldModelTick).toBe(wm.builtAtTick);
    expect(snap.knownSystemCount).toBe(wm.systemCount); // тривиальная видимость 3а
    expect(snap.colonyCount).toBe(2);
    // Копия: мутация снапшота НЕ меняет world model
    snap.ownedSystems.push('spoiler');
    expect(wm.systemsByOwner.ai_1).toHaveLength(2);
    // И наоборот: мутация world model НЕ меняет построенный снапшот
    const snap2 = buildPerception(wm, 'player', 100);
    wm.systemsByOwner.player!.push('late_addition');
    expect(snap2.ownedSystems).toHaveLength(1);
  });

  test('снапшот не содержит ссылок на GameState (только примитивы и массивы примитивов)', () => {
    const state = syntheticState();
    const wm = buildWorldModel(state);
    const snap = buildPerception(wm, 'player', 100);
    for (const [key, value] of Object.entries(snap)) {
      if (key === 'ownedSystems') {
        expect(Array.isArray(value)).toBe(true);
        expect((value as unknown[]).every((v) => typeof v === 'string')).toBe(true);
      } else {
        expect(['string', 'number']).toContain(typeof value);
      }
    }
    // JSON-структура полностью независима от state
    const json = JSON.stringify(snap);
    expect(json).not.toContain(state.galaxy.id);
    expect(json).not.toContain('bakedModel');
  });

  test('фракция без владений получает легитимный пустой снапшот', () => {
    const state = syntheticState();
    const wm = buildWorldModel(state);
    const snap = buildPerception(wm, 'ai_nobody', 100);
    expect(snap.ownedSystems).toEqual([]);
    expect(snap.colonyCount).toBe(0);
    expect(snap.fleetCount).toBe(0);
    expect(snap.shipCount).toBe(0);
  });
});
