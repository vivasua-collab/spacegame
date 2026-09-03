/**
 * Etap 4.1 — R-STARS-DATA: Размерности гекс-сеток (data-driven JSON).
 *
 * Источник истины: `src/data/planets/grids.json` (человекочитаемый JSON).
 * Этот файл — тонкий loader.
 *
 * Требование владельца (2026-08-31): минимум 5 планетарных сеток + 2 малые
 * для спутников. Планеты генерируются процедурно (тип/атмосфера/температура/
 * жизнь — generate-planets.ts), но размерность сетки берётся отсюда.
 *
 * Все значения — центрированные гекс-числа 1+3k(k+1) (полные кольца
 * axial-сетки): 7=1 кольцо, 19=2, 37=3, 61=4, 91=5, 127=6.
 *
 * Потребители:
 *   - galaxy/hex-grid.ts — generateHexGrid(size, ..., gridMap) с fallback
 *     на PLANET_GRIDS;
 *   - data/planet-types.ts — SIZE_HEX_COUNT (= PLANET_GRIDS, обратная
 *     совместимость) + MOON_SIZE_HEX_COUNT (= MOON_GRIDS).
 *
 * Валидатор: scripts/validate-stars.ts (раздел 2). Тесты:
 * tests/galaxy/star-catalog.test.ts.
 */

import type { PlanetSize } from '@/core/types';
import gridsData from './grids.json';

type GridsFile = {
  comment?: string;
  planetGrids: Record<PlanetSize, number>;
  /** Малые сетки для спутников: только ключи 'tiny' и 'small'. */
  moonGrids: Partial<Record<PlanetSize, number>>;
};

const file = gridsData as unknown as GridsFile;

/** 5 планетарных сеток (tiny…huge), data-driven из grids.json. */
export const PLANET_GRIDS: Record<PlanetSize, number> = file.planetGrids;

/** 2 малые сетки для спутников газовых гигантов (tiny=7, small=19). */
export const MOON_GRIDS: Partial<Record<PlanetSize, number>> = file.moonGrids;
