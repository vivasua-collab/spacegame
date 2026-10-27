/**
 * Этап 3а (R-41): AIModule — каркас AI-фракций.
 *
 * КОНТРАКТ ЭТАПА 3а (Issue #5 + runbook владельца):
 * - Подключение ТОЛЬКО через существующие архитектурные механизмы:
 *   IGameModule/ModuleManifest + ModuleRegistry + GameMediator + GameLoop.
 *   Ни второй шины, ни параллельного таймера/интервала — работа только в
 *   tick(), который раздаёт GameLoop через registry.tickAll() в детермини-
 *   рованном порядке (AI тикает ПОСЛЕДНИМ: dependencies=['economy'] + регис-
 *   трация последней → initOrder [galaxy, economy, tech, ships, fleet, ai]).
 * - AI НЕ мутирует GameState: мутатора у модуля нет вовсе
 *   (setGameStateMutator не вызывается в game-store) — коммит физически
 *   недоступен. Мир читается через accessor; восприятие — defensive copy.
 * - Никаких игровых действий в 3а (build/move/research/trade/combat/
 *   diplomacy): intent-очередь инертна (см. src/ai/types.ts), события ai:*
 *   остаются зарезервированными (events.ts) — модуль НИЧЕГО не эмитит.
 * - Подписки создаются ТОЛЬКО в init(), снимаются в destroy() — безопасны
 *   при start/stop/newGame/load/повторной регистрации (R-39 lifecycle):
 *   обработчики сбрасывают ВЫЧИСЛЯЕМЫЙ кэш и не зависят от внешнего
 *   состояния.
 * - AI-состояние 3а — вычисляемый кэш (world model + perception),
 *   пересобираемый каждый игровой тик фазы playing; при game-created /
 *   game-loaded контроллеры сбрасываются. Сериализация в сейв НЕ вводится:
 *   serialize() = { version } (как у ResearchModule), формат сейва v3 не
 *   меняется, старые сейвы совместимы по построению.
 * - Бюджет на тик — детерминированный операционный лимит
 *   (maxControllersPerTick), без wall-clock.
 *
 * Этап 3б.1 (R-44): постоянное состояние AI-фракций живёт в GameState
 * (state.aiFactions — ссылочные сущности, см. src/ai/factions.ts), НЕ в
 * модуле: кэш контроллеров по-прежнему вычисляемый и синхронизируется от
 * реестра состояния каждый тик (syncControllersFromState — отсортированные
 * ключи, attach/идемпотентное обновление конфига, БЕЗ удаления ручных/
 * тестовых контроллеров). Подписки НЕ растут (синхронизация тиковая,
 * event-подписки прежние). Модуль по-прежнему БЕЗ мутатора: реестр пишет
 * СТОР (setupAIFactions), модуль только читает. Игровые действия — 3б.3+.
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, GameState, EntityId } from '@/core/types';
import { PRIORITY } from '@/core/module-types';
import {
  AI_STATE_VERSION,
  AI_DIFFICULTY_UPDATE_INTERVAL,
  DEFAULT_AI_CONFIG,
  createIntentQueue,
  type AIDifficulty,
  type AIConfig,
  type AIWorldModel,
  type AIControllerState,
  type AIControllerSummary,
} from '@/ai/types';
import { buildWorldModel, buildPerception } from '@/ai/perception';

/** Сводка состояния AI-модуля для query 'ai:state' (только чтение). */
export interface AIStateQueryResult {
  aiStateVersion: number;
  controllerCount: number;
  controllers: AIControllerSummary[];
  worldModel: {
    builtAtTick: number | null;
    systemCount: number;
    colonizedSystemCount: number;
  } | null;
}

