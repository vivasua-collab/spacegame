/**
 * Публичные экспорты ядра (core).
 *
 * Структура:
 * - types.ts          — игровые типы (EntityId, GameState, Planet, ...)
 * - events.ts         — карта типизированных событий (EventMap)
 * - typed-event-bus.ts — типизированная шина событий
 * - module-types.ts   — контракт модуля (IGameModule, ModuleManifest, ...)
 * - module-registry.ts — реестр модулей
 * - game-loop.ts      — игровой цикл
 * - game-mediator.ts  — центральный оркестратор
 * - event-bus.ts      — legacy-адаптер (deprecated)
 * - prng.ts           — детерминированный ГПСЧ
 */

// Типы
export type {
  EntityId, Vec2, AxialCoord, GameTime, GameSpeed, GamePhase,
  StarType, StarDef, BinaryType,
  PlanetType, PlanetSize, HexTerrain, AtmosphereType, Atmosphere, LifeLevel, PlanetLife, PlanetDef,
  ChemicalCharacter, ElementRarity, ElementCategory, ElementDef,
  BuildingCategory, BuildingLayer, BuildingDef,
  RecipeCategory, RecipeDef,
  HullSize, HullDef, ModuleType, ModuleDef,
  ResourceDeposit, HexCell, AtmosphericSlot, OrbitalSlot, Planet, PlanetResourceDeposit,
  WarehouseReserve, WarehouseSpecialization, ColonyRole, PlanetWarehouse,
  Star, JumpPoint, StarSystem, Galaxy,
  Ship, Fleet, FleetOrder, ProductionQueue, ProductionItem, GameState,
} from './types';

// События
export type { EventMap, EventName, EventPayload, EventHandler } from './events';
export type {
  CoreEvents, GalaxyEvents, EconomyEvents, ShipsEvents,
  FleetEvents, CombatEvents, TechEvents, DiplomacyEvents,
  TradeEvents, AIEvents,
} from './events';

// Шина событий
export { TypedEventBus, gameBus } from './typed-event-bus';
export type { SubscriptionOptions } from './typed-event-bus';

// Контракт модуля
export type { ModuleId, ModulePhase, EventSubscription, QueryDeclaration, ModuleManifest, IGameModule } from './module-types';
export { PRIORITY } from './module-types';

// Реестр модулей
export { ModuleRegistry } from './module-registry';

// Игровой цикл
export { GameLoop } from './game-loop';

// Медиатор
export { GameMediator, getGameMediator, resetGameMediator } from './game-mediator';

// Legacy (deprecated)
export { EventBus, gameBus as legacyGameBus } from './event-bus';

// PRNG
export { Xoshiro256 } from './prng';
