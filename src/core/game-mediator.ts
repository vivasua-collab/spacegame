/**
 * GameMediator — центральный оркестратор игры.
 *
 * Связывает вместе:
 * - TypedEventBus (шина событий)
 * - ModuleRegistry (реестр модулей)
 * - GameLoop (игровой цикл)
 *
 * GameMediator — единственная точка входа для:
 * - Создания новой игры
 * - Загрузки/сохранения
 * - Управления паузой/скоростью
 * - Регистрации модулей
 *
 * UI работает с GameMediator через Zustand store,
 * который делегирует действия медиатору.
 */

import { TypedEventBus } from './typed-event-bus';
import { ModuleRegistry } from './module-registry';
import { GameLoop } from './game-loop';
import type { IGameModule, ModuleId } from './module-types';
import type { GameTime, GameSpeed, GamePhase, Galaxy, EntityId, GameState, ProductionQueue } from './types';
import { generateGalaxy, type GalaxyGenConfig } from '@/galaxy';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { setCurrentLookups } from '@/data/baked-lookups';

export class GameMediator {
  readonly bus: TypedEventBus;
  readonly registry: ModuleRegistry;
  readonly loop: GameLoop;

  private gameState: GameState | null = null;

  constructor() {
    this.bus = new TypedEventBus();
    this.registry = new ModuleRegistry(this.bus);
    this.loop = new GameLoop(this.bus, this.registry);

    // Включить replay для ключевых событий (поздние подписчики)
    this.bus.enableReplay('core:tick');
    this.bus.enableReplay('core:game-created');
  }

  // ─── Управление модулями ──────────────────────────────

  /** Зарегистрировать модуль */
  registerModule(module: IGameModule): void {
    this.registry.register(module);
  }

  /** Зарегистрировать несколько модулей и инициализировать */
  registerAndInit(modules: IGameModule[]): void {
    for (const mod of modules) {
      this.registry.register(mod);
    }
    this.registry.initAll();
  }

  // ─── Управление игрой ─────────────────────────────────

  /** Создать новую игру */
  newGame(config?: Partial<GalaxyGenConfig>): GameState {
    // Остановить текущую игру если есть
    if (this.gameState) {
      this.registry.stopAll();
    }

    const galaxy = generateGalaxy(config);

    this.gameState = {
      time: { tick: 0, dayInYear: 0, year: 1 },
      speed: 0,
      phase: 'colonization',
      galaxy,
      productionQueues: new Map(),
      fleets: [],
      playerFactionId: 'player',
    };

    // Установить lookup для baked model
    setCurrentLookups(galaxy.bakedModel);

    // Уведомить модули
    this.bus.emit('core:game-created', {
      galaxyId: galaxy.id,
      seed: galaxy.seed,
    });

    return this.gameState;
  }

  /** Установить загруженное состояние */
  setLoadedState(state: GameState): void {
    this.registry.stopAll();

    this.gameState = state;

    // Установить lookup для baked model
    if (state.galaxy.bakedModel) {
      setCurrentLookups(state.galaxy.bakedModel);
    }

    // Установить время в GameLoop
    this.loop.setTime(state.time);

    this.bus.emit('core:game-loaded', { saveId: '' });
  }

  /** Получить текущее состояние игры */
  getGameState(): GameState | null {
    return this.gameState;
  }

  /** Обновить ссылку на gameState (для синхронизации с Zustand) */
  setGameState(state: GameState): void {
    this.gameState = state;
  }

  // ─── Управление временем ──────────────────────────────

  /** Установить скорость */
  setSpeed(speed: GameSpeed): void {
    if (!this.gameState) return;
    this.gameState.speed = speed;
    if (speed > 0) {
      this.gameState.phase = 'playing';
      this.loop.setSpeed(speed);
    }
  }

  /** Переключить паузу */
  togglePause(): void {
    if (!this.gameState) return;
    if (this.gameState.phase === 'playing') {
      this.gameState.phase = 'paused';
      this.gameState.speed = 0;
      this.loop.pause();
    } else {
      this.gameState.phase = 'playing';
      this.gameState.speed = 1;
      this.loop.start();
    }
  }

  /** Обработать тик (вызывается из React useEffect) */
  tick(): void {
    if (!this.gameState || this.gameState.phase !== 'playing') return;

    const speed = this.gameState.speed;
    this.gameState.time.tick += speed;
    this.gameState.time.dayInYear = this.gameState.time.tick % 365;
    this.gameState.time.year = Math.floor(this.gameState.time.tick / 365) + 1;

    // Тик через реестр модулей
    this.registry.tickAll(this.gameState.time);
  }

  // ─── Запросы к данным ─────────────────────────────────

  /** Получить систему по ID */
  getSystem(id: EntityId) {
    return this.gameState?.galaxy.systemMap.get(id);
  }

  /** Получить планету по ID */
  getPlanet(id: EntityId) {
    if (!this.gameState) return undefined;
    for (const system of this.gameState.galaxy.systems) {
      const planet = system.planets.find(p => p.id === id);
      if (planet) return planet;
    }
    return undefined;
  }

  /** Получить колонизированные планеты */
  getColonizedPlanets() {
    if (!this.gameState) return [];
    return this.gameState.galaxy.systems.flatMap(s => s.planets).filter(p => p.owner != null);
  }

  /** Получить очередь производства */
  getProductionQueue(planetId: EntityId) {
    return this.gameState?.productionQueues.get(planetId) ?? null;
  }

  // ─── Уничтожение ──────────────────────────────────────

  /** Полная очистка (для тестов или перезагрузки) */
  destroy(): void {
    this.loop.destroy();
    this.registry.destroyAll();
    this.bus.clear();
    this.gameState = null;
  }
}

/** Глобальный синглтон медиатора */
let _mediator: GameMediator | null = null;

/** Получить или создать глобальный медиатор */
export function getGameMediator(): GameMediator {
  if (!_mediator) {
    _mediator = new GameMediator();
  }
  return _mediator;
}

/** Сбросить глобальный медиатор (для тестов) */
export function resetGameMediator(): void {
  if (_mediator) {
    _mediator.destroy();
    _mediator = null;
  }
}
