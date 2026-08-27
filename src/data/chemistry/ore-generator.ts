/**
 * Ore Generator — helpers for producing BakedOre entries from OreSpecs.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * Contains:
 * - Math helpers: `round1`, `calculateMolarMass`, `calculateYieldsFromFormula`.
 * - Default-rule functions for elements not in ORE_SPECS:
 *   `getDefaultFormula`, `getDefaultBuildingAndType`, `getDefaultProcessingParams`.
 * - Display helpers: `buildMolarFormulaString`, `buildDefaultPrototype`.
 * - Native-chance helper: `calculateNativeChance`.
 * - The central spec → BakedOre builder: `bakeOreFromSpec`.
 *
 * @see docs/chemistry.md §4 — ore formation rules
 * @see docs/chemistry.md §7.2–7.4 — processing energy/time/level tables
 * @see docs/chemistry.md §8   — native element rules
 */

import type {
  OreSpec,
  FormulaComponent,
  BakedOre,
} from './baked-types';
import type { ElementDef } from '@/core/types';
import type { ChemicalCharacter, ElementRarity } from '@/core/types';
import type {
  OreType,
  SourceBuildingId,
  ContainedElement,
} from '@/data/processing-chains';

// ============================================================================
// Constants
// ============================================================================

/** Rarity → energy/time modifier (docs/chemistry.md §7.3). */
export const RARITY_MODIFIER: Record<ElementRarity, number> = {
  abundant: 1.0,
  common: 1.2,
  rare: 1.5,
  ultra_rare: 2.0,
};

/** Native element chances (docs/chemistry.md §8). */
export const NATIVE_CHANCE_TABLE: Record<string, number> = {
  S: 0.30,
  C: 0.20,
  Cu: 0.05,
  Ag: 0.05,
  Au: 0.10,
  Pt: 0.03,
};

/** Default native chance for noble_metal elements not in the table. */
export const DEFAULT_NOBLE_NATIVE_CHANCE = 0.05;

// ============================================================================
// Math Helpers
// ============================================================================

/** Round a number to 1 decimal place. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Calculate molar mass from formula components.
 * @param formula - Array of {elementId, count} pairs
 * @param massMap - Map of elementId → atomic mass
 * @returns Molar mass in g/mol
 */
export function calculateMolarMass(formula: FormulaComponent[], massMap: Map<string, number>): number {
  let total = 0;
  for (const comp of formula) {
    const mass = massMap.get(comp.elementId);
    if (mass === undefined) {
      throw new Error(`Unknown element in formula: ${comp.elementId}`);
    }
    total += comp.count * mass;
  }
  return round1(total);
}

/**
 * Calculate element yields from a formula using molar mass ratios.
 * Formula: yield_i = 10 × (n_i × M_i) / M(compound), rounded to 1 decimal.
 *
 * @param formula - Array of {elementId, count} pairs
 * @param massMap - Map of elementId → atomic mass
 * @returns Array of ContainedElement with calculated yields
 */
export function calculateYieldsFromFormula(
  formula: FormulaComponent[],
  massMap: Map<string, number>,
): ContainedElement[] {
  const molarMass = calculateMolarMass(formula, massMap);
  if (molarMass === 0) return [];

  const results: ContainedElement[] = [];
  for (const comp of formula) {
    const atomicMass = massMap.get(comp.elementId);
    if (atomicMass === undefined) continue;
    const yield_ = round1(10 * (comp.count * atomicMass) / molarMass);
    results.push({ elementId: comp.elementId, yield: yield_ });
  }
  return results;
}

// ============================================================================
// Default-Rule Functions (for elements not in ORE_SPECS)
// ============================================================================

/**
 * Get the default ore formula for an element based on its chemicalCharacter
 * and oxidationState. Used for elements not in the ORE_SPECS lookup table.
 *
 * @see docs/chemistry.md §4 — rules for ore formation
 */
