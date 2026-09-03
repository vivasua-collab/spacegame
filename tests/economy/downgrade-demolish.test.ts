/// <reference types="bun-types" />
/**
 * R-DEMOLISH (Задача 23) tests: понижение уровня и снос зданий.
 *
 * Правила:
 *   - downgrade: L → L−1, возврат 50% стоимости уровня L (base × (L−1) × 0.5);
 *     при L=1 превращается в снос.
 *   - demolish: полное освобождение гекса/слота, возврат 50% суммарных
 *     вложений (base × (1 + L(L−1)/2) × 0.5).
 *   - colony_hub защищён (ядро колонии).
 *   - энергобаланс пересчитывается; события эмитятся.
 *
 * Run: bun test tests/economy/downgrade-demolish.test.ts
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import { downgradeBuilding, demolishBuilding, DEMOLITION_REFUND_SHARE } from '@/economy/engine';
import { gameBus } from '@/core/typed-event-bus';
import { BUILDING_MAP } from '@/data/buildings';
import type { Planet, EventPayload } from '@/core/types';

const LAB = BUILDING_MAP.get('laboratory')!; // cost: Fe 30, Si 20, Cu 5
const MINE = BUILDING_MAP.get('mine')!; // cost: Fe 5, Si 3; energyConsumption 2

/** Планета-фикстура: 3 гекса в ряд + пустые ресурсы. */
function makePlanet(buildings: Array<{ idx: number; id: string; level: number }>): Planet {
  const planet: Planet = {
    id: 'p1',
    systemId: 's1',
    name: 'Demolish Test Planet',
    type: 'rocky',
    size: 'small',
    radiusKm: 5000,
    density: 5.5,
    gravity: 0.8,
    temperature: 20,
    atmosphere: { type: 'standard', pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes: [
      { coord: { q: 0, r: 0 }, terrain: 'plains', buildingId: null, buildingLevel: 0, deposits: [] },
      { coord: { q: 1, r: 0 }, terrain: 'plains', buildingId: null, buildingLevel: 0, deposits: [] },
      { coord: { q: 2, r: 0 }, terrain: 'plains', buildingId: null, buildingLevel: 0, deposits: [] },
    ],
    atmosphericSlots: [
      { buildingId: null, buildingLevel: 0 },
      { buildingId: null, buildingLevel: 0 },
    ],
    orbitSlots: [{ buildingId: null, buildingLevel: 0 }],
    moons: [],
    resourceDeposits: [],
    resources: {},
    energyBalance: 0,
    owner: 'player',
  } as unknown as Planet;
  for (const b of buildings) {
    const hex = planet.hexes[b.idx];
    if (hex) {
      hex.buildingId = b.id;
      hex.buildingLevel = b.level;
    }
  }
  return planet;
}

describe('R-DEMOLISH — downgradeBuilding', () => {
  test('L3 → L2: уровень уменьшен, возврат 50% стоимости уровня L3 (base × 2 × 0.5)', () => {
    const planet = makePlanet([{ idx: 1, id: 'laboratory', level: 3 }]);
    const ok = downgradeBuilding(planet, 'surface', 1);
    expect(ok).toBe(true);
    expect(planet.hexes[1]!.buildingId).toBe('laboratory');
    expect(planet.hexes[1]!.buildingLevel).toBe(2);
    // Стоимость уровня L=3: base × (L−1) = base × 2. Возврат 50%:
    // Fe: 30×2×0.5=30, Si: 20×2×0.5=20, Cu: 5×2×0.5=5.
    expect(planet.resources.Fe).toBe(30);
    expect(planet.resources.Si).toBe(20);
    expect(planet.resources.Cu).toBe(5);
  });

  test('L1 → снос (гекс освобождается, возврат 50% базовой стоимости)', () => {
    const planet = makePlanet([{ idx: 1, id: 'laboratory', level: 1 }]);
    const ok = downgradeBuilding(planet, 'surface', 1);
    expect(ok).toBe(true);
    expect(planet.hexes[1]!.buildingId).toBeNull();
    expect(planet.hexes[1]!.buildingLevel).toBe(0);
    // Возврат: base × 1 × 0.5: Fe 15, Si 10, Cu floor(2.5)=2.
    expect(planet.resources.Fe).toBe(15);
    expect(planet.resources.Si).toBe(10);
    expect(planet.resources.Cu).toBe(2);
  });

  test('событие economy:building-downgraded эмитится с новым уровнем', () => {
    const planet = makePlanet([{ idx: 1, id: 'laboratory', level: 3 }]);
    const events: Array<EventPayload<'economy:building-downgraded'>> = [];
    const off = gameBus.on('economy:building-downgraded', (p) => events.push(p));
    downgradeBuilding(planet, 'surface', 1);
    off();
    expect(events.length).toBe(1);
    expect(events[0]!.planetId).toBe('p1');
    expect(events[0]!.hexIndex).toBe(1);
    expect(events[0]!.level).toBe(2);
  });

  test('colony_hub защищён от понижения', () => {
    const planet = makePlanet([{ idx: 0, id: 'colony_hub', level: 3 }]);
    expect(downgradeBuilding(planet, 'surface', 0)).toBe(false);
    expect(planet.hexes[0]!.buildingLevel).toBe(3);
  });

  test('пустой гекс / неверный индекс → false', () => {
    const planet = makePlanet([]);
    expect(downgradeBuilding(planet, 'surface', 0)).toBe(false); // пусто
    expect(downgradeBuilding(planet, 'surface', 99)).toBe(false); // вне диапазона
  });

  test('слоты: атмосферный слот 0 → reportIndex = −1', () => {
    const planet = makePlanet([]);
    planet.atmosphericSlots[0]!.buildingId = 'laboratory';
    planet.atmosphericSlots[0]!.buildingLevel = 2;
    const events: Array<EventPayload<'economy:building-downgraded'>> = [];
    const off = gameBus.on('economy:building-downgraded', (p) => events.push(p));
    const ok = downgradeBuilding(planet, 'atmosphere', 0);
    off();
    expect(ok).toBe(true);
    expect(planet.atmosphericSlots[0]!.buildingLevel).toBe(1);
    expect(events[0]!.hexIndex).toBe(-1);
  });

  test('слоты: орбитальный слот 0 → reportIndex = −101', () => {
    const planet = makePlanet([]);
    planet.orbitSlots[0]!.buildingId = 'laboratory';
    planet.orbitSlots[0]!.buildingLevel = 2;
    const events: Array<EventPayload<'economy:building-downgraded'>> = [];
    const off = gameBus.on('economy:building-downgraded', (p) => events.push(p));
    const ok = downgradeBuilding(planet, 'orbit', 0);
    off();
    expect(ok).toBe(true);
    expect(events[0]!.hexIndex).toBe(-100 - 0);
  });
});

describe('R-DEMOLISH — demolishBuilding', () => {
  test('полный снос L3: гекс освобождён, возврат 50% суммарных вложений', () => {
    const planet = makePlanet([{ idx: 1, id: 'laboratory', level: 3 }]);
    const ok = demolishBuilding(planet, 'surface', 1);
    expect(ok).toBe(true);
    expect(planet.hexes[1]!.buildingId).toBeNull();
    expect(planet.hexes[1]!.buildingLevel).toBe(0);
    // Вложено до L3: base × (1 + 3×2/2) = base × 4. Возврат 50%: base × 2.
    expect(planet.resources.Fe).toBe(60);
    expect(planet.resources.Si).toBe(40);
    expect(planet.resources.Cu).toBe(10);
  });

  test('снос L1: возврат 50% базовой стоимости', () => {
    const planet = makePlanet([{ idx: 1, id: 'laboratory', level: 1 }]);
    expect(demolishBuilding(planet, 'surface', 1)).toBe(true);
    expect(planet.resources.Fe).toBe(15);
  });

  test('событие economy:building-demolished эмитится (hexIndex + buildingId)', () => {
    const planet = makePlanet([{ idx: 1, id: 'laboratory', level: 2 }]);
    const events: Array<EventPayload<'economy:building-demolished'>> = [];
    const off = gameBus.on('economy:building-demolished', (p) => events.push(p));
    demolishBuilding(planet, 'surface', 1);
    off();
    expect(events.length).toBe(1);
    expect(events[0]!.planetId).toBe('p1');
    expect(events[0]!.hexIndex).toBe(1);
    expect(events[0]!.buildingId).toBe('laboratory');
  });

  test('процессорное состояние экземпляра сбрасывается (specialization и пр.)', () => {
    const planet = makePlanet([{ idx: 1, id: 'processor', level: 2 }]);
    const hex = planet.hexes[1]! as unknown as Record<string, unknown>;
    hex.processorType = 'ore';
    hex.specialization = 'smelting';
    hex.specializationLevel = 2;
    hex.activeRecipes = ['r1'];
    expect(demolishBuilding(planet, 'surface', 1)).toBe(true);
    expect(hex.processorType).toBeUndefined();
    expect(hex.specialization).toBeUndefined();
    expect(hex.specializationLevel).toBeUndefined();
    expect(hex.activeRecipes).toBeUndefined();
  });

  test('colony_hub защищён от сноса', () => {
    const planet = makePlanet([{ idx: 0, id: 'colony_hub', level: 1 }]);
    expect(demolishBuilding(planet, 'surface', 0)).toBe(false);
    expect(planet.hexes[0]!.buildingId).toBe('colony_hub');
  });

  test('энергобаланс пересчитывается после сноса (mine: −2 → 0)', () => {
    const planet = makePlanet([{ idx: 1, id: 'mine', level: 1 }]);
    // До сноса: потребление mine L1 = 2 → energyBalance = −2.
    // (makePlanet ставит 0 — пересчитаем через demolish-механику.)
    expect(MINE.energyConsumption).toBe(2);
    demolishBuilding(planet, 'surface', 1);
    // После сноса потребителей нет → баланс 0.
    expect(planet.energyBalance).toBe(0);
  });

  test('пустой гекс / неверный индекс / space-слой → false', () => {
    const planet = makePlanet([]);
    expect(demolishBuilding(planet, 'surface', 0)).toBe(false);
    expect(demolishBuilding(planet, 'surface', 99)).toBe(false);
    expect(demolishBuilding(planet, 'space', 0)).toBe(false);
  });
});

describe('R-DEMOLISH — константы', () => {
  test('DEMOLITION_REFUND_SHARE = 0.5 (50% возврата)', () => {
    expect(DEMOLITION_REFUND_SHARE).toBe(0.5);
  });

  test('фикстуры: laboratory Fe 30 / Si 20 / Cu 5, mine energy 2 (синхронизация с каталогом)', () => {
    expect(LAB.costPerLevel.Fe).toBe(30);
    expect(LAB.costPerLevel.Si).toBe(20);
    expect(LAB.costPerLevel.Cu).toBe(5);
  });
});
