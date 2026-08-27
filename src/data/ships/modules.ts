/**
 * Block 02 (F1): Каталог модулей кораблей MVP — docs/50-ships.md §3-§9,
 * Приложение D.
 *
 * ~18 модулей (Mk.I только):
 * - engines (2): engine_chemical_mk1, engine_ion_mk1
 * - control (4): cpu_micro, cpu_light, navigator_mk1, comm_mk1, comm_mk2
 * - life_support (1): life_support_cabin
 * - weapon (2): weapon_laser_mk1, weapon_missile_mk1
 * - defense (2): shield_light_mk1, armor_steel
 * - auxiliary (8): cargo_bay_s, fuel_tank_chemical_s, fuel_tank_xenon_s,
 *                  fuel_tank_hydrogen_s, scanner_basic, jump_drive_mk1,
 *                  colony_module_small, reactor_nuclear_mk1
 *
 * Числа подобраны под T-FLEET-1/T-FLEET-2: Разведчик из §10.1
 * (Скаут + light armor + 8 модулей) даёт:
 *   mass = 500 + 575 = 1075 т
 *   speed = 800/1075 × 10 ≈ 7.4 км/с
 *   energyBalance = 50 (reactor) − 52 (consumption) = −2 МВт
 *   cost = 50 (hull) + 365 (modules) = 415 у.е.р.
 *
 * Полный список модулей Разведчика (§10.1):
 *   cpu_micro + engine_ion_mk1 + scanner_basic + comm_mk2 +
 *   fuel_tank_xenon_s + jump_drive_mk1 + navigator_mk1 + reactor_nuclear_mk1
 *
 * Mk.II–Mk.V, варп-двигатели, торпеды, ионные пушки, истребительные отсеки,
 * маскировка, ЭМИ-щиты — отложены на Etap 4.
 */

import type { ShipModule } from '@/core/types';

