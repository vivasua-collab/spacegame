/// <reference types="bun-types" />
/**
 * ORE-POOLS-RUNTIME-01 (Issue #25): планировщик добычи — единый бюджет
 * здания, фаза A (минимумы) → фаза B (пропорциональный излишек).
 *
 * Сценарии ORE-POOL-01…ORE-POOL-12 (pending-инструкция плейтеста —
 * docs/playtest-checklist.md; здесь — автотестовое покрытие инвариантов
 * docs/31 §11 и docs/35 §2.7):
 *
 *   ORE-POOL-01  единый бюджет: 1/5/N видов руды не умножают выпуск
 *   ORE-POOL-02  фаза A: наименьший fulfillment первым; ties → priority → oreId
 *   ORE-POOL-03  достигнутый минимум освобождает бюджет в том же тике
 *   ORE-POOL-04  редкий критический ресурс пополняется раньше переполнения склада обычной рудой
 *   ORE-POOL-05  фаза B: доли ∝ remaining × availability; сумма ≤ бюджет
 *   ORE-POOL-06  исчерпанный пул исключается; доля перераспределяется; остаток ≥ 0
 *   ORE-POOL-07  полный склад: непомещённое НЕ списывается из пула; другой ресурс добывается
 *   ORE-POOL-08  две+ шахты на одном пуле: sum(extracted) ≤ исходный остаток; детерминизм
 *   ORE-POOL-09  порядок зданий/пулов не влияет на результат
 *   ORE-POOL-10  кандидат, добавленный после начала тика, не появляется задним числом
 *   ORE-POOL-11  фаза A не ждёт недоступную руду (несовместимый источник/пустой пул)
 *   ORE-POOL-12  дробные остатки/округление: сумма выданного ≤ бюджета, без отрицательных
 *
 * Run: bun test tests/economy/mining-scheduler.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { distributeMiningBudget, type PoolCandidate, type MiningSchedulerContext } from '@/economy/mining-scheduler';
import type { PlanetOrePool } from '@/core/types';

/** Тестовый движок: пулы + склад + счётчик добычи (границы tryExtract соблюдаются). */
function makeEngine(pools: PlanetOrePool[], stock: Record<string, number> = {}, storableCap: Record<string, number> = {}) {
  const poolByOre = new Map(pools.map((p) => [p.oreId, p]));
  const extracted: Record<string, number> = {};
  const startingRemaining = new Map(pools.map((p) => [p.oreId, p.remainingQuantity]));
  const ctx: MiningSchedulerContext = {
    remaining: (oreId) => poolByOre.get(oreId)?.remainingQuantity ?? 0,
    stock: (oreId) => stock[oreId] ?? 0,
    tryExtract: (oreId, amount) => {
      const pool = poolByOre.get(oreId);
      if (!pool || !(amount > 0)) return 0;
      const requested = Math.min(amount, pool.remainingQuantity);
      const cap = storableCap[oreId] ?? Number.POSITIVE_INFINITY;
      const actual = Math.min(requested, Math.max(0, cap - (stock[oreId] ?? 0)));
      if (!(actual > 0)) return 0;
      pool.remainingQuantity -= actual;
      stock[oreId] = (stock[oreId] ?? 0) + actual;
      extracted[oreId] = (extracted[oreId] ?? 0) + actual;
      return actual;
    },
  };
  return { ctx, extracted, stock, startingRemaining };
}

const pool = (oreId: string, remaining: number, availability = 0.5, tier: PlanetOrePool['tier'] = 'rare'): PlanetOrePool =>
  ({ oreId, initialQuantity: Math.max(remaining, 1), remainingQuantity: remaining, availability, tier });

const cand = (oreId: string, availability = 0.5, minimum = 0, priority = 0): PoolCandidate =>
  ({ oreId, availability, minimum, priority });

describe('ORE-POOL-01: единый бюджет — число руд не умножает выпуск', () => {
  test('1, 5, N доступных видов: суммарная добыча за тик = бюджет', () => {
    for (const n of [1, 5, 20]) {
      const pools = Array.from({ length: n }, (_, i) => pool(`Ore-${String(i).padStart(2, '0')}`, 100000, 0.5));
      const candidates = pools.map(p => cand(p.oreId, p.availability));
      const { ctx, extracted } = makeEngine(pools);
      const orders = distributeMiningBudget(2.0, candidates, ctx);
      const total = orders.reduce((s, o) => s + o.amount, 0);
      expect(total, `n=${n}`).toBeCloseTo(2.0, 9);
      expect(Object.values(extracted).reduce((s, v) => s + v, 0)).toBeCloseTo(2.0, 9);
    }
  });
});

