/// <reference types="bun-types" />
/**
 * Block 06 — GameLoop tests.
 *
 * Контракт скорости (docs/00-ARCHITECTURE.md §2, README):
 *   ×N = N игровых тиков (дней) в секунду реального времени.
 *
 * Tests that:
 * - ticksDue() — чистая функция контракта ×N (без таймеров, детерминированно)
 * - loop.start() runs an interval that emits core:tick с темпом ×N тиков/с
 *   (а НЕ ~N² как до аудита 2026-10-26: интервал 1000/N мс + пакет из N
 *   тиков за интервал давали ×5→~25/с, ×15→~225/с, ×50→~2500/с)
 * - loop.stop() / loop.pause() stops the interval
 * - loop is idempotent — no double intervals
 *
 * Run: bun test tests/game-loop.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { TypedEventBus } from '@/core/typed-event-bus';
import { ModuleRegistry } from '@/core/module-registry';
import { GameLoop, ticksDue } from '@/core/game-loop';

/** Helper: подождать ms миллисекунд. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Block 06: ticksDue — чистая функция контракта ×N', () => {
  test('0 мс → 0 тиков на любой скорости', () => {
    for (const speed of [1, 5, 15, 50] as const) {
      expect(ticksDue(0, speed)).toBe(0);
    }
  });

  test('1000 мс → ровно N тиков (контракт ×N = N тиков/с)', () => {
    expect(ticksDue(1000, 1)).toBe(1);
    expect(ticksDue(1000, 5)).toBe(5);
    expect(ticksDue(1000, 15)).toBe(15);
    expect(ticksDue(1000, 50)).toBe(50);
  });

  test('2000 мс → 2N тиков; 500 мс → N/2 тиков', () => {
    expect(ticksDue(2000, 5)).toBe(10);
    expect(ticksDue(500, 50)).toBe(25);
  });

  test('speed=0 (пауза) → 0 тиков независимо от времени', () => {
    expect(ticksDue(0, 0)).toBe(0);
    expect(ticksDue(10_000, 0)).toBe(0);
  });

  test('дробное время округляется вниз (незавершённый тик не начат)', () => {
    // 1999 мс на x5 → 9.995 тика → 9
    expect(ticksDue(1999, 5)).toBe(9);
    // 999 мс на x1 → 0.999 тика → 0
    expect(ticksDue(999, 1)).toBe(0);
  });
});

describe('Block 06: GameLoop start/stop/setSpeed — темп ×N', () => {
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

  test('loop.start() at x50 — первый тик в течение 100 мс (интервал 20 мс)', async () => {
    loop.setSpeed(50);
    loop.start();

    expect(tickCount).toBe(0);
    await wait(100); // ~5 интервалов по 20 мс

    // Контракт ×50: ~5 тиков за 100 мс. До фикса было бы ~250 (50×5 интервалов).
    expect(tickCount).toBeGreaterThanOrEqual(1);
    expect(tickCount).toBeLessThanOrEqual(10);

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

  test('КОНТРАКТ ×1: ~1 тик/с (не больше 2 за 1.15 с)', async () => {
    loop.setSpeed(1);
    loop.start();

    expect(tickCount).toBe(0);
    await wait(1150);

    // due = floor(1.15 × 1) = 1; допуск на джиттер таймера — 0..2
    expect(tickCount).toBeGreaterThanOrEqual(0);
    expect(tickCount).toBeLessThanOrEqual(2);

    loop.stop();
  });

  test('КОНТРАКТ ×5: ~5 тиков/с (баг давал ~25/с)', async () => {
    loop.setSpeed(5);
    loop.start();

    await wait(1100);

    // due ≤ floor(1.1 × 5) = 5; нижняя граница — таймер мог чуть опоздать
    expect(tickCount).toBeGreaterThanOrEqual(3);
    expect(tickCount).toBeLessThanOrEqual(6);

    loop.stop();
  });

  test('КОНТРАКТ ×15: ~15 тиков/с (баг давал ~225/с)', async () => {
    loop.setSpeed(15);
    loop.start();

    await wait(1050);

    // due ≤ floor(1.05 × 15) = 15
    expect(tickCount).toBeGreaterThanOrEqual(10);
    expect(tickCount).toBeLessThanOrEqual(16);

    loop.stop();
  });

  test('КОНТРАКТ ×50: ~50 тиков/с, потолок по elapsed (баг давал ~2500/с)', async () => {
    loop.setSpeed(50);
    loop.start();

    await wait(500);

    // due ≤ floor(0.5 × 50) = 25; catch-up не может превысить elapsed-потолок
    expect(tickCount).toBeGreaterThanOrEqual(15);
    expect(tickCount).toBeLessThanOrEqual(30);

    loop.stop();
  });

  test('переключение скоростей на лету — темп каждой скорости по контракту, без двойного интервала', async () => {
    // x5 → 400 мс → ~2 тика
    loop.setSpeed(5);
    loop.start();
    await wait(400);
    const afterX5 = tickCount;

    // x50 → 400 мс → ~20 тиков (после фикса); при двойном интервале было бы ~100
    loop.setSpeed(50);
    await wait(400);
    const afterX50 = tickCount;

    // x1 → 600 мс → ≤1 тика
    loop.setSpeed(1);
    await wait(600);
    const afterX1 = tickCount;

    expect(afterX5).toBeGreaterThanOrEqual(1);
    expect(afterX5).toBeLessThanOrEqual(4);
    expect(afterX50 - afterX5).toBeGreaterThanOrEqual(12);
    expect(afterX50 - afterX5).toBeLessThanOrEqual(26);
    expect(afterX1 - afterX50).toBeGreaterThanOrEqual(0);
    expect(afterX1 - afterX50).toBeLessThanOrEqual(2);

    loop.stop();
  });

  test('loop is idempotent — start() called twice does not start two intervals', async () => {
    loop.setSpeed(50);
    loop.start();
    loop.start(); // second call — should be no-op

    await wait(80);
    const countAfterDoubleStart = tickCount;
    expect(countAfterDoubleStart).toBeGreaterThan(0);
    // Контракт ×50 за 80 мс → не более 4 тиков (double interval дал бы ~8)
    expect(countAfterDoubleStart).toBeLessThanOrEqual(6);

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
});
