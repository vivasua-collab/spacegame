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

import type { EntityId, Fleet, Ship } from '@/core/types';
import { emptyFuelStore, ALL_FUEL_TYPES } from '@/data/ships/fuel-map';

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
// (Implemented in Phase 2.6 — see end of file after Phase 2.6 work)
