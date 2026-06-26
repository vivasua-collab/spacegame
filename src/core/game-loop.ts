/**
 * Игровой цикл с управлением временем.
 *
 * Версия 3.0: Интегрирован с ModuleRegistry и TypedEventBus.
 * - Тики распределяются через bus → registry.tickAll()
 * - Отложенные события обрабатываются через bus.flush()
 * - Поддерживает пошаговый режим (step)
 *
 * Подключение:
 * - React: useEffect + setInterval → mediator.tick()
 * - Headless: loop.start() / loop.step()
 */

import type { TypedEventBus } from './typed-event-bus';
import type { ModuleRegistry } from './module-registry';
import type { GameTime, GameSpeed, GamePhase } from './types';

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

  private startInterval(): void {
    this.stopInterval();
    const ms = 200; // 200мс интервал при любой скорости
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

  /** Обработать один игровой день */
  private processTick(): void {
    this.time.tick++;
    this.time.dayInYear = this.time.tick % 365;
    this.time.year = Math.floor(this.time.tick / 365) + 1;

    // Отправить событие тика в шину
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
