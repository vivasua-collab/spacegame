/**
 * Block 03 (R7): ResearchModule — модуль исследований.
 *
 * Реализует IGameModule. Подписывается на core:tick (priority: SIMULATION + 5,
 * после economy (SIMULATION=10), перед ships (SIM+10) и fleet (SIM+20)).
 * На каждом тике вызывает tickResearch для GameState.researchState.
 *
 * Алгоритм:
 *   1. На каждом тике получить GameState из accessor.
 *   2. Подсчитать totalRPPerSec = getTotalRPPerSec(colonized planets).
 *   3. Обернуть в immer.produce() — мутация draft.researchState через tickResearch.
 *   4. После тика для каждого завершённого уровня:
 *      a) applyTechUnlock(state, techId) — добавить разблокировки в state.
 *      b) emit 'tech:research-completed' с {techId, level, unlocks}.
 *      c) emit 'tech:unlocked' для каждого типа (recipe/module/building).
 *   5. commitState(newState) — обновить ссылку в медиаторе + emit 'core:state-changed'.
 *
 * Block 01 P2 (immutable store): все мутации GameState оборачиваются в
 * `produce(currentState, draft => { ... })` — immer создаёт новые ссылки
 * для изменённых путей (researchState, researched, activeSlots, ...).
 *
 * Manifest:
 * - dependencies: ['economy'] — нужен для доступа к planets (через accessor).
 * - emits: tech:research-completed, tech:unlocked, tech:fundamental-leveled,
 *   tech:tree-validated, core:state-changed.
 * - subscribes: core:tick (priority SIMULATION + 5 — после economy).
 */

import type { IGameModule, ModuleManifest, ModulePhase } from '@/core/module-types';
import type { TypedEventBus } from '@/core/typed-event-bus';
import type { ModuleRegistry } from '@/core/module-registry';
import type { GameTime, EntityId, GameState, ResearchState } from '@/core/types';
import { PRIORITY } from '@/core/module-types';
import { produce } from 'immer';
import {
  tickResearch,
  applyTechUnlock,
  getTotalRPPerSec,
  validateTechTree,
  createDefaultResearchState,
} from '@/research/engine';
import { TECH_TREE } from '@/data/research/tech-tree';
import { resolveBonuses } from '@/research/bonus-resolver';

