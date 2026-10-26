/**
 * Task 36 (аудит δ, C1): орбитальные радиусы планет.
 *
 * Дефект (воспроизведён до правок, 300 seed × 60 систем):
 *  - clamp'ы двойных систем (G-13: BINARY_CLOSE → max(1.0, r),
 *    BINARY_WIDE → min(30, r)) сплющивали «зажатые» орбиты в точку:
 *    1500 пар соседних планет с ОДИНАКОВЫМ orbitalRadius (все — BINARY_CLOSE
 *    с первичками G/M; у M-карликов до 3 планет на орбите r=1.00, P=738 дн);
 *  - у тусклых звёзд (WD, L < 0.005 L☉) шаг 0.5·scale < 0.02 AU →
 *    склейка соседних орбит при округлении 2dp.
 *
 * Контракт после фикса (generate-planets.ts, Audit Task 36):
 *  1. Строгая монотонность orbitalRadius по orbitNumber (хранимое значение 2dp).
 *  2. Уникальность (строгий рост) орбитальных периодов внутри системы.
 *  3. Clamp'ы стабильности сохранены: BINARY_CLOSE — все орбиты ≥ 1.0 AU;
 *     BINARY_WIDE — все орбиты ≤ 30 AU.
 *  4. Минимальный зазор между соседними орбитами (после clamp):
 *     BINARY_CLOSE/WIDE ≥ 0.09 AU (GAP 0.1 − округление 2dp);
 *     одиночные/тройные ≥ 0.01 AU (расслоение 2dp).
 *  5. Производные не ломаются: P = 365.25·sqrt(r³/M) (Кеплер, в пределах
 *     округления r до 2dp); выработка солнечной станции L/r строго убывает
 *     по орбите (P1-26).
 *
 * Синтетические кейсы (generatePlanet напрямую) покрывают РЕДКИЕ в реальной
 * генерации конфигурации — B/RG/O-первички в BINARY_WIDE (ожидание по весам
 * каталога ≈ 38 на 20000 систем, эмпирия 34: B:4, RG:30, O:0) — и усиливают
 * их параметры до краевых значений (L=3000 — максимум pile-up'а на потолке
 * 30 AU).
 *
 * Run: bun test tests/galaxy/planet-orbits.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy, DEFAULT_CONFIG } from '@/galaxy';
import { generatePlanet } from '@/galaxy/generate-planets';
import { Xoshiro128StarStar } from '@/core/prng';
import { getBuildingEnergyOutput } from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import type { Star, Planet, BinaryType } from '@/core/types';

// generatePlanet → assignResourceDeposits требует инициализированных
// BakedLookups (в реальной генерации это делает generateGalaxy).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

// ============ Хелперы ============

/** Синтетическая звезда с заданными mass/luminosity (остальное косметика). */
function makeStar(mass: number, luminosity: number, type: Star['type'] = 'STAR_G'): Star {
  return {
    id: 'star-test', systemId: 'sys-test', type, name: 'Test Star',
    mass, luminosity, temperature: 5000, radius: 1, color: '#ffffff',
  };
}

/** Планеты системы: generatePlanet по орбитам 1..n (как generate-systems). */
function makeSystemPlanets(
  star: Star, binaryType: BinaryType, planetCount: number, seed: number,
): Planet[] {
  const base = new Xoshiro128StarStar(seed);
  const planets: Planet[] = [];
  for (let i = 0; i < planetCount; i++) {
    planets.push(generatePlanet('sys-test', i + 1, 'Test System', star, binaryType, base.derive(`planet_${i}`)));
  }
  return planets;
}

/** Кеплер: P(дни) из радиуса (AU) и массы звезды. */
function keplerPeriodDays(radiusAU: number, starMass: number): number {
  return 365.25 * Math.sqrt(radiusAU ** 3 / starMass);
}

/** Допуск расхождения P с пересчётом из хранимого r (2dp) + округление до дней. */
function keplerToleranceDays(radiusAU: number, starMass: number): number {
  // dP/dr × 0.006 AU (полкванта 2dp с запасом) + 1 день (финальный round)
  return 1 + 365.25 * 1.5 * Math.sqrt(radiusAU / starMass) * 0.006 + 0.5;
}

