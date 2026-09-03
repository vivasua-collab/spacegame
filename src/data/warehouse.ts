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

import type { PlanetWarehouse, WarehouseReserve, WarehouseType, ColonyRole, WarehouseSpecialization, Planet } from '@/core/types';
import { ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups, hasCurrentLookups } from '@/data/baked-lookups';

// ============================================================================
// Константы (раздельная система складов v3.0)
// См. docs/35-warehouse-and-logistics.md §1.3
// Единица измерения: 1 ед. = 1 млн т = 0.001 млрд т
// ============================================================================

/** @deprecated Используйте PROCESSED_WAREHOUSE_BASE. Legacy совместимость. */
export const BASE_CAPACITY = 10000;

/** @deprecated Используйте PROCESSED_WAREHOUSE_PER_LEVEL. Legacy совместимость. */
export const WAREHOUSE_PER_LEVEL = 2500;

/** Бонус орбитального буфера за уровень космопорта */
export const SPACEPORT_PER_LEVEL = 5;

// --- Раздельные константы (v3.0) ---
// Audit 2026-08-28: стартовый склад увеличен с 1110 до 10000 ед.
// (пропорции сохранены: ore 5000, processed 3500, highTech 1500).
// Прежнее переполнение склада на старте («1623/1110») устранено.

/** Базовая вместимость рудного склада (открытое хранение) = 5 млрд т */
export const ORE_WAREHOUSE_BASE = 5000;

/** Бонус рудного склада за уровень open_warehouse = +1.25 млрд т/ур. */
export const ORE_WAREHOUSE_PER_LEVEL = 1250;

/** Базовая вместимость переработанного склада (крытое хранение) = 3.5 млрд т */
export const PROCESSED_WAREHOUSE_BASE = 3500;

/** Бонус переработанного склада за уровень warehouse = +0.875 млрд т/ур. */
export const PROCESSED_WAREHOUSE_PER_LEVEL = 875;

/** Базовая вместимость высокотехнологичного склада (спец хранение) = 1.5 млрд т */
export const HIGH_TECH_STORAGE_BASE = 1500;

/** Бонус высокотехнологичного склада за уровень high_tech_storage = +0.375 млрд т/ур. */
export const HIGH_TECH_STORAGE_PER_LEVEL = 375;

/**
 * Базовая вместимость газового склада (R-27, сжимаемое хранение) = 2 млрд т.
 *
 * Жалоба владельца 2026-08-31 №5/№7: сырые атмосферные газы (CO2, CH4, NH3,
 * H2S, SO2 — без DIRECT_GAS_MAP-конверсии) копились в РУДНОМ складе и
 * забивали его — газовый экстрактор «заморозил» всю логистику колонии.
 * Теперь атмосферные соединения хранятся в отдельном газовом складе;
 * лёд (твёрдые соединения) остаётся в рудном.
 */
export const GAS_WAREHOUSE_BASE = 2000;

/**
 * Бонус газового склада за уровень (зарезервировано под будущее здание
 * gas_tank; сейчас зданий-расширителей нет — только база).
 */
export const GAS_WAREHOUSE_PER_LEVEL = 500;

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
    // noUncheckedIndexedAccess: containedElements[0] possibly undefined.
    const firstContained = atmo.containedElements[0];
    if (firstContained) {
      const firstEl = lookups.elementMap.get(firstContained.elementId);
      return firstEl?.category;
    }
  }

  // Ледяное соединение?
  const ice = lookups.iceMap.get(resourceId);
  if (ice && ice.containedElements.length > 0) {
    const firstContained = ice.containedElements[0];
    if (firstContained) {
      const firstEl = lookups.elementMap.get(firstContained.elementId);
      return firstEl?.category;
    }
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
    // Audit 2026-08-28: сумма трёх баз = 10000 (раньше было PROCESSED_WAREHOUSE_BASE
    // = 100, что вызывало переполнение склада на старте до первого tick).
    // R-27 (v3.1): газовый склад — отдельная база 2000 (не входит в «стартовый
    // склад 10000 ед.» твёрдых грузов: руды/элементы/высокотех — пропорции
    // 5000/3500/1500 не тронуты).
    totalCapacity: ORE_WAREHOUSE_BASE + PROCESSED_WAREHOUSE_BASE + HIGH_TECH_STORAGE_BASE + GAS_WAREHOUSE_BASE,
    capacities: {
      ore: ORE_WAREHOUSE_BASE,
      processed: PROCESSED_WAREHOUSE_BASE,
      highTech: HIGH_TECH_STORAGE_BASE,
      gas: GAS_WAREHOUSE_BASE,
    },
    specialization: 'universal',
    reserves: {},
    colonyRole: 'industrial',
    orbitBuffer: {
      capacity: 0,
      resources: {},
    },
  };
}

