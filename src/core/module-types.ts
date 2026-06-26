/**
 * Контракт модуля — типы для манифеста, жизненного цикла и интерфейса модуля.
 *
 * Каждый модуль реализует IGameModule и предоставляет ModuleManifest.
 * Манифест — это «паспорт» модуля, описывающий его зависимости,
 * события и запросы.
 */

import type { EventName } from './events';
import type { GameTime } from './types';

// ─── Идентификаторы ──────────────────────────────────────

/** Уникальный идентификатор модуля */
export type ModuleId =
  | 'core'
  | 'galaxy'
  | 'economy'
  | 'ships'
  | 'fleet'
  | 'combat'
  | 'tech'
  | 'diplomacy'
  | 'trade'
  | 'ai';

/** Фаза жизненного цикла модуля */
export type ModulePhase = 'uninitialized' | 'initialized' | 'started' | 'stopped' | 'destroyed';

// ─── Декларации ──────────────────────────────────────────

/** Декларация подписки модуля на событие */
export interface EventSubscription {
  event: EventName;
  /** Приоритет обработки (меньше = раньше). По умолчанию: 100 */
  priority?: number;
  /** Если true — отписаться после первого вызова */
  once?: boolean;
}

/** Декларация запроса, который модуль обрабатывает */
export interface QueryDeclaration {
  queryName: string;
  description: string;
  requestType: string;   // имя типа запроса (для документации)
  responseType: string;  // имя типа ответа (для документации)
}

// ─── Манифест ────────────────────────────────────────────

/**
 * Манифест модуля — декларативное описание модуля.
 * Это «паспорт» модуля, который видит реестр.
 */
export interface ModuleManifest {
  /** Уникальный идентификатор модуля */
  id: ModuleId;

  /** Человекочитаемое название */
  name: string;

  /** Версия модуля (semver) */
  version: string;

  /** Описание */
  description: string;

  /** Зависимости от других модулей (будут инициализированы раньше) */
  dependencies: ModuleId[];

  /** События, которые этот модуль генерирует (emit) */
  emits: EventName[];

  /** События, на которые модуль подписывается (on) */
  subscribes: EventSubscription[];

  /** Запросы, которые модуль обрабатывает */
  handlesQueries: QueryDeclaration[];

  /** Запросы, которые модуль отправляет другим модулям */
  requiresQueries: QueryDeclaration[];
}

// ─── Интерфейс модуля ────────────────────────────────────

/**
 * Интерфейс игрового модуля.
 * Каждый модуль реализует этот интерфейс.
 *
 * Жизненный цикл:
 *   uninitialized → init() → initialized → start() → started ⇄ stopped → destroy() → destroyed
 *
 * Правила:
 * - init() вызывается ровно один раз, после разрешения всех зависимостей
 * - start()/stop() могут вызываться многократно (пауза/резюме)
 * - tick() вызывается только в состоянии started
 * - destroy() необратим
 * - serialize() может вызываться в любом состоянии кроме destroyed
 * - deserialize() вызывается в состоянии initialized перед start()
 */
export interface IGameModule {
  /** Манифест модуля */
  readonly manifest: ModuleManifest;

  /** Текущая фаза жизненного цикла */
  readonly phase: ModulePhase;

  /**
   * Инициализация модуля.
   * Вызывается после разрешения зависимостей.
   * Здесь: создание стора, подписка на события, регистрация запросов.
   */
  init(bus: import('./typed-event-bus').TypedEventBus, registry: import('./module-registry').ModuleRegistry): void;

  /** Запуск модуля. Модуль готов обрабатывать тики и события. */
  start(): void;

  /** Обработка одного игрового тика. Вызывается GameLoop'ом в детерминированном порядке. */
  tick(time: GameTime): void;

  /** Остановка модуля (пауза). Модуль прекращает обработку тиков, но сохраняет состояние. */
  stop(): void;

  /** Уничтожение модуля. Отписка от событий, очистка ресурсов. */
  destroy(): void;

  /** Сериализация состояния модуля для сохранения. Возвращает JSON-safe объект. */
  serialize(): Record<string, unknown>;

  /** Десериализация состояния модуля из сохранения. */
  deserialize(data: Record<string, unknown>): void;
}

// ─── Приоритеты ──────────────────────────────────────────

/**
 * Таблица приоритетов обработки событий.
 * Меньшее значение = более ранний вызов.
 *
 * | Диапазон | Назначение       | Примеры                          |
 * |----------|-----------------|----------------------------------|
 * | 0–9      | Ядро (Core)     | GameLoop, ModuleRegistry         |
 * | 10–29    | Симуляция       | EconomyModule.tick, ShipsModule  |
 * | 30–49    | Реакция         | AIModule анализирует тик         |
 * | 50–69    | Вторичные       | DiplomacyModule (реакция на бои) |
 * | 70–89    | Уведомления     | TradeModule (реакция на спрос)   |
 * | 90–99    | UI/Логирование  | Отладка, аналитика               |
 */
export const PRIORITY = {
  CORE: 0,
  SIMULATION: 10,
  REACTION: 30,
  SECONDARY: 50,
  NOTIFICATION: 70,
  UI: 90,
  DEFAULT: 100,
} as const;
