/**
 * Виртуальный склад планеты — константы, пресеты и вспомогательные функции.
 * Ограничивает суммарный объём ресурсов на планете.
 */

import type { PlanetWarehouse, WarehouseReserve, ColonyRole, WarehouseSpecialization, Planet } from '@/core/types';
import { ELEMENT_MAP } from '@/data/elements';

// Приоритеты по умолчанию для категорий элементов
const CATEGORY_PRIORITY: Record<string, number> = {
  structural: 8,
  fuel: 7,
  light: 7,
  chemical: 6,
  alloy: 5,
  electronics: 4,
  rare: 3,
};

const DEFAULT_MINIMUM = 20;

/** Создать склад по умолчанию для новой колонии */
export function createDefaultWarehouse(): PlanetWarehouse {
  return {
    totalCapacity: 1000,
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
  let capacity = 1000; // Colony Hub base

  // Вместимость от зданий склада на поверхности
  for (const hex of planet.hexes) {
    if (hex.buildingId === 'warehouse') {
      capacity += 500 * hex.buildingLevel;
    }
  }

  // Вместимость от складов на орбитальных слотах
  for (const slot of planet.orbitSlots) {
    if (slot.buildingId === 'warehouse') {
      capacity += 500 * slot.buildingLevel;
    }
  }

  // Бонус специализации (+10% к вместимости для специализированных ресурсов)
  const spec = planet.warehouse?.specialization;
  if (spec === 'ore' || spec === 'metal' || spec === 'gas' || spec === 'component') {
    capacity = Math.floor(capacity * 1.1);
  }

  return capacity;
}

/** Получить суммарный объём всех ресурсов на планете (Energy НЕ считается — это потоковый ресурс) */
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
      capacity += 200 * slot.buildingLevel;
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

/** Пресеты резервов для ролей колонии */
export const COLONY_ROLE_PRESETS: Record<ColonyRole, { resourceId: string; minimum: number; priority: number }[]> = {
  mining: [
    // Высокие резервы руд
    ...['Fe-ore', 'Si-ore', 'C-ore', 'Al-ore', 'Ti-ore', 'Cu-ore'].map(id => ({ resourceId: id, minimum: 50, priority: 8 })),
    // Чистые элементы: средние
    ...['Fe', 'Si', 'C', 'Al'].map(id => ({ resourceId: id, minimum: 20, priority: 7 })),
  ],
  industrial: [
    // Сбалансированные резервы
    ...['Fe-ore', 'Si-ore', 'C-ore', 'Al-ore'].map(id => ({ resourceId: id, minimum: 30, priority: 8 })),
    ...['Fe', 'Si', 'C', 'Al', 'Ti', 'Cu'].map(id => ({ resourceId: id, minimum: 25, priority: 7 })),
  ],
  research: [
    // Высокие резервы электроники и редких материалов
    ...['Si', 'Au', 'Cu'].map(id => ({ resourceId: id, minimum: 50, priority: 9 })),
    // Низкие резервы руд
    ...['Fe-ore', 'Si-ore'].map(id => ({ resourceId: id, minimum: 5, priority: 3 })),
  ],
  capital: [
    // Сбалансированные + жизнеобеспечение
    ...['Fe', 'Si', 'C', 'Al'].map(id => ({ resourceId: id, minimum: 30, priority: 7 })),
    ...['Fe-ore', 'Si-ore'].map(id => ({ resourceId: id, minimum: 15, priority: 5 })),
  ],
  custom: [],
};

/** Применить роль колонии (пресет резервов) к складу */
export function applyColonyRole(warehouse: PlanetWarehouse, role: ColonyRole): PlanetWarehouse {
  const preset = COLONY_ROLE_PRESETS[role];
  const newReserves: Record<string, WarehouseReserve> = {};

  for (const config of preset) {
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

/** Убедиться, что резервы существуют для всех ресурсов на планете (Energy пропускается — потоковый ресурс) */
export function ensureReservesForResources(planet: Planet): void {
  if (!planet.warehouse) return;

  for (const resourceId of Object.keys(planet.resources)) {
    if (resourceId === 'Energy') continue; // Energy — потоковый ресурс, нет смысла резервировать
    if (!planet.warehouse.reserves[resourceId]) {
      const pureId = resourceId.replace('-ore', '');
      const elDef = ELEMENT_MAP.get(pureId);
      const priority = elDef ? (CATEGORY_PRIORITY[elDef.category] ?? 5) : 5;

      planet.warehouse.reserves[resourceId] = {
        resourceId,
        minimum: DEFAULT_MINIMUM,
        priority,
      };
    }
  }
}
