/**
 * Block 02 (F1): Публичные экспорты каталога кораблей.
 *
 * Структура:
 * - hulls.ts            — 4 корпуса MVP (Скаут/Истребитель/Фрегат/Транспорт)
 * - modules.ts          — ~18 модулей Mk.I (engines, ЦПУ, оружие, оборона, ...)
 * - fuel-map.ts         — FuelType → elementId mapping
 * - shipyard-queue.ts   — функции очереди постройки (см. также src/ships/designer.ts)
 *
 * Логические функции (validateShip, planRoute, processFleetTick) живут в
 * `src/ships/` (отдельно от данных) — это разделение данных и логики.
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
