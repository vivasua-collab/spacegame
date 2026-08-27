/// <reference types="bun-types" />
/**
 * Block 02 — T-FLEET-3 — Orders tests.
 *
 * Tests (matches §7 T-FLEET-3 spec):
 *   1. planRoute finds shortest path through 3 systems (A-B-C via A↔B, B↔C, no A↔C)
 *   2. planRoute returns [A] for from === to
 *   3. planRoute returns null when target isolated (no JP path)
 *   4. calculateTravelTime sums per-leg times (2 legs → 2 × single leg time)
 *   5. calculateTravelTime returns Infinity if no jump drive
 *   6. calculateTravelTime returns Infinity if speed = 0
 *   7. calculateTravelTime returns 0 for path.length <= 1
 *   8. executeOrder sets fleet.orders[0] for 'move' order
 *   9. patrol order has repeat=true (persistent — loops via Phase 2.6 completeOrder)
 *  10. attack order resolves via resolveCombat stub (returns winner + losses)
 *  11. colonize order — canColonizePlanet stub returns true for rocky unowned
 *  12. executeOrder with no path → ok=false, reason='no_route'
 *  13. executeOrder with no jump drive → ok=false, reason='no_jump_drive'
 *  14. executeOrder for 'defend' — targetId = fleet.location (no movement)
 *  15. listReachableSystems returns neighbors of fromSystemId
 *
 * Run: bun test tests/ships/orders.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  planRoute,
  calculateTravelTime,
  calculateFleetStats,
  executeOrder,
  resolveCombat,
  canColonizePlanet,
  listReachableSystems,
  hasActiveOrder,
  getCurrentOrder,
  JUMP_RECHARGE_TICKS,
  TRAVEL_SCALE,
} from '@/ships/orders';
import type { EntityId, Fleet, Galaxy, StarSystem, Ship, ShipDesign, Planet } from '@/core/types';
import { calculateDesignStats } from '@/ships/designer';

// ─── Mock galaxy for tests ───────────────────────────────────────────────

/**
 * Создать мок galaxy с 3 системами A, B, C:
 * - A at (0, 0), B at (5, 0), C at (10, 0)
 * - JP A↔B (A→B + B→A pair)
 * - JP B↔C (B→C + C→B pair)
 * - НЕТ прямого JP A↔C — путь возможен только через B.
 */
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
  // System D — isolated (no JPs at all)
  const systemD: StarSystem = {
    id: 'sys_D',
    name: 'Система D',
    position: { x: 100, y: 100 },
    binaryType: 'BINARY_NONE',
    stars: [],
    planets: [],
    asteroidFields: 0,
    jumpPoints: [],
    discovered: false,
    owner: null,
  };
  const systems = [systemA, systemB, systemC, systemD];
  const systemMap = new Map<EntityId, StarSystem>(systems.map(s => [s.id, s]));
  return {
    id: 'galaxy_test',
    seed: 42,
    systems,
    systemMap,
    bakedModel: { createdAt: 'test', elements: [], oreSpecs: [], iceSpecs: [], atmosphericGases: [] } as never,
  };
}

/** Создать мок galaxy с линейкой из 5 систем для travel-time тестов. */
function makeLinearGalaxy(count: number, spacing: number): Galaxy {
  const systems: StarSystem[] = [];
  for (let i = 0; i < count; i++) {
    systems.push({
      id: `sys_${i}`,
      name: `Система ${i}`,
      position: { x: i * spacing, y: 0 },
      binaryType: 'BINARY_NONE',
      stars: [],
      planets: [],
      asteroidFields: 0,
      jumpPoints: i < count - 1
        ? [{ id: `jp_${i}_${i + 1}`, fromSystemId: `sys_${i}`, toSystemId: `sys_${i + 1}`, stabilized: true }]
        : [],
      discovered: true,
      owner: null,
    });
  }
  // Add reverse JPs
  for (let i = 1; i < count; i++) {
    systems[i]!.jumpPoints.push({
      id: `jp_${i}_${i - 1}`,
      fromSystemId: `sys_${i}`,
      toSystemId: `sys_${i - 1}`,
      stabilized: true,
    });
  }
  const systemMap = new Map<EntityId, StarSystem>(systems.map(s => [s.id, s]));
  return {
    id: 'galaxy_linear',
    seed: 42,
    systems,
    systemMap,
    bakedModel: { createdAt: 'test', elements: [], oreSpecs: [], iceSpecs: [], atmosphericGases: [] } as never,
  };
}

