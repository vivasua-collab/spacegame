/// <reference types="bun-types" />
/**
 * Block 01 — T4 Chemistry-generator test.
 *
 * Verifies molar mass calculations, ore yields, and recipe consistency.
 *
 * Tests (matches T4 spec from `08_27_block_01_stabilization.md` §4):
 *   1. getElementAtomicMass('Fe') === 55.8 (per elements.ts).
 *   2. calculateMolarMass(Fe₂O₃) = 2×55.8 + 3×16 = 159.6.
 *   3. calculateYieldsFromFormula for Fe-ore → { Fe: 7.0, O: 3.0 }
 *      (matches recipes.ts 'smelt_fe' outputs).
 *   4. bakeGalaxyModel generates valid BakedGalaxyModel (ores, atmospherics, ice).
 *   5. Recipe consistency (P1): for each 'process_*' or 'smelt_*' recipe using
 *      an ore ID, the ore exists in BakedGalaxyModel.ores.
 *
 * Run: bun test tests/chemistry.test.ts
 */

import { test, expect, describe, beforeAll } from 'bun:test';
import { bakeGalaxyModel, getElementAtomicMass } from '@/data/chemistry-generator';
import {
  calculateMolarMass,
  calculateYieldsFromFormula,
} from '@/data/chemistry/ore-generator';
import { ORE_SPECS } from '@/data/chemistry/ore-specs';
import type { FormulaComponent } from '@/data/chemistry/baked-types';
import { setCurrentLookups, getCurrentLookups } from '@/data/baked-lookups';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { RECIPES } from '@/data/recipes';
import type { ElementDef } from '@/core/types';

let bakedModel: ReturnType<typeof bakeGalaxyModel>;
let massMap: Map<string, number>;

beforeAll(() => {
  bakedModel = bakeGalaxyModel(42, ELEMENTS);
  setCurrentLookups(bakedModel);
  massMap = new Map<string, number>();
  for (const e of ELEMENTS) {
    massMap.set(e.id, e.atomicMass);
  }
});

