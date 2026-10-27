/**
 * Генерация ресурсов планеты.
 *
 * Философия: на каждой планете есть ВСЯ таблица элементов (как таблица Менделеева).
 * Профильные ресурсы (соответствующие типу планеты) — в ЗНАЧИТЕЛЬНОМ количестве.
 * Редкие — в следовых количествах (но всегда есть).
 * Ультраредкие — 1-2 уникальных для планеты.
 *
 * ВАЖНО: в гексах генерируются залежи РУД (не чистых элементов).
 * ID руды берётся из ORE_FOR_ELEMENT_MAP, который маппит элемент → реальную руду
 * (Fe→Fe-ore, Ca→CaCO3, Na→NaCl и т.д.).
 * При добыче руда конвертируется в содержащиеся элементы через BakedGalaxyModel.
 *
 * R-27: КИСЛОРОД И ВОДОРОД НЕ ГЕНЕРИРУЮТСЯ В ВИДЕ ЗАЛЕЖЕЙ — это же вода!
 * Атмосферные элементы (H, He, N, O, Ne, Ar) не создают залежей в породе:
 * их источники — атмосфера (газовый экстрактор) и Вода (H2O-ice).
 * Вода — единственная залежь-источник H и O: электролиз в processor
 * (рецепт process_H2O) даёт водород + кислород.
 *
 * R-36 (вариант «а» владельца): пулы RARE/ULTRA_RARE = docs/31 §2; элементы
 * пула ULTRA_RARE (все 10 — deep_ore/drilling_rig) генерируют СЛЕДОВЫЕ
 * глубинные залежи (depth 4–5, availability 0.02–0.10) — базовое присутствие
 * ultra_rare минимально (§1.1/§3.2), извлечение — буровой установкой
 * (здание в MVP-каталоге).
 *
 * R-37 (вердикт аудитора R-36, блокеры Б2/Б3): КОНТРАКТ «свод = физика».
 *   1. Выбор уникального ресурса планеты (1–2 из пула ULTRA_RARE) переехал
 *      из aggregateResourceDeposits ВНУТРЬ assignResourceDeposits (конец
 *      потока) — материализация (replay снимка) воспроизводит и ВЫБОР, и
 *      усиленную залежь бит-в-бит. Прежде выбор не воспроизводился: пул
 *      обещал 4–6 выбранного элемента, физика давала следы 1–3.
 *   2. aggregateResourceDeposits — ЧИСТАЯ агрегация физики (руды→элементы
 *      по долям выхода) + гарантия всех элементов (записи с hexCount=0 —
 *      «геологическая оценка, залежи не разведаны»). Отображаемая
 *      концентрация всегда равна доступной добыче.
 *   3. Версионная совместимая материализация: загрузка сейва НЕ
 *      материализует тела (ленивость R-29 и размер сейва сохранены);
 *      materializePlanetDeposits (колонизация) — единственная точка входа
 *      залежей в игру: replay + ПЕРЕСЧЁТ сводного пула продолжением того же
 *      RNG-потока. Для тел dv ≠ DEPOSIT_RNG_VERSION дрейф поглощается: пул
 *      следует за физикой (несогласованность исключена по построению).
 */

import { Xoshiro128StarStar } from '@/core/prng';
import type { HexCell, PlanetResourceDeposit } from '@/core/types';
import { PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups, findContainedElements } from '@/data/baked-lookups';

/** Планетарный пул уникальных ресурсов как Set (горячий цикл генерации, R-36). */
const ULTRA_POOL_SET = new Set<string>(ULTRA_RARE_ELEMENTS);

/** R-29: тело (планета/луна) с ленивыми залежами — минимальный интерфейс материализации. */
export interface LazyDepositBody {
  /** ID тела — детерминированная соль RNG миграции свод-пула (R-38). */
  id?: string;
  hexes: HexCell[];
  type: string;
  depositsMaterialized?: boolean;
  depositRngState?: number[] | null;
  /** R-36: версия семантики RNG/веток генерации залежей (см. DEPOSIT_RNG_VERSION). */
  depositRngVersion?: number;
  /**
   * R-38: версия КОНТРАКТА свод-пула (см. DEPOSIT_SUMMARY_VERSION). Отдельна от
   * dv: dv описывает ФИЗИКУ (кем сгенерированы залежи), sv — СВОД (по каким
   * правилам агрегирован пул). Проставляется materializePlanetDeposits (replay
   * текущим кодом) и migrateMaterializedBodySummary (R-38-миграция старых
   * материализованных тел: физика сохраняется, свод пересчитывается).
   */
  depositSummaryVersion?: number;
  /**
   * R-37 (Б2): свод-пул тела. Если присутствует (массив) — при материализации
   * ПЕРЕСЧИТЫВАЕТСЯ из свежих физических залежей (согласованность пул ↔ гексы;
   * для тел старых версий dv это и есть миграция пула).
   */
  resourceDeposits?: PlanetResourceDeposit[];
}

