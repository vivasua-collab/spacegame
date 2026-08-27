/// <reference types="bun-types" />
/**
 * Block 03 — T-R2 — Cost formulas.
 *
 * Tests per plan §7 T-R2:
 *   - getTechCost(800, 1) === 800
 *   - getTechCost(800, 5) === 4050
 *   - getCumulativeCost(800, 3) === 3800
 *   - getMinResearchTime(800) === 10 (base)
 *   - getMinResearchTime(15000) === 15
 *   - getTechCost(level=0) returns 0 (impossible level)
 *   - getEstimatedCompletionTime with effectiveRPPerSec=0 → Infinity
 *
 * Run: bun test tests/research/cost-formulas.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  getTechCost,
  getCumulativeCost,
  getMinResearchTime,
  getEstimatedCompletionTime,
} from '@/research/engine';

describe('Block 03 T-R2 — Cost formulas', () => {
  describe('getTechCost — level cost', () => {
    test('getTechCost(800, 1) === 800 (base cost)', () => {
      expect(getTechCost(800, 1)).toBe(800);
    });

    test('getTechCost(800, 5) === 4050 (×1.5^4 ≈ 5.0625)', () => {
      // floor(800 × 1.5^4) = floor(800 × 5.0625) = 4050
      expect(getTechCost(800, 5)).toBe(4050);
    });

    test('getTechCost(800, 2) === 1200 (×1.5^1)', () => {
      expect(getTechCost(800, 2)).toBe(1200);
    });

    test('getTechCost(800, 3) === 1800 (×1.5^2 = 2.25)', () => {
      expect(getTechCost(800, 3)).toBe(1800);
    });

    test('getTechCost(500, 1) === 500', () => {
      expect(getTechCost(500, 1)).toBe(500);
    });

    test('getTechCost(500, 10) === 19221 (×1.5^9 ≈ 38.443)', () => {
      // floor(500 × 1.5^9) = floor(500 × 38.443359375) = floor(19221.6796875) = 19221
      expect(getTechCost(500, 10)).toBe(19221);
    });

    test('getTechCost(800, 0) === 0 (invalid level)', () => {
      expect(getTechCost(800, 0)).toBe(0);
    });

    test('getTechCost(800, -1) === 0 (invalid level)', () => {
      expect(getTechCost(800, -1)).toBe(0);
    });
  });

  describe('getCumulativeCost — sum of levels 1..N', () => {
    test('getCumulativeCost(800, 3) === 3800 (800 + 1200 + 1800)', () => {
      expect(getCumulativeCost(800, 3)).toBe(3800);
    });

    test('getCumulativeCost(800, 1) === 800', () => {
      expect(getCumulativeCost(800, 1)).toBe(800);
    });

    test('getCumulativeCost(800, 0) === 0', () => {
      expect(getCumulativeCost(800, 0)).toBe(0);
    });

    test('getCumulativeCost(800, 5) === 800+1200+1800+2700+4050 = 10550', () => {
      // 800 + 1200 + 1800 + 2700 + 4050 = 10550
      expect(getCumulativeCost(800, 5)).toBe(10550);
    });

    test('getCumulativeCost(500, 3) === 500+750+1125 = 2375', () => {
      expect(getCumulativeCost(500, 3)).toBe(2375);
    });
  });

  describe('getMinResearchTime — floor baseCost/1000, min 10', () => {
    test('getMinResearchTime(800) === 10 (800/1000=0.8 < 10, floor to 10)', () => {
      expect(getMinResearchTime(800)).toBe(10);
    });

    test('getMinResearchTime(15000) === 15 (15000/1000=15)', () => {
      expect(getMinResearchTime(15000)).toBe(15);
    });

    test('getMinResearchTime(10000) === 10 (exactly 10)', () => {
      expect(getMinResearchTime(10000)).toBe(10);
    });

    test('getMinResearchTime(100000) === 100 (large cost)', () => {
      expect(getMinResearchTime(100000)).toBe(100);
    });

    test('getMinResearchTime(100) === 10 (small cost, floor to 10)', () => {
      expect(getMinResearchTime(100)).toBe(10);
    });
  });

  describe('getEstimatedCompletionTime', () => {
    test('getEstimatedCompletionTime(800, 100, 800) === 8 sec', () => {
      expect(getEstimatedCompletionTime(800, 100, 800)).toBe(8);
    });

    test('getEstimatedCompletionTime(800, 0, 800) === Infinity (no RP/sec)', () => {
      expect(getEstimatedCompletionTime(800, 0, 800)).toBe(Infinity);
    });

    test('getEstimatedCompletionTime(800, -5, 800) === Infinity', () => {
      expect(getEstimatedCompletionTime(800, -5, 800)).toBe(Infinity);
    });

    test('getEstimatedCompletionTime(0, 100, 800) === 0 (no RP needed)', () => {
      expect(getEstimatedCompletionTime(0, 100, 800)).toBe(0);
    });
  });
});