describe('ORE-POOL-02: фаза A — наименьший fulfillment; ties → priority → oreId', () => {
  test('2a. Наименьший fulfillment обслуживается первым', () => {
    // Fe: stock 90/100 (fulfillment 0.9); Cu: stock 5/100 (0.05) → Cu первым.
    const pools = [pool('Fe-ore', 10000), pool('Cu-ore', 10000)];
    const candidates = [cand('Fe-ore', 0.5, 100, 1), cand('Cu-ore', 0.5, 100, 1)];
    const { ctx } = makeEngine(pools, { 'Fe-ore': 90, 'Cu-ore': 5 });
    const orders = distributeMiningBudget(1.0, candidates, ctx);
    expect(orders[0]).toEqual({ oreId: 'Cu-ore', amount: 1.0 }); // недостача Cu = 95 > бюджет
  });

  test('2b. Равный fulfillment → высший priority первым', () => {
    const pools = [pool('Au-ore', 10000), pool('Ag-ore', 10000)];
    const candidates = [cand('Ag-ore', 0.5, 100, 3), cand('Au-ore', 0.5, 100, 7)];
    const { ctx } = makeEngine(pools, { 'Au-ore': 10, 'Ag-ore': 10 }); // fulfillment 0.1 у обоих
    const orders = distributeMiningBudget(1.0, candidates, ctx);
    expect(orders[0]!.oreId).toBe('Au-ore'); // priority 7 > 3
  });

  test('2c. Равный fulfillment и priority → стабильный порядок oreId', () => {
    const pools = [pool('Zr-ore', 10000), pool('Y-ore', 10000)];
    const candidates = [cand('Zr-ore', 0.5, 100, 5), cand('Y-ore', 0.5, 100, 5)];
    const { ctx } = makeEngine(pools, { 'Zr-ore': 10, 'Y-ore': 10 });
    const orders = distributeMiningBudget(1.0, candidates, ctx);
    expect(orders[0]!.oreId).toBe('Y-ore'); // лексикографически раньше
  });
});

describe('ORE-POOL-03/04: минимумы закрываются точно, бюджет переключается в том же тике', () => {
  test('3. Недостача закрывается точно в фазе A; закрытый минимум участвует в фазе B на общих основаниях', () => {
    const pools = [pool('Fe-ore', 100000, 0.5), pool('Cu-ore', 100000, 0.5)];
    const candidates = [cand('Fe-ore', 0.5, 100, 5), cand('Cu-ore', 0.5, 0, 0)];
    const { ctx, extracted } = makeEngine(pools, { 'Fe-ore': 99 }); // недостача 1
    const orders = distributeMiningBudget(2.0, candidates, ctx);
    const fe = extracted['Fe-ore'] ?? 0;
    // Фаза A: Fe (единственный кандидат с минимумом) получает ровно недостачу 1.0
    // (переоценка: fulfillment = 1 → минимум освобождает бюджет в том же тике);
    // Фаза B: Fe и Cu — равные «остальные совместимые пулы» → по 0.5 каждому.
    // Итого Fe = 1.5, Cu = 0.5; сумма долей ≤ бюджет (docs/35 §2.7.2–2.7.3).
    // Веса фазы B читаются живьём (remaining после фазы A) — допуски 1e-5.
    expect(fe).toBeCloseTo(1.5, 5);
    expect(extracted['Cu-ore'] ?? 0).toBeCloseTo(0.5, 5);
    const total = orders.reduce((s, o) => s + o.amount, 0);
    expect(total).toBeCloseTo(2.0, 9);
  });

  test('4. Редкий критический ресурс пополняется раньше, чем склад зальёт обычная руда', () => {
    // Два кандидата с минимумами: редкий Ir (fulfillment 0) vs Fe (0.5);
    // склад с лимитом 60: Ir закрывает свой минимум 50 ПЕРВЫМ, Fe не вытесняет.
    const pools = [pool('Fe-ore', 100000), pool('Ir-ore', 100000)];
    const candidates = [cand('Fe-ore', 0.5, 100, 1), cand('Ir-ore', 0.5, 50, 1)];
    const { ctx, extracted } = makeEngine(pools, { 'Fe-ore': 50, 'Ir-ore': 0 }, { 'Fe-ore': 60, 'Ir-ore': 60 });
    distributeMiningBudget(30, candidates, ctx);
    // fulfillment: Ir 0.0 < Fe 0.5 → Ir первым: недостача 50 > бюджета 30 → весь бюджет Ir.
    expect(extracted['Ir-ore'] ?? 0).toBeCloseTo(30, 9);
    expect(extracted['Fe-ore'] ?? 0).toBe(0);
  });
});

