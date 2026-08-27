/**
 * Block 02 (F3, F5): Fleet engine — create/merge/split + tick processing.
 *
 * Phase 2.4 (F3): createFleet / mergeFleets / splitFleet / getFleetAt —
 * pure functions, no side-effects, no PRNG, no event emission.
 *
 * Phase 2.6 (F5) extends this file with processFleetTick / advanceFleet /
 * consumeFuel / completeOrder — see bottom of file.
 *
 * Логика чистая (без side-effects), тестируется unit-тестами.
 * Иммутабельные возвращаемые значения — store обёрнёт в immer draft.
 *
 * Документация: docs/50-ships.md §1.6 (fleet), §10 (примеры), Приложение D (MVP).
 */

import type { EntityId, Fleet, Ship, GameState, FleetOrder } from '@/core/types';
import { emptyFuelStore, ALL_FUEL_TYPES } from '@/data/ships/fuel-map';
import { gameBus } from '@/core/typed-event-bus';
import {
  resolveCombat,
  canColonizePlanet,
  calculateFleetStats,
  JUMP_RECHARGE_TICKS,
  TRAVEL_SCALE,
} from './orders';
import { colonizePlanet as engineColonizePlanet } from '@/economy/engine';

// ─── F3: create / merge / split ──────────────────────────────────────────

/**
 * Создать новый флот из набора кораблей в указанной системе.
 * Возвращает Fleet без id — store action присваивает id (детерминированный
 * счётчик, без Math.random).
 *
 * Fuel store инициализируется пустым — заправка происходит на планете
 * (UI action refuelFleet — Phase 2.7). В MVP топливо списывается только
 * в пути (Phase 2.6 processFleetTick).
 *
 * @param shipIds  — ID кораблей, входящих в флот (корабли должны находиться
 *                   в указанной системе; проверка остаётся на store action)
 * @param location — systemId, где находится флот
 * @param owner    — factionId владельца (для фильтрации UI)
 * @param name     — человекочитаемое имя флота (опционально)
 */
export function createFleet(
  shipIds: EntityId[],
  location: EntityId,
  owner: EntityId,
  name?: string,
): Omit<Fleet, 'id'> {
  return {
    name: name ?? `Флот (${shipIds.length})`,
    shipIds: shipIds.slice(),
    location,
    owner,
    orders: [],
    fuelStores: emptyFuelStore(),
  };
}

/**
 * Объединить несколько флотов в один. Все корабли из всех флотов попадают
 * в новый флот в порядке следования.
 *
 * Локация нового флота = локация первого флота в массиве (все флоты в
 * массиве должны находиться в одной системе — проверка остаётся на store).
 *
 * Fuel stores суммируются по всем типам топлива (chemical/xenon/hydrogen/antimatter).
 *
 * Orders НЕ переносятся — объединённый флот начинает без активных приказов
 * (предполагается, что игрок объединяет флоты для новой задачи).
 *
 * @param fleets — массив флотов для объединения (>=1)
 * @returns Fleet без id (store присваивает)
 */
export function mergeFleets(fleets: Fleet[]): Omit<Fleet, 'id'> {
  if (fleets.length === 0) {
    return {
      name: 'Пустой флот',
      shipIds: [],
      location: '',
      owner: '',
      orders: [],
      fuelStores: emptyFuelStore(),
    };
  }
  const first = fleets[0]!;
  const allShipIds: EntityId[] = [];
  const allFuel = emptyFuelStore();
  for (const f of fleets) {
    for (const id of f.shipIds) allShipIds.push(id);
    for (const ft of ALL_FUEL_TYPES) {
      allFuel[ft] += f.fuelStores[ft] ?? 0;
    }
  }
  return {
    name: `Объединённый флот (${allShipIds.length})`,
    shipIds: allShipIds,
    location: first.location,
    owner: first.owner,
    orders: [],
    fuelStores: allFuel,
  };
}

