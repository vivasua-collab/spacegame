/**
 * Конвейер переработки ресурсов — руды, атмосферные и ледяные соединения,
 * цепочки трансформации от сырья до чистых элементов.
 *
 * Источник истины: doc_temp/ores-and-chains.md (версия 2.0).
 * Согласовано с §8 (TypeScript структуры).
 *
 * Здания переработки маппятся на существующие ID из buildings.ts:
 *   Плавильня → processor
 *   Химзавод  → processor
 *   Очистительный комплекс → refinery
 *   Синтезатор → synthesizer
 *
 * Здания добычи, не добавленные в buildings.ts (drilling_rig, ice_harvester),
 * используются как строковые ID для будущей интеграции.
 */

import type { AtmosphereType } from '@/core/types';

// ============ Типы ============

/** Тип сырьевого ресурса */
export type OreType =
  | 'metal_ore'
  | 'nonmetal_ore'
  | 'gas_compound'
  | 'ice_compound'
  | 'deep_ore';

/** Здание добычи сырья */
export type SourceBuildingId =
  | 'mine'
  | 'quarry'
  | 'gas_extractor'
  | 'drilling_rig'
  | 'ice_harvester';

/** Здание переработки (null = переработка не нужна, используется напрямую) */
export type ProcessingBuildingId =
  | 'processor'
  | 'refinery'
  | 'synthesizer'
  | null;

/** Элемент, содержащийся в руде/соединении */
export interface ContainedElement {
  /** ID элемента (напр. 'Fe', 'H', 'O') */
  elementId: string;
  /** Выход из 10 единиц сырья */
  yield: number;
}

/** Определение руды / сырьевого ресурса (§8.1) */
export interface OreDefinition {
  /** Уникальный ID (напр. 'Fe-ore', 'H2O-ice', 'CO2') */
  id: string;
  /** Человекочитаемое название */
  name: string;
  /** Тип сырья */
  type: OreType;
  /** Здание добычи */
  sourceBuildingId: SourceBuildingId;
  /** Главный элемент(ы), содержащиеся в руде */
  containedElements: ContainedElement[];
  /** Минимальный уровень здания добычи */
  minSourceLevel: number;
  /** Здание переработки */
  processingBuildingId: ProcessingBuildingId;
  /** Минимальный уровень здания переработки (null если переработка не нужна) */
  minProcessingLevel: number | null;
  /** Энергозатраты на переработку за единицу */
  processingEnergyCost: number;
  /** Время переработки (тиков) */
  processingTime: number;
  /** Реальный прототип минерала (опционально) */
  prototype?: string;
}

/** Атмосферное соединение (§3.1) */
export interface AtmosphericCompound {
  /** ID соединения (напр. 'CO2', 'CH4') */
  id: string;
  /** Название */
  name: string;
  /** Химическая формула */
  formula: string;
  /** Элементы, получаемые при разложении (пусто для чистых газов) */
  containedElements: ContainedElement[];
  /** Типы атмосферы, где доступно */
  atmosphereTypes: AtmosphereType[];
  /** Здание переработки (null = используется напрямую) */
  processingBuildingId: ProcessingBuildingId;
  /** Минимальный уровень здания переработки */
  minProcessingLevel: number | null;
  /** Энергозатраты на переработку за единицу */
  processingEnergyCost: number;
  /** Время переработки (тиков) */
  processingTime: number;
}

/** Ледяное соединение (§4.1) */
export interface IceCompound {
  /** ID соединения (напр. 'H2O-ice') */
  id: string;
  /** Название */
  name: string;
  /** Химическая формула */
  formula: string;
  /** Элементы, получаемые при переработке */
  containedElements: ContainedElement[];
  /** Условие добычи (температурный порог) */
  tempCondition: string;
  /** Максимальная температура поверхности для добычи (°C) */
  maxTemp: number;
  /** Здание переработки (null = используется напрямую) */
  processingBuildingId: ProcessingBuildingId;
  /** Минимальный уровень здания переработки */
  minProcessingLevel: number | null;
  /** Энергозатраты на переработку за единицу */
  processingEnergyCost: number;
  /** Время переработки (тиков) */
  processingTime: number;
}

/** Шаг цепочки переработки */
export interface ProcessingStep {
  /** ID ресурса на этом шаге (руды или элемента) */
  resourceId: string;
  /** Название ресурса */
  resourceName: string;
  /** Здание, обрабатывающее этот шаг (null = без переработки) */
  buildingId: ProcessingBuildingId;
  /** Минимальный уровень здания переработки */
  minBuildingLevel: number | null;
  /** Энергозатраты */
  energyCost: number;
}

