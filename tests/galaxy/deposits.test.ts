/// <reference types="bun-types" />
/**
 * Task 37 / D2+D3 tests: распределение и материализация залежей
 * (assignResourceDeposits / aggregateResourceDeposits /
 * materializePlanetDeposits) + регрессии G-05 (shuffle) и G-06 (ultra-rare).
 *
 * Инварианты:
 *   - детерминизм в пределах процесса (один seed → одинаковые залежи/свод);
 *   - значения валидны (qty ≥ 1, 0 < availability ≤ 1, depth 1–5, без NaN);
 *   - ID залежей соответствуют химической модели (BakedGalaxyModel);
 *   - свод-пул согласован с фактическими залежами (доли выхода руд);
 *   - материализация = replay бит-в-бит, идемпотентна, без дублей
 *     (взаимодействие с ленивыми залежами R-29 и снимками RNG в сейве);
 *   - перемешивание Fisher–Yates: перестановка, ровно n−1 вызовов RNG,
 *     равномерность (регрессия G-05: sort-компаратор был смещён и
 *     зависел от алгоритма sort движка);
 *   - ультраредкие: 1-2 УНИКАЛЬНЫХ элемента на планету, tier 'ultra_rare'
 *     (регрессия G-06: повторы выбора, «богатые» кандидаты молча
 *     пропускались, tier затирался классификацией rare);
 *   - G-07: океанские гексы залежей не получают (модель морской добычи
 *     отсутствует — незавершённая возможность, поведение зафиксировано).
 *
 * Run: bun test tests/galaxy/deposits.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  assignResourceDeposits,
  aggregateResourceDeposits,
  materializePlanetDeposits,
  shuffledWithRng,
  WATER_DEPOSIT_ID,
} from '@/galaxy/generate-resources';
import { Xoshiro256 } from '@/core/prng';
import { setCurrentLookups, getCurrentLookups, findContainedElements } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import type { HexCell, HexTerrain } from '@/core/types';

setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

const PLANET_TYPES = ['rocky', 'volcanic', 'ice', 'oceanic', 'desert', 'dwarf'] as const;
const GRID_SIZES = [19, 37, 61];

function mkHexes(n: number, terrain: HexTerrain = 'plains'): HexCell[] {
  return Array.from({ length: n }, (_, i) => ({
    coord: { q: i % 8, r: Math.floor(i / 8) },
    terrain,
    buildingId: null,
    buildingLevel: 0,
    deposits: [],
  }));
}

function sumDepositQty(hexes: HexCell[], elementId: string): number {
  return hexes.reduce((s, h) => s + h.deposits.filter(d => d.elementId === elementId)
    .reduce((ss, d) => ss + d.quantity, 0), 0);
}

describe('D2: assignResourceDeposits — детерминизм и валидность', () => {
  test('1. Один seed → бит-в-бит одинаковые залежи (детерминизм)', () => {
    for (const seed of [1, 42, 777, 123456]) {
      const a = mkHexes(37);
      const b = mkHexes(37);
      assignResourceDeposits(a, new Xoshiro256(seed).derive('deposits'), 'rocky');
      assignResourceDeposits(b, new Xoshiro256(seed).derive('deposits'), 'rocky');
      expect(a).toEqual(b);
    }
  });

  test('2. Значения валидны: qty ≥ 1, 0 < availability ≤ 1, depth 1–5, без NaN (30 планет)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const type of PLANET_TYPES) {
        for (const n of GRID_SIZES) {
          const hexes = mkHexes(n);
          assignResourceDeposits(hexes, new Xoshiro256(seed * 1000 + n).derive('d'), type);
          for (const hex of hexes) {
            for (const d of hex.deposits) {
              expect(Number.isFinite(d.quantity), `${type} qty`).toBe(true);
              expect(d.quantity, `${type} ${d.elementId} qty`).toBeGreaterThanOrEqual(1);
              expect(d.availability, `${type} ${d.elementId} avail`).toBeGreaterThan(0);
              expect(d.availability, `${type} ${d.elementId} avail`).toBeLessThanOrEqual(1);
              expect(Number.isInteger(d.depth)).toBe(true);
              expect(d.depth).toBeGreaterThanOrEqual(1);
              expect(d.depth).toBeLessThanOrEqual(5);
            }
          }
        }
      }
    }
  });

  test('3. ID залежей соответствуют химической модели (oreMap / вода / fallback)', () => {
    const lookups = getCurrentLookups();
    for (let seed = 1; seed <= 3; seed++) {
      for (const type of PLANET_TYPES) {
        const hexes = mkHexes(37);
        assignResourceDeposits(hexes, new Xoshiro256(seed).derive('d'), type);
        for (const hex of hexes) {
          for (const d of hex.deposits) {
            const knownOre = lookups.oreMap.has(d.elementId);
            const isWater = d.elementId === WATER_DEPOSIT_ID;
            // fallback «<элемент>-ore» разрешён только элементам БЕЗ руды в модели
            // (трансурановые Np/Pu/Am)
            const m = /^([A-Za-z]+)-ore$/.exec(d.elementId);
            const fallbackOk = m !== null
              && ELEMENT_MAP.has(m[1]!)
              && lookups.elementToOre[m[1]!] === undefined;
            expect(knownOre || isWater || fallbackOk,
              `${type}: неожидаемый ID залежи ${d.elementId}`).toBe(true);
            // атмосферные соединения залежами не бывают
            expect(lookups.atmosphericMap.has(d.elementId)).toBe(false);
          }
        }
      }
    }
  });

  test('4. Роли руд: metal_ore/mine, nonmetal_ore/quarry, deep_ore/drilling_rig — без смешения', () => {
    // Инвариант данных каталога (docs/34-ores.md §3.1-3.3): каждая руда
    // принадлежит ровно одному добытчику; проверяем на всем oreMap.
    const lookups = getCurrentLookups();
    const roles = new Set<string>();
    for (const ore of lookups.oreMap.values()) {
      roles.add(ore.sourceBuildingId);
      if (ore.type === 'metal_ore') expect(ore.sourceBuildingId).toBe('mine');
      if (ore.type === 'nonmetal_ore') expect(ore.sourceBuildingId).toBe('quarry');
      if (ore.type === 'deep_ore') expect(ore.sourceBuildingId).toBe('drilling_rig');
    }
    expect([...roles].sort()).toEqual(['drilling_rig', 'mine', 'quarry']);
  });

  test('5. Вода (H2O-ice): есть на каждом типе кроме газового гиганта (R-27)', () => {
    for (const type of PLANET_TYPES) {
      const hexes = mkHexes(37);
      assignResourceDeposits(hexes, new Xoshiro256(11).derive('d'), type);
      expect(sumDepositQty(hexes, WATER_DEPOSIT_ID), type).toBeGreaterThan(0);
    }
    // газовый гигант: сетка пуста — ранний return
    const gg: HexCell[] = [];
    assignResourceDeposits(gg, new Xoshiro256(11).derive('d'), 'gas_giant');
    expect(gg.length).toBe(0);
  });

  test('6. Океанские гексы залежей не получают (G-07: модель морской добычи отсутствует)', () => {
    const hexes = Array.from({ length: 20 }, (_, i) => ({
      coord: { q: i, r: 0 },
      terrain: (i % 2 === 0 ? 'ocean' : 'plains') as HexTerrain,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    }));
    assignResourceDeposits(hexes, new Xoshiro256(5).derive('d'), 'oceanic');
    for (const [i, hex] of hexes.entries()) {
      if (hex.terrain === 'ocean') {
        expect(hex.deposits.length, `гекс ${i} (ocean)`).toBe(0);
      }
    }
    expect(hexes.some(h => h.terrain === 'plains' && h.deposits.length > 0)).toBe(true);

    // полностью океанская планета: ранний return, без краша
    const allOcean = mkHexes(19, 'ocean');
    assignResourceDeposits(allOcean, new Xoshiro256(5).derive('d'), 'oceanic');
    expect(allOcean.every(h => h.deposits.length === 0)).toBe(true);
    // свод при этом полон (гарантия всех элементов); hexCount=0 у всех, кроме
    // 1-2 выбранных ультраредких (им явка проставляется как 1)
    const pool = aggregateResourceDeposits(allOcean, 'oceanic', new Xoshiro256(5).derive('u'));
    expect(pool.length).toBe(ELEMENTS.length);
    const withHexes = pool.filter(d => d.hexCount > 0);
    expect(withHexes.length).toBeLessThanOrEqual(2);
    expect(withHexes.every(d => d.tier === 'ultra_rare' && d.totalQuantity <= 6)).toBe(true);
  });
});

describe('D2: свод-пул согласован с залежами (aggregateResourceDeposits)', () => {
  test('7. Пул элементов = Σ по ВСЕМ рудам × доля выхода (±1); H — только из воды (R-27)', () => {
    // Fe содержится не только в Fe-ore (гематит Fe 7/10), но и в Ti-ore/Cu-ore/
    // Ni-ore/Cr-ore/W-ore/Au-ore/Pt-ore — ожидание считаем по всей запечённой
    // модели (химию выходов отдельно гарантирует tests/chemistry.test.ts,
    // здесь проверяется АГРЕГАЦИЯ: полнота источников + корректность долей).
    // H — особый инвариант R-27: ЕДИНСТВЕННЫЙ источник H в залежах — вода
    // (H₂O → H 1.1/10), атмосферные элементы залежей не создают.
    const lookups = getCurrentLookups();
    for (const type of PLANET_TYPES) {
      const hexes = mkHexes(37);
      const rng = new Xoshiro256(21).derive('d');
      assignResourceDeposits(hexes, rng, type);
      const pool = aggregateResourceDeposits(hexes, type, new Xoshiro256(21).derive('u'));

      // ожидание по модели: для каждой руды — её содержимые элементы × доля
      const expected = new Map<string, number>();
      for (const hex of hexes) {
        for (const d of hex.deposits) {
          const contained = findContainedElements(lookups, d.elementId) ?? [];
          const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
          for (const ce of contained) {
            expected.set(ce.elementId, (expected.get(ce.elementId) ?? 0) + d.quantity * (ce.yield / totalYield));
          }
        }
      }
      for (const [elId, expQty] of expected) {
        const entry = pool.find(d => d.elementId === elId)!;
        // Ultra-переопределение может понизить количество до 1-6 — пропускаем
        // такие элементы (их инварианты — в D3-блоке)
        if (ULTRA_RARE_ELEMENTS.includes(elId) && entry.totalQuantity <= 6) continue;
        expect(entry.totalQuantity, `${type} ${elId}`).toBeGreaterThanOrEqual(expQty - 1);
        expect(entry.totalQuantity, `${type} ${elId}`).toBeLessThanOrEqual(expQty + 1);
      }

      // H: вода (H₂O → H 1.1/10) — ЗАЯВЛЕННЫЙ источник (R-27), но не единственный:
      // каменный уголь C-ore тоже содержит H (0.5/10, docs/34-ores.md §3.2.2) —
      // проверяем нижнюю границу по воде, точную сумму даёт model-цикл выше.
      const water = sumDepositQty(hexes, WATER_DEPOSIT_ID);
      expect(water, `${type} вода`).toBeGreaterThan(0);
      const poolH = pool.find(d => d.elementId === 'H')!;
      expect(poolH.totalQuantity, `${type} H`).toBeGreaterThanOrEqual(water * 0.11 - 1);
    }
  });

  test('8. Содержимые элементы каждой руды соответствуют BakedGalaxyModel', () => {
    const lookups = getCurrentLookups();
    for (const type of PLANET_TYPES) {
      const hexes = mkHexes(19);
      assignResourceDeposits(hexes, new Xoshiro256(31).derive('d'), type);
      const pool = aggregateResourceDeposits(hexes, type, new Xoshiro256(31).derive('u'));
      const poolIds = new Set(pool.map(d => d.elementId));
      // каждый элемент, содержащийся в реально сгенерированных рудах, есть в пуле
      for (const hex of hexes) {
        for (const d of hex.deposits) {
          const contained = findContainedElements(lookups, d.elementId) ?? [];
          for (const ce of contained) {
            expect(poolIds.has(ce.elementId), `${type}: ${d.elementId}→${ce.elementId}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('D2: materializePlanetDeposits — ленивые залежи R-29', () => {
  function buildReference(seed: number, type: string, n: number) {
    const reference = mkHexes(n);
    const rng = new Xoshiro256(seed).derive('deposits');
    const snapshot = rng.snapshotState();
    assignResourceDeposits(reference, rng, type);
    return { reference, snapshot };
  }

  test('9. Материализация = replay из снимка (бит-в-бит)', () => {
    for (const [seed, type] of [[42, 'rocky'], [7, 'ice'], [999, 'volcanic']] as const) {
      const { reference, snapshot } = buildReference(seed, type, 37);
      const body = { hexes: mkHexes(37), type, depositsMaterialized: false, depositRngState: [...snapshot] };
      expect(materializePlanetDeposits(body)).toBe(true);
      expect(body.depositsMaterialized).toBe(true);
      expect(body.hexes).toEqual(reference);
    }
  });

  test('10. Идемпотентность: повторный вызов — no-op (флаг)', () => {
    const { snapshot } = buildReference(42, 'rocky', 19);
    const body = { hexes: mkHexes(19), type: 'rocky', depositsMaterialized: false, depositRngState: [...snapshot] };
    materializePlanetDeposits(body);
    const before = body.hexes.map(h => h.deposits.length);
    expect(materializePlanetDeposits(body)).toBe(false);
    expect(body.hexes.map(h => h.deposits.length)).toEqual(before);
  });

  test('11. Hardenening: сброшенный флаг при непустых залежах — replay без дублей', () => {
    // Смешанное состояние (флаг сброшен, залежи уже есть): replay должен
    // ВОССТАНОВИТЬ эталон, а не дописать кортежи поверх (защита от дюпа).
    const { reference, snapshot } = buildReference(42, 'desert', 19);
    const body = { hexes: mkHexes(19), type: 'desert', depositsMaterialized: false, depositRngState: [...snapshot] };
    materializePlanetDeposits(body);
    // частично «истощаем» и сбрасываем флаг (повреждённое состояние)
    body.hexes[0]!.deposits[0]!.quantity = 0;
    body.depositsMaterialized = false;
    expect(materializePlanetDeposits(body)).toBe(true);
    expect(body.hexes).toEqual(reference);
  });

  test('12. Снимок в «сейве» (массив чисел) → fromState → тот же replay', () => {
    const { reference, snapshot } = buildReference(77, 'oceanic', 37);
    // сериализация снимка: обычный JSON-массив (как в сейве v3: body.ds)
    const serialized = JSON.parse(JSON.stringify(snapshot)) as number[];
    const body = {
      hexes: mkHexes(37),
      type: 'oceanic',
      depositsMaterialized: false,
      depositRngState: serialized,
    };
    materializePlanetDeposits(body);
    expect(body.hexes).toEqual(reference);
  });

  test('13. Нет снимка / нет гексов / уже материализовано → false без изменений', () => {
    const hexes = mkHexes(7);
    expect(materializePlanetDeposits({ hexes, type: 'rocky', depositsMaterialized: false, depositRngState: null })).toBe(false);
    expect(materializePlanetDeposits({ hexes: [], type: 'rocky', depositsMaterialized: false, depositRngState: [1, 2, 3, 4] })).toBe(false);
    expect(materializePlanetDeposits({ hexes, type: 'rocky', depositsMaterialized: true, depositRngState: [1, 2, 3, 4] })).toBe(false);
    expect(hexes.every(h => h.deposits.length === 0)).toBe(true);
  });
});

describe('D2/G-05: перемешивание Fisher–Yates (регрессия sort-компаратора)', () => {
  /** Замоканный RNG с заданной последовательностью nextFloat (для точных перестановок). */
  function riggedRng(floats: number[]): Xoshiro256 {
    let i = 0;
    return { nextFloat: () => floats[i++] ?? 0 } as unknown as Xoshiro256;
  }

  test('14. Точная перестановка на замоканном RNG (детерминизм алгоритма)', () => {
    // n=3 → ровно 2 вызова: i=2 (j=floor(u·3)), затем i=1 (j=floor(u·2))
    // [0.99, 0.0]: i=2: j=2 (self-swap) → [A,B,C]; i=1: j=0 → swap(1,0) → [B,A,C]
    expect(shuffledWithRng(['A', 'B', 'C'], riggedRng([0.99, 0.0]))).toEqual(['B', 'A', 'C']);
    // [0.34, 0.51]: i=2: j=floor(1.02)=1 → swap(2,1) → [A,C,B]; i=1: j=1 (self) → [A,C,B]
    expect(shuffledWithRng(['A', 'B', 'C'], riggedRng([0.34, 0.51]))).toEqual(['A', 'C', 'B']);
    // [0.0, 0.0]: i=2: j=0 → [C,B,A]; i=1: j=0 → [B,C,A]
    expect(shuffledWithRng(['A', 'B', 'C'], riggedRng([0.0, 0.0]))).toEqual(['B', 'C', 'A']);
  });

  test('15. Ровно n−1 вызовов RNG; результат — перестановка; исходник не мутируется', () => {
    const N = 61;
    let calls = 0;
    const rng = new Xoshiro256(12345);
    const counting = { nextFloat: () => { calls++; return rng.nextFloat(); } } as unknown as Xoshiro256;
    const src = Array.from({ length: N }, (_, i) => i);
    const arr = shuffledWithRng(src, counting);
    expect(calls).toBe(N - 1);
    expect([...arr].sort((a, b) => a - b)).toEqual(src); // перестановка
    expect(src[0]).toBe(0); // исходник не тронут
    // пустой/одноэлементный массив — 0 вызовов
    calls = 0;
    expect(shuffledWithRng([], counting)).toEqual([]);
    expect(shuffledWithRng([1], counting)).toEqual([1]);
    expect(calls).toBe(0);
  });

  test('16. Равномерность: chi² < порога p=0.01 (было 4637 при sort-компараторе)', () => {
    const N = 19; // df = 18, критическое значение p=0.01: 34.805
    const TRIALS = 10000;
    const posCount = new Array<number>(N).fill(0);
    const rng = new Xoshiro256(2026);
    for (let t = 0; t < TRIALS; t++) {
      const arr = shuffledWithRng(Array.from({ length: N }, (_, i) => i), rng);
      const idx = arr.indexOf(0);
      posCount[idx] = posCount[idx]! + 1;
    }
    const expected = TRIALS / N;
    const chi2 = posCount.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(34.805);
  });

  test('17. Воспроизводимость: один seed → одна перестановка (кросс-вызов)', () => {
    const a = shuffledWithRng([1, 2, 3, 4, 5, 6, 7, 8], new Xoshiro256(777));
    const b = shuffledWithRng([1, 2, 3, 4, 5, 6, 7, 8], new Xoshiro256(777));
    expect(a).toEqual(b);
  });
});

