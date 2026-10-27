/// <reference types="bun-types" />
/**
 * R-RES-QUEUE-01 (Issue #15): циклическая очередь исследований + единый пул
 * RP империи — engine-контракты по решению владельца 2026-10-27
 * (docs/60-research.md v1.1 §3.3–3.5).
 *
 * Канонический пример владельца: уровни трёх проектов [1, 1, 2] после одного
 * полного прохода → [2, 2, 3], а НЕ [4, 1, 2] (монополизация потока первой
 * технологией).
 *
 * Механика цикла (§3.4):
 *   - один активный проект получает 100% потоковой доли дерева (фокус ×1.2);
 *   - после завершения ОДНОГО уровня ход передаётся следующему готовому
 *     проекту; не достигший maxLevel возвращается в ХВОСТ очереди;
 *   - достигший maxLevel покидает цикл;
 *   - единственный проект (очередь без готовых) продолжает уровни;
 *   - остаток RP в тике детерминированно идёт следующему проекту по порядку
 *     очереди, без потери на границе переключения;
 *   - unknown techId / maxLevel / неготовые прекурсоры — тихая деградация.
 *
 * Технический приём: большинство тестов подаёт totalRPPerSec = 0 и
 * предзагружает slot.rpInvested — каскад отрабатывает предзагруженные очки
 * в чистом виде (начисление притока покрыто отдельными тестами T4/T10 и
 * интеграционным файлом).
 *
 * Run: bun test tests/research/cyclic-queue.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  createDefaultResearchState,
  createResearchSlot,
  tickResearch,
  advanceQueue,
} from '@/research/engine';
import type { ResearchState } from '@/core/types';

// ─── Хелперы ─────────────────────────────────────────────────────────

/**
 * Состояние с активным слотом techId (targetLevel, 100%, rpInvested)
 * и очередью queue. Фундаменталы = 0 (partial-бонусы всех веток = 1.0 —
 * power/materials без partial-связей, computing partial chemistry=0).
 */
function makeState(
  active: { techId: string; targetLevel: number; rpInvested: number; allocationPercent?: number },
  queue: string[],
  researched: Record<string, number> = {},
): ResearchState {
  const state = createDefaultResearchState();
  state.researched = { ...researched };
  state.activeSlots.push(
    createResearchSlot(
      `slot_t_${active.techId}_${active.targetLevel}`,
      active.techId,
      active.targetLevel,
      active.allocationPercent ?? 100,
    ),
  );
  state.activeSlots[0]!.rpInvested = active.rpInvested;
  state.researchQueue = [...queue];
  return state;
}

/** Каскадный тик без притока (totalRPPerSec=0): обрабатывает предзагруженный rpInvested. */
function cascadeTick(state: ResearchState) {
  return tickResearch(state, 0, 1);
}

// ─── Канонический пример владельца [1,1,2] → [2,2,3] ─────────────────

describe('R-RES-QUEUE-01 — канонический пример владельца', () => {
  test('[1,1,2] → [2,2,3] за один полный проход (НЕ [4,1,2])', () => {
    // fusion L2=750, micro L2=450, steel L3=675 → бюджет ровно 1875.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 2, rpInvested: 750 + 450 + 675 },
      ['microelectronics', 'steel_processing'],
      { fusion_reactor: 1, microelectronics: 1, steel_processing: 2 },
    );
    const result = cascadeTick(state);

    // Полный проход: каждый проект получил ровно +1 уровень.
    expect(state.researched['fusion_reactor']).toBe(2);
    expect(state.researched['microelectronics']).toBe(2);
    expect(state.researched['steel_processing']).toBe(3);

    // НЕ монополизация: fusion НЕ получил несколько уровней за проход.
    expect(state.researched['fusion_reactor']).not.toBe(4);
    expect(state.researched['microelectronics']).not.toBe(1);
    expect(state.researched['steel_processing']).not.toBe(2);

    // Все три завершения — в одном тике, в порядке очереди.
    expect(result.completed.map((c) => `${c.techId}:${c.level}`)).toEqual([
      'fusion_reactor:2',
      'microelectronics:2',
      'steel_processing:3',
    ]);

    // После прохода цикл замкнулся: fusion снова активен (следующий ход),
    // остаток 0; очередь — micro, steel (хвост).
    expect(state.activeSlots.length).toBe(1);
    expect(state.activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(state.activeSlots[0]!.targetLevel).toBe(3);
    expect(state.researchQueue).toEqual(['microelectronics', 'steel_processing']);
  });
});

