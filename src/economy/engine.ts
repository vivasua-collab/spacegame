/**
 * Экономический движок — производство, крафт, энергия.
 * P1-26: Солнечная станция учитывает светимость звезды.
 * P1-27: Газовый экстрактор проверяет наличие атмосферы.
 */

import type { Planet, HexCell, ProductionQueue, ProductionItem, EntityId, StarSystem, BuildingDef, ProcessorType, ProcessorRecipeCategory } from '@/core/types';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { PROCESSOR_CATEGORIES } from '@/data/processor-categories';
import { ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups } from '@/data/baked-lookups';
import { canStoreResource, calculateWarehouseCapacity, calculateWarehouseCapacities, getOrbitBufferCapacity, ensureReservesForResources } from '@/data/warehouse';
import { DIRECT_GAS_MAP, getAtmosphericGasesForType } from '@/data/atmosphere-gases';
import { gameBus } from '@/core/typed-event-bus';

/**
 * Детерминированный счётчик ProductionItem IDs (gap-6, P9).
 * Раньше использовался `Date.now() + Math.random()` — нарушал принцип детерминизма игры
 * (audit §2.3). Теперь — монотонный счётчик. Для одного seed и последовательности actions
 * IDs будут одинаковыми (если enqueue вызывается в том же порядке).
 */
let productionItemCounter = 0;

/**
 * Сбросить счётчик ProductionItem IDs (для детерминированных тестов).
 * Вызывать после newGame/loadGame, чтобы начать с 0.
 */
export function resetProductionItemCounter(): void {
  productionItemCounter = 0;
}

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

    // 4. Автоматическое создание резервов для новых ресурсов
    ensureReservesForResources(planet);
  }
}

/**
 * Добыча ресурсов зданиями на планете.
 * P1-27: Газовый экстрактор требует атмосферу.
 * Руды и соединения кладутся на склад как сырьё —
 * переработка происходит через рецептурную систему (recipes.ts).
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

        // 1 тик = 1 день. Базовая скорость: ~1 единица/день при availability=0.5
        const baseRate = 1.0 * deposit.availability;
        const amount = baseRate * levelMult * terrainMult;
        const extracted = Math.min(amount, deposit.quantity);

        deposit.quantity -= extracted;
        if (extracted > 0) {
          // Кладём руду на склад как сырьё (переработка через рецепты)
          const canStore = canStoreResource(planet, deposit.elementId, extracted);
          const actual = Math.min(extracted, canStore);
          if (actual > 0) {
            planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
          }
        }
      }
    }

    // Colony hub: добыча всех залежей на гексе со скоростью 50% от шахты
    if (buildingDef.id === 'colony_hub') {
      const levelMult = 1 + hex.buildingLevel * 0.1;
      for (const deposit of hex.deposits) {
        if (deposit.quantity <= 0) continue;

        // 50% от скорости шахты (1 тик = 1 день)
        const baseRate = 0.5 * deposit.availability;
        const amount = baseRate * levelMult;
        const extracted = Math.min(amount, deposit.quantity);

        deposit.quantity -= extracted;
        if (extracted > 0) {
          const canStore = canStoreResource(planet, deposit.elementId, extracted);
          const actual = Math.min(extracted, canStore);
          if (actual > 0) {
            planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
          }
        }
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
      const atmosphereMult = planet.type === 'gas_giant' ? 1.0 : getAtmosphereEfficiency(planet.atmosphere.type);

      // Получаем список доступных газов для данного типа атмосферы
      const availableGases = getAtmosphericGasesForType(planet.atmosphere.type);
      for (const gasId of availableGases) {
        const baseRate = 2.0 * levelMult * atmosphereMult;
        const canStore = canStoreResource(planet, gasId, baseRate);
        if (canStore > 0) {
          planet.resources[gasId] = (planet.resources[gasId] ?? 0) + canStore;
        }
      }
    }
  }

  // Автоматическая конвертация чистых газов (не требующих переработки)
  // H2→H, N2→N, O2→O, He→He, Ne→Ne, Ar→Ar — 1:1 прямое преобразование
  convertDirectAtmosphericElements(planet);
}

/** Получить доступные газы для типа атмосферы (gap-3, C3 — вынесено в data/atmosphere-gases.ts) */

