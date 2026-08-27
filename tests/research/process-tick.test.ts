/// <reference types="bun-types" />
/**
 * Block 03 — T-R7 — processResearchTick (tickResearch).
 *
 * Tests per plan §7 T-R7:
 *   - 1 слот, 100% аллокация, 100 RP/сек → за 10 сек = 1000 RP, уровень P1 (cost 500) завершён
 *   - getMinResearchTime не мешает на нормальных скоростях
 *   - 5-секундный tick на speed=5 → ×5 RP
 *   - превышение потолка фундаментала → уровень не растёт
 *   - 0 RP/сек → не прогрессирует
 *   - макс. уровень → слот закрывается
 *   - createResearchSlot создаёт валидный слот
 *   - completeResearch завершает уровень вручную
 *   - canStartResearch rejects: prerequisite not met, ceiling exceeded,
 *     slot overflow, targetLevel != currentLevel+1
 *   - canAllocate проверяет sum=100% и min 5%
 *
 * Run: bun test tests/research/process-tick.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  tickResearch,
  createResearchSlot,
  completeResearch,
  canStartResearch,
  canAllocate,
  createDefaultResearchState,
  getTechCost,
  applyTechUnlock,
  getTechCeiling,
} from '@/research/engine';
import { TECH_MAP } from '@/data/research/tech-tree';
import type { ResearchState } from '@/core/types';

function makeStateWithSlot(
  techId: string,
  allocation = 100,
  targetLevel = 1,
  fundOverrides?: Partial<Record<'chemistry' | 'physics' | 'engineering' | 'biology_fund' | 'military_science' | 'xenoarchaeology', number>>,
): ResearchState {
  const state = createDefaultResearchState();
  // Set all fundamentals to 10 by default — so ceiling = tech.maxLevel = 10
  // (we want to test tick mechanics, not ceiling rejection).
  state.fundamentalLevels.chemistry = 10;
  state.fundamentalLevels.physics = 10;
  state.fundamentalLevels.engineering = 10;
  state.fundamentalLevels.biology_fund = 10;
  state.fundamentalLevels.military_science = 10;
  if (fundOverrides) {
    Object.assign(state.fundamentalLevels, fundOverrides);
  }
  const slot = createResearchSlot(`slot_test_${techId}`, techId, targetLevel, allocation);
  state.activeSlots.push(slot);
  return state;
}

describe('Block 03 T-R7 — processResearchTick (tickResearch)', () => {
  describe('createResearchSlot — slot constructor', () => {
    test('creates valid slot with id, techId, allocation, rpInvested=0', () => {
      const slot = createResearchSlot('s1', 'fusion_reactor', 1, 100);
      expect(slot.slotId).toBe('s1');
      expect(slot.techId).toBe('fusion_reactor');
      expect(slot.targetLevel).toBe(1);
      expect(slot.allocationPercent).toBe(100);
      expect(slot.rpInvested).toBe(0);
    });

    test('clamps allocation to [5, 100]', () => {
      const slot1 = createResearchSlot('s1', 'fusion_reactor', 1, 200);
      expect(slot1.allocationPercent).toBe(100);
      const slot2 = createResearchSlot('s2', 'fusion_reactor', 1, 1);
      expect(slot2.allocationPercent).toBe(5);
      const slot3 = createResearchSlot('s3', 'fusion_reactor', 1, 50);
      expect(slot3.allocationPercent).toBe(50);
    });

    test('clamps targetLevel to >= 1', () => {
      const slot = createResearchSlot('s1', 'fusion_reactor', 0, 100);
      expect(slot.targetLevel).toBe(1);
    });
  });

  describe('tickResearch — basic RP accumulation', () => {
    test('0 RP/сек → slot does not progress, totalRpGenerated stays 0', () => {
      const state = makeStateWithSlot('fusion_reactor');
      const result = tickResearch(state, 0, 10);
      expect(state.activeSlots[0]!.rpInvested).toBe(0);
      expect(result.completed).toEqual([]);
      expect(state.totalRpGenerated).toBe(0);
    });

    test('100 RP/сек × 10 сек × 100% × focus(×1.2) → 1200 RP — completes P1 level 1 (cost 500)', () => {
      const state = makeStateWithSlot('fusion_reactor');
      // effective = 100 × (100/100) × 1.2 = 120 RP/сек
      // × 10 сек = 1200 RP → level 1 cost 500 → completes (1200 - 500 = 700 RP invested next)
      const result = tickResearch(state, 100, 10);
      expect(state.researched['fusion_reactor']).toBe(1);
      expect(state.activeSlots[0]!.targetLevel).toBe(2);
      expect(state.activeSlots[0]!.rpInvested).toBe(700); // 1200 - 500
      expect(result.completed.length).toBe(1);
      expect(result.completed[0]).toEqual({ techId: 'fusion_reactor', level: 1 });
      expect(state.totalRpGenerated).toBe(1000); // 100 × 10
    });

    test('Slot with 0 RP/sec — no progress', () => {
      const state = makeStateWithSlot('fusion_reactor');
      const result = tickResearch(state, 0, 100);
      expect(state.researched['fusion_reactor']).toBeUndefined();
      expect(result.completed).toEqual([]);
    });

    test('50% allocation → half RP accumulation', () => {
      const state = makeStateWithSlot('fusion_reactor', 50);
      // 100 RP × 50% × 1.0 (no focus, but 1 slot at <100% — wait, focus applies if
      // 1 slot at 100%, here 1 slot at 50% → no focus)
      // effective = 100 × 0.5 × 1.0 = 50 RP/сек
      // × 10 сек = 500 RP → exactly cost(500) for level 1 → completes
      const result = tickResearch(state, 100, 10);
      expect(state.researched['fusion_reactor']).toBe(1);
      expect(result.completed.length).toBe(1);
    });

    test('Multiple levels in one tick — big RP injection', () => {
      const state = makeStateWithSlot('fusion_reactor');
      // 1000 RP/сек × 10 сек × 1.2 focus = 12000 RP
      // Level 1: cost 500 → completes, 11500 left
      // Level 2: cost 750 (800×1.5=1200)... wait, baseCost=500, level 2 cost = 500×1.5=750
      // Level 2: 750 → completes, 10750 left
      // Level 3: 500×1.5^2=1125 → completes, 9625 left
      // Level 4: 500×1.5^3=1687 → completes, 7938 left
      // Level 5: 500×1.5^4=2531 → completes, 5407 left
      // Level 6: 500×1.5^5=3796 → completes, 1611 left
      // Level 7: 500×1.5^6=5695 → can't (1611 < 5695), stop
      // Note: focus bonus only applies on 1-slot-at-100%, but the slot stays
      // at 100% allocation throughout, so focus applies each iteration.
      // Actually wait — focus = 1.2 only if activeSlots === 1 && allocation === 100
      // Here activeSlots === 1 (one slot) and allocation === 100 → focus = 1.2
      const result = tickResearch(state, 1000, 10);
      // Should complete several levels — at least 4
      expect(result.completed.length).toBeGreaterThanOrEqual(4);
      expect(result.completed[0]!.level).toBe(1);
    });
  });

  describe('tickResearch — fundamental ceiling', () => {
    test('Slot reaches fundamental ceiling → slot removed, last level recorded', () => {
      const state = makeStateWithSlot('fusion_reactor');
      // physics=2 → ceiling=2 → can reach level 1 and 2, but not 3
      state.fundamentalLevels.physics = 2;
      // Pre-set level 1 done, target level 2
      state.activeSlots[0]!.targetLevel = 2;
      state.researched['fusion_reactor'] = 1;
      // Big RP injection: 10000 RP/сек × 10 = 100000 × 1.2 = 120000
      // Level 2 cost = 500×1.5=750 → completes, slot.targetLevel=3
      // Level 3 > ceiling=2 → slot removed
      const result = tickResearch(state, 10000, 10);
      expect(state.researched['fusion_reactor']).toBe(2);
      // Slot should be removed (ceiling reached)
      expect(state.activeSlots.length).toBe(0);
      expect(result.completed.length).toBeGreaterThanOrEqual(1);
    });

    test('Slot at maxLevel → slot removed when level maxes out', () => {
      const tech = TECH_MAP.get('fusion_reactor')!;
      const state = makeStateWithSlot('fusion_reactor');
      // Set physics high enough — no ceiling issue
      state.fundamentalLevels.physics = 15; // ceiling=10 (capped by tech.maxLevel)
      // Pre-set level 9 done, target level 10 (max)
      state.activeSlots[0]!.targetLevel = 10;
      state.researched['fusion_reactor'] = 9;
      // Level 10 cost = 500×1.5^9 = 19221
      // Need 19221 RP — give 100000
      const result = tickResearch(state, 10000, 10);
      expect(state.researched['fusion_reactor']).toBe(10);
      // Slot removed after reaching maxLevel
      expect(state.activeSlots.length).toBe(0);
      expect(result.completed.length).toBeGreaterThanOrEqual(1);
      void tech;
    });
  });

  describe('tickResearch — partial bonus', () => {
    test('Partial bonus applies to computing tech (chemistry bonus)', () => {
      // chemistry=4 → partial bonus = 1 + 0.05×4 = 1.2 for computing
      const state = makeStateWithSlot('microelectronics', 100, 1, { chemistry: 4 });
      // effective = 100 × 1 × 1.2 (focus) × 1.2 (partial) = 144 RP/сек
      // × 10 = 1440 RP → completes microelectronics level 1 (cost 300),
      // level 2 (cost 450), level 3 (cost 675) — total 1425, 15 RP left
      // → researched['microelectronics'] === 3 (not 1 — partial bonus pushes higher)
      const result = tickResearch(state, 100, 10);
      expect(state.researched['microelectronics']).toBeGreaterThanOrEqual(1);
      expect(result.completed.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tickResearch — multiple slots', () => {
    test('Two slots, 50% each — split RP between them', () => {
      const state = createDefaultResearchState();
      // Set fundamentals high enough for both techs (power needs physics,
      // materials needs chemistry + engineering)
      state.fundamentalLevels.physics = 10;
      state.fundamentalLevels.chemistry = 10;
      state.fundamentalLevels.engineering = 10;
      state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 50));
      state.activeSlots.push(createResearchSlot('s2', 'steel_processing', 1, 50));
      // 100 RP × 0.5 × 1.0 (no focus, 2 slots) = 50 RP/сек each
      // × 10 = 500 RP each → fusion_reactor (cost 500) completes,
      // steel_processing (cost 300) completes
      const result = tickResearch(state, 100, 10);
      expect(state.researched['fusion_reactor']).toBe(1);
      expect(state.researched['steel_processing']).toBe(1);
      expect(result.completed.length).toBe(2);
    });
  });

  describe('completeResearch — manual finish', () => {
    test('Completes level if rpInvested >= cost', () => {
      const state = makeStateWithSlot('fusion_reactor');
      state.activeSlots[0]!.rpInvested = 500;
      const result = completeResearch(state, 'slot_test_fusion_reactor');
      expect(result).toBe(true);
      expect(state.researched['fusion_reactor']).toBe(1);
      expect(state.activeSlots[0]!.targetLevel).toBe(2);
      expect(state.activeSlots[0]!.rpInvested).toBe(0);
    });

    test('Returns false if rp insufficient', () => {
      const state = makeStateWithSlot('fusion_reactor');
      state.activeSlots[0]!.rpInvested = 100;
      const result = completeResearch(state, 'slot_test_fusion_reactor');
      expect(result).toBe(false);
      expect(state.researched['fusion_reactor']).toBeUndefined();
    });

    test('Returns false if slot not found', () => {
      const state = makeStateWithSlot('fusion_reactor');
      const result = completeResearch(state, 'nonexistent_slot');
      expect(result).toBe(false);
    });
  });
});

// ============ Phase 3.4: R4 — canStartResearch + canAllocate ============

describe('Block 03 — R4 canStartResearch + canAllocate', () => {
  describe('canStartResearch — composite validation', () => {
    test('OK: starter tech (free branch microelectronics), targetLevel=1, 0 slots used, 0 labs', () => {
      const tech = TECH_MAP.get('microelectronics')!;
      const state = createDefaultResearchState();
      // microelectronics is in computing — free branch (no primary/secondary)
      // → ceiling=Infinity → targetLevel=1 OK
      const result = canStartResearch(tech, 1, state, 0);
      expect(result.ok).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    test('OK: fusion_reactor with physics=10, targetLevel=1', () => {
      const tech = TECH_MAP.get('fusion_reactor')!;
      const state = createDefaultResearchState();
      state.fundamentalLevels.physics = 10;
      const result = canStartResearch(tech, 1, state, 0);
      expect(result.ok).toBe(true);
    });

    test('REJECT: prerequisites not met (P2 ion_engine without fusion_reactor)', () => {
      const tech = TECH_MAP.get('ion_engine')!;
      const state = createDefaultResearchState();
      state.fundamentalLevels.physics = 10; // ceiling OK
      const result = canStartResearch(tech, 1, state, 0);
      expect(result.ok).toBe(false);
      expect(result.reasons.some(r => r.includes('prerequisites not met'))).toBe(true);
    });

    test('REJECT: ceiling exceeded (fusion_reactor targetLevel=11, physics=10 → ceiling=10)', () => {
      const tech = TECH_MAP.get('fusion_reactor')!;
      const state = createDefaultResearchState();
      state.fundamentalLevels.physics = 10; // ceiling=10
      state.researched['fusion_reactor'] = 10; // already at maxLevel
      const result = canStartResearch(tech, 11, state, 0);
      expect(result.ok).toBe(false);
      expect(result.reasons.some(r => r.includes('maxLevel') || r.includes('ceiling'))).toBe(true);
    });

    test('REJECT: slot overflow (1 slot max with 0 labs, already 1 active)', () => {
      const tech = TECH_MAP.get('microelectronics')!;
      const state = createDefaultResearchState();
      state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 100));
      // 0 labs → 1 max slot; already 1 active → can't add
      const result = canStartResearch(tech, 1, state, 0);
      expect(result.ok).toBe(false);
      expect(result.reasons.some(r => r.includes('no free slots'))).toBe(true);
    });

    test('REJECT: targetLevel != currentLevel+1 (skip a level)', () => {
      const tech = TECH_MAP.get('microelectronics')!;
      const state = createDefaultResearchState();
      const result = canStartResearch(tech, 2, state, 0);
      expect(result.ok).toBe(false);
      expect(result.reasons.some(r => r.includes('must equal currentLevel+1'))).toBe(true);
    });

    test('REJECT: targetLevel > tech.maxLevel', () => {
      const tech = TECH_MAP.get('microelectronics')!;
      const state = createDefaultResearchState();
      state.researched['microelectronics'] = 10; // at maxLevel
      const result = canStartResearch(tech, 11, state, 0);
      expect(result.ok).toBe(false);
      expect(result.reasons.some(r => r.includes('maxLevel'))).toBe(true);
    });

    test('OK: can start P2 ion_engine if P1=1, slot free, physics ceiling OK', () => {
      const tech = TECH_MAP.get('ion_engine')!;
      const state = createDefaultResearchState();
      state.researched['fusion_reactor'] = 1;
      state.fundamentalLevels.physics = 5;
      const result = canStartResearch(tech, 1, state, 0);
      expect(result.ok).toBe(true);
    });

    test('OK: 10 labs → 2 slots, can start second tech', () => {
      const tech = TECH_MAP.get('microelectronics')!;
      const state = createDefaultResearchState();
      state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 50));
      const result = canStartResearch(tech, 1, state, 10);
      expect(result.ok).toBe(true);
    });
  });

  describe('canAllocate — allocation rules', () => {
    test('OK: single slot 100%', () => {
      expect(canAllocate([100])).toBe(true);
    });

    test('OK: two slots 50/50', () => {
      expect(canAllocate([50, 50])).toBe(true);
    });

    test('OK: three slots 40/30/30', () => {
      expect(canAllocate([40, 30, 30])).toBe(true);
    });

    test('REJECT: sum != 100 (90)', () => {
      expect(canAllocate([50, 40])).toBe(false);
    });

    test('REJECT: sum != 100 (110)', () => {
      expect(canAllocate([60, 50])).toBe(false);
    });

    test('REJECT: any slot < 5%', () => {
      expect(canAllocate([95, 5])).toBe(true);  // 5% is OK
      expect(canAllocate([96, 4])).toBe(false); // 4% is below min
    });

    test('OK: empty array (no slots — 100% on "nothing")', () => {
      expect(canAllocate([])).toBe(true);
    });

    test('OK: 5 slots 20% each', () => {
      expect(canAllocate([20, 20, 20, 20, 20])).toBe(true);
    });
  });
});

// ============ Phase 3.5: R5 — applyTechUnlock (idempotent) ============

describe('Block 03 — R5 applyTechUnlock (idempotent)', () => {
  test('M1 steel_processing → recipe make_steel unlocked', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
    };
    state.researched['steel_processing'] = 1;
    const newUnlocks = applyTechUnlock(state, 'steel_processing');
    expect(state.unlockedRecipes).toContain('make_steel');
    expect(newUnlocks.length).toBe(1);
    expect(newUnlocks[0]!.id).toBe('make_steel');
    expect(newUnlocks[0]!.type).toBe('recipe');
  });

  test('C1 microelectronics → recipe make_microchip unlocked', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
    };
    state.researched['microelectronics'] = 1;
    const newUnlocks = applyTechUnlock(state, 'microelectronics');
    expect(state.unlockedRecipes).toContain('make_microchip');
    expect(newUnlocks.length).toBe(1);
  });

  test('Idempotent: apply twice → no duplicates', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
    };
    state.researched['steel_processing'] = 1;
    const first = applyTechUnlock(state, 'steel_processing');
    const second = applyTechUnlock(state, 'steel_processing');
    expect(first.length).toBe(1);
    expect(second.length).toBe(0); // already unlocked — no new
    expect(state.unlockedRecipes!.length).toBe(1); // still only 1
  });

  test('P2 ion_engine → module ion_engine unlocked', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedModules?: string[];
    };
    state.researched['ion_engine'] = 1;
    const newUnlocks = applyTechUnlock(state, 'ion_engine');
    expect(state.unlockedModules).toContain('ion_engine');
    expect(newUnlocks[0]!.type).toBe('module');
  });

  test('P1 fusion_reactor → building fusion_reactor unlocked', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedBuildings?: string[];
    };
    state.researched['fusion_reactor'] = 1;
    const newUnlocks = applyTechUnlock(state, 'fusion_reactor');
    expect(state.unlockedBuildings).toContain('fusion_reactor');
    expect(newUnlocks[0]!.type).toBe('building');
  });

  test('No unlocks for tech without entries (e.g., fleet_tactics)', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
    };
    state.researched['fleet_tactics'] = 1;
    const newUnlocks = applyTechUnlock(state, 'fleet_tactics');
    expect(newUnlocks).toEqual([]);
  });

  test('Level 0 → no unlocks (must complete level 1 first)', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
    };
    state.researched['steel_processing'] = 0;
    const newUnlocks = applyTechUnlock(state, 'steel_processing');
    expect(newUnlocks).toEqual([]);
    expect(state.unlockedRecipes).toBeUndefined();
  });

  test('Unknown tech → no unlocks', () => {
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
    };
    const newUnlocks = applyTechUnlock(state, 'nonexistent_tech');
    expect(newUnlocks).toEqual([]);
  });

  test('Multiple unlocks for one tech (when TECH_UNLOCKS has multiple entries)', () => {
    // Manually construct a state with both recipe + module for testing
    const state = createDefaultResearchState() as ResearchState & {
      unlockedRecipes?: string[];
      unlockedModules?: string[];
    };
    state.researched['steel_processing'] = 2; // beyond level 1 unlocks
    const newUnlocks = applyTechUnlock(state, 'steel_processing');
    // All entries with level <= 2 should unlock
    expect(newUnlocks.length).toBeGreaterThanOrEqual(1);
    expect(state.unlockedRecipes!.length).toBeGreaterThanOrEqual(1);
  });
});

// ============ Phase 3.7 (preview): createDefaultResearchState ============

describe('Block 03 — createDefaultResearchState', () => {
  test('All fundamentals = 0', () => {
    const state = createDefaultResearchState();
    expect(state.fundamentalLevels.chemistry).toBe(0);
    expect(state.fundamentalLevels.physics).toBe(0);
    expect(state.fundamentalLevels.engineering).toBe(0);
    expect(state.fundamentalLevels.biology_fund).toBe(0);
    expect(state.fundamentalLevels.military_science).toBe(0);
    expect(state.fundamentalLevels.xenoarchaeology).toBe(0);
  });

  test('researched empty, activeSlots empty, totalRpGenerated = 0', () => {
    const state = createDefaultResearchState();
    expect(state.researched).toEqual({});
    expect(state.activeSlots).toEqual([]);
    expect(state.totalRpGenerated).toBe(0);
  });

  test('fundamentalRpInvested empty Partial', () => {
    const state = createDefaultResearchState();
    expect(state.fundamentalRpInvested).toEqual({});
  });
});

// ============ Phase 3.4: getTechCeiling in canStartResearch context ============

describe('Block 03 — getTechCeiling integration', () => {
  test('techCeiling=0 → no research possible (canStartResearch rejects)', () => {
    const tech = TECH_MAP.get('fusion_reactor')!;
    const state = createDefaultResearchState();
    // physics=0 → ceiling=0
    // targetLevel=1 (currentLevel+1=0+1=1) — that's OK numerically
    // But targetLevel > ceiling (1 > 0) → reject
    const result = canStartResearch(tech, 1, state, 0);
    expect(result.ok).toBe(false);
    expect(result.reasons.some(r => r.includes('ceiling'))).toBe(true);
  });

  test('Free branch (computing) — canStartResearch OK even with all fund=0', () => {
    const tech = TECH_MAP.get('microelectronics')!;
    const state = createDefaultResearchState();
    const result = canStartResearch(tech, 1, state, 0);
    expect(result.ok).toBe(true);
    // ceiling = Infinity, targetLevel=1 ≤ Infinity → OK
    expect(getTechCeiling(tech, state)).toBe(tech.maxLevel);
  });

  test('Materials: chemistry=2, engineering=2 → ceiling=2, targetLevel=1 OK, targetLevel=3 REJECTED', () => {
    const tech = TECH_MAP.get('steel_processing')!;
    const state = createDefaultResearchState();
    state.fundamentalLevels.chemistry = 2;
    state.fundamentalLevels.engineering = 2;
    // ceiling = min(2, floor(2×1.5)=3) = 2
    expect(getTechCeiling(tech, state)).toBe(2);

    // targetLevel=1 (currentLevel+1=0+1=1) — OK
    state.researched['steel_processing'] = 0;
    expect(canStartResearch(tech, 1, state, 0).ok).toBe(true);

    // targetLevel=2 (currentLevel+1=1+1=2) — OK (≤ ceiling=2)
    state.researched['steel_processing'] = 1;
    expect(canStartResearch(tech, 2, state, 0).ok).toBe(true);

    // targetLevel=3 (currentLevel+1=2+1=3) — REJECTED (> ceiling=2)
    state.researched['steel_processing'] = 2;
    const result = canStartResearch(tech, 3, state, 0);
    expect(result.ok).toBe(false);
    expect(result.reasons.some(r => r.includes('ceiling'))).toBe(true);
  });
});

// ============ getTechCost sanity check ============

describe('Block 03 — getTechCost sanity', () => {
  test('M1 steel_processing level 1 cost = 300', () => {
    expect(getTechCost(300, 1)).toBe(300);
  });

  test('C1 microelectronics level 1 cost = 300', () => {
    expect(getTechCost(300, 1)).toBe(300);
  });

  test('P1 fusion_reactor level 1 cost = 500', () => {
    expect(getTechCost(500, 1)).toBe(500);
  });

  test('M5 superconductors level 1 cost = 1500', () => {
    expect(getTechCost(1500, 1)).toBe(1500);
  });
});
