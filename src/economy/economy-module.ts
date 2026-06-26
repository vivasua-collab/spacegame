/**
 * EconomyModule — модуль экономики.
 *
 * Реализует IGameModule и инкапсулирует:
 * - Добычу ресурсов
 * - Производство (очередь)
 * - Энергобаланс
 * - Строительство и улучшение зданий
 * - Колонизацию
 * - Управление складами
 *
 * Связь с другими модулями — только через TypedEventBus и ModuleRegistry.query().
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, EntityId, Planet, ProductionQueue } from '@/core/types';
import type { EventPayload } from '@/core/events';
import { PRIORITY } from '@/core/module-types';

import {
  processEconomyTick,
  buildOnHex as engineBuildOnHex,
  upgradeBuilding as engineUpgradeBuilding,
  enqueueProduction as engineEnqueueProduction,
  colonizePlanet as engineColonizePlanet,
  recalcEnergyBalance,
} from './engine';
import { createDefaultWarehouse, applyColonyRole, calculateWarehouseCapacity, getOrbitBufferCapacity, canStoreResource } from '@/data/warehouse';

export class EconomyModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'economy',
    name: 'Экономика',
    version: '1.0.0',
    description: 'Добыча ресурсов, производство, энергетика, склады',
    dependencies: ['galaxy'],
    emits: [
      'economy:building-constructed',
      'economy:building-upgraded',
      'economy:production-complete',
      'economy:planet-colonized',
      'economy:energy-recalced',
      'economy:resource-depleted',
      'economy:warehouse-full',
      'economy:warehouse-updated',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION },
      { event: 'economy:build' },
      { event: 'economy:upgrade' },
      { event: 'economy:enqueue' },
      { event: 'economy:colonize' },
    ],
    handlesQueries: [
      { queryName: 'economy:planet-resources', description: 'Ресурсы планеты', requestType: 'EntityId', responseType: 'Record<string, number>' },
      { queryName: 'economy:planet-energy', description: 'Энергобаланс планеты', requestType: 'EntityId', responseType: '{ balance: number }' },
      { queryName: 'economy:production-queue', description: 'Очередь производства', requestType: 'EntityId', responseType: 'ProductionQueue | null' },
    ],
    requiresQueries: [
      { queryName: 'galaxy:system-by-id', description: 'Получить звёздную систему', requestType: 'EntityId', responseType: 'StarSystem | undefined' },
    ],
  };

  private _phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubscribers: Array<() => void> = [];

  /** Ссылка на GameState — устанавливается извне для доступа к планетам */
  private getGameState: (() => import('@/core/types').GameState | null) | null = null;

  get phase(): ModulePhase { return this._phase; }

  /**
   * Установить функцию доступа к GameState.
   * EconomyModule нуждается в доступе к планетам, но не владеетGameState напрямую.
   */
  setGameStateAccessor(accessor: () => import('@/core/types').GameState | null): void {
    this.getGameState = accessor;
  }

  init(bus: TypedEventBus, registry: ModuleRegistry): void {
    this.bus = bus;
    this.registry = registry;
    this._phase = 'initialized';

    // Подписка на события
    this.unsubscribers.push(
      bus.on('core:tick', (time) => this.onTick(time), { priority: PRIORITY.SIMULATION, label: 'economy' }),
      bus.on('economy:build', (p) => this.onBuild(p), { label: 'economy' }),
      bus.on('economy:upgrade', (p) => this.onUpgrade(p), { label: 'economy' }),
      bus.on('economy:enqueue', (p) => this.onEnqueue(p), { label: 'economy' }),
      bus.on('economy:colonize', (p) => this.onColonize(p), { label: 'economy' }),
    );

    // Регистрация обработчиков запросов
    registry.registerQuery('economy:planet-resources', (planetId) => this.queryPlanetResources(planetId as EntityId));
    registry.registerQuery('economy:planet-energy', (planetId) => this.queryPlanetEnergy(planetId as EntityId));
    registry.registerQuery('economy:production-queue', (planetId) => this.queryProductionQueue(planetId as EntityId));
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  tick(time: GameTime): void {
    if (this._phase !== 'started') return;
    this.processEconomyTick();
  }

  stop(): void {
    if (this._phase !== 'started') return;
    this._phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    this.registry.unregisterQuery('economy:planet-resources');
    this.registry.unregisterQuery('economy:planet-energy');
    this.registry.unregisterQuery('economy:production-queue');

    this._phase = 'destroyed';
  }

  serialize(): Record<string, unknown> {
    // Состояние экономики хранится в GameState (planets, productionQueues)
    // Модуль не владеет собственным состоянием в этой версии
    return { version: this.manifest.version };
  }

  deserialize(_data: Record<string, unknown>): void {
    // Восстановление не требуется — состояние в GameState
  }

  // ─── Обработчики событий ──────────────────────────────

  private onTick(time: GameTime): void {
    // Тик обрабатывается через tick() от ModuleRegistry
    // Этот обработчик для дополнительных действий на каждый тик
  }

  private onBuild(payload: EventPayload<'economy:build'>): void {
    const state = this.getGameState?.();
    if (!state) return;

    const planet = this.findPlanet(state, payload.planetId);
    if (!planet) return;

    const result = engineBuildOnHex(planet, payload.hexIndex, payload.buildingId);
    if (result) {
      this.bus.emit('economy:building-constructed', {
        planetId: payload.planetId,
        hexIndex: payload.hexIndex,
        buildingId: payload.buildingId,
      });
    }
  }

  private onUpgrade(payload: EventPayload<'economy:upgrade'>): void {
    const state = this.getGameState?.();
    if (!state) return;

    const planet = this.findPlanet(state, payload.planetId);
    if (!planet) return;

    const result = engineUpgradeBuilding(planet, payload.hexIndex);
    if (result) {
      const hex = planet.hexes[payload.hexIndex];
      this.bus.emit('economy:building-upgraded', {
        planetId: payload.planetId,
        hexIndex: payload.hexIndex,
        level: hex.buildingLevel,
      });
    }
  }

  private onEnqueue(payload: EventPayload<'economy:enqueue'>): void {
    const state = this.getGameState?.();
    if (!state) return;

    const planet = this.findPlanet(state, payload.planetId);
    if (!planet) return;

    engineEnqueueProduction(planet, state.productionQueues, payload.recipeId, payload.repeat);
  }

  private onColonize(payload: EventPayload<'economy:colonize'>): void {
    const state = this.getGameState?.();
    if (!state) return;

    const planet = this.findPlanet(state, payload.planetId);
    if (!planet) return;

    const system = state.galaxy.systemMap.get(planet.systemId);
    const result = engineColonizePlanet(planet, system);
    if (result) {
      // Инициализация склада при колонизации
      if (!planet.warehouse) {
        planet.warehouse = createDefaultWarehouse();
        planet.warehouse = applyColonyRole(planet.warehouse, 'industrial');
        planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
        planet.warehouse.orbitBuffer.capacity = getOrbitBufferCapacity(planet);
      }

      this.bus.emit('economy:planet-colonized', {
        planetId: payload.planetId,
        hexIndex: planet.hexes.findIndex(h => h.buildingId === 'colony_hub'),
      });
    }
  }

  // ─── Обработка тика экономики ─────────────────────────

  private processEconomyTick(): void {
    const state = this.getGameState?.();
    if (!state) return;

    const colonizedPlanets = state.galaxy.systems
      .flatMap(s => s.planets)
      .filter(p => p.owner != null);

    processEconomyTick(colonizedPlanets, state.productionQueues, state.galaxy.systemMap);
  }

  // ─── Обработчики запросов ─────────────────────────────

  private queryPlanetResources(planetId: EntityId): Record<string, number> | null {
    const state = this.getGameState?.();
    if (!state) return null;
    const planet = this.findPlanet(state, planetId);
    return planet ? { ...planet.resources } : null;
  }

  private queryPlanetEnergy(planetId: EntityId): { balance: number } | null {
    const state = this.getGameState?.();
    if (!state) return null;
    const planet = this.findPlanet(state, planetId);
    return planet ? { balance: planet.energyBalance } : null;
  }

  private queryProductionQueue(planetId: EntityId): ProductionQueue | null {
    const state = this.getGameState?.();
    if (!state) return null;
    return state.productionQueues.get(planetId) ?? null;
  }

  // ─── Утилиты ──────────────────────────────────────────

  private findPlanet(state: import('@/core/types').GameState, planetId: EntityId): Planet | undefined {
    for (const system of state.galaxy.systems) {
      const planet = system.planets.find(p => p.id === planetId);
      if (planet) return planet;
    }
    return undefined;
  }
}