/**
 * Создать мок флота с указанными характеристиками.
 * shipIds: ['ship_1']
 * speed/thrust/mass/jumpDrive — контролируется через mock designs.
 */
function makeMockFleet(
  overrides: Partial<Fleet> = {},
): Fleet {
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

/**
 * Mock Ship + ShipDesign с заданными stats (mass, thrust, canJump).
 * Создаётся так, чтобы calculateDesignStats вернул нужные значения.
 * Для тестов мы обходаем calculateDesignStats, создавая FleetTravelStats напрямую.
 */
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
  // Use the full Разведчик §10.1 module list — gives mass=1075, thrust=800,
  // speed≈7.4, canJump=true. See tests/ships/designer.test.ts.
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

/** Мок планеты (для canColonizePlanet stub). */
function makeMockPlanet(overrides: Partial<Planet> = {}): Planet {
  return {
    id: 'planet_test',
    systemId: 'sys_C',
    name: 'Тест-планета',
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
    hexes: [],
    atmosphericSlots: [],
    orbitSlots: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 0,
    owner: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Block 02 T-FLEET-3 — planRoute (BFS)', () => {
  const galaxy = makeMockGalaxy();

  test('1. planRoute(A, C) — shortest path through 3 systems = [A, B, C]', () => {
    const path = planRoute('sys_A', 'sys_C', galaxy);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path).toEqual(['sys_A', 'sys_B', 'sys_C']);
  });

  test('2. planRoute(A, A) — same system → [A]', () => {
    const path = planRoute('sys_A', 'sys_A', galaxy);
    expect(path).not.toBeNull();
    expect(path).toEqual(['sys_A']);
  });

  test('3. planRoute(A, D) — D isolated → null (no route)', () => {
    const path = planRoute('sys_A', 'sys_D', galaxy);
    expect(path).toBeNull();
  });

  test('4. planRoute(C, A) — reverse direction works (graph is bidirectional)', () => {
    const path = planRoute('sys_C', 'sys_A', galaxy);
    expect(path).not.toBeNull();
    expect(path).toEqual(['sys_C', 'sys_B', 'sys_A']);
  });
});

describe('Block 02 T-FLEET-3 — calculateTravelTime', () => {
  test('5. Two legs → sum of per-leg times', () => {
    // Linear galaxy: sys_0 (0,0), sys_1 (5,0), sys_2 (10,0).
    // Distance per leg = 5 units. Speed = 10 km/s (для круглого числа).
    // Per-leg = ceil(5 × 1000 / 10 + 10) = ceil(500 + 10) = 510 ticks.
    // Two legs = 510 × 2 = 1020 ticks total.
    const galaxy = makeLinearGalaxy(3, 5);
    const fleetStats = { mass: 100, thrust: 1000, speed: 10, jumpDrivePresent: true };
    const travelTime = calculateTravelTime(['sys_0', 'sys_1', 'sys_2'], fleetStats, galaxy);
    const expectedPerLeg = Math.ceil((5 * TRAVEL_SCALE) / 10 + JUMP_RECHARGE_TICKS);
    expect(travelTime).toBe(expectedPerLeg * 2);
  });

  test('6. No jump drive → Infinity', () => {
    const galaxy = makeLinearGalaxy(2, 5);
    const fleetStats = { mass: 100, thrust: 1000, speed: 10, jumpDrivePresent: false };
    const travelTime = calculateTravelTime(['sys_0', 'sys_1'], fleetStats, galaxy);
    expect(travelTime).toBe(Infinity);
  });

  test('7. Speed = 0 → Infinity', () => {
    const galaxy = makeLinearGalaxy(2, 5);
    const fleetStats = { mass: 100, thrust: 0, speed: 0, jumpDrivePresent: true };
    const travelTime = calculateTravelTime(['sys_0', 'sys_1'], fleetStats, galaxy);
    expect(travelTime).toBe(Infinity);
  });

  test('8. path.length <= 1 → 0 ticks', () => {
    const galaxy = makeMockGalaxy();
    const fleetStats = { mass: 100, thrust: 1000, speed: 10, jumpDrivePresent: true };
    expect(calculateTravelTime(['sys_A'], fleetStats, galaxy)).toBe(0);
    expect(calculateTravelTime([], fleetStats, galaxy)).toBe(0);
  });
});

