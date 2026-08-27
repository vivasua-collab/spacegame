/**
 * Block 02 (F4): Orders engine — planRoute + calculateTravelTime + executeOrder.
 *
 * MVP-реализация docs/50-ships.md §1.6 (fleet orders) + §3.1 (speed formula).
 *
 * Pure functions, no side-effects, no PRNG, no event emission.
 * Phase 2.6 (F5) executes orders via processFleetTick (fleet-engine.ts).
 *
 * Структура:
 * - planRoute(from, to, galaxy) — BFS по jump point графу
 * - calculateTravelTime(path, fleetStats, galaxy) — сумма времён по переходам
 * - calculateFleetStats(fleet, ships, designs) — масса/тяга/скорость/jumpDrive
 * - executeOrder(fleet, type, target, galaxy, ships, designs, tick) — ставит order в orders[0]
 * - resolveCombat stub (Etap 4 — full combat)
 * - canColonize stub (Phase 2.6 — full colonize logic with colony_hub building)
 *
 * Документация: docs/50-ships.md §1.6, §3.1, §3.2.4, Приложение B (validateShip).
 */

import type {
  EntityId,
  Fleet,
  FleetOrder,
  Galaxy,
  Planet,
  Ship,
  ShipDesign,
  StarSystem,
} from '@/core/types';
import { calculateDesignStats } from '@/ships/designer';

// ─── Константы ───────────────────────────────────────────────────────────

/**
 * Время перезарядки jump_drive между переходами (тики).
 * §3.2.4 docs/50-ships.md.
 */
export const JUMP_RECHARGE_TICKS = 10;

/**
 * Масштаб времени пути: per-leg time = ceil(distance × TRAVEL_SCALE / speed + JUMP_RECHARGE).
 *
 * Коэффициент подобран для игровой балансировки: даёт разумное число тиков
 * на типичных галактических расстояниях (10-100 position units).
 *
 * Физически-корректный расчёт (5 ly × 9.46e12 km / 7.4 km/s / 86400 s/day = 7.4M ticks)
 * неприемлем для геймплея — игроки не захотят ждать 20 000 лет внутриигрового
 * времени на один переход. TRAVEL_SCALE=1000 даёт:
 *   - distance 5, speed 7.4 → 5 × 1000 / 7.4 + 10 ≈ 686 ticks/leg
 *   - distance 1, speed 10  → 1 × 1000 / 10 + 10 = 110 ticks/leg
 *
 * Etap 4 может усложнить формулу (эффекты искажения времени, варп-двигатели).
 */
export const TRAVEL_SCALE = 1000;

// ─── Helper: построить граф Jump Points ─────────────────────────────────

/**
 * Построить adjacency-граф по jump points галактики.
 * Jump points двунаправлены (см. generate-jump-points.ts — для каждого jp
 * создаётся обратный reverseJp), поэтому достаточно пройти по всем
 * system.jumpPoints и добавить рёбра в обе стороны (для надёжности —
 * на случай, если в каком-то тестовом galaxy JP单向).
 */
function buildJumpGraph(galaxy: Galaxy): Map<EntityId, Set<EntityId>> {
  const graph = new Map<EntityId, Set<EntityId>>();
  const ensure = (id: EntityId): Set<EntityId> => {
    let s = graph.get(id);
    if (!s) {
      s = new Set();
      graph.set(id, s);
    }
    return s;
  };
  for (const sys of galaxy.systems) {
    const neighbors = ensure(sys.id);
    for (const jp of sys.jumpPoints) {
      neighbors.add(jp.toSystemId);
      // Для симметрии добавим и обратное ребро — на случай однонаправленного JP
      const other = ensure(jp.toSystemId);
      other.add(jp.fromSystemId);
    }
  }
  return graph;
}

/**
 * BFS — найти кратчайший путь от fromId к toId через граф jump points.
 *
 * Возвращает:
 * - `[fromId]` если fromId === toId (или from === to, переходов нет)
 * - `[fromId, …, toId]` — кратчайший путь (BFS guarantees shortest by edge count)
 * - `null` — пути нет (D изолирована)
 *
 * Сложность: O(V + E) где V — кол-во систем, E — кол-во JP.
 */
export function planRoute(
  fromSystemId: EntityId,
  toSystemId: EntityId,
  galaxy: Galaxy,
): EntityId[] | null {
  if (fromSystemId === toSystemId) return [fromSystemId];

  const graph = buildJumpGraph(galaxy);
  const visited = new Set<EntityId>([fromSystemId]);
  const queue: Array<{ id: EntityId; path: EntityId[] }> = [
    { id: fromSystemId, path: [fromSystemId] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.get(current.id);
    if (!neighbors) continue;
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      const newPath = [...current.path, next];
      if (next === toSystemId) return newPath;
      queue.push({ id: next, path: newPath });
    }
  }
  return null;
}

// ─── Helper: расстояние между системами ──────────────────────────────────

