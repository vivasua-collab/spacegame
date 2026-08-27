/**
 * Galaxy Bake — the main `bakeGalaxyModel` orchestrator.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * Takes a list of elements with their chemical properties and auto-generates
 * all ores, atmospheric compounds, ice compounds, processing chains, and
 * native element chances. The result is a `BakedGalaxyModel` — an immutable
 * snapshot that defines the chemistry of a galaxy for its entire lifetime.
 *
 * The function is **pure** (no side effects) and **deterministic** for the same
 * seed and element list.
 *
 * @see docs/galaxy-bake.md — concept document
 * @see docs/chemistry.md  — rules for chemical interactions and ore generation
 */

import type {
  BakedGalaxyModel,
  BakedElement,
  BakedOre,
  BakedAtmospheric,
  BakedIce,
  BakedProcessingChain,
  BakedProcessingStep,
  BakedElementSource,
  OreSpec,
} from './baked-types';
import { BAKE_VERSION } from './baked-types';
import {
  ORE_SPECS,
  SPECIAL_ORE_SPECS,
  ELEMENT_TO_SPEC_KEY,
  ELEMENTS_WITH_QUARRY_ALT,
  REFINERY_ALTERNATIVES,
} from './ore-specs';
import {
  bakeOreFromSpec,
  getDefaultFormula,
  getDefaultBuildingAndType,
  getDefaultProcessingParams,
  calculateNativeChance,
  calculateMolarMass,
  calculateYieldsFromFormula,
  buildMolarFormulaString,
  buildDefaultPrototype,
} from './ore-generator';
import { generateAtmosphericCompounds } from './atmospheric-generator';
import { generateIceCompounds } from './ice-generator';
import { ELEMENT_MAP } from '@/data/elements';
import { GAS_ELEMENT_TO_ATMO_ID } from '@/data/atmosphere-gases';
import type { ElementDef } from '@/core/types';
import type { SourceBuildingId } from '@/data/processing-chains';

/**
 * Bake a galaxy model from a list of elements.
 *
 * This is the core of the "galaxy baking" system. It takes elements with their
 * chemical properties and auto-generates all ores, atmospheric compounds, ice
 * compounds, and processing chains. The result is an immutable snapshot that
 * defines the chemistry of a galaxy for its entire lifetime.
 *
 * The function is **pure** (no side effects) and **deterministic** for the same
 * seed and element list.
 *
 * @param seed - Galaxy seed (stored for reference; does not affect chemistry)
 * @param elements - Complete list of elements to bake
 * @returns A fully populated BakedGalaxyModel
 *
 * @example
 * ```ts
 * import { ELEMENTS } from '@/data/elements';
 * const model = bakeGalaxyModel(12345, ELEMENTS);
 * console.log(model.ores.length); // ~50+ ores
 * console.log(model.elementToOre['Fe']); // 'Fe-ore'
 * ```
 */
