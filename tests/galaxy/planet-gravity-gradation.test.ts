/**
 * R-26 (2026-08-31): тесты гравитационной градации планет и лун.
 *
 * Запрос владельца: «чёткая градация планет по размерам — чем планета
 * больше (в рамках одного геологического типа), тем её гравитация выше».
 * Жалоба-кейс: «0.9g — средняя, 0.8g — большая»; «ледяная 0.4g — большая».
 *
 * Проверки:
 *   1. Уровень дизайна: полосы (тип × класс) не пересекаются, монотонны
 *      по классу; гравитация на концах полос даёт плотность в диапазоне
 *      типа (физическая согласованность ρ = g×5.51/R).
 *   2. Уровень генерации (galaxy, seed фиксирован): гравитация каждой
 *      планеты лежит в полосе своего (тип, класс) ± округление 2dp.
 *   3. Разделение классов: max гравитации меньшего класса < min большего
 *      (в рамках каждого типа; луны — аналогично).
 *   4. Монотонность по радиусу: сортировка по radiusKm → гравитация не
 *      убывает; строго растёт при ΔR ≥ 500 км (выше кванта округления 2dp
 *      для всех полос, включая ГГ и луны).
 *   5. Регрессия жалобы: ледяная планета с g ∈ [0.32, 0.55] — СРЕДНЯЯ,
 *      с g ∈ [0.62, 0.95] — БОЛЬШАЯ (не наоборот).
 *   6. Согласованность данных: |g − R×ρ/5.51| в пределах квант округления.
 *
 * Run: bun test tests/galaxy/planet-gravity-gradation.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy, DEFAULT_CONFIG } from '@/galaxy';
import {
  PLANET_GRAVITY_BANDS,
  MOON_GRAVITY_BANDS,
  PLANET_DENSITY,
  PLANET_TYPE_RADIUS,
  MOON_DENSITY,
  MOON_RADIUS,
  SIZE_CLASS_RADIUS_REARTH,
  MOON_CLASS_RADIUS_REARTH,
  getPlanetGravityForRadius,
} from '@/data/planet-types';
import type { Planet, Moon, PlanetSize, PlanetType } from '@/core/types';

const SIZE_ORDER: PlanetSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];
const G_QUANTUM = 0.005; // округление gravity до 2 знаков

/** Собрать все планеты галактики (поверхность систем). */
function allPlanets(seed: number, systemCount: number): Planet[] {
  const g = generateGalaxy({ ...DEFAULT_CONFIG, seed, systemCount });
  return g.systems.flatMap((s) => s.planets);
}

/** Собрать все луны галактики. */
function allMoons(seed: number, systemCount: number): Moon[] {
  const g = generateGalaxy({ ...DEFAULT_CONFIG, seed, systemCount });
  return g.systems.flatMap((s) => s.planets.flatMap((p) => p.moons ?? []));
}

