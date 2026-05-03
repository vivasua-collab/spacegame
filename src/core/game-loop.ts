/**
 * Игровой цикл с управлением временем.
 */

import { gameBus } from './event-bus';
import type { GameTime, GameSpeed, GamePhase } from './types';

export class GameLoop {
  private time: GameTime;
  private speed: GameSpeed = 1;
  private phase: GamePhase = 'paused';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly TICKS_PER_DAY = 86400;

  constructor() {
    this.time = { tick: 0, day: 0, year: 0 };
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
    const ms = 1000 / this.speed;
    this.intervalId = setInterval(() => this.processTick(), ms);
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private processTick(): void {
    this.time.tick++;

    // Обновляем день/год
    this.time.day = Math.floor(this.time.tick / this.TICKS_PER_DAY);
    this.time.year = Math.floor(this.time.day / 365);

    // События
    gameBus.emit('tick', this.time);
    if (this.time.tick % this.TICKS_PER_DAY === 0) {
      gameBus.emit('day', this.time);
    }
    if (this.time.day % 365 === 0 && this.time.tick % this.TICKS_PER_DAY === 0 && this.time.day > 0) {
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
