/// <reference types="bun-types" />
/**
 * R-35 (P1 аудита этапа 2): эталонные векторы канонического xoshiro128** 1.1.
 *
 * Векторы сгенерированы ОФИЦИАЛЬНЫМ C-кодом Д. Блэкмана и С. Вигны
 * (http://prng.di.unimi.it/xoshiro128starstar.c, версия 1.1; файл получен
 * 2026-10-26), скомпилированным gcc -O2 (-Wall -Wextra, 0 предупреждений).
 * Харнесс: /home/z/prng-ref/harness.c (копия официального next()/rotl() +
 * официальный splitmix64.c; сидирование — конвенция проекта: state[i] =
 * младшие 32 бита i-го выхода splitMix64 от z=(uint64)(int64)seed).
 *
 * ЧТО ИМЕННО ПРОВЕРЯЕТСЯ (и что НЕ проверяли прежние тесты среднего/std):
 *  1. SEED-векторы: splitMix64-сидирование (4 слова состояния) и первые
 *     8 выходов nextU32() для 10 seed (включая отрицательный и 2^53−1)
 *     бит-в-бит совпадают с C — т.е. переход состояния и скрамблер ТОЧНО
 *     соответствуют эталону, а не просто «выглядят случайно».
 *  2. STATE-векторы: путь fromState() (мимо splitMix64) — 5 состояний.
 *  3. SM64-векторы: полный uint64-выход splitMix64 (проверка BigInt-пути).
 *  4. Обратная совместимость макета: snapshotState() → fromState() →
 *     тот же поток (контракт сейвов v3, поле ds).
 *
 * Контекст: до R-35 класс назывался Xoshiro256 и использовал константы
 * 64-битного xoshiro256** (t = s1 << 17, rotl(s3, 45)) на 32-битных словах —
 * неэталонный «мешап». Официальные константы xoshiro128**: t = s1 << 9,
 * rotl(s3, 11).
 *
 * Run: bun test tests/prng-reference.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { Xoshiro128StarStar } from '@/core/prng';

/** hex → uint32-число (числа со старшим битом в JS представляют знаковые int32;
 *  nextU32() возвращает >>> 0 — сравнение ведём в том же домене). */
function u32(hex: string): number {
  return Number.parseInt(hex, 16) >>> 0;
}

/** Первые n выходов nextU32() для генератора, созданного из seed. */
function firstOutputs(seed: number, n: number): number[] {
  const rng = new Xoshiro128StarStar(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextU32());
  return out;
}

/** Первые n выходов nextU32() для генератора из snapshot-состояния. */
function firstOutputsFromState(state: number[], n: number): number[] {
  const rng = Xoshiro128StarStar.fromState(state);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextU32());
  return out;
}

/** Разбор строки харнесса «… out <hex> <hex> …» в массив uint32. */
function outs(hexes: string[]): number[] {
  return hexes.map(u32);
}

