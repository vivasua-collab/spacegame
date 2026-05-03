/**
 * Основной Zustand-стор для игрового состояния.
 */

import { create } from 'zustand';
import type { GameState, GameTime, GameSpeed, GamePhase, Galaxy, StarSystem, Planet, EntityId, ProductionQueue } from '@/core/types';
import { generateGalaxy, type GalaxyGenConfig } from '@/galaxy';
import { processEconomyTick, buildOnHex, upgradeBuilding, enqueueProduction, giveStarterResources, recalcEnergyBalance } from '@/economy';
import { gameBus } from '@/core/event-bus';
import { BUILDING_MAP } from '@/data/buildings';

// ============ Типы стора ============

export type GameView = 'galaxy' | 'system' | 'planet';

export interface GameStore {
  // === Состояние ===
  gameState: GameState | null;
  view: GameView;
  selectedSystemId: EntityId | null;
  selectedPlanetId: EntityId | null;
  isInitialized: boolean;

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

  // Утилиты
  getSystem: (id: EntityId) => StarSystem | undefined;
  getPlanet: (id: EntityId) => Planet | undefined;
  getSelectedSystem: () => StarSystem | undefined;
  getSelectedPlanet: () => Planet | undefined;
}

export const useGameStore = create<GameStore>((set, get) => {
  /** Создать начальное GameState */
  function createInitialState(config: Partial<GalaxyGenConfig>): GameState {
    const galaxy = generateGalaxy(config);

    // Даём стартовые ресурсы на первую планету первой системы
    const firstSystem = galaxy.systems[0];
    if (firstSystem && firstSystem.planets.length > 0) {
      const firstPlanet = firstSystem.planets[0];
      giveStarterResources(firstPlanet);
      firstPlanet.owner = 'player';
      recalcEnergyBalance(firstPlanet);

      // Установить солнечную станцию на первый подходящий гекс
      for (let i = 0; i < firstPlanet.hexes.length; i++) {
        const hex = firstPlanet.hexes[i];
        if (!hex.buildingId && hex.terrain !== 'ocean') {
          hex.buildingId = 'solar_plant';
          hex.buildingLevel = 1;
          break;
        }
      }
      recalcEnergyBalance(firstPlanet);
    }

    return {
      time: { tick: 0, day: 0, year: 0 },
      speed: 1,
      phase: 'paused',
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

    newGame: (config = {}) => {
      const state = createInitialState(config);
      set({
        gameState: state,
        view: 'galaxy',
        selectedSystemId: state.galaxy.systems[0]?.id ?? null,
        selectedPlanetId: null,
        isInitialized: true,
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

      // Обновляем время
      const TICKS_PER_DAY = 86400;
      gameState.time.tick += gameState.speed;
      gameState.time.day = Math.floor(gameState.time.tick / TICKS_PER_DAY);
      gameState.time.year = Math.floor(gameState.time.day / 365);

      // Обрабатываем экономику каждый "дневной" тик
      const allPlanets = gameState.galaxy.systems.flatMap(s => s.planets);
      processEconomyTick(allPlanets, gameState.productionQueues);

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
