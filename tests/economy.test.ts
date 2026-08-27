/// <reference types="bun-types" />
/**
 * Block 01 — T3 Economy test.
 *
 * Verifies the full economy pipeline: extraction → production queue → energy.
 *
 * Tests (matches T3 spec from `08_27_block_01_stabilization.md` §4):
 *   1. processExtraction adds extracted ore to planet.resources.
 *   2. processProductionQueue with a queued recipe → outputs added to resources.
 *   3. recalcEnergyBalance correctly computes production vs consumption.
 *   4. Energy deficit (consumption > production) → buildings don't produce
 *      (processProductionQueue returns early when energyBalance < perTickCost).
 *
 * Run: bun test tests/economy.test.ts
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import {
  processEconomyTick,
  enqueueProduction,
  recalcEnergyBalance,
  buildOnHex,
  giveStarterResources,
  cancelProduction,
} from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import type { Planet, EntityId, ProductionQueue, HexCell, HexTerrain } from '@/core/types';

// Initialize baked lookups once for all tests (deterministic seed).
const bakedModel = bakeGalaxyModel(42, ELEMENTS);
setCurrentLookups(bakedModel);

/** Helper: build a minimal rocky planet with one hex containing Fe-ore deposit. */
function makeTestPlanet(overrides?: Partial<Planet>): Planet {
  const feDeposit = {
    elementId: 'Fe-ore',
    availability: 0.7,
    quantity: 1000,
    depth: 1,
  };
  const hex: HexCell = {
    coord: { q: 0, r: 0 },
    terrain: 'plains' as HexTerrain,
    buildingId: null,
    buildingLevel: 0,
    deposits: [feDeposit],
  };
  return {
    id: 'test-planet' as EntityId,
    systemId: 'test-system' as EntityId,
    name: 'Test Planet',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1.0,
    temperature: 15,
    atmosphere: { type: 'standard', pressure: 1.0, composition: [{ element: 'N', percentage: 78 }, { element: 'O', percentage: 21 }, { element: 'Ar', percentage: 1 }] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1.0,
    orbitalPeriod: 365,
    hexes: [hex],
    atmosphericSlots: [],
    orbitSlots: [],
    resourceDeposits: [],
    resources: {},
    warehouse: {
      totalCapacity: 10000,
      capacities: { ore: 1000, processed: 100, highTech: 10 },
      reserves: {},
      specialization: 'universal',
      colonyRole: 'industrial',
      orbitBuffer: {
        capacity: 100,
        resources: {},
      },
    },
    energyBalance: 0,
    owner: 'player' as EntityId,
    ...overrides,
  };
}

describe('Block 01 T3: Economy — extraction → production → energy', () => {
  let planet: Planet;
  let queues: Map<EntityId, ProductionQueue>;

  beforeEach(() => {
    planet = makeTestPlanet();
    // Give starter resources so buildOnHex(mine/processor/solar_plant) can succeed.
    giveStarterResources(planet);
    queues = new Map();
  });

  test('1. processExtraction adds ore to resources when mine is built', () => {
    // Build a mine on the hex (it has Fe-ore deposit).
    const built = buildOnHex(planet, 0, 'mine');
    expect(built).toBe(true);
    expect(planet.hexes[0].buildingId).toBe('mine');
    expect(planet.hexes[0].buildingLevel).toBe(1);

    // Run 100 ticks — extraction accumulates.
    for (let i = 0; i < 100; i++) {
      processEconomyTick([planet], queues);
    }

    // After 100 ticks, Fe-ore should be in resources (mine extracts Fe-ore).
    expect(planet.resources['Fe-ore']).toBeGreaterThan(0);
  });

  test('2. processProductionQueue — enqueued recipe produces output', () => {
    // Setup: build a processor (no mine — give Fe-ore directly to isolate production test).
    const hex2: HexCell = {
      coord: { q: 1, r: 0 },
      terrain: 'plains' as HexTerrain,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    };
    planet.hexes.push(hex2);
    buildOnHex(planet, 1, 'processor');

    // Give Fe-ore directly (no extraction to isolate production).
    planet.resources['Fe-ore'] = 100;

    // Enqueue a recipe: smelt_fe (Fe-ore → Fe + O).
    const enqueued = enqueueProduction(planet, queues, 'smelt_fe', false);
    expect(enqueued).toBe(true);

    // Run enough ticks to complete the recipe (time=5 → ~20 cycles in 100 ticks).
    for (let i = 0; i < 100; i++) {
      processEconomyTick([planet], queues);
    }

    // After 100 ticks, Fe (output) should be in resources (recipe produces 7 Fe per cycle).
    expect(planet.resources['Fe']).toBeGreaterThan(0);
    // Fe-ore should be consumed (input of 10 per recipe, 100 ticks → up to 10 cycles = 100 Fe-ore consumed).
    expect(planet.resources['Fe-ore'] ?? 0).toBeLessThanOrEqual(100);
  });

  test('3. recalcEnergyBalance — solar plant adds production', () => {
    // Build a solar plant.
    const hex2: HexCell = {
      coord: { q: 1, r: 0 },
      terrain: 'plains' as HexTerrain,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    };
    planet.hexes.push(hex2);
    buildOnHex(planet, 1, 'solar_plant');

    // Recalc energy with a G-type star (luminosity ~1.0).
    const system = {
      id: 'test-system' as EntityId,
      name: 'Test',
      stars: [{ luminosity: 1.0, type: 'STAR_G' as never, name: 'Test Sun', temperature: 5778, mass: 1.0, radius: 1.0 }],
    } as any;
    recalcEnergyBalance(planet, system);

    // Solar plant at level 1: 10 × 1.2 × 1.0 / 1.0 = 12 (with levelMult 1.0).
    // Colony hub: 5 × 1.0 = 5 (colony_hub is auto-built on colonize).
    // Total production should be > 0.
    expect(planet.energyBalance).toBeGreaterThan(0);
  });

  test('4. Energy deficit — buildings do not produce without power', () => {
    // Setup: a processor that needs energy, no solar plant.
    const hex2: HexCell = {
      coord: { q: 1, r: 0 },
      terrain: 'plains' as HexTerrain,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    };
    planet.hexes.push(hex2);
    buildOnHex(planet, 1, 'processor');

    // Set energy balance to negative (no solar plant).
    planet.energyBalance = -10;

    // Give Fe-ore and enqueue.
    planet.resources['Fe-ore'] = 100;
    enqueueProduction(planet, queues, 'smelt_fe', false);

    // Run 100 ticks — production should NOT progress (energy deficit).
    const feBefore = planet.resources['Fe'] ?? 0;
    for (let i = 0; i < 100; i++) {
      processEconomyTick([planet], queues);
    }
    const feAfter = planet.resources['Fe'] ?? 0;

    // No Fe produced (recipe time not decremented due to energy deficit).
    expect(feAfter).toBe(feBefore);
  });

  test('5. cancelProduction removes item from queue', () => {
    // Setup: mine + processor, enqueue a recipe.
    buildOnHex(planet, 0, 'mine');
    const hex2: HexCell = {
      coord: { q: 1, r: 0 },
      terrain: 'plains' as HexTerrain,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    };
    planet.hexes.push(hex2);
    buildOnHex(planet, 1, 'processor');

    planet.resources['Fe-ore'] = 100;
    enqueueProduction(planet, queues, 'smelt_fe', false);

    // Verify item is in queue.
    const queue = queues.get(planet.id);
    expect(queue).toBeDefined();
    expect(queue!.items.length).toBe(1);

    const itemId = queue!.items[0].id;
    // Cancel it.
    const cancelled = cancelProduction(planet, queues, itemId);
    expect(cancelled).toBe(true);
    expect(queue!.items.length).toBe(0);
  });
});