/**
 * Рассчитать раздельные вместимости складов на основе зданий (v3.1).
 * Возвращает 4 вместимости: ore, processed, highTech, gas.
 *
 * Газовый склад: пока расширяющих зданий нет — всегда базовая 2000
 * (GAS_WAREHOUSE_PER_LEVEL зарезервирован под будущее gas_tank).
 */
export function calculateWarehouseCapacities(planet: Planet): { ore: number; processed: number; highTech: number; gas: number } {
  // C4 (audit §2.3 — O(N²M) per tick): memoize by Planet object identity.
  // Immer creates a NEW Planet object on every mutation (build/upgrade/setResources),
  // so the cache automatically invalidates when planet changes.
  // For the duration of one tick (where planet reference is stable), the cache is reused
  // for all canStoreResource() calls in processExtraction → O(N+M) per tick instead of O(N*M).
  const cached = CAPACITIES_CACHE.get(planet);
  if (cached) return cached;

  let oreCap = ORE_WAREHOUSE_BASE;
  let processedCap = PROCESSED_WAREHOUSE_BASE;
  let highTechCap = HIGH_TECH_STORAGE_BASE;
  let gasCap = GAS_WAREHOUSE_BASE;

  // Подсчёт по зданиям на поверхности
  for (const hex of planet.hexes) {
    if (!hex.buildingId) continue;
    switch (hex.buildingId) {
      case 'open_warehouse':
        oreCap += ORE_WAREHOUSE_PER_LEVEL * hex.buildingLevel;
        break;
      case 'warehouse':
        processedCap += PROCESSED_WAREHOUSE_PER_LEVEL * hex.buildingLevel;
        break;
      case 'high_tech_storage':
        highTechCap += HIGH_TECH_STORAGE_PER_LEVEL * hex.buildingLevel;
        break;
      case 'gas_tank':
        // R-27: газовые хранилища (в каталоге пока нет; хук на будущее)
        gasCap += GAS_WAREHOUSE_PER_LEVEL * hex.buildingLevel;
        break;
    }
  }

  // Подсчёт по зданиям на орбитальных слотах
  for (const slot of planet.orbitSlots) {
    if (!slot.buildingId) continue;
    switch (slot.buildingId) {
      case 'open_warehouse':
        oreCap += ORE_WAREHOUSE_PER_LEVEL * slot.buildingLevel;
        break;
      case 'warehouse':
        processedCap += PROCESSED_WAREHOUSE_PER_LEVEL * slot.buildingLevel;
        break;
      case 'high_tech_storage':
        highTechCap += HIGH_TECH_STORAGE_PER_LEVEL * slot.buildingLevel;
        break;
      case 'gas_tank':
        gasCap += GAS_WAREHOUSE_PER_LEVEL * slot.buildingLevel;
        break;
    }
  }

  const result = { ore: oreCap, processed: processedCap, highTech: highTechCap, gas: gasCap };
  CAPACITIES_CACHE.set(planet, result);
  return result;
}

/**
 * Per-tick cache for calculateWarehouseCapacities (C4).
 * Keyed by Planet object reference — automatically invalidates when immer creates
 * a new Planet on mutation (build/upgrade/setResources).
 * WeakMap so GC can clean up old Planet references.
 */
const CAPACITIES_CACHE: WeakMap<Planet, { ore: number; processed: number; highTech: number; gas: number }> = new WeakMap();

/**
 * @deprecated Используйте calculateWarehouseCapacities. Legacy совместимость.
 * Возвращает сумму всех 3 вместимостей (для обратной совместимости).
 */
export function calculateWarehouseCapacity(planet: Planet): number {
  const caps = calculateWarehouseCapacities(planet);
  return caps.ore + caps.processed + caps.highTech;
}

/**
 * Получить тип склада для ресурса (v3.1 — R-27: атмосферные газы → газовый склад).
 * 'ore' — рудный склад (руды, ледяные соединения)
 * 'processed' — переработанный (чистые элементы abundant/common, конструкционные)
 * 'highTech' — высокотехнологичный (электроника, сверхпроводники, редкие элементы)
 * 'gas' — газовый (сырые атмосферные газы: H2, N2, CO2, CH4, NH3, H2S, SO2…)
 */
