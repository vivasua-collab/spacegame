/// <reference types="bun-types" />
/**
 * Block 01 — T2 Galaxy snapshot tests.
 *
 * Tests (matches T2 spec from `checkpoints/08_27_block_01_stabilization.md` §4):
 *   1. Snapshot stability: for seed=42 and DEFAULT_CONFIG (the codebase's
 *      standard galaxy — `systemCount=500`), the generated galaxy has
 *      exactly 500 systems, every system is reachable from every other
 *      via BFS through Jump Points (full connectedness), and the set of
 *      star types present matches an inline snapshot.
 *   2. Determinism: two `generateGalaxy(seed)` calls with the same config
 *      produce deep-equal output (compared via deterministic JSON
 *      serialization of the `systems` array — the source of truth).
 *   3. Connectedness: BFS from systems[0] reaches every system in a
 *      50-system galaxy (independent of `ensureConnectivity`'s guarantees —
 *      the test verifies the actual post-generation graph, not the function).
 *
 * NOTE on snapshot sensitivity: the inline `EXPECTED_STAR_TYPES` snapshot
 * encodes the *current* xoshiro256** port + galaxy algorithm output. If a
 * future block (e.g. Block 07 PRNG port fix per T7) changes the PRNG output,
 * this snapshot will break — that's expected and documents that the
 * galaxy-generator output has shifted (the test should be updated alongside
 * the PRNG change).
 *
 * Run: bun test tests/galaxy-snapshot.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup'; // enableMapSet + setAutoFreeze(false)
import { generateGalaxy, DEFAULT_CONFIG } from '@/galaxy';
import type { Galaxy, StarSystem, EntityId } from '@/core/types';

/**
 * Snapshot: sorted unique star types observed for seed=42, DEFAULT_CONFIG
 * (systemCount=500). Re-recorded 2026-08-27 against the corrected
 * xoshiro256** port (Block 07 fix); see file-header NOTE for breakage
 * policy. The set now includes STAR_BH (black hole) — the corrected PRNG
 * state-update sequence shifts the seed=42 galaxy just enough that one
 * star lands on the BH branch of the star-type table.
 */
const EXPECTED_STAR_TYPES = [
  'STAR_A',
  'STAR_B',
  'STAR_BH',
  'STAR_F',
  'STAR_G',
  'STAR_K',
  'STAR_M',
  'STAR_WD',
];

/**
 * Deterministic JSON serialization of a Galaxy (for deep-equal comparison).
 * Strips `systemMap` (a Map → rebuilt from `systems`) and `bakedModel`
 * (contains a non-deterministic `createdAt` timestamp; rebuilt from the
 * galaxy seed by `bakeGalaxyModel`). The remaining `systems` array + scalar
 * galaxy fields fully describe the galaxy's structural content.
 */
function galaxyToComparableJSON(g: Galaxy): string {
  const { systemMap: _sm, bakedModel: _bm, ...rest } = g;
  return JSON.stringify(rest);
}

/** Run BFS from `startId` over the JPs and return the set of reachable ids. */
function bfsReachable(systems: StarSystem[], startId: EntityId): Set<EntityId> {
  const byId = new Map(systems.map(s => [s.id, s]));
  const visited = new Set<EntityId>();
  const queue: EntityId[] = [startId];
  visited.add(startId);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const sys = byId.get(cur);
    if (!sys) continue;
    for (const jp of sys.jumpPoints) {
      if (!visited.has(jp.toSystemId)) {
        visited.add(jp.toSystemId);
        queue.push(jp.toSystemId);
      }
    }
  }
  return visited;
}

/** Sorted list of unique star types across all systems in the galaxy. */
function uniqueStarTypes(g: Galaxy): string[] {
  const set = new Set<string>();
  for (const sys of g.systems) {
    for (const star of sys.stars) set.add(star.type);
  }
  return [...set].sort();
}

describe('Block 01 T2: Galaxy snapshot', () => {
  test('1. Snapshot stability — seed=42, DEFAULT_CONFIG (500 systems) → exact count + connected + star types', () => {
    // Act: generate with DEFAULT_CONFIG (the codebase's standard galaxy).
    const g = generateGalaxy({ ...DEFAULT_CONFIG, seed: 42 });

    // Assert 1: exact system count.
    expect(g.systems.length).toBe(DEFAULT_CONFIG.systemCount);
    expect(DEFAULT_CONFIG.systemCount).toBe(500); // sanity

    // Assert 2: all systems reachable from systems[0] via BFS through JPs.
    expect(g.systems.length).toBeGreaterThan(0);
    // noUncheckedIndexedAccess: systems[0] is StarSystem | undefined; we
    // asserted length > 0 above so the runtime guard is enough — but TS
    // can't see through the assertion. Use a non-null assertion.
    const firstSystem = g.systems[0]!;
    const reachable = bfsReachable(g.systems, firstSystem.id);
    expect(reachable.size).toBe(g.systems.length);

    // Assert 3: inline snapshot — star type set matches the expected list.
    expect(uniqueStarTypes(g)).toEqual(EXPECTED_STAR_TYPES);
  });

  test('2. Determinism — two generateGalaxy(seed) calls produce identical output', () => {
    // Use systemCount=50 (vs 500) for test speed — the determinism invariant
    // is independent of system count.
    const cfg = { seed: 42, systemCount: 50 };

    const g1 = generateGalaxy(cfg);
    const g2 = generateGalaxy(cfg);

    // Structural equality: systems array (source of truth) + scalar galaxy
    // fields (id, seed, ...) must match. Maps (systemMap) and bakedModel
    // (with createdAt) are excluded — they're rebuilt from `systems` /
    // regenerated from `seed`, so they're definitionally equal when the
    // serialized form is equal.
    expect(galaxyToComparableJSON(g1)).toBe(galaxyToComparableJSON(g2));

    // Also verify the galaxy.id (uses genId() counter, reset per-call) and
    // the systems' ids are identical — proves genId is deterministic.
    expect(g1.id).toBe(g2.id);
    expect(g1.systems.map(s => s.id)).toEqual(g2.systems.map(s => s.id));
  });

  test('3. Connectedness — BFS from any system reaches all others (50 systems)', () => {
    const g = generateGalaxy({ seed: 42, systemCount: 50 });
    expect(g.systems.length).toBe(50);

    // Test connectivity from systems[0] (the seed system). Per
    // `ensureConnectivity` (src/galaxy/generate-jump-points.ts), every
    // system must be reachable from systems[0] after generation.
    // noUncheckedIndexedAccess: array indexing returns T | undefined;
    // length=50 guarantees systems[0] exists at runtime. Use non-null
    // assertions after the length checks.
    const startSystem = g.systems[0]!;
    const reachable0 = bfsReachable(g.systems, startSystem.id);
    expect(reachable0.size).toBe(g.systems.length);

    // Stronger: pick a mid-graph system and verify it also reaches all
    // others (the graph is undirected — JPs are bidirectional — so any
    // starting node should see the full component).
    const mid = g.systems[Math.floor(g.systems.length / 2)]!;
    const reachableMid = bfsReachable(g.systems, mid.id);
    expect(reachableMid.size).toBe(g.systems.length);
  });
});
