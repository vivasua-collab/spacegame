/**
 * Определения типов планет.
 * Все параметры из документации 03-planets.md.
 * Terrain weights, temperature ranges, atmosphere chances — строго по документации.
 */

import type { PlanetDef, PlanetType, PlanetSize, HexTerrain } from '@/core/types';

/** Диапазоны плотности по типу планеты (г/см³). Из 03-planets.md §2.2 */
export const PLANET_DENSITY: Record<PlanetType, { min: number; max: number; avg: number }> = {
  rocky:    { min: 3.5, max: 6.5, avg: 5.0 },
  volcanic: { min: 4.0, max: 7.0, avg: 5.5 },
  ice:      { min: 2.0, max: 4.5, avg: 3.0 },
  oceanic:  { min: 3.5, max: 5.5, avg: 4.5 },
  desert:   { min: 3.0, max: 5.5, avg: 4.0 },
  gas_giant:{ min: 0.8, max: 2.5, avg: 1.5 },
  dwarf:    { min: 2.0, max: 5.0, avg: 3.5 },
};

/** Диапазоны радиуса (км) по типу и размеру. Из 03-planets.md §1.1, §2.1 */
export const PLANET_RADIUS_KM: Record<PlanetType, Record<PlanetSize, { min: number; max: number }>> = {
  rocky:    { tiny: { min: 1000, max: 2000 }, small: { min: 2000, max: 4500 }, medium: { min: 4500, max: 7000 }, large: { min: 7000, max: 9000 }, huge: { min: 9000, max: 12700 } },
  volcanic: { tiny: { min: 1500, max: 2500 }, small: { min: 2500, max: 5000 }, medium: { min: 5000, max: 8000 }, large: { min: 8000, max: 10500 }, huge: { min: 10500, max: 14000 } },
  ice:      { tiny: { min: 500, max: 1500 }, small: { min: 1500, max: 3500 }, medium: { min: 3500, max: 6000 }, large: { min: 6000, max: 8500 }, huge: { min: 8500, max: 11000 } },
  oceanic:  { tiny: { min: 2500, max: 4000 }, small: { min: 4000, max: 5500 }, medium: { min: 5500, max: 7500 }, large: { min: 7500, max: 10000 }, huge: { min: 10000, max: 13000 } },
  desert:   { tiny: { min: 1000, max: 2000 }, small: { min: 2000, max: 4000 }, medium: { min: 4000, max: 6500 }, large: { min: 6500, max: 9000 }, huge: { min: 9000, max: 12000 } },
  gas_giant:{ tiny: { min: 25000, max: 35000 }, small: { min: 35000, max: 45000 }, medium: { min: 45000, max: 55000 }, large: { min: 55000, max: 65000 }, huge: { min: 65000, max: 80000 } },
  dwarf:    { tiny: { min: 500, max: 1000 }, small: { min: 1000, max: 1500 }, medium: { min: 1500, max: 2000 }, large: { min: 2000, max: 2500 }, huge: { min: 2500, max: 3000 } },
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
    lifeChance: 0.05,
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
    lifeChance: 0,
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
    lifeChance: 0.01,
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
    lifeChance: 0.4,
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
    lifeChance: 0.02,
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
    lifeChance: 0,
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
 */
export const GAS_GIANT_ATMOSPHERE_SLOTS = { min: 6, max: 12 };

/**
 * Количество орбитальных слотов по типу планеты.
 */
export const ORBIT_SLOTS: Record<PlanetType, { min: number; max: number }> = {
  rocky: { min: 3, max: 5 },
  volcanic: { min: 3, max: 5 },
  ice: { min: 3, max: 5 },
  oceanic: { min: 3, max: 5 },
  desert: { min: 3, max: 5 },
  gas_giant: { min: 6, max: 12 },
  dwarf: { min: 2, max: 4 },
};