// ─── Передача хода после каждого уровня ──────────────────────────────

describe('R-RES-QUEUE-01 — передача хода (ротация)', () => {
  test('T1. A активна, B/C в очереди: завершение одного уровня A передаёт ход B', () => {
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 600 }, // L1=500
      ['microelectronics', 'steel_processing'],
    );
    const result = cascadeTick(state);

    expect(state.researched['fusion_reactor']).toBe(1);
    expect(result.completed.length).toBe(1);
    // Ход у B (microelectronics); A — в хвосте, C — второй.
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.activeSlots[0]!.targetLevel).toBe(1);
    expect(state.researchQueue).toEqual(['steel_processing', 'fusion_reactor']);
    // Остаток 100 передан B без потерь.
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(100, 5);
  });

  test('T1b. Последующие завершения передают ход C, затем снова A', () => {
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 600 },
      ['microelectronics', 'steel_processing'],
    );
    cascadeTick(state); // A: L1 → ход B (остаток 100)
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');

    // B: 100 + 250 = 350 ≥ 300 (L1) → завершает, остаток 50 → ход C.
    state.activeSlots[0]!.rpInvested += 250;
    cascadeTick(state);
    expect(state.researched['microelectronics']).toBe(1);
    expect(state.activeSlots[0]!.techId).toBe('steel_processing');
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(50, 5);

    // C: 50 + 250 = 300 ≥ 300 (L1) → завершает, остаток 0 → ход A (цикл замкнулся).
    state.activeSlots[0]!.rpInvested += 250;
    cascadeTick(state);
    expect(state.researched['steel_processing']).toBe(1);
    expect(state.activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(state.activeSlots[0]!.targetLevel).toBe(2);
  });

  test('T2. Остаток RP детерминированно идёт по очереди; частичный прогресс не теряется', () => {
    // fusion L1 (500) + micro L1 (300) + 150 в частичный прогресс steel L2.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 500 + 300 + 150 },
      ['microelectronics', 'steel_processing'],
    );
    cascadeTick(state);

    expect(state.researched['fusion_reactor']).toBe(1);
    expect(state.researched['microelectronics']).toBe(1);
    // steel: остаток после B = 150; L1=300 не завершен — частичный прогресс 150.
    expect(state.researched['steel_processing']).toBeUndefined();
    expect(state.activeSlots[0]!.techId).toBe('steel_processing');
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(150, 5);
    expect(state.researchQueue).toEqual(['fusion_reactor', 'microelectronics']);
  });

  test('T3. Частичный прогресс сохраняется, когда уровень не завершён (ход не передаётся)', () => {
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 300 },
      ['microelectronics'],
    );
    // Приток 10 RP/сек: дерево 50% = 5 × фокус 1.2 = 6/тик.
    const result = tickResearch(state, 10, 1);
    expect(result.completed).toEqual([]);
    expect(state.activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(306, 5);
    expect(state.researchQueue).toEqual(['microelectronics']);
    expect(state.researched['fusion_reactor']).toBeUndefined();
  });
});

// ─── maxLevel покидает цикл; единственный проект продолжает ─────────

