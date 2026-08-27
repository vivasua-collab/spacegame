/// <reference types="bun-types" />
/**
 * Block 02 — T-FLEET-1, T-FLEET-2 — Ship designer tests.
 *
 * T-FLEET-1: validateShip — Скаут без ЦПУ → invalid; Скаут с полным
 * дизайном Разведчик §10.1 → valid, mass ≈ 1075 т, speed ≈ 7.4 км/с.
 *
 * T-FLEET-2: calculateDesignStats — Разведчик §10.1: энергобаланс = −2 МВт,
 * стоимость = 415 у.е.р.
 *
 * Run: bun test tests/ships/designer.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { validateShip, calculateDesignStats, armorMultiplier } from '@/ships/designer';
import type { ShipDesign, EntityId } from '@/core/types';
import { HULLS, HULL_MAP } from '@/data/ships/hulls';
import { MODULE_MAP } from '@/data/ships/modules';

/** ctx для тестов — все гейты отключены (tech/level = high). */
const TEST_CTX = {
  shipyardLevel: 99,
  engineeringLevel: 99,
  researchedTechs: ['all'],
};

/**
 * Дизайн «Разведчик §10.1» — Скаут + light armor + 8 модулей:
 * cpu_micro + engine_ion_mk1 + scanner_basic + comm_mk2 +
 * fuel_tank_xenon_s + jump_drive_mk1 + navigator_mk1 + reactor_nuclear_mk1.
 */
function makeRazvedchik(id: EntityId = 'design_razvedchik'): ShipDesign {
  return {
    id,
    name: 'Разведчик-α',
    hullId: 'hull_scout',
    armor: 'light',
    moduleIds: [
      'cpu_micro',
      'engine_ion_mk1',
      'scanner_basic',
      'comm_mk2',
      'fuel_tank_xenon_s',
      'jump_drive_mk1',
      'navigator_mk1',
      'reactor_nuclear_mk1',
    ],
    owner: 'player',
    createdAtTick: 0,
  };
}

describe('Block 02 T-FLEET-1 — validateShip', () => {
  test('Скаут без ЦПУ → invalid, ошибка содержит «ЦПУ»', () => {
    const design: ShipDesign = {
      id: 'design_no_cpu',
      name: 'Без ЦПУ',
      hullId: 'hull_scout',
      armor: 'light',
      moduleIds: ['engine_ion_mk1', 'jump_drive_mk1', 'reactor_nuclear_mk1'],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ЦПУ'))).toBe(true);
  });

  test('Скаут без двигателя → invalid, ошибка содержит «двигатель»', () => {
    const design: ShipDesign = {
      id: 'design_no_engine',
      name: 'Без двигателя',
      hullId: 'hull_scout',
      armor: 'light',
      moduleIds: ['cpu_micro', 'jump_drive_mk1', 'reactor_nuclear_mk1'],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('двигател'))).toBe(true);
  });

  test('Превышение HS → invalid', () => {
    // Скаут totalHS=25. Кладём 7 × jump_drive_mk1 (size=5) = 35 HS > 25.
    const design: ShipDesign = {
      id: 'design_overload',
      name: 'Перегруз',
      hullId: 'hull_scout',
      armor: 'light',
      moduleIds: [
        'cpu_micro', 'engine_ion_mk1', 'reactor_nuclear_mk1',
        'jump_drive_mk1', 'jump_drive_mk1', 'jump_drive_mk1',
        'jump_drive_mk1',
      ],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('hs') || e.toLowerCase().includes('объём'))).toBe(true);
  });

  test('Разведчик §10.1 (Скаут + 8 модулей) → valid: true', () => {
    const design = makeRazvedchik();
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('Разведчик §10.1 — stats: mass ≈ 1075 т, speed ≈ 7.4 км/с', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.isValid).toBe(true);
    // Mass tolerance: 1075 ± 5
    expect(Math.abs(stats.mass - 1075)).toBeLessThan(5);
    // Speed tolerance: 7.4 ± 0.1
    expect(Math.abs(stats.speed - 7.4)).toBeLessThan(0.1);
  });

  test('Скаут с толстой обшивкой (heavy) → invalid — hull.armorOptions не включает heavy', () => {
    const design: ShipDesign = {
      id: 'design_heavy_scout',
      name: 'Скаут-тяжёлый',
      hullId: 'hull_scout',
      armor: 'heavy', // скаут поддерживает только ['light','standard']
      moduleIds: ['cpu_micro', 'engine_ion_mk1', 'reactor_nuclear_mk1'],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('обшивк') || e.toLowerCase().includes('armor'))).toBe(true);
  });

  test('ЦПУ-Лёгкий (minHull=fighter) на Скаут → invalid', () => {
    const design: ShipDesign = {
      id: 'design_cpu_light_on_scout',
      name: 'ЦПУ-Лёгкий на Скаут',
      hullId: 'hull_scout',
      armor: 'light',
      moduleIds: ['cpu_light', 'engine_ion_mk1', 'reactor_nuclear_mk1'],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('корпус') || e.toLowerCase().includes('требует'))).toBe(true);
  });

  test('Неизвестный корпус → invalid', () => {
    const design: ShipDesign = {
      id: 'design_unknown_hull',
      name: 'Невалидный корпус',
      hullId: 'hull_nonexistent',
      armor: 'light',
      moduleIds: ['cpu_micro'],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('корпус'))).toBe(true);
  });

  test('Неизвестный модуль → invalid', () => {
    const design: ShipDesign = {
      id: 'design_unknown_module',
      name: 'Невалидный модуль',
      hullId: 'hull_scout',
      armor: 'light',
      moduleIds: ['cpu_micro', 'nonexistent_module_id', 'engine_ion_mk1', 'reactor_nuclear_mk1'],
      owner: 'player',
      createdAtTick: 0,
    };
    const result = validateShip(design, TEST_CTX);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('модуль'))).toBe(true);
  });
});

