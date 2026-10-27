/// <reference types="bun-types" />
/**
 * Этап 3б.1 (R-44): постоянное состояние AI-фракций + save/load контракт.
 *
 * Покрывает (тест-план roadmap R-43, пункты для 3б.1 + общесрезовые):
 * - [п.1] валидация state/config + уникальные faction IDs (валидаторы фракции
 *   и реестра, консистентность ключей, отказ дублирующей регистрации);
 * - [п.2] referential integrity — владения/ресурсы НЕ копируются во фракцию
 *   (типо-уровневая форма + проверка разрешения owner-полей в реестр);
 * - [п.4] детерминизм: same seed → идентичный реестр (in-process ×3);
 * - [п.5] старый v3-сейв без AI-полей (загрузка без инъекции ключей,
 *   побайтный рантрип) + новый сейв с фракциями (save→load→save→load
 *   побайтно идентичен, маркер aiFactionsV);
 * - [п.6] lifecycle: newGame/load/repeated setLoadedState — подписки не
 *   растут, контроллеры восстанавливаются от состояния реестра;
 * - инертность 3а сохраняется при непустом реестре (AI не мутирует GameState);
 * - повреждённая AI-секция (версия/лишние поля/бюджет) — явный отказ загрузки.
 *
 * Run: bun test tests/ai/factions.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'crypto';
import { produce } from 'immer';
import {
  AI_FACTION_STATE_VERSION,
  AI_FACTION_ARCHETYPES,
  ARCHETYPE_CONSTANTS,
  createAIFactionRoster,
  validateAIFactionState,
  validateAIFactionRegistry,
  withAIFactions,
  checkOwnershipIntegrity,
} from '@/ai/factions';
import type { AIFactionState } from '@/ai/factions';
import { AIModule } from '@/ai/ai-module';
import { useGameStore, serializeGameState, deserializeGameState } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import type { GameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';
import type { GameState, Planet, StarSystem, FuelType } from '@/core/types';
import { createDefaultResearchState } from '@/research/engine';

// ─── Хелперы: синтетическое GameState (паттерн ai-model.test.ts) ──

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

function system(id: string, planetList: Planet[], owner: string | null = null): StarSystem {
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
    owner,
  };
}

function syntheticState(overrides?: Partial<GameState>): GameState {
  const sysA = system('sysA', [
    planet('plA1', 'sysA', 'player'),
    planet('plA2', 'sysA', 'ai_faction_01'),
  ]);
  const sysB = system('sysB', [planet('plB1', 'sysB', 'ai_faction_02')], 'ai_faction_01');
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
    ],
    playerFactionId: 'player',
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map(),
    researchState: createDefaultResearchState(),
    ...overrides,
  };
}

// ─── Хелперы: прод-сценарий стора (паттерн ai-integration.test.ts) ──

function resetStore(): void {
  useGameStore.setState({
    gameState: null,
    view: 'galaxy',
    selectedSystemId: null,
    selectedPlanetId: null,
    selectedFleetId: null,
    isInitialized: false,
    currentSaveId: null,
    isSaving: false,
    saveError: null,
    isLoading: false,
    loadWarnings: [],
  });
}

function firstColonizable(state: GameState): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p;
    }
  }
  throw new Error('нет колонизируемых планет в тестовой галактике');
}

function toManualTickMode(mediator: GameMediator): void {
  mediator.setSpeed(0);
  const cur = mediator.getGameState()!;
  const manual = produce(cur, (draft) => {
    draft.phase = 'playing';
    draft.speed = 0;
  });
  mediator.setGameState(manual);
}

function getAI(mediator: GameMediator): AIModule {
  const ai = mediator.registry.getModule<AIModule>('ai');
  if (!ai) throw new Error('AI-модуль не зарегистрирован в прод-проводке');
  return ai;
}

function runStoreScenario(ticks: number): { mediator: GameMediator; state: GameState; ai: AIModule } {
  const store = useGameStore.getState();
  store.newGame({ seed: 42, systemCount: 5 });
  const state = useGameStore.getState().gameState!;
  const planet = firstColonizable(state);
  const ok = useGameStore.getState().colonizePlanet(planet.id);
  if (!ok) throw new Error('колонизация через стор не удалась');

  const mediator = getGameMediator();
  toManualTickMode(mediator);
  const ai = getAI(mediator);
  for (let i = 0; i < ticks; i++) mediator.tick();
  const final = mediator.getGameState()!;
  return { mediator, state: final, ai };
}

// ─── 1. Валидация фракции и реестра (тест-план п.1) ──────────

describe('R-44 3б.1: валидация AIFactionState / реестра', () => {
  test('фракция из канонического roster валидна', () => {
    const roster = createAIFactionRoster(42, { count: 3 });
    for (const f of Object.values(roster)) {
      expect(validateAIFactionState(f).ok).toBe(true);
    }
  });

  test('неизвестный archetype отклоняется', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const f = { ...Object.values(roster)[0], archetype: 'EMPIRE' };
    const v = validateAIFactionState(f);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('archetype');
  });

  test('невалидный config (updateIntervalTicks=0) отклоняется', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const base = Object.values(roster)[0]!;
    const f = { ...base, config: { ...base.config, updateIntervalTicks: 0 } };
    expect(validateAIFactionState(f).ok).toBe(false);
  });

  test('бюджет: сумма ≠ 1 и отрицательные веса отклоняются', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const base = Object.values(roster)[0]!;
    const badSum = { ...base, budget: { ...base.budget, economy: base.budget.economy + 0.5 } };
    expect(validateAIFactionState(badSum).ok).toBe(false);
    const negative = { ...base, budget: { ...base.budget, military: -0.1 } };
    expect(validateAIFactionState(negative).ok).toBe(false);
  });

  test('пороги: attack ≤ 0 / colonization вне [0..1] / maxColonizations < 0 отклоняются', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const base = Object.values(roster)[0]!;
    expect(validateAIFactionState({ ...base, thresholds: { ...base.thresholds, attack: 0 } }).ok).toBe(false);
    expect(validateAIFactionState({ ...base, thresholds: { ...base.thresholds, colonization: 1.5 } }).ok).toBe(false);
    expect(validateAIFactionState({ ...base, thresholds: { ...base.thresholds, maxColonizations: -1 } }).ok).toBe(false);
  });

  test('цели: дубликат id отклоняется; в 3б.1 канонически пусто', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const base = Object.values(roster)[0]!;
    expect(base.goals).toEqual([]);
    const dup = {
      ...base,
      goals: [
        { id: 'g1', kind: 'build_economy', createdAtTick: 0 },
        { id: 'g1', kind: 'research', createdAtTick: 1 },
      ],
    };
    expect(validateAIFactionState(dup).ok).toBe(false);
  });

  test('createdAtTick: отрицательный/нецелый отклоняется', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const base = Object.values(roster)[0]!;
    expect(validateAIFactionState({ ...base, createdAtTick: -1 }).ok).toBe(false);
    expect(validateAIFactionState({ ...base, createdAtTick: 1.5 }).ok).toBe(false);
  });

  test('реестр: ключ обязан совпадать с faction.id; битое значение отклоняется', () => {
    const roster = createAIFactionRoster(42, { count: 2 });
    expect(validateAIFactionRegistry(roster).ok).toBe(true);
    const mismatched = { ai_faction_01: { ...Object.values(roster)[1] } };
    const v = validateAIFactionRegistry(mismatched);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('ai_faction_01');
  });

  test('константы архетипов соответствуют docs/70 Приложение C', () => {
    expect(AI_FACTION_ARCHETYPES).toEqual(['CONFEDERATION', 'HEGEMONY', 'SYNDICATE', 'ORDER', 'SWARM']);
    expect(ARCHETYPE_CONSTANTS.CONFEDERATION.thresholds.attack).toBe(1.5);
    expect(ARCHETYPE_CONSTANTS.HEGEMONY.thresholds.attack).toBe(1.2);
    expect(ARCHETYPE_CONSTANTS.SYNDICATE.thresholds.attack).toBe(3.0);
    expect(ARCHETYPE_CONSTANTS.SWARM.thresholds.maxColonizations).toBe(4);
    expect(ARCHETYPE_CONSTANTS.SWARM.thresholds.colonization).toBe(0.1);
    for (const a of AI_FACTION_ARCHETYPES) {
      const c = ARCHETYPE_CONSTANTS[a];
      const sum = c.budget.economy + c.budget.military + c.budget.research + c.budget.trade + c.budget.diplomacy;
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
    }
  });
});

// ─── 2. createAIFactionRoster: детерминизм и форма (п.1/п.4) ──

describe('R-44 3б.1: createAIFactionRoster (детерминированный setup по seed)', () => {
  test('тот же seed → бит-в-бит идентичный реестр', () => {
    const a = createAIFactionRoster(424242, { count: 3 });
    const b = createAIFactionRoster(424242, { count: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('разный seed → разный реестр (расстановка по seed)', () => {
    const a = JSON.stringify(createAIFactionRoster(1, { count: 5 }));
    const b = JSON.stringify(createAIFactionRoster(2, { count: 5 }));
    expect(a).not.toBe(b);
  });

  test('ids уникальны, ключи реестра отсортированы, форма id каноническая', () => {
    const roster = createAIFactionRoster(7, { count: 5 });
    const keys = Object.keys(roster);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
    for (const k of keys) expect(k).toMatch(/^ai_faction_\d{2}$/);
  });

  test('count ≤ 5 → архетипы без повторов; count > 5 → цикл из перемешанного списка', () => {
    const r5 = createAIFactionRoster(9, { count: 5 });
    const archetypes = Object.values(r5).map((f) => f.archetype);
    expect(new Set(archetypes).size).toBe(5);
    const r8 = createAIFactionRoster(9, { count: 8 });
    expect(Object.keys(r8).length).toBe(8);
  });

  test('createdAtTick прокидывается во фракции; дефолт 0', () => {
    const withTick = createAIFactionRoster(11, { count: 1, createdAtTick: 777 });
    expect(Object.values(withTick)[0]!.createdAtTick).toBe(777);
    const def = createAIFactionRoster(11, { count: 1 });
    expect(Object.values(def)[0]!.createdAtTick).toBe(0);
  });

  test('невалидные опции — явный отказ (throw)', () => {
    expect(() => createAIFactionRoster(1, { count: 0 })).toThrow();
    expect(() => createAIFactionRoster(1, { count: 9 })).toThrow();
    expect(() => createAIFactionRoster(1, { count: 1.5 })).toThrow();
    expect(() => createAIFactionRoster(Number.NaN, { count: 1 })).toThrow();
  });

  test('конфиг фракции согласован со сложностью (таблица частот §7.6)', () => {
    const roster = createAIFactionRoster(424242, { count: 4 });
    for (const f of Object.values(roster)) {
      if (f.config.difficulty === 'insane') expect(f.config.updateIntervalTicks).toBe(1);
      if (f.config.difficulty === 'hard') expect(f.config.updateIntervalTicks).toBe(5);
      if (f.config.difficulty === 'normal') expect(f.config.updateIntervalTicks).toBe(10);
      if (f.config.difficulty === 'easy') expect(f.config.updateIntervalTicks).toBe(20);
    }
  });
});

// ─── 3. withAIFactions: установка/отказ дубликата/чистота ─────

describe('R-44 3б.1: withAIFactions (регистрация без мутации входа)', () => {
  test('устанавливает реестр в НОВОЕ состояние; вход не мутируется', () => {
    const state = syntheticState();
    const roster = createAIFactionRoster(42, { count: 2, createdAtTick: 100 });
    const res = withAIFactions(state, roster);
    expect(res.ok).toBe(true);
    expect(res.state).not.toBeNull();
    expect(res.state!.aiFactions).toEqual(roster);
    expect(state.aiFactions).toBeUndefined(); // вход не тронут
    expect(res.state).not.toBe(state); // новый объект
  });

  test('дублирующая регистрация (реестр уже непуст) — явный отказ', () => {
    const roster = createAIFactionRoster(42, { count: 2 });
    const state = withAIFactions(syntheticState(), roster).state!;
    const res = withAIFactions(state, createAIFactionRoster(43, { count: 2 }));
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.state).toBeNull();
  });

  test('пустой существующий реестр не блокирует регистрацию', () => {
    const state = syntheticState({ aiFactions: {} });
    const roster = createAIFactionRoster(42, { count: 1 });
    const res = withAIFactions(state, roster);
    expect(res.ok).toBe(true);
    expect(res.state!.aiFactions).toEqual(roster);
  });

  test('невалидный roster — явный отказ', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const broken = { ai_faction_01: { ...Object.values(roster)[0]!, archetype: 'WRONG' as AIFactionState['archetype'] } };
    const res = withAIFactions(syntheticState(), broken);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

// ─── 4. Referential integrity (тест-план п.2) ─────────────────

describe('R-44 3б.1: checkOwnershipIntegrity (владения не копируются)', () => {
  test('все owner-поля разрешаются в playerFactionId или ключ реестра', () => {
    const state = syntheticState({ aiFactions: createAIFactionRoster(42, { count: 2, createdAtTick: 100 }) });
    const res = checkOwnershipIntegrity(state);
    expect(res.ok).toBe(true);
    expect(res.violations).toEqual([]);
  });

  test('владение неизвестной фракцией — нарушение с путём', () => {
    const roster = createAIFactionRoster(42, { count: 1 });
    const state = syntheticState({ aiFactions: roster });
    // ai_faction_02 НЕ в реестре (roster из 1 фракции), но владеет планетой/системой
    const res = checkOwnershipIntegrity(state);
    expect(res.ok).toBe(false);
    expect(res.violations.length).toBeGreaterThan(0);
    expect(res.violations.join(' ')).toContain('ai_faction_02');
  });

  test('фракция сущность НЕ содержит копий владений/ресурсов/флотов/технологий', () => {
    const roster = createAIFactionRoster(42, { count: 2 });
    for (const f of Object.values(roster)) {
      const keys = Object.keys(f);
      expect(keys.sort()).toEqual(['archetype', 'budget', 'config', 'createdAtTick', 'goals', 'id', 'thresholds']);
      expect(f).not.toHaveProperty('owned_systems');
      expect(f).not.toHaveProperty('resources');
      expect(f).not.toHaveProperty('fleets');
      expect(f).not.toHaveProperty('researched_techs');
    }
  });
});

// ─── 5. Save/load v3 контракт (тест-план п.5) ─────────────────

describe('R-44 3б.1: v3 save/load контракт AI-секции', () => {
  beforeEach(() => {
    resetGameMediator();
    resetStore();
  });

  afterEach(() => {
    resetGameMediator();
    resetStore();
  });

  test('старый сейв без AI-полей: загрузка + побайтный рантрип без инъекции ключей', () => {
    const { state } = runStoreScenario(3);
    const json1 = serializeGameState(state);
    expect(json1).not.toContain('aiFactions');
    expect(json1).not.toContain('aiFactionsV');

    const restored = deserializeGameState(json1);
    expect(restored.aiFactions).toBeUndefined(); // предсказуемый дефолт: реестра нет

    const json2 = serializeGameState(restored);
    expect(json2).toBe(json1); // побайтно, БЕЗ инъекции AI-ключей
  });

  test('пустой реестр не пишется в сейв (байт-совместимость)', () => {
    runStoreScenario(1);
    const state = useGameStore.getState().gameState!;
    const withEmpty = produce(state, (draft) => {
      draft.aiFactions = {};
    });
    const jsonEmpty = serializeGameState(withEmpty);
    const { state: plain } = { state: withEmpty };
    void plain;
    runStoreScenario(1);
    const statePlain = useGameStore.getState().gameState!;
    const jsonPlain = serializeGameState(statePlain);
    // Пустой реестр эквивалентен отсутствию: те же ключи в JSON
    expect(jsonEmpty).not.toContain('aiFactions');
    expect(jsonPlain).not.toContain('aiFactions');
  });

  test('сейв с фракциями: маркер aiFactionsV + save→load→save→load побайтно идентичен', () => {
    runStoreScenario(2);
    expect(useGameStore.getState().setupAIFactions({ count: 3 })).toBe(true);
    const state = useGameStore.getState().gameState!;
    expect(state.aiFactions).toBeDefined();
    expect(Object.keys(state.aiFactions!).length).toBe(3);

    const json1 = serializeGameState(state);
    expect(json1).toContain('"aiFactions"');
    expect(json1).toContain(`"aiFactionsV":${AI_FACTION_STATE_VERSION}`);

    const restored1 = deserializeGameState(json1);
    expect(JSON.stringify(restored1.aiFactions)).toBe(JSON.stringify(state.aiFactions));
    expect((restored1 as unknown as Record<string, unknown>).aiFactionsV).toBeUndefined(); // транспортный маркер снят

    const json2 = serializeGameState(restored1);
    expect(json2).toBe(json1); // рантрип побайтен ×1

    const restored2 = deserializeGameState(json2);
    const json3 = serializeGameState(restored2);
    expect(json3).toBe(json1); // рантрип побайтен ×2 (save→load→save→load)
  });

  test('повреждённая AI-секция: aiFactionsV ≠ 1 — явный отказ загрузки', () => {
    runStoreScenario(2);
    useGameStore.getState().setupAIFactions({ count: 1 });
    const json = serializeGameState(useGameStore.getState().gameState!);
    const corrupted = JSON.parse(json) as Record<string, unknown>;
    corrupted.aiFactionsV = AI_FACTION_STATE_VERSION + 1;
    expect(() => deserializeGameState(JSON.stringify(corrupted))).toThrow(/aiFactionsV/);
  });

  test('повреждённая AI-секция: лишнее поле во фракции (strict) — отказ', () => {
    runStoreScenario(2);
    useGameStore.getState().setupAIFactions({ count: 1 });
    const json = serializeGameState(useGameStore.getState().gameState!);
    const corrupted = JSON.parse(json) as Record<string, unknown>;
    const reg = corrupted.aiFactions as Record<string, Record<string, unknown>>;
    const firstKey = Object.keys(reg)[0]!;
    reg[firstKey]!.owned_systems = ['sys_ghost']; // попытка прокрасти копию владений
    expect(() => deserializeGameState(JSON.stringify(corrupted))).toThrow();
  });

  test('повреждённая AI-секция: битый бюджет (сумма ≠ 1) — отказ', () => {
    runStoreScenario(2);
    useGameStore.getState().setupAIFactions({ count: 1 });
    const json = serializeGameState(useGameStore.getState().gameState!);
    const corrupted = JSON.parse(json) as Record<string, unknown>;
    const reg = corrupted.aiFactions as Record<string, { budget: Record<string, number> }>;
    const firstKey = Object.keys(reg)[0]!;
    const firstFaction = reg[firstKey]!;
    const budget = firstFaction.budget as { economy: number };
    budget.economy += 0.5;
    expect(() => deserializeGameState(JSON.stringify(corrupted))).toThrow();
  });
});

// ─── 6. Store action setupAIFactions (регистрация по seed) ────

describe('R-44 3б.1: store action setupAIFactions', () => {
  beforeEach(() => {
    resetGameMediator();
    resetStore();
  });

  afterEach(() => {
    resetGameMediator();
    resetStore();
  });

  test('регистрирует фракции по seed галактики; повторная регистрация — отказ', () => {
    runStoreScenario(0);
    const store = useGameStore.getState();
    expect(store.setupAIFactions({ count: 2 })).toBe(true);
    const state = useGameStore.getState().gameState!;
    expect(Object.keys(state.aiFactions!).length).toBe(2);
    // seed галактики == seed сценария → roster воспроизводим
    expect(JSON.stringify(state.aiFactions)).toBe(JSON.stringify(createAIFactionRoster(42, { count: 2, createdAtTick: state.time.tick })));
    expect(store.setupAIFactions({ count: 2 })).toBe(false); // дубликат — явный отказ
  });

  test('без активной игры — отказ', () => {
    expect(useGameStore.getState().setupAIFactions()).toBe(false);
  });
});

// ─── 7. Модуль: синхронизация контроллеров от состояния ───────

describe('R-44 3б.1: AIModule — контроллеры от aiFactions (без мутаций)', () => {
  beforeEach(() => {
    resetGameMediator();
    resetStore();
  });

  afterEach(() => {
    resetGameMediator();
    resetStore();
  });

  test('после setupAIFactions тик подключает контроллеры по реестру (sorted keys)', () => {
    runStoreScenario(0);
    useGameStore.getState().setupAIFactions({ count: 3 });
    const mediator = getGameMediator();
    toManualTickMode(mediator);
    const ai = getAI(mediator);
    expect(ai.getControllerCount()).toBe(0); // до первого тика
    mediator.tick();
    expect(ai.getControllerCount()).toBe(3);
    const roster = useGameStore.getState().gameState!.aiFactions!;
    const expected = Object.keys(roster).sort();
    expect(ai.getControllerSummaries().map((s) => s.factionId)).toEqual(expected);
    // конфиг контроллера — из faction.config (сложность прокидывается)
    for (const s of ai.getControllerSummaries()) {
      expect(s.difficulty).toBe(roster[s.factionId]!.config.difficulty);
      expect(s.perceptionTick).not.toBeNull();
    }
  });

  test('инертность при непустом реестре: тики с AI и без AI — GameState бит-в-бит идентичен', () => {
    // Сценарий A: фракции зарегистрированы, AI активен
    runStoreScenario(0);
    useGameStore.getState().setupAIFactions({ count: 3 });
    let mediator = getGameMediator();
    toManualTickMode(mediator);
    for (let i = 0; i < 10; i++) mediator.tick();
    const jsonA = serializeGameState(useGameStore.getState().gameState!);

    // Сценарий B: тот же seed/действия, AI ОСТАНОВЛЕН (контроллеры не строятся)
    resetGameMediator();
    resetStore();
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    const planet = firstColonizable(useGameStore.getState().gameState!);
    expect(useGameStore.getState().colonizePlanet(planet.id)).toBe(true);
    useGameStore.getState().setupAIFactions({ count: 3 });
    mediator = getGameMediator();
    toManualTickMode(mediator);
    getAI(mediator).stop();
    for (let i = 0; i < 10; i++) mediator.tick();
    const jsonB = serializeGameState(useGameStore.getState().gameState!);

    expect(jsonA).toBe(jsonB);
  });

  test('ручные (тестовые) контроллеры при отсутствии реестра сохраняются — 3а-совместимость', () => {
    const { mediator, ai } = runStoreScenario(3);
    ai.attachController('ai_conf', 'normal');
    mediator.tick();
    expect(ai.getControllerCount()).toBe(1);
    expect(ai.getControllerSummaries()[0]!.factionId).toBe('ai_conf');
  });

  test('lifecycle: повторный setLoadedState — подписки не растут; контроллеры восстанавливаются от загруженного реестра', () => {
    runStoreScenario(2);
    expect(useGameStore.getState().setupAIFactions({ count: 2 })).toBe(true);
    const mediator = getGameMediator();
    toManualTickMode(mediator);
    mediator.tick();
    expect(getAI(mediator).getControllerCount()).toBe(2);

    const beforeCreated = gameBus.listenerCount('core:game-created');
    const beforeLoaded = gameBus.listenerCount('core:game-loaded');

    mediator.setLoadedState(mediator.getGameState()!);
    mediator.setLoadedState(mediator.getGameState()!);

    expect(gameBus.listenerCount('core:game-created')).toBe(beforeCreated);
    expect(gameBus.listenerCount('core:game-loaded')).toBe(beforeLoaded);

    // Кэш сброшен → тик восстанавливает контроллеры от РЕЕСТРА (пережил load)
    expect(getAI(mediator).getControllerCount()).toBe(0);
    mediator.tick();
    expect(getAI(mediator).getControllerCount()).toBe(2);
    const roster = useGameStore.getState().gameState!.aiFactions!;
    expect(Object.keys(roster).length).toBe(2); // реестр пережил load
  });
});

// ─── 8. Детерминизм ×3 сборки (in-process; п.4) ───────────────

describe('R-44 3б.1: детерминизм (same seed + setup + тики → идентичный результат)', () => {
  beforeEach(() => {
    resetGameMediator();
    resetStore();
  });

  afterEach(() => {
    resetGameMediator();
    resetStore();
  });

  test('sha256(GameState) и sha256(реестра) идентичны в трёх сборках', () => {
    const hashes: string[] = [];
    const rosterHashes: string[] = [];
    for (let run = 0; run < 3; run++) {
      resetGameMediator();
      resetStore();
      runStoreScenario(0);
      expect(useGameStore.getState().setupAIFactions({ count: 3 })).toBe(true);
      const mediator = getGameMediator();
      toManualTickMode(mediator);
      for (let i = 0; i < 15; i++) mediator.tick();
      const state = useGameStore.getState().gameState!;
      const ai = getAI(mediator);
      hashes.push(createHash('sha256').update(serializeGameState(state)).digest('hex'));
      rosterHashes.push(createHash('sha256').update(JSON.stringify(state.aiFactions)).digest('hex'));
      void ai;
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[1]).toBe(hashes[2]);
    expect(rosterHashes[0]).toBe(rosterHashes[1]);
    expect(rosterHashes[1]).toBe(rosterHashes[2]);
  });
});