describe('ORE-POOL-05: фаза B — доли ∝ remaining × availability; сумма ≤ бюджет', () => {
  test('5a. Пропорция весов при равных remaining', () => {
    // Веса: Fe 1000×0.75=750; Cu 1000×0.25=250 → 75%/25% бюджета 2.0.
    const pools = [pool('Fe-ore', 1000, 0.75), pool('Cu-ore', 1000, 0.25)];
    const candidates = [cand('Fe-ore', 0.75), cand('Cu-ore', 0.25)];
    const { ctx, extracted } = makeEngine(pools);
    distributeMiningBudget(2.0, candidates, ctx);
    expect(extracted['Fe-ore'] ?? 0).toBeCloseTo(1.5, 9);
    expect(extracted['Cu-ore'] ?? 0).toBeCloseTo(0.5, 9);
  });

  test('5b. availability — вес, а НЕ множитель: сумма долей = бюджет (не больше)', () => {
    const pools = [pool('Fe-ore', 1000, 1.0), pool('Cu-ore', 1000, 1.0)];
    const candidates = [cand('Fe-ore', 1.0), cand('Cu-ore', 1.0)];
    const { ctx, extracted } = makeEngine(pools);
    distributeMiningBudget(1.0, candidates, ctx);
    // Высокие availability НЕ увеличивают суммарный выпуск сверх бюджета.
    const total = Object.values(extracted).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 9);
  });
});

describe('ORE-POOL-06/12: исчерпанный пул исключается; без отрицательных остатков', () => {
  test('6. Пул remaining 0 не занимает долю; доля перераспределяется', () => {
    const pools = [pool('Fe-ore', 0, 0.5), pool('Cu-ore', 1000, 0.5)];
    const candidates = [cand('Fe-ore', 0.5), cand('Cu-ore', 0.5)];
    const { ctx, extracted } = makeEngine(pools);
    const orders = distributeMiningBudget(2.0, candidates, ctx);
    expect(orders.some(o => o.oreId === 'Fe-ore')).toBe(false);
    expect(extracted['Cu-ore'] ?? 0).toBeCloseTo(2.0, 9);
    expect(pools[0]!.remainingQuantity).toBe(0); // не ушло в минус
  });

  test('12. Дробные остатки: вес ∝ remaining — малый пул получает малую долю; без отрицательных', () => {
    // Канон (docs/35 §2.7.3.2): вес = remaining × availability — почти
    // исчерпанный пул получает пропорционально малую долю (остаток
    // размывается постепенно), сумма долей = бюджет.
    const pools = [pool('Fe-ore', 0.37, 0.5), pool('Cu-ore', 1000, 0.5)];
    const candidates = [cand('Fe-ore', 0.5), cand('Cu-ore', 0.5)];
    const { ctx, extracted } = makeEngine(pools);
    distributeMiningBudget(2.0, candidates, ctx);
    const fe = extracted['Fe-ore'] ?? 0;
    const expectedFe = 2.0 * (0.37 * 0.5) / (0.37 * 0.5 + 1000 * 0.5);
    expect(fe).toBeCloseTo(expectedFe, 12);
    expect(pools[0]!.remainingQuantity).toBeGreaterThanOrEqual(0);
    const total = Object.values(extracted).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(2.0, 9);
  });
});

describe('ORE-POOL-07: полный склад — непомещённое НЕ расходует месторождение', () => {
  test('7a. Склад полон: пул не тратится, бюджет не теряется в пустоту', () => {
    const pools = [pool('Fe-ore', 1000, 0.5)];
    const candidates = [cand('Fe-ore', 0.5)];
    const { ctx, extracted } = makeEngine(pools, { 'Fe-ore': 50 }, { 'Fe-ore': 50 }); // склад полон
    const orders = distributeMiningBudget(1.0, candidates, ctx);
    expect(orders.length).toBe(0);
    expect(extracted['Fe-ore'] ?? 0).toBe(0);
    expect(pools[0]!.remainingQuantity).toBe(1000);
  });

  test('7b. Один склад полон, другой принимает: бюджет уходит принимающему', () => {
    const pools = [pool('Fe-ore', 1000, 0.5), pool('Cu-ore', 1000, 0.5)];
    const candidates = [cand('Fe-ore', 0.5), cand('Cu-ore', 0.5)];
    const { ctx, extracted } = makeEngine(pools, { 'Fe-ore': 50 }, { 'Fe-ore': 50, 'Cu-ore': 1000 });
    distributeMiningBudget(2.0, candidates, ctx);
    expect(extracted['Fe-ore'] ?? 0).toBe(0);
    expect(extracted['Cu-ore'] ?? 0).toBeCloseTo(2.0, 9);
    expect(pools[0]!.remainingQuantity).toBe(1000); // непомещённое не списано
  });
});

