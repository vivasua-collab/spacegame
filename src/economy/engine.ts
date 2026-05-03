/**
 * Экономический движок — производство, крафт, энергия.
 * P1-26: Солнечная станция учитывает светимость звезды.
 * P1-27: Газовый экстрактор проверяет наличие атмосферы.
 */

import type { Planet, HexCell, ProductionQueue, ProductionItem, EntityId, StarSystem } from '@/core/types';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { gameBus } from '@/core/event-bus';

/**
 * Обработка одного тика экономики для всех планет.
 */
export function processEconomyTick(planets: Planet[], queues: Map<EntityId, ProductionQueue>, systemMap?: Map<EntityId, StarSystem>): void {
  for (const planet of planets) {
    // 1. Добыча ресурсов зданиями
    processExtraction(planet);

    // 2. Обработка очереди производства
    processProductionQueue(planet, queues);

    // 3. Расчёт энергетического баланса
    const system = systemMap?.get(planet.systemId);
    recalcEnergyBalance(planet, system);
  }
}

/**
 * Добыча ресурсов зданиями на планете.
 * P1-27: Газовый экстрактор требует атмосферу.
 */
function processExtraction(planet: Planet): void {
  // Surface buildings
  for (const hex of planet.hexes) {
    if (!hex.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(hex.buildingId);
    if (!buildingDef) continue;

    // P1-27: проверка атмосферы для газового экстрактора
    if (buildingDef.requiresAtmosphere && planet.atmosphere.type === 'none') {
      continue; // Невозможно работать без атмосферы
    }

    if (buildingDef.category === 'extraction') {
      const levelMult = 1 + hex.buildingLevel * 0.15;
      const terrainMult = hex.terrain in (buildingDef.terrainBonus ?? {})
        ? (buildingDef.terrainBonus as Record<string, number>)[hex.terrain] ?? 1
        : 1;

      for (const deposit of hex.deposits) {
        if (deposit.quantity <= 0) continue;

        const baseRate = 0.01 * deposit.availability;
        const amount = baseRate * levelMult * terrainMult;
        const extracted = Math.min(amount, deposit.quantity);

        deposit.quantity -= extracted;
        const key = deposit.elementId;
        planet.resources[key] = (planet.resources[key] ?? 0) + extracted;
      }
    }

    // Colony hub: добыча всех залежей на гексе со скоростью 50% от шахты
    if (buildingDef.id === 'colony_hub') {
      const levelMult = 1 + hex.buildingLevel * 0.1;
      for (const deposit of hex.deposits) {
        if (deposit.quantity <= 0) continue;

        const baseRate = 0.005 * deposit.availability; // 50% от скорости шахты
        const amount = baseRate * levelMult;
        const extracted = Math.min(amount, deposit.quantity);

        deposit.quantity -= extracted;
        const key = deposit.elementId;
        planet.resources[key] = (planet.resources[key] ?? 0) + extracted;
      }
    }
  }

  // Atmospheric slots (P1-01: газовые гиганты)
  for (const slot of planet.atmosphericSlots) {
    if (!slot.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(slot.buildingId);
    if (!buildingDef) continue;

    // P1-27: атмосферные здания требуют атмосферу
    if (buildingDef.requiresAtmosphere && planet.atmosphere.type === 'none') {
      continue;
    }

    if (buildingDef.category === 'extraction') {
      const levelMult = 1 + slot.buildingLevel * 0.15;
      // Газовые гиганты имеют бонус к добыче из атмосферы
      const atmosphereMult = planet.type === 'gas_giant' ? 1.0 : getAtmosphereEfficiency(planet.atmosphere.type);

      // C-02 fix: добавлен O — добывается из плотных/стандартных атмосфер по 04-buildings.md §2.3
      const atmosphericElements = ['H', 'He', 'C', 'N', 'O'];
      for (const elementId of atmosphericElements) {
        const baseRate = 0.02 * levelMult * atmosphereMult;
        planet.resources[elementId] = (planet.resources[elementId] ?? 0) + baseRate;
      }
    }
  }
}

/** Эффективность добычи из атмосферы по типу (из 04-buildings.md §2.3) */
function getAtmosphereEfficiency(type: string): number {
  switch (type) {
    case 'thin': return 0.3;
    case 'standard': return 0.6;
    case 'dense': return 0.7;
    case 'toxic': return 0.6;
    case 'inert': return 0.5;
    case 'methane': return 0.7;
    case 'co2': return 0.5;
    default: return 0;
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
    queue.items.shift();
    return;
  }

  // P3-02: проверяем энергобаланс по стоимости за тик, а не по полной стоимости рецепта
  const perTickCost = recipe.energyCost / item.total;
  if (planet.energyBalance < perTickCost && recipe.energyCost > 0) {
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
    let canProduce = true;
    for (const [resourceId, amount] of Object.entries(recipe.inputs)) {
      if ((planet.resources[resourceId] ?? 0) < amount) {
        canProduce = false;
        break;
      }
    }

    if (canProduce) {
      for (const [resourceId, amount] of Object.entries(recipe.inputs)) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) - amount;
      }
      for (const [resourceId, amount] of Object.entries(recipe.outputs)) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + amount;
      }

      gameBus.emit('production:complete', { planetId: planet.id, recipeId: recipe.id });
    }

    if (item.repeat) {
      item.progress = item.total;
    } else {
      queue.items.shift();
    }
  }
}