/**
 * Разделить флот на два: оставшийся (remaining = source без извлечённых
 * кораблей) и извлечённый (extracted = новый флот с запрошенными кораблями).
 *
 * Топливо делится пропорционально количеству кораблей:
 *   extractedFuel = source.fuelStores × (extractedCount / totalCount)
 *   remainingFuel  = source.fuelStores − extractedFuel
 *
 * Orders остаются с remaining флотом (extracted начинает без приказов).
 * Location сохраняется у обоих (оба в той же системе, что и исходный).
 *
 * @param fleet              — исходный флот (immutable input — не мутируется)
 * @param shipIdsToExtract   — ID кораблей для извлечения в новый флот
 * @returns { remaining: Fleet (с тем же id, что и входной), extracted: Fleet без id }
 */
export function splitFleet(
  fleet: Fleet,
  shipIdsToExtract: EntityId[],
): { remaining: Fleet; extracted: Omit<Fleet, 'id'> } {
  const extractSet = new Set(shipIdsToExtract);
  const remainingShips = fleet.shipIds.filter(id => !extractSet.has(id));
  const extractedShips = fleet.shipIds.filter(id => extractSet.has(id));

  // Топливо пропорционально кол-ву кораблей (round-down для extract,
  // остаток уходит в remaining — сумма сохраняется).
  const total = fleet.shipIds.length;
  const extractCount = extractedShips.length;
  const extractFuel = emptyFuelStore();
  const remainFuel = emptyFuelStore();
  if (total > 0) {
    for (const ft of ALL_FUEL_TYPES) {
      const totalFuel = fleet.fuelStores[ft] ?? 0;
      const extractAmount = Math.floor((totalFuel * extractCount) / total);
      extractFuel[ft] = extractAmount;
      remainFuel[ft] = totalFuel - extractAmount;
    }
  }

  const remaining: Fleet = {
    ...fleet,
    shipIds: remainingShips,
    fuelStores: remainFuel,
  };

  const extracted: Omit<Fleet, 'id'> = {
    name: `${fleet.name} (часть)`,
    shipIds: extractedShips,
    location: fleet.location,
    owner: fleet.owner,
    orders: [],
    fuelStores: extractFuel,
  };

  return { remaining, extracted };
}

/**
 * Найти первый флот игрока в указанной системе.
 * Если несколько флотов — возвращается первый по индексу в массиве.
 */
export function getFleetAt(fleets: Fleet[], systemId: EntityId): Fleet | undefined {
  return fleets.find(f => f.location === systemId);
}

/**
 * Найти все флоты игрока в указанной системе.
 */
export function getFleetsAt(fleets: Fleet[], systemId: EntityId): Fleet[] {
  return fleets.filter(f => f.location === systemId);
}

/**
 * Найти флот по id (O(n) lookup по массиву — для MVP с одним игроком
 * и десятком флотов это приемлемо; spatial hash — Etap 3.5 при росте флотов).
 */
export function getFleetById(fleets: Fleet[], fleetId: EntityId): Fleet | undefined {
  return fleets.find(f => f.id === fleetId);
}

/**
 * Получить список кораблей флота (lookup по Map из GameState.ships).
 * Корабли, чьи ID не найдены в Map, пропускаются (стейл-ссылки после
 * уничтожения корабля — Etap 4).
 */
export function getFleetShips(fleet: Fleet, ships: Map<EntityId, Ship>): Ship[] {
  const out: Ship[] = [];
  for (const id of fleet.shipIds) {
    const ship = ships.get(id);
    if (ship) out.push(ship);
  }
  return out;
}

/**
 * Найти все «свободные» корабли игрока — те, что не входят ни в один флот.
 * Локация = planetId (на орбите верфи) или systemId (если в пути — но в MVP
 * корабль в пути числится во флоте, не свободным).
 *
 * @param ships   — Map всех кораблей GameState.ships
 * @param fleets  — массив всех флотов GameState.fleets
 * @param ownerId — фильтр по владельцу (для UI показываем только свои корабли)
 * @param location — фильтр по локации (planetId или systemId); undefined = все
 */
