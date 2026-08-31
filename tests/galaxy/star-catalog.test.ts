/// <reference types="bun-types" />
/**
 * R-STARS-DATA (Etap 4.1) — тесты data-driven каталога звёзд + сеток.
 *
 * Гарантирует:
 *   1. Звёздный каталог (src/data/stars/types.json):
 *      - структуру (7 ГП + 5 специальных);
 *      - СПЕКТРАЛЬНУЮ ЦЕПОЧКУ O→B→A→F→G→K→M в точном порядке (критично
 *        для selectCompanionStar «тот же класс или на 1 ниже» и
 *        STAR_TYPES.slice(0, 7) в generate-systems.ts);
 *      - долю специальных звёзд ~4% ≤ 5% (требование владельца 2026-08-31);
 *      - публичный API loader'а (STAR_TYPES/STAR_TYPE_MAP/STAR_WEIGHTS/
 *        getStarTypeDef/SPECIAL_STAR_RANGES/MAIN_SEQUENCE_TYPES);
 *      - физическую монотонность T/M/L вдоль цепочки.
 *   2. Размерности сеток (src/data/planets/grids.json):
 *      - 5 планетарных сеток + 2 малые лунные (требование владельца);
 *      - обратную совместимость SIZE_HEX_COUNT === PLANET_GRIDS;
 *      - generateHexGrid с лунными сетками (7/19) и с планетарными по
 *        умолчанию;
 *      - интеграцию: все луны сгенерированной галактики имеют hexes.length
 *        ∈ {7, 19} и size ∈ {tiny, small}.
 *
 * Run: bun test tests/galaxy/star-catalog.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup'; // enableMapSet + setAutoFreeze(false)
import {
  STAR_TYPES,
  STAR_TYPE_MAP,
  STAR_WEIGHTS,
  getStarTypeDef,
  SPECIAL_STAR_RANGES,
  MAIN_SEQUENCE_TYPES,
  MAIN_SEQUENCE_STAR_TYPES,
  MAIN_SEQUENCE_STAR_WEIGHTS,
  SPECTRAL_CHAIN,
  specialStarFraction,
} from '@/data/stars';
import { PLANET_GRIDS, MOON_GRIDS } from '@/data/planets/grids';
import { SIZE_HEX_COUNT, MOON_SIZE_HEX_COUNT, ALL_TERRAINS } from '@/data/planet-types';
import { generateHexGrid } from '@/galaxy/hex-grid';
import { generateGalaxy } from '@/galaxy';
import { Xoshiro256 } from '@/core/prng';

/** Центрированное гекс-число: 1 + 3k(k+1) для целого k ≥ 1. */
function isCenteredHex(n: number): boolean {
  const disc = 9 - 12 * (1 - n);
  if (disc < 0) return false;
  const k = (-3 + Math.sqrt(disc)) / 6;
  return Number.isInteger(k) && k >= 1;
}

const FLAT_TERRAIN: Record<string, number> = { plains: 100 };
const terrainWeights = ALL_TERRAINS.reduce(
  (acc, t) => { acc[t] = FLAT_TERRAIN[t] ?? 0; return acc; },
  {} as Record<string, number>,
);

