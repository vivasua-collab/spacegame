/**
 * Игровой цикл с управлением временем.
 *
 * Контракт скорости (docs/00-ARCHITECTURE.md §2, README):
 *   ×N = N игровых тиков (дней) в секунду реального времени.
 * - x1 → 1 тик/с, x5 → 5 тиков/с, x15 → 15 тиков/с, x50 → 50 тиков/с.
 *
 * Механика: setInterval с интервалом 1000/speed мс + catch-up по настенным
 * часам (performance.now, монотонный). За каждый запуск интервала
 * выполняется столько тиков, сколько «накопилось» по контракту ×N
 * (обычно 1; при троттлинге таймеров — пакетом, до MAX_TICKS_PER_INTERVAL
 * за запуск). Это одновременно и «защита от перегрузки»: если движок не
 * успевает, темп плавно деградирует, не блокируя поток.
 *
 * Аудит 2026-10-26 (внешний, этап 0–1): до фикса скорость применялась
 * ДВАЖДЫ — интервал 1000/speed мс И по `speed` тиков за интервал —
 * фактический темп был ~speed² тиков/с (×5 → ~25/с, ×50 → ~2500/с)
 * вместо контрактного ×N. Исправлено: размер пакета = фактический
 * догоняющий дефицит по настенным часам, а не константа speed.
 *
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

/** Максимальное количество тиков за один запуск интервала (защита от перегрузки и троттлинга). */
const MAX_TICKS_PER_INTERVAL = 50;

/** Интервал (мс) для каждой скорости. */
function intervalForSpeed(speed: GameSpeed): number {
  if (speed <= 0) return 1000;
  // x1 → 1000ms, x5 → 200ms, x15 → ~67ms, x50 → 20ms
  return Math.max(20, Math.round(1000 / speed));
}

/**
 * Сколько игровых тиков «должно» быть выполнено к моменту elapsedMs
 * после старта интервала — по контракту ×N (N тиков за 1000 мс).
 *
 * Чистая функция — покрыта юнит-тестами без таймеров (аудит 2026-10-26).
 */
export function ticksDue(elapsedMs: number, speed: GameSpeed): number {
  if (speed <= 0) return 0;
  return Math.floor((elapsedMs / 1000) * speed);
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
    const speed = this.speed;
    // Якорь по монотонным настенным часам: контракт «×N = N тиков/с реального
    // времени» восстанавливается догоняющими пакетами, если таймеры
    // троттлятся (фоновая вкладка) или обработчик опаздывает.
    let anchor = performance.now();
    let processed = 0; // тиков выполнено с момента anchor
    this.intervalId = setInterval(() => {
      const now = performance.now();
      let due = ticksDue(now - anchor, speed);
      // Катастрофическое отставание (сон машины, агрессивный троттлинг
      // фоновой вкладки): навёрстывать тысячи тиков пакетами — значит
      // заморозить поток; переякориваемся и продолжаем с текущего момента.
      if (due - processed > MAX_TICKS_PER_INTERVAL * 10) {
        anchor = now;
        processed = 0;
        due = 0;
      }
      // Догоняем дефицит, но не более MAX тиков за один запуск — защита
      // от перегрузки (исходный смысл константы).
      const target = Math.min(due, processed + MAX_TICKS_PER_INTERVAL);
      while (processed < target) {
        processed++;
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