export function getLooseShips(
  ships: Map<EntityId, Ship>,
  fleets: Fleet[],
  ownerId: EntityId,
  location?: EntityId,
): Ship[] {
  // Собрать все ID кораблей, входящих в какой-либо флот
  const inFleet = new Set<EntityId>();
  for (const f of fleets) {
    for (const id of f.shipIds) inFleet.add(id);
  }
  const out: Ship[] = [];
  for (const ship of ships.values()) {
    if (ship.owner !== ownerId) continue;
    if (inFleet.has(ship.id)) continue;
    if (location !== undefined && ship.location !== location) continue;
    out.push(ship);
  }
  return out;
}

// ─── F5: processFleetTick / advanceFleet / consumeFuel / completeOrder ────
// Phase 2.6 — full tick processing for fleet movement, fuel consumption,
// and order completion (move/patrol/colonize/attack/defend).

/**
 * Результат обработки одного тика флота.
 */
export interface ProcessFleetTickResult {
  /** Обновлённый флот (с обновлённой location / orders / fuelStores / defending). */
  updatedFleet: Fleet;
  /** true если текущий приказ завершён на этом тике. */
  completed: boolean;
  /** systemId если флот прибыл в новую систему на этом тике (next leg completed). */
  arrivedAt?: EntityId;
  /** true если флот застрял из-за нехватки топлива. */
  stranded?: boolean;
  /** planetId если была колонизирована планета (для colonize order). */
  colonizedPlanetId?: EntityId;
}

/**
 * Стоимость топлива за один leg перехода через JP.
 * Константа MVP — Etap 4 может усложнить формулой (зависимость от массы флота,
 * дальности прыжка, эффективности двигателя).
 */
const FUEL_COST_PER_LEG = 1;

/**
 * Обработать 1 тик флота — главный движок движения (§F5 plan).
 *
 * Логика:
 * 1. Нет активного приказа (orders[0]) → no-op.
 * 2. Приказ 'defend' → мгновенное завершение: fleet.defending = true, order removed.
 * 3. Если currentTick < order.etaTick → флот в пути. Если currentLegIndex === 0 —
 *    emit fleet:movement-started (один раз за order; не повторяем на промежуточных).
 *    Возвращаем без изменений (без движения).
 * 4. Если currentTick >= order.etaTick → advance на 1 leg:
 *    a. consumeFuel(fleet, FUEL_COST_PER_LEG) — если insufficient → emit stranded, halt
 *    b. currentLegIndex + 1, fleet.location = path[currentLegIndex]
 *    c. emit ships:arrived (для каждого корабля) + fleet:arrived
 *    d. Если currentLegIndex == path.length - 1 → completeOrder (move done / patrol loops / colonize / attack / defend)
 *    e. Иначе — пересчёт etaTick для следующего leg (на основе distance / speed)
 *
 * @param fleet        — флот для обработки (immutable input)
 * @param gameState    — для lookup galaxy/systems/planets (используется в colonize/attack)
 * @param currentTick  — текущий игровой тик
 */
