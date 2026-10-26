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
 */

import { Xoshiro128StarStar } from '@/core/prng';
import type { HexCell, PlanetResourceDeposit } from '@/core/types';
import { PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups, findContainedElements } from '@/data/baked-lookups';

/** R-29: тело (планета/луна) с ленивыми залежами — минимальный интерфейс материализации. */
export interface LazyDepositBody {
  hexes: HexCell[];
  type: string;
  depositsMaterialized?: boolean;
  depositRngState?: number[] | null;
}

/**
 * R-29: ленивая материализация залежей гексов.
 *
 * До колонизации планета знает только свод-пул resourceDeposits («сколько
 * всего»); гексы пусты (depositRngState хранит снимок RNG ДО прогона
 * генерации). При колонизации этот проигрывает assignResourceDeposits из
 * сохранённого состояния → бит-в-бит те же залежи, что дал бы полный
 * прогон при генерации галактики.
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
  return true;
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

    let baseQuantity: number;
    let hexFraction: number;
    let baseAvailability: number;

    if (isProfile) {
      baseQuantity = (200 + rng.nextFloat() * 800) * mult * 3.0;
      hexFraction = Math.min(0.6, 0.2 + mult * 0.3);
      baseAvailability = 0.3 + rng.nextFloat() * 0.5;
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
        depth: isRare ? rng.nextInt(3, 5) : rng.nextInt(1, 4),
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
}

/**
 * Агрегация ресурсных залежей из гексов в сводную таблицу планеты.
 * Конвертирует руды в элементы (по containedElements из ORE_MAP / ATMOSPHERIC_COMPOUND_MAP)
 * и показывает, какие ЧИСТЫЕ ЭЛЕМЕНТЫ можно получить на планете.
 * Также добавляет ультраредкие ресурсы (1-2 уникальных для планеты).
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

  // Гарантируем ВСЕ элементы из таблицы
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

  // Ультраредкие элементы (1-2 уникальных для планеты) — G-06 (Task 37, fix).
  // Прежний код имел три дефекта (замер на 1080 синтетических планетах):
  //   1) rng.nextChoice вызывался до 2 раз С ПОВТОРЕНИЕМ — ~11% «двойных»
  //      планет получали 1 уникальный элемент вместо 2;
  //   2) кандидат с уже богатыми залежами (totalQuantity ≥ 10) молча
  //      пропускался — 6.9% планет не получали НИ ОДНОГО ультраредкого;
  //   3) выбранный элемент из пересечения RARE∩ULTRA_RARE получал tier
  //      'rare' (87% выборов) вместо 'ultra_rare' — переопределение
  //      намерения ultra_rare классификацией rare.
  // Теперь: выбор БЕЗ ПОВТОРЕНИЙ из «элективных» кандидатов (ещё не имеющих
  // богатых залежей — их можно понизить до следового количества), а выбранные
  // элементы явно классифицируются как ultra_rare.
  const ultraCount = rng.nextInt(1, 2);
  const availableUltra = ULTRA_RARE_ELEMENTS.filter(e => !profileSet.has(e));
  const eligibleUltra = availableUltra.filter(e =>
    !deposits.has(e) || (deposits.get(e)?.totalQuantity ?? 0) < 10);
  const ultraChosen = new Set<string>();
  for (let i = 0; i < ultraCount && eligibleUltra.length > 0; i++) {
    const elId = rng.nextChoice(eligibleUltra);
    // выбор без повторений: убрать выбранного из пула кандидатов
    eligibleUltra.splice(eligibleUltra.indexOf(elId), 1);
    ultraChosen.add(elId);
    deposits.set(elId, {
      totalQuantity: Math.max(1, Math.round(1 + rng.nextFloat() * 5)),
      totalAvailability: 0.01 + rng.nextFloat() * 0.04,
      hexCount: 1,
      maxAvailability: 0.05,
    });
  }

  // Собираем результат
  const result: PlanetResourceDeposit[] = [];
  for (const [elementId, data] of deposits) {
    const isProfile = profileSet.has(elementId);
    const isRare = rareSet.has(elementId);
    // G-06 (fix): явно выбранные ультраредкие — tier 'ultra_rare', даже если
    // элемент входит и в RARE_ELEMENTS (пересечение множеств в
    // planet-types.ts — осознанное допущение, «уникальный ресурс планеты» —
    // более сильная классификация, чем «редкий везде»; profileSet исключён
    // из кандидатов выше). Прежняя эвристика !isRare затирала намерение.
    const isUltra = ultraChosen.has(elementId)
      || (!isProfile && !isRare && (data.totalQuantity < 20 || data.maxAvailability < 0.05));

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
