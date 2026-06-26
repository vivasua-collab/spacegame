# Модульная архитектура SpaceGame: Типизированная шина событий и система модулей

> **Версия:** 1.0
> **Дата:** 2026-03-05
> **Статус:** Проект (Design Document)
> **Зависимости:** [ARCHITECTURE.md](../ARCHITECTURE.md), [modularity.md](../modularity.md)
> **Затрагиваемые файлы:** `src/core/event-bus.ts`, `src/core/game-loop.ts`, `src/core/types.ts`, `src/stores/game-store.ts`, `src/economy/engine.ts`

---

## Содержание

1. [Архитектурный обзор](#1-архитектурный-обзор)
2. [Дизайн шины событий](#2-дизайн-шины-событий)
3. [Контракт модуля](#3-контракт-модуля)
4. [Реестр модулей](#4-реестр-модулей)
5. [Система запросов](#5-система-запросов)
6. [Архитектура состояния](#6-архитектура-состояния)
7. [Интеграция игрового цикла](#7-интеграция-игрового-цикла)
8. [Каталог типизированных событий](#8-каталог-типизированных-событий)
9. [Стратегия миграции](#9-стратегия-миграции)
10. [Шаблон нового модуля](#10-шаблон-нового-модуля)

---

## 1. Архитектурный обзор

### 1.1 Проблематика текущей архитектуры

Текущая архитектура имеет ряд критических недостатков, которые будут усугубляться с добавлением новых модулей (корабли, AI, технологии, бой, дипломатия, торговля):

| Проблема | Текущее состояние | Последствие |
|----------|-------------------|-------------|
| Нетипизированная шина | `EventBus` принимает `string` | Опечатки не ловятся, нет автодополнения |
| Монолитный стор | `game-store.ts` — 570+ строк | Сложность растёт квадратично с числом модулей |
| Прямые мутации | `economy/engine.ts` мутирует планеты напрямую | Побочные эффекты, сложно отлаживать |
| Отключённый GameLoop | `useEffect`/`setInterval` в page.tsx | Двойная логика, невозможно тестировать |
| Нет неймспейсов | `gameBus.emit('tick')` | Конфликты имён при росте числа событий |
| Нет подписок | Economy эмитит `production:complete`, никто не слушает | События теряются, модули не могут реагировать |

### 1.2 Целевая архитектура

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GameLoop (ядро)                              │
│                    ┌──────────────┐                                 │
│                    │  processTick │──── emit('core:tick', time)     │
│                    └──────┬───────┘                                 │
│                           │                                         │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────────┐
          │                 ▼                      │
          │    ┌────────────────────────┐          │
          │    │   TypedEventBus        │          │
          │    │   (центральная шина)   │          │
          │    │                        │          │
          │    │  ┌──────────────────┐  │          │
          │    │  │ QueryRegistry    │  │          │
          │    │  │ (запросы данных) │  │          │
          │    │  └──────────────────┘  │          │
          │    └───────┬────┬────┬──────┘          │
          │            │    │    │                  │
          └────────────┼────┼────┼─────────────────┘
                       │    │    │
          ┌────────────┘    │    └────────────────┐
          ▼                 ▼                     ▼
  ┌───────────┐    ┌──────────────┐      ┌──────────────┐
  │  Galaxy   │    │   Economy    │      │    Ships     │
  │  Module   │    │   Module     │      │   Module     │
  ├───────────┤    ├──────────────┤      ├──────────────┤
  │ manifest  │    │  manifest    │      │  manifest    │
  │ state     │    │  state       │      │  state       │
  │ handlers  │    │  handlers    │      │  handlers    │
  │ queries   │    │  queries     │      │  queries     │
  └───────────┘    └──────────────┘      └──────────────┘
          │                 │                     │
          └────────┬────────┘─────────────────────┘
                   ▼
          ┌────────────────┐
          │  Module        │
          │  Registry      │
          │  (dep resolve, │
          │   init order)  │
          └────────────────┘
                   │
                   ▼
          ┌──────────────────────────────────────┐
          │         Zustand Stores (per-module)  │
          │                                      │
          │  useGalaxyStore  useEconomyStore     │
          │  useShipStore    useDiplomacyStore   │
          │  useTechStore    useCombatStore      │
          │  useTradeStore   useCoreStore        │
          └──────────────────────────────────────┘
```

### 1.3 Принципы проектирования

1. **Шина — единственный канал межмодульного взаимодействия.** Модули НЕ импортируют друг друга напрямую.
2. **Каждый модуль — чёрный ящик.** Внешний мир знает только события и запросы модуля.
3. **Горячее подключение.** Новый модуль добавляется через регистрацию в реестре — без правки существующего кода.
4. **Детерминизм.** Порядок обработки событий фиксирован (приоритеты + порядок регистрации).
5. **Обратная совместимость.** Существующий код продолжает работать во время миграции.

### 1.4 Поток данных

```
Пользовательский ввод (UI)
        │
        ▼
  Zustand Action → emit('economy:build', { planetId, ... })
        │
        ▼
  TypedEventBus → EconomyModule.onBuild()
        │
        ├─→ EconomyStore.update() (иммутабельно)
        ├─→ emit('economy:building-constructed', { ... })
        │       │
        │       ├─→ GalaxyModule → обновить discovered
        │       ├─→ UIModule → показать уведомление
        │       └─→ AIModule → пересчитать стратегию
        │
        └─→ return result → UI
```

---

## 2. Дизайн шины событий

### 2.1 Типизированные события

Вместо `string` используем **маппинг тип события → тип полезной нагрузки**. Это даёт автодополнение и проверку типов на этапе компиляции.

```typescript
// src/core/events.ts

/**
 * Карта типизированных событий.
 * Ключ = имя события (формат module:action),
 * Значение = тип полезной нагрузки (payload).
 *
 * Неймспейс:  module:action
 *   module  — имя модуля (galaxy, economy, ships, combat, ai, tech, diplomacy, trade, core)
 *   action  — действие или результат (tick, build, colonized, arrived, completed, ...)
 */
export interface EventMap {
  // ─── Core ─────────────────────────────────────────────────
  'core:tick':               GameTime;
  'core:year':               GameTime;
  'core:started':            void;
  'core:paused':             void;
  'core:resumed':            void;
  'core:speed-changed':      GameSpeed;
  'core:game-created':       { galaxyId: EntityId; seed: number };
  'core:game-loaded':        { saveId: string };

  // ─── Galaxy ───────────────────────────────────────────────
  'galaxy:generated':        { galaxyId: EntityId; systemCount: number; seed: number };
  'galaxy:system-discovered':{ systemId: EntityId; byFactionId: EntityId };
  'galaxy:system-surveyed':  { systemId: EntityId; byFactionId: EntityId };

  // ─── Economy ──────────────────────────────────────────────
  'economy:build':           { planetId: EntityId; hexIndex: number; buildingId: string };
  'economy:building-constructed': { planetId: EntityId; hexIndex: number; buildingId: string };
  'economy:upgrade':         { planetId: EntityId; hexIndex: number };
  'economy:building-upgraded':    { planetId: EntityId; hexIndex: number; level: number };
  'economy:enqueue':         { planetId: EntityId; recipeId: string; repeat: boolean };
  'economy:production-complete':  { planetId: EntityId; recipeId: string };
  'economy:colonize':        { planetId: EntityId };
  'economy:planet-colonized':     { planetId: EntityId; hexIndex: number };
  'economy:energy-recalced':      { planetId: EntityId; balance: number };
  'economy:resource-depleted':    { planetId: EntityId; elementId: string; hexIndex: number };
  'economy:warehouse-full':       { planetId: EntityId };
  'economy:warehouse-updated':    { planetId: EntityId; capacity: number; used: number };

  // ─── Ships ────────────────────────────────────────────────
  'ships:designed':          { designId: EntityId; hullId: string; moduleCount: number };
  'ships:constructed':       { shipId: EntityId; designId: EntityId; owner: EntityId };
  'ships:destroyed':         { shipId: EntityId; systemId: EntityId; byFactionId?: EntityId };
  'ships:movement-started':  { shipId: EntityId; from: EntityId; to: EntityId; etaTick: number };
  'ships:arrived':           { shipId: EntityId; systemId: EntityId };
  'ships:damaged':           { shipId: EntityId; hp: number; maxHp: number };
  'ships:repaired':          { shipId: EntityId; hp: number };

  // ─── Fleet ────────────────────────────────────────────────
  'fleet:created':           { fleetId: EntityId; owner: EntityId; shipCount: number };
  'fleet:order-issued':      { fleetId: EntityId; orderType: string; targetId: EntityId };
  'fleet:order-completed':   { fleetId: EntityId; orderType: string; targetId: EntityId };
  'fleet:merged':            { fleetId: EntityId; fromFleetIds: EntityId[] };
  'fleet:split':             { fleetId: EntityId; newFleetId: EntityId };

  // ─── Combat ───────────────────────────────────────────────
  'combat:engaged':          { systemId: EntityId; attackerFactionId: EntityId; defenderFactionId: EntityId };
  'combat:round':            { systemId: EntityId; round: number; attackerDmg: number; defenderDmg: number };
  'combat:resolved':         { systemId: EntityId; winnerFactionId: EntityId; losses: { factionId: EntityId; shipCount: number }[] };
  'combat:planet-bombarded': { planetId: EntityId; damage: number; buildingsDestroyed: number };

  // ─── Tech ─────────────────────────────────────────────────
  'tech:research-started':   { techId: string; factionId: EntityId; etaTick: number };
  'tech:research-completed': { techId: string; factionId: EntityId };
  'tech:unlocked':           { techId: string; factionId: EntityId; unlocks: string[] };

  // ─── Diplomacy ────────────────────────────────────────────
  'diplomacy:proposal':      { fromFactionId: EntityId; toFactionId: EntityId; type: string };
  'diplomacy:accepted':      { fromFactionId: EntityId; toFactionId: EntityId; type: string };
  'diplomacy:rejected':      { fromFactionId: EntityId; toFactionId: EntityId; type: string };
  'diplomacy:relations-changed': { factionA: EntityId; factionB: EntityId; delta: number; newScore: number };
  'diplomacy:war-declared':  { attackerFactionId: EntityId; defenderFactionId: EntityId };
  'diplomacy:peace-signed':  { factionA: EntityId; factionB: EntityId };

  // ─── Trade ────────────────────────────────────────────────
  'trade:offer-created':     { offerId: EntityId; factionId: EntityId; resourceId: string; amount: number; price: number };
  'trade:offer-accepted':    { offerId: EntityId; buyerFactionId: EntityId };
  'trade:route-established': { routeId: EntityId; fromPlanetId: EntityId; toPlanetId: EntityId; resourceId: string };
  'trade:route-completed':   { routeId: EntityId; delivered: number };
  'trade:route-raided':      { routeId: EntityId; raiderFactionId: EntityId; stolen: number };

  // ─── AI ───────────────────────────────────────────────────
  'ai:decision':             { factionId: EntityId; action: string; targetId?: EntityId };
  'ai:colony-founded':       { factionId: EntityId; planetId: EntityId };
  'ai:fleet-sent':           { factionId: EntityId; fleetId: EntityId; purpose: string };
}

/** Тип имени события из EventMap */
export type EventName = keyof EventMap;

/** Тип полезной нагрузки для конкретного события */
export type EventPayload<E extends EventName> = EventMap[E];

/** Полный тип события для обработчика */
export type EventHandler<E extends EventName> = (payload: EventPayload<E>) => void;
```

### 2.2 Типизированная шина

```typescript
// src/core/typed-event-bus.ts

import type { EventMap, EventName, EventPayload, EventHandler } from './events';

/** Конфигурация подписчика */
export interface SubscriptionOptions {
  /** Приоритет обработки (меньше = раньше). По умолчанию: 100 */
  priority?: number;
  /** Метка подписчика для отладки */
  label?: string;
  /** Одноразовая подписка (автоотписка после первого вызова) */
  once?: boolean;
}

interface Subscription<E extends EventName> {
  handler: EventHandler<E>;
  priority: number;
  label: string;
  once: boolean;
}

/**
 * Типизированная шина событий.
 *
 * Ключевые отличия от старой реализации:
 * 1. Типобезопасность: имена событий и payload проверяются компилятором
 * 2. Приоритеты: обработчики вызываются в порядке priority (0 = первый)
 * 3. Event replay: поздние подписчики могут получить последнее событие
 * 4. Неймспейсы: все события в формате `module:action`
 * 5. Отложенная обработка (фаза): batch emit в конце тика
 */
export class TypedEventBus {
  private listeners = new Map<EventName, Set<Subscription<EventName>>>();
  private lastEvents = new Map<EventName, unknown>();
  private replayConfig = new Set<EventName>();
  private pendingEmit: Array<{ event: EventName; payload: unknown }> = [];
  private processing = false;

  /**
   * Подписка на типизированное событие.
   * Возвращает функцию отписки.
   */
  on<E extends EventName>(
    event: E,
    handler: EventHandler<E>,
    options: SubscriptionOptions = {},
  ): () => void {
    const { priority = 100, label = 'anonymous', once = false } = options;

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const sub: Subscription<EventName> = {
      handler: handler as EventHandler<EventName>,
      priority,
      label,
      once,
    };

    this.listeners.get(event)!.add(sub);

    // Event replay: если событие уже происходило и помечено для replay
    if (this.replayConfig.has(event) && this.lastEvents.has(event)) {
      handler(this.lastEvents.get(event) as EventPayload<E>);
    }

    return () => this.off(event, sub);
  }

  /** Одноразовая подписка */
  once<E extends EventName>(
    event: E,
    handler: EventHandler<E>,
    options: Omit<SubscriptionOptions, 'once'> = {},
  ): () => void {
    return this.on(event, handler, { ...options, once: true });
  }

  /** Отписка */
  private off<E extends EventName>(event: E, sub: Subscription<EventName>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(sub);
    }
  }

  /**
   * Синхронная отправка события.
   * Обработчики вызываются в порядке приоритета.
   */
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    // Сохранить последнее событие для replay
    this.lastEvents.set(event, payload);

    const set = this.listeners.get(event);
    if (!set) return;

    // Сортировка по приоритету (детерминизм)
    const sorted = Array.from(set).sort((a, b) => a.priority - b.priority);

    const toRemove: Subscription<EventName>[] = [];

    for (const sub of sorted) {
      try {
        sub.handler(payload);
      } catch (e) {
        console.error(`[EventBus] Ошибка в "${event}" (${sub.label}):`, e);
      }
      if (sub.once) {
        toRemove.push(sub);
      }
    }

    for (const sub of toRemove) {
      set.delete(sub);
    }
  }

  /**
   * Отложенная отправка — событие будет обработано при вызове flush().
   * Используется внутри тика для batch-обработки:
   * модули накапливают события, flush вызывает их в детерминированном порядке.
   */
  defer<E extends EventName>(event: E, payload: EventPayload<E>): void {
    this.pendingEmit.push({ event, payload: payload as unknown });
  }

  /**
   * Обработать все отложенные события.
   * Вызывается GameLoop'ом в конце каждого тика.
   */
  flush(): void {
    if (this.processing) return; // предотвращение рекурсии
    this.processing = true;

    try {
      while (this.pendingEmit.length > 0) {
        // Извлечь всё и обработать пакетно (предотвращает бесконечный цикл)
        const batch = this.pendingEmit.splice(0);
        for (const { event, payload } of batch) {
          this.emit(event as EventName, payload as EventPayload<EventName>);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Включить replay для события.
   * Новые подписчики автоматически получат последнее значение.
   */
  enableReplay<E extends EventName>(event: E): void {
    this.replayConfig.add(event);
  }

  /** Проверить, есть ли подписчики */
  hasListeners<E extends EventName>(event: E): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  /** Очистить все подписки (для тестов и перезагрузки) */
  clear(): void {
    this.listeners.clear();
    this.lastEvents.clear();
    this.pendingEmit = [];
    this.processing = false;
  }
}

/** Глобальная типизированная шина событий игры */
export const gameBus = new TypedEventBus();
```

### 2.3 Приоритеты обработки

Приоритеты определяют порядок вызова обработчиков внутри одного события. Это критично для детерминизма:

| Приоритет | Назначение | Примеры |
|-----------|-----------|---------|
| 0–9 | Ядро (Core) | GameLoop, ModuleRegistry |
| 10–29 | Симуляция | EconomyModule.tick, ShipsModule.tick |
| 30–49 | Реакция на симуляцию | AIModule анализирует результаты тика |
| 50–69 | Вторичные эффекты | DiplomacyModule (реакция на бои) |
| 70–89 | Уведомления | TradeModule (реакция на спрос) |
| 90–99 | UI/Логирование | Отладка, аналитика |

### 2.4 Event Replay (для поздних подписчиков)

Некоторые события должны быть доступны модулям, которые загрузились позже:

```typescript
// При инициализации шины — включить replay для ключевых событий
gameBus.enableReplay('core:tick');
gameBus.enableReplay('core:game-created');
gameBus.enableReplay('economy:planet-colonized');
```

Когда модуль Ships загружается после Economy, он немедленно получит последнее состояние `core:tick` и `economy:planet-colonized`.

---

## 3. Контракт модуля

### 3.1 ModuleManifest

Каждый модуль описывает себя через манифест — это «контракт», который видит реестр модулей:

```typescript
// src/core/module-types.ts

import type { EventName, EventPayload } from './events';
import type { TypedEventBus } from './typed-event-bus';

/** Уникальный идентификатор модуля */
export type ModuleId = 'core' | 'galaxy' | 'economy' | 'ships' | 'fleet' | 'combat' | 'tech' | 'diplomacy' | 'trade' | 'ai';

/** Фаза жизненного цикла модуля */
export type ModulePhase = 'uninitialized' | 'initialized' | 'started' | 'stopped' | 'destroyed';

/** Декларация подписки модуля на событие */
export interface EventSubscription<E extends EventName = EventName> {
  event: E;
  priority?: number;
  /** Если true — отписаться после первого вызова */
  once?: boolean;
}

/** Декларация запроса, который модуль обрабатывает */
export interface QueryDeclaration {
  queryName: string;
  description: string;
  requestType: string;   // имя типа запроса
  responseType: string;  // имя типа ответа
}

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

  /**
   * События, которые этот модуль генерирует (emit).
   * Формат: module:action.
   */
  emits: EventName[];

  /**
   * События, на которые модуль подписывается (on).
   */
  subscribes: EventSubscription[];

  /**
   * Запросы, которые модуль обрабатывает.
   */
  handlesQueries: QueryDeclaration[];

  /**
   * Запросы, которые модуль отправляет другим модулям.
   */
  requiresQueries: QueryDeclaration[];
}

/**
 * Интерфейс игрового модуля.
 * Каждый модуль реализует этот интерфейс.
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
  init(bus: TypedEventBus, registry: ModuleRegistry): void;

  /**
   * Запуск модуля.
   * Модуль готов обрабатывать тики и события.
   */
  start(): void;

  /**
   * Обработка одного игрового тика.
   * Вызывается GameLoop'ом в детерминированном порядке.
   * @param time — текущее игровое время
   */
  tick(time: GameTime): void;

  /**
   * Остановка модуля (пауза).
   * Модуль прекращает обработку тиков, но сохраняет состояние.
   */
  stop(): void;

  /**
   * Уничтожение модуля.
   * Отписка от событий, очистка ресурсов.
   */
  destroy(): void;

  /**
   * Сериализация состояния модуля для сохранения.
   * Возвращает JSON-safe объект.
   */
  serialize(): Record<string, unknown>;

  /**
   * Десериализация состояния модуля из сохранения.
   */
  deserialize(data: Record<string, unknown>): void;
}
```

### 3.2 Жизненный цикл модуля

```
  uninitialized ──init()──▶ initialized ──start()──▶ started
                                                     │  ▲
                                                   tick() │
                                                     │  │
                                                     ▼  │
                                              (обработка тиков)
                                                     │
                                               stop() │
                                                     ▼
                             stopped ──start()──▶ started
                               │
                          destroy()
                               │
                               ▼
                            destroyed
```

Правила переходов:
- `init()` вызывается **ровно один раз**, после разрешения всех зависимостей
- `start()` и `stop()` могут вызываться многократно (пауза/резюме)
- `tick()` вызывается только в состоянии `started`
- `destroy()` необратим — после него модуль нельзя перезапустить
- `serialize()` может вызываться в любом состоянии кроме `destroyed`
- `deserialize()` вызывается в состоянии `initialized` перед `start()`

### 3.3 Пример: EconomyModule (минимальный скелет)

```typescript
// src/economy/economy-module.ts

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, EntityId } from '@/core/types';

export class EconomyModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'economy',
    name: 'Экономика',
    version: '1.0.0',
    description: 'Добыча ресурсов, производство, энергетика, склады',
    dependencies: ['galaxy'],  // нужен доступ к системе/звезде
    emits: [
      'economy:building-constructed',
      'economy:building-upgraded',
      'economy:production-complete',
      'economy:planet-colonized',
      'economy:energy-recalced',
      'economy:resource-depleted',
      'economy:warehouse-full',
      'economy:warehouse-updated',
    ],
    subscribes: [
      { event: 'core:tick', priority: 10 },
      { event: 'economy:build' },
      { event: 'economy:upgrade' },
      { event: 'economy:enqueue' },
      { event: 'economy:colonize' },
    ],
    handlesQueries: [
      { queryName: 'economy:planet-resources', description: 'Ресурсы планеты', requestType: 'EntityId', responseType: 'Record<string, number>' },
      { queryName: 'economy:planet-energy', description: 'Энергобаланс планеты', requestType: 'EntityId', responseType: '{ production: number; consumption: number; balance: number }' },
      { queryName: 'economy:production-queue', description: 'Очередь производства', requestType: 'EntityId', responseType: 'ProductionQueue | null' },
    ],
    requiresQueries: [
      { queryName: 'galaxy:system-by-id', description: 'Получить звёздную систему', requestType: 'EntityId', responseType: 'StarSystem | undefined' },
    ],
  };

  private phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubscribers: Array<() => void> = [];

  get phase() { return this.phase; }

  init(bus: TypedEventBus, registry: ModuleRegistry): void {
    this.bus = bus;
    this.registry = registry;
    this.phase = 'initialized';

    // Подписка на события (в соответствии с манифестом)
    this.unsubscribers.push(
      bus.on('core:tick', (time) => this.onTick(time), { priority: 10, label: 'economy' }),
      bus.on('economy:build', (p) => this.onBuild(p), { label: 'economy' }),
      bus.on('economy:upgrade', (p) => this.onUpgrade(p), { label: 'economy' }),
      bus.on('economy:enqueue', (p) => this.onEnqueue(p), { label: 'economy' }),
      bus.on('economy:colonize', (p) => this.onColonize(p), { label: 'economy' }),
    );

    // Регистрация обработчиков запросов
    registry.registerQuery('economy:planet-resources', (planetId) => this.queryPlanetResources(planetId));
    registry.registerQuery('economy:planet-energy', (planetId) => this.queryPlanetEnergy(planetId));
    registry.registerQuery('economy:production-queue', (planetId) => this.queryProductionQueue(planetId));
  }

  start(): void {
    if (this.phase !== 'initialized' && this.phase !== 'stopped') return;
    this.phase = 'started';
  }

  tick(time: GameTime): void {
    if (this.phase !== 'started') return;
    // processEconomyTick вынесен из store в модуль
  }

  stop(): void {
    if (this.phase !== 'started') return;
    this.phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.phase = 'destroyed';
  }

  serialize(): Record<string, unknown> {
    // Сериализация состояния экономики
    return {};
  }

  deserialize(data: Record<string, unknown>): void {
    // Восстановление состояния
  }

  // ─── Обработчики событий ──────────────────────────────

  private onTick(time: GameTime): void {
    // Делегация в engine, но через шину
  }

  private onBuild(payload: EventPayload<'economy:build'>): void {
    // Логика строительства + emit('economy:building-constructed')
  }

  private onUpgrade(payload: EventPayload<'economy:upgrade'>): void {
    // Логика улучшения + emit('economy:building-upgraded')
  }

  private onEnqueue(payload: EventPayload<'economy:enqueue'>): void {
    // Добавление в очередь
  }

  private onColonize(payload: EventPayload<'economy:colonize'>): void {
    // Колонизация + emit('economy:planet-colonized')
  }

  // ─── Обработчики запросов ─────────────────────────────

  private queryPlanetResources(planetId: EntityId): Record<string, number> | null { return null; }
  private queryPlanetEnergy(planetId: EntityId): { production: number; consumption: number; balance: number } | null { return null; }
  private queryProductionQueue(planetId: EntityId): import('@/core/types').ProductionQueue | null { return null; }
}
```

---

## 4. Реестр модулей

### 4.1 ModuleRegistry

Реестр управляет жизненным циклом всех модулей, разрешает зависимости и определяет порядок инициализации:

```typescript
// src/core/module-registry.ts

import type { IGameModule, ModuleId, ModuleManifest } from './module-types';
import type { TypedEventBus } from './typed-event-bus';

type QueryHandler = (request: unknown) => unknown;

export class ModuleRegistry {
  private modules = new Map<ModuleId, IGameModule>();
  private initOrder: ModuleId[] = [];
  private queryHandlers = new Map<string, QueryHandler>();
  private bus: TypedEventBus;

  constructor(bus: TypedEventBus) {
    this.bus = bus;
  }

  /**
   * Зарегистрировать модуль в реестре.
   * Регистрация возможна в любой момент (горячее подключение).
   */
  register(module: IGameModule): void {
    if (this.modules.has(module.manifest.id)) {
      console.warn(`[Registry] Модуль "${module.manifest.id}" уже зарегистрирован — перезапись`);
    }
    this.modules.set(module.manifest.id, module);
    this.recalculateInitOrder();
  }

  /**
   * Отменить регистрацию модуля.
   */
  unregister(moduleId: ModuleId): void {
    const mod = this.modules.get(moduleId);
    if (mod) {
      mod.destroy();
      this.modules.delete(moduleId);
      this.recalculateInitOrder();
    }
  }

  /**
   * Инициализировать все зарегистрированные модули
   * в порядке разрешения зависимостей.
   */
  initAll(): void {
    for (const moduleId of this.initOrder) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'uninitialized') {
        this.validateDependencies(mod.manifest);
        mod.init(this.bus, this);
      }
    }
  }

  /**
   * Запустить все модули.
   */
  startAll(): void {
    for (const moduleId of this.initOrder) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'initialized' || mod.phase === 'stopped') {
        mod.start();
      }
    }
  }

  /**
   * Остановить все модули (в обратном порядке).
   */
  stopAll(): void {
    for (const moduleId of [...this.initOrder].reverse()) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'started') {
        mod.stop();
      }
    }
  }

  /**
   * Обработать тик для всех модулей в порядке инициализации.
   * Это обеспечивает детерминизм: Economy всегда тикает перед AI.
   */
  tickAll(time: GameTime): void {
    for (const moduleId of this.initOrder) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'started') {
        mod.tick(time);
      }
    }

    // После всех тиков — обработать отложенные события
    this.bus.flush();
  }

  /**
   * Зарегистрировать обработчик запроса.
   */
  registerQuery(queryName: string, handler: QueryHandler): void {
    this.queryHandlers.set(queryName, handler);
  }

  /**
   * Выполнить запрос к другому модулю.
   * Это единственный способ межмодульного доступа к данным.
   */
  query<T = unknown>(queryName: string, request: unknown): T | null {
    const handler = this.queryHandlers.get(queryName);
    if (!handler) {
      console.warn(`[Registry] Запрос "${queryName}" не зарегистрирован`);
      return null;
    }
    return handler(request) as T;
  }

  /**
   * Получить модуль по ID (для внутреннего использования).
   * Внешние модули должны использовать query() вместо прямого доступа.
   */
  getModule(moduleId: ModuleId): IGameModule | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * Сериализовать все модули.
   */
  serializeAll(): Record<string, Record<string, unknown>> {
    const data: Record<string, Record<string, unknown>> = {};
    for (const [id, mod] of this.modules) {
      data[id] = mod.serialize();
    }
    return data;
  }

  /**
   * Пересчитать порядок инициализации на основе зависимостей.
   * Используется топологическая сортировка.
   */
  private recalculateInitOrder(): void {
    const ids = Array.from(this.modules.keys());
    const visited = new Set<ModuleId>();
    const order: ModuleId[] = [];
    const visiting = new Set<ModuleId>();

    const visit = (id: ModuleId) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`[Registry] Циклическая зависимость: ${id}`);
      }

      visiting.add(id);
      const mod = this.modules.get(id);
      if (mod) {
        for (const dep of mod.manifest.dependencies) {
          if (this.modules.has(dep)) {
            visit(dep);
          }
        }
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of ids) {
      visit(id);
    }

    this.initOrder = order;
  }

  /**
   * Проверить, что все зависимости модуля удовлетворены.
   */
  private validateDependencies(manifest: ModuleManifest): void {
    for (const dep of manifest.dependencies) {
      if (!this.modules.has(dep)) {
        throw new Error(
          `[Registry] Модуль "${manifest.id}" требует "${dep}", но тот не зарегистрирован`
        );
      }
      const depModule = this.modules.get(dep)!;
      if (depModule.phase === 'uninitialized') {
        throw new Error(
          `[Registry] Модуль "${manifest.id}" требует "${dep}", но тот ещё не инициализирован`
        );
      }
    }
  }
}
```

### 4.2 Граф зависимостей

Текущие и планируемые зависимости:

```
  core (нет зависимостей)
    │
    ├──▶ galaxy (зависит от: core)
    │       │
    │       └──▶ economy (зависит от: galaxy)
    │               │
    │               ├──▶ ships (зависит от: economy)
    │               │       │
    │               │       ├──▶ fleet (зависит от: ships)
    │               │       │       │
    │               │       │       └──▶ combat (зависит от: fleet)
    │               │       │
    │               │       └──▶ trade (зависит от: ships, economy)
    │               │
    │               └──▶ tech (зависит от: economy)
    │                       │
    │                       └──▶ ai (зависит от: tech, economy, diplomacy)
    │                               │
    │                               └──▶ diplomacy (зависит от: ai)
    │
    └─────────────────────────────────────────────────────────
       Порядок инициализации (топологическая сортировка):
       core → galaxy → economy → ships → fleet → combat
                                → tech → ai → diplomacy
                         ships → trade
