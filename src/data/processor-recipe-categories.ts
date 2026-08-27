/**
 * Block 05 — детерминированное отображение рецептов → ProcessorRecipeCategory.
 *
 * Решение R8 плана Блока 05: вместо ручной правки ~70 рецептов в recipes.ts
 * (трудоёмко и подвержено ошибкам), используем централизованное отображение
 * по ID рецепта + pattern-matching fallback для надёжности.
 *
 * Источник истины: docs/40-buildings.md §3 + §12.1.
 *
 * Логика категоризации:
 * - `smelt_*` металлических руд (Fe, Ti, Cu, Cr, V, Ni, Mn, Zn, Sn, Pb, Co,
 *   W, Mo, Ag, Au, Pt, Al, Li, Cd, Se, Te, U) → `metal_smelting`
 * - `smelt_*` неметаллических руд (Si, C, S, K, B, F, P, Mg) → `nonmetal_smelting`
 * - `smelt_ba_quarry` (поверхностный барит), `process_rock`, `process_limestone`,
 *   `process_salt` → `chemical_decomp` (составные соединения)
 * - Глубинные руды (Y, Ba, Zr, Be, In, Nd, Ce, La, Dy, Ir, Os, Ru, Rh, Pd,
 *   Hf, Ta, Nb, Re) → `deep_ore_smelting` + minSpecializationLevel=5
 * - `process_*` (CO2, CH4, NH3, H2S, SO2) → `gas_processing`
 * - `refine_*` (Au, Pt, U высшей чистоты) → `metal_smelting` + minSpecializationLevel=5
 * - `make_*` (steel, titanium_alloy, plastic, silicon_crystal, superconductor,
 *   synfuel, microchip, hull_element, armor_plate, engine_section, shield_generator)
 *   → `alloy_synthesis`
 */

import type { ProcessorRecipeCategory } from '@/core/types';

/**
 * Металлы (для которых есть `smelt_<id>` рецепты, идущие в metal_smelting).
 * Источник: docs/mendeleev.md §3.1 (Шахта).
 */
const METAL_SMELTING_IDS = new Set([
  'smelt_fe', 'smelt_ti', 'smelt_cu', 'smelt_cr', 'smelt_v', 'smelt_ni',
  'smelt_mn', 'smelt_zn', 'smelt_sn', 'smelt_pb', 'smelt_co', 'smelt_w',
  'smelt_mo', 'smelt_au', 'smelt_ag', 'smelt_pt', 'smelt_al', 'smelt_li',
  'smelt_cd', 'smelt_se', 'smelt_te', 'smelt_u',
]);

/**
 * Неметаллы (для которых есть `smelt_<id>` рецепты, идущие в nonmetal_smelting).
 * Источник: docs/mendeleev.md §3.2 (Карьер).
 */
const NONMETAL_SMELTING_IDS = new Set([
  'smelt_si', 'smelt_c', 'smelt_s', 'smelt_k', 'smelt_b', 'smelt_f',
  'smelt_p', 'smelt_mg',
]);

/**
 * Химическое разложение (составные соединения: соли, известняк, силикаты).
 * Карьер + доп.карьер.
 */
const CHEMICAL_DECOMP_IDS = new Set([
  'process_limestone', 'process_salt', 'process_rock', 'smelt_ba_quarry',
]);

/**
 * Глубинные руды (требуют ур. здания 5+).
 * Источник: docs/mendeleev.md §3.3 (глубинные руды).
 */
const DEEP_ORE_SMELTING_IDS = new Set([
  'smelt_y', 'smelt_ba', 'smelt_zr', 'smelt_be', 'smelt_in',
  'smelt_nd', 'smelt_ce', 'smelt_la', 'smelt_dy',
  'smelt_ir', 'smelt_os', 'smelt_ru', 'smelt_rh', 'smelt_pd',
  'smelt_hf', 'smelt_ta', 'smelt_nb', 'smelt_re',
]);

/**
 * Газовая переработка (атмосферные газы: CO2, CH4, NH3, H2S, SO2).
 * Block 01 P8: сложные газы теперь разлагаются в processor.
 */
