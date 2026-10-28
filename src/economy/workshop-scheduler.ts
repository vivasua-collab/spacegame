/**
 * PROC-WORKSHOPS-01 (Issue #23): детерминированный планировщик цехов.
 *
 * Обслуживает ОЧЕРЕДИ цеховых processing-зданий (BuildingDef.usesWorkshops):
 *   - construction_materials_plant → пул «стройматериалы» (6 базовых R-27);
 *   - processor → пул «продвинутый» (прочие рецепты переработки).
 *
 * Пул = все цехи ВСЕХ экземпляров здания на планете (surface → atmosphere →
 * orbit, стабильный порядок). Пулы изолированы: задача одного пула никогда
 * не занимает цех другого типа (рецепты пула определяются recipe.buildingId).
 *
 * Контракт (docs/40-buildings.md §3.0.5 v3.0):
 *   1. Продвижение начатых партий — БЕЗ вытеснения (начатая партия не
 *      прерывается, в т.ч. для приоритета специалиста — «на следующей
 *      границе партии»).
 *   2. Назначение свободным цехам:
 *      a) специалист-приоритет: свободный специализированный цех забирает
 *         первую runnable-задачу своего профиля (player-FIFO, затем
 *         авто-кандидат R-27);
 *      b) общий FIFO: оставшиеся runnable-задачи — свободным обычным цехам
 *         и специалистам БЕЗ доступной задачи профиля (fallback: специалист
 *         временно работает как обычный, без второго штрафа);
 *      c) авто-кандидаты R-27 (только строительный пул): оставшиеся
 *         свободные цехи заполняются кандидатами Fe → Si → Al → C → Cu → Ti.
 *   3. Runnable-гейты при назначении: входы (для авто-кандидатов — над
 *      резервным полем склада), энергия ≥ per-tick, место под ВСЕ выходы.
 *      Недоступная задача не занимает цех и не блокирует доступные.
 *   4. Завершение: списание входов, начисление выходов (формулы по цеху-
 *      исполнителю), repeat → хвост пула, без repeat — удаление. Одна задача
 *      никогда не исполняется двумя цехами.
 *
 * Энергия: партия тратит recipe.energyCost / total за тик (внутритиковый
 * бюджет — последующие партии того же тика видят остаток; сброс в конце тика
 * делает recalcEnergyBalance).
 */

import type {
  Planet,
  ProductionQueue,
  ProductionItem,
  EntityId,
  WorkshopState,
  BuildingDef,
} from '@/core/types';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { BASE_CONSTRUCTION_RECIPE_IDS } from '@/data/auto-processing';
import { WORKSHOP_BUILDING_POOLS } from '@/data/workshop-specializations';
import { getProcessingSpeedMultiplier } from './adjacency';
import { canStoreResource, getWarehouseType } from '@/data/warehouse';
import { gameBus } from '@/core/typed-event-bus';

// ─── Ссылка на цех (instance + workshop) ─────────────────────────────────

/**
 * Ссылка на цех конкретного экземпляра цехового здания.
 * Порядок обхода детерминирован: surface (гексы по возрастанию) →
 * atmosphere → orbit; внутри экземпляра — цехи по номеру 1..L.
 */
export interface WorkshopRef {
  buildingId: string;
  /** Ключ экземпляра: hexIndex (>=0) | -1-i (атмосфера) | -100-i (орбита) */
  instanceKey: number;
  layer: 'surface' | 'atmosphere' | 'orbit';
  /** Номер цеха 1..L (= индекс в cell.workshops + 1) */
  workshopNumber: number;
  /** hexIndex для синергии (только surface; иначе -1) */
  hexIndex: number;
  cell: { buildingId: string | null; buildingLevel: number; workshops?: WorkshopState[] };
  workshop: WorkshopState;
}