/** Конвертация чистых атмосферных газов в элементы (1:1, переработка не нужна) */
function convertDirectAtmosphericElements(planet: Planet): void {
  for (const [gasId, elementId] of Object.entries(DIRECT_GAS_MAP)) {
    const gasAmount = planet.resources[gasId] ?? 0;
    if (gasAmount > 0) {
      const canStore = canStoreResource(planet, elementId, gasAmount);
      const actual = Math.min(gasAmount, canStore);
      if (actual > 0) {
        planet.resources[elementId] = (planet.resources[elementId] ?? 0) + actual;
        planet.resources[gasId] = gasAmount - actual;
        if (planet.resources[gasId] <= 0) delete planet.resources[gasId];
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
 * (gap-7, C2 — удалено как мёртвый код, audit §2.3)
 * Прежняя extractOreToElements(planet, oreId, oreAmount) была @deprecated и не имела
 * вызовов: руды теперь кладутся на склад как сырьё и перерабатываются через рецептурную
 * систему (recipes.ts). Удалено в Блоке 01 C2.
 */

/**
 * Обработка очереди производства планеты.
 *
 * (gap-7, C7 — добавлен emit `economy:production-cancelled` при удалении элемента
 * из очереди. Раньше рецепт «терялся молча» — audit §2.3.)
 *
 * Block 05 (PR3-min): перед записью выходов в `planet.resources` найти
 * экземпляр здания-исполнителя (`recipe.buildingId`) на планете и применить
 * `calculateProcessorOutputMultiplier`. Умножить `amount` на `yieldMult`
 * и записать средневзвешенную чистоту в `planet.resourcePurity`.
 *
 * Альтернатива per-building cycles (PR3-full) — отложена; в PR3-min
 * используется «одна очередь на планету» + поиск экземпляра по buildingId.
 */
function processProductionQueue(planet: Planet, queues: Map<EntityId, ProductionQueue>): void {
  const queue = queues.get(planet.id);
  if (!queue || queue.items.length === 0) return;

  const item = queue.items[0];
  const recipe = RECIPE_MAP.get(item.recipeId);
  if (!recipe) {
    // (gap-7, C7) — эмитить событие об отмене, прежде чем удалить
    gameBus.emit('economy:production-cancelled', {
      planetId: planet.id,
      recipeId: item.recipeId,
      queueItemId: item.id,
      reason: 'recipe_not_found',
    });
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

      // ─── Block 05 PR3-min: множитель выхода процессора ──────────────
      // Найти экземпляр здания-исполнителя на планете (любой с подходящим
      // buildingId). Это «минимальное» решение — без per-building cycles.
      // Если таких зданий несколько, берём первое. PR3-full будет фильтровать
      // по специализации: specialised здание для этой категории приоритетнее.
      const buildingInstance = findProcessorInstance(planet, recipe.buildingId, recipe.processorCategory);
      const buildingDef = BUILDING_MAP.get(recipe.buildingId);
      let yieldMult = 1.0;
      let purity = 1.0;
      if (buildingDef?.isUniversalProcessor && buildingInstance) {
        const result = calculateProcessorOutputMultiplier(buildingDef, buildingInstance);
        yieldMult = result.yieldMult;
        purity = result.purity;
      }

      // Применить множитель к выходам и записать чистоту (средневзвешенно).
      if (!planet.resourcePurity) planet.resourcePurity = {};
      for (const [resourceId, amount] of Object.entries(recipe.outputs)) {
        const producedAmount = amount * yieldMult;
        const prevAmount = planet.resources[resourceId] ?? 0;
        const prevPurity = planet.resourcePurity[resourceId] ?? 1.0;
        // Средневзвешенная чистота (только если был предыдущий запас).
        const newTotal = prevAmount + producedAmount;
        const newPurity = newTotal > 0
          ? (prevPurity * prevAmount + purity * producedAmount) / newTotal
          : purity;
        planet.resources[resourceId] = newTotal;
        if (newTotal > 0) {
          planet.resourcePurity[resourceId] = newPurity;
        } else {
          delete planet.resourcePurity[resourceId];
        }
      }

      gameBus.emit('economy:production-complete', { planetId: planet.id, recipeId: recipe.id });
    } else {
      // (gap-7, C7) — недостаточно входных ресурсов; эмитить об отмене
      gameBus.emit('economy:production-cancelled', {
        planetId: planet.id,
        recipeId: recipe.id,
        queueItemId: item.id,
        reason: 'insufficient_inputs',
      });
    }

    if (item.repeat) {
      item.progress = item.total;
    } else {
      queue.items.shift();
    }
  }
}

/**
 * Block 05 (PR3-min): найти экземпляр процессорного здания на планете
 * по buildingId, предпочтительно с specialization, соответствующей
 * recipe.processorCategory (если указана).
 *
 * Сканы: planet.hexes (surface) + planet.atmosphericSlots + planet.orbitSlots.
 * Возвращает структуру с полями, нужными calculateProcessorOutputMultiplier.
 *
 * @param planet                — планета с построенными зданиями
 * @param buildingId            — какой buildingId искать (processor/refinery/synthesizer)
 * @param preferredCategory     — если указана, приоритет specialized зданию с этой специализацией
 */
export function findProcessorInstance(
  planet: Planet,
  buildingId: string,
  preferredCategory?: ProcessorRecipeCategory,
): {
  processorType: ProcessorType;
  specialization?: ProcessorRecipeCategory;
  specializationLevel: number;
  activeRecipes?: string[];
  hexIndex: number;
} | null {
  // Собираем все экземпляры с указанным buildingId.
  type Candidate = {
    processorType: ProcessorType;
    specialization?: ProcessorRecipeCategory;
    specializationLevel: number;
    activeRecipes?: string[];
    hexIndex: number;
  };
  const candidates: Candidate[] = [];

  // Surface hexes
  for (let i = 0; i < planet.hexes.length; i++) {
    const hex = planet.hexes[i];
    if (hex.buildingId === buildingId && hex.processorType) {
      candidates.push({
        processorType: hex.processorType,
        specialization: hex.specialization,
        specializationLevel: hex.specializationLevel ?? 0,
        activeRecipes: hex.activeRecipes,
        hexIndex: i,
      });
    } else if (hex.buildingId === buildingId) {
      // Building exists but processorType not set (e.g. migration deferred).
      // Defaults: universal, level 0, no activeRecipes.
      candidates.push({
        processorType: 'universal' as ProcessorType,
        specializationLevel: 0,
        hexIndex: i,
      });
    }
  }
  // Atmosphere slots
  for (let i = 0; i < planet.atmosphericSlots.length; i++) {
    const slot = planet.atmosphericSlots[i];
    if (slot.buildingId === buildingId && slot.processorType) {
      candidates.push({
        processorType: slot.processorType,
        specialization: slot.specialization,
        specializationLevel: slot.specializationLevel ?? 0,
        activeRecipes: slot.activeRecipes,
        hexIndex: -1 - i,
      });
    } else if (slot.buildingId === buildingId) {
      candidates.push({
        processorType: 'universal' as ProcessorType,
        specializationLevel: 0,
        hexIndex: -1 - i,
      });
    }
  }
  // Orbit slots
  for (let i = 0; i < planet.orbitSlots.length; i++) {
    const slot = planet.orbitSlots[i];
    if (slot.buildingId === buildingId && slot.processorType) {
      candidates.push({
        processorType: slot.processorType,
        specialization: slot.specialization,
        specializationLevel: slot.specializationLevel ?? 0,
        activeRecipes: slot.activeRecipes,
        hexIndex: -100 - i,
      });
    } else if (slot.buildingId === buildingId) {
      candidates.push({
        processorType: 'universal' as ProcessorType,
        specializationLevel: 0,
        hexIndex: -100 - i,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Если есть preferredCategory — приоритет specialized зданию с этой специализацией.
  if (preferredCategory) {
    const matching = candidates.find(c =>
      c.processorType === 'specialized' && c.specialization === preferredCategory,
    );
    if (matching) return matching;
  }

  // Fallback: первое попавшееся specialized, потом первое universal.
  const specialized = candidates.find(c => c.processorType === 'specialized');
  if (specialized) return specialized;
  return candidates[0];
}

/**
 * Block 05 (PR3): расчёт множителя выхода для процессорного здания.
 *
 * Универсальный:
 *   output = base × 0.75 × (1 / sqrt(max(1, activeRecipes)))
 *   purity = building.basePurity (по умолчанию 0.78, диапазон 0.70–0.85)
 *
 * Специализированный:
 *   output = base × 1.0 × purityBonus
 *   purityBonus = 1.0 + 0.02 × (specializationLevel - 1)   // +0%/+2%/+4%/+6%/+8%
 *   purity = 0.92 + 0.0175 × (specializationLevel - 1)     // 0.92..0.99
 *
 * Источник: docs/40-buildings.md §11.3 (формулы переработчиков).
 */
export function calculateProcessorOutputMultiplier(
  building: BuildingDef,
  instance: {
    processorType?: ProcessorType;
    specialization?: ProcessorRecipeCategory;
    specializationLevel?: number;
    activeRecipes?: string[];
  },
): { yieldMult: number; purity: number } {
  // Специализированная ветка (refinery/synthesizer или специализированный processor)
  if (instance.processorType === 'specialized') {
    const specLvl = Math.max(1, Math.min(5, instance.specializationLevel ?? 1));
    const purityBonus = 1.0 + 0.02 * (specLvl - 1);       // +0%/+2%/+4%/+6%/+8%
    const purity = 0.92 + 0.0175 * (specLvl - 1);         // 0.92..0.99
    return { yieldMult: (building.baseYield ?? 1.0) * purityBonus, purity };
  }
  // Универсальная ветка (processor без specialization)
  const activeCount = Math.max(1, instance.activeRecipes?.length ?? 1);
  const multiPenalty = 1 / Math.sqrt(activeCount);         // 1.0 / 0.707 / 0.577 / 0.5 / 0.447 …
  return {
    yieldMult: (building.baseYield ?? 0.75) * multiPenalty,
    purity: building.basePurity ?? 0.78,
  };
}

/**
 * Пересчёт энергетического баланса планеты.
 * P1-26: Солнечная станция зависит от светимости звезды и расстояния.
 *
 * (C4 — audit §2.3: ранее 3 отдельных цикла по surface/atmosphere/orbit с дублированной
 * логикой. Объединены в один helper `processBuildingEnergy` + 3 коротких цикла.)
 */
export function recalcEnergyBalance(planet: Planet, system?: StarSystem): void {
  let production = 0;
  let consumption = 0;

  // Get star luminosity if available (P2-26: guard against black holes with ~0 luminosity)
  const starLuminosity = Math.max(0.0001, system?.stars[0]?.luminosity ?? 1.0);
  const distanceFactor = Math.max(0.01, planet.orbitalRadius);

  // Helper: process one building's energy contribution (C4 — extracted from 3 inline copies).
  // layer: 'surface' | 'atmosphere' | 'orbit' — affects solar_plant bonus (orbit ×1.2)
  //        and colony_hub special-case (only on surface).
  const processBuildingEnergy = (
    buildingId: string | null | undefined,
    buildingLevel: number,
    layer: 'surface' | 'atmosphere' | 'orbit',
  ): void => {
    if (!buildingId) return;
    const buildingDef = BUILDING_MAP.get(buildingId);
    if (!buildingDef) return;

    const levelMult = 1 + buildingLevel * 0.2;
    const orbitBonus = layer === 'orbit' ? 1.2 : 1.0;

    if (buildingDef.category === 'energy') {
      if (buildingDef.id === 'solar_plant') {
        // P1-26: power_output = base_output × level × star_luminosity / distance_factor
        // Orbit solar plants work 1.2× better (no atmosphere attenuation).
        production += 10 * levelMult * starLuminosity / distanceFactor * orbitBonus;
      } else if (buildingDef.id === 'nuclear_reactor') {
        // P2-06/P2-07: nuclear plant base output = 25, no luminosity factor
        production += 25 * levelMult;
      } else {
        production += 10 * levelMult; // fallback for unknown energy buildings
      }
    } else if (buildingDef.id === 'colony_hub') {
      // Colony hub: базовая энергия 5 — только на surface (colony_hub строится только там).
      if (layer === 'surface') {
        production += 5 * levelMult;
      }
    } else {
      consumption += buildingDef.energyConsumption * levelMult;
    }
  };

  // Surface buildings
  for (const hex of planet.hexes) {
    processBuildingEnergy(hex.buildingId, hex.buildingLevel, 'surface');
  }

  // Atmospheric slot buildings
  for (const slot of planet.atmosphericSlots) {
    processBuildingEnergy(slot.buildingId, slot.buildingLevel, 'atmosphere');
  }

  // Orbit slot buildings
  for (const slot of planet.orbitSlots) {
    processBuildingEnergy(slot.buildingId, slot.buildingLevel, 'orbit');
  }

  planet.energyBalance = production - consumption;

  // Пересчёт вместимости склада и орбитального буфера
  if (planet.warehouse) {
    // v3.0: раздельная система складов
    const caps = calculateWarehouseCapacities(planet);
    planet.warehouse.capacities = caps;
    // Legacy totalCapacity (сумма всех 3) — для обратной совместимости
    planet.warehouse.totalCapacity = caps.ore + caps.processed + caps.highTech;
    planet.warehouse.orbitBuffer.capacity = getOrbitBufferCapacity(planet);
  }
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
  gameBus.emit('economy:building-constructed', { planetId: planet.id, hexIndex, buildingId });

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
  gameBus.emit('economy:building-constructed', { planetId: planet.id, hexIndex: -1 - slotIndex, buildingId });
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
  gameBus.emit('economy:building-constructed', { planetId: planet.id, hexIndex: -100 - slotIndex, buildingId });
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
  gameBus.emit('economy:building-upgraded', { planetId: planet.id, hexIndex, level: hex.buildingLevel });

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
    id: `prod_${planet.id}_${productionItemCounter++}`,
    recipeId,
    progress: recipe.time,
    total: recipe.time,
    repeat,
  });

  return true;
}

// ─── Block 05 PR4: специализация переработчиков ────────────────────────────
//
// specializeBuilding(planet, hexIndex, category)
//   Превратить универсальный processor в специализированный под категорию,
//   либо откатить специализацию к универсальной (за 50% возврата стоимости).
//
// upgradeSpecialization(planet, hexIndex)
//   Поднять specializationLevel 1→2→…→5. Каждый уровень даёт +2% purityBonus
//   и +0.0175 к чистоте.
//
// Эти функции мутируют Planet.hexes[hexIndex] напрямую (как buildOnHex/
// upgradeBuilding). Все события эмитируются через gameBus (legacy adapter
// проксирует в typedBus — после DEP-1 миграции заменится на typedBus).

/**
 * Списать стоимость специализации с planet.resources.
 * Возвращает true, если всех ресурсов достаточно; иначе false (без списания).
 */
function spendSpecializeCost(planet: Planet, cost: Partial<Record<string, number>>): boolean {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if ((planet.resources[resourceId] ?? 0) < (amount ?? 0)) return false;
  }
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount && amount > 0) {
      planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) - amount;
    }
  }
  return true;
}

/**
 * Вернуть долю стоимости специализации на склад планеты (для отката).
 * fraction=0.5 → вернуть 50%.
 */
function refundSpecializeCost(
  planet: Planet,
  cost: Partial<Record<string, number>>,
  fraction: number,
): void {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount && amount > 0) {
      const refund = Math.floor(amount * fraction);
      if (refund > 0) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + refund;
      }
    }
  }
}

