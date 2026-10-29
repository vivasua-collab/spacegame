/**
 * Экономический движок — производство, крафт, энергия.
 * P1-26: Солнечная станция учитывает светимость звезды.
 * P1-27: Газовый экстрактор проверяет наличие атмосферы.
 */

import type { Planet, HexCell, AtmosphericSlot, OrbitalSlot, BuildingLayer, ProductionQueue, ProductionItem, EntityId, StarSystem, BuildingDef, ProcessorType, ProcessorRecipeCategory, WorkshopState } from '@/core/types';
import { BUILDING_MAP, areBuildingTechsMet } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { canStoreResource, calculateWarehouseCapacities, getOrbitBufferCapacity, ensureReservesForResources } from '@/data/warehouse';
import { DIRECT_GAS_MAP, getAtmosphericGasesForType } from '@/data/atmosphere-gases';
import { getCurrentLookups, hasCurrentLookups } from '@/data/baked-lookups';
import { GEOLOGICAL_ACTIVITY_BONUS } from '@/data/planet-types'; // R-40: §2.4 40-buildings
import { isRecipeAllowedForBuildingPool } from '@/data/workshop-specializations';
import { resolveProcessorCategory } from '@/data/processor-recipe-categories';
import { WATER_DEPOSIT_ID } from '@/galaxy/generate-resources'; // ORE-POOLS: водный пул (H2O-ice)
import { distributeMiningBudget, type PoolCandidate, type MiningSchedulerContext } from '@/economy/mining-scheduler';
import { gameBus } from '@/core/typed-event-bus';
import { getEnergyConsumptionMultiplier, getEnergyGenerationMultiplier, getMiningSpeedMultiplier, getProcessingSpeedMultiplier } from '@/economy/adjacency';
import { runWorkshopPoolTick, createPoolReservations } from '@/economy/workshop-scheduler';

/** Цеховые здания (usesWorkshops) — их очереди обслуживает планировщик пулов. */
const WORKSHOP_BUILDING_IDS = ['construction_materials_plant', 'processor'] as const;

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
 * R-31 (audit): восстановить счётчик ProductionItem IDs из загруженных очередей.
 *
 * Вызывать после loadGame вместо resetProductionItemCounter(): загруженный сейв
 * содержит элементы с id `prod_<planetId>_<0..N>`; сброс счётчика в 0 порождал
 * бы коллизии (cancelProduction удаляет по ПЕРВОМУ совпадению id — была бы
 * отменена старая задача вместо новой; дубли React-ключей в очереди).
 * Счётчик выставляется на max(числовой суффикс)+1 — новые ID гарантированно
 * не пересекаются с существующими.
 */
