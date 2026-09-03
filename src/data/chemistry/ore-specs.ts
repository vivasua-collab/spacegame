/**
 * Ore Specifications — complete ore spec tables for the chemistry generator.
 *
 * Extracted from `chemistry-generator.ts` as part of Block 01 C5 (audit §2.3):
 * split a 1704-line file into focused modules.
 *
 * Contains ORE_SPECS (element→ore), SPECIAL_ORE_SPECS (empty — R-27),
 * ELEMENT_TO_SPEC_KEY, ELEMENTS_WITH_QUARRY_ALT, REFINERY_ALTERNATIVES.
 *
 * @see docs/chemistry.md §4 — ore formation rules
 * @see docs/34-ores.md    — mineral prototypes
 */

import type { OreSpec } from './baked-types';
import type { ContainedElement } from '@/data/processing-chains';

/**
 * Complete ore specifications for all known elements (ORE_SPECS).
 * For elements not listed here, the generator falls back to default rules
 * based on chemicalCharacter + oxidationState. Bit-exact consistency with
 * the manually curated data in processing-chains.ts for the 57 elements.
 */
export const ORE_SPECS: Record<string, OreSpec> = {
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
    // R-27: алюминиевая руда = Каолин (каолиновая глина). Каолинит Al₂Si₂O₅(OH)₄ —
    // выход из 10 ед. по молярной массе: Al 2.1 / Si 2.2 / O 5.6 / H 0.2.
    id: 'Al-ore', name: 'Каолин (каолиновая глина)', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [
      { elementId: 'Al', count: 2 }, { elementId: 'Si', count: 2 },
      { elementId: 'O', count: 9 }, { elementId: 'H', count: 4 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Каолинит (Al₂Si₂O₅(OH)₄)', molarFormula: 'Al₂Si₂O₅(OH)₄',
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

  Se: {
    id: 'Se-ore', name: 'Селеновая руда', oreType: 'metal_ore', sourceBuildingId: 'mine',
    formula: [{ elementId: 'Pb', count: 1 }, { elementId: 'Se', count: 1 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Клаусталит (PbSe)', molarFormula: 'PbSe',
  },

  Si: {
    // R-27: кремниевая руда = Песок (SiO₂).
    id: 'Si-ore', name: 'Песок', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Si', count: 1 }, { elementId: 'O', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Песок (SiO₂)', molarFormula: 'SiO₂',
  },
  C: {
    // R-27: углеродная руда = Уголь. При переработке даёт Углерод + Шлак (зола);
    // Шлак — отдельный ресурс (см. crafted-materials.ts), на следующем этапе
    // добавляется в бетон. Следы H/O/S из руды убраны — чистая семантика «C + зола».
    id: 'C-ore', name: 'Уголь', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: null,
    containedElements: [{ elementId: 'C', yield: 8.0 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 120,
    prototype: 'Каменный уголь', molarFormula: 'C + зола',
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

  F: {
    id: 'F-ore', name: 'Фторсодержащая руда', oreType: 'nonmetal_ore', sourceBuildingId: 'quarry',
    formula: [{ elementId: 'Ca', count: 1 }, { elementId: 'F', count: 2 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 200,
    prototype: 'Флюорит (CaF₂)', molarFormula: 'CaF₂',
  },

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
  // R-27: 'O-rock' (кислородсодержащие породы) удалён — кислород в залежах
  // больше не встречается. Единственный источник H и O в залежах — Вода
  // (H2O-ice, см. ice-generator.ts + generate-resources.ts).

  In: {
    id: 'In-ore', name: 'Индиевая руда', oreType: 'deep_ore', sourceBuildingId: 'drilling_rig',
    formula: [{ elementId: 'In', count: 2 }, { elementId: 'S', count: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Рожит (In₂S₃)', molarFormula: 'In₂S₃',
  },

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

/**
 * Special ores not tied to a single element — added after element-based generation.
 * R-27: пусто — «O-rock» (кислородсодержащие породы) удалён: кислород и водород
 * не существуют в виде залежей, их источник — Вода (H₂O, электролиз).
 */
export const SPECIAL_ORE_SPECS: OreSpec[] = [];

/**
 * Maps element IDs to their primary ore spec key in ORE_SPECS.
 * Some elements share an ore (e.g., Na and Cl both use 'NaCl').
 */
export const ELEMENT_TO_SPEC_KEY: Record<string, string> = {
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
export const ELEMENTS_WITH_QUARRY_ALT = new Set(['Ba']);

/** Refinery alternative processing for Au/Pt/U (docs/chemistry.md §6.3). */
export const REFINERY_ALTERNATIVES: Record<string, {
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
