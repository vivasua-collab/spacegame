/**
 * PROC-WORKSHOPS-01 (Issue #23): data-driven каталог специализаций ЦЕХОВ.
 *
 * Специализация хранится на цехе (WorkshopState.specializationRecipeId) и
 * выбирается по конкретному recipeId — не по широкой категории, как в
 * категорийной модели Block 05 (та осталась только для refinery/synthesizer).
 *
 * Каталог выводится из RECIPES + BASE_CONSTRUCTION_RECIPE_IDS (единственный
 * источник истины о рецептах): каждая запись = { id (= recipeId), имя,
 * совместимый пул }. Пул определяет, в каком здании цех может взять эту
 * специализацию:
 *   - 'construction' → construction_materials_plant (ровно 6 базовых R-27);
 *   - 'advanced'     → processor (все прочие рецепты переработки).
 *
 * docs/40-buildings.md §3.0.3 (v3.0).
 */

import { RECIPES } from './recipes';
import { BASE_CONSTRUCTION_RECIPE_IDS } from './auto-processing';

/** Пул цехового здания (изолированные очереди планировщика). */
export type WorkshopPoolId = 'construction' | 'advanced';

export interface WorkshopSpecializationDef {
  /** ID = recipeId профиль-рецепта (например 'smelt_fe') */
  id: string;
  /** Человеко-читаемое имя (имя рецепта) */
  name: string;
  /** Совместимый пул (здание, в цехах которого доступна эта специализация) */
  pool: WorkshopPoolId;
}

/** buildingId → пул (контракт: оба цеховых здания имеют свой пул). */
export const WORKSHOP_BUILDING_POOLS: Record<string, WorkshopPoolId> = {
  construction_materials_plant: 'construction',
  processor: 'advanced',
};

/** Пул → buildingId (обратное отображение). */
export const POOL_BUILDINGS: Record<WorkshopPoolId, string> = {
  construction: 'construction_materials_plant',
  advanced: 'processor',
};

const CONSTRUCTION_SET = new Set<string>(BASE_CONSTRUCTION_RECIPE_IDS);

function buildCatalog(): WorkshopSpecializationDef[] {
  const catalog: WorkshopSpecializationDef[] = [];
  for (const recipe of RECIPES) {
    if (recipe.buildingId === 'construction_materials_plant') {
      catalog.push({ id: recipe.id, name: recipe.name, pool: 'construction' });
    } else if (recipe.buildingId === 'processor') {
      catalog.push({ id: recipe.id, name: recipe.name, pool: 'advanced' });
    }
  }
  return catalog;
}

/**
 * Каталог специализаций цехов (порядок = порядок RECIPES; детерминирован).
 * Только рецепты цеховых зданий: 6 базовых R-27 (construction) + все прочие
 * рецепты processor (advanced).
 */
export const WORKSHOP_SPECIALIZATIONS: readonly WorkshopSpecializationDef[] = buildCatalog();

/** Map recipeId → определение специализации (O(1) lookup). */
export const WORKSHOP_SPECIALIZATION_MAP = new Map<string, WorkshopSpecializationDef>(
  WORKSHOP_SPECIALIZATIONS.map((s) => [s.id, s]),
);

/**
 * Список специализаций, доступных цехам здания buildingId
 * (разрешённые рецепты соответствующего пула).
 */
export function getWorkshopSpecializationsForBuilding(buildingId: string): WorkshopSpecializationDef[] {
  const pool = WORKSHOP_BUILDING_POOLS[buildingId];
  if (!pool) return [];
  return WORKSHOP_SPECIALIZATIONS.filter((s) => s.pool === pool);
}

/**
 * Проверить, что recipeId — допустимая специализация для цеха здания
 * buildingId (рецепт принадлежит пулу здания).
 */
export function isRecipeAllowedForBuildingPool(buildingId: string, recipeId: string): boolean {
  const pool = WORKSHOP_BUILDING_POOLS[buildingId];
  if (!pool) return false;
  const spec = WORKSHOP_SPECIALIZATION_MAP.get(recipeId);
  return spec?.pool === pool;
}

/** Инверсия для тестов: рецепт из базового списка R-27? */
export function isBaseConstructionRecipe(recipeId: string): boolean {
  return CONSTRUCTION_SET.has(recipeId);
}