describe('R-26: Гравитационная градация — уровень дизайна (полосы)', () => {
  test('1. Полосы (тип × класс) монотонны по классу и не пересекаются', () => {
    for (const type of Object.keys(PLANET_GRAVITY_BANDS) as PlanetType[]) {
      const bands = PLANET_GRAVITY_BANDS[type];
      const classes = SIZE_ORDER.filter((s) => bands[s] !== undefined);
      for (let i = 1; i < classes.length; i++) {
        const prev = bands[classes[i - 1]!]!;
        const curr = bands[classes[i]!]!;
        // Зазор с учётом округления до 2dp (±0.005 с каждой стороны)
        expect(prev.max + G_QUANTUM).toBeLessThan(curr.min - G_QUANTUM);
      }
    }
  });

  test('2. Плотность на концах каждой полосы — в физическом диапазоне типа', () => {
    for (const type of Object.keys(PLANET_GRAVITY_BANDS) as PlanetType[]) {
      const bands = PLANET_GRAVITY_BANDS[type];
      const typeRange = PLANET_TYPE_RADIUS[type];
      const densityRange = PLANET_DENSITY[type];
      for (const size of SIZE_ORDER) {
        const band = bands[size];
        if (!band) continue;
        const cls = SIZE_CLASS_RADIUS_REARTH[size];
        const lo = Math.max(cls.min * 6371, typeRange.min);
        const hi = Math.min(cls.max * 6371, typeRange.max);
        // На обоих концах ρ = g×5.51/R должен попадать в [min, max] типа
        for (const [radiusKm, g] of [[lo, band.min], [hi, band.max]] as const) {
          const rho = (g * 5.51 * 6371) / radiusKm;
          expect(rho).toBeGreaterThanOrEqual(densityRange.min - 0.01);
          expect(rho).toBeLessThanOrEqual(densityRange.max + 0.01);
        }
      }
    }
  });

  test('3. Полосы лун: монотонность и плотность в диапазоне', () => {
    for (const type of Object.keys(MOON_GRAVITY_BANDS) as Array<'rocky' | 'ice' | 'dwarf'>) {
      const bands = MOON_GRAVITY_BANDS[type];
      const tiny = bands.tiny!;
      const small = bands.small!;
      expect(tiny.max + G_QUANTUM).toBeLessThan(small.min - G_QUANTUM);
      const densityRange = MOON_DENSITY[type];
      const loTiny = Math.max(MOON_CLASS_RADIUS_REARTH.tiny.min * 6371, MOON_RADIUS.min);
      const hiTiny = Math.min(MOON_CLASS_RADIUS_REARTH.tiny.max * 6371, MOON_RADIUS.max);
      const loSmall = Math.max(MOON_CLASS_RADIUS_REARTH.small.min * 6371, MOON_RADIUS.min);
      const hiSmall = Math.min(MOON_CLASS_RADIUS_REARTH.small.max * 6371, MOON_RADIUS.max);
      for (const [radiusKm, g] of [
        [loTiny, tiny.min], [hiTiny, tiny.max],
        [loSmall, small.min], [hiSmall, small.max],
      ] as const) {
        const rho = (g * 5.51 * 6371) / radiusKm;
        expect(rho).toBeGreaterThanOrEqual(densityRange.min - 0.01);
        expect(rho).toBeLessThanOrEqual(densityRange.max + 0.01);
      }
    }
  });

  test('4. getPlanetGravityForRadius: интерполяция и фолбэк', () => {
    // rocky medium: lo=4460, hi=8282, полоса [0.60, 1.00]
    expect(getPlanetGravityForRadius('rocky', 4460, 'medium')).toBeCloseTo(0.60, 3);
    expect(getPlanetGravityForRadius('rocky', 8282, 'medium')).toBeCloseTo(1.00, 3);
    expect(getPlanetGravityForRadius('rocky', 6371, 'medium')).toBeCloseTo(0.80, 3);
    // rocky large: lo=8282, hi=10200, полоса [1.15, 1.40]
    expect(getPlanetGravityForRadius('rocky', 8282, 'large')).toBeCloseTo(1.15, 3);
    expect(getPlanetGravityForRadius('rocky', 10200, 'large')).toBeCloseTo(1.40, 3);
    // Полоса отсутствует (rocky huge) → null → фолбэк у генератора
    expect(getPlanetGravityForRadius('rocky', 20000, 'huge')).toBeNull();
    // Клампинг за пределами диапазона (микро-защита)
    expect(getPlanetGravityForRadius('rocky', 3000, 'small')).toBeCloseTo(0.37, 3);
    expect(getPlanetGravityForRadius('rocky', 9000, 'medium')).toBeCloseTo(1.00, 3); // за hi=8282 → кламп t=1
  });
});

