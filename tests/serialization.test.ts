/// <reference types="bun-types" />
/**
 * Block 01 — T5 Serialization round-trip tests.
 *
 * Tests (matches T5 spec from `checkpoints/08_27_block_01_stabilization.md` §4):
 *   1. Round-trip: serializeGameState(state) → deserializeGameState(json) →
 *      result deep-equals original state (modulo the non-deterministic
 *      `bakedModel.createdAt` timestamp — see KNOWN_BUG note below).
 *   2. Excludes systemMap and bakedModel: the serialized JSON string does
 *      NOT contain `systemMap` or `bakedModel` keys (they are stripped by
 *      `serializeGameState` and rebuilt on load).
 *   3. Backward compatibility: a v1-format JSON (with `time.dayInYear`,
 *      no `time.day`) and a v0-format JSON (with `time.day`, no
 *      `time.dayInYear`) both deserialize without crashing.
 *   4. Idempotent: serializeGameState(deserializeGameState(serializeGameState(s)))
 *      === serializeGameState(s) — i.e. the serialized form is a fixed
 *      point under the round-trip.
 *
 * KNOWN_BUG (documented, not blocking): `bakeGalaxyModel` in
 * `src/data/chemistry/bake.ts` embeds `new Date().toISOString()` into
 * `bakedModel.createdAt`. Since `serializeGameState` strips `bakedModel`
 * from the JSON and `deserializeGameState` regenerates it from the seed,
 * the round-tripped state has a DIFFERENT `bakedModel.createdAt` than the
 * original. The round-trip test below strips `createdAt` from both sides
 * before deep-equal — this isolates the structural round-trip invariant
 * (all other fields match) while explicitly documenting the
 * non-determinism for a future Block 07 fix.
 *
 * Run: bun test tests/serialization.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup'; // enableMapSet + setAutoFreeze(false) — needed for Map draft support
import { getGameMediator, resetGameMediator, GameMediator } from '@/core';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import type { GameState } from '@/core/types';

/**
 * Build a fresh mediator with P2-wired modules and a small galaxy — the
 * same pattern used by `tests/modular-integration.test.ts` and
 * `tests/immutability.test.ts`. `systemCount: 5` keeps the test fast
 * (serialize/deserialize doesn't care about galaxy size).
 */
function freshMediatorWithGame(config: { seed: number; systemCount: number } = { seed: 42, systemCount: 5 }): GameState {
  const mediator = getGameMediator();
  const economyModule = new EconomyModule();
  const galaxyModule = new GalaxyModule();
  economyModule.setGameStateAccessor(() => mediator.getGameState());
  economyModule.setGameStateMutator((s) => mediator.commitState(s));
  galaxyModule.setGameStateAccessor(() => mediator.getGameState());
  galaxyModule.setGameStateMutator((s) => mediator.commitState(s));
  mediator.registerAndInit([galaxyModule, economyModule]);
  return mediator.newGame(config);
}

/**
 * Strip `bakedModel.createdAt` from a state's galaxy — workaround for the
 * `bakeGalaxyModel` non-determinism (see file-header KNOWN_BUG). After
 * stripping, two round-tripped states should deep-equal.
 */
function stripBakedModelCreatedAt(state: GameState): GameState {
  if (!state.galaxy.bakedModel) return state;
  return {
    ...state,
    galaxy: {
      ...state.galaxy,
      bakedModel: { ...state.galaxy.bakedModel, createdAt: '<stripped>' },
    },
  };
}

