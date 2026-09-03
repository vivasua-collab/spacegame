/// <reference types="bun-types" />
/**
 * R-RES §B + §C tests: research queue + available RP.
 *
 * Tests:
 *   - getAvailableRP returns totalRpGenerated - fundamentals - activeSlots
 *   - createDefaultResearchState has researchQueue: []
 *   - tickResearch auto-advances queue when active slot completes
 *   - advanceQueue creates slot with deterministic id `slot_q_*`
 *   - advanceQueue handles: empty queue, maxLevel tech, unknown tech, prereqs not met
 *
 * Run: bun test tests/research/queue-and-rp.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  createDefaultResearchState,
  createResearchSlot,
  tickResearch,
  advanceQueue,
  getAvailableRP,
  ensureRpBank,
} from '@/research/engine';
import { TECH_MAP } from '@/data/research/tech-tree';
import type { ResearchState } from '@/core/types';

describe('R-RES/R-SPLIT — getAvailableRP (аккумулятор фундаменталов)', () => {
  test('empty state → 0 available', () => {
    const state = createDefaultResearchState();
    expect(getAvailableRP(state)).toBe(0);
  });

  test('R-SPLIT: возвращает rpBank напрямую (аккумулятор — единственный банк)', () => {
    const state = createDefaultResearchState();
    state.rpBank = 500;
    // totalRpGenerated теперь lifetime-счётчик (debug) — НЕ участвует
    // в расчёте доступных RP.
    state.totalRpGenerated = 99999;
    state.fundamentalRpInvested = { chemistry: 200 };
    state.activeSlots.push({
      slotId: 's1',
      techId: 'fusion_reactor',
      targetLevel: 1,
      allocationPercent: 100,
      rpInvested: 250,
    });
    expect(getAvailableRP(state)).toBe(500);
  });

  test('R-SPLIT legacy-миграция: сейв без rpBank → старая формула (total − fundamentals − slots)', () => {
    const state = createDefaultResearchState();
    state.totalRpGenerated = 1000;
    state.fundamentalRpInvested = { chemistry: 200, physics: 100 };
    delete (state as unknown as { rpBank?: number }).rpBank;
    // legacy = 1000 − 200 − 100 = 700 (старая формула с клампом ≥ 0;
    // слоты вычитаются только в legacy — в новых состояниях ветки разделены)
    expect(getAvailableRP(state)).toBe(700);
  });

  test('R-SPLIT legacy: кламп снизу нулём (инвестиции больше lifetime)', () => {
    const state = createDefaultResearchState();
    state.totalRpGenerated = 100;
    state.fundamentalRpInvested = { chemistry: 200 };
    delete (state as unknown as { rpBank?: number }).rpBank;
    expect(getAvailableRP(state)).toBe(0);
  });

  test('R-SPLIT ensureRpBank: вычисляет и записывает банк при первом обращении', () => {
    const state = createDefaultResearchState();
    state.totalRpGenerated = 1000;
    state.fundamentalRpInvested = { chemistry: 300 };
    delete (state as unknown as { rpBank?: number }).rpBank;
    const bank = ensureRpBank(state);
    expect(bank).toBe(700);
    expect(state.rpBank).toBe(700);
    // Повторный вызов — идемпотентен.
    expect(ensureRpBank(state)).toBe(700);
  });
});

describe('R-RES — createDefaultResearchState has researchQueue', () => {
  test('researchQueue is empty array', () => {
    const state = createDefaultResearchState();
    expect(Array.isArray(state.researchQueue)).toBe(true);
    expect(state.researchQueue.length).toBe(0);
    expect(state.researchQueue).toEqual([]);
  });
});

describe('R-RES — advanceQueue', () => {
  test('empty queue → returns false, no slot created', () => {
    const state = createDefaultResearchState();
    const result = advanceQueue(state);
    expect(result).toBe(false);
    expect(state.activeSlots.length).toBe(0);
  });

  test('creates slot from first queue item with deterministic id', () => {
    const state = createDefaultResearchState();
    state.researchQueue = ['fusion_reactor'];
    const result = advanceQueue(state);
    expect(result).toBe(true);
    expect(state.activeSlots.length).toBe(1);
    expect(state.activeSlots[0]!.slotId).toBe('slot_q_fusion_reactor_1');
    expect(state.activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(state.activeSlots[0]!.targetLevel).toBe(1);
    expect(state.activeSlots[0]!.allocationPercent).toBe(100);
    expect(state.researchQueue.length).toBe(0);
  });

  test('skips techs that are already at maxLevel', () => {
    const state = createDefaultResearchState();
    state.researched['fusion_reactor'] = 10; // maxLevel
    state.researchQueue = ['fusion_reactor', 'microelectronics'];
    const result = advanceQueue(state);
    expect(result).toBe(true);
    // fusion_reactor was dropped, microelectronics started
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.researchQueue.length).toBe(0);
  });

  test('skips unknown techs (not in TECH_MAP)', () => {
    const state = createDefaultResearchState();
    state.researchQueue = ['nonexistent_tech', 'microelectronics'];
    const result = advanceQueue(state);
    expect(result).toBe(true);
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.researchQueue.length).toBe(0);
  });

  test('returns false if activeSlots already has a slot (safety)', () => {
    const state = createDefaultResearchState();
    state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 100));
    state.researchQueue = ['microelectronics'];
    const result = advanceQueue(state);
    expect(result).toBe(false);
    // Queue untouched — caller (tickResearch) only calls advanceQueue when
    // activeSlots is empty.
    expect(state.researchQueue.length).toBe(1);
  });
});

describe('R-RES — tickResearch auto-advance from queue', () => {
  test('when active slot completes, queue advances automatically', () => {
    const state = createDefaultResearchState();
    // Set up: fusion_reactor at level 9, target 10, queue has microelectronics.
    state.researched['fusion_reactor'] = 9;
    state.activeSlots.push({
      slotId: 's1',
      techId: 'fusion_reactor',
      targetLevel: 10,
      allocationPercent: 100,
      rpInvested: 0,
    });
    state.researchQueue = ['microelectronics'];
    // Big RP injection: completes fusion_reactor level 10 (cost 19221),
    // then targetLevel becomes 11 → slot removed.
    // Then queue advances: microelectronics → slot_q_microelectronics_1.
    tickResearch(state, 10000, 10);
    expect(state.researched['fusion_reactor']).toBe(10);
    expect(state.activeSlots.length).toBe(1);
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.activeSlots[0]!.slotId).toBe('slot_q_microelectronics_1');
    expect(state.researchQueue.length).toBe(0);
  });

  test('no queue → slot removed, queue stays empty', () => {
    const state = createDefaultResearchState();
    state.researched['fusion_reactor'] = 9;
    state.activeSlots.push({
      slotId: 's1',
      techId: 'fusion_reactor',
      targetLevel: 10,
      allocationPercent: 100,
      rpInvested: 0,
    });
    tickResearch(state, 10000, 10);
    expect(state.researched['fusion_reactor']).toBe(10);
    expect(state.activeSlots.length).toBe(0);
    expect(state.researchQueue.length).toBe(0);
  });

  test('queue is preserved when active slot still in progress', () => {
    const state = createDefaultResearchState();
    state.activeSlots.push({
      slotId: 's1',
      techId: 'fusion_reactor',
      targetLevel: 1,
      allocationPercent: 100,
      rpInvested: 0,
    });
    state.researchQueue = ['microelectronics'];
    // Small RP — not enough to complete level 1 (cost 500)
    tickResearch(state, 10, 1);
    expect(state.activeSlots.length).toBe(1);
    expect(state.activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(state.researchQueue.length).toBe(1);
    expect(state.researchQueue[0]).toBe('microelectronics');
  });

  test('empty activeSlots + non-empty queue → advances on tick', () => {
    const state = createDefaultResearchState();
    state.researchQueue = ['microelectronics'];
    // First tick: advanceQueue creates slot from queue; tick's RP accrues
    // into totalRpGenerated only (slot is now active, but RP processes on
    // the same tick — let's check what happens).
    tickResearch(state, 100, 10);
    // advanceQueue should have started microelectronics as active slot.
    expect(state.activeSlots.length).toBe(1);
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.researchQueue.length).toBe(0);
    // Note: on this tick, advanceQueue runs FIRST (because activeSlots was empty),
    // but RP processing only happens if activeSlots was non-empty BEFORE the tick.
    // The slot was created, but no RP processing occurs this tick. researched
    // remains 0 until next tick.
    // Total RP accumulated: 100 × 10 = 1000 (lifetime counter).
    expect(state.totalRpGenerated).toBe(1000);
  });
});