```

Порядок инициализации (определяется автоматически топологической сортировкой):

1. `core`
2. `galaxy`
3. `economy`
4. `ships`
5. `fleet`
6. `combat`
7. `tech`
8. `trade`
9. `ai`
10. `diplomacy`

---

## 5. Система запросов

### 5.1 Проблема прямых импортов

В текущем коде `economy/engine.ts` напрямую импортирует данные из `data/warehouse.ts`, `data/buildings.ts` и т.д. Это допустимо для статических данных, но модули не должны напрямую обращаться к состоянию друг друга:

```typescript
// ❌ Плохо: EconomyModule напрямую лезет в GalaxyModule
import { getSystem } from '@/galaxy';
const system = getSystem(planet.systemId);

// ✅ Хорошо: EconomyModule запрашивает данные через Registry
const system = this.registry.query<StarSystem>('galaxy:system-by-id', planet.systemId);
```

### 5.2 Типизированные запросы

```typescript
// src/core/query-types.ts

/**
 * Карта типизированных запросов.
 * Ключ = имя запроса (формат module:what),
 * Request = тип входного параметра,
 * Response = тип возвращаемого значения.
 */
export interface QueryMap {
  // ─── Galaxy ───────────────────────────────────────────────
  'galaxy:system-by-id':       { request: EntityId;      response: StarSystem | undefined };
  'galaxy:planet-by-id':       { request: EntityId;      response: Planet | undefined };
  'galaxy:systems-by-owner':   { request: EntityId;      response: StarSystem[] };
  'galaxy:planets-by-owner':   { request: EntityId;      response: Planet[] };
  'galaxy:colonized-planets':  { request: void;          response: Planet[] };
  'galaxy:jump-points':        { request: EntityId;      response: JumpPoint[] };  // systemId
  'galaxy:distance':           { request: { a: EntityId; b: EntityId }; response: number };

