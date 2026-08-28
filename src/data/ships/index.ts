/**
 * Block 02 (F1) — R-SHIPS-DATA: Публичные экспорты каталога кораблей.
 *
 * Структура (data-driven JSON + тонкие TS-loaders + runtime-логика):
 * - hulls.ts            — thin loader → hulls.json (4 корпуса MVP)
 * - modules.ts          — thin loader → modules.json (~18 модулей Mk.I)
 * - fuel-map.ts         — thin loader → fuel-map.json (FuelType ↔ elementId)
 * - shipyard-queue.ts   — runtime-логика очереди постройки (НЕ данные;
 *                         см. также src/ships/designer.ts для validateShip
 *                         и src/ships/orders.ts для planRoute)
 *
 * DATA-DRIVEN: добавление записи в hulls.json/modules.json или правка
 * fuel-map.json автоматически подхватываются соответствующими тонкими
 * loader'ами — UI конструктора (ship-designer.tsx), справочника
 * (reference-dialog → Флот), панели ресурсов (resource-panel.tsx) и
 * движком (ships/, economy/shipyard-queue) продолжают работать без
 * правок импортов. Валидатор: `bun run validate:ships` проверяет
 * целостность каталога.
 *
 * Публичный API сохранён для обратной совместимости с 10 потребителями
 * (см. grep `from '@/data/ships'`).
 *
 * Логические функции (validateShip, planRoute, processFleetTick) живут в
 * `src/ships/` (отдельно от данных) — это разделение данных и логики.
 *
 * См. docs/data-driven-architecture.md — общая архитектура data-driven
 * хранения в SpaceGame (buildings / research / ships).
 */

export {
  HULLS,
  HULL_MAP,
  getHull,
  listHulls,
} from './hulls';

export {
  SHIP_MODULES,
  MODULE_MAP,
  getModule,
  listModulesByCategory,
  listModulesForHull,
} from './modules';

export {
  FUEL_TO_ELEMENT,
  ELEMENT_TO_FUEL,
  FUEL_ELEMENT_COST_PER_UNIT,
  ALL_FUEL_TYPES,
  emptyFuelStore,
} from './fuel-map';

export {
  STEEL_PER_UER,
  MICROCHIP_PER_UER,
  getShipBuildTime,
  getShipBuildCostUER,
  getShipBuildCostResources,
  enqueueShipBuild,
  processShipyardTick,
} from './shipyard-queue';