/**
 * Block 05 PR4: превратить универсальный processor в специализированный
 * под конкретную категорию, либо откатить специализацию к универсальной.
 *
 * Проверки:
 * - Здание должно быть processor (не refinery/synthesizer — они уже
 *   specialized как предельные формы).
 * - Уровень здания ≥ 3 (минимум для специализации).
 * - Категория доступна на этом уровне (deep_ore_smelting требует ур. 5+).
 * - Достаточно ресурсов для specializeCost.
 *
 * Эмитит:
 * - economy:building-specialized (с specialization=category|'universal')
 * - economy:processor-output-changed (с новым yieldMult/purity)
 *
 * Необратимость: ОБРАТИМО через specializeBuilding(..., 'universal') за
 * 50% возврата стоимости (мягче для игрока, упрощает тестирование).
 *
 * @returns { success: boolean; reason?: string }
 */
export function specializeBuilding(
  planet: Planet,
  hexIndex: number,
  category: ProcessorRecipeCategory | 'universal',
  _options?: { silent?: boolean },
): { success: boolean; reason?: string } {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) {
    return { success: false, reason: 'invalid-hex-index' };
  }
  const hex = planet.hexes[hexIndex];
  if (!hex.buildingId) return { success: false, reason: 'no-building' };

  const def = BUILDING_MAP.get(hex.buildingId);
  if (!def) return { success: false, reason: 'unknown-building' };
  if (!def.isUniversalProcessor) return { success: false, reason: 'not-processor' };
  // refinery/synthesizer — уже специализированные предельные формы; их нельзя
  // «специализировать дальше» или откатывать к универсальному.
  if (def.defaultProcessorType === 'specialized') {
    return { success: false, reason: 'already-specialized-form' };
  }

  // ─── Случай: откат к универсальному ───────────────────────────────
  if (category === 'universal') {
    if (hex.processorType !== 'specialized') {
      return { success: false, reason: 'not-specialized' };
    }
    hex.processorType = 'universal';
    hex.specialization = undefined;
    hex.specializationLevel = 0;
    // Возврат 50% specializeCost
    refundSpecializeCost(planet, def.specializeCost ?? {}, 0.5);
    gameBus.emit('economy:building-specialized', {
      planetId: planet.id,
      hexIndex,
      specialization: 'universal',
      specializationLevel: 0,
    });
    // Эмит output-changed с universal формулой
    const out = calculateProcessorOutputMultiplier(def, hex);
    gameBus.emit('economy:processor-output-changed', {
      planetId: planet.id,
      hexIndex,
      yieldMult: out.yieldMult,
      purity: out.purity,
    });
    return { success: true };
  }

  // ─── Случай: специализация universal → specialized ────────────────
  // Минимальный уровень здания для специализации
  if (hex.buildingLevel < 3) {
    return { success: false, reason: 'level-too-low' };
  }
  // Категория требует мин. уровень здания
  const catDef = PROCESSOR_CATEGORIES.get(category);
  if (!catDef) {
    return { success: false, reason: 'unknown-category' };
  }
  if (hex.buildingLevel < catDef.minBuildingLevel) {
    return { success: false, reason: 'category-level-too-low' };
  }
  // Уже специализирован в эту же категорию?
  if (hex.processorType === 'specialized' && hex.specialization === category) {
    return { success: false, reason: 'already-specialized-this-category' };
  }
  // Списание стоимости (если переходим universal → specialized в другой категории,
  // это считается как переключение; дешевле — построить новый processor).
  // Для упрощения: switching category требует полной стоимости specializeCost.
  if (hex.processorType !== 'specialized') {
    if (!spendSpecializeCost(planet, def.specializeCost ?? {})) {
      return { success: false, reason: 'cannot-afford' };
    }
  }
  // Мутация
  hex.processorType = 'specialized';
  hex.specialization = category;
  hex.specializationLevel = 1;
  // Фильтр активных рецептов (только для PR3-full — сейчас activeRecipes может
  // быть пустым; фильтр безопасен в обоих случаях).
  hex.activeRecipes = (hex.activeRecipes ?? []).filter(rid => {
    const r = RECIPE_MAP.get(rid);
    return r?.processorCategory === category;
  });

  gameBus.emit('economy:building-specialized', {
    planetId: planet.id,
    hexIndex,
    specialization: category,
    specializationLevel: 1,
  });
  // Эмит output-changed со specialized формулой (L1)
  const out = calculateProcessorOutputMultiplier(def, hex);
  gameBus.emit('economy:processor-output-changed', {
    planetId: planet.id,
    hexIndex,
    yieldMult: out.yieldMult,
    purity: out.purity,
  });
  return { success: true };
}