/**
 * R-37: версия семантики генерации залежей (RNG-поток + ветки).
 *
 * История:
 *   1 — до R-36 (Fisher–Yates G-05, пул W/Co/Pt/Y/Ba/Au/U/Li/V, без
 *       отдельной ultra-ветки);
 *   2 — R-36: пулы = docs/31 §2 (вариант «а»), ultra-ветка следовых глубинных
 *       залежей; выбор уникального ресурса — в aggregateResourceDeposits
 *       (отдельный поток derive('ultra'), НЕ воспроизводился материализацией);
 *   3 — R-37 (блокеры Б2/Б3 аудита R-36): выбор уникального ресурса — ВНУТРИ
 *       assignResourceDeposits (конец потока; усиленная залежь qty 4–6,
 *       availability 0.03–0.10, depth 4–5); свод-пул = чистая агрегация физики
 *       + гарантия элементов (hexCount=0 = оценка); RNG пула — продолжение
 *       deposit-потока (прежде отдельный derive('ultra')).
 *
 * Защита сейвов (версионная совместимая материализация, R-37): сейв v3 хранит
 * `dv`; при ЗАГРУЗКЕ тела НЕ материализуются (ленивость и размер сейва
 * сохранены, deserializeGameState лишь ведёт перепись ожидающих). При
 * КОЛОНИЗАЦИИ materializePlanetDeposits реплеит снимок ТЕКУЩИМ кодом и
 * ПЕРЕСЧИТЫВАЕТ свод-пул из свежей физики — для тел dv ≠ текущей дрейф
 * поглощается (пул следует за физикой), несогласованность исключена
 * по построению.
 */
export const DEPOSIT_RNG_VERSION = 3;

/**
 * R-38: версия КОНТРАКТА свод-пула resourceDeposits (отдельна от dv).
 *
 * История:
 *   0 — (неявная, сейвы до R-38) пул считался прежней семантикой агрегации:
 *       до R-36 — иной состав пула; R-36 — выбранный уникальный ресурс
 *       ПЕРЕЗАПИСЫВАЛСЯ в пуле константами 4–6 без согласования с физикой
 *       гексов (несогласованность «свод ≠ добыча», блокер Б3 аудита R-36).
 *       Для НЕматериализованных тел дрейф поглощается версионной
 *       материализацией R-37 (replay + пересчёт при колонизации), но тела,
 *       УЖЕ материализованные в старых сейвах (dm=1, dv≠текущей), навсегда
 *       сохраняли устаревший свод — дефект совместимости, закрытый R-38.
 *   1 — R-38: «свод = физика» (пул = чистая агрегация физических залежей
 *       + гарантия элементов hexCount=0, выбор уникального ресурса — в
 *       assignResourceDeposits). Проставляется:
 *         а) materializePlanetDeposits (replay текущим кодом);
 *         б) migrateMaterializedBodySummary — R-38-миграция старых
 *            материализованных тел при загрузке сейва (deserializeGameState):
 *            ФИЗИКА СОХРАНЯЕТСЯ КАК ЕСТЬ (добытый прогресс, истощение,
 *            здания, склад — неприкосновенны), устаревший свод пересчитывается
 *            из фактических залежей. dv НЕ поднимается: версия физики —
 *            честная (тело, материализованное старым кодом, НЕ эквивалентно
 *            телу новой генерации; обновление dv само по себе не доказывает
 *            корректность физики — требование аудита R-38 §2.4).
 *
 * В сейве пишется как `sv` (рядом с ds/dm/dv, только если известна —
 * побайтная идемпотентность сейвов без sv сохранена, как у dv в R-37).
 */
export const DEPOSIT_SUMMARY_VERSION = 1;

/**
 * R-29/R-37: ленивая (версионно-совместимая) материализация залежей гексов.
 *
 * До колонизации планета знает только свод-пул resourceDeposits («сколько
 * всего»); гексы пусты (depositRngState хранит снимок RNG ДО прогона
 * генерации). При колонизации этот проигрывает assignResourceDeposits из
 * сохранённого состояния → бит-в-бит те же залежи, что дал бы полный
 * прогон при генерации галактики (включая ВЫБОР уникального ресурса — R-37:
 * выбор живёт внутри assignResourceDeposits).
 *
 * R-37 (Б2/Б3 аудита R-36): свод-пул ПЕРЕСЧИТЫВАЕТСЯ из свежей физики
 * продолжением ТОГО ЖЕ RNG-потока — та же функция, тот же поток, что и при
 * генерации, поэтому пул ↔ залежи согласованы по построению. Для тел,
 * записанных прежней версией генерации (dv ≠ DEPOSIT_RNG_VERSION), это и
 * есть миграция: дрейф физики поглощается пересчитанным пулом (явный
 * console.warn — без молчаливой порчи, требование аудита R-35/R-37).
 *
 * Идемпотентна: уже материализованное тело (флаг или отсутствие снимка)
 * не трогается — повторный вызов не дублирует залежи (флаг dm в сейве v3
 * хранит материализованность, R-30: сейвы старых форматов не читаются).
 *
 * @returns true, если залежи были материализованы в этом вызове.
 */
