/**
 * Генерация планетарных пулов сырьевых руд (ORE-POOLS-DOCS-01 / Issue #24).
 *
 * Философия: на каждой планете есть ВСЯ таблица элементов (как таблица Менделеева).
 * Профильные ресурсы (соответствующие типу планеты) — в ЗНАЧИТЕЛЬНОМ количестве.
 * Редкие — в следовых количествах (но всегда есть).
 * Ультраредкие — 1-2 уникальных для планеты.
 *
 * ORE-POOLS-DOCS-01 (решение владельца 2026-10-29): физическая модель «залежь
 * привязана к гексу» ЗАМЕНЕНА планетарными пулами сырьевых руд по точному
 * oreId (docs/31 §6/§10). Гексы служат размещению зданий, террейну и синергии
 * соседства; наличие месторождения под конкретной клеткой больше не
 * определяет доступ к ресурсу. Ресурсы генерируются НАПРЯМУЮ в планетарные
 * пулы — раскладка залежей по координатам гексов не создаётся ни временно,
 * ни в сейвах.
 *
 * Ключ пула — ID РУДЫ (не элемент): ID берётся из elementToOre baked-модели
 * (Fe→Fe-ore, Ca→CaCO3, Na→NaCl и т.д.). При добыче руда конвертируется в
 * содержащиеся элементы через BakedGalaxyModel (рецепты переработки).
 *
 * R-27: КИСЛОРОД И ВОДОРОД НЕ ГЕНЕРИРУЮТСЯ В ВИДЕ ПУЛОВ — это же вода!
 * Атмосферные элементы (H, He, N, O, Ne, Ar) не создают коровых пулов:
 * их источники — атмосфера (газовый экстрактор) и Вода (H2O-ice).
 * Вода — единственный коровой пул-источник H и O: электролиз в processor
 * (рецепт process_H2O) даёт водород + кислород.
 *
 * R-36 (вариант «а» владельца): пулы RARE/ULTRA_RARE = docs/31 §2; элементы
 * пула ULTRA_RARE (все 10 — deep_ore/drilling_rig) генерируют СЛЕДОВЫЕ
 * глубинные пулы (availability 0.02–0.10) — базовое присутствие ultra_rare
 * минимально (§1.1/§3.2), извлечение — буровой установкой.
 *
 * R-37-контракт «свод = добыча» гекс-модели ПЕРЕНЕСЁН на пулы: свод-превью
 * `resourceDeposits` — ЧИСТАЯ производная пулов (buildResourceSummary,
 * без RNG): отображаемая концентрация всегда следует остаткам недр.
 *
 * Версия генерации: прямой генератор пулов меняет порядок потребления RNG
 * относительно гекс-модели — версии гекс-раскладки (1–3, dv) НЕ совместимы
 * по построению; новые сейвы хранят пулы (не снимки RNG), старые сейвы
 * отклоняются с понятным сообщением (docs/31 §12, ORE-POOLS-RUNTIME-01).
 */

import { Xoshiro128StarStar } from '@/core/prng';
import type { PlanetOrePool, PlanetResourceDeposit } from '@/core/types';
import { PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups, findContainedElements, hasCurrentLookups } from '@/data/baked-lookups';

/** Планетарный пул уникальных ресурсов как Set (горячий цикл генерации, R-36). */
const ULTRA_POOL_SET = new Set<string>(ULTRA_RARE_ELEMENTS);

/**
 * Версия генерации планетарных пулов (ORE-POOLS-DOCS-01).
 *
 * История:
 *   1..3 — гекс-модель (dv): раскладка залежей по гексам + replay-снимки
 *          (R-29/R-36/R-37/R-38) — SUPERSEDED, не совместима с пулами;
 *   1 — ORE-POOLS-DOCS-01: прямая генерация пулов по seed и профилю планеты
 *       (без раскладки по гексам; RNG-поток 'ore-pools'). Сейв хранит пулы,
 *       а не RNG-снимки; формат сейва поднял версию (v4) — старые сейвы
 *       отклоняются (docs/31 §12).
 */