export function restoreProductionItemCounter(queues: Map<EntityId, ProductionQueue>): void {
  let max = -1;
  for (const queue of queues.values()) {
    for (const item of queue.items) {
      const m = /_(\d+)$/.exec(item.id);
      const suffix = m?.[1];
      if (suffix !== undefined) {
        const n = parseInt(suffix, 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
    }
  }
  productionItemCounter = max + 1;
}

/**
 * Обработка одного тика экономики для всех планет.
 */
export function processEconomyTick(planets: Planet[], queues: Map<EntityId, ProductionQueue>, systemMap?: Map<EntityId, StarSystem>): void {
  for (const planet of planets) {
    // 1. Добыча ресурсов зданиями
    processExtraction(planet);

    // 2. Очереди производства: цеховые здания (processor /
    //    construction_materials_plant) — детерминированный планировщик пулов
    //    (внутри — авто-кандидаты R-27 строительного пула, PROC-WORKSHOPS-01;
    //    прежний отдельный шаг processAutoProcessing удалён — второй
    //    исполнительной дороги больше нет); прочие здания — карусель R-26.
    processProductionQueue(planet, queues);

    // 3. Расчёт энергетического баланса (статический нетто: генерация −
    //    потребление зданий; внутритиковые траты партий сбрасываются —
    //    следующий тик снова начинает со статического бюджета)
    const system = systemMap?.get(planet.systemId);
    recalcEnergyBalance(planet, system);

    // 4. Автоматическое создание резервов для новых ресурсов
    ensureReservesForResources(planet);
  }
}

/**
 * Добыча ресурсов зданиями на планете (ORE-POOLS-RUNTIME-01 / Issue #25).
 * P1-27: Газовый экстрактор требует атмосферу.
 * Руды и соединения кладутся на склад как сырьё —
 * переработка происходит через рецептурную систему (recipes.ts).
 *
 * Роли добывающих зданий по data-driven контракту источников
 * (docs/40-buildings.md §2 + BakedOre.sourceBuildingId, docs/34-ores.md §3.8):
 *   - mine (шахта) — МЕТАЛЛИЧЕСКИЕ руды (sourceBuildingId='mine');
 *   - quarry (карьер) — НЕМЕТАЛЛИЧЕСКИЕ ресурсы (sourceBuildingId='quarry');
 *   - gas_extractor (газовый экстрактор) — АТМОСФЕРНЫЕ ГАЗЫ (на поверхности
 *     и в атмосферном слоте — из атмосферы планеты, НЕ из планетарных
 *     рудных пулов, docs/31 §9.3);
 *   - drilling_rig (буровая установка) — ГЛУБИННЫЕ руды
 *     (sourceBuildingId='drilling_rig'). R-36: пулы RARE (Be) и ULTRA_RARE
 *     (Ir,Os,Re,Ru,Rh,Pd,Hf,Ta,Nb,Zr) добываемы; порог —
 *     BakedOre.minSourceLevel (уровень здания ≥ порога руды);
 *   - вода H2O-ice — добывается и шахтой, и карьером (R-27: единственный
 *     коровой пул-источник H/O, ice_harvester post-MVP — process_H2O).
 *
 * ORE-POOLS-DOCS-01 (единый бюджет, docs/31 §7.2 / docs/40 §11.2): каждое
 * геологическое добывающее здание имеет РОВНО ОДИН суммарный бюджет за тик:
 *   budget = baseRate(1.0) × levelMult × terrainMult × synergyMult
 *            (× geologicalMult — только буровая, ровно один раз).
 * Распределение бюджета между совместимыми пулами планеты — детерминированный
 * планировщик distributeMiningBudget (минимумы → пропорциональный излишек,
 * src/economy/mining-scheduler.ts, docs/35 §2.7). Число видов руды НЕ
 * умножает выпуск; availability — вес доли, а не множитель бюджета.
 * Добыча ведётся из планетарных пулов (Planet.orePools) — привязка залежи
 * к гексу выведена из модели; положение здания влияет только на terrain
 * bonus и синергию.
 */
function processExtraction(planet: Planet): void {
  // Контекст планировщика: единые для всех зданий планеты чтение состояния
  // и применение добычи — несколько зданий расходуют ОДИН остаток пулов
  // (sum(extracted по всем зданиям) ≤ исходного remainingQuantity).
  const poolByOre = new Map(planet.orePools.map((p) => [p.oreId, p]));
  const ctx: MiningSchedulerContext = {
    remaining: (oreId) => poolByOre.get(oreId)?.remainingQuantity ?? 0,
    stock: (oreId) => planet.resources[oreId] ?? 0,
    tryExtract: (oreId, amount) => {
      const pool = poolByOre.get(oreId);
      if (!pool || !(amount > 0)) return 0;
      const requested = Math.min(amount, pool.remainingQuantity);
      if (!(requested > 0)) return 0;
      // Защита от потери добытого при полном складе (контракт P1-1/P2-1):
      // из пула вычитается только реально помещённый объём — непомещённое
      // сырьё НЕ расходует месторождение (docs/31 §7.2.5).
      const storable = canStoreResource(planet, oreId, requested);
      const actual = Math.min(requested, storable);
      if (!(actual > 0)) return 0;
      pool.remainingQuantity -= actual;
      if (pool.remainingQuantity < 0) pool.remainingQuantity = 0;
      // Кладём руду на склад как сырьё (переработка через рецепты)
      planet.resources[oreId] = (planet.resources[oreId] ?? 0) + actual;
      return actual;
    },
  };

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
      if (buildingDef.id === 'gas_extractor') {
        // G-01 (fix): газовый экстрактор на ПОВЕРХНОСТИ добывает атмосферу
        // (та же логика, что и в атмосферном слоте газового гиганта), а не
        // планетарные рудные пулы. Формула docs/40 §2.3: уровень ×
        // эффективность атмосферы (бонус местности не применяется —
        // у экстрактора его нет).
        extractAtmosphericGases(planet, hex.buildingLevel, getMiningSpeedMultiplier(planet, i));
      } else {
        // Единый бюджет здания за тик (docs/40 §11.2) — рассчитывается
        // ОДИН раз на здание из существующих множителей.
        const levelMult = 1 + hex.buildingLevel * 0.15;
        const terrainMult = hex.terrain in (buildingDef.terrainBonus ?? {})
          ? (buildingDef.terrainBonus as Record<string, number>)[hex.terrain] ?? 1
          : 1;
        // R-SYNERGY v2 mining_cluster (Задача 24): экстракторы одного
        // подтипа ускоряют добычу друг друга (+10% за смежного, стекинг
        // ×0.5^(n−1)) — бонус СКОРОСТИ ДОБЫЧИ внутри бюджета здания.
        const miningMult = getMiningSpeedMultiplier(planet, i);

        // R-40 (docs/40 §2.4): бонус геологической активности планеты —
        // ТОЛЬКО для буровой, по ТИПУ планеты, РОВНО ОДИН РАЗ; terrainMult
        // каталога и синергия mining_cluster НЕ удваиваются. У остальных
        // добытчиков (mine/quarry) множителя нет.
        const geologicalMult = buildingDef.id === 'drilling_rig'
          ? (GEOLOGICAL_ACTIVITY_BONUS[planet.type] ?? 1)
          : 1;

        const budget = 1.0 * levelMult * terrainMult * miningMult * geologicalMult;
        const candidates = collectPoolCandidates(planet, buildingDef.id, hex.buildingLevel);
        distributeMiningBudget(budget, candidates, ctx);
      }
    }

    // Colony hub: малая пассивная добыча поверхностных пулов (mine ∪ quarry,
    // вкл. воду) по ОБЩЕПЛАНЕТАРНОМУ пулу — ORE-POOLS-DOCS-01: локальная
    // добыча «только под своим гексом» отменена (docs/40 §2.7). Ориентир —
    // 50% базовой скорости шахты (0.5) с текущим множителем уровня хаба
    // (1+ур.×0.1); без terrain-бонусов и синергии; глубинные руды и
    // атмосферные газы хаб не добывает. Здание на любом гексе не блокируется
    // отсутствием локального депозита.
    if (buildingDef.id === 'colony_hub') {
      const levelMult = 1 + hex.buildingLevel * 0.1;
      const budget = 0.5 * levelMult;
      const candidates = collectPoolCandidates(planet, 'colony_hub', hex.buildingLevel);
      distributeMiningBudget(budget, candidates, ctx);
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
      // Слоты не имеют смежности — синергия mining_cluster не применяется
      extractAtmosphericGases(planet, slot.buildingLevel);
    }
  }

  // Автоматическая конвертация чистых газов (не требующих переработки)
  // H2→H, N2→N, O2→O, He→He, Ne→Ne, Ar→Ar — 1:1 прямое преобразование
  convertDirectAtmosphericElements(planet);
}

/**
 * Кандидаты планировщика добычи для здания (ORE-POOLS-DOCS-01, docs/35 §2.7.1):
 * совместимые, неистощённые пулы планеты, разрешённые data-driven контрактом
 * источника (BakedOre.sourceBuildingId / minSourceLevel — единый источник
 * истины ролей, docs/34 §3.8).
 *
 * Гейты роли:
 *   - mine/quarry/drilling_rig — canMineDeposit (роль руды + порог уровня);
 *   - colony_hub — isSurfaceMinable (mine ∪ quarry ∪ вода; пороги
 *     поверхностных руд = 1; глубинные руды/газы хабу недоступны).
 *
 * Минимум/приоритет кандидата — существующие резервы склада
 * (WarehouseReserve.minimum/priority; выполнение минимума считается по
 * складскому запасу, docs/35 §1.4). Кандидаты сортируются по oreId —
 * детерминизм планировщика не зависит от порядка пулов в состоянии.
 */
