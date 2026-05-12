/**
 * Основной Zustand-стор для игрового состояния.
 *
 * Версия 3.0: Работает через GameMediator.
 * Стор делегирует действия медиатору и модулям,
 * а сам отвечает за реактивность (React re-renders).
 *
 * Паттерн:
 * - Мутации → через модули/медиатор (движок)
 * - Реактивность → через Zustand set() (UI)
 * - События → через TypedEventBus (межмодульное взаимодействие)
 */

import { create } from 'zustand';
import type { GameState, GameTime, GameSpeed, GamePhase, Galaxy, StarSystem, Planet, EntityId, ProductionQueue, ColonyRole, WarehouseSpecialization } from '@/core/types';
import { getGameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';
import { processEconomyTick, buildOnHex, upgradeBuilding, enqueueProduction, giveStarterResources, colonizePlanet } from '@/economy';
import { createDefaultWarehouse, applyColonyRole, calculateWarehouseCapacity, canStoreResource, getOrbitBufferUsed, getOrbitBufferCapacity, ensureReservesForResources } from '@/data/warehouse';
import { BUILDING_MAP } from '@/data/buildings';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { setCurrentLookups } from '@/data/baked-lookups';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';

// ============ Типы стора ============

export type GameView = 'galaxy' | 'system' | 'planet';

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
  upgradeBuildingOnHex: (planetId: EntityId, hexIndex: number) => boolean;
  enqueueProduction: (planetId: EntityId, recipeId: string, repeat?: boolean) => boolean;

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

  // Утилиты
  getSystem: (id: EntityId) => StarSystem | undefined;
  getPlanet: (id: EntityId) => Planet | undefined;
  getSelectedSystem: () => StarSystem | undefined;
  getSelectedPlanet: () => Planet | undefined;
}

// ============ Медиатор (инициализация) ============

/** Флаг: были ли модули уже зарегистрированы */
let modulesRegistered = false;

/** Получить медиатор с зарегистрированными модулями */
function getMediatorWithModules() {
  const mediator = getGameMediator();

  if (!modulesRegistered) {
    const economyModule = new EconomyModule();
    const galaxyModule = new GalaxyModule();

    // Модули нуждаются в доступе к GameState — устанавливаем accessor
    economyModule.setGameStateAccessor(() => mediator.getGameState());
    galaxyModule.setGameStateAccessor(() => mediator.getGameState());

    mediator.registerAndInit([galaxyModule, economyModule]);
    modulesRegistered = true;
  }

  return mediator;
}

// ============ Сериализация ============

/**
 * Сериализует GameState в JSON-строку.
 */
function serializeGameState(state: GameState): string {
  const { systemMap: _systemMap, bakedModel: _bakedModel, ...galaxyWithoutMap } = state.galaxy;
  const serializable = {
    ...state,
    galaxy: galaxyWithoutMap,
    productionQueues: Array.from(state.productionQueues.entries()),
  };
  return JSON.stringify(serializable);
}

/**
 * Десериализует GameState из JSON-строки.
 */
function deserializeGameState(json: string): GameState {
  const raw = JSON.parse(json);

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

  return {
    ...raw,
    galaxy: {
      ...raw.galaxy,
      systemMap,
      systems: systems.length > 0 ? systems : Array.from(systemMap.values()),
      bakedModel,
    },
    productionQueues,
    fleets: raw.fleets || [],
    time: raw.time?.dayInYear !== undefined
      ? raw.time
      : { tick: raw.time?.tick ?? 0, dayInYear: (raw.time?.day ?? 0) % 365, year: raw.time?.year ?? 1 },
  };
}

// ============ Store ============

