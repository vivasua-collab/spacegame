/// <reference types="bun-types" />
/**
 * Block 03 — T-R1 — Tech tree data validation.
 *
 * Tests per plan §7 T-R1:
 *   1. TECH_TREE has 15 elements
 *   2. validateTechTree returns [] for valid tree
 *   3. STARTER_TECH_IDS has 5 entries, all in TECH_TREE
 *   4. FUNDAMENTAL_BRANCHES_MVP has 5 entries (no xenoarchaeology)
 *   5. BRANCH_LINKS has 8 entries (5 MVP + 1 ghost + ... actually 7+1 ghost)
 *   6. Duplicate ID → error
 *   7. Unknown prerequisite → error
 *   8. Self-prerequisite → error
 *   9. Cycle in DAG → error
 *  10. Each tech has correct branch, valid sortOrder, maxLevel ≥ 1
 *
 * Run: bun test tests/research/tree-data.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { TECH_TREE, TECH_MAP, STARTER_TECH_IDS, BRANCH_COLORS } from '@/data/research/tech-tree';
import { FUNDAMENTAL_BRANCHES, FUNDAMENTAL_BRANCHES_MVP } from '@/data/research/fundamental-branches';
import { BRANCH_LINKS } from '@/data/research/branch-links';
import { validateTechTree } from '@/research/engine';
import type { Technology, SpecializedBranchId, FundamentalBranchId } from '@/core/types';

describe('Block 03 T-R1 — Tree data', () => {
  test('TECH_TREE has 15 elements', () => {
    expect(TECH_TREE.length).toBe(15);
  });

  test('validateTechTree returns [] for valid TECH_TREE', () => {
    expect(validateTechTree(TECH_TREE)).toEqual([]);
  });

  test('STARTER_TECH_IDS has 5 entries, all exist in TECH_TREE', () => {
    expect(STARTER_TECH_IDS.length).toBe(5);
    for (const id of STARTER_TECH_IDS) {
      expect(TECH_MAP.has(id)).toBe(true);
      const tech = TECH_MAP.get(id)!;
      expect(tech.prerequisites.length).toBe(0);
    }
  });

  test('FUNDAMENTAL_BRANCHES_MVP has 5 entries (no xenoarchaeology)', () => {
    expect(FUNDAMENTAL_BRANCHES_MVP.length).toBe(5);
    expect(FUNDAMENTAL_BRANCHES_MVP.find(b => b.id === 'xenoarchaeology')).toBeUndefined();
  });

  test('FUNDAMENTAL_BRANCHES total has 6 entries (incl. ghost xenoarchaeology)', () => {
    expect(FUNDAMENTAL_BRANCHES.length).toBe(6);
    const ghost = FUNDAMENTAL_BRANCHES.find(b => b.id === 'xenoarchaeology');
    expect(ghost).toBeDefined();
  });

  test('Each fundamental branch has baseCost 200 and maxLevel 10', () => {
    for (const b of FUNDAMENTAL_BRANCHES) {
      expect(b.baseCost).toBe(200);
      expect(b.maxLevel).toBe(10);
    }
  });

  test('BRANCH_LINKS has 8 entries (MVP-7 + ghost xenoarch)', () => {
    expect(BRANCH_LINKS.length).toBe(8);
  });

  test('BRANCH_LINKS — 5 primary, 1 secondary, 2 partial (MVP slice)', () => {
    const primaries = BRANCH_LINKS.filter(l => l.linkType === 'primary');
    const secondaries = BRANCH_LINKS.filter(l => l.linkType === 'secondary');
    const partials = BRANCH_LINKS.filter(l => l.linkType === 'partial');
    expect(primaries.length).toBeGreaterThanOrEqual(5);
    expect(secondaries.length).toBeGreaterThanOrEqual(1);
    expect(partials.length).toBeGreaterThanOrEqual(2);
  });

  test('BRANCH_COLORS has all 6 specialized branches', () => {
    const expectedBranches: SpecializedBranchId[] = ['power', 'materials', 'weapons', 'computing', 'biology', 'xenoarch'];
    for (const branch of expectedBranches) {
      expect(BRANCH_COLORS[branch]).toBeDefined();
      expect(BRANCH_COLORS[branch]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test('All techs have valid branch and sortOrder', () => {
    for (const tech of TECH_TREE) {
      expect(['power', 'materials', 'weapons', 'computing', 'biology', 'xenoarch']).toContain(tech.branch);
      expect(tech.sortOrder).toBeGreaterThan(0);
      expect(tech.maxLevel).toBeGreaterThanOrEqual(1);
      expect(tech.baseCost).toBeGreaterThan(0);
    }
  });

  test('Cross-branch prerequisites exist (M5←C1, W2←C1)', () => {
    const m5 = TECH_MAP.get('superconductors')!;
    expect(m5.prerequisites).toContainEqual({ techId: 'microelectronics', minLevel: 1 });
    expect(m5.prerequisites).toContainEqual({ techId: 'steel_processing', minLevel: 2 });

    const w2 = TECH_MAP.get('laser_weapons')!;
    expect(w2.prerequisites).toContainEqual({ techId: 'microelectronics', minLevel: 1 });
    expect(w2.prerequisites).toContainEqual({ techId: 'ballistic_weapons', minLevel: 2 });
  });

  // ─── Error cases ──────────────────────────────────────

  test('validateTechTree detects duplicate IDs', () => {
    const dup: Technology[] = [
      { ...TECH_MAP.get('fusion_reactor')! },
      { ...TECH_MAP.get('fusion_reactor')! },
    ];
    const errors = validateTechTree(dup);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('Duplicate techId'))).toBe(true);
  });

  test('validateTechTree detects unknown prerequisite', () => {
    const bad: Technology[] = [
      {
        ...TECH_MAP.get('fusion_reactor')!,
        id: 'test_tech',
        prerequisites: [{ techId: 'nonexistent_tech', minLevel: 1 }],
      },
    ];
    const errors = validateTechTree(bad);
    expect(errors.some(e => e.includes('prerequisite nonexistent_tech not found'))).toBe(true);
  });

  test('validateTechTree detects self-prerequisite', () => {
    const bad: Technology[] = [
      {
        ...TECH_MAP.get('fusion_reactor')!,
        id: 'self_loop',
        prerequisites: [{ techId: 'self_loop', minLevel: 1 }],
      },
    ];
    const errors = validateTechTree(bad);
    expect(errors.some(e => e.includes('self-prerequisite'))).toBe(true);
  });

  test('validateTechTree detects cycles', () => {
    // A → B → A cycle
    const cyclic: Technology[] = [
      {
        id: 'a', name: 'A', nameEn: 'A', branch: 'power',
        baseCost: 100, maxLevel: 5, improvementType: 'linear', improvementPerLevel: 0.1,
        prerequisites: [{ techId: 'b', minLevel: 1 }],
        effects: [], description: '', icon: '', sortOrder: 1,
      },
      {
        id: 'b', name: 'B', nameEn: 'B', branch: 'power',
        baseCost: 100, maxLevel: 5, improvementType: 'linear', improvementPerLevel: 0.1,
        prerequisites: [{ techId: 'a', minLevel: 1 }],
        effects: [], description: '', icon: '', sortOrder: 2,
      },
    ];
    const errors = validateTechTree(cyclic);
    expect(errors.some(e => e.includes('Cycle detected'))).toBe(true);
  });

  test('validateTechTree detects invalid baseCost', () => {
    const bad: Technology[] = [
      { ...TECH_MAP.get('fusion_reactor')!, id: 'bad_cost', baseCost: 0 },
    ];
    const errors = validateTechTree(bad);
    expect(errors.some(e => e.includes('baseCost must be > 0'))).toBe(true);
  });
});
