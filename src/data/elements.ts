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

import type { ElementDef, ChemicalCharacter, ElementRarity } from '@/core/types';

export const ELEMENTS: ElementDef[] = [
  // ============ Строительные — основа для застройки ============
  { id: 'Fe', name: 'Железо', symbol: 'Fe', category: 'structural', baseValue: 1, density: 7.87, isAtmospheric: false,
    atomicNumber: 26, atomicMass: 55.8, chemicalCharacter: 'reactive_metal', oxidationState: 3, rarity: 'abundant' },
  { id: 'Si', name: 'Кремний', symbol: 'Si', category: 'structural', baseValue: 1.2, density: 2.33, isAtmospheric: false,
    atomicNumber: 14, atomicMass: 28.1, chemicalCharacter: 'reactive_nonmetal', oxidationState: 4, rarity: 'abundant' },
  { id: 'Al', name: 'Алюминий', symbol: 'Al', category: 'structural', baseValue: 1.5, density: 2.70, isAtmospheric: false,
    atomicNumber: 13, atomicMass: 27.0, chemicalCharacter: 'reactive_metal', oxidationState: 3, rarity: 'abundant' },
  { id: 'C', name: 'Углерод', symbol: 'C', category: 'structural', baseValue: 0.8, density: 2.27, isAtmospheric: false,
    atomicNumber: 6, atomicMass: 12.0, chemicalCharacter: 'reactive_nonmetal', oxidationState: 4, rarity: 'abundant' },

  // ============ Топливные — для энергетики и двигателей ============
  { id: 'H', name: 'Водород', symbol: 'H', category: 'fuel', baseValue: 0.5, density: 0.00009, isAtmospheric: true,
    atomicNumber: 1, atomicMass: 1.0, chemicalCharacter: 'gas', oxidationState: 1, rarity: 'abundant' },
  { id: 'He', name: 'Гелий', symbol: 'He', category: 'fuel', baseValue: 0.6, density: 0.00018, isAtmospheric: true,
    atomicNumber: 2, atomicMass: 4.0, chemicalCharacter: 'gas', oxidationState: 0, rarity: 'abundant' },

  // ============ Химические — жизнеобеспечение и хим. производство ============
  { id: 'O', name: 'Кислород', symbol: 'O', category: 'chemical', baseValue: 0.3, density: 0.00143, isAtmospheric: true,
    atomicNumber: 8, atomicMass: 16.0, chemicalCharacter: 'gas', oxidationState: -2, rarity: 'abundant' },
  { id: 'N', name: 'Азот', symbol: 'N', category: 'chemical', baseValue: 0.4, density: 0.00125, isAtmospheric: true,
    atomicNumber: 7, atomicMass: 14.0, chemicalCharacter: 'gas', oxidationState: -3, rarity: 'abundant' },
  { id: 'S', name: 'Сера', symbol: 'S', category: 'chemical', baseValue: 0.6, density: 2.07, isAtmospheric: false,
    atomicNumber: 16, atomicMass: 32.1, chemicalCharacter: 'reactive_nonmetal', oxidationState: -2, rarity: 'common' },
  { id: 'P', name: 'Фосфор', symbol: 'P', category: 'chemical', baseValue: 0.8, density: 1.82, isAtmospheric: false,
    atomicNumber: 15, atomicMass: 31.0, chemicalCharacter: 'reactive_nonmetal', oxidationState: 5, rarity: 'common' },

  // ============ Щелочные металлы ============
  { id: 'Li', name: 'Литий', symbol: 'Li', category: 'alkali', baseValue: 6, density: 0.53, isAtmospheric: false,
    atomicNumber: 3, atomicMass: 6.9, chemicalCharacter: 'alkali', oxidationState: 1, rarity: 'rare' },
  { id: 'Na', name: 'Натрий', symbol: 'Na', category: 'alkali', baseValue: 0.5, density: 0.97, isAtmospheric: false,
    atomicNumber: 11, atomicMass: 23.0, chemicalCharacter: 'alkali', oxidationState: 1, rarity: 'abundant' },
  { id: 'K', name: 'Калий', symbol: 'K', category: 'alkali', baseValue: 0.5, density: 0.86, isAtmospheric: false,
    atomicNumber: 19, atomicMass: 39.1, chemicalCharacter: 'alkali', oxidationState: 1, rarity: 'abundant' },

  // ============ Щёлочноземельные металлы ============
  { id: 'Be', name: 'Бериллий', symbol: 'Be', category: 'alkaline_earth', baseValue: 8, density: 1.85, isAtmospheric: false,
    atomicNumber: 4, atomicMass: 9.0, chemicalCharacter: 'alkaline_earth', oxidationState: 2, rarity: 'ultra_rare' },
  { id: 'Mg', name: 'Магний', symbol: 'Mg', category: 'alkaline_earth', baseValue: 1.2, density: 1.74, isAtmospheric: false,
    atomicNumber: 12, atomicMass: 24.3, chemicalCharacter: 'alkaline_earth', oxidationState: 2, rarity: 'abundant' },
  { id: 'Ca', name: 'Кальций', symbol: 'Ca', category: 'alkaline_earth', baseValue: 0.6, density: 1.55, isAtmospheric: false,
    atomicNumber: 20, atomicMass: 40.1, chemicalCharacter: 'alkaline_earth', oxidationState: 2, rarity: 'abundant' },
  { id: 'Ba', name: 'Барий', symbol: 'Ba', category: 'alkaline_earth', baseValue: 3, density: 3.51, isAtmospheric: false,
    atomicNumber: 56, atomicMass: 137.3, chemicalCharacter: 'alkaline_earth', oxidationState: 2, rarity: 'rare' },

  // ============ Галогены ============
  { id: 'F', name: 'Фтор', symbol: 'F', category: 'halogen', baseValue: 2, density: 0.0017, isAtmospheric: false,
    atomicNumber: 9, atomicMass: 19.0, chemicalCharacter: 'halogen', oxidationState: -1, rarity: 'common' },
  { id: 'Cl', name: 'Хлор', symbol: 'Cl', category: 'halogen', baseValue: 0.8, density: 0.0032, isAtmospheric: false,
    atomicNumber: 17, atomicMass: 35.5, chemicalCharacter: 'halogen', oxidationState: -1, rarity: 'common' },

  // ============ Неметаллы ============
  { id: 'B', name: 'Бор', symbol: 'B', category: 'nonmetal', baseValue: 5, density: 2.34, isAtmospheric: false,
    atomicNumber: 5, atomicMass: 10.8, chemicalCharacter: 'reactive_nonmetal', oxidationState: 3, rarity: 'rare' },
  { id: 'Se', name: 'Селен', symbol: 'Se', category: 'nonmetal', baseValue: 8, density: 4.81, isAtmospheric: false,
    atomicNumber: 34, atomicMass: 79.0, chemicalCharacter: 'reactive_nonmetal', oxidationState: -2, rarity: 'ultra_rare' },
  { id: 'Te', name: 'Теллур', symbol: 'Te', category: 'nonmetal', baseValue: 10, density: 6.24, isAtmospheric: false,
    atomicNumber: 52, atomicMass: 127.6, chemicalCharacter: 'reactive_nonmetal', oxidationState: -2, rarity: 'ultra_rare' },

  // ============ Металлы — промышленные ============
  { id: 'Ti', name: 'Титан', symbol: 'Ti', category: 'metal', baseValue: 3, density: 4.51, isAtmospheric: false,
    atomicNumber: 22, atomicMass: 47.9, chemicalCharacter: 'reactive_metal', oxidationState: 4, rarity: 'common' },
  { id: 'Cr', name: 'Хром', symbol: 'Cr', category: 'metal', baseValue: 2.5, density: 7.19, isAtmospheric: false,
    atomicNumber: 24, atomicMass: 52.0, chemicalCharacter: 'reactive_metal', oxidationState: 3, rarity: 'common' },
  { id: 'Mn', name: 'Марганец', symbol: 'Mn', category: 'metal', baseValue: 1.5, density: 7.21, isAtmospheric: false,
    atomicNumber: 25, atomicMass: 54.9, chemicalCharacter: 'reactive_metal', oxidationState: 4, rarity: 'common' },
  { id: 'Ni', name: 'Никель', symbol: 'Ni', category: 'metal', baseValue: 2.8, density: 8.91, isAtmospheric: false,
    atomicNumber: 28, atomicMass: 58.7, chemicalCharacter: 'reactive_metal', oxidationState: 2, rarity: 'common' },
  { id: 'Cu', name: 'Медь', symbol: 'Cu', category: 'metal', baseValue: 2, density: 8.96, isAtmospheric: false,
    atomicNumber: 29, atomicMass: 63.5, chemicalCharacter: 'reactive_metal', oxidationState: 1, rarity: 'common' },
  { id: 'Zn', name: 'Цинк', symbol: 'Zn', category: 'metal', baseValue: 1.5, density: 7.13, isAtmospheric: false,
    atomicNumber: 30, atomicMass: 65.4, chemicalCharacter: 'reactive_metal', oxidationState: 2, rarity: 'common' },
  { id: 'Sn', name: 'Олово', symbol: 'Sn', category: 'metal', baseValue: 2, density: 7.31, isAtmospheric: false,
    atomicNumber: 50, atomicMass: 118.7, chemicalCharacter: 'reactive_metal', oxidationState: 4, rarity: 'common' },
  { id: 'Pb', name: 'Свинец', symbol: 'Pb', category: 'metal', baseValue: 1.5, density: 11.34, isAtmospheric: false,
    atomicNumber: 82, atomicMass: 207.2, chemicalCharacter: 'reactive_metal', oxidationState: 2, rarity: 'common' },
  { id: 'V', name: 'Ванадий', symbol: 'V', category: 'metal', baseValue: 5, density: 6.11, isAtmospheric: false,
    atomicNumber: 23, atomicMass: 50.9, chemicalCharacter: 'reactive_metal', oxidationState: 5, rarity: 'rare' },
  { id: 'Co', name: 'Кобальт', symbol: 'Co', category: 'metal', baseValue: 4, density: 8.90, isAtmospheric: false,
    atomicNumber: 27, atomicMass: 58.9, chemicalCharacter: 'reactive_metal', oxidationState: 2, rarity: 'rare' },
  { id: 'W', name: 'Вольфрам', symbol: 'W', category: 'metal', baseValue: 5, density: 19.25, isAtmospheric: false,
    atomicNumber: 74, atomicMass: 183.8, chemicalCharacter: 'reactive_metal', oxidationState: 6, rarity: 'rare' },
  { id: 'Mo', name: 'Молибден', symbol: 'Mo', category: 'metal', baseValue: 3.5, density: 10.28, isAtmospheric: false,
    atomicNumber: 42, atomicMass: 95.9, chemicalCharacter: 'reactive_metal', oxidationState: 4, rarity: 'rare' },
  { id: 'Nb', name: 'Ниобий', symbol: 'Nb', category: 'metal', baseValue: 5, density: 8.57, isAtmospheric: false,
    atomicNumber: 41, atomicMass: 92.9, chemicalCharacter: 'refractory_metal', oxidationState: 5, rarity: 'ultra_rare' },
  { id: 'Ta', name: 'Тантал', symbol: 'Ta', category: 'metal', baseValue: 8, density: 16.65, isAtmospheric: false,
    atomicNumber: 73, atomicMass: 180.9, chemicalCharacter: 'refractory_metal', oxidationState: 5, rarity: 'ultra_rare' },
  { id: 'Re', name: 'Рений', symbol: 'Re', category: 'metal', baseValue: 12, density: 21.02, isAtmospheric: false,
    atomicNumber: 75, atomicMass: 186.2, chemicalCharacter: 'refractory_metal', oxidationState: 4, rarity: 'ultra_rare' },

  // ============ Благородные металлы ============
  { id: 'Au', name: 'Золото', symbol: 'Au', category: 'noble', baseValue: 15, density: 19.32, isAtmospheric: false,
    atomicNumber: 79, atomicMass: 197.0, chemicalCharacter: 'noble_metal', oxidationState: 3, rarity: 'ultra_rare' },
  { id: 'Pt', name: 'Платина', symbol: 'Pt', category: 'noble', baseValue: 20, density: 21.45, isAtmospheric: false,
    atomicNumber: 78, atomicMass: 195.1, chemicalCharacter: 'noble_metal', oxidationState: 4, rarity: 'ultra_rare' },
  { id: 'Ag', name: 'Серебро', symbol: 'Ag', category: 'noble', baseValue: 12, density: 10.49, isAtmospheric: false,
    atomicNumber: 47, atomicMass: 107.9, chemicalCharacter: 'noble_metal', oxidationState: 1, rarity: 'rare' },
  { id: 'Ru', name: 'Рутений', symbol: 'Ru', category: 'noble', baseValue: 18, density: 12.45, isAtmospheric: false,
    atomicNumber: 44, atomicMass: 101.1, chemicalCharacter: 'platinoid', oxidationState: 4, rarity: 'ultra_rare' },
  { id: 'Rh', name: 'Родий', symbol: 'Rh', category: 'noble', baseValue: 22, density: 12.41, isAtmospheric: false,
    atomicNumber: 45, atomicMass: 102.9, chemicalCharacter: 'platinoid', oxidationState: 3, rarity: 'ultra_rare' },
  { id: 'Pd', name: 'Палладий', symbol: 'Pd', category: 'noble', baseValue: 18, density: 12.02, isAtmospheric: false,
    atomicNumber: 46, atomicMass: 106.4, chemicalCharacter: 'platinoid', oxidationState: 2, rarity: 'ultra_rare' },
  { id: 'Ir', name: 'Иридий', symbol: 'Ir', category: 'noble', baseValue: 25, density: 22.56, isAtmospheric: false,
    atomicNumber: 77, atomicMass: 192.2, chemicalCharacter: 'platinoid', oxidationState: 4, rarity: 'ultra_rare' },
  { id: 'Os', name: 'Осмий', symbol: 'Os', category: 'noble', baseValue: 20, density: 22.59, isAtmospheric: false,
    atomicNumber: 76, atomicMass: 190.2, chemicalCharacter: 'platinoid', oxidationState: 4, rarity: 'ultra_rare' },

  // ============ Лантаноиды ============
  { id: 'Y', name: 'Иттрий', symbol: 'Y', category: 'lanthanide', baseValue: 12, density: 4.47, isAtmospheric: false,
    atomicNumber: 39, atomicMass: 88.9, chemicalCharacter: 'rare_earth', oxidationState: 3, rarity: 'ultra_rare' },
  { id: 'La', name: 'Лантан', symbol: 'La', category: 'lanthanide', baseValue: 10, density: 6.15, isAtmospheric: false,
    atomicNumber: 57, atomicMass: 138.9, chemicalCharacter: 'rare_earth', oxidationState: 3, rarity: 'ultra_rare' },
  { id: 'Ce', name: 'Церий', symbol: 'Ce', category: 'lanthanide', baseValue: 10, density: 6.77, isAtmospheric: false,
    atomicNumber: 58, atomicMass: 140.1, chemicalCharacter: 'rare_earth', oxidationState: 3, rarity: 'ultra_rare' },
  { id: 'Nd', name: 'Неодим', symbol: 'Nd', category: 'lanthanide', baseValue: 15, density: 7.01, isAtmospheric: false,
    atomicNumber: 60, atomicMass: 144.2, chemicalCharacter: 'rare_earth', oxidationState: 3, rarity: 'ultra_rare' },
  { id: 'Dy', name: 'Диспрозий', symbol: 'Dy', category: 'lanthanide', baseValue: 18, density: 8.55, isAtmospheric: false,
    atomicNumber: 66, atomicMass: 162.5, chemicalCharacter: 'rare_earth', oxidationState: 3, rarity: 'ultra_rare' },

  // ============ Редкие/стратегические ============
  { id: 'U', name: 'Уран', symbol: 'U', category: 'rare', baseValue: 10, density: 19.05, isAtmospheric: false,
    atomicNumber: 92, atomicMass: 238.0, chemicalCharacter: 'reactive_metal', oxidationState: 4, rarity: 'ultra_rare' },
  { id: 'Zr', name: 'Цирконий', symbol: 'Zr', category: 'rare', baseValue: 5, density: 6.52, isAtmospheric: false,
    atomicNumber: 40, atomicMass: 91.2, chemicalCharacter: 'refractory_metal', oxidationState: 4, rarity: 'rare' },
  { id: 'Hf', name: 'Гафний', symbol: 'Hf', category: 'rare', baseValue: 8, density: 13.31, isAtmospheric: false,
    atomicNumber: 72, atomicMass: 178.5, chemicalCharacter: 'refractory_metal', oxidationState: 4, rarity: 'ultra_rare' },

  // ============ Переходные металлы для электроники ============
  { id: 'Cd', name: 'Кадмий', symbol: 'Cd', category: 'transmetal', baseValue: 5, density: 8.65, isAtmospheric: false,
    atomicNumber: 48, atomicMass: 112.4, chemicalCharacter: 'reactive_metal', oxidationState: 2, rarity: 'rare' },
  { id: 'In', name: 'Индий', symbol: 'In', category: 'transmetal', baseValue: 8, density: 7.31, isAtmospheric: false,
    atomicNumber: 49, atomicMass: 114.8, chemicalCharacter: 'reactive_metal', oxidationState: 3, rarity: 'ultra_rare' },

  // ============ Инертные газы (атмосферные) ============
  { id: 'Ne', name: 'Неон', symbol: 'Ne', category: 'noble', baseValue: 1, density: 0.0009, isAtmospheric: true,
    atomicNumber: 10, atomicMass: 20.2, chemicalCharacter: 'gas', oxidationState: 0, rarity: 'abundant' },
  { id: 'Ar', name: 'Аргон', symbol: 'Ar', category: 'noble', baseValue: 0.8, density: 0.0018, isAtmospheric: true,
    atomicNumber: 18, atomicMass: 39.9, chemicalCharacter: 'gas', oxidationState: 0, rarity: 'abundant' },
];

export const ELEMENT_MAP = new Map(ELEMENTS.map(e => [e.id, e]));

/** Получить элементы по категории */
export function getElementsByCategory(category: string): ElementDef[] {
  return ELEMENTS.filter(e => e.category === category);
}