export const useGameStore = create<GameStore>((set, get) => {
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
    isInitialized: false,
    currentSaveId: null,
    isSaving: false,
    saveError: null,
    isLoading: false,

    newGame: (config = {}) => {
      const state = createInitialState(config);
      set({
        gameState: state,
        view: 'galaxy',
        selectedSystemId: state.galaxy.systems[0]?.id ?? null,
        selectedPlanetId: null,
        isInitialized: true,
        currentSaveId: null,
      });
    },

    setSpeed: (speed) => {
      const { gameState } = get();
      if (!gameState) return;
      gameState.speed = speed;
      if (speed > 0) {
        gameState.phase = 'playing';
      }
      set({ gameState: { ...gameState } });
    },

    togglePause: () => {
      const { gameState } = get();
      if (!gameState) return;
      if (gameState.phase === 'playing') {
        gameState.phase = 'paused';
        gameState.speed = 0;
      } else {
        gameState.phase = 'playing';
        gameState.speed = 1;
      }
      set({ gameState: { ...gameState } });
    },

    tick: () => {
      const { gameState } = get();
      if (!gameState || gameState.phase !== 'playing') return;

      // Обновить время
      gameState.time.tick += gameState.speed;
      gameState.time.dayInYear = gameState.time.tick % 365;
      gameState.time.year = Math.floor(gameState.time.tick / 365) + 1;

      // Экономика: обрабатываем только колонизированные планеты
      const colonizedPlanets = gameState.galaxy.systems
        .flatMap(s => s.planets)
        .filter(p => p.owner != null);

      for (let i = 0; i < gameState.speed; i++) {
        processEconomyTick(colonizedPlanets, gameState.productionQueues, gameState.galaxy.systemMap);
      }

      set({ gameState: { ...gameState } });
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
      const { gameState } = get();
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const result = buildOnHex(planet, hexIndex, buildingId);
      if (result) set({ gameState: { ...gameState } });
      return result;
    },

    upgradeBuildingOnHex: (planetId, hexIndex) => {
      const { gameState } = get();
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const result = upgradeBuilding(planet, hexIndex);
      if (result) set({ gameState: { ...gameState } });
      return result;
    },

    enqueueProduction: (planetId, recipeId, repeat = false) => {
      const { gameState } = get();
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const result = enqueueProduction(planet, gameState.productionQueues, recipeId, repeat);
      if (result) set({ gameState: { ...gameState } });
      return result;
    },

    colonizePlanet: (planetId) => {
      const { gameState } = get();
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;

      const system = gameState.galaxy.systemMap.get(planet.systemId);

      const result = colonizePlanet(planet, system);
      if (result) {
        if (!planet.warehouse) {
          planet.warehouse = createDefaultWarehouse();
          planet.warehouse = applyColonyRole(planet.warehouse, 'industrial');
          planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
          planet.warehouse.orbitBuffer.capacity = getOrbitBufferCapacity(planet);
        }

        gameState.phase = 'playing';
        gameState.speed = 1;
        set({
          gameState: {
            ...gameState,
            galaxy: {
              ...gameState.galaxy,
              systems: [...gameState.galaxy.systems],
            },
          },
          selectedSystemId: planet.systemId,
          selectedPlanetId: planetId,
          view: 'planet',
        });
      }
      return result;
    },

    // ─── Склад ────────────────────────────────────────────

    setColonyRole: (planetId, role) => {
      const { gameState } = get();
      if (!gameState) return;
      const planet = findPlanet(gameState, planetId);
      if (!planet || !planet.warehouse) return;
      planet.warehouse = applyColonyRole(planet.warehouse, role);
      set({ gameState: { ...gameState, galaxy: { ...gameState.galaxy, systems: [...gameState.galaxy.systems] } } });
    },

    setReserveMinimum: (planetId, resourceId, minimum) => {
      const { gameState } = get();
      if (!gameState) return;
      const planet = findPlanet(gameState, planetId);
      if (!planet || !planet.warehouse) return;
      if (planet.warehouse.reserves[resourceId]) {
        planet.warehouse.reserves[resourceId].minimum = minimum;
      } else {
        planet.warehouse.reserves[resourceId] = { resourceId, minimum, priority: 5 };
      }
      set({ gameState: { ...gameState, galaxy: { ...gameState.galaxy, systems: [...gameState.galaxy.systems] } } });
    },

    setWarehouseSpecialization: (planetId, spec) => {
      const { gameState } = get();
      if (!gameState) return;
      const planet = findPlanet(gameState, planetId);
      if (!planet || !planet.warehouse) return;
      planet.warehouse.specialization = spec;
      planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
      set({ gameState: { ...gameState, galaxy: { ...gameState.galaxy, systems: [...gameState.galaxy.systems] } } });
    },

    moveToOrbit: (planetId, resourceId, amount) => {
      const { gameState } = get();
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet || !planet.warehouse) return false;

      const available = planet.resources[resourceId] ?? 0;
      const moveAmount = Math.min(amount, available);
      if (moveAmount <= 0) return false;

      const orbitUsed = getOrbitBufferUsed(planet);
      const orbitCapacity = planet.warehouse.orbitBuffer.capacity;
      if (orbitUsed + moveAmount > orbitCapacity) return false;

      planet.resources[resourceId] -= moveAmount;
      planet.warehouse.orbitBuffer.resources[resourceId] = (planet.warehouse.orbitBuffer.resources[resourceId] ?? 0) + moveAmount;
      set({ gameState: { ...gameState, galaxy: { ...gameState.galaxy, systems: [...gameState.galaxy.systems] } } });
      return true;
    },

    moveFromOrbit: (planetId, resourceId, amount) => {
      const { gameState } = get();
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet || !planet.warehouse) return false;

      const orbitAmount = planet.warehouse.orbitBuffer.resources[resourceId] ?? 0;
      const moveAmount = Math.min(amount, orbitAmount);
      if (moveAmount <= 0) return false;

      const canStoreAmount = canStoreResource(planet, resourceId, moveAmount);
      if (canStoreAmount <= 0) return false;

      const actualMove = Math.min(moveAmount, canStoreAmount);
      planet.warehouse.orbitBuffer.resources[resourceId] -= actualMove;
      planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + actualMove;
      set({ gameState: { ...gameState, galaxy: { ...gameState.galaxy, systems: [...gameState.galaxy.systems] } } });
      return true;
    },

    // ─── Сохранение / Загрузка ─────────────────────────────

    saveGame: async (name?: string) => {
      const { gameState, currentSaveId } = get();
      if (!gameState) return false;

      const savedSpeed = gameState.speed;
      const savedPhase = gameState.phase;

      if (gameState.phase === 'playing' || gameState.phase === 'colonization') {
        gameState.phase = 'paused';
        gameState.speed = 0;
        set({ gameState: { ...gameState } });
      }

      set({ isSaving: true, saveError: null });

      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      try {
        const saveName = name || `Galaxy #${gameState.galaxy.seed}`;
        const stateJson = serializeGameState(gameState);

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
            body: JSON.stringify({ name: saveName, state: stateJson, tick: gameState.time.tick }),
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
              seed: gameState.galaxy.seed,
              state: stateJson,
              tick: gameState.time.tick,
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
        if (savedPhase === 'playing' || savedPhase === 'colonization') {
          gameState.phase = savedPhase === 'colonization' ? 'colonization' : 'playing';
          gameState.speed = savedSpeed || 1;
          set({ gameState: { ...gameState } });
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

        set({
          gameState: loadedState,
          view: 'galaxy',
          selectedSystemId: loadedState.galaxy.systems[0]?.id ?? null,
          selectedPlanetId: null,
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
  };
});

function findPlanet(state: GameState, planetId: EntityId): Planet | undefined {
  for (const system of state.galaxy.systems) {
    const planet = system.planets.find(p => p.id === planetId);
    if (planet) return planet;
  }
  return undefined;
}