export class ResearchModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'tech',
    name: 'Исследования',
    version: '1.0.0',
    description: 'Накопление RP, обработка очереди исследований, разблокировки',
    dependencies: ['economy'],
    emits: [
      'tech:research-completed',
      'tech:unlocked',
      'tech:fundamental-leveled',
      'tech:tree-validated',
      'tech:queue-advanced',
      'tech:queue-added',
      'tech:queue-removed',
      'core:state-changed',
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.SIMULATION + 5 },
    ],
    handlesQueries: [
      { queryName: 'research:state', description: 'Текущее ResearchState', requestType: 'void', responseType: 'ResearchState' },
      { queryName: 'research:tech-status', description: 'Статус технологии по techId', requestType: 'string', responseType: '{ status: string; currentLevel: number; ceiling: number }' },
    ],
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

  /** Cached tree validation result (computed once at init). */
  private treeValidationErrors: string[] | null = null;

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

    // Validate tree once at init — emit tech:tree-validated.
    this.treeValidationErrors = validateTechTree(TECH_TREE);
    this.bus.emit('tech:tree-validated', {
      ok: this.treeValidationErrors.length === 0,
      errors: this.treeValidationErrors,
    });

    this.unsubscribers.push(
      bus.on('core:tick', (time) => this.onTick(time), {
        priority: PRIORITY.SIMULATION + 5,
        label: 'tech',
      }),
    );

    // Register query handlers
    registry.registerQuery('research:state', () => this.queryResearchState());
    registry.registerQuery('research:tech-status', (techId) =>
      this.queryTechStatus(techId as string),
    );
  }

  start(): void {
    if (this._phase !== 'initialized' && this._phase !== 'stopped') return;
    this._phase = 'started';
  }

  tick(time: GameTime): void {
    if (this._phase !== 'started') return;
    this.processResearchTick(time);
  }

  stop(): void {
    if (this._phase !== 'started') return;
    this._phase = 'stopped';
  }

  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.registry.unregisterQuery('research:state');
    this.registry.unregisterQuery('research:tech-status');
    this._phase = 'destroyed';
  }

  serialize(): Record<string, unknown> {
    return { version: this.manifest.version };
  }

  deserialize(_data: Record<string, unknown>): void {
    // No-op — состояние хранится в GameState.researchState
  }

  // ─── Tick handler ─────────────────────────────────────────────────

  private onTick(time: GameTime): void {
    // Not used — tick() is called via ModuleRegistry.tickAll()
    void time;
  }

  /**
   * Обработка тика исследований (R7).
   *
   * Block 01 P2: обёрнуто в immer produce() — после тика создаётся новое
   * иммутабельное состояние с новыми ссылками для researchState.researched /
   * activeSlots / totalRpGenerated.
   *
   * Для каждого завершённого уровня: applyTechUnlock (idempotent) + emit
   * 'tech:research-completed' с {techId, level, unlocks}.
   */
  private processResearchTick(time: GameTime): void {
    const currentState = this.getGameState?.();
    if (!currentState) return;
    if (currentState.phase !== 'playing') return; // only tick during active play

    // Подсчитать totalRPPerSec из всех колонизированных планет
    const planets = currentState.galaxy.systems
      .flatMap((s) => s.planets)
      .filter((p) => p.owner != null);
    // R-RES §E: применяем research_rate bonus (от лабораторий и других
    // источников). resolveBonuses чистая функция; если state не ready —
    // множитель = 1 (нет бонусов).
    const researchMultiplier = resolveBonuses(currentState, 'research_rate');
    const totalRPPerSec = getTotalRPPerSec(planets, researchMultiplier);

    // deltaSeconds = speed (1 tick = 1 sec at speed=1; ×5 at speed=5; etc.)
    const deltaSeconds = currentState.speed;

    // Process tick — mutate researchState via immer draft.
    // tickResearch returns list of completed levels for emitting.
    let completedLevels: Array<{ techId: string; level: number }> = [];
    let allUnlocks: Array<{ techId: string; level: number; unlocks: string[] }> = [];

    const newState = produce(currentState, (draft) => {
      const rs = draft.researchState;
      // Ensure researchState is initialized (migration for old saves — Phase 3.7)
      if (!rs) {
        draft.researchState = createDefaultResearchState();
        return;
      }

      const tickResult = tickResearch(rs, totalRPPerSec, deltaSeconds);
      completedLevels = tickResult.completed;

      // Apply unlocks for each completed level (idempotent)
      for (const completed of completedLevels) {
        const newUnlocks = applyTechUnlock(rs, completed.techId);
        if (newUnlocks.length > 0) {
          allUnlocks.push({
            techId: completed.techId,
            level: completed.level,
            unlocks: newUnlocks.map((u) => u.id),
          });
        }
      }
    });

    // Commit new state to mediator → emits 'core:state-changed' → store sync.
    this.commitState?.(newState);

    // R-RES §B: detect queue auto-advancements (compare before/after).
    // If we started a new active slot from the queue (slotId starts with
    // "slot_q_"), emit tech:queue-advanced so UI can react.
    const playerFactionId = currentState.playerFactionId;
    const newActiveSlots = newState.researchState.activeSlots;
    const oldActiveSlots = currentState.researchState.activeSlots;
    const oldSlotIds = new Set(oldActiveSlots.map((s) => s.slotId));
    const newSlots = newActiveSlots.filter((s) => !oldSlotIds.has(s.slotId));
    for (const slot of newSlots) {
      if (slot.slotId.startsWith('slot_q_')) {
        this.bus.emit('tech:queue-advanced', {
          factionId: playerFactionId,
          techId: slot.techId,
          targetLevel: slot.targetLevel,
          remainingQueue: newState.researchState.researchQueue.length,
        });
      }
    }

    // Emit tech:research-completed for each completed level
    for (const completed of completedLevels) {
      const unlockEntry = allUnlocks.find(
        (u) => u.techId === completed.techId && u.level === completed.level,
      );
      const unlocks = unlockEntry?.unlocks ?? [];
      this.bus.emit('tech:research-completed', {
        techId: completed.techId,
        factionId: playerFactionId,
        level: completed.level,
        unlocks,
      });
      if (unlocks.length > 0) {
        this.bus.emit('tech:unlocked', {
          techId: completed.techId,
          factionId: playerFactionId,
          unlocks,
        });
      }
    }

    // Note: tech:fundamental-leveled is emitted from game-store.levelUpFundamental action
    // (it's a UI-triggered action, not a tick).
    void time;
  }

  // ─── Query handlers ───────────────────────────────────────────────

  private queryResearchState(): ResearchState | null {
    const state = this.getGameState?.();
    return state?.researchState ?? null;
  }

  private queryTechStatus(techId: string): { status: string; currentLevel: number; ceiling: number } | null {
    const state = this.getGameState?.();
    if (!state) return null;
    const tech = TECH_TREE.find((t) => t.id === techId);
    if (!tech) return null;
    // Re-use getTechStatus from engine (would need import; keep simple here)
    const currentLevel = state.researchState.researched[techId] ?? 0;
    return {
      status: currentLevel >= tech.maxLevel ? 'researched' : 'unknown',
      currentLevel,
      ceiling: tech.maxLevel,
    };
  }
}
