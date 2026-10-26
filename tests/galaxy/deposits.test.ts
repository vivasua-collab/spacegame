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
  DEPOSIT_RNG_VERSION,
} from '@/galaxy/generate-resources';
import { Xoshiro128StarStar } from '@/core/prng';
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
      assignResourceDeposits(a, new Xoshiro128StarStar(seed).derive('deposits'), 'rocky');
      assignResourceDeposits(b, new Xoshiro128StarStar(seed).derive('deposits'), 'rocky');
      expect(a).toEqual(b);
    }
  });

  test('2. Значения валидны: qty ≥ 1, 0 < availability ≤ 1, depth 1–5, без NaN (30 планет)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const type of PLANET_TYPES) {
        for (const n of GRID_SIZES) {
          const hexes = mkHexes(n);
          assignResourceDeposits(hexes, new Xoshiro128StarStar(seed * 1000 + n).derive('d'), type);
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
        assignResourceDeposits(hexes, new Xoshiro128StarStar(seed).derive('d'), type);
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
      assignResourceDeposits(hexes, new Xoshiro128StarStar(11).derive('d'), type);
      expect(sumDepositQty(hexes, WATER_DEPOSIT_ID), type).toBeGreaterThan(0);
    }
    // газовый гигант: сетка пуста — ранний return
    const gg: HexCell[] = [];
    assignResourceDeposits(gg, new Xoshiro128StarStar(11).derive('d'), 'gas_giant');
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
    assignResourceDeposits(hexes, new Xoshiro128StarStar(5).derive('d'), 'oceanic');
    for (const [i, hex] of hexes.entries()) {
      if (hex.terrain === 'ocean') {
        expect(hex.deposits.length, `гекс ${i} (ocean)`).toBe(0);
      }
    }
    expect(hexes.some(h => h.terrain === 'plains' && h.deposits.length > 0)).toBe(true);

    // полностью океанская планета: ранний return, без краша
    const allOcean = mkHexes(19, 'ocean');
    assignResourceDeposits(allOcean, new Xoshiro128StarStar(5).derive('d'), 'oceanic');
    expect(allOcean.every(h => h.deposits.length === 0)).toBe(true);
    // R-37 (Б3): свод — ЧИСТАЯ геологическая оценка: у ВСЕХ записей hexCount=0
    // (нет поверхности — нет ни залежей, ни «повышенной концентрации» выбранного
    // ultra). Пул НЕ сообщает о залежах, отсутствующих в гексах.
    const pool = aggregateResourceDeposits(allOcean, 'oceanic', new Xoshiro128StarStar(5).derive('d'));
    expect(pool.length).toBe(ELEMENTS.length);
    expect(pool.filter(d => d.hexCount > 0), 'океанский мир: физических записей нет').toHaveLength(0);
    expect(pool.every(d => d.hexCount === 0)).toBe(true);
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
      const rng = new Xoshiro128StarStar(21).derive('d');
      assignResourceDeposits(hexes, rng, type);
      const pool = aggregateResourceDeposits(hexes, type, new Xoshiro128StarStar(21).derive('u'));

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
        // R-37 (Б3): пропусков БОЛЬШЕ НЕТ — пул = агрегация ВСЕЙ физики,
        // включая усиленную залежь выбранного ultra (прежде ultra-перезапись
        // в пуле принуждала пропускать проверку суммирования).
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
      assignResourceDeposits(hexes, new Xoshiro128StarStar(31).derive('d'), type);
      const pool = aggregateResourceDeposits(hexes, type, new Xoshiro128StarStar(31).derive('u'));
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
    const rng = new Xoshiro128StarStar(seed).derive('deposits');
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
    // R-37: ds НЕ обнуляется при материализации — восстановление по снимку
    // работает и для старых сейвов (dm=1 + ds писались вместе до R-37).
    const { reference, snapshot } = buildReference(42, 'desert', 19);
    const body = { hexes: mkHexes(19), type: 'desert', depositsMaterialized: false, depositRngState: [...snapshot] };
    materializePlanetDeposits(body);
    // частично «истощаем» и сбрасываем флаг (повреждённое состояние)
    body.hexes[0]!.deposits[0]!.quantity = 0;
    body.depositsMaterialized = false;
    expect(materializePlanetDeposits(body)).toBe(true);
    expect(body.hexes).toEqual(reference);
  });

  test('11a. R-37: материализация ПЕРЕСЧИТЫВАЕТ свод-пул из физики (Б2/Б3)', () => {
    // Тело с пулом: после replay пул = агрегация свежих залежей — та же
    // функция, продолжение того же потока, что и при генерации ⇒ бит-в-бит.
    // Эталон строится ТОЧНО как при генерации: snapshot → assign → агрегация
    // продолжением того же rng.
    const reference = mkHexes(37);
    const genRng = new Xoshiro128StarStar(42).derive('deposits');
    const snapshot = genRng.snapshotState();
    assignResourceDeposits(reference, genRng, 'rocky');
    const poolAtGen = aggregateResourceDeposits(reference, 'rocky', genRng);

    const body = {
      hexes: mkHexes(37), type: 'rocky', depositsMaterialized: false,
      depositRngState: [...snapshot], resourceDeposits: [{ elementId: 'Xx', totalQuantity: 999, avgAvailability: 0.5, tier: 'rare', hexCount: 1, maxAvailability: 0.5 } as never],
    };
    expect(materializePlanetDeposits(body)).toBe(true);
    expect(body.resourceDeposits).toEqual(poolAtGen); // бит-в-бит с генерацией
    // и согласован с независимой суммой физики (проверка суммы — без пропусков)
    const lookups = getCurrentLookups();
    const expected = new Map<string, number>();
    for (const hex of body.hexes) {
      for (const d of hex.deposits) {
        const contained = findContainedElements(lookups, d.elementId) ?? [];
        const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
        for (const ce of contained) {
          expected.set(ce.elementId, (expected.get(ce.elementId) ?? 0) + d.quantity * (ce.yield / totalYield));
        }
      }
    }
    for (const [elId, expQty] of expected) {
      const entry = body.resourceDeposits.find(d => d.elementId === elId)!;
      expect(entry.totalQuantity, `${elId}`).toBeGreaterThanOrEqual(expQty - 1);
      expect(entry.totalQuantity, `${elId}`).toBeLessThanOrEqual(expQty + 1);
    }
    // заглушка без пула не трогается (поле отсутствует)
    const stub = { hexes: mkHexes(7), type: 'rocky', depositsMaterialized: false, depositRngState: [...snapshot] };
    materializePlanetDeposits(stub);
    expect('resourceDeposits' in stub).toBe(false);
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
  function riggedRng(floats: number[]): Xoshiro128StarStar {
    let i = 0;
    return { nextFloat: () => floats[i++] ?? 0 } as unknown as Xoshiro128StarStar;
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
    const rng = new Xoshiro128StarStar(12345);
    const counting = { nextFloat: () => { calls++; return rng.nextFloat(); } } as unknown as Xoshiro128StarStar;
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
    const rng = new Xoshiro128StarStar(2026);
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
    const a = shuffledWithRng([1, 2, 3, 4, 5, 6, 7, 8], new Xoshiro128StarStar(777));
    const b = shuffledWithRng([1, 2, 3, 4, 5, 6, 7, 8], new Xoshiro128StarStar(777));
    expect(a).toEqual(b);
  });
});

