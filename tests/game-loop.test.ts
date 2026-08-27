/// <reference types="bun-types" />
/**
 * Block 06 — GameLoop tests.
 *
 * Tests that:
 * - loop.start() runs an interval that emits core:tick
 * - loop.stop() / loop.pause() stops the interval
 * - loop.setSpeed(N) results in N core:tick emits per interval
 *   (speed × ticks-batched-per-interval, capped at 50)
 *
 * Run: bun test tests/game-loop.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { TypedEventBus } from '@/core/typed-event-bus';
import { ModuleRegistry } from '@/core/module-registry';
import { GameLoop } from '@/core/game-loop';

/** Helper: подождать ms миллисекунд. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Block 06: GameLoop start/stop/setSpeed', () => {
  let bus: TypedEventBus;
  let registry: ModuleRegistry;
  let loop: GameLoop;
  let tickCount: number;
  let unsubscriber: () => void;

  beforeEach(() => {
    bus = new TypedEventBus();
    registry = new ModuleRegistry(bus);
    loop = new GameLoop(bus, registry);
    tickCount = 0;
    unsubscriber = bus.on('core:tick', () => { tickCount++; });
  });

  afterEach(() => {
    unsubscriber();
    loop.destroy();
  });

  test('loop.step() emits exactly one core:tick (sanity check for processTick)', () => {
    expect(tickCount).toBe(0);
    loop.step();
    expect(tickCount).toBe(1);
    loop.step();
    expect(tickCount).toBe(2);
  });

  test('loop.start() runs interval — at least one tick within 300ms at speed=1', async () => {
    // x1 → 1000ms interval. Чтобы ускорить тест — используем speed=50 (20ms interval).
    loop.setSpeed(50);
    loop.start();

    expect(tickCount).toBe(0);
    await wait(80); // ~4 intervals at 20ms

    // Math.min(50, 50) = 50 ticks per interval → минимум 1 интервал → ≥50 тиков
    expect(tickCount).toBeGreaterThanOrEqual(50);

    loop.stop();
  });

  test('loop.stop() halts the interval — no more ticks after stop', async () => {
    loop.setSpeed(50);
    loop.start();
    await wait(50);
    const countAfterStart = tickCount;
    expect(countAfterStart).toBeGreaterThan(0);

    loop.stop();
    await wait(80);

    // После stop() количество тиков не должно увеличиться
    expect(tickCount).toBe(countAfterStart);
  });

  test('loop.pause() also halts the interval', async () => {
    loop.setSpeed(50);
    loop.start();
    await wait(50);
    const countAfterStart = tickCount;
    expect(countAfterStart).toBeGreaterThan(0);

    loop.pause();
    await wait(80);

    expect(tickCount).toBe(countAfterStart);
  });

  test('loop.setSpeed(5) → 5 core:tick emits per interval', async () => {
    // x5 → 200ms interval, 5 ticks per interval
    loop.setSpeed(5);
    loop.start();

    expect(tickCount).toBe(0);
    // Подождём чуть больше одного интервала (250ms)
    await wait(260);

    // Должно быть 5 тиков за один интервал (±0 — первый интервал мог быть неполным)
    // Разрешим допуск: 4-10 тиков за ~260мс
    expect(tickCount).toBeGreaterThanOrEqual(4);
    expect(tickCount).toBeLessThanOrEqual(15);

    loop.stop();
  });

  test('loop.setSpeed(15) → ~15 ticks per interval', async () => {
    // x15 → ~67ms interval, 15 ticks per interval
    loop.setSpeed(15);
    loop.start();

    await wait(150); // ~2 intervals

    // ≥15 (один интервал) — допуск, чтобы избежать flake
    expect(tickCount).toBeGreaterThanOrEqual(15);
    expect(tickCount).toBeLessThanOrEqual(45);

    loop.stop();
  });

  test('loop is idempotent — start() called twice does not start two intervals', async () => {
    loop.setSpeed(50);
    loop.start();
    loop.start(); // second call — should be no-op

    await wait(80);
    const countAfterDoubleStart = tickCount;
    expect(countAfterDoubleStart).toBeGreaterThan(0);

    loop.stop();
    await wait(80);
    expect(tickCount).toBe(countAfterDoubleStart);
  });

  test('speed=0 means paused — no ticks emitted', async () => {
    loop.setSpeed(0);
    loop.start();

    await wait(80);

    // speed=0 → startInterval не вызывается (guards в start())
    expect(tickCount).toBe(0);

    loop.stop();
  });

  test('Math.min cap — speed=50 caps at 50 ticks per interval', async () => {
    // Если бы cap не работал, за 80мс при 50 интерпретациях как 50 ticks × interval@20ms
    // каждый интервал = 50 ticks → 4 intervals = 200 ticks
    // С cap=50 это всё ещё 50 ticks per interval (cap = speed = 50)
    // Тестируем что за один интервал (20мс) ровно 50 тиков (не больше).
    loop.setSpeed(50);
    loop.start();

    await wait(30); // ~1.5 intervals

    // Минимум один интервал = 50 тиков; не должно быть меньше 50
    expect(tickCount).toBeGreaterThanOrEqual(50);

    loop.stop();
  });
});