const GAS_PROCESSING_IDS = new Set([
  'process_CO2', 'process_CH4', 'process_NH3', 'process_H2S', 'process_SO2',
]);

/**
 * Рафинирование (Au, Pt, U высшей чистоты) — в refinery.
 * Эквивалентно metal_smelting L5 (требует ур. здания 5+).
 */
const REFINING_IDS = new Set([
  'refine_au', 'refine_pt', 'refine_u',
]);

/**
 * Синтез сплавов и материалов — в synthesizer.
 */
const ALLOY_SYNTHESIS_IDS = new Set([
  'make_steel', 'make_titanium_alloy', 'make_plastic',
  'make_silicon_crystal', 'make_superconductor', 'make_synfuel',
  'make_microchip', 'make_hull_element', 'make_armor_plate',
  'make_engine_section', 'make_shield_generator',
]);

/**
 * Карта: recipeId → { category, minSpecializationLevel }.
 * Лениво вычисляется при первом обращении.
 */
interface RecipeCategoryAssignment {
  category: ProcessorRecipeCategory;
  /** Минимальный уровень специализации здания для рецепта (1 = L1, 5 = L5) */
  minSpecializationLevel: number;
}

const RECIPE_CATEGORY_MAP: Record<string, RecipeCategoryAssignment> = {};

function buildRecipeCategoryMap(): void {
  for (const id of METAL_SMELTING_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'metal_smelting', minSpecializationLevel: 1 };
  }
  for (const id of NONMETAL_SMELTING_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'nonmetal_smelting', minSpecializationLevel: 1 };
  }
  for (const id of CHEMICAL_DECOMP_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'chemical_decomp', minSpecializationLevel: 1 };
  }
  for (const id of DEEP_ORE_SMELTING_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'deep_ore_smelting', minSpecializationLevel: 5 };
  }
  for (const id of GAS_PROCESSING_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'gas_processing', minSpecializationLevel: 1 };
  }
  for (const id of REFINING_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'metal_smelting', minSpecializationLevel: 5 };
  }
  for (const id of ALLOY_SYNTHESIS_IDS) {
    RECIPE_CATEGORY_MAP[id] = { category: 'alloy_synthesis', minSpecializationLevel: 1 };
  }
}

buildRecipeCategoryMap();

/**
 * Резолвить категорию и мин. уровень специализации для рецепта по его ID.
 * Возвращает undefined для не-процессорных рецептов (shipyard: make_ion_engine,
 * make_laser, make_cargo_bay, make_scanner).
 */
export function resolveProcessorCategory(
  recipeId: string,
  buildingId: string,
): RecipeCategoryAssignment | undefined {
  // Рецепты не из процессорных зданий не имеют processorCategory.
  if (buildingId !== 'processor' && buildingId !== 'refinery' && buildingId !== 'synthesizer') {
    return undefined;
  }
  return RECIPE_CATEGORY_MAP[recipeId];
}

/**
 * Получить категорию рецепта (без minSpecializationLevel).
 * Удобно для UI: показать плашку категории рядом с рецептом.
 */
export function getRecipeCategory(
  recipeId: string,
  buildingId: string,
): ProcessorRecipeCategory | undefined {
  return resolveProcessorCategory(recipeId, buildingId)?.category;
}

/**
 * Получить мин. уровень специализации для рецепта (default 1).
 */
export function getRecipeMinSpecializationLevel(
  recipeId: string,
  buildingId: string,
): number {
  return resolveProcessorCategory(recipeId, buildingId)?.minSpecializationLevel ?? 1;
}

/**
 * Список рецептов по категории (для UI SpecializeDialog: показать
 * какие рецепты войдут в активный набор после специализации).
 */
export function getRecipeIdsForCategory(
  category: ProcessorRecipeCategory,
  allRecipes: { id: string; buildingId: string }[],
): string[] {
  return allRecipes
    .filter(r => resolveProcessorCategory(r.id, r.buildingId)?.category === category)
    .map(r => r.id);
}