/**
 * Собрать все цехи всех экземпляров цехового здания buildingId на планете
 * (детерминированный порядок). Нормализует массив workshops: длина обязана
 * равняться buildingLevel (guard от повреждённых/старых состояний — цехи
 * добираются обычными, лишние отбрасываются).
 */
export function collectWorkshops(planet: Planet, buildingId: string): WorkshopRef[] {
  const def = BUILDING_MAP.get(buildingId);
  if (!def?.usesWorkshops) return [];
  const refs: WorkshopRef[] = [];

  const pushFrom = (
    cell: WorkshopRef['cell'],
    layer: WorkshopRef['layer'],
    instanceKey: number,
    hexIndex: number,
  ): void => {
    if (cell.buildingId !== buildingId || cell.buildingLevel < 1) return;
    // Нормализация: ровно buildingLevel цехов (guard).
    if (!Array.isArray(cell.workshops) || cell.workshops.length !== cell.buildingLevel) {
      const normalized: WorkshopState[] = [];
      for (let i = 0; i < cell.buildingLevel; i++) {
        normalized.push(cell.workshops?.[i] ?? {});
      }
      cell.workshops = normalized;
    }
    cell.workshops.forEach((ws, i) => {
      refs.push({
        buildingId,
        instanceKey,
        layer,
        workshopNumber: i + 1,
        hexIndex,
        cell,
        workshop: ws,
      });
    });
  };

  planet.hexes.forEach((hex, i) => pushFrom(hex, 'surface', i, i));
  planet.atmosphericSlots.forEach((slot, i) => pushFrom(slot, 'atmosphere', -1 - i, -1));
  planet.orbitSlots.forEach((slot, i) => pushFrom(slot, 'orbit', -100 - i, -1));

  return refs;
}

// ─── Runnable-гейты (чистые; используются планировщиком и UI) ────────────

export type RunabilityReason =
  | 'ok'
  | 'recipe-not-found'
  | 'no-inputs'
  | 'no-energy'
  | 'no-output-space';

export interface RunabilityOptions {
  /** true → проверять входы НАД резервным полем склада (авто-кандидаты R-27) */
  aboveReserveFloor?: boolean;
}

/**
 * Проверить, может ли партия рецепта recipeId быть НАЧАТА сейчас:
 * есть входы (опционально — над резервным полем), энергия ≥ per-tick,
 * место под ВСЕ выходы партии вместе (типы склада делят общий объём).
 */
export function getRecipeRunability(
  planet: Planet,
  recipeId: string,
  options: RunabilityOptions = {},
): RunabilityReason {
  const recipe = RECIPE_MAP.get(recipeId);
  if (!recipe) return 'recipe-not-found';

  // Входы
  for (const [inputId, amount] of Object.entries(recipe.inputs)) {
    const stock = planet.resources[inputId] ?? 0;
    const floor = options.aboveReserveFloor
      ? planet.warehouse?.reserves[inputId]?.minimum ?? 0
      : 0;
    if (stock - floor < amount - 1e-9) return 'no-inputs';
  }

  // Энергия (per-tick стоимость партии)
  const perTickCost = recipe.energyCost / Math.max(1, recipe.time);
  if (recipe.energyCost > 0 && planet.energyBalance < perTickCost - 1e-9) {
    return 'no-energy';
  }

  // Место под ВСЕ выходы вместе (по типам склада)
  const desiredByType = new Map<string, number>();
  for (const [outputId, outputAmount] of Object.entries(recipe.outputs)) {
    if ((outputAmount ?? 0) <= 0) continue;
    const whType = getWarehouseType(outputId);
    const combined = (desiredByType.get(whType) ?? 0) + (outputAmount ?? 0);
    desiredByType.set(whType, combined);
    const storable = canStoreResource(planet, outputId, combined);
    if (storable < combined - 1e-9) return 'no-output-space';
  }

  return 'ok';
}

// ─── Выход партии по цеху-исполнителю ────────────────────────────────────