/** Евклидово расстояние между позициями двух систем (в position units). */
function systemDistance(galaxy: Galaxy, sysA: EntityId, sysB: EntityId): number {
  const a = galaxy.systemMap.get(sysA);
  const b = galaxy.systemMap.get(sysB);
  if (!a || !b) return Infinity;
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Fleet travel stats ──────────────────────────────────────────────────

export interface FleetTravelStats {
  /** Суммарная масса (т) всех кораблей флота. */
  mass: number;
  /** Суммарная тяга (кН) всех двигателей. */
  thrust: number;
  /** Скорость флота (км/с) = thrust / mass × 10 (§3.1). 0 если масса 0. */
  speed: number;
  /** true если хотя бы один корабль имеет jump_drive или warp engine. */
  jumpDrivePresent: boolean;
}

/**
 * Рассчитать travel-стат флота по его кораблям (lookup в Map designs/ships).
 *
 * Масса/тяга суммируются по всем кораблям. Скорость = общая_тяга / общая_масса × 10
 * (как в §3.1 для одного корабля, но на уровне флота — Etap 4 может усложнить
 * минимальной скоростью самого медленного).
 *
 * jumpDrivePresent = true если хотя бы один корабль имеет jump_drive модуль
 * (минимальная масса прыжка jumpRangeMass тоже рассчитывается, но для MVP
 * достаточно булева — флот либо может прыгать, либо нет).
 *
 * @param fleet   — флот (берётся shipIds[])
 * @param ships   — Map всех кораблей GameState.ships
 * @param designs — Map всех дизайнов GameState.shipDesigns
 */
export function calculateFleetStats(
  fleet: Fleet,
  ships: Map<EntityId, Ship>,
  designs: Map<EntityId, ShipDesign>,
): FleetTravelStats {
  let mass = 0;
  let thrust = 0;
  let jumpDrivePresent = false;
  for (const id of fleet.shipIds) {
    const ship = ships.get(id);
    if (!ship) continue;
    const design = designs.get(ship.designId);
    if (!design) continue;
    const stats = calculateDesignStats(design);
    mass += stats.mass;
    thrust += stats.thrust;
    if (stats.canJump) jumpDrivePresent = true;
  }
  const speed = mass > 0 ? (thrust / mass) * 10 : 0;
  return { mass, thrust, speed, jumpDrivePresent };
}

// ─── Travel time ──────────────────────────────────────────────────────────

/**
 * Рассчитать полное время пути (тики) для заданного маршрута.
 *
 * Per-leg формула: ceil(distance × TRAVEL_SCALE / speed + JUMP_RECHARGE_TICKS)
 *
 * Возвращает:
 * - 0 если path.length <= 1 (from === to — переходов нет)
 * - Infinity если нет jump_drive или speed = 0 (флот не может прыгать)
 * - Иначе: сумма per-leg времён
 *
 * @param path       — массив systemId (включая fromId и toId)
 * @param fleetStats — stats флота (mass/thrust/speed/jumpDrivePresent)
 * @param galaxy     — для lookup позиций систем
 */
export function calculateTravelTime(
  path: EntityId[],
  fleetStats: FleetTravelStats,
  galaxy: Galaxy,
): number {
  if (path.length <= 1) return 0;
  if (!fleetStats.jumpDrivePresent) return Infinity;
  if (fleetStats.speed <= 0) return Infinity;

  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dist = systemDistance(galaxy, path[i]!, path[i + 1]!);
    if (dist === Infinity) return Infinity; // unknown system
    const legTime = Math.ceil((dist * TRAVEL_SCALE) / fleetStats.speed + JUMP_RECHARGE_TICKS);
    total += legTime;
  }
  return total;
}

// ─── Stub functions (Etap 4 — full implementations) ─────────────────────

/**
 * Stub: Resolve combat between attacker and defender fleets.
 *
 * Etap 4 will implement full tactical combat (ship targeting, damage per
 * weapon type, armor penetration, shield regen, etc.). For MVP, we just
 * declare the attacker the winner with no losses — preserves game flow
 * (attack order completes, system ownership changes if applicable).
 *
 * @param _attackerFleet — флот атакующего (Etap 4: читает корабли для тактического боя)
 * @param _defenderFleet — флот защитника или undefined (Etap 4: то же)
 * @returns { winner: 'attacker' | 'defender'; losses: { factionId, shipCount }[] }
 */
export interface CombatResult {
  winner: 'attacker' | 'defender';
  losses: { factionId: EntityId; shipCount: number }[];
}

export function resolveCombat(
  _attackerFleet: Fleet,
  _defenderFleet?: Fleet,
): CombatResult {
  // MVP: attacker always wins, no losses. Etap 4: full tactical combat.
  return {
    winner: 'attacker',
    losses: [],
  };
}

