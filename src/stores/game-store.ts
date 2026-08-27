/**
 * Основной Zustand-стор для игрового состояния.
 *
 * Версия 4.0 (Block 01 P2): обёрнут в immer-middleware.
 * Все set()-вызовы используют draft-мутации — immer создаёт новые
 * ссылки для изменённых путей, что позволяет `useMemo([gameState.galaxy.systems])`
 * корректно срабатывать после любой мутации.
 *
 * Версия 3.0: Работает через GameMediator.
 * Стор делегирует действия медиатору и модулям,
 * а сам отвечает за реактивность (React re-renders).
 *
 * Паттерн:
 * - Мутации → через модули/медиатор (движок) с immer produce()
 * - Реактивность → через Zustand set() (UI)
 * - События → через TypedEventBus (межмодульное взаимодействие)
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { produce } from 'immer';
import type { GameState, GameTime, GameSpeed, GamePhase, Galaxy, StarSystem, Planet, EntityId, ProductionQueue, ColonyRole, WarehouseSpecialization } from '@/core/types';
import '@/core/immer-setup'; // Block 01 P2: enableMapSet + setAutoFreeze(false)
import { getGameMediator } from '@/core/game-mediator';
import { applyColonyRole, calculateWarehouseCapacity, calculateWarehouseCapacities, canStoreResource, getOrbitBufferUsed } from '@/data/warehouse';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { setCurrentLookups } from '@/data/baked-lookups';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { resetProductionItemCounter } from '@/economy/engine';
import { BUILDING_MAP } from '@/data/buildings'; // Block 05 PR7 — migratePlanet
import { SerializedGameStateSchema } from '@/lib/schemas/game-state-schema'; // Block 08 gap-9: state validation on deserialize
import { enqueueShipBuild as enqueueShipBuildFn, cancelShipyardItem as cancelShipyardItemFn } from '@/data/ships/shipyard-queue'; // Block 02 F6
import { ShipsModule, resetShipCounter } from '@/ships/ships-module'; // Block 02 F5
import { FleetModule } from '@/ships/fleet-module'; // Block 02 F5
import {
  createFleet as createFleetFn,
  mergeFleets as mergeFleetsFn,
  splitFleet as splitFleetFn,
  getFleetById as getFleetByIdFn,
  getFleetsAt as getFleetsAtFn,
  getLooseShips as getLooseShipsFn,
} from '@/ships/fleet-engine'; // Block 02 F3
import { executeOrder as executeOrderFn } from '@/ships/orders'; // Block 02 F4

// ============ Типы стора ============

export type GameView = 'galaxy' | 'system' | 'planet' | 'ship-designer' | 'fleet';

/**
 * Block 02 (F2): детерминированный счётчик ID дизайнов кораблей.
 * Аналог productionItemCounter из engine.ts — без Math.random(),
 * для соблюдения детерминизма игры (Block 07 gap-3).
 */
let shipDesignCounter = 0;

/**
 * Block 02 (F6): детерминированный счётчик ID элементов очереди верфи.
 */
let shipyardItemCounter = 0;

/**
 * Block 02 (F3): детерминированный счётчик ID флотов.
 * Без Math.random — для детерминизма (Block 07 gap-3).
 * (shipCounter для ID построенных кораблей добавляется в Phase 2.6 — ShipsModule.)
 */
let fleetCounter = 0;