export function getWarehouseType(resourceId: string): WarehouseType {
  const resType = getResourceType(resourceId);

  // R-27: сырые атмосферные газы — отдельный газовый склад (жалоба №5/№7:
  // раньше падали в рудный и забивали его — колония «замерзала»).
  // Лёд (твёрдые соединения) остаётся в рудном.
  if (resType === 'atmospheric') {
    return 'gas';
  }

  // Руды, ледяные → рудный склад
  if (resType === 'ore' || resType === 'ice') {
    return 'ore';
  }

  // Проверяем на высокотехнологичные материалы (по ID)
  const HIGH_TECH_MATERIALS = new Set([
    'microchip', 'superconductor', 'silicon_crystal', 'sensor_array',
    'shield_generator', 'engine_section', 'ion_engine', 'laser',
    'cargo_bay', 'scanner',
  ]);
  if (HIGH_TECH_MATERIALS.has(resourceId)) {
    return 'highTech';
  }

  // Редкие и уникальные чистые элементы → высокотехнологичный
  // Примечание (gap-5, C6): 'platinoid' и 'rare_earth' — это значения ChemicalCharacter,
  // а не ElementCategory. Их сравнения с `category` всегда false. Удалено как мёртвый код.
  // Элементы с chemicalCharacter 'platinoid' (Ru/Rh/Pd/Ir/Os) имеют category 'noble',
  // элементы с 'rare_earth' (Y/La/Ce/Nd/Dy) — category 'lanthanide'; оба случая уже покрыты ниже.
  const category = getResourceCategory(resourceId);
  if (category === 'noble' || category === 'rare' || category === 'lanthanide' ||
      category === 'transuranic') {
    return 'highTech';
  }

  // Остальные чистые элементы и материалы → переработанный
  if (resType === 'element' || resType === 'unknown') {
    return 'processed';
  }

  return 'processed';
}

/**
 * Получить использованный объём для конкретного типа склада (v3.1: + gas).
 */
export function getUsedCapacityByType(planet: Planet, warehouseType: WarehouseType): number {
  let total = 0;
  for (const [id, amount] of Object.entries(planet.resources)) {
    if (id === 'Energy') continue;
    if (getWarehouseType(id) === warehouseType) {
      total += amount;
    }
  }
  return total;
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
 * R-27 (жалоба №6): «долг резервов» — сколько места в складе типа
 * warehouseType должно оставаться СВОБОДНЫМ под минимальные запасы ДРУГИХ
 * ресурсов (свои резервы не ограничивают свой же ресурс).
 *
 * Семантика (docs/35-warehouse-and-logistics.md §1.4):
 *   debt = Σ по резервам r ≠ excludingResourceId, type(r) = warehouseType:
 *          max(0, minimum(r) − stock(r)).
 *
 * Свойства:
 *   - Один тип руды НЕ может занять слоты минимумов других ресурсов
 *     («чтобы один тип руды не забил все склады собой»).
 *   - Долг существует только пока запас ниже минимума; когда все минимумы
 *     физически выполнены, debt = 0 и склад используется целиком.
 *   - Пороги — свойство стартовых (базовых) мощностей: при добавлении новых
 *     складов (open_warehouse и т.п.) minimum-ы НЕ меняются — новый объём
 *     минус маленький долг можно забить одним типом руды.
 */
export function getReserveDebt(planet: Planet, warehouseType: WarehouseType, excludingResourceId?: string): number {
  const wh = planet.warehouse;
  if (!wh?.reserves) return 0;
  let debt = 0;
  for (const [resId, reserve] of Object.entries(wh.reserves)) {
    if (resId === excludingResourceId) continue;
    if (getWarehouseType(resId) !== warehouseType) continue;
    const stock = planet.resources[resId] ?? 0;
    if (stock < reserve.minimum) debt += reserve.minimum - stock;
  }
  return debt;
}

/**
 * Проверить, можно ли хранить ресурс на складе.
 * Использует раздельную систему складов (v3.1): ресурс направляется в
 * соответствующий склад (ore/processed/highTech/gas), и проверяется вместимость
 * именно этого склада. R-27 (жалоба №6): из свободного места вычитается
 * долг резервов ДРУГИХ ресурсов этого склада — минимумы всегда доступны.
 *
 * Возвращает фактическое количество, которое можно разместить
 * (может быть меньше запрошенного).
 */
export function canStoreResource(planet: Planet, resourceId: string, amount: number): number {
  if (!planet.warehouse) return amount; // Нет склада = безлимит (обратная совместимость)

  // v3.1: раздельная система складов
  if (planet.warehouse.capacities) {
    const whType = getWarehouseType(resourceId);
    const caps = calculateWarehouseCapacities(planet);
    const capacity = whType === 'ore' ? caps.ore
      : whType === 'highTech' ? caps.highTech
      : whType === 'gas' ? (caps.gas ?? GAS_WAREHOUSE_BASE)
      : caps.processed;
    const used = getUsedCapacityByType(planet, whType);
    // R-27: место под минимумы других ресурсов этого склада зарезервировано
    const debt = getReserveDebt(planet, whType, resourceId);
    const available = Math.max(0, capacity - used - debt);
    if (available <= 0) return 0;
    if (amount <= available) return amount;
    return available;
  }

  // Legacy: общая вместимость (для старых сохранений без capacities)
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