describe('ORE-POOL-08/09: несколько зданий на одном пуле — детерминизм, без двойного вычитания', () => {
  test('8. Две шахты по 1.0: суммарно 2.0 из пула 3.0; остаток точно 1.0', () => {
    const pools = [pool('Fe-ore', 3.0, 0.5)];
    const candidates = [cand('Fe-ore', 0.5)];
    const { ctx } = makeEngine(pools);
    distributeMiningBudget(1.0, candidates, ctx);
    distributeMiningBudget(1.0, candidates, ctx);
    expect(pools[0]!.remainingQuantity).toBeCloseTo(1.0, 9); // нет двойного вычитания
  });

  test('8b. Три шахты по 2.0 при пуле 5.0: суммарно ровно остаток (конкурентный доступ)', () => {
    const pools = [pool('Fe-ore', 5.0, 0.5)];
    const candidates = [cand('Fe-ore', 0.5)];
    const { ctx } = makeEngine(pools);
    distributeMiningBudget(2.0, candidates, ctx);
    distributeMiningBudget(2.0, candidates, ctx);
    distributeMiningBudget(2.0, candidates, ctx);
    expect(pools[0]!.remainingQuantity).toBeCloseTo(0, 9);
  });

  test('9. Порядок входа кандидатов/зданий не влияет на результат', () => {
    const run = (order: PoolCandidate[], poolsOrder: PlanetOrePool[]) => {
      const pools = poolsOrder.map(p => ({ ...p }));
      const { ctx, extracted } = makeEngine(pools);
      distributeMiningBudget(3.0, order, ctx);
      return { extracted, pools };
    };
    const a = run(
      [cand('B-ore', 0.3), cand('A-ore', 0.7)],
      [pool('B-ore', 1000, 0.3), pool('A-ore', 1000, 0.7)],
    );
    const b = run(
      [cand('A-ore', 0.7), cand('B-ore', 0.3)],
      [pool('A-ore', 1000, 0.7), pool('B-ore', 1000, 0.3)],
    );
    // Бит-в-бит детерминизм (стабильная сортировка oreId внутри планировщика):
    // объёмы добычи идентичны; остатки пулов сравниваем по oreId
    // (порядок КОНСТРУКЦИИ массивов в двух прогонах разный).
    expect(b.extracted).toEqual(a.extracted);
    const byOre = (runs: { pools: Array<{ oreId: string; remainingQuantity: number }> }) =>
      Object.fromEntries(runs.pools.map(p => [p.oreId, p.remainingQuantity]));
    expect(byOre(b)).toEqual(byOre(a));
  });
});

describe('ORE-POOL-10/11: новодоступные пулы со следующего тика; фаза A не ждёт недоступное', () => {
  test('10. Кандидат, добавленный после начала распределения, не получает долю (список фиксирован)', () => {
    // Кандидаты фиксируются ДО распределения: пул, «открытый» внутри тика
    // (добавлен в состояние после списка), не получает долю в этом тике.
    const pools = [pool('Fe-ore', 1000, 0.5)];
    const candidates = [cand('Fe-ore', 0.5)];
    const { ctx, extracted } = makeEngine(pools);
    distributeMiningBudget(1.0, candidates, ctx);
    pools.push(pool('Secret-ore', 1000, 1.0)); // «разведка» внутри тика
    const secondPass = distributeMiningBudget(0.0, candidates, ctx);
    expect(secondPass.length).toBe(0);
    expect(extracted['Secret-ore']).toBeUndefined();
  });

  test('11. Фаза A не ждёт недоступную руду: пустой пул не блокирует доступный минимум', () => {
    // Au (минимум 100, пул пуст) не занимает долю — Cu (минимум 100, пул полон)
    // получает весь бюджет.
    const pools = [pool('Au-ore', 0, 0.5), pool('Cu-ore', 1000, 0.5)];
    const candidates = [cand('Au-ore', 0.5, 100, 9), cand('Cu-ore', 0.5, 100, 9)];
    const { ctx, extracted } = makeEngine(pools);
    const orders = distributeMiningBudget(2.0, candidates, ctx);
    expect(extracted['Au-ore'] ?? 0).toBe(0);
    // Cu: минимум 100 (склад 0) → фаза A закрывает недостачу 2.0 бюджета
    expect(orders[0]).toEqual({ oreId: 'Cu-ore', amount: 2.0 });
  });
});
