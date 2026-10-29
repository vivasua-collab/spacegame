/**
 * Этап 3а (R-41): минимальные типизированные модели AI.
 *
 * Границы этапа 3а (Issue #5 / runbook владельца):
 * - ТОЛЬКО типы + валидация + построение восприятия. Никакого исполнения
 *   игровых действий (build/move/research/trade/combat/diplomacy) — это 3б,
 *   который стартует ТОЛЬКО после отдельной приёмки 3а владельцем.
 * - Интенты типизированы, но ИНЕРТНЫ: очередь накапливает записи и
 *   валидирует их, однако не содержит исполнятора и никем не вызывается
 *   вне тестов (контракт «инертная очередь»).
 * - AI-состояние 3а — ВЫЧИСЛЯЕМЫЙ КЭШ (world model + perception),
 *   полностью пересчитываемый из GameState. Постоянное состояние AI-фракций
 *   введено позже в 3б.1 (R-44 — реестр aiFactions/aiFactionsV в GameState);
 *   в 3а сериализация НЕ вводилась (на момент 3а сейвы были v3, формат
 *   тогда не менялся).
 * - AI-состояние НЕ входит в GameState: модуль не владеет игровым
 *   состоянием, кэш живёт в модуле и пересобирается при game-created /
 *   game-loaded (контракт «модули не владеют состоянием»).
 *
 * Источник требований: docs/70-ai.md (§1 архитектура, §7 сложность,
 * §8 оптимизация, приложение A/C) — сверено с фактическим кодом
 * (module-types.ts, module-registry.ts, game-mediator.ts, events.ts).
 * Расхождение спеки с кодом зафиксировано в плане R-41 §«Открытые вопросы».
 */

import type { EntityId } from '@/core/types';

// ─── Версия модели AI-состояния ──────────────────────────

/**
 * Версия контракта AI-модели этапа 3а. Увеличивается при изменении
 * формы AIWorldModel / AIPerceptionSnapshot (для будущей сериализации 3б).
 */
export const AI_STATE_VERSION = 1;

// ─── Сложность и конфигурация (docs/70-ai.md §7) ─────────

/** Уровни сложности AI (docs/70-ai.md §7.1). */
export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'insane';

export const AI_DIFFICULTIES: readonly AIDifficulty[] = ['easy', 'normal', 'hard', 'insane'];

/**
 * Частота обновления AI по уровням сложности (docs/70-ai.md §7.6,
 * строка «Частота обновления»): easy 20 / normal 10 / hard 5 / insane 1 тик.
 */
export const AI_DIFFICULTY_UPDATE_INTERVAL: Readonly<Record<AIDifficulty, number>> = {
  easy: 20,
  normal: 10,
  hard: 5,
  insane: 1,
};

/**
 * Конфигурация AI-контроллера.
 *
 * Границы бюджета на тик — ДЕТЕРМИНИРОВАННЫЕ ОПЕРАЦИОННЫЕ лимиты
 * (макс. контроллеров за тик), а не wall-clock: runbook R-41 запрещает
 * wall-clock timing в игровых решениях. ms-бюджет docs/70 §8.8 (20 мс/тик)
 * переносится в 3б/4 вместе с Web Worker — зафиксировано в плане R-41.
 */
export interface AIConfig {
  /** Уровень сложности (влияет на частоту обновления). */
  difficulty: AIDifficulty;
  /** Период обновления восприятия контроллера, в тиках. */
  updateIntervalTicks: number;
  /** Детерминированный бюджет: макс. контроллеров, обрабатываемых за один тик. */
  maxControllersPerTick: number;
}

/** Дефолтная конфигурация: normal, обновление каждые 10 тиков. */
export const DEFAULT_AI_CONFIG: Readonly<AIConfig> = {
  difficulty: 'normal',
  updateIntervalTicks: AI_DIFFICULTY_UPDATE_INTERVAL.normal,
  maxControllersPerTick: 8,
};

/**
 * Валидация AIConfig (чистая функция; юнит-тесты этапа 3а).
 * Не бросает исключений — возвращает список ошибок.
 */