export function materializePlanetDeposits(body: LazyDepositBody): boolean {
  if (body.depositsMaterialized) return false;
  if (!body.depositRngState || body.hexes.length === 0) return false;

  // Версия тела ДО replay — для журнала миграции (R-37).
  const staleVersion = body.depositRngVersion ?? 1;

  // Task 37 (D2, hardening): очистка гексов перед replay — защита от дублей.
  // В нормальном потоке гексы уже пусты (генерация стирает залежи после расчёта
  // свода, сейв v3 не пишет залежи не-материализованных тел), но если тело
  // попало в смешанное состояние (флаг сброшен при непустых залежах), replay
  // дописал бы кортежи ПОВЕРХ существующих. Стирание делает материализацию
  // идемпотентной независимо от флага.
  for (const hex of body.hexes) hex.deposits = [];

  const rng = Xoshiro128StarStar.fromState(body.depositRngState);
  assignResourceDeposits(body.hexes, rng, body.type);
  body.depositsMaterialized = true;

  // R-38: физика воспроизведена ТЕКУЩИМ кодом — версия физики честно
  // актуальна (раньше dv оставался старым и после replay, что ложно
  // помечало свежесгенерированные залежи как «до R-36/37»). Свод-пул
  // (ниже) пересчитывается из этой же физики текущей семантикой агрегации.
  body.depositRngVersion = DEPOSIT_RNG_VERSION;

  // R-37 (Б2): согласованное обновление сводного пула — агрегация свежей
  // физики продолжением того же потока (бит-в-бит как при генерации).
  // Только для тел, несущих пул (живые планеты/луны; синтетические заглушки
  // тестов без пула не трогаются).
  if (Array.isArray(body.resourceDeposits)) {
    body.resourceDeposits = aggregateResourceDeposits(body.hexes, body.type, rng);
    // R-38: пул пересчитан текущим контрактом — фиксируем версию свода.
    body.depositSummaryVersion = DEPOSIT_SUMMARY_VERSION;
  }

  // ВНИМАНИЕ (R-37): снимок ds СОЗНАТЕЛЬНО НЕ обнуляется (поведение R-29
  // сохранено). Во-первых, это защищает контракт восстановления (D2-тест 11):
  // при сброшенном флаге и непустых залежах replay по ds восстанавливает
  // эталон без дублей. Во-вторых, мёртвый ds у материализованного тела —
  // ~20 байт в сейве (несущественно против залежей гексов); миграционная
  // ценность dv (перепись ожидающих на загрузке) сохраняется. Прежняя
  // миграция R-36 (migrateDepositsIfNeeded) обнуляла ds только потому,
  // что материализовала тела ЗА пределами колонизации — теперь этой ветки
  // нет.

  if (staleVersion !== DEPOSIT_RNG_VERSION) {
    console.warn(
      `[deposits] R-37: версионная материализация тела (dv ${staleVersion} → ${DEPOSIT_RNG_VERSION}): `
      + 'залежи воспроизведены текущей семантикой, свод-пул пересчитан из физики',
    );
  }
  return true;
}

// ─── R-38: миграция свод-пула МАТЕРИАЛИЗОВАННЫХ тел старых сейвов ────────────

/**
 * R-38: действующая версия контракта свод-пула тела.
 *
 * Тело с dv = DEPOSIT_RNG_VERSION и БЕЗ явного sv (сейвы R-37, поле ещё не
 * существовало) считается соответствующим текущему контракту: их пулы
 * считались materializePlanetDeposits/генерацией R-37 (чистая агрегация +
 * гарантия). Тела с иной/неизвестной dv — версией 0 (устаревшая семантика).
 */
export function summaryContractVersion(body: LazyDepositBody): number {
  if (typeof body.depositSummaryVersion === 'number') return body.depositSummaryVersion;
  return body.depositRngVersion === DEPOSIT_RNG_VERSION ? DEPOSIT_SUMMARY_VERSION : 0;
}

/**
 * R-38: нужно ли телу пересчитать устаревший свод-пул?
 *
 * Условия: тело УЖЕ материализовано (dm=1 — залежи в гексах физические,
 * трогать их нельзя: прогресс добычи/истощение неприкосновенны), имеет
 * гексы и свод устаревшего контракта. Ленивые тела (dm=0) НЕ попадают:
 * их миграция — версионная материализация при колонизации (R-37),
 * ленивость и размер сейва сохранены.
 */
export function needsSummaryMigration(body: LazyDepositBody): boolean {
  return body.depositsMaterialized === true
    && Array.isArray(body.hexes)
    && body.hexes.length > 0
    && summaryContractVersion(body) < DEPOSIT_SUMMARY_VERSION;
}

/**
 * R-38: детерминированный RNG оценок гарантии для миграции свода.
 *
 * aggregateResourceDeposits потребляет RNG в фазе гарантии (оценки элементов
 * без физических залежей, hexCount=0). При миграции продолжить депозитный
 * поток НЕЛЬЗЯ (точка после assign не сохранена), поэтому оценки берутся из
 * ИМЕНОВАННОГО дочернего потока от снимка ds: derive() не потребляет
 * родителя, детерминирован и воспроизводим в любом процессе/окружении
 * (C-тесты R-38). Тела без ds (повреждённые/краевые) — базовое состояние
 * fromState(null), уникальность обеспечивает соль id тела в имени потока.
 */
