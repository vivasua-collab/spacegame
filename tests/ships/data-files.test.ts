/**
 * R-SHIPS-DATA: тесты обратной совместимости API data-driven каталога кораблей.
 *
 * Гарантируют, что миграция hulls.ts/modules.ts/fuel-map.ts → JSON
 * (с тонкими TS-loader'ами) НЕ сломала публичный API и runtime-данные.
 *
 * Покрытие:
 *   - HULLS/HULL_MAP/getHull/listHulls экспортируют корректный массив
 *   - SHIP_MODULES/MODULE_MAP/getModule/listModulesByCategory/listModulesForHull
 *   - FUEL_TO_ELEMENT/ELEMENT_TO_FUEL/FUEL_ELEMENT_COST_PER_UNIT/ALL_FUEL_TYPES/emptyFuelStore
 *   - Ключевые точечные данные (T-FLEET-1 spec: scout + light + 8 модулей)
 *   - JSON-структура: файлы загружаются, массивы непустые, comment-поле есть
 *   - IDs уникальны (валидатор тоже проверяет, но тест гарантирует на CI)
 */

import { describe, it, expect } from 'bun:test';
import {
  HULLS,
  HULL_MAP,
  getHull,
  listHulls,
  SHIP_MODULES,
  MODULE_MAP,
  getModule,
  listModulesByCategory,
  listModulesForHull,
  FUEL_TO_ELEMENT,
  ELEMENT_TO_FUEL,
  FUEL_ELEMENT_COST_PER_UNIT,
  ALL_FUEL_TYPES,
  emptyFuelStore,
} from '@/data/ships';

import hullsJson from '@/data/ships/hulls.json';
import modulesJson from '@/data/ships/modules.json';
import fuelJson from '@/data/ships/fuel-map.json';

// ─── Hulls ───────────────────────────────────────────────────────────────