export function validateAIConfig(config: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (config === null || typeof config !== 'object') {
    return { ok: false, errors: ['AIConfig должен быть объектом'] };
  }
  const c = config as Record<string, unknown>;
  if (!AI_DIFFICULTIES.includes(c.difficulty as AIDifficulty)) {
    errors.push(`difficulty должен быть одним из ${AI_DIFFICULTIES.join('|')}, получено: ${String(c.difficulty)}`);
  }
  if (typeof c.updateIntervalTicks !== 'number' || !Number.isInteger(c.updateIntervalTicks) || c.updateIntervalTicks < 1) {
    errors.push(`updateIntervalTicks должен быть целым >= 1, получено: ${String(c.updateIntervalTicks)}`);
  }
  if (typeof c.maxControllersPerTick !== 'number' || !Number.isInteger(c.maxControllersPerTick) || c.maxControllersPerTick < 0) {
    errors.push(`maxControllersPerTick должен быть целым >= 0, получено: ${String(c.maxControllersPerTick)}`);
  }
  return { ok: errors.length === 0, errors };
}

// ─── Инертная очередь намерений (goal/intent queue) ──────

/**
 * Классы действий намерений — словарь из docs/70-ai.md §2–6
 * (экономика/военное/дипломатия/экспансия/торговля/наука).
 * В 3а НИ ОДНО действие не исполняется: типы существуют как контракт
 * для 3б, очередь инертна.
 */
export type AIIntentAction =
  | 'expand'
  | 'build_economy'
  | 'build_military'
  | 'research'
  | 'trade'
  | 'diplomacy'
  | 'defend'
  | 'attack';

/**
 * Статусы намерения. В 3а достижимы только `pending` и `cancelled`;
 * статус `executed` сознательно НЕ вводится — исполнение появится в 3б.
 */
export type AIIntentStatus = 'pending' | 'cancelled';

export interface AIIntent {
  /** Стабильный уникальный идентификатор намерения. */
  id: string;
  /** Класс действия (см. AIIntentAction). */
  action: AIIntentAction;
  /** Необязательная цель (systemId/planetId/fleetId — существующие EntityId). */
  targetId?: EntityId;
  /** Тик создания (из GameTime.tick — никакого wall-clock). */
  createdAtTick: number;
  /** Приоритет (меньше = выше); использование — решение 3б. */
  priority: number;
  status: AIIntentStatus;
}

/** Инертная очередь намерений одного контроллера. */
export interface AIIntentQueue {
  factionId: EntityId;
  intents: AIIntent[];
  /** Вместимость очереди (детерминированная граница). */
  maxIntents: number;
}

/** Дефолтная вместимость intent-очереди контроллера. */
export const DEFAULT_MAX_INTENTS = 16;

/**
 * Создать пустую инертную очередь намерений.
 */
export function createIntentQueue(factionId: EntityId, maxIntents: number = DEFAULT_MAX_INTENTS): AIIntentQueue {
  return { factionId, intents: [], maxIntents };
}

/**
 * Валидация намерения (чистая функция; юнит-тесты этапа 3а).
 */
