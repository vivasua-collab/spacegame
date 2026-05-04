/**
 * Виртуальный склад планеты — константы, пресеты и вспомогательные функции.
 * Ограничивает суммарный объём ресурсов на планете.
 *
 * Интеграция с BakedGalaxyModel (v2.0):
 * - COLONY_ROLE_PRESETS генерируются динамически через getCurrentLookups()
 * - ensureReservesForResources определяет категорию ресурса через baked-lookups
 * - Специализация даёт значимый бонус (+25%) вместо +10%
 * - Добавлены helper-функции getResourceType() и getResourceCategory()
 */

import type { PlanetWarehouse, WarehouseReserve, ColonyRole, WarehouseSpecialization, Planet } from '@/core/types';
import { ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups, hasCurrentLookups } from '@/data/baked-lookups';

// ============================================================================
// Константы
// ============================================================================

/** Базовая вместимость склада (предоставляется Колониальным Хабом) */
export const BASE_CAPACITY = 10000;

/** Бонус вместимости за уровень здания склада */
export const WAREHOUSE_PER_LEVEL = 2500;

/** Бонус орбитального буфера за уровень космопорта */
export const SPACEPORT_PER_LEVEL = 500;

/** Минимальный резерв по умолчанию */
const DEFAULT_MINIMUM = 50;

/** Приоритеты по умолчанию для категорий элементов */
const CATEGORY_PRIORITY: Record<string, number> = {
  structural: 8,
  fuel: 7,
  metal: 6,
  chemical: 5,
  alkali: 5,
  alkaline_earth: 5,
  halogen: 4,
  nonmetal: 4,
  transmetal: 4,
  noble: 3,
  lanthanide: 3,
  rare: 2,
  transuranic: 2,
};

/** Приоритеты для типов ресурсов (руда/элемент/газ/лёд) */
const RESOURCE_TYPE_PRIORITY: Record<string, number> = {
  ore: 8,          // Руды — высокий приоритет (сырьё)
  element: 7,      // Чистые элементы
  atmospheric: 6,  // Атмосферные соединения
  ice: 5,          // Ледяные соединения
  unknown: 5,      // Неизвестный тип
};

/** Бонусы специализации склада */
const SPEC_BONUSES: Record<WarehouseSpecialization, { multiplier: number; label: string }> = {
  universal: { multiplier: 1.0,  label: 'Универсальный' },
  ore:       { multiplier: 1.25, label: 'Рудный (+25%)' },
  metal:     { multiplier: 1.20, label: 'Металлургический (+20%)' },
  gas:       { multiplier: 1.20, label: 'Газовый (+20%)' },
  component: { multiplier: 1.15, label: 'Компонентный (+15%)' },
};

// ============================================================================
// Helper-функции для BakedGalaxyModel
// ============================================================================

/**
 * Определить тип ресурса через BakedGalaxyModel.
 * Возвращает 'ore', 'atmospheric', 'ice', 'element', или 'unknown'.
 */
export function getResourceType(resourceId: string): string {
  if (!hasCurrentLookups()) return 'unknown';
  const lookups = getCurrentLookups();

  if (lookups.oreMap.has(resourceId)) return 'ore';
  if (lookups.atmosphericMap.has(resourceId)) return 'atmospheric';
  if (lookups.iceMap.has(resourceId)) return 'ice';
  if (lookups.elementMap.has(resourceId)) return 'element';

  // Fallback: strip -ore suffix
  const pureId = resourceId.replace(/-ore(-quarry|-deep)?$/, '');
  if (ELEMENT_MAP.has(pureId)) return 'element';

  return 'unknown';
}

/**
 * Получить категорию элемента для ресурса (через BakedGalaxyModel).
 * Для руд возвращает категорию первичного элемента.
 * Для элементов возвращает их категорию напрямую.
 */