describe('R-RES-QUEUE-01 — maxLevel и одиночный проект', () => {
  test('T4. Достигший maxLevel покидает цикл (не возвращается в очередь)', () => {
    // fusion на L9 → цель 10 (maxLevel); стоимость 19221, остаток 500 дальше.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 10, rpInvested: 19221 + 500 },
      ['microelectronics'],
      { fusion_reactor: 9 },
    );
    cascadeTick(state);

    expect(state.researched['fusion_reactor']).toBe(10);
    // fusion НЕ в очереди; ход у microelectronics.
    expect(state.researchQueue).toEqual([]);
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    // Остаток достаточен на L1 micro (300) → завершён, остаток 200 → очередь
    // пуста → micro продолжает уровни: L2 (450) > 200 → стоп.
    expect(state.researched['microelectronics']).toBe(1);
    expect(state.activeSlots[0]!.targetLevel).toBe(2);
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(200, 5);
  });

  test('T5. Единственный проект продолжает уровни (несколько за тик)', () => {
    // Приток 1000: дерево 50% = 500 × фокус 1.2 = 600/сек × 10 = 6000.
    // fusion: L1=500, L2=750, L3=1125, L4=1687 (Σ=4062) — L5 (2531) не влезает.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 0 },
      [],
    );
    const result = tickResearch(state, 1000, 10);
    expect(state.researched['fusion_reactor']).toBe(4);
    expect(result.completed.length).toBe(4);
    expect(state.activeSlots[0]!.targetLevel).toBe(5);
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(6000 - 4062, 5);
    expect(state.researchQueue).toEqual([]);
  });
});

// ─── Деградация очереди ──────────────────────────────────────────────

describe('R-RES-QUEUE-01 — валидация и деградация', () => {
  test('T6. Неготовые прекурсоры: проект ротируется в хвост, ход получает следующий готовый', () => {
    // composites требует steel_processing ≥ 2 (у нас 1) — не готов.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 600 },
      ['composites', 'microelectronics'],
      { steel_processing: 1 },
    );
    cascadeTick(state);
    expect(state.researched['fusion_reactor']).toBe(1);
    // Ход у готовой microelectronics; composites остался в очереди.
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.researchQueue).toContain('composites');
    expect(state.researchQueue).toContain('fusion_reactor');
  });

  test('T7. В очереди только неготовые → активный НЕ простаивает, продолжает уровни', () => {
    // fusion: L1=500 + L2=750 = 1250 ровно; в очереди только composites
    // (прекурсоры не готовы) — ход не кому передавать, fusion продолжает.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 1250 },
      ['composites'],
      { steel_processing: 1 },
    );
    const result = cascadeTick(state);
    expect(state.researched['fusion_reactor']).toBe(2);
    expect(result.completed.length).toBe(2);
    expect(state.activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(state.activeSlots[0]!.targetLevel).toBe(3);
    expect(state.researchQueue).toEqual(['composites']);
  });

  test('T8. Unknown techId тихо удаляется из очереди', () => {
    const state = createDefaultResearchState();
    state.researchQueue = ['nonexistent_tech', 'microelectronics'];
    cascadeTick(state);
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.researchQueue).toEqual([]);
  });

  test('T9. Tech на maxLevel тихо удаляется из очереди', () => {
    const state = createDefaultResearchState();
    state.researched['microelectronics'] = 10; // maxLevel
    state.researchQueue = ['microelectronics', 'steel_processing'];
    cascadeTick(state);
    expect(state.activeSlots[0]!.techId).toBe('steel_processing');
    expect(state.researchQueue).toEqual([]);
  });
});

// ─── Legacy-консолидация параллельных слотов + нормализация ──────────

