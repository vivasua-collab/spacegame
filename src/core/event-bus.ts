/**
 * Адаптер для обратной совместимости со старой нетипизированной шиной.
 *
 * Маппинг старых имён событий на новые типизированные:
 * - 'tick'                  → 'core:tick'
 * - 'year'                  → 'core:year'
 * - 'game:started'          → 'core:started'
 * - 'game:paused'           → 'core:paused'
 * - 'speed:changed'         → 'core:speed-changed'
 * - 'building:constructed'  → 'economy:building-constructed'
 * - 'building:upgraded'     → 'economy:building-upgraded'
 * - 'production:complete'   → 'economy:production-complete'
 * - 'planet:colonized'      → 'economy:planet-colonized'
 *
 * @deprecated Используйте TypedEventBus напрямую (gameBus из typed-event-bus.ts)
 */

import { gameBus as typedBus } from './typed-event-bus';
import type { GameTime, GameSpeed } from './types';

type Listener<T = unknown> = (data: T) => void;

/** Маппинг старых имён событий на новые */
const EVENT_MAP: Record<string, string> = {
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

/**
 * @deprecated Используйте TypedEventBus (gameBus из typed-event-bus.ts)
 */
export class EventBus {
  private legacyUnsubscribers: Array<() => void> = [];

  on<T>(event: string, listener: Listener<T>): () => void {
    const typedEvent = EVENT_MAP[event] ?? event;
    const unsub = typedBus.on(typedEvent as any, listener as any, { label: `legacy:${event}` });
    this.legacyUnsubscribers.push(unsub);
    return unsub;
  }

  once<T>(event: string, listener: Listener<T>): () => void {
    const typedEvent = EVENT_MAP[event] ?? event;
    const unsub = typedBus.once(typedEvent as any, listener as any, { label: `legacy-once:${event}` });
    this.legacyUnsubscribers.push(unsub);
    return unsub;
  }

  off<T>(event: string, listener: Listener<T>): void {
    // Старый API off не поддерживается напрямую — используем unsub функции
    console.warn(`[EventBus] off() не поддерживается в legacy-адаптере. Используйте функцию отписки.`);
  }

  emit<T>(event: string, data?: T): void {
    const typedEvent = EVENT_MAP[event] ?? event;
    typedBus.emit(typedEvent as any, data as any);
  }

  clear(): void {
    for (const unsub of this.legacyUnsubscribers) {
      unsub();
    }
    this.legacyUnsubscribers = [];
  }
}

/**
 * @deprecated Используйте gameBus из '@/core/typed-event-bus'
 */
export const gameBus = new EventBus();
