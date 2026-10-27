/**
 * Этап 3а (R-41): построение world model и perception snapshot.
 *
 * ЧИСТЫЕ функции: читают GameState, не мутируют ни его, ни что-либо
 * глобальное. Детерминизм:
 * - итерации по массивам (galaxy.systems, system.planets, state.fleets) —
 *   стабильный порядок; state.ships — Map, используется только размер/счётчик
 *   по owner (порядок обхода не влияет на результат);
 * - ключи Record собираются с явной сортировкой (стабильный порядок
 *   сериализации — сравнение/хеширование снапшотов);
 * - никаких обращений к wall-clock, PRNG и неустойчивым коллекциям.
 *
 * Defensive copy: результаты содержат только новые объекты/массивы и
 * примитивы — ни одной ссылки на GameState (проверяется тестом 3а).
 */

import type { EntityId, GameState } from '@/core/types';
import { AI_STATE_VERSION } from '@/ai/types';
import type { AIWorldModel, AIPerceptionSnapshot } from '@/ai/types';

/**
 * Собрать Record с отсортированными ключами (детерминизм сериализации).
 * Значения — копии (для массивов: отсортированные копии).
 */
function sortedRecord<T>(source: Map<string, T>, sortArrays: boolean): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Array.from(source.keys()).sort()) {
    const value = source.get(key)!;
    if (sortArrays && Array.isArray(value)) {
      out[key] = [...(value as unknown as unknown[])].sort() as unknown as T;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Построить общую (shared) модель мира из GameState.
 *
 * Лёгкие агрегаты: владение системами (по owner колонизированных планет),
 * счётчики планет/флотов/кораблей по owner. Планеты, гексы, залежи и
 * прочие тяжёлые данные НЕ копируются (граница «не копировать весь мир
 * в каждую фракцию» — Issue #5 п.2).
 */
export function buildWorldModel(state: GameState): AIWorldModel {
  const systemsByOwner = new Map<string, string[]>();
  const planetCountByOwner = new Map<string, number>();
  let colonizedSystemCount = 0;

  for (const system of state.galaxy.systems) {
    // Владение системой = владение хотя бы одной её планетой.
    const owners = new Set<string>();
    for (const planet of system.planets) {
      if (planet.owner != null) {
        owners.add(planet.owner);
        planetCountByOwner.set(planet.owner, (planetCountByOwner.get(planet.owner) ?? 0) + 1);
      }
    }
    if (owners.size > 0) {
      colonizedSystemCount++;
      for (const owner of owners) {
        const list = systemsByOwner.get(owner);
        if (list) list.push(system.id);
        else systemsByOwner.set(owner, [system.id]);
      }
    }
  }

  const fleetCountByOwner = new Map<string, number>();
  for (const fleet of state.fleets) {
    fleetCountByOwner.set(fleet.owner, (fleetCountByOwner.get(fleet.owner) ?? 0) + 1);
  }

  const shipCountByOwner = new Map<string, number>();
  for (const ship of state.ships.values()) {
    shipCountByOwner.set(ship.owner, (shipCountByOwner.get(ship.owner) ?? 0) + 1);
  }

  return {
    stateVersion: AI_STATE_VERSION,
    builtAtTick: state.time.tick,
    year: state.time.year,
    galaxyId: state.galaxy.id,
    seed: state.galaxy.seed,
    systemCount: state.galaxy.systems.length,
    colonizedSystemCount,
    systemsByOwner: sortedRecord(systemsByOwner, true),
    planetCountByOwner: sortedRecord(planetCountByOwner, false),
    fleetCountByOwner: sortedRecord(fleetCountByOwner, false),
    shipCountByOwner: sortedRecord(shipCountByOwner, false),
  };
}

/**
 * Построить снимок восприятия контроллера на основе world model.
 *
 * Defensive copy: ownedSystems — свежий отсортированный массив (копия
 * world model), остальные поля — примитивы. Фракция без владений
 * получает пустой массив (легитимный случай 3а: контроллер подключён,
 * но империя ещё не существует).
 */
export function buildPerception(world: AIWorldModel, factionId: EntityId, tick: number): AIPerceptionSnapshot {
  const ownedSystems = [...(world.systemsByOwner[factionId] ?? [])].sort();
  return {
    stateVersion: AI_STATE_VERSION,
    factionId,
    tick,
    worldModelTick: world.builtAtTick,
    ownedSystems,
    colonyCount: world.planetCountByOwner[factionId] ?? 0,
    // Видимость 3а тривиальна: фракция «знает» все системы мира
    // (fog-of-war per-faction отсутствует — точка расширения 3б).
    knownSystemCount: world.systemCount,
    fleetCount: world.fleetCountByOwner[factionId] ?? 0,
    shipCount: world.shipCountByOwner[factionId] ?? 0,
  };
}
