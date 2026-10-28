/// <reference types="bun-types" />
/**
 * GAL-UI-01 (Issue #19, 2026-10-28) — юнит-тесты математики Fit viewport
 * карты галактики (src/lib/map-viewport.ts).
 *
 * Регрессия бага: прежний «Fit» сбрасывал zoom=1/pan=(0,0) — при контейнере
 * больше канвы SVG 900×600 галактика съезжала в левый верхний угол вместо
 * центрирования (отчёт владельца GAL-UI-01). Визуальная часть (сама карта,
 * окно справки) проверена браузерным E2E — см. чекпоинт
 * checkpoints/10_28_gal_ui01.md.
 *
 * Run: bun test tests/gal-ui-viewport.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { computeFitView, MAP_ZOOM_MIN, MAP_ZOOM_MAX } from '@/lib/map-viewport';

const SVG_W = 900;
const SVG_H = 600;

describe('GAL-UI-01: computeFitView — Fit центрирует галактику в контейнере', () => {
  test('T1. контейнер больше канвы (1280×800): канва вписана и центрирована, не в углу', () => {
    const fit = computeFitView(1280, 800, SVG_W, SVG_H);
    // Контейнер шире и выше канвы: обзор не раздуваем (zoom = 1),
    // канва центрирована — положительные отступы с обеих сторон.
    expect(fit.zoom).toBe(1);
    expect(fit.panX).toBe((1280 - SVG_W) / 2); // 190 > 0 — не прижата влево
    expect(fit.panY).toBe((800 - SVG_H) / 2); // 100 > 0 — не прижата вверх
    // Границы канвы [panX, panX + svgW*zoom] внутри контейнера.
    expect(fit.panX).toBeGreaterThan(0);
    expect(fit.panY).toBeGreaterThan(0);
    expect(fit.panX + SVG_W * fit.zoom).toBeLessThanOrEqual(1280);
    expect(fit.panY + SVG_H * fit.zoom).toBeLessThanOrEqual(800);
  });

  test('T2. широкий контейнер (1600×600): масштаб по высоте, центрирование по X', () => {
    const fit = computeFitView(1600, 600, SVG_W, SVG_H);
    expect(fit.zoom).toBe(1); // вписывается без увеличения
    expect(fit.panX).toBe(350); // (1600-900)/2
    expect(fit.panY).toBe(0);
  });

  test('T3. низкий контейнер (900×400): масштаб < 1 (по высоте), центрирование по Y', () => {
    const fit = computeFitView(900, 400, SVG_W, SVG_H);
    // scale = min(900/900, 400/600) = 2/3
    expect(fit.zoom).toBeCloseTo(400 / 600, 10);
    expect(fit.panX).toBe((900 - SVG_W * (400 / 600)) / 2);
    expect(fit.panY).toBe(0);
    // Вся канва видна.
    expect(fit.panX + SVG_W * fit.zoom).toBeLessThanOrEqual(900);
    expect(fit.panY + SVG_H * fit.zoom).toBeLessThanOrEqual(400);
  });

  test('T4. маленький контейнер (320×240, мобильный): масштаб по ширине, всё видно', () => {
    const fit = computeFitView(320, 240, SVG_W, SVG_H);
    // scale = min(320/900, 240/600) = 320/900 ≈ 0.356
    expect(fit.zoom).toBeCloseTo(320 / 900, 10);
    expect(fit.panX).toBe(0);
    expect(fit.panY).toBe((240 - SVG_H * (320 / 900)) / 2);
    expect(fit.panX + SVG_W * fit.zoom).toBeLessThanOrEqual(320);
    expect(fit.panY + SVG_H * fit.zoom).toBeLessThanOrEqual(240);
  });

  test('T5. экстремально вытянутый контейнер (4000×200): масштаб ограничен ZOOM_MIN', () => {
    const fit = computeFitView(4000, 200, SVG_W, SVG_H);
    // scale по высоте = 200/600 = 1/3 — не ниже ZOOM_MIN, ок
    expect(fit.zoom).toBeCloseTo(200 / 600, 10);
    expect(fit.zoom).toBeGreaterThanOrEqual(MAP_ZOOM_MIN);
    // А вот канва 200×N ультра-низкая: масштаб клампится снизу
    const extreme = computeFitView(4000, 50, SVG_W, SVG_H);
    expect(extreme.zoom).toBeGreaterThanOrEqual(MAP_ZOOM_MIN);
    expect(extreme.zoom).toBeLessThanOrEqual(MAP_ZOOM_MAX);
  });

  test('T6. детерминизм/идемпотентность: повторный Fit не дрейфует', () => {
    const first = computeFitView(1280, 800, SVG_W, SVG_H);
    const second = computeFitView(1280, 800, SVG_W, SVG_H);
    expect(second).toEqual(first);
    // Тот же контейнер после применения fit — fit(fit(x)) == fit(x)
    // (функция зависит только от контейнера и канвы, не от текущего вида).
    const third = computeFitView(1280, 800, SVG_W, SVG_H);
    expect(third).toEqual(first);
  });

  test('T7. невалидные входы (0/отрицательные) → безопасный фолбэк zoom=1/pan=0', () => {
    expect(computeFitView(0, 600, SVG_W, SVG_H)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitView(1280, 0, SVG_W, SVG_H)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitView(-5, -5, SVG_W, SVG_H)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitView(1280, 800, 0, 0)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  test('T8. квадратная канва в неквадратном контейнере: свободное место делится поровну', () => {
    const fit = computeFitView(1000, 500, 500, 500);
    expect(fit.zoom).toBe(1);
    // По X: (1000-500)/2 = 250 слева; по Y: 0.
    expect(fit.panX).toBe(250);
    expect(fit.panY).toBe(0);
    // Симметрия: слева столько же, сколько справа.
    const rightMargin = 1000 - (fit.panX + 500 * fit.zoom);
    expect(rightMargin).toBe(fit.panX);
  });
});
