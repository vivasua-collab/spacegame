/**
 * Экономический движок — производство, крафт, энергия.
 * P1-26: Солнечная станция учитывает светимость звезды.
 * P1-27: Газовый экстрактор проверяет наличие атмосферы.
 */

import type { Planet, HexCell, AtmosphericSlot, OrbitalSlot, BuildingLayer, ProductionQueue, ProductionItem, EntityId, StarSystem, BuildingDef, ProcessorType, ProcessorRecipeCategory } from '@/core/types';
import { BUILDING_MAP, areBuildingTechsMet } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { PROCESSOR_CATEGORIES } from '@/data/processor-categories';
import { ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups } from '@/data/baked-lookups';
import { canStoreResource, calculateWarehouseCapacity, calculateWarehouseCapacities, getOrbitBufferCapacity, ensureReservesForResources } from '@/data/warehouse';
import { DIRECT_GAS_MAP, getAtmosphericGasesForType } from '@/data/atmosphere-gases';
import { gameBus } from '@/core/typed-event-bus';
import { getEnergyConsumptionMultiplier, getEnergyGenerationMultiplier, getMiningSpeedMultiplier, getProcessingSpeedMultiplier } from '@/economy/adjacency';

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
  for (let i = 0; i < planet.hexes.length; i++) {
    const hex = planet.hexes[i];
    if (!hex || !hex.buildingId) continue;
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
      // R-SYNERGY v2 mining_cluster (Задача 24): экстракторы одного
      // подтипа ускоряют добычу друг друга (+10% за смежного, стекинг
      // ×0.5^(n−1)) — добывающие здания дают бонус СКОРОСТИ ДОБЫЧИ.
      const miningMult = getMiningSpeedMultiplier(planet, i);

      for (const deposit of hex.deposits) {
        if (deposit.quantity <= 0) continue;

        // 1 тик = 1 день. Базовая скорость: ~1 единица/день при availability=0.5
        const baseRate = 1.0 * deposit.availability;
        const amount = baseRate * levelMult * terrainMult * miningMult;
        const requested = Math.min(amount, deposit.quantity);

        // Audit Pass 2 P1-1 (fix): only debit the deposit for the portion
        // we can actually store. Previously we debited `requested` (full
        // amount) BEFORE the canStoreResource check — if the warehouse was
        // full the extracted units silently evaporated (deposit decremented,
        // nothing added to planet.resources). Now the leftover stays in the
        // deposit for the next tick.
        const canStore = canStoreResource(planet, deposit.elementId, requested);
        const actual = Math.min(requested, canStore);
        if (actual > 0) {
          deposit.quantity -= actual;
          // Кладём руду на склад как сырьё (переработка через рецепты)
          planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
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
        const requested = Math.min(amount, deposit.quantity);

        // Audit Pass 2 P2-1 (fix, same bug as P1-1 above): only debit what
        // can actually be stored, leaving the remainder in the deposit.
        const canStore = canStoreResource(planet, deposit.elementId, requested);
        const actual = Math.min(requested, canStore);
        if (actual > 0) {
          deposit.quantity -= actual;
          planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
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

  // ─── R-SYNERGY §processing: множитель скорости производства ─────────
  // Смежные шахты (+15%) / склады (+20%) ускоряют переработку у здания-
  // исполнителя (docs/40-buildings.md §5.1, стекинг ×0.5^(n-1)).
  // PR3-min: берём ПЕРВЫЙ экземпляр здания recipe.buildingId на гексах
  // поверхности (та же политика выбора, что у findProcessorInstance).
  const executorHexIndex = planet.hexes.findIndex((h) => h?.buildingId === recipe.buildingId);
  const synergySpeedMult = executorHexIndex >= 0
    ? getProcessingSpeedMultiplier(planet, executorHexIndex)
    : 1;

  // Обновляем прогресс (R-SYNERGY: с множителем Синергии)
  item.progress -= synergySpeedMult;

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
 *   output = base × baseYield × (1 / sqrt(max(1, activeRecipes)))
 *   purity = building.basePurity (по умолчанию 0.78, диапазон 0.70–0.85)
 *
 * Специализированный (любое specialized здание — processor после specialize,
 * или refinery/synthesizer как предельные специализированные формы):
 *   output = base × 1.0 × purityBonus        // baseYield = 1.0 для specialized
 *   purityBonus = 1.0 + 0.02 × (specializationLevel - 1)   // +0%/+2%/+4%/+6%/+8%
 *   purity = 0.92 + 0.0175 × (specializationLevel - 1)     // 0.92..0.99
 *
 * Внимание: для specialized ветки baseYield фиксирован = 1.0 (по плану §11.3),
 * НЕ building.baseYield (который 0.75 для processor). Это даёт специализированному
 * processor L1 выход 7.0 × 1.0 × 1.0 = 7.0 ед. (+33% над universal L1 с 1 рецептом).
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
    // baseYield для specialized = 1.0 (фиксированный, по плану §11.3)
    return { yieldMult: 1.0 * purityBonus, purity };
  }
  // Универсальная ветка (processor без specialization)
  // building.baseYield: 0.75 для processor (можно тюнить в зданиях).
  const activeCount = Math.max(1, instance.activeRecipes?.length ?? 1);
  const multiPenalty = 1 / Math.sqrt(activeCount);         // 1.0 / 0.707 / 0.577 / 0.5 / 0.447 …
  return {
    yieldMult: (building.baseYield ?? 0.75) * multiPenalty,
    purity: building.basePurity ?? 0.78,
  };
}

/**
 * R-24 (Задача 24): чистый хелпер выработки энергии зданием за тик.
 *
 * ЕДИНАЯ формула для engine (recalcEnergyBalance) и UI (building-dialog —
 * «реальное отображение в построенном здании»): раньше UI показывал
 * захардкоженное «+10/tick», игнорируя уровень, светимость звезды (P1-26)
 * и орбитальный бонус — теперь диалог показывает ровно то, что считает
 * движок (без синергии power_boost — она добавляется отдельно, т.к. engine
 * применяет её только на гексах поверхности).
 *
 * Формулы (docs/30-energy.md / 40-buildings.md):
 *   - solar_plant:  10 × (1 + L×0.2) × светимость / max(0.01, R) × (orbit? 1.2 : 1)
 *     (P1-26 — выработка зависит от светимости звезды и расстояния;
 *     орбитальные станции работают в 1.2× лучше — нет затухания в атмосфере);
 *   - nuclear_reactor: 25 × (1 + L×0.2) (P2-06/P2-07 — без светимости);
 *   - прочие energy:  10 × (1 + L×0.2) (fallback);
 *   - colony_hub (только surface): 5 × (1 + L×0.2);
 *   - остальные: 0.
 *
 * @param buildingId     id здания из каталога
 * @param buildingLevel  уровень (≥1; 0 → 0)
 * @param layer          слой размещения (orbit → solar ×1.2)
 * @param starLuminosity светимость звезды (L_sun); при отсутствии — 1.0
 * @param orbitalRadius  орб. радиус планеты (дистанционный фактор P1-26)
 */
export function getBuildingEnergyOutput(
  buildingId: string,
  buildingLevel: number,
  layer: 'surface' | 'atmosphere' | 'orbit',
  starLuminosity: number,
  orbitalRadius: number,
): number {
  const def = BUILDING_MAP.get(buildingId);
  if (!def || buildingLevel < 1) return 0;
  const levelMult = 1 + buildingLevel * 0.2;
  const distanceFactor = Math.max(0.01, orbitalRadius);
  const orbitBonus = layer === 'orbit' ? 1.2 : 1.0;

  if (def.category === 'energy') {
    if (def.id === 'solar_plant') {
      // P1-26: power_output = base_output × level × star_luminosity / distance_factor
      // Orbit solar plants work 1.2× better (no atmosphere attenuation).
      return 10 * levelMult * Math.max(0.0001, starLuminosity) / distanceFactor * orbitBonus;
    }
    if (def.id === 'nuclear_reactor') {
      // P2-06/P2-07: nuclear plant base output = 25, no luminosity factor
      return 25 * levelMult;
    }
    return 10 * levelMult; // fallback for unknown energy buildings
  }
  if (def.id === 'colony_hub') {
    // Colony hub: базовая энергия 5 — только на surface (строится только там).
    return layer === 'surface' ? 5 * levelMult : 0;
  }
  return 0;
}

/**
 * R-24 (Задача 24): чистый хелпер энергопотребления здания за тик.
 *
 * Базовая формула engine: energyConsumption × (1 + L×0.2) — тот же расчёт,
 * что в recalcEnergyBalance (без синергии power_grid; движок применяет её
 * только на гексах поверхности). UI показывает потребление с учётом уровня.
 */
export function getBuildingEnergyConsumption(
  buildingId: string,
  buildingLevel: number,
): number {
  const def = BUILDING_MAP.get(buildingId);
  if (!def || buildingLevel < 1) return 0;
  return def.energyConsumption * (1 + buildingLevel * 0.2);
}

/**
 * Пересчёт энергетического баланса планеты.
 * P1-26: Солнечная станция зависит от светимости звезды и расстояния.
 *
 * (C4 — audit §2.3: ранее 3 отдельных цикла по surface/atmosphere/orbit с дублированной
 * логикой. Объединены в один helper `processBuildingEnergy` + 3 коротких цикла.)
 *
 * R-SYNERGY v2 (Задача 24):
 *   - потребители на гексах поверхности: множитель энергопотребления от
 *     смежных электростанций (power_grid, −5% за станцию);
 *   - генераторы на гексах поверхности: множитель ВЫРАБОТКИ от смежных
 *     потребителей (power_boost, +5% за потребителя, стекинг ×0.5^(n−1)).
 */
export function recalcEnergyBalance(planet: Planet, system?: StarSystem): void {
  let production = 0;
  let consumption = 0;

  // Get star luminosity if available (P2-26: guard against black holes with ~0 luminosity)
  const starLuminosity = Math.max(0.0001, system?.stars[0]?.luminosity ?? 1.0);

  // Helper: process one building's energy contribution (C4 — extracted from 3 inline copies).
  // layer: 'surface' | 'atmosphere' | 'orbit' — affects solar_plant bonus (orbit ×1.2)
  //        and colony_hub special-case (only on surface).
  // R-SYNERGY: для зданий на гексах поверхности применяются множители
  // энергопотребления (power_grid) и выработки (power_boost), docs §5.1.
  const processBuildingEnergy = (
    buildingId: string | null | undefined,
    buildingLevel: number,
    layer: 'surface' | 'atmosphere' | 'orbit',
    hexIndex = -1,
  ): void => {
    if (!buildingId) return;
    const buildingDef = BUILDING_MAP.get(buildingId);
    if (!buildingDef) return;

    const levelMult = 1 + buildingLevel * 0.2;

    if (buildingDef.category === 'energy') {
      // Базовая выработка (единая формула с UI-хелпером getBuildingEnergyOutput).
      const base = getBuildingEnergyOutput(buildingDef.id, buildingLevel, layer, starLuminosity, planet.orbitalRadius);
      // R-SYNERGY v2 power_boost: генератор на гексе поверхности получает
      // +выработку за смежных потребителей (+5% за каждого, стекинг).
      const synergyMult = layer === 'surface' && hexIndex >= 0
        ? getEnergyGenerationMultiplier(planet, hexIndex)
        : 1;
      production += base * synergyMult;
    } else if (buildingDef.id === 'colony_hub') {
      // Colony hub: базовая энергия 5 — только на surface (colony_hub строится только там).
      if (layer === 'surface') {
        production += 5 * levelMult;
      }
    } else {
      // R-SYNERGY §power: смежные электростанции снижают потребление
      // (−5% за каждую, стекинг ×0.5^(n-1); только для гексов поверхности).
      const synergyMult = layer === 'surface' && hexIndex >= 0
        ? getEnergyConsumptionMultiplier(planet, hexIndex)
        : 1;
      consumption += buildingDef.energyConsumption * levelMult * synergyMult;
    }
  };

  // Surface buildings
  for (let i = 0; i < planet.hexes.length; i++) {
    const hex = planet.hexes[i];
    if (!hex) continue;
    processBuildingEnergy(hex.buildingId, hex.buildingLevel, 'surface', i);
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
 *
 * R-BLD-MOD: добавлен опциональный параметр `researched` — карта изученных
 * технологий (techId → уровень). Если передан, проверяется requiresTechs
 * здания (технологии, необходимые для открытия). Если не передан — гейт
 * пропускается (backward-compat для тестов, вызывающих с 3 аргументами).
 * Также добавлена проверка terrainTypes (allowlist местности) если задано.
 */
export function buildOnHex(
  planet: Planet,
  hexIndex: number,
  buildingId: string,
  researched?: Record<string, number>,
): boolean {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) return false;
  const hex = planet.hexes[hexIndex];
  if (!hex) return false;
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

  // R-BLD-MOD: проверка местности (terrainTypes allowlist)
  if (buildingDef.terrainTypes && buildingDef.terrainTypes.length > 0) {
    if (!buildingDef.terrainTypes.includes(hex.terrain)) {
      return false;
    }
  }

  // R-BLD-MOD: проверка технологических требований (requiresTechs)
  if (researched && !areBuildingTechsMet(buildingDef, researched)) {
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
 *
 * R-BLD-MOD: добавлен опциональный `researched` для requiresTechs-гейта.
 */
export function buildOnAtmosphereSlot(
  planet: Planet,
  slotIndex: number,
  buildingId: string,
  researched?: Record<string, number>,
): boolean {
  if (slotIndex < 0 || slotIndex >= planet.atmosphericSlots.length) return false;
  const slot = planet.atmosphericSlots[slotIndex];
  if (!slot) return false;
  if (slot.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef) return false;

  // Только атмосферные здания
  if (!buildingDef.layer.includes('atmosphere')) return false;

  // P1-27: проверка атмосферы
  if (buildingDef.requiresAtmosphere && planet.atmosphere.type === 'none') {
    return false;
  }

  // R-BLD-MOD: проверка технологических требований (requiresTechs)
  if (researched && !areBuildingTechsMet(buildingDef, researched)) {
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
 *
 * R-BLD-MOD: добавлен опциональный `researched` для requiresTechs-гейта.
 */
export function buildOnOrbitSlot(
  planet: Planet,
  slotIndex: number,
  buildingId: string,
  researched?: Record<string, number>,
): boolean {
  if (slotIndex < 0 || slotIndex >= planet.orbitSlots.length) return false;
  const slot = planet.orbitSlots[slotIndex];
  if (!slot) return false;
  if (slot.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef) return false;

  // Только орбитальные здания
  if (!buildingDef.layer.includes('orbit')) return false;

  // R-BLD-MOD: проверка технологических требований (requiresTechs)
  if (researched && !areBuildingTechsMet(buildingDef, researched)) {
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

// ═══════════ R-DEMOLISH (Задача 22): понижение уровня и снос ═══════════

/**
 * Доля возврата ресурсов при понижении уровня / сносе здания.
 * 0.5 = 50% вложенных ресурсов возвращается на склад планеты.
 */
export const DEMOLITION_REFUND_SHARE = 0.5;

/** Слот-ячейка здания: surface-гекс, атмосферный или орбитальный слот. */
type BuildingCell = HexCell | AtmosphericSlot | OrbitalSlot;

/**
 * Разрешить адрес ячейки здания по слою и индексу.
 *
 * Возвращает ячейку (структурно совместимую: buildingId/buildingLevel/
 * процессорные поля) и reportIndex — единый индекс для событий/UI:
 *   surface      → hexIndex (>= 0);
 *   atmosphere   → -1 - slotIndex;
 *   orbit        → -100 - slotIndex
 * (та же конвенция, что у economy:building-constructed).
 *
 * 'space' не поддерживается (нет планетарных слотов) → null.
 */
function getBuildingCell(
  planet: Planet,
  layer: BuildingLayer,
  index: number,
): { cell: BuildingCell; reportIndex: number } | null {
  if (layer === 'atmosphere') {
    const slot = planet.atmosphericSlots[index];
    if (!slot) return null;
    return { cell: slot, reportIndex: -1 - index };
  }
  if (layer === 'orbit') {
    const slot = planet.orbitSlots[index];
    if (!slot) return null;
    return { cell: slot, reportIndex: -100 - index };
  }
  if (layer === 'surface') {
    const hex = planet.hexes[index];
    if (!hex) return null;
    return { cell: hex, reportIndex: index };
  }
  return null;
}

/** Сбросить состояние экземпляра здания (процессорные поля) при сносе. */
function clearCellInstanceState(cell: BuildingCell): void {
  cell.buildingId = null;
  cell.buildingLevel = 0;
  cell.processorType = undefined;
  cell.specialization = undefined;
  cell.specializationLevel = undefined;
  cell.activeRecipes = undefined;
}

/**
 * Понизить уровень здания на 1 (R-DEMOLISH).
 *
 * - Уровень L → L−1; возврат 50% стоимости уровня L (стоимость = base × (L−1)).
 * - При L = 1 понижение превращается в СНОС (гекс/слот освобождается,
 *   возврат 50% стоимости постройки) — «понижение до нуля».
 * - Колониальный хаб нельзя понижать/сносить (ядро колонии).
 * - Энергобаланс пересчитывается (recalcEnergyBalance).
 *
 * Известное упрощение MVP: снос не блокируется активной очередью
 * производства (рецепты ссылаются на buildingId, не на экземпляр —
 * при отсутствии экземпляра выход считается без процессорных бонусов).
 */
export function downgradeBuilding(
  planet: Planet,
  layer: BuildingLayer,
  index: number,
): boolean {
  const ref = getBuildingCell(planet, layer, index);
  if (!ref) return false;
  const { cell, reportIndex } = ref;
  if (!cell.buildingId || cell.buildingLevel < 1) return false;

  const buildingDef = BUILDING_MAP.get(cell.buildingId);
  if (!buildingDef) return false;

  // Колониальный хаб — ядро колонии, снос/понижение запрещены.
  if (buildingDef.id === 'colony_hub') return false;

  // Уровень 1: понижение = снос (полное освобождение гекса/слота).
  if (cell.buildingLevel === 1) {
    return demolishBuilding(planet, layer, index);
  }

  // Возврат 50% стоимости текущего уровня L (стоимость уровня L = base × (L-1)).
  const levelCostMult = cell.buildingLevel - 1;
  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    const refund = Math.floor(baseAmount * levelCostMult * DEMOLITION_REFUND_SHARE);
    if (refund > 0) {
      planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + refund;
    }
  }

  cell.buildingLevel--;
  recalcEnergyBalance(planet);
  gameBus.emit('economy:building-downgraded', {
    planetId: planet.id,
    hexIndex: reportIndex,
    level: cell.buildingLevel,
  });
  return true;
}

/**
 * Снести здание полностью (R-DEMOLISH) — освобождает гекс/слот.
 *
 * Возврат: 50% суммарных вложенных ресурсов. Модель стоимости
 * (симметрична buildOnHex/upgradeBuilding): уровень 1 = base × 1,
 * уровень i (i ≥ 2) = base × (i−1) → суммарно до уровня L:
 *   base × (1 + L(L−1)/2).
 *
 * Специализация/активные рецепты экземпляра сбрасываются.
 * Колониальный хаб снести нельзя. Энергобаланс пересчитывается.
 */
export function demolishBuilding(
  planet: Planet,
  layer: BuildingLayer,
  index: number,
): boolean {
  const ref = getBuildingCell(planet, layer, index);
  if (!ref) return false;
  const { cell, reportIndex } = ref;
  if (!cell.buildingId || cell.buildingLevel < 1) return false;

  const buildingDef = BUILDING_MAP.get(cell.buildingId);
  if (!buildingDef) return false;
  if (buildingDef.id === 'colony_hub') return false;

  const removedId = cell.buildingId;
  const level = cell.buildingLevel;

  // Возврат 50% суммарных вложений (см. докблок выше).
  const totalInvestedMult = 1 + (level * (level - 1)) / 2;
  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    const refund = Math.floor(baseAmount * totalInvestedMult * DEMOLITION_REFUND_SHARE);
    if (refund > 0) {
      planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + refund;
    }
  }

  clearCellInstanceState(cell);
  recalcEnergyBalance(planet);
  gameBus.emit('economy:building-demolished', {
    planetId: planet.id,
    hexIndex: reportIndex,
    buildingId: removedId,
  });
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
 * с причиной `'manual'` — это ручная отмена со стороны игрока.
 *
 * Audit Pass 2 P1-5: раньше reason был `'insufficient_inputs'` (ближайшая
 * доступная причина из union type), что не позволяло UI/аналитике отличить
 * ручную отмену от системной авто-отмены из-за нехватки входных ресурсов.
 * Теперь в union type добавлен `'manual'` (events.ts) и используется здесь.
 * Авто-отмена из `processProductionQueue` (recipe_not_found,
 * insufficient_inputs в repeat-loop) оставлена как есть.
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
    reason: 'manual',
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