export function getResourceCategory(resourceId: string): string | undefined {
  if (!hasCurrentLookups()) {
    // Fallback без baked model
    const pureId = resourceId.replace(/-ore(-quarry|-deep)?$/, '');
    return ELEMENT_MAP.get(pureId)?.category;
  }
  const lookups = getCurrentLookups();

  // Чистый элемент?
  const bakedEl = lookups.elementMap.get(resourceId);
  if (bakedEl) return bakedEl.category;

  // Руда? → категория первичного элемента
  const ore = lookups.oreMap.get(resourceId);
  if (ore) {
    const primaryEl = lookups.elementMap.get(ore.primaryElement);
    return primaryEl?.category;
  }

  // Атмосферное соединение?
  const atmo = lookups.atmosphericMap.get(resourceId);
  if (atmo && atmo.containedElements.length > 0) {
    const firstEl = lookups.elementMap.get(atmo.containedElements[0].elementId);
    return firstEl?.category;
  }

  // Ледяное соединение?
  const ice = lookups.iceMap.get(resourceId);
  if (ice && ice.containedElements.length > 0) {
    const firstEl = lookups.elementMap.get(ice.containedElements[0].elementId);
    return firstEl?.category;
  }

  // Fallback: strip -ore suffix
  const pureId = resourceId.replace(/-ore(-quarry|-deep)?$/, '');
  return ELEMENT_MAP.get(pureId)?.category;
}

/**
 * Получить приоритет ресурса для резервов склада.
 * Учитывает и тип ресурса (руда/элемент/газ), и категорию элемента.
 */
export function getResourcePriority(resourceId: string): number {
  const resType = getResourceType(resourceId);
  const typePriority = RESOURCE_TYPE_PRIORITY[resType] ?? 5;
  const category = getResourceCategory(resourceId);
  const catPriority = category ? (CATEGORY_PRIORITY[category] ?? 5) : 5;
  // Берём максимум из типа и категории (более высокий приоритет побеждает)
  return Math.max(typePriority, catPriority);
}

/** Получить описательную информацию о специализации */
export function getSpecInfo(spec: WarehouseSpecialization): { multiplier: number; label: string } {
  return SPEC_BONUSES[spec] ?? SPEC_BONUSES.universal;
}

// ============================================================================
// Создание и расчёт склада
// ============================================================================

/** Создать склад по умолчанию для новой колонии */
export function createDefaultWarehouse(): PlanetWarehouse {
  return {
    totalCapacity: BASE_CAPACITY,
    specialization: 'universal',
    reserves: {},
    colonyRole: 'industrial',
    orbitBuffer: {
      capacity: 0,
      resources: {},
    },
  };
}

/** Рассчитать общую вместимость склада на основе зданий */
export function calculateWarehouseCapacity(planet: Planet): number {
  let capacity = BASE_CAPACITY; // Colony Hub base

  // Вместимость от зданий склада на поверхности
  for (const hex of planet.hexes) {
    if (hex.buildingId === 'warehouse') {
      capacity += WAREHOUSE_PER_LEVEL * hex.buildingLevel;
    }
  }

  // Вместимость от складов на орбитальных слотах
  for (const slot of planet.orbitSlots) {
    if (slot.buildingId === 'warehouse') {
      capacity += WAREHOUSE_PER_LEVEL * slot.buildingLevel;
    }
  }

  // Бонус специализации
  const spec = planet.warehouse?.specialization ?? 'universal';
  const specBonus = SPEC_BONUSES[spec];
  if (specBonus && specBonus.multiplier > 1) {
    capacity = Math.floor(capacity * specBonus.multiplier);
  }

  return capacity;
}

// ============================================================================
// Учёт ресурсов
// ============================================================================

/** Получить суммарный объём всех ресурсов на планете (Energy НЕ считается — потоковый ресурс) */
export function getUsedCapacity(planet: Planet): number {
  let total = 0;
  for (const [id, amount] of Object.entries(planet.resources)) {
    if (id === 'Energy') continue; // Energy — потоковый ресурс, не занимает склад
    total += amount;
  }
  return total;
}

/** Получить вместимость орбитального буфера на основе космопортов */
export function getOrbitBufferCapacity(planet: Planet): number {
  let capacity = 0;
  for (const slot of planet.orbitSlots) {
    if (slot.buildingId === 'spaceport') {
      capacity += SPACEPORT_PER_LEVEL * slot.buildingLevel;
    }
  }
  return capacity;
}

