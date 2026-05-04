/**
 * Игровой цикл с управлением временем.
 *
 * Версия 2.0: 1 тик = 1 игровой день.
 * Скорость x1 = 5 дней/сек (200мс интервал),
 * x50 = 250 дней/сек.
 *
 * Note: этот класс НЕ подключён к Zustand-стору напрямую.
 * Основной цикл работает через useEffect в page.tsx → store.tick().
 * GameLoop оставлен для возможного будущего использования (headless-сервер, тесты).
 */

import { gameBus } from './event-bus';
import type { GameTime, GameSpeed, GamePhase } from './types';

export class GameLoop {
  private time: GameTime;
  private speed: GameSpeed = 1;
  private phase: GamePhase = 'paused';
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
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
    gameBus.emit('speed:changed', speed);
  }

  start(): void {
    if (this.phase === 'playing') return;
    this.phase = 'playing';
    if (this.speed > 0) {
      this.startInterval();
    }
    gameBus.emit('game:started');
  }

  pause(): void {
    if (this.phase === 'paused') return;
    this.phase = 'paused';
    this.stopInterval();
    gameBus.emit('game:paused');
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

    gameBus.emit('tick', this.time);

    // Ежегодное событие
    if (this.time.dayInYear === 0 && this.time.tick > 0) {
      gameBus.emit('year', this.time);
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