  // ─── Economy ──────────────────────────────────────────────
  'economy:planet-resources':  { request: EntityId;      response: Record<string, number> };
  'economy:planet-energy':     { request: EntityId;      response: { production: number; consumption: number; balance: number } };
  'economy:production-queue':  { request: EntityId;      response: ProductionQueue | null };
  'economy:warehouse-info':    { request: EntityId;      response: PlanetWarehouse | null };
  'economy:building-count':    { request: EntityId;      response: Record<string, number> };

  // ─── Ships ────────────────────────────────────────────────
  'ships:by-owner':            { request: EntityId;      response: Ship[] };
  'ships:by-location':         { request: EntityId;      response: Ship[] };  // systemId
  'ships:by-id':               { request: EntityId;      response: Ship | undefined };
  'ships:design-cost':         { request: string;        response: Record<string, number> | null };

  // ─── Fleet ────────────────────────────────────────────────
  'fleet:by-owner':            { request: EntityId;      response: Fleet[] };
  'fleet:by-location':         { request: EntityId;      response: Fleet[] };
  'fleet:by-id':               { request: EntityId;      response: Fleet | undefined };
  'fleet:military-power':      { request: EntityId;      response: number };

  // ─── Tech ─────────────────────────────────────────────────
  'tech:unlocked':             { request: EntityId;      response: string[] };  // factionId → techIds
  'tech:current-research':     { request: EntityId;      response: { techId: string; progress: number; total: number } | null };

