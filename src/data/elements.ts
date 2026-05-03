/**
 * Определения элементов — 22 элемента для MVP.
 * Базовые 20 + V (Ванадий, P1-12), Y (Иттрий), Ba (Барий) для рецепта сверхпроводника.
 * Порядок и категории соответствуют документации ARCHITECTURE.md §3.1.3.
 */

import type { ElementDef } from '@/core/types';

export const ELEMENTS: ElementDef[] = [
  // Строительные
  { id: 'Fe', name: 'Железо', symbol: 'Fe', category: 'structural', baseValue: 1, density: 7.87, isAtmospheric: false },
  { id: 'Si', name: 'Кремний', symbol: 'Si', category: 'structural', baseValue: 1.2, density: 2.33, isAtmospheric: false },
  { id: 'Al', name: 'Алюминий', symbol: 'Al', category: 'structural', baseValue: 1.5, density: 2.70, isAtmospheric: false },
  { id: 'C', name: 'Углерод', symbol: 'C', category: 'structural', baseValue: 0.8, density: 2.27, isAtmospheric: true },

  // Топливные
  { id: 'H', name: 'Водород', symbol: 'H', category: 'fuel', baseValue: 0.5, density: 0.00009, isAtmospheric: true },
  { id: 'He', name: 'Гелий', symbol: 'He', category: 'fuel', baseValue: 0.6, density: 0.00018, isAtmospheric: true },

  // Сплавы
  { id: 'Ti', name: 'Титан', symbol: 'Ti', category: 'alloy', baseValue: 3, density: 4.51, isAtmospheric: false },
  { id: 'Cr', name: 'Хром', symbol: 'Cr', category: 'alloy', baseValue: 2.5, density: 7.19, isAtmospheric: false },
  { id: 'Ni', name: 'Никель', symbol: 'Ni', category: 'alloy', baseValue: 2.8, density: 8.91, isAtmospheric: false },
  { id: 'V', name: 'Ванадий', symbol: 'V', category: 'alloy', baseValue: 5, density: 6.11, isAtmospheric: false },

  // Электроника
  { id: 'Cu', name: 'Медь', symbol: 'Cu', category: 'electronics', baseValue: 2, density: 8.96, isAtmospheric: false },
  { id: 'Au', name: 'Золото', symbol: 'Au', category: 'electronics', baseValue: 15, density: 19.32, isAtmospheric: false },

  // Химия
  { id: 'O', name: 'Кислород', symbol: 'O', category: 'chemical', baseValue: 0.3, density: 0.00143, isAtmospheric: true },
  { id: 'N', name: 'Азот', symbol: 'N', category: 'chemical', baseValue: 0.4, density: 0.00125, isAtmospheric: true },
  { id: 'S', name: 'Сера', symbol: 'S', category: 'chemical', baseValue: 0.6, density: 2.07, isAtmospheric: true },

  // Энергия
  { id: 'U', name: 'Уран', symbol: 'U', category: 'energy', baseValue: 10, density: 19.05, isAtmospheric: false },

  // Редкие
  { id: 'W', name: 'Вольфрам', symbol: 'W', category: 'rare', baseValue: 5, density: 19.25, isAtmospheric: false },
  { id: 'Co', name: 'Кобальт', symbol: 'Co', category: 'rare', baseValue: 4, density: 8.90, isAtmospheric: false },
  { id: 'Pt', name: 'Платина', symbol: 'Pt', category: 'rare', baseValue: 20, density: 21.45, isAtmospheric: false },

  // Лёгкие
  { id: 'Li', name: 'Литий', symbol: 'Li', category: 'light', baseValue: 6, density: 0.53, isAtmospheric: false },

  // Для сверхпроводника (рецепт из ARCHITECTURE.md §3.2.2)
  { id: 'Y', name: 'Иттрий', symbol: 'Y', category: 'rare', baseValue: 12, density: 4.47, isAtmospheric: false },
  { id: 'Ba', name: 'Барий', symbol: 'Ba', category: 'rare', baseValue: 3, density: 3.51, isAtmospheric: false },
];

export const ELEMENT_MAP = new Map(ELEMENTS.map(e => [e.id, e]));

/** Получить элементы по категории */
export function getElementsByCategory(category: string): ElementDef[] {
  return ELEMENTS.filter(e => e.category === category);
}