function deriveSummaryEstimateRng(body: LazyDepositBody): Xoshiro128StarStar {
  return Xoshiro128StarStar.fromState(body.depositRngState)
    .derive(`r38-summary-v${DEPOSIT_SUMMARY_VERSION}:${body.id ?? 'unknown'}`);
}

/**
 * R-38: безопасная миграция устаревшего свод-пула МАТЕРИАЛИЗОВАННОГО тела.
 *
 * КОНТРАКТ (аудит R-38 §2.3):
 *   - физические залежи НЕ регенерируются и не меняются (частично/полностью
 *     истощённые остаются истощёнными — «не восстанавливать истощённую
 *     залежь до первоначального количества»);
 *   - dv НЕ поднимается — версия физики остаётся честной (старое тело НЕ
 *     эквивалентно телу новой генерации; обновление dv ничего не доказывает);
 *   - свод пересчитывается из ФАКТИЧЕСКОЙ физики текущим контрактом
 *     («свод = физика»: пул = Σ(залежи × доля выхода) + гарантия hexCount=0);
 *   - проставляется depositSummaryVersion — повторная загрузка идемпотентна;
 *   - всё прочее (здания, склад resources, owner, очереди, энергия)
 *     неприкосновенно — функция читает hexes/type и пишет ТОЛЬКО
 *     resourceDeposits + depositSummaryVersion.
 *
 * Атомарность на тело: исключение/невалидный результат — тело остаётся со
 * СТАРЫМ сводом (частично изменённое состояние исключено), загрузка
 * продолжается (отказ миграции одного тела не должен блокировать игру —
 * задание R-38 §2.5: предсказуемая обработка без тихого уничтожения).
 *
 * @returns true, если свод был пересчитан в этом вызове.
 */
export function migrateMaterializedBodySummary(body: LazyDepositBody): boolean {
  if (!needsSummaryMigration(body)) return false;

  try {
    const estimateRng = deriveSummaryEstimateRng(body);
    const migrated = aggregateResourceDeposits(body.hexes, body.type, estimateRng);

    // Валидация результата: NaN/Infinity в своде = повреждённые числовые
    // данные сейва (например, нечисловые quantity в кортежах) — НЕ тиражируем
    // мусор в пул, тело сохраняет прежний (числовой) свод, попытка — отказ.
    for (const entry of migrated) {
      if (!Number.isFinite(entry.totalQuantity) || !Number.isFinite(entry.avgAvailability)
        || !Number.isFinite(entry.maxAvailability)) {
        throw new Error(`невалидная агрегация: элемент ${entry.elementId} даёт NaN/Inf`);
      }
    }

    body.resourceDeposits = migrated;
    body.depositSummaryVersion = DEPOSIT_SUMMARY_VERSION;
    return true;
  } catch (err) {
    console.warn(
      `[deposits] R-38: миграция свод-пула тела ${body.id ?? '?'} ОТКАЗАНА — `
      + `сохранён прежний свод (${err instanceof Error ? err.message : String(err)})`,
    );
    return false;
  }
}

// Множители количества по категории для каждого типа планеты
const CATEGORY_MULTIPLIERS: Record<string, Record<string, number>> = {
  rocky:    { structural: 2.5, fuel: 0.5, alloy: 1.5, electronics: 0.8, chemical: 0.6, energy: 0.5, rare: 0.3, light: 0.5 },
  volcanic: { structural: 1.8, fuel: 0.3, alloy: 2.5, electronics: 0.6, chemical: 1.2, energy: 2.0, rare: 0.8, light: 0.2 },
  ice:      { structural: 0.4, fuel: 2.0, alloy: 0.3, electronics: 0.2, chemical: 1.8, energy: 0.2, rare: 0.15, light: 1.0 },
  oceanic:  { structural: 0.7, fuel: 1.0, alloy: 0.5, electronics: 0.5, chemical: 1.8, energy: 0.3, rare: 0.2, light: 0.6 },
  desert:   { structural: 1.2, fuel: 0.2, alloy: 1.0, electronics: 0.6, chemical: 0.3, energy: 0.6, rare: 0.5, light: 0.3 },
  gas_giant:{ structural: 0.1, fuel: 3.0, alloy: 0.1, electronics: 0.1, chemical: 2.5, energy: 0.1, rare: 0.1, light: 1.5 },
  dwarf:    { structural: 0.6, fuel: 0.3, alloy: 0.4, electronics: 0.2, chemical: 0.3, energy: 0.2, rare: 0.15, light: 0.3 },
};

/**
 * Получить реальный ID руды для элемента.
 * R-27: атмосферные элементы (H, He, O, N и др.) НЕ создают залежей —
 * вызывается только для не-атмосферных элементов. Газовые экстракторы
 * добывают атмосферные газы напрямую из атмосферы (engine.ts, P1-01).
 */
function getOreIdForElement(elementId: string): string {
  const lookups = getCurrentLookups();
  const oreId = lookups.elementToOre[elementId];
  if (oreId) return oreId;
  // Fallback для элементов без маппинга (трансурановые и т.д.)
  return `${elementId}-ore`;
}

