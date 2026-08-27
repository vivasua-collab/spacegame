/**
 * Block 02 (F5): FleetModule — модуль флотов.
 *
 * Реализует IGameModule. Подписывается на core:tick (priority: SIMULATION + 20,
 * после ships — чтобы корабли были построены до движения флотов).
 * На каждом тике итерирует gameState.fleets и вызывает processFleetTick
 * для каждого. Эмитит fleet:arrived, fleet:stranded по мере обработки.
 *
 * Manifest:
 * - dependencies: ['ships', 'galaxy'] — нужны корабли и galaxy для путей.
 * - emits: fleet:arrived, fleet:stranded, fleet:order-completed, fleet:movement-started,
 *   fleet:fuel-low, core:state-changed.
 * - subscribes: core:tick (priority SIMULATION + 20 — после ships).
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, GameState } from '@/core/types';
import { PRIORITY } from '@/core/module-types';
import { produce } from 'immer';
import { processFleetTick } from './fleet-engine';

export class FleetModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'fleet',
    name: 'Флот',
    version: '1.0.0',
    description: 'Движение флотов по Jump Points, обработка приказов',
    dependencies: ['ships', 'galaxy'],
    emits: [
      'fleet:arrived',
      'fleet:stranded',
      'fleet:order-completed',
      'fleet:movement-started',
      'fleet:fuel-low',
      'fleet:order-cancelled',
      'core:state-changed',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION + 20 },
    ],
    handlesQueries: [],
    requiresQueries: [],
  };

  private _phase: ModulePhase = 'uninitialized';
  private bus!: TypedEventBus;
  private registry!: ModuleRegistry;
  private unsubscribers: Array<() => void> = [];

  private getGameState: (() => GameState | null) | null = null;
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
        priority: PRIORITY.SIMULATION + 20,
        label: 'fleet',
      }),
    );
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  tick(time: GameTime): void {
    if (this._phase !== 'started') return;
    this.processFleetTicks(time);
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
    // No-op — состояние хранится в GameState.fleets
  }

  // ─── Tick handler ─────────────────────────────────────────────────

  private onTick(time: GameTime): void {
    // Not used — tick() called via ModuleRegistry.tickAll()
    void time;
  }

  /**
   * Обработка тика флотов: для каждого флота с активным приказом —
   * processFleetTick. Эмичит события (movement-started, arrived, stranded,
   * order-completed, fuel-consumed) внутри engine function.
   *
   * Block 01 P2: обёрнуто в immer produce() — после тика создаётся новое
   * иммутабельное состояние. Итерируем snapshot fleets[], заменяем каждый
   * обработанный Fleet на updated версию.
   */
  private processFleetTicks(time: GameTime): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;
    if (currentState.fleets.length === 0) return;

    let stateChanged = false;
    const newState = produce(currentState, (draft) => {
      for (let i = 0; i < draft.fleets.length; i++) {
        const fleet = draft.fleets[i];
        if (!fleet) continue;
        if (fleet.orders.length === 0) continue;
        const result = processFleetTick(fleet, draft, time.tick);
        if (result.updatedFleet !== fleet) {
          draft.fleets[i] = result.updatedFleet;
          stateChanged = true;
        }
      }
    });

    if (stateChanged) {
      this.commitState?.(newState);
    }
  }
}
