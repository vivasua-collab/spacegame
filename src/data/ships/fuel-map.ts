/**
 * Block 02 (F1) — R-SHIPS-DATA: Маппинг `FuelType` → elementId (data-driven JSON).
 *
 * Источник истины: `src/data/ships/fuel-map.json` (человекочитаемый JSON).
 * Этот файл — тонкий loader: импортирует JSON, экспортирует типизированные
 * объекты + хелпер `emptyFuelStore()`.
 *
 * Используется при заправке корабля/флота на планете (списать
 * `planet.resources[elementId]`) и в UI resource-panel для строки
 * «Топливо флотов».
 *
 * Решение R7 плана (см. modules.json comment для деталей по каждому
 * типу топлива): chemical → 'H', xenon → 'Xe', hydrogen → 'H',
 * antimatter → 'antimatter'. Хим. топливо и водород делят elementId
 * 'H' — упрощение MVP.
 *
 * DATA-DRIVEN: изменения в `fuel-map.json` (например, разделение H на
 * хим. и водородный бак для Etap 4, или изменение коэффициента
 * конверсии `fuelElementCostPerUnit`) автоматически подхватываются
 * через этот loader.
 *
 * Публичный API сохранён (FUEL_TO_ELEMENT, ELEMENT_TO_FUEL,
 * FUEL_ELEMENT_COST_PER_UNIT, ALL_FUEL_TYPES, emptyFuelStore) —
 * обратная совместимость со всеми потребителями (fleet-engine.ts,
 * orders.ts, shipyard-queue.ts, reference-dialog.tsx,
 * resource-panel.tsx, tests/ships/*).
 */

import type { FuelType } from '@/core/types';
import fuelData from './fuel-map.json';

type FuelMapFile = {
  comment?: string;
  fuelToElement: Record<FuelType, string>;
  elementToFuel: Record<string, FuelType>;
  fuelElementCostPerUnit: Record<FuelType, number>;
  allFuelTypes: FuelType[];
};

const data = fuelData as unknown as FuelMapFile;

/** FuelType → elementId для planet.resources. */
export const FUEL_TO_ELEMENT: Record<FuelType, string> = data.fuelToElement;

/** Обратная мапа: elementId → FuelType (для resource-panel). */
export const ELEMENT_TO_FUEL: Record<string, FuelType> = data.elementToFuel;

/**
 * Сколько единиц elementId нужно на 1 ед. топлива данного типа.
 * Для MVP: 1:1 (одна единица ресурса = одна единица топлива).
 * Etap 4 может усложнить (хим. топливо из H+C в пропорции 4:1 и т.д.).
 */
export const FUEL_ELEMENT_COST_PER_UNIT: Record<FuelType, number> = data.fuelElementCostPerUnit;

/** Список всех типов топлива MVP (antimatter включён для UI-плейсхолдера). */
export const ALL_FUEL_TYPES: FuelType[] = data.allFuelTypes;

/** Инициализировать пустой fuel-объект (для нового корабля / флота). */
export function emptyFuelStore(): Record<FuelType, number> {
  return { chemical: 0, xenon: 0, hydrogen: 0, antimatter: 0 };
}