/**
 * Обилие воды (H2O-ice) по типу планеты — R-27.
 * Ледяные и океанические миры богаты водой; пустынные — бедны;
 * газовые гиганты воды на поверхности не имеют.
 */
const WATER_ABUNDANCE: Record<string, number> = {
  rocky: 0.4,
  volcanic: 0.2,
  ice: 3.0,
  oceanic: 2.5,
  desert: 0.15,
  gas_giant: 0,
  dwarf: 0.3,
};

/**
 * ID водной залежи (лёд) — добывается шахтой/карьером, электролиз даёт H + O.
 * Экспортируется для engine.ts (G-01/Task 37: фильтр залежей по роли здания).
 */
export const WATER_DEPOSIT_ID = 'H2O-ice';

/**
 * G-05 (Task 37, fix): детерминированное перемешивание Fisher–Yates.
 *
 * Прежний подход `.sort(() => rng.nextFloat() - 0.5)` использовал
 * НЕПОСЛЕДОВАТЕЛЬНЫЙ компаратор (для одной и той же пары элементов может
 * вернуть противоположные знаки → нарушена транзитивность порядка):
 *   - распределение перестановок СМЕЩЕНО: элемент из начала массива
 *     оставался в начале до 3.2× чаще равномерного (замер Task 37: N=61,
 *     20000 прогонов, chi²=4637 при df=60, порог p<0.01 ≈ 92) → залежи
 *     концентрировались на «ранних» гексах спирали (географический перекос);
 *   - число вызовов RNG зависело от внутреннего алгоритма sort движка
 *     (замер в JSC/bun: 212–287 вызовов на массив из 61) → в браузере (V8)
 *     тот же seed давал ДРУГИЕ перестановки — кросс-окруженческая
 *     невоспроизводимость генерации.
 *
 * Fisher–Yates равномерен по перестановкам и потребляет ровно n−1 вызовов
 * nextFloat — поведение одинаково на всех движках.
 *
 * ВНИМАНИЕ (сдвиг RNG-потока): старый shuffle съедал ~275 вызовов на 61 гекс,
 * новый — ровно 60 → все последующие значения потока depositRng сдвинулись,
 * вывод генерации залежей изменился для ВСЕХ seed (ожидаемо и задокументировано).
 */
export function shuffledWithRng<T>(items: readonly T[], rng: Xoshiro128StarStar): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    const a = arr[j] as T;
    arr[j] = arr[i] as T;
    arr[i] = a;
  }
  return arr;
}

/**
 * Назначить ресурсные залежи на гексах.
 * Каждый элемент размещается на гексах в виде своей основной руды.
 * R-27: атмосферные элементы (H, He, O, N, Ne, Ar) залежей не создают —
 * вместо этого генерируется Вода (H2O-ice), из которой электролизом
 * получаются водород и кислород.
 */