/** Полная цепочка переработки от сырья до чистого элемента */
export interface ProcessingChain {
  /** ID целевого чистого элемента */
  elementId: string;
  /** Название элемента */
  elementName: string;
  /** Шаги цепочки */
  steps: ProcessingStep[];
}

/** Источник элемента (откуда добывается) */
export interface ElementSource {
  /** ID элемента */
  elementId: string;
  /** Основной способ добычи */
  primarySource: {
    oreId: string;
    oreName: string;
    sourceBuildingId: SourceBuildingId;
    processingBuildingId: ProcessingBuildingId;
    minProcessingLevel: number | null;
  };
  /** Альтернативные источники (другие руды/соединения) */
  alternativeSources: {
    oreId: string;
    oreName: string;
    sourceBuildingId: SourceBuildingId;
    processingBuildingId: ProcessingBuildingId;
    minProcessingLevel: number | null;
  }[];
}

// ============ Константы: Руды из Шахты (§2.1) ============

export const ORE_DEFINITIONS: OreDefinition[] = [
  // --- Руды из Шахты (Mine) — 21 руда ---
  {
    id: 'Ag-ore', name: 'Серебряная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Ag', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Аргентит (Ag₂S), самородное серебро',
  },
  {
    id: 'Al-ore', name: 'Алюминиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Al', yield: 7 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Боксит (Al₂O₃·nH₂O)',
  },
  {
    id: 'Au-ore', name: 'Золотая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Au', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 6, processingTime: 250,
    prototype: 'Самородное золото в кварце, арсенопирит',
  },
  {
    id: 'Cd-ore', name: 'Кадмиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Cd', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Гринокит (CdS)',
  },
  {
    id: 'Co-ore', name: 'Кобальтовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Co', yield: 5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Кобальтин (CoAsS), скуттерудит',
  },
  {
    id: 'Cr-ore', name: 'Хромовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Cr', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Хромит (FeCr₂O₄)',
  },
  {
    id: 'Cu-ore', name: 'Медная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Cu', yield: 7 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Халькопирит (CuFeS₂), малахит',
  },
  {
    id: 'Fe-ore', name: 'Железная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Fe', yield: 8 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Гематит (Fe₂O₃), магнетит (Fe₃O₄)',
  },
  {
    id: 'Li-ore', name: 'Литиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Li', yield: 5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 4, processingTime: 200,
    prototype: 'Сподумен (LiAlSi₂O₆), лепидолит',
  },
  {
    id: 'Mn-ore', name: 'Марганцевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Mn', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Пиролюзит (MnO₂), родохрозит (MnCO₃)',
  },
  {
    id: 'Mo-ore', name: 'Молибденовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Mo', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Молибденит (MoS₂), повеллит',
  },
  {
    id: 'Ni-ore', name: 'Никелевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Ni', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Гарниерит, пентландит',
  },
  {
    id: 'Pb-ore', name: 'Свинцовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Pb', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
    prototype: 'Галенит (PbS)',
  },
  {
    id: 'Pt-ore', name: 'Платиновая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Pt', yield: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Платиноиды в сульфидах',
  },
  {
    id: 'Se-ore', name: 'Селеновая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Se', yield: 3 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Клаусталит (PbSe)',
  },
  {
    id: 'Sn-ore', name: 'Оловянная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Sn', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
    prototype: 'Касситерит (SnO₂)',
  },
  {
    id: 'Ti-ore', name: 'Титановая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Ti', yield: 7 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Ильменит (FeTiO₃), рутил (TiO₂)',
  },
  {
    id: 'U-ore', name: 'Урановая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'U', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 8, processingTime: 350,
    prototype: 'Уранинит (UO₂), карнотит',
  },
  {
    id: 'V-ore', name: 'Ванадиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'V', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Ванадинит, карнотит',
  },
  {
    id: 'W-ore', name: 'Вольфрамовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'W', yield: 5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Вольфрамит, шеелит',
  },
  {
    id: 'Zn-ore', name: 'Цинковая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Zn', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Сфалерит (ZnS), смитсонит',
  },

  // --- Руды из Карьера (Quarry) — 12 руд/соединений ---
  {
    id: 'Si-ore', name: 'Кремниевая руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'Si', yield: 7 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кварц (SiO₂), кварцевый песок',
  },
  {
    id: 'C-ore', name: 'Углеродная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'C', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 120,
    prototype: 'Графит, каменный уголь',
  },
  {
    id: 'S-ore', name: 'Серная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'S', yield: 8 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 1, processingTime: 100,
    prototype: 'Самородная сера, пирит (FeS₂)',
  },
  {
    id: 'K-ore', name: 'Калийная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'K', yield: 7 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Сильвинит (KCl), карналлит',
  },
  {
    id: 'B-ore', name: 'Борная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'B', yield: 5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Боракс, сассолит (H₃BO₃)',
  },
  {
    id: 'F-ore', name: 'Фторсодержащая руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'F', yield: 7 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 200,
    prototype: 'Флюорит (CaF₂)',
  },
  {
    id: 'CaCO3', name: 'Известняк', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Ca', yield: 4 },
      { elementId: 'C', yield: 2 },
      { elementId: 'O', yield: 6 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Кальцит (CaCO₃)',
  },
  {
    id: 'NaCl', name: 'Поваренная соль', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Na', yield: 4 },
      { elementId: 'Cl', yield: 6 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 4, processingTime: 200,
    prototype: 'Галит (NaCl)',
  },
  {
    id: 'O-rock', name: 'Кислородсодержащие породы', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'O', yield: 5 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кислородсодержащие минералы',
  },
  {
    id: 'P-ore', name: 'Фосфорная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'P', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Апатит, фосфорит',
  },
  {
    id: 'Mg-ore', name: 'Магнезиальная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'Mg', yield: 6 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 180,
    prototype: 'Магнезит, доломит',
  },
  {
    id: 'Ba-ore-quarry', name: 'Бариевая руда (поверхностная)', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [{ elementId: 'Ba', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Барит (BaSO₄)',
  },
];

// ============ Константы: Атмосферные соединения (§3.1) ============

export const ATMOSPHERIC_COMPOUNDS: AtmosphericCompound[] = [
  {
    id: 'H2', name: 'Водород', formula: 'H₂',
    containedElements: [{ elementId: 'H', yield: 10 }],
    atmosphereTypes: ['dense'],
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
  {
    id: 'He', name: 'Гелий', formula: 'He',
    containedElements: [{ elementId: 'He', yield: 10 }],
    atmosphereTypes: ['inert'],
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
  {
    id: 'Ne', name: 'Неон', formula: 'Ne',
    containedElements: [{ elementId: 'Ne', yield: 10 }],
    atmosphereTypes: ['inert'],
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
  {
    id: 'Ar', name: 'Аргон', formula: 'Ar',
    containedElements: [{ elementId: 'Ar', yield: 10 }],
    atmosphereTypes: ['inert', 'standard'],
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
  {
    id: 'N2', name: 'Азот', formula: 'N₂',
    containedElements: [{ elementId: 'N', yield: 10 }],
    atmosphereTypes: ['thin', 'standard', 'dense'],
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
  {
    id: 'CO2', name: 'Углекислый газ', formula: 'CO₂',
    containedElements: [
      { elementId: 'C', yield: 5 },
      { elementId: 'O', yield: 9 },
    ],
    atmosphereTypes: ['thin', 'dense', 'toxic', 'co2'],
    processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 5, processingTime: 200,
  },
  {
    id: 'CH4', name: 'Метан', formula: 'CH₄',
    containedElements: [
      { elementId: 'C', yield: 2 },
      { elementId: 'H', yield: 6 },
    ],
    atmosphereTypes: ['methane'],
    processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 180,
  },
  {
    id: 'NH3', name: 'Аммиак', formula: 'NH₃',
    containedElements: [
      { elementId: 'N', yield: 8 },
      { elementId: 'H', yield: 12 },
    ],
    atmosphereTypes: ['toxic', 'methane'],
    processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
  },
  {
    id: 'H2S', name: 'Сероводород', formula: 'H₂S',
    containedElements: [
      { elementId: 'H', yield: 6 },
      { elementId: 'S', yield: 8 },
    ],
    atmosphereTypes: ['toxic'],
    processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
  },
  {
    id: 'SO2', name: 'Диоксид серы', formula: 'SO₂',
    containedElements: [
      { elementId: 'S', yield: 6 },
      { elementId: 'O', yield: 8 },
    ],
    atmosphereTypes: ['toxic'],
    processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
  },
  {
    id: 'O2', name: 'Кислород', formula: 'O₂',
    containedElements: [{ elementId: 'O', yield: 10 }],
    atmosphereTypes: ['standard', 'dense'],
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
];

/** Доступность газов по типу атмосферы (§3.2) */
export const ATMOSPHERE_GAS_AVAILABILITY: Record<AtmosphereType, string[]> = {
  none: [],
  thin: ['N2', 'CO2'],
  standard: ['Ar', 'N2', 'CO2', 'O2'],
  dense: ['H2', 'He', 'Ar', 'N2', 'CO2', 'O2'],
  toxic: ['N2', 'CO2', 'NH3', 'H2S', 'SO2'],
  inert: ['He', 'Ne', 'Ar', 'N2'],
  methane: ['H2', 'CH4', 'NH3'],
  co2: ['N2', 'CO2'],
};

// ============ Константы: Ледяные соединения (§4.1) ============

export const ICE_COMPOUNDS: IceCompound[] = [
  {
    id: 'H2O-ice', name: 'Водяной лёд', formula: 'H₂O',
    containedElements: [
      { elementId: 'H', yield: 8 },
      { elementId: 'O', yield: 8 },
    ],
    tempCondition: 'T < +50°C', maxTemp: 50,
    processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 4, processingTime: 200,
  },
  {
    id: 'CO2-ice', name: 'Сухой лёд', formula: 'CO₂',
    containedElements: [
      { elementId: 'C', yield: 5 },
      { elementId: 'O', yield: 9 },
    ],
    tempCondition: 'T < −50°C', maxTemp: -50,
    processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 5, processingTime: 200,
  },
  {
    id: 'N2-ice', name: 'Замёрзший азот', formula: 'N₂',
    containedElements: [{ elementId: 'N', yield: 10 }],
    tempCondition: 'T < −150°C', maxTemp: -150,
    processingBuildingId: null, minProcessingLevel: null,
    processingEnergyCost: 0, processingTime: 0,
  },
  {
    id: 'CH4-ice', name: 'Метановый лёд', formula: 'CH₄',
    containedElements: [
      { elementId: 'C', yield: 2 },
      { elementId: 'H', yield: 6 },
    ],
    tempCondition: 'T < −150°C', maxTemp: -150,
    processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 180,
  },
  {
    id: 'NH3-ice', name: 'Аммиачный лёд', formula: 'NH₃',
    containedElements: [
      { elementId: 'N', yield: 8 },
      { elementId: 'H', yield: 12 },
    ],
    tempCondition: 'T < −100°C', maxTemp: -100,
    processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
  },
];

/** Бонус температуры для ледодобывающей станции (§4.2) */
export const ICE_TEMP_BONUSES: { maxTemp: number; bonus: number; availableIces: string[] }[] = [
  { maxTemp: 50, bonus: 0.3, availableIces: ['H2O-ice'] },
  { maxTemp: 0, bonus: 0.7, availableIces: ['H2O-ice', 'CO2-ice'] },
  { maxTemp: -50, bonus: 1.0, availableIces: ['H2O-ice', 'CO2-ice', 'NH3-ice'] },
  { maxTemp: -150, bonus: 1.2, availableIces: ['H2O-ice', 'CO2-ice', 'N2-ice', 'CH4-ice', 'NH3-ice'] },
];

// ============ Константы: Глубинные руды (§5.1) ============

export const DEEP_ORES: OreDefinition[] = [
  {
    id: 'Y-ore', name: 'Иттриевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Y', yield: 3 }],
    minSourceLevel: 2, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
  },
  {
    id: 'Ba-ore', name: 'Бариевая руда (глубинная)', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Ba', yield: 4 }],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 250,
  },
  {
    id: 'Zr-ore', name: 'Циркониевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Zr', yield: 5 }],
    minSourceLevel: 3, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
  },
  {
    id: 'Be-ore', name: 'Бериллиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Be', yield: 3 }],
    minSourceLevel: 3, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
  },
  {
    id: 'In-ore', name: 'Индиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'In', yield: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
  },
  {
    id: 'Nd-ore', name: 'Неодимовая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Nd', yield: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
  },
  {
    id: 'Ce-ore', name: 'Цериевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Ce', yield: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
  },
  {
    id: 'La-ore', name: 'Лантановая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'La', yield: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
  },
  {
    id: 'Dy-ore', name: 'Диспрозиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Dy', yield: 2 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 9, processingTime: 350,
  },
  {
    id: 'Ir-ore', name: 'Иридиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Ir', yield: 2 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 10, processingTime: 350,
  },
  {
    id: 'Os-ore', name: 'Осмиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Os', yield: 2 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 10, processingTime: 350,
  },
  {
    id: 'Ru-ore', name: 'Рутениевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Ru', yield: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 8, processingTime: 300,
  },
  {
    id: 'Rh-ore', name: 'Родиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Rh', yield: 2 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 9, processingTime: 350,
  },
  {
    id: 'Pd-ore', name: 'Палладиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Pd', yield: 3 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 8, processingTime: 300,
  },
  {
    id: 'Hf-ore', name: 'Гафниевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Hf', yield: 3 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
  },
  {
    id: 'Ta-ore', name: 'Танталовая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Ta', yield: 3 }],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 7, processingTime: 300,
  },
  {
    id: 'Nb-ore', name: 'Ниобиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Nb', yield: 4 }],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
  },
  {
    id: 'Re-ore', name: 'Рениевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [{ elementId: 'Re', yield: 2 }],
    minSourceLevel: 8, processingBuildingId: 'processor', minProcessingLevel: 8,
    processingEnergyCost: 12, processingTime: 400,
  },
];

