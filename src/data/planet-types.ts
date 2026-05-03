/**
 * Определения типов планет.
 * Все параметры из документации 03-planets.md.
 * Terrain weights, temperature ranges, atmosphere chances — строго по документации.
 *
 * G-01 fix: lifeChance приведены к спецификации §1.2
 * G-04/G-06 fix: добавлен PLANET_TYPE_RADIUS и getSizeFromRadius() — размер из R⊕
 * G-15/G-23 fix: добавлен ORBIT_SLOTS_BY_SIZE — орбитальные слоты по размеру
 */

import type { PlanetDef, PlanetType, PlanetSize, HexTerrain } from '@/core/types';

/** Диапазоны плотности по типу планеты (г/см³). Из 03-planets.md §2.2 */
export const PLANET_DENSITY: Record<PlanetType, { min: number; max: number; avg: number }> = {
  rocky:    { min: 3.5, max: 6.5, avg: 5.0 },
  volcanic: { min: 4.0, max: 7.0, avg: 5.5 },
  ice:      { min: 2.0, max: 4.5, avg: 3.0 },
  oceanic:  { min: 3.5, max: 5.5, avg: 4.5 },
  desert:   { min: 3.0, max: 5.5, avg: 4.0 },
  gas_giant:{ min: 1.2, max: 2.5, avg: 1.5 },  // G-29 fix: min 0.8→1.2 (min gravity ~0.9g)
  dwarf:    { min: 2.0, max: 5.0, avg: 3.5 },
};

/**
 * G-04/G-06 fix: Диапазоны радиуса по типу планеты (км).
 * Из 03-planets.md §1.1 — единый диапазон на тип, НЕ на размер.
 * Размер сетки ВЫВОДИТСЯ из радиуса через getSizeFromRadius().
 */
export const PLANET_TYPE_RADIUS: Record<PlanetType, { min: number; max: number }> = {
  rocky:    { min: 2000, max: 10000 },  // G-25 fix: max 7000→10000 (allows R=1.57 = "large")
  volcanic: { min: 2500, max: 8000 },
  ice:      { min: 1500, max: 6000 },
  oceanic:  { min: 4000, max: 11000 },  // G-25 fix: max 8000→11000 (allows R=1.73 = "large")
  desert:   { min: 2000, max: 6500 },
  gas_giant:{ min: 25000, max: 80000 },
  dwarf:    { min: 500, max: 2000 },
};

/**
 * G-06 fix: Определение размера сетки из радиуса в R⊕.
 * Из 03-planets.md §2.1 — единый источник истины.
 */
export function getSizeFromRadius(radiusKm: number): PlanetSize {
  const R = radiusKm / 6371; // в Earth radii
  if (R < 0.3) return 'tiny';
  if (R < 0.7) return 'small';
  if (R < 1.3) return 'medium';
  if (R < 2.0) return 'large';
  return 'huge';
}

/**
 * G-15/G-23 fix: Орбитальные слоты по размеру планеты.
 * Из 03-planets.md §3.2.3.
 */
export const ORBIT_SLOTS_BY_SIZE: Record<PlanetSize, number> = {
  tiny: 3,
  small: 4,
  medium: 5,
  large: 5,
  huge: 6,
};

/**
 * Профильные элементы для каждого типа планеты.
 * Профильные = в ЗНАЧИТЕЛЬНОМ количестве (множитель 3.0–5.0).
 * Из 03-planets.md §1.2 (ключевые ресурсы каждого типа).
 */
export const PROFILE_ELEMENTS: Record<PlanetType, string[]> = {
  rocky:    ['Fe', 'Si', 'Al', 'C', 'O'],
  volcanic: ['Fe', 'Ti', 'Cr', 'Ni', 'S', 'V'],
  ice:      ['H', 'O', 'N', 'He'],
  oceanic:  ['H', 'O', 'N', 'C', 'S'],
  desert:   ['Si', 'Fe', 'Al', 'Ti'],
  gas_giant:['H', 'He', 'C', 'N'],
  dwarf:    ['Fe', 'Si', 'C', 'Ni'],
};

