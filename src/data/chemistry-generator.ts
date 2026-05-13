/**
 * Chemistry Generator — core of the "galaxy baking" system.
 *
 * Takes a list of elements with their chemical properties and auto-generates
 * all ores, atmospheric compounds, ice compounds, processing chains, and
 * native element chances. The result is a `BakedGalaxyModel` — an immutable
 * snapshot that defines the chemistry of a galaxy for its entire lifetime.
 *
 * @see docs/galaxy-bake.md — concept document
 * @see docs/chemistry.md  — rules for chemical interactions and ore generation
 */

import type { ElementDef, ChemicalCharacter, ElementRarity, AtmosphereType } from '@/core/types';
import type {
  OreType,
  SourceBuildingId,
  ProcessingBuildingId,
  ContainedElement,
} from '@/data/processing-chains';
import { ELEMENT_MAP } from '@/data/elements';

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
// Internal Types
// ============================================================================

/** A component in a chemical formula (element + stoichiometric count). */
interface FormulaComponent {
  elementId: string;
  count: number;
}

/** Complete specification for generating an ore. */
interface OreSpec {
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
// Constants
// ============================================================================

/** Version of the baking algorithm — bump when output format changes. */
const BAKE_VERSION = 1;

/** Rarity → energy/time modifier (docs/chemistry.md §7.3). */
const RARITY_MODIFIER: Record<ElementRarity, number> = {
  abundant: 1.0,
  common: 1.2,
  rare: 1.5,
  ultra_rare: 2.0,
};

/** Native element chances (docs/chemistry.md §8). */
const NATIVE_CHANCE_TABLE: Record<string, number> = {
  S: 0.30,
  C: 0.20,
  Cu: 0.05,
  Ag: 0.05,
  Au: 0.10,
  Pt: 0.03,
};

/** Default native chance for noble_metal elements not in the table. */
const DEFAULT_NOBLE_NATIVE_CHANCE = 0.05;

/** Atmosphere type → available gas IDs (docs/chemistry.md §9.5). */
const ATMOSPHERE_TYPE_MAP: Record<AtmosphereType, string[]> = {
  none: [],
  thin: ['N2', 'CO2'],
  standard: ['Ar', 'N2', 'CO2', 'O2'],
  dense: ['H2', 'He', 'Ar', 'N2', 'CO2', 'O2'],
  toxic: ['N2', 'CO2', 'NH3', 'H2S', 'SO2'],
  inert: ['He', 'Ne', 'Ar', 'N2'],
  methane: ['H2', 'CH4', 'NH3'],
  co2: ['N2', 'CO2'],
};

// ============================================================================
// Element-Specific Ore Specifications
// ============================================================================

/**
 * Complete ore specifications for all known elements.
 * For elements not listed here, the generator falls back to default rules
 * based on chemicalCharacter + oxidationState.
 *
 * This table ensures bit-exact consistency with the manually curated
 * data in processing-chains.ts for the 57 existing elements.
 */
const ORE_SPECS: Record<string, OreSpec> = {
  // ── Mine ores (reactive_metal) ────────────────────────────────────────
  Fe: {
    id: 'Fe-ore', name: 'Железная руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Fe', count: 2 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Гематит (Fe₂O₃)', molarFormula: 'Fe₂O₃',
  },
  Ti: {
    id: 'Ti-ore', name: 'Титановая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Fe', count: 1 }, { elementId: 'Ti', count: 1 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Ильменит (FeTiO₃)', molarFormula: 'FeTiO₃',
  },
  Cu: {
    id: 'Cu-ore', name: 'Медная руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Cu', count: 1 }, { elementId: 'Fe', count: 1 }, { elementId: 'S', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Халькопирит (CuFeS₂)', molarFormula: 'CuFeS₂',
  },
  Cr: {
    id: 'Cr-ore', name: 'Хромовая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Fe', count: 1 }, { elementId: 'Cr', count: 2 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Хромит (FeCr₂O₄)', molarFormula: 'FeCr₂O₄',
  },
  V: {
    id: 'V-ore', name: 'Ванадиевая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'V', count: 2 }, { elementId: 'O', count: 5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Ванадиевый концентрат (V₂O₅)', molarFormula: 'V₂O₅',
  },
  Ni: {
    id: 'Ni-ore', name: 'Никелевая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Ni', count: 1 }, { elementId: 'Si', count: 1 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Гарниерит (NiSiO₃)', molarFormula: 'NiSiO₃',
  },
  Mn: {
    id: 'Mn-ore', name: 'Марганцевая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Mn', count: 1 }, { elementId: 'O', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Пиролюзит (MnO₂)', molarFormula: 'MnO₂',
  },
  Zn: {
    id: 'Zn-ore', name: 'Цинковая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Zn', count: 1 }, { elementId: 'S', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Сфалерит (ZnS)', molarFormula: 'ZnS',
  },
  Sn: {
    id: 'Sn-ore', name: 'Оловянная руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Sn', count: 1 }, { elementId: 'O', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
    prototype: 'Касситерит (SnO₂)', molarFormula: 'SnO₂',
  },
  Pb: {
    id: 'Pb-ore', name: 'Свинцовая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Pb', count: 1 }, { elementId: 'S', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
    prototype: 'Галенит (PbS)', molarFormula: 'PbS',
  },
  Co: {
    id: 'Co-ore', name: 'Кобальтовая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Co', count: 3 }, { elementId: 'S', count: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Линнеит (Co₃S₄)', molarFormula: 'Co₃S₄',
  },
  W: {
    id: 'W-ore', name: 'Вольфрамовая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Fe', count: 1 }, { elementId: 'W', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Вольфрамит (FeWO₄)', molarFormula: 'FeWO₄',
  },
  Mo: {
    id: 'Mo-ore', name: 'Молибденовая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Mo', count: 1 }, { elementId: 'S', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Молибденит (MoS₂)', molarFormula: 'MoS₂',
  },
  Al: {
    id: 'Al-ore', name: 'Алюминиевая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Al', count: 2 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Боксит (Al₂O₃)', molarFormula: 'Al₂O₃',
  },
  Cd: {
    id: 'Cd-ore', name: 'Кадмиевая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Cd', count: 1 }, { elementId: 'S', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Гринокит (CdS)', molarFormula: 'CdS',
  },
  U: {
    id: 'U-ore', name: 'Урановая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'U', count: 1 }, { elementId: 'O', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 8, processingTime: 350,
    prototype: 'Уранинит (UO₂)', molarFormula: 'UO₂',
  },

  // ── Mine ores (noble_metal) ───────────────────────────────────────────
  Au: {
    id: 'Au-ore', name: 'Золотая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: null,
    containedElements: [
      { elementId: 'Au', yield: 0.4 },
      { elementId: 'Si', yield: 4.5 },
      { elementId: 'O', yield: 5.1 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 6, processingTime: 250,
    prototype: 'Кварцевая жила с золотом (Au + SiO₂)', molarFormula: 'Au+SiO₂',
  },
  Ag: {
    id: 'Ag-ore', name: 'Серебряная руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Ag', count: 2 }, { elementId: 'S', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Аргентит (Ag₂S)', molarFormula: 'Ag₂S',
  },
  Pt: {
    id: 'Pt-ore', name: 'Платиновая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: null,
    containedElements: [
      { elementId: 'Pt', yield: 0.3 },
      { elementId: 'Fe', yield: 3.0 },
      { elementId: 'Ni', yield: 1.0 },
      { elementId: 'S', yield: 2.0 },
      { elementId: 'O', yield: 3.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Ультрамафиты (Pt + FeNiS)', molarFormula: 'Pt+FeNiS+O',
  },

  // ── Mine ores (alkali — Li as aluminosilicate) ────────────────────────
  Li: {
    id: 'Li-ore', name: 'Литиевая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [
      { elementId: 'Li', count: 1 }, { elementId: 'Al', count: 1 },
      { elementId: 'Si', count: 2 }, { elementId: 'O', count: 6 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 4, processingTime: 200,
    prototype: 'Сподумен (LiAlSi₂O₆)', molarFormula: 'LiAlSi₂O₆',
  },

  // ── Mine ores (reactive_nonmetal — Se as selenide) ────────────────────
  Se: {
    id: 'Se-ore', name: 'Селеновая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Pb', count: 1 }, { elementId: 'Se', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Клаусталит (PbSe)', molarFormula: 'PbSe',
  },

  // ── Quarry ores (reactive_nonmetal) ───────────────────────────────────
  Si: {
    id: 'Si-ore', name: 'Кремниевая руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Si', count: 1 }, { elementId: 'O', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кварц (SiO₂)', molarFormula: 'SiO₂',
  },
  C: {
    id: 'C-ore', name: 'Углеродная руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: null,
    containedElements: [
      { elementId: 'C', yield: 8.0 },
      { elementId: 'H', yield: 0.5 },
      { elementId: 'O', yield: 1.3 },
      { elementId: 'S', yield: 0.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 120,
    prototype: 'Каменный уголь', molarFormula: 'C+H+O+S',
  },
  S: {
    id: 'S-ore', name: 'Серная руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: null,
    containedElements: [{ elementId: 'S', yield: 9.5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 1, processingTime: 100,
    prototype: 'Самородная сера', molarFormula: 'S',
  },
  B: {
    id: 'B-ore', name: 'Борная руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'B', count: 2 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Боракс (B₂O₃)', molarFormula: 'B₂O₃',
  },
  P: {
    id: 'P-ore', name: 'Фосфорная руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Ca', count: 3 }, { elementId: 'P', count: 2 }, { elementId: 'O', count: 8 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Апатит (Ca₃(PO₄)₂)', molarFormula: 'Ca₃(PO₄)₂',
  },
  Te: {
    id: 'Te-ore', name: 'Теллуровая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Pb', count: 1 }, { elementId: 'Te', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Алтаит (PbTe)', molarFormula: 'PbTe',
  },

  // ── Quarry ores (alkali) ──────────────────────────────────────────────
  K: {
    id: 'K-ore', name: 'Калийная руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'K', count: 1 }, { elementId: 'Cl', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Сильвинит (KCl)', molarFormula: 'KCl',
  },
  Na: {
    id: 'NaCl', name: 'Поваренная соль', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Na', count: 1 }, { elementId: 'Cl', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 4, processingTime: 200,
    prototype: 'Галит (NaCl)', molarFormula: 'NaCl',
  },

  // ── Quarry ores (halogen) ─────────────────────────────────────────────
  F: {
    id: 'F-ore', name: 'Фторсодержащая руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Ca', count: 1 }, { elementId: 'F', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 200,
    prototype: 'Флюорит (CaF₂)', molarFormula: 'CaF₂',
  },

  // ── Quarry ores (alkaline_earth) ──────────────────────────────────────
  Ca: {
    id: 'CaCO3', name: 'Известняк', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Ca', count: 1 }, { elementId: 'C', count: 1 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Кальцит (CaCO₃)', molarFormula: 'CaCO₃',
  },
  Mg: {
    id: 'Mg-ore', name: 'Магнезиальная руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Mg', count: 1 }, { elementId: 'C', count: 1 }, { elementId: 'O', count: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 180,
    prototype: 'Магнезит (MgCO₃)', molarFormula: 'MgCO₃',
  },
  'Ba-quarry': {
    id: 'Ba-ore-quarry', name: 'Бариевая руда (поверхностная)', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Ba', count: 1 }, { elementId: 'S', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Барит (BaSO₄)', molarFormula: 'BaSO₄',
  },
  'O-rock': {
    id: 'O-rock', name: 'Кислородсодержащие породы', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: null,
    containedElements: [
      { elementId: 'Si', yield: 3.0 },
      { elementId: 'O', yield: 5.0 },
      { elementId: 'Al', yield: 2.0 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кислородсодержащие силикаты', molarFormula: 'SiO₂+Al₂O₃',
  },

  // ── Deep ores (drilling_rig) ──────────────────────────────────────────
  // reactive_metal exceptions
  In: {
    id: 'In-ore', name: 'Индиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'In', count: 2 }, { elementId: 'S', count: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Рожит (In₂S₃)', molarFormula: 'In₂S₃',
  },

  // rare_earth
  Y: {
    id: 'Y-ore', name: 'Иттриевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Y', count: 1 }, { elementId: 'P', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 2, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
    prototype: 'Ксенотим (YPO₄)', molarFormula: 'YPO₄',
  },
  La: {
    id: 'La-ore', name: 'Лантановая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'La', count: 1 }, { elementId: 'P', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Монацит (LaPO₄)', molarFormula: 'LaPO₄',
  },
  Ce: {
    id: 'Ce-ore', name: 'Цериевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Ce', count: 1 }, { elementId: 'P', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Монацит (CePO₄)', molarFormula: 'CePO₄',
  },
  Nd: {
    id: 'Nd-ore', name: 'Неодимовая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Nd', count: 1 }, { elementId: 'P', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Монацит (NdPO₄)', molarFormula: 'NdPO₄',
  },
  Dy: {
    id: 'Dy-ore', name: 'Диспрозиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Dy', count: 1 }, { elementId: 'P', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 9, processingTime: 350,
    prototype: 'Фергусонит (DyPO₄)', molarFormula: 'DyPO₄',
  },

  // alkaline_earth — deep
  Be: {
    id: 'Be-ore', name: 'Бериллиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [
      { elementId: 'Be', count: 3 }, { elementId: 'Al', count: 2 },
      { elementId: 'Si', count: 6 }, { elementId: 'O', count: 18 },
    ],
    minSourceLevel: 3, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
    prototype: 'Берилл (Be₃Al₂Si₆O₁₈)', molarFormula: 'Be₃Al₂Si₆O₁₈',
  },
  Ba: {
    id: 'Ba-ore', name: 'Бариевая руда (глубинная)', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Ba', count: 1 }, { elementId: 'S', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Барит (BaSO₄)', molarFormula: 'BaSO₄',
  },

  // refractory_metal
  Zr: {
    id: 'Zr-ore', name: 'Циркониевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Zr', count: 1 }, { elementId: 'Si', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 3, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Циркон (ZrSiO₄)', molarFormula: 'ZrSiO₄',
  },
  Hf: {
    id: 'Hf-ore', name: 'Гафниевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Hf', count: 1 }, { elementId: 'Si', count: 1 }, { elementId: 'O', count: 4 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Гафниевый силикат (HfSiO₄)', molarFormula: 'HfSiO₄',
  },
  Ta: {
    id: 'Ta-ore', name: 'Танталовая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Ta', count: 2 }, { elementId: 'O', count: 5 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Танталит (Ta₂O₅)', molarFormula: 'Ta₂O₅',
  },
  Nb: {
    id: 'Nb-ore', name: 'Ниобиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Nb', count: 2 }, { elementId: 'O', count: 5 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
    prototype: 'Колумбит (Nb₂O₅)', molarFormula: 'Nb₂O₅',
  },
  Re: {
    id: 'Re-ore', name: 'Рениевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Re', count: 1 }, { elementId: 'S', count: 2 }],
    minSourceLevel: 8, processingBuildingId: 'processor', minProcessingLevel: 8,
    processingEnergyCost: 12, processingTime: 400,
    prototype: 'Рениевый сульфид (ReS₂)', molarFormula: 'ReS₂',
  },

  // platinoid
  Ru: {
    id: 'Ru-ore', name: 'Рутениевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Ru', count: 1 }, { elementId: 'S', count: 2 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Рутениевый сульфид (RuS₂)', molarFormula: 'RuS₂',
  },
  Rh: {
    id: 'Rh-ore', name: 'Родиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Rh', count: 2 }, { elementId: 'S', count: 3 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 9, processingTime: 350,
    prototype: 'Родиевый сульфид (Rh₂S₃)', molarFormula: 'Rh₂S₃',
  },
  Pd: {
    id: 'Pd-ore', name: 'Палладиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Pd', count: 1 }, { elementId: 'S', count: 1 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Палладиевый сульфид (PdS)', molarFormula: 'PdS',
  },
  Ir: {
    id: 'Ir-ore', name: 'Иридиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Ir', count: 1 }, { elementId: 'S', count: 2 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 10, processingTime: 350,
    prototype: 'Иридиевый сульфид (IrS₂)', molarFormula: 'IrS₂',
  },
  Os: {
    id: 'Os-ore', name: 'Осмиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'Os', count: 1 }, { elementId: 'S', count: 2 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 10, processingTime: 350,
    prototype: 'Осмиевый сульфид (OsS₂)', molarFormula: 'OsS₂',
  },
};

/** Special ores not tied to a single element — added after element-based generation. */
const SPECIAL_ORE_SPECS: OreSpec[] = [
  {
    id: 'O-rock', name: 'Кислородсодержащие породы', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: null,
    containedElements: [
      { elementId: 'Si', yield: 3.0 },
      { elementId: 'O', yield: 5.0 },
      { elementId: 'Al', yield: 2.0 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кислородсодержащие силикаты', molarFormula: 'SiO₂+Al₂O₃',
  },
];

/**
 * Maps element IDs to their primary ore spec key in ORE_SPECS.
 * Some elements share an ore (e.g., Na and Cl both use 'NaCl').
 * Some elements have their key equal to their ID; others use a special key.
 */
const ELEMENT_TO_SPEC_KEY: Record<string, string> = {
  Fe: 'Fe', Ti: 'Ti', Cu: 'Cu', Cr: 'Cr', V: 'V', Ni: 'Ni',
  Mn: 'Mn', Zn: 'Zn', Sn: 'Sn', Pb: 'Pb', Co: 'Co', W: 'W',
  Mo: 'Mo', Al: 'Al', Cd: 'Cd', U: 'U',
  Au: 'Au', Ag: 'Ag', Pt: 'Pt',
  Li: 'Li', Se: 'Se', Te: 'Te',
  Si: 'Si', C: 'C', S: 'S', B: 'B', P: 'P',
  K: 'K', Na: 'Na', Cl: 'Na', // Cl shares NaCl with Na
  F: 'F', Ca: 'Ca', Mg: 'Mg', Ba: 'Ba', // Ba primary = deep
  Be: 'Be',
  In: 'In',
  Y: 'Y', La: 'La', Ce: 'Ce', Nd: 'Nd', Dy: 'Dy',
  Zr: 'Zr', Hf: 'Hf', Ta: 'Ta', Nb: 'Nb', Re: 'Re',
  Ru: 'Ru', Rh: 'Rh', Pd: 'Pd', Ir: 'Ir', Os: 'Os',
};

/** Elements that have a secondary (quarry) ore in addition to their primary deep ore. */
const ELEMENTS_WITH_QUARRY_ALT = new Set(['Ba']);

/** Refinery alternative processing for specific elements (docs/chemistry.md §6.3). */
const REFINERY_ALTERNATIVES: Record<string, {
  id: string;
  name: string;
  containedElements: ContainedElement[];
  minProcessingLevel: number;
  processingEnergyCost: number;
  processingTime: number;
  prototype: string;
}> = {
  Au: {
    id: 'Au-ore:refinery', name: 'Очистка золота',
    containedElements: [{ elementId: 'Au', yield: 9 }],
    minProcessingLevel: 3, processingEnergyCost: 8, processingTime: 15,
    prototype: 'Очистка из Au-ore через Очистительный комплекс',
  },
  Pt: {
    id: 'Pt-ore:refinery', name: 'Очистка платины',
    containedElements: [{ elementId: 'Pt', yield: 9 }],
    minProcessingLevel: 5, processingEnergyCost: 10, processingTime: 18,
    prototype: 'Очистка из Pt-ore через Очистительный комплекс',
  },
  U: {
    id: 'U-ore:refinery', name: 'Очистка урана',
    containedElements: [{ elementId: 'U', yield: 9 }],
    minProcessingLevel: 5, processingEnergyCost: 10, processingTime: 18,
    prototype: 'Очистка из U-ore через Очистительный комплекс',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/** Round a number to 1 decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Calculate molar mass from formula components.
 * @param formula - Array of {elementId, count} pairs
 * @param massMap - Map of elementId → atomic mass
 * @returns Molar mass in g/mol
 */
function calculateMolarMass(formula: FormulaComponent[], massMap: Map<string, number>): number {
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
function calculateYieldsFromFormula(
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

/**
 * Get the default ore formula for an element based on its chemicalCharacter
 * and oxidationState. Used for elements not in the ORE_SPECS lookup table.
 *
 * @see docs/chemistry.md §4 — rules for ore formation
 */
function getDefaultFormula(element: ElementDef): FormulaComponent[] | null {
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
function getDefaultBuildingAndType(
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
function getDefaultProcessingParams(
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
function calculateNativeChance(element: ElementDef): number {
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
function buildMolarFormulaString(formula: FormulaComponent[]): string {
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
function buildDefaultPrototype(element: ElementDef, molarFormula: string): string {
  return `${element.name} руда (${molarFormula})`;
}

// ============================================================================
// Atmospheric Compound Definitions
// ============================================================================

/**
 * Generate atmospheric compounds from the element list.
 * Pure gases (H₂, He, Ne, Ar, N₂, O₂) yield 10.
 * Complex gases (CO₂, CH₄, NH₃, H₂S, SO₂) have calculated yields.
 */
function generateAtmosphericCompounds(massMap: Map<string, number>): BakedAtmospheric[] {
  // Pure gases — yield 10, no processing needed
  const pureGases: {
    id: string; name: string; formula: string; elementId: string;
    atmoTypes: AtmosphereType[];
  }[] = [
    { id: 'H2', name: 'Водород', formula: 'H₂', elementId: 'H', atmoTypes: ['dense'] },
    { id: 'He', name: 'Гелий', formula: 'He', elementId: 'He', atmoTypes: ['inert'] },
    { id: 'Ne', name: 'Неон', formula: 'Ne', elementId: 'Ne', atmoTypes: ['inert'] },
    { id: 'Ar', name: 'Аргон', formula: 'Ar', elementId: 'Ar', atmoTypes: ['inert', 'standard'] },
    { id: 'N2', name: 'Азот', formula: 'N₂', elementId: 'N', atmoTypes: ['thin', 'standard', 'dense'] },
    { id: 'O2', name: 'Кислород', formula: 'O₂', elementId: 'O', atmoTypes: ['standard', 'dense'] },
  ];

  // Complex gases — yields calculated from molar mass
  const complexGases: {
    id: string; name: string; formula: string;
    formulaComponents: FormulaComponent[];
    atmoTypes: AtmosphereType[];
    minLevel: number | null;
    energyCost: number;
    time: number;
  }[] = [
    {
      id: 'CO2', name: 'Углекислый газ', formula: 'CO₂',
      formulaComponents: [{ elementId: 'C', count: 1 }, { elementId: 'O', count: 2 }],
      atmoTypes: ['thin', 'dense', 'toxic', 'co2'],
      minLevel: 1, energyCost: 5, time: 200,
    },
    {
      id: 'CH4', name: 'Метан', formula: 'CH₄',
      formulaComponents: [{ elementId: 'C', count: 1 }, { elementId: 'H', count: 4 }],
      atmoTypes: ['methane'],
      minLevel: 1, energyCost: 3, time: 180,
    },
    {
      id: 'NH3', name: 'Аммиак', formula: 'NH₃',
      formulaComponents: [{ elementId: 'N', count: 1 }, { elementId: 'H', count: 3 }],
      atmoTypes: ['toxic', 'methane'],
      minLevel: 2, energyCost: 3, time: 180,
    },
    {
      id: 'H2S', name: 'Сероводород', formula: 'H₂S',
      formulaComponents: [{ elementId: 'H', count: 2 }, { elementId: 'S', count: 1 }],
      atmoTypes: ['toxic'],
      minLevel: 1, energyCost: 2, time: 150,
    },
    {
      id: 'SO2', name: 'Диоксид серы', formula: 'SO₂',
      formulaComponents: [{ elementId: 'S', count: 1 }, { elementId: 'O', count: 2 }],
      atmoTypes: ['toxic'],
      minLevel: 2, energyCost: 3, time: 180,
    },
  ];

  const compounds: BakedAtmospheric[] = [];

  // Pure gases
  for (const gas of pureGases) {
    compounds.push({
      id: gas.id,
      name: gas.name,
      formula: gas.formula,
      containedElements: [{ elementId: gas.elementId, yield: 10 }],
      atmosphereTypes: gas.atmoTypes,
      processingBuildingId: null,
      minProcessingLevel: null,
      processingEnergyCost: 0,
      processingTime: 0,
    });
  }

  // Complex gases
  for (const gas of complexGases) {
    const yields = calculateYieldsFromFormula(gas.formulaComponents, massMap);
    compounds.push({
      id: gas.id,
      name: gas.name,
      formula: gas.formula,
      containedElements: yields,
      atmosphereTypes: gas.atmoTypes,
      processingBuildingId: 'processor',
      minProcessingLevel: gas.minLevel,
      processingEnergyCost: gas.energyCost,
      processingTime: gas.time,
    });
  }

  return compounds;
}

// ============================================================================
// Ice Compound Definitions
// ============================================================================

/**
 * Generate ice compounds — frozen atmospheric gases with temperature thresholds.
 * @see docs/chemistry.md §9.4
 */
function generateIceCompounds(massMap: Map<string, number>): BakedIce[] {
  const iceDefs: {
    id: string; name: string; formula: string;
    formulaComponents: FormulaComponent[] | null; // null = pure gas with yield 10
    maxTemp: number;
    minLevel: number | null;
    energyCost: number;
    time: number;
    pureElementId?: string;
  }[] = [
    {
      id: 'H2O-ice', name: 'Водяной лёд', formula: 'H₂O',
      formulaComponents: [{ elementId: 'H', count: 2 }, { elementId: 'O', count: 1 }],
      maxTemp: 50, minLevel: 1, energyCost: 4, time: 200,
    },
    {
      id: 'CO2-ice', name: 'Сухой лёд', formula: 'CO₂',
      formulaComponents: [{ elementId: 'C', count: 1 }, { elementId: 'O', count: 2 }],
      maxTemp: -50, minLevel: 1, energyCost: 5, time: 200,
    },
    {
      id: 'N2-ice', name: 'Замёрзший азот', formula: 'N₂',
      formulaComponents: null, pureElementId: 'N',
      maxTemp: -150, minLevel: null, energyCost: 0, time: 0,
    },
    {
      id: 'CH4-ice', name: 'Метановый лёд', formula: 'CH₄',
      formulaComponents: [{ elementId: 'C', count: 1 }, { elementId: 'H', count: 4 }],
      maxTemp: -150, minLevel: 1, energyCost: 3, time: 180,
    },
    {
      id: 'NH3-ice', name: 'Аммиачный лёд', formula: 'NH₃',
      formulaComponents: [{ elementId: 'N', count: 1 }, { elementId: 'H', count: 3 }],
      maxTemp: -100, minLevel: 2, energyCost: 3, time: 180,
    },
  ];

  const ices: BakedIce[] = [];

  for (const def of iceDefs) {
    const containedElements = def.formulaComponents
      ? calculateYieldsFromFormula(def.formulaComponents, massMap)
      : [{ elementId: def.pureElementId!, yield: 10 }];

    ices.push({
      id: def.id,
      name: def.name,
      formula: def.formula,
      containedElements,
      maxTemp: def.maxTemp,
      processingBuildingId: def.minLevel === null ? null : 'processor',
      minProcessingLevel: def.minLevel,
      processingEnergyCost: def.energyCost,
      processingTime: def.time,
    });
  }

  return ices;
}

// ============================================================================
// Main Function: bakeGalaxyModel
// ============================================================================

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

  // Helper: produce a BakedOre from a spec
  function bakeOreFromSpec(spec: OreSpec, primaryElement: string, character: ChemicalCharacter): BakedOre {
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
      ores.push(bakeOreFromSpec(spec, element.id, element.chemicalCharacter));
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

      ores.push(bakeOreFromSpec(spec, element.id, element.chemicalCharacter));
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
      ores.push(bakeOreFromSpec(quarrySpec, elementId, element?.chemicalCharacter ?? 'alkaline_earth'));
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

  // Map gas elements to their atmospheric compound IDs
  const gasElementToAtmoId: Record<string, string> = {
    H: 'H2', He: 'He', Ne: 'Ne', Ar: 'Ar', N: 'N2', O: 'O2',
  };

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
    if (elementToAltOres[element.id]) {
      for (const altId of elementToAltOres[element.id]) {
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

// ============================================================================
// Validation
// ============================================================================

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