export function processFleetTick(
  fleet: Fleet,
  gameState: GameState,
  currentTick: number,
): ProcessFleetTickResult {
  // No active order
  if (fleet.orders.length === 0) {
    return { updatedFleet: fleet, completed: false };
  }

  const order = fleet.orders[0]!;

  // 'defend' order: complete immediately, no movement
  if (order.type === 'defend') {
    const newFleet: Fleet = {
      ...fleet,
      defending: true,
      orders: fleet.orders.slice(1),
    };
    gameBus.emit('fleet:order-completed', {
      fleetId: fleet.id,
      orderType: 'defend',
      targetId: order.targetId,
    });
    return { updatedFleet: newFleet, completed: true };
  }

  // For move/patrol/colonize/attack: movement logic
  // If currentTick < etaTick → still in transit on current leg
  if (currentTick < order.etaTick) {
    // Emit movement-started once per order (when on first leg AND just after issue)
    // For tests: emit on the first tick after issue (currentTick === issuedTick + 1)
    // AND currentLegIndex === 0.
    if (order.currentLegIndex === 0 && currentTick === order.issuedTick + 1) {
      const toSystemId = order.path.length > 1 ? order.path[1]! : order.targetId;
      gameBus.emit('fleet:movement-started', {
        fleetId: fleet.id,
        fromSystemId: fleet.location,
        toSystemId,
        path: order.path,
        etaTick: order.etaTick,
      });
    }
    return { updatedFleet: fleet, completed: false };
  }

  // currentTick >= etaTick → advance one leg
  const nextLegIndex = order.currentLegIndex + 1;

  // Cannot advance beyond path
  if (nextLegIndex >= order.path.length) {
    // Already at end — complete
    return completeOrder(fleet, gameState, currentTick);
  }

  // Consume fuel for the leg
  const fuelResult = consumeFuel(fleet, FUEL_COST_PER_LEG);
  if (fuelResult.insufficient) {
    gameBus.emit('fleet:fuel-low', {
      fleetId: fleet.id,
      remainingFuel: 0,
      requiredFuel: FUEL_COST_PER_LEG,
    });
    gameBus.emit('fleet:stranded', {
      fleetId: fleet.id,
      systemId: fleet.location,
    });
    return { updatedFleet: fleet, completed: false, stranded: true };
  }

  // Update fleet location
  const newLocation = order.path[nextLegIndex]!;

  // Recalculate etaTick for next leg (or set to currentTick if at end)
  let newEtaTick = order.etaTick;
  if (nextLegIndex < order.path.length - 1) {
    // Still more legs to go — calculate time for next leg
    const fleetStats = computeFleetStatsForTick(fleet, gameState);
    const nextLegDistance = systemDistance(gameState.galaxy, newLocation, order.path[nextLegIndex + 1]!);
    const nextLegTime = fleetStats.speed > 0
      ? Math.ceil((nextLegDistance * TRAVEL_SCALE) / fleetStats.speed + JUMP_RECHARGE_TICKS)
      : 0;
    newEtaTick = currentTick + nextLegTime;
  } else {
    // Reached final destination
    newEtaTick = currentTick;
  }

  // Build new order with updated legIndex + etaTick
  const newOrder: FleetOrder = {
    ...order,
    currentLegIndex: nextLegIndex,
    etaTick: newEtaTick,
  };
  const newFleet: Fleet = {
    ...fuelResult.fleet,
    location: newLocation,
    orders: [newOrder, ...fleet.orders.slice(1)],
  };

  // Emit arrival events
  gameBus.emit('fleet:arrived', { fleetId: fleet.id, systemId: newLocation });
  for (const shipId of fleet.shipIds) {
    gameBus.emit('ships:arrived', { shipId, systemId: newLocation });
  }

  // If reached final destination → complete order
  if (nextLegIndex === order.path.length - 1) {
    return completeOrder(newFleet, gameState, currentTick);
  }

  return { updatedFleet: newFleet, completed: false, arrivedAt: newLocation };
}

/**
 * Списать топливо с флота. Пробует типы в порядке: xenon → hydrogen → chemical.
 * Antimatter зарезервирован для Etap 4.
 *
 * @returns { fleet, insufficient } — если insufficient, топливо не списано.
 */
export function consumeFuel(
  fleet: Fleet,
  amount: number,
): { fleet: Fleet; insufficient: boolean } {
  // Try each fuel type in priority order (xenon → hydrogen → chemical)
  const fuelPriority: Array<'xenon' | 'hydrogen' | 'chemical'> = ['xenon', 'hydrogen', 'chemical'];
  for (const ft of fuelPriority) {
    if (fleet.fuelStores[ft] >= amount) {
      const newFuel = { ...fleet.fuelStores, [ft]: fleet.fuelStores[ft] - amount };
      gameBus.emit('ships:fuel-consumed', {
        fleetId: fleet.id,
        fuelType: ft,
        amount,
        remaining: newFuel[ft],
      });
      return { fleet: { ...fleet, fuelStores: newFuel }, insufficient: false };
    }
  }
  // Insufficient fuel
  return { fleet, insufficient: true };
}