/** Общие орбитальные инварианты группы планет одной системы. */
function expectOrbitInvariants(planets: Planet[], ctx: { minGap: number; minRadius: number; maxRadius: number }) {
  const ps = [...planets].sort((a, b) => a.orbitNumber - b.orbitNumber);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    expect(Number.isFinite(p.orbitalRadius), `orbit ${p.orbitNumber}: radius finite`).toBe(true);
    expect(p.orbitalRadius, `${ctx}: orbit ${p.orbitNumber} radius > 0`).toBeGreaterThan(0);
    expect(p.orbitalRadius, `${ctx}: orbit ${p.orbitNumber} ≥ ${ctx.minRadius}`).toBeGreaterThanOrEqual(ctx.minRadius);
    expect(p.orbitalRadius, `${ctx}: orbit ${p.orbitNumber} ≤ ${ctx.maxRadius}`).toBeLessThanOrEqual(ctx.maxRadius);
    expect(Number.isFinite(p.orbitalPeriod)).toBe(true);
    if (i === 0) continue;
    const prev = ps[i - 1]!;
    // Строгая монотонность радиусов + минимальный зазор
    expect(p.orbitalRadius, `${ctx}: r строго растёт (orbit ${prev.orbitNumber}→${p.orbitNumber}: ${prev.orbitalRadius}→${p.orbitalRadius})`).toBeGreaterThan(prev.orbitalRadius);
    expect(p.orbitalRadius - prev.orbitalRadius, `${ctx}: зазор orbit ${prev.orbitNumber}→${p.orbitNumber} ≥ ${ctx.minGap}`).toBeGreaterThanOrEqual(ctx.minGap);
    // Уникальность и строгий рост периодов (3-й закон Кеплера)
    expect(p.orbitalPeriod, `${ctx}: P строго растёт (orbit ${prev.orbitNumber}→${p.orbitNumber})`).toBeGreaterThan(prev.orbitalPeriod);
  }
}

// ============ Синтетические кейсы (краевые звёзды) ============

