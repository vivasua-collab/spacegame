/**
 * Validator — `validateBakedModel` for BakedGalaxyModel consistency.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * Returns an array of error strings — empty if the model is valid.
 *
 * Checks:
 * - Yield sums ≈ 10 for ores with calculable formulas.
 * - All non-gas, non-transuranic elements have ores.
 * - All gas elements have atmospheric compound references.
 * - All processing chains have at least one step.
 * - No duplicate ore IDs.
 * - `elementToOre` mapping is consistent with ores/atmospherics/ices.
 * - `elementSources` exists for every mapped element.
 * - Atmospheric and ice compound yield sums.
 *
 * @see docs/galaxy-bake.md §5.2 — model validation rules
 */

import type { BakedGalaxyModel } from './baked-types';

/**
 * Validate a baked galaxy model for consistency.
 * Returns an array of error strings — empty if the model is valid.
 *
 * Checks:
 * - Yield sums ≈ 10 for ores with calculable formulas
 * - All non-gas, non-transuranic elements have ores
 * - All processing chains have at least one step
 * - No duplicate ore IDs
 * - elementToOre mapping is consistent with ores
 */
export function validateBakedModel(model: BakedGalaxyModel): string[] {
  const errors: string[] = [];

  // Check for duplicate ore IDs
  const oreIds = new Set<string>();
  for (const ore of model.ores) {
    if (oreIds.has(ore.id)) {
      errors.push(`Duplicate ore ID: ${ore.id}`);
    }
    oreIds.add(ore.id);
  }

  // Check yield sums for ores with calculable formulas
  for (const ore of model.ores) {
    const totalYield = ore.containedElements.reduce((sum, ce) => sum + ce.yield, 0);
    // Allow ±0.5 tolerance for rounding
    if (ore.molarMass > 0 && Math.abs(totalYield - 10) > 0.5) {
      errors.push(`Ore ${ore.id}: yield sum ${totalYield.toFixed(1)} ≠ 10.0 (deviation > 0.5)`);
    }
  }

  // Check that all non-gas, non-transuranic elements have ores
  for (const element of model.elements) {
    if (element.chemicalCharacter === 'gas' || element.chemicalCharacter === 'transuranic') {
      continue;
    }
    if (!model.elementToOre[element.id]) {
      errors.push(`Element ${element.id} (${element.name}) has no primary ore`);
    }
  }

  // Check that all gas elements have atmospheric compound references
  for (const element of model.elements) {
    if (element.chemicalCharacter !== 'gas') continue;
    if (!model.elementToOre[element.id]) {
      errors.push(`Gas element ${element.id} (${element.name}) has no atmospheric compound reference`);
    }
  }

  // Check processing chains
  for (const element of model.elements) {
    if (element.chemicalCharacter === 'transuranic') continue;
    const chain = model.processingChains.find(c => c.elementId === element.id);
    if (!chain && model.elementToOre[element.id]) {
      errors.push(`No processing chain for element ${element.id}`);
    }
    if (chain && chain.steps.length === 0) {
      errors.push(`Empty processing chain for element ${element.id}`);
    }
  }

  // Check elementToOre → ore ID exists
  for (const [elementId, oreId] of Object.entries(model.elementToOre)) {
    const oreExists = model.ores.some(o => o.id === oreId);
    const atmoExists = model.atmosphericCompounds.some(a => a.id === oreId);
    const iceExists = model.iceCompounds.some(i => i.id === oreId);
    if (!oreExists && !atmoExists && !iceExists) {
      errors.push(`elementToOre[${elementId}] = '${oreId}' but no ore/atmo/ice with that ID exists`);
    }
  }

  // Check element sources exist for all mapped elements
  for (const elementId of Object.keys(model.elementToOre)) {
    if (!model.elementSources[elementId]) {
      errors.push(`No elementSources entry for ${elementId}`);
    }
  }

  // Check atmospheric compound yield sums
  for (const compound of model.atmosphericCompounds) {
    const totalYield = compound.containedElements.reduce((sum, ce) => sum + ce.yield, 0);
    // Pure gases should yield 10; complex gases should yield ≈ 10
    if (compound.processingBuildingId === null) {
      if (Math.abs(totalYield - 10) > 0.01) {
        errors.push(`Pure gas ${compound.id}: yield sum ${totalYield} ≠ 10`);
      }
    } else if (Math.abs(totalYield - 10) > 0.5) {
      errors.push(`Complex gas ${compound.id}: yield sum ${totalYield.toFixed(1)} ≠ 10.0 (deviation > 0.5)`);
    }
  }

  // Check ice compound yield sums
  for (const ice of model.iceCompounds) {
    const totalYield = ice.containedElements.reduce((sum, ce) => sum + ce.yield, 0);
    if (ice.processingBuildingId === null) {
      if (Math.abs(totalYield - 10) > 0.01) {
        errors.push(`Pure ice ${ice.id}: yield sum ${totalYield} ≠ 10`);
      }
    } else if (Math.abs(totalYield - 10) > 0.5) {
      errors.push(`Complex ice ${ice.id}: yield sum ${totalYield.toFixed(1)} ≠ 10.0 (deviation > 0.5)`);
    }
  }

  return errors;
}