export function getDefaultFormula(element: ElementDef): FormulaComponent[] | null {
  const { id, chemicalCharacter, oxidationState } = element;

  switch (chemicalCharacter) {
    case 'reactive_metal': {
      if (oxidationState === 1) {
        // CuFeS₂-like complex (Cu, or theoretical +1 reactive metals)
        return [{ elementId: id, count: 1 }, { elementId: 'Fe', count: 1 }, { elementId: 'S', count: 2 }];
      }
      if (oxidationState === 2) return [{ elementId: id, count: 1 }, { elementId: 'S', count: 1 }];
      if (oxidationState === 3) return [{ elementId: id, count: 2 }, { elementId: 'O', count: 3 }];
      if (oxidationState === 4) return [{ elementId: id, count: 1 }, { elementId: 'O', count: 2 }];
      if (oxidationState === 5) return [{ elementId: id, count: 2 }, { elementId: 'O', count: 5 }];
      if (oxidationState === 6) {
        // FeMeO₄ complex (like wolframite)
        return [{ elementId: 'Fe', count: 1 }, { elementId: id, count: 1 }, { elementId: 'O', count: 4 }];
      }
      return null;
    }

    case 'noble_metal': {
      if (id === 'Ag') return [{ elementId: id, count: 2 }, { elementId: 'S', count: 1 }];
      // Au and Pt are trace concentrations — must be hardcoded
      return null;
    }

    case 'refractory_metal': {
      if (oxidationState === 5) return [{ elementId: id, count: 2 }, { elementId: 'O', count: 5 }];
      if (oxidationState === 4) {
        // Default: MeSiO₄ silicate (like zircon/hafnon)
        return [{ elementId: id, count: 1 }, { elementId: 'Si', count: 1 }, { elementId: 'O', count: 4 }];
      }
      return null;
    }

    case 'platinoid': {
      if (oxidationState === 2) return [{ elementId: id, count: 1 }, { elementId: 'S', count: 1 }];
      if (oxidationState === 3) return [{ elementId: id, count: 2 }, { elementId: 'S', count: 3 }];
      if (oxidationState === 4) return [{ elementId: id, count: 1 }, { elementId: 'S', count: 2 }];
      return null;
    }

    case 'rare_earth': {
      // MePO₄ (monazite/xenotime pattern)
      return [{ elementId: id, count: 1 }, { elementId: 'P', count: 1 }, { elementId: 'O', count: 4 }];
    }

    case 'alkali': {
      if (id === 'Li') {
        // LiAlSi₂O₆ (spodumene)
        return [
          { elementId: id, count: 1 }, { elementId: 'Al', count: 1 },
          { elementId: 'Si', count: 2 }, { elementId: 'O', count: 6 },
        ];
      }
      // MeCl (halite/sylvite pattern)
      return [{ elementId: id, count: 1 }, { elementId: 'Cl', count: 1 }];
    }

    case 'alkaline_earth': {
      if (id === 'Be') {
        // Be₃Al₂Si₆O₁₈ (beryl)
        return [
          { elementId: id, count: 3 }, { elementId: 'Al', count: 2 },
          { elementId: 'Si', count: 6 }, { elementId: 'O', count: 18 },
        ];
      }
      if (id === 'Ba') {
        // BaSO₄ (barite)
        return [{ elementId: id, count: 1 }, { elementId: 'S', count: 1 }, { elementId: 'O', count: 4 }];
      }
      // MeCO₃ (carbonate) for Mg, Ca
      return [{ elementId: id, count: 1 }, { elementId: 'C', count: 1 }, { elementId: 'O', count: 3 }];
    }

    case 'reactive_nonmetal': {
      if (id === 'S') return [{ elementId: id, count: 1 }]; // native
      if (id === 'C') return null; // coal — hardcoded
      if (id === 'Si') return [{ elementId: id, count: 1 }, { elementId: 'O', count: 2 }];
      if (id === 'B') return [{ elementId: id, count: 2 }, { elementId: 'O', count: 3 }];
      if (id === 'P') {
        // Ca₃(PO₄)₂ (apatite)
        return [{ elementId: 'Ca', count: 3 }, { elementId: id, count: 2 }, { elementId: 'O', count: 8 }];
      }
      if (id === 'Se' || id === 'Te') {
        // PbSe / PbTe (selenide/telluride from mine)
        return [{ elementId: 'Pb', count: 1 }, { elementId: id, count: 1 }];
      }
      // Default for unknown reactive_nonmetal: oxide
      if (oxidationState === 3) return [{ elementId: id, count: 2 }, { elementId: 'O', count: 3 }];
      if (oxidationState === 4) return [{ elementId: id, count: 1 }, { elementId: 'O', count: 2 }];
      return null;
    }

    case 'halogen': {
      if (id === 'F') return [{ elementId: 'Ca', count: 1 }, { elementId: id, count: 2 }];
      // Cl → NaCl
      return [{ elementId: 'Na', count: 1 }, { elementId: id, count: 1 }];
    }

    default:
      return null;
  }
}

