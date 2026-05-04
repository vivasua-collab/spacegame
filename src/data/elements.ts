/**
 * Определения элементов — 57 элементов для SpaceGame.
 * Расширенная таблица (версия 4.0) на основе docs/mendeleev.md.
 *
 * Категории:
 * - structural: строительные базовые материалы (Fe, Si, Al, C)
 * - fuel: топливные/энергетические (H, He)
 * - metal: промышленные металлы (Ti, Cr, Mn, Ni, Cu, Zn, Sn, Pb, V, Co, W, Mo, Nb, Ta, Re)
 * - chemical: химические/жизнеобеспечение (O, N, S, P)
 * - noble: благородные металлы и инертные газы (Au, Pt, Ag, Ru, Rh, Pd, Ir, Os, Ne, Ar)
 * - rare: редкие/стратегические (U, Zr, Hf)
 * - alkali: щелочные металлы (Li, Na, K)
 * - alkaline_earth: щёлочноземельные (Be, Mg, Ca, Ba)
 * - halogen: галогены (F, Cl)
 * - nonmetal: неметаллы (B, Se, Te)
 * - lanthanide: лантаноиды (Y, La, Ce, Nd, Dy)
 * - transmetal: переходные металлы для электроники (Cd, In)
 */

import type { ElementDef } from '@/core/types';

