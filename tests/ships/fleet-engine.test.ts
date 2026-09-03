/// <reference types="bun-types" />
/**
 * Block 02 — T-FLEET-4 — Fleet engine tick processing tests.
 *
 * Covers Phase 2.6 (F5: Jump Point Travel):
 *   1. processFleetTick with no active order → no-op
 *   2. processFleetTick before etaTick → fleet stays at current leg (in transit)
 *   3. processFleetTick advances leg when currentTick >= etaTick (move order)
 *   4. processFleetTick completes move order when reaching final destination
 *   5. consumeFuel deducts from fleet.fuelStores (xenon priority)
 *   6. consumeFuel falls through to hydrogen when xenon exhausted
 *   7. Insufficient fuel → fleet stranded, emits fleet:stranded
 *   8. completeOrder pops orders[0] for 'move' type
 *   9. patrol order re-queues with reversed path (loops back to origin)
 *  10. defend order sets fleet.defending = true (immediate completion)
 *  11. colonize order calls colonizePlanet (planet owner changes to 'player')
 *
 * Run: bun test tests/ships/fleet-engine.test.ts
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import {
  processFleetTick,
  consumeFuel,
  completeOrder,
  createFleet,
  mergeFleets,
  splitFleet,
} from '@/ships/fleet-engine';
import type {
  EntityId,
  Fleet,
  FleetOrder,
  GameState,
  Galaxy,
  StarSystem,
  Ship,
  ShipDesign,
  Planet,
  GameTime,
  GameSpeed,
} from '@/core/types';
import { gameBus } from '@/core/typed-event-bus';

// ─── Mock galaxy (linear A-B-C with bidirectional JPs) ────────────────────

function makeMockGalaxy(): Galaxy {
  const systemA: StarSystem = {
    id: 'sys_A',
    name: 'Система A',
    position: { x: 0, y: 0 },
    binaryType: 'BINARY_NONE',
    stars: [],
    planets: [],
    asteroidFields: 0,
    jumpPoints: [
      { id: 'jp_AB', fromSystemId: 'sys_A', toSystemId: 'sys_B', stabilized: true },
    ],
    discovered: true,
    owner: null,
  };
  const systemB: StarSystem = {
    id: 'sys_B',
    name: 'Система B',
    position: { x: 5, y: 0 },
    binaryType: 'BINARY_NONE',
    stars: [],
    planets: [],
    asteroidFields: 0,
    jumpPoints: [
      { id: 'jp_BA', fromSystemId: 'sys_B', toSystemId: 'sys_A', stabilized: true },
      { id: 'jp_BC', fromSystemId: 'sys_B', toSystemId: 'sys_C', stabilized: true },
    ],
    discovered: true,
    owner: null,
  };
  const systemC: StarSystem = {
    id: 'sys_C',
    name: 'Система C',
    position: { x: 10, y: 0 },
    binaryType: 'BINARY_NONE',
    stars: [],
    planets: [],
    asteroidFields: 0,
    jumpPoints: [
      { id: 'jp_CB', fromSystemId: 'sys_C', toSystemId: 'sys_B', stabilized: true },
    ],
    discovered: true,
    owner: null,
  };
  const systems = [systemA, systemB, systemC];
  const systemMap = new Map<EntityId, StarSystem>(systems.map(s => [s.id, s]));
  return {
    id: 'galaxy_test',
    seed: 42,
    systems,
    systemMap,
    bakedModel: { createdAt: 'test', elements: [], oreSpecs: [], iceSpecs: [], atmosphericGases: [] } as never,
  };
}

/** Galaxy with a planet in sys_C that can be colonized (rocky, unowned, with one free hex). */
function makeMockGalaxyWithPlanet(): Galaxy {
  const galaxy = makeMockGalaxy();
  // Replace sys_C with one that has a rocky planet with a free hex
  const sysC = galaxy.systemMap.get('sys_C')!;
  const planet: Planet = {
    id: 'planet_rocky_1',
    systemId: 'sys_C',
    name: 'Каменистая 1',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6000,
    density: 5.5,
    gravity: 1.0,
    temperature: 20,
    atmosphere: { type: 'standard', pressure: 1.0, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 2,
    orbitalRadius: 1.5,
    orbitalPeriod: 365,
    hexes: [
      {
        coord: { q: 0, r: 0 },
        terrain: 'plains',
        buildingId: null,
        buildingLevel: 0,
        deposits: [],
      },
      {
        coord: { q: 1, r: 0 },
        terrain: 'mountains',
        buildingId: null,
        buildingLevel: 0,
        deposits: [],
      },
    ],
    atmosphericSlots: [],
    orbitSlots: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 0,
    owner: null,
  };
  sysC.planets = [planet];
  return galaxy;
}

// ─── Mock ships + designs (Разведчик §10.1) ────────────────────────────────

function makeMockShipsMap(): Map<EntityId, Ship> {
  const ship: Ship = {
    id: 'ship_1',
    name: 'Тест-корабль',
    designId: 'design_test',
    hullId: 'hull_scout',
    moduleIds: ['jump_drive_mk1'],
    armor: 'light',
    hp: 200,
    maxHp: 200,
    fuel: { chemical: 0, xenon: 100, hydrogen: 0, antimatter: 0 },
    location: 'sys_A',
    owner: 'player',
    designName: 'Тест-дизайн',
  };
  return new Map([['ship_1', ship]]);
}

function makeMockDesignsMap(): Map<EntityId, ShipDesign> {
  const design: ShipDesign = {
    id: 'design_test',
    name: 'Тест-дизайн',
    hullId: 'hull_scout',
    armor: 'light',
    moduleIds: [
      'cpu_micro',
      'engine_ion_mk1',
      'scanner_basic',
      'comm_mk2',
      'fuel_tank_xenon_s',
      'jump_drive_mk1',
      'navigator_mk1',
      'reactor_nuclear_mk1',
    ],
    owner: 'player',
    createdAtTick: 0,
  };
  return new Map([['design_test', design]]);
}

function makeMockFleet(overrides: Partial<Fleet> = {}): Fleet {
  return {
    id: 'fleet_test',
    name: 'Тест-флот',
    shipIds: ['ship_1'],
    location: 'sys_A',
    owner: 'player',
    orders: [],
    fuelStores: { chemical: 0, xenon: 100, hydrogen: 0, antimatter: 0 },
    ...overrides,
  };
}

function makeMockGameState(galaxy: Galaxy = makeMockGalaxy()): GameState {
  return {
    time: { tick: 0, dayInYear: 0, year: 1 },
    speed: 0,
    phase: 'playing',
    galaxy,
    productionQueues: new Map(),
    fleets: [],
    playerFactionId: 'player',
    shipDesigns: makeMockDesignsMap(),
    shipyardQueues: new Map(),
    ships: makeMockShipsMap(),
    // Block 03 (R7): researchState required by GameState type — default empty.
    // R-RES §B: researchQueue field is now required on ResearchState.
    // R-SPLIT (Задача 22): rpBank field is now required on ResearchState.
    researchState: {
      fundamentalLevels: {
        chemistry: 0, physics: 0, engineering: 0,
        biology_fund: 0, military_science: 0, xenoarchaeology: 0,
      },
      fundamentalRpInvested: {},
      rpBank: 0,
      researched: {},
      activeSlots: [],
      researchQueue: [],
      totalRpGenerated: 0,
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Block 02 T-FLEET-4 — processFleetTick', () => {
  let gameState: GameState;

  beforeEach(() => {
    gameState = makeMockGameState();
  });

  test('1. No active order → no-op (returns same fleet, not completed)', () => {
    const fleet = makeMockFleet(); // empty orders
    const result = processFleetTick(fleet, gameState, 5);
    expect(result.completed).toBe(false);
    expect(result.updatedFleet).toBe(fleet); // same reference
    expect(result.stranded).toBeUndefined();
  });

  test('2. Before etaTick → fleet stays at current leg (in transit)', () => {
    // Move order: path A→B, currentLegIndex=0, issuedTick=0, etaTick=100.
    // At tick=50 → still in transit; no movement; not completed.
    const order: FleetOrder = {
      type: 'move',
      targetId: 'sys_B',
      issuedTick: 0,
      path: ['sys_A', 'sys_B'],
      currentLegIndex: 0,
      etaTick: 100,
      repeat: false,
    };
    const fleet = makeMockFleet({ orders: [order] });
    const result = processFleetTick(fleet, gameState, 50);
    expect(result.completed).toBe(false);
    expect(result.updatedFleet.location).toBe('sys_A'); // unchanged
    expect(result.updatedFleet.orders[0]!.currentLegIndex).toBe(0); // still on leg 0
    expect(result.arrivedAt).toBeUndefined();
  });

  test('3. At etaTick → advances one leg (fleet.location updates to next system)', () => {
    // Move order: path A→B, currentLegIndex=0, issuedTick=0, etaTick=100.
    // At tick=100 → advance: nextLegIndex=1, location becomes sys_B.
    const order: FleetOrder = {
      type: 'move',
      targetId: 'sys_B',
      issuedTick: 0,
      path: ['sys_A', 'sys_B'],
      currentLegIndex: 0,
      etaTick: 100,
      repeat: false,
    };
    const fleet = makeMockFleet({ orders: [order] });
    const result = processFleetTick(fleet, gameState, 100);
    expect(result.completed).toBe(true); // single-leg path → completes
    expect(result.updatedFleet.location).toBe('sys_B');
    expect(result.updatedFleet.orders.length).toBe(0); // order popped
  });

  test('4. Multi-leg path: intermediate leg advances without completing order', () => {
    // Move order: path A→B→C, currentLegIndex=0, issuedTick=0, etaTick=50.
    // At tick=50 → advance to sys_B (leg 1), but not final → not completed.
    const order: FleetOrder = {
      type: 'move',
      targetId: 'sys_C',
      issuedTick: 0,
      path: ['sys_A', 'sys_B', 'sys_C'],
      currentLegIndex: 0,
      etaTick: 50,
      repeat: false,
    };
    const fleet = makeMockFleet({ orders: [order] });
    const result = processFleetTick(fleet, gameState, 50);
    expect(result.completed).toBe(false); // intermediate leg, not final
    expect(result.updatedFleet.location).toBe('sys_B');
    expect(result.updatedFleet.orders[0]!.currentLegIndex).toBe(1);
    expect(result.arrivedAt).toBe('sys_B');
    // New etaTick should be in the future (recalculated for next leg)
    expect(result.updatedFleet.orders[0]!.etaTick).toBeGreaterThan(50);
  });

  test('5. defend order → immediate completion, fleet.defending=true, no movement', () => {
    // Defend: targetId=fleet.location, path=[location], etaTick=currentTick.
    // Single tick → defending=true, order popped.
    const order: FleetOrder = {
      type: 'defend',
      targetId: 'sys_A',
      issuedTick: 0,
      path: ['sys_A'],
      currentLegIndex: 0,
      etaTick: 0,
      repeat: false,
    };
    const fleet = makeMockFleet({ orders: [order] });
    const result = processFleetTick(fleet, gameState, 0);
    expect(result.completed).toBe(true);
    expect(result.updatedFleet.defending).toBe(true);
    expect(result.updatedFleet.orders.length).toBe(0);
    expect(result.updatedFleet.location).toBe('sys_A'); // no movement
  });
});

describe('Block 02 T-FLEET-4 — consumeFuel', () => {
  test('6. Deducts from xenon first (priority order: xenon → hydrogen → chemical)', () => {
    const fleet = makeMockFleet({
      fuelStores: { chemical: 50, xenon: 100, hydrogen: 30, antimatter: 0 },
    });
    const result = consumeFuel(fleet, 1);
    expect(result.insufficient).toBe(false);
    expect(result.fleet.fuelStores.xenon).toBe(99); // xenon deducted
    expect(result.fleet.fuelStores.hydrogen).toBe(30); // unchanged
    expect(result.fleet.fuelStores.chemical).toBe(50); // unchanged
  });

  test('7. Falls through to hydrogen when xenon exhausted', () => {
    const fleet = makeMockFleet({
      fuelStores: { chemical: 50, xenon: 0, hydrogen: 30, antimatter: 0 },
    });
    const result = consumeFuel(fleet, 1);
    expect(result.insufficient).toBe(false);
    expect(result.fleet.fuelStores.xenon).toBe(0);
    expect(result.fleet.fuelStores.hydrogen).toBe(29); // hydrogen deducted
    expect(result.fleet.fuelStores.chemical).toBe(50); // unchanged
  });

  test('8. All fuel types exhausted → insufficient=true, fuel not modified', () => {
    const fleet = makeMockFleet({
      fuelStores: { chemical: 0, xenon: 0, hydrogen: 0, antimatter: 0 },
    });
    const result = consumeFuel(fleet, 1);
    expect(result.insufficient).toBe(true);
    // Fleet unchanged
    expect(result.fleet.fuelStores.xenon).toBe(0);
    expect(result.fleet.fuelStores.hydrogen).toBe(0);
    expect(result.fleet.fuelStores.chemical).toBe(0);
  });

  test('9. Partial amount per type — xenon covers amount → no fallback', () => {
    const fleet = makeMockFleet({
      fuelStores: { chemical: 1, xenon: 2, hydrogen: 1, antimatter: 0 },
    });
    const result = consumeFuel(fleet, 2);
    expect(result.insufficient).toBe(false);
    expect(result.fleet.fuelStores.xenon).toBe(0); // exactly 2 deducted
    expect(result.fleet.fuelStores.hydrogen).toBe(1); // untouched
    expect(result.fleet.fuelStores.chemical).toBe(1); // untouched
  });
});

describe('Block 02 T-FLEET-4 — stranded fleet (insufficient fuel during move)', () => {
  let gameState: GameState;

  beforeEach(() => {
    gameState = makeMockGameState();
  });

  test('10. Insufficient fuel at leg advance → stranded=true, fleet stays put', () => {
    // Move order: path A→B, currentLegIndex=0, etaTick=100.
    // Fleet has 0 fuel → at tick=100 → consumeFuel fails → stranded.
    const order: FleetOrder = {
      type: 'move',
      targetId: 'sys_B',
      issuedTick: 0,
      path: ['sys_A', 'sys_B'],
      currentLegIndex: 0,
      etaTick: 100,
      repeat: false,
    };
    const fleet = makeMockFleet({
      orders: [order],
      fuelStores: { chemical: 0, xenon: 0, hydrogen: 0, antimatter: 0 },
    });

    // Subscribe to stranded event to verify emission
    let strandedEmitted = false;
    gameBus.on('fleet:stranded', (e) => {
      if (e.fleetId === 'fleet_test') strandedEmitted = true;
    });

    const result = processFleetTick(fleet, gameState, 100);
    expect(result.stranded).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.updatedFleet.location).toBe('sys_A'); // stayed put
    expect(result.updatedFleet.orders.length).toBe(1); // order not popped
    expect(strandedEmitted).toBe(true);
  });
});

describe('Block 02 T-FLEET-4 — completeOrder', () => {
  let gameState: GameState;

  beforeEach(() => {
    gameState = makeMockGameState();
  });

  test('11. completeOrder for move → pops orders[0], fleet stays at target', () => {
    const order: FleetOrder = {
      type: 'move',
      targetId: 'sys_B',
      issuedTick: 0,
      path: ['sys_A', 'sys_B'],
      currentLegIndex: 1, // already at final leg
      etaTick: 100,
      repeat: false,
    };
    const fleet = makeMockFleet({
      location: 'sys_B', // already at target
      orders: [order],
    });
    const result = completeOrder(fleet, gameState, 100);
    expect(result.completed).toBe(true);
    expect(result.updatedFleet.orders.length).toBe(0); // popped
    expect(result.updatedFleet.location).toBe('sys_B'); // stays at target
  });

  test('12. completeOrder for patrol → re-queues with reversed path', () => {
    // Patrol: path A→B→C, issuedTick=0, etaTick=100 (travelDuration=100).
    // After completion: reversed path [C, B, A], currentLegIndex=0,
    // issuedTick=currentTick, etaTick=currentTick + 100.
    const order: FleetOrder = {
      type: 'patrol',
      targetId: 'sys_C',
      issuedTick: 0,
      path: ['sys_A', 'sys_B', 'sys_C'],
      currentLegIndex: 2, // at final leg
      etaTick: 100,
      repeat: true,
    };
    const fleet = makeMockFleet({
      location: 'sys_C',
      orders: [order],
    });
    const result = completeOrder(fleet, gameState, 200);
    expect(result.completed).toBe(true);
    expect(result.updatedFleet.orders.length).toBe(1); // re-queued
    const newOrder = result.updatedFleet.orders[0]!;
    expect(newOrder.type).toBe('patrol');
    expect(newOrder.path).toEqual(['sys_C', 'sys_B', 'sys_A']); // reversed
    expect(newOrder.currentLegIndex).toBe(0);
    expect(newOrder.issuedTick).toBe(200); // current tick
    expect(newOrder.etaTick).toBe(300); // 200 + (100 - 0) = 300
    expect(newOrder.repeat).toBe(true);
  });

  test('13. completeOrder for defend → fleet.defending=true, order popped', () => {
    const order: FleetOrder = {
      type: 'defend',
      targetId: 'sys_B',
      issuedTick: 0,
      path: ['sys_B'],
      currentLegIndex: 0,
      etaTick: 0,
      repeat: false,
    };
    const fleet = makeMockFleet({
      location: 'sys_B',
      orders: [order],
      defending: false,
    });
    const result = completeOrder(fleet, gameState, 50);
    expect(result.completed).toBe(true);
    expect(result.updatedFleet.defending).toBe(true);
    expect(result.updatedFleet.orders.length).toBe(0);
  });
});

describe('Block 02 T-FLEET-4 — colonize order', () => {
  let gameState: GameState;

  beforeEach(() => {
    gameState = makeMockGameState(makeMockGalaxyWithPlanet());
  });

  test('14. colonize order completes + planet owner changes to player', () => {
    // Fleet at sys_C with colonize order targeting sys_C.
    // completeOrder for colonize → calls engine.colonizePlanet → owner='player'.
    const order: FleetOrder = {
      type: 'colonize',
      targetId: 'sys_C',
      issuedTick: 0,
      path: ['sys_C'], // already at target
      currentLegIndex: 0,
      etaTick: 100,
      repeat: false,
    };
    const fleet = makeMockFleet({
      location: 'sys_C',
      orders: [order],
    });

    // Verify planet is unowned before
    const planetBefore = gameState.galaxy.systemMap.get('sys_C')!.planets[0]!;
    expect(planetBefore.owner).toBeNull();

    const result = completeOrder(fleet, gameState, 100);
    expect(result.completed).toBe(true);
    expect(result.colonizedPlanetId).toBe('planet_rocky_1');
    // Planet owner should now be 'player' (mutated in place by engine.colonizePlanet).
    expect(planetBefore.owner).toBe('player');
    expect(result.updatedFleet.orders.length).toBe(0); // popped
  });
});

// ─── createFleet / mergeFleets / splitFleet (smoke tests in tick context) ──

describe('Block 02 T-FLEET-4 — fleet engine: pure helpers', () => {
  test('15. createFleet returns Fleet without id (store assigns)', () => {
    const draft = createFleet(['ship_1', 'ship_2'], 'sys_A', 'player', 'Мой флот');
    expect(draft.name).toBe('Мой флот');
    expect(draft.shipIds).toEqual(['ship_1', 'ship_2']);
    expect(draft.location).toBe('sys_A');
    expect(draft.owner).toBe('player');
    expect(draft.orders).toEqual([]);
    expect(draft.fuelStores.xenon).toBe(0);
    // No id field (caller assigns)
    expect((draft as Partial<Fleet>).id).toBeUndefined();
  });

  test('16. mergeFleets sums fuelStores across all fuel types', () => {
    const f1 = makeMockFleet({
      id: 'f1',
      fuelStores: { chemical: 10, xenon: 100, hydrogen: 5, antimatter: 0 },
    });
    const f2 = makeMockFleet({
      id: 'f2',
      fuelStores: { chemical: 20, xenon: 50, hydrogen: 10, antimatter: 0 },
    });
    const merged = mergeFleets([f1, f2]);
    expect(merged.fuelStores.chemical).toBe(30);
    expect(merged.fuelStores.xenon).toBe(150);
    expect(merged.fuelStores.hydrogen).toBe(15);
    expect(merged.shipIds.length).toBe(2);
  });

  test('17. splitFleet divides fuel proportionally (round-down to extracted, remainder to remaining)', () => {
    // 4 ships, 100 xenon. Extract 1 ship → 25 xenon (100*1/4 = 25).
    // Remaining 3 ships → 75 xenon.
    const fleet = makeMockFleet({
      id: 'f1',
      shipIds: ['s1', 's2', 's3', 's4'],
      fuelStores: { chemical: 0, xenon: 100, hydrogen: 0, antimatter: 0 },
    });
    const { remaining, extracted } = splitFleet(fleet, ['s1']);
    expect(extracted.shipIds).toEqual(['s1']);
    expect(extracted.fuelStores.xenon).toBe(25); // 100 × 1/4 = 25
    expect(remaining.shipIds).toEqual(['s2', 's3', 's4']);
    expect(remaining.fuelStores.xenon).toBe(75); // 100 - 25 = 75
    // Total preserved: 25 + 75 = 100
    expect(extracted.fuelStores.xenon + remaining.fuelStores.xenon).toBe(100);
  });
});