/**
 * Get the default source building and ore type for an element.
 * @see docs/chemistry.md §5 — building → ore type matrix
 */
export function getDefaultBuildingAndType(
  element: ElementDef,
): { building: SourceBuildingId; oreType: OreType } {
  const { chemicalCharacter, id } = element;

  switch (chemicalCharacter) {
    case 'reactive_metal':
      if (id === 'In') return { building: 'drilling_rig', oreType: 'deep_ore' };
      return { building: 'mine', oreType: 'metal_ore' };
    case 'noble_metal':
      return { building: 'mine', oreType: 'metal_ore' };
    case 'refractory_metal':
      return { building: 'drilling_rig', oreType: 'deep_ore' };
    case 'platinoid':
      return { building: 'drilling_rig', oreType: 'deep_ore' };
    case 'rare_earth':
      return { building: 'drilling_rig', oreType: 'deep_ore' };
    case 'alkali':
      if (id === 'Li') return { building: 'mine', oreType: 'metal_ore' };
      return { building: 'quarry', oreType: 'nonmetal_ore' };
    case 'alkaline_earth':
      if (id === 'Be') return { building: 'drilling_rig', oreType: 'deep_ore' };
      if (id === 'Ba') return { building: 'drilling_rig', oreType: 'deep_ore' }; // primary = deep
      return { building: 'quarry', oreType: 'nonmetal_ore' };
    case 'reactive_nonmetal':
      if (id === 'Se' || id === 'Te') return { building: 'mine', oreType: 'metal_ore' };
      return { building: 'quarry', oreType: 'nonmetal_ore' };
    case 'halogen':
      return { building: 'quarry', oreType: 'nonmetal_ore' };
    case 'gas':
      return { building: 'gas_extractor', oreType: 'gas_compound' };
    case 'transuranic':
      return { building: 'drilling_rig', oreType: 'deep_ore' };
  }
}

/**
 * Calculate default processing parameters for an element not in the spec table.
 * Uses base energy ranges from docs/chemistry.md §7.2 and rarity modifiers from §7.3.
 */
export function getDefaultProcessingParams(
  element: ElementDef,
): {
  minSourceLevel: number;
  minProcessingLevel: number;
  processingEnergyCost: number;
  processingTime: number;
} {
  const { chemicalCharacter, rarity } = element;
  const mod = RARITY_MODIFIER[rarity];

  // Base energy and time by character (midpoints of ranges from §7.2)
  const baseEnergyByCharacter: Record<ChemicalCharacter, number> = {
    reactive_metal: 3,
    noble_metal: 6,
    refractory_metal: 9,
    platinoid: 9,
    rare_earth: 7,
    alkali: 3,
    alkaline_earth: 3,
    reactive_nonmetal: 2,
    halogen: 3,
    gas: 3,
    transuranic: 10,
  };

  const baseTimeByCharacter: Record<ChemicalCharacter, number> = {
    reactive_metal: 200,
    noble_metal: 275,
    refractory_metal: 350,
    platinoid: 325,
    rare_earth: 325,
    alkali: 175,
    alkaline_earth: 215,
    reactive_nonmetal: 175,
    halogen: 175,
    gas: 175,
    transuranic: 400,
  };

  // Default processing levels by rarity (§6.2)
  const processingLevelByRarity: Record<ElementRarity, number> = {
    abundant: 1,
    common: 2,
    rare: 3,
    ultra_rare: 5,
  };

  // Default min source level by character (§7.4)
  const sourceLevelByCharacter: Record<ChemicalCharacter, number> = {
    reactive_metal: 1,
    noble_metal: 1,
    refractory_metal: 5,
    platinoid: 5,
    rare_earth: 5,
    alkali: 1,
    alkaline_earth: 1,
    reactive_nonmetal: 1,
    halogen: 1,
    gas: 1,
    transuranic: 1,
  };

  return {
    minSourceLevel: sourceLevelByCharacter[chemicalCharacter],
    minProcessingLevel: processingLevelByRarity[rarity],
    processingEnergyCost: Math.max(1, Math.round(baseEnergyByCharacter[chemicalCharacter] * mod)),
    processingTime: Math.round(baseTimeByCharacter[chemicalCharacter] * mod),
  };
}