describe('D3/G-06: ультраредкие элементы (1-2 уникальных для планеты)', () => {
  /** Подпись выбранного ultra: следовое количество, hexCount=1, maxAvail=0.05. */
  function ultraSignatures(pool: ReturnType<typeof aggregateResourceDeposits>, type: string) {
    const profile = new Set(PROFILE_ELEMENTS[type as keyof typeof PROFILE_ELEMENTS] ?? []);
    return pool.filter(d =>
      ULTRA_RARE_ELEMENTS.includes(d.elementId)
      && !profile.has(d.elementId)
      && d.hexCount === 1
      && d.maxAvailability === 0.05
      && d.totalQuantity <= 6);
  }

  test('18. Статистика 100 seed × 1200 планет: у КАЖДОЙ 1-2 УНИКАЛЬНЫХ ultra, все tier=ultra_rare', () => {
    let withTwo = 0;
    let total = 0;
    for (let seed = 1; seed <= 100; seed++) {
      for (const type of PLANET_TYPES) {
        for (const n of [19, 61] as const) {
          const hexes = mkHexes(n);
          assignResourceDeposits(hexes, new Xoshiro256(seed * 100 + n).derive('d'), type);
          const pool = aggregateResourceDeposits(hexes, type, new Xoshiro256(seed * 100 + n).derive('u'));
          total++;
          const sig = ultraSignatures(pool, type);
          // ГЛАВНАЯ регрессия G-06: раньше 6.9% планет не получали НИ ОДНОГО
          expect(sig.length, `${type} seed${seed} n${n}: 0 ультраредких`).toBeGreaterThanOrEqual(1);
          expect(sig.length).toBeLessThanOrEqual(2);
          if (sig.length === 2) withTwo++;
          // уникальность (без повторов выбора)
          const ids = sig.map(s => s.elementId);
          expect(new Set(ids).size).toBe(ids.length);
          // tier исправлен (раньше 87% выбранных получали 'rare')
          for (const s of sig) {
            expect(s.tier, `${s.elementId} tier`).toBe('ultra_rare');
            expect(ULTRA_RARE_ELEMENTS).toContain(s.elementId);
            expect(RARE_ELEMENTS.includes(s.elementId) || ['Li', 'V'].includes(s.elementId)).toBe(true);
          }
        }
      }
    }
    expect(total).toBeGreaterThanOrEqual(1000);
    // nextInt(1,2) даёт 1 или 2 ~50/50 — проверяем разумный разброс
    const twoShare = withTwo / total;
    expect(twoShare).toBeGreaterThan(0.3);
    expect(twoShare).toBeLessThan(0.7);
  });

  test('19. Выбранный ultra из пересечения RARE∩ULTRA всё же ultra_rare (не rare)', () => {
    // Ищем планету, где выбран элемент из RARE_ELEMENTS (пересечение множеств)
    let foundOverlapCase = false;
    for (let seed = 1; seed <= 40 && !foundOverlapCase; seed++) {
      const hexes = mkHexes(37);
      assignResourceDeposits(hexes, new Xoshiro256(seed).derive('d'), 'rocky');
      const pool = aggregateResourceDeposits(hexes, 'rocky', new Xoshiro256(seed).derive('u'));
      for (const d of ultraSignatures(pool, 'rocky')) {
        if (RARE_ELEMENTS.includes(d.elementId)) {
          expect(d.tier).toBe('ultra_rare'); // прежде было 'rare'
          foundOverlapCase = true;
          break;
        }
      }
    }
    expect(foundOverlapCase, 'хотя бы одна планета с ultra из пересечения множеств').toBe(true);
  });

  test('20. Профильные элементы не выбираются как ultra', () => {
    // volcanic: V профильный → не кандидат; проверяем на 30 планетах
    for (let seed = 1; seed <= 30; seed++) {
      const hexes = mkHexes(37);
      assignResourceDeposits(hexes, new Xoshiro256(seed).derive('d'), 'volcanic');
      const pool = aggregateResourceDeposits(hexes, 'volcanic', new Xoshiro256(seed).derive('u'));
      const sig = ultraSignatures(pool, 'volcanic');
      expect(sig.every(s => s.elementId !== 'V')).toBe(true);
      expect(sig.every(s => s.tier !== 'profile')).toBe(true);
    }
  });
});