// ============ Самородные элементы (§2.4) ============

/** Шанс нахождения самородка при добыче руды */
export const NATIVE_ELEMENT_CHANCE: Record<string, number> = {
  S: 0.30,
  C: 0.20,
  Cu: 0.05,
  Ag: 0.05,
  Au: 0.10,
  Pt: 0.03,
};

// ============ Вспомогательные маппинги ============

/** Альтернативные пути переработки через Очистительный комплекс (§2.3: Au, Pt, U) */
export const REFINERY_PROCESSING: OreDefinition[] = [
  {
    id: 'Au-ore:refinery', name: 'Очистка золота', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Au', yield: 9 }],
    minSourceLevel: 1, processingBuildingId: 'refinery', minProcessingLevel: 3,
    processingEnergyCost: 8, processingTime: 15,
    prototype: 'Очистка из Au-ore через Очистительный комплекс',
  },
  {
    id: 'Pt-ore:refinery', name: 'Очистка платины', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'Pt', yield: 9 }],
    minSourceLevel: 1, processingBuildingId: 'refinery', minProcessingLevel: 5,
    processingEnergyCost: 10, processingTime: 18,
    prototype: 'Очистка из Pt-ore через Очистительный комплекс',
  },
  {
    id: 'U-ore:refinery', name: 'Очистка урана', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [{ elementId: 'U', yield: 9 }],
    minSourceLevel: 1, processingBuildingId: 'refinery', minProcessingLevel: 5,
    processingEnergyCost: 10, processingTime: 18,
    prototype: 'Очистка из U-ore через Очистительный комплекс',
  },
];