describe('Block 02 T-FLEET-3 — calculateFleetStats', () => {
  test('9. Stats вычисляются из кораблей флота через дизайны', () => {
    // Разведчик §10.1 дизайн: mass=1075, thrust=800, speed=7.4, canJump=true.
    const galaxy = makeMockGalaxy();
    const fleet = makeMockFleet();
    const ships = makeMockShipsMap();
    const designs = makeMockDesignsMap();
    const stats = calculateFleetStats(fleet, ships, designs);
    // Разведчик имеет mass=1075 (500 hull + 575 modules), thrust=800 (engine_ion_mk1)
    // → speed = 800/1075 × 10 ≈ 7.44
    expect(stats.mass).toBeCloseTo(1075, 0);
    expect(stats.thrust).toBeCloseTo(800, 0);
    expect(stats.speed).toBeGreaterThan(7.0);
    expect(stats.speed).toBeLessThan(8.0);
    expect(stats.jumpDrivePresent).toBe(true);
  });
});

describe('Block 02 T-FLEET-3 — executeOrder', () => {
  const galaxy = makeMockGalaxy();
  const ships = makeMockShipsMap();
  const designs = makeMockDesignsMap();

  test('10. executeOrder move → orders[0] установлен с type=move', () => {
    const fleet = makeMockFleet();
    const result = executeOrder(fleet, 'move', 'sys_C', galaxy, ships, designs, 100);
    expect(result.ok).toBe(true);
    expect(result.order).toBeDefined();
    expect(result.order!.type).toBe('move');
    expect(result.order!.targetId).toBe('sys_C');
    expect(result.order!.path).toEqual(['sys_A', 'sys_B', 'sys_C']);
    expect(result.order!.issuedTick).toBe(100);
    expect(result.order!.currentLegIndex).toBe(0);
    expect(result.order!.etaTick).toBeGreaterThan(100); // > issuedTick
    expect(result.updatedFleet.orders[0]).toBe(result.order);
  });

  test('11. patrol order → repeat=true (persistent — loops)', () => {
    const fleet = makeMockFleet();
    const result = executeOrder(fleet, 'patrol', 'sys_C', galaxy, ships, designs, 0);
    expect(result.ok).toBe(true);
    expect(result.order!.type).toBe('patrol');
    expect(result.order!.repeat).toBe(true);
  });

  test('12. move order → repeat=false (not persistent)', () => {
    const fleet = makeMockFleet();
    const result = executeOrder(fleet, 'move', 'sys_C', galaxy, ships, designs, 0);
    expect(result.ok).toBe(true);
    expect(result.order!.repeat).toBe(false);
  });

  test('13. defend order → target = fleet.location (no movement)', () => {
    const fleet = makeMockFleet({ location: 'sys_B' });
    const result = executeOrder(fleet, 'defend', 'sys_A', galaxy, ships, designs, 50);
    expect(result.ok).toBe(true);
    expect(result.order!.type).toBe('defend');
    expect(result.order!.targetId).toBe('sys_B'); // not sys_A!
    expect(result.order!.path).toEqual(['sys_B']);
    expect(result.order!.etaTick).toBe(50); // no movement → eta = issuedTick
    expect(result.order!.repeat).toBe(false);
  });

  test('14. No route (isolated target) → ok=false, reason=no_route', () => {
    const fleet = makeMockFleet();
    const result = executeOrder(fleet, 'move', 'sys_D', galaxy, ships, designs, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_route');
    expect(result.order).toBeUndefined();
    expect(result.updatedFleet.orders.length).toBe(0); // no order added
  });

  test('15. No jump drive → ok=false, reason=no_jump_drive', () => {
    // Ship without jump_drive module — canColonize=false, canJump=false.
    // Override the designs map to use a design without jump_drive.
    const noJumpDesign: ShipDesign = {
      id: 'design_no_jump',
      name: 'Без прыжка',
      hullId: 'hull_scout',
      armor: 'light',
      moduleIds: ['cpu_micro', 'engine_ion_mk1', 'reactor_nuclear_mk1'], // no jump_drive
      owner: 'player',
      createdAtTick: 0,
    };
    const designsNoJump = new Map([['design_no_jump', noJumpDesign]]);
    const shipNoJump: Ship = {
      ...makeMockShipsMap().get('ship_1')!,
      designId: 'design_no_jump',
    };
    const shipsNoJump = new Map([['ship_1', shipNoJump]]);
    const fleet = makeMockFleet();
    const result = executeOrder(fleet, 'move', 'sys_C', galaxy, shipsNoJump, designsNoJump, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_jump_drive');
  });
});

describe('Block 02 T-FLEET-3 — resolveCombat stub', () => {
  test('16. resolveCombat returns winner=attacker, losses=[]', () => {
    const attacker = makeMockFleet();
    const result = resolveCombat(attacker);
    expect(result.winner).toBe('attacker');
    expect(result.losses).toEqual([]);
    expect(Array.isArray(result.losses)).toBe(true);
  });

  test('17. resolveCombat with defender — still attacker wins (MVP stub)', () => {
    const attacker = makeMockFleet();
    const defender = makeMockFleet({ id: 'fleet_defender', owner: 'enemy' });
    const result = resolveCombat(attacker, defender);
    expect(result.winner).toBe('attacker');
  });
});

describe('Block 02 T-FLEET-3 — canColonizePlanet stub', () => {
  test('18. Rocky + unowned → can colonize', () => {
    const planet = makeMockPlanet({ type: 'rocky', owner: null });
    expect(canColonizePlanet(planet)).toBe(true);
  });

  test('19. Gas giant → cannot colonize', () => {
    const planet = makeMockPlanet({ type: 'gas_giant' });
    expect(canColonizePlanet(planet)).toBe(false);
  });

  test('20. Already owned → cannot colonize', () => {
    const planet = makeMockPlanet({ owner: 'player' });
    expect(canColonizePlanet(planet)).toBe(false);
  });
});

describe('Block 02 T-FLEET-3 — listReachableSystems', () => {
  test('21. From A — reachable = {B, C}, not D', () => {
    const galaxy = makeMockGalaxy();
    const reachable = listReachableSystems('sys_A', galaxy);
    const ids = reachable.map(s => s.id);
    expect(ids).toContain('sys_B');
    expect(ids).toContain('sys_C');
    expect(ids).not.toContain('sys_A'); // exclude self
    expect(ids).not.toContain('sys_D'); // isolated
  });
});

describe('Block 02 T-FLEET-3 — hasActiveOrder + getCurrentOrder', () => {
  test('22. Empty orders → hasActiveOrder=false, getCurrentOrder=undefined', () => {
    const fleet = makeMockFleet();
    expect(hasActiveOrder(fleet)).toBe(false);
    expect(getCurrentOrder(fleet)).toBeUndefined();
  });

  test('23. After executeOrder → hasActiveOrder=true, getCurrentOrder returns it', () => {
    const galaxy = makeMockGalaxy();
    const ships = makeMockShipsMap();
    const designs = makeMockDesignsMap();
    const fleet = makeMockFleet();
    const result = executeOrder(fleet, 'move', 'sys_C', galaxy, ships, designs, 0);
    expect(hasActiveOrder(result.updatedFleet)).toBe(true);
    const order = getCurrentOrder(result.updatedFleet);
    expect(order).toBeDefined();
    expect(order!.type).toBe('move');
    expect(order!.targetId).toBe('sys_C');
  });
});
