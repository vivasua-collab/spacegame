/**
 * Планировщик добычи: единый бюджет здания → распределение по планетарным
 * пулам (ORE-POOLS-RUNTIME-01 / Issue #25; канон — docs/31 §11,
 * полный алгоритм — docs/35 §2.7).
 *
 * Детерминированный, чистый по управляющей структуре модуль: распределение
 * не зависит от порядка обхода зданий/массивов (кандидаты сортируются по
 * устойчивым ключам), результат воспроизводим бит-в-бит.
 *
 * Канонические правила (docs/35 §2.7):
 *   Фаза A — недовыполненные минимумы (`reserves.minimum` > 0):
 *     1. fulfillment = clamp(currentStock / minimum, 0, 1) — по СКЛАДСКОМУ
 *        запасу (planet.resources[oreId]), НЕ по остатку недр;
 *     2. первым обслуживается кандидат с наименьшим fulfillment; при
 *        равенстве — существующий priority (больше = раньше), затем
 *        стабильный порядок oreId;
 *     3. выдаётся не больше: остатка бюджета, недостачи до минимума,
 *        остатка планетарного пула и объёма, реально принимаемого складом;
 *     4. кандидатура переоценивается после каждой выдачи (достигнутый
 *        минимум освобождает бюджет следующему в том же тике);
 *     5. ресурс без остатка в пуле или без места на складе не занимает
 *        долю распределения (исключается до конца тика) — доступные
 *        ресурсы не ждут недоступную руду.
 *   Фаза B — пропорциональный излишек:
 *     1. оставшийся бюджет делится между совместимыми ненулевыми пулами;
 *     2. вес пула = remainingQuantity × availability (доступный остаток
 *        недр с учётом availability как веса, НЕ как множителя бюджета);
 *     3. доли нормализуются, сумма выданного ≤ бюджета; дробные остатки
 *        обрабатываются в стабильном порядке oreId;
 *     4. исчерпанный пул (remaining ≤ 0) или склад без места исключаются —
 *        их доля перераспределяется оставшимся (повторные проходы);
 *     5. непомещённый объём НЕ расходует месторождение.
 *
 * Общие инварианты:
 *   - сумма выданного ≤ бюджета здания (число руд НЕ умножает выпуск);
 *   - для нескольких зданий по одному пулу сумма добытого ≤ исходного
 *     остатка (обеспечивается tryExtract-колбэком двигателя);
 *   - кандидаты, ставшие доступными после начала тика, не появляются
 *     задним числом (список кандидатов фиксируется до распределения).
 */

/** Кандидат распределения: один планетарный пул, совместимый со зданием. */
export interface PoolCandidate {
  /** Точный ID сырой руды (стабильный ключ порядка) */
  oreId: string;
  /** 0–1 — вес пула (фаза B); не влияет на размер бюджета */
  availability: number;
  /** Складской минимум (reserves.minimum); 0 — только фаза B */
  minimum: number;
  /** Приоритет резерва (reserves.priority); больше = раньше при равном fulfillment */
  priority: number;
}

/** Контекст двигателя: чтение состояния + применение добычи (единственная точка мутации). */
export interface MiningSchedulerContext {
  /** Авторитетный остаток планетарного пула (remainingQuantity) */
  remaining: (oreId: string) => number;
  /** Складской запас уже добытого (planet.resources[oreId]) */
  stock: (oreId: string) => number;
  /**
   * Применить добычу: вычесть из пула и положить на склад только реально
   * помещаемый объём (canStoreResource); вернуть фактически добытое.
   * Гарантии двигателя: 0 ≤ actual ≤ min(amount, remaining).
   */
  tryExtract: (oreId: string, amount: number) => number;
}

/** Итог распределения: добытые объёмы по oreId (только фактически добытое). */
export interface MiningOrder {
  oreId: string;
  amount: number;
}

const EPS = 1e-9;

/**
 * Распределить единый бюджет здания между кандидатами (docs/35 §2.7).
 *
 * @param budget суммарный бюджет здания за тик (рассчитан один раз на здание)
 * @param candidates совместимые пулы (двигатель фильтрует по роли/уровню и
 *        сортирует по oreId — порядок входа не влияет на результат)
 * @param ctx контекст двигателя (remaining/stock/tryExtract)
 * @returns фактически добытые объёмы по oreId (сумма ≤ budget)
 */
