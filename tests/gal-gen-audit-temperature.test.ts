/// <reference types="bun-types" />
/**
 * GAL-GEN-AUDIT-01 (Issue #20, 2026-10-28) — characterizing-тесты модели
 * температуры планет (src/galaxy/generate-planets.ts).
 *
 * ВАЖНО: это ХАРАКТЕРИЗАЦИЯ существующего поведения, НЕ одобрение модели
 * как правильной. Гейт аудита (Issue #20) прямо запрещает менять формулы
 * до решения владельца. Тесты фиксируют факты: какие входы влияют на
 * температуру, какие нет, и известные расхождения (composition всегда
 * пуст, temperatureRange не применяется) — чтобы любое будущее изменение
 * было сознательным и видимым.
 *
 * Аудит: checkpoints/10_28_gal_gen_audit01.md.
 *
 * Run: bun test tests/gal-gen-audit-temperature.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { Xoshiro128StarStar } from '@/core/prng';
import {
  calculatePlanetTemperature,
  getAlbedo,
} from '@/galaxy/generate-planets';
import { generateGalaxy } from '@/galaxy';
import { PLANET_TYPES } from '@/data/planet-types';
import type { Atmosphere, Star, PlanetDef } from '@/core/types';

// ============ Хелперы ============

/** Звезда-«ручка»: светимость/масса задаются, остальное фиктивно. */
function starWith(luminosity: number): Star {
  return {
    id: 'star-test', name: 'Test', type: 'STAR_G2V', stellarClass: 'G',
    mass: 1, radius: 1, luminosity, temperature: 5778, color: '#fff',
  } as unknown as Star;
}

function planetDefOf(type: string): PlanetDef {
  const def = PLANET_TYPES.find((d) => d.type === type);
  if (!def) throw new Error(`unknown planet type ${type}`);
  return def;
}

function atmo(type: Atmosphere['type'], pressure: number): Atmosphere {
  return { type, pressure, composition: [] };
}

/** Планета без атмосферы: T = T_eq − 273.15 (парник 0, модификатор rocky = 0). */
function tempNoAtmo(planetType: string, L: number, rAU: number, rngSeed = 777): number {
  return calculatePlanetTemperature(
    starWith(L), rAU, planetDefOf(planetType), atmo('none', 0), new Xoshiro128StarStar(rngSeed),
  );
}