  // ─── Diplomacy ────────────────────────────────────────────
  'diplomacy:relations':       { request: { a: EntityId; b: EntityId }; response: number };  // -100..+100
  'diplomacy:agreements':      { request: EntityId;      response: Array<{ with: EntityId; type: string }> };

  // ─── Trade ────────────────────────────────────────────────
  'trade:offers':              { request: EntityId;      response: TradeOffer[] };  // factionId
  'trade:routes':              { request: EntityId;      response: TradeRoute[] };  // factionId

  // ─── AI ───────────────────────────────────────────────────
  'ai:faction-strategy':       { request: EntityId;      response: string };
  'ai:faction-resources':      { request: EntityId;      response: { surplus: Record<string, number>; deficit: Record<string, number> } };
}

export type QueryName = keyof QueryMap;
export type QueryRequest<Q extends QueryName> = QueryMap[Q]['request'];
export type QueryResponse<Q extends QueryName> = QueryMap[Q]['response'];
```

### 5.3 Типобезопасный метод запроса

Расширяет ModuleRegistry типизированным методом:

```typescript
// Добавление в ModuleRegistry

/**
 * Типобезопасный запрос.
 * Компилятор проверяет соответствие типа запроса и ответа.
 */
queryTyped<Q extends QueryName>(
  queryName: Q,
  request: QueryRequest<Q>,
): QueryResponse<Q> | null {
  const handler = this.queryHandlers.get(queryName);
  if (!handler) return null;
  return handler(request) as QueryResponse<Q>;
}
```

Пример использования в EconomyModule:

```typescript
// EconomyModule нужен доступ к звёздной системе для расчёта энергобаланса
const system = this.registry.queryTyped('galaxy:system-by-id', planet.systemId);
if (system) {
  recalcEnergyBalance(planet, system);
}
```

---

## 6. Архитектура состояния

### 6.1 Разделение монолитного стора

Текущий `game-store.ts` (570+ строк) объединяет:
- Состояние ядра (время, скорость, фаза)
- Навигацию (view, selectedSystemId, selectedPlanetId)
- Экономику (build, upgrade, enqueue, colonize)
- Склад (role, reserves, specialization, orbit)
- Сохранение/загрузку
- Утилиты (getSystem, getPlanet)

Целевая структура — **один стор на модуль** + **общий UI-стор**:

```
stores/
├── core-store.ts         # Время, скорость, фаза, инициализация
├── ui-store.ts           # Навигация, выделение, модальные окна
├── galaxy-store.ts       # Галактика, системы, планеты
├── economy-store.ts      # Ресурсы, здания, очереди, склады
├── ships-store.ts        # Корабли, дизайны
├── fleet-store.ts        # Флоты, приказы
├── combat-store.ts       # Активные бои, история
├── tech-store.ts         # Исследования, технологии
├── diplomacy-store.ts    # Отношения, соглашения
├── trade-store.ts        # Предложения, маршруты
├── ai-store.ts           # Состояние AI-фракций
└── save-store.ts         # Сохранение/загрузка (кросс-модульный)
```

### 6.2 Структура модульного стора

```typescript
// src/stores/economy-store.ts (пример)