export function bakeGalaxyModel(seed: number, elements: ElementDef[]): BakedGalaxyModel {
  // ── Step 0: Build mass lookup from elements ─────────────────────────
  const massMap = new Map<string, number>();
  const elementByName = new Map<string, ElementDef>();
  for (const e of elements) {
    massMap.set(e.id, e.atomicMass);
    elementByName.set(e.id, e);
  }

  // ── Step 1: Snapshot elements ───────────────────────────────────────
  const bakedElements: BakedElement[] = elements.map(e => ({
    id: e.id,
    name: e.name,
    symbol: e.symbol,
    category: e.category,
    atomicNumber: e.atomicNumber,
    atomicMass: e.atomicMass,
    chemicalCharacter: e.chemicalCharacter,
    oxidationState: e.oxidationState,
    rarity: e.rarity,
    baseValue: e.baseValue,
    density: e.density,
    isAtmospheric: e.isAtmospheric,
  }));

  // ── Step 2: Generate ores ───────────────────────────────────────────
  const ores: BakedOre[] = [];
  const elementToOre: Record<string, string> = {};
  const elementToAltOres: Record<string, string[]> = {};

  // Generate primary ores for each non-gas, non-transuranic element
  const addedOreIds = new Set<string>();

  for (const element of elements) {
    if (element.chemicalCharacter === 'gas' || element.chemicalCharacter === 'transuranic') {
      continue;
    }

    const specKey = ELEMENT_TO_SPEC_KEY[element.id];

    if (specKey && ORE_SPECS[specKey]) {
      // Known element — use the spec table
      const spec = ORE_SPECS[specKey];
      elementToOre[element.id] = spec.id;
      // Skip if this ore was already added (e.g., NaCl serves both Na and Cl)
      if (addedOreIds.has(spec.id)) continue;
      addedOreIds.add(spec.id);
      ores.push(bakeOreFromSpec(spec, element.id, element.chemicalCharacter, massMap));
    } else {
      // Unknown element — auto-generate from rules
      const formula = getDefaultFormula(element);
      const { building, oreType } = getDefaultBuildingAndType(element);
      const params = getDefaultProcessingParams(element);

      if (!formula) {
        // Cannot generate ore — skip
        continue;
      }

      const molarFormulaStr = buildMolarFormulaString(formula);
      const oreId = `${element.id}-ore`;
      const prototype = buildDefaultPrototype(element, molarFormulaStr);

      const spec: OreSpec = {
        id: oreId,
        name: `${element.name} руда`,
        oreType,
        sourceBuildingId: building,
        formula,
        minSourceLevel: params.minSourceLevel,
        processingBuildingId: 'processor',
        minProcessingLevel: params.minProcessingLevel,
        processingEnergyCost: params.processingEnergyCost,
        processingTime: params.processingTime,
        prototype,
        molarFormula: molarFormulaStr,
      };

      ores.push(bakeOreFromSpec(spec, element.id, element.chemicalCharacter, massMap));
      elementToOre[element.id] = oreId;
    }

    elementToAltOres[element.id] = [];
  }

  // ── Step 2b: Add additional ores (Ba-quarry, O-rock, refinery alts) ─
  for (const elementId of ELEMENTS_WITH_QUARRY_ALT) {
    const quarrySpecKey = `${elementId}-quarry`;
    const quarrySpec = ORE_SPECS[quarrySpecKey];
    if (quarrySpec) {
      const element = elementByName.get(elementId);
      ores.push(bakeOreFromSpec(quarrySpec, elementId, element?.chemicalCharacter ?? 'alkaline_earth', massMap));
      if (elementToAltOres[elementId]) {
        elementToAltOres[elementId].push(quarrySpec.id);
      }
    }
  }

  // Add special ores not tied to any element
  for (const spec of SPECIAL_ORE_SPECS) {
    const contained = spec.containedElements ?? (spec.formula ? calculateYieldsFromFormula(spec.formula, massMap) : []);
    const molarMass = spec.formula ? calculateMolarMass(spec.formula, massMap) : 0;
    ores.push({
      id: spec.id,
      name: spec.name,
      type: spec.oreType,
      sourceBuildingId: spec.sourceBuildingId,
      containedElements: contained,
      minSourceLevel: spec.minSourceLevel,
      processingBuildingId: spec.processingBuildingId,
      minProcessingLevel: spec.minProcessingLevel,
      processingEnergyCost: spec.processingEnergyCost,
      processingTime: spec.processingTime,
      prototype: spec.prototype,
      molarFormula: spec.molarFormula,
      molarMass,
      primaryElement: '__compound__',
      chemicalCharacter: 'reactive_nonmetal',
    });
  }

  // Refinery alternatives for Au, Pt, U
  for (const [elementId, alt] of Object.entries(REFINERY_ALTERNATIVES)) {
    const element = elementByName.get(elementId);
    ores.push({
      id: alt.id,
      name: alt.name,
      type: 'metal_ore',
      sourceBuildingId: elementToOre[elementId] ? 'mine' : 'drilling_rig',
      containedElements: alt.containedElements,
      minSourceLevel: 1,
      processingBuildingId: 'refinery',
      minProcessingLevel: alt.minProcessingLevel,
      processingEnergyCost: alt.processingEnergyCost,
      processingTime: alt.processingTime,
      prototype: alt.prototype,
      molarFormula: '',
      molarMass: 0,
      primaryElement: elementId,
      chemicalCharacter: element?.chemicalCharacter ?? 'noble_metal',
    });
    if (elementToAltOres[elementId]) {
      elementToAltOres[elementId].push(alt.id);
    }
  }

  // ── Step 3: Atmospheric compounds ───────────────────────────────────
  const atmosphericCompounds = generateAtmosphericCompounds(massMap);

  // Map gas elements to their atmospheric compound IDs.
  // (gap-3, C3 — вынесено в data/atmosphere-gases.ts как GAS_ELEMENT_TO_ATMO_ID;
  //  ранее было дублировано в engine.ts и chemistry-generator.ts.)
  const gasElementToAtmoId = GAS_ELEMENT_TO_ATMO_ID;

  // Register atmospheric compounds as primary sources for gas elements
  for (const [elemId, atmoId] of Object.entries(gasElementToAtmoId)) {
    if (!elementToOre[elemId]) {
      elementToOre[elemId] = atmoId;
    }
  }

  // ── Step 4: Ice compounds ───────────────────────────────────────────
  const iceCompounds = generateIceCompounds(massMap);

  // ── Step 5: Processing chains ───────────────────────────────────────
  const processingChains: BakedProcessingChain[] = [];

  for (const element of elements) {
    if (element.chemicalCharacter === 'transuranic') continue;

    const oreId = elementToOre[element.id];
    if (!oreId) continue;

    const steps: BakedProcessingStep[] = [];

    // Find the ore/atmospheric/ice object
    const ore = ores.find(o => o.id === oreId);
    const atmo = atmosphericCompounds.find(a => a.id === oreId);
    const ice = iceCompounds.find(i => i.id === oreId);

    // Step 0: Extraction
    const resourceName = ore?.name ?? atmo?.name ?? ice?.name ?? element.name;
    steps.push({
      resourceId: oreId,
      resourceName,
      buildingId: null,
      minBuildingLevel: null,
      energyCost: 0,
    });

    // Step 1: Processing (if needed)
    const processingBuilding = ore?.processingBuildingId ?? atmo?.processingBuildingId ?? ice?.processingBuildingId;
    if (processingBuilding) {
      steps.push({
        resourceId: element.id,
        resourceName: element.name,
        buildingId: processingBuilding,
        minBuildingLevel: ore?.minProcessingLevel ?? atmo?.minProcessingLevel ?? ice?.minProcessingLevel ?? null,
        energyCost: ore?.processingEnergyCost ?? atmo?.processingEnergyCost ?? ice?.processingEnergyCost ?? 0,
      });
    }

    processingChains.push({
      elementId: element.id,
      steps,
    });
  }

  // ── Step 6: Native chances ──────────────────────────────────────────
  const nativeChances: Record<string, number> = {};
  for (const element of elements) {
    const chance = calculateNativeChance(element);
    if (chance > 0) {
      nativeChances[element.id] = chance;
    }
  }

  // ── Step 7: Element sources ─────────────────────────────────────────
  const elementSources: Record<string, BakedElementSource> = {};

  for (const element of elements) {
    if (element.chemicalCharacter === 'transuranic') continue;

    const primaryOreId = elementToOre[element.id];
    if (!primaryOreId) continue;

    // Find primary source building
    const ore = ores.find(o => o.id === primaryOreId);
    const atmo = atmosphericCompounds.find(a => a.id === primaryOreId);
    const ice = iceCompounds.find(i => i.id === primaryOreId);

    let primarySourceBuilding: SourceBuildingId = 'mine';
    if (ore) primarySourceBuilding = ore.sourceBuildingId;
    else if (atmo) primarySourceBuilding = 'gas_extractor';
    else if (ice) primarySourceBuilding = 'ice_harvester';

    // Find alternative ores (ores that contain this element but are primary for another)
    const alternativeOreIds: string[] = [];
    for (const o of ores) {
      if (o.id === primaryOreId) continue;
      if (o.containedElements.some(ce => ce.elementId === element.id)) {
        alternativeOreIds.push(o.id);
      }
    }

    // Add element-specific alt ores
    // noUncheckedIndexedAccess: elementToAltOres[element.id] possibly undefined.
    const altOreIds = elementToAltOres[element.id];
    if (altOreIds) {
      for (const altId of altOreIds) {
        if (!alternativeOreIds.includes(altId)) {
          alternativeOreIds.push(altId);
        }
      }
    }

    // Find atmospheric compounds containing this element
    const atmosphericIds = atmosphericCompounds
      .filter(a => a.id !== primaryOreId && a.containedElements.some(ce => ce.elementId === element.id))
      .map(a => a.id);

    // If the primary source is atmospheric, include it
    if (atmo && !atmosphericIds.includes(atmo.id)) {
      atmosphericIds.unshift(atmo.id);
    }

    // Find ice compounds containing this element
    const iceIds = iceCompounds
      .filter(i => i.id !== primaryOreId && i.containedElements.some(ce => ce.elementId === element.id))
      .map(i => i.id);

    elementSources[element.id] = {
      elementId: element.id,
      primaryOreId,
      primarySourceBuilding,
      alternativeOreIds,
      atmosphericIds,
      iceIds,
      nativeChance: nativeChances[element.id] ?? 0,
    };
  }

  // ── Assemble final model ────────────────────────────────────────────
  return {
    version: BAKE_VERSION,
    createdAt: new Date().toISOString(),
    seed,
    elements: bakedElements,
    ores,
    atmosphericCompounds,
    iceCompounds,
    processingChains,
    nativeChances,
    elementToOre,
    elementSources,
  };
}

// ============================================================================
// Helper: getElementAtomicMass
// ============================================================================

/**
 * Get the atomic mass for any element by ID.
 * Uses the canonical ELEMENT_MAP from elements.ts.
 *
 * @param elementId - Element symbol (e.g. 'Fe', 'Au')
 * @returns Atomic mass in g/mol, or 0 if element is unknown
 */
export function getElementAtomicMass(elementId: string): number {
  return ELEMENT_MAP.get(elementId)?.atomicMass ?? 0;
}