/**
 * Формулы выхода партии (docs/40-buildings.md §3.0 IMPLEMENTATION NOTE):
 *  - специалист на СОВПАДАЮЩЕМ рецепте: yieldMult = 1.0 × (1 + 0.02×(L−1)),
 *    purity = 0.92 + 0.0175×(L−1);
 *  - обычный цех / специалист на НЕсовпадающем: yieldMult = baseYield (0.75)
 *    × 1 (один рецепт на партию — штрафа мультирецепта нет),
 *    purity = basePurity (0.78). Второй штраф за несовпадение НЕ вводится.
 */
export function calculateWorkshopOutputMultiplier(
  building: BuildingDef,
  workshop: WorkshopState,
  recipeId: string,
): { yieldMult: number; purity: number } {
  if (
    workshop.specializationRecipeId !== undefined
    && workshop.specializationRecipeId === recipeId
  ) {
    const specLvl = Math.max(1, Math.min(5, workshop.specializationLevel ?? 1));
    const purityBonus = 1.0 + 0.02 * (specLvl - 1);
    const purity = 0.92 + 0.0175 * (specLvl - 1);
    return { yieldMult: 1.0 * purityBonus, purity };
  }
  return {
    yieldMult: building.baseYield ?? 0.75,
    purity: building.basePurity ?? 0.78,
  };
}

// ─── Исполнитель для UI (не сохраняемая привязка) ────────────────────────

/** Описание цеха-исполнителя для UI-бейджа. */
export interface WorkshopExecutorInfo {
  buildingId: string;
  instanceKey: number;
  layer: 'surface' | 'atmosphere' | 'orbit';
  workshopNumber: number;
}

/**
 * Найти цех, исполняющий элемент очереди queueItemId (lookup по всем
 * цеховым зданиям планеты). UI-хелпер: фактический исполнитель, не
 * редактируемая привязка (assignedTo удалён из модели).
 */
export function findWorkshopExecutor(
  planet: Planet,
  queueItemId: EntityId,
): WorkshopExecutorInfo | null {
  for (const buildingId of Object.keys(WORKSHOP_BUILDING_POOLS)) {
    for (const ref of collectWorkshops(planet, buildingId)) {
      if (ref.workshop.currentBatch?.queueItemId === queueItemId) {
        return {
          buildingId: ref.buildingId,
          instanceKey: ref.instanceKey,
          layer: ref.layer,
          workshopNumber: ref.workshopNumber,
        };
      }
    }
  }
  return null;
}

// ─── Тик пула ─────────────────────────────────────────────────────────────

/**
 * Один тик пула цехового здания buildingId на планете.
 * Вызывается из engine.processProductionQueue (диспетчер).
 */
