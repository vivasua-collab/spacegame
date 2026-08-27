/**
 * Recipe validator — checks that all `inputs` keys in recipes.ts exist as either:
 *   - ore IDs in the current BakedGalaxyModel (any oreMap key)
 *   - atmospheric gas IDs (atmosphericMap key)
 *   - ice IDs (iceMap key)
 *   - element IDs (in ELEMENT_MAP)
 *   - crafted material IDs (in CRAFTED_MATERIALS)
 *
 * Run: `cd /home/z/spacegame-audit/spacegame && bun run scripts/validate-recipes.ts`
 *
 * (P1, gap-1 audit §2.2 — single-source-of-truth check. If a recipe references an
 * unknown resource ID, this script reports it.)
 */

import { RECIPES } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { CRAFTED_MATERIALS } from '@/data/crafted-materials';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { setCurrentLookups, getCurrentLookups, hasCurrentLookups } from '@/data/baked-lookups';
import { ELEMENTS } from '@/data/elements';

// Build a default BakedGalaxyModel from the elements list for validation.
// This simulates what would happen at game start (newGame → bakeGalaxyModel → setCurrentLookups).
const bakedModel = bakeGalaxyModel(42, ELEMENTS);
setCurrentLookups(bakedModel);
const lookups = getCurrentLookups();

if (!hasCurrentLookups()) {
  console.error('❌ BakedGalaxyModel not initialized — cannot validate recipes.');
  process.exit(1);
}

// Build a Set of all valid resource IDs.
const validResourceIds = new Set<string>();

// 1. Ore IDs
for (const oreId of lookups.oreMap.keys()) {
  validResourceIds.add(oreId);
}

// 2. Atmospheric gas IDs
for (const atmoId of lookups.atmosphericMap.keys()) {
  validResourceIds.add(atmoId);
}

// 3. Ice IDs
for (const iceId of lookups.iceMap.keys()) {
  validResourceIds.add(iceId);
}

// 4. Element IDs
for (const elementId of ELEMENT_MAP.keys()) {
  validResourceIds.add(elementId);
}

// 5. Crafted material IDs (output-only — but they can be inputs to higher-tier recipes)
for (const materialId of Object.keys(CRAFTED_MATERIALS)) {
  validResourceIds.add(materialId);
}

// Validate each recipe.
const errors: string[] = [];
const warnings: string[] = [];

for (const recipe of RECIPES) {
  // Check that buildingId exists in BUILDING_MAP (skip — too much coupling, recipes.ts uses string IDs).
  // Check that all input IDs are valid.
  for (const inputId of Object.keys(recipe.inputs)) {
    if (!validResourceIds.has(inputId)) {
      errors.push(`Recipe ${recipe.id} (buildingId: ${recipe.buildingId}): input '${inputId}' is not a valid resource ID (not in baked model, ELEMENT_MAP, or CRAFTED_MATERIALS)`);
    }
  }
  // Check that all output IDs are valid.
  for (const outputId of Object.keys(recipe.outputs)) {
    if (!validResourceIds.has(outputId)) {
      errors.push(`Recipe ${recipe.id} (buildingId: ${recipe.buildingId}): output '${outputId}' is not a valid resource ID`);
    }
  }
  // Check that recipe ID is unique (already enforced by RECIPE_MAP construction, but verify).
  // Check energyCost >= 0.
  if (recipe.energyCost < 0) {
    warnings.push(`Recipe ${recipe.id}: energyCost is negative (${recipe.energyCost})`);
  }
  // Check time > 0.
  if (recipe.time <= 0) {
    warnings.push(`Recipe ${recipe.id}: time is non-positive (${recipe.time})`);
  }
}

// Print results.
console.log('═══════════════════════════════════════════════════════════════');
console.log('  RECIPE VALIDATION REPORT (P1, gap-1 audit §2.2)');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total recipes:        ${RECIPES.length}`);
console.log(`  Valid resource IDs:  ${validResourceIds.size} (${lookups.oreMap.size} ores + ${lookups.atmosphericMap.size} atmospheric + ${lookups.iceMap.size} ice + ${ELEMENT_MAP.size} elements + ${Object.keys(CRAFTED_MATERIALS).length} crafted)`);
console.log();

if (errors.length > 0) {
  console.log(`❌ ERRORS: ${errors.length}`);
  for (const err of errors) {
    console.log(`  - ${err}`);
  }
  console.log();
}

if (warnings.length > 0) {
  console.log(`⚠️  WARNINGS: ${warnings.length}`);
  for (const warn of warnings) {
    console.log(`  - ${warn}`);
  }
  console.log();
}

if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ All recipes valid — single-source-of-truth preserved.');
  console.log('   All inputs/outputs reference valid resource IDs.');
  process.exit(0);
} else if (errors.length === 0) {
  console.log(`✅ All recipes valid (with ${warnings.length} warnings).`);
  process.exit(0);
} else {
  console.log(`❌ Validation failed with ${errors.length} errors.`);
  process.exit(1);
}
