/**
 * Block 02 (F5): ShipsModule — модуль кораблей.
 *
 * Реализует IGameModule. Подписывается на core:tick (priority: SIMULATION + 10,
 * после economy). На каждом тике вызывает processShipyardTick для всех
 * планетных очередей постройки кораблей. Создаёт Ship-сущности и кладёт их
 * в GameState.ships (Map).
 *
 * Block 01 P2 (immutable store): все мутации GameState оборачиваются в
 * `produce(currentState, draft => { ... })` — immer создаёт новые ссылки
 * для изменённых путей.
 *
 * Manifest:
 * - dependencies: ['economy'] — нужен для доступа к planets (через accessor).
 * - emits: ships:constructed, ships:construction-progress, ships:construction-started,
 *   ships:arrived, ships:fuel-consumed, core:state-changed.
 * - subscribes: core:tick (priority SIMULATION + 10 — после economy).
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, EntityId, GameState, Ship } from '@/core/types';
import { PRIORITY } from '@/core/module-types';
import { produce } from 'immer';
import { processShipyardTick } from '@/data/ships/shipyard-queue';

// Module-level deterministic ship ID counter (no Math.random — Block 07 gap-3).
let shipCounter = 0;

/**
 * Reset ship ID counter — вызывать после newGame/loadGame, чтобы IDs начинались с 0.
 * Экспортируется для тестов (по аналогии с resetProductionItemCounter).
 */
export function resetShipCounter(): void {
  shipCounter = 0;
}

export class ShipsModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'ships',
    name: 'Корабли',
    version: '1.0.0',
    description: 'Постройка кораблей на верфях (shipyard queue processing)',
    dependencies: ['economy'],
    emits: [
      'ships:constructed',
      'ships:construction-progress',
      'ships:construction-started',
      'ships:arrived',
      'ships:fuel-consumed',
      'core:state-changed',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION + 10 },
    ],
    handlesQueries: [],
    requiresQueries: [],
  };

  private _phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubscribers: Array<() => void> = [];

  /** Accessor для GameState (устанавливается из store/mediator). */
  private getGameState: (() => GameState | null) | null = null;

  /** Mutator для коммита нового иммутабельного состояния в медиатор. */
  private commitState: ((state: GameState) => void) | null = null;

  get phase(): ModulePhase { return this._phase; }

  setGameStateAccessor(accessor: () => GameState | null): void {
    this.getGameState = accessor;
  }

  setGameStateMutator(mutator: (state: GameState) => void): void {
    this.commitState = mutator;
  }

  init(bus: TypedEventBus, registry: ModuleRegistry): void {
    this.bus = bus;
    this.registry = registry;
    this._phase = 'initialized';
    this.unsubscribers.push(
      bus.on('core:tick', (time) => this.onTick(time), {
        priority: PRIORITY.SIMULATION + 10,
        label: 'ships',
      }),
    );
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  tick(time: GameTime): void {
    if (this._phase !== 'started') return;
    this.processShipsTick(time);
  }

  stop(): void {
    if (this._phase !== 'started') return;
    this._phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this._phase = 'destroyed';
  }

  serialize(): Record<string, unknown> {
    return { version: this.manifest.version };
  }

  deserialize(_data: Record<string, unknown>): void {
    // No-op — состояние хранится в GameState
  }

  // ─── Tick handler ─────────────────────────────────────────────────

  private onTick(time: GameTime): void {
    // Not used — tick() is called via ModuleRegistry.tickAll()
    void time;
  }

  /**
   * Обработка тика кораблей: для каждой планеты с shipyard queue —
   * processShipyardTick. Созданные корабли добавляются в GameState.ships.
   *
   * Block 01 P2: обёрнуто в immer produce() — после тика создаётся новое
   * иммутабельное состояние с новыми ссылками для изменённых путей
   * (planet.resources, planet.hexes, gameState.ships).
   */
  private processShipsTick(time: GameTime): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;

    let shipsCreatedThisTick = 0;
    const newState = produce(currentState, (draft) => {
      // Для каждой планеты с очередью верфи — processShipyardTick
      for (const [planetId, queue] of draft.shipyardQueues) {
        if (queue.items.length === 0) continue;
        // Найти планету в galaxy
        const planet = this.findPlanet(draft, planetId);
        if (!planet) continue;
        // Get design — use first queue item's designId
        const item = queue.items[0];
        if (!item) continue;
        const design = draft.shipDesigns.get(item.designId);
        // ID generator — deterministic
        const shipIdGen = (): EntityId => `ship_${time.tick}_${shipCounter++}`;
        const result = processShipyardTick(planet, queue, shipIdGen, design);
        // Apply queue update
        draft.shipyardQueues.set(planetId, result.newQueue);
        // If ship was created — add to ships Map
        if (result.ship) {
          draft.ships.set(result.ship.id, result.ship as Ship);
          shipsCreatedThisTick++;
        }
      }
    });

    // Коммит нового состояния (если что-то изменилось)
    if (shipsCreatedThisTick > 0) {
      this.commitState?.(newState);
    }
  }

  // ─── Utils ───────────────────────────────────────────────────────

  private findPlanet(state: GameState, planetId: EntityId) {
    for (const system of state.galaxy.systems) {
      const planet = system.planets.find(p => p.id === planetId);
      if (planet) return planet;
    }
    return undefined;
  }
}
