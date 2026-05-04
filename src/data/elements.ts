/**
 * Определения элементов — 22 элемента для MVP.
 * Базовые 20 + V (Ванадий, P1-12), Y (Иттрий), Ba (Барий) для рецепта сверхпроводника.
 *
 * Категории переработаны (версия 3.0):
 * - structural: строительные базовые материалы (Fe, Si, Al, C)
 * - fuel: топливные/энергетические (H, He)
 * - metal: промышленные металлы (Ti, Cr, Ni, V, Cu, Co, W, Li)
 * - chemical: химические/жизнеобеспечение (O, N, S)
 * - noble: благородные металлы для электроники (Au, Pt)
 * - rare: редкие/стратегические (U, Y, Ba)
 *
 * Примечание: 'alloy' заменён на 'metal' — Ti, Cr, Ni, V являются чистыми МЕТАЛЛАМИ,
 * а не сплавами. Сплавы (steel, titanium_alloy) — это продукты переработки уровня 2.
 */

import type { ElementDef } from '@/core/types';

export const ELEMENTS: ElementDef[] = [
  // Строительные — основа для застройки
  { id: 'Fe', name: 'Железо', symbol: 'Fe', category: 'structural', baseValue: 1, density: 7.87, isAtmospheric: false },
  { id: 'Si', name: 'Кремний', symbol: 'Si', category: 'structural', baseValue: 1.2, density: 2.33, isAtmospheric: false },
  { id: 'Al', name: 'Алюминий', symbol: 'Al', category: 'structural', baseValue: 1.5, density: 2.70, isAtmospheric: false },
  { id: 'C', name: 'Углерод', symbol: 'C', category: 'structural', baseValue: 0.8, density: 2.27, isAtmospheric: false },

  // Топливные — для энергетики и двигателей
  { id: 'H', name: 'Водород', symbol: 'H', category: 'fuel', baseValue: 0.5, density: 0.00009, isAtmospheric: true },
  { id: 'He', name: 'Гелий', symbol: 'He', category: 'fuel', baseValue: 0.6, density: 0.00018, isAtmospheric: true },

  // Металлы — промышленные металлы (НЕ сплавы!)
  { id: 'Ti', name: 'Титан', symbol: 'Ti', category: 'metal', baseValue: 3, density: 4.51, isAtmospheric: false },
  { id: 'Cr', name: 'Хром', symbol: 'Cr', category: 'metal', baseValue: 2.5, density: 7.19, isAtmospheric: false },
  { id: 'Ni', name: 'Никель', symbol: 'Ni', category: 'metal', baseValue: 2.8, density: 8.91, isAtmospheric: false },
  { id: 'V', name: 'Ванадий', symbol: 'V', category: 'metal', baseValue: 5, density: 6.11, isAtmospheric: false },
  { id: 'Cu', name: 'Медь', symbol: 'Cu', category: 'metal', baseValue: 2, density: 8.96, isAtmospheric: false },
  { id: 'Co', name: 'Кобальт', symbol: 'Co', category: 'metal', baseValue: 4, density: 8.90, isAtmospheric: false },
  { id: 'W', name: 'Вольфрам', symbol: 'W', category: 'metal', baseValue: 5, density: 19.25, isAtmospheric: false },
  { id: 'Li', name: 'Литий', symbol: 'Li', category: 'metal', baseValue: 6, density: 0.53, isAtmospheric: false },

  // Химические — жизнеобеспечение и хим. производство
  { id: 'O', name: 'Кислород', symbol: 'O', category: 'chemical', baseValue: 0.3, density: 0.00143, isAtmospheric: true },
  { id: 'N', name: 'Азот', symbol: 'N', category: 'chemical', baseValue: 0.4, density: 0.00125, isAtmospheric: true },
  { id: 'S', name: 'Сера', symbol: 'S', category: 'chemical', baseValue: 0.6, density: 2.07, isAtmospheric: false },

  // Благородные — для электроники и высоких технологий
  { id: 'Au', name: 'Золото', symbol: 'Au', category: 'noble', baseValue: 15, density: 19.32, isAtmospheric: false },
  { id: 'Pt', name: 'Платина', symbol: 'Pt', category: 'noble', baseValue: 20, density: 21.45, isAtmospheric: false },

  // Редкие — стратегические элементы
  { id: 'U', name: 'Уран', symbol: 'U', category: 'rare', baseValue: 10, density: 19.05, isAtmospheric: false },
  { id: 'Y', name: 'Иттрий', symbol: 'Y', category: 'rare', baseValue: 12, density: 4.47, isAtmospheric: false },
  { id: 'Ba', name: 'Барий', symbol: 'Ba', category: 'rare', baseValue: 3, density: 3.51, isAtmospheric: false },
];

export const ELEMENT_MAP = new Map(ELEMENTS.map(e => [e.id, e]));

/** Получить элементы по категории */
export function getElementsByCategory(category: string): ElementDef[] {
  return ELEMENTS.filter(e => e.category === category);
}