function collectPoolCandidates(planet: Planet, buildingId: string, buildingLevel: number): PoolCandidate[] {
  const reserves = planet.warehouse?.reserves ?? {};
  const candidates: PoolCandidate[] = [];
  for (const pool of planet.orePools) {
    if (pool.remainingQuantity <= 0) continue;
    const ok = buildingId === 'colony_hub'
      ? isSurfaceMinable(pool.oreId)
      : canMineDeposit(buildingId, pool.oreId, buildingLevel);
    if (!ok) continue;
    const reserve = reserves[pool.oreId];
    candidates.push({
      oreId: pool.oreId,
      availability: pool.availability,
      minimum: reserve?.minimum ?? 0,
      priority: reserve?.priority ?? 0,
    });
  }
  candidates.sort((a, b) => (a.oreId < b.oreId ? -1 : a.oreId > b.oreId ? 1 : 0));
  return candidates;
}

/**
 * G-01 (Task 37): может ли поверхностное добывающее здание buildingId
 * (mine/quarry/drilling_rig) добыть залежь resourceId? Роль залежи берётся из
 * запечённой хим.модели (BakedOre.sourceBuildingId — единый источник
 * истины, автогенерация docs/33-chemistry.md).
 *
 * R-36: buildingLevel (опционально, по умолчанию Infinity — без ограничения)
 * включает порог ГЛУБИНЫ BakedOre.minSourceLevel (docs/40 §2.4: «каждый
 * уровень буровой открывает большую глубину»; данные уже были в хим.модели:
 * Re-ore=8, Rh/Ta/Pd/Dy=6, большинство deep_ore=5, Y=2, Ba=1; у всех
 * mine/quarry-руд порог = 1 — фиксируется тестом). Colony hub вызывает
 * isSurfaceMinable БЕЗ уровня: его роль — базовые поверхностные руды
 * (пороги 1), глубинные руды ему недоступны по роли.
 */
function canMineDeposit(buildingId: string, resourceId: string, buildingLevel: number = Number.POSITIVE_INFINITY): boolean {
  if (!hasCurrentLookups()) return true; // нет baked-модели — легаси-поведение
  const lookups = getCurrentLookups();

  // Руда с известной ролью: добытчик должен совпадать (mine/quarry/drilling_rig)
  // и здание должно достигать глубины залежи (minSourceLevel, R-36).
  const ore = lookups.oreMap.get(resourceId);
  if (ore) return ore.sourceBuildingId === buildingId && buildingLevel >= ore.minSourceLevel;

  // R-27: вода (H2O-ice) — единственная залежь-источник H и O; добывается
  // и шахтой, и карьером (ice_harvester — post-MVP, docs/40-buildings §2.5).
  if (resourceId === WATER_DEPOSIT_ID) return buildingId === 'mine' || buildingId === 'quarry';

  // Прочие льды (CO2-ice, N2-ice, CH4-ice, NH3-ice) — ice_harvester (post-MVP):
  // в залежах не генерируются; добывать их поверхностные добытчики не могут.
  if (lookups.iceMap.has(resourceId)) return false;

  // Атмосферные соединения — источник газового экстрактора (атмосфера), не рудник.
  if (lookups.atmosphericMap.has(resourceId)) return false;

  // Неизвестный ID (fallback «<элемент>-ore» для трансурановых без руды в
  // хим.модели) — считаем обычной породой: доступен базовым добытчикам.
  return true;
}

/**
 * G-01 (Task 37): залежь доступна БАЗОВОЙ поверхностной добыче
 * (шахта ∪ карьер)? Используется колониальным хабом («базовая добыча
 * ресурсов»): металл + неметалл + вода; без глубинных руд и газов.
 */
function isSurfaceMinable(resourceId: string): boolean {
  return canMineDeposit('mine', resourceId) || canMineDeposit('quarry', resourceId);
}

/**
 * G-01 (Task 37): добыча атмосферных газов газовым экстрактором — единая
 * логика для поверхностной установки (обычные планеты) и атмосферного
 * слота (газовые гиганты, P1-01). Газы — по ATMOSPHERE_GAS_MAP
 * (docs/30-planets §2.4 / docs/31-resources §9.1), эффективность — по
 * типу атмосферы (газовый гигант = 1.0).
 */
function extractAtmosphericGases(planet: Planet, buildingLevel: number, speedMult = 1): void {
  const levelMult = 1 + buildingLevel * 0.15;
  const atmosphereMult = planet.type === 'gas_giant' ? 1.0 : getAtmosphereEfficiency(planet.atmosphere.type);

  // Получаем список доступных газов для данного типа атмосферы
  const availableGases = getAtmosphericGasesForType(planet.atmosphere.type);
  for (const gasId of availableGases) {
    const baseRate = 2.0 * levelMult * atmosphereMult * speedMult;
    const canStore = canStoreResource(planet, gasId, baseRate);
    if (canStore > 0) {
      planet.resources[gasId] = (planet.resources[gasId] ?? 0) + canStore;
    }
  }
}

