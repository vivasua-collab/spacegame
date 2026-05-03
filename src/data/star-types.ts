/**
 * Определения типов звёзд.
 * Все параметры из документации 02-stars.md §1.1, §2.1.
 * ID звёзд соответствуют документации (STAR_O, STAR_WD и т.д.).
 */

import type { StarDef, StarType } from '@/core/types';

export const STAR_TYPES: StarDef[] = [
  // === Основная последовательность (02-stars.md §1.1) ===
  { type: 'STAR_O', name: 'Голубой сверхгигант', mass: 40, luminosity: 200000, temperature: 40000, radius: 10, color: '#9bb0ff', minPlanets: 0, maxPlanets: 2, weight: 0.003 },
  { type: 'STAR_B', name: 'Бело-голубой гигант', mass: 5, luminosity: 500, temperature: 20000, radius: 3.5, color: '#aabfff', minPlanets: 0, maxPlanets: 4, weight: 0.1 },
  { type: 'STAR_A', name: 'Белая звезда', mass: 1.7, luminosity: 12, temperature: 8750, radius: 1.6, color: '#cad7ff', minPlanets: 1, maxPlanets: 6, weight: 0.6 },
  { type: 'STAR_F', name: 'Жёлто-белая', mass: 1.2, luminosity: 2.5, temperature: 6750, radius: 1.28, color: '#f8f7ff', minPlanets: 2, maxPlanets: 8, weight: 3 },
  { type: 'STAR_G', name: 'Жёлтый карлик', mass: 0.92, luminosity: 1.0, temperature: 5600, radius: 1.0, color: '#fff4ea', minPlanets: 2, maxPlanets: 10, weight: 7.5 },
  { type: 'STAR_K', name: 'Оранжевый карлик', mass: 0.63, luminosity: 0.3, temperature: 4450, radius: 0.83, color: '#ffd2a1', minPlanets: 1, maxPlanets: 8, weight: 12 },
  { type: 'STAR_M', name: 'Красный карлик', mass: 0.25, luminosity: 0.02, temperature: 3050, radius: 0.35, color: '#ffad6b', minPlanets: 1, maxPlanets: 5, weight: 76 },

  // === Специальные типы (02-stars.md §2.1) ===
  { type: 'STAR_WD', name: 'Белый карлик', mass: 0.6, luminosity: 0.005, temperature: 30000, radius: 0.014, color: '#e8e8ff', minPlanets: 0, maxPlanets: 3, weight: 0.4 },
  { type: 'STAR_RG', name: 'Красный гигант', mass: 1.5, luminosity: 3000, temperature: 4000, radius: 50, color: '#ff8866', minPlanets: 1, maxPlanets: 5, weight: 0.2 },
  { type: 'STAR_NS', name: 'Нейтронная звезда', mass: 1.4, luminosity: 0.0001, temperature: 600000, radius: 0.00001, color: '#b0b0ff', minPlanets: 0, maxPlanets: 2, weight: 0.1 },
  { type: 'STAR_PULSAR', name: 'Пульсар', mass: 1.4, luminosity: 0.0001, temperature: 1000000, radius: 0.00001, color: '#8080ff', minPlanets: 0, maxPlanets: 1, weight: 0.05 },
  { type: 'STAR_BH', name: 'Чёрная дыра', mass: 10, luminosity: 0, temperature: 0, radius: 0, color: '#1a1a2e', minPlanets: 0, maxPlanets: 1, weight: 0.05 },
];

export const STAR_TYPE_MAP = new Map(STAR_TYPES.map(s => [s.type, s]));

export function getStarTypeDef(type: StarType): StarDef {
  return STAR_TYPE_MAP.get(type)!;
}

/**
 * Весовые вероятности для генерации.
 * Используются как есть — значения пропорциональны частотам из документации.
 */
export const STAR_WEIGHTS = STAR_TYPES.map(s => s.weight);