/** Все руды (объединение ORE_DEFINITIONS + DEEP_ORES + REFINERY_PROCESSING) */
const ALL_ORE_DEFS = [...ORE_DEFINITIONS, ...DEEP_ORES, ...REFINERY_PROCESSING];

/** Маппинг: ID руды → OreDefinition */
export const ORE_MAP = new Map(ALL_ORE_DEFS.map(o => [o.id, o]));

/** Маппинг: ID атмосферного соединения → AtmosphericCompound */
export const ATMOSPHERIC_COMPOUND_MAP = new Map(ATMOSPHERIC_COMPOUNDS.map(c => [c.id, c]));

/** Маппинг: ID ледяного соединения → IceCompound */
export const ICE_COMPOUND_MAP = new Map(ICE_COMPOUNDS.map(c => [c.id, c]));

/** Маппинг: элемент → ID руды (§8.3) */
const ORE_FOR_ELEMENT_MAP: Record<string, string> = {
  Fe: 'Fe-ore', Si: 'Si-ore', Ti: 'Ti-ore', Al: 'Al-ore',
  Cu: 'Cu-ore', Ni: 'Ni-ore', Cr: 'Cr-ore', W: 'W-ore',
  Co: 'Co-ore', Au: 'Au-ore', Pt: 'Pt-ore', U: 'U-ore',
  Li: 'Li-ore', V: 'V-ore', C: 'C-ore', S: 'S-ore',
  Mn: 'Mn-ore', Zn: 'Zn-ore', Sn: 'Sn-ore', Pb: 'Pb-ore',
  Mo: 'Mo-ore', Ag: 'Ag-ore', Cd: 'Cd-ore', Se: 'Se-ore',
  K: 'K-ore', B: 'B-ore', F: 'F-ore',
  Mg: 'Mg-ore', P: 'P-ore', Na: 'NaCl', Cl: 'NaCl', Ca: 'CaCO3',
  // Глубинные
  Y: 'Y-ore', Ba: 'Ba-ore', Zr: 'Zr-ore', Be: 'Be-ore',
  In: 'In-ore', Nd: 'Nd-ore', Ce: 'Ce-ore', La: 'La-ore', Dy: 'Dy-ore',
  Ir: 'Ir-ore', Os: 'Os-ore', Ru: 'Ru-ore', Rh: 'Rh-ore',
  Pd: 'Pd-ore', Hf: 'Hf-ore', Ta: 'Ta-ore', Nb: 'Nb-ore', Re: 'Re-ore',
  // Атмосферные (используются напрямую, руда = газ)
  H: 'H2', He: 'He', Ne: 'Ne', Ar: 'Ar', N: 'N2', O: 'O2',
};