describe('Task 36 C1: орбиты — синтетические краевые случаи', () => {
  test('BINARY_CLOSE + M-карлик (L=0.02): все орбиты ≥ 1.0, строгий рост, зазор ≥ 0.09', () => {
    // До фикса: ВСЕ планеты склеивались на r = 1.00 (до 3 планет на орбите).
    const star = makeStar(0.25, 0.02, 'STAR_M');
    for (const seed of [1, 7, 42, 1000, 99999]) {
      const ps = makeSystemPlanets(star, 'BINARY_CLOSE', 5, seed);
      expectOrbitInvariants(ps, { minGap: 0.09, minRadius: 1.0, maxRadius: Infinity });
      // Кеплер с реальной массой
      for (const p of ps) {
        expect(Math.abs(p.orbitalPeriod - keplerPeriodDays(p.orbitalRadius, star.mass)))
          .toBeLessThanOrEqual(keplerToleranceDays(p.orbitalRadius, star.mass));
      }
    }
  });

  test('BINARY_CLOSE + тусклый WD (L=0.001): без склейки, все ≥ 1.0', () => {
    const star = makeStar(0.6, 0.001, 'STAR_WD');
    for (const seed of [3, 11, 4242]) {
      const ps = makeSystemPlanets(star, 'BINARY_CLOSE', 3, seed);
      expectOrbitInvariants(ps, { minGap: 0.09, minRadius: 1.0, maxRadius: Infinity });
    }
  });

  test('BINARY_CLOSE + яркая A-звезда (L=12): clamp неактивен, зазор сохранён', () => {
    const star = makeStar(1.7, 12, 'STAR_A');
    for (const seed of [5, 77, 12345]) {
      const ps = makeSystemPlanets(star, 'BINARY_CLOSE', 4, seed);
      expectOrbitInvariants(ps, { minGap: 0.09, minRadius: 1.0, maxRadius: Infinity });
    }
  });

  test('BINARY_WIDE + RG (L=3000): все орбиты ≤ 30, строгий рост (лестница)', () => {
    // До фикса: внешние орбиты RG склеивались на r = 30.00.
    const star = makeStar(1.5, 3000, 'STAR_RG');
    for (const seed of [2, 9, 42, 555]) {
      const ps = makeSystemPlanets(star, 'BINARY_WIDE', 5, seed);
      expectOrbitInvariants(ps, { minGap: 0.09, minRadius: 0, maxRadius: 30 });
      for (const p of ps) {
        expect(Math.abs(p.orbitalPeriod - keplerPeriodDays(p.orbitalRadius, star.mass)))
          .toBeLessThanOrEqual(keplerToleranceDays(p.orbitalRadius, star.mass));
      }
    }
  });

  test('BINARY_WIDE + B (L=500) и O (L=200000): потолок 30 без склейки', () => {
    const bStar = makeStar(5, 500, 'STAR_B');
    for (const seed of [1, 42]) {
      const ps = makeSystemPlanets(bStar, 'BINARY_WIDE', 4, seed);
      expectOrbitInvariants(ps, { minGap: 0.09, minRadius: 0, maxRadius: 30 });
    }
    const oStar = makeStar(40, 200000, 'STAR_O');
    for (const seed of [1, 42]) {
      const ps = makeSystemPlanets(oStar, 'BINARY_WIDE', 2, seed);
      expectOrbitInvariants(ps, { minGap: 0.09, minRadius: 0, maxRadius: 30 });
    }
  });

  test('BINARY_NONE + тусклый WD (L=0.001): минимальный зазор 2dp, уникальные периоды', () => {
    // До фикса: шаг 0.5·scale = 0.018 AU → соседние орбиты склеивались в 0.01.
    const star = makeStar(0.6, 0.001, 'STAR_WD');
    for (const seed of [1, 13, 42, 777, 31337]) {
      const ps = makeSystemPlanets(star, 'BINARY_NONE', 3, seed);
      expectOrbitInvariants(ps, { minGap: 0.01, minRadius: 0, maxRadius: Infinity });
      for (const p of ps) {
        expect(Math.abs(p.orbitalPeriod - keplerPeriodDays(p.orbitalRadius, star.mass)))
          .toBeLessThanOrEqual(keplerToleranceDays(p.orbitalRadius, star.mass));
      }
    }
  });

  test('BINARY_NONE + BH (L=0): орбиты положительны и различимы', () => {
    const star = makeStar(10, 0, 'STAR_BH');
    const ps = makeSystemPlanets(star, 'BINARY_NONE', 2, 4242);
    expectOrbitInvariants(ps, { minGap: 0.01, minRadius: 0, maxRadius: Infinity });
  });

  test('BINARY_TRIPLE: строгая монотонность (clamp не применяется — задокументировано)', () => {
    const star = makeStar(0.92, 1.0, 'STAR_G');
    for (const seed of [4, 8, 90210]) {
      const ps = makeSystemPlanets(star, 'BINARY_TRIPLE', 6, seed);
      expectOrbitInvariants(ps, { minGap: 0.01, minRadius: 0, maxRadius: Infinity });
    }
  });

  test('Производная — солнечная станция: выработка строго убывает по орбите (P1-26)', () => {
    // До фикса у склеенных орбит (r=1.00 у соседей) выработка была ОДИНАКОВОЙ.
    const star = makeStar(0.25, 0.02, 'STAR_M');
    const ps = makeSystemPlanets(star, 'BINARY_CLOSE', 5, 42);
    const outputs = ps.map(p => getBuildingEnergyOutput('solar_plant', 1, 'surface', star.luminosity, p.orbitalRadius));
    for (let i = 1; i < outputs.length; i++) {
      expect(outputs[i]!, `solar output строго убывает: ${outputs.join(', ')}`).toBeLessThan(outputs[i - 1]!);
    }
  });
});

// ============ Галактика: ≥100 seed, все реальные конфигурации ============