/**
 * Calculate the native chance for an element.
 * @see docs/chemistry.md §8 — native element rules
 */
export function calculateNativeChance(element: ElementDef): number {
  // Check explicit table first
  const explicit = NATIVE_CHANCE_TABLE[element.id];
  if (explicit !== undefined) return explicit;

  // Default rules by character
  if (element.chemicalCharacter === 'noble_metal') {
    return DEFAULT_NOBLE_NATIVE_CHANCE;
  }

  return 0;
}

/**
 * Build a formula display string from components.
 * Example: [{Fe,2},{O,3}] → "Fe₂O₃"
 */
export function buildMolarFormulaString(formula: FormulaComponent[]): string {
  const SUBSCRIPTS: Record<number, string> = {
    1: '', 2: '₂', 3: '₃', 4: '₄', 5: '₅',
    6: '₆', 7: '₇', 8: '₈', 9: '₉', 10: '₁₀',
    11: '₁₁', 12: '₁₂', 18: '₁₈',
  };

  return formula
    .map(c => `${c.elementId}${SUBSCRIPTS[c.count] ?? String(c.count)}`)
    .join('');
}

/**
 * Build a prototype name for a default ore.
 * Uses the element symbol and formula.
 */
export function buildDefaultPrototype(element: ElementDef, molarFormula: string): string {
  return `${element.name} руда (${molarFormula})`;
}

// ============================================================================
// Ore Builder
// ============================================================================

/**
 * Produce a BakedOre from an OreSpec.
 *
 * Behavior:
 * - If `spec.formula` is provided, calculates contained elements + molar mass
 *   from the formula using molar-mass ratios.
 * - If `spec.containedElements` is hardcoded (formula === null), uses those
 *   yields directly and sets `molarMass = 0` (special multi-component ores
 *   like Au/Pt ore have no single molar mass).
 * - Otherwise yields are empty and molarMass is 0.
 *
 * @param spec            - Ore specification (from ORE_SPECS or auto-generated).
 * @param primaryElement  - Element ID for which this ore is the primary source.
 * @param character       - Chemical character of the primary element.
 * @param massMap         - Map of elementId → atomic mass (built by bakeGalaxyModel).
 */
export function bakeOreFromSpec(
  spec: OreSpec,
  primaryElement: string,
  character: ChemicalCharacter,
  massMap: Map<string, number>,
): BakedOre {
  let containedElements: ContainedElement[];
  let molarMass: number;

  if (spec.formula) {
    containedElements = calculateYieldsFromFormula(spec.formula, massMap);
    molarMass = calculateMolarMass(spec.formula, massMap);
  } else if (spec.containedElements) {
    containedElements = spec.containedElements;
    // Estimate molar mass from yields (for special ores)
    molarMass = 0;
    for (const ce of containedElements) {
      const m = massMap.get(ce.elementId) ?? 0;
      if (ce.yield > 0 && m > 0) {
        molarMass += m * (10 / ce.yield) * (ce.yield / 10);
      }
    }
    // For special ores, set molarMass to 0 since it's not a simple compound
    molarMass = 0;
  } else {
    containedElements = [];
    molarMass = 0;
  }

  return {
    id: spec.id,
    name: spec.name,
    type: spec.oreType,
    sourceBuildingId: spec.sourceBuildingId,
    containedElements,
    minSourceLevel: spec.minSourceLevel,
    processingBuildingId: spec.processingBuildingId,
    minProcessingLevel: spec.minProcessingLevel,
    processingEnergyCost: spec.processingEnergyCost,
    processingTime: spec.processingTime,
    prototype: spec.prototype,
    molarFormula: spec.molarFormula,
    molarMass,
    primaryElement,
    chemicalCharacter: character,
  };
}
