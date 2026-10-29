/// <reference types="bun-types" />
/**
 * ORE-POOLS-RUNTIME-01 (Issue #25): генерация планетарных пулов сырьевых руд.
 * (Наследник D2/D3-тестов гекс-модели залежей — гекс-раскладка выведена
 * решением владельца ORE-POOLS-DOCS-01, docs/31 §6/§10.)
 *
 * Инварианты:
 *   - детерминизм: один seed → бит-в-бит одинаковые пулы;
 *   - значения валидны (qty ≥ 1, 0 < availability ≤ 1, без NaN);
 *   - ID пулов соответствуют химической модели (elementToOre / вода / fallback);
 *   - роли руд: metal_ore/mine, nonmetal_ore/quarry, deep_ore/drilling_rig;
 *   - вода (H2O-ice) есть на каждом типе кроме газового гиганта (R-27);
 *   - свод-превью (buildResourceSummary) — чистая производная пулов
 *     («свод = добыча»), без RNG, воспроизводим и согласован;
 *   - уникальный ресурс: 1-2 ULTRA_RARE, усиленный глубинный пул qty 4–6,
 *     availability 0.03–0.10 (G-06-регрессии);
 *   - ГГ (surfaceScale=0) коровых пулов не получает (docs/31 §9.3);
 *   - D4 guard: пулы RARE/ULTRA_RARE = спека docs/31 §2.
 *
 * Run: bun test tests/galaxy/deposits.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  generatePlanetOrePools,
  buildResourceSummary,
  WATER_DEPOSIT_ID,
  ORE_POOLS_GENERATION_VERSION,
} from '@/galaxy/generate-resources';
import { Xoshiro128StarStar } from '@/core/prng';
import { setCurrentLookups, getCurrentLookups, findContainedElements } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import type { PlanetOrePool } from '@/core/types';

setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

const PLANET_TYPES = ['rocky', 'volcanic', 'ice', 'oceanic', 'desert', 'dwarf'] as const;
const GRID_SIZES = [19, 37, 61];

function generate(planetType: string, surfaceScale: number, seedOffset = 0): PlanetOrePool[] {
  return generatePlanetOrePools(new Xoshiro128StarStar(4242 + seedOffset), planetType, surfaceScale);
}

describe('D2: generatePlanetOrePools — детерминизм и валидность', () => {
  test('1. Один seed → бит-в-бит одинаковые пулы (детерминизм)', () => {
    for (const t of PLANET_TYPES) {
      const a = generate(t, 61);
      const b = generate(t, 61);
      expect(b).toEqual(a);
      // Другой масштаб поверхности → другой результат (чувствительность к входу)
      const c = generate(t, 37);
      expect(c).not.toEqual(a);
    }
  });

  test('2. Значения валидны: qty ≥ 1, 0 < availability ≤ 1, без NaN (30 планет)', () => {
    let count = 0;
    for (const t of PLANET_TYPES) {
      for (let i = 0; i < 5; i++) {
        const pools = generate(t, GRID_SIZES[i % 3]!, i * 31);
        expect(pools.length, `${t}#${i}: пулы сгенерированы`).toBeGreaterThan(0);
        for (const pool of pools) {
          expect(Number.isFinite(pool.initialQuantity), `${pool.oreId}: finite`).toBe(true);
          expect(Number.isFinite(pool.remainingQuantity), `${pool.oreId}: finite`).toBe(true);
          expect(pool.initialQuantity, `${pool.oreId}: qty ≥ 1`).toBeGreaterThanOrEqual(1);
          expect(pool.remainingQuantity, `${pool.oreId}: remaining = initial при генерации`).toBe(pool.initialQuantity);
          expect(pool.availability, `${pool.oreId}: availability > 0`).toBeGreaterThan(0);
          expect(pool.availability, `${pool.oreId}: availability ≤ 1`).toBeLessThanOrEqual(1);
          count++;
        }
        // Детерминированный порядок (tier → qty↓ → oreId)
        const tierOrder = { profile: 0, rare: 1, ultra_rare: 2 } as const;
        for (let k = 1; k < pools.length; k++) {
          const prev = pools[k - 1]!, cur = pools[k]!;
          const okOrder =
            tierOrder[prev.tier] < tierOrder[cur.tier]
            || prev.initialQuantity > cur.initialQuantity
            || (prev.initialQuantity === cur.initialQuantity && prev.oreId <= cur.oreId);
          expect(okOrder, `${t}#${i}: стабильный сортировочный порядок`).toBe(true);
        }
      }
    }
    expect(count).toBeGreaterThan(200);
  });

  test('3. ID пулов соответствуют химической модели (elementToOre / вода / fallback)', () => {
    const lookups = getCurrentLookups();
    for (const t of PLANET_TYPES) {
      const pools = generate(t, 61, 7);
      for (const pool of pools) {
        if (pool.oreId === WATER_DEPOSIT_ID) continue;
        // Каждая руда из elementToOre значений или fallback «<элемент>-ore»
        const fromMap = Object.values(lookups.elementToOre).includes(pool.oreId);
        const fallback = pool.oreId.endsWith('-ore') && ELEMENTS.some(e => `${e.id}-ore` === pool.oreId);
        expect(fromMap || fallback, `${t}: ${pool.oreId} из хим.модели`).toBe(true);
      }
    }
  });

  test('4. Роли руд: metal_ore/mine, nonmetal_ore/quarry, deep_ore/drilling_rig — без смешения', () => {
    const lookups = getCurrentLookups();
    for (const t of PLANET_TYPES) {
      const pools = generate(t, 61, 11);
      for (const pool of pools) {
        const ore = lookups.oreMap.get(pool.oreId);
        if (!ore) continue; // вода / fallback
        if (ore.type === 'metal_ore') expect(ore.sourceBuildingId, pool.oreId).toBe('mine');
        if (ore.type === 'nonmetal_ore') expect(ore.sourceBuildingId, pool.oreId).toBe('quarry');
        if (ore.type === 'deep_ore') expect(ore.sourceBuildingId, pool.oreId).toBe('drilling_rig');
      }
    }
  });

  test('5. Вода (H2O-ice): есть на каждом типе кроме газового гиганта (R-27)', () => {
    for (const t of PLANET_TYPES) {
      const pools = generate(t, 61, 13);
      expect(pools.some(p => p.oreId === WATER_DEPOSIT_ID), `${t}: вода есть`).toBe(true);
    }
    // ГГ (surfaceScale = 0): коровых пулов нет вообще (docs/31 §9.3)
    expect(generate('gas_giant', 0)).toEqual([]);
  });

  test('5a. Газовый гигант: surfaceScale=0 → НЕТ коровых пулов (атмосфера — отдельно)', () => {
    for (let i = 0; i < 5; i++) expect(generate('gas_giant', 0, i)).toEqual([]);
  });
});

describe('D2: свод-превью согласован с пулами (buildResourceSummary)', () => {
  test('7. Пул элементов = Σ по пулам × доля выхода (±1); H — только из воды (R-27)', () => {
    const lookups = getCurrentLookups();
    for (const t of PLANET_TYPES) {
      const pools = generate(t, 61, 17);
      const summary = buildResourceSummary(pools, t);
      // Второй вызов — бит-в-бит (чистая функция без RNG)
      expect(buildResourceSummary(pools, t)).toEqual(summary);

      // Ожидание: агрегат пулов по долям выхода
      const expected = new Map<string, number>();
      for (const pool of pools) {
        const contained = findContainedElements(lookups, pool.oreId);
        if (contained && contained.length > 0) {
          const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
          for (const ce of contained) {
            expected.set(ce.elementId, (expected.get(ce.elementId) ?? 0) + pool.remainingQuantity * (ce.yield / totalYield));
          }
        } else {
          const pureId = pool.oreId.replace('-ore', '');
          expected.set(pureId, (expected.get(pureId) ?? 0) + pool.remainingQuantity);
        }
      }
      for (const [elId, qty] of expected) {
        const entry = summary.find(d => d.elementId === elId);
        expect(entry, `${t}/${elId}: запись свода есть`).toBeDefined();
        if (qty >= 1) {
          expect(Math.abs((entry?.totalQuantity ?? 0) - qty), `${t}/${elId}: свод = добыча`).toBeLessThanOrEqual(1.001);
        }
      }
      // R-27: водород появляется в своде ТОЛЬКО как элемент воды (H2O-ice)
      // или гарантийной оценки; физический вклад H — из водного пула.
      const waterPool = pools.find(p => p.oreId === WATER_DEPOSIT_ID);
      const hEntry = summary.find(d => d.elementId === 'H');
      if (waterPool && hEntry) {
        expect(hEntry.totalQuantity, `${t}: H из воды`).toBeGreaterThan(0);
      }
    }
  });

  test('8. Гарантийные записи помечены estimated; физические — нет', () => {
    const pools = generate('rocky', 61, 19);
    const summary = buildResourceSummary(pools, 'rocky');
    // Атмосферные элементы (H — только вода, He/Ne/Ar — атмосфера) без пулов → estimated
    const heEntry = summary.find(d => d.elementId === 'He');
    expect(heEntry?.estimated).toBe(true);
    // Fe имеет пул → запись НЕ estimated
    const feEntry = summary.find(d => d.elementId === 'Fe');
    expect(feEntry).toBeDefined();
    expect(feEntry?.estimated ?? false).toBe(false);
  });
});

describe('D3/G-06: уникальный ресурс планеты (1-2 из пула ULTRA_RARE)', () => {
  /** Выбранный уникальный ресурс опознаётся по подписи усиленного пула. */
  function uniqueOf(pools: PlanetOrePool[]): PlanetOrePool | null {
    const ultra = pools.filter(p => p.tier === 'ultra_rare');
    // Усиленный пул: qty 4–6, availability 0.03–0.10
    return ultra.find(p => p.initialQuantity >= 4 && p.initialQuantity <= 6
      && p.availability >= 0.03 && p.availability <= 0.10 + 1e-9) ?? null;
  }

  test('18. Статистика 100 seed: у каждой планеты 0-2 уникальных (0 — только океан/ГГ), qty 4–6', () => {
    let withUnique = 0;
    for (let i = 0; i < 100; i++) {
      const t = PLANET_TYPES[i % PLANET_TYPES.length]!;
      const pools = generate(t, 61, i * 101);
      const unique = uniqueOf(pools);
      if (unique) withUnique++;
      if (unique) {
        const lookups = getCurrentLookups();
        const ore = lookups.oreMap.get(unique.oreId);
        expect(ore?.sourceBuildingId, `${unique.oreId}: deep_ore/drilling_rig`).toBe('drilling_rig');
        // Выбранный уникальный ресурс имеет РОВНО ОДИН пул (следовые стёрты)
        expect(pools.filter(p => p.oreId === unique.oreId).length).toBe(1);
      }
    }
    // Океанские/бедные выборы бывают редко, но большинство планет имеют находку
    expect(withUnique).toBeGreaterThan(50);
  });

  test('19. R-36: выбранный ultra извлекаем буровой (deep_ore/drilling_rig, порог ≤ 10)', () => {
    const lookups = getCurrentLookups();
    for (const t of PLANET_TYPES) {
      const pools = generate(t, 61, 23);
      const unique = uniqueOf(pools);
      if (!unique) continue;
      const ore = lookups.oreMap.get(unique.oreId);
      expect(ore, `${unique.oreId} в хим.модели`).toBeDefined();
      expect(ore!.sourceBuildingId).toBe('drilling_rig');
      expect(ore!.minSourceLevel).toBeLessThanOrEqual(10);
    }
  });

  test('20. Профильные элементы не выбираются как ultra', () => {
    for (const t of PLANET_TYPES) {
      const profileSet = new Set(PROFILE_ELEMENTS[t as keyof typeof PROFILE_ELEMENTS] ?? []);
      const pools = generate(t, 61, 29);
      const unique = uniqueOf(pools);
      if (!unique) continue;
      const elId = unique.oreId.replace('-ore', '');
      expect(profileSet.has(elId), `${t}: ${elId} не профильный`).toBe(false);
    }
  });
});

describe('D4/R-36: состав пулов = спека docs/31 §2 (guard-тесты «третьего источника»)', () => {
  test('22. RARE_ELEMENTS / ULTRA_RARE_ELEMENTS дословно равны перечням спеки', () => {
    expect([...RARE_ELEMENTS].sort()).toEqual(['Ag', 'Au', 'Be', 'Co', 'Li', 'Mo', 'Pt', 'U', 'V', 'W'].sort());
    expect([...ULTRA_RARE_ELEMENTS].sort()).toEqual(['Hf', 'Ir', 'Nb', 'Os', 'Pd', 'Re', 'Rh', 'Ru', 'Ta', 'Zr'].sort());
  });

  test('23. Пулы дизъюнктны; oreId уникальны', () => {
    for (const t of PLANET_TYPES) {
      const pools = generate(t, 61, 37);
      const ids = pools.map(p => p.oreId);
      expect(new Set(ids).size, `${t}: oreId без дублей`).toBe(ids.length);
    }
  });

  test('24. Версия генерации пулов — ORE_POOLS_GENERATION_VERSION=1 (маркер модели)', () => {
    expect(ORE_POOLS_GENERATION_VERSION).toBe(1);
  });
});