export function validateAIIntent(intent: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (intent === null || typeof intent !== 'object') {
    return { ok: false, errors: ['AIIntent должен быть объектом'] };
  }
  const i = intent as Record<string, unknown>;
  const actions: readonly string[] = [
    'expand', 'build_economy', 'build_military', 'research',
    'trade', 'diplomacy', 'defend', 'attack',
  ];
  if (typeof i.id !== 'string' || i.id.length === 0) {
    errors.push('id должен быть непустой строкой');
  }
  if (!actions.includes(String(i.action))) {
    errors.push(`action должен быть одним из ${actions.join('|')}, получено: ${String(i.action)}`);
  }
  if (i.targetId !== undefined && (typeof i.targetId !== 'string' || i.targetId.length === 0)) {
    errors.push('targetId должен быть непустой строкой или отсутствовать');
  }
  if (typeof i.createdAtTick !== 'number' || !Number.isInteger(i.createdAtTick) || i.createdAtTick < 0) {
    errors.push(`createdAtTick должен быть целым >= 0, получено: ${String(i.createdAtTick)}`);
  }
  if (typeof i.priority !== 'number' || !Number.isFinite(i.priority)) {
    errors.push('priority должен быть конечным числом');
  }
  if (i.status !== 'pending' && i.status !== 'cancelled') {
    errors.push(`status должен быть 'pending'|'cancelled', получено: ${String(i.status)}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Добавить намерение в ИНЕРТНУЮ очередь.
 *
 * Контракт 3а: очередь только накапливает и валидирует. Исполнятора нет;
 * функция не эмитит событий и не мутирует GameState. Отклонение по
 * вместимости/дубликату id — явный отказ, без бросков.
 */
export function enqueueIntent(queue: AIIntentQueue, intent: AIIntent): { ok: boolean; errors: string[] } {
  const v = validateAIIntent(intent);
  if (!v.ok) return v;
  if (queue.intents.length >= queue.maxIntents) {
    return { ok: false, errors: [`Очередь переполнена (max ${queue.maxIntents})`] };
  }
  if (queue.intents.some((x) => x.id === intent.id)) {
    return { ok: false, errors: [`Намерение с id "${intent.id}" уже в очереди`] };
  }
  queue.intents.push(intent);
  return { ok: true, errors: [] };
}

// ─── World model (общая, вычисляемая) ────────────────────

/**
 * Общая (shared между контроллерами) лёгкая модель мира.
 *
 * - ВЫЧИСЛЯЕТСЯ из GameState (пересобирается каждый игровой тик фазы
 *   playing — см. AIModule.tick). НЕ сериализуется в сейв (3а).
 * - НЕ копирует мир: только агрегаты из стабильных источников
 *   (galaxy.systems — массив; fleets — массив; ships — Map, счётчики).
 * - Ключи Record отсортированы при построении (стабильный порядок
 *   сериализации/сравнения — детерминизм).
 * - Видимость (fog-of-war per-faction) в игре отсутствует
 *   (system.discovered — глобальный флаг): в 3а модель видит агрегаты
 *   всего мира; фильтры видимости — точка расширения 3б (зафиксировано
 *   в плане R-41, «Открытые вопросы»).
 */
export interface AIWorldModel {
  /** Версия контракта модели. */
  stateVersion: number;
  /** Тик, на котором модель построена (= state.time.tick). */
  builtAtTick: number;
  /** Год модели (= state.time.year). */
  year: number;
  galaxyId: EntityId;
  seed: number;
  /** Всего систем в галактике. */
  systemCount: number;
  /** Систем, имеющих хотя бы одну колонизированную планету (owner != null). */
  colonizedSystemCount: number;
  /** owner (factionId) → отсортированный массив id систем. */
  systemsByOwner: Record<string, EntityId[]>;
  /** owner → число колонизированных планет. */
  planetCountByOwner: Record<string, number>;
  /** owner → число флотов (state.fleets). */
  fleetCountByOwner: Record<string, number>;
  /** owner → число кораблей (state.ships). */
  shipCountByOwner: Record<string, number>;
}

// ─── Perception snapshot (на контроллер) ─────────────────

/**
 * Снимок восприятия одного AI-контроллера.
 *
 * - Defensive copy: агрегаты копируются из world model; НИ ОДНОЙ ссылки
 *   на GameState / AIWorldModel (тест 3а проверяет мутационную изоляцию).
 * - `knownSystemCount` в 3а = systemCount (видимость тривиальна, см.
 *   AIWorldModel); в 3б станет срезом по fog-of-war фракции.
 */
export interface AIPerceptionSnapshot {
  stateVersion: number;
  factionId: EntityId;
  /** Тик, на котором снимок построен. */
  tick: number;
  /** builtAtTick world model, на основе которой построен снимок. */
  worldModelTick: number;
  /** Отсортированный массив id систем, принадлежащих фракции. */
  ownedSystems: EntityId[];
  /** Число колонизированных планет фракции. */
  colonyCount: number;
  /** Число известных систем (3а: тривиальная видимость = systemCount). */
  knownSystemCount: number;
  /** Число флотов фракции. */
  fleetCount: number;
  /** Число кораблей фракции. */
  shipCount: number;
}

// ─── Состояние контроллера (вычисляемый кэш 3а) ─────────

/**
 * Состояние AI-контроллера этапа 3а.
 *
 * ВАЖНО (граница 3а/3б): это НЕ постоянное состояние фракции-«империи»
 * (ресурсы/территория/флот из docs/70 §1.1) — его в игре пока нет.
 * Это вычисляемый кэш контроллера: конфиг + снимок восприятия +
 * инертная очередь намерений. Всё пересчитывается/пересобирается из
 * GameState; при game-created/game-loaded контроллеры сбрасываются
 * (кэш не переживает смену мира — сериализация появится в 3б).
 */
export interface AIControllerState {
  factionId: EntityId;
  difficulty: AIDifficulty;
  config: AIConfig;
  /** Последний построенный снимок восприятия (null до первого тика). */
  perception: AIPerceptionSnapshot | null;
  /** Инертная очередь намерений. */
  intents: AIIntentQueue;
  /** Тик последней обработки контроллера (для updateIntervalTicks). */
  lastProcessedTick: number;
}

// ─── Сводка для query/UI (только чтение) ────────────────

/** Сводка контроллера для query 'ai:state' (без внутренних ссылок). */
export interface AIControllerSummary {
  factionId: EntityId;
  difficulty: AIDifficulty;
  perceptionTick: number | null;
  colonyCount: number | null;
  ownedSystemCount: number | null;
  pendingIntents: number;
}
