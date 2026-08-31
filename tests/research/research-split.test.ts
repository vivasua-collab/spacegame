/// <reference types="bun-types" />
/**
 * R-SPLIT (Задача 23) tests: разделение исследований на две параллельные ветки.
 *
 * Ветки:
 *   1. Аккумулятор (rpBank) — накопительная, только для фундаменталов.
 *   2. Дерево технологий (activeSlots) — потоковая, прогресс напрямую
 *      от притока RP (techPerSec), банк не трогает.
 *
 * Правила редиректа (RP не теряются):
 *   - все доступные фундаменталы изучены → 100% в дерево;
 *   - дерево простаивает (нет слотов И очередь пуста) → 100% в банк;
 *   - иначе 50/50 (FUNDAMENTAL_RP_SHARE).
 *
 * Run: bun test tests/research/research-split.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  createDefaultResearchState,
  createResearchSlot,
  tickResearch,
  getResearchInflowSplit,
  areAllFundamentalsMaxed,
  getAvailableRP,
  ensureRpBank,
  levelUpFundamentalEngine,
  FUNDAMENTAL_RP_SHARE,
} from '@/research/engine';
import { FUNDAMENTAL_BRANCHES_MVP } from '@/data/research/fundamental-branches';
import type { ResearchState } from '@/core/types';

/** Максимальть все 5 MVP-веток (призрак xenoarchaeology не трогаем). */
function maxAllMvpFundamentals(state: ResearchState): void {
  for (const branch of FUNDAMENTAL_BRANCHES_MVP) {
    state.fundamentalLevels[branch.id] = branch.maxLevel;
  }
}

describe('R-SPLIT — areAllFundamentalsMaxed', () => {
  test('новая игра → false', () => {
    expect(areAllFundamentalsMaxed(createDefaultResearchState())).toBe(false);
  });

  test('все 5 MVP-веток на maxLevel → true (призрак xenoarchaeology не блокирует)', () => {
    const state = createDefaultResearchState();
    maxAllMvpFundamentals(state);
    // xenoarchaeology (Etap 4) остаётся 0 — недоступна игроку.
    expect(areAllFundamentalsMaxed(state)).toBe(true);
  });

  test('одна ветка не докачана → false', () => {
    const state = createDefaultResearchState();
    maxAllMvpFundamentals(state);
    state.fundamentalLevels.physics = 9;
    expect(areAllFundamentalsMaxed(state)).toBe(false);
  });
});

describe('R-SPLIT — getResearchInflowSplit', () => {
  test('дерево активно, фундаменталы не изучены → 50/50', () => {
    const state = createDefaultResearchState();
    state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 100));
    const split = getResearchInflowSplit(state, 100);
    expect(split.bankPerSec).toBeCloseTo(100 * FUNDAMENTAL_RP_SHARE, 5);
    expect(split.techPerSec).toBeCloseTo(100 * (1 - FUNDAMENTAL_RP_SHARE), 5);
  });

  test('все фундаменталы изучены + дерево активно → 0% банк / 100% дерево', () => {
    const state = createDefaultResearchState();
    maxAllMvpFundamentals(state);
    state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 100));
    const split = getResearchInflowSplit(state, 100);
    expect(split.bankPerSec).toBe(0);
    expect(split.techPerSec).toBe(100);
  });

  test('дерево простаивает (нет слотов, очередь пуста) → 100% банк / 0% дерево', () => {
    const state = createDefaultResearchState();
    const split = getResearchInflowSplit(state, 100);
    expect(split.bankPerSec).toBe(100);
    expect(split.techPerSec).toBe(0);
  });

  test('очесть непуста, слотов нет → не idle → 50/50 (слот стартует на тике)', () => {
    const state = createDefaultResearchState();
    state.researchQueue = ['microelectronics'];
    const split = getResearchInflowSplit(state, 100);
    expect(split.bankPerSec).toBeCloseTo(50, 5);
    expect(split.techPerSec).toBeCloseTo(50, 5);
  });

  test('все фундаменталы изучены + дерево простаивает → приоритет редиректа: 100% в ДЕРЕВО', () => {
    // fundamentalsMaxed проверяется ПЕРВЫМ: банк maxed → дерево получает всё.
    const state = createDefaultResearchState();
    maxAllMvpFundamentals(state);
    const split = getResearchInflowSplit(state, 100);
    expect(split.bankPerSec).toBe(0);
    expect(split.techPerSec).toBe(100);
  });
});

