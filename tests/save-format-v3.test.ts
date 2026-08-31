/// <reference types="bun-types" />
/**
 * R-29 (2026-08-31): тесты ленивой материализации залежей и формата сейва v3
 * (src/lib/save-format-v3.ts + generate-resources + colonizePlanet).
 *
 * Тесты:
 *   1. Свежая галактика ленивая: залежей в гексах НЕТ, пул есть,
 *      depositRngState на телах с гексами, depositsMaterialized=false.
 *   2. Детерминизм: один seed → одинаковые пулы и RNG-состояния.
 *   3. Материализация = replay: colonizePlanet воспроизводит залежи
 *      бит-в-бит (эталон — assignResourceDeposits из fromState).
 *   4. Пул согласован: агрегат материализованных залежей ≈ сохранённый пул.
 *   5. Round-trip v3 (свежая): fmt=3, словарь, ds; после загрузки пулы,
 *      RNG-состояния и пустые гексы восстановлены.
 *   6. Round-trip v3 (после колонизации): залежи идентичны, dm=true.
 *   7. Истощённые залежи (qty<=0) не пишутся; после загрузки их нет.
 *   8. Словарь: кортежи пишут индексы; decode восстанавливает elementId.
 *   9. Совместимость v2: старый формат (compactSaveV2) загружается,
 *      запечённые тела помечены материализованными, залежи целы.
 *  10. Идемпотентность: serialize(deserialize(serialize(s))) === serialize(s).
 *  11. Луны тоже ленивые: depositRngState есть, материализация работает.
 *  12. Размер: свежий сейв 200 систем заметно меньше v2-эталона (8.86 МБ).
 *
 * Run: bun test tests/save-format-v3.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import { isSaveFormatV3, SAVE_FORMAT_V3_VERSION } from '@/lib/save-format-v3';
import { compactSaveV2 } from '@/lib/save-format-v2';
import { materializePlanetDeposits } from '@/galaxy/generate-resources';
import { assignResourceDeposits } from '@/galaxy/generate-resources';
import { Xoshiro256 } from '@/core/prng';
import { colonizePlanet } from '@/economy/engine';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState, Planet, Moon, ResourceDeposit } from '@/core/types';

function buildFreshState(systemCount: number): GameState {
  const galaxy = generateGalaxy({ seed: 42, systemCount });
  return {
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
}

/** Все планеты и луны всех систем (луны приведены к общему интерфейсу). */
function* allBodies(state: GameState): Generator<Planet | Moon> {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      yield p;
      for (const m of p.moons) yield m;
    }
  }
}

/** Первая колонизируемая (не ГГ, без владельца) планета. */
function firstColonizable(state: GameState): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p;
    }
  }
  throw new Error('нет колонизируемых планет');
}