/** Получить использованный объём орбитального буфера */
export function getOrbitBufferUsed(planet: Planet): number {
  let total = 0;
  for (const amount of Object.values(planet.warehouse?.orbitBuffer.resources ?? {})) {
    total += amount;
  }
  return total;
}

/**
 * Проверить, можно ли хранить ресурс на складе.
 * Возвращает фактическое количество, которое можно разместить
 * (может быть меньше запрошенного).
 */
export function canStoreResource(planet: Planet, resourceId: string, amount: number): number {
  if (!planet.warehouse) return amount; // Нет склада = безлимит (обратная совместимость)

  const capacity = planet.warehouse.totalCapacity;
  const used = getUsedCapacity(planet);
  const available = capacity - used;

  if (available <= 0) return 0;
  if (amount <= available) return amount;
  return available;
}

// ============================================================================
// Пресеты ролей колонии (динамические через BakedGalaxyModel)
// ============================================================================

/**
 * Конфигурация резерва для генерации пресетов.
 * Определяется в терминах элемента → при применении маппится на руду
 * через getCurrentLookups().elementToOre.
 */
interface ReserveConfig {
  /** ID элемента (для чистых элементов) или руды */
  elementId: string;
  /** Минимальный резерв */
  minimum: number;
  /** Приоритет (1-10) */
  priority: number;
  /** Если true, будет добавлена и руда (через elementToOre), и сам элемент */
  includeOre: boolean;
}

/** Конфигурации резервов по ролям — в терминах элементов */
const ROLE_CONFIGS: Record<ColonyRole, ReserveConfig[]> = {
  mining: [
    // Высокие резервы руд — профильные строительные
    { elementId: 'Fe', minimum: 100, priority: 9, includeOre: true },
    { elementId: 'Si', minimum: 80,  priority: 9, includeOre: true },
    { elementId: 'C',  minimum: 60,  priority: 8, includeOre: true },
    { elementId: 'Al', minimum: 80,  priority: 8, includeOre: true },
    { elementId: 'Ti', minimum: 50,  priority: 8, includeOre: true },
    { elementId: 'Cu', minimum: 50,  priority: 7, includeOre: true },
    // Чистые элементы — средние резервы
    { elementId: 'Fe', minimum: 40, priority: 7, includeOre: false },
    { elementId: 'Si', minimum: 30, priority: 7, includeOre: false },
    { elementId: 'C',  minimum: 25, priority: 6, includeOre: false },
    { elementId: 'Al', minimum: 30, priority: 6, includeOre: false },
    // Топливные
    { elementId: 'H', minimum: 50, priority: 7, includeOre: false },
  ],
  industrial: [
    // Сбалансированные резервы — руды
    { elementId: 'Fe', minimum: 60, priority: 8, includeOre: true },
    { elementId: 'Si', minimum: 50, priority: 8, includeOre: true },
    { elementId: 'C',  minimum: 40, priority: 7, includeOre: true },
    { elementId: 'Al', minimum: 50, priority: 7, includeOre: true },
    // Чистые элементы — основные для промышленности
    { elementId: 'Fe', minimum: 40, priority: 7, includeOre: false },
    { elementId: 'Si', minimum: 35, priority: 7, includeOre: false },
    { elementId: 'C',  minimum: 30, priority: 6, includeOre: false },
    { elementId: 'Al', minimum: 30, priority: 6, includeOre: false },
    { elementId: 'Ti', minimum: 20, priority: 6, includeOre: false },
    { elementId: 'Cu', minimum: 25, priority: 6, includeOre: false },
    // Топливные и химические
    { elementId: 'H', minimum: 40, priority: 6, includeOre: false },
    { elementId: 'O', minimum: 30, priority: 5, includeOre: false },
    { elementId: 'N', minimum: 20, priority: 5, includeOre: false },
  ],
  research: [
    // Высокие резервы электроники и редких материалов
    { elementId: 'Si', minimum: 80,  priority: 9, includeOre: false },
    { elementId: 'Au', minimum: 30,  priority: 9, includeOre: true },
    { elementId: 'Cu', minimum: 50,  priority: 8, includeOre: true },
    // Редкие элементы
    { elementId: 'Y',  minimum: 20,  priority: 8, includeOre: true },
    { elementId: 'La', minimum: 15,  priority: 7, includeOre: true },
    { elementId: 'Nd', minimum: 15,  priority: 7, includeOre: true },
    // Низкие резервы руд
    { elementId: 'Fe', minimum: 15, priority: 3, includeOre: true },
    { elementId: 'Si', minimum: 10, priority: 3, includeOre: true },
  ],
  capital: [
    // Сбалансированные + жизнеобеспечение
    { elementId: 'Fe', minimum: 40, priority: 7, includeOre: false },
    { elementId: 'Si', minimum: 35, priority: 7, includeOre: false },
    { elementId: 'C',  minimum: 30, priority: 6, includeOre: false },
    { elementId: 'Al', minimum: 30, priority: 6, includeOre: false },
    // Руды — средние
    { elementId: 'Fe', minimum: 25, priority: 5, includeOre: true },
    { elementId: 'Si', minimum: 20, priority: 5, includeOre: true },
    // Жизнеобеспечение
    { elementId: 'O', minimum: 50, priority: 8, includeOre: false },
    { elementId: 'N', minimum: 40, priority: 7, includeOre: false },
    { elementId: 'H', minimum: 30, priority: 6, includeOre: false },
  ],
  custom: [],
};