describe('Block 01 T5: Serialization round-trip', () => {
  let mediator: GameMediator;

  beforeEach(() => {
    resetGameMediator();
    mediator = getGameMediator();
  });

  afterEach(() => {
    mediator.destroy();
  });

  test('1. Round-trip — serializeGameState → deserializeGameState deep-equals original (modulo createdAt)', () => {
    // Arrange: build a small galaxy and wrap it in a GameState via mediator.
    const original = freshMediatorWithGame({ seed: 42, systemCount: 5 });
    expect(original.galaxy.systems.length).toBe(5);

    // Act: serialize → deserialize.
    const json = serializeGameState(original);
    const roundTripped = deserializeGameState(json);

    // Assert: structural equality (all fields except bakedModel.createdAt).
    // `toEqual` performs a recursive deep-equal that handles Map (Bun/Jest
    // compatible) — so productionQueues (Map) and systemMap (Map) compare by
    // contents, not by reference.
    expect(stripBakedModelCreatedAt(roundTripped)).toEqual(stripBakedModelCreatedAt(original));

    // Explicit spot-checks for the most important fields:
    expect(roundTripped.galaxy.seed).toBe(original.galaxy.seed);
    expect(roundTripped.galaxy.id).toBe(original.galaxy.id);
    expect(roundTripped.galaxy.systems).toEqual(original.galaxy.systems);
    expect(roundTripped.galaxy.systemMap.size).toBe(original.galaxy.systemMap.size);
    expect(roundTripped.time).toEqual(original.time);
    expect(roundTripped.phase).toBe(original.phase);
    expect(roundTripped.speed).toBe(original.speed);
    expect(roundTripped.productionQueues.size).toBe(original.productionQueues.size);
    expect(roundTripped.fleets).toEqual(original.fleets);
    expect(roundTripped.playerFactionId).toBe(original.playerFactionId);

    // The systemMap is rebuilt from systems — every system must be present.
    for (const sys of original.galaxy.systems) {
      expect(roundTripped.galaxy.systemMap.has(sys.id)).toBe(true);
    }

    // The bakedModel is regenerated from the seed — must be present and
    // deep-equal to the original EXCEPT createdAt (KNOWN_BUG).
    expect(roundTripped.galaxy.bakedModel).toBeDefined();
    const { createdAt: _origT, ...origBM } = original.galaxy.bakedModel;
    const { createdAt: _rtT, ...rtBM } = roundTripped.galaxy.bakedModel!;
    expect(rtBM).toEqual(origBM);
  });

  test('2. Serialized JSON excludes systemMap and bakedModel (rebuilt on load)', () => {
    const state = freshMediatorWithGame({ seed: 42, systemCount: 5 });
    const json = serializeGameState(state);
    const parsed = JSON.parse(json) as {
      galaxy: Record<string, unknown>;
      productionQueues: unknown;
    };

    // `serializeGameState` destructures `systemMap` and `bakedModel` out of
    // state.galaxy before JSON.stringify — so neither key should appear.
    expect(parsed.galaxy).not.toHaveProperty('systemMap');
    expect(parsed.galaxy).not.toHaveProperty('bakedModel');

    // Sanity: the systems array IS in the JSON (the source of truth from
    // which systemMap is rebuilt on load).
    expect(parsed.galaxy).toHaveProperty('systems');
    expect(Array.isArray(parsed.galaxy.systems)).toBe(true);
    expect((parsed.galaxy.systems as unknown[]).length).toBe(5);

    // And productionQueues is serialized as an entries array (not a Map).
    expect((state as unknown as { productionQueues: unknown }).productionQueues).toBeInstanceOf(Map);
    expect(parsed).toHaveProperty('productionQueues');
    expect(Array.isArray(parsed.productionQueues)).toBe(true);
  });

  test('3. Backward compatibility — v1 (dayInYear) and v0 (day) time formats deserialize without crashing', () => {
    // v1 format: uses `time.dayInYear` (current format) — should be used as-is.
    const v1Json = JSON.stringify({
      time: { tick: 100, dayInYear: 200, year: 1 },
      speed: 1,
      phase: 'playing',
      galaxy: { id: 'galaxy_1', seed: 42, systems: [] },
      productionQueues: [],
      fleets: [],
      playerFactionId: 'player',
    });

    const v1State = deserializeGameState(v1Json);
    expect(v1State.time.tick).toBe(100);
    expect(v1State.time.dayInYear).toBe(200);
    expect(v1State.time.year).toBe(1);

    // v0 format: uses `time.day` instead of `time.dayInYear` —
    // `deserializeGameState` migrates: dayInYear = day % 365.
    const v0Json = JSON.stringify({
      time: { tick: 100, day: 400, year: 1 },
      speed: 1,
      phase: 'playing',
      galaxy: { id: 'galaxy_1', seed: 42, systems: [] },
      productionQueues: [],
      fleets: [],
      playerFactionId: 'player',
    });

    const v0State = deserializeGameState(v0Json);
    expect(v0State.time.tick).toBe(100);
    // 400 % 365 = 35
    expect(v0State.time.dayInYear).toBe(35);
    expect(v0State.time.year).toBe(1);
  });

  test('4. Idempotent — serialize(deserialize(serialize(s))) === serialize(s)', () => {
    const state = freshMediatorWithGame({ seed: 42, systemCount: 5 });

    const json1 = serializeGameState(state);
    const roundTripped = deserializeGameState(json1);
    const json2 = serializeGameState(roundTripped);

    // Both serialized forms have systemMap and bakedModel stripped, so the
    // createdAt non-determinism doesn't leak in. The two JSON strings must
    // be byte-identical — this proves serialize GameState is a fixed
    // point under the round-trip.
    expect(json2).toBe(json1);
  });
});
