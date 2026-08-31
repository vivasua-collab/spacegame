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
 *
 * Block 01 P2 (immutable store): все мутации GameState оборачиваются в
 * `produce(currentState, draft => { engine.mutate(draft...) })` —
 * immer создаёт новые ссылки для изменённых путей, что позволяет
 * `useMemo([gameState.galaxy.systems])` корректно срабатывать.
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, EntityId, ProductionQueue, GameState, BuildingLayer } from '@/core/types';
import type { EventPayload } from '@/core/events';
import { findPlanet } from '@/core/find-planet';
import { PRIORITY } from '@/core/module-types';
import { produce } from 'immer';

import {
  processEconomyTick,
  buildOnHex as engineBuildOnHex,
  buildOnAtmosphereSlot as engineBuildOnAtmosphereSlot,
  buildOnOrbitSlot as engineBuildOnOrbitSlot,
  upgradeBuilding as engineUpgradeBuilding,
  downgradeBuilding as engineDowngradeBuilding,
  demolishBuilding as engineDemolishBuilding,
  enqueueProduction as engineEnqueueProduction,
  colonizePlanet as engineColonizePlanet,
  recalcEnergyBalance,
  specializeBuilding as engineSpecializeBuilding,
  upgradeSpecialization as engineUpgradeSpecialization,
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
      'economy:building-downgraded',
      'economy:building-demolished',
      'economy:production-complete',
      'economy:planet-colonized',
      'economy:energy-recalced',
      'economy:resource-depleted',
      'economy:warehouse-full',
      'economy:warehouse-updated',
      // Block 05 PR7 — specialization events
      'economy:building-specialized',
      'economy:specialization-upgraded',
      'economy:processor-output-changed',
      'core:state-changed',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION },
      { event: 'economy:build' },
      { event: 'economy:upgrade' },
      { event: 'economy:enqueue' },
      { event: 'economy:colonize' },
      // Block 05 PR7 — specialize/upgrade events (для логирования; основная
      // обработка идёт через onSpecialize/onUpgrade обработчики ниже)
      { event: 'economy:specialize' },
      { event: 'economy:upgrade-specialization' },
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
  private getGameState: (() => GameState | null) | null = null;

  /**
   * Мутатор для коммита нового иммутабельного состояния в медиатор (Block 01 P2).
   * После produce() модуль вызывает этот колбэк, чтобы обновить ссылку
   * в медиаторе и эмитнуть `core:state-changed` для синхронизации Zustand-стора.
   */
  private commitState: ((state: GameState) => void) | null = null;

  get phase(): ModulePhase { return this._phase; }

  /**
   * Установить функцию доступа к GameState.
   * EconomyModule нуждается в доступе к планетам, но не владеетGameState напрямую.
   */
  setGameStateAccessor(accessor: () => GameState | null): void {
    this.getGameState = accessor;
  }

  /**
   * Установить мутатор для коммита нового состояния в медиатор.
   * Block 01 P2: используется после produce() для обновления ссылки
   * и эмитта `core:state-changed`.
   */
  setGameStateMutator(mutator: (state: GameState) => void): void {
    this.commitState = mutator;
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
      // R-DEMOLISH (Задача 22): понижение уровня и снос зданий
      bus.on('economy:downgrade', (p) => this.onDowngrade(p), { label: 'economy' }),
      bus.on('economy:demolish', (p) => this.onDemolish(p), { label: 'economy' }),
      bus.on('economy:enqueue', (p) => this.onEnqueue(p), { label: 'economy' }),
      bus.on('economy:colonize', (p) => this.onColonize(p), { label: 'economy' }),
      // Block 05 PR7 — specialization events
      bus.on('economy:specialize', (p) => this.onSpecialize(p), { label: 'economy' }),
      bus.on('economy:upgrade-specialization', (p) => this.onUpgradeSpecialization(p), { label: 'economy' }),
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
    const currentState = this.getGameState?.();
    if (!currentState) return;

    // Block 01 P3: dispatch by `layer`. Defaults to 'surface' for backward
    // compatibility — existing test emit `{ planetId, hexIndex, buildingId }`
    // without `layer` continues to call engine.buildOnHex.
    const layer = payload.layer ?? 'surface';

    // Block 01 P2: wrap engine mutation in immer produce() — creates a new
    // immutable state with new references for changed paths. The engine
    // mutates the draft directly (Option A: Draft<Planet> is structurally
    // compatible with Planet for mutation purposes).
    let success = false;
    let reportedHexIndex = payload.hexIndex ?? -1;
    // R-BLD-MOD: передаём researched в engine для проверки requiresTechs.
    // Читаем из currentState (не из draft) — research не меняется во время build.
    const researched = currentState.researchState.researched;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      if (layer === 'atmosphere') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineBuildOnAtmosphereSlot(planet, slotIndex, payload.buildingId, researched);
        // engine emits use hexIndex = -1 - slotIndex for atmosphere — mirror
        // that convention so downstream listeners (UI) can locate the slot.
        if (success) reportedHexIndex = -1 - slotIndex;
      } else if (layer === 'orbit') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineBuildOnOrbitSlot(planet, slotIndex, payload.buildingId, researched);
        if (success) reportedHexIndex = -100 - slotIndex;
      } else {
        // surface (default)
        const hexIndex = payload.hexIndex ?? 0;
        success = engineBuildOnHex(planet, hexIndex, payload.buildingId, researched);
        if (success) reportedHexIndex = hexIndex;
      }
    });

    if (success) {
      this.commitState?.(newState);
      this.bus.emit('economy:building-constructed', {
        planetId: payload.planetId,
        hexIndex: reportedHexIndex,
        buildingId: payload.buildingId,
      });
      // Note: core:state-changed is emitted by mediator.commitState() —
      // no need to emit again here.
    }
  }

  private onUpgrade(payload: EventPayload<'economy:upgrade'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    let newLevel = 0;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      success = engineUpgradeBuilding(planet, payload.hexIndex);
      if (success) {
        newLevel = planet.hexes[payload.hexIndex]?.buildingLevel ?? 0;
      }
    });

    if (success) {
      this.commitState?.(newState);
      this.bus.emit('economy:building-upgraded', {
        planetId: payload.planetId,
        hexIndex: payload.hexIndex,
        level: newLevel,
      });
    }
  }

  // ─── R-DEMOLISH (Задача 22): обработчики понижения и сноса ──────────

  /**
   * Понизить уровень здания на 1. При уровне 1 — снос (гекс/слот
   * освобождается). Диспетчеризация по layer (как в onBuild):
   * 'surface' (default) → hexIndex; 'atmosphere' | 'orbit' → slotIndex.
   */
  private onDowngrade(payload: EventPayload<'economy:downgrade'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    const layer = payload.layer ?? 'surface';
    let success = false;
    let reportedIndex = payload.hexIndex ?? -1;

    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      if (layer === 'atmosphere') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDowngradeBuilding(planet, 'atmosphere', slotIndex);
        if (success) reportedIndex = -1 - slotIndex;
      } else if (layer === 'orbit') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDowngradeBuilding(planet, 'orbit', slotIndex);
        if (success) reportedIndex = -100 - slotIndex;
      } else {
        const hexIndex = payload.hexIndex ?? 0;
        success = engineDowngradeBuilding(planet, 'surface', hexIndex);
        if (success) reportedIndex = hexIndex;
      }
    });

    if (success) {
      this.commitState?.(newState);
      // engine уже эмитнул economy:building-downgraded /
      // economy:building-demolished (уровень 1 = снос) через gameBus —
      // здесь дублируем на шину модуля для UI-слушателей медиатора.
      const isDemolition = this.isCellEmptyAfter(newState, payload.planetId, layer, payload);
      if (!isDemolition) {
        this.bus.emit('economy:building-downgraded', {
          planetId: payload.planetId,
          hexIndex: reportedIndex,
          level: this.getCellLevelAfter(newState, payload.planetId, layer, payload),
        });
      }
    }
  }

  /**
   * Снести здание полностью — освобождает гекс/слот, возвращает 50%
   * вложенных ресурсов. Диспетчеризация по layer (как в onBuild).
   */
  private onDemolish(payload: EventPayload<'economy:demolish'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    const layer = payload.layer ?? 'surface';
    // Считываем id ДО сноса (для эмита на шину модуля).
    const beforeBuildingId = this.getBuildingIdAt(currentState, payload.planetId, layer, payload);
    if (!beforeBuildingId) return;

    let success = false;
    let reportedIndex = payload.hexIndex ?? -1;

    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      if (layer === 'atmosphere') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDemolishBuilding(planet, 'atmosphere', slotIndex);
        if (success) reportedIndex = -1 - slotIndex;
      } else if (layer === 'orbit') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDemolishBuilding(planet, 'orbit', slotIndex);
        if (success) reportedIndex = -100 - slotIndex;
      } else {
        const hexIndex = payload.hexIndex ?? 0;
        success = engineDemolishBuilding(planet, 'surface', hexIndex);
        if (success) reportedIndex = hexIndex;
      }
    });

    if (success) {
      this.commitState?.(newState);
      this.bus.emit('economy:building-demolished', {
        planetId: payload.planetId,
        hexIndex: reportedIndex,
        buildingId: beforeBuildingId,
      });
    }
  }

  /** id здания в указанной ячейке (для эмита до сноса). */
  private getBuildingIdAt(
    state: GameState,
    planetId: EntityId,
    layer: BuildingLayer,
    payload: EventPayload<'economy:demolish'>,
  ): string | null {
    const planet = findPlanet(state, planetId);
    if (!planet) return null;
    if (layer === 'atmosphere') {
      return planet.atmosphericSlots[payload.slotIndex ?? 0]?.buildingId ?? null;
    }
    if (layer === 'orbit') {
      return planet.orbitSlots[payload.slotIndex ?? 0]?.buildingId ?? null;
    }
    return planet.hexes[payload.hexIndex ?? 0]?.buildingId ?? null;
  }

  /** Ячейка пуста после операции (снос прошёл, а не понижение)? */
  private isCellEmptyAfter(
    state: GameState,
    planetId: EntityId,
    layer: BuildingLayer,
    payload: EventPayload<'economy:downgrade'>,
  ): boolean {
    return this.getBuildingIdAt(state, planetId, layer, payload) == null;
  }

  /** Уровень здания в ячейке после операции (для эмита понижения). */
  private getCellLevelAfter(
    state: GameState,
    planetId: EntityId,
    layer: BuildingLayer,
    payload: EventPayload<'economy:downgrade'>,
  ): number {
    const planet = findPlanet(state, planetId);
    if (!planet) return 0;
    if (layer === 'atmosphere') {
      return planet.atmosphericSlots[payload.slotIndex ?? 0]?.buildingLevel ?? 0;
    }
    if (layer === 'orbit') {
      return planet.orbitSlots[payload.slotIndex ?? 0]?.buildingLevel ?? 0;
    }
    return planet.hexes[payload.hexIndex ?? 0]?.buildingLevel ?? 0;
  }

  private onEnqueue(payload: EventPayload<'economy:enqueue'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      success = engineEnqueueProduction(planet, draft.productionQueues, payload.recipeId, payload.repeat);
    });

    if (success) {
      this.commitState?.(newState);
    }
  }

  private onColonize(payload: EventPayload<'economy:colonize'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    let colonyHubHexIndex = -1;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;

      const system = draft.galaxy.systemMap.get(planet.systemId);
      success = engineColonizePlanet(planet, system);
      if (success) {
        // Инициализация склада при колонизации
        if (!planet.warehouse) {
          planet.warehouse = createDefaultWarehouse();
          planet.warehouse = applyColonyRole(planet.warehouse, 'industrial');
          planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
          planet.warehouse.orbitBuffer.capacity = getOrbitBufferCapacity(planet);
        }
        colonyHubHexIndex = planet.hexes.findIndex(h => h.buildingId === 'colony_hub');
      }
    });

    if (success) {
      this.commitState?.(newState);
      this.bus.emit('economy:planet-colonized', {
        planetId: payload.planetId,
        hexIndex: colonyHubHexIndex,
      });
    }
  }

  /**
   * Block 05 PR7: обработчик economy:specialize.
   * Оборачивает engine.specializeBuilding в immer.produce() — создаёт новое
   * иммутабельное состояние с обновлённым hex (processorType/specialization/
   * specializationLevel/activeRecipes) и списанной/возвращённой стоимостью.
   *
   * engine.specializeBuilding сам эмитит economy:building-specialized и
   * economy:processor-output-changed через gameBus (legacy adapter проксирует
   * в typedBus) — повторный эмит здесь не нужен.
   */
  private onSpecialize(payload: EventPayload<'economy:specialize'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      const result = engineSpecializeBuilding(planet, payload.hexIndex, payload.category);
      success = result.success;
    });

    if (success) {
      this.commitState?.(newState);
    }
  }

  /**
   * Block 05 PR7: обработчик economy:upgrade-specialization.
   * Оборачивает engine.upgradeSpecialization в immer.produce().
   * engine.upgradeSpecialization сам эмитит economy:specialization-upgraded
   * и economy:processor-output-changed через gameBus.
   */
  private onUpgradeSpecialization(payload: EventPayload<'economy:upgrade-specialization'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      const result = engineUpgradeSpecialization(planet, payload.hexIndex);
      success = result.success;
    });

    if (success) {
      this.commitState?.(newState);
    }
  }

  /**
   * Обработка тика экономики.
   * Вызывается ModuleRegistry.tickAll() внутри каждого game-loop тика,
   * а также напрямую из GameMediator.tick() для пошагового режима.
   *
   * Block 01 P2: обёрнуто в immer produce() — после тика создаётся новое
   * иммутабельное состояние с новыми ссылками для изменённых путей
   * (planet.resources, planet.energyBalance, и т.д.).
   */
  private processEconomyTick(): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    const newState = produce(currentState, (draft) => {
      const colonizedPlanets = draft.galaxy.systems
        .flatMap(s => s.planets)
        .filter(p => p.owner != null);

      processEconomyTick(colonizedPlanets, draft.productionQueues, draft.galaxy.systemMap);
    });

    // Коммит нового состояния в медиатор → эмит core:state-changed →
    // подписка в game-store обновляет Zustand-state.
    this.commitState?.(newState);
  }

  // ─── Обработчики запросов ─────────────────────────────

  private queryPlanetResources(planetId: EntityId): Record<string, number> | null {
    const state = this.getGameState?.();
    if (!state) return null;
    const planet = findPlanet(state, planetId);
    return planet ? { ...planet.resources } : null;
  }

  private queryPlanetEnergy(planetId: EntityId): { balance: number } | null {
    const state = this.getGameState?.();
    if (!state) return null;
    const planet = findPlanet(state, planetId);
    return planet ? { balance: planet.energyBalance } : null;
  }

  private queryProductionQueue(planetId: EntityId): ProductionQueue | null {
    const state = this.getGameState?.();
    if (!state) return null;
    return state.productionQueues.get(planetId) ?? null;
  }

  // ─── Утилиты ──────────────────────────────────────────

  // Audit Pass 2 P3-3: private findPlanet removed — uses the shared
  // helper from `@/core/find-planet` (imported at top of file).
  // All internal call sites use the imported `findPlanet` directly.
}