describe('R-STARS-DATA: звёздный каталог (types.json + loader)', () => {
  test('1. Каталог: ровно 12 типов = 7 ГП (0–6) + 5 специальных (7–11)', () => {
    expect(STAR_TYPES.length).toBe(12);
    expect(MAIN_SEQUENCE_STAR_TYPES.length).toBe(7);
    expect(STAR_TYPES.slice(0, 7)).toEqual(MAIN_SEQUENCE_STAR_TYPES);
    expect(STAR_TYPES.slice(7).map(s => s.type).sort()).toEqual(
      ['STAR_BH', 'STAR_NS', 'STAR_PULSAR', 'STAR_RG', 'STAR_WD'],
    );
  });

  test('2. СПЕКТРАЛЬНАЯ ЦЕПОЧКА: mainSequence в точном порядке O→B→A→F→G→K→M', () => {
    expect(MAIN_SEQUENCE_STAR_TYPES.map(s => s.type)).toEqual([
      'STAR_O', 'STAR_B', 'STAR_A', 'STAR_F', 'STAR_G', 'STAR_K', 'STAR_M',
    ]);
    expect(SPECTRAL_CHAIN).toEqual([
      'STAR_O', 'STAR_B', 'STAR_A', 'STAR_F', 'STAR_G', 'STAR_K', 'STAR_M',
    ]);
    // Инвариант generate-systems.ts: slice(0, 7) === ГП цепочка
    expect(STAR_TYPES.slice(0, 7).map(s => s.type)).toEqual(SPECTRAL_CHAIN);
  });

  test('3. Доля специальных звёзд ~4%, НЕ больше 5% (требование владельца)', () => {
    const fraction = specialStarFraction();
    expect(fraction).toBeGreaterThan(0.02);  // «несколько процентов»
    expect(fraction).toBeLessThanOrEqual(0.05); // «не больше 5»
    // Точная фиксация баланса (смена = осознанное изменение баланса)
    expect(fraction).toBeCloseTo(0.03997, 3);
  });

  test('4. Тип-IDs уникальны, веса положительны', () => {
    const ids = STAR_TYPES.map(s => s.type);
    expect(new Set(ids).size).toBe(12);
    for (const w of STAR_WEIGHTS) expect(w).toBeGreaterThan(0);
    expect(STAR_WEIGHTS.length).toBe(12);
  });

  test('5. Публичный API: STAR_TYPE_MAP + getStarTypeDef', () => {
    expect(STAR_TYPE_MAP.size).toBe(12);
    const g = getStarTypeDef('STAR_G');
    expect(g.name).toBe('Жёлтый карлик');
    expect(g.mass).toBe(0.92);
    expect(g.temperature).toBe(5600);
    expect(g.color).toBe('#ffe8a0');
    expect(g.minPlanets).toBe(2);
    expect(g.maxPlanets).toBe(10);
    const m = getStarTypeDef('STAR_M');
    expect(m.name).toBe('Красный карлик');
    expect(m.weight).toBe(76);
  });

  test('6. SPECIAL_STAR_RANGES: 5 записей с физическими диапазонами', () => {
    expect(Object.keys(SPECIAL_STAR_RANGES).sort()).toEqual(
      ['STAR_BH', 'STAR_NS', 'STAR_PULSAR', 'STAR_RG', 'STAR_WD'],
    );
    const wd = SPECIAL_STAR_RANGES['STAR_WD']!;
    expect(wd.massMin).toBe(0.5);
    expect(wd.massMax).toBe(1.4);
    expect(wd.tempMin).toBe(8000);
    expect(wd.tempMax).toBe(40000);
    expect(wd.radiusMin).toBe(0.008);
    expect(wd.radiusMax).toBe(0.02);
    // ГП не имеют ranges
    expect(SPECIAL_STAR_RANGES['STAR_G']).toBeUndefined();
  });

  test('7. MAIN_SEQUENCE_TYPES: Set из 7 ГП, без специальных', () => {
    expect(MAIN_SEQUENCE_TYPES.size).toBe(7);
    expect(MAIN_SEQUENCE_TYPES.has('STAR_G')).toBe(true);
    expect(MAIN_SEQUENCE_TYPES.has('STAR_M')).toBe(true);
    expect(MAIN_SEQUENCE_TYPES.has('STAR_WD')).toBe(false);
    expect(MAIN_SEQUENCE_TYPES.has('STAR_BH')).toBe(false);
  });

  test('8. MAIN_SEQUENCE_STAR_WEIGHTS: 7 весов для выбора компаньонов', () => {
    expect(MAIN_SEQUENCE_STAR_WEIGHTS).toEqual([0.003, 0.1, 0.6, 3, 7.5, 12, 76]);
  });

  test('9. Физическая монотонность: T, M, L строго убывают O→M', () => {
    for (let i = 1; i < MAIN_SEQUENCE_STAR_TYPES.length; i++) {
      const prev = MAIN_SEQUENCE_STAR_TYPES[i - 1]!;
      const cur = MAIN_SEQUENCE_STAR_TYPES[i]!;
      expect(prev.temperature).toBeGreaterThan(cur.temperature);
      expect(prev.mass).toBeGreaterThan(cur.mass);
      expect(prev.luminosity).toBeGreaterThan(cur.luminosity);
    }
  });

  test('10. Спец-веса зафиксированы (WD 1.5 / RG 1.0 / NS 0.68 / PULSAR 0.35 / BH 0.6)', () => {
    const w = (t: string) => STAR_TYPE_MAP.get(t as never)?.weight;
    expect(w('STAR_WD')).toBe(1.5);
    expect(w('STAR_RG')).toBe(1.0);
    expect(w('STAR_NS')).toBe(0.68);
    expect(w('STAR_PULSAR')).toBe(0.35);
    expect(w('STAR_BH')).toBe(0.6);
  });
});

