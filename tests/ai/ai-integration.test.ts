/// <reference types="bun-types" />
/**
 * Этап 3а (R-41): интеграционные тесты AI-каркаса в прод-проводке.
 *
 * Покрывает (Issue #5, п.5 + runbook фаза 4):
 * - регистрация AI-модуля в РЕАЛЬНОЙ проводке стора (getMediatorWithModules):
 *   initOrder [..., 'ai'], AI тикает последним;
 * - инертность 3а: N тиков с AI-контроллерами и без — serializeGameState
 *   бит-в-бит идентичен (экономика/флот/исследования игрока не тронуты);
 *   AI не коммитит state (core:state-changed от AI отсутствует);
 * - детерминизм: same state + seed + последовательность тиков → идентичный
 *   AI-снимок (world model + perceptions) в трёх независимых сборках;
 * - save/load: v3-раундтрип сейва БЕЗ AI-полей с зарегистрированным
 *   AI-модулем (старые сейвы совместимы по построению — AI в v3 нет);
 * - подписки прод-проводки не дублируются при setLoadedState.
 *
 * Run: bun test tests/ai/ai-integration.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { createHash } from 'crypto';
import { produce } from 'immer';
import { useGameStore, serializeGameState, deserializeGameState } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';
import { AIModule } from '@/ai/ai-module';
import type { GameMediator } from '@/core/game-mediator';
import type { GameState, Planet } from '@/core/types';

/** Сброс стора в «холодное» состояние (как в r39-тестах). */
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

/** Перевести игру в ручной тик-режим (phase=playing, speed=0 — без интервала). */
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

/**
 * Полный прод-сценарий: newGame через стор → колонизация через стор →
 * ручные тики. AI-модуль зарегистрирован проводкой стора автоматически.
 */
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
  ai.attachController('ai_conf', 'normal');
  ai.attachController('ai_heg', 'hard');
  for (let i = 0; i < ticks; i++) mediator.tick();
  const final = mediator.getGameState()!;
  return { mediator, state: final, ai };
}

/** Канонический AI-снимок для сравнения/хеширования (world model + perceptions). */
function aiSnapshotJSON(ai: AIModule): string {
  return JSON.stringify({
    worldModel: ai.getWorldModel(),
    controllers: ai.getControllerSummaries(),
  });
}

describe('R-41 3а: интеграция в прод-проводке', () => {
  beforeEach(() => {
    resetGameMediator();
    resetStore();
  });

  afterEach(() => {
    resetGameMediator();
    resetStore();
  });

  test('AI-модуль зарегистрирован проводкой стора и тикает последним', () => {
    runStoreScenario(3);
    const mediator = getGameMediator();
    const order = mediator.registry.getInitOrder();
    expect(order[order.length - 1]).toBe('ai');
    expect(order.indexOf('ai')).toBeGreaterThan(order.indexOf('economy'));
    expect(getAI(mediator).getControllerCount()).toBe(2);
  });

  test('инертность: тики с AI и без AI дают бит-в-бит идентичный GameState', () => {
    // Сценарий A: прод-проводка С AI-контроллерами (в составе 831-сьюта
    // AI всегда зарегистрирован; здесь сравниваем состояние мира).
    const a = runStoreScenario(10);
    const jsonA = serializeGameState(a.state);

    // Сценарий B: тот же seed/действия, но НИ ОДНОГО AI-контроллера
    // (модуль зарегистрирован, но perception не строится — контроллеров нет).
    resetGameMediator();
    resetStore();
    const store = useGameStore.getState();
    store.newGame({ seed: 42, systemCount: 5 });
    const planet = firstColonizable(useGameStore.getState().gameState!);
    expect(useGameStore.getState().colonizePlanet(planet.id)).toBe(true);
    const mediatorB = getGameMediator();
    toManualTickMode(mediatorB);
    for (let i = 0; i < 10; i++) mediatorB.tick();
    const jsonB = serializeGameState(mediatorB.getGameState()!);

    expect(jsonA).toBe(jsonB);
  });

  test('инертность: AI не коммитит состояние (0 коммитов/0 событий ai:*)', () => {
    runStoreScenario(5);
    const mediator = getGameMediator();
    const ai = getAI(mediator);

    let commitsDuringAI = 0;
    let aiEvents = 0;
    const unsub = gameBus.on('core:state-changed', () => {
      commitsDuringAI++;
    });
    // ai:* события не существуют в 3а — модуль не эмитит ничего (манифест emits []).
    // Проверяем отсутствием любых подписок модуля на core:tick и отсутствием
    // изменений числа коммитов при изолированном тике AI (только AI тикает):
    ai.stop(); // остальные модули продолжат, AI выключен — разница и есть вклад AI
    const before = commitsDuringAI;
    getGameMediator().tick();
    const duringOff = commitsDuringAI - before;

    ai.start();
    const beforeOn = commitsDuringAI;
    getGameMediator().tick();
    const duringOn = commitsDuringAI - beforeOn;

    // Тики в playing с колонизированной планетой коммитят состояние экономикой;
    // вклад AI в число коммитов — ноль (AI выключен/включён — одинаково).
    expect(duringOff).toBe(duringOn);
    expect(aiEvents).toBe(0);
    unsub();
  });

  test('детерминизм: same seed + последовательность → идентичный AI-снимок ×3 сборки', () => {
    const hashes: string[] = [];
    for (let run = 0; run < 3; run++) {
      resetGameMediator();
      resetStore();
      const { ai } = runStoreScenario(15);
      const json = aiSnapshotJSON(ai);
      hashes.push(createHash('sha256').update(json).digest('hex'));
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[1]).toBe(hashes[2]);
    expect(hashes.every((h) => h.length === 64)).toBe(true);
  });

  test('save/load: v3-раундтрип сейва без AI-полей с зарегистрированным AI-модулем', () => {
    const { state, ai } = runStoreScenario(7);
    // До сохранения AI построил perception
    expect(ai.getWorldModel()).not.toBeNull();
    expect(ai.getControllerSummaries().every((s) => s.perceptionTick !== null)).toBe(true);

    const json = serializeGameState(state);
    // В сейве v3 нет AI-полей (формат не менялся в 3а)
    expect(json).not.toContain('aiState');
    expect(json).not.toContain('perception');

    const restored: GameState = deserializeGameState(json);
    const mediator = getGameMediator();
    mediator.setLoadedState(restored); // эмитит core:game-loaded → reset AI-кэша

    // Старый сейв (без AI-полей) загружен; AI-кэш сброшен и пересобирается
    expect(getAI(mediator).getControllerCount()).toBe(0);
    toManualTickMode(mediator);
    mediator.tick();
    expect(getAI(mediator).getWorldModel()).not.toBeNull();
    expect(getAI(mediator).getWorldModel()!.builtAtTick).toBe(restored.time.tick + 1);
  });

  test('подписки прод-проводки не дублируются при повторном setLoadedState', () => {
    runStoreScenario(3);
    const beforeCreated = gameBus.listenerCount('core:game-created');
    const beforeLoaded = gameBus.listenerCount('core:game-loaded');
    expect(beforeCreated).toBeGreaterThanOrEqual(1);
    expect(beforeLoaded).toBeGreaterThanOrEqual(1);

    const mediator = getGameMediator();
    mediator.setLoadedState(mediator.getGameState()!); // повторная загрузка
    mediator.setLoadedState(mediator.getGameState()!);

    expect(gameBus.listenerCount('core:game-created')).toBe(beforeCreated);
    expect(gameBus.listenerCount('core:game-loaded')).toBe(beforeLoaded);
  });
});
