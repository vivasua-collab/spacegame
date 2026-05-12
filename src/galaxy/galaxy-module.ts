/**
 * GalaxyModule — модуль генерации и управления галактикой.
 *
 * Отвечает за:
 * - Генерацию галактики
 * - Доступ к системам и планетам
 * - Обработку запросов о звёздных системах
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, EntityId, StarSystem } from '@/core/types';
import type { EventPayload } from '@/core/events';
import { PRIORITY } from '@/core/module-types';

export class GalaxyModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'galaxy',
    name: 'Галактика',
    version: '1.0.0',
    description: 'Генерация галактики, звёздные системы, планеты',
    dependencies: ['core'],
    emits: [
      'galaxy:generated',
      'galaxy:system-discovered',
      'galaxy:system-surveyed',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION },
      { event: 'core:game-created' },
    ],
    handlesQueries: [
      { queryName: 'galaxy:system-by-id', description: 'Получить звёздную систему по ID', requestType: 'EntityId', responseType: 'StarSystem | undefined' },
      { queryName: 'galaxy:planet-by-id', description: 'Получить планету по ID', requestType: 'EntityId', responseType: 'Planet | undefined' },
      { queryName: 'galaxy:colonized-planets', description: 'Список колонизированных планет', requestType: 'void', responseType: 'Planet[]' },
    ],
    requiresQueries: [],
  };

  private _phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubscribers: Array<() => void> = [];
  private getGameState: (() => import('@/core/types').GameState | null) | null = null;

  get phase(): ModulePhase { return this._phase; }

  setGameStateAccessor(accessor: () => import('@/core/types').GameState | null): void {
    this.getGameState = accessor;
  }

  init(bus: TypedEventBus, registry: ModuleRegistry): void {
    this.bus = bus;
    this.registry = registry;
    this._phase = 'initialized';

    this.unsubscribers.push(
      bus.on('core:tick', (time) => this.onTick(time), { priority: PRIORITY.SIMULATION, label: 'galaxy' }),
      bus.on('core:game-created', (p) => this.onGameCreated(p), { label: 'galaxy' }),
    );

    registry.registerQuery('galaxy:system-by-id', (id) => this.querySystemById(id as EntityId));
    registry.registerQuery('galaxy:planet-by-id', (id) => this.queryPlanetById(id as EntityId));
    registry.registerQuery('galaxy:colonized-planets', () => this.queryColonizedPlanets());
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  tick(time: GameTime): void {
    // Галактика не требует обработки тиков (статичная после генерации)
  }

  stop(): void {
    if (this._phase !== 'started') return;
    this._phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    this.registry.unregisterQuery('galaxy:system-by-id');
    this.registry.unregisterQuery('galaxy:planet-by-id');
    this.registry.unregisterQuery('galaxy:colonized-planets');

    this._phase = 'destroyed';
  }

  serialize(): Record<string, unknown> {
    return { version: this.manifest.version };
  }

  deserialize(_data: Record<string, unknown>): void {
    // Не требуется
  }

  // ─── Обработчики событий ──────────────────────────────

  private onTick(time: GameTime): void {
    // Галактика статична — нет действий на тик
  }

  private onGameCreated(payload: EventPayload<'core:game-created'>): void {
    this.bus.emit('galaxy:generated', {
      galaxyId: payload.galaxyId,
      systemCount: 0, // Будет заполнено позже
      seed: payload.seed,
    });
  }

  // ─── Обработчики запросов ─────────────────────────────

  private querySystemById(id: EntityId): StarSystem | undefined {
    const state = this.getGameState?.();
    return state?.galaxy.systemMap.get(id);
  }

  private queryPlanetById(id: EntityId): import('@/core/types').Planet | undefined {
    const state = this.getGameState?.();
    if (!state) return undefined;
    for (const system of state.galaxy.systems) {
      const planet = system.planets.find(p => p.id === id);
      if (planet) return planet;
    }
    return undefined;
  }

  private queryColonizedPlanets(): import('@/core/types').Planet[] {
    const state = this.getGameState?.();
    if (!state) return [];
    return state.galaxy.systems.flatMap(s => s.planets).filter(p => p.owner != null);
  }
}
