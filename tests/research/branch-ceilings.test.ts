/// <reference types="bun-types" />
/**
 * Block 03 — T-R6 — Branch ceilings (fundamental ↔ specialized).
 *
 * Tests per plan §7 T-R6:
 *   - getEffectiveMaxLevel('materials', {chemistry:5, engineering:2}) === 3
 *   - getEffectiveMaxLevel('computing', {chemistry:5}) === Infinity
 *   - getPartialBonus('weapons', {engineering:4}) === 1.2
 *   - getPartialBonus('computing', {chemistry:5}) === 1.25
 *   - All fundamentals = 0 → ceiling = 0 for non-free branches
 *   - getTechCeiling returns min(tech.maxLevel, branch ceiling)
 *
 * Run: bun test tests/research/branch-ceilings.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  getEffectiveMaxLevel,
  getPartialBonus,
  getTechCeiling,
  createDefaultResearchState,
} from '@/research/engine';
import { TECH_MAP } from '@/data/research/tech-tree';
import type { FundamentalBranchId } from '@/core/types';

function makeFundLevels(overrides: Partial<Record<FundamentalBranchId, number>>) {
  return {
    chemistry: 0,
    physics: 0,
    engineering: 0,
    biology_fund: 0,
    military_science: 0,
    xenoarchaeology: 0,
    ...overrides,
  };
}

describe('Block 03 T-R6 — Branch ceilings', () => {
  describe('getEffectiveMaxLevel — fundamental ceilings', () => {
    test('materials: chemistry=5, engineering=2 → 3 (min(5, floor(2×1.5)=3))', () => {
      const result = getEffectiveMaxLevel('materials', makeFundLevels({
        chemistry: 5,
        engineering: 2,
      }));
      expect(result).toBe(3);
    });

    test('materials: chemistry=5, engineering=0 → 0 (engineering=0 floors to 0)', () => {
      const result = getEffectiveMaxLevel('materials', makeFundLevels({
        chemistry: 5,
        engineering: 0,
      }));
      expect(result).toBe(0);
    });

    test('materials: chemistry=0, engineering=10 → 0 (chemistry=0)', () => {
      const result = getEffectiveMaxLevel('materials', makeFundLevels({
        chemistry: 0,
        engineering: 10,
      }));
      expect(result).toBe(0);
    });

    test('materials: chemistry=10, engineering=10 → 10 (min(10, 15)=10)', () => {
      const result = getEffectiveMaxLevel('materials', makeFundLevels({
        chemistry: 10,
        engineering: 10,
      }));
      // floor(10 × 1.5) = 15; min(10, 15) = 10
      expect(result).toBe(10);
    });

    test('materials: chemistry=4, engineering=4 → 4 (min(4, floor(6)=6))', () => {
      const result = getEffectiveMaxLevel('materials', makeFundLevels({
        chemistry: 4,
        engineering: 4,
      }));
      // floor(4 × 1.5) = 6; min(4, 6) = 4
      expect(result).toBe(4);
    });

    test('power: physics=5 → 5 (primary only)', () => {
      const result = getEffectiveMaxLevel('power', makeFundLevels({ physics: 5 }));
      expect(result).toBe(5);
    });

    test('power: physics=0 → 0', () => {
      const result = getEffectiveMaxLevel('power', makeFundLevels({ physics: 0 }));
      expect(result).toBe(0);
    });

    test('computing: free branch — Infinity even with chemistry=5', () => {
      const result = getEffectiveMaxLevel('computing', makeFundLevels({ chemistry: 5 }));
      expect(result).toBe(Infinity);
    });

    test('computing: free branch — Infinity with all 0', () => {
      const result = getEffectiveMaxLevel('computing', makeFundLevels({}));
      expect(result).toBe(Infinity);
    });

    test('biology: biology_fund=7 → 7 (primary only)', () => {
      const result = getEffectiveMaxLevel('biology', makeFundLevels({ biology_fund: 7 }));
      expect(result).toBe(7);
    });

    test('weapons: military_science=5 → 5 (primary only)', () => {
      const result = getEffectiveMaxLevel('weapons', makeFundLevels({ military_science: 5 }));
      expect(result).toBe(5);
    });

    test('weapons: military_science=10, engineering=10 → 10 (min(10, 15)=10)', () => {
      const result = getEffectiveMaxLevel('weapons', makeFundLevels({
        military_science: 10,
        engineering: 10,
      }));
      expect(result).toBe(10);
    });

    test('all fundamentals = 0 → materials ceiling = 0', () => {
      const result = getEffectiveMaxLevel('materials', makeFundLevels({}));
      expect(result).toBe(0);
    });
  });

  describe('getPartialBonus — partial links', () => {
    test('weapons: engineering=4 → 1 + 0.05×4 = 1.2', () => {
      const result = getPartialBonus('weapons', makeFundLevels({ engineering: 4 }));
      expect(result).toBe(1.2);
    });

    test('computing: chemistry=5 → 1 + 0.05×5 = 1.25', () => {
      const result = getPartialBonus('computing', makeFundLevels({ chemistry: 5 }));
      expect(result).toBe(1.25);
    });

    test('materials: no partial → 1.0', () => {
      const result = getPartialBonus('materials', makeFundLevels({}));
      expect(result).toBe(1.0);
    });

    test('power: no partial → 1.0', () => {
      const result = getPartialBonus('power', makeFundLevels({}));
      expect(result).toBe(1.0);
    });

    test('biology: no partial → 1.0', () => {
      const result = getPartialBonus('biology', makeFundLevels({}));
      expect(result).toBe(1.0);
    });

    test('computing: chemistry=10 → 1 + 0.05×10 = 1.5', () => {
      const result = getPartialBonus('computing', makeFundLevels({ chemistry: 10 }));
      expect(result).toBe(1.5);
    });

    test('weapons: engineering=0 → 1.0', () => {
      const result = getPartialBonus('weapons', makeFundLevels({}));
      expect(result).toBe(1.0);
    });
  });

  describe('getTechCeiling — min(tech.maxLevel, branch ceiling)', () => {
    test('fusion_reactor (power, max 10) with physics=5 → 5', () => {
      const tech = TECH_MAP.get('fusion_reactor')!;
      const state = createDefaultResearchState();
      state.fundamentalLevels.physics = 5;
      expect(getTechCeiling(tech, state)).toBe(5);
    });

    test('fusion_reactor with physics=0 → 0', () => {
      const tech = TECH_MAP.get('fusion_reactor')!;
      const state = createDefaultResearchState();
      expect(getTechCeiling(tech, state)).toBe(0);
    });

    test('fusion_reactor with physics=20 → capped at tech.maxLevel=10', () => {
      const tech = TECH_MAP.get('fusion_reactor')!;
      const state = createDefaultResearchState();
      state.fundamentalLevels.physics = 20;
      expect(getTechCeiling(tech, state)).toBe(10);
    });

    test('microelectronics (computing — free branch) → tech.maxLevel=10', () => {
      const tech = TECH_MAP.get('microelectronics')!;
      const state = createDefaultResearchState();
      // free branch — no primary/secondary → Infinity → returns tech.maxLevel
      expect(getTechCeiling(tech, state)).toBe(10);
    });

    test('steel_processing (materials) with chemistry=3, engineering=2 → 3', () => {
      const tech = TECH_MAP.get('steel_processing')!;
      const state = createDefaultResearchState();
      state.fundamentalLevels.chemistry = 3;
      state.fundamentalLevels.engineering = 2;
      // ceiling = min(3, floor(2×1.5)=3) = 3
      expect(getTechCeiling(tech, state)).toBe(3);
    });
  });
});