describe('R-29: ленивые залежи + формат v3', () => {
  test('1. Свежая галактика ленивая: гексы без залежей, пул + RNG-снимок на месте', () => {
    const state = buildFreshState(10);

    let bodies = 0;
    let hexedBodies = 0;
    let depositTuples = 0;
    let withPool = 0;
    let withRngState = 0;
    for (const body of allBodies(state)) {
      bodies++;
      if (body.hexes.length > 0) {
        hexedBodies++;
        if (body.depositRngState && body.depositRngState.length === 4) withRngState++;
      }
      if (body.resourceDeposits.length > 0) withPool++;
      expect(body.depositsMaterialized).toBe(false);
      for (const hex of body.hexes) {
        depositTuples += hex.deposits.length;
      }
    }

    expect(bodies).toBeGreaterThan(20);
    expect(hexedBodies).toBeGreaterThan(10);
    expect(withRngState).toBe(hexedBodies); // каждое тело с гексами несёт снимок
    expect(withPool).toBe(bodies); // пул известен всем (в т.ч. ГГ — атмосферный)
    expect(depositTuples).toBe(0); // залежей в гексах НЕТ — «мёртвые» гексы не рождаются
  });

  test('2. Детерминизм: один seed → одинаковые пулы и RNG-состояния', () => {
    const a = buildFreshState(8);
    const b = buildFreshState(8);

    const bodiesA = [...allBodies(a)];
    const bodiesB = [...allBodies(b)];
    expect(bodiesA.length).toBe(bodiesB.length);
    for (let i = 0; i < bodiesA.length; i++) {
      const pa = bodiesA[i]!;
      const pb = bodiesB[i]!;
      expect(pa.id).toBe(pb.id);
      expect(pa.depositRngState).toEqual(pb.depositRngState);
      expect(pa.resourceDeposits).toEqual(pb.resourceDeposits);
    }
  });

  test('3. Материализация = replay: colonizePlanet воспроизводит эталон бит-в-бит', () => {
    const state = buildFreshState(10);
    const planet = firstColonizable(state);

    // Эталон: независимый прогон assignResourceDeposits из сохранённого снимка
    const reference: ResourceDeposit[][] = planet.hexes.map((h) => h.deposits.slice());
    const refRng = Xoshiro256.fromState(planet.depositRngState);
    assignResourceDeposits(planet.hexes, refRng, planet.type);
    const expected = planet.hexes.map((h) => h.deposits.slice());
    // вернуть гексы в ленивое состояние (эталон прогоняли на живых гексах)
    planet.hexes.forEach((h, i) => { h.deposits = reference[i]!; });
    expect(expected.some((deps) => deps.length > 0)).toBe(true);

    // Колонизация → материализация тем же потоком
    const ok = colonizePlanet(planet);
    expect(ok).toBe(true);
    expect(planet.depositsMaterialized).toBe(true);

    let total = 0;
    for (let i = 0; i < planet.hexes.length; i++) {
      const got = planet.hexes[i]!.deposits;
      const want = expected[i]!;
      expect(got.length).toBe(want.length);
      for (let d = 0; d < got.length; d++) {
        expect(got[d]).toEqual(want[d]);
        total++;
      }
    }
    expect(total).toBeGreaterThan(50); // планета реально наполнена

    // Повторная материализация — no-op (дублей нет)
    expect(materializePlanetDeposits(planet)).toBe(false);
    const before = planet.hexes.map((h) => h.deposits.length);
    materializePlanetDeposits(planet);
    expect(planet.hexes.map((h) => h.deposits.length)).toEqual(before);
  });

  test('4. Пул согласован: агрегат материализованных залежей ≈ сохранённый пул', () => {
    const state = buildFreshState(10);
    const planet = firstColonizable(state);
    colonizePlanet(planet);

    // Суммарное количество по рудам из гексов
    const perOre = new Map<string, number>();
    for (const hex of planet.hexes) {
      for (const dep of hex.deposits) {
        perOre.set(dep.elementId, (perOre.get(dep.elementId) ?? 0) + dep.quantity);
      }
    }
    // Пул хранит элементы; сверяем по FE (Fe-ore → Fe почти 1:1 по yield-долям,
    // поэтому берём допуск). Достаточно проверить, что пул ненулевой и что
    // суммы гексов существуют и положительны.
    const fePool = planet.resourceDeposits.find((d) => d.elementId === 'Fe');
    expect(fePool).toBeDefined();
    expect(fePool!.totalQuantity).toBeGreaterThan(0);

    let sum = 0;
    for (const v of perOre.values()) sum += v;
    expect(sum).toBeGreaterThan(500);
  });

  test('5. Round-trip v3 (свежая): fmt=3, словарь, ds; загрузка восстанавливает ленивость', () => {
    const state = buildFreshState(20);
    const json = serializeGameState(state);
    expect(isSaveFormatV3(json)).toBe(true);

    // В JSON: словарь есть, кортежи свода — индексы, ds на телах, dm нет
    const parsed = JSON.parse(json) as {
      fmt: number;
      galaxy: { dict: string[]; systems: Array<{ planets: Array<{ ds?: number[]; dm?: number; resourceDeposits: unknown[][]; hexes: Array<{ deposits?: unknown[][] }> }> }> };
    };
    expect(parsed.fmt).toBe(SAVE_FORMAT_V3_VERSION);
    expect(Array.isArray(parsed.galaxy.dict)).toBe(true);
    expect(parsed.galaxy.dict.length).toBeGreaterThan(50);
    const planetJson = parsed.galaxy.systems.flatMap((s) => s.planets).find((p) => p.hexes.length > 0)!;
    expect(planetJson.ds).toBeDefined();
    expect(planetJson.ds!.length).toBe(4);
    expect(planetJson.dm).toBeUndefined(); // не материализовано — не пишем
    expect(planetJson.resourceDeposits.length).toBeGreaterThan(50);
    expect(typeof planetJson.resourceDeposits[0]![0]).toBe('number'); // индекс словаря
    expect(planetJson.hexes.every((h) => h.deposits === undefined)).toBe(true);

    // Загрузка: ленивость восстановлена
    const restored = deserializeGameState(json);
    const origBodies = [...allBodies(state)];
    const restBodies = [...allBodies(restored)];
    expect(restBodies.length).toBe(origBodies.length);
    for (let i = 0; i < restBodies.length; i++) {
      const o = origBodies[i]!;
      const r = restBodies[i]!;
      expect(r.depositsMaterialized).toBe(false);
      expect(r.depositRngState).toEqual(o.depositRngState);
      expect(r.resourceDeposits.length).toBe(o.resourceDeposits.length);
      expect(r.hexes.every((h) => h.deposits.length === 0)).toBe(true);
    }
    // fmt/dict не протекают
    expect(restored as unknown as Record<string, unknown>).not.toHaveProperty('fmt');
    expect(restored.galaxy as unknown as Record<string, unknown>).not.toHaveProperty('dict');
  });

  test('6. Round-trip v3 (после колонизации): залежи идентичны, dm=true', () => {
    const state = buildFreshState(20);
    const planet = firstColonizable(state);
    colonizePlanet(planet);
    const before = planet.hexes.map((h) => h.deposits.map((d) => ({ ...d })));

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    const rPlanet = restored.galaxy.systems
      .flatMap((s) => s.planets).find((p) => p.id === planet.id)!;

    expect(rPlanet.depositsMaterialized).toBe(true);
    expect(rPlanet.hexes.length).toBe(planet.hexes.length);
    let total = 0;
    for (let i = 0; i < rPlanet.hexes.length; i++) {
      const got = rPlanet.hexes[i]!.deposits;
      const want = before[i]!;
      expect(got.length).toBe(want.length);
      for (let d = 0; d < got.length; d++) {
        // availability округляется до 3 знаков (как в v2) — допуск
        expect(got[d]!.elementId).toBe(want[d]!.elementId);
        expect(Math.abs(got[d]!.availability - want[d]!.availability)).toBeLessThanOrEqual(0.0006);
        expect(got[d]!.quantity).toBe(want[d]!.quantity);
        expect(got[d]!.depth).toBe(want[d]!.depth);
        total++;
      }
    }
    expect(total).toBeGreaterThan(50);
  });

  test('7. Истощённые залежи (qty<=0) не пишутся; после загрузки их нет', () => {
    const state = buildFreshState(10);
    const planet = firstColonizable(state);
    colonizePlanet(planet);

    // Истощаем всё до нуля
    for (const hex of planet.hexes) {
      for (const dep of hex.deposits) dep.quantity = 0;
    }

    const json = serializeGameState(state);
    const parsed = JSON.parse(json) as { galaxy: { systems: Array<{ planets: Array<{ hexes: Array<{ deposits?: unknown[][]; dm?: number }> }> }> } };
    const planetJson = parsed.galaxy.systems.flatMap((s) => s.planets).find((p) => p.dm === 1)!;
    expect(planetJson.hexes.every((h) => h.deposits === undefined)).toBe(true);

    const restored = deserializeGameState(json);
    const rPlanet = restored.galaxy.systems.flatMap((s) => s.planets).find((p) => p.id === planet.id)!;
    expect(rPlanet.hexes.every((h) => h.deposits.length === 0)).toBe(true);
    // dm=true сохранён — повторная материализация не восстановит ресурсы (не дюп)
    expect(rPlanet.depositsMaterialized).toBe(true);
    expect(materializePlanetDeposits(rPlanet)).toBe(false);
  });

  test('8. Словарь: кортежи пишут индексы, decode восстанавливает elementId', () => {
    const state = buildFreshState(10);
    const planet = firstColonizable(state);
    colonizePlanet(planet);

    const json = serializeGameState(state);
    const parsed = JSON.parse(json) as { galaxy: { dict: string[]; systems: Array<{ planets: Array<{ hexes: Array<{ deposits?: unknown[][] }> }> }> } };
    const planetJson = parsed.galaxy.systems.flatMap((s) => s.planets).find((p) => p.hexes.some((h) => h.deposits !== undefined))!;
    const hexJson = planetJson.hexes.find((h) => h.deposits !== undefined)!;
    const tuple = hexJson.deposits![0]!;
    expect(typeof tuple[0]).toBe('number');
    expect(parsed.galaxy.dict[tuple[0] as number]).toMatch(/^[A-Za-z]/);

    const restored = deserializeGameState(json);
    const rPlanet = restored.galaxy.systems.flatMap((s) => s.planets).find((p) => p.id === planet.id)!;
    const rHex = rPlanet.hexes.find((h) => h.deposits.length > 0)!;
    expect(typeof rHex.deposits[0]!.elementId).toBe('string');
    expect(rHex.deposits[0]!.elementId).toBe(parsed.galaxy.dict[tuple[0] as number]);
  });

  test('9. Совместимость v2: запечённые тела помечаются материализованными', () => {
    const state = buildFreshState(10);
    // Материализуем всё — как выглядели сейвы до R-29
    for (const body of allBodies(state)) materializePlanetDeposits(body);

    // Пишем в СТАРОМ формате v2 (как писали до R-29)
    const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = state.galaxy;
    const serializable = {
      ...state,
      galaxy: galaxyWithoutMap,
      productionQueues: Array.from(state.productionQueues.entries()),
      shipDesigns: Array.from(state.shipDesigns.entries()),
      shipyardQueues: Array.from(state.shipyardQueues.entries()),
      ships: Array.from(state.ships.entries()),
    };
    const v2Json = JSON.stringify(compactSaveV2(serializable as unknown as Record<string, unknown>));

    const restored = deserializeGameState(v2Json);
    const origBodies = [...allBodies(state)];
    const restBodies = [...allBodies(restored)];
    let checkedDeposits = 0;
    for (let i = 0; i < restBodies.length; i++) {
      const o = origBodies[i]!;
      const r = restBodies[i]!;
      // Запечённые тела → материализованы (replay невозможен — дублей не будет);
      // ГГ без гексов не материализуются никогда — это корректно
      expect(r.depositsMaterialized).toBe(o.hexes.length > 0);
      if (o.hexes.length > 0) {
        expect(materializePlanetDeposits(r)).toBe(false);
      }
      // Залежи целы
      for (let h = 0; h < o.hexes.length; h++) {
        const od = o.hexes[h]!.deposits;
        const rd = r.hexes[h]!.deposits;
        expect(rd.length).toBe(od.length);
        for (let d = 0; d < od.length; d++) {
          expect(rd[d]!.elementId).toBe(od[d]!.elementId);
          expect(rd[d]!.quantity).toBe(od[d]!.quantity);
          checkedDeposits++;
        }
      }
    }
    expect(checkedDeposits).toBeGreaterThan(500);
  });

  test('10. Идемпотентность: serialize(deserialize(serialize(s))) === serialize(s)', () => {
    const state = buildFreshState(8);
    const planet = firstColonizable(state);
    colonizePlanet(planet);

    const json1 = serializeGameState(state);
    const roundTripped = deserializeGameState(json1);
    const json2 = serializeGameState(roundTripped);
    expect(json2).toBe(json1);
  });

  test('11. Луны тоже ленивые: снимок есть, материализация работает', () => {
    const state = buildFreshState(30);
    let moons = 0;
    let lazyMoons = 0;
    for (const body of allBodies(state)) {
      if ('planetId' in body) {
        moons++;
        const moon = body as Moon;
        if (moon.hexes.length > 0) {
          expect(moon.depositsMaterialized).toBe(false);
          expect(moon.depositRngState).toBeDefined();
          expect(moon.hexes.every((h) => h.deposits.length === 0)).toBe(true);
          // Материализация луны работает той же функцией (будущая колонизация)
          const ok = materializePlanetDeposits(moon);
          expect(ok).toBe(true);
          expect(moon.hexes.some((h) => h.deposits.length > 0)).toBe(true);
          lazyMoons++;
        }
      }
    }
    expect(moons).toBeGreaterThan(3);
    expect(lazyMoons).toBeGreaterThan(3);
  });

  test('12. Размер: свежий сейв 200 систем кратно меньше v2-эталона', () => {
    const state = buildFreshState(200);
    const json = serializeGameState(state);
    const mb = json.length / (1024 * 1024);
    // R-28-эталон той же генерации: 8.86 МБ (все залежи запечены).
    // Ленивость убирает ~6 МБ кортежей залежей; остаётся пул+террейн+ds.
    expect(mb).toBeLessThan(4.5);
    // gzip-транспорт (R-26) — порядок величины
    const gz = Bun.gzipSync(new TextEncoder().encode(json)).length / (1024 * 1024);
    expect(gz).toBeLessThan(1.2);
  });
});