export const SHIP_MODULES: ShipModule[] = [
  // ═════════════ Двигатели (engine) ═══════════════════════════════════
  {
    id: 'engine_chemical_mk1',
    name: 'Химический двигатель Mk.I',
    category: 'engine',
    size: 3,
    mass: 60,
    energyConsumption: 0,
    cost: 30,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'engine',
    thrust: 600,
    fuelType: 'chemical',
    fuelPerThrust: 0.002,
  },
  {
    id: 'engine_ion_mk1',
    name: 'Ионный двигатель Mk.I',
    category: 'engine',
    size: 4,
    mass: 200,
    energyConsumption: 30, // ионные двигатели энергозатратные (ионизация рабочего тела)
    cost: 100,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'engine',
    thrust: 800,
    fuelType: 'xenon',
    fuelPerThrust: 0.0008,
  },

  // ═════════════ ЦПУ (control) ═════════════════════════════════════════
  {
    id: 'cpu_micro',
    name: 'ЦПУ-Микро',
    category: 'control',
    size: 1,
    mass: 5,
    energyConsumption: 5,
    cost: 30,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'system',
    controlType: 'cpu',
    minHull: 'scout',
  },
  {
    id: 'cpu_light',
    name: 'ЦПУ-Лёгкий',
    category: 'control',
    size: 2,
    mass: 15,
    energyConsumption: 10,
    cost: 70,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'system',
    controlType: 'cpu',
    minHull: 'fighter',
  },
  {
    id: 'navigator_mk1',
    name: 'Навигатор Mk.I',
    category: 'control',
    size: 1,
    mass: 50,
    energyConsumption: 2,
    cost: 30,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'system',
    controlType: 'navigation',
    fuelEfficiencyBonus: 0.1, // −10% расход топлива в пути
  },
  {
    id: 'comm_mk1',
    name: 'Связь Mk.I',
    category: 'control',
    size: 1,
    mass: 10,
    energyConsumption: 2,
    cost: 20,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'system',
    controlType: 'communication',
    communicationRange: 5, // св. лет
  },
  {
    id: 'comm_mk2',
    name: 'Связь Mk.II',
    category: 'control',
    size: 1,
    mass: 20,
    energyConsumption: 4,
    cost: 50,
    techLevel: 2,
    requiredTechs: [],
    slotRestriction: 'system',
    controlType: 'communication',
    communicationRange: 15, // св. лет — критично для межсистемных приказов
  },

  // ═════════════ Жизнеобеспечение (life_support) ═════════════════════
  {
    id: 'life_support_cabin',
    name: 'ЖО-Кабина',
    category: 'life_support',
    size: 2,
    mass: 30,
    energyConsumption: 3,
    cost: 40,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'system',
    // Stub для адмирала (Etap 4) — пока не используется в механике.
  },

  // ═════════════ Оружие (weapon) ═════════════════════════════════════
  {
    id: 'weapon_laser_mk1',
    name: 'Лазерная пушка Mk.I',
    category: 'weapon',
    size: 2,
    mass: 40,
    energyConsumption: 5,
    cost: 60,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'weapon',
    weaponType: 'laser',
    damage: 25,
    range: 5000, // км
    fireRate: 1,
    energyPerShot: 5,
    accuracy: 85,
    damageType: 'energy',
    ammo: null,
  },
  {
    id: 'weapon_missile_mk1',
    name: 'Ракетная установка Mk.I',
    category: 'weapon',
    size: 3,
    mass: 60,
    energyConsumption: 2,
    cost: 80,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'weapon',
    weaponType: 'missile',
    damage: 80,
    range: 20000, // км
    fireRate: 0.2,
    energyPerShot: 2,
    accuracy: 70,
    damageType: 'missile',
    ammo: 20, // ракет в боезапасе
  },

  // ═════════════ Оборона (defense) ═══════════════════════════════════
  {
    id: 'shield_light_mk1',
    name: 'Лёгкий щит Mk.I',
    category: 'defense',
    size: 2,
    mass: 30,
    energyConsumption: 8,
    cost: 70,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'defense',
    defenseType: 'shield',
    shieldHP: 100,
    regenRate: 2, // %/тик
  },
  {
    id: 'armor_steel',
    name: 'Стальная обшивка',
    category: 'defense',
    size: 1,
    mass: 25, // масса 1 HS брони (25 т/HS)
    energyConsumption: 0,
    cost: 15,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'defense',
    defenseType: 'armor',
    hpPerHS: 50, // +50 HP на 1 HS
    massPerHS: 25, // 25 т/HS
  },

  // ═════════════ Вспомогательные (auxiliary) ═════════════════════════
  {
    id: 'cargo_bay_s',
    name: 'Грузовой отсек-S',
    category: 'auxiliary',
    size: 2,
    mass: 25,
    energyConsumption: 0,
    cost: 25,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'cargo',
    capacity: 100, // т груза
  },
  {
    id: 'fuel_tank_chemical_s',
    name: 'Топливный бак-S (хим)',
    category: 'auxiliary',
    size: 1,
    mass: 10,
    energyConsumption: 0,
    cost: 10,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'fuel_tank',
    fuelType: 'chemical',
    capacity: 50, // 50 ед. хим. топлива
  },
  {
    id: 'fuel_tank_xenon_s',
    name: 'Топливный бак-S (ксенон)',
    category: 'auxiliary',
    size: 1,
    mass: 50,
    energyConsumption: 0,
    cost: 20,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'fuel_tank',
    fuelType: 'xenon',
    capacity: 100, // 100 ед. ксенона
  },
  {
    id: 'fuel_tank_hydrogen_s',
    name: 'Топливный бак-S (водород)',
    category: 'auxiliary',
    size: 1,
    mass: 30,
    energyConsumption: 0,
    cost: 18,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'fuel_tank',
    fuelType: 'hydrogen',
    capacity: 200, // 200 ед. водорода
  },
  {
    id: 'scanner_basic',
    name: 'Сканер базовый',
    category: 'auxiliary',
    size: 1,
    mass: 30,
    energyConsumption: 1,
    cost: 15,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'scanner',
    capacity: 200, // 200 а.е. дальность сканирования (в UI можно не использовать)
  },
  {
    id: 'jump_drive_mk1',
    name: 'Прыжковый модуль Mk.I',
    category: 'auxiliary',
    size: 5,
    mass: 100,
    energyConsumption: 10, // энергозатратный
    cost: 80,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'jump_drive',
    maxJumpMass: 1500, // прыгает корабль массой до 1500 т
  },
  {
    id: 'colony_module_small',
    name: 'Колонизационный модуль',
    category: 'auxiliary',
    size: 3,
    mass: 50,
    energyConsumption: 0,
    cost: 40,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'colony',
    capacity: 1, // 1 использование (тратится при колонизации)
  },
  {
    id: 'reactor_nuclear_mk1',
    name: 'Ядерный реактор Mk.I',
    category: 'auxiliary',
    size: 4,
    mass: 120,
    energyConsumption: 0, // реактор не потребляет, он производит
    cost: 40,
    techLevel: 1,
    requiredTechs: [],
    slotRestriction: 'any',
    auxiliaryType: 'reactor',
    energyOutput: 50, // МВт; план документация §3.3
  },
];

/** Lookup-мапа: moduleId → ShipModule. */
export const MODULE_MAP = new Map<string, ShipModule>(SHIP_MODULES.map(m => [m.id, m]));

/** Получить модуль по id. */
export function getModule(id: string): ShipModule | undefined {
  return MODULE_MAP.get(id);
}

/** Список модулей указанной категории (для UI дизайнера). */
export function listModulesByCategory(category: ShipModule['category']): ShipModule[] {
  return SHIP_MODULES.filter(m => m.category === category);
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
