/**
 * Экспорты модуля экономики.
 */

// Движок (прямые функции — для внутреннего использования)
export {
  processEconomyTick,
  recalcEnergyBalance,
  buildOnHex,
  upgradeBuilding,
  enqueueProduction,
  giveStarterResources,
  colonizePlanet,
} from './engine';

// Модуль (для регистрации в ModuleRegistry)
export { EconomyModule } from './economy-module';
