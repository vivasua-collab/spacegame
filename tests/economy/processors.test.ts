/// <reference types="bun-types" />
/**
 * Block 05 — T5.1–T5.8 Processor specialization tests.
 *
 * Spec: checkpoints/08_27_block_05_processors.md §7.
 *
 * T5.1 — Universal with 1 recipe vs 3 recipes: output ratio = 1/sqrt(activeCount)
 * T5.2 — Specialized vs universal (same recipe): specialized ≥ universal × 1.33
 * T5.3 — Specialization level rises → purity and yield rise monotonically
 * T5.4 — specializeBuilding: universal → specialized (mutation + cost + emit)
 * T5.5 — Failure modes: low level, category-level-too-low, already-specialized-form
 * T5.6 — Electronic silicon purity (universal vs specialized nonmetal_smelting L3)
 * T5.7 — Reverse upgrade: universal → specialized → universal (50% refund)
 * T5.8 — Recipe categories: every processor/refinery/synthesizer recipe has
 *        a valid processorCategory that exists in PROCESSOR_CATEGORIES
 *
 * Run: bun test tests/economy/processors.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup'; // enableMapSet + setAutoFreeze(false)
import {
  calculateProcessorOutputMultiplier,
  specializeBuilding,
  upgradeSpecialization,
} from '@/economy/engine';
import { BUILDING_MAP, BUILDINGS } from '@/data/buildings';
import { RECIPES, RECIPE_MAP } from '@/data/recipes';
import { PROCESSOR_CATEGORIES } from '@/data/processor-categories';
import { resolveProcessorCategory } from '@/data/processor-recipe-categories';
import { gameBus } from '@/core/typed-event-bus';
import type {
  Planet,
  HexCell,
  ProcessorType,
  ProcessorRecipeCategory,
  BuildingDef,
  RecipeDef,
  GameTime,
  GameState,
} from '@/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeProcessorInstance(
  processorType: ProcessorType,
  specializationLevel = 0,
  specialization?: ProcessorRecipeCategory,
  activeRecipes: string[] = [],
): { processorType: ProcessorType; specialization?: ProcessorRecipeCategory; specializationLevel: number; activeRecipes: string[] } {
  return { processorType, specialization, specializationLevel, activeRecipes };
}

function makePlanet(): Planet {
  return {
    id: 'test_planet',
    systemId: 'test_system',
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
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes: [],
    atmosphericSlots: [],
    orbitSlots: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 1000,
    owner: 'player',
  };
}

function makeHex(buildingId: string, level: number): HexCell {
  return {
    coord: { q: 0, r: 0 },
    terrain: 'plains',
    buildingId,
    buildingLevel: level,
    deposits: [],
  };
}

// ─── T5.1 — Universal: 1 vs 3 recipes ──────────────────────────────────

describe('Block 05 T5.1 — Universal: 1 recipe vs 3 recipes (multi-recipe penalty)', () => {
  const processor = BUILDING_MAP.get('processor')!;

  test('Universal with 1 active recipe → no penalty (yieldMult = baseYield × 1.0)', () => {
    const instance = makeProcessorInstance('universal', 0, undefined, ['smelt_fe']);
    const { yieldMult, purity } = calculateProcessorOutputMultiplier(processor, instance);
    // baseYield=0.75, sqrt(1)=1.0 → 0.75 × 1.0 = 0.75
    expect(yieldMult).toBeCloseTo(0.75, 5);
    expect(purity).toBeCloseTo(0.78, 5);
  });

  test('Universal with 3 active recipes → penalty 1/sqrt(3) ≈ 0.577', () => {
    const instance = makeProcessorInstance('universal', 0, undefined, ['smelt_fe', 'smelt_ti', 'smelt_cu']);
    const { yieldMult, purity } = calculateProcessorOutputMultiplier(processor, instance);
    // baseYield=0.75, sqrt(3)≈1.732 → 0.75 / 1.732 ≈ 0.433
    expect(yieldMult).toBeCloseTo(0.75 / Math.sqrt(3), 5);
    expect(purity).toBeCloseTo(0.78, 5);
  });

  test('Ratio of 1-recipe vs 3-recipe output = 1/sqrt(3) ≈ 0.577 (≈ 42% penalty)', () => {
    const one = calculateProcessorOutputMultiplier(processor, makeProcessorInstance('universal', 0, undefined, ['smelt_fe']));
    const three = calculateProcessorOutputMultiplier(processor, makeProcessorInstance('universal', 0, undefined, ['smelt_fe', 'smelt_ti', 'smelt_cu']));
    const ratio = three.yieldMult / one.yieldMult;
    expect(ratio).toBeCloseTo(1 / Math.sqrt(3), 5);
    // 1 recipe is ~1.73× more productive than 3 recipes
    expect(one.yieldMult / three.yieldMult).toBeCloseTo(Math.sqrt(3), 5);
  });
});

// ─── T5.2 — Specialized vs universal (same recipe) ──────────────────────

describe('Block 05 T5.2 — Specialized vs universal (same recipe)', () => {
  const processor = BUILDING_MAP.get('processor')!;

  test('Universal: yieldMult = 0.75 × 1.0 (no penalty for 1 recipe)', () => {
    const universal = makeProcessorInstance('universal', 0, undefined, ['smelt_fe']);
    const result = calculateProcessorOutputMultiplier(processor, universal);
    expect(result.yieldMult).toBeCloseTo(0.75, 5);
    expect(result.purity).toBeCloseTo(0.78, 5);
  });

  test('Specialized L1: yieldMult = 1.0 × 1.0 = 1.0, purity = 0.92', () => {
    const specialized = makeProcessorInstance('specialized', 1, 'metal_smelting', ['smelt_fe']);
    const result = calculateProcessorOutputMultiplier(processor, specialized);
    expect(result.yieldMult).toBeCloseTo(1.0, 5);
    expect(result.purity).toBeCloseTo(0.92, 5);
  });

  test('Specialized ≥ universal × 1.33 (per spec §7 T5.2)', () => {
    const universal = calculateProcessorOutputMultiplier(processor, makeProcessorInstance('universal', 0, undefined, ['smelt_fe']));
    const specialized = calculateProcessorOutputMultiplier(processor, makeProcessorInstance('specialized', 1, 'metal_smelting', ['smelt_fe']));
    expect(specialized.yieldMult).toBeGreaterThanOrEqual(universal.yieldMult * 1.33);
  });
});

// ─── T5.3 — Specialization level monotonic growth ──────────────────────

describe('Block 05 T5.3 — Specialization level monotonic growth', () => {
  const processor = BUILDING_MAP.get('processor')!;

  test('L1 → L5: yieldMult rises monotonically', () => {
    const yields: number[] = [];
    for (let lvl = 1; lvl <= 5; lvl++) {
      const instance = makeProcessorInstance('specialized', lvl, 'metal_smelting', ['smelt_fe']);
      yields.push(calculateProcessorOutputMultiplier(processor, instance).yieldMult);
    }
    // Strictly increasing
    for (let i = 1; i < yields.length; i++) {
      expect(yields[i]!).toBeGreaterThan(yields[i - 1]!);
    }
    // L1 = 1.0, L5 = 1.0 × 1.08 = 1.08
    expect(yields[0]!).toBeCloseTo(1.0, 5);
    expect(yields[4]!).toBeCloseTo(1.08, 5);
  });

  test('L1 → L5: purity rises 0.92 → 0.99 monotonically', () => {
    const purities: number[] = [];
    for (let lvl = 1; lvl <= 5; lvl++) {
      const instance = makeProcessorInstance('specialized', lvl, 'metal_smelting', ['smelt_fe']);
      purities.push(calculateProcessorOutputMultiplier(processor, instance).purity);
    }
    // Strictly increasing
    for (let i = 1; i < purities.length; i++) {
      expect(purities[i]!).toBeGreaterThan(purities[i - 1]!);
    }
    // L1 = 0.92, L5 = 0.92 + 0.0175 × 4 = 0.99
    expect(purities[0]!).toBeCloseTo(0.92, 5);
    expect(purities[4]!).toBeCloseTo(0.99, 5);
  });

  test('L3: purity = 0.955, yieldMult = 1.04 (per spec §7 T5.3)', () => {
    const instance = makeProcessorInstance('specialized', 3, 'metal_smelting', ['smelt_fe']);
    const result = calculateProcessorOutputMultiplier(processor, instance);
    expect(result.purity).toBeCloseTo(0.955, 5);
    expect(result.yieldMult).toBeCloseTo(1.04, 5);
  });
});

// ─── T5.4 — specializeBuilding: universal → specialized ────────────────

describe('Block 05 T5.4 — specializeBuilding (universal → specialized)', () => {
  let eventLog: Array<{ type: string; payload: unknown }> = [];
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    eventLog = [];
    unsub = gameBus.on('economy:building-specialized', (p) => {
      eventLog.push({ type: 'economy:building-specialized', payload: p });
    });
  });

  afterEach(() => {
    if (unsub) unsub();
    unsub = null;
  });

  test('Successful specialize → hex mutated, cost spent, event emitted', () => {
    const planet = makePlanet();
    // Place a level-3 processor on hex 0; give enough resources for specializeCost.
    planet.hexes = [makeHex('processor', 3)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 }; // specializeCost = {Fe:10,Si:5,Cu:3}

    const result = specializeBuilding(planet, 0, 'metal_smelting');
    expect(result.success).toBe(true);

    const hex = planet.hexes[0]!;
    expect(hex.processorType).toBe('specialized');
    expect(hex.specialization).toBe('metal_smelting');
    expect(hex.specializationLevel).toBe(1);

    // Cost spent: Fe 100-10=90, Si 100-5=95, Cu 100-3=97
    expect(planet.resources.Fe).toBe(90);
    expect(planet.resources.Si).toBe(95);
    expect(planet.resources.Cu).toBe(97);

    // Event emitted
    const ev = eventLog.find((e) => e.type === 'economy:building-specialized');
    expect(ev).toBeDefined();
    const payload = ev!.payload as { specialization: string; specializationLevel: number };
    expect(payload.specialization).toBe('metal_smelting');
    expect(payload.specializationLevel).toBe(1);
  });

  test('Cannot specialize twice to same category → already-specialized-this-category', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 3)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    specializeBuilding(planet, 0, 'metal_smelting');
    const second = specializeBuilding(planet, 0, 'metal_smelting');
    expect(second.success).toBe(false);
    expect(second.reason).toBe('already-specialized-this-category');
  });
});

// ─── T5.5 — Failure modes ───────────────────────────────────────────────

describe('Block 05 T5.5 — Failure modes', () => {
  test('processor level 2 → level-too-low (requires ≥ 3)', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 2)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = specializeBuilding(planet, 0, 'metal_smelting');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('level-too-low');
  });

  test('processor level 4 + deep_ore_smelting (requires 5+) → category-level-too-low', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 4)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = specializeBuilding(planet, 0, 'deep_ore_smelting');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('category-level-too-low');
  });

  test('refinery (already specialized form) → already-specialized-form', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('refinery', 5)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = specializeBuilding(planet, 0, 'metal_smelting');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('already-specialized-form');
  });

  test('synthesizer (already specialized form) → already-specialized-form', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('synthesizer', 5)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = specializeBuilding(planet, 0, 'alloy_synthesis');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('already-specialized-form');
  });

  test('mine (not a processor) → not-processor', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('mine', 5)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = specializeBuilding(planet, 0, 'metal_smelting');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not-processor');
  });

  test('processor level 3 + insufficient resources → cannot-afford', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 3)];
    planet.resources = { Fe: 5, Si: 100, Cu: 100 }; // Fe < 10

    const result = specializeBuilding(planet, 0, 'metal_smelting');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('cannot-afford');
  });
});

// ─── T5.6 — Electronic silicon purity ───────────────────────────────────

describe('Block 05 T5.6 — Electronic silicon purity', () => {
  const processor = BUILDING_MAP.get('processor')!;

  test('Universal smelt_si → Si purity 0.78 (technical; below 0.9 threshold)', () => {
    const universal = makeProcessorInstance('universal', 0, undefined, ['smelt_si']);
    const { purity } = calculateProcessorOutputMultiplier(processor, universal);
    expect(purity).toBeLessThan(0.9);
    expect(purity).toBeCloseTo(0.78, 5);
  });

  test('Specialized nonmetal_smelting L3 → Si purity 0.955 (above 0.9 threshold)', () => {
    const specialized = makeProcessorInstance('specialized', 3, 'nonmetal_smelting', ['smelt_si']);
    const { purity } = calculateProcessorOutputMultiplier(processor, specialized);
    expect(purity).toBeGreaterThanOrEqual(0.9);
    expect(purity).toBeCloseTo(0.955, 5);
  });

  test('Purity threshold filter: universal does NOT pass ≥0.9, specialized does', () => {
    const universalPurity = calculateProcessorOutputMultiplier(
      processor,
      makeProcessorInstance('universal', 0, undefined, ['smelt_si']),
    ).purity;
    const specializedPurity = calculateProcessorOutputMultiplier(
      processor,
      makeProcessorInstance('specialized', 3, 'nonmetal_smelting', ['smelt_si']),
    ).purity;
    expect(universalPurity >= 0.9).toBe(false);
    expect(specializedPurity >= 0.9).toBe(true);
  });
});

// ─── T5.7 — Reverse upgrade: universal → specialized → universal ───────

describe('Block 05 T5.7 — Reverse upgrade (universal → specialized → universal)', () => {
  test('Revert to universal: 50% refund, fields cleared', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 3)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    // Step 1: specialize → cost spent (Fe 100→90, Si 100→95, Cu 100→97)
    const r1 = specializeBuilding(planet, 0, 'metal_smelting');
    expect(r1.success).toBe(true);

    // Step 2: revert → 50% refund (Fe 90+5=95, Si 95+2=97, Cu 97+1=98)
    const r2 = specializeBuilding(planet, 0, 'universal');
    expect(r2.success).toBe(true);

    const hex = planet.hexes[0]!;
    expect(hex.processorType).toBe('universal');
    expect(hex.specialization).toBeUndefined();
    expect(hex.specializationLevel).toBe(0);

    // Refund amounts (Math.floor of 50%):
    // Fe: Math.floor(10 × 0.5) = 5 → 90 + 5 = 95
    // Si: Math.floor(5 × 0.5) = 2 → 95 + 2 = 97
    // Cu: Math.floor(3 × 0.5) = 1 → 97 + 1 = 98
    expect(planet.resources.Fe).toBe(95);
    expect(planet.resources.Si).toBe(97);
    expect(planet.resources.Cu).toBe(98);
  });

  test('Cannot revert if not specialized → not-specialized', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 3)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    // Try revert without prior specialize
    const result = specializeBuilding(planet, 0, 'universal');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not-specialized');
  });

  test('Cannot revert refinery (already specialized form) → already-specialized-form', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('refinery', 5)];
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = specializeBuilding(planet, 0, 'universal');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('already-specialized-form');
  });
});

// ─── T5.8 — Recipe categories validation ────────────────────────────────

describe('Block 05 T5.8 — Recipe categories validation', () => {
  test('Every processor/refinery/synthesizer recipe has a valid processorCategory', () => {
    const processorBuildings = new Set(['processor', 'refinery', 'synthesizer']);
    const processorRecipes = RECIPES.filter(r => processorBuildings.has(r.buildingId));
    expect(processorRecipes.length).toBeGreaterThan(0);

    for (const recipe of processorRecipes) {
      // Recipe should have processorCategory defined (post-processing in recipes.ts)
      expect(
        recipe.processorCategory,
        `Recipe ${recipe.id} (buildingId: ${recipe.buildingId}) has no processorCategory`,
      ).toBeDefined();

      // Category must exist in PROCESSOR_CATEGORIES
      const cat = recipe.processorCategory!;
      expect(
        PROCESSOR_CATEGORIES.has(cat),
        `Recipe ${recipe.id} has unknown category ${cat}`,
      ).toBe(true);
    }
  });

  test('Shipyard recipes do NOT have processorCategory (they are not processors)', () => {
    const shipyardRecipes = RECIPES.filter(r => r.buildingId === 'shipyard');
    expect(shipyardRecipes.length).toBeGreaterThan(0);
    for (const recipe of shipyardRecipes) {
      expect(
        recipe.processorCategory,
        `Shipyard recipe ${recipe.id} should not have processorCategory`,
      ).toBeUndefined();
    }
  });

  test('resolveProcessorCategory matches recipe.processorCategory for all processor recipes', () => {
    const processorBuildings = new Set(['processor', 'refinery', 'synthesizer']);
    for (const recipe of RECIPES) {
      const resolved = resolveProcessorCategory(recipe.id, recipe.buildingId);
      if (processorBuildings.has(recipe.buildingId)) {
        expect(resolved, `Recipe ${recipe.id} should resolve to a category`).toBeDefined();
        expect(resolved!.category).toBe(recipe.processorCategory!);
      } else {
        expect(resolved, `Non-processor recipe ${recipe.id} should NOT resolve`).toBeUndefined();
      }
    }
  });

  test('deep_ore_smelting recipes have minSpecializationLevel=5', () => {
    const deepOreRecipes = RECIPES.filter(r => r.processorCategory === 'deep_ore_smelting');
    expect(deepOreRecipes.length).toBeGreaterThan(0);
    for (const recipe of deepOreRecipes) {
      expect(
        recipe.minSpecializationLevel,
        `Deep ore recipe ${recipe.id} should require spec level 5`,
      ).toBe(5);
    }
  });

  test('refine_* recipes have minSpecializationLevel=5 (in refinery)', () => {
    const refineRecipes = RECIPES.filter(r => r.id.startsWith('refine_'));
    expect(refineRecipes.length).toBe(3); // refine_au, refine_pt, refine_u
    for (const recipe of refineRecipes) {
      expect(recipe.minSpecializationLevel).toBe(5);
      expect(recipe.processorCategory).toBe('metal_smelting');
    }
  });
});

// ─── upgradeSpecialization (extra, not in spec but needed) ─────────────

describe('Block 05 — upgradeSpecialization (1→5)', () => {
  let eventLog: Array<{ type: string; payload: unknown }> = [];
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    eventLog = [];
    unsub = gameBus.on('economy:specialization-upgraded', (p) => {
      eventLog.push({ type: 'economy:specialization-upgraded', payload: p });
    });
  });

  afterEach(() => {
    if (unsub) unsub();
    unsub = null;
  });

  test('L1 → L2: specializationLevel rises, cost spent, event emitted', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 5)];
    planet.hexes[0]!.processorType = 'specialized';
    planet.hexes[0]!.specialization = 'metal_smelting';
    planet.hexes[0]!.specializationLevel = 1;
    // upgradeSpecializationCost = {Fe:5,Si:3,Cu:2} × currentLevel=1 → {Fe:5,Si:3,Cu:2}
    planet.resources = { Fe: 100, Si: 100, Cu: 100 };

    const result = upgradeSpecialization(planet, 0);
    expect(result.success).toBe(true);

    expect(planet.hexes[0]!.specializationLevel).toBe(2);
    expect(planet.resources.Fe).toBe(95);
    expect(planet.resources.Si).toBe(97);
    expect(planet.resources.Cu).toBe(98);

    const ev = eventLog.find((e) => e.type === 'economy:specialization-upgraded');
    expect(ev).toBeDefined();
    const payload = ev!.payload as { specializationLevel: number };
    expect(payload.specializationLevel).toBe(2);
  });

  test('L5 → max-level refused', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 5)];
    planet.hexes[0]!.processorType = 'specialized';
    planet.hexes[0]!.specialization = 'metal_smelting';
    planet.hexes[0]!.specializationLevel = 5;
    planet.resources = { Fe: 1000, Si: 1000, Cu: 1000 };

    const result = upgradeSpecialization(planet, 0);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('max-level');
  });

  test('Universal (not specialized) → not-specialized', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 5)];
    planet.hexes[0]!.processorType = 'universal';
    planet.resources = { Fe: 1000, Si: 1000, Cu: 1000 };

    const result = upgradeSpecialization(planet, 0);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('not-specialized');
  });

  test('Cannot afford upgrade → cannot-afford', () => {
    const planet = makePlanet();
    planet.hexes = [makeHex('processor', 5)];
    planet.hexes[0]!.processorType = 'specialized';
    planet.hexes[0]!.specialization = 'metal_smelting';
    planet.hexes[0]!.specializationLevel = 3; // cost = upgradeCost × 3 = {Fe:15,Si:9,Cu:6}
    planet.resources = { Fe: 10, Si: 100, Cu: 100 }; // Fe < 15

    const result = upgradeSpecialization(planet, 0);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('cannot-afford');
  });
});