export const ORE_POOLS_GENERATION_VERSION = 1;

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
 * R-27: атмосферные элементы (H, He, O, N и др.) НЕ создают коровых пулов —
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
 * ID водного пула (лёд) — добывается шахтой/карьером, электролиз даёт H + O.
 * Экспортируется для engine.ts (G-01/Task 37: фильтр пулов по роли здания).
 */
export const WATER_DEPOSIT_ID = 'H2O-ice';

/**
 * Сгенерировать планетарные пулы сырьевых руд (ORE-POOLS-DOCS-01).
 *
 * Детерминировано по seed: тот же rng-поток и параметры дают те же пулы
 * бит-в-бит. Количественные профили гекс-модели сохранены: суммарное
 * количество руды элемента ≈ baseQuantity × число «залежей» старой модели
 * (poolCount), распределённое теперь в ОДИН пул с одной availability.
 *
 * @param rng дочерний RNG-поток ('ore-pools' — derive() не потребляет родителя)
 * @param planetType тип планеты (профиль/редкость/вода/категории)
 * @param surfaceScale масштаб поверхности — число гексов сетки планеты
 *        (0 у газовых гигантов: коровых пулов нет, атмосфера добывается
 *        газовым экстрактором отдельно, docs/31 §9.3). Используется как
 *        масштаб богатства (НЕ как раскладка по координатам).
 * @returns планетарные пулы, отсортированные детерминированно
 *          (tier → количество↓ → oreId).
 */