export function runWorkshopPoolTick(
  planet: Planet,
  queues: Map<EntityId, ProductionQueue>,
  buildingId: string,
): void {
  const def = BUILDING_MAP.get(buildingId);
  if (!def?.usesWorkshops) return;

  const workshops = collectWorkshops(planet, buildingId);
  if (workshops.length === 0) return;

  const queue = queues.get(planet.id);
  const recipeOf = (recipeId: string) => RECIPE_MAP.get(recipeId);

  // Элементы очереди этого пула (FIFO = порядок в queue.items).
  const poolItems: ProductionItem[] = [];
  if (queue) {
    for (const item of queue.items) {
      if (recipeOf(item.recipeId)?.buildingId === buildingId) poolItems.push(item);
    }
  }

  // ── Фаза A: назначение свободным цехам (порядок §3.0.5) ──────────────
  // Выполняется ДО продвижения: партия, назначенная в этом тике, продвигается
  // этим же тиком (recipe.time тиков = recipe.time тиков стены).
  const executingIds = new Set<EntityId>();
  for (const ref of workshops) {
    if (ref.workshop.currentBatch?.queueItemId != null) {
      executingIds.add(ref.workshop.currentBatch.queueItemId);
    }
  }

  const free = workshops.filter((ref) => !ref.workshop.currentBatch);
  if (free.length > 0) {
    // Доступные (runnable) player-задачи, ещё не исполняемые другим цехом.
    const runnableItems: ProductionItem[] = [];
    for (const item of poolItems) {
      if (executingIds.has(item.id)) continue;
      if (getRecipeRunability(planet, item.recipeId) === 'ok') runnableItems.push(item);
    }
    const claimed = new Set<string>();

    // A1: специалист-приоритет — профильная runnable-задача (player-FIFO),
    // затем профильный авто-кандидат (только строительный пул).
    const stillFree: WorkshopRef[] = [];
    for (const ref of free) {
      const profile = ref.workshop.specializationRecipeId;
      if (profile === undefined) {
        stillFree.push(ref);
        continue;
      }
      let assigned = false;
      for (const item of runnableItems) {
        if (claimed.has(item.id)) continue;
        if (item.recipeId === profile) {
          startPlayerBatch(planet.id, ref, item);
          claimed.add(item.id);
          assigned = true;
          break;
        }
      }
      if (!assigned && buildingId === 'construction_materials_plant') {
        if (autoCandidateRunnable(planet, profile)) {
          startAutoBatch(planet.id, ref, profile);
          assigned = true;
        }
      }
      if (!assigned) stillFree.push(ref);
    }

    // A2: общий FIFO — оставшиеся runnable-задачи свободным цехам
    // (обычные + специалисты без доступной профильной задачи).
    const remaining = runnableItems.filter((it) => !claimed.has(it.id));
    const n = Math.min(stillFree.length, remaining.length);
    for (let i = 0; i < n; i++) {
      const ref = stillFree[i];
      const item = remaining[i];
      if (ref && item) startPlayerBatch(planet.id, ref, item);
    }
    const freeAfterFifo = stillFree.slice(n);

    // A3: авто-кандидаты R-27 — только строительный пул; порядок
    // Fe → Si → Al → C → Cu → Ti; по одной партии на свободный цех.
    if (buildingId === 'construction_materials_plant') {
      for (const ref of freeAfterFifo) {
        for (const recipeId of BASE_CONSTRUCTION_RECIPE_IDS) {
          if (autoCandidateRunnable(planet, recipeId)) {
            startAutoBatch(planet.id, ref, recipeId);
            break;
          }
        }
      }
    }
  }

  // ── Фаза B: продвижение партий (без вытеснения) ──────────────────────
  for (const ref of workshops) {
    const batch = ref.workshop.currentBatch;
    if (!batch) continue;
    const recipe = recipeOf(batch.recipeId);
    if (!recipe) {
      // Рецепт исчез из каталога — партия снимается молча.
      ref.workshop.currentBatch = undefined;
      continue;
    }

    // Синергия скорости — только surface-гексы (смежность).
    const synergyMult = ref.layer === 'surface' && ref.hexIndex >= 0
      ? getProcessingSpeedMultiplier(planet, ref.hexIndex)
      : 1;

    // Энергия: per-tick стоимость; при нехватке партия стоит (цех удерживается).
    const perTickCost = recipe.energyCost / Math.max(1, batch.total);
    if (recipe.energyCost > 0 && planet.energyBalance < perTickCost - 1e-9) {
      syncItemProgress(queue, batch);
      continue;
    }

    batch.progress -= synergyMult;
    if (recipe.energyCost > 0) {
      planet.energyBalance -= perTickCost;
    }
    syncItemProgress(queue, batch);

    if (batch.progress > 0) continue;

    // ── Завершение партии ────────────────────────────────────────────
    const canConsume = Object.entries(recipe.inputs).every(
      ([rid, amount]) => (planet.resources[rid] ?? 0) >= amount - 1e-9,
    );
    if (!canConsume) {
      // Входы исчезли к моменту завершения (параллельная партия забрала):
      // player-партия стоит на progress=0, удерживая цех, до появления
      // входов; авто-партия снимается (заказа нет — нечего сохранять).
      if (batch.queueItemId == null) {
        ref.workshop.currentBatch = undefined;
      } else {
        batch.progress = 0;
        syncItemProgress(queue, batch);
      }
      continue;
    }

    // Списание входов
    for (const [rid, amount] of Object.entries(recipe.inputs)) {
      const left = (planet.resources[rid] ?? 0) - amount;
      if (left > 1e-9) planet.resources[rid] = left;
      else delete planet.resources[rid];
    }

    // Начисление выходов по цеху-исполнителю (средневзвешенная чистота).
    const { yieldMult, purity } = calculateWorkshopOutputMultiplier(def, ref.workshop, recipe.id);
    if (!planet.resourcePurity) planet.resourcePurity = {};
    for (const [rid, amount] of Object.entries(recipe.outputs)) {
      const produced = (amount ?? 0) * yieldMult;
      if (produced <= 0) continue;
      const prevAmount = planet.resources[rid] ?? 0;
      const prevPurity = planet.resourcePurity[rid] ?? 1.0;
      const newTotal = prevAmount + produced;
      planet.resources[rid] = newTotal;
      planet.resourcePurity[rid] = newTotal > 0
        ? (prevPurity * prevAmount + purity * produced) / newTotal
        : purity;
    }

    gameBus.emit('economy:production-complete', { planetId: planet.id, recipeId: recipe.id });

    // Пост-обработка player-элемента: repeat → хвост пула, иначе — удалить.
    if (batch.queueItemId != null && queue) {
      const idx = queue.items.findIndex((it) => it.id === batch.queueItemId);
      if (idx >= 0) {
        const [item] = queue.items.splice(idx, 1);
        if (item?.repeat) {
          item.progress = item.total;
          queue.items.push(item); // хвост общего FIFO-пула (ротация)
        }
      }
    }
    ref.workshop.currentBatch = undefined;
  }
}