/**
 * Block 05 PR4: повысить уровень специализации (1→2→…→5).
 *
 * Каждый уровень даёт +2% purityBonus и +0.0175 к чистоте.
 * Стоимость = upgradeSpecializationCost × specializationLevel.
 *
 * Эмитит:
 * - economy:specialization-upgraded
 * - economy:processor-output-changed (с новым yieldMult/purity)
 */
export function upgradeSpecialization(
  planet: Planet,
  hexIndex: number,
): { success: boolean; reason?: string } {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) {
    return { success: false, reason: 'invalid-hex-index' };
  }
  const hex = planet.hexes[hexIndex];
  if (!hex.buildingId) return { success: false, reason: 'no-building' };

  const def = BUILDING_MAP.get(hex.buildingId);
  if (!def) return { success: false, reason: 'unknown-building' };
  if (!def.isUniversalProcessor) return { success: false, reason: 'not-processor' };
  if (hex.processorType !== 'specialized') {
    return { success: false, reason: 'not-specialized' };
  }
  const currentLevel = hex.specializationLevel ?? 1;
  if (currentLevel >= 5) {
    return { success: false, reason: 'max-level' };
  }

  // Стоимость = upgradeSpecializationCost × currentLevel
  const upgradeCost = def.upgradeSpecializationCost ?? {};
  for (const [resourceId, amount] of Object.entries(upgradeCost)) {
    const required = (amount ?? 0) * currentLevel;
    if ((planet.resources[resourceId] ?? 0) < required) {
      return { success: false, reason: 'cannot-afford' };
    }
  }
  for (const [resourceId, amount] of Object.entries(upgradeCost)) {
    const required = (amount ?? 0) * currentLevel;
    if (required > 0) {
      planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) - required;
    }
  }

  // Мутация: +1 к specializationLevel
  hex.specializationLevel = currentLevel + 1;

  gameBus.emit('economy:specialization-upgraded', {
    planetId: planet.id,
    hexIndex,
    specializationLevel: hex.specializationLevel,
  });
  const out = calculateProcessorOutputMultiplier(def, hex);
  gameBus.emit('economy:processor-output-changed', {
    planetId: planet.id,
    hexIndex,
    yieldMult: out.yieldMult,
    purity: out.purity,
  });
  return { success: true };
}