describe('R-35 P1: xoshiro128** 1.1 — эталонные векторы (официальный C-код)', () => {
  // Харнесс: SEED <seed> state <s0> <s1> <s2> <s3> out <8 выходов>
  const seedVectors: Array<{
    seed: number; state: string[]; out: string[];
  }> = [
    {
      seed: 0,
      state: ['7b1dcdaf', 'a1b965f4', '8009454f', '724c81ec'],
      out: ['cb75f2b4', '49564572', '176fe55d', 'a6810796', '81cc281b', 'd764943a', '371cfcf1', '945701ee'],
    },
    {
      seed: 1,
      state: ['89025cc1', '658eec67', 'fb32555e', 'ee42c90b'],
      out: ['0fc711e5', '47364e13', '641142c2', '1fe9de23', 'ceea4bf6', '9a50f962', 'f8a175aa', '9cb4ef4b'],
    },
    {
      seed: 7,
      state: ['59320dd7', 'f43c661c', 'bab12a02', '673e29cb'],
      out: ['4ef97972', '4f482c93', 'e27877b0', '0e0b5d29', '14dcaaa0', '5f8e32dd', 'e7ece97d', '7df872b5'],
    },
    {
      seed: 42,
      state: ['2feb6e95', 'b266f103', '130f9f52', '0e4ae394'],
      out: ['0c2ec5ae', '6d113d84', 'efb7993e', 'bb7e773a', '9fc5a7ed', '5b282046', '6285ea86', 'ee262922'],
    },
    {
      seed: 12345,
      state: ['a9d111a0', 'f713f8ed', '80e6721d', '5c3f42ca'],
      out: ['4160d831', '37a68983', 'c593d175', '4dd2870b', '3e092243', 'd5141057', 'a47bcd97', 'fdd6077f'],
    },
    {
      seed: 999999,
      state: ['459887ed', 'bd9d0202', '9c53b2f4', '3d122728'],
      out: ['4cad302a', '93d7e3ca', '897b51d6', '18f124e8', '123ffc73', 'ecb01a0e', 'db103ee1', '2a336716'],
    },
    {
      seed: 2147483647,
      state: ['261a4be7', '9e76a5c7', '7465df5e', 'a119b4be'],
      out: ['6d91fdec', 'ced9976e', '5df652d1', '3fca61a9', '63ed4d43', 'e09a6421', 'e0420d4e', '6d9ac040'],
    },
    {
      seed: 4294967295,
      state: ['aff181c0', '1340d3b4', '47275e73', '3ced4b8e'],
      out: ['329b53b0', 'b00ea194', '7dc3dc9e', 'c1f2e0e9', '76531a8c', '08b46f00', 'b79d7706', '644a1b03'],
    },
    {
      // 2^53 − 1: верхняя граница безопасных целых JS (путь BigInt(Math.trunc(seed))).
      seed: 9007199254740991,
      state: ['efb6559f', 'b73ff198', '83f9875c', '34340ac6'],
      out: ['1ebbde9a', '5b1b80c4', '9049536a', '7b511307', '2e742f6f', '8362a676', '086af545', '6c6be80f'],
    },
    {
      // Отрицательный seed: two's complement uint64 (как в C-харнессе).
      seed: -7,
      state: ['43822970', 'bcf192aa', 'd7350611', 'eddad0c2'],
      out: ['3b63f418', '37ae5b04', '8bc42749', '8756425e', '40851412', '89db2bd8', '57f9f47a', 'b03c3c0f'],
    },
  ];

  test('1. SEED-векторы: сидирование splitMix64 + первые 8 выходов = C-эталон', () => {
    for (const v of seedVectors) {
      const rng = new Xoshiro128StarStar(v.seed);
      const snapshot = rng.snapshotState().map((w) => (w >>> 0).toString(16).padStart(8, '0'));
      expect(snapshot, `seed ${v.seed}: слова состояния`).toEqual(v.state);
      const got = firstOutputs(v.seed, 8);
      expect(got.map((w) => (w >>> 0).toString(16).padStart(8, '0')), `seed ${v.seed}: выходы`)
        .toEqual(v.out);
      expect(got, `seed ${v.seed}: числовое сравнение`).toEqual(outs(v.out));
    }
  });

  // Харнесс: STATE <s0> <s1> <s2> <s3> out <8 выходов>
  const stateVectors: Array<{ state: number[]; out: string[] }> = [
    {
      state: [1, 0, 0, 0],
      out: ['00000000', '00001680', '00001680', '002d1680', '00e10000', 'fa2d1680', '5ae12d00', '5b9500b4'],
    },
    {
      state: [0xdeadbeef, 0xcafebabe, 0x0badc0de, 0xfeedface],
      out: ['6369b753', 'e4469447', '2d6ee7f1', '1a8c0ce9', 'd4be7c7d', 'b198877e', '4e96b746', '161bc0a8'],
    },
    {
      state: [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f],
      out: ['394a6a3e', '2da0ce97', '7b872fb4', '92504037', '933d3487', '99e174a9', '2afe1259', '607fe0a3'],
    },
    {
      state: [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
      out: ['ffffedf7', 'ffffedf7', 'ffd30477', '002ce980', '59ffe980', '0eb3e980', '9fd3018c', 'f179172b'],
    },
    {
      state: [0, 1, 2, 3],
      out: ['00001680', '00004380', '002d4380', '01ef2d00', '9b3b1689', 'e7ef8709', '4abf2ff4', '0ce15b17'],
    },
  ];

  test('2. STATE-векторы: fromState() → поток = C-эталон', () => {
    for (const v of stateVectors) {
      const got = firstOutputsFromState(v.state, 8);
      expect(got.map((w) => (w >>> 0).toString(16).padStart(8, '0')),
        `state [${v.state.join(', ')}]`).toEqual(v.out);
    }
  });

  test('3. SM64-векторы: сидирование — низкие 32 бита полного uint64-выхода splitMix64', () => {
    // Харнесс: SM64 0 full e220a8397b1dcdaf 6e789e6aa1b965f4 …
    // Слово состояния xoshiro = младшие 32 бита каждого полного выхода.
    const sm64: Array<{ seed: number; full: string[] }> = [
      {
        seed: 0,
        full: ['e220a8397b1dcdaf', '6e789e6aa1b965f4', '06c45d188009454f', 'f88bb8a8724c81ec'],
      },
      {
        seed: 42,
        full: ['bdd732262feb6e95', '28efe333b266f103', '47526757130f9f52', '581ce1ff0e4ae394'],
      },
    ];
    for (const v of sm64) {
      const rng = new Xoshiro128StarStar(v.seed);
      const snapshot = rng.snapshotState().map((w) => (w >>> 0).toString(16).padStart(8, '0'));
      const expectedLow = v.full.map((h) => h.slice(-8)); // младшие 32 бита
      expect(snapshot, `SM64 seed ${v.seed}: low-32 слов`).toEqual(expectedLow);
    }
  });

  test('4. Совместимость макета сейвов: snapshotState → fromState → бит-в-бит тот же поток', () => {
    // Контракт поля ds (save format v3, R-29): снимок 4×uint32 восстанавливает
    // поток РОВНО (макет не менялся при миграции R-35 — см. шапку prng.ts).
    const rng = new Xoshiro128StarStar(4242);
    rng.nextU32(); rng.nextU32(); rng.nextU32(); // сдвинуть состояние
    const snap = rng.snapshotState();

    const restored = Xoshiro128StarStar.fromState(snap);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 32; i++) {
      a.push(rng.nextU32());
      b.push(restored.nextU32());
    }
    expect(b).toEqual(a);

    // Снимок — копия, не ссылка: дальнейшая эволюция исходного не меняет снимок.
    rng.nextU32(); rng.nextU32();
    expect(rng.snapshotState()).not.toEqual(snap);
  });

  test('5. Стабильность констант миграции: выход seed 42 отличается от до-R-35 мешапа', () => {
    // Регрессионная привязка миграции: первый выход seed 42 при КАНОНИЧЕСКОМ
    // xoshiro128** = 0x0c2ec5ae. До R-35 (константы 17/45 от xoshiro256**)
    // тот же seed давал ДРУГОЕ число — тест фиксирует, что откат к мешапу
    // замечен мгновенно (и что сами векторы не «подогнаны» под старый поток).
    expect(new Xoshiro128StarStar(42).nextU32()).toBe(0x0c2ec5ae);
  });
});