describe('R-STARS-DATA: размерности гекс-сеток (grids.json)', () => {
  test('11. 5 планетарных сеток: tiny=19 … huge=127 (требование владельца: минимум 5)', () => {
    expect(Object.keys(PLANET_GRIDS).length).toBeGreaterThanOrEqual(5);
    expect(PLANET_GRIDS).toEqual({
      tiny: 19, small: 37, medium: 61, large: 91, huge: 127,
    });
  });

  test('12. 2 малые лунные сетки: tiny=7, small=19 (требование владельца)', () => {
    expect(Object.keys(MOON_GRIDS).length).toBeGreaterThanOrEqual(2);
    expect(MOON_GRIDS).toEqual({ tiny: 7, small: 19 });
    // Лунные сетки — действительно малые: max ≤ min планетарной
    expect(Math.max(...Object.values(MOON_GRIDS))).toBeLessThanOrEqual(
      Math.min(...Object.values(PLANET_GRIDS)),
    );
  });

  test('13. Все размерности — центрированные гекс-числа 1+3k(k+1)', () => {
    for (const n of Object.values(PLANET_GRIDS)) expect(isCenteredHex(n)).toBe(true);
    for (const n of Object.values(MOON_GRIDS)) expect(isCenteredHex(n)).toBe(true);
    // Спот-чек формулы: 1 кольцо = 7, 2 кольца = 19, 6 колец = 127
    expect(1 + 3 * 1 * 2).toBe(7);
    expect(1 + 3 * 2 * 3).toBe(19);
    expect(1 + 3 * 6 * 7).toBe(127);
  });

  test('14. Обратная совместимость: SIZE_HEX_COUNT === PLANET_GRIDS, MOON_SIZE_HEX_COUNT === MOON_GRIDS', () => {
    expect(SIZE_HEX_COUNT).toEqual(PLANET_GRIDS);
    expect(MOON_SIZE_HEX_COUNT).toEqual(MOON_GRIDS);
  });

  test('15. generateHexGrid: лунные сетки дают 7/19 гексов', () => {
    const rng1 = new Xoshiro256(1001);
    const tiny = generateHexGrid('tiny', terrainWeights, rng1, MOON_GRIDS);
    expect(tiny.length).toBe(7);
    const rng2 = new Xoshiro256(1002);
    const small = generateHexGrid('small', terrainWeights, rng2, MOON_GRIDS);
    expect(small.length).toBe(19);
  });

  test('16. generateHexGrid: по умолчанию — планетарные сетки (fallback)', () => {
    const rng = new Xoshiro256(1003);
    expect(generateHexGrid('medium', terrainWeights, rng).length).toBe(61);
    const rng2 = new Xoshiro256(1004);
    expect(generateHexGrid('tiny', terrainWeights, rng2).length).toBe(19);
  });
});

describe('R-STARS-DATA: интеграция генератора (звёзды из каталога + луны на малых сетках)', () => {
  test('17. Галактика seed=42: звёзды соответствуют каталогу (все type ∈ 12, цвет из defs)', () => {
    const g = generateGalaxy({ seed: 42, systemCount: 50 });
    expect(g.systems.length).toBe(50);

    let starCount = 0;
    for (const sys of g.systems) {
      for (const star of sys.stars) {
        starCount++;
        // Каждый star.type есть в каталоге
        expect(STAR_TYPE_MAP.has(star.type)).toBe(true);
        // Цвет берётся из каталога
        expect(star.color).toBe(getStarTypeDef(star.type).color);
      }
    }
    expect(starCount).toBeGreaterThan(50); // с компаньонами двойных систем
  });

  test('18. Все луны: size ∈ {tiny, small}, hexes.length ∈ {7, 19} (2 малые сетки)', () => {
    const g = generateGalaxy({ seed: 42, systemCount: 100 });
    const moons = g.systems.flatMap(s => s.planets).flatMap(p => p.moons);
    // 100 систем достаточно, чтобы гарантированно иметь луны
    expect(moons.length).toBeGreaterThan(0);
    for (const m of moons) {
      expect(['tiny', 'small']).toContain(m.size);
      expect([7, 19]).toContain(m.hexes.length);
    }
  });

  test('19. Планеты (кроме газовых гигантов): hexes.length ∈ планетарным сеткам', () => {
    const g = generateGalaxy({ seed: 42, systemCount: 50 });
    const planetHexValues = new Set(Object.values(PLANET_GRIDS));
    planetHexValues.add(0); // газовые гиганты — без поверхности
    for (const sys of g.systems) {
      for (const p of sys.planets) {
        expect(planetHexValues.has(p.hexes.length)).toBe(true);
      }
    }
  });

  test('20. Детерминизм: два вызова generateGalaxy(seed=42, 50) идентичны', () => {
    const strip = (g: ReturnType<typeof generateGalaxy>) => {
      const { systemMap: _sm, bakedModel: _bm, ...rest } = g;
      return JSON.stringify(rest);
    };
    const g1 = generateGalaxy({ seed: 42, systemCount: 50 });
    const g2 = generateGalaxy({ seed: 42, systemCount: 50 });
    expect(strip(g1)).toBe(strip(g2));
  });

  test('21. Компаньоны двойных систем — только из ГП (G-12: без WD/RG/NS/PULSAR/BH)', () => {
    const g = generateGalaxy({ seed: 42, systemCount: 100 });
    let companions = 0;
    for (const sys of g.systems) {
      for (const star of sys.stars.slice(1)) {
        companions++;
        expect(MAIN_SEQUENCE_TYPES.has(star.type)).toBe(true);
      }
    }
    // В 100 системах (~40% двойных/тройных) компаньоны обязаны быть
    expect(companions).toBeGreaterThan(20);
  });

  test('22. Размер луны 2-уровневый: tiny < 0.15 R⊕, иначе small', () => {
    const g = generateGalaxy({ seed: 42, systemCount: 100 });
    for (const sys of g.systems) {
      for (const p of sys.planets) {
        for (const m of p.moons) {
          const rEarth = m.radiusKm / 6371;
          if (rEarth < 0.15) expect(m.size).toBe('tiny');
          else expect(m.size).toBe('small');
        }
      }
    }
  });
});