export interface SaveInfo {
  id: string;
  name: string;
  seed: number;
  tick: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameStore {
  // === Состояние ===
  gameState: GameState | null;
  view: GameView;
  selectedSystemId: EntityId | null;
  selectedPlanetId: EntityId | null;
  /** Block 02 (F7): currently selected fleet (for galaxy-map right-click
   *  context menu — «Перебросить флот сюда» issues move order to this fleet). */
  selectedFleetId: EntityId | null;
  isInitialized: boolean;
  currentSaveId: string | null;
  isSaving: boolean;
  saveError: string | null;
  isLoading: boolean;

  // === Действия ===
  newGame: (config?: Partial<import('@/galaxy').GalaxyGenConfig>) => void;
  setSpeed: (speed: GameSpeed) => void;
  togglePause: () => void;
  tick: () => void;

  // Навигация
  setView: (view: GameView) => void;
  selectSystem: (id: EntityId | null) => void;
  selectPlanet: (id: EntityId | null) => void;

  // Экономика
  buildOnHex: (planetId: EntityId, hexIndex: number, buildingId: string) => boolean;
  buildOnAtmosphereSlot: (planetId: EntityId, slotIndex: number, buildingId: string) => boolean;
  buildOnOrbitSlot: (planetId: EntityId, slotIndex: number, buildingId: string) => boolean;
  upgradeBuildingOnHex: (planetId: EntityId, hexIndex: number) => boolean;
  enqueueProduction: (planetId: EntityId, recipeId: string, repeat?: boolean) => boolean;
  cancelProduction: (planetId: EntityId, queueItemId: string) => boolean;
  // Block 05 PR7 — специализация переработчиков
  specializeBuildingOnHex: (
    planetId: EntityId,
    hexIndex: number,
    category: import('@/core/types').ProcessorRecipeCategory | 'universal',
  ) => boolean;
  upgradeSpecializationOnHex: (planetId: EntityId, hexIndex: number) => boolean;

  // Колонизация
  colonizePlanet: (planetId: EntityId) => boolean;

  // Склад
  setColonyRole: (planetId: EntityId, role: ColonyRole) => void;
  setReserveMinimum: (planetId: EntityId, resourceId: string, minimum: number) => void;
  setWarehouseSpecialization: (planetId: EntityId, spec: WarehouseSpecialization) => void;
  moveToOrbit: (planetId: EntityId, resourceId: string, amount: number) => boolean;
  moveFromOrbit: (planetId: EntityId, resourceId: string, amount: number) => boolean;

  // Сохранение/загрузка
  saveGame: (name?: string) => Promise<boolean>;
  loadGame: (id: string) => Promise<boolean>;
  loadSaveList: () => Promise<SaveInfo[]>;
  deleteSave: (id: string) => Promise<boolean>;

  // ─── Block 02 (F2): Конструктор кораблей ────────────────
  /** Сохранить дизайн корабля в GameState.shipDesigns. Возвращает id или null. */
  saveShipDesign: (design: Omit<import('@/core/types').ShipDesign, 'id' | 'createdAtTick'> & { id?: string }) => string | null;
  /** Удалить дизайн корабля по id. */
  deleteShipDesign: (id: string) => boolean;
  /** Получить дизайн по id. */
  getShipDesign: (id: string) => import('@/core/types').ShipDesign | undefined;
  /** Список всех дизайнов игрока. */
  listShipDesigns: () => import('@/core/types').ShipDesign[];

  // ─── Block 02 (F6): Верфь — постройка кораблей ──────────
  /** Поставить дизайн в очередь постройки на верфи планеты. Возвращает itemId или null. */
  enqueueShipBuild: (planetId: string, designId: string, shipName?: string) => string | null;
  /** Отменить элемент очереди постройки. */
  cancelShipyardItem: (planetId: string, itemId: string) => boolean;
  /** Получить очередь постройки планеты. */
  getShipyardQueue: (planetId: string) => import('@/core/types').ShipyardQueue | undefined;

  // ─── Block 02 (F3): Флот-менеджер — create/merge/split ───
  /** Создать новый флот из выбранных кораблей. Возвращает id нового флота или null. */
  createFleet: (name: string, shipIds: string[], atSystemId: string) => string | null;
  /** Объединить несколько флотов в один. Возвращает id нового флота или null. */
  mergeFleets: (fleetIds: string[]) => string | null;
  /** Разделить флот на два: оставшийся + извлечённый. Возвращает id извлечённого флота или null. */
  splitFleet: (sourceFleetId: string, shipIdsToExtract: string[], newName?: string) => string | null;
  /** Переименовать флот. */
  renameFleet: (fleetId: string, newName: string) => boolean;
  /** Получить флот по id (sync lookup). */
  getFleet: (fleetId: string) => import('@/core/types').Fleet | undefined;
  /** Получить все флоты в указанной системе. */
  getFleetsAtSystem: (systemId: string) => import('@/core/types').Fleet[];
  /** Получить корабль по id. */
  getShip: (shipId: string) => import('@/core/types').Ship | undefined;
  /** Получить «свободные» корабли игрока на локации (planetId или systemId). */
  getLooseShips: (ownerId: string, location?: string) => import('@/core/types').Ship[];

  // ─── Block 02 (F4): Приказы флотов ─────────────────────
  /** Отдать приказ флоту. type — move/patrol/colonize/attack/defend. Возвращает true если успешно. */
  issueFleetOrder: (
    fleetId: string,
    type: import('@/core/types').FleetOrder['type'],
    targetId: string,
  ) => boolean;
  /** Отменить текущий приказ флота (снимает orders[0]). */
  cancelFleetOrder: (fleetId: string) => boolean;
  /** Block 02 (F7): выбрать флот (для контекстного меню galaxy-map). */
  selectFleet: (fleetId: EntityId | null) => void;

  // Утилиты
  getSystem: (id: EntityId) => StarSystem | undefined;
  getPlanet: (id: EntityId) => Planet | undefined;
  getSelectedSystem: () => StarSystem | undefined;
  getSelectedPlanet: () => Planet | undefined;
}

// ============ Медиатор (инициализация) ============

/** Флаг: были ли модули уже зарегистрированы */
let modulesRegistered = false;

/**
 * Получить медиатор с зарегистрированными модулями.
 * Также подписывается на `core:state-changed` один раз —
 * это позволяет модулям и медиатору синхронизировать Zustand-store
 * после любой мутации GameState (patrn 3.6 из Block 06).
 */
function getMediatorWithModules() {
  const mediator = getGameMediator();

  if (!modulesRegistered) {
    const economyModule = new EconomyModule();
    const galaxyModule = new GalaxyModule();
    // Block 02 (F5, F7): ships + fleet modules — shipyard queue processing
    // (priority SIMULATION+10, after economy) + fleet movement via JP
    // (priority SIMULATION+20, after ships). Both need GameState accessor +
    // mutator to commit immutable produced state (Block 01 P2 pattern).
    const shipsModule = new ShipsModule();
    const fleetModule = new FleetModule();

    // Модули нуждаются в доступе к GameState — устанавливаем accessor.
    // Block 01 P2: also set a mutator so modules can commit new immutable state
    // (produced via immer.produce) back to the mediator.
    economyModule.setGameStateAccessor(() => mediator.getGameState());
    economyModule.setGameStateMutator((state) => mediator.commitState(state));
    galaxyModule.setGameStateAccessor(() => mediator.getGameState());
    galaxyModule.setGameStateMutator((state) => mediator.commitState(state));
    shipsModule.setGameStateAccessor(() => mediator.getGameState());
    shipsModule.setGameStateMutator((state) => mediator.commitState(state));
    fleetModule.setGameStateAccessor(() => mediator.getGameState());
    fleetModule.setGameStateMutator((state) => mediator.commitState(state));

    mediator.registerAndInit([galaxyModule, economyModule, shipsModule, fleetModule]);

    // Block 01 P2: subscribe to core:state-changed — modules already produce
    // immutable state via immer.produce(), so we just assign the new reference.
    // No shallow clone needed — newState already has new refs for changed paths.
    mediator.getBus().on('core:state-changed', (newState) => {
      useGameStore.setState({ gameState: newState });
    });

    modulesRegistered = true;
  }

  return mediator;
}

// ============ Сериализация ============

/**
 * Сериализует GameState в JSON-строку.
 *
 * Exported for Block 01 T5 (serialization round-trip test) so test code can
 * exercise the same save/load pipeline used by `saveGame`/`loadGame`.
 */
export function serializeGameState(state: GameState): string {
  const { systemMap: _systemMap, bakedModel: _bakedModel, ...galaxyWithoutMap } = state.galaxy;
  const serializable = {
    ...state,
    galaxy: galaxyWithoutMap,
    productionQueues: Array.from(state.productionQueues.entries()),
    // Block 02 (F7): serialize shipDesigns + shipyardQueues + ships as entries arrays
    shipDesigns: Array.from(state.shipDesigns.entries()),
    shipyardQueues: Array.from(state.shipyardQueues.entries()),
    ships: Array.from(state.ships.entries()),
  };
  return JSON.stringify(serializable);
}

/**
 * Десериализует GameState из JSON-строки.
 *
 * Exported for Block 01 T5 (serialization round-trip test). The function is
 * pure with respect to input: it rebuilds `systemMap` from `galaxy.systems`
 * and regenerates `galaxy.bakedModel` from the galaxy seed when the field is
 * absent in the serialized JSON (always — `serializeGameState` strips it).
 *
 * Block 08 (audit §2.3, gap-9): top-level state structure is now validated
 * against `SerializedGameStateSchema` (zod). On validation failure, we log
 * the issues and fall back to the unvalidated parse — preserving backward
 * compat with test fixtures / hand-crafted saves that may not match the
 * strict v1 schema. Deep validation (Planet/System/Resources) is deferred
 * to Etap 4 per the audit recommendation.
 *
 * NOTE: `bakeGalaxyModel` embeds `new Date().toISOString()` in `bakedModel.createdAt`,
 * so the deserialized state's `bakedModel.createdAt` will differ from the original
 * state's timestamp. This is a known non-determinism bug — see
 * `08_27_block_01_progress.md` (T5) and `docs/galaxy-bake.md` (todo: strip
 * `createdAt` from bakeGalaxyModel). Tests work around it by stripping the
 * `createdAt` field before deep-equal comparisons.
 */
export function deserializeGameState(json: string): GameState {
  const raw = JSON.parse(json);

  // ─── Block 08 gap-9: top-level schema validation ──────────────────
  // Best-effort: log issues but don't throw — preserves backward compat
  // for any pre-existing saves that may not conform to the v1 schema.
  const validationResult = SerializedGameStateSchema.safeParse(raw);
  if (!validationResult.success) {
    console.warn(
      'deserializeGameState: SerializedGameStateSchema validation failed — falling back to unvalidated parse. Issues:',
      validationResult.error.issues,
    );
  }

  const systems: StarSystem[] = raw.galaxy.systems || [];
  const systemMap = new Map<string, StarSystem>();

  if (systems.length > 0) {
    for (const sys of systems) {
      systemMap.set(sys.id, sys);
    }
  } else if (Array.isArray(raw.galaxy.systemMap)) {
    const entries: [string, StarSystem][] = raw.galaxy.systemMap;
    for (const [id, sys] of entries) {
      systemMap.set(id, sys);
    }
  }

  const queueEntries: [string, ProductionQueue][] = raw.productionQueues || [];
  const productionQueues = new Map(queueEntries);

  let bakedModel = raw.galaxy.bakedModel;
  if (!bakedModel) {
    bakedModel = bakeGalaxyModel(raw.galaxy.seed ?? 42, ELEMENTS);
  }

  setCurrentLookups(bakedModel);

  // Block 05 PR7: миграция процессорных зданий в старых сейвах.
  // У зданий processor/refinery/synthesizer должны быть установлены поля
  // processorType/specialization/specializationLevel/activeRecipes, если
  // их не было (старые сохранения до Блока 05). Также добавляется
  // planet.resourcePurity — пустая карта (заполняется по мере производства).
  const migratedSystems: StarSystem[] = (systems.length > 0
    ? systems
    : Array.from(systemMap.values())) as StarSystem[];
  for (const system of migratedSystems) {
    for (const planet of system.planets) {
      migratePlanet(planet);
    }
  }

  return {
    ...raw,
    galaxy: {
      ...raw.galaxy,
      systemMap,
      systems: migratedSystems,
      bakedModel,
    },
    productionQueues,
    fleets: raw.fleets || [],
    // Block 02 (F7): defensive parse — empty Map if missing or malformed
    shipDesigns: new Map(raw.shipDesigns ?? []),
    shipyardQueues: new Map(raw.shipyardQueues ?? []),
    ships: new Map(raw.ships ?? []),
    time: raw.time?.dayInYear !== undefined
      ? raw.time
      : { tick: raw.time?.tick ?? 0, dayInYear: (raw.time?.day ?? 0) % 365, year: raw.time?.year ?? 1 },
  };
}

/**
 * Block 05 PR7: миграция полей специализации переработчиков при загрузке
 * старых сейвов (до Блока 05).
 *
 * Для каждого здания processor/refinery/synthesizer:
 * - Если processorType уже установлен — оставляем как есть.
 * - Иначе берём defaults из BuildingDef:
 *   - refinery/synthesizer → specialized с defaultSpecialization
 *   - processor → universal
 * - activeRecipes ??= [] (пустой список).
 *
 * planet.resourcePurity НЕ добавляется здесь — оно создаётся лениво в
 * processProductionQueue при первой переработке (`if (!planet.resourcePurity)
 * planet.resourcePurity = {};`). Это сохраняет deep-equals invariant в
 * round-trip тестах (новая игра без зданий → serialize → deserialize →
 * нет изменений в структуре планеты).
 *
 * Идемпотентна: повторный вызов на уже-мигрированном сейве — no-op (использует ??=).
 * Запускать только в loadGame.
 */
function migratePlanet(planet: Planet): void {
  // Surface hexes
  for (const hex of planet.hexes) {
    migrateProcessorInstance(hex);
  }
  // Atmospheric slots
  for (const slot of planet.atmosphericSlots) {
    migrateProcessorInstance(slot);
  }
  // Orbit slots
  for (const slot of planet.orbitSlots) {
    migrateProcessorInstance(slot);
  }
}

/**
 * Block 05 PR7: миграция одной ячейки здания (HexCell | AtmosphericSlot |
 * OrbitalSlot). Универсальный интерфейс — все три типа имеют поля
 * buildingId/buildingLevel/processorType/specialization/specializationLevel/
 * activeRecipes.
 */
function migrateProcessorInstance(instance: {
  buildingId: string | null;
  buildingLevel: number;
  processorType?: import('@/core/types').ProcessorType;
  specialization?: import('@/core/types').ProcessorRecipeCategory;
  specializationLevel?: number;
  activeRecipes?: string[];
}): void {
  if (!instance.buildingId) return;
  const def = BUILDING_MAP.get(instance.buildingId);
  if (!def?.isUniversalProcessor) return;
  // Если specialization уже есть — оставляем; иначе defaults
  if (instance.processorType === undefined) {
    instance.processorType = def.defaultProcessorType ?? 'universal';
  }
  if (instance.specialization === undefined && def.defaultSpecialization !== undefined) {
    instance.specialization = def.defaultSpecialization;
  }
  if (instance.specializationLevel === undefined) {
    instance.specializationLevel = def.defaultProcessorType === 'specialized' ? 1 : 0;
  }
  if (instance.activeRecipes === undefined) {
    instance.activeRecipes = [];
  }
}

// ============ Store ============

export const useGameStore = create<GameStore>()(immer((set, get) => {
  /** Создать начальное GameState */
  function createInitialState(config: Partial<import('@/galaxy').GalaxyGenConfig>): GameState {
    const mediator = getMediatorWithModules();
    const state = mediator.newGame(config);
    return state;
  }

  return {
    gameState: null,
    view: 'galaxy',
    selectedSystemId: null,
    selectedPlanetId: null,
    selectedFleetId: null,
    isInitialized: false,
    currentSaveId: null,
    isSaving: false,
    saveError: null,
    isLoading: false,

    newGame: (config = {}) => {
      const state = createInitialState(config);
      // Сброс детерминированного счётчика ProductionItem IDs (gap-6, P9)
      // для согласованности с новым seed.
      resetProductionItemCounter();
      // Block 02 (F5): reset ship ID counter — new game starts at 0.
      resetShipCounter();
      set({
        gameState: state,
        view: 'galaxy',
        selectedSystemId: state.galaxy.systems[0]?.id ?? null,
        selectedPlanetId: null,
        selectedFleetId: null,
        isInitialized: true,
        currentSaveId: null,
      });
    },

    setSpeed: (speed) => {
      const mediator = getMediatorWithModules();
      const { gameState } = get();
      if (!gameState) return;
      // Делегируем медиатору: он обновит state + loop + эмитнет state-changed
      mediator.setSpeed(speed);
    },

    togglePause: () => {
      const mediator = getMediatorWithModules();
      const { gameState } = get();
      if (!gameState) return;
      // Делегируем медиатору: он переключит phase + loop + эмитнет state-changed
      mediator.togglePause();
    },

    tick: () => {
      const mediator = getMediatorWithModules();
      // Делегируем медиатору: он инкрементирует время и вызовет registry.tickAll,
      // что приведёт к EconomyModule.tick → processEconomyTick → emit state-changed
      mediator.tick();
    },

    setView: (view) => set({ view }),

    selectSystem: (id) => {
      set({ selectedSystemId: id, selectedPlanetId: null });
      if (id) set({ view: 'system' });
    },

    selectPlanet: (id) => {
      set({ selectedPlanetId: id });
      if (id) set({ view: 'planet' });
    },

    buildOnHex: (planetId, hexIndex, buildingId) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.buildingId;
      // Emit event — EconomyModule.onBuild wraps engine.buildOnHex in immer.produce(),
      // commits new immutable state via mediator.commitState() which emits
      // core:state-changed → our subscription updates the store.
      mediator.getBus().emit('economy:build', { planetId, hexIndex, buildingId });
      // Re-fetch state — after produce(), the old planet reference is stale.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.buildingId;
      return after === buildingId && before !== buildingId;
    },

    upgradeBuildingOnHex: (planetId, hexIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.buildingLevel ?? 0;
      mediator.getBus().emit('economy:upgrade', { planetId, hexIndex });
      // Re-fetch — produce() in EconomyModule created a new state reference.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.buildingLevel ?? 0;
      return after > before;
    },

    buildOnAtmosphereSlot: (planetId, slotIndex, buildingId) => {
      // Block 01 P3 — emit economy:build with layer='atmosphere' + slotIndex.
      // EconomyModule.onBuild dispatches to engine.buildOnAtmosphereSlot.
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      if (slotIndex < 0 || slotIndex >= planet.atmosphericSlots.length) return false;
      const before = planet.atmosphericSlots[slotIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:build', {
        planetId,
        buildingId,
        slotIndex,
        layer: 'atmosphere',
      });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.atmosphericSlots[slotIndex]?.buildingId ?? null;
      return after === buildingId && before !== buildingId;
    },

    buildOnOrbitSlot: (planetId, slotIndex, buildingId) => {
      // Block 01 P3 — emit economy:build with layer='orbit' + slotIndex.
      // EconomyModule.onBuild dispatches to engine.buildOnOrbitSlot.
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      if (slotIndex < 0 || slotIndex >= planet.orbitSlots.length) return false;
      const before = planet.orbitSlots[slotIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:build', {
        planetId,
        buildingId,
        slotIndex,
        layer: 'orbit',
      });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.orbitSlots[slotIndex]?.buildingId ?? null;
      return after === buildingId && before !== buildingId;
    },

    enqueueProduction: (planetId, recipeId, repeat = false) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = gameState.productionQueues.get(planetId)?.items.length ?? 0;
      mediator.getBus().emit('economy:enqueue', { planetId, recipeId, repeat });
      // Re-fetch — produce() in EconomyModule created a new state reference.
      const newState = get().gameState;
      if (!newState) return false;
      const after = newState.productionQueues.get(planetId)?.items.length ?? 0;
      return after > before;
    },

