/**
 * Block 02 (F1): Маппинг `FuelType` → elementId — docs/50-ships.md §1.6 + §3.1.
 *
 * Используется при заправке корабля/флота на планете (списать
 * `planet.resources[elementId]`), и в UI resource-panel для строки «Топливо флотов».
 *
 * Решение R7 плана:
 * - chemical  → 'H' (упрощённо: хим. двигатели сжигают водород; MVP)
 * - xenon     → 'Xe' (не в ELEMENTS, но строка-ключ для planet.resources — ResourcePanel покажет как «Прочие»)
 * - hydrogen  → 'H' (те же запасы, что и chemical; но для водородных двигателей)
 * - antimatter → 'antimatter' (не используется в MVP, reserved для Etap 4)
 *
 * Хим. топливо и водород делят один и тот же elementId 'H' — это упрощение MVP:
 * один бак 'H' на планете обслуживает оба типа двигателей. Etap 4 может разделить
 * их (если хим. топливо станет отдельным синтезируемым ресурсом).
 */

import type { FuelType } from '@/core/types';

/** FuelType → elementId для planet.resources. */
export const FUEL_TO_ELEMENT: Record<FuelType, string> = {
  chemical: 'H',
  xenon: 'Xe',
  hydrogen: 'H',
  antimatter: 'antimatter',
};

/** Обратная мапа: elementId → FuelType (для resource-panel). */
export const ELEMENT_TO_FUEL: Record<string, FuelType> = {
  H: 'hydrogen',
  Xe: 'xenon',
  antimatter: 'antimatter',
};

/**
 * Сколько единиц elementId нужно на 1 ед. топлива данного типа.
 * Для MVP: 1:1 (одна единица ресурса = одна единица топлива).
 * Etap 4 может усложнить (хим. топливо из H+C в пропорции 4:1 и т.д.).
 */
export const FUEL_ELEMENT_COST_PER_UNIT: Record<FuelType, number> = {
  chemical: 1,
  xenon: 1,
  hydrogen: 1,
  antimatter: 1,
};

/** Список всех типов топлива MVP (antimatter включён для UI-плейсхолдера). */
export const ALL_FUEL_TYPES: FuelType[] = ['chemical', 'xenon', 'hydrogen', 'antimatter'];

/** Инициализировать пустой fuel-объект (для нового корабля / флота). */
export function emptyFuelStore(): Record<FuelType, number> {
  return { chemical: 0, xenon: 0, hydrogen: 0, antimatter: 0 };
}
