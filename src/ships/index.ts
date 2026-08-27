/**
 * Block 02 (F1-F7): Публичные экспорты модуля кораблей и флотов.
 *
 * Структура:
 * - designer.ts — validateShip, calculateDesignStats, armorMultiplier (F2)
 * - orders.ts   — planRoute, calculateTravelTime, executeOrder, resolveCombat stub (F4)
 * - fleet-engine.ts — createFleet, mergeFleets, splitFleet, processFleetTick (F3, F5)
 * - ships-module.ts — ShipsModule (IGameModule) — processShipyardTick integration
 * - fleet-module.ts — FleetModule (IGameModule) — processFleetTick integration
 *
 * UI components в src/components/game/: ship-designer, shipyard-dialog,
 * fleet-view, ship-card, fleet-orders-panel, fleet-route-overlay.
 */

// Engine exports
export {
  armorMultiplier,
  validateShip,
  calculateDesignStats,
  createBlankDesign,
} from './designer';

export type { DesignStats } from './designer';

export {
  planRoute,
  calculateTravelTime,
  calculateFleetStats,
  executeOrder,
  resolveCombat,
  canColonizePlanet,
  listReachableSystems,
  hasActiveOrder,
  getCurrentOrder,
  JUMP_RECHARGE_TICKS,
  TRAVEL_SCALE,
} from './orders';

export type {
  FleetTravelStats,
  CombatResult,
  ExecuteOrderResult,
} from './orders';

export {
  createFleet,
  mergeFleets,
  splitFleet,
  getFleetAt,
  getFleetsAt,
  getFleetById,
  getFleetShips,
  getLooseShips,
  processFleetTick,
  consumeFuel,
  completeOrder,
} from './fleet-engine';

export type { ProcessFleetTickResult } from './fleet-engine';

// Module exports
export { ShipsModule, resetShipCounter } from './ships-module';
export { FleetModule } from './fleet-module';
