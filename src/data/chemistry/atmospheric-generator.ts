/**
 * Atmospheric Compound Generator — produces BakedAtmospheric entries.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * Pure gases (H₂, He, Ne, Ar, N₂, O₂) yield 10.
 * Complex gases (CO₂, CH₄, NH₃, H₂S, SO₂) have yields calculated via
 * molar-mass ratios (see `calculateYieldsFromFormula` in `./ore-generator`).
 *
 * Note: the atmosphere-type → gas-id mapping lives in
 * `@/data/atmosphere-gases.ts` (single source of truth, gap-3 fix).
 *
 * @see docs/chemistry.md §9.5 — atmospheric compound rules
 */

import type { BakedAtmospheric, FormulaComponent } from './baked-types';
import type { AtmosphereType } from '@/core/types';
import { calculateYieldsFromFormula } from './ore-generator';

/**
 * Generate atmospheric compounds from the element list.
 * Pure gases (H₂, He, Ne, Ar, N₂, O₂) yield 10.
 * Complex gases (CO₂, CH₄, NH₃, H₂S, SO₂) have calculated yields.
 */
export function generateAtmosphericCompounds(massMap: Map<string, number>): BakedAtmospheric[] {
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
