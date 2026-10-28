/**
 * Экспорты модуля экономики.
 */

// Движок (прямые функции — для внутреннего использования)
export {
  processEconomyTick,
  recalcEnergyBalance,
  buildOnHex,
  buildOnAtmosphereSlot,
  buildOnOrbitSlot,
  upgradeBuilding,
  enqueueProduction,
  cancelProduction,
  giveStarterResources,
  colonizePlanet,
  // Block 05 — специализация переработчиков
  calculateProcessorOutputMultiplier,
  // R-26 — карусель производства (баги 3–4)
  collectProcessorInstances,
  specializeWorkshop,
  upgradeWorkshopSpecialization,
} from './engine';

// Модуль (для регистрации в ModuleRegistry)
export { EconomyModule } from './economy-module';