/** Маппинг: элемент → все источники (руды/соединения, которые его содержат) */
const ELEMENT_SOURCES_MAP = buildElementSourcesMap();

function buildElementSourcesMap(): Map<string, ElementSource> {
  const map = new Map<string, ElementSource>();

  // Собираем все источники для каждого элемента
  const sourceEntries = new Map<string, {
    oreId: string; oreName: string;
    sourceBuildingId: SourceBuildingId;
    processingBuildingId: ProcessingBuildingId;
    minProcessingLevel: number | null;
    isPrimary: boolean;
  }[]>();

  // Вспомогательная функция для добавления источника
  function addSource(
    elementId: string,
    oreId: string,
    oreName: string,
    sourceBuildingId: SourceBuildingId,
    processingBuildingId: ProcessingBuildingId,
    minProcessingLevel: number | null,
    isPrimary: boolean,
  ): void {
    if (!sourceEntries.has(elementId)) {
      sourceEntries.set(elementId, []);
    }
    sourceEntries.get(elementId)!.push({
      oreId, oreName, sourceBuildingId, processingBuildingId, minProcessingLevel, isPrimary,
    });
  }

  // Из ORE_DEFINITIONS и DEEP_ORES
  for (const ore of ALL_ORE_DEFS) {
    for (const ce of ore.containedElements) {
      const isPrimary = ORE_FOR_ELEMENT_MAP[ce.elementId] === ore.id;
      addSource(
        ce.elementId, ore.id, ore.name,
        ore.sourceBuildingId, ore.processingBuildingId, ore.minProcessingLevel,
        isPrimary,
      );
    }
  }

  // Из ATMOSPHERIC_COMPOUNDS
  for (const compound of ATMOSPHERIC_COMPOUNDS) {
    for (const ce of compound.containedElements) {
      const isPrimary = ORE_FOR_ELEMENT_MAP[ce.elementId] === compound.id;
      addSource(
        ce.elementId, compound.id, compound.name,
        'gas_extractor', compound.processingBuildingId, compound.minProcessingLevel,
        isPrimary,
      );
    }
  }

  // Из ICE_COMPOUNDS
  for (const ice of ICE_COMPOUNDS) {
    for (const ce of ice.containedElements) {
      const isPrimary = ORE_FOR_ELEMENT_MAP[ce.elementId] === ice.id;
      addSource(
        ce.elementId, ice.id, ice.name,
        'ice_harvester', ice.processingBuildingId, ice.minProcessingLevel,
        isPrimary,
      );
    }
  }

  // Собираем ElementSource для каждого элемента
  for (const [elementId, entries] of sourceEntries) {
    const primary = entries.find(e => e.isPrimary) ?? entries[0];
    const alternatives = entries.filter(e => e !== primary);

    map.set(elementId, {
      elementId,
      primarySource: {
        oreId: primary.oreId,
        oreName: primary.oreName,
        sourceBuildingId: primary.sourceBuildingId,
        processingBuildingId: primary.processingBuildingId,
        minProcessingLevel: primary.minProcessingLevel,
      },
      alternativeSources: alternatives.map(a => ({
        oreId: a.oreId,
        oreName: a.oreName,
        sourceBuildingId: a.sourceBuildingId,
        processingBuildingId: a.processingBuildingId,
        minProcessingLevel: a.minProcessingLevel,
      })),
    });
  }

  return map;
}

