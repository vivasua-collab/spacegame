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

import type { EntityId, GameTime, GameSpeed, GameState, BuildingLayer, ProcessorRecipeCategory, FundamentalBranchId } from './types';

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
  /**
   * Состояние игры изменилось.
   * Эмитится медиатором и модулями после любой мутации GameState,
   * чтобы Zustand-store мог синхронизировать свою реактивную копию.
   * Payload — ссылка на актуальный GameState (не клон; клон делает store).
   */
  'core:state-changed': GameState;
}

// ─── Galaxy ───────────────────────────────────────────────

export interface GalaxyEvents {
  'galaxy:generated': { galaxyId: EntityId; systemCount: number; seed: number };
  'galaxy:system-discovered': { systemId: EntityId; byFactionId: EntityId };
  'galaxy:system-surveyed': { systemId: EntityId; byFactionId: EntityId };
}

// ─── Economy ──────────────────────────────────────────────

export interface EconomyEvents {
  /**
   * Построить здание. Block 01 P3: добавлены опциональные поля `layer` и
   * `slotIndex` для поддержки atmospheric/orbit слотов.
   *
   * - Поведение по умолчанию (backward-compat): `layer` отсутствует или
   *   `'surface'` — интерпретируется как постройка на гексе, индекс берётся
   *   из `hexIndex`. Существующие emit-вызовы в тестах и UI не требуют
   *   правок.
   * - `layer: 'atmosphere'` — постройка на atmospheric-слоте, индекс берётся
   *   из `slotIndex` (игнорирует `hexIndex`).
   * - `layer: 'orbit'` — постройка на orbit-слоте, индекс берётся из
   *   `slotIndex` (игнорирует `hexIndex`).
   */
  'economy:build': { planetId: EntityId; buildingId: string; hexIndex?: number; slotIndex?: number; layer?: BuildingLayer };
  'economy:building-constructed': { planetId: EntityId; hexIndex: number; buildingId: string };
  'economy:upgrade': { planetId: EntityId; hexIndex: number };
  'economy:building-upgraded': { planetId: EntityId; hexIndex: number; level: number };
  'economy:enqueue': { planetId: EntityId; recipeId: string; repeat: boolean };
  'economy:production-complete': { planetId: EntityId; recipeId: string };
  'economy:production-cancelled': { planetId: EntityId; recipeId: string; queueItemId: string; reason: 'recipe_not_found' | 'insufficient_inputs' };
  'economy:colonize': { planetId: EntityId };
  'economy:planet-colonized': { planetId: EntityId; hexIndex: number };
  'economy:energy-recalced': { planetId: EntityId; balance: number };
  'economy:resource-depleted': { planetId: EntityId; elementId: string; hexIndex: number };
  'economy:warehouse-full': { planetId: EntityId };
  'economy:warehouse-updated': { planetId: EntityId; capacity: number; used: number };
  // ─── Block 05 PR7: входящие события специализации (store → module) ──
  /** Инициировать специализацию или откат к universal (store → engine.specializeBuilding). */
  'economy:specialize': {
    planetId: EntityId;
    hexIndex: number;
    category: ProcessorRecipeCategory | 'universal';
  };
  /** Повысить specializationLevel (store → engine.upgradeSpecialization). */
  'economy:upgrade-specialization': { planetId: EntityId; hexIndex: number };
  // ─── Block 05 PR7: исходящие события специализации (engine → listeners) ──
  /** Эмитится после specializeBuilding (включая откат к universal). */
  'economy:building-specialized': {
    planetId: EntityId;
    hexIndex: number;
    specialization: ProcessorRecipeCategory | 'universal';
    specializationLevel: number;
  };
  /** Эмитится после upgradeSpecialization (+1 уровень). */
  'economy:specialization-upgraded': {
    planetId: EntityId;
    hexIndex: number;
    specializationLevel: number;
  };
  /**
   * Эмитится после любого изменения, влияющего на выход процессора
   * (specialize/upgrade/activeRecipes change) — чтобы UI перерисовал
   * плашку коэф. выхода и чистоты.
   */
  'economy:processor-output-changed': {
    planetId: EntityId;
    hexIndex: number;
    yieldMult: number;
    purity: number;
  };
  /** (PR3-full, отложено) При изменении набора активных рецептов здания. */
  'economy:active-recipes-changed': {
    planetId: EntityId;
    hexIndex: number;
    activeRecipes: string[];
  };
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
  // ─── Block 02 (F2, F5, F7): новые события для флота/верфи ──
  /** Эмитится после validateShip — подтверждает валидность дизайна (для UI тоста). */
  'ships:design-validated': { designId: EntityId; valid: boolean; errors: string[] };
  /** Эмитится при постановке дизайна в очередь верфи (F6). */
  'ships:construction-started': { planetId: EntityId; designId: EntityId; shipId: EntityId; etaTick: number };
  /** Эмитится на каждом тике постройки (для UI прогресс-бара). */
  'ships:construction-progress': { planetId: EntityId; shipId: EntityId; progressTicks: number; totalTicks: number };
  /** Эмитится при списании топлива с флота в пути (F5). */
  'ships:fuel-consumed': { fleetId: EntityId; fuelType: string; amount: number; remaining: number };
}

