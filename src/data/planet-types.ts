/**
 * Определения типов планет.
 */

import type { PlanetDef, PlanetType, PlanetSize, HexTerrain } from '@/core/types';

export const PLANET_TYPES: PlanetDef[] = [
  {
    type: 'rocky',
    name: 'Скалистая',
    size: 'medium',
    hexCount: 61,
    baseGravity: 0.8,
    temperatureRange: [-50, 150],
    atmosphereChance: 0.3,
    lifeChance: 0.05,
    terrainWeights: { plains: 35, mountains: 25, desert: 15, crater: 15, ice: 5, ocean: 0, volcano: 5, jungle: 0 },
  },
  {
    type: 'volcanic',
    name: 'Вулканическая',
    size: 'small',
    hexCount: 37,
    baseGravity: 0.9,
    temperatureRange: [200, 800],
    atmosphereChance: 0.1,
    lifeChance: 0,
    terrainWeights: { plains: 15, mountains: 20, desert: 10, crater: 10, ice: 0, ocean: 0, volcano: 40, jungle: 5 },
  },
  {
    type: 'ice',
    name: 'Ледяная',
    size: 'small',
    hexCount: 37,
    baseGravity: 0.5,
    temperatureRange: [-250, -50],
    atmosphereChance: 0.2,
    lifeChance: 0.01,
    terrainWeights: { plains: 20, mountains: 15, desert: 0, crater: 10, ice: 50, ocean: 5, volcano: 0, jungle: 0 },
  },
  {
    type: 'oceanic',
    name: 'Океаническая',
    size: 'medium',
    hexCount: 61,
    baseGravity: 1.0,
    temperatureRange: [0, 50],
    atmosphereChance: 0.9,
    lifeChance: 0.4,
    terrainWeights: { plains: 10, mountains: 5, desert: 0, crater: 5, ice: 5, ocean: 65, volcano: 0, jungle: 10 },
  },
  {
    type: 'desert',
    name: 'Пустынная',
    size: 'medium',
    hexCount: 61,
    baseGravity: 0.7,
    temperatureRange: [50, 200],
    atmosphereChance: 0.15,
    lifeChance: 0.02,
    terrainWeights: { plains: 20, mountains: 10, desert: 55, crater: 10, ice: 0, ocean: 0, volcano: 5, jungle: 0 },
  },
  {
    type: 'gas_giant',
    name: 'Газовый гигант',
    size: 'huge',
    hexCount: 127,
    baseGravity: 2.5,
    temperatureRange: [-200, 400],
    atmosphereChance: 1.0,
    lifeChance: 0,
    terrainWeights: { plains: 40, mountains: 0, desert: 0, crater: 0, ice: 0, ocean: 0, volcano: 0, jungle: 0 },
  },
  {
    type: 'dwarf',
    name: 'Карликовая',
    size: 'tiny',
    hexCount: 19,
    baseGravity: 0.2,
    temperatureRange: [-250, 50],
    atmosphereChance: 0.05,
    lifeChance: 0,
    terrainWeights: { plains: 30, mountains: 20, desert: 10, crater: 30, ice: 10, ocean: 0, volcano: 0, jungle: 0 },
  },
];

export const PLANET_TYPE_MAP = new Map(PLANET_TYPES.map(p => [p.type, p]));

export const SIZE_HEX_COUNT: Record<PlanetSize, number> = {
  tiny: 19,
  small: 37,
  medium: 61,
  large: 91,
  huge: 127,
};

export const ALL_TERRAINS: HexTerrain[] = ['plains', 'mountains', 'desert', 'ice', 'ocean', 'volcano', 'jungle', 'crater'];

export const TERRAIN_COLORS: Record<HexTerrain, string> = {
  plains: '#8fbc8f',
  mountains: '#a0826d',
  desert: '#d2b48c',
  ice: '#b0d4e8',
  ocean: '#4a90d9',
  volcano: '#cd5c5c',
  jungle: '#2e8b57',
  crater: '#b8a9c9',
};

export const TERRAIN_NAMES: Record<HexTerrain, string> = {
  plains: 'Равнина',
  mountains: 'Горы',
  desert: 'Пустыня',
  ice: 'Лёд',
  ocean: 'Океан',
  volcano: 'Вулкан',
  jungle: 'Джунгли',
  crater: 'Кратер',
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