    cancelProduction: (planetId, queueItemId) => {
      // Block 01 P4 — cancel a queued production item by ID.
      // Pattern: directly mutate the queue via immer draft (same as
      // setReserveMinimum / setColonyRole — no need to round-trip
      // through the mediator for a simple deletion).
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet) return;
        const queue = state.gameState.productionQueues.get(planetId);
        if (!queue) return;
        const idx = queue.items.findIndex((it) => it.id === queueItemId);
        if (idx === -1) return;
        queue.items.splice(idx, 1);
        ok = true;
      });
      return ok;
    },

    // ─── Block 05 PR7 — специализация переработчиков ─────────────────
    // Pattern: emit event → EconomyModule.onSpecialize wraps engine
    // .specializeBuilding in immer.produce() and commits new state via
    // mediator.commitState() → core:state-changed → store subscription
    // syncs the new reference.
    specializeBuildingOnHex: (planetId, hexIndex, category) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.processorType;
      const beforeSpec = planet.hexes[hexIndex]?.specialization;
      mediator.getBus().emit('economy:specialize', { planetId, hexIndex, category });
      // Re-fetch — engine.specializeBuilding mutates hex; immer produces a
      // new state reference with the changed hex path.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.processorType;
      const afterSpec = newPlanet.hexes[hexIndex]?.specialization;
      // Success criterion: either processorType changed OR (category === 'universal'
      // AND specialization was non-empty before, now undefined).
      if (category === 'universal') {
        return before === 'specialized' && after === 'universal' && beforeSpec !== undefined && afterSpec === undefined;
      }
      return after === 'specialized' && afterSpec === category;
    },

    upgradeSpecializationOnHex: (planetId, hexIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.specializationLevel ?? 0;
      if (before === 0) return false; // не specialized
      mediator.getBus().emit('economy:upgrade-specialization', { planetId, hexIndex });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.specializationLevel ?? 0;
      return after > before;
    },

    colonizePlanet: (planetId) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;

      // Emit event — EconomyModule.onColonize wraps engine.colonizePlanet in
      // immer.produce() and commits the new state via mediator.commitState().
      mediator.getBus().emit('economy:colonize', { planetId });

      // Re-fetch state — planet reference is stale after produce().
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const success = newPlanet.owner === 'player';
      if (success) {
        // Block 01 P2: use immer produce() to create a new state with
        // phase='playing' + speed=1 — keeps immutability invariant.
        // mediator.setGameState emits core:state-changed which syncs the
        // Zustand-state via our subscription.
        const currentState = mediator.getGameState();
        if (currentState) {
          const finalState = produce(currentState, (draft) => {
            draft.phase = 'playing';
            draft.speed = 1;
          });
          mediator.setGameState(finalState);
        }
        set({
          selectedSystemId: newPlanet.systemId,
          selectedPlanetId: planetId,
          view: 'planet',
        });
      }
      return success;
    },

    // ─── Склад ────────────────────────────────────────────
    // Block 01 P2: all warehouse mutations use immer draft via set((state) => ...).
    // immer creates new references for changed paths (galaxy.systems array,
    // planet, planet.warehouse) — useMemo on galaxy.systems now triggers.

    setColonyRole: (planetId, role) => {
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;
        planet.warehouse = applyColonyRole(planet.warehouse, role);
      });
    },

    setReserveMinimum: (planetId, resourceId, minimum) => {
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;
        if (planet.warehouse.reserves[resourceId]) {
          planet.warehouse.reserves[resourceId].minimum = minimum;
        } else {
          planet.warehouse.reserves[resourceId] = { resourceId, minimum, priority: 5 };
        }
      });
    },

    setWarehouseSpecialization: (planetId, spec) => {
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;
        planet.warehouse.specialization = spec;
        planet.warehouse.capacities = calculateWarehouseCapacities(planet);
        planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
      });
    },

    moveToOrbit: (planetId, resourceId, amount) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;

        const available = planet.resources[resourceId] ?? 0;
        const moveAmount = Math.min(amount, available);
        if (moveAmount <= 0) return;

        const orbitUsed = getOrbitBufferUsed(planet);
        const orbitCapacity = planet.warehouse.orbitBuffer.capacity;
        if (orbitUsed + moveAmount > orbitCapacity) return;

        planet.resources[resourceId] -= moveAmount;
        planet.warehouse.orbitBuffer.resources[resourceId] = (planet.warehouse.orbitBuffer.resources[resourceId] ?? 0) + moveAmount;
        ok = true;
      });
      return ok;
    },

    moveFromOrbit: (planetId, resourceId, amount) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;

        const orbitAmount = planet.warehouse.orbitBuffer.resources[resourceId] ?? 0;
        const moveAmount = Math.min(amount, orbitAmount);
        if (moveAmount <= 0) return;

        const canStoreAmount = canStoreResource(planet, resourceId, moveAmount);
        if (canStoreAmount <= 0) return;

        const actualMove = Math.min(moveAmount, canStoreAmount);
        planet.warehouse.orbitBuffer.resources[resourceId] -= actualMove;
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + actualMove;
        ok = true;
      });
      return ok;
    },

    // ─── Сохранение / Загрузка ─────────────────────────────

    saveGame: async (name?: string) => {
      const gameState = get().gameState;
      const currentSaveId = get().currentSaveId;
      if (!gameState) return false;

      const savedSpeed = gameState.speed;
      const savedPhase = gameState.phase;

      // Block 01 P2: pause state during save via immer draft mutation.
      if (gameState.phase === 'playing' || gameState.phase === 'colonization') {
        set((state) => {
          if (!state.gameState) return;
          state.gameState.phase = 'paused';
          state.gameState.speed = 0;
        });
      }

      set({ isSaving: true, saveError: null });

      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      try {
        const currentGameState = get().gameState!;
        const saveName = name || `Galaxy #${currentGameState.galaxy.seed}`;
        const stateJson = serializeGameState(currentGameState);

        const fetchWithTimeout = async (url: string, options: RequestInit) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            return res;
          } finally {
            clearTimeout(timeoutId);
          }
        };

        if (currentSaveId) {
          const res = await fetchWithTimeout(`/api/save/${currentSaveId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: saveName, state: stateJson, tick: currentGameState.time.tick }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to update save (${res.status}): ${errText}`);
          }
        } else {
          const res = await fetchWithTimeout('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: saveName,
              seed: currentGameState.galaxy.seed,
              state: stateJson,
              tick: currentGameState.time.tick,
            }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to create save (${res.status}): ${errText}`);
          }
          const data = await res.json();
          set({ currentSaveId: data.id });
        }
        set({ saveError: null });
        return true;
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error('Save failed:', e);
        set({ saveError: errorMsg });
        return false;
      } finally {
        // Block 01 P2: restore phase via immer draft mutation.
        if (savedPhase === 'playing' || savedPhase === 'colonization') {
          set((state) => {
            if (!state.gameState) return;
            state.gameState.phase = savedPhase === 'colonization' ? 'colonization' : 'playing';
            state.gameState.speed = savedSpeed || 1;
          });
        }
        set({ isSaving: false });
      }
    },

    loadGame: async (id: string) => {
      set({ isLoading: true });
      try {
        const res = await fetch(`/api/save/${id}`);
        if (!res.ok) throw new Error('Failed to load save');
        const data = await res.json();

        const loadedState = deserializeGameState(data.state);

        // Сброс детерминированного счётчика ProductionItem IDs (gap-6, P9)
        // при загрузке сейва — новые ID будут идти с 0, что упрощает расследование.
        resetProductionItemCounter();
        // Block 02 (F5): reset ship ID counter — newly built ships get fresh IDs.
        resetShipCounter();

        set({
          gameState: loadedState,
          view: 'galaxy',
          selectedSystemId: loadedState.galaxy.systems[0]?.id ?? null,
          selectedPlanetId: null,
          selectedFleetId: null,
          isInitialized: true,
          currentSaveId: id,
        });
        return true;
      } catch (e) {
        console.error('Load failed:', e);
        return false;
      } finally {
        set({ isLoading: false });
      }
    },

    loadSaveList: async () => {
      try {
        const res = await fetch('/api/save');
        if (!res.ok) throw new Error('Failed to list saves');
        return await res.json() as SaveInfo[];
      } catch (e) {
        console.error('List saves failed:', e);
        return [];
      }
    },

    deleteSave: async (id) => {
      try {
        const res = await fetch(`/api/save/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete save');
        return true;
      } catch (e) {
        console.error('Delete save failed:', e);
        return false;
      }
    },

    // ─── Утилиты ───────────────────────────────────────────

    getSystem: (id) => {
      const { gameState } = get();
      return gameState?.galaxy.systemMap.get(id);
    },

    getPlanet: (id) => {
      const { gameState } = get();
      if (!gameState) return undefined;
      for (const system of gameState.galaxy.systems) {
        const planet = system.planets.find(p => p.id === id);
        if (planet) return planet;
      }
      return undefined;
    },

    getSelectedSystem: () => {
      const { gameState, selectedSystemId } = get();
      if (!gameState || !selectedSystemId) return undefined;
      return gameState.galaxy.systemMap.get(selectedSystemId);
    },

    getSelectedPlanet: () => {
      const { gameState, selectedPlanetId } = get();
      if (!gameState || !selectedPlanetId) return undefined;
      for (const system of gameState.galaxy.systems) {
        const planet = system.planets.find(p => p.id === selectedPlanetId);
        if (planet) return planet;
      }
      return undefined;
    },

    // ─── Block 02 (F2): Конструктор кораблей ─────────────────────
    // Direct immer mutation (no mediator round-trip needed — simple Map addition).
    saveShipDesign: (design) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        // Block 02: deterministic ID (counter, no Math.random) per Block 07 gap-3.
        const id = design.id ?? `design_${state.gameState.time.tick}_${shipDesignCounter++}`;
        newId = id;
        const designRecord: import('@/core/types').ShipDesign = {
          id,
          name: design.name,
          hullId: design.hullId,
          armor: design.armor,
          moduleIds: design.moduleIds.slice(),
          owner: design.owner,
          createdAtTick: state.gameState.time.tick,
        };
        state.gameState.shipDesigns.set(id, designRecord);
      });
      return newId;
    },

    deleteShipDesign: (id) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        ok = state.gameState.shipDesigns.delete(id);
      });
      return ok;
    },

    getShipDesign: (id) => {
      const { gameState } = get();
      return gameState?.shipDesigns.get(id);
    },

    listShipDesigns: () => {
      const { gameState } = get();
      if (!gameState) return [];
      return Array.from(gameState.shipDesigns.values());
    },

    // ─── Block 02 (F6): Верфь — постройка кораблей ──────────────
    enqueueShipBuild: (planetId, designId, shipName) => {
      let itemId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        const design = state.gameState.shipDesigns.get(designId);
        if (!design) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet) return;
        const existingQueue = state.gameState.shipyardQueues.get(planetId);
        itemId = `ship_${state.gameState.time.tick}_${shipyardItemCounter++}`;
        const newQueue = enqueueShipBuildFn(planet, existingQueue, design, shipName ?? `${design.name}-${shipyardItemCounter}`, itemId);
        state.gameState.shipyardQueues.set(planetId, newQueue);
      });
      return itemId;
    },

    cancelShipyardItem: (planetId, itemId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const queue = state.gameState.shipyardQueues.get(planetId);
        if (!queue) return;
        const newQueue = cancelShipyardItemFn(queue, itemId);
        ok = newQueue.items.length < queue.items.length;
        state.gameState.shipyardQueues.set(planetId, newQueue);
      });
      return ok;
    },

    getShipyardQueue: (planetId) => {
      const { gameState } = get();
      return gameState?.shipyardQueues.get(planetId);
    },

    // ─── Block 02 (F3): Флот-менеджер ────────────────────────
    // Pattern: direct immer mutation. Engine functions (createFleet / mergeFleets /
    // splitFleet from src/ships/fleet-engine.ts) are pure — they return Fleet objects
    // without ids; store assigns deterministic ids (counter, no Math.random).
    createFleet: (name, shipIds, atSystemId) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        if (shipIds.length === 0) return;
        // Validate: all ship IDs must exist in state.ships
        for (const id of shipIds) {
          if (!state.gameState.ships.has(id)) return;
        }
        const owner = state.gameState.playerFactionId;
        const draft = createFleetFn(shipIds, atSystemId, owner, name);
        newId = `fleet_${state.gameState.time.tick}_${fleetCounter++}`;
        const newFleet: import('@/core/types').Fleet = { ...draft, id: newId };
        state.gameState.fleets.push(newFleet);
      });
      return newId;
    },

    mergeFleets: (fleetIds) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        if (fleetIds.length < 2) return; // merge of 1 = no-op
        // Resolve fleets by id
        const fleetsToMerge: import('@/core/types').Fleet[] = [];
        for (const id of fleetIds) {
          const f = getFleetByIdFn(state.gameState.fleets, id);
          if (!f) return; // invalid id — abort
          fleetsToMerge.push(f);
        }
        // All fleets must be in same location
        const loc = fleetsToMerge[0]!.location;
        for (const f of fleetsToMerge) {
          if (f.location !== loc) return;
        }
        const draft = mergeFleetsFn(fleetsToMerge);
        newId = `fleet_${state.gameState.time.tick}_${fleetCounter++}`;
        const newFleet: import('@/core/types').Fleet = { ...draft, id: newId };
        // Remove old fleets, add new one
        const idSet = new Set(fleetIds);
        state.gameState.fleets = state.gameState.fleets.filter(f => !idSet.has(f.id));
        state.gameState.fleets.push(newFleet);
      });
      return newId;
    },

    splitFleet: (sourceFleetId, shipIdsToExtract, newName) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        if (shipIdsToExtract.length === 0) return;
        const source = getFleetByIdFn(state.gameState.fleets, sourceFleetId);
        if (!source) return;
        // Validate: shipIdsToExtract must all be in the source fleet
        for (const id of shipIdsToExtract) {
          if (!source.shipIds.includes(id)) return;
        }
        // Validate: don't allow extracting all ships (would leave empty fleet)
        if (shipIdsToExtract.length >= source.shipIds.length) return;
        const { remaining, extracted } = splitFleetFn(source, shipIdsToExtract);
        newId = `fleet_${state.gameState.time.tick}_${fleetCounter++}`;
        const newFleet: import('@/core/types').Fleet = {
          ...extracted,
          id: newId,
          name: newName ?? extracted.name,
        };
        // Replace source with remaining (keep id), add extracted
        const idx = state.gameState.fleets.findIndex(f => f.id === sourceFleetId);
        if (idx === -1) return;
        state.gameState.fleets[idx] = remaining;
        state.gameState.fleets.push(newFleet);
      });
      return newId;
    },

    renameFleet: (fleetId, newName) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const f = getFleetByIdFn(state.gameState.fleets, fleetId);
        if (!f) return;
        f.name = newName;
        ok = true;
      });
      return ok;
    },

    getFleet: (fleetId) => {
      const { gameState } = get();
      if (!gameState) return undefined;
      return getFleetByIdFn(gameState.fleets, fleetId);
    },

    getFleetsAtSystem: (systemId) => {
      const { gameState } = get();
      if (!gameState) return [];
      return getFleetsAtFn(gameState.fleets, systemId);
    },

    getShip: (shipId) => {
      const { gameState } = get();
      return gameState?.ships.get(shipId);
    },

    getLooseShips: (ownerId, location) => {
      const { gameState } = get();
      if (!gameState) return [];
      return getLooseShipsFn(gameState.ships, gameState.fleets, ownerId, location);
    },

    // ─── Block 02 (F4): Приказы флотов ────────────────────
    // Pattern: pure engine function executeOrder returns { updatedFleet, ok } —
    // store applies via immer draft. Failure (no route / no jump drive) returns false;
    // UI shows toast error per failure reason.
    issueFleetOrder: (fleetId, type, targetId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const fleet = getFleetByIdFn(state.gameState.fleets, fleetId);
        if (!fleet) return;
        const result = executeOrderFn(
          fleet,
          type,
          targetId,
          state.gameState.galaxy,
          state.gameState.ships,
          state.gameState.shipDesigns,
          state.gameState.time.tick,
        );
        if (!result.ok || !result.order) return;
        // Replace fleet in array
        const idx = state.gameState.fleets.findIndex(f => f.id === fleetId);
        if (idx === -1) return;
        state.gameState.fleets[idx] = result.updatedFleet;
        ok = true;
      });
      return ok;
    },

    cancelFleetOrder: (fleetId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const fleet = getFleetByIdFn(state.gameState.fleets, fleetId);
        if (!fleet) return;
        if (fleet.orders.length === 0) return;
        fleet.orders = fleet.orders.slice(1);
        ok = true;
      });
      return ok;
    },

    // Block 02 (F7): выбрать флот — синхронно устанавливает selectedFleetId.
    // Используется galaxy-map context menu для определения, какому флоту
    // отдать приказ перемещения при right-click на систему.
    selectFleet: (fleetId) => {
      set({ selectedFleetId: fleetId });
    },
  };
}));

function findPlanet(state: GameState, planetId: EntityId): Planet | undefined {
  for (const system of state.galaxy.systems) {
    const planet = system.planets.find(p => p.id === planetId);
    if (planet) return planet;
  }
  return undefined;
}