import { create } from 'zustand';
import type { EntityId, ProductionQueue, PlanetWarehouse, Planet } from '@/core/types';

/**
 * Состояние модуля экономики.
 * Принадлежит исключительно EconomyModule.
 */
export interface EconomyState {
  /** Очереди производства по planetId */
  productionQueues: Map<EntityId, ProductionQueue>;

  /** Кэш энергобалансов (пересчитывается каждый тик) */
  energyBalances: Map<EntityId, { production: number; consumption: number; balance: number }>;

  /** Последний тик обработки экономики */
  lastProcessedTick: number;
}

export interface EconomyActions {
  /** Обновить очередь производства */
  setProductionQueue: (planetId: EntityId, queue: ProductionQueue) => void;

  /** Обновить энергобаланс планеты */
  setEnergyBalance: (planetId: EntityId, balance: { production: number; consumption: number; balance: number }) => void;

  /** Отметить тик как обработанный */
  setLastProcessedTick: (tick: number) => void;

  /** Сбросить состояние (новая игра) */
  reset: () => void;

  /** Сериализация для сохранения */
  serialize: () => Record<string, unknown>;

  /** Десериализация из сохранения */
  deserialize: (data: Record<string, unknown>) => void;
}

const initialState: EconomyState = {
  productionQueues: new Map(),
  energyBalances: new Map(),
  lastProcessedTick: 0,
};

export const useEconomyStore = create<EconomyState & EconomyActions>()((set, get) => ({
  ...initialState,

  setProductionQueue: (planetId, queue) =>
    set((s) => {
      const next = new Map(s.productionQueues);
      next.set(planetId, queue);
      return { productionQueues: next };
    }),

  setEnergyBalance: (planetId, balance) =>
    set((s) => {
      const next = new Map(s.energyBalances);
      next.set(planetId, balance);
      return { energyBalances: next };
    }),

  setLastProcessedTick: (tick) => set({ lastProcessedTick: tick }),

  reset: () => set(initialState),

  serialize: () => {
    const { productionQueues, lastProcessedTick } = get();
    return {
      productionQueues: Array.from(productionQueues.entries()),
      lastProcessedTick,
    };
  },

  deserialize: (data) => {
    set({
      productionQueues: new Map(data.productionQueues as [EntityId, ProductionQueue][]),
      energyBalances: new Map(),
      lastProcessedTick: (data.lastProcessedTick as number) ?? 0,
    });
  },
}));
```

### 6.3 Границы чтения/записи

Ключевой принцип: **модуль пишет только в свой стор, читает любой**.

```
              Пишет                    Читает
              ──────                   ──────
EconomyModule  →  economyStore    ←  economyStore, galaxyStore
GalaxyModule   →  galaxyStore     ←  galaxyStore
ShipsModule    →  shipsStore      ←  shipsStore, economyStore, galaxyStore
AIModule       →  aiStore         ←  aiStore, economyStore, galaxyStore, diplomacyStore
```

Для записи в чужой стор модуль использует шину событий:

```typescript
// EconomyModule хочет обновить discovered-статус системы
// ❌ Плохо: напрямую писать в galaxyStore
useGalaxyStore.getState().setSystemDiscovered(systemId);

// ✅ Хорошо: через шину
this.bus.emit('galaxy:system-discovered', { systemId, byFactionId });
// GalaxyModule подпишется и обновит свой стор
```

### 6.4 Важное замечание о мутациях Planet

В текущей архитектуре `Planet` — изменяемый объект, лежащий внутри `Galaxy.systems[].planets[]`. Economy engine напрямую мутирует `planet.resources`, `planet.energyBalance` и т.д.

В целевой архитектуре:
1. **Краткосрочно (фаза миграции):** допускаются прямые мутации Planet внутри EconomyModule, т.к. EconomyModule «владеет» данными экономики планеты
2. **Долгосрочно:** данные экономики планеты переезжают в `economyStore`, а Planet в `galaxyStore` становится иммутабельным справочником (только тип, размер, атмосфера, deposits)

Это разделение описано в стратегии миграции (§9).

---

## 7. Интеграция игрового цикла

### 7.1 Проблема текущего GameLoop

Существующий `GameLoop` (в `src/core/game-loop.ts`) отключён — реальный цикл работает через `useEffect`/`setInterval` в `page.tsx`:

```typescript
// page.tsx — текущий (плохо)
useEffect(() => {
  if (!gameState || gameState.phase !== 'playing' || gameState.speed === 0) return;
  const interval = setInterval(() => { tick(); }, 200);
  return () => clearInterval(interval);
}, [gameState?.phase, gameState?.speed, tick]);
```

Проблемы:
- Игровая логика привязана к React-рендерингу
- Невозможно запустить симуляцию без UI (headless-тесты, сервер)
- `tick()` в сторе делает слишком много (время + экономика + ре-рендер)

### 7.2 Целевой GameLoop

```typescript
// src/core/game-loop.ts (переработанный)

import { gameBus } from './typed-event-bus';
import { ModuleRegistry } from './module-registry';
import type { GameTime, GameSpeed, GamePhase } from './types';

export class GameLoop {
  private time: GameTime;
  private speed: GameSpeed = 1;
  private phase: GamePhase = 'paused';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private registry: ModuleRegistry;

  constructor(registry: ModuleRegistry) {
    this.time = { tick: 0, dayInYear: 0, year: 1 };
    this.registry = registry;
  }

  getTime(): GameTime { return { ...this.time }; }
  getSpeed(): GameSpeed { return this.speed; }
  getPhase(): GamePhase { return this.phase; }

  setSpeed(speed: GameSpeed): void {
    this.speed = speed;
    if (this.phase === 'playing') {
      this.stopInterval();
      if (speed > 0) {
        this.startInterval();
      } else {
        this.phase = 'paused';
      }
    }
    gameBus.emit('core:speed-changed', speed);
  }

  start(): void {
    if (this.phase === 'playing') return;
    this.phase = 'playing';
    this.registry.startAll();
    if (this.speed > 0) {
      this.startInterval();
    }
    gameBus.emit('core:started', undefined);
  }

  pause(): void {
    if (this.phase === 'paused') return;
    this.phase = 'paused';
    this.stopInterval();
    this.registry.stopAll();
    gameBus.emit('core:paused', undefined);
  }

  toggle(): void {
    if (this.phase === 'playing') {
      this.pause();
    } else {
      this.start();
    }
  }

  /** Один ручной тик (для отладки и пошагового режима) */
  step(): void {
    this.processTick();
  }

  /** Установить время (для загрузки сохранения) */
  setTime(time: GameTime): void {
    this.time = { ...time };
  }

  destroy(): void {
    this.stopInterval();
    this.registry.stopAll();
    this.phase = 'paused';
  }

  // ─── Приватные методы ─────────────────────────────────