// ─── Внутренние хелперы ───────────────────────────────────────────────────

/** Авто-кандидат R-27 runnable: входы над резервным полем + энергия + место. */
function autoCandidateRunnable(planet: Planet, recipeId: string): boolean {
  return getRecipeRunability(planet, recipeId, { aboveReserveFloor: true }) === 'ok';
}

/** Начать player-партию на цехе (прогресс берётся из элемента очереди). */
function startPlayerBatch(planetId: EntityId, ref: WorkshopRef, item: ProductionItem): void {
  ref.workshop.currentBatch = {
    queueItemId: item.id,
    recipeId: item.recipeId,
    progress: item.progress,
    total: item.total,
  };
  gameBus.emit('economy:workshop-batch-started', {
    planetId,
    buildingId: ref.buildingId,
    hexIndex: ref.instanceKey,
    workshopNumber: ref.workshopNumber,
    recipeId: item.recipeId,
    queueItemId: item.id,
  });
}

/** Начать системную авто-партию R-27 (без элемента очереди). */
function startAutoBatch(planetId: EntityId, ref: WorkshopRef, recipeId: string): void {
  const recipe = RECIPE_MAP.get(recipeId);
  if (!recipe) return;
  ref.workshop.currentBatch = {
    queueItemId: null,
    recipeId,
    progress: recipe.time,
    total: recipe.time,
  };
  gameBus.emit('economy:workshop-batch-started', {
    planetId,
    buildingId: ref.buildingId,
    hexIndex: ref.instanceKey,
    workshopNumber: ref.workshopNumber,
    recipeId,
    queueItemId: null,
  });
}

/** Синхронизировать прогресс player-партии обратно в элемент очереди. */
function syncItemProgress(
  queue: ProductionQueue | undefined,
  batch: { queueItemId: EntityId | null; progress: number },
): void {
  if (batch.queueItemId == null || !queue) return;
  const item = queue.items.find((it) => it.id === batch.queueItemId);
  if (item) item.progress = batch.progress;
}