/** Генерировать пресет резервов для роли колонии с использованием BakedGalaxyModel */
export function buildColonyRolePresets(role: ColonyRole): { resourceId: string; minimum: number; priority: number }[] {
  const configs = ROLE_CONFIGS[role];
  if (configs.length === 0) return [];

  const lookups = hasCurrentLookups() ? getCurrentLookups() : null;
  const result: { resourceId: string; minimum: number; priority: number }[] = [];
  const seen = new Set<string>();

  for (const config of configs) {
    if (config.includeOre && lookups) {
      // Добавить руду для этого элемента
      const oreId = lookups.elementToOre[config.elementId];
      if (oreId && !seen.has(oreId)) {
        seen.add(oreId);
        result.push({
          resourceId: oreId,
          minimum: config.minimum,
          priority: config.priority,
        });
      }
    }

    // Добавить сам чистый элемент (если ещё не добавлен через руду)
    if (!seen.has(config.elementId)) {
      seen.add(config.elementId);
      result.push({
        resourceId: config.elementId,
        minimum: config.includeOre ? Math.floor(config.minimum * 0.6) : config.minimum,
        priority: config.includeOre ? config.priority - 1 : config.priority,
      });
    }
  }

  return result;
}

/** Применить роль колонии (пресет резервов) к складу */
export function applyColonyRole(warehouse: PlanetWarehouse, role: ColonyRole): PlanetWarehouse {
  const presets = buildColonyRolePresets(role);
  const newReserves: Record<string, WarehouseReserve> = {};

  for (const config of presets) {
    newReserves[config.resourceId] = {
      resourceId: config.resourceId,
      minimum: config.minimum,
      priority: config.priority,
    };
  }

  return {
    ...warehouse,
    colonyRole: role,
    reserves: newReserves,
  };
}

// ============================================================================
// Резервы
// ============================================================================

/**
 * Убедиться, что резервы существуют для всех ресурсов на планете.
 * Energy пропускается — потоковый ресурс.
 * Использует BakedGalaxyModel для определения категории ресурса
 * и назначения правильного приоритета.
 */
export function ensureReservesForResources(planet: Planet): void {
  if (!planet.warehouse) return;

  for (const resourceId of Object.keys(planet.resources)) {
    if (resourceId === 'Energy') continue;
    if (planet.warehouse.reserves[resourceId]) continue;

    // Используем BakedGalaxyModel для определения приоритета
    const priority = getResourcePriority(resourceId);

    planet.warehouse.reserves[resourceId] = {
      resourceId,
      minimum: DEFAULT_MINIMUM,
      priority,
    };
  }
}
