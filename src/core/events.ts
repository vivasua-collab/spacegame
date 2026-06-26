/**
 * Карта типизированных событий игры.
 *
 * Все межмодульные события проходят через эту карту.
 * Формат ключа: `module:action`
 *   module — имя модуля (core, galaxy, economy, ships, fleet, combat, tech, diplomacy, trade, ai)
 *   action — действие или результат (tick, build, colonized, arrived, completed, ...)
 *
 * Добавление нового события:
 * 1. Добавить ключ в EventMap в формате `module:action`
 * 2. Указать тип полезной нагрузки (void для событий без данных)
 * 3. Обновить манифест модуля (emits / subscribes)
 */

import type { EntityId, GameTime, GameSpeed } from './types';

// ─── Core ─────────────────────────────────────────────────

export interface CoreEvents {
  'core:tick': GameTime;
  'core:year': GameTime;
  'core:started': void;
  'core:paused': void;
  'core:resumed': void;
  'core:speed-changed': GameSpeed;
  'core:game-created': { galaxyId: EntityId; seed: number };
  'core:game-loaded': { saveId: string };
}

// ─── Galaxy ───────────────────────────────────────────────

export interface GalaxyEvents {
  'galaxy:generated': { galaxyId: EntityId; systemCount: number; seed: number };
  'galaxy:system-discovered': { systemId: EntityId; byFactionId: EntityId };
  'galaxy:system-surveyed': { systemId: EntityId; byFactionId: EntityId };
}

// ─── Economy ──────────────────────────────────────────────

export interface EconomyEvents {
  'economy:build': { planetId: EntityId; hexIndex: number; buildingId: string };
  'economy:building-constructed': { planetId: EntityId; hexIndex: number; buildingId: string };
  'economy:upgrade': { planetId: EntityId; hexIndex: number };
  'economy:building-upgraded': { planetId: EntityId; hexIndex: number; level: number };
  'economy:enqueue': { planetId: EntityId; recipeId: string; repeat: boolean };
  'economy:production-complete': { planetId: EntityId; recipeId: string };
  'economy:colonize': { planetId: EntityId };
  'economy:planet-colonized': { planetId: EntityId; hexIndex: number };
  'economy:energy-recalced': { planetId: EntityId; balance: number };
  'economy:resource-depleted': { planetId: EntityId; elementId: string; hexIndex: number };
  'economy:warehouse-full': { planetId: EntityId };
  'economy:warehouse-updated': { planetId: EntityId; capacity: number; used: number };
}

// ─── Ships ────────────────────────────────────────────────

export interface ShipsEvents {
  'ships:designed': { designId: EntityId; hullId: string; moduleCount: number };
  'ships:constructed': { shipId: EntityId; designId: EntityId; owner: EntityId };
  'ships:destroyed': { shipId: EntityId; systemId: EntityId; byFactionId?: EntityId };
  'ships:movement-started': { shipId: EntityId; from: EntityId; to: EntityId; etaTick: number };
  'ships:arrived': { shipId: EntityId; systemId: EntityId };
  'ships:damaged': { shipId: EntityId; hp: number; maxHp: number };
  'ships:repaired': { shipId: EntityId; hp: number };
}

// ─── Fleet ────────────────────────────────────────────────

export interface FleetEvents {
  'fleet:created': { fleetId: EntityId; owner: EntityId; shipCount: number };
  'fleet:order-issued': { fleetId: EntityId; orderType: string; targetId: EntityId };
  'fleet:order-completed': { fleetId: EntityId; orderType: string; targetId: EntityId };
  'fleet:merged': { fleetId: EntityId; fromFleetIds: EntityId[] };
  'fleet:split': { fleetId: EntityId; newFleetId: EntityId };
}

// ─── Combat ───────────────────────────────────────────────

export interface CombatEvents {
  'combat:engaged': { systemId: EntityId; attackerFactionId: EntityId; defenderFactionId: EntityId };
  'combat:round': { systemId: EntityId; round: number; attackerDmg: number; defenderDmg: number };
  'combat:resolved': { systemId: EntityId; winnerFactionId: EntityId; losses: { factionId: EntityId; shipCount: number }[] };
  'combat:planet-bombarded': { planetId: EntityId; damage: number; buildingsDestroyed: number };
}

// ─── Tech ─────────────────────────────────────────────────

export interface TechEvents {
  'tech:research-started': { techId: string; factionId: EntityId; etaTick: number };
  'tech:research-completed': { techId: string; factionId: EntityId };
  'tech:unlocked': { techId: string; factionId: EntityId; unlocks: string[] };
}

// ─── Diplomacy ────────────────────────────────────────────

export interface DiplomacyEvents {
  'diplomacy:proposal': { fromFactionId: EntityId; toFactionId: EntityId; type: string };
  'diplomacy:accepted': { fromFactionId: EntityId; toFactionId: EntityId; type: string };
  'diplomacy:rejected': { fromFactionId: EntityId; toFactionId: EntityId; type: string };
  'diplomacy:relations-changed': { factionA: EntityId; factionB: EntityId; delta: number; newScore: number };
  'diplomacy:war-declared': { attackerFactionId: EntityId; defenderFactionId: EntityId };
  'diplomacy:peace-signed': { factionA: EntityId; factionB: EntityId };
}

// ─── Trade ────────────────────────────────────────────────

export interface TradeEvents {
  'trade:offer-created': { offerId: EntityId; factionId: EntityId; resourceId: string; amount: number; price: number };
  'trade:offer-accepted': { offerId: EntityId; buyerFactionId: EntityId };
  'trade:route-established': { routeId: EntityId; fromPlanetId: EntityId; toPlanetId: EntityId; resourceId: string };
  'trade:route-completed': { routeId: EntityId; delivered: number };
  'trade:route-raided': { routeId: EntityId; raiderFactionId: EntityId; stolen: number };
}

// ─── AI ───────────────────────────────────────────────────

export interface AIEvents {
  'ai:decision': { factionId: EntityId; action: string; targetId?: EntityId };
  'ai:colony-founded': { factionId: EntityId; planetId: EntityId };
  'ai:fleet-sent': { factionId: EntityId; fleetId: EntityId; purpose: string };
}

// ─── Агрегация ────────────────────────────────────────────

/**
 * Полная карта типизированных событий.
 * Ключ = имя события (module:action), значение = тип payload.
 */
export type EventMap = CoreEvents & GalaxyEvents & EconomyEvents & ShipsEvents &
  FleetEvents & CombatEvents & TechEvents & DiplomacyEvents & TradeEvents & AIEvents;

/** Тип имени события из EventMap */
export type EventName = keyof EventMap;

/** Тип полезной нагрузки для конкретного события */
export type EventPayload<E extends EventName> = EventMap[E];

/** Полный тип обработчика события */
export type EventHandler<E extends EventName> = (payload: EventPayload<E>) => void;
