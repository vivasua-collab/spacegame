/// <reference types="bun-types" />
/**
 * Block 01 P2 — T6 Immutability test.
 *
 * Verifies that the immer-middleware + produce()-pattern in EconomyModule
 * produces new references for changed paths after every mutation, so that
 * React's useMemo([gameState.galaxy.systems]) correctly re-computes.
 *
 * Tests (matches T6 spec from `08_27_block_01_stabilization.md` §7):
 *   1. After `economy:build` emit → `engine.buildOnHex(...)`: the planet
 *      reference changes (old !== new).
 *   2. After `mediator.tick()` → `processEconomyTick`: the
 *      `gameState.galaxy.systems` array reference changes (immer creates
 *      a new array).
 *   3. Integration: the Zustand store receives different state references
 *      for different ticks (proxy for "devtools show different snapshots").
 *
 * Run: bun test tests/immutability.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { getGameMediator, resetGameMediator, GameMediator } from '@/core';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { giveStarterResources } from '@/economy/engine';
import { produce } from 'immer';
import type { EntityId, GameState, Planet } from '@/core/types';

/**
 * Создать свежий медиатор с зарегистрированными модулями (P2-wired) и новой игрой.
 * Минимальная галактика (5 систем) для ускорения тестов.
 *
 * Block 07 PRNG port fix note: systemCount=1 with seed=42 now produces a
 * system with no planets — see `tests/modular-integration.test.ts` for the
 * same rationale. systemCount=5 yields ≥1 suitable planet for the test.
 */
function freshMediatorWithGame(): { mediator: GameMediator; state: GameState } {
  const mediator = getGameMediator();
  const economyModule = new EconomyModule();
  const galaxyModule = new GalaxyModule();
  economyModule.setGameStateAccessor(() => mediator.getGameState());
  // Block 01 P2: wire up the mutator so EconomyModule's produce() results
  // are committed back to the mediator (and emit core:state-changed).
  economyModule.setGameStateMutator((s) => mediator.commitState(s));
  galaxyModule.setGameStateAccessor(() => mediator.getGameState());
  galaxyModule.setGameStateMutator((s) => mediator.commitState(s));
  mediator.registerAndInit([galaxyModule, economyModule]);
  const state = mediator.newGame({ seed: 42, systemCount: 5 });
  return { mediator, state };
}

/** Найти первую планету в состоянии, подходящую для тестов строительства. */
function findFirstPlanet(state: GameState): Planet {
  for (const system of state.galaxy.systems) {
    for (const planet of system.planets) {
      if (planet.type !== 'gas_giant' && planet.hexes.length > 0) {
        return planet;
      }
    }
  }
  throw new Error('No suitable planet found for test');
}

/** Re-fetch a planet by id from the (immutable) state. */
function findPlanetById(state: GameState, planetId: EntityId): Planet | undefined {
  for (const system of state.galaxy.systems) {
    const planet = system.planets.find((p) => p.id === planetId);
    if (planet) return planet;
  }
  return undefined;
}

