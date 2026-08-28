/// <reference types="bun-types" />
/**
 * R-RES §E tests: bonus-resolver (data-driven bonus aggregation).
 *
 * Tests:
 *   - resolveBonuses returns 1.0 when no bonuses active (empty state)
 *   - resolveBonuses returns 1.0 for unknown target (no tech/building matches)
 *   - Tech effect 'add' perLevel: fusion_reactor multiply energy_output at L1
 *   - Building bonus 'add' perLevel: laboratory L3 → research_rate += 0.06
 *   - Multiple sources combine: (1 + sum(add)) × product(multiply)
 *
 * Run: bun test tests/research/bonus-resolver.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { resolveBonuses } from '@/research/bonus-resolver';
import { BUILDING_MAP } from '@/data/buildings';
import type { GameState, Planet, StarSystem, Galaxy } from '@/core/types';

// Build a minimal GameState with a single player-owned planet that has
// arbitrary buildings placed in its hexes. Used for unit tests.
function makeGameStateWithBuildings(buildings: Array<{ hexIdx: number; buildingId: string; level: number }>): GameState {
  // Create a planet with 12 empty hexes; populate some with buildings.
  const planet: Planet = {
    id: 'p1',
    systemId: 's1',
    name: 'Test Planet',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1.0,
    temperature: 20,
    atmosphere: { type: 'standard', pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1.0,
    orbitalPeriod: 365,
    hexes: Array.from({ length: 12 }, (_, i) => ({
      coord: { q: i, r: 0 },
      terrain: 'plains' as const,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    })),
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 0,
    owner: 'player',
  };
  for (const b of buildings) {
    const hex = planet.hexes[b.hexIdx];
    if (hex) {
      hex.buildingId = b.buildingId;
      hex.buildingLevel = b.level;
    }
  }
  const system: StarSystem = {
    id: 's1',
    name: 'Test System',
    position: { x: 0, y: 0 },
    binaryType: 'BINARY_NONE',
    stars: [],
    planets: [planet],
    asteroidFields: 0,
    jumpPoints: [],
    discovered: true,
    owner: null,
  };
  const galaxy: Galaxy = {
    id: 'g1',
    seed: 1,
    systems: [system],
    systemMap: new Map(),
    bakedModel: { createdAt: 'test', elements: [], oreSpecs: [], iceSpecs: [], atmosphericGases: [] } as never,
  };
  return {
    time: { tick: 0, dayInYear: 0, year: 1 },
    speed: 1,
    phase: 'playing',
    galaxy,
    fleets: [],
    productionQueues: new Map(),
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map(),
    playerFactionId: 'player',
    researchState: {
      fundamentalLevels: {
        chemistry: 0, physics: 0, engineering: 0,
        biology_fund: 0, military_science: 0, xenoarchaeology: 0,
      },
      fundamentalRpInvested: {},
      researched: {},
      activeSlots: [],
      researchQueue: [],
      totalRpGenerated: 0,
    },
  };
}

describe('R-RES §E — resolveBonuses', () => {
  test('returns 1.0 for empty state (no techs, no buildings)', () => {
    const state = makeGameStateWithBuildings([]);
    expect(resolveBonuses(state, 'research_rate')).toBe(1.0);
    expect(resolveBonuses(state, 'energy_output')).toBe(1.0);
    expect(resolveBonuses(state, 'unknown_target')).toBe(1.0);
  });

  test('BuildingDef has bonuses field on laboratory', () => {
    // Sanity check: data-driven bonus is wired up.
    const lab = BUILDING_MAP.get('laboratory');
    expect(lab).toBeDefined();
    expect(lab?.bonuses).toBeDefined();
    expect(lab?.bonuses?.length).toBeGreaterThan(0);
    expect(lab?.bonuses?.[0]?.target).toBe('research_rate');
    expect(lab?.bonuses?.[0]?.operation).toBe('add');
    expect(lab?.bonuses?.[0]?.value).toBe(0.02);
    expect(lab?.bonuses?.[0]?.perLevel).toBe(true);
  });

  test('laboratory L1 → research_rate multiplier = 1 + 0.02×1 = 1.02', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 1 },
    ]);
    expect(resolveBonuses(state, 'research_rate')).toBeCloseTo(1.02, 5);
  });

  test('laboratory L3 → research_rate multiplier = 1 + 0.02×3 = 1.06', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 3 },
    ]);
    expect(resolveBonuses(state, 'research_rate')).toBeCloseTo(1.06, 5);
  });

  test('laboratory L5 → research_rate multiplier = 1 + 0.02×5 = 1.10', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 5 },
    ]);
    expect(resolveBonuses(state, 'research_rate')).toBeCloseTo(1.10, 5);
  });

  test('multiple laboratories sum their contributions', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 3 },
      { hexIdx: 1, buildingId: 'laboratory', level: 2 },
    ]);
    // (1 + 0.02×3 + 0.02×2) = 1 + 0.06 + 0.04 = 1.10
    expect(resolveBonuses(state, 'research_rate')).toBeCloseTo(1.10, 5);
  });

  test('building at level 0 is ignored', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 0 },
    ]);
    expect(resolveBonuses(state, 'research_rate')).toBe(1.0);
  });

  test('building without bonuses field is ignored', () => {
    // mine has no bonuses field
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'mine', level: 5 },
    ]);
    expect(resolveBonuses(state, 'research_rate')).toBe(1.0);
  });

  test('tech effect: fusion_reactor L1 multiply energy_output → multiplier > 1', () => {
    const state = makeGameStateWithBuildings([]);
    state.researchState.researched['fusion_reactor'] = 1;
    // fusion_reactor effect: { target: 'energy_output', operation: 'multiply',
    //                          value: 1.10, perLevel: true }
    // At level 1: 1.10^1 = 1.10
    expect(resolveBonuses(state, 'energy_output')).toBeCloseTo(1.10, 5);
  });

  test('tech effect: fusion_reactor L3 multiply energy_output → 1.10^3 = 1.331', () => {
    const state = makeGameStateWithBuildings([]);
    state.researchState.researched['fusion_reactor'] = 3;
    expect(resolveBonuses(state, 'energy_output')).toBeCloseTo(1.331, 3);
  });

  test('combined: tech multiply × building add', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 5 },
    ]);
    state.researchState.researched['fusion_reactor'] = 1;
    // energy_output = 1.10^1 (from tech) × 1 (no building energy_output) = 1.10
    expect(resolveBonuses(state, 'energy_output')).toBeCloseTo(1.10, 5);
    // research_rate = 1 (no tech research_rate) × (1 + 0.02×5) = 1.10
    expect(resolveBonuses(state, 'research_rate')).toBeCloseTo(1.10, 5);
  });

  test('unrelated target returns 1.0 even with bonuses active', () => {
    const state = makeGameStateWithBuildings([
      { hexIdx: 0, buildingId: 'laboratory', level: 5 },
    ]);
    state.researchState.researched['fusion_reactor'] = 3;
    expect(resolveBonuses(state, 'ship_thrust')).toBe(1.0);
    expect(resolveBonuses(state, 'unknown_metric')).toBe(1.0);
  });
});
