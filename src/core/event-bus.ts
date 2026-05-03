/**
 * Типизированная шина событий для игровой логики.
 */

type Listener<T = unknown> = (data: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on<T>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener as Listener);
    return () => this.off(event, listener);
  }

  once<T>(event: string, listener: Listener<T>): () => void {
    const wrapper: Listener<T> = (data) => {
      this.off(event, wrapper);
      listener(data);
    };
    return this.on(event, wrapper);
  }

  off<T>(event: string, listener: Listener<T>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as Listener);
    }
  }

  emit<T>(event: string, data?: T): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch (e) {
          console.error(`EventBus error in "${event}":`, e);
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Глобальная шина событий игры */
export const gameBus = new EventBus();