// ============ Функции ============

/**
 * Возвращает полную цепочку переработки от руды/сырья до чистого элемента.
 * Если элемент добывается из нескольких источников, возвращает цепочку
 * по основному (primary) источнику.
 */
export function getProcessingChain(elementId: string): ProcessingChain | null {
  const source = ELEMENT_SOURCES_MAP.get(elementId);
  if (!source) return null;

  const steps: ProcessingStep[] = [];

  // Шаг 0: Добыча сырья
  const primaryOre = ORE_MAP.get(source.primarySource.oreId) ??
    (ATMOSPHERIC_COMPOUND_MAP.get(source.primarySource.oreId) as unknown as OreDefinition | undefined) ??
    (ICE_COMPOUND_MAP.get(source.primarySource.oreId) as unknown as OreDefinition | undefined);

  steps.push({
    resourceId: source.primarySource.oreId,
    resourceName: source.primarySource.oreName,
    buildingId: null, // добыча — не переработка
    minBuildingLevel: null,
    energyCost: 0,
  });

  // Шаг 1: Переработка (если нужна)
  if (source.primarySource.processingBuildingId) {
    steps.push({
      resourceId: elementId,
      resourceName: getElementName(elementId),
      buildingId: source.primarySource.processingBuildingId,
      minBuildingLevel: source.primarySource.minProcessingLevel,
      energyCost: primaryOre?.processingEnergyCost ?? 0,
    });
  }

  return {
    elementId,
    elementName: getElementName(elementId),
    steps,
  };
}