export function assignResourceDeposits(hexes: HexCell[], rng: Xoshiro128StarStar, planetType: string): void {
  if (hexes.length === 0) return;

  const nonOceanHexes = hexes.filter(h => h.terrain !== 'ocean');
  if (nonOceanHexes.length === 0) return;

  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  // Task 37 (базовая гигиена tsc): явная проверка фолбэка — раньше тип был
  // `Record | undefined` из-за noUncheckedIndexedAccess (3 pre-existing ошибки)
  const catMult = CATEGORY_MULTIPLIERS[planetType] ?? CATEGORY_MULTIPLIERS.rocky;
  if (!catMult) return;

  // Для КАЖДОГО элемента из таблицы — создаём залежи его руды.
  // R-27: атмосферные элементы пропускаем — залежей газа в породе нет.
  for (const element of ELEMENTS) {
    if (element.isAtmospheric) continue;

    const cat = element.category;
    const mult = catMult[cat] ?? 0.3;
    const isProfile = profileSet.has(element.id);
    const isRare = rareSet.has(element.id);
    // R-36: планетарный пул уникальных ресурсов (docs/31 §2/§8.2, вариант «а»).
    const isUltraPool = ULTRA_POOL_SET.has(element.id);

    let baseQuantity: number;
    let hexFraction: number;
    let baseAvailability: number;

    if (isProfile) {
      baseQuantity = (200 + rng.nextFloat() * 800) * mult * 3.0;
      hexFraction = Math.min(0.6, 0.2 + mult * 0.3);
      baseAvailability = 0.3 + rng.nextFloat() * 0.5;
    } else if (isUltraPool) {
      // R-36 (вариант «а»): элементы пула ULTRA_RARE — ВСЕ deep_ore
      // (drilling_rig), у каждого базовое присутствие МИНИМАЛЬНО (docs/31
      // §1.1 «на всех планетах есть все ресурсы» + §3.2: ultra_rare ×0.05).
      // ДО R-36 они шли по обычной ветке (qty 6–42/гекс × 4–6 гексов →
      // свод ≥ 10) и после синхронизации пула со спекой ВСЕ кандидаты
      // отсеивались фильтром eligibleUltra (qty ≥ 10) → 0 уникальных на
      // планете — регрессия G-06. Следовые количества (×0.05 от обычной
      // ветки) держат qty 1–3 < 10 → пул кандидатов никогда не пуст.
      baseQuantity = (5 + rng.nextFloat() * 30) * mult * 0.05;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.02 + mult * 0.05);
      baseAvailability = 0.02 + rng.nextFloat() * 0.08;
    } else if (isRare) {
      baseQuantity = (5 + rng.nextFloat() * 30) * mult * 0.15;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.1);
      baseAvailability = 0.02 + rng.nextFloat() * 0.12;
    } else {
      baseQuantity = (20 + rng.nextFloat() * 120) * mult;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.15);
      baseAvailability = 0.1 + rng.nextFloat() * 0.3;
    }

    const hexCount = Math.max(1, Math.min(
      nonOceanHexes.length,
      Math.ceil(hexFraction * nonOceanHexes.length),
    ));

    // Используем реальный ID руды из ORE_FOR_ELEMENT_MAP
    const oreId = getOreIdForElement(element.id);

    // G-05 (fix): равномерное перемешивание Fisher–Yates (см. shuffledWithRng)
    const shuffled = shuffledWithRng(nonOceanHexes, rng);
    for (let h = 0; h < hexCount && h < shuffled.length; h++) {
      const targetHex = shuffled[h];
      if (!targetHex) continue; // noUncheckedIndexedAccess
      const quantityVariance = 0.5 + rng.nextFloat();
      targetHex.deposits.push({
        elementId: oreId,
        availability: Math.min(1, baseAvailability * (0.7 + rng.nextFloat() * 0.6)),
        quantity: Math.max(1, Math.round(baseQuantity * quantityVariance)),
        // Глубина: уникальные — глубинные залежи (docs/31 §6.1: depth 4–5 —
        // юрисдикция drilling_rig); редкие — 3–5; остальные — 1–4.
        depth: isUltraPool ? rng.nextInt(4, 5) : isRare ? rng.nextInt(3, 5) : rng.nextInt(1, 4),
      });
    }
  }

  // ── R-27: Вода (H2O-ice) — единственная залежь-источник H и O ─────────────
  // Кислород и водород не встречаются в виде отдельных залежей — это же вода!
  // Ледяные/океанические миры богаты водой; пустыни и вулканы — бедны;
  // газовые гиганты поверхности не имеют (hexes пуст → ранний return выше,
  // но и явный множитель 0 для надёжности).
  const waterMult = WATER_ABUNDANCE[planetType] ?? 0.3;
  if (waterMult > 0) {
    const baseQuantity = (80 + rng.nextFloat() * 400) * waterMult;
    const hexFraction = Math.min(0.55, 0.1 + waterMult * 0.18);
    const baseAvailability = 0.15 + rng.nextFloat() * 0.45;
    const hexCount = Math.max(1, Math.min(
      nonOceanHexes.length,
      Math.ceil(hexFraction * nonOceanHexes.length),
    ));

    // G-05 (fix): равномерное перемешивание Fisher–Yates (см. shuffledWithRng)
    const shuffledWater = shuffledWithRng(nonOceanHexes, rng);
    for (let h = 0; h < hexCount && h < shuffledWater.length; h++) {
      const waterHex = shuffledWater[h];
      if (!waterHex) continue;
      const quantityVariance = 0.5 + rng.nextFloat();
      waterHex.deposits.push({
        elementId: WATER_DEPOSIT_ID,
        availability: Math.min(1, baseAvailability * (0.7 + rng.nextFloat() * 0.6)),
        quantity: Math.max(1, Math.round(baseQuantity * quantityVariance)),
        depth: rng.nextInt(1, 3),
      });
    }
  }

  // Случайные богатые залежи профильных ресурсов на 15% гексов
  // R-27: атмосферные элементы исключены и здесь — богатые залежи H2/O2
  // больше не генерируются.
  for (const hex of nonOceanHexes) {
    if (rng.nextBool(0.15)) {
      const profileElements = ELEMENTS.filter(e => profileSet.has(e.id) && !e.isAtmospheric);
      const element = profileElements.length > 0
        ? rng.nextChoice(profileElements)
        : rng.nextChoice(ELEMENTS.filter(e => !e.isAtmospheric));
      const cat = element.category;
      const mult = catMult[cat] ?? 0.3;
      const oreId = getOreIdForElement(element.id);
      hex.deposits.push({
        elementId: oreId,
        availability: 0.5 + rng.nextFloat() * 0.5,
        quantity: Math.round((200 + rng.nextFloat() * 800) * mult * 2),
        depth: rng.nextInt(1, 3),
      });
    }
  }

  // ── R-37: выбор уникального ресурса планеты (docs/31 §8.2) ────────────────
  // Фаза в КОНЦЕ потока (после следовых веток/воды/богатых залежей): физика
  // прочих элементов бит-в-бит совпадает с R-36. Выбор живёт ВНУТРИ
  // назначителя залежей, поэтому материализация (replay снимка) воспроизводит
  // и ВЫБОР, и усиленную залежь бит-в-бит — прежде выбор жил в
  // aggregateResourceDeposits (отдельный поток derive('ultra')) и при
  // материализации ТЕРЯЛСЯ: пул обещал 4–6 выбранного элемента, физика давала
  // следы 1–3 (несогласованность свод-пула и добычи — блокер Б3 аудита R-37).
  //
  // Контракт: 1–2 элемента пула ULTRA_RARE (не профильные — пересечение пусто,
  // без повторов выбора) получают «повышенную концентрацию»: их следовые
  // залежи СТИРАЮТСЯ и заменяются ОДНОЙ глубинной залежью на случайном
  // не-океанском гексе — depth 4–5 (юрисдикция drilling_rig, docs/31 §6.1),
  // qty 4–6 ЕДИНИЦ РУДЫ (чистого элемента — qty × доля выхода руды, напр.
  // Ir-ore = Ir 7.5/10 → 3.0–4.5 Ir), availability 0.03–0.10. Свод-пул
  // (aggregateResourceDeposits) — чистая агрегация этой физики, поэтому
  // отображаемая концентрация всегда равна доступной добыче.
  //
  // Полностью океанские миры: nonOceanHexes пуст → ранний return выше →
  // выбора НЕТ — пул без «повышенных концентраций» (нет поверхности — нет и
  // добычи; пул честно остаётся геологической оценкой, hexCount=0).
  const ultraCount = rng.nextInt(1, 2);
  const ultraCandidates = ULTRA_RARE_ELEMENTS.filter(e => !profileSet.has(e));
  for (let i = 0; i < ultraCount && ultraCandidates.length > 0; i++) {
    const elId = rng.nextChoice(ultraCandidates);
    // выбор без повторов (G-06): убрать выбранного из пула кандидатов
    ultraCandidates.splice(ultraCandidates.indexOf(elId), 1);

    const oreId = getOreIdForElement(elId);
    // Следовые залежи выбранной руды стираются — физика выбранного элемента
    // сводится к единственной усиленной залежи (без хвостов).
    for (const hex of nonOceanHexes) {
      if (hex.deposits.some(d => d.elementId === oreId)) {
        hex.deposits = hex.deposits.filter(d => d.elementId !== oreId);
      }
    }
    const targetHex = rng.nextChoice(nonOceanHexes);
    targetHex.deposits.push({
      elementId: oreId,
      availability: 0.03 + rng.nextFloat() * 0.07, // 0.03–0.10
      quantity: 4 + Math.floor(rng.nextFloat() * 3), // 4–6 (оруда)
      depth: rng.nextInt(4, 5), // глубинная — drilling_rig
    });
  }
}

