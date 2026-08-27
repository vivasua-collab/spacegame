/**
 * Block 02 (F1): Каталог корпусов кораблей MVP — docs/50-ships.md §2.1, §2.5.
 *
 * 4 корпуса MVP (из 7 в спеке): Скаут, Истребитель, Фрегат, Транспорт.
 * Тяжёлые корпуса (Cruiser/Battleship/Flagship) отложены на Etap 4.
 *
 * Значения: HS, HP, масса, слоты (weapon/engine/system/defense),
 * стоимость в у.е.р., требования (Engineering/Shipyard уровни),
 * доступные обшивки (armorOptions).
 *
 * Source of truth: docs/50-ships.md §2.2 таблица параметров корпусов.
 * Конкретные числа подобраны для MVP-балансировки: Разведчик (Скаут)
 * с 8 модулями даёт массу ≈ 1075 т, скорость ≈ 7.4 км/с,
 * энергобаланс −2 МВт, стоимость ≈ 415 у.е.р. (см. tests/ships/designer.test.ts).
 */

import type { HullType } from '@/core/types';

export const HULLS: HullType[] = [
  {
    id: 'hull_scout',
    name: 'Скаут',
    size: 'scout',
    totalHS: 25,
    baseHP: 200,
    baseMass: 500,
    weaponSlots: 1,
    engineSlots: 2,
    systemSlots: 3,
    defenseSlots: 1,
    baseCost: 50,
    requiredEngineeringLevel: 1,
    requiredShipyardLevel: 1,
    armorOptions: ['light', 'standard'],
  },
  {
    id: 'hull_fighter',
    name: 'Истребитель',
    size: 'fighter',
    totalHS: 50,
    baseHP: 400,
    baseMass: 1000,
    weaponSlots: 2,
    engineSlots: 2,
    systemSlots: 2,
    defenseSlots: 2,
    baseCost: 120,
    requiredEngineeringLevel: 1,
    requiredShipyardLevel: 1,
    armorOptions: ['light', 'standard', 'thick'],
  },
  {
    id: 'hull_frigate',
    name: 'Фрегат',
    size: 'frigate',
    totalHS: 100,
    baseHP: 1000,
    baseMass: 2500,
    weaponSlots: 4,
    engineSlots: 3,
    systemSlots: 4,
    defenseSlots: 3,
    baseCost: 300,
    requiredEngineeringLevel: 2,
    requiredShipyardLevel: 2,
    armorOptions: ['light', 'standard', 'thick', 'heavy'],
  },
  {
    id: 'hull_transport',
    name: 'Транспорт',
    size: 'transport',
    totalHS: 150,
    baseHP: 800,
    baseMass: 4000,
    weaponSlots: 2,
    engineSlots: 3,
    systemSlots: 5,
    defenseSlots: 2,
    baseCost: 250,
    requiredEngineeringLevel: 2,
    requiredShipyardLevel: 2,
    armorOptions: ['light', 'standard', 'thick', 'heavy'],
  },
];

/** Lookup-мапа: hullId → HullType. */
export const HULL_MAP = new Map<string, HullType>(HULLS.map(h => [h.id, h]));

/** Получить корпус по id. */
export function getHull(id: string): HullType | undefined {
  return HULL_MAP.get(id);
}

/** Список всех корпусов MVP (4 шт.). */
export function listHulls(): HullType[] {
  return HULLS;
}
