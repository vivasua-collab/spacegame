/// <reference types="bun-types" />
/**
 * Этап 3а (R-41): lifecycle-тесты AIModule.
 *
 * Покрывает (Issue #5, п.5 «Интеграционные тесты: регистрация AI module →
 * start/tick/stop → корректная подписка на существующую шину; повторный
 * start/stop/load не дублирует обработчики и таймеры» + runbook фаза 4):
 * - манифест-контракт (id 'ai', deps ['economy'], emits [] в 3а, query);
 * - initOrder заканчивается 'ai' (AI тикает последним — детерминизм);
 * - фазы init/start/tick/stop/destroy; тик вне started — no-op;
 * - подписки создаются ровно один раз в init, снимаются в destroy;
 *   циклы замены модуля не наращивают listenerCount; таймеров нет;
 * - reset при game-created/game-loaded (в т.ч. replay-доставка);
 * - phase-guard: тик вне 'playing' не строит world model;
 * - бюджет maxControllersPerTick и период updateIntervalTicks;
 * - attachController идемпотентен; summaries отсортированы;
 * - query 'ai:state' живёт до destroy и снимается при destroy;
 * - serialize/deserialize (3а: вычисляемый кэш).
 *
 * Run: bun test tests/ai/ai-module.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { produce } from 'immer';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { gameBus, TypedEventBus } from '@/core/typed-event-bus';
import type { GameMediator } from '@/core/game-mediator';
import { ModuleRegistry } from '@/core/module-registry';
import type { IGameModule, ModuleId, ModuleManifest, ModulePhase } from '@/core/module-types';
import { AIModule, type AIStateQueryResult } from '@/ai/ai-module';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { ResearchModule } from '@/research/research-module';
import { ShipsModule } from '@/ships/ships-module';
import { FleetModule } from '@/ships/fleet-module';

/** Стаб-модуль без поведения (для удовлетворения зависимостей реестра). */
class StubModule implements IGameModule {
  readonly manifest: ModuleManifest;
  private _phase: ModulePhase = 'uninitialized';
  get phase(): ModulePhase {
    return this._phase;
  }
  constructor(id: ModuleId) {
    this.manifest = {
      id,
      name: `stub ${id}`,
      version: '0.0.0',
      description: 'Тестовый стаб (без поведения)',
      dependencies: [],
      emits: [],
      subscribes: [],
      handlesQueries: [],
      requiresQueries: [],
    };
  }
  init(): void {
    this._phase = 'initialized';
  }
  start(): void {
    this._phase = 'started';
  }
  tick(): void {
    /* no-op */
  }
  stop(): void {
    this._phase = 'stopped';
  }
  destroy(): void {
    this._phase = 'destroyed';
  }
  serialize(): Record<string, unknown> {
    return {};
  }
  deserialize(): void {
    /* no-op */
  }
}