export function generatePlanetOrePools(
  rng: Xoshiro128StarStar,
  planetType: string,
  surfaceScale: number,
): PlanetOrePool[] {
  if (surfaceScale <= 0) return [];

  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  // Task 37 (базовая гигиена tsc): явная проверка фолбэка — раньше тип был
  // `Record | undefined` из-за noUncheckedIndexedAccess (3 pre-existing ошибки)
  const catMult = CATEGORY_MULTIPLIERS[planetType] ?? CATEGORY_MULTIPLIERS.rocky;
  if (!catMult) return [];

  const pools = new Map<string, PlanetOrePool>();

  const ensurePool = (oreId: string, tier: PlanetOrePool['tier']): PlanetOrePool => {
    let pool = pools.get(oreId);
    if (!pool) {
      pool = { oreId, initialQuantity: 0, remainingQuantity: 0, availability: 0, tier };
      pools.set(oreId, pool);
    }
    return pool;
  };

  // Для КАЖДОГО элемента из таблицы — пул его руды.
  // R-27: атмосферные элементы пропускаем — коровых пулов газа нет.
  for (const element of ELEMENTS) {
    if (element.isAtmospheric) continue;

    const cat = element.category;
    const mult = catMult[cat] ?? 0.3;
    const isProfile = profileSet.has(element.id);
    const isRare = rareSet.has(element.id);
    // R-36: планетарный пул уникальных ресурсов (docs/31 §2/§8.2, вариант «а»).
    const isUltraPool = ULTRA_POOL_SET.has(element.id);

    let baseQuantity: number;
    let poolFraction: number;
    let baseAvailability: number;
    let tier: PlanetOrePool['tier'];

    if (isProfile) {
      baseQuantity = (200 + rng.nextFloat() * 800) * mult * 3.0;
      poolFraction = Math.min(0.6, 0.2 + mult * 0.3);
      baseAvailability = 0.3 + rng.nextFloat() * 0.5;
      tier = 'profile';
    } else if (isUltraPool) {
      // R-36 (вариант «а»): элементы пула ULTRA_RARE — ВСЕ deep_ore
      // (drilling_rig), у каждого базовое присутствие МИНИМАЛЬНО (docs/31
      // §1.1 «на всех планетах есть все ресурсы» + §3.2: ultra_rare ×0.05).
      // Следовые количества (×0.05) держат пул > 0 — пул кандидатов
      // уникального выбора никогда не пуст.
      baseQuantity = (5 + rng.nextFloat() * 30) * mult * 0.05;
      poolFraction = Math.max(1 / Math.max(1, surfaceScale), 0.02 + mult * 0.05);
      baseAvailability = 0.02 + rng.nextFloat() * 0.08;
      tier = 'ultra_rare';
    } else if (isRare) {
      baseQuantity = (5 + rng.nextFloat() * 30) * mult * 0.15;
      poolFraction = Math.max(1 / Math.max(1, surfaceScale), 0.05 + mult * 0.1);
      baseAvailability = 0.02 + rng.nextFloat() * 0.12;
      tier = 'rare';
    } else {
      baseQuantity = (20 + rng.nextFloat() * 120) * mult;
      poolFraction = Math.max(1 / Math.max(1, surfaceScale), 0.05 + mult * 0.15);
      baseAvailability = 0.1 + rng.nextFloat() * 0.3;
      tier = 'rare';
    }

    // «Число залежей» старой гекс-модели → масштаб пула (количественный
    // профиль сохранён: суммарное количество ≈ baseQuantity × poolCount).
    const poolCount = Math.max(1, Math.ceil(poolFraction * surfaceScale));
    const quantityVariance = 0.75 + rng.nextFloat() * 0.5; // среднее 1.0 — как Σ variance(0.5..1.5)
    const quantity = Math.max(1, Math.round(baseQuantity * poolCount * quantityVariance));
    const availability = Math.min(1, baseAvailability * (0.85 + rng.nextFloat() * 0.3));

    const oreId = getOreIdForElement(element.id);
    const pool = ensurePool(oreId, tier);
    pool.initialQuantity += quantity;
    pool.remainingQuantity += quantity;
    // Одна availability на пул: среднее прежнего разброса (0.7–1.3 фактор).
    if (pool.availability === 0) pool.availability = availability;
    else pool.availability = Math.min(1, (pool.availability + availability) / 2);
  }

  // ── R-27: Вода (H2O-ice) — единственный коровой пул-источник H и O ─────────
  // Кислород и водород не встречаются в виде отдельных пулов — это же вода!
  // Ледяные/океанические миры богаты водой; пустыни и вулканы — бедны;
  // газовые гиганты поверхности не имеют (surfaceScale=0 → ранний return).
  const waterMult = WATER_ABUNDANCE[planetType] ?? 0.3;
  if (waterMult > 0) {
    const baseQuantity = (80 + rng.nextFloat() * 400) * waterMult;
    const poolFraction = Math.min(0.55, 0.1 + waterMult * 0.18);
    const baseAvailability = 0.15 + rng.nextFloat() * 0.45;
    const poolCount = Math.max(1, Math.ceil(poolFraction * surfaceScale));
    const quantityVariance = 0.75 + rng.nextFloat() * 0.5;

    const pool = ensurePool(WATER_DEPOSIT_ID, planetType === 'ice' || planetType === 'oceanic' ? 'profile' : 'rare');
    pool.initialQuantity += Math.max(1, Math.round(baseQuantity * poolCount * quantityVariance));
    pool.remainingQuantity += Math.max(1, Math.round(baseQuantity * poolCount * quantityVariance));
    pool.availability = pool.availability === 0
      ? Math.min(1, baseAvailability * (0.85 + rng.nextFloat() * 0.3))
      : Math.min(1, (pool.availability + Math.min(1, baseAvailability)) / 2);
  }

  // Случайные богатые жилы профильных ресурсов («богатство» планеты).
  // Аналог 15%-на-гекс ветки гекс-модели: ~15% × surfaceScale бонусных
  // жил, каждая добавляет количество в пул случайного профильного элемента.
  const bonusVeins = Math.max(1, Math.round(0.15 * surfaceScale));
  for (let k = 0; k < bonusVeins; k++) {
    if (!rng.nextBool(0.15)) continue;
    const profileElements = ELEMENTS.filter(e => profileSet.has(e.id) && !e.isAtmospheric);
    const element = profileElements.length > 0
      ? rng.nextChoice(profileElements)
      : rng.nextChoice(ELEMENTS.filter(e => !e.isAtmospheric));
    const cat = element.category;
    const mult = catMult[cat] ?? 0.3;
    const oreId = getOreIdForElement(element.id);
    const vein = Math.round((200 + rng.nextFloat() * 800) * mult * 2);
    const pool = ensurePool(oreId, profileSet.has(element.id) ? 'profile' : 'rare');
    pool.initialQuantity += vein;
    pool.remainingQuantity += vein;
  }

  // ── ORE-POOLS-DOCS-01: выбор уникального ресурса планеты (docs/31 §8.2) ────
  // 1–2 элемента пула ULTRA_RARE (не профильные — пересечение пусто,
  // без повторов выбора) получают «повышенную концентрацию»: их следовые
  // пулы СТИРАЮТСЯ и заменяются ОДНИМ глубинным пулом — категория
  // drilling_rig (роль руды — deep_ore, docs/34 §3.8), qty 4–6 ЕДИНИЦ РУДЫ
  // (чистого элемента — qty × доля выхода руды), availability 0.03–0.10.
  //
  // Полностью океанские миры/ГГ: surfaceScale > 0 у океанских миров есть
  // (суша есть — суша мала, но гексы есть); для ГГ surfaceScale=0 →
  // ранний return → выбора НЕТ (пул честно остаётся геологической оценкой).
  const ultraCount = rng.nextInt(1, 2);
  const ultraCandidates = ULTRA_RARE_ELEMENTS.filter(e => !profileSet.has(e));
  for (let i = 0; i < ultraCount && ultraCandidates.length > 0; i++) {
    const elId = rng.nextChoice(ultraCandidates);
    // выбор без повторов (G-06): убрать выбранного из пула кандидатов
    ultraCandidates.splice(ultraCandidates.indexOf(elId), 1);

    const oreId = getOreIdForElement(elId);
    // Следовые пулы выбранной руды стираются — физика выбранного элемента
    // сводится к единственному усиленному пулу (без хвостов).
    pools.delete(oreId);
    const qty = 4 + Math.floor(rng.nextFloat() * 3); // 4–6 (руда)
    pools.set(oreId, {
      oreId,
      initialQuantity: qty,
      remainingQuantity: qty,
      availability: 0.03 + rng.nextFloat() * 0.07, // 0.03–0.10
      tier: 'ultra_rare',
    });
  }

  // Детерминированный порядок: tier (profile → rare → ultra_rare) →
  // количество↓ → oreId. Не зависит от порядка обхода ELEMENTS/Map.
  const tierOrder = { profile: 0, rare: 1, ultra_rare: 2 } as const;
  const result = Array.from(pools.values());
  result.sort((a, b) =>
    tierOrder[a.tier] - tierOrder[b.tier]
    || b.initialQuantity - a.initialQuantity
    || (a.oreId < b.oreId ? -1 : a.oreId > b.oreId ? 1 : 0),
  );
  return result;
}