  private startInterval(): void {
    this.stopInterval();
    const ms = 200;
    this.intervalId = setInterval(() => {
      for (let i = 0; i < this.speed; i++) {
        this.processTick();
      }
    }, ms);
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Обработать один игровой день.
   *
   * Порядок:
   * 1. Обновить время
   * 2. Emit 'core:tick' (модули обрабатывают в порядке приоритетов)
   * 3. Registry.tickAll() — детерминированный порядок модулей
   * 4. Bus.flush() — отложенные события
   * 5. Ежегодное событие
   */
  private processTick(): void {
    // 1. Обновить время
    this.time.tick++;
    this.time.dayInYear = this.time.tick % 365;
    this.time.year = Math.floor(this.time.tick / 365) + 1;

    // 2. Отправить тик через шину (модули подписаны с приоритетами)
    gameBus.emit('core:tick', this.time);

    // 3. Вызвать tick() каждого модуля в детерминированном порядке
    this.registry.tickAll(this.time);

    // 4. flush() уже вызван внутри registry.tickAll(), но для страховки:
    // (flush внутри tickAll уже обработал отложенные события)

    // 5. Ежегодное событие
    if (this.time.dayInYear === 0 && this.time.tick > 0) {
      gameBus.emit('core:year', this.time);
    }
  }
}
```

### 7.3 Подключение к React

GameLoop теперь — единственный владелец игрового времени. React-компоненты подписываются на стор:

```typescript
// src/app/page.tsx (целевой)

'use client';

import { useEffect, useRef } from 'react';
import { useCoreStore } from '@/stores/core-store';
import { GameLoop } from '@/core/game-loop';
import { gameBus } from '@/core/typed-event-bus';
import { ModuleRegistry } from '@/core/module-registry';

// Глобальный экземпляр (создаётся один раз)
let gameLoop: GameLoop | null = null;

export default function Home() {
  const phase = useCoreStore((s) => s.phase);
  const speed = useCoreStore((s) => s.speed);
  const isInitialized = useCoreStore((s) => s.isInitialized);

  // Инициализация GameLoop (один раз)
  useEffect(() => {
    if (!gameLoop) {
      const registry = new ModuleRegistry(gameBus);
      // Регистрация модулей...
      // registry.register(new GalaxyModule());
      // registry.register(new EconomyModule());
      registry.initAll();

      gameLoop = new GameLoop(registry);
    }
    return () => {
      gameLoop?.destroy();
    };
  }, []);

  // UI рендеринг зависит только от сторов
  if (!isInitialized) {
    return <MainMenu />;
  }

  return <GameLayout />;
}
```

---

## 8. Каталог типизированных событий

### 8.1 Модуль Core

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `core:tick` | `GameTime` | GameLoop | Все модули (priority: 0–99) | Игровой тик (1 день) |
| `core:year` | `GameTime` | GameLoop | Economy, AI, Diplomacy | Новый год |
| `core:started` | `void` | GameLoop | UI | Игра запущена |
| `core:paused` | `void` | GameLoop | UI | Игра на паузе |
| `core:speed-changed` | `GameSpeed` | GameLoop | UI | Изменена скорость |
| `core:game-created` | `{ galaxyId, seed }` | CoreModule | Galaxy, UI | Новая игра |
| `core:game-loaded` | `{ saveId }` | CoreModule | Все модули | Загружено сохранение |

### 8.2 Модуль Galaxy

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `galaxy:generated` | `{ galaxyId, systemCount, seed }` | GalaxyModule | Core, UI | Галактика сгенерирована |
| `galaxy:system-discovered` | `{ systemId, byFactionId }` | GalaxyModule | Economy, AI, Diplomacy | Система обнаружена |
| `galaxy:system-surveyed` | `{ systemId, byFactionId }` | GalaxyModule | Economy, Ships | Полное обследование |

### 8.3 Модуль Economy

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `economy:build` | `{ planetId, hexIndex, buildingId }` | UI → Bus | EconomyModule | Команда: построить здание |
| `economy:building-constructed` | `{ planetId, hexIndex, buildingId }` | EconomyModule | AI, UI | Здание построено |
| `economy:upgrade` | `{ planetId, hexIndex }` | UI → Bus | EconomyModule | Команда: улучшить здание |
| `economy:building-upgraded` | `{ planetId, hexIndex, level }` | EconomyModule | AI, UI | Здание улучшено |
| `economy:enqueue` | `{ planetId, recipeId, repeat }` | UI → Bus | EconomyModule | Команда: добавить в очередь |
| `economy:production-complete` | `{ planetId, recipeId }` | EconomyModule | AI, Ships, UI | Производство завершено |
| `economy:colonize` | `{ planetId }` | UI → Bus | EconomyModule | Команда: колонизировать |
| `economy:planet-colonized` | `{ planetId, hexIndex }` | EconomyModule | Galaxy, AI, Diplomacy, UI | Планета колонизирована |
| `economy:energy-recalced` | `{ planetId, balance }` | EconomyModule | UI | Пересчитан энергобаланс |
| `economy:resource-depleted` | `{ planetId, elementId, hexIndex }` | EconomyModule | AI, UI | Залежь исчерпана |
| `economy:warehouse-full` | `{ planetId }` | EconomyModule | AI, Trade | Склад заполнен |
| `economy:warehouse-updated` | `{ planetId, capacity, used }` | EconomyModule | UI | Обновлён склад |

### 8.4 Модуль Ships

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `ships:designed` | `{ designId, hullId, moduleCount }` | ShipsModule | UI | Создан дизайн корабля |
| `ships:constructed` | `{ shipId, designId, owner }` | ShipsModule | Fleet, AI, UI | Корабль построен |
| `ships:destroyed` | `{ shipId, systemId, byFactionId? }` | ShipsModule | Fleet, AI, Diplomacy | Корабль уничтожен |
| `ships:movement-started` | `{ shipId, from, to, etaTick }` | ShipsModule | AI, Diplomacy | Корабль начал движение |
| `ships:arrived` | `{ shipId, systemId }` | ShipsModule | Fleet, AI, Diplomacy | Корабль прибыл |
| `ships:damaged` | `{ shipId, hp, maxHp }` | ShipsModule | AI, UI | Корабль повреждён |
| `ships:repaired` | `{ shipId, hp }` | ShipsModule | AI, UI | Корабль отремонтирован |

### 8.5 Модуль Fleet

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `fleet:created` | `{ fleetId, owner, shipCount }` | FleetModule | AI, UI | Флот создан |
| `fleet:order-issued` | `{ fleetId, orderType, targetId }` | FleetModule | AI, UI | Приказ флоту |
| `fleet:order-completed` | `{ fleetId, orderType, targetId }` | FleetModule | AI, Diplomacy | Приказ выполнен |
| `fleet:merged` | `{ fleetId, fromFleetIds }` | FleetModule | UI | Флоты объединены |
| `fleet:split` | `{ fleetId, newFleetId }` | FleetModule | UI | Флот разделён |

### 8.6 Модуль Combat

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `combat:engaged` | `{ systemId, attackerFactionId, defenderFactionId }` | CombatModule | Diplomacy, AI, UI | Бой начался |
| `combat:round` | `{ systemId, round, attackerDmg, defenderDmg }` | CombatModule | UI | Раунд боя |
| `combat:resolved` | `{ systemId, winnerFactionId, losses }` | CombatModule | Diplomacy, AI, Fleet, UI | Бой завершён |
| `combat:planet-bombarded` | `{ planetId, damage, buildingsDestroyed }` | CombatModule | Economy, AI, UI | Планета обстреляна |

### 8.7 Модуль Tech

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `tech:research-started` | `{ techId, factionId, etaTick }` | TechModule | AI, UI | Начато исследование |
| `tech:research-completed` | `{ techId, factionId }` | TechModule | Ships, Economy, AI | Исследование завершено |
| `tech:unlocked` | `{ techId, factionId, unlocks }` | TechModule | Ships, Economy, AI | Разблокированы технологии |

### 8.8 Модуль Diplomacy

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `diplomacy:proposal` | `{ fromFactionId, toFactionId, type }` | DiplomacyModule | AI, UI | Дипломатическое предложение |
| `diplomacy:accepted` | `{ fromFactionId, toFactionId, type }` | DiplomacyModule | Trade, AI, UI | Предложение принято |
| `diplomacy:rejected` | `{ fromFactionId, toFactionId, type }` | DiplomacyModule | AI, UI | Предложение отклонено |
| `diplomacy:relations-changed` | `{ factionA, factionB, delta, newScore }` | DiplomacyModule | AI, Trade, UI | Изменены отношения |
| `diplomacy:war-declared` | `{ attackerFactionId, defenderFactionId }` | DiplomacyModule | Combat, AI, Fleet, UI | Объявлена война |
| `diplomacy:peace-signed` | `{ factionA, factionB }` | DiplomacyModule | Combat, Trade, AI, UI | Подписан мир |

### 8.9 Модуль Trade

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `trade:offer-created` | `{ offerId, factionId, resourceId, amount, price }` | TradeModule | AI, UI | Создано торговое предложение |
| `trade:offer-accepted` | `{ offerId, buyerFactionId }` | TradeModule | Economy, AI, UI | Предложение принято |
| `trade:route-established` | `{ routeId, fromPlanetId, toPlanetId, resourceId }` | TradeModule | Ships, AI, UI | Торговый маршрут |
| `trade:route-completed` | `{ routeId, delivered }` | TradeModule | Economy, AI | Доставка завершена |
| `trade:route-raided` | `{ routeId, raiderFactionId, stolen }` | TradeModule | Diplomacy, AI, UI | Маршрут ограблен |

### 8.10 Модуль AI

| Событие | Payload | Кто эмитит | Кто слушает | Описание |
|---------|---------|-----------|-------------|----------|
| `ai:decision` | `{ factionId, action, targetId? }` | AIModule | UI (лог), Diplomacy | Решение AI |
| `ai:colony-founded` | `{ factionId, planetId }` | AIModule | Galaxy, Economy, UI | AI основал колонию |
| `ai:fleet-sent` | `{ factionId, fleetId, purpose }` | AIModule | Diplomacy, UI | AI отправил флот |

---

## 9. Стратегия миграции

Миграция проводится **постепенно**, каждый шаг — рабочий код, который можно деплоить.

### Фаза 0: Подготовка (1–2 дня)

**Цель:** Создать инфраструктуру без изменения текущего поведения.

1. Создать `src/core/events.ts` — карта типизированных событий (только `core:*` и `economy:*` пока)
2. Создать `src/core/typed-event-bus.ts` — новая шина с поддержкой старых строковых событий
3. Создать `src/core/module-types.ts` — интерфейсы `IGameModule`, `ModuleManifest`
4. Создать `src/core/module-registry.ts` — реестр модулей
5. Создать `src/core/query-types.ts` — карта запросов

**Адаптер обратной совместимости:**

```typescript
// src/core/event-bus.ts — временный адаптер
// Старый код продолжает использовать gameBus.emit('tick', ...)
// Адаптер маппит старые имена на новые

import { gameBus as newBus } from './typed-event-bus';

/** Маппинг старых имён событий на новые */
const LEGACY_EVENT_MAP: Record<string, string> = {
  'tick': 'core:tick',
  'year': 'core:year',
  'game:started': 'core:started',
  'game:paused': 'core:paused',
  'speed:changed': 'core:speed-changed',
  'building:constructed': 'economy:building-constructed',
  'building:upgraded': 'economy:building-upgraded',
  'production:complete': 'economy:production-complete',
  'planet:colonized': 'economy:planet-colonized',
};

/** @deprecated Используйте типизированную шину */
export class EventBus {
  on<T>(event: string, listener: (data: T) => void): () => void {
    const newEvent = LEGACY_EVENT_MAP[event] ?? event;
    return newBus.on(newEvent as any, listener as any);
  }

