/// <reference types="bun-types" />
/**
 * Block 02 — T-FLEET-5 — Shipyard queue tests.
 *
 * T-FLEET-5: enqueueShipBuild + processShipyardTick.
 *
 * Скаут (50 тиков) → через 50 тиков processShipyardTick создаёт Ship с
 * designId, location = planetId, эмитит ships:constructed; ресурсы планеты
 * уменьшаются на cost_total = 415 у.е.р. × ресурсы/у.е.р.
 *
 * Run: bun test tests/ships/shipyard.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  enqueueShipBuild,
  processShipyardTick,
  getShipBuildTime,
  getShipBuildCostUER,
  getShipBuildCostResources,
  cancelShipyardItem,
  STEEL_PER_UER,
  MICROCHIP_PER_UER,
} from '@/data/ships/shipyard-queue';
import { gameBus } from '@/core/typed-event-bus';
import type { Planet, ShipDesign, ShipyardQueue, EntityId } from '@/core/types';
import type { HexTerrain, HexCell } from '@/core/types';

/** Минимальная rocky-планета с колонизированным owner и ресурсами. */
function makeTestPlanet(overrides?: Partial<Planet>): Planet {
  const hex: HexCell = {
    coord: { q: 0, r: 0 },
    terrain: 'plains' as HexTerrain,
    buildingId: 'shipyard',
    buildingLevel: 1,
    deposits: [],
  };
  return {
    id: 'planet_test',
    systemId: 'sys_test',
    name: 'Тест-планета',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6000,
    density: 5.5,
    gravity: 1.0,
    temperature: 20,
    atmosphere: { type: 'standard', pressure: 1.0, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 2,
    orbitalRadius: 1.5,
    orbitalPeriod: 365,
    hexes: [hex],
    atmosphericSlots: [],
    orbitSlots: [],
    resourceDeposits: [],
    resources: { steel: 100000, microchip: 100000 },
    energyBalance: 100,
    owner: 'player',
    ...overrides,
  };
}

/** Дизайн Разведчик §10.1 (cost=415 у.е.р.). */
function makeRazvedchik(): ShipDesign {
  return {
    id: 'design_razvedchik',
    name: 'Разведчик-α',
    hullId: 'hull_scout',
    armor: 'light',
    moduleIds: [
      'cpu_micro', 'engine_ion_mk1', 'scanner_basic', 'comm_mk2',
      'fuel_tank_xenon_s', 'jump_drive_mk1', 'navigator_mk1', 'reactor_nuclear_mk1',
    ],
    owner: 'player',
    createdAtTick: 0,
  };
}

/** Детерминированный счётчик ID кораблей. */
let shipIdCounter = 0;
const shipIdGen = () => `ship_${shipIdCounter++}`;

describe('Block 02 T-FLEET-5 — enqueueShipBuild + processShipyardTick', () => {
  test('getShipBuildTime для Скаута = 50 тиков (Приложение C)', () => {
    const design = makeRazvedchik();
    expect(getShipBuildTime(design)).toBe(50);
  });

  test('getShipBuildTime для Фрегата = 150 тиков', () => {
    const design: ShipDesign = {
      ...makeRazvedchik(),
      hullId: 'hull_frigate',
    };
    expect(getShipBuildTime(design)).toBe(150);
  });

  test('getShipBuildCostUER для Разведчик = 415 у.е.р.', () => {
    const design = makeRazvedchik();
    expect(getShipBuildCostUER(design)).toBe(415);
  });

  test('getShipBuildCostResources для Разведчик = 415 × 5 steel + 415 × 1 microchip', () => {
    const design = makeRazvedchik();
    const cost = getShipBuildCostResources(design);
    expect(cost.steel).toBe(415 * STEEL_PER_UER);
    expect(cost.microchip).toBe(415 * MICROCHIP_PER_UER);
  });

  test('enqueueShipBuild создаёт очередь с 1 item, totalTicks=50', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    const queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');
    expect(queue.planetId).toBe('planet_test');
    expect(queue.items.length).toBe(1);
    expect(queue.items[0]?.designId).toBe('design_razvedchik');
    expect(queue.items[0]?.totalTicks).toBe(50);
    expect(queue.items[0]?.progressTicks).toBe(0);
    expect(queue.items[0]?.shipName).toBe('Разведчик-1');
  });

  test('processShipyardTick — 1 тик → progress=1, не завершён', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    const queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');
    const result = processShipyardTick(planet, queue, shipIdGen, design);
    expect(result.completed).toBe(false);
    expect(result.ship).toBeUndefined();
    expect(result.newQueue.items[0]?.progressTicks).toBe(1);
  });

  test('processShipyardTick — 50 тиков → Ship создан, completed=true', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    let queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');

    // Run 49 ticks — не завершено
    for (let i = 0; i < 49; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      expect(r.completed).toBe(false);
      queue = r.newQueue;
    }
    expect(queue.items[0]?.progressTicks).toBe(49);

    // 50-й тик — завершён
    const result = processShipyardTick(planet, queue, shipIdGen, design);
    expect(result.completed).toBe(true);
    expect(result.ship).toBeDefined();
    expect(result.ship?.name).toBe('Разведчик-1');
    expect(result.ship?.designId).toBe('design_razvedchik');
    expect(result.ship?.hullId).toBe('hull_scout');
    expect(result.ship?.location).toBe('planet_test');
    expect(result.ship?.owner).toBe('player');
    expect(result.ship?.maxHp).toBe(200); // Скаут HP × light 1.0
    expect(result.ship?.hp).toBe(200);
    // После завершения — очередь пуста
    expect(result.newQueue.items.length).toBe(0);
  });

  test('processShipyardTick — после завершения planet.resources уменьшаются на cost_total × ресурсы/у.е.р.', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    const steelBefore = planet.resources['steel'] ?? 0;
    const microchipBefore = planet.resources['microchip'] ?? 0;

    let queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');
    for (let i = 0; i < 50; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      queue = r.newQueue;
    }

    const cost = getShipBuildCostResources(design);
    expect(planet.resources['steel']).toBe(steelBefore - cost.steel);
    expect(planet.resources['microchip']).toBe(microchipBefore - cost.microchip);
  });

  test('processShipyardTick — эмитит ships:constructed при завершении', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    let queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');

    const events: { shipId: EntityId; designId: EntityId; owner: EntityId }[] = [];
    const unsub = gameBus.on('ships:constructed', (p) => {
      events.push(p);
    });

    // 50 тиков
    for (let i = 0; i < 50; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      queue = r.newQueue;
    }

    expect(events.length).toBe(1);
    expect(events[0]?.designId).toBe('design_razvedchik');
    expect(events[0]?.owner).toBe('player');
    expect(events[0]?.shipId).toMatch(/^ship_\d+$/);

    unsub();
  });

  test('processShipyardTick — эмитит ships:construction-progress на каждом промежуточном тике', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    let queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');

    const progressEvents: { progressTicks: number; totalTicks: number }[] = [];
    const unsub = gameBus.on('ships:construction-progress', (p) => {
      progressEvents.push(p);
    });

    // 3 промежуточных тика (не завершено)
    for (let i = 0; i < 3; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      queue = r.newQueue;
    }

    expect(progressEvents.length).toBe(3);
    expect(progressEvents[0]?.progressTicks).toBe(1);
    expect(progressEvents[1]?.progressTicks).toBe(2);
    expect(progressEvents[2]?.progressTicks).toBe(3);
    expect(progressEvents[0]?.totalTicks).toBe(50);

    unsub();
  });

  test('processShipyardTick — недостаточно ресурсов → не завершён, прогресс не растёт', () => {
    // Мало ресурсов: steel=100, microchip=10 (нужно 2075 + 415)
    const planet = makeTestPlanet({
      resources: { steel: 100, microchip: 10 },
    });
    const design = makeRazvedchik();
    let queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');

    // Прогоняем 49 тиков (прогресс доходит до 49)
    for (let i = 0; i < 49; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      queue = r.newQueue;
    }
    expect(queue.items[0]?.progressTicks).toBe(49);

    // 50-й тик — недостаточно ресурсов → не завершён, прогресс не растёт
    const result = processShipyardTick(planet, queue, shipIdGen, design);
    expect(result.completed).toBe(false);
    expect(result.ship).toBeUndefined();
    // Прогресс остался 49 (не инкрементирован до 50, т.к. недостаточно ресурсов)
    expect(result.newQueue.items[0]?.progressTicks).toBe(49);
  });

  test('processShipyardTick — пустая очередь → completed=false, no ship', () => {
    const planet = makeTestPlanet();
    const emptyQueue: ShipyardQueue = { planetId: 'planet_test', items: [] };
    const result = processShipyardTick(planet, emptyQueue, shipIdGen, undefined);
    expect(result.completed).toBe(false);
    expect(result.ship).toBeUndefined();
    expect(result.newQueue.items.length).toBe(0);
  });

  test('processShipyardTick — design=undefined (был удалён) → item удалён из очереди', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    let queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');

    // Прогоняем 49 тиков
    for (let i = 0; i < 49; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      queue = r.newQueue;
    }

    // 50-й тик с design=undefined (эмуляция удаления дизайна)
    const result = processShipyardTick(planet, queue, shipIdGen, undefined);
    expect(result.completed).toBe(true);
    expect(result.ship).toBeUndefined();
    expect(result.newQueue.items.length).toBe(0); // item удалён
  });

  test('cancelShipyardItem — удаляет элемент по itemId', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    const queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');
    expect(queue.items.length).toBe(1);

    const newQueue = cancelShipyardItem(queue, 'item_1');
    expect(newQueue.items.length).toBe(0);
  });

  test('cancelShipyardItem — несуществующий itemId → очередь без изменений', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    const queue = enqueueShipBuild(planet, undefined, design, 'Разведчик-1', 'item_1');
    const newQueue = cancelShipyardItem(queue, 'nonexistent_id');
    expect(newQueue.items.length).toBe(1); // не изменилось
  });

  test('enqueueShipBuild — добавление нескольких дизайнов в очередь', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    let queue: ShipyardQueue | undefined = undefined;
    queue = enqueueShipBuild(planet, queue, design, 'Разведчик-1', 'item_1');
    queue = enqueueShipBuild(planet, queue, design, 'Разведчик-2', 'item_2');
    queue = enqueueShipBuild(planet, queue, design, 'Разведчик-3', 'item_3');

    expect(queue.items.length).toBe(3);
    expect(queue.items[0]?.shipName).toBe('Разведчик-1');
    expect(queue.items[1]?.shipName).toBe('Разведчик-2');
    expect(queue.items[2]?.shipName).toBe('Разведчик-3');
  });

  test('processShipyardTick — обрабатывает только первый item (FIFO)', () => {
    const planet = makeTestPlanet();
    const design = makeRazvedchik();
    let queue: ShipyardQueue | undefined = undefined;
    queue = enqueueShipBuild(planet, queue, design, 'Разведчик-1', 'item_1');
    queue = enqueueShipBuild(planet, queue, design, 'Разведчик-2', 'item_2');

    // 50 тиков — завершён только первый
    for (let i = 0; i < 50; i++) {
      const r = processShipyardTick(planet, queue, shipIdGen, design);
      queue = r.newQueue;
    }

    // Первый завершён — в очереди остался только второй
    expect(queue.items.length).toBe(1);
    expect(queue.items[0]?.shipName).toBe('Разведчик-2');
    expect(queue.items[0]?.progressTicks).toBe(0);
  });
});
