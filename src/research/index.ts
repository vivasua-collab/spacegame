/**
 * Block 03 (R7): Barrel-экспорт для research-системы.
 *
 * Все pure engine-функции + типы + ResearchModule (IGameModule-гражданин).
 */

export * from './engine';
export { ResearchModule } from './research-module';
// R-RES §E: bonus resolver (data-driven multipliers for energy_output,
// research_rate, ship_thrust, … aggregated from techs + buildings + parts).
export { resolveBonuses } from './bonus-resolver';
export type { Bonus } from '@/core/types';