/** Конвертация чистых атмосферных газов в элементы (1:1, переработка не нужна) */
function convertDirectAtmosphericElements(planet: Planet): void {
  for (const [gasId, elementId] of Object.entries(DIRECT_GAS_MAP)) {
    // Task 37 (fix): тождественные маппинги (He→He, Ne→Ne, Ar→Ar) — газ УЖЕ
    // является элементом, конвертировать нечего. Раньше ветка добавляла
    // actual к resources[elementId], а затем перезаписывала resources[gasId]
    // = gasAmount − actual (тот же ключ!) — весь добытый He/Ne/Ar аннигилировал.
    if (gasId === elementId) continue;
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
 */
/**
 * R-26 (баги 3–4): карусель производства с параллелизмом.
 *
 * Одновременно работает столько задач, сколько экземпляров здания
 * (recipe.buildingId) построено на планете. Назначение задач на экземпляры
 * (выбран вариант 1 — «приоритет специализации в общей карусели», как
 * наименее багоопасный: без смены схемы сейва и без отдельного UI):
 *
 *   1) Приоритет специализации — специализированный переработчик в первую
 *      очередь берёт задачи СВОЕЙ категории рецептов (в порядке очереди),
 *      правило карусели для него отменяется. Специализированный экземпляр
 *      берёт ТОЛЬКО задачи своей категории — если их нет, он простаивает.
 *   2) Липкое назначение — задача в процессе выполнения остаётся на своём
 *      экземпляре (стабильность множителя выхода и прогресс-бара).
 *   3) Карусель — оставшиеся задачи раздаются свободным универсальным
 *      экземплярам в порядке очереди (FIFO): 2 переработчика + 3 задачи →
 *      работают 2, третья ждёт освобождения слота.
 *
 * Автоповтор занимает свой слот постоянно: задача остаётся в очереди и
 * каждый тик продолжается назначенным экземпляром. Два автоповтора при
 * двух переработчиках работают одновременно (баг 3 исправлен).
 */
/**
 * PROC-WORKSHOPS-01: обработка очередей производства планеты — ДИСПЕТЧЕР.
 *
 * Элементы группируются по recipe.buildingId:
 *   - цеховые здания (usesWorkshops: processor, construction_materials_plant)
 *     → детерминированный планировщик пулов (runWorkshopPoolTick; внутри —
 *     специалист-приоритет, общий FIFO, авто-кандидаты R-27 строительного
 *     пула, ротация repeat; docs/40-buildings.md §3.0.5);
 *   - прочие здания (refinery / synthesizer / заводы) → прежняя карусель
 *     R-26 (assignQueueTasks — spec-priority/sticky/carousel по экземплярам).
 *
 * Пулы изолированы: задача цехового пула никогда не попадает в карусель и
 * наоборот (группировка по buildingId рецепта).
 */
function processProductionQueue(planet: Planet, queues: Map<EntityId, ProductionQueue>): void {
  const queue = queues.get(planet.id);

  // Группировка элементов по зданию рецепта (порядок групп = порядок первого
  // появления — детерминированно).
  const itemsByBuilding = new Map<string, ProductionItem[]>();
  if (queue) {
    for (const item of queue.items) {
      const recipe = RECIPE_MAP.get(item.recipeId);
      if (!recipe) continue; // recipe_not_found обрабатывается ниже
      const group = itemsByBuilding.get(recipe.buildingId);
      if (group) group.push(item);
      else itemsByBuilding.set(recipe.buildingId, [item]);
    }
  }

  // 1. Цеховые здания → планировщик пулов. Один аккумулятор броней на тик
  //    на планету (P1-1/P1-2, §3.0.5 v3.0.1): оба пула видят входы/энергию/
  //    место под выходы, занятые партиями другого пула.
  const sharedReservations = createPoolReservations(planet);
  for (const buildingId of WORKSHOP_BUILDING_IDS) {
    runWorkshopPoolTick(planet, queues, buildingId, sharedReservations);
  }

  // 2. Прочие здания → карусель R-26 (по группам).
  const legacyItems: ProductionItem[] = [];
  for (const [buildingId, group] of itemsByBuilding) {
    if ((WORKSHOP_BUILDING_IDS as readonly string[]).includes(buildingId)) continue;
    legacyItems.push(...group);
  }

  if (legacyItems.length === 0) {
    // R-31 (audit): пустая очередь — сбросить фантомные activeRecipes
    // УСТАРЕВШИХ категорийных экземпляров (refinery/synthesizer; цеховым
    // зданиям поле не принадлежит).
    for (const hex of planet.hexes) {
      if (hex.activeRecipes?.length) hex.activeRecipes = [];
    }
    for (const slot of planet.atmosphericSlots) {
      if (slot.activeRecipes?.length) slot.activeRecipes = [];
    }
    for (const slot of planet.orbitSlots) {
      if (slot.activeRecipes?.length) slot.activeRecipes = [];
    }
    return;
  }

  // recipe_not_found: рецепты, исчезнувшие из каталога (по всем пулам).
  if (queue) {
    for (let i = queue.items.length - 1; i >= 0; i--) {
      const item = queue.items[i];
      if (!item) continue;
      if (RECIPE_MAP.has(item.recipeId)) continue;
      gameBus.emit('economy:production-cancelled', {
        planetId: planet.id,
        recipeId: item.recipeId,
        queueItemId: item.id,
        reason: 'recipe_not_found',
      });
      queue.items.splice(i, 1);
    }
  }

  // 1. Назначить задачи на экземпляры зданий (spec-priority → sticky → carousel).
  const assignments = assignQueueTasks(planet, legacyItems);

  // 2. Прогресс каждой назначенной задачи (параллельно).
  for (const { item, instance } of assignments) {
    const recipe = RECIPE_MAP.get(item.recipeId);
    if (!recipe) continue; // уже обработано выше

    // P3-02: проверяем энергобаланс по стоимости за тик, а не по полной стоимости рецепта
    const perTickCost = recipe.energyCost / item.total;
    if (recipe.energyCost > 0 && planet.energyBalance < perTickCost) {
      continue; // нет энергии — задача ждёт, слот не освобождается
    }

    // ─── R-SYNERGY §processing (интеграция в карусель R-26) ────────────
    const synergySpeedMult = instance.layer === 'surface' && instance.key >= 0
      ? getProcessingSpeedMultiplier(planet, instance.key)
      : 1;

    // Обновляем прогресс (R-SYNERGY: с множителем скорости).
    item.progress -= synergySpeedMult;

    // Тратим энергию (внутритиковый бюджет).
    if (recipe.energyCost > 0) {
      planet.energyBalance -= perTickCost;
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

        // ─── R-26: множитель выхода по НАЗНАЧЕННОМУ экземпляру ──────────
        const buildingDef = BUILDING_MAP.get(recipe.buildingId);
        let yieldMult = 1.0;
        let purity = 1.0;
        if (buildingDef?.isUniversalProcessor) {
          const result = calculateProcessorOutputMultiplier(buildingDef, instance);
          yieldMult = result.yieldMult;
          purity = result.purity;
        }

        // Применить множитель к выходам и записать чистоту (средневзвешенно).
        if (!planet.resourcePurity) planet.resourcePurity = {};
        for (const [resourceId, amount] of Object.entries(recipe.outputs)) {
          const producedAmount = amount * yieldMult;
          const prevAmount = planet.resources[resourceId] ?? 0;
          const prevPurity = planet.resourcePurity[resourceId] ?? 1.0;
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
        const idx = queue ? queue.items.indexOf(item) : -1;
        if (idx >= 0 && queue) queue.items.splice(idx, 1);
      }
    }
  }
}

// ─── R-26 (баги 3–4): экземпляры зданий-производственников ───────────────

/**
 * Ссылка на экземпляр здания-производственника на планете.
 *
 * key — стабильный идентификатор для UI и назначений:
 *   hexIndex       — гекс поверхности (>= 0);
 *   -1 - i         — атмосферный слот #i;
 *   -100 - i       — орбитальный слот #i
 * (та же конвенция, что и в hexIndex-событиях economy:building-constructed).
 *
 * cell — прямая ссылка на HexCell | AtmosphericSlot | OrbitalSlot в draft
 * (для записи activeRecipes по факту назначения задач).
 */
export interface ProcessorInstanceRef {
  buildingId: string;
  key: number;
  layer: 'surface' | 'atmosphere' | 'orbit';
  slotIndex: number;
  processorType: ProcessorType;
  specialization?: ProcessorRecipeCategory;
  specializationLevel: number;
  activeRecipes: string[];
  cell: {
    buildingId: string | null;
    buildingLevel: number;
    processorType?: ProcessorType;
    specialization?: ProcessorRecipeCategory;
    specializationLevel?: number;
    activeRecipes?: string[];
  };
}

/**
 * Собрать ВСЕ экземпляры здания buildingId на планете (поверхность +
 * атмосфера + орбита) с их процессорными полями. Для экземпляров без
 * явного processorType берутся дефолты из BuildingDef (processor →
 * universal; refinery/synthesizer → specialized с defaultSpecialization).
 */
export function collectProcessorInstances(planet: Planet, buildingId: string): ProcessorInstanceRef[] {
  const def = BUILDING_MAP.get(buildingId);
  const instances: ProcessorInstanceRef[] = [];

  const resolveType = (cell: ProcessorInstanceRef['cell']): Pick<ProcessorInstanceRef, 'processorType' | 'specialization' | 'specializationLevel'> => {
    if (cell.processorType !== undefined) {
      return {
        processorType: cell.processorType,
        specialization: cell.specialization,
        specializationLevel: cell.specializationLevel ?? 0,
      };
    }
    // Дефолты из BuildingDef (для зданий, построенных до инициализации полей)
    if (def?.defaultProcessorType === 'specialized') {
      return {
        processorType: 'specialized' as ProcessorType,
        specialization: def.defaultSpecialization,
        specializationLevel: 1,
      };
    }
    return { processorType: 'universal' as ProcessorType, specializationLevel: 0 };
  };

  planet.hexes.forEach((hex, i) => {
    if (hex.buildingId !== buildingId) return;
    instances.push({
      buildingId,
      key: i,
      layer: 'surface',
      slotIndex: i,
      activeRecipes: hex.activeRecipes ?? [],
      cell: hex,
      ...resolveType(hex),
    });
  });

  planet.atmosphericSlots.forEach((slot, i) => {
    if (slot.buildingId !== buildingId) return;
    instances.push({
      buildingId,
      key: -1 - i,
      layer: 'atmosphere',
      slotIndex: i,
      activeRecipes: slot.activeRecipes ?? [],
      cell: slot,
      ...resolveType(slot),
    });
  });

  planet.orbitSlots.forEach((slot, i) => {
    if (slot.buildingId !== buildingId) return;
    instances.push({
      buildingId,
      key: -100 - i,
      layer: 'orbit',
      slotIndex: i,
      activeRecipes: slot.activeRecipes ?? [],
      cell: slot,
      ...resolveType(slot),
    });
  });

  return instances;
}

/**
 * Назначить задачи очереди на экземпляры УСТАРЕВШИХ категорийных зданий
 * (R-26 карусель: refinery / synthesizer — PROC-WORKSHOPS-01 оставил её
 * только для предельных форм; цеховые здания обслуживает планировщик).
 *
 * Возвращает список «задача → экземпляр». Одновременно обрабатывается не
 * больше задач, чем экземпляров здания. Порядок назначения:
 *   1. Специализация — specialized экземпляр забирает первую в очереди
 *      задачу своей категории (carousel-правило для него отменено).
 *   2. Карусель — оставшиеся задачи (в порядке очереди) раздаются
 *      свободным универсальным экземплярам (surface → atmosphere → orbit).
 *
 * (Sticky-`assignedTo` удалён вместе с полем — PROC-WORKSHOPS-01.)
 *
 * Побочно обновляет cell.activeRecipes каждого задействованного экземпляра
 * списком назначенных рецептов (реальная картина для UI и мульти-рецептного
 * штрафа universal-процессора).
 */
function assignQueueTasks(
  planet: Planet,
  items: ProductionItem[],
): Array<{ item: ProductionItem; instance: ProcessorInstanceRef }> {
  // Группируем задачи по buildingId рецепта (у каждой группы — свои экземпляры).
  const itemsByBuilding = new Map<string, ProductionItem[]>();
  for (const item of items) {
    const recipe = RECIPE_MAP.get(item.recipeId);
    if (!recipe) continue; // recipe_not_found обрабатывается в processProductionQueue
    // Защита: цеховые здания обслуживает планировщик пулов — в карусель
    // их задачи не попадают (диспетчер их не передаёт; guard на будущее).
    if ((WORKSHOP_BUILDING_IDS as readonly string[]).includes(recipe.buildingId)) continue;
    const group = itemsByBuilding.get(recipe.buildingId);
    if (group) group.push(item);
    else itemsByBuilding.set(recipe.buildingId, [item]);
  }

  const assignments: Array<{ item: ProductionItem; instance: ProcessorInstanceRef }> = [];

  for (const [buildingId, groupItems] of itemsByBuilding) {
    const instances = collectProcessorInstances(planet, buildingId);
    if (instances.length === 0) continue; // здания нет — задачи стоят

    const free = new Set<ProcessorInstanceRef>(instances);
    const unassigned = new Set<ProductionItem>(groupItems);
    const assignedRecipes = new Map<ProcessorInstanceRef, Set<string>>();

    const assign = (item: ProductionItem, instance: ProcessorInstanceRef): void => {
      assignments.push({ item, instance });
      free.delete(instance);
      unassigned.delete(item);
      const recipes = assignedRecipes.get(instance) ?? new Set<string>();
      recipes.add(item.recipeId);
      assignedRecipes.set(instance, recipes);
    };

    // ── Pass 1: приоритет специализации ──────────────────────────────
    for (const instance of instances) {
      if (instance.processorType !== 'specialized' || !instance.specialization) continue;
      for (const item of groupItems) {
        if (!unassigned.has(item)) continue;
        const category = resolveProcessorCategory(item.recipeId, buildingId)?.category;
        if (category === instance.specialization) {
          assign(item, instance);
          break; // экземпляр занят одной задачей
        }
      }
    }

    // ── Pass 2: карусель — свободные задачи → свободные универсальные экземпляры ──
    const freeUniversal = [...free].filter((inst) => inst.processorType !== 'specialized');
    const remaining = groupItems.filter((item) => unassigned.has(item));
    const n = Math.min(freeUniversal.length, remaining.length);
    for (let i = 0; i < n; i++) {
      const item = remaining[i];
      const inst = freeUniversal[i];
      if (item && inst) assign(item, inst);
    }

    // Записать активные рецепты в ячейки зданий (реальная картина).
    // R-31 (audit): незадействованным экземплярам — сброс (иначе у простаивающих
    // переработчиков в диалоге висел фантомный «активный рецепт» из прошлых тиков).
    for (const [instance, recipes] of assignedRecipes) {
      instance.cell.activeRecipes = [...recipes];
    }
    for (const instance of instances) {
      if (!assignedRecipes.has(instance)) {
        instance.cell.activeRecipes = [];
      }
    }
  }

  return assignments;
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
    // Legacy totalCapacity — сумма всех 4 складов, включая газовый (R-31:
    // аудит нашёл, что после первой постройки итог «прыгал» с 12000 на
    // 10000 — газовый склад выпадал из знаменателя общего бара UI).
    planet.warehouse.totalCapacity = caps.ore + caps.processed + caps.highTech + caps.gas;
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

  // PROC-WORKSHOPS-01: цеховые здания — уровень 1 = один обычный цех.
  // Категорийные поля (processorType/...) — только для refinery/synthesizer.
  if (buildingDef.usesWorkshops) {
    hex.workshops = [{}];
  } else if (buildingDef.isUniversalProcessor) {
    hex.processorType = buildingDef.defaultProcessorType ?? 'universal';
    hex.specialization = buildingDef.defaultSpecialization;
    hex.specializationLevel = buildingDef.defaultProcessorType === 'specialized' ? 1 : 0;
    hex.activeRecipes = [];
  }

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

  // PROC-WORKSHOPS-01: цеховые здания — уровень 1 = один обычный цех.
  if (buildingDef.usesWorkshops) {
    slot.workshops = [{}];
  } else if (buildingDef.isUniversalProcessor) {
    slot.processorType = buildingDef.defaultProcessorType ?? 'universal';
    slot.specialization = buildingDef.defaultSpecialization;
    slot.specializationLevel = buildingDef.defaultProcessorType === 'specialized' ? 1 : 0;
    slot.activeRecipes = [];
  }

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

  // PROC-WORKSHOPS-01: цеховые здания — уровень 1 = один обычный цех.
  if (buildingDef.usesWorkshops) {
    slot.workshops = [{}];
  } else if (buildingDef.isUniversalProcessor) {
    slot.processorType = buildingDef.defaultProcessorType ?? 'universal';
    slot.specialization = buildingDef.defaultSpecialization;
    slot.specializationLevel = buildingDef.defaultProcessorType === 'specialized' ? 1 : 0;
    slot.activeRecipes = [];
  }

  recalcEnergyBalance(planet);
  gameBus.emit('economy:building-constructed', { planetId: planet.id, hexIndex: -100 - slotIndex, buildingId });
  return true;
}

/**
 * Улучшить здание на гексе.
 *
 * R-40: добавлен опциональный `researched` — requiresTechs-гейт действует
 * и на АПГРЕЙД (симметрично buildOnHex). Контракт гейта: существующие
 * здания при загрузке старых сейвов НЕ удаляются и продолжают работать,
 * но новые действия (постройка НОВОГО здания, апгрейд существующего)
 * отклоняются до изучения технологии. Если `researched` не передан —
 * гейт пропускается (backward-compat для тестов и прямых вызовов).
 * Уровни технологий не уменьшаются, поэтому для зданий, построенных ПОСЛЕ
 * гейта (synthesizer/refinery/drilling_rig), апгрейд всегда разрешён —
 * регрессии старых сейвов нет.
 */
export function upgradeBuilding(
  planet: Planet,
  hexIndex: number,
  researched?: Record<string, number>,
): boolean {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) return false;
  const hex = planet.hexes[hexIndex];
  if (!hex.buildingId) return false;

  const buildingDef = BUILDING_MAP.get(hex.buildingId);
  if (!buildingDef) return false;
  if (hex.buildingLevel >= buildingDef.levels) return false;

  // R-40: requiresTechs-гейт на апгрейд (та же семантика, что в buildOnHex).
  if (researched && !areBuildingTechsMet(buildingDef, researched)) {
    return false;
  }

  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    const amount = baseAmount * hex.buildingLevel;
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }

  for (const [resourceId, baseAmount] of Object.entries(buildingDef.costPerLevel)) {
    planet.resources[resourceId] -= baseAmount * hex.buildingLevel;
  }

  // PROC-WORKSHOPS-01: upgrade цехового здания добавляет обычный цех №L+1
  // (стабильная нумерация: существующие цехи не трогаются). Нормализация —
  // ДО инкремента уровня (guard в getCellWorkshops сверяет длину со СТАРЫМ
  // уровнем), добавление — после.
  const workshopsBefore = buildingDef.usesWorkshops ? getCellWorkshops(hex) : null;
  hex.buildingLevel++;
  workshopsBefore?.push({});

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
  cell.workshops = undefined; // PROC-WORKSHOPS-01
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
  queues?: Map<EntityId, ProductionQueue>,
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
    return demolishBuilding(planet, layer, index, queues);
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

  // PROC-WORKSHOPS-01: понижение удаляет именно цех №L (крайний). Его партия
  // возвращается в хвост FIFO-пула с сохранённым прогрессом; специализация
  // и вложения теряются безвозвратно (docs/40-buildings.md §3.0.4).
  if (buildingDef.usesWorkshops && cell.workshops) {
    const removed = cell.workshops.pop();
    requeueRemovedWorkshopBatches(planet, removed ? [removed] : [], queues);
  }

  recalcEnergyBalance(planet);
  gameBus.emit('economy:building-downgraded', {
    planetId: planet.id,
    hexIndex: reportIndex,
    level: cell.buildingLevel,
  });
  return true;
}

