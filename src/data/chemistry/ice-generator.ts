/**
 * Ice Compound Generator — produces BakedIce entries.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * Ice compounds are frozen atmospheric gases with temperature thresholds.
 * Yields for complex ices (H₂O, CO₂, CH₄, NH₃) are calculated via molar-mass
 * ratios (see `calculateYieldsFromFormula` in `./ore-generator`).
 * Pure ices (N₂) yield 10.
 *
 * @see docs/chemistry.md §9.4 — ice compound rules
 */

import type { BakedIce, FormulaComponent } from './baked-types';
import { calculateYieldsFromFormula } from './ore-generator';

/**
 * Generate ice compounds — frozen atmospheric gases with temperature thresholds.
 * @see docs/chemistry.md §9.4
 */
export function generateIceCompounds(massMap: Map<string, number>): BakedIce[] {
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
