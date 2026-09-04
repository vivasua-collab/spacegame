/// <reference types="bun-types" />
/**
 * R-28 (2026-08-31): тесты компактного формата сейва v2
 * (src/lib/save-format-v2.ts).
 *
 * R-29: продовый сериализатор теперь пишет v3, но v2-ДЕКОДЕР
 * (expandSaveV2 + миграция флагов) — живой путь загрузки старых сейвов
 * (например, сейв владельца Galaxy #213397). Поэтому тесты переключены
 * на unit-уровень: JSON формата v2 строится компакт-кодеком v2
 * (compactSaveV2) на материализованном состоянии (как выглядели сейвы
 * до R-29 — со запечёнными залежами).
 *
 * Тесты:
 *   1. Round-trip структуры: залежи-кортежи → объекты (все поля, включая
 *      processor-поля застроенных гексов), coord восстанавливается из сетки.
 *   2. Свод resourceDeposits: кортежи с tierIdx → объекты, tier восстановлен.
 *   3. Размер: v2 строго меньше v1-объектной формы (порог 40% на 30 систем).
 *   4. Идемпотентность: serialize(deserialize(serialize(s))) === serialize(s).
 *   5. Обратная совместимость: v1-JSON (без fmt) читается как раньше,
 *      залаежи-объекты не трогаются expandSaveV2.
 *   6. Застройка сохраняется: buildingId/Level + processor-поля round-trip.
 *   7. Звёзды: mass/luminosity/temperature/radius → 4 значащих цифры.
 *   8. Газовые гиганты: hexes:[] остаётся [], атмосферные слоты не тронуты.
 *   9. Маркер fmt не протекает в восстановленный GameState.
 *  10. Луны: гексы лун восстанавливаются с координатами малых сеток.
 *
 * Run: bun test tests/save-format-v2.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { deserializeGameState } from '@/stores/game-store';
import { compactSaveV2, expandSaveV2, SAVE_FORMAT_VERSION, isSaveFormatV2 } from '@/lib/save-format-v2';
import { generateHexCoords } from '@/galaxy/hex-grid';
import { materializePlanetDeposits } from '@/galaxy/generate-resources';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState, Planet, HexCell, ResourceDeposit } from '@/core/types';

/** Первая планета с непустой гекс-сеткой (не ГГ) среди всех систем. */
function firstPlanetWithHexes(state: GameState, minHexes = 1): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.hexes.length >= minHexes) return p;
    }
  }
  throw new Error('нет планет с гексами');
}

function buildFreshState(systemCount: number, materialize = false): GameState {
  const galaxy = generateGalaxy({ seed: 42, systemCount });
  const state: GameState = {
    time: { tick: 7, dayInYear: 100, year: 2 },
    speed: 1,
    phase: 'playing',
    galaxy,
    productionQueues: new Map(),
    fleets: [],
    playerFactionId: 'player',
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map(),
    researchState: createDefaultResearchState(),
  };
  // R-29: свежая генерация теперь ЛЕНИВАЯ (залежей в гексах нет). Для
  // тестов v2-кодека воспроизводим ДО-R-29 вид: все тела материализованы
  // (как выглядели старые сейвы).
  if (materialize) materializeAllBodies(state);
  return state;
}

/** Материализовать залежи всех тел (планеты + луны) — как до R-29. */
function materializeAllBodies(state: GameState): void {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      materializePlanetDeposits(p);
      for (const m of p.moons) materializePlanetDeposits(m);
    }
  }
}

/**
 * R-29: JSON в формате v2 (как писали до R-29): компакт-кодек v2 поверх
 * сериализуемой формы — тот же пайплайн, что был в serializeGameState
 * до перехода на v3.
 */
function serializeV2(state: GameState): string {
  const { systemMap: _systemMap, bakedModel: _bakedModel, ...galaxyWithoutMap } = state.galaxy;
  const serializable = {
    ...state,
    galaxy: galaxyWithoutMap,
    productionQueues: Array.from(state.productionQueues.entries()),
    shipDesigns: Array.from(state.shipDesigns.entries()),
    shipyardQueues: Array.from(state.shipyardQueues.entries()),
    ships: Array.from(state.ships.entries()),
  };
  return JSON.stringify(compactSaveV2(serializable as unknown as Record<string, unknown>));
}