/**
 * PROC-WORKSHOPS-01: вернуть партии удалённых цехов в очередь.
 *
 * - player-партия: элемент остаётся в очереди (прогресс уже синхронизирован
 *   планировщиком) и ПЕРЕМЕЩАЕТСЯ В ХВОСТ общего FIFO (ротация пула) —
 *   заказ не пересоздаётся и не теряется;
 * - авто-партия R-27 (queueItemId === null): просто прекращается.
 */
function requeueRemovedWorkshopBatches(
  planet: Planet,
  removedWorkshops: WorkshopState[],
  queues?: Map<EntityId, ProductionQueue>,
): void {
  if (removedWorkshops.length === 0) return;
  const queue = queues?.get(planet.id);
  if (!queue) return;
  for (const ws of removedWorkshops) {
    const batch = ws.currentBatch;
    if (!batch || batch.queueItemId == null) continue; // авто-партия — drop
    const idx = queue.items.findIndex((it) => it.id === batch.queueItemId);
    if (idx >= 0) {
      const [item] = queue.items.splice(idx, 1);
      item.progress = batch.progress; // сохранённый оставшийся прогресс
      queue.items.push(item); // хвост FIFO-пула
    }
  }
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
  queues?: Map<EntityId, ProductionQueue>,
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

  // PROC-WORKSHOPS-01: партии всех цехов сносимого здания — в хвост FIFO
  // (player-партии с сохранённым прогрессом; авто-партии прекращаются).
  if (cell.workshops?.length) {
    requeueRemovedWorkshopBatches(planet, cell.workshops, queues);
  }

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

// ─── PROC-WORKSHOPS-01 (Issue #23): специализация ЦЕХОВ ──────────────────
//
// specializeWorkshop(planet, hexIndex, workshopNumber, recipeId)
//   Превратить обычный цех цехового здания (processor / plant) в
//   специализированный под конкретный recipeId. НЕОБРАТИМО: снять, сменить
//   рецепт или понизить уровень специализации нельзя. Цех должен быть
//   свободен (без текущей партии). Доступно с уровня здания 1.
//
// upgradeWorkshopSpecialization(planet, hexIndex, workshopNumber)
//   Поднять specializationLevel цеха 1→2→…→5. Стоимость =
//   upgradeSpecializationCost × specializationLevel (существующая механика).
//
// Эти функции мутируют cell.workshops напрямую (как buildOnHex/upgradeBuilding).
// События эмитируются через gameBus.

/**
 * Получить нормализованный массив цехов ячейки цехового здания.
 * Возвращает null, если ячейка — не цеховое здание. Guard: длина массива
 * обязана равняться buildingLevel (добирает/обрезает при повреждении).
 */
export function getCellWorkshops(cell: HexCell | AtmosphericSlot | OrbitalSlot): WorkshopState[] | null {
  const buildingId = cell.buildingId;
  if (!buildingId) return null;
  const def = BUILDING_MAP.get(buildingId);
  if (!def?.usesWorkshops || cell.buildingLevel < 1) return null;
  if (!Array.isArray(cell.workshops) || cell.workshops.length !== cell.buildingLevel) {
    const normalized: WorkshopState[] = [];
    for (let i = 0; i < cell.buildingLevel; i++) {
      normalized.push(cell.workshops?.[i] ?? {});
    }
    cell.workshops = normalized;
  }
  return cell.workshops;
}

/**
 * PROC-WORKSHOPS-01: специализировать ЦЕХ по конкретному recipeId.
 *
 * Проверки:
 * - Здание — цеховое (usesWorkshops: processor / construction_materials_plant).
 * - workshopNumber в 1..buildingLevel; цех существует.
 * - Цех — обычный (специализация НЕОБРАТИМА: повторно/сменить нельзя).
 * - Цех свободен (без текущей партии).
 * - recipeId разрешён в пуле здания (каталог workshop-specializations).
 * - Достаточно ресурсов для specializeCost.
 *
 * Эмитит: economy:building-specialized (workshopNumber + recipeId).
 *
 * @returns { success: boolean; reason?: string }
 */
export function specializeWorkshop(
  planet: Planet,
  hexIndex: number,
  workshopNumber: number,
  recipeId: string,
): { success: boolean; reason?: string } {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) {
    return { success: false, reason: 'invalid-hex-index' };
  }
  const hex = planet.hexes[hexIndex];
  if (!hex.buildingId) return { success: false, reason: 'no-building' };

  const def = BUILDING_MAP.get(hex.buildingId);
  if (!def) return { success: false, reason: 'unknown-building' };
  if (!def.usesWorkshops) return { success: false, reason: 'not-workshop-building' };

  const workshops = getCellWorkshops(hex);
  if (!workshops) return { success: false, reason: 'not-workshop-building' };
  if (workshopNumber < 1 || workshopNumber > workshops.length) {
    return { success: false, reason: 'invalid-workshop-number' };
  }
  const ws = workshops[workshopNumber - 1];

  // Необратимость: уже специализированный цех менять нельзя.
  if (ws.specializationRecipeId !== undefined) {
    return { success: false, reason: 'already-specialized' };
  }
  // Цех должен быть свободен.
  if (ws.currentBatch) {
    return { success: false, reason: 'workshop-busy' };
  }
  // Рецепт обязан принадлежать пулу здания.
  if (!isRecipeAllowedForBuildingPool(def.id, recipeId)) {
    return { success: false, reason: 'recipe-not-in-pool' };
  }
  // Стоимость.
  if (!spendSpecializeCost(planet, def.specializeCost ?? {})) {
    return { success: false, reason: 'cannot-afford' };
  }

  // Мутация: профиль-рецепт + уровень 1.
  ws.specializationRecipeId = recipeId;
  ws.specializationLevel = 1;

  gameBus.emit('economy:building-specialized', {
    planetId: planet.id,
    hexIndex,
    workshopNumber,
    recipeId,
    specializationLevel: 1,
  });
  return { success: true };
}