/**
 * Возвращает все рецепты (как определения руд/соединений) для здания переработки.
 * @param buildingId ID здания из buildings.ts
 */
export function getRecipesForBuilding(buildingId: string): OreDefinition[] {
  return ALL_ORE_DEFS.filter(o => o.processingBuildingId === buildingId);
}

/**
 * Возвращает атмосферные соединения, обрабатываемые указанным зданием.
 */
export function getAtmosphericRecipesForBuilding(buildingId: string): AtmosphericCompound[] {
  return ATMOSPHERIC_COMPOUNDS.filter(c => c.processingBuildingId === buildingId);
}

/**
 * Возвращает ледяные соединения, обрабатываемые указанным зданием.
 */
export function getIceRecipesForBuilding(buildingId: string): IceCompound[] {
  return ICE_COMPOUNDS.filter(c => c.processingBuildingId === buildingId);
}

/**
 * Возвращает информацию об источнике элемента — откуда добывается
 * (шахта/карьер/атмосфера/лёд/глубинная).
 */
export function getElementSource(elementId: string): ElementSource | null {
  return ELEMENT_SOURCES_MAP.get(elementId) ?? null;
}

/**
 * Возвращает ID руды, необходимой для получения элемента.
 * Для атмосферных элементов (H, He, N, O) возвращает ID газа.
 * Возвращает null, если элемент неизвестен.
 */
export function getOreForElement(elementId: string): string | null {
  return ORE_FOR_ELEMENT_MAP[elementId] ?? null;
}

/**
 * Возвращает все руды, добываемые конкретным зданием добычи.
 */
export function getOresForSourceBuilding(buildingId: SourceBuildingId): OreDefinition[] {
  return ALL_ORE_DEFS.filter(o => o.sourceBuildingId === buildingId);
}

/**
 * Возвращает атмосферные соединения, доступные на планете
 * с заданным типом атмосферы.
 */
export function getAtmosphericCompoundsForType(atmosphereType: AtmosphereType): AtmosphericCompound[] {
  const availableIds = ATMOSPHERE_GAS_AVAILABILITY[atmosphereType] ?? [];
  return ATMOSPHERIC_COMPOUNDS.filter(c => availableIds.includes(c.id));
}

/**
 * Возвращает ледяные соединения, доступные при заданной температуре.
 * @param temperature Температура поверхности в °C
 */
export function getIceCompoundsForTemp(temperature: number): IceCompound[] {
  return ICE_COMPOUNDS.filter(ice => temperature < ice.maxTemp);
}

/**
 * Возвращает бонус добычи льда в зависимости от температуры.
 */
export function getIceTempBonus(temperature: number): number {
  if (temperature >= 50) return 0;
  if (temperature >= 0) return 0.3;
  if (temperature >= -50) return 0.7;
  if (temperature >= -150) return 1.0;
  return 1.2;
}

/**
 * Возвращает все элементы, которые можно получить из конкретного сырья (руды/газа/льда).
 */
export function getElementsFromOre(oreId: string): ContainedElement[] {
  const ore = ORE_MAP.get(oreId);
  if (ore) return ore.containedElements;

  const atmo = ATMOSPHERIC_COMPOUND_MAP.get(oreId);
  if (atmo) return atmo.containedElements;

  const ice = ICE_COMPOUND_MAP.get(oreId);
  if (ice) return ice.containedElements;

  return [];
}

