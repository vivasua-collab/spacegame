/**
 * Основной Zustand-стор для игрового состояния.
 * Включает систему сохранения/загрузки через API.
 */

import { create } from 'zustand';
import type { GameState, GameTime, GameSpeed, GamePhase, Galaxy, StarSystem, Planet, EntityId, ProductionQueue, ColonyRole, WarehouseSpecialization } from '@/core/types';
import { generateGalaxy, type GalaxyGenConfig } from '@/galaxy';
import { processEconomyTick, buildOnHex, upgradeBuilding, enqueueProduction, giveStarterResources, recalcEnergyBalance, colonizePlanet } from '@/economy';
import { createDefaultWarehouse, applyColonyRole, calculateWarehouseCapacity, canStoreResource, getOrbitBufferUsed, getOrbitBufferCapacity } from '@/data/warehouse';
import { gameBus } from '@/core/event-bus';
import { BUILDING_MAP } from '@/data/buildings';

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
  isLoading: boolean;

  // === Действия ===
  newGame: (config?: Partial<GalaxyGenConfig>) => void;
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

// ============ Сериализация ============

/**
 * Сериализует GameState в JSON-строку.
 * Конвертирует Map → массив пар [key, value] для JSON-совместимости.
 */
function serializeGameState(state: GameState): string {
  const serializable = {
    ...state,
    galaxy: {
      ...state.galaxy,
      systemMap: Array.from(state.galaxy.systemMap.entries()),
    },
    productionQueues: Array.from(state.productionQueues.entries()),
  };
  return JSON.stringify(serializable);
}

/**
 * Десериализует GameState из JSON-строки.
 * Восстанавливает Map из массива пар [key, value].
 */
function deserializeGameState(json: string): GameState {
  const raw = JSON.parse(json);

  // Восстановить systemMap
  const systemMapEntries: [string, StarSystem][] = raw.galaxy.systemMap || [];
  const systemMap = new Map(systemMapEntries);

  // Восстановить productionQueues
  const queueEntries: [string, ProductionQueue][] = raw.productionQueues || [];
  const productionQueues = new Map(queueEntries);

  return {
    ...raw,
    galaxy: {
      ...raw.galaxy,
      systemMap,
      systems: raw.galaxy.systems || [],
    },
    productionQueues,
    fleets: raw.fleets || [],
    // Миграция: старые сохранения могут иметь time.day вместо time.dayInYear
    time: raw.time?.dayInYear !== undefined
      ? raw.time
      : { tick: raw.time?.tick ?? 0, dayInYear: (raw.time?.day ?? 0) % 365, year: raw.time?.year ?? 1 },
  };
}

// ============ Store ============

export const useGameStore = create<GameStore>((set, get) => {
  /** Создать начальное GameState */
  function createInitialState(config: Partial<GalaxyGenConfig>): GameState {
    const galaxy = generateGalaxy(config);

    return {
      time: { tick: 0, dayInYear: 0, year: 1 },
      speed: 0,
      phase: 'colonization',
      galaxy,
      productionQueues: new Map(),
      fleets: [],
      playerFactionId: 'player',
    };
  }

  return {
    gameState: null,
    view: 'galaxy',
    selectedSystemId: null,
    selectedPlanetId: null,
    isInitialized: false,
    currentSaveId: null,
    isSaving: false,
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

      // 1 тик = 1 игровой день. Speed = количество дней за интервал.
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

      // Найти систему для расчёта энергобаланса
      const system = gameState.galaxy.systemMap.get(planet.systemId);

      const result = colonizePlanet(planet, system);
      if (result) {
        // Инициализация склада при колонизации
        if (!planet.warehouse) {
          planet.warehouse = createDefaultWarehouse();
          planet.warehouse = applyColonyRole(planet.warehouse, 'industrial');
          planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
          planet.warehouse.orbitBuffer.capacity = getOrbitBufferCapacity(planet);
        }

        // После колонизации — начать игру
        gameState.phase = 'playing';
        gameState.speed = 1;
        set({
          // Создаём новые ссылки для galaxy.systems, чтобы все
          // consumer-компоненты увидели изменение (planet.owner мутируется напрямую)
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

      const canStore = canStoreResource(planet, resourceId, moveAmount);
      if (canStore <= 0) return false;

      const actualMove = Math.min(moveAmount, canStore);
      planet.warehouse.orbitBuffer.resources[resourceId] -= actualMove;
      planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + actualMove;
      set({ gameState: { ...gameState, galaxy: { ...gameState.galaxy, systems: [...gameState.galaxy.systems] } } });
      return true;
    },

    // ─── Сохранение / Загрузка ─────────────────────────────

    saveGame: async (name?: string) => {
      const { gameState, currentSaveId } = get();
      if (!gameState) return false;

      set({ isSaving: true });
      try {
        const saveName = name || `Galaxy #${gameState.galaxy.seed}`;
        const stateJson = serializeGameState(gameState);

        if (currentSaveId) {
          // Обновить существующее сохранение
          const res = await fetch(`/api/save/${currentSaveId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: saveName, state: stateJson, tick: gameState.time.tick }),
          });
          if (!res.ok) throw new Error('Failed to update save');
        } else {
          // Создать новое сохранение
          const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: saveName,
              seed: gameState.galaxy.seed,
              state: stateJson,
              tick: gameState.time.tick,
            }),
          });
          if (!res.ok) throw new Error('Failed to create save');
          const data = await res.json();
          set({ currentSaveId: data.id });
        }
        return true;
      } catch (e) {
        console.error('Save failed:', e);
        return false;
      } finally {
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

    deleteSave: async (id: string) => {
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