/**
 * Свод-превью ресурсов планеты из планетарных пулов (ORE-POOLS-DOCS-01,
 * docs/31 §10.2). ЧИСТАЯ функция БЕЗ RNG: производная пулов, полностью
 * детерминированная — пересчёт в любой момент даёт тот же результат.
 *
 *   - пул руды → содержащиеся элементы (по долям выхода из
 *     BakedGalaxyModel); объём следует ОСТАТКУ пулов (remainingQuantity):
 *     отображаемая концентрация всегда равна доступной добыче;
 *   - элементы без пулов (атмосферные; полностью океанские миры/ГГ)
 *     добавляются фазой гарантии с детерминированными оценками — «геол.
 *     оценка с орбиты, пулы не разведаны» (пул НЕ заявляет физику,
 *     которой нет);
 *   - поля гекс-модели (hexCount/maxAvailability) выведены: свод не
 *     заявляет распределение по гексам (docs/30 §5.3.1).
 *
 * Требует инициализированных lookups (текущей baked-модели галактики);
 * при их отсутствии — фолбэк «<ore> → элемент без -ore».
 */
export function buildResourceSummary(
  orePools: PlanetOrePool[],
  planetType: string,
): PlanetResourceDeposit[] {
  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  const agg = new Map<string, { totalQuantity: number; totalAvailability: number; poolCount: number; estimated?: boolean }>();

  const addElement = (elementId: string, quantity: number, availability: number): void => {
    const existing = agg.get(elementId);
    if (existing) {
      existing.totalQuantity += quantity;
      existing.totalAvailability += availability * quantity;
      existing.poolCount += 1;
    } else {
      agg.set(elementId, { totalQuantity: quantity, totalAvailability: availability * quantity, poolCount: 1 });
    }
  };

  for (const pool of orePools) {
    if (pool.remainingQuantity <= 0) continue; // исчерпанные пулы не заявляют физику
    const contained = hasCurrentLookups() ? findContainedElements(getCurrentLookups(), pool.oreId) : undefined;
    if (contained && contained.length > 0) {
      const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
      for (const ce of contained) {
        const fraction = ce.yield / totalYield;
        addElement(ce.elementId, pool.remainingQuantity * fraction, pool.availability);
      }
    } else {
      const pureId = pool.oreId.replace('-ore', '');
      const elDef = ELEMENT_MAP.get(pureId);
      addElement(elDef ? pureId : pool.oreId, pool.remainingQuantity, pool.availability);
    }
  }

  // Гарантия ВСЕХ элементов из таблицы (детерминированные оценки — без RNG:
  // середины диапазонов прежней оценки; docs/31 §10.2 «геол. оценка»).
  for (const element of ELEMENTS) {
    if (agg.has(element.id)) continue;
    const isProfile = profileSet.has(element.id);
    const isRare = rareSet.has(element.id);
    const mult = planetType === 'gas_giant' ? (element.category === 'fuel' ? 3 : element.category === 'chemical' ? 2 : 0.2) : 0.3;
    const quantity = isProfile
      ? Math.round(800 * mult)
      : isRare
        ? Math.max(1, Math.round(1.05 * mult))
        : Math.max(1, Math.round(35 * mult));
    const availability = isProfile ? 0.6 : isRare ? 0.06 : 0.125;
    agg.set(element.id, { totalQuantity: quantity, totalAvailability: availability * quantity, poolCount: 1, estimated: true });
  }

  const result: PlanetResourceDeposit[] = [];
  for (const [elementId, data] of agg) {
    const isProfile = profileSet.has(elementId);
    const isRare = rareSet.has(elementId);
    const avgAvailability = data.totalQuantity > 0
      ? Math.round((data.totalAvailability / data.totalQuantity) * 1000) / 1000
      : 0;
    // Эвристика tier (G-06/R-37): ультраредкие — «минимальная концентрация»
    // (docs/31 §8.2). Выбранный уникальный ресурс (усиленный пул qty 4–6)
    // классифицируется ultra_rare наравне со следовыми элементами пула.
    const isUltra = !isProfile && !isRare && (data.totalQuantity < 20 || avgAvailability < 0.05);

    let tier: PlanetResourceDeposit['tier'];
    if (isProfile) tier = 'profile';
    else if (isUltra) tier = 'ultra_rare';
    else if (isRare) tier = 'rare';
    else if (avgAvailability < 0.1 && data.totalQuantity < 50) tier = 'ultra_rare';
    else tier = 'rare';

    result.push({
      elementId,
      totalQuantity: Math.round(data.totalQuantity),
      avgAvailability,
      tier,
      ...(data.estimated ? { estimated: true } : {}),
    });
  }

  // Сортировка: профильные → редкие → ультраредкие
  const tierOrder = { profile: 0, rare: 1, ultra_rare: 2 };
  result.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.totalQuantity - a.totalQuantity);

  return result;
}