/**
 * Возвращает все ID руд/соединений, необходимых для переработки
 * на заданном здании, с минимальным уровнем.
 */
export function getProcessingRequirementsForBuilding(
  buildingId: string,
): { oreId: string; oreName: string; minLevel: number; outputElements: ContainedElement[] }[] {
  const results: { oreId: string; oreName: string; minLevel: number; outputElements: ContainedElement[] }[] = [];

  for (const ore of ALL_ORE_DEFS) {
    if (ore.processingBuildingId === buildingId) {
      results.push({
        oreId: ore.id,
        oreName: ore.name,
        minLevel: ore.minProcessingLevel ?? 1,
        outputElements: ore.containedElements,
      });
    }
  }

  return results;
}

// ============ Внутренние утилиты ============

/** Человекочитаемые имена элементов */
const ELEMENT_NAMES: Record<string, string> = {
  H: 'Водород', He: 'Гелий', Ne: 'Неон', Ar: 'Аргон',
  C: 'Углерод', N: 'Азот', O: 'Кислород',
  F: 'Фтор', B: 'Бор', Cl: 'Хлор',
  Si: 'Кремний', S: 'Сера', P: 'Фосфор',
  K: 'Калий', Ca: 'Кальций', Na: 'Натрий', Mg: 'Магний',
  Fe: 'Железо', Al: 'Алюминий', Ti: 'Титан',
  Cr: 'Хром', Mn: 'Марганец', Ni: 'Никель',
  Cu: 'Медь', Zn: 'Цинк', Sn: 'Олово', Pb: 'Свинец',
  Co: 'Кобальт', W: 'Вольфрам', Mo: 'Молибден',
  V: 'Ванадий', Ag: 'Серебро', Cd: 'Кадмий', Se: 'Селен',
  Au: 'Золото', Pt: 'Платина', U: 'Уран',
  Li: 'Литий', Y: 'Иттрий', Ba: 'Барий',
  Zr: 'Цирконий', Be: 'Бериллий',
  In: 'Индий', Nd: 'Неодим', Ce: 'Церий', La: 'Лантан', Dy: 'Диспрозий',
  Ir: 'Иридий', Os: 'Осмий', Ru: 'Рутений', Rh: 'Родий',
  Pd: 'Палладий', Hf: 'Гафний', Ta: 'Тантал', Nb: 'Ниобий', Re: 'Рений',
};

function getElementName(elementId: string): string {
  return ELEMENT_NAMES[elementId] ?? elementId;
}

// ============ Сводные списки ID (§8.4) ============

/** Все ID руд шахты */
export const MINE_ORE_IDS = [
  'Fe-ore', 'Ti-ore', 'Al-ore', 'Cr-ore', 'Ni-ore',
  'Cu-ore', 'W-ore', 'Co-ore', 'Au-ore', 'Pt-ore',
  'U-ore', 'Li-ore', 'V-ore', 'Mn-ore', 'Mo-ore',
  'Ag-ore', 'Sn-ore', 'Pb-ore', 'Zn-ore', 'Cd-ore', 'Se-ore',
] as const;

/** Все ID руд карьера */
export const QUARRY_ORE_IDS = [
  'Si-ore', 'C-ore', 'S-ore', 'K-ore', 'B-ore', 'F-ore',
  'CaCO3', 'NaCl', 'O-rock', 'P-ore', 'Mg-ore', 'Ba-ore-quarry',
] as const;

/** Все ID атмосферных газов */
export const ATMOSPHERIC_GAS_IDS = [
  'H2', 'He', 'Ne', 'Ar', 'N2', 'CO2', 'CH4', 'NH3', 'H2S', 'SO2', 'O2',
] as const;

/** Все ID ледяных соединений */
export const ICE_COMPOUND_IDS = [
  'H2O-ice', 'CO2-ice', 'N2-ice', 'CH4-ice', 'NH3-ice',
] as const;

/** Все ID глубинных руд */
export const DEEP_ORE_IDS = [
  'Y-ore', 'Ba-ore', 'Zr-ore', 'Be-ore', 'In-ore', 'Nd-ore', 'Ce-ore', 'La-ore', 'Dy-ore',
  'Ir-ore', 'Os-ore', 'Ru-ore', 'Rh-ore', 'Pd-ore', 'Hf-ore', 'Ta-ore', 'Nb-ore', 'Re-ore',
] as const;