/**
 * Отменить элемент очереди производства по его ID (Block 01 P4).
 *
 * Сканирует очередь планеты и удаляет элемент с совпадающим `id`.
 * Возвращает true, если элемент найден и удалён; false — если очередь
 * или элемент не существуют. Эмитит `economy:production-cancelled`
 * с причиной `insufficient_inputs` (ближайшая доступная причина из
 * `EconomyEvents['economy:production-cancelled']['reason']` для ручной
 * отмены; будущая итерация может добавить `'manual'` в union type).
 */
export function cancelProduction(
  planet: Planet,
  queues: Map<EntityId, ProductionQueue>,
  queueItemId: string,
): boolean {
  const queue = queues.get(planet.id);
  if (!queue) return false;

  const idx = queue.items.findIndex((it) => it.id === queueItemId);
  if (idx === -1) return false;

  const [removed] = queue.items.splice(idx, 1);
  gameBus.emit('economy:production-cancelled', {
    planetId: planet.id,
    recipeId: removed.recipeId,
    queueItemId: removed.id,
    reason: 'insufficient_inputs',
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

  gameBus.emit('economy:planet-colonized', { planetId: planet.id, hexIndex: bestHex });

  return true;
}

/**
 * Дать стартовые ресурсы планете (первичная колонизация).
 * Колонисты привозят только чистые материалы — руды добываются шахтами на гексах.
 * Energy НЕ выдаётся — это потоковый ресурс (производство/потребление за тик).
 */
export function giveStarterResources(planet: Planet): void {
  const starters: Record<string, number> = {
    // Строительные — основа для застройки
    Fe: 150, Si: 100, C: 60, Al: 80,
    // Топливные — для энергетики
    H: 300,
    // Металлы — для продвинутого строительства и электроники
    Ti: 30, Cu: 40,
    // Химические — жизнеобеспечение
    O: 200, N: 100,
    // Благородные — малые запасы для электроники
    Au: 2,
    // Редкие — стратегические
    U: 5,
  };
  for (const [id, amount] of Object.entries(starters)) {
    planet.resources[id] = (planet.resources[id] ?? 0) + amount;
  }
}