/**
 * PROC-WORKSHOPS-01: повысить уровень специализации цеха (1→2→…→5).
 *
 * Стоимость = upgradeSpecializationCost × specializationLevel (существующая
 * механика Block 05). Повышать можно в любой момент (монотонное улучшение);
 * понизить нельзя (необратимость).
 *
 * Эмитит: economy:specialization-upgraded.
 */
export function upgradeWorkshopSpecialization(
  planet: Planet,
  hexIndex: number,
  workshopNumber: number,
): { success: boolean; reason?: string } {
  if (hexIndex < 0 || hexIndex >= planet.hexes.length) {
    return { success: false, reason: 'invalid-hex-index' };
  }
  const hex = planet.hexes[hexIndex];
  if (!hex.buildingId) return { success: false, reason: 'no-building' };

  const def = BUILDING_MAP.get(hex.buildingId);
  if (!def) return { success: false, reason: 'unknown-building' };
  if (!def.usesWorkshops) return { success: false, reason: 'not-workshop-building' };

  const workshops = getCellWorkshops(hex);
  if (!workshops) return { success: false, reason: 'not-workshop-building' };
  if (workshopNumber < 1 || workshopNumber > workshops.length) {
    return { success: false, reason: 'invalid-workshop-number' };
  }
  const ws = workshops[workshopNumber - 1];
  if (ws.specializationRecipeId === undefined) {
    return { success: false, reason: 'not-specialized' };
  }
  const currentLevel = ws.specializationLevel ?? 1;
  if (currentLevel >= 5) {
    return { success: false, reason: 'max-level' };
  }

  // Стоимость = upgradeSpecializationCost × currentLevel.
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

  ws.specializationLevel = currentLevel + 1;
  gameBus.emit('economy:specialization-upgraded', {
    planetId: planet.id,
    hexIndex,
    workshopNumber,
    specializationLevel: ws.specializationLevel,
  });
  return { success: true };
}

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

  // PROC-WORKSHOPS-01: если элемент исполнялся цехом — снять партию
  // (иначе цех держал бы батч с висячим queueItemId).
  dropWorkshopBatchesForItem(planet, queueItemId);

  gameBus.emit('economy:production-cancelled', {
    planetId: planet.id,
    recipeId: removed.recipeId,
    queueItemId: removed.id,
    reason: 'manual',
  });
  return true;
}