export class AIModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'ai',
    name: 'AI-фракции (этап 3б.1: постоянное состояние)',
    version: '0.2.0',
    description:
      'Детерминированный AI: постоянный реестр фракций живёт в GameState (aiFactions, ' +
      'сериализуется в v3 с маркером aiFactionsV); контроллеры — вычисляемый кэш от реестра ' +
      '(syncControllersFromState), world model + perception — defensive copy, инертная очередь ' +
      'намерений. Без игровых действий (3б.3+) и без мутации GameState (мутатора нет).',
    dependencies: ['economy'],
    // 3а: модуль НЕ эмитит события — ai:* остаются зарезервированными
    // (events.ts, каталог «вперёд» под этапы 3б/4).
    emits: [],
    subscribes: [
      // Lifecycle-сброс вычисляемого кэша при смене мира. Приоритет
      // NOTIFICATION (70) — реакции на lifecycle не должны опережать
      // симуляцию/реакцию. Обработчики инертны (сброс кэша модуля).
      { event: 'core:game-created', priority: PRIORITY.NOTIFICATION },
      { event: 'core:game-loaded', priority: PRIORITY.NOTIFICATION },
    ],
    handlesQueries: [
      {
        queryName: 'ai:state',
        description: 'Сводка AI-контроллеров и world model (только чтение; 3а)',
        requestType: 'void',
        responseType: 'AIStateQueryResult',
      },
    ],
    requiresQueries: [],
  };

  private _phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubscribers: Array<() => void> = [];

  /**
   * Accessor для GameState (чтение). Устанавливается из game-store.
   * ВАЖНО (3а): mutator НЕ устанавливается — AI не может коммитить
   * состояние (setGameStateMutator отсутствует сознательно).
   */
  private getGameState: (() => GameState | null) | null = null;

  /** Общие контроллеры (вычисляемый кэш 3а). Порядок обхода — вставки Map (детерминизм). */
  private controllers = new Map<EntityId, AIControllerState>();

  /** Общая world model (пересобирается каждый игровой тик playing). */
  private worldModel: AIWorldModel | null = null;

  get phase(): ModulePhase {
    return this._phase;
  }

  /** Установить accessor чтения GameState (из store/mediator). */
  setGameStateAccessor(accessor: () => GameState | null): void {
    this.getGameState = accessor;
  }

  // ─── Жизненный цикл (IGameModule) ─────────────────────

  init(bus: TypedEventBus, registry: ModuleRegistry): void {
    this.bus = bus;
    this.registry = registry;
    this._phase = 'initialized';

    // Подписки создаются РОВНО ОДИН РАЗ (здесь), снимаются в destroy().
    // Обработчики только сбрасывают вычисляемый кэш — безопасны при
    // replay-доставке (медиатор включает replay для core:game-created).
    this.unsubscribers.push(
      bus.on(
        'core:game-created',
        () => this.resetDerivedState(),
        { priority: PRIORITY.NOTIFICATION, label: 'ai' },
      ),
      bus.on(
        'core:game-loaded',
        () => this.resetDerivedState(),
        { priority: PRIORITY.NOTIFICATION, label: 'ai' },
      ),
    );

    registry.registerQuery('ai:state', () => this.queryAIState());
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  stop(): void {
    if (this._phase !== 'started') return;
    this._phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.registry.unregisterQuery('ai:state');
    this.controllers.clear();
    this.worldModel = null;
    this._phase = 'destroyed';
  }

  /**
   * Сериализация состояния модуля.
   * Постоянное состояние фракций живёт в GameState (aiFactions) и попадает
   * в сейв через serializeGameState (v3-секция aiFactions/aiFactionsV, R-44) —
   * модульный serialize его НЕ дублирует. Кэш контроллеров вычисляемый,
   * в сейв не пишется. Возвращаем версию — как ResearchModule.
   */
  serialize(): Record<string, unknown> {
    return {
      version: this.manifest.version,
      aiStateVersion: AI_STATE_VERSION,
      // Информационно (не используется загрузчиком): число контроллеров.
      controllerCount: this.controllers.size,
    };
  }

  /**
   * Десериализация. 3а: no-op — состояние вычисляется из GameState,
   * контроллеры подключаются игровым setup-путём (3б) заново.
   */
  deserialize(_data: Record<string, unknown>): void {
    void _data;
  }

  // ─── Тик ──────────────────────────────────────────────

  /**
   * Обработка одного тика. Вызывается GameLoop'ом через registry.tickAll
   * ПОСЛЕДНИМ (после galaxy/economy/tech/ships/fleet).
   *
   * Контракт 3а:
   * - phase-guard 'playing' (как у остальных модулей — защита в глубину);
   * - world model пересобирается каждый игровой тик (лёгкие агрегаты);
   * - контроллеры обрабатываются в порядке вставки Map (детерминизм) с
   *   бюджетом maxControllersPerTick и периодом updateIntervalTicks;
   * - perception — defensive copy (buildPerception);
   * - НИКАКИХ мутаций GameState и игровых действий.
   */
  tick(time: GameTime): void {
    if (this._phase !== 'started') return;
    const state = this.getGameState?.();
    if (!state) return;
    if (state.phase !== 'playing') return; // только активная игра

    // Общая world model: пересборка каждый игровой тик (лёгкие агрегаты).
    this.worldModel = buildWorldModel(state);

    // Этап 3б.1 (R-44): контроллеры синхронизируются от постоянного реестра
    // state.aiFactions (отсортированные ключи — детерминизм; БЕЗ удаления
    // ручных/тестовых контроллеров; БЕЗ мутаций GameState).
    this.syncControllersFromState(state);

    // Детерминированный бюджет на тик.
    let processed = 0;
    for (const controller of this.controllers.values()) {
      if (processed >= controller.config.maxControllersPerTick) break;
      if (time.tick - controller.lastProcessedTick < controller.config.updateIntervalTicks) continue;

      controller.perception = buildPerception(this.worldModel, controller.factionId, time.tick);
      controller.lastProcessedTick = time.tick;
      processed++;
    }
  }

  // ─── Управление контроллерами (3а: programmatic API) ──

  /**
   * Подключить AI-контроллер фракции.
   *
   * 3а: контроллер — вычисляемый кэш, НЕ постоянная фракция-империя.
   * В продакшене контроллеров нет (AI-фракции появятся в 3б вместе с
   * игровым setup-путём); API используется тестами и будущим 3б.
   * Идемпотентен: повторный attach существующей фракции обновляет
   * сложность и возвращает существующий контроллер (без дублей).
   */
  attachController(factionId: EntityId, difficulty: AIDifficulty = DEFAULT_AI_CONFIG.difficulty): AIControllerState {
    const existing = this.controllers.get(factionId);
    const config: AIConfig = {
      difficulty,
      updateIntervalTicks: AI_DIFFICULTY_UPDATE_INTERVAL[difficulty],
      maxControllersPerTick: DEFAULT_AI_CONFIG.maxControllersPerTick,
    };
    if (existing) {
      existing.difficulty = difficulty;
      existing.config = config;
      return existing;
    }
    const controller: AIControllerState = {
      factionId,
      difficulty,
      config,
      perception: null,
      intents: createIntentQueue(factionId),
      lastProcessedTick: Number.NEGATIVE_INFINITY,
    };
    this.controllers.set(factionId, controller);
    return controller;
  }

  /** Отключить AI-контроллер (idempotent). */
  detachController(factionId: EntityId): void {
    this.controllers.delete(factionId);
  }

  /** Число подключённых контроллеров. */
  getControllerCount(): number {
    return this.controllers.size;
  }

  /**
   * Сводки контроллеров, отсортированные по factionId (детерминизм вывода).
   * Копии — без внутренних ссылок.
   */
  getControllerSummaries(): AIControllerSummary[] {
    const summaries: AIControllerSummary[] = [];
    for (const factionId of Array.from(this.controllers.keys()).sort()) {
      const c = this.controllers.get(factionId)!;
      summaries.push({
        factionId: c.factionId,
        difficulty: c.difficulty,
        perceptionTick: c.perception?.tick ?? null,
        colonyCount: c.perception?.colonyCount ?? null,
        ownedSystemCount: c.perception?.ownedSystems.length ?? null,
        pendingIntents: c.intents.intents.filter((i) => i.status === 'pending').length,
      });
    }
    return summaries;
  }

  /** Текущая общая world model (только чтение; null до первого тика playing). */
  getWorldModel(): AIWorldModel | null {
    return this.worldModel;
  }

  // ─── Синхронизация контроллеров от постоянного реестра (3б.1) ──

  /**
   * Синхронизация кэша контроллеров от state.aiFactions (R-44).
   *
   * - Отсортированные ключи реестра (детерминизм порядка вставки Map);
   * - НОВОЙ фракции — контроллер с конфигом ИЗ фракции (faction.config);
   * - существующей — идемпотентное обновление конфига при расхождении;
   * - БЕЗ удаления: контроллеры, подключённые вручную/тестами (3а API),
   *   сохраняются; удаление фракций из реестра — за пределами 3б.1
   *   (API не существует; контракт зафиксирован в чекпоинте R-44);
   * - отсутствие реестра (старые состояния/сейвы) — no-op (3а-совместимость).
   */
  private syncControllersFromState(state: GameState): void {
    const registry = state.aiFactions;
    if (!registry) return; // 3а-совместимость: реестра нет — контроллеры не трогаем
    for (const factionId of Object.keys(registry).sort()) {
      const faction = registry[factionId];
      if (!faction || faction.id !== factionId) continue; // повреждённая запись — не читаем (валидация на setup/загрузке)
      const config: AIConfig = {
        difficulty: faction.config.difficulty,
        updateIntervalTicks: faction.config.updateIntervalTicks,
        maxControllersPerTick: faction.config.maxControllersPerTick,
      };
      const existing = this.controllers.get(factionId);
      if (!existing) {
        this.controllers.set(factionId, {
          factionId,
          difficulty: config.difficulty,
          config,
          perception: null,
          intents: createIntentQueue(factionId),
          lastProcessedTick: Number.NEGATIVE_INFINITY,
        });
      } else if (
        existing.difficulty !== config.difficulty ||
        existing.config.updateIntervalTicks !== config.updateIntervalTicks ||
        existing.config.maxControllersPerTick !== config.maxControllersPerTick
      ) {
        existing.difficulty = config.difficulty;
        existing.config = config;
      }
    }
  }

  // ─── Внутреннее ───────────────────────────────────────

  /**
   * Сброс вычисляемого кэша при смене мира (game-created / game-loaded).
   * Контроллеры тоже сбрасываются: кэш не переживает смену мира
   * (сериализация контроллеров — решение 3б).
   */
  private resetDerivedState(): void {
    this.controllers.clear();
    this.worldModel = null;
  }

  /** Query 'ai:state' — сводка только для чтения (копии, без ссылок). */
  private queryAIState(): AIStateQueryResult {
    const wm = this.worldModel;
    return {
      aiStateVersion: AI_STATE_VERSION,
      controllerCount: this.controllers.size,
      controllers: this.getControllerSummaries(),
      worldModel: wm
        ? {
            builtAtTick: wm.builtAtTick,
            systemCount: wm.systemCount,
            colonizedSystemCount: wm.colonizedSystemCount,
          }
        : null,
    };
  }
}