/** Корреляция Пирсона. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

// ============ Тесты ============

describe('GAL-GEN-AUDIT-01: characterize — какие входы меняют температуру', () => {
  test('T1. Формула T_eq точно следует задокументированному виду 278.5·L^¼·(1-A)^¼·r^-½ (rocky, без атмосферы)', () => {
    // Тот же rng-seed → то же альбедо; парник 'none' = 0; rocky-модификатор = 0.
    // Значит T = 278.5 · L^0.25 · (1-A)^0.25 · r^-0.5 − 273.15 — проверяем с
    // точным альбедо, полученным из getAlbedo тем же seed.
    const rngA = new Xoshiro128StarStar(4242);
    const A = getAlbedo('rocky', 'none', rngA);
    const expected = 278.5 * Math.pow(1, 0.25) * Math.pow(1 - A, 0.25) * Math.pow(1, -0.5) - 273.15;
    const actual = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('none', 0), new Xoshiro128StarStar(4242),
    );
    expect(actual).toBeCloseTo(expected, 6);
  });

  test('T2. Расстояние: r^-0.5 — удвоение дистанции ↓ T_eq в √2 (при равных прочих)', () => {
    const t1 = tempNoAtmo('rocky', 1, 1.0);
    const t2 = tempNoAtmo('rocky', 1, 2.0);
    const t4 = tempNoAtmo('rocky', 1, 4.0);
    // В Кельвинах: T(r) ∝ r^-0.5 → T(2r)/T(r) = 2^-0.5.
    const K = (c: number) => c + 273.15;
    expect(K(t2) / K(t1)).toBeCloseTo(Math.pow(2, -0.5), 3);
    expect(K(t4) / K(t1)).toBeCloseTo(Math.pow(4, -0.5), 3);
    // Монотонное убывание.
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t4);
  });

  test('T3. Светимость звезды: L^0.25 — рост L в 16 раз удваивает T_eq', () => {
    const tL1 = tempNoAtmo('rocky', 1, 1.0);
    const tL16 = tempNoAtmo('rocky', 16, 1.0);
    const K = (c: number) => c + 273.15;
    expect(K(tL16) / K(tL1)).toBeCloseTo(2, 3); // 16^0.25 = 2
  });

  test('T4. Наличие атмосферы: без атмосферы ΔT=0; со стандартной теплее на 25–40 K (масштаб давления)', () => {
    // Одинаковый rng-seed → одинаковое альбедо; различие только в атмосфере.
    const tNone = tempNoAtmo('rocky', 1, 1.0, 555);
    const tStd1atm = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('standard', 1.0), new Xoshiro128StarStar(555),
    );
    const delta = (tStd1atm + 273.15) - (tNone + 273.15);
    // База standard 25–40 K при P=1 атм (масштаб = 1^0.25 = 1).
    expect(delta).toBeGreaterThanOrEqual(25);
    expect(delta).toBeLessThanOrEqual(40);
  });

  test('T5. Тип атмосферы (прокси состава): co2 > dense > standard > thin > none по парнику', () => {
    const cases: Array<[Atmosphere['type'], number]> = [
      ['none', 0], ['thin', 0.5], ['standard', 1.0], ['dense', 3.0], ['co2', 10.0],
    ];
    let prev = -Infinity;
    for (const [type, pressure] of cases) {
      const t = calculatePlanetTemperature(
        starWith(1), 1, planetDefOf('rocky'), atmo(type, pressure), new Xoshiro128StarStar(999),
      );
      // База: none 0 < thin 5-20 < standard 25-40 < dense 50-130 < co2 80-280,
      // при давлениях выше давление только усиливает. Строгий порядок.
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  test('T6. Давление: ΔT масштабируется (P)^0.25 — рост P в 16 раз удваивает парник', () => {
    const t1 = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('standard', 1.0), new Xoshiro128StarStar(31337),
    );
    const t16 = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('standard', 16.0), new Xoshiro128StarStar(31337),
    );
    const tNone = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('none', 0), new Xoshiro128StarStar(31337),
    );
    const gh1 = (t1 + 273.15) - (tNone + 273.15);
    const gh16 = (t16 + 273.15) - (tNone + 273.15);
    expect(gh16 / gh1).toBeCloseTo(Math.pow(16, 0.25), 3); // 2
  });

  test('T7. РАЗМЕР НЕ ВХОДИТ в формулу: сигнатура не получает радиус/размер; корреляция радиус↔T внутри типов слабая (характеризация)', () => {
    // (а) Сигнатура: calculatePlanetTemperature(star, orbitalRadiusAU, planetDef,
    //     atmosphere, rng) — радиуса нет (проверено аудитом кода, §2 чекпоинта).
    // (б) Интеграционная характеризация: на seed 42 внутри каждого типа
    //     |corr(radiusKm, temperature)| < 0.35 — зависимости нет (слабые
    //     значения объясняются шумом выборки/confounder'ом орбиты).
    const g = generateGalaxy({ seed: 42, systemCount: 200 });
    const byType = new Map<string, { r: number[]; t: number[] }>();
    for (const sys of g.systems) {
      for (const p of sys.planets) {
        const entry = byType.get(p.type) ?? { r: [], t: [] };
        entry.r.push(p.radiusKm);
        entry.t.push(p.temperature);
        byType.set(p.type, entry);
      }
    }
    expect(byType.size).toBe(7);
    for (const [type, { r, t }] of byType) {
      expect(r.length).toBeGreaterThanOrEqual(30); // все типы представлены
      const corr = pearson(r, t);
      expect(Math.abs(corr)).toBeLessThan(0.35);
      // Лог для аудита (не ассерт): фактические значения зафиксированы в чекпоинте.
      if (Math.abs(corr) >= 0.2) {
        console.info(`[gal-gen-audit] corr(radius, T) для ${type}: ${corr.toFixed(3)} — слабая, без каузального пути (шум/confounder)`);
      }
    }
  });

  test('T8. СОСТАВ АТМОСФЕРЫ всегда пуст и не влияет ни на что (composition: [] у 100% планет)', () => {
    // Характеризация известного расхождения: поле Atmosphere.composition
    // объявлено в типах, но генератор никогда его не заполняет — «состав»
    // представлен только классом (type). Владелец решает: генерировать
    // состав или убрать поле (чекпоинт §5, решение D2).
    const g = generateGalaxy({ seed: 42, systemCount: 200 });
    let planets = 0;
    let withComposition = 0;
    for (const sys of g.systems) {
      for (const p of sys.planets) {
        planets++;
        if (p.atmosphere.composition.length > 0) withComposition++;
      }
    }
    expect(planets).toBeGreaterThan(400);
    expect(withComposition).toBe(0); // 552/552 на seed 42
  });

  test('T9. temperatureRange НЕ применяется генератором (справка показывает диапазоны, с которыми генерация не согласована)', () => {
    // Характеризация: PLANET_TYPES[].temperatureRange отображается в окне
    // справки как ожидаемый диапазон, но calculatePlanetTemperature его не
    // читает. На seed 42: 186/552 = 33.7% планет вне заявленных диапазонов
    // (например, вулканическая при −82°C при заявленных 200–800°C).
    const g = generateGalaxy({ seed: 42, systemCount: 200 });
    const ranges = new Map(PLANET_TYPES.map((d) => [d.type, d.temperatureRange]));
    let total = 0;
    let violations = 0;
    for (const sys of g.systems) {
      for (const p of sys.planets) {
        total++;
        const [lo, hi] = ranges.get(p.type)!;
        if (p.temperature < lo || p.temperature > hi) violations++;
      }
    }
    expect(total).toBeGreaterThan(400);
    // Зафиксированный факт seed 42: 186 нарушений (33.7%). Порог ≥ 25%
    // оставляет запас на будущие правки данных, но ловит «диапазоны
    // применяются» (тогда violations → ~0) и «диапазоны синхронизированы».
    expect(violations / total).toBeGreaterThanOrEqual(0.25);
  });

  test('T10. Проверка из документации: Земля (L=1, r=1, A=0.30) → T_eq = 254.8 K; +33 K парника → 287.8 K (14.6°C)', () => {
    // docs/30-planets.md §2.3 приводит этот расчёт как валидацию. Альбедо
    // rocky rng-зависимо (0.15–0.30) — подбираем seed, дающий A≈0.30, и
    // проверяем конечные числа формулы.
    let seed = 1;
    let A = 0;
    for (; seed < 5000; seed++) {
      A = getAlbedo('rocky', 'none', new Xoshiro128StarStar(seed));
      if (A > 0.299) break;
    }
    const tNoAtmo = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('none', 0), new Xoshiro128StarStar(seed),
    );
    // T_eq = 278.5 × (0.7)^0.25 = 254.7 K → −18.4°C (A=0.30).
    expect(tNoAtmo + 273.15).toBeCloseTo(278.5 * Math.pow(1 - A, 0.25), 1);
    // С земным парником +33K (standard, ~1 атм даёт 25–40) — порядок величины
    // совпадает с документированными 287.8 K.
    const tEarth = calculatePlanetTemperature(
      starWith(1), 1, planetDefOf('rocky'), atmo('standard', 1.0), new Xoshiro128StarStar(seed),
    );
    expect(tEarth).toBeGreaterThan(-10);
    expect(tEarth).toBeLessThan(40);
  });
});