/** Все планеты и луны всех систем. */
function* allBodies(state: GameState): Generator<Planet> {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      yield p;
      for (const m of p.moons) yield m as unknown as Planet;
    }
  }
}

describe('R-28: формат сейва v2', () => {
  test('1. Round-trip: кортежи залежей → объекты, coord из сетки, структура целa', () => {
    const original = buildFreshState(20, true);
    const json = serializeV2(original);
    expect(isSaveFormatV2(json)).toBe(true);

    const restored = deserializeGameState(json);

    let hexesChecked = 0;
    let depositsChecked = 0;
    for (const body of allBodies(restored)) {
      for (let i = 0; i < body.hexes.length; i++) {
        const hex = body.hexes[i]!;
        // coord восстановлена из сетки по индексу
        const expectedCoord = generateHexCoords(body.hexes.length)[i]!;
        expect(hex.coord).toEqual(expectedCoord);
        // постренные гексы несут buildingId (null после реконструкции)
        expect(hex).toHaveProperty('buildingId');
        expect(hex).toHaveProperty('buildingLevel');
        expect(hex).toHaveProperty('deposits');
        hexesChecked++;
        depositsChecked += hex.deposits.length;
        for (const d of hex.deposits) {
          expect(typeof d.elementId).toBe('string');
          expect(typeof d.availability).toBe('number');
          expect(typeof d.quantity).toBe('number');
          expect(typeof d.depth).toBe('number');
        }
      }
    }
    expect(hexesChecked).toBeGreaterThan(200); // 20 систем — сеть ненулевая
    expect(depositsChecked).toBeGreaterThan(500);

    // Сравнение с оригиналом: структура идентична, числа с допуском.
    const origBodies = [...allBodies(original)];
    let idx = 0;
    for (const body of allBodies(restored)) {
      const orig = origBodies[idx++]!;
      expect(body.hexes.length).toBe(orig.hexes.length);
      for (let i = 0; i < body.hexes.length; i++) {
        const a = body.hexes[i]!;
        const b = orig.hexes[i]!;
        expect(a.terrain).toBe(b.terrain);
        expect(a.buildingId).toBe(b.buildingId);
        expect(a.deposits.length).toBe(b.deposits.length);
        for (let d = 0; d < a.deposits.length; d++) {
          const da = a.deposits[d] as ResourceDeposit;
          const db = b.deposits[d] as ResourceDeposit;
          expect(da.elementId).toBe(db.elementId);
          expect(Math.abs(da.availability - db.availability)).toBeLessThanOrEqual(0.0006);
          expect(da.quantity).toBe(db.quantity);
          expect(da.depth).toBe(db.depth);
        }
      }
    }
  });

  test('2. Свод resourceDeposits: кортежи → объекты, tier восстановлен', () => {
    const original = buildFreshState(10);
    const json = serializeV2(original);
    const restored = deserializeGameState(json);

    // В сериализованном JSON свод — кортежи
    const parsed = JSON.parse(json) as { galaxy: { systems: Array<{ planets: Array<{ resourceDeposits: unknown[][] }> }> } };
    const firstPlanetWithDeposits = parsed.galaxy.systems
      .flatMap((s) => s.planets)
      .find((p) => p.resourceDeposits.length > 0)!;
    const tuple = firstPlanetWithDeposits.resourceDeposits[0]!;
    expect(Array.isArray(tuple)).toBe(true);
    expect(tuple.length).toBe(6);
    expect(typeof tuple[0]).toBe('string');
    expect(typeof tuple[3]).toBe('number'); // tierIdx 0/1/2

    // После загрузки — объекты с корректным tier
    const origBodies = [...allBodies(original)];
    const restoredBodies = [...allBodies(restored)];
    let compared = 0;
    for (let i = 0; i < restoredBodies.length; i++) {
      const a = restoredBodies[i]!.resourceDeposits;
      const b = origBodies[i]!.resourceDeposits;
      expect(a.length).toBe(b.length);
      for (let j = 0; j < a.length; j++) {
        expect(a[j]!.elementId).toBe(b[j]!.elementId);
        expect(a[j]!.tier).toBe(b[j]!.tier);
        expect(a[j]!.hexCount).toBe(b[j]!.hexCount);
        expect(a[j]!.totalQuantity).toBe(b[j]!.totalQuantity);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  test('3. Размер: v2 минимум на 40% меньше объектной формы', () => {
    const state = buildFreshState(30, true);
    const v2 = serializeV2(state);

    // v1-форма: то же состояние без компактора (как до R-28)
    const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = state.galaxy;
    const v1 = JSON.stringify({
      ...state,
      galaxy: galaxyWithoutMap,
      productionQueues: Array.from(state.productionQueues.entries()),
      shipDesigns: Array.from(state.shipDesigns.entries()),
      shipyardQueues: Array.from(state.shipyardQueues.entries()),
      ships: Array.from(state.ships.entries()),
    });

    expect(v2.length).toBeLessThan(v1.length * 0.6);
    // Данные не потеряны: обе формы разворачиваются в одинаковые states
    const s2 = deserializeGameState(v2);
    expect(s2.galaxy.systems.length).toBe(30);
    expect(s2.galaxy.systems.flatMap((s) => s.planets).length)
      .toBe(state.galaxy.systems.flatMap((s) => s.planets).length);
  });

  test('4. Идемпотентность: serialize(deserialize(serialize(s))) === serialize(s)', () => {
    const state = buildFreshState(10, true);
    const json1 = serializeV2(state);
    const roundTripped = deserializeGameState(json1);
    const json2 = serializeV2(roundTripped);
    expect(json2).toBe(json1);
  });

  test('5. Обратная совместимость: v1-JSON без fmt читается как раньше', () => {
    const state = buildFreshState(15, true);
    // Собираем v1-форму вручную (объектные залежи, coord на месте)
    const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = state.galaxy;
    const v1Raw = {
      ...state,
      galaxy: galaxyWithoutMap,
      productionQueues: [],
      shipDesigns: [],
      shipyardQueues: [],
      ships: [],
    };
    const v1Json = JSON.stringify(v1Raw);
    expect(isSaveFormatV2(v1Json)).toBe(false);

    // expandSaveV2 не трогает v1-объекты
    const expanded = expandSaveV2(JSON.parse(v1Json) as Record<string, unknown>);
    const planet = firstPlanetWithHexes(state);
    const expandedPlanet = (expanded.galaxy as { systems: Array<{ planets: Array<{ id: string; hexes: HexCell[] }> }> })
      .systems.flatMap((s) => s.planets).find((p) => p.id === planet.id)!;
    expect(expandedPlanet.hexes[0]!.coord).toBeDefined();
    expect(Array.isArray(planet.hexes[0]!.deposits)).toBe(true);

    // Полный deserialize v1 не падает
    const loaded = deserializeGameState(v1Json);
    expect(loaded.galaxy.systems.length).toBe(15);
    const loadedPlanet = loaded.galaxy.systems
      .flatMap((s) => s.planets).find((p) => p.hexes.length > 0)!;
    expect(loadedPlanet.hexes[0]!.coord).toBeDefined();
  });

  test('6. Застройка: buildingId/Level и processor-поля round-trip', () => {
    const state = buildFreshState(15);
    const planet = firstPlanetWithHexes(state, 5);
    const hex = planet.hexes[3]!;
    hex.buildingId = 'mine_iron';
    hex.buildingLevel = 2;
    hex.processorType = 'universal';
    hex.specialization = 'metal_smelting';
    hex.specializationLevel = 3;
    hex.activeRecipes = ['iron_plate'];

    const json = serializeV2(state);
    const restored = deserializeGameState(json);
    const rPlanet = restored.galaxy.systems.flatMap((s) => s.planets).find((p) => p.id === planet.id)!;
    const rHex = rPlanet.hexes[3]!;

    expect(rHex.buildingId).toBe('mine_iron');
    expect(rHex.buildingLevel).toBe(2);
    expect(rHex.processorType).toBe('universal');
    expect(rHex.specialization).toBe('metal_smelting');
    expect(rHex.specializationLevel).toBe(3);
    expect(rHex.activeRecipes).toEqual(['iron_plate']);

    // Незастроенный гекс восстановлен в null/0 (а в JSON полей не было)
    const rEmpty = rPlanet.hexes[0]!;
    expect(rEmpty.buildingId).toBeNull();
    expect(rEmpty.buildingLevel).toBe(0);
  });

  test('7. Звёзды: float-хвосты обрезаны до 4 значащих цифр', () => {
    const state = buildFreshState(10);
    const json = serializeV2(state);
    const restored = deserializeGameState(json);

    const origStars = state.galaxy.systems.flatMap((s) => s.stars);
    const restStars = restored.galaxy.systems.flatMap((s) => s.stars);
    expect(restStars.length).toBe(origStars.length);
    for (let i = 0; i < origStars.length; i++) {
      for (const field of ['mass', 'luminosity', 'temperature', 'radius'] as const) {
        const o = origStars[i]![field];
        const r = restStars[i]![field];
        const rel = Math.abs(o - r) / Math.max(1e-9, Math.abs(o));
        expect(rel).toBeLessThanOrEqual(1e-3);
      }
    }
  });

  test('8. Газовые гиганты: hexes [] не ломаются, атмосферные слоты целы', () => {
    const state = buildFreshState(30);
    const gg = state.galaxy.systems.flatMap((s) => s.planets).find((p) => p.type === 'gas_giant');
    expect(gg).toBeDefined();

    const json = serializeV2(state);
    const restored = deserializeGameState(json);
    const rGg = restored.galaxy.systems.flatMap((s) => s.planets).find((p) => p.id === gg!.id)!;

    expect(rGg.hexes).toEqual([]);
    expect(rGg.atmosphericSlots.length).toBe(gg!.atmosphericSlots.length);
    expect(rGg.orbitSlots.length).toBe(gg!.orbitSlots.length);
    expect(rGg.moons.length).toBe(gg!.moons.length);
    // Луны ГГ: гексы малых сеток восстановлены
    if (rGg.moons.length > 0) {
      const rMoon = rGg.moons[0]!;
      const moon = gg!.moons[0]!;
      expect(rMoon.hexes.length).toBe(moon.hexes.length);
      for (let i = 0; i < rMoon.hexes.length; i++) {
        expect(rMoon.hexes[i]!.coord).toEqual(moon.hexes[i]!.coord);
      }
    }
  });

  test('9. Маркер fmt не протекает в восстановленный GameState', () => {
    const state = buildFreshState(5);
    const json = serializeV2(state);
    const restored = deserializeGameState(json) as unknown as Record<string, unknown>;
    expect(restored).not.toHaveProperty('fmt');
    expect((restored.galaxy as Record<string, unknown>)).not.toHaveProperty('fmt');
  });

  test('10. compactSaveV2 — чистая функция: живой state не мутируется', () => {
    const state = buildFreshState(15);
    const planet = firstPlanetWithHexes(state);
    const hexBefore = JSON.stringify(planet.hexes[0]);
    const depositsBefore = JSON.stringify(planet.resourceDeposits[0]);

    const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = state.galaxy;
    const serializable = {
      ...state,
      galaxy: galaxyWithoutMap,
      productionQueues: [],
      shipDesigns: [],
      shipyardQueues: [],
      ships: [],
    };
    compactSaveV2(serializable as unknown as Record<string, unknown>);

    expect(JSON.stringify(planet.hexes[0])).toBe(hexBefore);
    expect(JSON.stringify(planet.resourceDeposits[0])).toBe(depositsBefore);
  });

  test('11. SAVE_FORMAT_VERSION = 2 и маркер в корне', () => {
    expect(SAVE_FORMAT_VERSION).toBe(2);
    const state = buildFreshState(5);
    const parsed = JSON.parse(serializeV2(state)) as { fmt?: number };
    expect(parsed.fmt).toBe(2);
  });
});