/**
 * PROC-WORKSHOPS-01: снять партии всех цехов, исполнявшие queueItemId
 * (ручная отмена / удаление элемента). Прогресс теряется — осознанный
 * выбор игрока; заказ удалён из очереди.
 */
function dropWorkshopBatchesForItem(planet: Planet, queueItemId: string): void {
  const cells: Array<HexCell | AtmosphericSlot | OrbitalSlot> = [
    ...planet.hexes,
    ...planet.atmosphericSlots,
    ...planet.orbitSlots,
  ];
  for (const cell of cells) {
    const workshops = cell.workshops;
    if (!workshops) continue;
    for (const ws of workshops) {
      if (ws.currentBatch?.queueItemId === queueItemId) {
        ws.currentBatch = undefined;
      }
    }
  }
}

/**
 * Колонизировать планету: поставить colony_hub на лучший гекс + дать стартовые ресурсы.
 * Возвращает true если успешно, false если нельзя колонизировать.
 */
export function colonizePlanet(planet: Planet, system?: StarSystem): boolean {
  // Нельзя колонизировать газовый гигант (нет поверхности) или уже занятую планету
  if (planet.type === 'gas_giant') return false;
  if (planet.owner) return false;

  // ORE-POOLS-DOCS-01: колонизация АКТИВИРУЕТ уже рассчитанные планетарные
  // пулы (Planet.orePools — сгенерированы при создании планеты). Залежи НЕ
  // материализуются в координаты гексов и ресурс НЕ накидывается повторно —
  // добыча с первого тика идёт из общепланетарных пулов (docs/31 §10.4).

  // Найти гекс для colony_hub по действующим критериям ТЕРРИТОРИИ/РАЗМЕЩЕНИЯ
  // (ORE-POOLS-DOCS-01: НЕ по количеству подземных залежей). Детерминированный
  // выбор: предпочтение — свободный не-океанский гекс с наибольшим числом
  // не-океанских соседей (качество размещения/синергии), затем порядок сетки.
  let bestHex = -1;
  let bestScore = -1;

  for (let i = 0; i < planet.hexes.length; i++) {
    const hex = planet.hexes[i];
    if (hex.buildingId) continue;
    if (hex.terrain === 'ocean') continue;

    const score = countNonOceanNeighbors(planet, i);
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
 * Число не-океанских соседей гекса (качество размещения colony_hub —
 * ORE-POOLS-DOCS-01: выбор по территории, не по подземным залежам).
 */
function countNonOceanNeighbors(planet: Planet, index: number): number {
  const hex = planet.hexes[index];
  if (!hex) return 0;
  let count = 0;
  for (const other of planet.hexes) {
    if (other === hex) continue;
    const dq = other.coord.q - hex.coord.q;
    const dr = other.coord.r - hex.coord.r;
    // Axial-соседи: (±1,0),(0,±1),(1,−1),(−1,1) ⇔ |dq|≤1, |dr|≤1, dq+dr≠0
    const isNeighbor = Math.abs(dq) <= 1 && Math.abs(dr) <= 1 && dq + dr !== 0;
    if (!isNeighbor) continue;
    if (other.terrain !== 'ocean') count++;
  }
  return count;
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