export function distributeMiningBudget(
  budget: number,
  candidates: PoolCandidate[],
  ctx: MiningSchedulerContext,
): MiningOrder[] {
  const orders = new Map<string, number>();
  if (!(budget > EPS) || candidates.length === 0) return [];

  // Детерминизм (docs/35 §2.7.4): порядок входа НЕ влияет на результат —
  // внутренний порядок кандидатов задаётся стабильной сортировкой oreId
  // (порядок обхода и суммирования весов фиксируется → бит-в-бит).
  // Список кандидатов фиксируется до распределения: пул, ставший доступным
  // после начала тика, не появляется задним числом (docs/35 §2.7.3.5).
  const list = candidates.slice().sort((a, b) => (a.oreId < b.oreId ? -1 : a.oreId > b.oreId ? 1 : 0));

  let budgetLeft = budget;
  // Исключённые до конца тика: пустой пул или склад без места (не ждём
  // недоступную руду — другие кандидаты продолжают получать бюджет).
  const excluded = new Set<string>();

  const extract = (oreId: string, want: number): number => {
    if (!(want > EPS)) return 0;
    const actual = ctx.tryExtract(oreId, want);
    if (actual > EPS) {
      orders.set(oreId, (orders.get(oreId) ?? 0) + actual);
      budgetLeft -= actual;
    }
    return actual;
  };

  // ── Фаза A: недовыполненные минимумы (наименьший fulfillment → priority → oreId)
  const fulfilled = new Set<string>();
  for (;;) {
    if (budgetLeft <= EPS) break;

    let best: PoolCandidate | null = null;
    let bestFulfillment = 0;
    let bestShortfall = 0;
    for (const c of list) {
      if (excluded.has(c.oreId) || fulfilled.has(c.oreId)) continue;
      if (!(c.minimum > EPS)) continue;
      const shortfall = c.minimum - ctx.stock(c.oreId);
      if (shortfall <= EPS) { fulfilled.add(c.oreId); continue; } // минимум закрыт — освобождает бюджет
      if (ctx.remaining(c.oreId) <= EPS) { excluded.add(c.oreId); continue; } // пул пуст
      const fulfillment = Math.min(1, ctx.stock(c.oreId) / c.minimum);
      const better =
        best === null
        || fulfillment < bestFulfillment - EPS
        || (Math.abs(fulfillment - bestFulfillment) <= EPS && c.priority > best.priority)
        || (Math.abs(fulfillment - bestFulfillment) <= EPS && c.priority === best.priority && c.oreId < best.oreId);
      if (better) {
        best = c;
        bestFulfillment = fulfillment;
        bestShortfall = shortfall;
      }
    }
    if (best === null) break; // недовыполненных доступных минимумов нет

    // Выдать не больше: остатка бюджета, недостачи до минимума, остатка пула
    // (место склада ограничивает tryExtract-колбэк двигателя).
    const want = Math.min(budgetLeft, bestShortfall, ctx.remaining(best.oreId));
    const actual = extract(best.oreId, want);
    if (actual <= EPS) {
      // Пул пуст или склад не принимает — кандидат исключается до конца тика,
      // его доля перераспределяется остальным (переоценка в следующей итерации).
      excluded.add(best.oreId);
    }
  }

  // ── Фаза B: пропорциональный излишек (вес = remaining × availability)
  // Доли считаются от бюджета НАЧАЛА прохода (нормировка — сумма долей
  // = бюджет прохода); объём, не принятый складом/пулом, пере-
  // распределяется следующим проходом (порядок обхода — стабильный oreId).
  for (;;) {
    if (budgetLeft <= EPS) break;

    const active = list.filter((c) => !excluded.has(c.oreId) && ctx.remaining(c.oreId) > EPS);
    if (active.length === 0) break;

    const passBudget = budgetLeft;
    const weights = active.map((c) => ctx.remaining(c.oreId) * Math.max(0, c.availability));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (!(totalWeight > EPS)) break;

    let anyExtracted = false;
    for (let i = 0; i < active.length; i++) {
      if (budgetLeft <= EPS) break;
      const c = active[i]!;
      const share = passBudget * weights[i]! / totalWeight;
      if (!(share > EPS)) continue;
      const want = Math.min(share, budgetLeft);
      const actual = extract(c.oreId, want);
      if (actual > EPS) {
        anyExtracted = true;
      } else {
        // Склад не принимает / пул исчерпан между проходами — исключить,
        // остаток бюджета уйдёт другим в следующем проходе.
        excluded.add(c.oreId);
      }
    }
    if (!anyExtracted) break; // никто не может добыть — бюджет не тратится
  }

  return Array.from(orders.entries())
    .map(([oreId, amount]) => ({ oreId, amount }))
    .sort((a, b) => (a.oreId < b.oreId ? -1 : a.oreId > b.oreId ? 1 : 0));
}