/**
 * Редкие элементы — присутствуют на КАЖДОЙ планете в следовых количествах.
 * Множитель 0.1–0.3 от базового количества.
 */
export const RARE_ELEMENTS = ['W', 'Co', 'Pt', 'Y', 'Ba', 'Au', 'U'];

/**
 * Ультраредкие элементы — 1-2 уникальных для планеты.
 * Присутствуют в минимальных количествах (множитель 0.02–0.05).
 * Какой именно ультраредкий элемент достанется планете — определяется при генерации.
 */
export const ULTRA_RARE_ELEMENTS = ['W', 'Co', 'Pt', 'Y', 'Ba', 'Au', 'U', 'Li', 'V'];

export const PLANET_TYPES: PlanetDef[] = [
  {
    type: 'rocky',
    name: 'Скалистая',
    size: 'medium',
    hexCount: 61,
    baseGravity: 0.8,
    temperatureRange: [-50, 150],
    atmosphereChance: 0.4,
    lifeChance: 0.5,  // G-01 fix: спец §1.2.1 — 50% с жизнью (микробы 30%, растения 15%, простая 5%)
    terrainWeights: { plains: 40, mountains: 30, desert: 20, ice: 0, ocean: 0, volcano: 0, jungle: 10 },
  },
  {
    type: 'volcanic',
    name: 'Вулканическая',
    size: 'small',
    hexCount: 37,
    baseGravity: 0.9,
    temperatureRange: [200, 800],
    atmosphereChance: 0.6,
    lifeChance: 0.05,  // G-01 fix: спец §1.2.2 — 5% (микробы-экстремофилы)
    terrainWeights: { plains: 25, mountains: 30, desert: 0, ice: 0, ocean: 0, volcano: 45, jungle: 0 },
  },
  {
    type: 'ice',
    name: 'Ледяная',
    size: 'small',
    hexCount: 37,
    baseGravity: 0.5,
    temperatureRange: [-230, -30],
    atmosphereChance: 0.2,
    lifeChance: 0.15,  // G-01 fix: спец §1.2.3 — 15% (микробы)
    terrainWeights: { plains: 25, mountains: 25, desert: 0, ice: 50, ocean: 0, volcano: 0, jungle: 0 },
  },
  {
    type: 'oceanic',
    name: 'Океаническая',
    size: 'medium',
    hexCount: 61,
    baseGravity: 1.0,
    temperatureRange: [-10, 60],
    atmosphereChance: 0.85,
    lifeChance: 0.95,  // G-01 fix: спец §1.2.4 — 95% с жизнью
    terrainWeights: { plains: 15, mountains: 5, desert: 0, ice: 0, ocean: 65, volcano: 0, jungle: 15 },
  },
  {
    type: 'desert',
    name: 'Пустынная',
    size: 'medium',
    hexCount: 61,
    baseGravity: 0.7,
    temperatureRange: [30, 250],
    atmosphereChance: 0.15,
    lifeChance: 0.25,  // G-01 fix: спец §1.2.5 — 25% (микробы 20%, растения 5%)
    terrainWeights: { plains: 20, mountains: 25, desert: 55, ice: 0, ocean: 0, volcano: 0, jungle: 0 },
  },
  {
    type: 'gas_giant',
    name: 'Газовый гигант',
    size: 'huge',
    hexCount: 0, // P1-01: застройка поверхности невозможна
    baseGravity: 2.5,
    temperatureRange: [-180, 1000],
    atmosphereChance: 1.0,
    lifeChance: 0,
    terrainWeights: { plains: 0, mountains: 0, desert: 0, ice: 0, ocean: 0, volcano: 0, jungle: 0 },
  },
  {
    type: 'dwarf',
    name: 'Карликовая',
    size: 'tiny',
    hexCount: 19,
    baseGravity: 0.2,
    temperatureRange: [-230, 50],
    atmosphereChance: 0.1,
    lifeChance: 0.02,  // G-01 fix: спец §1.2.7 — 2% (микробы)
    terrainWeights: { plains: 50, mountains: 30, desert: 0, ice: 20, ocean: 0, volcano: 0, jungle: 0 },
  },
];

export const PLANET_TYPE_MAP = new Map(PLANET_TYPES.map(p => [p.type, p]));