describe('Block 01 P2: Immutability (T6)', () => {
  let mediator: GameMediator;
  let state: GameState;

  beforeEach(() => {
    resetGameMediator();
    const ctx = freshMediatorWithGame();
    mediator = ctx.mediator;
    state = ctx.state;
  });

  afterEach(() => {
    mediator.destroy();
  });

  test('After economy:build emit, planet reference changes (immer creates a new object)', () => {
    // Arrange: prepare the planet via direct mutations (auto-freeze is off
    // in game-store.ts → setAutoFreeze(false), so this is allowed).
    const planetBefore = findFirstPlanet(state);
    const planetId = planetBefore.id;
    planetBefore.owner = 'player';
    planetBefore.warehouse = undefined;
    giveStarterResources(planetBefore);

    // Sync the mediator so EconomyModule.produce() picks up the mutations.
    mediator.commitState(state);

    // Find a free non-ocean hex
    const hexIndex = planetBefore.hexes.findIndex(
      (h) => !h.buildingId && h.terrain !== 'ocean'
    );
    expect(hexIndex).toBeGreaterThanOrEqual(0);

    // Act: emit economy:build — EconomyModule wraps engine.buildOnHex in
    // immer.produce(), creating a new immutable state.
    mediator.getBus().emit('economy:build', {
      planetId,
      hexIndex,
      buildingId: 'mine',
    });

    // Assert: a new immutable state has been committed.
    const newState = mediator.getGameState()!;
    expect(newState).not.toBe(state); // top-level state reference changed

    // The planet reference has changed (immer produced a new planet object
    // because one of its hexes was mutated).
    const planetAfter = findPlanetById(newState, planetId)!;
    expect(planetAfter).not.toBe(planetBefore);
    expect(planetAfter.hexes[hexIndex]!.buildingId).toBe('mine');

    // The OLD planet reference is unchanged — proves immutability (the
    // mutation went through the immer draft, not the original object).
    expect(planetBefore.hexes[hexIndex]!.buildingId).toBeNull();
  });

  test('After mediator.tick(), galaxy.systems array reference changes', () => {
    // Arrange: colonize a planet and switch to playing so processEconomyTick
    // has work to do (otherwise the tick produces no mutations and immer
    // returns the same reference — which is also a valid immutability check,
    // but we want to verify the "mutations → new array ref" path).
    const planet = findFirstPlanet(state);
    const planetId = planet.id;

    // Use produce() to set up state immutably (colonize + warehouse + phase).
    const setupState = produce(state, (draft) => {
      const draftPlanet = findPlanetById(draft, planetId)!;
      draftPlanet.owner = 'player';
      // Starter resources so the colony hub can function.
      const starters: Record<string, number> = {
        Fe: 150, Si: 100, C: 60, Al: 80,
        H: 300, Ti: 30, Cu: 40, O: 200, N: 100, Au: 2, U: 5,
      };
      for (const [id, amount] of Object.entries(starters)) {
        draftPlanet.resources[id] = (draftPlanet.resources[id] ?? 0) + amount;
      }
      // Place colony_hub on a free hex (mimics engine.colonizePlanet).
      const freeHex = draftPlanet.hexes.findIndex(
        (h) => !h.buildingId && h.terrain !== 'ocean'
      );
      if (freeHex >= 0) {
        draftPlanet.hexes[freeHex]!.buildingId = 'colony_hub';
        draftPlanet.hexes[freeHex]!.buildingLevel = 1;
      }
      // Initialize warehouse (mimics EconomyModule.onColonize post-processing).
      draftPlanet.warehouse = {
        totalCapacity: 1000,
        capacities: { ore: 500, processed: 100, highTech: 10 },
        specialization: 'universal',
        reserves: {},
        colonyRole: 'industrial',
        orbitBuffer: { capacity: 100, resources: {} },
      };
      // Flip phase + speed so mediator.tick() runs.
      draft.phase = 'playing';
      draft.speed = 1;
    });
    mediator.setGameState(setupState);

    // Capture state references before tick.
    const stateBefore = mediator.getGameState()!;
    const systemsBefore = stateBefore.galaxy.systems;
    const planetsBefore = stateBefore.galaxy.systems.flatMap((s) => s.planets);

    // Sanity: stateBefore is the setupState (just committed).
    expect(stateBefore).toBe(setupState);

    // Act: tick — mediator.tick() increments time then calls
    // registry.tickAll → EconomyModule.tick → processEconomyTick, which
    // is now wrapped in immer.produce() and committed via commitState().
    mediator.tick();

    // Assert: the state reference has changed (immer produced a new state).
    const stateAfter = mediator.getGameState()!;
    expect(stateAfter).not.toBe(stateBefore);

    // The galaxy.systems array reference has changed because at least one
    // planet inside was mutated (e.g., resources added, energy recalculated).
    const systemsAfter = stateAfter.galaxy.systems;
    expect(systemsAfter).not.toBe(systemsBefore);

    // The planet objects inside also have new references (their resources
    // record was mutated — even just adding energyBalance triggers this).
    const planetsAfter = stateAfter.galaxy.systems.flatMap((s) => s.planets);
    for (let i = 0; i < planetsBefore.length; i++) {
      // At least one planet reference must have changed (the colonized one).
      const beforePlanet = planetsBefore[i]!;
      const afterPlanet = planetsAfter[i]!;
      if (beforePlanet.id === planetId) {
        expect(afterPlanet).not.toBe(beforePlanet);
      }
    }
  });

  test('Integration: store state reference changes after tick (Zustand subscription)', () => {
    // This test verifies the full pipeline:
    //   EconomyModule.produce() → mediator.commitState() → bus.emit('core:state-changed')
    //   → useGameStore subscription → useGameStore.setState({ gameState: newState })
    //
    // We subscribe to core:state-changed directly (bypassing the store, which
    // isn't initialized in this test setup) and verify that the emitted state
    // is a new reference (different snapshot per tick).
    //
    // This is the closest proxy to "Zustand devtools show different snapshots
    // for different ticks" — the devtools snapshot is the state reference.

    // Set up: colonize + playing phase.
    const planet = findFirstPlanet(state);
    const planetId = planet.id;
    const setupState = produce(state, (draft) => {
      const draftPlanet = findPlanetById(draft, planetId)!;
      draftPlanet.owner = 'player';
      const starters: Record<string, number> = {
        Fe: 150, Si: 100, C: 60, Al: 80,
        H: 300, Ti: 30, Cu: 40, O: 200, N: 100, Au: 2, U: 5,
      };
      for (const [id, amount] of Object.entries(starters)) {
        draftPlanet.resources[id] = (draftPlanet.resources[id] ?? 0) + amount;
      }
      const freeHex = draftPlanet.hexes.findIndex(
        (h) => !h.buildingId && h.terrain !== 'ocean'
      );
      if (freeHex >= 0) {
        draftPlanet.hexes[freeHex]!.buildingId = 'colony_hub';
        draftPlanet.hexes[freeHex]!.buildingLevel = 1;
      }
      draftPlanet.warehouse = {
        totalCapacity: 1000,
        capacities: { ore: 500, processed: 100, highTech: 10 },
        specialization: 'universal',
        reserves: {},
        colonyRole: 'industrial',
        orbitBuffer: { capacity: 100, resources: {} },
      };
      draft.phase = 'playing';
      draft.speed = 1;
    });
    mediator.setGameState(setupState);

    // Collect state references emitted via core:state-changed.
    // Capture both the reference AND the tick at emission time (the tick
    // captured here is a primitive number — safe from later mutations to
    // the state reference's time.tick field).
    const emittedStates: GameState[] = [];
    const emittedTicks: number[] = [];
    mediator.getBus().on('core:state-changed', (s: GameState) => {
      emittedStates.push(s);
      emittedTicks.push(s.time.tick);
    });

    // Act: tick twice — each tick should produce a different state snapshot.
    mediator.tick();
    mediator.tick();

    // Assert: at least 2 state-changed events fired (one per tick).
    // (mediator.tick() also calls emitStateChanged() at the end, plus
    // EconomyModule.processEconomyTick emits one via commitState.)
    expect(emittedStates.length).toBeGreaterThanOrEqual(2);

    // Dedupe consecutive identical state references — mediator.tick()
    // may emit core:state-changed twice per tick (once from commitState
    // inside EconomyModule, once from emitStateChanged at the end of
    // mediator.tick). Both reference the same newState, which is fine.
    const uniqueSnapshots: GameState[] = [];
    for (const s of emittedStates) {
      if (uniqueSnapshots.length === 0 || uniqueSnapshots[uniqueSnapshots.length - 1] !== s) {
        uniqueSnapshots.push(s);
      }
    }

    // We expect at least 2 unique snapshots: the seed state (from
    // mediator.setGameState) and at least one post-tick state.
    expect(uniqueSnapshots.length).toBeGreaterThanOrEqual(2);

    // The seed state (first snapshot) must differ from the final
    // post-tick state — this is what "different snapshots for different
    // ticks" means in the Zustand-devtools sense.
    const seedSnapshot = uniqueSnapshots[0];
    const finalSnapshot = uniqueSnapshots[uniqueSnapshots.length - 1];
    expect(finalSnapshot).not.toBe(seedSnapshot);

    // The captured tick values are monotonically non-decreasing — proves
    // the snapshots are real different states (not the same object with
    // a mutated field).
    const firstTick = emittedTicks[0]!;
    const lastTick = emittedTicks[emittedTicks.length - 1]!;
    expect(lastTick).toBeGreaterThan(firstTick);
  });
});