function getAI(mediator: GameMediator): AIModule {
  const ai = mediator.registry.getModule<AIModule>('ai');
  if (!ai) throw new Error('AI-модуль не зарегистрирован');
  return ai;
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

describe('R-41 3а: AIModule lifecycle', () => {
  let mediator: GameMediator;

  beforeEach(() => {
    resetGameMediator();
    mediator = getGameMediator();
    // Стаб economy (зависимость AI по манифесту) + AI. Никаких других
    // модулей: lifecycle AI изолирован от симуляции.
    const ai = new AIModule();
    ai.setGameStateAccessor(() => mediator.getGameState());
    mediator.registerAndInit([new StubModule('economy'), ai]);
  });

  afterEach(() => {
    resetGameMediator();
  });

  // ─── Манифест-контракт ───────────────────────────────

  test('манифест: id ai, deps [economy], emits [] в 3а, подписки lifecycle, query ai:state', () => {
    const ai = getAI(mediator);
    expect(ai.manifest.id).toBe('ai');
    expect(ai.manifest.dependencies).toEqual(['economy']);
    expect(ai.manifest.emits).toEqual([]); // ai:* остаются зарезервированными
    expect(ai.manifest.subscribes.map((s) => s.event).sort()).toEqual(['core:game-created', 'core:game-loaded']);
    expect(ai.manifest.handlesQueries.map((q) => q.queryName)).toEqual(['ai:state']);
  });

  test('initOrder реестра заканчивается ai (AI тикает последним)', () => {
    const bus = new TypedEventBus();
    const reg = new ModuleRegistry(bus);
    const modules: IGameModule[] = [
      new GalaxyModule(),
      new EconomyModule(),
      new ResearchModule(),
      new ShipsModule(),
      new FleetModule(),
      new AIModule(),
    ];
    for (const m of modules) reg.register(m);
    const order = reg.getInitOrder();
    expect(order[order.length - 1]).toBe('ai');
    expect(order.indexOf('ai')).toBeGreaterThan(order.indexOf('economy'));
    expect(order.indexOf('ai')).toBeGreaterThan(order.indexOf('fleet'));
  });

  // ─── Фазы и подписки ─────────────────────────────────

  test('фазы: initialized → started → stopped → started → destroyed', () => {
    const ai = getAI(mediator);
    expect(ai.phase).toBe('initialized');
    ai.start();
    expect(ai.phase).toBe('started');
    ai.stop();
    expect(ai.phase).toBe('stopped');
    ai.start();
    expect(ai.phase).toBe('started');
    ai.destroy();
    expect(ai.phase).toBe('destroyed');
  });

  test('подписки создаются в init и снимаются в destroy; замена модуля не дублирует', () => {
    // beforeEach создал модуль: ровно 1 подписка на каждое lifecycle-событие
    expect(gameBus.listenerCount('core:game-created')).toBe(1);
    expect(gameBus.listenerCount('core:game-loaded')).toBe(1);

    const ai = getAI(mediator);
    ai.destroy();
    expect(gameBus.listenerCount('core:game-created')).toBe(0);
    expect(gameBus.listenerCount('core:game-loaded')).toBe(0);

    // Повторные циклы замены модуля — ровно 1 подписка (без накопления)
    for (let i = 0; i < 3; i++) {
      const fresh = new AIModule();
      fresh.setGameStateAccessor(() => mediator.getGameState());
      mediator.registerAndInit([fresh]); // register (замена) + initAll
      expect(gameBus.listenerCount('core:game-created')).toBe(1);
      expect(gameBus.listenerCount('core:game-loaded')).toBe(1);
    }
  });

  test('таймеров нет: тики модуля не создают подписок/интервалов (контракт 3а)', () => {
    const ai = getAI(mediator);
    ai.start();
    const beforeTick = gameBus.listenerCount('core:tick');
    const beforeCreated = gameBus.listenerCount('core:game-created');
    ai.attachController('ai_t');
    mediator.newGame({ seed: 42, systemCount: 5 });
    toManualTickMode(mediator);
    mediator.tick();
    mediator.tick();
    expect(gameBus.listenerCount('core:tick')).toBe(beforeTick);
    expect(gameBus.listenerCount('core:game-created')).toBe(beforeCreated);
  });

  // ─── Reset при смене мира ────────────────────────────

  test('game-created/game-loaded сбрасывают контроллеры и world model', () => {
    const ai = getAI(mediator);
    mediator.newGame({ seed: 42, systemCount: 5 }); // эмитит game-created (reset)
    ai.start();
    expect(ai.getControllerCount()).toBe(0);
    expect(ai.getWorldModel()).toBeNull();

    ai.attachController('ai_test');
    expect(ai.getControllerCount()).toBe(1);
    gameBus.emit('core:game-loaded', { saveId: 'test' });
    expect(ai.getControllerCount()).toBe(0);
    expect(ai.getWorldModel()).toBeNull();
  });

  // ─── Phase-guard и тики ──────────────────────────────

  test('phase-guard: тик вне playing не строит world model и perception', () => {
    mediator.newGame({ seed: 42, systemCount: 5 }); // phase 'colonization'
    const ai = getAI(mediator);
    ai.start();
    ai.attachController('ai_test');
    mediator.tick(); // colonization — тики модулей не раздаются
    expect(ai.getWorldModel()).toBeNull();
    expect(ai.getControllerSummaries()[0]!.perceptionTick).toBeNull();
  });

  test('тик playing строит world model; perception обновляется по updateIntervalTicks', () => {
    mediator.newGame({ seed: 42, systemCount: 5 });
    const ai = getAI(mediator);
    ai.start();
    toManualTickMode(mediator);
    ai.attachController('ai_easy', 'easy'); // период 20
    ai.attachController('ai_insane', 'insane'); // период 1

    mediator.tick(); // tick 1: оба обработаны впервые
    let summaries = ai.getControllerSummaries();
    expect(summaries.find((s) => s.factionId === 'ai_easy')!.perceptionTick).toBe(1);
    expect(summaries.find((s) => s.factionId === 'ai_insane')!.perceptionTick).toBe(1);
    const wm = ai.getWorldModel()!;
    expect(wm.builtAtTick).toBe(1);
    expect(wm.systemCount).toBe(5);

    for (let i = 0; i < 8; i++) mediator.tick(); // tick 9
    summaries = ai.getControllerSummaries();
    expect(summaries.find((s) => s.factionId === 'ai_easy')!.perceptionTick).toBe(1); // период не подошёл
    expect(summaries.find((s) => s.factionId === 'ai_insane')!.perceptionTick).toBe(9);

    for (let i = 0; i < 12; i++) mediator.tick(); // tick 21
    summaries = ai.getControllerSummaries();
    expect(summaries.find((s) => s.factionId === 'ai_easy')!.perceptionTick).toBe(21);
    expect(summaries.find((s) => s.factionId === 'ai_insane')!.perceptionTick).toBe(21);
  });

  test('бюджет maxControllersPerTick: за тик не больше лимита, порядок детерминирован', () => {
    mediator.newGame({ seed: 42, systemCount: 5 });
    const ai = getAI(mediator);
    ai.start();
    toManualTickMode(mediator);
    const c1 = ai.attachController('ai_a');
    const c2 = ai.attachController('ai_b');
    const c3 = ai.attachController('ai_c');
    c1.config.maxControllersPerTick = 1;
    c2.config.maxControllersPerTick = 1;
    c3.config.maxControllersPerTick = 1;

    mediator.tick(); // tick 1: лимит 1 — только первый по порядку вставки
    expect(c1.perception?.tick).toBe(1);
    expect(c2.perception).toBeNull();
    expect(c3.perception).toBeNull();

    mediator.tick(); // tick 2: второй
    expect(c2.perception?.tick).toBe(2);
    expect(c3.perception).toBeNull();

    mediator.tick(); // tick 3: третий
    expect(c3.perception?.tick).toBe(3);
  });

  test('stop() останавливает обработку тиков; повторный start возобновляет', () => {
    mediator.newGame({ seed: 42, systemCount: 5 });
    const ai = getAI(mediator);
    ai.start();
    toManualTickMode(mediator);
    ai.attachController('ai_test');

    mediator.tick();
    expect(ai.getWorldModel()?.builtAtTick).toBe(1);

    ai.stop();
    mediator.tick();
    mediator.tick();
    expect(ai.getWorldModel()?.builtAtTick).toBe(1); // не обновился

    ai.start();
    mediator.tick();
    expect(ai.getWorldModel()?.builtAtTick).toBe(4);
  });

  // ─── Контроллеры и query ─────────────────────────────

  test('attachController идемпотентен; detach удаляет; summaries отсортированы', () => {
    const ai = getAI(mediator);
    const first = ai.attachController('ai_b', 'hard');
    const again = ai.attachController('ai_b', 'easy'); // тот же factionId
    expect(again).toBe(first);
    expect(ai.getControllerCount()).toBe(1);
    expect(first.difficulty).toBe('easy'); // обновлён
    expect(first.config.updateIntervalTicks).toBe(20); // easy → период 20

    ai.attachController('ai_a');
    ai.attachController('ai_c');
    const summaries = ai.getControllerSummaries();
    expect(summaries.map((s) => s.factionId)).toEqual(['ai_a', 'ai_b', 'ai_c']);

    ai.detachController('ai_b');
    expect(ai.getControllerCount()).toBe(2);
    ai.detachController('ai_b'); // idempotent
    expect(ai.getControllerCount()).toBe(2);
  });

  test('query ai:state возвращает сводку только для чтения; destroy снимает query', () => {
    const ai = getAI(mediator);
    mediator.newGame({ seed: 42, systemCount: 5 });
    ai.start();
    toManualTickMode(mediator);
    ai.attachController('ai_q');
    mediator.tick();

    const res = mediator.registry.query<AIStateQueryResult>('ai:state');
    expect(res).not.toBeNull();
    expect(res!.aiStateVersion).toBe(1);
    expect(res!.controllerCount).toBe(1);
    expect(res!.controllers[0]!.factionId).toBe('ai_q');
    expect(res!.worldModel!.systemCount).toBe(5);
    // Копия, а не внутренняя структура
    res!.controllers.push({ ...res!.controllers[0]!, factionId: 'spoiler' });
    expect(ai.getControllerSummaries()).toHaveLength(1);

    ai.destroy();
    const after = mediator.registry.query('ai:state');
    expect(after).toBeNull();
  });

  test('serialize: версия + счётчик; deserialize — no-op без бросков (3а)', () => {
    const ai = getAI(mediator);
    ai.attachController('ai_s');
    const data = ai.serialize();
    // R-44 (3б.1): манифест бампнут 0.1.0 → 0.2.0 (постоянный реестр в
    // GameState + syncControllersFromState); тест проверяет, что serialize
    // возвращает АКТУАЛЬНУЮ версию манифеста — смысл теста не ослаблен.
    expect(data.version).toBe('0.2.0');
    expect(data.aiStateVersion).toBe(1);
    expect(data.controllerCount).toBe(1);
    expect(() => ai.deserialize(data)).not.toThrow();
    expect(ai.getControllerCount()).toBe(1); // кэш не тронут deserialize'ом
  });
});
