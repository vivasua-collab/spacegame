/**
 * Определения типов звёзд.
 */

import type { StarDef, StarType } from '@/core/types';

export const STAR_TYPES: StarDef[] = [
  { type: 'O', name: 'Голубой сверхгигант', mass: 40, luminosity: 200000, temperature: 44000, radius: 15, color: '#9bb0ff', minPlanets: 0, maxPlanets: 3, weight: 1 },
  { type: 'B', name: 'Голубой гигант', mass: 10, luminosity: 3000, temperature: 20000, radius: 5, color: '#aabfff', minPlanets: 1, maxPlanets: 5, weight: 2 },
  { type: 'A', name: 'Белая звезда', mass: 2.5, luminosity: 30, temperature: 9000, radius: 1.8, color: '#cad7ff', minPlanets: 1, maxPlanets: 6, weight: 5 },
  { type: 'F', name: 'Жёлто-белая', mass: 1.3, luminosity: 3, temperature: 6800, radius: 1.2, color: '#f8f7ff', minPlanets: 2, maxPlanets: 8, weight: 10 },
  { type: 'G', name: 'Жёлтый карлик', mass: 1, luminosity: 1, temperature: 5500, radius: 1, color: '#fff4ea', minPlanets: 2, maxPlanets: 8, weight: 15 },
  { type: 'K', name: 'Оранжевый карлик', mass: 0.7, luminosity: 0.2, temperature: 4200, radius: 0.8, color: '#ffd2a1', minPlanets: 1, maxPlanets: 6, weight: 20 },
  { type: 'M', name: 'Красный карлик', mass: 0.3, luminosity: 0.005, temperature: 3000, radius: 0.4, color: '#ffad6b', minPlanets: 1, maxPlanets: 4, weight: 30 },
  { type: 'white_dwarf', name: 'Белый карлик', mass: 0.6, luminosity: 0.001, temperature: 12000, radius: 0.01, color: '#e8e8ff', minPlanets: 0, maxPlanets: 2, weight: 8 },
  { type: 'neutron', name: 'Нейтронная звезда', mass: 1.4, luminosity: 0.0001, temperature: 600000, radius: 0.00001, color: '#b0b0ff', minPlanets: 0, maxPlanets: 1, weight: 4 },
  { type: 'black_hole', name: 'Чёрная дыра', mass: 10, luminosity: 0, temperature: 0, radius: 0, color: '#1a1a2e', minPlanets: 0, maxPlanets: 0, weight: 3 },
];

export const STAR_TYPE_MAP = new Map(STAR_TYPES.map(s => [s.type, s]));

export function getStarTypeDef(type: StarType): StarDef {
  return STAR_TYPE_MAP.get(type)!;
}

/** Весовые вероятности для генерации */
export const STAR_WEIGHTS = STAR_TYPES.map(s => s.weight);