describe('Block 02 T-FLEET-2 — calculateDesignStats', () => {
  test('Разведчик §10.1 — энергобаланс = −2 МВт', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    // Production: reactor_nuclear_mk1 = 50 МВт
    // Consumption: cpu(5) + engine_ion(30) + scanner(1) + comm_mk2(4) + jump_drive(10) + navigator(2) = 52
    // Balance = 50 - 52 = -2
    expect(stats.energyBalance).toBe(-2);
  });

  test('Разведчик §10.1 — стоимость = 415 у.е.р.', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    // hull 50 × 1.0 (light) + sum(modules):
    // cpu(30) + engine_ion(100) + scanner(15) + comm_mk2(50) + fuel_tank(20) + jump_drive(80) + navigator(30) + reactor(40) = 365
    // total = 50 + 365 = 415
    expect(stats.cost).toBe(415);
  });

  test('Разведчик §10.1 — масса = 1075 т', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.mass).toBe(1075);
  });

  test('Разведчик §10.1 — скорость ≈ 7.4 км/с', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    // thrust=800, mass=1075, speed = 800/1075 × 10 = 7.441...
    expect(Math.abs(stats.speed - 7.4)).toBeLessThan(0.1);
  });

  test('Разведчик §10.1 — прыжок доступен (canJump=true)', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.canJump).toBe(true);
    // jump_drive_mk1 maxJumpMass = 1500
    expect(stats.jumpRangeMass).toBe(1500);
  });

  test('Разведчик §10.1 — дальность связи = 15 св. лет (comm_mk2)', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.commRange).toBe(15);
  });

  test('Разведчик §10.1 — топливный бак ксенон = 100 ед.', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.fuelCapacity['xenon']).toBe(100);
  });

  test('Разведчик §10.1 — использовано 18 HS из 25 (freeHS=7)', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    // cpu_micro(1) + engine_ion(4) + scanner(1) + comm_mk2(1) + fuel_tank(1) + jump_drive(5) + navigator(1) + reactor(4) = 18
    expect(stats.usedHS).toBe(18);
    expect(stats.totalHS).toBe(25);
    expect(stats.freeHS).toBe(7);
  });

  test('Разведчик §10.1 — HP корпуса = 200 (hull baseHP × light 1.0)', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.totalHP).toBe(200);
  });

  test('Разведчик §10.1 — щиты = 0 (нет shield модулей)', () => {
    const design = makeRazvedchik();
    const stats = calculateDesignStats(design);
    expect(stats.shieldHP).toBe(0);
  });
});

describe('Block 02 — armorMultiplier (§2.3)', () => {
  test('light = {1.0, 1.0, 1.0}', () => {
    expect(armorMultiplier('light')).toEqual({ hpMult: 1.0, massMult: 1.0, costMult: 1.0 });
  });
  test('standard = {1.25, 1.10, 1.20}', () => {
    expect(armorMultiplier('standard')).toEqual({ hpMult: 1.25, massMult: 1.1, costMult: 1.2 });
  });
  test('thick = {1.50, 1.25, 1.50}', () => {
    expect(armorMultiplier('thick')).toEqual({ hpMult: 1.5, massMult: 1.25, costMult: 1.5 });
  });
  test('heavy = {2.00, 1.50, 2.00}', () => {
    expect(armorMultiplier('heavy')).toEqual({ hpMult: 2.0, massMult: 1.5, costMult: 2.0 });
  });
});

