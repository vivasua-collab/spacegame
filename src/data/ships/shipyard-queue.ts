/**
 * Block 02 (F1, F6): Очередь постройки кораблей на верфи.
 *
 * Типы ShipyardQueue и ShipyardQueueItem определены в `src/core/types.ts`.
 * Этот файл содержит функции-помощники:
 * - `enqueueShipBuild` — добавить дизайн в очередь постройки планеты
 * - `processShipyardTick` — продвинуть очередь на 1 тик (списать ресурсы,
 *   при завершении — создать Ship-сущность)
 * - `getShipBuildTime` — получить время постройки корпуса (из Приложения C)
 * - `getShipBuildCost` — рассчитать стоимость постройки (в у.е.р. и в ресурсах)
 *
 * Решение R2 плана (§8): для MVP используем упрощённую модель ресурсов —
 * каждая у.е.р. конвертируется в 5 ед. steel + 1 ед. microchip. Полный
 * крафт модулей через recipes.ts (make_ion_engine, make_laser, ...) — это
 * уровень 3, остаётся опциональным пред-степом (Etap 4).
 *
 * Время постройки (Приложение C):
 *   scout=50, fighter=80, frigate=150, transport=120 тиков.
 */

import type {
  Planet,
  Ship,
  ShipDesign,
  ShipyardQueue,
  ShipyardQueueItem,
  EntityId,
  HullSize,
} from '@/core/types';
import { HULL_MAP } from './hulls';
import { MODULE_MAP } from './modules';
import { armorMultiplier, calculateDesignStats } from '@/ships/designer';
import { emptyFuelStore } from './fuel-map';
import { gameBus } from '@/core/typed-event-bus';

/**
 * Константа конверсии стоимости постройки в ресурсы (упрощение MVP).
 * 1 у.е.р. = 5 ед. steel + 1 ед. microchip.
 */
export const STEEL_PER_UER = 5;
export const MICROCHIP_PER_UER = 1;

/**
 * Время постройки корпуса (в тиках) по Приложению C docs/50-ships.md.
 * scout=50, fighter=80, frigate=150, transport=120.
 * Heavy hulls (cruiser/battleship/flagship) — заглушки (MVP не строит).
 */
const SHIP_BUILD_TIME: Record<HullSize, number> = {
  scout: 50,
  fighter: 80,
  frigate: 150,
  transport: 120,
  cruiser: 250,        // stub (Etap 4)
  battleship: 400,     // stub (Etap 4)
  flagship: 600,        // stub (Etap 4)
};

/** Получить время постройки (тики) для дизайна. */
export function getShipBuildTime(design: ShipDesign): number {
  const hull = HULL_MAP.get(design.hullId);
  if (!hull) return 100;
  return SHIP_BUILD_TIME[hull.size] ?? 100;
}

/**
 * Рассчитать стоимость постройки (в у.е.р.).
 * Формула §1.3 + §2.5: cost_total = hull.baseCost × armorMult.costMult + Σ(modules.cost).
 */
export function getShipBuildCostUER(design: ShipDesign): number {
  const hull = HULL_MAP.get(design.hullId);
  if (!hull) return 0;
  const armorMult = armorMultiplier(design.armor);
  const hullCost = hull.baseCost * armorMult.costMult;
  let modulesCost = 0;
  for (const moduleId of design.moduleIds) {
    const mod = MODULE_MAP.get(moduleId);
    if (mod) modulesCost += mod.cost;
  }
  return Math.round(hullCost + modulesCost);
}

/**
 * Рассчитать стоимость постройки в ресурсах (steel + microchip) — упрощение MVP.
 * 1 у.е.р. = 5 steel + 1 microchip.
 */
export function getShipBuildCostResources(design: ShipDesign): { steel: number; microchip: number } {
  const uer = getShipBuildCostUER(design);
  return {
    steel: uer * STEEL_PER_UER,
    microchip: uer * MICROCHIP_PER_UER,
  };
}

/**
 * Добавить дизайн в очередь постройки кораблей на планете.
 * НЕ списывает ресурсы мгновенно — списание происходит в `processShipyardTick`
 * при завершении (это мягче для игрока: можно отменить до завершения).
 *
 * Если у планеты нет shipyard-здания — операция не выполняется (return queue as-is).
 * Однако проверка самого здания остаётся на уровне UI/store — здесь мы не
 * проверяем планету на наличие верфи, чтобы функция была pure.
 *
 * @param planet  — планета (не используется в MVP, но симметрично с processShipyardTick)
 * @param queue   — текущая очередь (или undefined — создать новую)
 * @param design  — дизайн корабля для постройки
 * @param shipName — имя будущего корабля
 * @param itemId   — уникальный ID для ShipyardQueueItem (генерируется в store)
 * @returns новая очередь с добавленным item
 */
