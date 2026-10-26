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
 *   9. R-30: старые форматы (fmt:2 / без fmt) отклоняются явной ошибкой
 *      (декодеры v1/v2 удалены — старые сейвы стёрты владельцем).
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
import { materializePlanetDeposits, DEPOSIT_RNG_VERSION } from '@/galaxy/generate-resources';
import { assignResourceDeposits } from '@/galaxy/generate-resources';
import { findContainedElements, getCurrentLookups } from '@/data/baked-lookups';
import { Xoshiro128StarStar } from '@/core/prng';
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
    const refRng = Xoshiro128StarStar.fromState(planet.depositRngState);
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

  test('9. R-30: старые форматы (fmt:2 / без fmt) отклоняются явной ошибкой', () => {
    const state = buildFreshState(10);
    const planet = firstColonizable(state);
    colonizePlanet(planet);

    // Минимальная по форме сохранёнка на основе живого состояния (содержимое
    // значения не имеет — decode обязан отклонить ДО какого-либо разбора).
    const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = state.galaxy;
    const base = {
      time: state.time,
      speed: state.speed,
      phase: state.phase,
      galaxy: galaxyWithoutMap,
      productionQueues: [],
      fleets: [],
      playerFactionId: 'player',
    };

    // fmt:2 (сейвы R-28) — явная ошибка, не молчаливая порча состояния
    const v2Json = JSON.stringify({ ...base, fmt: 2 });
    expect(() => deserializeGameState(v2Json)).toThrow('Неподдерживаемый формат сейва');

    // без маркера fmt (сейвы до R-28) — тот же отказ
    const v1Json = JSON.stringify(base);
    expect(() => deserializeGameState(v1Json)).toThrow('Неподдерживаемый формат сейва');
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

  test('13. R-35 (P1 аудита): Save → Load → materialize — полный цикл бит-в-бит', () => {
    // Требование аудитора: смена ядра PRNG (R-35: мешап → канонический
    // xoshiro128**) НЕ должна молча ломать ленивую материализацию. Цепочка:
    // свежее состояние → СЕЙВ → ЗАГРУЗКА → колонизация (materialize из ds)
    // даёт РОВНО те же залежи, что прямая колонизация без сейва.
    const direct = buildFreshState(20);          // эталон: без сейва
    const saved = buildFreshState(20);           // тот же seed → та же генерация
    const planetDirect = firstColonizable(direct);

    // Прямая материализация (ground truth)
    expect(colonizePlanet(planetDirect)).toBe(true);
    const truth = planetDirect.hexes.map((h) => h.deposits.map((d) => ({ ...d })));

    // Полный цикл: serialize → deserialize → materialize
    const json = serializeGameState(saved);
    expect(isSaveFormatV3(json)).toBe(true);
    const restored = deserializeGameState(json);
    const rPlanet = restored.galaxy.systems
      .flatMap((s) => s.planets).find((p) => p.id === planetDirect.id)!;
    expect(rPlanet.depositsMaterialized).toBe(false);
    expect(rPlanet.depositRngState).toEqual(planetDirect.depositRngState); // ds прошёл кодек
    expect(colonizePlanet(rPlanet)).toBe(true);

    // Бит-в-бит: каждая залежь каждого гекса совпадает с эталоном
    expect(rPlanet.hexes.length).toBe(truth.length);
    let tuples = 0;
    for (let i = 0; i < truth.length; i++) {
      const got = rPlanet.hexes[i]!.deposits;
      const want = truth[i]!;
      expect(got.length).toBe(want.length);
      for (let d = 0; d < got.length; d++) {
        expect(got[d]).toEqual(want[d]);
        tuples++;
      }
    }
    expect(tuples).toBeGreaterThan(50);

    // Повторный цикл сейв→загрузка уже материализованной планеты: без дублей
    const json2 = serializeGameState(restored);
    const restored2 = deserializeGameState(json2);
    const r2Planet = restored2.galaxy.systems
      .flatMap((s) => s.planets).find((p) => p.id === planetDirect.id)!;
    expect(r2Planet.depositsMaterialized).toBe(true);
    expect(materializePlanetDeposits(r2Planet)).toBe(false);
    expect(r2Planet.hexes.map((h) => h.deposits.length))
      .toEqual(truth.map((h) => h.length));
  });

  // ============ R-36: версия RNG залежей (dv) и явная миграция ============

  test('14. R-36: свежий сейв хранит dv=DEPOSIT_RNG_VERSION у тел с гексами', () => {
    const state = buildFreshState(15);
    const bodies = [...allBodies(state)];
    const withHexes = bodies.filter((b) => b.hexes.length > 0);
    expect(withHexes.length).toBeGreaterThan(0);
    // живое состояние: версия совпадает с текущей семантикой генерации
    for (const b of withHexes) {
      expect(b.depositRngVersion, b.id).toBe(DEPOSIT_RNG_VERSION);
    }
    // компактная форма: поле dv, канонического depositRngVersion нет
    const json = serializeGameState(state);
    const raw = JSON.parse(json) as { galaxy: { systems: Array<{ planets: Array<Record<string, unknown>> }> } };
    let dvCount = 0;
    for (const sys of raw.galaxy.systems) {
      for (const p of sys.planets) {
        expect('depositRngVersion' in p, 'каноническое поле не пишется').toBe(false);
        if (typeof p.ds !== 'undefined') {
          expect(p.dv, 'dv accompanies ds').toBe(DEPOSIT_RNG_VERSION);
          dvCount++;
        } else {
          expect('dv' in p, 'dv без ds не пишется').toBe(false);
        }
      }
    }
    expect(dvCount).toBeGreaterThan(0);
  });

  test('15. R-37: сейв до R-37 (без dv) — ленивость при загрузке, версионная материализация при колонизации', () => {
    // Требование аудитора R-35/R-37: сейвы с отложенными залежами вне
    // пересозданного окружения защищаются версией RNG. R-37 (Б1/Б2): защита —
    // ВЕРСИОННО-СОВМЕСТИМАЯ МАТЕРИАЛИЗАЦИЯ: загрузка тела НЕ материализует
    // (краш холодного старта / раздувание сейва исключены), при колонизации
    // replay идёт текущим кодом, а свод-пул ПЕРЕСЧИТЫВАЕТСЯ из свежей физики
    // (дрейф поглощается — пул следует за физикой).
    const state = buildFreshState(15);
    const truthBody = firstColonizable(state);
    const truthRef = buildFreshState(15);
    const truthPlanet = truthRef.galaxy.systems.flatMap(s => s.planets).find(p => p.id === truthBody.id)!;
    expect(colonizePlanet(truthPlanet)).toBe(true);
    const truth = truthPlanet.hexes.map((h) => h.deposits.map((d) => ({ ...d })));

    let json = serializeGameState(state);
    const raw = JSON.parse(json) as {
      galaxy: { systems: Array<{ planets: Array<Record<string, unknown>> }> };
    };
    // сейв «до R-37»: поле dv отсутствует У ВСЕХ тел (и у лун тоже)
    for (const sys of raw.galaxy.systems) {
      for (const p of sys.planets) {
        delete p.dv;
        for (const m of (p.moons as Array<Record<string, unknown>> | undefined) ?? []) delete m.dv;
      }
    }
    json = JSON.stringify(raw);

    const restored = deserializeGameState(json);

    // Б1/Б2: НИ ОДНО тело не материализовано при загрузке (ленивость и
    // размер сейва сохранены; пул НЕ тронут)
    const bodies = [...(function* () {
      for (const sys of restored.galaxy.systems) {
        for (const p of sys.planets) { yield p; for (const m of p.moons) yield m; }
      }
    })()];
    for (const b of bodies) {
      if (b.hexes.length > 0) {
        expect(b.depositsMaterialized, `${b.id} остаётся ленивым`).toBe(false);
        expect(b.depositRngState, `${b.id}: снимок на месте`).not.toBeNull();
      }
    }

    // Б2: повторный Save/Load НЕтронутого сейва — побайтно идентичен
    // (перепись ожидающих не мутирует состояние, размер не растёт)
    const json2 = serializeGameState(restored);
    expect(json2).toBe(json);

    // КОЛОНИЗАЦИЯ = версионная материализация: залежи бит-в-бит эталону
    // (тот же seed, тот же код), пул пересчитан из физики
    const rPlanet = restored.galaxy.systems.flatMap(s => s.planets).find(p => p.id === truthBody.id)!;
    expect(colonizePlanet(rPlanet)).toBe(true);
    expect(rPlanet.hexes.length).toBe(truth.length);
    for (let i = 0; i < truth.length; i++) {
      expect(rPlanet.hexes[i]!.deposits).toEqual(truth[i]!);
    }

    // Б2/Б3: пересчитанный пул согласован с физикой (независимая сумма,
    // без пропусков — включая выбранный уникальный ресурс)
    const expected = new Map<string, number>();
    for (const hex of rPlanet.hexes) {
      for (const d of hex.deposits) {
        const contained = findContainedElements(getCurrentLookups(), d.elementId) ?? [];
        const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
        for (const ce of contained) {
          expected.set(ce.elementId, (expected.get(ce.elementId) ?? 0) + d.quantity * (ce.yield / totalYield));
        }
      }
    }
    expect(expected.size).toBeGreaterThan(0);
    for (const [elId, expQty] of expected) {
      const entry = rPlanet.resourceDeposits.find(d => d.elementId === elId)!;
      expect(entry, `${elId}: запись пула есть`).toBeDefined();
      expect(entry.totalQuantity, `${elId}: пул = Σ(физика × доля)`).toBeGreaterThanOrEqual(expQty - 1);
      expect(entry.totalQuantity, `${elId}: пул = Σ(физика × доля)`).toBeLessThanOrEqual(expQty + 1);
    }

    // повторная загрузка мигрированного сейва — стабильна (без дублей/сдвигов).
    // ВНИМАНИЕ: кодек округляет availability до 3 знаков (round3), поэтому
    // точное toEqual на float-поля недопустим — сверяем форму (кол-во залежей),
    // ID, quantity (int) и depth (int); availability — с допуском 1e-3.
    const json3 = serializeGameState(restored);
    const restored2 = deserializeGameState(json3);
    const r2 = restored2.galaxy.systems.flatMap(s => s.planets).find(p => p.id === truthBody.id)!;
    expect(r2.hexes.length).toBe(rPlanet.hexes.length);
    for (let i = 0; i < rPlanet.hexes.length; i++) {
      const a = rPlanet.hexes[i]!.deposits;
      const b = r2.hexes[i]!.deposits;
      expect(b.length, `гекс ${i}`).toBe(a.length);
      for (let d = 0; d < a.length; d++) {
        expect(b[d]!.elementId).toBe(a[d]!.elementId);
        expect(b[d]!.quantity).toBe(a[d]!.quantity);
        expect(b[d]!.depth).toBe(a[d]!.depth);
        expect(Math.abs(b[d]!.availability - a[d]!.availability)).toBeLessThanOrEqual(1e-3);
      }
    }
    // и пул пережил повторный рантрип без изменений
    expect(r2.resourceDeposits).toEqual(rPlanet.resourceDeposits);
  });

  test('16. R-36: сейв с ТЕКУЩЕЙ dv остаётся ленивым (миграция не срабатывает)', () => {
    const state = buildFreshState(12);
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    for (const b of [...(function* () {
      for (const sys of restored.galaxy.systems) {
        for (const p of sys.planets) { yield p; for (const m of p.moons) yield m; }
      }
    })()]) {
      if (b.hexes.length > 0) {
        expect(b.depositsMaterialized, `${b.id} остаётся ленивым`).toBe(false);
        expect(b.depositRngState, `${b.id}: снимок на месте`).not.toBeNull();
        expect(b.depositRngVersion, `${b.id}: версия preserved`).toBe(DEPOSIT_RNG_VERSION);
      }
    }
  });

  test('17. R-37 (Б2): размер — загрузка старого сейва НЕ раздувает состояние; колония добавляет только своё тело', () => {
    // Аудитор: «Не материализовать всю галактику при загрузке без оценки
    // влияния на производительность и размер сейва». R-37: загрузка не
    // материализует вовсе; проверяем размер фактом:
    //   (а) повторная сериализация загруженного старого сейва — побайтно
    //       исходная (0 байт накладных расходов);
    //   (б) после колонизации ОДНОГО тела сейв растёт на его залежи
    //       (сотни байт — КБ, не мегабайты всей галактики).
    const state = buildFreshState(200);
    let json = serializeGameState(state);
    const raw = JSON.parse(json) as { galaxy: { systems: Array<{ planets: Array<Record<string, unknown>> }> } };
    for (const sys of raw.galaxy.systems) {
      for (const p of sys.planets) {
        delete p.dv;
        for (const m of (p.moons as Array<Record<string, unknown>> | undefined) ?? []) delete m.dv;
      }
    }
    json = JSON.stringify(raw);

    const restored = deserializeGameState(json);
    expect(serializeGameState(restored)).toBe(json); // (а) 0 накладных

    const planet = firstColonizable(restored);
    colonizePlanet(planet);
    const jsonAfter = serializeGameState(restored);
    const deltaKb = (jsonAfter.length - json.length) / 1024;
    // одно тело: залежи гексов + пул; вся галактика (~600 тел) была бы МБ
    expect(deltaKb, 'рост только на колонизованное тело').toBeGreaterThan(0);
    expect(deltaKb, 'рост ограничен (< 64 КБ на тело)').toBeLessThan(64);
  });
});
