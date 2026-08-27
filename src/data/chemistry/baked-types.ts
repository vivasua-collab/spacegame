/**
 * Baked Model Types — interfaces for the immutable BakedGalaxyModel.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * @see docs/galaxy-bake.md §5 — baked model schema
 * @see docs/chemistry.md   — rules for chemical interactions and ore generation
 */

import type { ElementDef, ChemicalCharacter, ElementRarity, AtmosphereType } from '@/core/types';
import type {
  OreType,
  SourceBuildingId,
  ProcessingBuildingId,
  ContainedElement,
} from '@/data/processing-chains';

// ============================================================================
// Baked Model Types (docs/galaxy-bake.md §5)
// ============================================================================

/** Baked galaxy model — immutable after generation. */
export interface BakedGalaxyModel {
  /** Algorithm version (for migration). */
  version: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Galaxy seed. */
  seed: number;
  /** Element snapshot at generation time. */
  elements: BakedElement[];
  /** Generated ores (mine + quarry + deep). */
  ores: BakedOre[];
  /** Atmospheric compounds. */
  atmosphericCompounds: BakedAtmospheric[];
  /** Ice compounds. */
  iceCompounds: BakedIce[];
  /** Processing chains (element → ore → processing). */
  processingChains: BakedProcessingChain[];
  /** Native element chances (elementId → 0–1). */
  nativeChances: Record<string, number>;
  /** Element → primary ore ID mapping. */
  elementToOre: Record<string, string>;
  /** Element → all sources (ore + atmospheric + ice). */
  elementSources: Record<string, BakedElementSource>;
}

/** Element snapshot at generation time. */
export interface BakedElement {
  id: string;
  name: string;
  symbol: string;
  category: string;
  atomicNumber: number;
  atomicMass: number;
  chemicalCharacter: ChemicalCharacter;
  oxidationState: number;
  rarity: ElementRarity;
  baseValue: number;
  density: number;
  isAtmospheric: boolean;
}

/** Baked ore definition. */
export interface BakedOre {
  id: string;
  name: string;
  type: OreType;
  sourceBuildingId: SourceBuildingId;
  containedElements: ContainedElement[];
  minSourceLevel: number;
  processingBuildingId: ProcessingBuildingId;
  minProcessingLevel: number | null;
  processingEnergyCost: number;
  processingTime: number;
  prototype: string;
  molarFormula: string;
  molarMass: number;
  /** Element for which this ore is the primary source. */
  primaryElement: string;
  /** Chemical character of the primary element. */
  chemicalCharacter: ChemicalCharacter;
}

/** Baked atmospheric compound. */
export interface BakedAtmospheric {
  id: string;
  name: string;
  formula: string;
  containedElements: ContainedElement[];
  atmosphereTypes: AtmosphereType[];
  processingBuildingId: ProcessingBuildingId;
  minProcessingLevel: number | null;
  processingEnergyCost: number;
  processingTime: number;
}

/** Baked ice compound. */
export interface BakedIce {
  id: string;
  name: string;
  formula: string;
  containedElements: ContainedElement[];
  maxTemp: number;
  processingBuildingId: ProcessingBuildingId;
  minProcessingLevel: number | null;
  processingEnergyCost: number;
  processingTime: number;
}

/** Baked processing chain (element → steps). */
export interface BakedProcessingChain {
  elementId: string;
  steps: BakedProcessingStep[];
}

/** Single step in a processing chain. */
export interface BakedProcessingStep {
  resourceId: string;
  resourceName: string;
  buildingId: ProcessingBuildingId;
  minBuildingLevel: number | null;
  energyCost: number;
}

/** Element source summary. */
export interface BakedElementSource {
  elementId: string;
  primaryOreId: string;
  primarySourceBuilding: SourceBuildingId;
  alternativeOreIds: string[];
  atmosphericIds: string[];
  iceIds: string[];
  nativeChance: number;
}

// ============================================================================
// Internal Types (shared across chemistry modules)
// ============================================================================

/** A component in a chemical formula (element + stoichiometric count). */
export interface FormulaComponent {
  elementId: string;
  count: number;
}

/** Complete specification for generating an ore. */
export interface OreSpec {
  /** Ore ID (e.g. 'Fe-ore', 'NaCl'). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Ore type. */
  oreType: OreType;
  /** Source building. */
  sourceBuildingId: SourceBuildingId;
  /** Chemical formula components (null = use hardcoded containedElements). */
  formula: FormulaComponent[] | null;
  /** Hardcoded contained elements (for special ores like Au, Pt, C, S). */
  containedElements?: ContainedElement[];
  /** Min source building level. */
  minSourceLevel: number;
  /** Processing building. */
  processingBuildingId: ProcessingBuildingId;
  /** Min processing building level. */
  minProcessingLevel: number | null;
  /** Energy cost per unit. */
  processingEnergyCost: number;
  /** Processing time in ticks. */
  processingTime: number;
  /** Real mineral prototype name. */
  prototype: string;
  /** Molar formula string for display. */
  molarFormula: string;
}

// ============================================================================
// Shared Constants
// ============================================================================

/** Version of the baking algorithm — bump when output format changes. */
export const BAKE_VERSION = 1;

// Re-export ElementDef for downstream convenience (used by ore-generator.ts).
export type { ElementDef };
