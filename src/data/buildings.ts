/**
 * Определения зданий — 8 зданий для MVP.
 * Добавлены поля layer и requiresAtmosphere для соответствия документации.
 */

import type { BuildingDef } from '@/core/types';

export const BUILDINGS: BuildingDef[] = [
  {
    id: 'mine',
    name: 'Шахта',
    description: 'Добыча металлических руд из недр планеты',
    category: 'extraction',
    layer: ['surface'],
    size: ['tiny', 'small', 'medium', 'large'],
    energyConsumption: 2,
    baseProductionTime: 100,
    levels: 10,
    costPerLevel: { Fe: 5, Si: 3 },
    terrainBonus: { mountains: 1.5, volcano: 1.3 },
    requiresAtmosphere: false,
  },
  {
    id: 'quarry',
    name: 'Карьер',
    description: 'Добыча неметаллических ресурсов',
    category: 'extraction',
    layer: ['surface'],
    size: ['tiny', 'small', 'medium', 'large'],
    energyConsumption: 1,
    baseProductionTime: 80,
    levels: 10,
    costPerLevel: { Fe: 3, Si: 5 },
    terrainBonus: { plains: 1.3, desert: 1.2 },
    requiresAtmosphere: false,
  },
  {
    id: 'gas_extractor',
    name: 'Газовый экстрактор',
    description: 'Добыча газов из атмосферы (P1-27: только на планетах с атмосферой)',
    category: 'extraction',
    layer: ['surface', 'atmosphere'], // Может строиться на поверхности (скалистые) или в атмосфере (газовые гиганты)
    size: ['small', 'medium', 'large', 'huge'],
    energyConsumption: 3,
    baseProductionTime: 120,
    levels: 10,
    costPerLevel: { Fe: 4, Al: 3 },
    terrainBonus: {},
    requiresAtmosphere: true, // P1-27: только на планетах с атмосферой
  },
  {
    id: 'smelter',
    name: 'Плавильня',
    description: 'Переработка руды в чистые металлы',
    category: 'processing',
    layer: ['surface'],
    size: ['small', 'medium', 'large'],
    energyConsumption: 5,
    baseProductionTime: 150,
    levels: 10,
    costPerLevel: { Fe: 8, Si: 5, C: 3 },
    terrainBonus: {},
    requiresAtmosphere: false,
  },
  {
    id: 'chemical_plant',
    name: 'Химзавод',
    description: 'Химическая переработка и синтез',
    category: 'processing',
    layer: ['surface'],
    size: ['medium', 'large'],
    energyConsumption: 4,
    baseProductionTime: 200,
    levels: 10,
    costPerLevel: { Fe: 6, Si: 4, Cu: 2 },
    terrainBonus: {},
    requiresAtmosphere: false,
  },
  {
    id: 'solar_plant',
    name: 'Солнечная станция',
    description: 'Выработка энергии из звёздного излучения (P1-26: зависит от светимости звезды)',
    category: 'energy',
    layer: ['surface', 'orbit'], // Может строиться на поверхности или на орбите
    size: ['tiny', 'small', 'medium', 'large', 'huge'],
    energyConsumption: 0,
    baseProductionTime: 0,
    levels: 10,
    costPerLevel: { Si: 8, Al: 5 },
    terrainBonus: { desert: 1.4, plains: 1.1 },
    requiresAtmosphere: false,
  },
  {
    id: 'nuclear_plant',
    name: 'Ядерный реактор',
    description: 'Выработка энергии из ядерного топлива',
    category: 'energy',
    layer: ['surface'],
    size: ['medium', 'large'],
    energyConsumption: 0,
    baseProductionTime: 0,
    levels: 10,
    costPerLevel: { Fe: 10, Ti: 5, U: 2 },
    terrainBonus: {},
    requiresAtmosphere: false,
  },
  {
    id: 'shipyard',
    name: 'Верфь',
    description: 'Сборка и ремонт космических кораблей',
    category: 'production',
    layer: ['surface', 'orbit'], // Может быть планетарной или орбитальной
    size: ['medium', 'large'],
    energyConsumption: 8,
    baseProductionTime: 500,
    levels: 10,
    costPerLevel: { Fe: 15, Ti: 8, Si: 10 },
    terrainBonus: {},
    requiresAtmosphere: false,
  },
];

export const BUILDING_MAP = new Map(BUILDINGS.map(b => [b.id, b]));

export const CATEGORY_NAMES: Record<string, string> = {
  extraction: 'Добыча',
  processing: 'Переработка',
  production: 'Производство',
  energy: 'Энергия',
  military: 'Военные',
  research: 'Исследования',
  logistics: 'Логистика',
};

export const CATEGORY_ICONS: Record<string, string> = {
  extraction: '⛏️',
  processing: '🔥',
  production: '🏗️',
  energy: '⚡',
  military: '⚔️',
  research: '🔬',
  logistics: '🚚',
};

export const LAYER_NAMES: Record<string, string> = {
  surface: 'Поверхность',
  atmosphere: 'Атмосфера',
  orbit: 'Орбита',
};