/**
 * Пересчёт энергетического баланса планеты.
 * P1-26: Солнечная станция зависит от светимости звезды и расстояния.
 */
export function recalcEnergyBalance(planet: Planet, system?: StarSystem): void {
  let production = 0;
  let consumption = 0;

  // Get star luminosity if available (P2-26: guard against black holes with ~0 luminosity)
  const starLuminosity = Math.max(0.0001, system?.stars[0]?.luminosity ?? 1.0);
  const distanceFactor = Math.max(0.01, planet.orbitalRadius);

  // Surface buildings
  for (const hex of planet.hexes) {
    if (!hex.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(hex.buildingId);
    if (!buildingDef) continue;

    const levelMult = 1 + hex.buildingLevel * 0.2;

    if (buildingDef.category === 'energy') {
      if (buildingDef.id === 'solar_plant') {
        // P1-26: power_output = base_output × level × star_luminosity / distance_factor
        production += 10 * levelMult * starLuminosity / distanceFactor;
      } else if (buildingDef.id === 'nuclear_plant') {
        // P2-06/P2-07: nuclear plant base output = 25, no luminosity factor
        production += 25 * levelMult;
      } else {
        production += 10 * levelMult; // fallback for unknown energy buildings
      }
    } else if (buildingDef.id === 'colony_hub') {
      // Colony hub: базовая энергия 5, не зависит от светимости
      production += 5 * levelMult;
    } else {
      consumption += buildingDef.energyConsumption * levelMult;
    }
  }

  // Atmospheric slot buildings
  for (const slot of planet.atmosphericSlots) {
    if (!slot.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(slot.buildingId);
    if (!buildingDef) continue;

    const levelMult = 1 + slot.buildingLevel * 0.2;
    if (buildingDef.category === 'energy') {
      if (buildingDef.id === 'solar_plant') {
        production += 10 * levelMult * starLuminosity / distanceFactor;
      } else if (buildingDef.id === 'nuclear_plant') {
        // P2-06/P2-07: nuclear plant base output = 25
        production += 25 * levelMult;
      } else {
        production += 10 * levelMult;
      }
    } else {
      consumption += buildingDef.energyConsumption * levelMult;
    }
  }

  // Orbit slot buildings
  for (const slot of planet.orbitSlots) {
    if (!slot.buildingId) continue;
    const buildingDef = BUILDING_MAP.get(slot.buildingId);
    if (!buildingDef) continue;

    const levelMult = 1 + slot.buildingLevel * 0.2;
    if (buildingDef.category === 'energy') {
      if (buildingDef.id === 'solar_plant') {
        // Орбитальные солнечные станции работают эффективнее
        production += 10 * levelMult * starLuminosity / distanceFactor * 1.2;
      } else if (buildingDef.id === 'nuclear_plant') {
        // P2-06/P2-07: nuclear plant base output = 25
        production += 25 * levelMult;
      } else {
        production += 10 * levelMult;
      }
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
  if (hex.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef) return false;

  // L-05: проверяем, что здание может строиться на поверхности
  if (!buildingDef.layer.includes('surface')) {
    return false;
  }

  // P1-27: проверка атмосферы
  if (buildingDef.requiresAtmosphere && planet.atmosphere.type === 'none') {
    return false;
  }

  // P3-04: проверяем, что здание подходит по размеру планеты
  if (!buildingDef.size.includes(planet.size)) {
    return false;
  }

  // Проверяем ресурсы
  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) {
      return false;
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
 * Построить здание на атмосферном слоте (газовые гиганты, P1-01).
 */
export function buildOnAtmosphereSlot(planet: Planet, slotIndex: number, buildingId: string): boolean {
  if (slotIndex < 0 || slotIndex >= planet.atmosphericSlots.length) return false;
  const slot = planet.atmosphericSlots[slotIndex];
  if (slot.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef) return false;

  // Только атмосферные здания
  if (!buildingDef.layer.includes('atmosphere')) return false;

  // P1-27: проверка атмосферы
  if (buildingDef.requiresAtmosphere && planet.atmosphere.type === 'none') {
    return false;
  }

  // Проверяем ресурсы
  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }

  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    planet.resources[resourceId] -= amount;
  }

  slot.buildingId = buildingId;
  slot.buildingLevel = 1;

  recalcEnergyBalance(planet);
  gameBus.emit('building:constructed', { planetId: planet.id, hexIndex: -1 - slotIndex, buildingId });
  return true;
}

/**
 * Построить здание на орбитальном слоте (P1-01).
 */
export function buildOnOrbitSlot(planet: Planet, slotIndex: number, buildingId: string): boolean {
  if (slotIndex < 0 || slotIndex >= planet.orbitSlots.length) return false;
  const slot = planet.orbitSlots[slotIndex];
  if (slot.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef) return false;

  // Только орбитальные здания
  if (!buildingDef.layer.includes('orbit')) return false;

  // Проверяем ресурсы
  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }

  for (const [resourceId, amount] of Object.entries(buildingDef.costPerLevel)) {
    planet.resources[resourceId] -= amount;
  }

  slot.buildingId = buildingId;
  slot.buildingLevel = 1;

  recalcEnergyBalance(planet);
  gameBus.emit('building:constructed', { planetId: planet.id, hexIndex: -100 - slotIndex, buildingId });
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

  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    const amount = baseAmount * hex.buildingLevel;
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }

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

  // P3-06: проверяем, что требуемое здание существует на планете
  const hasBuilding = planet.hexes.some(h => h.buildingId === recipe.buildingId) ||
    planet.atmosphericSlots.some(s => s.buildingId === recipe.buildingId) ||
    planet.orbitSlots.some(s => s.buildingId === recipe.buildingId);
  if (!hasBuilding) return false;

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
 * Колонизировать планету: поставить colony_hub на лучший гекс + дать стартовые ресурсы.
 * Возвращает true если успешно, false если нельзя колонизировать.
 */
export function colonizePlanet(planet: Planet, system?: StarSystem): boolean {
  // Нельзя колонизировать газовый гигант (нет поверхности) или уже занятую планету
  if (planet.type === 'gas_giant') return false;
  if (planet.owner) return false;

  // Найти лучший гекс для colony_hub:
  // Предпочтение: не-ocean гекс с максимальным количеством deposits
  let bestHex = -1;
  let bestScore = -1;

  for (let i = 0; i < planet.hexes.length; i++) {
    const hex = planet.hexes[i];
    if (hex.buildingId) continue;
    if (hex.terrain === 'ocean') continue;

    const score = hex.deposits.length * 10 + (hex.deposits.reduce((s, d) => s + d.availability, 0));
    if (score > bestScore) {
      bestScore = score;
      bestHex = i;
    }
  }

  // Fallback: любой свободный не-ocean гекс
  if (bestHex === -1) {
    for (let i = 0; i < planet.hexes.length; i++) {
      if (!planet.hexes[i].buildingId && planet.hexes[i].terrain !== 'ocean') {
        bestHex = i;
        break;
      }
    }
  }

  // Последний fallback: любой свободный гекс
  if (bestHex === -1) {
    for (let i = 0; i < planet.hexes.length; i++) {
      if (!planet.hexes[i].buildingId) {
        bestHex = i;
        break;
      }
    }
  }

  if (bestHex === -1) return false; // Нет свободных гексов

  // Поставить colony_hub
  planet.hexes[bestHex].buildingId = 'colony_hub';
  planet.hexes[bestHex].buildingLevel = 1;
  planet.owner = 'player';

  // Дать стартовые ресурсы
  giveStarterResources(planet);

  // Пересчитать энергобаланс
  recalcEnergyBalance(planet, system);

  gameBus.emit('planet:colonized', { planetId: planet.id, hexIndex: bestHex });

  return true;
}

/**
 * Дать стартовые ресурсы планете (первичная колонизация).
 * Все элементы из таблицы Менделеева игры, но в разных количествах:
 * - Руды (ore) — основной запас для добычи через шахты
 * - Чистые элементы — начальный буфер для крафта
 * - Атмосферные — через газовый экстрактор
 */
export function giveStarterResources(planet: Planet): void {
  const starters: Record<string, number> = {
    // Руды — основной добываемый ресурс (шахты → плавильни → чистые элементы)
    'Fe-ore': 500, 'Si-ore': 400, 'C-ore': 300, 'Al-ore': 200,
    'Ti-ore': 80,  'Cr-ore': 60,  'Ni-ore': 50,  'V-ore': 20,
    'Cu-ore': 100, 'Au-ore': 10,
    'S-ore': 80,
    'U-ore': 15,
    'W-ore': 20,   'Co-ore': 25,  'Pt-ore': 5,
    'Li-ore': 30,  'Y-ore': 8,    'Ba-ore': 15,
    // Атмосферные руды (в породе — мало, основной добыч через экстрактор)
    'H-ore': 50,   'He-ore': 30,  'O-ore': 60,  'N-ore': 40,

    // Чистые элементы — начальный буфер для крафта
    Fe: 100, Si: 60, C: 40, Al: 30,
    Ti: 15,  Cu: 20, H: 200, O: 200,
    // Энергия
    Energy: 500,
  };
  for (const [id, amount] of Object.entries(starters)) {
    planet.resources[id] = (planet.resources[id] ?? 0) + amount;
  }
}