// ─── Fleet ────────────────────────────────────────────────

export interface FleetEvents {
  'fleet:created': { fleetId: EntityId; owner: EntityId; shipCount: number };
  'fleet:order-issued': { fleetId: EntityId; orderType: string; targetId: EntityId };
  'fleet:order-completed': { fleetId: EntityId; orderType: string; targetId: EntityId };
  'fleet:merged': { fleetId: EntityId; fromFleetIds: EntityId[] };
  'fleet:split': { fleetId: EntityId; newFleetId: EntityId };
  // ─── Block 02 (F4, F5, F7): новые события для движения/приказов ──
  /** Эмитится при начале движения флота по маршруту (F5). */
  'fleet:movement-started': { fleetId: EntityId; fromSystemId: EntityId; toSystemId: EntityId; path: EntityId[]; etaTick: number };
  /** Эмитится при прибытии флота в систему на маршруте (F5). */
  'fleet:arrived': { fleetId: EntityId; systemId: EntityId };
  /** Эмитится при отмене приказа (ручная отмена / нет пути / нет топлива). */
  'fleet:order-cancelled': { fleetId: EntityId; orderType: string; reason: 'manual' | 'impossible' | 'fuel' };
  /** Эмитится когда топливо флота падает ниже порога для завершения leg. */
  'fleet:fuel-low': { fleetId: EntityId; remainingFuel: number; requiredFuel: number };
  /** Эмитится когда флот застрял в системе без топлива (F5). */
  'fleet:stranded': { fleetId: EntityId; systemId: EntityId };
}

// ─── Combat ───────────────────────────────────────────────

export interface CombatEvents {
  'combat:engaged': { systemId: EntityId; attackerFactionId: EntityId; defenderFactionId: EntityId };
  'combat:round': { systemId: EntityId; round: number; attackerDmg: number; defenderDmg: number };
  'combat:resolved': { systemId: EntityId; winnerFactionId: EntityId; losses: { factionId: EntityId; shipCount: number }[] };
  'combat:planet-bombarded': { planetId: EntityId; damage: number; buildingsDestroyed: number };
}

// ─── Tech ─────────────────────────────────────────────────

/**
 * Block 03 (R7): события исследований.
 *
 * Существующие 3 (расширяем payload для тех, которые нужны с детальной информацией):
 * - tech:research-completed теперь включает `level` и `unlocks` (что разблокировано).
 *
 * Новые 6 событий (plan §5):
 * - tech:research-cancelled — слот отменён игроком (rpRefunded возвращается в банк).
 * - tech:allocation-changed — изменена аллокация слота (UI).
 * - tech:fundamental-leveled — фундаментальная ветка повышена.
 * - tech:prerequisites-met — изменилась доступность tech (после level up).
 * - tech:tree-validated — дерево провалидировано (start-up / dev-mode).
 * - tech:research-rejected — startResearch отклонён (с причинами).
 */
export interface TechEvents {
  /** Слот исследования запущен (techId + targetLevel + ETA). */
  'tech:research-started': { techId: string; factionId: EntityId; targetLevel: number; etaTick: number };
  /** Уровень технологии завершён — emits и unlocks для UI/модулей. */
  'tech:research-completed': { techId: string; factionId: EntityId; level: number; unlocks: string[] };
  /** Разблокировка (recipe/module/building) применена к state. */
  'tech:unlocked': { techId: string; factionId: EntityId; unlocks: string[] };
  // ─── Block 03 (R7) — новые события ──────────────────────
  /** Слот отменён игроком. */
  'tech:research-cancelled': { slotId: string; factionId: EntityId; techId: string; rpRefunded: number };
  /** Аллокация слотов изменена (для синхронизации UI). */
  'tech:allocation-changed': { factionId: EntityId; slots: Array<{ slotId: string; percent: number }> };
  /** Фундаментальная ветка повышена на 1 уровень. */
  'tech:fundamental-leveled': { branchId: FundamentalBranchId; factionId: EntityId; newLevel: number };
  /** Доступность технологии изменилась (после level up). */
  'tech:prerequisites-met': { techId: string; factionId: EntityId; met: boolean; missing: string[] };
  /** Дерево провалидировано (start-up). */
  'tech:tree-validated': { ok: boolean; errors: string[] };
  /** StartResearch отклонён (причины для UI). */
  'tech:research-rejected': { techId: string; factionId: EntityId; reasons: string[] };
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
