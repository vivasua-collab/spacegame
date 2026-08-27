/**
 * Block 05 — таблица категорий специализации переработчиков.
 *
 * Источник: docs/40-buildings.md §3 (после правки 08_27_doc_fixes.md §4).
 *
 * Каждая категория — это «узкая цепочка переработки», в которую можно
 * превратить универсальный `processor` через `specializeBuilding`.
 * Предельные специализированные формы:
 *   - `metal_smelting`   ↔ `refinery`
 *   - `alloy_synthesis`  ↔ `synthesizer`
 * Остальные 5 категорий существуют только как апгрейд универсального
 * `processor` (не имеют отдельного здания-предельной-формы).
 */

import type { ProcessorRecipeCategory } from '@/core/types';

export interface ProcessorCategoryDef {
  id: ProcessorRecipeCategory;
  /** Человеко-читаемое имя */
  name: string;
  /** Описание — какие ресурсы/рецепты попадают в категорию */
  description: string;
  /** Мин. уровень здания для выбора этой специализации */
  minBuildingLevel: number;
  /** Чистота на L1 (будет расти с specializationLevel до 0.99) */
  basePurity: number;
  /** Краткое описание бонуса для UI подсказки */
  bonusText?: string;
  /** Соответствующее здание-предельная-форма (для UI подсказки) */
  equivalentTo?: 'refinery' | 'synthesizer';
}

export const PROCESSOR_CATEGORIES: Map<ProcessorRecipeCategory, ProcessorCategoryDef> = new Map([
  ['metal_smelting', {
    id: 'metal_smelting',
    name: 'Плавка металлических руд',
    description: 'Fe, Ti, Cu, Cr, V, Ni, Mn, Zn, Sn, Pb, Co, W, Mo, Ag, Au, Pt, U и др.',
    minBuildingLevel: 3,
    basePurity: 0.92,
    bonusText: '+15% выход металлов; доступ к refine_au/pt/u через L5',
    equivalentTo: 'refinery',
  }],
  ['nonmetal_smelting', {
    id: 'nonmetal_smelting',
    name: 'Плавка неметаллических руд',
    description: 'Si, C, S, P, Mg, B — для электроники и химии',
    minBuildingLevel: 3,
    basePurity: 0.92,
    bonusText: '+10% выход Si и C; электронный кремний доступен с L3',
  }],
  ['chemical_decomp', {
    id: 'chemical_decomp',
    name: 'Химическое разложение',
    description: 'H2O→H+O, CO2→C+O, NH3→N+H, NaCl→Na+Cl, CaCO3→Ca+C+O и др.',
    minBuildingLevel: 3,
    basePurity: 0.92,
    bonusText: '+20% выход газов (H, O, N)',
  }],
  ['ice_melting', {
    id: 'ice_melting',
    name: 'Переработка льда',
    description: 'H2O-лед, CO2-лед, NH3-лед, CH4-лед — для колоний без атмосферы',
    minBuildingLevel: 3,
    basePurity: 0.93,
    bonusText: '+30% выход при работе с ледяными рудами',
  }],
  ['gas_processing', {
    id: 'gas_processing',
    name: 'Газовая переработка',
    description: 'Атмосферные газы (CO2, CH4, NH3, H2S, SO2) — добытые газовым экстрактором',
    minBuildingLevel: 4,
    basePurity: 0.93,
    bonusText: 'Доступна на газовых гигантах через атмосферные слоты',
  }],
  ['deep_ore_smelting', {
    id: 'deep_ore_smelting',
    name: 'Плавка глубинных руд',
    description: 'Y, Ba, Zr, Be, Nb, Hf, Ta, Re, Ir, Os, Ru, Rh, Pd, Nd, Ce, La, Dy, In — редкие и ультраредкие',
    minBuildingLevel: 5,
    basePurity: 0.95,
    bonusText: 'Требует ур. здания 5+; доступ к сверхпроводникам (Y, Ba, Cu)',
  }],
  ['alloy_synthesis', {
    id: 'alloy_synthesis',
    name: 'Синтез сплавов и материалов',
    description: 'Сталь, титановый сплав, пластик, кремниевый кристалл, сверхпроводник, синтетическое топливо, микрочип, бронеплита и др.',
    minBuildingLevel: 3,
    basePurity: 0.95,
    bonusText: 'Высшая чистота материалов; доступ к make_superconductor',
    equivalentTo: 'synthesizer',
  }],
]);

/** Получить определение категории по ID (с fallback на undefined) */
export function getProcessorCategoryDef(id: ProcessorRecipeCategory): ProcessorCategoryDef | undefined {
  return PROCESSOR_CATEGORIES.get(id);
}

/** Список всех категорий, доступных на указанном уровне здания */
export function getCategoriesForBuildingLevel(buildingLevel: number): ProcessorCategoryDef[] {
  const result: ProcessorCategoryDef[] = [];
  for (const def of PROCESSOR_CATEGORIES.values()) {
    if (buildingLevel >= def.minBuildingLevel) {
      result.push(def);
    }
  }
  return result;
}
