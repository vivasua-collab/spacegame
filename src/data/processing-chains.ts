/**
 * Конвейер переработки ресурсов — руды, атмосферные и ледяные соединения,
 * цепочки трансформации от сырья до чистых элементов.
 *
 * Источник истины: docs/mendeleev.md §3 (расчёты молярной массы).
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
  /** Химическая формула минерала-прототипа */
  molarFormula?: string;
  /** Молярная масса соединения (г/моль) */
  molarMass?: number;
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

// ============ Константы: Руды из Шахты (§3.1 — 21 руда) ============
// Данные из docs/mendeleev.md §3.1 — расчёт по молярной массе

export const ORE_DEFINITIONS: OreDefinition[] = [
  // --- Руды из Шахты (Mine) — 21 руда ---
  {
    id: 'Fe-ore', name: 'Железная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Fe', yield: 7.0 },
      { elementId: 'O', yield: 3.0 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Гематит (Fe₂O₃)',
    molarFormula: 'Fe₂O₃', molarMass: 159.6,
  },
  {
    id: 'Ti-ore', name: 'Титановая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Fe', yield: 3.7 },
      { elementId: 'Ti', yield: 3.2 },
      { elementId: 'O', yield: 3.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Ильменит (FeTiO₃)',
    molarFormula: 'FeTiO₃', molarMass: 151.7,
  },
  {
    id: 'Cu-ore', name: 'Медная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Cu', yield: 3.5 },
      { elementId: 'Fe', yield: 3.0 },
      { elementId: 'S', yield: 3.5 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Халькопирит (CuFeS₂)',
    molarFormula: 'CuFeS₂', molarMass: 183.5,
  },
  {
    id: 'Cr-ore', name: 'Хромовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Fe', yield: 2.5 },
      { elementId: 'Cr', yield: 4.6 },
      { elementId: 'O', yield: 2.9 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Хромит (FeCr₂O₄)',
    molarFormula: 'FeCr₂O₄', molarMass: 223.8,
  },
  {
    id: 'V-ore', name: 'Ванадиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'V', yield: 5.6 },
      { elementId: 'O', yield: 4.4 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Ванадиевый концентрат (V₂O₅)',
    molarFormula: 'V₂O₅', molarMass: 181.8,
  },
  {
    id: 'Ni-ore', name: 'Никелевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Ni', yield: 4.4 },
      { elementId: 'Si', yield: 2.1 },
      { elementId: 'O', yield: 3.6 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Гарниерит (NiSiO₃)',
    molarFormula: 'NiSiO₃', molarMass: 134.8,
  },
  {
    id: 'Mn-ore', name: 'Марганцевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Mn', yield: 6.3 },
      { elementId: 'O', yield: 3.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Пиролюзит (MnO₂)',
    molarFormula: 'MnO₂', molarMass: 86.9,
  },
  {
    id: 'Zn-ore', name: 'Цинковая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Zn', yield: 6.7 },
      { elementId: 'S', yield: 3.3 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Сфалерит (ZnS)',
    molarFormula: 'ZnS', molarMass: 97.5,
  },
  {
    id: 'Sn-ore', name: 'Оловянная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Sn', yield: 7.9 },
      { elementId: 'O', yield: 2.1 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
    prototype: 'Касситерит (SnO₂)',
    molarFormula: 'SnO₂', molarMass: 150.7,
  },
  {
    id: 'Pb-ore', name: 'Свинцовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Pb', yield: 8.7 },
      { elementId: 'S', yield: 1.3 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 180,
    prototype: 'Галенит (PbS)',
    molarFormula: 'PbS', molarMass: 239.3,
  },
  {
    id: 'Co-ore', name: 'Кобальтовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Co', yield: 5.8 },
      { elementId: 'S', yield: 4.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Линнеит (Co₃S₄)',
    molarFormula: 'Co₃S₄', molarMass: 305.1,
  },
  {
    id: 'W-ore', name: 'Вольфрамовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Fe', yield: 1.8 },
      { elementId: 'W', yield: 6.1 },
      { elementId: 'O', yield: 2.1 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Вольфрамит (FeWO₄)',
    molarFormula: 'FeWO₄', molarMass: 303.6,
  },
  {
    id: 'Mo-ore', name: 'Молибденовая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Mo', yield: 6.0 },
      { elementId: 'S', yield: 4.0 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Молибденит (MoS₂)',
    molarFormula: 'MoS₂', molarMass: 160.1,
  },
  {
    id: 'Au-ore', name: 'Золотая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Au', yield: 0.4 },
      { elementId: 'Si', yield: 4.5 },
      { elementId: 'O', yield: 5.1 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 6, processingTime: 250,
    prototype: 'Кварцевая жила с золотом (Au + SiO₂)',
    molarFormula: 'Au+SiO₂',
  },
  {
    id: 'Ag-ore', name: 'Серебряная руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Ag', yield: 8.7 },
      { elementId: 'S', yield: 1.3 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Аргентит (Ag₂S)',
    molarFormula: 'Ag₂S', molarMass: 247.9,
  },
  {
    id: 'Pt-ore', name: 'Платиновая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Pt', yield: 0.3 },
      { elementId: 'Fe', yield: 3.0 },
      { elementId: 'Ni', yield: 1.0 },
      { elementId: 'S', yield: 2.0 },
      { elementId: 'O', yield: 3.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Ультрамафиты (Pt + FeNiS)',
    molarFormula: 'Pt+FeNiS+O',
  },
  {
    id: 'Al-ore', name: 'Алюминиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Al', yield: 5.3 },
      { elementId: 'O', yield: 4.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 3, processingTime: 150,
    prototype: 'Боксит (Al₂O₃)',
    molarFormula: 'Al₂O₃', molarMass: 102.0,
  },
  {
    id: 'Li-ore', name: 'Литиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Li', yield: 0.4 },
      { elementId: 'Al', yield: 1.5 },
      { elementId: 'Si', yield: 3.0 },
      { elementId: 'O', yield: 5.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 4, processingTime: 200,
    prototype: 'Сподумен (LiAlSi₂O₆)',
    molarFormula: 'LiAlSi₂O₆', molarMass: 186.1,
  },
  {
    id: 'Cd-ore', name: 'Кадмиевая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Cd', yield: 7.8 },
      { elementId: 'S', yield: 2.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Гринокит (CdS)',
    molarFormula: 'CdS', molarMass: 144.5,
  },
  {
    id: 'Se-ore', name: 'Селеновая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'Pb', yield: 7.2 },
      { elementId: 'Se', yield: 2.8 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 300,
    prototype: 'Клаусталит (PbSe)',
    molarFormula: 'PbSe', molarMass: 286.2,
  },
  {
    id: 'U-ore', name: 'Урановая руда', type: 'metal_ore',
    sourceBuildingId: 'mine',
    containedElements: [
      { elementId: 'U', yield: 8.8 },
      { elementId: 'O', yield: 1.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 8, processingTime: 350,
    prototype: 'Уранинит (UO₂)',
    molarFormula: 'UO₂', molarMass: 270.0,
  },

  // --- Руды из Карьера (Quarry) — данные из mendeleev.md §3.2 ---
  {
    id: 'Si-ore', name: 'Кремниевая руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Si', yield: 4.7 },
      { elementId: 'O', yield: 5.3 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кварц (SiO₂)',
    molarFormula: 'SiO₂', molarMass: 60.1,
  },
  {
    id: 'C-ore', name: 'Углеродная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'C', yield: 8.0 },
      { elementId: 'H', yield: 0.5 },
      { elementId: 'O', yield: 1.3 },
      { elementId: 'S', yield: 0.2 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 120,
    prototype: 'Каменный уголь',
    molarFormula: 'C+H+O+S',
  },
  {
    id: 'S-ore', name: 'Серная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'S', yield: 9.5 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 1, processingTime: 100,
    prototype: 'Самородная сера',
    molarFormula: 'S', molarMass: 32.1,
  },
  {
    id: 'K-ore', name: 'Калийная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'K', yield: 5.2 },
      { elementId: 'Cl', yield: 4.8 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Сильвинит (KCl)',
    molarFormula: 'KCl', molarMass: 74.6,
  },
  {
    id: 'B-ore', name: 'Борная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'B', yield: 3.1 },
      { elementId: 'O', yield: 6.9 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Боракс (B₂O₃)',
    molarFormula: 'B₂O₃', molarMass: 69.6,
  },
  {
    id: 'F-ore', name: 'Фторсодержащая руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Ca', yield: 5.1 },
      { elementId: 'F', yield: 4.9 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 200,
    prototype: 'Флюорит (CaF₂)',
    molarFormula: 'CaF₂', molarMass: 78.1,
  },
  {
    id: 'CaCO3', name: 'Известняк', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Ca', yield: 4.0 },
      { elementId: 'C', yield: 1.2 },
      { elementId: 'O', yield: 4.8 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 3, processingTime: 200,
    prototype: 'Кальцит (CaCO₃)',
    molarFormula: 'CaCO₃', molarMass: 100.1,
  },
  {
    id: 'NaCl', name: 'Поваренная соль', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Na', yield: 3.9 },
      { elementId: 'Cl', yield: 6.1 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 4, processingTime: 200,
    prototype: 'Галит (NaCl)',
    molarFormula: 'NaCl', molarMass: 58.5,
  },

  // --- Дополнительные руды Карьера (не в mendeleev.md §3.2, но с реальной химией) ---
  {
    id: 'O-rock', name: 'Кислородсодержащие породы', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Si', yield: 3.0 },
      { elementId: 'O', yield: 5.0 },
      { elementId: 'Al', yield: 2.0 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 1,
    processingEnergyCost: 2, processingTime: 150,
    prototype: 'Кислородсодержащие силикаты',
    molarFormula: 'SiO₂+Al₂O₃',
  },
  {
    id: 'P-ore', name: 'Фосфорная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Ca', yield: 3.9 },
      { elementId: 'P', yield: 2.0 },
      { elementId: 'O', yield: 4.1 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Апатит (Ca₃(PO₄)₂)',
    molarFormula: 'Ca₃(PO₄)₂', molarMass: 310.3,
  },
  {
    id: 'Mg-ore', name: 'Магнезиальная руда', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Mg', yield: 2.9 },
      { elementId: 'C', yield: 1.4 },
      { elementId: 'O', yield: 5.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
    processingEnergyCost: 2, processingTime: 180,
    prototype: 'Магнезит (MgCO₃)',
    molarFormula: 'MgCO₃', molarMass: 84.3,
  },
  {
    id: 'Ba-ore-quarry', name: 'Бариевая руда (поверхностная)', type: 'nonmetal_ore',
    sourceBuildingId: 'quarry',
    containedElements: [
      { elementId: 'Ba', yield: 5.9 },
      { elementId: 'S', yield: 1.4 },
      { elementId: 'O', yield: 2.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Барит (BaSO₄)',
    molarFormula: 'BaSO₄', molarMass: 233.4,
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

// ============ Константы: Глубинные руды (§3.3 — 18 руд) ============
// Данные из docs/mendeleev.md §3.3 — расчёт по молярной массе

export const DEEP_ORES: OreDefinition[] = [
  {
    id: 'Y-ore', name: 'Иттриевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Y', yield: 4.8 },
      { elementId: 'P', yield: 1.7 },
      { elementId: 'O', yield: 3.5 },
    ],
    minSourceLevel: 2, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
    prototype: 'Ксенотим (YPO₄)',
    molarFormula: 'YPO₄', molarMass: 183.9,
  },
  {
    id: 'Ba-ore', name: 'Бариевая руда (глубинная)', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Ba', yield: 5.9 },
      { elementId: 'S', yield: 1.4 },
      { elementId: 'O', yield: 2.7 },
    ],
    minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 4,
    processingEnergyCost: 5, processingTime: 250,
    prototype: 'Барит (BaSO₄)',
    molarFormula: 'BaSO₄', molarMass: 233.4,
  },
  {
    id: 'Zr-ore', name: 'Циркониевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Zr', yield: 5.0 },
      { elementId: 'Si', yield: 1.5 },
      { elementId: 'O', yield: 3.5 },
    ],
    minSourceLevel: 3, processingBuildingId: 'processor', minProcessingLevel: 3,
    processingEnergyCost: 4, processingTime: 250,
    prototype: 'Циркон (ZrSiO₄)',
    molarFormula: 'ZrSiO₄', molarMass: 183.3,
  },
  {
    id: 'Be-ore', name: 'Бериллиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Be', yield: 0.5 },
      { elementId: 'Al', yield: 1.0 },
      { elementId: 'Si', yield: 3.1 },
      { elementId: 'O', yield: 5.4 },
    ],
    minSourceLevel: 3, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
    prototype: 'Берилл (Be₃Al₂Si₆O₁₈)',
    molarFormula: 'Be₃Al₂Si₆O₁₈', molarMass: 537.6,
  },
  {
    id: 'In-ore', name: 'Индиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'In', yield: 7.0 },
      { elementId: 'S', yield: 3.0 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Рожит (In₂S₃)',
    molarFormula: 'In₂S₃', molarMass: 325.9,
  },
  {
    id: 'Nd-ore', name: 'Неодимовая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Nd', yield: 6.0 },
      { elementId: 'P', yield: 1.3 },
      { elementId: 'O', yield: 2.7 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Монацит (NdPO₄)',
    molarFormula: 'NdPO₄', molarMass: 239.2,
  },
  {
    id: 'Ce-ore', name: 'Цериевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Ce', yield: 6.0 },
      { elementId: 'P', yield: 1.3 },
      { elementId: 'O', yield: 2.7 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Монацит (CePO₄)',
    molarFormula: 'CePO₄', molarMass: 235.1,
  },
  {
    id: 'La-ore', name: 'Лантановая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'La', yield: 5.9 },
      { elementId: 'P', yield: 1.3 },
      { elementId: 'O', yield: 2.7 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Монацит (LaPO₄)',
    molarFormula: 'LaPO₄', molarMass: 233.9,
  },
  {
    id: 'Dy-ore', name: 'Диспрозиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Dy', yield: 6.3 },
      { elementId: 'P', yield: 1.2 },
      { elementId: 'O', yield: 2.5 },
    ],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 9, processingTime: 350,
    prototype: 'Фергусонит (DyPO₄)',
    molarFormula: 'DyPO₄', molarMass: 257.5,
  },
  {
    id: 'Ir-ore', name: 'Иридиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Ir', yield: 7.5 },
      { elementId: 'S', yield: 2.5 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 10, processingTime: 350,
    prototype: 'Иридиевый сульфид (IrS₂)',
    molarFormula: 'IrS₂', molarMass: 256.4,
  },
  {
    id: 'Os-ore', name: 'Осмиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Os', yield: 7.5 },
      { elementId: 'S', yield: 2.5 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 10, processingTime: 350,
    prototype: 'Осмиевый сульфид (OsS₂)',
    molarFormula: 'OsS₂', molarMass: 254.4,
  },
  {
    id: 'Ru-ore', name: 'Рутениевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Ru', yield: 6.1 },
      { elementId: 'S', yield: 3.9 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Рутениевый сульфид (RuS₂)',
    molarFormula: 'RuS₂', molarMass: 165.3,
  },
  {
    id: 'Rh-ore', name: 'Родиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Rh', yield: 6.8 },
      { elementId: 'S', yield: 3.2 },
    ],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 7,
    processingEnergyCost: 9, processingTime: 350,
    prototype: 'Родиевый сульфид (Rh₂S₃)',
    molarFormula: 'Rh₂S₃', molarMass: 302.1,
  },
  {
    id: 'Pd-ore', name: 'Палладиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Pd', yield: 7.7 },
      { elementId: 'S', yield: 2.3 },
    ],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 8, processingTime: 300,
    prototype: 'Палладиевый сульфид (PdS)',
    molarFormula: 'PdS', molarMass: 138.5,
  },
  {
    id: 'Hf-ore', name: 'Гафниевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Hf', yield: 6.6 },
      { elementId: 'Si', yield: 1.0 },
      { elementId: 'O', yield: 2.4 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Гафниевый силикат (HfSiO₄)',
    molarFormula: 'HfSiO₄', molarMass: 270.6,
  },
  {
    id: 'Ta-ore', name: 'Танталовая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Ta', yield: 8.2 },
      { elementId: 'O', yield: 1.8 },
    ],
    minSourceLevel: 6, processingBuildingId: 'processor', minProcessingLevel: 6,
    processingEnergyCost: 7, processingTime: 300,
    prototype: 'Танталит (Ta₂O₅)',
    molarFormula: 'Ta₂O₅', molarMass: 441.8,
  },
  {
    id: 'Nb-ore', name: 'Ниобиевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Nb', yield: 7.0 },
      { elementId: 'O', yield: 3.0 },
    ],
    minSourceLevel: 5, processingBuildingId: 'processor', minProcessingLevel: 5,
    processingEnergyCost: 6, processingTime: 300,
    prototype: 'Колумбит (Nb₂O₅)',
    molarFormula: 'Nb₂O₅', molarMass: 265.8,
  },
  {
    id: 'Re-ore', name: 'Рениевая руда', type: 'deep_ore',
    sourceBuildingId: 'drilling_rig',
    containedElements: [
      { elementId: 'Re', yield: 7.4 },
      { elementId: 'S', yield: 2.6 },
    ],
    minSourceLevel: 8, processingBuildingId: 'processor', minProcessingLevel: 8,
    processingEnergyCost: 12, processingTime: 400,
    prototype: 'Рениевый сульфид (ReS₂)',
    molarFormula: 'ReS₂', molarMass: 250.4,
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
  // Шахта
  Fe: 'Fe-ore', Si: 'Si-ore', Ti: 'Ti-ore', Al: 'Al-ore',
  Cu: 'Cu-ore', Ni: 'Ni-ore', Cr: 'Cr-ore', W: 'W-ore',
  Co: 'Co-ore', Au: 'Au-ore', Pt: 'Pt-ore', U: 'U-ore',
  Li: 'Li-ore', V: 'V-ore', Mn: 'Mn-ore', Zn: 'Zn-ore',
  Sn: 'Sn-ore', Pb: 'Pb-ore', Mo: 'Mo-ore', Ag: 'Ag-ore',
  Cd: 'Cd-ore', Se: 'Se-ore',
  // Карьер
  C: 'C-ore', S: 'S-ore', K: 'K-ore', B: 'B-ore', F: 'F-ore',
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
  Te: 'Теллур',
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