/**
 * Агрегация ресурсных залежей из гексов в сводную таблицу планеты (R-37).
 * Конвертирует руды в элементы (по containedElements из ORE_MAP / ATMOSPHERIC_COMPOUND_MAP)
 * и показывает, какие ЧИСТЫЕ ЭЛЕМЕНТЫ можно получить на планете.
 *
 * R-37 (блокер Б3 аудита R-36) — ЧИСТАЯ агрегация физики + гарантия элементов:
 *   - пул = Σ(залежи руд × доля выхода) → отображаемая концентрация ВСЕГДА
 *     равна доступной добыче (прежде выбранный ultra ПЕРЕЗАПИСЫВАЛСЯ в пуле
 *     константами 4–6, не согласуясь с гексами);
 *   - выбор уникального ресурса переехал в assignResourceDeposits (R-37) —
 *     усиленная залежь выбранного элемента приходит на вход как обычная
 *     физика и агрегируется на общих основаниях;
 *   - элементы без физических залежей (атмосферные; полностью океанские
 *     миры/ГГ) добавляются фазой гарантии с hexCount=0 — «геологическая
 *     оценка с орбиты, залежи не разведаны» (честная метка вместо
 *     обещанных физики).
 *
 * RNG: продолжение deposit-потока ПОСЛЕ assignResourceDeposits — та же точка,
 * из которой пул считается при материализации (materializePlanetDeposits),
 * поэтому пул при генерации и при replay бит-в-бит идентичен. Для тел БЕЗ
 * прогона assign (ГГ: hexes пуст) — rng не потреблён, пул = гарантия.
 */
