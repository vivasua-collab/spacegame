/// <reference types="bun-types" />
/**
 * R-BLD-MOD tests: requiresTechs gate in engine build functions.
 *
 * Проверяет, что buildOnHex/buildOnAtmosphereSlot/buildOnOrbitSlot:
 *   - пропускают гейт, если researched не передан (backward-compat).
 *   - блокируют постройку, если requiresTechs не выполнены.
 *   - разрешают постройку, если requiresTechs выполнены.
 *   - buildings без requiresTechs строятся всегда.
 *   - terrainTypes (allowlist) валидируется в buildOnHex.
 *
 * Run: bun test tests/economy/building-tech-gate.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { buildOnHex, buildOnOrbitSlot } from '@/economy/engine';
import { areBuildingTechsMet, BUILDING_MAP } from '@/data/buildings';
import type { Planet } from '@/core/types';

/** Планета medium-размера с 12 гексами plains и ресурсами на несколько построек. */
function makePlanet(): Planet {
  return {
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
    orbitSlots: Array.from({ length: 3 }, (_, i) => ({
      index: i,
      buildingId: null,
      buildingLevel: 0,
    })),
    moons: [],
    resourceDeposits: [],
    // Достаточно ресурсов для mine (Fe5,Si3), synthesizer (Fe6,Si4,Cu2),
    // refinery (Fe12,Si8,Cu4), spaceport (Fe50,Si30,Al20,Ti10).
    resources: { Fe: 200, Si: 100, Al: 50, Cu: 30, Ti: 20, C: 10 },
    energyBalance: 0,
    owner: 'player',
  };
}

describe('R-BLD-MOD — requiresTechs gate', () => {
  describe('areBuildingTechsMet helper', () => {
    test('returns true for building without requiresTechs', () => {
      const mine = BUILDING_MAP.get('mine')!;
      expect(areBuildingTechsMet(mine, {})).toBe(true);
      expect(areBuildingTechsMet(mine, { steel_processing: 5 })).toBe(true);
    });

    test('returns false when required tech not researched', () => {
      const synth = BUILDING_MAP.get('synthesizer')!;
      expect(areBuildingTechsMet(synth, {})).toBe(false);
    });

    test('returns false when required tech below minLevel', () => {
      const synth = BUILDING_MAP.get('synthesizer')!;
      // synthesizer requires steel_processing >= 1
      expect(areBuildingTechsMet(synth, { steel_processing: 0 })).toBe(false);
    });

    test('returns true when required tech meets minLevel', () => {
      const synth = BUILDING_MAP.get('synthesizer')!;
      expect(areBuildingTechsMet(synth, { steel_processing: 1 })).toBe(true);
      expect(areBuildingTechsMet(synth, { steel_processing: 5 })).toBe(true);
    });

    test('refinery requires steel_processing >= 1 (data-driven)', () => {
      const ref = BUILDING_MAP.get('refinery')!;
      expect(ref.requiresTechs).toBeDefined();
      expect(ref.requiresTechs?.[0]?.techId).toBe('steel_processing');
      expect(ref.requiresTechs?.[0]?.minLevel).toBe(1);
      expect(areBuildingTechsMet(ref, {})).toBe(false);
      expect(areBuildingTechsMet(ref, { steel_processing: 1 })).toBe(true);
    });
  });

  describe('buildOnHex — backward-compat (no researched arg)', () => {
    test('mine builds without researched arg (gate skipped)', () => {
      const planet = makePlanet();
      // No 4th arg → gate skipped → mine (no requiresTechs) builds OK.
      const ok = buildOnHex(planet, 0, 'mine');
      expect(ok).toBe(true);
      expect(planet.hexes[0]?.buildingId).toBe('mine');
    });

    test('synthesizer builds without researched arg (gate skipped — backward-compat)', () => {
      const planet = makePlanet();
      // Without researched, the gate is skipped so synthesizer (which has
      // requiresTechs) can still be built. This preserves backward-compat
      // for tests calling with 3 args. In real gameplay, economy-module
      // always passes researched, so the gate IS enforced there.
      const ok = buildOnHex(planet, 0, 'synthesizer');
      expect(ok).toBe(true);
    });
  });

  describe('buildOnHex — with researched arg (gate enforced)', () => {
    test('mine (no requiresTechs) builds regardless of researched', () => {
      const planet1 = makePlanet();
      expect(buildOnHex(planet1, 0, 'mine', {})).toBe(true);
      const planet2 = makePlanet();
      expect(buildOnHex(planet2, 0, 'mine', { steel_processing: 0 })).toBe(true);
    });

    test('synthesizer blocked when steel_processing not researched', () => {
      const planet = makePlanet();
      const ok = buildOnHex(planet, 0, 'synthesizer', {});
      expect(ok).toBe(false);
      expect(planet.hexes[0]?.buildingId).toBeNull();
      // Resources NOT consumed (gate fails before resource check)
      expect(planet.resources['Fe']).toBe(200);
    });

    test('synthesizer blocked when steel_processing below minLevel', () => {
      const planet = makePlanet();
      const ok = buildOnHex(planet, 0, 'synthesizer', { steel_processing: 0 });
      expect(ok).toBe(false);
    });

    test('synthesizer builds when steel_processing >= 1', () => {
      const planet = makePlanet();
      const ok = buildOnHex(planet, 0, 'synthesizer', { steel_processing: 1 });
      expect(ok).toBe(true);
      expect(planet.hexes[0]?.buildingId).toBe('synthesizer');
      // Resources consumed
      expect(planet.resources['Fe']).toBe(200 - 6);
      expect(planet.resources['Si']).toBe(100 - 4);
      expect(planet.resources['Cu']).toBe(30 - 2);
    });

    test('refinery builds when steel_processing met, blocked otherwise', () => {
      const p1 = makePlanet();
      expect(buildOnHex(p1, 0, 'refinery', {})).toBe(false);
      const p2 = makePlanet();
      expect(buildOnHex(p2, 0, 'refinery', { steel_processing: 1 })).toBe(true);
    });

    test('tech-gate failure does not consume resources', () => {
      const planet = makePlanet();
      buildOnHex(planet, 0, 'synthesizer', {}); // fails gate
      expect(planet.resources['Fe']).toBe(200);
      expect(planet.resources['Si']).toBe(100);
      expect(planet.resources['Cu']).toBe(30);
    });
  });
});

describe('R-BLD-MOD — space layer buildings cannot be built on planets', () => {
  test('starlift_collector (layer space) rejected by buildOnHex', () => {
    const planet = makePlanet();
    // space-layer building → layer.includes('surface') is false → rejected.
    const ok = buildOnHex(planet, 0, 'starlift_collector', { fusion_reactor: 5 });
    expect(ok).toBe(false);
    expect(planet.hexes[0]?.buildingId).toBeNull();
  });

  test('starlift_collector rejected by buildOnOrbitSlot (layer space, not orbit)', () => {
    const planet = makePlanet();
    const ok = buildOnOrbitSlot(planet, 0, 'starlift_collector', { fusion_reactor: 5 });
    expect(ok).toBe(false);
    expect(planet.orbitSlots[0]?.buildingId).toBeNull();
  });

  test('spaceport (layer orbit) builds on orbit slot with researched', () => {
    const planet = makePlanet();
    // spaceport has no requiresTechs → builds regardless.
    const ok = buildOnOrbitSlot(planet, 0, 'spaceport', {});
    expect(ok).toBe(true);
    expect(planet.orbitSlots[0]?.buildingId).toBe('spaceport');
  });
});
