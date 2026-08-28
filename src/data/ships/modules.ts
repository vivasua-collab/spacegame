/**
 * Block 02 (F1) — R-SHIPS-DATA: Каталог модулей кораблей MVP (data-driven JSON).
 *
 * Источник истины: `src/data/ships/modules.json` (человекочитаемый JSON).
 * Этот файл — тонкий loader: импортирует JSON, кастит к `ShipModule[]` и
 * строит `MODULE_MAP` для O(1) поиска по id.
 *
 * Спека: docs/50-ships.md §3-§9, Приложение D. Реализованные модули Mk.I
 * (~18 шт.): engines (2), control (5), life_support (1), weapon (2),
 * defense (2), auxiliary (8). Mk.II–Mk.V, варп-двигатели, торпеды,
 * ионные пушки, истребительные отсеки, маскировка, ЭМИ-щиты —
 * отложены на Etap 4.
 *
 * DATA-DRIVEN: добавление записи в `modules.json` автоматически делает
 * модуль доступным в UI конструктора кораблей (ship-designer.tsx) и в
 * справочнике (reference-dialog → Флот). Никаких правок кода не требуется.
 *
 * Поле `requiredTechs` — список techId (без minLevel, MVP-tech-gate
 * отключён; массив пуст для всех модулей). Поле `bonuses` (R-RES §E) —
 * data-driven бонусы модуля (например, ионный двигатель даёт +10%
 * multiply к ship_thrust).
 *
 * Публичный API сохранён (SHIP_MODULES, MODULE_MAP, getModule,
 * listModulesByCategory, listModulesForHull) — обратная совместимость
 * со всеми потребителями (ship-designer.tsx, shipyard-dialog.tsx,
 * ship-card.tsx, reference-dialog.tsx, designer.ts, fleet-engine.ts,
 * ships-module.ts, game-store.ts, tests/ships/*).
 */

import type { ShipModule } from '@/core/types';
import modulesData from './modules.json';

type ModulesFile = { comment?: string; modules: ShipModule[] };

/**
 * Единый каталог модулей (data-driven из modules.json).
 */
export const SHIP_MODULES: ShipModule[] = (modulesData as unknown as ModulesFile).modules;

/** Map moduleId → ShipModule для O(1) поиска. */
export const MODULE_MAP = new Map<string, ShipModule>(SHIP_MODULES.map((m) => [m.id, m]));

/** Получить модуль по id. */
export function getModule(id: string): ShipModule | undefined {
  return MODULE_MAP.get(id);
}

/** Список модулей указанной категории (для UI дизайнера). */
export function listModulesByCategory(category: ShipModule['category']): ShipModule[] {
  return SHIP_MODULES.filter((m) => m.category === category);
}

/**
 * Список модулей, доступных для установки на указанный корпус.
 * Фильтр по:
 * - slotRestriction (если у корпуса есть такой слот)
 * - minHull (для ЦПУ — проверяется отдельно в validateShip)
 *
 * MVP: tech-gate отключён (requiredTechs пуст); фильтр только по тому,
 * чтобы хотя бы один слот корпуса принимал эту категорию.
 */
export function listModulesForHull(_hullId: string): ShipModule[] {
  return SHIP_MODULES.slice();
}