describe('Block 01 T4: Chemistry-generator — molar masses, yields, consistency', () => {
  test('1. getElementAtomicMass returns correct value for Fe', () => {
    // Per elements.ts: Fe atomicMass = 55.8
    expect(getElementAtomicMass('Fe')).toBe(55.8);
    expect(getElementAtomicMass('O')).toBe(16);
    expect(getElementAtomicMass('Si')).toBe(28.1);
    // Unknown element returns 0
    expect(getElementAtomicMass('XX')).toBe(0);
  });

  test('2. calculateMolarMass for Fe₂O₃ = 2×55.8 + 3×16 = 159.6', () => {
    const fe2o3: FormulaComponent[] = [
      { elementId: 'Fe', count: 2 },
      { elementId: 'O', count: 3 },
    ];
    const m = calculateMolarMass(fe2o3, massMap);
    // 2×55.8 + 3×16 = 111.6 + 48 = 159.6
    expect(m).toBeCloseTo(159.6, 2);
  });

  test('3. calculateYieldsFromFormula for Fe-ore → { Fe: 7.0, O: 3.0 }', () => {
    // ORE_SPECS.Fe.formula = Fe₂O₃ (hematite)
    const feSpec = ORE_SPECS.Fe;
    expect(feSpec).toBeDefined();
    expect(feSpec.formula).toBeDefined();
    const yields = calculateYieldsFromFormula(feSpec.formula!, massMap);
    // calculateYieldsFromFormula returns ContainedElement[] = [{ elementId, yield }, ...]
    const feYield = yields.find(y => y.elementId === 'Fe');
    const oYield = yields.find(y => y.elementId === 'O');
    expect(feYield).toBeDefined();
    expect(oYield).toBeDefined();
    // For 10 units of Fe-ore, yields should sum to ~10 (proportional to molar mass fractions).
    // Fe fraction = 2×55.8 / 159.6 = 0.700 → 7.0
    // O fraction = 3×16 / 159.6 = 0.301 → 3.0 (rounded)
    expect(feYield!.yield).toBeCloseTo(7.0, 1);
    expect(oYield!.yield).toBeCloseTo(3.0, 1);
    // Sum should be ~10 (mass conservation)
    const sum = yields.reduce((s, y) => s + y.yield, 0);
    expect(sum).toBeGreaterThan(9.5);
    expect(sum).toBeLessThan(10.5);
  });

  test('4. bakeGalaxyModel generates valid model with ores + atmospherics + ice', () => {
    expect(bakedModel).toBeDefined();
    expect(bakedModel.elements.length).toBe(ELEMENTS.length);
    expect(bakedModel.ores.length).toBeGreaterThan(0);
    expect(bakedModel.atmosphericCompounds.length).toBeGreaterThan(0);
    expect(bakedModel.iceCompounds.length).toBeGreaterThan(0);
    expect(bakedModel.elementToOre).toBeDefined();
    // Fe-ore should be in the model (from ORE_SPECS.Fe)
    expect(bakedModel.elementToOre.Fe).toBe('Fe-ore');
  });

  test('5. Recipe consistency (P1) — all recipe inputs/outputs reference valid IDs', () => {
    // Build a set of all valid resource IDs from baked model + ELEMENT_MAP.
    const lookups = getCurrentLookups();
    const validIds = new Set<string>();
    for (const oreId of lookups.oreMap.keys()) validIds.add(oreId);
    for (const atmoId of lookups.atmosphericMap.keys()) validIds.add(atmoId);
    for (const iceId of lookups.iceMap.keys()) validIds.add(iceId);
    for (const elementId of ELEMENT_MAP.keys()) validIds.add(elementId);
    // Crafted materials (steel, microchip, etc.) — add manually
    const craftedIds = [
      'steel', 'microchip', 'superconductor', 'titanium_alloy', 'silicon_crystal',
      'sensor_array', 'shield_generator', 'engine_section', 'ion_engine',
      'laser', 'cargo_bay', 'scanner', 'plastic', 'synfuel', 'hull_element', 'armor_plate',
    ];
    for (const id of craftedIds) validIds.add(id);

    // Check all recipes
    let invalidCount = 0;
    for (const recipe of RECIPES) {
      for (const inputId of Object.keys(recipe.inputs)) {
        if (!validIds.has(inputId)) {
          console.error(`Recipe ${recipe.id}: input '${inputId}' not in validIds`);
          invalidCount++;
        }
      }
      for (const outputId of Object.keys(recipe.outputs)) {
        if (!validIds.has(outputId)) {
          console.error(`Recipe ${recipe.id}: output '${outputId}' not in validIds`);
          invalidCount++;
        }
      }
    }
    expect(invalidCount).toBe(0);
  });

  test('6. ORE_SPECS — for each entry, formula/containedElements and sourceBuildingId are valid', () => {
    const validSourceBuildings = new Set(['mine', 'quarry', 'drilling_rig', 'gas_extractor']);
    let invalidCount = 0;
    for (const [elementId, spec] of Object.entries(ORE_SPECS)) {
      // Some ORE_SPECS entries are for native elements (Au, Pt, C, S) which have
      // formula: null — they are pure elements, no compound formula. Skip these.
      // Others (like 'O-rock' — silicate rocks) use `containedElements` instead of `formula`.
      const hasFormula = spec.formula && spec.formula.length > 0;
      const hasContainedElements = (spec as any).containedElements && (spec as any).containedElements.length > 0;
      if (!hasFormula && !hasContainedElements) {
        // Verify it's a native element — should be in ELEMENT_MAP (pure element).
        if (!ELEMENT_MAP.has(elementId)) {
          console.error(`ORE_SPECS.${elementId}: no formula/containedElements AND not in ELEMENT_MAP`);
          invalidCount++;
        }
        continue;
      }
      if (!validSourceBuildings.has(spec.sourceBuildingId)) {
        console.error(`ORE_SPECS.${elementId}: unknown sourceBuildingId '${spec.sourceBuildingId}'`);
        invalidCount++;
      }
      // Formula elements must exist in ELEMENT_MAP
      if (hasFormula) {
        for (const fc of spec.formula!) {
          if (!ELEMENT_MAP.has(fc.elementId)) {
            console.error(`ORE_SPECS.${elementId}: formula references unknown element '${fc.elementId}'`);
            invalidCount++;
          }
        }
      }
      // containedElements elements must exist in ELEMENT_MAP
      if (hasContainedElements) {
        for (const ce of (spec as any).containedElements) {
          if (!ELEMENT_MAP.has(ce.elementId)) {
            console.error(`ORE_SPECS.${elementId}: containedElements references unknown element '${ce.elementId}'`);
            invalidCount++;
          }
        }
      }
    }
    expect(invalidCount).toBe(0);
  });
});