export function enqueueShipBuild(
  _planet: Planet,
  queue: ShipyardQueue | undefined,
  design: ShipDesign,
  shipName: string,
  itemId: EntityId,
): ShipyardQueue {
  const items = queue?.items ?? [];
  const totalTicks = getShipBuildTime(design);
  const newItem: ShipyardQueueItem = {
    id: itemId,
    designId: design.id,
    shipName,
    progressTicks: 0,
    totalTicks,
  };
  return {
    planetId: _planet.id,
    items: [...items, newItem],
  };
}

/**
 * Обработать 1 тик очереди постройки кораблей на планете.
 *
 * Если первый в очереди item имеет progressTicks + 1 >= totalTicks — он завершён:
 * - списываются ресурсы (steel + microchip) с planet.resources
 * - создаётся новая Ship-сущность (через shipIdGenerator)
 *   - location = planet.id (корабль появляется на орбите планеты)
 *   - owner = planet.owner
 *   - hp = maxHp = totalHP из дизайнерского расчёта (calculateDesignStats)
 *   - fuel = полный бак (на основе топливных модулей)
 * - item удаляется из очереди
 * - эмитится ships:constructed (через gameBus) и ships:construction-progress
 *
 * Если ресурсов недостаточно — флот не строится, item остаётся в очереди
 * (но прогресс НЕ растёт до тех пор, пока ресурсы не появятся).
 *
 * @param planet            — планета (для списания ресурсов и owner)
 * @param queue             — текущая очередь
 * @param shipIdGenerator   — функция для генерации ID нового корабля
 * @param design            — дизайн (нужно для получения stats и moduleIds)
 * @returns { ship?: Ship; newQueue: ShipyardQueue; completed: boolean }
 */
export function processShipyardTick(
  planet: Planet,
  queue: ShipyardQueue,
  shipIdGenerator: () => EntityId,
  design: ShipDesign | undefined,
): { ship?: Ship; newQueue: ShipyardQueue; completed: boolean } {
  if (queue.items.length === 0) {
    return { newQueue: queue, completed: false };
  }
  const item = queue.items[0];
  if (!item) {
    return { newQueue: queue, completed: false };
  }

  // Прогресс +1 тик
  const newProgress = item.progressTicks + 1;

  // Не завершён — просто инкремент прогресса + emit progress event
  if (newProgress < item.totalTicks) {
    const newItems = queue.items.slice();
    newItems[0] = { ...item, progressTicks: newProgress };
    gameBus.emit('ships:construction-progress', {
      planetId: planet.id,
      shipId: item.id,
      progressTicks: newProgress,
      totalTicks: item.totalTicks,
    });
    return {
      newQueue: { ...queue, items: newItems },
      completed: false,
    };
  }

  // Завершён — списать ресурсы, создать Ship
  if (!design) {
    // Дизайн не найден (был удалён) — удалить item из очереди
    const newItems = queue.items.slice(1);
    return {
      newQueue: { ...queue, items: newItems },
      completed: true,
    };
  }

  const cost = getShipBuildCostResources(design);
  const steelAvailable = planet.resources['steel'] ?? 0;
  const microchipAvailable = planet.resources['microchip'] ?? 0;
  if (steelAvailable < cost.steel || microchipAvailable < cost.microchip) {
    // Недостаточно ресурсов — НЕ строим, прогресс НЕ растёт (мягче для игрока).
    return { newQueue: queue, completed: false };
  }

  // Списать ресурсы
  planet.resources['steel'] = steelAvailable - cost.steel;
  planet.resources['microchip'] = microchipAvailable - cost.microchip;

  // Рассчитать итоговый maxHp из дизайна
  const designStats = calculateDesignStats(design);
  const maxHp = designStats.totalHP;

  // Создать Ship
  const shipId = shipIdGenerator();
  const ship: Ship = {
    id: shipId,
    name: item.shipName,
    designId: design.id,
    hullId: design.hullId,
    moduleIds: design.moduleIds.slice(),
    armor: design.armor,
    hp: maxHp,
    maxHp,
    fuel: emptyFuelStore(),
    location: planet.id, // на орбите планеты-верфи
    owner: planet.owner ?? 'player',
    designName: design.name,
  };

  // Удалить item из очереди
  const newItems = queue.items.slice(1);

  // Эмит ships:constructed
  gameBus.emit('ships:constructed', {
    shipId,
    designId: design.id,
    owner: ship.owner,
  });

  return {
    ship,
    newQueue: { ...queue, items: newItems },
    completed: true,
  };
}

/**
 * Отменить элемент очереди постройки (по itemId). Возвращает обновлённую очередь.
 * Ресурсы НЕ возвращаются (они списываются только при завершении, а отмена
 * до завершения не требует возврата).
 */
export function cancelShipyardItem(
  queue: ShipyardQueue,
  itemId: EntityId,
): ShipyardQueue {
  return {
    ...queue,
    items: queue.items.filter(i => i.id !== itemId),
  };
}