describe('Block 02 — каталог данных (hulls + modules)', () => {
  test('HULLS содержит 4 MVP-корпуса', () => {
    expect(HULLS.length).toBe(4);
    const ids = HULLS.map(h => h.id);
    expect(ids).toContain('hull_scout');
    expect(ids).toContain('hull_fighter');
    expect(ids).toContain('hull_frigate');
    expect(ids).toContain('hull_transport');
  });

  test('HULL_MAP lookup работает', () => {
    const scout = HULL_MAP.get('hull_scout');
    expect(scout).toBeDefined();
    expect(scout?.totalHS).toBe(25);
    expect(scout?.baseHP).toBe(200);
    expect(scout?.baseMass).toBe(500);
    expect(scout?.weaponSlots).toBe(1);
    expect(scout?.engineSlots).toBe(2);
    expect(scout?.systemSlots).toBe(3);
    expect(scout?.defenseSlots).toBe(1);
    expect(scout?.baseCost).toBe(50);
    expect(scout?.armorOptions).toEqual(['light', 'standard']);
  });

  test('Скаут: requiredEngineeringLevel=1, requiredShipyardLevel=1', () => {
    const scout = HULL_MAP.get('hull_scout');
    expect(scout?.requiredEngineeringLevel).toBe(1);
    expect(scout?.requiredShipyardLevel).toBe(1);
  });

  test('Фрегат: requiredEngineeringLevel=2, requiredShipyardLevel=2', () => {
    const frigate = HULL_MAP.get('hull_frigate');
    expect(frigate?.requiredEngineeringLevel).toBe(2);
    expect(frigate?.requiredShipyardLevel).toBe(2);
  });

  test('Каталог модулей содержит все MVP-модули', () => {
    const expectedModules = [
      'engine_chemical_mk1', 'engine_ion_mk1',
      'cpu_micro', 'cpu_light', 'navigator_mk1', 'comm_mk1', 'comm_mk2',
      'life_support_cabin',
      'weapon_laser_mk1', 'weapon_missile_mk1',
      'shield_light_mk1', 'armor_steel',
      'cargo_bay_s', 'fuel_tank_chemical_s', 'fuel_tank_xenon_s',
      'fuel_tank_hydrogen_s', 'scanner_basic', 'jump_drive_mk1',
      'colony_module_small', 'reactor_nuclear_mk1',
    ];
    for (const id of expectedModules) {
      expect(MODULE_MAP.has(id)).toBe(true);
    }
  });

  test('engine_ion_mk1 — корректные параметры', () => {
    const m = MODULE_MAP.get('engine_ion_mk1');
    expect(m).toBeDefined();
    expect(m?.category).toBe('engine');
    expect(m?.mass).toBe(200);
    expect(m?.thrust).toBe(800);
    expect(m?.fuelType).toBe('xenon');
    expect(m?.energyConsumption).toBe(30);
    expect(m?.cost).toBe(100);
    expect(m?.slotRestriction).toBe('engine');
  });

  test('reactor_nuclear_mk1 — energyOutput=50 МВт', () => {
    const m = MODULE_MAP.get('reactor_nuclear_mk1');
    expect(m).toBeDefined();
    expect(m?.auxiliaryType).toBe('reactor');
    expect(m?.energyOutput).toBe(50);
    expect(m?.energyConsumption).toBe(0);
  });

  test('comm_mk2 — communicationRange=15 св. лет', () => {
    const m = MODULE_MAP.get('comm_mk2');
    expect(m).toBeDefined();
    expect(m?.controlType).toBe('communication');
    expect(m?.communicationRange).toBe(15);
  });

  test('jump_drive_mk1 — maxJumpMass=1500 т', () => {
    const m = MODULE_MAP.get('jump_drive_mk1');
    expect(m).toBeDefined();
    expect(m?.auxiliaryType).toBe('jump_drive');
    expect(m?.maxJumpMass).toBe(1500);
  });

  test('cpu_light — minHull=fighter (нельзя на Скаут)', () => {
    const m = MODULE_MAP.get('cpu_light');
    expect(m).toBeDefined();
    expect(m?.minHull).toBe('fighter');
  });
});
