/// <reference types="bun-types" />
/**
 * Block 07 — Statistical PRNG tests (audit §2.3, gap-3).
 *
 * Verifies that the corrected xoshiro256** port produces statistically
 * uniform and independent output.
 *
 * Tests:
 *   1. Chi-square uniformity: 100 000 nextFloat() values in [0, 1) are
 *      binned into 100 buckets of width 0.01 (expected 1000 each).
 *      chi-square statistic must be below the α=0.01 critical value for
 *      df=99 (≈ 134.68) — α=0.01 is used per the spec's flakiness escape
 *      hatch (Block 07 checkpoint §3.4).
 *   2. derive() independence: 4 derive streams ('arms', 'stars',
 *      'planets', 'chemistry') of 10 000 nextFloat() values each.
 *      Pearson correlation between every pair of streams must have
 *      |r| < 0.05 (well above the α=0.01 critical threshold of ~0.0257
 *      for N=10 000 — non-flaky).
 *   3. Birthday test: 65 536 nextU32() values from a fixed seed — expect
 *      ~1 collision (theoretical mean for 32-bit birthday paradox with
 *      N=65 536 is ≈ 0.5; observed ≈ 1 consistently for xoshiro256**
 *      output sequence). Assert collisions ≤ 5 to catch badly broken
 *      PRNGs without flakiness.
 *
 * NOTE: these tests use fixed seeds and deterministic assertions — no
 * flakiness expected on a correctly-implemented xoshiro256** port.
 *
 * Run: bun test tests/prng-statistical.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { Xoshiro256 } from '@/core/prng';

/**
 * Chi-square statistic for uniformity.
 *
 * Bins N samples into B buckets of equal width on [0, 1) and computes:
 *   chi² = Σ (observed_i - expected)² / expected
 * where expected = N / B for each bucket.
 *
 * @param values    N samples in [0, 1)
 * @param buckets   number of buckets (e.g. 100 for 0.01-wide bins)
 * @returns         chi-square statistic (lower = more uniform)
 */
function chiSquareUniform(values: number[], buckets: number): number {
  const counts = new Array(buckets).fill(0);
  for (const v of values) {
    // Clamp to [0, buckets-1] — values strictly less than 1 land in the
    // correct bucket; the Math.min guards against rare rounding to buckets.
    const idx = Math.min(buckets - 1, Math.floor(v * buckets));
    counts[idx]++;
  }
  const expected = values.length / buckets;
  let chi = 0;
  for (const c of counts) {
    chi += ((c - expected) ** 2) / expected;
  }
  return chi;
}

/**
 * Pearson product-moment correlation between two equal-length numeric
 * sequences. Returns a value in [-1, +1]; ~0 indicates no linear
 * correlation (independence).
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) {
    throw new Error('pearsonCorrelation: sequences must be non-empty and equal-length');
  }
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  for (let i = 0; i < n; i++) {
    // noUncheckedIndexedAccess — both arrays are equal length and bounded by n.
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const num = sumXY - n * meanX * meanY;
  const den = Math.sqrt((sumX2 - n * meanX * meanX) * (sumY2 - n * meanY * meanY));
  if (den === 0) return 0;
  return num / den;
}

describe('Block 07: PRNG statistical quality', () => {
  test('1. Chi-square uniformity — 100 000 nextFloat() values in 100 buckets (α=0.01)', () => {
    // Arrange: collect 100 000 nextFloat() values from a fixed seed.
    const N = 100_000;
    const buckets = 100;
    const rng = new Xoshiro256(42);
    const values: number[] = [];
    for (let i = 0; i < N; i++) {
      const v = rng.nextFloat();
      // Range invariant: every value must be in [0, 1).
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      values.push(v);
    }

    // Act: compute chi-square statistic.
    const chi = chiSquareUniform(values, buckets);

    // Assert: chi² must be below the α=0.01 critical value for df=99
    // (≈ 134.68). We use α=0.01 per the spec's flakiness escape hatch
    // (Block 07 checkpoint §3.4) — observed chi² for xoshiro256** is
    // typically in the 70–110 range, well below the threshold.
    //
    // For reference: α=0.05 critical for df=99 is ≈ 123.23.
    const chiCriticalAlpha001 = 134.68;
    expect(chi).toBeLessThan(chiCriticalAlpha001);

    // Sanity: also assert mean ≈ 0.5 (uniform[0,1) theoretical mean).
    // Theoretical mean of sample mean ≈ 0.5 ± 1/√(12N) ≈ 0.5 ± 0.00091.
    // Allow ±0.005 to absorb sampling noise.
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / N;
    expect(mean).toBeGreaterThan(0.495);
    expect(mean).toBeLessThan(0.505);
  });

  test('2. derive() independence — 4 streams, pairwise |r| < 0.05 (N=10 000 each)', () => {
    // Arrange: build a parent PRNG and derive 4 named sub-streams.
    const parent = new Xoshiro256(42);
    const streamNames = ['arms', 'stars', 'planets', 'chemistry'] as const;
    const N = 10_000;

    const streams: Record<string, number[]> = {};
    for (const name of streamNames) {
      const rng = parent.derive(name);
      const arr: number[] = [];
      for (let i = 0; i < N; i++) {
        arr.push(rng.nextFloat());
      }
      streams[name] = arr;
    }

    // Sanity: each stream's mean is in [0.48, 0.52] (uniform[0,1) mean = 0.5).
    for (const name of streamNames) {
      const arr = streams[name];
      if (!arr) continue;
      let sum = 0;
      for (const v of arr) sum += v;
      const mean = sum / N;
      expect(mean).toBeGreaterThan(0.48);
      expect(mean).toBeLessThan(0.52);
    }

    // Act + Assert: every pairwise Pearson correlation must have |r| < 0.05.
    // With N=10 000, the critical |r| at α=0.01 is ~0.0257, so the 0.05
    // threshold is comfortably above the noise floor (no flakiness).
    for (let i = 0; i < streamNames.length; i++) {
      for (let j = i + 1; j < streamNames.length; j++) {
        const a = streamNames[i]!;
        const b = streamNames[j]!;
        const xs = streams[a];
        const ys = streams[b];
        if (!xs || !ys) continue;
        const r = pearsonCorrelation(xs, ys);
        const abs = Math.abs(r);
        expect(abs).toBeLessThan(0.05);
      }
    }
  });

  test('3. Birthday test — 65 536 nextU32() values from seed=42, collisions ≤ 5', () => {
    // Theoretical expected collisions for 65 536 random 32-bit integers:
    //   E[pairs] = C(N, 2) / 2^32 = N(N-1) / (2 * 2^32) ≈ 0.500
    // Empirically observed for xoshiro256**: 0 or 1 collisions per seed
    // (the spec calls this "~1 collision"). Allow up to 5 to absorb
    // random variation without flakiness; a badly-broken PRNG would
    // produce hundreds of collisions, easily tripping this threshold.
    const N = 65_536;
    const rng = new Xoshiro256(42);

    const seen = new Set<number>();
    let collisions = 0;
    for (let i = 0; i < N; i++) {
      const v = rng.nextU32();
      if (seen.has(v)) {
        collisions++;
      } else {
        seen.add(v);
      }
    }

    // Assert: collisions count is "around 1" — upper bound 5 absorbs noise,
    // lower bound 0 (no collisions is also a valid outcome).
    expect(collisions).toBeGreaterThanOrEqual(0);
    expect(collisions).toBeLessThanOrEqual(5);

    // Sanity: unique count must equal N - collisions.
    expect(seen.size).toBe(N - collisions);
  });
});
