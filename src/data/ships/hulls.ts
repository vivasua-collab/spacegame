/**
 * Block 02 (F1) — R-SHIPS-DATA: Каталог корпусов кораблей MVP (data-driven JSON).
 *
 * Источник истины: `src/data/ships/hulls.json` (человекочитаемый JSON).
 * Этот файл — тонкий loader: импортирует JSON, кастит к `HullType[]` и
 * строит `HULL_MAP` для O(1) поиска по id.
 *
 * Спека: docs/50-ships.md §2.1, §2.5. Реализованные корпуса MVP (4 из 7):
 * Скаут, Истребитель, Фрегат, Транспорт. Тяжёлые корпуса
 * (cruiser/battleship/flagship) — отложены на Etap 4.
 *
 * DATA-DRIVEN: добавление записи в `hulls.json` автоматически делает корпус
 * доступным в UI конструктора кораблей (ship-designer.tsx) и в справочнике
 * (reference-dialog → Флот). Никаких правок кода не требуется.
 *
 * Время постройки (stub для heavy hulls) живёт отдельно в
 * `src/data/ships/shipyard-queue.ts` SHIP_BUILD_TIME, поскольку это
 * runtime-константа, а не данные каталога.
 *
 * Публичный API сохранён (HULLS, HULL_MAP, getHull, listHulls) —
 * обратная совместимость со всеми потребителями (ship-designer.tsx,
 * shipyard-dialog.tsx, ship-card.tsx, reference-dialog.tsx, designer.ts,
 * fleet-engine.ts, ships-module.ts, game-store.ts, tests/ships/*).
 */

import type { HullType } from '@/core/types';
import hullsData from './hulls.json';

type HullsFile = { comment?: string; hulls: HullType[] };

/**
 * Единый каталог корпусов (data-driven из hulls.json).
 */
export const HULLS: HullType[] = (hullsData as unknown as HullsFile).hulls;

/** Map hullId → HullType для O(1) поиска. */
export const HULL_MAP = new Map<string, HullType>(HULLS.map((h) => [h.id, h]));

/** Получить корпус по id. */
export function getHull(id: string): HullType | undefined {
  return HULL_MAP.get(id);
}

/** Список всех корпусов MVP (4 шт.). */
export function listHulls(): HullType[] {
  return HULLS;
}