/**
 * Завершить текущий приказ (orders[0]) — pop, emit order-completed.
 *
 * Поведение по типам приказов:
 * - move: просто pop order (fleet остаётся в target системе).
 * - patrol: re-queue с reversed path (loops обратно к origin).
 * - colonize: найти первую rocky unowned planet в target system и colonize.
 * - attack: stub resolveCombat (attacker wins), emit combat:engaged.
 * - defend: fleet.defending = true, pop order.
 *
 * @param fleet        — флот с завершённым orders[0]
 * @param gameState    — для galaxy/systemMap lookup (colonize/attack)
 * @param currentTick  — для нового issuedTick (patrol re-queue)
 */
export function completeOrder(
  fleet: Fleet,
  gameState: GameState,
  currentTick: number,
): ProcessFleetTickResult {
  const order = fleet.orders[0];
  if (!order) return { updatedFleet: fleet, completed: false };

  let updatedFleet = fleet;
  let colonizedPlanetId: EntityId | undefined;

  switch (order.type) {
    case 'move': {
      // Pop order, fleet stays at target system
      updatedFleet = { ...fleet, orders: fleet.orders.slice(1) };
      break;
    }
    case 'patrol': {
      // Re-queue with reversed path (loops back to origin, then back again)
      const reversedPath = [...order.path].reverse();
      const travelDuration = order.etaTick - order.issuedTick;
      const newOrder: FleetOrder = {
        ...order,
        path: reversedPath,
        currentLegIndex: 0,
        issuedTick: currentTick,
        etaTick: currentTick + travelDuration,
      };
      updatedFleet = { ...fleet, orders: [newOrder, ...fleet.orders.slice(1)] };
      break;
    }
    case 'colonize': {
      // Find first rocky unowned planet in target system
      const targetSystem = gameState.galaxy.systemMap.get(order.targetId);
      if (targetSystem) {
        const planet = targetSystem.planets.find(p => canColonizePlanet(p));
        if (planet) {
          // engineColonizePlanet mutates planet in place (assumes draft or mutable)
          engineColonizePlanet(planet, targetSystem);
          colonizedPlanetId = planet.id;
        }
      }
      updatedFleet = { ...fleet, orders: fleet.orders.slice(1) };
      break;
    }
    case 'attack': {
      // Stub: resolve combat — attacker wins, no losses
      resolveCombat(fleet);
      gameBus.emit('combat:engaged', {
        systemId: fleet.location,
        attackerFactionId: fleet.owner,
        defenderFactionId: 'enemy', // stub — Etap 4 will compute real defender
      });
      updatedFleet = { ...fleet, orders: fleet.orders.slice(1) };
      break;
    }
    case 'defend': {
      updatedFleet = { ...fleet, defending: true, orders: fleet.orders.slice(1) };
      break;
    }
  }

  gameBus.emit('fleet:order-completed', {
    fleetId: fleet.id,
    orderType: order.type,
    targetId: order.targetId,
  });

  return { updatedFleet, completed: true, colonizedPlanetId };
}

// ─── Helpers (used by processFleetTick for etaTick recalculation) ───────

/**
 * Compute fleet stats (mass/thrust/speed/jumpDrive) — wrapper for use in
 * processFleetTick's etaTick recalculation.
 */
function computeFleetStatsForTick(fleet: Fleet, gameState: GameState) {
  return calculateFleetStats(fleet, gameState.ships, gameState.shipDesigns);
}

/**
 * Euclidean distance between two systems (in galaxy position units).
 */
function systemDistance(galaxy: GameState['galaxy'], sysA: EntityId, sysB: EntityId): number {
  const a = galaxy.systemMap.get(sysA);
  const b = galaxy.systemMap.get(sysB);
  if (!a || !b) return Infinity;
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}