export function aggregateResourceDeposits(
  hexes: HexCell[],
  planetType: string,
  rng: Xoshiro128StarStar,
): PlanetResourceDeposit[] {
  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  const deposits = new Map<string, { totalQuantity: number; totalAvailability: number; hexCount: number; maxAvailability: number }>();

  // Вспомогательная функция: добавить ресурс элемента
  function addElement(elementId: string, quantity: number, availability: number): void {
    const existing = deposits.get(elementId);
    if (existing) {
      existing.totalQuantity += quantity;
      existing.totalAvailability += availability;
      existing.maxAvailability = Math.max(existing.maxAvailability, availability);
    } else {
      deposits.set(elementId, {
        totalQuantity: quantity,
        totalAvailability: availability,
        hexCount: 0,
        maxAvailability: availability,
      });
    }
  }

  // Агрегируем из гексов, конвертируя руды → элементы через BakedGalaxyModel
  for (const hex of hexes) {
    // Собираем элементы, которые уже были добавлены из этого гекса (чтобы hexCount++ только один раз)
    const elementsInHex = new Set<string>();

    for (const dep of hex.deposits) {
      // Ищем содержащиеся элементы через BakedGalaxyModel
      const contained = findContainedElements(getCurrentLookups(), dep.elementId);

      if (contained && contained.length > 0) {
        // Руда содержит несколько элементов — распределяем пропорционально yield
        const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
        for (const ce of contained) {
          const fraction = ce.yield / totalYield;
          addElement(ce.elementId, dep.quantity * fraction, dep.availability);
          elementsInHex.add(ce.elementId);
        }
      } else {
        // Fallback: не нашли руду — пробуем strip -ore suffix
        const pureId = dep.elementId.replace('-ore', '');
        const elDef = ELEMENT_MAP.get(pureId);
        if (elDef) {
          addElement(pureId, dep.quantity, dep.availability);
          elementsInHex.add(pureId);
        } else {
          // Последний fallback — используем ID как есть
          addElement(dep.elementId, dep.quantity, dep.availability);
          elementsInHex.add(dep.elementId);
        }
      }
    }

    // Увеличиваем hexCount для каждого элемента, найденного на этом гексе
    for (const elId of elementsInHex) {
      const entry = deposits.get(elId);
      if (entry) entry.hexCount++;
    }
  }

  // Гарантируем ВСЕ элементы из таблицы (геологическая оценка с орбиты):
  // элементы без физических залежей (атмосферные газы; полностью океанские
  // миры/ГГ — вся поверхность) получают ОЦЕНОЧНЫЕ записи с hexCount=0 —
  // R-37: пул НЕ заявляет физику, которой нет в гексах (контракт Б3).
  for (const element of ELEMENTS) {
    if (!deposits.has(element.id)) {
      const isProfile = profileSet.has(element.id);
      const isRare = rareSet.has(element.id);
      const mult = planetType === 'gas_giant' ? (element.category === 'fuel' ? 3 : element.category === 'chemical' ? 2 : 0.2) : 0.3;
      const quantity = isProfile
        ? Math.round((300 + rng.nextFloat() * 1000) * mult)
        : isRare
          ? Math.round((3 + rng.nextFloat() * 15) * mult * 0.1)
          : Math.round((10 + rng.nextFloat() * 50) * mult);

      deposits.set(element.id, {
        totalQuantity: Math.max(1, quantity),
        totalAvailability: isProfile ? 0.4 + rng.nextFloat() * 0.4 : isRare ? 0.02 + rng.nextFloat() * 0.08 : 0.05 + rng.nextFloat() * 0.15,
        hexCount: 0,
        maxAvailability: isProfile ? 0.5 + rng.nextFloat() * 0.5 : 0.1 + rng.nextFloat() * 0.2,
      });
    }
  }

  // R-37: отдельная фаза «выбора уникального ресурса» УДАЛЕНА — выбор живёт
  // в assignResourceDeposits (усиленная залежь qty 4–6, depth 4–5) и приходит
  // сюда как обычная физика. Выбранный элемент опознаётся в пуле по подписи
  // hexCount=1 + повышенное количество (тесты D3/G-06), tier — эвристикой ниже.

  // Собираем результат
  const result: PlanetResourceDeposit[] = [];
  for (const [elementId, data] of deposits) {
    const isProfile = profileSet.has(elementId);
    const isRare = rareSet.has(elementId);
    // G-06 (fix) / R-37: ультраредкие — эвристика «минимальная концентрация»
    // (docs/31 §8.2). Выбранный уникальный ресурс (усиленная залежь qty 4–6
    // руды) попадает сюда как обычная физика: hexCount=1, количество
    // qty×доля ≤ 5 < 20 → классифицируется ultra_rare наравне со следовыми
    // элементами пула (выбор НЕ теряется — он в самой физике).
    const isUltra = !isProfile && !isRare && (data.totalQuantity < 20 || data.maxAvailability < 0.05);

    let tier: 'profile' | 'rare' | 'ultra_rare';
    if (isProfile) tier = 'profile';
    else if (isUltra) tier = 'ultra_rare';
    else if (isRare) tier = 'rare';
    else if (data.totalAvailability / Math.max(1, data.hexCount) < 0.1 && data.totalQuantity < 50) tier = 'ultra_rare';
    else tier = 'rare';

    result.push({
      elementId,
      totalQuantity: Math.round(data.totalQuantity),
      avgAvailability: data.hexCount > 0 ? Math.round((data.totalAvailability / data.hexCount) * 1000) / 1000 : Math.round(data.totalAvailability * 1000) / 1000,
      tier,
      hexCount: data.hexCount,
      maxAvailability: Math.round(data.maxAvailability * 1000) / 1000,
    });
  }

  // Сортировка: профильные → редкие → ультраредкие
  const tierOrder = { profile: 0, rare: 1, ultra_rare: 2 };
  result.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.totalQuantity - a.totalQuantity);

  return result;
}
