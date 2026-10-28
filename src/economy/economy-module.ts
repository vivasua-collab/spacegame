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
import type { GameTime, EntityId, ProductionQueue, GameState } from '@/core/types';
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
  specializeWorkshop as engineSpecializeWorkshop,
  upgradeWorkshopSpecialization as engineUpgradeWorkshopSpecialization,
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
      // R-39 (единая шина): события исходов помеченные (*) эмитятся
      // engine-функциями на gameBus (=== шина медиатора) внутри
      // produce()-блока обработчиков; модуль их НЕ ре-эмитит (дубль).
      // Манифест описывает события СИСТЕМЫ economy (кто бы их ни публиковал
      // на пути store → модуль → engine).
      'economy:building-constructed', // (*) engine.buildOn*
      'economy:building-upgraded',    // (*) engine.upgradeBuilding
      'economy:building-downgraded',  // (*) engine.downgradeBuilding
      'economy:building-demolished',  // (*) engine.demolishBuilding
      'economy:production-complete',  // (*) engine.processEconomyTick
      'economy:planet-colonized',     // (*) engine.colonizePlanet
      'economy:energy-recalced',
      'economy:resource-depleted',
      'economy:warehouse-full',
      'economy:warehouse-updated',
      // PROC-WORKSHOPS-01 — события цехов
      'economy:building-specialized',    // (*) engine.specializeWorkshop
      'economy:specialization-upgraded', // (*) engine.upgradeWorkshopSpecialization
      'economy:workshop-batch-started',  // (*) workshop-scheduler (партии цехов)
      'core:state-changed',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION },
      { event: 'economy:build' },
      { event: 'economy:upgrade' },
      { event: 'economy:enqueue' },
      { event: 'economy:colonize' },
      // PROC-WORKSHOPS-01 — specialize/upgrade события цехов (основная
      // обработка — onSpecialize/onUpgradeSpecialization ниже)
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
    // R-BLD-MOD: передаём researched в engine для проверки requiresTechs.
    // Читаем из currentState (не из draft) — research не меняется во время build.
    const researched = currentState.researchState.researched;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      if (layer === 'atmosphere') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineBuildOnAtmosphereSlot(planet, slotIndex, payload.buildingId, researched);
      } else if (layer === 'orbit') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineBuildOnOrbitSlot(planet, slotIndex, payload.buildingId, researched);
      } else {
        // surface (default)
        const hexIndex = payload.hexIndex ?? 0;
        success = engineBuildOnHex(planet, hexIndex, payload.buildingId, researched);
      }
    });

    if (success) {
      // R-39 (единая шина): state закоммичен. Событие
      // 'economy:building-constructed' НЕ ре-эмитится здесь — его эмитит
      // сам engine.buildOnHex/buildOnAtmosphereSlot/buildOnOrbitSlot на
      // gameBus (=== this.bus после унификации R-39) с ИДЕНТИЧНЫМ payload
      // (конвенция reportIndex: surface → hexIndex, atmosphere → -1-slot,
      // orbit → -100-slot). Прежний ре-эмит был нужен, пока engine эмитил
      // в «мёртвый» gameBus, а модуль — в шину медиатора: после унификации
      // он стал бы ДУБЛЕМ (двойное событие на одно действие).
      this.commitState?.(newState);
    }
  }

  private onUpgrade(payload: EventPayload<'economy:upgrade'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    // R-40: requiresTechs-гейт действует и на апгрейд — читаем researched
    // из currentState (не из draft), как в onBuild.
    const researched = currentState.researchState.researched;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      success = engineUpgradeBuilding(planet, payload.hexIndex, researched);
    });

    if (success) {
      // R-39: 'economy:building-upgraded' эмитит engine.upgradeBuilding
      // (gameBus === this.bus) — ре-эмит был бы дублем.
      this.commitState?.(newState);
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

    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      // PROC-WORKSHOPS-01: queues передаются в engine — партии удалённых
      // понижением цехов возвращаются в хвост FIFO-пула с прогрессом.
      if (layer === 'atmosphere') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDowngradeBuilding(planet, 'atmosphere', slotIndex, draft.productionQueues);
      } else if (layer === 'orbit') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDowngradeBuilding(planet, 'orbit', slotIndex, draft.productionQueues);
      } else {
        const hexIndex = payload.hexIndex ?? 0;
        success = engineDowngradeBuilding(planet, 'surface', hexIndex, draft.productionQueues);
      }
    });

    if (success) {
      // R-39: 'economy:building-downgraded' / 'economy:building-demolished'
      // (уровень 1 = снос) эмитит engine.downgradeBuilding на gameBus
      // (=== this.bus) с той же конвенцией reportIndex — ре-эмит был бы
      // дублем после унификации шин.
      this.commitState?.(newState);
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
    let success = false;

    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      // PROC-WORKSHOPS-01: queues — партии цехов сносимого здания в хвост FIFO.
      if (layer === 'atmosphere') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDemolishBuilding(planet, 'atmosphere', slotIndex, draft.productionQueues);
      } else if (layer === 'orbit') {
        const slotIndex = payload.slotIndex ?? 0;
        success = engineDemolishBuilding(planet, 'orbit', slotIndex, draft.productionQueues);
      } else {
        const hexIndex = payload.hexIndex ?? 0;
        success = engineDemolishBuilding(planet, 'surface', hexIndex, draft.productionQueues);
      }
    });

    if (success) {
      // R-39: 'economy:building-demolished' эмитит engine.demolishBuilding
      // (gameBus === this.bus, payload идентичен: тот же removedId/
      // reportIndex) — ре-эмит был бы дублем.
      this.commitState?.(newState);
    }
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
      }
    });

    if (success) {
      // R-39: 'economy:planet-colonized' эмитит engine.colonizePlanet на
      // gameBus (=== this.bus; hexIndex = гекс размещения colony_hub) —
      // ре-эмит был бы дублем.
      this.commitState?.(newState);
    }
  }

  /**
   * PROC-WORKSHOPS-01: обработчик economy:specialize.
   * Оборачивает engine.specializeWorkshop в immer.produce() — новое
   * состояние со специализированным цехом (workshops[n-1]) и списанной
   * стоимостью. engine.specializeWorkshop сам эмитит
   * economy:building-specialized на gameBus (= шина медиатора, R-39).
   */
  private onSpecialize(payload: EventPayload<'economy:specialize'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      const result = engineSpecializeWorkshop(
        planet,
        payload.hexIndex,
        payload.workshopNumber,
        payload.recipeId,
      );
      success = result.success;
    });

    if (success) {
      this.commitState?.(newState);
    }
  }

  /**
   * PROC-WORKSHOPS-01: обработчик economy:upgrade-specialization.
   * Оборачивает engine.upgradeWorkshopSpecialization в immer.produce().
   * engine сам эмитит economy:specialization-upgraded (единая шина R-39).
   */
  private onUpgradeSpecialization(payload: EventPayload<'economy:upgrade-specialization'>): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let success = false;
    const newState = produce(currentState, (draft) => {
      const planet = findPlanet(draft, payload.planetId);
      if (!planet) return;
      const result = engineUpgradeWorkshopSpecialization(
        planet,
        payload.hexIndex,
        payload.workshopNumber,
      );
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
    // R-39 (phase guard): экономика обрабатывается ТОЛЬКО в фазе playing.
    // Прежде guard был только у посредника (mediator.tick) и GameLoop
    // (loop.start только из playing), но не у самого модуля: saveGame
    // ставил phase='paused', не останавливая интервал (race R-39), и тики
    // продолжали обрабатывать экономику «в паузе». Зеркалим guard
    // ResearchModule (процесс-такт — защита в глубину).
    if (currentState.phase !== 'playing') return;

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