describe('R-RES-QUEUE-01 — legacy-миграция (docs/60 §3.4)', () => {
  test('T10. Параллельные слоты консолидируются: первый активен, остальные в хвост, RP переносится', () => {
    const state = createDefaultResearchState();
    // Два «старых» параллельных слота (до R-RES-QUEUE-01) + очередь.
    const s1 = createResearchSlot('s1', 'fusion_reactor', 1, 50);
    s1.rpInvested = 300;
    const s2 = createResearchSlot('s2', 'steel_processing', 1, 60);
    s2.rpInvested = 200;
    state.activeSlots.push(s1, s2);
    state.researchQueue = ['microelectronics'];

    cascadeTick(state);

    // Консолидация: остался ОДИН слот; аллокация нормализована до 100.
    expect(state.activeSlots.length).toBe(1);
    // rpInvested перенесён: 300 + 200 = 500 → fusion L1 (500) завершён
    // в том же тике, остаток 0; ход передан (очередь не пуста).
    expect(state.researched['fusion_reactor']).toBe(1);
    // steel_processing вернулся в хвост очереди; microelectronics получил ход.
    expect(state.activeSlots[0]!.techId).toBe('microelectronics');
    expect(state.researchQueue).toEqual(['steel_processing', 'fusion_reactor']);
  });

  test('T11. Одиночный legacy-слот с аллокацией < 100 нормализуется до 100 (фокус)', () => {
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 0, allocationPercent: 50 },
      [],
    );
    // Приток 200: дерево 50% = 100; после нормализации 100% × фокус 1.2
    // = 120/сек × 10 = 1200 → L1 (500) завершён, остаток 700 < L2 (750).
    tickResearch(state, 200, 10);
    expect(state.activeSlots[0]!.allocationPercent).toBe(100);
    expect(state.researched['fusion_reactor']).toBe(1);
    expect(state.activeSlots[0]!.rpInvested).toBeCloseTo(700, 5);
  });
});

// ─── Граничный случай «все закрыты» ──────────────────────────────────

describe('R-RES-QUEUE-01 — граничные случаи остатка', () => {
  test('T12. Все проекты цикла закрыты в тике → остаток не сохраняется, банк не тронут', () => {
    // fusion L10 (последний уровень) + огромный остаток; очередь пуста.
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 10, rpInvested: 19221 + 99999 },
      [],
      { fusion_reactor: 9 },
    );
    const bankBefore = state.rpBank;
    cascadeTick(state);
    expect(state.researched['fusion_reactor']).toBe(10);
    expect(state.activeSlots.length).toBe(0);
    expect(state.researchQueue).toEqual([]);
    // Инвариант R-SPLIT: слоты дерева НЕ трогают банк (даже «потерянный»
    // остаток НЕ уходит в банк).
    expect(state.rpBank).toBe(bankBefore);
  });

  test('T13. Каскад не зацикливается на дешёвых уровнях (guard завершается)', () => {
    // Огромный бюджет на миксе: полный проход повторяется, пока RP не
    // кончатся; завершение гарантировано (стоимость уровней растёт).
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 100000 },
      ['microelectronics', 'steel_processing'],
    );
    const result = cascadeTick(state);
    // Все три проекта исследованы глубоко, но НЕ бесконечно: суммарные
    // завершения конечны и детерминированы.
    expect(result.completed.length).toBeGreaterThan(3);
    expect(result.completed.length).toBeLessThan(100);
    const f = state.researched['fusion_reactor'] ?? 0;
    const m = state.researched['microelectronics'] ?? 0;
    const s = state.researched['steel_processing'] ?? 0;
    // Цикличность: уровни распределены, первая технология НЕ съела всё.
    expect(f).toBeGreaterThan(0);
    expect(m).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(0);
    expect(Math.abs(f - m)).toBeLessThanOrEqual(1); // по очереди — примерно поровну
  });
});

// ─── advanceQueue: прежние инварианты сохранены ──────────────────────

describe('R-RES-QUEUE-01 — advanceQueue (инварианты R-RES §B)', () => {
  test('не продвигает при непустом activeSlots', () => {
    const state = makeState(
      { techId: 'fusion_reactor', targetLevel: 1, rpInvested: 0 },
      ['microelectronics'],
    );
    expect(advanceQueue(state)).toBe(false);
    expect(state.researchQueue.length).toBe(1);
  });

  test('детерминированный slotId slot_q_* при старте из очереди', () => {
    const state = createDefaultResearchState();
    state.researchQueue = ['microelectronics'];
    expect(advanceQueue(state)).toBe(true);
    expect(state.activeSlots[0]!.slotId).toBe('slot_q_microelectronics_1');
    expect(state.activeSlots[0]!.allocationPercent).toBe(100);
  });
});