/**
 * Stub: Check if a planet can be colonized.
 *
 * Real implementation (Phase 2.6 / Etap 4): verify that the colonizing
 * fleet contains a ship with `colony_module_small` (capacity > 0 — unused
 * modules count). Planet must be rocky (not gas giant), unowned, and
 * have a free hex for colony_hub.
 *
 * MVP stub: returns true if planet.type === 'rocky' && !planet.owner.
 */
export function canColonizePlanet(planet: Planet): boolean {
  return planet.type === 'rocky' && !planet.owner;
}

// ─── Execute order ──────────────────────────────────────────────────────

export interface ExecuteOrderResult {
  /** Обновлённый флот с order в orders[0]. */
  updatedFleet: Fleet;
  /** true если приказ успешно отдан. */
  ok: boolean;
  /** Причина отказа (если ok=false): 'no_route' | 'no_jump_drive' | 'invalid_target' */
  reason?: string;
  /** Эмитнутый order (если ok=true). */
  order?: FleetOrder;
}

/**
 * Отдать приказ флоту — поставить order в начало orders[].
 *
 * Логика:
 * 1. Для 'defend': target = текущая система, path = [fleet.location],
 *    etaTick = currentTick (нет перемещения). order.repeat = false.
 * 2. Для move/patrol/colonize/attack: planRoute(from=fleet.location, to=targetId).
 *    Если путь null → ok=false, reason='no_route'.
 * 3. Рассчитать travelTime. Если Infinity (no jump drive или speed=0) →
 *    ok=false, reason='no_jump_drive'.
 * 4. Создать FleetOrder { type, targetId, issuedTick, path, currentLegIndex=0,
 *    etaTick = currentTick + travelTime, repeat=(type==='patrol') }.
 * 5. Вернуть обновлённый флот с order в orders[0] (старые приказы сдвигаются).
 *
 * Приказы НЕ обрабатываются здесь — для обработки (движение по маршруту,
 * списание топлива, бои, колонизация) см. processFleetTick в Phase 2.6.
 */
export function executeOrder(
  fleet: Fleet,
  orderType: FleetOrder['type'],
  targetId: EntityId,
  galaxy: Galaxy,
  ships: Map<EntityId, Ship>,
  designs: Map<EntityId, ShipDesign>,
  currentTick: number,
): ExecuteOrderResult {
  // 1. 'defend' — без перемещения
  if (orderType === 'defend') {
    const order: FleetOrder = {
      type: 'defend',
      targetId: fleet.location,
      issuedTick: currentTick,
      path: [fleet.location],
      currentLegIndex: 0,
      etaTick: currentTick,
      repeat: false,
    };
    return {
      updatedFleet: { ...fleet, orders: [order, ...fleet.orders] },
      ok: true,
      order,
    };
  }

  // 2. Для остальных — нужен путь
  const path = planRoute(fleet.location, targetId, galaxy);
  if (!path || path.length === 0) {
    return {
      updatedFleet: fleet,
      ok: false,
      reason: 'no_route',
    };
  }

  // 3. Travel stats + time
  const fleetStats = calculateFleetStats(fleet, ships, designs);
  const travelTime = calculateTravelTime(path, fleetStats, galaxy);
  if (travelTime === Infinity) {
    return {
      updatedFleet: fleet,
      ok: false,
      reason: 'no_jump_drive',
    };
  }

  // 4. Создать order
  const order: FleetOrder = {
    type: orderType,
    targetId,
    issuedTick: currentTick,
    path,
    currentLegIndex: 0,
    etaTick: currentTick + travelTime,
    repeat: orderType === 'patrol',
  };

  return {
    updatedFleet: { ...fleet, orders: [order, ...fleet.orders] },
    ok: true,
    order,
  };
}

// ─── Helpers для UI ───────────────────────────────────────────────────────

/**
 * Список систем, в которые флот может переместиться (есть путь через JP).
 * Для UI: показывает валидные цели в dropdown.
 */
export function listReachableSystems(
  fromSystemId: EntityId,
  galaxy: Galaxy,
): StarSystem[] {
  const graph = buildJumpGraph(galaxy);
  const visited = new Set<EntityId>([fromSystemId]);
  const queue: EntityId[] = [fromSystemId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbors = graph.get(cur);
    if (!neighbors) continue;
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  // Системы доступны, кроме текущей (нет смысла «перелететь» в ту же систему)
  visited.delete(fromSystemId);
  const out: StarSystem[] = [];
  for (const sys of galaxy.systems) {
    if (visited.has(sys.id)) out.push(sys);
  }
  return out;
}

/**
 * Проверить, имеет ли флот активный приказ (orders[0] существует).
 */
export function hasActiveOrder(fleet: Fleet): boolean {
  return fleet.orders.length > 0;
}

/**
 * Получить текущий активный приказ флота (orders[0]) или undefined.
 */
export function getCurrentOrder(fleet: Fleet): FleetOrder | undefined {
  return fleet.orders[0];
}