  once<T>(event: string, listener: (data: T) => void): () => void {
    const newEvent = LEGACY_EVENT_MAP[event] ?? event;
    return newBus.once(newEvent as any, listener as any);
  }

  off<T>(event: string, listener: (data: T) => void): void {
    const newEvent = LEGACY_EVENT_MAP[event] ?? event;
    // newBus не имеет public off — используем unsubscribe-функцию
    // Это ограничение адаптера; для полной отписки нужен рефакторинг подписок
  }

  emit<T>(event: string, data?: T): void {
    const newEvent = LEGACY_EVENT_MAP[event] ?? event;
    newBus.emit(newEvent as any, data as any);
  }

  clear(): void {
    newBus.clear();
  }
}

export const gameBus = new EventBus();
```

### Фаза 1: CoreModule + GalaxyModule (2–3 дня)

**Цель:** Выделить ядро и галактику в модули, подключить GameLoop.

1. Создать `src/modules/core/core-module.ts`
   - Отвечает за: время, скорость, фазу
   - Перенести `newGame()`, `loadGame()` из `game-store.ts`
2. Создать `src/modules/galaxy/galaxy-module.ts`
   - Отвечает за: генерацию галактики, доступ к системам/планетам
   - Перенести `generateGalaxy()` вызов
3. Создать `src/stores/core-store.ts`
   - `time`, `speed`, `phase`, `isInitialized`
4. Создать `src/stores/galaxy-store.ts`
   - `galaxy`, `systems`, `systemMap`
5. Переподключить `GameLoop` к `ModuleRegistry` вместо `useEffect`
6. Обновить `page.tsx` — использовать `GameLoop` вместо `setInterval`

**Критерий успеха:** Игра работает как раньше, но GameLoop подключён через Registry.

### Фаза 2: EconomyModule (3–5 дней)

**Цель:** Выделить экономику в модуль, отделить состояние от действий.

1. Создать `src/modules/economy/economy-module.ts`
   - Перенести логику из `economy/engine.ts` + часть `game-store.ts`
   - Подписаться на `core:tick`, `economy:build`, `economy:colonize` и т.д.
   - Эмитить `economy:building-constructed`, `economy:production-complete` и т.д.
2. Создать `src/stores/economy-store.ts`
   - `productionQueues`, `energyBalances`
3. Создать `src/stores/ui-store.ts`
   - `view`, `selectedSystemId`, `selectedPlanetId`
4. Обновить UI-компоненты — читать из соответствующих сторов
5. Регистрация запросов:
   - `galaxy:system-by-id`, `galaxy:planet-by-id`
   - `economy:planet-resources`, `economy:planet-energy`

**Критерий успеха:** Экономика работает через шину, `game-store.ts` уменьшен вдвое.

### Фаза 3: UI-мост (2–3 дня)

**Цель:** UI отправляет команды через шину, а не вызывает методы стора напрямую.

1. Создать хуки-обёртки:
   ```typescript
   // src/hooks/use-economy-actions.ts
   export function useEconomyActions() {
     const bus = useGameBus();
     return {
       buildOnHex: (planetId, hexIndex, buildingId) =>
         bus.emit('economy:build', { planetId, hexIndex, buildingId }),
       upgradeBuilding: (planetId, hexIndex) =>
         bus.emit('economy:upgrade', { planetId, hexIndex }),
       enqueueProduction: (planetId, recipeId, repeat) =>
         bus.emit('economy:enqueue', { planetId, recipeId, repeat }),
       colonizePlanet: (planetId) =>
         bus.emit('economy:colonize', { planetId }),
     };
   }
   ```
2. Обновить компоненты `planet-view.tsx`, `building-dialog.tsx` — использовать хуки
3. Удалить экономические actions из `game-store.ts`

**Критерий успеха:** UI полностью работает через шину событий.

### Фаза 4: ShipsModule + FleetModule (5–7 дней)

**Цель:** Добавить модули кораблей и флотов.

1. Создать `src/modules/ships/ships-module.ts`
   - Дизайн кораблей, строительство, перемещение
2. Создать `src/modules/fleet/fleet-module.ts`
   - Группировка кораблей, приказы, маршруты
3. Создать `src/stores/ships-store.ts`, `src/stores/fleet-store.ts`
4. Зарегистрировать новые события и запросы
5. Обновить UI — панель флота

**Критерий успеха:** Корабли и флоты работают через модульную архитектуру.

### Фаза 5: CombatModule + TechModule (5–7 дней)

1. Создать `src/modules/combat/combat-module.ts`
2. Создать `src/modules/tech/tech-module.ts`
3. Создать соответствующие сторы
4. Связать Combat с Fleet и Ships через шину
5. Связать Tech с Economy через шину

### Фаза 6: AIModule + DiplomacyModule + TradeModule (7–10 дней)

1. Создать `src/modules/ai/ai-module.ts`
2. Создать `src/modules/diplomacy/diplomacy-module.ts`
3. Создать `src/modules/trade/trade-module.ts`
4. Соответствующие сторы
5. Связать AI со всеми модулями через шину и запросы

### Фаза 7: Очистка (2–3 дня)

1. Удалить `src/core/event-bus.ts` (старая шина)
2. Удалить `src/stores/game-store.ts` (монолитный стор)
3. Переместить сериализацию/десериализацию в `save-store.ts`
4. Финальная проверка типов и тесты

---

## 10. Шаблон нового модуля

### 10.1 Структура файлов

При добавлении нового модуля создайте следующую структуру:

```
src/
├── modules/
│   └── my-module/
│       ├── my-module.ts          # Класс модуля (IGameModule)
│       ├── engine.ts             # Игровая логика (чистые функции)
│       ├── types.ts              # Локальные типы модуля
│       └── index.ts              # Публичный экспорт
├── stores/
│   └── my-module-store.ts        # Zustand-стор модуля
└── hooks/
    └── use-my-module-actions.ts  # React-хуки для UI
```

### 10.2 Код шаблона

```typescript
// src/modules/my-module/my-module.ts

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime } from '@/core/types';

/**
 * Шаблон игрового модуля.
 * Скопируйте этот файл и замените my-module на имя вашего модуля.
 */