describe('R-SPLIT — tickResearch (банк)', () => {
  test('банк копит bankPerSec × dt; слот — techPerSec × allocation', () => {
    const state = createDefaultResearchState();
    state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 50));
    // 100 RP/s → 50/50: банк 50/сек, дерево 50/сек × 50% = 25 RP/сек.
    tickResearch(state, 100, 10);
    expect(state.rpBank).toBeCloseTo(500, 5); // 50 × 10
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(250, 5); // 25 × 10
  });

  test('простой дерева → банк получает 100% притока', () => {
    const state = createDefaultResearchState();
    tickResearch(state, 100, 10);
    expect(state.rpBank).toBeCloseTo(1000, 5);
    expect(state.totalRpGenerated).toBeCloseTo(1000, 5); // lifetime = полный приток
  });

  test('фундаменталы изучены → банк заморожен, слот получает всё', () => {
    const state = createDefaultResearchState();
    maxAllMvpFundamentals(state);
    state.rpBank = 123;
    state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 100));
    tickResearch(state, 100, 10);
    expect(state.rpBank).toBe(123); // не растёт и не тратится
    // 100 × 100% × 1.2 (focus) × 10 = 1200 → L1 (500) завершён, 700 остаток.
    expect(state.researched['fusion_reactor']).toBe(1);
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(700, 5);
  });

  test('totalRpGenerated — lifetime-счётчик полного притока (не делится)', () => {
    const state = createDefaultResearchState();
    state.activeSlots.push(createResearchSlot('s1', 'fusion_reactor', 1, 100));
    tickResearch(state, 100, 10);
    expect(state.totalRpGenerated).toBeCloseTo(1000, 5); // полный приток, не 50%
  });
});

describe('R-SPLIT — levelUpFundamentalEngine (тратит банк)', () => {
  test('успех: банк ≥ cost → списание из rpBank, уровень растёт', () => {
    const state = createDefaultResearchState();
    state.rpBank = 200; // cost L1 = baseCost 200
    const ok = levelUpFundamentalEngine(state, 'chemistry');
    expect(ok).toBe(true);
    expect(state.fundamentalLevels.chemistry).toBe(1);
    expect(state.rpBank).toBe(0);
    expect(state.fundamentalRpInvested.chemistry).toBe(200);
  });

  test('отказ: банк < cost → false, ничего не меняется', () => {
    const state = createDefaultResearchState();
    state.rpBank = 199;
    const ok = levelUpFundamentalEngine(state, 'chemistry');
    expect(ok).toBe(false);
    expect(state.fundamentalLevels.chemistry).toBe(0);
    expect(state.rpBank).toBe(199);
  });

  test('вклад слотов дерева НЕ занимает банк (ветки разделены)', () => {
    const state = createDefaultResearchState();
    state.rpBank = 500;
    state.activeSlots.push({
      slotId: 's1',
      techId: 'fusion_reactor',
      targetLevel: 1,
      allocationPercent: 100,
      rpInvested: 250,
    });
    // getAvailableRP = 500 (rpBank) — rpInvested слота не вычитается.
    expect(getAvailableRP(state)).toBe(500);
  });
});

describe('R-SPLIT — миграция старых сейвов (ensureRpBank)', () => {
  test('поле отсутствует → вычисляется legacy-значение и записывается', () => {
    const state = createDefaultResearchState();
    state.totalRpGenerated = 800;
    state.fundamentalRpInvested = { chemistry: 300 };
    delete (state as unknown as { rpBank?: number }).rpBank;
    const migrated = ensureRpBank(state);
    expect(migrated).toBe(500);
    expect(state.rpBank).toBe(500);
  });

  test('tickResearch мигрирует состояние сам (первый тик)', () => {
    const state = createDefaultResearchState();
    state.totalRpGenerated = 800;
    state.fundamentalRpInvested = { chemistry: 300 };
    delete (state as unknown as { rpBank?: number }).rpBank;
    tickResearch(state, 10, 1);
    // 500 (миграция) + 10 × 1 (100% в банк — дерево простаивает) = 510.
    expect(state.rpBank).toBeCloseTo(510, 5);
  });
});
