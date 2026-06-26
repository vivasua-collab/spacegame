/**
 * Lookup-помощники для BakedGalaxyModel.
 *
 * Заменяют статические Map-объекты из processing-chains.ts
 * на данные, полученные из запечённой модели галактики.
 *
 * Использование:
 *   1. При создании/загрузке игры вызвать setCurrentLookups(galaxy.bakedModel)
 *   2. В коде использовать getCurrentLookups() или helper-функции
 */

import type { BakedGalaxyModel, BakedOre, BakedAtmospheric, BakedIce, BakedElement } from './chemistry-generator';
import type { ContainedElement } from './processing-chains';

// ============================================================================
// Типы
// ============================================================================

/** Кэш lookup-структур, построенных из BakedGalaxyModel */
export interface BakedLookups {
  /** oreId → BakedOre (заменяет ORE_MAP) */
  oreMap: Map<string, BakedOre>;
  /** compoundId → BakedAtmospheric (заменяет ATMOSPHERIC_COMPOUND_MAP) */
  atmosphericMap: Map<string, BakedAtmospheric>;
  /** iceId → BakedIce (заменяет ICE_COMPOUND_MAP) */
  iceMap: Map<string, BakedIce>;
  /** elementId → oreId (заменяет ORE_FOR_ELEMENT_MAP) */
  elementToOre: Record<string, string>;
  /** elementId → BakedElement */
  elementMap: Map<string, BakedElement>;
}

// ============================================================================
// Синглтон
// ============================================================================

let _currentLookups: BakedLookups | null = null;

/** Установить текущую модель (вызывается при newGame / loadGame) */
export function setCurrentLookups(model: BakedGalaxyModel): void {
  _currentLookups = buildLookups(model);
}

/** Получить текущие lookup-структуры */
export function getCurrentLookups(): BakedLookups {
  if (!_currentLookups) throw new Error('BakedLookups не инициализированы — вызовите setCurrentLookups()');
  return _currentLookups;
}

/** Проверить, инициализированы ли lookup-структуры */
export function hasCurrentLookups(): boolean {
  return _currentLookups !== null;
}

// ============================================================================
// Построение lookup-структур
// ============================================================================

/** Построить все lookup-структуры из BakedGalaxyModel */
export function buildLookups(model: BakedGalaxyModel): BakedLookups {
  const oreMap = new Map<string, BakedOre>();
  for (const ore of model.ores) {
    oreMap.set(ore.id, ore);
  }

  const atmosphericMap = new Map<string, BakedAtmospheric>();
  for (const compound of model.atmosphericCompounds) {
    atmosphericMap.set(compound.id, compound);
  }

  const iceMap = new Map<string, BakedIce>();
  for (const ice of model.iceCompounds) {
    iceMap.set(ice.id, ice);
  }

  const elementMap = new Map<string, BakedElement>();
  for (const el of model.elements) {
    elementMap.set(el.id, el);
  }

  return {
    oreMap,
    atmosphericMap,
    iceMap,
    elementToOre: model.elementToOre,
    elementMap,
  };
}

// ============================================================================
// Helper-функции
// ============================================================================

/**
 * Найти содержащиеся элементы для любого ресурса (руда/атмосфера/лёд).
 * Ищет в порядке: ore → atmospheric → ice.
 */
export function findContainedElements(lookups: BakedLookups, resourceId: string): ContainedElement[] | null {
  const ore = lookups.oreMap.get(resourceId);
  if (ore) return ore.containedElements;

  const atmo = lookups.atmosphericMap.get(resourceId);
  if (atmo) return atmo.containedElements;

  const ice = lookups.iceMap.get(resourceId);
  if (ice) return ice.containedElements;

  return null;
}

/**
 * Найти отображаемую информацию (имя, формула) для любого ресурса.
 */
export function findResourceDisplay(lookups: BakedLookups, resourceId: string): { name: string; formula: string } | null {
  const ore = lookups.oreMap.get(resourceId);
  if (ore) return { name: ore.name, formula: ore.molarFormula };

  const atmo = lookups.atmosphericMap.get(resourceId);
  if (atmo) return { name: atmo.name, formula: atmo.formula };

  const ice = lookups.iceMap.get(resourceId);
  if (ice) return { name: ice.name, formula: ice.formula };

  return null;
}

/**
 * Получить ID руды для элемента (заменяет ORE_FOR_ELEMENT_MAP[elementId]).
 */
export function getOreForElement(elementId: string): string | undefined {
  return getCurrentLookups().elementToOre[elementId];
}

/**
 * Получить ID руды для элемента с fallback (как в generate-resources.ts).
 */
export function getOreIdForElement(elementId: string): string {
  return getCurrentLookups().elementToOre[elementId] ?? `${elementId}-ore`;
}
