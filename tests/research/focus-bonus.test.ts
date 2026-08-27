/// <reference types="bun-types" />
/**
 * Block 03 — T-R4 — Focus bonus + effective RP/sec.
 *
 * Tests per plan §7 T-R4:
 *   - getFocusBonus(1, 100) === 1.2 (1 slot, 100% allocation)
 *   - getFocusBonus(2, 50) === 1.0 (multiple slots, no focus)
 *   - getFocusBonus(1, 50) === 1.0 (1 slot but not 100%)
 *   - getEffectiveRPPerSec(100, 100, 1, 0) === 120
 *   - getEffectiveRPPerSec with activeSlots=0 returns 0
 *
 * Run: bun test tests/research/focus-bonus.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { getFocusBonus, getEffectiveRPPerSec } from '@/research/engine';

describe('Block 03 T-R4 — Focus bonus', () => {
  describe('getFocusBonus', () => {
    test('getFocusBonus(1, 100) === 1.2 (single slot at 100%)', () => {
      expect(getFocusBonus(1, 100)).toBe(1.2);
    });

    test('getFocusBonus(2, 50) === 1.0 (multiple slots)', () => {
      expect(getFocusBonus(2, 50)).toBe(1.0);
    });

    test('getFocusBonus(1, 50) === 1.0 (single slot but not 100%)', () => {
      expect(getFocusBonus(1, 50)).toBe(1.0);
    });

    test('getFocusBonus(0, 100) === 1.0 (no active slots)', () => {
      expect(getFocusBonus(0, 100)).toBe(1.0);
    });

    test('getFocusBonus(1, 99) === 1.0 (just below 100%)', () => {
      expect(getFocusBonus(1, 99)).toBe(1.0);
    });

    test('getFocusBonus(3, 100) === 1.0 (multiple slots even at 100%)', () => {
      expect(getFocusBonus(3, 100)).toBe(1.0);
    });

    test('getFocusBonus(1, 100) === 1.2 (exactly 100 boundary)', () => {
      expect(getFocusBonus(1, 100)).toBe(1.2);
    });

    test('getFocusBonus(1, 150) === 1.2 (over 100 — capped)', () => {
      // allocation can't exceed 100 normally, but bonus applies anyway
      expect(getFocusBonus(1, 150)).toBe(1.2);
    });
  });

  describe('getEffectiveRPPerSec', () => {
    test('getEffectiveRPPerSec(100, 100, 1, 0) === 120 (focus ×1.2)', () => {
      // 100 × (100/100) × 1.2 = 120
      expect(getEffectiveRPPerSec(100, 100, 1, 0)).toBe(120);
    });

    test('getEffectiveRPPerSec(100, 50, 1, 0) === 50 (no focus, 50%)', () => {
      // 100 × 0.5 × 1.0 = 50
      expect(getEffectiveRPPerSec(100, 50, 1, 0)).toBe(50);
    });

    test('getEffectiveRPPerSec(100, 50, 2, 0) === 50 (2 slots, 50% each)', () => {
      // 100 × 0.5 × 1.0 = 50 (focus only on single slot at 100%)
      expect(getEffectiveRPPerSec(100, 50, 2, 0)).toBe(50);
    });

    test('getEffectiveRPPerSec(0, 100, 1, 0) === 0 (no total RP)', () => {
      expect(getEffectiveRPPerSec(0, 100, 1, 0)).toBe(0);
    });

    test('getEffectiveRPPerSec(100, 0, 1, 0) === 0 (0% allocation)', () => {
      expect(getEffectiveRPPerSec(100, 0, 1, 0)).toBe(0);
    });

    test('getEffectiveRPPerSec(100, 100, 0, 0) === 0 (no active slots)', () => {
      expect(getEffectiveRPPerSec(100, 100, 0, 0)).toBe(0);
    });

    test('getEffectiveRPPerSec(200, 100, 1, 0) === 240 (double RP, focus)', () => {
      expect(getEffectiveRPPerSec(200, 100, 1, 0)).toBe(240);
    });
  });
});