describe('Task 36 C1: орбиты — генерация галактики (100 seed × 40 систем)', () => {
  const SEEDS = 100;
  const SYSTEMS = 40;

  test('строгая монотонность радиусов, уникальные периоды, clamp-ы соблюдены', () => {
    let closeSystems = 0, wideSystems = 0, noneSystems = 0, tripleSystems = 0;
    let pairCount = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = generateGalaxy({ ...DEFAULT_CONFIG, seed, systemCount: SYSTEMS });
      for (const sys of g.systems) {
        const ps = [...sys.planets].sort((a, b) => a.orbitNumber - b.orbitNumber);
        if (ps.length === 0) continue;
        switch (sys.binaryType) {
          case 'BINARY_CLOSE': closeSystems++; break;
          case 'BINARY_WIDE': wideSystems++; break;
          case 'BINARY_TRIPLE': tripleSystems++; break;
          default: noneSystems++;
        }
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i]!;
          expect(Number.isFinite(p.orbitalRadius)).toBe(true);
          expect(Number.isFinite(p.orbitalPeriod)).toBe(true);
          expect(p.orbitalRadius).toBeGreaterThan(0);
          if (sys.binaryType === 'BINARY_CLOSE') {
            expect(p.orbitalRadius, `CLOSE ${sys.name} orbit ${p.orbitNumber}`).toBeGreaterThanOrEqual(1.0);
          }
          if (sys.binaryType === 'BINARY_WIDE') {
            expect(p.orbitalRadius, `WIDE ${sys.name} orbit ${p.orbitNumber}`).toBeLessThanOrEqual(30);
          }
          if (i === 0) continue;
          const prev = ps[i - 1]!;
          pairCount++;
          expect(p.orbitalRadius,
            `seed ${seed} ${sys.name} (${sys.binaryType}): r(${prev.orbitNumber})=${prev.orbitalRadius} ≥ r(${p.orbitNumber})=${p.orbitalRadius}`)
            .toBeGreaterThan(prev.orbitalRadius);
          expect(p.orbitalPeriod,
            `seed ${seed} ${sys.name}: P(${prev.orbitNumber})=${prev.orbitalPeriod} ≥ P(${p.orbitNumber})=${p.orbitalPeriod}`)
            .toBeGreaterThan(prev.orbitalPeriod);
          // минимальный зазор (2dp-различимость): CLOSE — гарантия фикса
          // (GAP 0.1 − округление); WIDE в зоне лестницы (r>28) — 0.09,
          // остальное — без склейки ≥ 0.01; NONE/TRIPLE — ≥ 0.01
          const minGap = sys.binaryType === 'BINARY_CLOSE'
            ? 0.09
            : sys.binaryType === 'BINARY_WIDE' && prev.orbitalRadius > 28 && p.orbitalRadius > 28
              ? 0.09
              : 0.01;
          expect(p.orbitalRadius - prev.orbitalRadius).toBeGreaterThanOrEqual(minGap);
        }
      }
    }
    // Санити: все типы систем реально покрыты (60/20/15/5 маргиналы)
    expect(closeSystems).toBeGreaterThan(200);
    expect(wideSystems).toBeGreaterThan(100);
    expect(tripleSystems).toBeGreaterThan(20);
    expect(noneSystems).toBeGreaterThan(1000);
    expect(pairCount).toBeGreaterThan(3000);
  }, 60_000);

  test('Kepler: хранимый период согласован с хранимым радиусом и массой звезды', () => {
    let checked = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = generateGalaxy({ ...DEFAULT_CONFIG, seed, systemCount: SYSTEMS });
      for (const sys of g.systems) {
        const star = sys.stars[0];
        if (!star) continue;
        for (const p of sys.planets) {
          const expected = keplerPeriodDays(p.orbitalRadius, star.mass);
          const tol = keplerToleranceDays(p.orbitalRadius, star.mass);
          expect(Math.abs(p.orbitalPeriod - expected),
            `${sys.name} orbit ${p.orbitNumber}: P=${p.orbitalPeriod}, kepler=${expected.toFixed(1)}, mass=${star.mass}`)
            .toBeLessThanOrEqual(tol);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  }, 60_000);
});