export const ELEMENTS: ElementDef[] = [
  // ============ Строительные — основа для застройки ============
  { id: 'Fe', name: 'Железо', symbol: 'Fe', category: 'structural', baseValue: 1, density: 7.87, isAtmospheric: false },
  { id: 'Si', name: 'Кремний', symbol: 'Si', category: 'structural', baseValue: 1.2, density: 2.33, isAtmospheric: false },
  { id: 'Al', name: 'Алюминий', symbol: 'Al', category: 'structural', baseValue: 1.5, density: 2.70, isAtmospheric: false },
  { id: 'C', name: 'Углерод', symbol: 'C', category: 'structural', baseValue: 0.8, density: 2.27, isAtmospheric: false },

  // ============ Топливные — для энергетики и двигателей ============
  { id: 'H', name: 'Водород', symbol: 'H', category: 'fuel', baseValue: 0.5, density: 0.00009, isAtmospheric: true },
  { id: 'He', name: 'Гелий', symbol: 'He', category: 'fuel', baseValue: 0.6, density: 0.00018, isAtmospheric: true },

  // ============ Химические — жизнеобеспечение и хим. производство ============
  { id: 'O', name: 'Кислород', symbol: 'O', category: 'chemical', baseValue: 0.3, density: 0.00143, isAtmospheric: true },
  { id: 'N', name: 'Азот', symbol: 'N', category: 'chemical', baseValue: 0.4, density: 0.00125, isAtmospheric: true },
  { id: 'S', name: 'Сера', symbol: 'S', category: 'chemical', baseValue: 0.6, density: 2.07, isAtmospheric: false },
  { id: 'P', name: 'Фосфор', symbol: 'P', category: 'chemical', baseValue: 0.8, density: 1.82, isAtmospheric: false },

  // ============ Щелочные металлы ============
  { id: 'Li', name: 'Литий', symbol: 'Li', category: 'alkali', baseValue: 6, density: 0.53, isAtmospheric: false },
  { id: 'Na', name: 'Натрий', symbol: 'Na', category: 'alkali', baseValue: 0.5, density: 0.97, isAtmospheric: false },
  { id: 'K', name: 'Калий', symbol: 'K', category: 'alkali', baseValue: 0.5, density: 0.86, isAtmospheric: false },

  // ============ Щёлочноземельные металлы ============
  { id: 'Be', name: 'Бериллий', symbol: 'Be', category: 'alkaline_earth', baseValue: 8, density: 1.85, isAtmospheric: false },
  { id: 'Mg', name: 'Магний', symbol: 'Mg', category: 'alkaline_earth', baseValue: 1.2, density: 1.74, isAtmospheric: false },
  { id: 'Ca', name: 'Кальций', symbol: 'Ca', category: 'alkaline_earth', baseValue: 0.6, density: 1.55, isAtmospheric: false },
  { id: 'Ba', name: 'Барий', symbol: 'Ba', category: 'alkaline_earth', baseValue: 3, density: 3.51, isAtmospheric: false },

  // ============ Галогены ============
  { id: 'F', name: 'Фтор', symbol: 'F', category: 'halogen', baseValue: 2, density: 0.0017, isAtmospheric: false },
  { id: 'Cl', name: 'Хлор', symbol: 'Cl', category: 'halogen', baseValue: 0.8, density: 0.0032, isAtmospheric: false },

  // ============ Неметаллы ============
  { id: 'B', name: 'Бор', symbol: 'B', category: 'nonmetal', baseValue: 5, density: 2.34, isAtmospheric: false },
  { id: 'Se', name: 'Селен', symbol: 'Se', category: 'nonmetal', baseValue: 8, density: 4.81, isAtmospheric: false },
  { id: 'Te', name: 'Теллур', symbol: 'Te', category: 'nonmetal', baseValue: 10, density: 6.24, isAtmospheric: false },

  // ============ Металлы — промышленные ============
  { id: 'Ti', name: 'Титан', symbol: 'Ti', category: 'metal', baseValue: 3, density: 4.51, isAtmospheric: false },
  { id: 'Cr', name: 'Хром', symbol: 'Cr', category: 'metal', baseValue: 2.5, density: 7.19, isAtmospheric: false },
  { id: 'Mn', name: 'Марганец', symbol: 'Mn', category: 'metal', baseValue: 1.5, density: 7.21, isAtmospheric: false },
  { id: 'Ni', name: 'Никель', symbol: 'Ni', category: 'metal', baseValue: 2.8, density: 8.91, isAtmospheric: false },
  { id: 'Cu', name: 'Медь', symbol: 'Cu', category: 'metal', baseValue: 2, density: 8.96, isAtmospheric: false },
  { id: 'Zn', name: 'Цинк', symbol: 'Zn', category: 'metal', baseValue: 1.5, density: 7.13, isAtmospheric: false },
  { id: 'Sn', name: 'Олово', symbol: 'Sn', category: 'metal', baseValue: 2, density: 7.31, isAtmospheric: false },
  { id: 'Pb', name: 'Свинец', symbol: 'Pb', category: 'metal', baseValue: 1.5, density: 11.34, isAtmospheric: false },
  { id: 'V', name: 'Ванадий', symbol: 'V', category: 'metal', baseValue: 5, density: 6.11, isAtmospheric: false },
  { id: 'Co', name: 'Кобальт', symbol: 'Co', category: 'metal', baseValue: 4, density: 8.90, isAtmospheric: false },
  { id: 'W', name: 'Вольфрам', symbol: 'W', category: 'metal', baseValue: 5, density: 19.25, isAtmospheric: false },
  { id: 'Mo', name: 'Молибден', symbol: 'Mo', category: 'metal', baseValue: 3.5, density: 10.28, isAtmospheric: false },
  { id: 'Nb', name: 'Ниобий', symbol: 'Nb', category: 'metal', baseValue: 5, density: 8.57, isAtmospheric: false },
  { id: 'Ta', name: 'Тантал', symbol: 'Ta', category: 'metal', baseValue: 8, density: 16.65, isAtmospheric: false },
  { id: 'Re', name: 'Рений', symbol: 'Re', category: 'metal', baseValue: 12, density: 21.02, isAtmospheric: false },

  // ============ Благородные металлы ============
  { id: 'Au', name: 'Золото', symbol: 'Au', category: 'noble', baseValue: 15, density: 19.32, isAtmospheric: false },
  { id: 'Pt', name: 'Платина', symbol: 'Pt', category: 'noble', baseValue: 20, density: 21.45, isAtmospheric: false },
  { id: 'Ag', name: 'Серебро', symbol: 'Ag', category: 'noble', baseValue: 12, density: 10.49, isAtmospheric: false },
  { id: 'Ru', name: 'Рутений', symbol: 'Ru', category: 'noble', baseValue: 18, density: 12.45, isAtmospheric: false },
  { id: 'Rh', name: 'Родий', symbol: 'Rh', category: 'noble', baseValue: 22, density: 12.41, isAtmospheric: false },
  { id: 'Pd', name: 'Палладий', symbol: 'Pd', category: 'noble', baseValue: 18, density: 12.02, isAtmospheric: false },
  { id: 'Ir', name: 'Иридий', symbol: 'Ir', category: 'noble', baseValue: 25, density: 22.56, isAtmospheric: false },
  { id: 'Os', name: 'Осмий', symbol: 'Os', category: 'noble', baseValue: 20, density: 22.59, isAtmospheric: false },

  // ============ Лантаноиды ============
  { id: 'Y', name: 'Иттрий', symbol: 'Y', category: 'lanthanide', baseValue: 12, density: 4.47, isAtmospheric: false },
  { id: 'La', name: 'Лантан', symbol: 'La', category: 'lanthanide', baseValue: 10, density: 6.15, isAtmospheric: false },
  { id: 'Ce', name: 'Церий', symbol: 'Ce', category: 'lanthanide', baseValue: 10, density: 6.77, isAtmospheric: false },
  { id: 'Nd', name: 'Неодим', symbol: 'Nd', category: 'lanthanide', baseValue: 15, density: 7.01, isAtmospheric: false },
  { id: 'Dy', name: 'Диспрозий', symbol: 'Dy', category: 'lanthanide', baseValue: 18, density: 8.55, isAtmospheric: false },

  // ============ Редкие/стратегические ============
  { id: 'U', name: 'Уран', symbol: 'U', category: 'rare', baseValue: 10, density: 19.05, isAtmospheric: false },
  { id: 'Zr', name: 'Цирконий', symbol: 'Zr', category: 'rare', baseValue: 5, density: 6.52, isAtmospheric: false },
  { id: 'Hf', name: 'Гафний', symbol: 'Hf', category: 'rare', baseValue: 8, density: 13.31, isAtmospheric: false },

  // ============ Переходные металлы для электроники ============
  { id: 'Cd', name: 'Кадмий', symbol: 'Cd', category: 'transmetal', baseValue: 5, density: 8.65, isAtmospheric: false },
  { id: 'In', name: 'Индий', symbol: 'In', category: 'transmetal', baseValue: 8, density: 7.31, isAtmospheric: false },

  // ============ Инертные газы (атмосферные) ============
  { id: 'Ne', name: 'Неон', symbol: 'Ne', category: 'noble', baseValue: 1, density: 0.0009, isAtmospheric: true },
  { id: 'Ar', name: 'Аргон', symbol: 'Ar', category: 'noble', baseValue: 0.8, density: 0.0018, isAtmospheric: true },
];

export const ELEMENT_MAP = new Map(ELEMENTS.map(e => [e.id, e]));

/** Получить элементы по категории */
export function getElementsByCategory(category: string): ElementDef[] {
  return ELEMENTS.filter(e => e.category === category);
}
