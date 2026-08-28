/**
 * Block 03 (R5) — R-RES refactor: TECH_UNLOCKS (data-driven JSON).
 *
 * Таблица «технология → разблокировки» теперь хранится во внешнем data-файле
 * `tech-unlocks.json`. Этот файл — тонкий loader.
 *
 * Источник истины: src/data/research/tech-unlocks.json
 */

import techUnlocksData from './tech-unlocks.json';

export interface TechUnlock {
  level: number;
  type: 'building' | 'recipe' | 'module' | 'ship_hull';
  id: string;
}

export const TECH_UNLOCKS: Record<string, TechUnlock[]> =
  techUnlocksData as Record<string, TechUnlock[]>;