export class MyModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'myModule',              // Уникальный ModuleId — добавить в тип
    name: 'Мой модуль',
    version: '0.1.0',
    description: 'Описание модуля',
    dependencies: [],             // Модули, которые будут инициализированы раньше
    emits: [],                    // Добавить в EventMap
    subscribes: [],               // События, на которые подписывается
    handlesQueries: [],           // Запросы, которые обрабатывает
    requiresQueries: [],          // Запросы, которые отправляет
  };

  private _phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubs: Array<() => void> = [];

  get phase(): ModulePhase { return this._phase; }

  init(bus: TypedEventBus, registry: ModuleRegistry): void {
    this.bus = bus;
    this.registry = registry;
    this._phase = 'initialized';

    // ─── Подписка на события ─────────────────────────────
    this.unsubs.push(
      // bus.on('core:tick', (time) => this.onTick(time), { priority: 50, label: 'myModule' }),
    );

    // ─── Регистрация запросов ────────────────────────────
    // registry.registerQuery('myModule:data', (req) => this.queryData(req));
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  tick(time: GameTime): void {
    if (this._phase !== 'started') return;
    // Логика тика модуля
  }

  stop(): void {
    if (this._phase !== 'started') return;
    this._phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this._phase = 'destroyed';
  }

  serialize(): Record<string, unknown> {
    return {};
  }

  deserialize(data: Record<string, unknown>): void {
    // Восстановление состояния из data
  }
}
```

### 10.3 Чеклист добавления нового модуля

1. **Типы:**
   - [ ] Добавить `ModuleId` в тип `ModuleId` (в `module-types.ts`)
   - [ ] Добавить события модуля в `EventMap` (в `events.ts`)
   - [ ] Добавить запросы модуля в `QueryMap` (в `query-types.ts`)

2. **Код:**
   - [ ] Создать класс модуля (`src/modules/my-module/my-module.ts`)
   - [ ] Создать Zustand-стор (`src/stores/my-module-store.ts`)
   - [ ] Создать React-хуки (`src/hooks/use-my-module-actions.ts`)
   - [ ] Создать `index.ts` с публичным экспортом

3. **Интеграция:**
   - [ ] Зарегистрировать модуль в точке входа (`page.tsx` или `game-init.ts`)
   - [ ] Убедиться, что `ModuleRegistry.recalculateInitOrder()` корректно сортирует
   - [ ] Проверить, что все зависимости удовлетворены

4. **UI:**
   - [ ] Создать или обновить компоненты для отображения данных модуля
   - [ ] Использовать хуки для отправки команд через шину

5. **Сохранение:**
   - [ ] Реализовать `serialize()` / `deserialize()`
   - [ ] Обновить `save-store.ts` для включения данных нового модуля

6. **Тесты:**
   - [ ] Unit-тесты логики модуля (без шины)
   - [ ] Интеграционные тесты через шину
   - [ ] Тест сериализации/десериализации

---

## Приложение A: Целевая структура проекта

```
src/
├── core/                           # Ядро (без зависимостей от модулей)
│   ├── types.ts                    # Общие типы данных
│   ├── prng.ts                     # PRNG (xoshiro256**)
│   ├── events.ts                   # EventMap — карта типизированных событий
│   ├── query-types.ts              # QueryMap — карта типизированных запросов
│   ├── typed-event-bus.ts          # Типизированная шина событий
│   ├── module-types.ts             # IGameModule, ModuleManifest и др.
│   ├── module-registry.ts          # Реестр модулей
│   └── game-loop.ts                # Игровой цикл (подключён к Registry)
│
├── modules/                        # Игровые модули
│   ├── core/
│   │   ├── core-module.ts          # Время, скорость, фаза
│   │   └── index.ts
│   ├── galaxy/
│   │   ├── galaxy-module.ts        # Генерация, системы, планеты
│   │   ├── generator.ts            # Генератор галактики
│   │   ├── gen-context.ts          # Контекст генерации
│   │   ├── generate-*.ts           # Подгенераторы
│   │   ├── hex-grid.ts             # Гекс-сетка
│   │   └── index.ts
│   ├── economy/
│   │   ├── economy-module.ts       # Модуль экономики
│   │   ├── engine.ts               # Движок экономики (чистые функции)
│   │   └── index.ts
│   ├── ships/
│   │   ├── ships-module.ts         # Модуль кораблей
│   │   ├── designer.ts             # Конструктор кораблей
│   │   ├── movement.ts             # Движение и навигация
│   │   └── index.ts
│   ├── fleet/
│   │   ├── fleet-module.ts         # Модуль флотов
│   │   ├── orders.ts               # Система приказов
│   │   └── index.ts
│   ├── combat/
│   │   ├── combat-module.ts        # Модуль боя
│   │   ├── resolver.ts             # Расчёт боя
│   │   └── index.ts
│   ├── tech/
│   │   ├── tech-module.ts          # Модуль исследований
│   │   ├── tech-tree.ts            # Дерево технологий
│   │   └── index.ts
│   ├── diplomacy/
│   │   ├── diplomacy-module.ts     # Модуль дипломатии
│   │   ├── relations.ts            # Расчёт отношений
│   │   └── index.ts
│   ├── trade/
│   │   ├── trade-module.ts         # Модуль торговли
│   │   ├── market.ts               # Рынок и цены
│   │   ├── routes.ts               # Торговые маршруты
│   │   └── index.ts
│   └── ai/
│       ├── ai-module.ts            # Модуль AI
│       ├── strategy.ts             # Стратегии фракций
│       ├── planner.ts              # Планировщик действий
│       └── index.ts
│
├── data/                           # Статические данные (без логики)
│   ├── elements.ts                 # Химические элементы
│   ├── buildings.ts                # Здания
│   ├── recipes.ts                  # Рецепты
│   ├── star-types.ts               # Типы звёзд
│   ├── planet-types.ts             # Типы планет
│   ├── chemistry-generator.ts      # Генератор химии
│   ├── baked-lookups.ts            # Запечённые структуры
│   ├── processing-chains.ts        # Цепочки переработки
│   └── warehouse.ts                # Конфигурация складов
│
├── stores/                         # Zustand-сторы (по одному на модуль)
│   ├── core-store.ts               # Время, скорость, фаза
│   ├── ui-store.ts                 # Навигация, выделение
│   ├── galaxy-store.ts             # Галактика
│   ├── economy-store.ts            # Экономика
│   ├── ships-store.ts              # Корабли
│   ├── fleet-store.ts              # Флоты
│   ├── combat-store.ts             # Бой
│   ├── tech-store.ts               # Технологии
│   ├── diplomacy-store.ts          # Дипломатия
│   ├── trade-store.ts              # Торговля
│   ├── ai-store.ts                 # AI
│   └── save-store.ts               # Сохранение/загрузка
│
├── hooks/                          # React-хуки
│   ├── use-core-actions.ts
│   ├── use-economy-actions.ts
│   ├── use-ships-actions.ts
│   ├── use-fleet-actions.ts
│   └── ...
│
├── components/                     # React-компоненты UI
│   ├── game/
│   │   ├── game-layout.tsx
│   │   ├── galaxy-map.tsx
│   │   ├── system-view.tsx
│   │   ├── planet-view.tsx
│   │   ├── building-dialog.tsx
│   │   ├── resource-panel.tsx
│   │   ├── time-controls.tsx
│   │   ├── fleet-panel.tsx         # (новый)
│   │   ├── combat-view.tsx         # (новый)
│   │   ├── tech-tree-view.tsx      # (новый)
│   │   ├── diplomacy-screen.tsx    # (новый)
│   │   └── trade-panel.tsx         # (новый)
│   └── ui/                         # shadcn/ui
│
├── app/                            # Next.js App Router
│   ├── page.tsx                    # Главная (меню + GameLoop init)
│   ├── layout.tsx
│   └── api/save/                   # API сохранений
│
└── lib/                            # Утилиты
    ├── db.ts
    └── utils.ts
```

---

## Приложение B: Сводка ключевых интерфейсов

```typescript
// ─── Шина событий ───────────────────────────────────────
interface EventMap { /* module:action → Payload */ }
class TypedEventBus {
  on<E>(event: E, handler: EventHandler<E>, options?): Unsubscribe;
  once<E>(event: E, handler: EventHandler<E>, options?): Unsubscribe;
  emit<E>(event: E, payload: EventPayload<E>): void;
  defer<E>(event: E, payload: EventPayload<E>): void;
  flush(): void;
  enableReplay<E>(event: E): void;
}

// ─── Модуль ─────────────────────────────────────────────
interface ModuleManifest {
  id: ModuleId;
  name: string;
  version: string;
  description: string;
  dependencies: ModuleId[];
  emits: EventName[];
  subscribes: EventSubscription[];
  handlesQueries: QueryDeclaration[];
  requiresQueries: QueryDeclaration[];
}

interface IGameModule {
  readonly manifest: ModuleManifest;
  readonly phase: ModulePhase;
  init(bus: TypedEventBus, registry: ModuleRegistry): void;
  start(): void;
  tick(time: GameTime): void;
  stop(): void;
  destroy(): void;
  serialize(): Record<string, unknown>;
  deserialize(data: Record<string, unknown>): void;
}

// ─── Реестр модулей ─────────────────────────────────────
class ModuleRegistry {
  register(module: IGameModule): void;
  unregister(moduleId: ModuleId): void;
  initAll(): void;
  startAll(): void;
  stopAll(): void;
  tickAll(time: GameTime): void;
  registerQuery(queryName: string, handler: QueryHandler): void;
  query<T>(queryName: string, request: unknown): T | null;
  queryTyped<Q>(queryName: Q, request: QueryRequest<Q>): QueryResponse<Q> | null;
  serializeAll(): Record<string, Record<string, unknown>>;
}

// ─── Запросы ────────────────────────────────────────────
interface QueryMap { /* module:what → { request, response } */ }

// ─── Игровой цикл ───────────────────────────────────────
class GameLoop {
  constructor(registry: ModuleRegistry);
  start(): void;
  pause(): void;
  toggle(): void;
  step(): void;
  setSpeed(speed: GameSpeed): void;
  setTime(time: GameTime): void;
  destroy(): void;
}
```

---

*Документ создан 2026-03-05. Согласовано с текущим состоянием кодовой базы: `src/core/event-bus.ts` (нетипизированная шина), `src/stores/game-store.ts` (монолит 570+ строк), `src/economy/engine.ts` (580 строк прямых мутаций), `src/core/game-loop.ts` (отключён).*