/**
 * Количество гексов по классу размера.
 * Из документации 03-planets.md §2.1 (единый источник истины).
 */
export const SIZE_HEX_COUNT: Record<PlanetSize, number> = {
  tiny: 19,
  small: 37,
  medium: 61,
  large: 91,
  huge: 127,
};

/**
 * Все типы местности — 7 типов (без crater, P1-20).
 * Из документации 03-planets.md §3.3.
 */
export const ALL_TERRAINS: HexTerrain[] = ['plains', 'mountains', 'desert', 'ice', 'ocean', 'volcano', 'jungle'];

export const TERRAIN_COLORS: Record<HexTerrain, string> = {
  plains: '#8fbc8f',
  mountains: '#a0826d',
  desert: '#d2b48c',
  ice: '#b0d4e8',
  ocean: '#4a90d9',
  volcano: '#cd5c5c',
  jungle: '#2e8b57',
};

export const TERRAIN_NAMES: Record<HexTerrain, string> = {
  plains: 'Равнина',
  mountains: 'Горы',
  desert: 'Пустыня',
  ice: 'Лёд',
  ocean: 'Океан',
  volcano: 'Вулкан',
  jungle: 'Джунгли',
};

export const SIZE_NAMES: Record<PlanetSize, string> = {
  tiny: 'Крошечная',
  small: 'Малая',
  medium: 'Средняя',
  large: 'Большая',
  huge: 'Огромная',
};

export const TYPE_NAMES: Record<PlanetType, string> = {
  rocky: 'Скалистая',
  volcanic: 'Вулканическая',
  ice: 'Ледяная',
  oceanic: 'Океаническая',
  desert: 'Пустынная',
  gas_giant: 'Газовый гигант',
  dwarf: 'Карликовая',
};

/**
 * Количество атмосферных слотов для газовых гигантов.
 * Из 03-planets.md §3.2.2.
 */
export const GAS_GIANT_ATMOSPHERE_SLOTS = { min: 6, max: 12 };

/**
 * Количество орбитальных слотов по типу планеты.
 * G-15 note: Используется ТОЛЬКО для газовых гигантов (6-12).
 * Для остальных типов — используйте ORBIT_SLOTS_BY_SIZE.
 */
export const ORBIT_SLOTS: Record<PlanetType, { min: number; max: number }> = {
  rocky: { min: 4, max: 5 },      // size small=4, medium=5, large=5
  volcanic: { min: 4, max: 5 },    // size small=4, medium=5
  ice: { min: 3, max: 5 },        // size tiny=3, small=4, medium=5
  oceanic: { min: 4, max: 6 },    // size small=4, medium=5, large=5, huge=6
  desert: { min: 4, max: 5 },     // size small=4, medium=5
  gas_giant: { min: 6, max: 12 }, // спец диапазон для ГГ
  dwarf: { min: 3, max: 3 },      // size tiny=3
};

/**
 * G-09: Вероятности уровней жизни по типу планеты.
 * Из 03-planets.md §1.2 — каждый тип имеет своё распределение.
 * Порядок: [нет, микробы, растения, простая, сложная]
 */
export const LIFE_LEVEL_WEIGHTS: Record<PlanetType, [number, number, number, number, number]> = {
  rocky:    [50, 30, 15, 5, 0],     // §1.2.1: нет 50%, микробы 30%, растения 15%, простая 5%, сложная 0%
  volcanic: [95, 5, 0, 0, 0],       // §1.2.2: нет 95%, экстремофилы 5%
  ice:      [85, 15, 0, 0, 0],      // §1.2.3: нет 85%, микробы 15%
  oceanic:  [5, 10, 30, 35, 20],    // §1.2.4: нет 5%, микробы 10%, растения 30%, простая 35%, сложная 20%
  desert:   [75, 20, 5, 0, 0],      // §1.2.5: нет 75%, микробы 20%, растения 5%
  gas_giant:[100, 0, 0, 0, 0],      // §1.2.6: нет 100%
  dwarf:    [98, 2, 0, 0, 0],       // §1.2.7: нет 98%, микробы 2%
};
