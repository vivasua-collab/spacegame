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

/** Максимальное число пакетов за один flush — защита от бесконечного повторного defer. */
const MAX_FLUSH_BATCHES = 1000;

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
      try {
        handler(this.lastEvents.get(event) as EventPayload<E>);
      } catch (e) {
        // R-42: изоляция ошибок подписчиков — как в emit(): ошибка обработчика
        // на replay-доставке не должна всплывать из on() и ломать подписку.
        console.error(`[EventBus] Ошибка replay "${String(event)}" (${label}):`, e);
      } finally {
        // R-42 (F-01): replay-доставка для once-подписки считается первым
        // (и единственным) вызовом — снимаем подписку НЕМЕДЛЕННО. Прежде
        // подписка оставалась в Set: обработчик срабатывал на replay и затем
        // ЕЩЁ РАЗ на следующем emit (нарушение контракта once).
        if (once) {
          this.listeners.get(event)!.delete(sub);
        }
      }
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
   *
   * R-42: добавлен защитный лимит пакетов (MAX_FLUSH_BATCHES). Прежде цикл
   * `while (pendingEmit.length > 0)` защищал только от рекурсии ВНУТРИ одного
   * пакета; обработчик, который безусловно повторно defer-ит событие,
   * зацикливал flush() навсегда (подтверждено зависанием теста R-42).
   */
  flush(): void {
    if (this.processing) return; // предотвращение рекурсии
    this.processing = true;

    try {
      let batches = 0;
      while (this.pendingEmit.length > 0) {
        if (++batches > MAX_FLUSH_BATCHES) {
          // Обработчик(и) бесконечно генерируют отложенные события: рвём цепочку,
          // сбрасываем остаток очереди и логируем — шина остаётся живой.
          console.error(
            `[EventBus] flush(): превышен лимит пакетов (${MAX_FLUSH_BATCHES}) — ` +
              `вероятно, обработчик бесконечно defer-ит события. ` +
              `Сброшено отложенных: ${this.pendingEmit.length}.`,
          );
          this.pendingEmit = [];
          break;
        }
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

/**
 * Глобальная типизированная шина событий игры.
 *
 * R-39 (P0-1, «единая шина»): ЭТОТ синглтон используется GameMediator как
 * его собственная шина (см. game-mediator.ts) — gameBus ===
 * mediator.getBus(). Engine-функции (economy/engine.ts, ships/
 * fleet-engine.ts, data/ships/shipyard-queue.ts) эмитят исходы операций
 * сюда же, поэтому ПОДПИСЧИКИ МЕДИАТОРА ВИДЯТ СОБЫТИЯ ENGINE — и наоборот.
 *
 * Порядок событий (контракт R-39): engine-события исходов (economy:
 * building-constructed, economy:production-complete, fleet:movement-
 * started, ...) эмитятся в момент выполнения операции — ВНУТРИ immer-
 * produce() модуля, т.е. ДО mediator.commitState(). События, публикуемые
 * самими модулями (core:state-changed, tech:*), — ПОСЛЕ коммита.
 * Подписчикам, которым нужен закоммиченный state, следует читать его в
 * обработчике core:state-changed или после возврата store-действия
 * (payload событий самодостаточен и ссылок на state не содержит).
 *
 * Прежде (до R-39) медиатор создавал ОТДЕЛЬНЫЙ TypedEventBus, а engine
 * эмитил сюда — события engine были невидимы для подписчиков медиатора
 * («мёртвые» эмишены, нарушение modular-bus.md §1.3 «Шина — единственный
 * канал»).
 */
export const gameBus = new TypedEventBus();
