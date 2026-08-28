/**
 * Shared helper: find a planet by its EntityId across the whole galaxy.
 *
 * Audit Pass 2 P3-3: previously the same O(S×P) loop was duplicated in:
 * - `src/economy/economy-module.ts` (private findPlanet)
 * - `src/ships/ships-module.ts`    (private findPlanet)
 * - `src/stores/game-store.ts`    (module-private findPlanet)
 * - `src/galaxy/galaxy-module.ts` (queryPlanetById — left as-is,
 *   different abstraction layer; can call this helper internally)
 *
 * This module is the single source of truth. The exported function is
 * pure (no side-effects), accepts a frozen GameState, and returns
 * `undefined` when no planet matches.
 *
 * Note: O(S×P) per call. For per-tick hot paths that look up many
 * planets, build a `Map<EntityId, Planet>` cache instead (see Pass 2
 * P2-2 for the index-build recommendation). This helper is the
 * correctness reference — caches must agree with it.
 */

import type { GameState, EntityId, Planet } from './types';

/**
 * Find a planet by ID across all systems in the galaxy.
 *
 * @param state    — current GameState (any immer-produced ref is fine).
 * @param planetId — entity ID of the planet to find.
 * @returns the Planet if found, otherwise `undefined`.
 */
export function findPlanet(state: GameState, planetId: EntityId): Planet | undefined {
  for (const system of state.galaxy.systems) {
    const planet = system.planets.find((p) => p.id === planetId);
    if (planet) return planet;
  }
  return undefined;
}
