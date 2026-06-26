/**
 * Типизированная шина событий.
 *
 * Ключевые отличия от старой EventBus:
 * 1. Типобезопасность: имена событий и payload проверяются компилятором
 * 2. Приоритеты: обработчики вызываются в порядке priority (0 = первый)
 * 3. Event replay: поздние подписчики могут получить последнее событие
 * 4. Неймспейсы: все события в формате `module:action`
 * 5. Отложенная обработка (defer/flush): batch emit в конце тика
 */

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

interface Subscription {
  handler: EventHandler<EventName>;
  priority: number;
  label: string;
  once: boolean;
}

/**
 * Типизированная шина событий.
 *
 * Использование:
 * ```ts
 * bus.on('economy:build', (payload) => { ... }, { priority: 10, label: 'economy' });
 * bus.emit('economy:build', { planetId, hexIndex, buildingId });
 * bus.defer('economy:production-complete', { planetId, recipeId }); // отложенно
 * bus.flush(); // обработать все отложенные
 * ```
 */
export class TypedEventBus {
  private listeners = new Map<EventName, Set<Subscription>>();
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

    const sub: Subscription = {
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

  /** Одноразовая подписка — отписка после первого вызова */
  once<E extends EventName>(
    event: E,
    handler: EventHandler<E>,
    options: Omit<SubscriptionOptions, 'once'> = {},
  ): () => void {
    return this.on(event, handler, { ...options, once: true });
  }

  /** Отписка конкретного обработчика */
  private off(event: EventName, sub: Subscription): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(sub);
    }
  }

  /**
   * Синхронная отправка события.
   * Обработчики вызываются в порядке приоритета (детерминизм).
   */
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    // Сохранить последнее событие для replay
    this.lastEvents.set(event, payload);

    const set = this.listeners.get(event);
    if (!set) return;

    // Сортировка по приоритету (детерминизм)
    const sorted = Array.from(set).sort((a, b) => a.priority - b.priority);
    const toRemove: Subscription[] = [];

    for (const sub of sorted) {
      try {
        sub.handler(payload);
      } catch (e) {
        console.error(`[EventBus] Ошибка в "${String(event)}" (${sub.label}):`, e);
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
          this.emit(event, payload as EventPayload<EventName>);
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

  /** Получить количество подписчиков на событие */
  listenerCount<E extends EventName>(event: E): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Получить последнее значение события (для replay) */
  getLastEvent<E extends EventName>(event: E): EventPayload<E> | undefined {
    return this.lastEvents.get(event) as EventPayload<E> | undefined;
  }

  /** Количество отложенных событий */
  get pendingCount(): number {
    return this.pendingEmit.length;
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