describe('R-26: Гравитационная градация — генерация галактики', () => {
  // Один seed для воспроизводимости + достаточно систем для наполнения ячеек
  const planets = allPlanets(4242, 120);
  const moons = allMoons(4242, 120);

  test('5. Каждая планета в полосе своего (тип × класс) ± округление', () => {
    expect(planets.length).toBeGreaterThan(300);
    let checked = 0;
    for (const p of planets) {
      const band = PLANET_GRAVITY_BANDS[p.type][p.size];
      if (!band) continue; // фолбэк-путь (не достижим текущими диапазонами)
      expect(p.gravity).toBeGreaterThanOrEqual(band.min - G_QUANTUM - 1e-9);
      expect(p.gravity).toBeLessThanOrEqual(band.max + G_QUANTUM + 1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(250); // полосы покрыли почти все планеты
  });

  test('6. Разделение классов: max гравитации меньшего класса < min большего (каждый тип)', () => {
    for (const type of Object.keys(PLANET_GRAVITY_BANDS) as PlanetType[]) {
      const bySize = new Map<PlanetSize, number[]>();
      for (const p of planets) {
        if (p.type !== type) continue;
        const arr = bySize.get(p.size) ?? [];
        arr.push(p.gravity);
        bySize.set(p.size, arr);
      }
      const classes = SIZE_ORDER.filter((s) => bySize.has(s));
      for (let i = 1; i < classes.length; i++) {
        const prev = bySize.get(classes[i - 1]!)!;
        const curr = bySize.get(classes[i]!)!;
        const prevMax = Math.max(...prev);
        const currMin = Math.min(...curr);
        expect(prevMax).toBeLessThan(currMin); // строгая инверсия невозможна
      }
    }
  });

  test('7. Монотонность по радиусу: g не убывает; строго растёт при ΔR ≥ 500 км', () => {
    for (const type of Object.keys(PLANET_GRAVITY_BANDS) as PlanetType[]) {
      const of = planets.filter((p) => p.type === type).sort((a, b) => a.radiusKm - b.radiusKm);
      expect(of.length).toBeGreaterThan(5);
      for (let i = 1; i < of.length; i++) {
        const prev = of[i - 1]!;
        const curr = of[i]!;
        expect(curr.gravity).toBeGreaterThanOrEqual(prev.gravity);
        if (curr.radiusKm - prev.radiusKm >= 500) {
          expect(curr.gravity).toBeGreaterThan(prev.gravity);
        }
      }
    }
  });

  test('8. Регрессия жалобы владельца: лёд 0.4g — СРЕДНЯЯ, не большая', () => {
    const ice = planets.filter((p) => p.type === 'ice');
    expect(ice.length).toBeGreaterThan(10);
    for (const p of ice) {
      if (p.gravity >= 0.32 && p.gravity <= 0.55) {
        expect(p.size).toBe('medium'); // «0.4g большая» — больше невозможно
      }
      if (p.gravity >= 0.62 && p.gravity <= 0.95) {
        expect(p.size).toBe('large');
      }
    }
    // Позитивная проверка: у больших ледяных гравитация ВЫШЕ средних
    const large = ice.filter((p) => p.size === 'large');
    const medium = ice.filter((p) => p.size === 'medium');
    if (large.length > 0 && medium.length > 0) {
      expect(Math.min(...large.map((p) => p.gravity))).toBeGreaterThan(
        Math.max(...medium.map((p) => p.gravity)),
      );
    }
  });

  test('9. Согласованность (g, R, ρ): формула docs §2.2 сходится в пределах округления', () => {
    for (const p of planets) {
      const band = PLANET_GRAVITY_BANDS[p.type][p.size];
      if (!band) continue; // фолбэк тоже консистентен по построению
      const rhoExpected = (p.gravity * 5.51 * 6371) / p.radiusKm;
      const tolerance = (G_QUANTUM * 5.51 * 6371) / p.radiusKm + 0.01;
      expect(Math.abs(p.density - rhoExpected)).toBeLessThanOrEqual(tolerance);
    }
  });

  test('10. Луны: разделение классов и монотонность по радиусу', () => {
    expect(moons.length).toBeGreaterThan(50);
    for (const type of Object.keys(MOON_GRAVITY_BANDS) as Array<'rocky' | 'ice' | 'dwarf'>) {
      const of = moons.filter((m) => m.type === type).sort((a, b) => a.radiusKm - b.radiusKm);
      if (of.length < 2) continue;
      const tiny = of.filter((m) => m.size === 'tiny');
      const small = of.filter((m) => m.size === 'small');
      if (tiny.length > 0 && small.length > 0) {
        expect(Math.max(...tiny.map((m) => m.gravity))).toBeLessThan(
          Math.min(...small.map((m) => m.gravity)),
        );
      }
      for (let i = 1; i < of.length; i++) {
        expect(of[i]!.gravity).toBeGreaterThanOrEqual(of[i - 1]!.gravity);
        if (of[i]!.radiusKm - of[i - 1]!.radiusKm >= 500) {
          expect(of[i]!.gravity).toBeGreaterThan(of[i - 1]!.gravity);
        }
      }
    }
  });
});
