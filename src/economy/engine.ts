/**
 * Экономический движок — производство, крафт, энергия.
 */

import type { Planet, HexCell, ProductionQueue, ProductionItem, EntityId, ResourceDeposit } from '@/core/types';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { gameBus } from '@/core/event-bus';

/**
 * Обработка одного тика экономики для всех планет.
 */
export function processEconomyTick(planets: Planet[], queues: Map<EntityId, ProductionQueue>): void {
  for (const planet of planets) {
    // 1. Добыча ресурсов зданиями
    processExtraction(planet);

    // 2. Обработка очереди производства
    processProductionQueue(planet, queues);

    // 3. Расчёт энергетического баланса
    recalcEnergyBalance(planet);
  }
}

/**
 * Добыча ресурсов зданиями на планете.
 */
function processExtraction(planet: Planet): void {
  for (const hex of planet.hexes) {
    if (!hex.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(hex.buildingId);
    if (!buildingDef) continue;

    // Здания добычи
    if (buildingDef.category === 'extraction') {
      const levelMult = 1 + hex.buildingLevel * 0.15;
      const terrainMult = hex.terrain in (buildingDef.terrainBonus ?? {})
        ? (buildingDef.terrainBonus as Record<string, number>)[hex.terrain] ?? 1
        : 1;

      for (const deposit of hex.deposits) {
        if (deposit.quantity <= 0) continue;

        // Добыча пропорциональна availability, уровню и бонусам
        const baseRate = 0.01 * deposit.availability; // базовая скорость: 0.01 единицы/тик
        const amount = baseRate * levelMult * terrainMult;
        const extracted = Math.min(amount, deposit.quantity);

        deposit.quantity -= extracted;
        const key = deposit.elementId;
        planet.resources[key] = (planet.resources[key] ?? 0) + extracted;
      }
    }
  }
}

/**
 * Обработка очереди производства планеты.
 */
function processProductionQueue(planet: Planet, queues: Map<EntityId, ProductionQueue>): void {
  const queue = queues.get(planet.id);
  if (!queue || queue.items.length === 0) return;

  const item = queue.items[0];
  const recipe = RECIPE_MAP.get(item.recipeId);
  if (!recipe) {
    // Рецепт не найден — удаляем из очереди
    queue.items.shift();
    return;
  }

  // Проверяем энергобаланс
  if (planet.energyBalance < recipe.energyCost && recipe.energyCost > 0) {
    // Недостаточно энергии — пропускаем тик
    return;
  }

  // Обновляем прогресс
  item.progress--;

  // Тратим энергию
  if (recipe.energyCost > 0) {
    planet.energyBalance -= recipe.energyCost / item.total;
  }

  // Рецепт завершён
  if (item.progress <= 0) {
    // Проверяем, хватает ли входных ресурсов
    let canProduce = true;
    for (const [resourceId, amount] of Object.entries(recipe.inputs)) {
      if ((planet.resources[resourceId] ?? 0) < amount) {
        canProduce = false;
        break;
      }
    }

    if (canProduce) {
      // Тратим входные ресурсы
      for (const [resourceId, amount] of Object.entries(recipe.inputs)) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) - amount;
      }
      // Добавляем выходные ресурсы
      for (const [resourceId, amount] of Object.entries(recipe.outputs)) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + amount;
      }

      gameBus.emit('production:complete', { planetId: planet.id, recipeId: recipe.id });
    }

    // Удаляем или повторяем
    if (item.repeat) {
      item.progress = item.total;
    } else {
      queue.items.shift();
    }
  }
}

/**
 * Пересчёт энергетического баланса планеты.
 */
export function recalcEnergyBalance(planet: Planet): void {
  let production = 0;
  let consumption = 0;

  for (const hex of planet.hexes) {
    if (!hex.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(hex.buildingId);
    if (!buildingDef) continue;

    const levelMult = 1 + hex.buildingLevel * 0.2;

    if (buildingDef.category === 'energy') {
      production += 10 * levelMult; // базовая выработка 10 единиц/уровень
    } else {
      consumption += buildingDef.energyConsumption * levelMult;
    }
  }

  planet.energyBalance = production - consumption;
}

/**
 * Построить здание на гексе планеты.
 */
export function buildOnHex(planet: Planet, hexIndex: number, buildingId: string): boolean {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) return false;
  const hex = planet.hexes[hexIndex];
  if (hex.buildingId) return false; // уже занято

  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef) return false;

  // Проверяем ресурсы
  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) {
      return false; // не хватает ресурсов
    }
  }

  // Тратим ресурсы
  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    planet.resources[resourceId] -= amount;
  }

  hex.buildingId = buildingId;
  hex.buildingLevel = 1;

  recalcEnergyBalance(planet);
  gameBus.emit('building:constructed', { planetId: planet.id, hexIndex, buildingId });

  return true;
}

/**
 * Улучшить здание на гексе.
 */
export function upgradeBuilding(planet: Planet, hexIndex: number): boolean {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) return false;
  const hex = planet.hexes[hexIndex];
  if (!hex.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(hex.buildingId);
  if (!buildingDef) return false;
  if (hex.buildingLevel >= buildingDef.levels) return false;

  // Проверяем ресурсы (стоимость × текущий уровень)
  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    const amount = baseAmount * hex.buildingLevel;
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }

  // Тратим ресурсы
  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    planet.resources[resourceId] -= baseAmount * hex.buildingLevel;
  }

  hex.buildingLevel++;
  recalcEnergyBalance(planet);
  gameBus.emit('building:upgraded', { planetId: planet.id, hexIndex, level: hex.buildingLevel });

  return true;
}

/**
 * Добавить рецепт в очередь производства.
 */
export function enqueueProduction(
  planet: Planet,
  queues: Map<EntityId, ProductionQueue>,
  recipeId: string,
  repeat = false,
): boolean {
  const recipe = RECIPE_MAP.get(recipeId);
  if (!recipe) return false;

  let queue = queues.get(planet.id);
  if (!queue) {
    queue = { planetId: planet.id, items: [] };
    queues.set(planet.id, queue);
  }

  queue.items.push({
    id: `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    recipeId,
    progress: recipe.time,
    total: recipe.time,
    repeat,
  });

  return true;
}

/**
 * Дать стартовые ресурсы планете (для тестирования).
 */
export function giveStarterResources(planet: Planet): void {
  const starters: Record<string, number> = {
    'Fe-ore': 200, 'Si-ore': 150, 'C-ore': 100, 'Al-ore': 80,
    'Ti-ore': 30, 'Cu-ore': 50, 'H': 100, 'O': 100,
    Fe: 50, Si: 30, C: 20, Al: 15,
  };
  for (const [id, amount] of Object.entries(starters)) {
    planet.resources[id] = (planet.resources[id] ?? 0) + amount;
  }
}
