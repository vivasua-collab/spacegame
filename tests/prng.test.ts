/// <reference types="bun-types" />
/**
 * Block 01 — T1 PRNG determinism tests.
 *
 * Tests (matches T1 spec from `checkpoints/08_27_block_01_stabilization.md` §4):
 *   1. Determinism: 5 different seeds → 100 nextU32() values per seed form a
 *      sequence that's identical to a second instance with the same seed.
 *   2. derive() independence: derive('arms') and derive('stars') produce
 *      independent (different) sequences from the same parent PRNG.
 *   3. derive() determinism: derive('arms') called twice on a fresh parent
 *      PRNG produces an identical 10-value sequence.
 *   4. Uniformity: 10 000 nextFloat() values in [0, 1) — mean ∈ [0.48, 0.52]
 *      and std ≈ 1/√12 ≈ 0.2887 (theoretical uniform[0,1) std).
 *
 * API NOTE: The codebase's PRNG class is `Xoshiro256` (exported from
 * `@/core/prng`). It accepts only number seeds. The task description mentions
 * string seeds ('alpha', 'galaxy-v1') — to keep the test meaningful we hash
 * them via FNV-1a before constructing the PRNG. This mirrors what a real
 * string-seed consumer would do; it preserves both determinism (same string
 * → same number → same sequence) and independence (different strings hash to
 * different numbers → different sequences).
 *
 * Run: bun test tests/prng.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { Xoshiro256 } from '@/core/prng';

/** FNV-1a 32-bit hash — converts a string seed to a number for Xoshiro256. */
function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Build a fresh PRNG from a string|number seed (hash applied for strings). */
function makeRng(seed: string | number): Xoshiro256 {
  return new Xoshiro256(hashSeed(seed));
}

/** Collect N nextU32() values from a fresh PRNG instance. */
function takeU32(seed: string | number, n: number): number[] {
  const rng = makeRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextU32());
  return out;
}

describe('Block 01 T1: PRNG determinism', () => {
  // The 5 seeds from the T1 spec — 3 numeric, 2 string. For string seeds
  // we hash via FNV-1a (see `hashSeed` above) since `Xoshiro256` only
  // accepts numbers.
  const seeds: Array<string | number> = [42, 12345, 9999, 'alpha', 'galaxy-v1'];

  test('1. Same seed → identical nextU32() sequence (100 values)', () => {
    for (const seed of seeds) {
      const a = takeU32(seed, 100);
      const b = takeU32(seed, 100);
      expect(a).toEqual(b);
    }
  });

  test('2. derive("arms") and derive("stars") produce independent sequences', () => {
    const seed = 42;
    const armsRng = makeRng(seed).derive('arms');
    const starsRng = makeRng(seed).derive('stars');

    const arms: number[] = [];
    const stars: number[] = [];
    for (let i = 0; i < 100; i++) {
      arms.push(armsRng.nextU32());
      stars.push(starsRng.nextU32());
    }

    // Independent streams must NOT be identical. (If `derive()` were broken
    // and produced the same sequence for any name, this would catch it.)
    expect(arms).not.toEqual(stars);

    // Stronger: at least one position must differ. A correctly-implemented
    // PRNG with two different derive names should differ at nearly every
    // position; we only require > 0 to make the test non-vacuous.
    let equalAt = 0;
    for (let i = 0; i < arms.length; i++) {
      if (arms[i] === stars[i]) equalAt++;
    }
    expect(equalAt).toBeLessThan(arms.length);
  });

  test('3. derive("arms") called twice → identical 10-value sequence (deterministic)', () => {
    const seed = 42;
    const a: number[] = [];
    const b: number[] = [];
    const rngA = makeRng(seed).derive('arms');
    for (let i = 0; i < 10; i++) a.push(rngA.nextU32());
    const rngB = makeRng(seed).derive('arms');
    for (let i = 0; i < 10; i++) b.push(rngB.nextU32());
    expect(a).toEqual(b);
  });

  test('4. Uniformity: 10 000 nextFloat() values — mean ∈ [0.48, 0.52], std ∈ [0.27, 0.31]', () => {
    const N = 10_000;
    const rng = makeRng(42);

    let sum = 0;
    const values: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = rng.nextFloat();
      values.push(v);
      sum += v;
    }
    const mean = sum / N;

    // Range invariant: nextFloat() ∈ [0, 1).
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }

    // Mean tolerance. Theoretical mean for uniform[0,1) is 0.5; std of the
    // sample mean = 1/sqrt(12N) ≈ 0.0029, so a real production PRNG should
    // land within ±0.01 of 0.5. The spec asks for [0.48, 0.52] (tolerant
    // floor) — xoshiro256** comfortably clears this.
    expect(mean).toBeGreaterThanOrEqual(0.48);
    expect(mean).toBeLessThanOrEqual(0.52);

    // Std of uniform[0,1) = 1/√12 ≈ 0.288675. Allow ±0.02 slack to absorb
    // sampling noise (theoretical std of sample std ≈ 0.002 for N=10 000).
    let sqSum = 0;
    for (const v of values) sqSum += (v - mean) ** 2;
    const std = Math.sqrt(sqSum / N);
    expect(std).toBeGreaterThan(0.27);
    expect(std).toBeLessThan(0.31);
  });
});
