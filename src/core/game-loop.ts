/**
 * Игровой цикл с управлением временем.
 *
 * Версия 4.0 (Block 06): setInterval с переменным интервалом по скорости.
 * - x1 → 1000ms, x5 → 200ms, x15 → ~67ms, x50 → 20ms
 * - Защита от перегрузки: Math.min(speed, 50) тиков за интервал.
 * - Тики распределяются через bus.emit('core:tick') → registry.tickAll()
 * - Поддерживает пошаговый режим (step)
 *
 * Подключение:
 * - React: useEffect (mount) → mediator.start() (который вызывает loop.start())
 * - Headless: loop.start() / loop.step()
 */

import type { TypedEventBus } from './typed-event-bus';
import type { ModuleRegistry } from './module-registry';
import type { GameTime, GameSpeed, GamePhase } from './types';

/** Максимальное количество тиков за один интервал (защита от перегрузки). */
const MAX_TICKS_PER_INTERVAL = 50;

/** Интервал (мс) для каждой скорости. */
function intervalForSpeed(speed: GameSpeed): number {
  if (speed <= 0) return 1000;
  // x1 → 1000ms, x5 → 200ms, x15 → ~67ms, x50 → 20ms
  return Math.max(20, Math.round(1000 / speed));
}

export class GameLoop {
  private time: GameTime;
  private speed: GameSpeed = 1;
  private phase: GamePhase = 'paused';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private bus: TypedEventBus;
  private registry: ModuleRegistry;

  constructor(bus: TypedEventBus, registry: ModuleRegistry) {
    this.bus = bus;
    this.registry = registry;
    this.time = { tick: 0, dayInYear: 0, year: 1 };
  }

  getTime(): GameTime {
    return { ...this.time };
  }

  getSpeed(): GameSpeed {
    return this.speed;
  }

  getPhase(): GamePhase {
    return this.phase;
  }

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
    this.bus.emit('core:speed-changed', speed);
  }

  start(): void {
    if (this.phase === 'playing') return;
    this.phase = 'playing';
    if (this.speed > 0) {
      this.startInterval();
    }
    this.bus.emit('core:started', undefined);
  }

  pause(): void {
    if (this.phase === 'paused') return;
    this.phase = 'paused';
    this.stopInterval();
    this.bus.emit('core:paused', undefined);
  }

  toggle(): void {
    if (this.phase === 'playing') {
      this.pause();
    } else {
      this.start();
    }
  }

  /** Выполнить один тик вручную (для отладки или пошагового режима) */
  step(): void {
    this.processTick();
  }

  /** Остановить интервал (без изменения фазы) */
  stop(): void {
    this.stopInterval();
    if (this.phase === 'playing') {
      this.phase = 'paused';
    }
  }

  private startInterval(): void {
    this.stopInterval();
    const ms = intervalForSpeed(this.speed);
    this.intervalId = setInterval(() => {
      const ticks = Math.min(this.speed, MAX_TICKS_PER_INTERVAL);
      for (let i = 0; i < ticks; i++) {
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

  /** Обработать один игровой день */
  private processTick(): void {
    this.time.tick++;
    this.time.dayInYear = this.time.tick % 365;
    this.time.year = Math.floor(this.time.tick / 365) + 1;

    // Отправить событие тика в шину (подписчики: EconomyModule, GalaxyModule, ...)
    this.bus.emit('core:tick', { ...this.time });

    // Распределить тик по всем модулям через реестр
    this.registry.tickAll(this.time);

    // Ежегодное событие
    if (this.time.dayInYear === 0 && this.time.tick > 0) {
      this.bus.emit('core:year', { ...this.time });
    }
  }

  destroy(): void {
    this.stopInterval();
    this.phase = 'paused';
  }

  /** Установить время (для загрузки) */
  setTime(time: GameTime): void {
    this.time = { ...time };
  }
}
