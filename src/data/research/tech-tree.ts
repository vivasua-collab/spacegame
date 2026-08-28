/**
 * Block 03 (R1) — R-RES refactor: Дерево технологий (data-driven JSON).
 *
 * Технологии теперь хранятся во внешнем data-файле `techs.json`.
 * Добавление новой записи в JSON автоматически делает её видимой в
 * дереве исследований (data-driven «infinite research»).
 *
 * Этот файл — тонкий loader: импортирует JSON, валидирует структуру
 * (через validateTechTree в engine.ts при init модуля) и экспортирует
 * типизированные объекты + хелперы (TECH_MAP, BRANCH_COLORS,
 * STARTER_TECH_IDS) для удобной работы из UI и engine.
 *
 * Источник истины: src/data/research/techs.json
 * Спека: docs/60-research.md §6 + R-RES task §D
 */

import type { Technology, SpecializedBranchId } from '@/core/types';
import techsData from './techs.json';

/**
 * Typed tech tree (data-driven from techs.json). Adding an entry to
 * techs.json makes it automatically appear in the research view.
 */
export const TECH_TREE: Technology[] = techsData as Technology[];

/** Map techId → Technology for O(1) lookup. */
export const TECH_MAP: Map<string, Technology> = new Map(
  TECH_TREE.map((t) => [t.id, t]),
);

/** Branch colors for UI (60-research.md §2.1). */
export const BRANCH_COLORS: Record<SpecializedBranchId, string> = {
  power: '#ef4444',       // red-500
  materials: '#f97316',  // orange-500
  weapons: '#eab308',     // yellow-500
  computing: '#06b6d4',  // cyan-500 (design gaidlines избегают blue)
  biology: '#22c55e',    // green-500
  xenoarch: '#a855f7',   // purple-500
};

/**
 * Starter techs — available from the very beginning (no prerequisites).
 * Computed at module-load time from the JSON data, so new starter techs
 * added to techs.json are picked up automatically.
 */
export const STARTER_TECH_IDS: string[] = TECH_TREE
  .filter((t) => t.prerequisites.length === 0)
  .map((t) => t.id);