describe('D3/G-06: уникальный ресурс планеты (1-2 из пула ULTRA_RARE, R-37)', () => {
  const lookups = getCurrentLookups();

  /**
   * R-37: выбор живёт в assignResourceDeposits — опознаём ВЫБРАННЫЕ элементы
   * по физической подписи усиленной залежи: руда ultra-пула, qty ∈ [4,6],
   * availability ∈ [0.03,0.10], depth ∈ {4,5}. Следы — qty ≤ 3; богатая ветка
   * (15% гексов; fallback для льда может выбрать любой не-атмосферный элемент,
   * вкл. ultra-пул — pre-existing) — availability ≥ 0.5, qty 200+, depth 1-3.
   */
  function findChosenUltra(hexes: HexCell[], type: string) {
    const profile = new Set(PROFILE_ELEMENTS[type as keyof typeof PROFILE_ELEMENTS] ?? []);
    const chosen = new Map<string, { hex: HexCell; deposit: { elementId: string; availability: number; quantity: number; depth: number } }>();
    for (const hex of hexes) {
      for (const d of hex.deposits) {
        const m = /^([A-Za-z]+)-ore$/.exec(d.elementId);
        const el = m?.[1];
        if (!el || !ULTRA_RARE_ELEMENTS.includes(el)) continue;
        const boosted = d.quantity >= 4 && d.quantity <= 6
          && d.availability >= 0.03 - 1e-9 && d.availability <= 0.10 + 1e-9
          && d.depth >= 4;
        if (boosted) {
          expect(chosen.has(el), `${el}: усиленная залежь одна`).toBe(false);
          chosen.set(el, { hex, deposit: d });
        }
      }
    }
    return { chosen, profile };
  }

  test('18. Статистика 100 seed × 1200 планет: у КАЖДОЙ 1-2 уникальных, физика = своду', () => {
    let withTwo = 0;
    let total = 0;
    for (let seed = 1; seed <= 100; seed++) {
      for (const type of PLANET_TYPES) {
        for (const n of [19, 61] as const) {
          const hexes = mkHexes(n);
          const rng = new Xoshiro128StarStar(seed * 100 + n).derive('d');
          assignResourceDeposits(hexes, rng, type);
          const pool = aggregateResourceDeposits(hexes, type, rng);
          total++;
          const { chosen, profile } = findChosenUltra(hexes, type);
          // ГЛАВНАЯ регрессия G-06: у каждой планеты 1-2 уникальных ресурса
          expect(chosen.size, `${type} seed${seed} n${n}: 0 уникальных`).toBeGreaterThanOrEqual(1);
          expect(chosen.size).toBeLessThanOrEqual(2);
          if (chosen.size === 2) withTwo++;
          for (const [elId, { hex, deposit }] of chosen) {
            // подпись усиленной залежи (контракт R-37)
            expect(deposit.quantity).toBeGreaterThanOrEqual(4);
            expect(deposit.quantity).toBeLessThanOrEqual(6);
            expect(deposit.depth).toBeGreaterThanOrEqual(4);
            expect(deposit.depth).toBeLessThanOrEqual(5);
            expect(deposit.availability).toBeGreaterThanOrEqual(0.03 - 1e-9);
            expect(deposit.availability).toBeLessThanOrEqual(0.10 + 1e-9);
            expect(hex.terrain).not.toBe('ocean');
            // R-36: выбор строго из спека-пула docs/31 §2; пулы НЕ пересекаются
            expect(ULTRA_RARE_ELEMENTS).toContain(elId);
            expect(RARE_ELEMENTS.includes(elId), `${elId} не из RARE`).toBe(false);
            expect(profile.has(elId), `${elId} не профильный`).toBe(false);
            // РЕГРЕССИЯ Б3 (аудит R-37): отображаемая концентрация = физике
            const contained = findContainedElements(lookups, deposit.elementId)!;
            const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
            const fraction = contained.find(ce => ce.elementId === elId)!.yield / totalYield;
            const entry = pool.find(d => d.elementId === elId)!;
            expect(entry).toBeDefined();
            expect(entry.totalQuantity, `${elId}: пул = Σ(физика × доля)`).toBeGreaterThanOrEqual(deposit.quantity * fraction - 1);
            expect(entry.totalQuantity, `${elId}: пул = Σ(физика × доля)`).toBeLessThanOrEqual(deposit.quantity * fraction + 1);
            expect(entry.hexCount, `${elId}: один гекс`).toBe(1);
            expect(entry.tier, `${elId} tier`).toBe('ultra_rare');
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

  test('19. R-36: выбранный ultra извлекаем буровой (deep_ore/drilling_rig, порог ≤ 10)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const hexes = mkHexes(37);
      assignResourceDeposits(hexes, new Xoshiro128StarStar(seed).derive('d'), 'rocky');
      const { chosen } = findChosenUltra(hexes, 'rocky');
      expect(chosen.size).toBeGreaterThanOrEqual(1);
      for (const elId of chosen.keys()) {
        const ore = lookups.oreMap.get(`${elId}-ore`);
        expect(ore?.sourceBuildingId, `${elId}-ore`).toBe('drilling_rig');
        expect(ore?.minSourceLevel ?? 0, `${elId}: порог достижим буровой L10`).toBeLessThanOrEqual(10);
      }
    }
  });

  test('20. Профильные элементы не выбираются как ultra', () => {
    // volcanic: V профильный → не кандидат; проверяем на 30 планетах
    for (let seed = 1; seed <= 30; seed++) {
      const hexes = mkHexes(37);
      assignResourceDeposits(hexes, new Xoshiro128StarStar(seed).derive('d'), 'volcanic');
      const { chosen } = findChosenUltra(hexes, 'volcanic');
      expect(chosen.has('V'), 'V профильный — не кандидат').toBe(false);
    }
  });

  test('21. R-36/R-37: все 10 руд пула присутствуют; у выбранного — единственная усиленная залежь', () => {
    // Базовое присутствие ultra_rare минимально (docs/31 §1.1/§3.2): следовые
    // залежи всех 10 руд (depth 4-5, availability ≤ 0.13, qty ≤ 3). ВЫБРАННЫЙ
    // (1-2 элемента) — исключение: его залежи (следы И богатые) стёрты,
    // вместо них одна усиленная залежь (qty 4-6, depth 4-5, avail 0.03-0.10).
    // ВНИМАНИЕ: богатая ветка (15% гексов) для льда падает в fallback «любой
    // не-атмосферный элемент» и может дать богатую залежь ultra-руды
    // НЕвыбранного элемента (pre-existing) — у не-выбранных проверяем
    // следовые залежи, богатые не запрещены.
    for (const type of PLANET_TYPES) {
      const hexes = mkHexes(61);
      assignResourceDeposits(hexes, new Xoshiro128StarStar(77).derive('d'), type);
      const { chosen } = findChosenUltra(hexes, type);
      expect(chosen.size, `${type}: уникальные есть`).toBeGreaterThanOrEqual(1);
      for (const el of ULTRA_RARE_ELEMENTS) {
        const oreId = lookups.elementToOre[el] ?? `${el}-ore`;
        const allDeps = hexes.flatMap(h => h.deposits.filter(d => d.elementId === oreId));
        if (chosen.has(el)) {
          // выбранный: ровно одна залежь — усиленная (следы/богатые стёрты)
          expect(allDeps.length, `${type} ${oreId}: единственная усиленная`).toBe(1);
          const d = allDeps[0]!;
          expect(d.quantity).toBeGreaterThanOrEqual(4);
          expect(d.quantity).toBeLessThanOrEqual(6);
          expect(d.depth).toBeGreaterThanOrEqual(4);
          expect(d.depth).toBeLessThanOrEqual(5);
          expect(d.availability).toBeLessThanOrEqual(0.10 + 1e-9);
          continue;
        }
        const traceDeps = allDeps.filter(d => d.availability <= 0.13 + 1e-9 && d.depth >= 4);
        expect(traceDeps.length, `${type} ${oreId}: следовые залежи есть`).toBeGreaterThan(0);
        for (const d of traceDeps) {
          expect(d.depth, `${type} ${oreId} depth`).toBeGreaterThanOrEqual(4);
          expect(d.depth, `${type} ${oreId} depth`).toBeLessThanOrEqual(5);
          // следовая ветка: base 0.02-0.10 × пер-гексовый множитель 0.7-1.3
          expect(d.availability, `${type} ${oreId} avail`).toBeLessThanOrEqual(0.13 + 1e-9);
          expect(d.quantity, `${type} ${oreId} qty следовое`).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe('D4/R-36: состав пулов = спека docs/31 §2 (guard-тесты «третьего источника»)', () => {
  /** Спека docs/31-resources.md §2 — РЕДКИЕ (перечень дословно). */
  const DOCS31_RARE = ['Co', 'W', 'Mo', 'V', 'Ag', 'Pt', 'Au', 'U', 'Li', 'Be'];
  /** Спека docs/31-resources.md §2 — УНИКАЛЬНЫЕ (перечень дословно). */
  const DOCS31_ULTRA = ['Ir', 'Os', 'Re', 'Ru', 'Rh', 'Pd', 'Hf', 'Ta', 'Nb', 'Zr'];

  test('22. RARE_ELEMENTS / ULTRA_RARE_ELEMENTS дословно равны перечням спеки', () => {
    expect([...RARE_ELEMENTS].sort()).toEqual([...DOCS31_RARE].sort());
    expect([...ULTRA_RARE_ELEMENTS].sort()).toEqual([...DOCS31_ULTRA].sort());
  });

  test('23. Пулы дизъюнктны; каждый элемент пула — из своего класса rarity (надкласс elements.ts)', () => {
    const rareSet = new Set(RARE_ELEMENTS);
    const ultraSet = new Set(ULTRA_RARE_ELEMENTS);
    for (const el of rareSet) expect(ultraSet.has(el), `${el} в обоих пулах`).toBe(false);
    for (const el of RARE_ELEMENTS) {
      expect(ELEMENT_MAP.get(el)?.rarity, `${el} rarity`).toBe('rare');
    }
    for (const el of ULTRA_RARE_ELEMENTS) {
      expect(ELEMENT_MAP.get(el)?.rarity, `${el} rarity`).toBe('ultra_rare');
    }
  });

  test('24. Всякий элемент пула ULTRA_RARE имеет deep_ore/drilling_rig (добываем буровой, MVP)', () => {
    const lookups = getCurrentLookups();
    for (const el of ULTRA_RARE_ELEMENTS) {
      const oreId = lookups.elementToOre[el];
      expect(oreId, `${el}: руда есть в хим.модели`).toBeDefined();
      const ore = lookups.oreMap.get(oreId!);
      expect(ore?.type, `${el} тип руды`).toBe('deep_ore');
      expect(ore?.sourceBuildingId, `${el} добытчик`).toBe('drilling_rig');
      // порог глубины достижим максимальным уровнем здания (10)
      expect(ore?.minSourceLevel ?? 0, `${el} minSourceLevel ≤ 10`).toBeLessThanOrEqual(10);
    }
  });

  test('25. R-37: кандидаты выбора уникального ресурса никогда не пусты (выбор в assign)', () => {
    // R-37: выбор живёт в assignResourceDeposits (фаза в конце потока);
    // кандидаты = ULTRA_RARE_ELEMENTS минус профильные (пересечение пусто —
    // проверено ниже), поэтому «кандидатский пул не пуст» — инвариант данных,
    // а не фильтра eligibleUltra (удалён вместе с перезаписью пула).
    for (const type of PLANET_TYPES) {
      const profile = new Set(PROFILE_ELEMENTS[type as keyof typeof PROFILE_ELEMENTS] ?? []);
      const candidates = ULTRA_RARE_ELEMENTS.filter(e => !profile.has(e));
      expect(candidates.length, `${type}: кандидаты ultra`).toBeGreaterThan(0);
      expect(candidates.length).toBe(ULTRA_RARE_ELEMENTS.length); // пересечение пусто
    }
    // и выбор реально происходит: у каждой планеты есть усиленная залежь
    for (const type of PLANET_TYPES) {
      const hexes = mkHexes(37);
      assignResourceDeposits(hexes, new Xoshiro128StarStar(7).derive('d'), type);
      const chosenCount = hexes.flatMap(h => h.deposits)
        .filter(d => {
          const m = /^([A-Za-z]+)-ore$/.exec(d.elementId);
          return m !== null && ULTRA_RARE_ELEMENTS.includes(m[1]!) && d.quantity >= 4;
        }).length;
      expect(chosenCount, `${type}: усиленные залежи`).toBeGreaterThanOrEqual(1);
    }
  });
});