describe('R-SHIPS-DATA: hulls data-driven JSON', () => {
  it('hulls.json загружается как объект с массивом hulls', () => {
    expect(typeof hullsJson).toBe('object');
    expect(hullsJson).not.toBeNull();
    const data = hullsJson as { comment?: string; hulls: unknown[] };
    expect(Array.isArray(data.hulls)).toBe(true);
    expect(data.hulls.length).toBeGreaterThan(0);
    expect(typeof data.comment).toBe('string');
  });

  it('HULLS содержит ровно 4 корпуса MVP (scout/fighter/frigate/transport)', () => {
    expect(HULLS).toHaveLength(4);
    const ids = HULLS.map((h) => h.id).sort();
    expect(ids).toEqual(
      ['hull_fighter', 'hull_frigate', 'hull_scout', 'hull_transport'],
    );
  });

  it('HULL_MAP обеспечивает O(1) поиск по id', () => {
    expect(HULL_MAP.size).toBe(4);
    for (const h of HULLS) {
      expect(HULL_MAP.get(h.id)).toBe(h);
    }
  });

  it('getHull возвращает корпус по id или undefined', () => {
    expect(getHull('hull_scout')?.name).toBe('Скаут');
    expect(getHull('hull_frigate')?.totalHS).toBe(100);
    expect(getHull('nonexistent')).toBeUndefined();
  });

  it('listHulls возвращает полный массив (не копию ссылок, но новый list)', () => {
    const list = listHulls();
    expect(list).toHaveLength(4);
    expect(list).toEqual(HULLS);
  });

  // ── T-FLEET-1 spec scout fixture (docs/50-ships.md §10.1) ──
  it('hull_scout имеет параметры из T-FLEET-1 спеки', () => {
    const scout = getHull('hull_scout');
    expect(scout).toBeDefined();
    expect(scout?.size).toBe('scout');
    expect(scout?.totalHS).toBe(25);
    expect(scout?.baseHP).toBe(200);
    expect(scout?.baseMass).toBe(500);
    expect(scout?.baseCost).toBe(50);
    expect(scout?.armorOptions).toEqual(['light', 'standard']);
    expect(scout?.requiredShipyardLevel).toBe(1);
  });

  it('тяжёлые корпуса (cruiser/battleship/flagship) НЕ присутствуют в MVP', () => {
    expect(getHull('hull_cruiser')).toBeUndefined();
    expect(getHull('hull_battleship')).toBeUndefined();
    expect(getHull('hull_flagship')).toBeUndefined();
  });

  it('все hull IDs уникальны', () => {
    const ids = HULLS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('все armorOptions валидны', () => {
    const valid = ['light', 'standard', 'thick', 'heavy'];
    for (const h of HULLS) {
      for (const opt of h.armorOptions) {
        expect(valid).toContain(opt);
      }
    }
  });
});

// ─── Modules ─────────────────────────────────────────────────────────────

describe('R-SHIPS-DATA: modules data-driven JSON', () => {
  it('modules.json загружается как объект с массивом modules', () => {
    expect(typeof modulesJson).toBe('object');
    expect(modulesJson).not.toBeNull();
    const data = modulesJson as { comment?: string; modules: unknown[] };
    expect(Array.isArray(data.modules)).toBe(true);
    expect(data.modules.length).toBeGreaterThan(0);
    expect(typeof data.comment).toBe('string');
  });

  it('SHIP_MODULES содержит 20 модулей MVP (2+5+1+2+2+8)', () => {
    expect(SHIP_MODULES.length).toBe(20);
    const cats = {
      engine: 0, control: 0, life_support: 0, weapon: 0, defense: 0, auxiliary: 0,
    };
    for (const m of SHIP_MODULES) cats[m.category]++;
    expect(cats).toEqual({
      engine: 2, control: 5, life_support: 1, weapon: 2, defense: 2, auxiliary: 8,
    });
  });

  it('MODULE_MAP обеспечивает O(1) поиск по id', () => {
    expect(MODULE_MAP.size).toBe(20);
    for (const m of SHIP_MODULES) {
      expect(MODULE_MAP.get(m.id)).toBe(m);
    }
  });

  it('getModule возвращает модуль по id или undefined', () => {
    expect(getModule('engine_ion_mk1')?.name).toBe('Ионный двигатель Mk.I');
    expect(getModule('reactor_nuclear_mk1')?.energyOutput).toBe(50);
    expect(getModule('nonexistent')).toBeUndefined();
  });

  it('listModulesByCategory фильтрует по category', () => {
    const engines = listModulesByCategory('engine');
    expect(engines).toHaveLength(2);
    expect(engines.every((m) => m.category === 'engine')).toBe(true);

    const aux = listModulesByCategory('auxiliary');
    expect(aux).toHaveLength(8);
  });

  it('listModulesForHull возвращает копию всего массива (MVP: без гейта)', () => {
    const list = listModulesForHull('hull_scout');
    expect(list).toHaveLength(SHIP_MODULES.length);
    expect(list).not.toBe(SHIP_MODULES); // slice возвращает новый массив
  });

  it('engine_ion_mk1 имеет бонус multiply к ship_thrust (R-RES §E demo)', () => {
    const ion = getModule('engine_ion_mk1');
    expect(ion?.bonuses).toBeDefined();
    expect(ion?.bonuses).toHaveLength(1);
    expect(ion?.bonuses?.[0]?.target).toBe('ship_thrust');
    expect(ion?.bonuses?.[0]?.operation).toBe('multiply');
    expect(ion?.bonuses?.[0]?.value).toBe(1.10);
  });

  it('T-FLEET-1 Разведчик: все 8 модулей из спеки присутствуют', () => {
    const specModuleIds = [
      'cpu_micro', 'engine_ion_mk1', 'scanner_basic', 'comm_mk2',
      'fuel_tank_xenon_s', 'jump_drive_mk1', 'navigator_mk1', 'reactor_nuclear_mk1',
    ];
    for (const id of specModuleIds) {
      expect(getModule(id), `missing ${id}`).toBeDefined();
    }
  });

  it('все module IDs уникальны', () => {
    const ids = SHIP_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('каждый модуль имеет requiredTechs (хотя бы пустой массив)', () => {
    for (const m of SHIP_MODULES) {
      expect(Array.isArray(m.requiredTechs)).toBe(true);
    }
  });
});

// ─── Fuel-map ────────────────────────────────────────────────────────────

describe('R-SHIPS-DATA: fuel-map data-driven JSON', () => {
  it('fuel-map.json загружается как объект с 4 ключами', () => {
    expect(typeof fuelJson).toBe('object');
    expect(fuelJson).not.toBeNull();
    const data = fuelJson as {
      comment?: string;
      fuelToElement: unknown;
      elementToFuel: unknown;
      fuelElementCostPerUnit: unknown;
      allFuelTypes: unknown;
    };
    expect(typeof data.comment).toBe('string');
    expect(typeof data.fuelToElement).toBe('object');
    expect(typeof data.elementToFuel).toBe('object');
    expect(typeof data.fuelElementCostPerUnit).toBe('object');
    expect(Array.isArray(data.allFuelTypes)).toBe(true);
  });

  it('FUEL_TO_ELEMENT маппит 4 типа топлива на elementId', () => {
    expect(Object.keys(FUEL_TO_ELEMENT)).toHaveLength(4);
    expect(FUEL_TO_ELEMENT.chemical).toBe('H');
    expect(FUEL_TO_ELEMENT.xenon).toBe('Xe');
    expect(FUEL_TO_ELEMENT.hydrogen).toBe('H');
    expect(FUEL_TO_ELEMENT.antimatter).toBe('antimatter');
  });

  it('ELEMENT_TO_FUEL — обратная мапа для resource-panel', () => {
    expect(ELEMENT_TO_FUEL.H).toBe('hydrogen');
    expect(ELEMENT_TO_FUEL.Xe).toBe('xenon');
    expect(ELEMENT_TO_FUEL.antimatter).toBe('antimatter');
  });

  it('FUEL_ELEMENT_COST_PER_UNIT: MVP 1:1 для всех типов', () => {
    expect(Object.keys(FUEL_ELEMENT_COST_PER_UNIT)).toHaveLength(4);
    for (const ft of ALL_FUEL_TYPES) {
      expect(FUEL_ELEMENT_COST_PER_UNIT[ft]).toBe(1);
    }
  });

  it('ALL_FUEL_TYPES содержит 4 типа (chemical, xenon, hydrogen, antimatter)', () => {
    expect(ALL_FUEL_TYPES).toHaveLength(4);
    const sorted = [...ALL_FUEL_TYPES].sort();
    expect(sorted).toEqual(['antimatter', 'chemical', 'hydrogen', 'xenon']);
  });

  it('emptyFuelStore создаёт объект со всеми 0', () => {
    const store = emptyFuelStore();
    expect(Object.keys(store)).toHaveLength(4);
    for (const ft of ALL_FUEL_TYPES) {
      expect(store[ft]).toBe(0);
    }
  });

  it('каждый ключ FUEL_TO_ELEMENT присутствует в FUEL_ELEMENT_COST_PER_UNIT и ALL_FUEL_TYPES', () => {
    const fteKeys = new Set(Object.keys(FUEL_TO_ELEMENT));
    const costKeys = new Set(Object.keys(FUEL_ELEMENT_COST_PER_UNIT));
    const allSet = new Set(ALL_FUEL_TYPES);
    expect(fteKeys).toEqual(allSet);
    expect(costKeys).toEqual(allSet);
  });
});
