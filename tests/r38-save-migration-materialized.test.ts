/// <reference types="bun-types" />
/**
 * R-38 (2026-10-27): миграция сейвов с уже МАТЕРИАЛИЗОВАННЫМИ залежами
 * + регрессионное покрытие (задание аудитора R-38 §3).
 *
 * Непокрытый R-37 сценарий: тело колонизировано в старом сейве (dm=1,
 * dv старая/отсутствует, свод старой семантики). Версионная материализация
 * R-37 тут не работает (replay невозможен — залежи уже физические), поэтому
 * устаревший свод оставался навсегда. R-38: при загрузке ФИЗИКА СОХРАНЯЕТСЯ
 * КАК ЕСТЬ (прогресс добычи, истощение, здания, склад, колонизация —
 * неприкосновенны), а свод пересчитывается из фактических залежей
 * контрактом «свод = физика» (migrateMaterializedBodySummary); dv НЕ
 * поднимается (честная версия физики), идемпотентность — поле sv.
 *
 * Разделы (нумерация задания R-38 §3):
 *   A1–A10 — миграция и загрузка;
 *   B1–B10 — согласованность сводки и физической добычи;
 *   C1–C5  — детерминизм и PRNG.
 *
 * Все исходные данные детерминированы (фиксированные seed); «старый сейв»
 * строится воспроизводимо: живое состояние → колонизация → детерминированный
 * геймплей → сериализация → состаривание (снос dv/sv + порча свода
 * материализованных тел под семантику R-36).
 *
 * Run: bun test tests/r38-save-migration-materialized.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import { colonizePlanet, processEconomyTick } from '@/economy/engine';
import { createDefaultResearchState } from '@/research/engine';
import { DEPOSIT_RNG_VERSION, DEPOSIT_SUMMARY_VERSION, materializePlanetDeposits } from '@/galaxy/generate-resources';
import { ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { ELEMENT_MAP } from '@/data/elements';
import {
  findContainedElements,
  getCurrentLookups,
  resetCurrentLookups,
  hasCurrentLookups,
  buildLookups,
} from '@/data/baked-lookups';
import type { GameState, Planet, Moon, HexCell, EntityId, ProductionQueue } from '@/core/types';

// ============ Хелперы (детерминированные) ============

function buildFreshState(seed: number, systemCount: number): GameState {
  const galaxy = generateGalaxy({ seed, systemCount });
  return {
    time: { tick: 66338, dayInYear: 100, year: 2 },
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

function firstColonizable(state: GameState): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p;
    }
  }
  throw new Error('нет колонизируемых планет');
}

function* allBodies(state: GameState): Generator<Planet | Moon> {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      yield p;
      for (const m of p.moons) yield m;
    }
  }
}

/**
 * Независимая агрегация физики тела (зеркало контракта «свод = физика»,
 * как tests/galaxy/unique-resource-contract.test.ts №2): руды → элементы
 * по долям выхода; fallback «<элемент>-ore» (трансурановые) → ID как есть.
 */
function independentAggregation(body: { hexes: HexCell[] }): Map<string, number> {
  const lookups = getCurrentLookups();
  const expected = new Map<string, number>();
  for (const hex of body.hexes) {
    for (const d of hex.deposits) {
      const contained = findContainedElements(lookups, d.elementId) ?? [];
      if (contained.length > 0) {
        const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
        for (const ce of contained) {
          expected.set(ce.elementId, (expected.get(ce.elementId) ?? 0) + d.quantity * (ce.yield / totalYield));
        }
      } else {
        const pureId = d.elementId.replace(/-ore$/, '');
        const id = ELEMENT_MAP.has(pureId) ? pureId : d.elementId;
        expected.set(id, (expected.get(id) ?? 0) + d.quantity);
      }
    }
  }
  return expected;
}

/** Проверка «свод = физика»: каждая физическая запись пула = независимой сумме (±1). */
function expectPoolMatchesPhysics(body: Planet | Moon, label: string): void {
  const expected = independentAggregation(body);
  expect(expected.size, `${label}: физика непуста`).toBeGreaterThan(0);
  for (const [elId, expQty] of expected) {
    const entry = body.resourceDeposits.find(d => d.elementId === elId);
    expect(entry, `${label} ${elId}: запись пула есть (без пропусков)`).toBeDefined();
    if (entry) {
      expect(entry.totalQuantity, `${label} ${elId}: пул = Σ(физика × доля)`).toBeGreaterThanOrEqual(expQty - 1);
      expect(entry.totalQuantity, `${label} ${elId}: пул = Σ(физика × доля)`).toBeLessThanOrEqual(expQty + 1);
    }
  }
  // и обратно: hexCount>0 ⇒ физика существует
  for (const entry of body.resourceDeposits) {
    if (entry.hexCount === 0) continue;
    expect(expected.has(entry.elementId), `${label} ${entry.elementId}: hexCount>0 ⇒ физика есть`).toBe(true);
  }
}

/** Форма сейва для точечной хирургии (кортежи/словарь — как в JSON). */
interface SaveJson {
  galaxy: {
    seed: number;
    dict: string[];
    systems: Array<{ planets: Array<Record<string, unknown>> }>;
  };
}

/** Все тела сейва (планеты + луны) — для обхода при состаривании. */
function* jsonBodies(raw: SaveJson): Generator<Record<string, unknown>> {
  for (const sys of raw.galaxy.systems) {
    for (const p of sys.planets) {
      yield p;
      for (const m of (p.moons as Array<Record<string, unknown>> | undefined) ?? []) yield m;
    }
  }
}

/**
 * Состарить сейв до «до R-36/R-37»: снести dv/sv у всех тел (версии не
 * существовали), а свод МАТЕРИАЛИЗОВАННЫХ тел (dm=1) испортить под старую
 * семантику R-36: первая ultra-запись — константное обещание 5/hexCount=1
 * (старый aggregate перезаписывал выбранный элемент константами 4–6 без
 * согласования с физикой), остальные записи — totalQuantity ×3.
 */
function ageSave(json: string, opts: { stalePool?: boolean } = {}): string {
  const stalePool = opts.stalePool ?? true;
  const raw = JSON.parse(json) as SaveJson;
  for (const body of jsonBodies(raw)) {
    delete body.dv;
    delete body.sv;
    if (stalePool && body.dm === 1 && Array.isArray(body.resourceDeposits)) {
      const dict = raw.galaxy.dict;
      const tuples = body.resourceDeposits as unknown[][];
      let ultraPatched = false;
      for (const t of tuples) {
        const elId = dict[t[0] as number];
        if (!ultraPatched && typeof elId === 'string' && ULTRA_RARE_ELEMENTS.includes(elId)) {
          // R-36-стиль: константа 4–6 + обещанный hexCount=1 (физике противоречит)
          t[1] = 5;
          t[4] = 1;
          ultraPatched = true;
        } else {
          t[1] = (t[1] as number) * 3; // «до R-36»: чужие тоталы
        }
      }
    }
  }
  return JSON.stringify(raw);
}

/**
 * Полный воспроизводимый сценарий «старого сейва с материализованным телом»:
 * колонизация → детерминированный геймплей (частичное истощение + полностью
 * истощённая залежь + склад + постройки) → сериализация → состаривание.
 */
interface OldSaveScenario {
  /** Состаренный JSON (публичный вход deserializeGameState). */
  json: string;
  /** Живой эталон ДО состаривания (физика/склад/постройки — что обязано уцелеть). */
  reference: GameState;
  /** Колонизированная планета эталона. */
  planet: Planet;
  /** Частично истощённая залежь: hexIndex/depIndex ДО, исходное и оставшееся количество. */
  partial: { hexIndex: number; depIndex: number; oreId: string; original: number; remaining: number };
  /** Полностью истощённая (quantity=0) залежь — в сейв НЕ пишется. */
  depleted: { hexIndex: number; depIndex: number; oreId: string };
}

function buildOldMaterializedSave(seed: number, systemCount = 10): OldSaveScenario {
  const state = buildFreshState(seed, systemCount);
  const planet = firstColonizable(state);
  expect(colonizePlanet(planet)).toBe(true);

  // Геймплей (детерминированный выбор — без RNG):
  // 1) частично истощаем самую большую залежь на треть;
  const flat: Array<{ hexIndex: number; depIndex: number; qty: number; oreId: string }> = [];
  planet.hexes.forEach((h, hexIndex) => h.deposits.forEach((d, depIndex) => {
    flat.push({ hexIndex, depIndex, qty: d.quantity, oreId: d.elementId });
  }));
  flat.sort((a, b) => b.qty - a.qty || a.hexIndex - b.hexIndex || a.depIndex - b.depIndex);
  const partialRef = flat[0]!;
  const partialDep = planet.hexes[partialRef.hexIndex]!.deposits[partialRef.depIndex]!;
  const partialOriginal = partialDep.quantity;
  partialDep.quantity -= Math.ceil(partialDep.quantity / 3);

  // 2) полностью истощаем другую (первую с qty < половины максимума);
  const depletedRef = flat.find(f => f.oreId !== partialRef.oreId && f.qty < flat[0]!.qty / 2)!;
  planet.hexes[depletedRef.hexIndex]!.deposits[depletedRef.depIndex]!.quantity = 0;

  // 3) склад с добытым + вторая постройка (шахта) — реальные игровые данные
  // (ключи не пересекаются: partial.oreId — крупнейшая руда, пишем её прогресс)
  planet.resources['Ti-ore'] = 500.5;
  planet.resources[partialDep.elementId] = 77.25;
  const mineHex = planet.hexes.findIndex(h =>
    h.buildingId === null && h.terrain !== 'ocean' && h.deposits.some(d => d.quantity > 0));
  if (mineHex >= 0) {
    planet.hexes[mineHex]!.buildingId = 'mine';
    planet.hexes[mineHex]!.buildingLevel = 2;
  }

  const json = ageSave(serializeGameState(state));
  return {
    json,
    reference: state,
    planet,
    partial: {
      hexIndex: partialRef.hexIndex,
      depIndex: partialRef.depIndex,
      oreId: partialDep.elementId,
      original: partialOriginal,
      remaining: partialDep.quantity,
    },
    depleted: { hexIndex: depletedRef.hexIndex, depIndex: depletedRef.depIndex, oreId: depletedRef.oreId },
  };
}

/** Найти тело в загруженном состоянии по id эталона. */
function findBody<T extends Planet | Moon>(state: GameState, id: string): T | undefined {
  for (const b of allBodies(state)) {
    if (b.id === id) return b as T;
  }
  return undefined;
}

// ============ A. Миграция и загрузка (задание R-38 §3A) ============

describe('R-38 A: миграция и загрузка старых сейвов с материализованными залежами', () => {
  test('A1. Холодный старт: загрузка старого сейва с dm=1 без активной игры — без краша, lookups загруженной галактики, свод мигрирован', () => {
    const sc = buildOldMaterializedSave(42);
    // ХОЛОДНЫЙ процесс: ни новой игры, ни загрузки до этого (lookups = null).
    resetCurrentLookups();
    expect(hasCurrentLookups()).toBe(false);

    let restored: GameState;
    expect(() => { restored = deserializeGameState(sc.json); }).not.toThrow();
    restored = deserializeGameState(sc.json);

    // lookups — модель ИМЕННО загруженной галактики (порядок Б1 R-37 сохранён:
    // setCurrentLookups ДО миграции свода)
    expect(hasCurrentLookups()).toBe(true);
    expect(getCurrentLookups().elementToOre)
      .toBe(buildLookups(restored.galaxy.bakedModel).elementToOre);

    // свод мигрирован контрактом «свод = физика» (не устаревшие значения)
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;
    expect(rPlanet.depositsMaterialized).toBe(true);
    expect(rPlanet.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
    expectPoolMatchesPhysics(rPlanet, 'A1');
  });

  test('A2. Кросс-галактика: загрузка старого сейва B после активной игры A — миграция идёт с моделью B, а не A', () => {
    // Активная игра A (seed 100): lookups = модель A.
    deserializeGameState(serializeGameState(buildFreshState(100, 8)));
    const lookupsA = getCurrentLookups().elementToOre;

    // Старый сейв галактики B (seed 200, материализованное тело, без dv/sv).
    const sc = buildOldMaterializedSave(200);
    const restoredB = deserializeGameState(sc.json);

    // lookups переключились на модель B (ссылка на record модели B из сейва)
    expect(getCurrentLookups().elementToOre)
      .toBe(buildLookups(restoredB.galaxy.bakedModel).elementToOre);
    expect(getCurrentLookups().elementToOre).not.toBe(lookupsA);

    // свод тела B согласован с физикой B (результат не зависит от lookups A)
    const rPlanet = findBody<Planet>(restoredB, sc.planet.id)!;
    expectPoolMatchesPhysics(rPlanet, 'A2');
  });

  test('A3. Старый сейв с материализованными залежами (dm=1, без dv, старый свод): свод пересчитан, физика/склад/постройки/колонизация нетронуты', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;

    // ФИЗИКА сохранена бит-в-бит (id/qty/depth/availability с допуском round3).
    // ВАЖНО: эталон содержит залежь, полностью истощённую в геймплее (qty=0)
    // — кодек v3 осмысленно её НЕ пишет (R-29: «истощённые не пишутся»),
    // поэтому сверяем ЗА ЖИВЫМИ (qty>0) залежами эталона.
    expect(rPlanet.hexes.length).toBe(sc.planet.hexes.length);
    for (let i = 0; i < sc.planet.hexes.length; i++) {
      const want = sc.planet.hexes[i]!.deposits.filter(d => d.quantity > 0);
      const got = rPlanet.hexes[i]!.deposits;
      expect(got.length, `гекс ${i}: число живых залежей`).toBe(want.length);
      for (let d = 0; d < want.length; d++) {
        expect(got[d]!.elementId).toBe(want[d]!.elementId);
        expect(got[d]!.quantity).toBe(want[d]!.quantity);
        expect(got[d]!.depth).toBe(want[d]!.depth);
        expect(Math.abs(got[d]!.availability - want[d]!.availability)).toBeLessThanOrEqual(1e-3);
      }
    }

    // Игровые данные неприкосновенны: склад, владелец, постройки
    expect(rPlanet.resources['Ti-ore']).toBe(500.5);
    expect(rPlanet.resources[sc.partial.oreId]).toBe(77.25);
    expect(rPlanet.owner).toBe(sc.planet.owner);
    const wantBuildings = sc.planet.hexes.map(h => `${h.buildingId}@${h.buildingLevel}`);
    const gotBuildings = rPlanet.hexes.map(h => `${h.buildingId}@${h.buildingLevel}`);
    expect(gotBuildings).toEqual(wantBuildings);

    // Свод: устаревшие значения (×3 / константа 5) ушли, пул = физика
    expectPoolMatchesPhysics(rPlanet, 'A3');
    const ultraStaleGone = rPlanet.resourceDeposits.every(e =>
      !(ULTRA_RARE_ELEMENTS.includes(e.elementId) && e.totalQuantity === 5 && e.hexCount === 1
        && !independentAggregation(rPlanet).has(e.elementId)));
    expect(ultraStaleGone, 'константное обещание R-36 больше не в своде').toBe(true);

    // Маркеры: sv=1 (идемпотентность), dv НЕ инъецирован (физика честно старая)
    expect(rPlanet.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
    expect(rPlanet.depositRngVersion).toBeUndefined();
  });

  test('A4. Частично истощённая залежь: миграция сохраняет ФАКТИЧЕСКИЙ остаток, пул отражает остаток (не исходный запас)', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;

    // остаток сохранён точно (не восстановлен до исходного)
    const dep = rPlanet.hexes[sc.partial.hexIndex]!.deposits[sc.partial.depIndex]!;
    expect(dep.quantity).toBe(sc.partial.remaining);

    // пул = остаток (Σ по фактической физике), а не исходный запас:
    // сверяем запись элемента этой руды с независимой суммой остатков…
    const contained = findContainedElements(getCurrentLookups(), dep.elementId) ?? [];
    const pureId = contained.length > 0 ? contained[0]!.elementId : dep.elementId.replace(/-ore$/, '');
    const entry = rPlanet.resourceDeposits.find(e => e.elementId === pureId)!;
    const expected = independentAggregation(rPlanet).get(pureId)!;
    expect(entry.totalQuantity).toBeGreaterThanOrEqual(expected - 1);
    expect(entry.totalQuantity).toBeLessThanOrEqual(expected + 1);
    // …и подтверждаем, что остаток ≠ исходного: восстанавливаем исходное
    // количество в клоне эталона — «исходная» агрегация строго больше
    // (миграция отразила именно остаток, не откатила истощение)
    const cloneHexes = sc.planet.hexes.map(h => ({ ...h, deposits: h.deposits.map(d => ({ ...d })) }));
    cloneHexes[sc.partial.hexIndex]!.deposits[sc.partial.depIndex]!.quantity = sc.partial.original;
    const expectedOriginal = independentAggregation({ hexes: cloneHexes }).get(pureId)!;
    expect(expected, 'остаток в пуле < исходного запаса').toBeLessThan(expectedOriginal);
  });

  test('A5. Полностью истощённая залежь: после миграции НЕ resurrected — в сейве её нет, qty=0 не восстанавливается, добыча с неё нулевая', () => {
    const sc = buildOldMaterializedSave(42);

    // (а) qty=0 залежь НЕ пишется кодеком: в старом сейве её уже нет —
    // миграция не может её «восстановить» (не генерирует ничего).
    // Все записанные кортежи живые (qty>0) — истощённая выпала при записи.
    const raw = JSON.parse(sc.json) as SaveJson;
    const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
    const depletedHex = (dmBody.hexes as Array<{ deposits?: unknown[][] }>)[sc.depleted.hexIndex]!;
    for (const t of depletedHex.deposits ?? []) {
      expect((t[2] as number) > 0, 'истощённые кортежи не пишутся (R-29)').toBe(true);
    }
    // исходной пары (oreId, qty=0) в сейве нет: записанных кортежей этой
    // руды ровно столько, сколько ЖИВЫХ (qty>0) в эталоне — истощённая выпала
    const refAlive = sc.planet.hexes[sc.depleted.hexIndex]!.deposits
      .filter(d => d.elementId === sc.depleted.oreId && d.quantity > 0).length;
    const savedTuples = (depletedHex.deposits ?? [])
      .filter(t => raw.galaxy.dict[t[0] as number] === sc.depleted.oreId).length;
    expect(savedTuples, 'истощённая залежь выпала из сейва (число кортежей = живым)').toBe(refAlive);

    // (б) в память она тоже не возвращается; добыча по ней нулевая
    const restored = deserializeGameState(sc.json);
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;
    const hex = rPlanet.hexes[sc.depleted.hexIndex]!;
    expect(hex.deposits.find(d => d.elementId === sc.depleted.oreId && d.quantity > 0)).toBeUndefined();

    // (в) краевой случай: кортеж с quantity=0, вручную внесённый в сейв,
    // переживает миграцию как 0 (не resurrected до первоначального количества)
    const rawB = JSON.parse(sc.json) as SaveJson;
    const dmBodyB = [...jsonBodies(rawB)].find(b => b.dm === 1)!;
    const idx = rawB.galaxy.dict.indexOf(sc.partial.oreId);
    const someHex = (dmBodyB.hexes as Array<{ deposits?: unknown[][] }>)[0]!;
    (someHex.deposits ??= []).push([idx, 0.4, 0, 2]); // qty=0
    const jsonB = JSON.stringify(rawB);
    const restoredB = deserializeGameState(jsonB);
    const rPlanetB = findBody<Planet>(restoredB, sc.planet.id)!;
    const zeroDep = rPlanetB.hexes[0]!.deposits.find(d => d.elementId === sc.partial.oreId && d.quantity === 0);
    expect(zeroDep, 'qty=0 кортеж читается как есть').toBeDefined();
    // элемент этой руды в пуле не «воскрес» до исходного количества:
    // нулевая залежь добавляет 0 к сумме
    expectPoolMatchesPhysics(rPlanetB, 'A5(в)');
  });

  test('A6. Повторная загрузка (load→save→load): залежи/свод/склад/прогресс неизменны; рантрип побайтно стабилен', () => {
    const sc = buildOldMaterializedSave(42);

    const restored1 = deserializeGameState(sc.json);
    const json2 = serializeGameState(restored1);
    const restored2 = deserializeGameState(json2);
    const json3 = serializeGameState(restored2);

    // побайтная стабильность ПОСЛЕ первой миграции (sv зафиксировал свод)
    expect(json3).toBe(json2);

    const p1 = findBody<Planet>(restored1, sc.planet.id)!;
    const p2 = findBody<Planet>(restored2, sc.planet.id)!;

    // физика идентична
    expect(p2.hexes.length).toBe(p1.hexes.length);
    for (let i = 0; i < p1.hexes.length; i++) {
      expect(p2.hexes[i]!.deposits.length).toBe(p1.hexes[i]!.deposits.length);
      for (let d = 0; d < p1.hexes[i]!.deposits.length; d++) {
        expect(p2.hexes[i]!.deposits[d]!.quantity).toBe(p1.hexes[i]!.deposits[d]!.quantity);
        expect(p2.hexes[i]!.deposits[d]!.elementId).toBe(p1.hexes[i]!.deposits[d]!.elementId);
      }
    }
    // свод/склад/прогресс идентичны
    expect(p2.resourceDeposits).toEqual(p1.resourceDeposits);
    expect(p2.resources).toEqual(p1.resources);
    expect(p2.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);

    // повторная загрузка ТОГО ЖЕ старого сейва (без промежуточного save)
    // даёт тот же мигрированный свод (детерминизм миграции)
    const restoredAgain = deserializeGameState(sc.json);
    const pAgain = findBody<Planet>(restoredAgain, sc.planet.id)!;
    expect(pAgain.resourceDeposits).toEqual(p1.resourceDeposits);
  });

  test('A7. Отказ миграции: тело с битыми числовыми данными сохраняет прежний свод, загрузка продолжается, lookups не портятся', () => {
    const sc = buildOldMaterializedSave(42);
    // Портим числовые данные материализованного тела: quantity = строка →
    // агрегация даёт NaN → миграция ОТКАЗЫВАЕТСЯ (валидация результата),
    // тело сохраняет прежний свод, остальные тела мигрируют нормально.
    const raw = JSON.parse(sc.json) as SaveJson;
    const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
    const hexes = dmBody.hexes as Array<{ deposits?: unknown[][] }>;
    const withDeps = hexes.find(h => (h.deposits?.length ?? 0) > 0)!;
    (withDeps.deposits![0] as unknown[])[2] = 'oops-not-a-number';
    const jsonBroken = JSON.stringify(raw);

    let restored: GameState;
    expect(() => { restored = deserializeGameState(jsonBroken); }).not.toThrow();
    restored = deserializeGameState(jsonBroken);

    // тело-отказник: sv НЕ проставлен, свод прежний (не NaN-мусор)
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;
    expect(rPlanet.depositSummaryVersion).toBeUndefined();
    for (const e of rPlanet.resourceDeposits) {
      expect(Number.isFinite(e.totalQuantity), `${e.elementId}: свод не отравлен NaN`).toBe(true);
    }

    // lookups валидны и принадлежат загруженной галактике (не «порчены»)
    expect(hasCurrentLookups()).toBe(true);
    expect(getCurrentLookups().elementToOre).toBe(buildLookups(restored.galaxy.bakedModel).elementToOre);

    // ленивые тела загружены нормально (загрузка не прервана отказом)
    let lazyBodies = 0;
    for (const b of allBodies(restored)) {
      if (b.hexes.length > 0 && !b.depositsMaterialized) lazyBodies++;
    }
    expect(lazyBodies).toBeGreaterThan(0);
  });

  test('A8. Ленивая загрузка: загрузка старого сейва НЕ материализует ленивые тела (dm=0 нетронуты, ds на месте, рост сейва ограничен)', () => {
    const sc = buildOldMaterializedSave(42); // 1 материализованное тело + сотни ленивых
    const restored = deserializeGameState(sc.json);

    let lazy = 0;
    let materialized = 0;
    for (const b of allBodies(restored)) {
      if (b.hexes.length === 0) continue;
      if (b.depositsMaterialized) { materialized++; continue; }
      lazy++;
      // ленивость: залежей нет, снимок на месте, sv НЕ инъецирован
      expect(b.hexes.every(h => h.deposits.length === 0), `${b.id}: гексы пусты`).toBe(true);
      expect(b.depositRngState, `${b.id}: снимок на месте`).not.toBeNull();
      expect(b.depositSummaryVersion, `${b.id}: sv не инъецирован`).toBeUndefined();
    }
    expect(materialized).toBe(1);
    expect(lazy).toBeGreaterThan(50);

    // размер: повторная сериализация отличается только мигрированным сводом
    // одного тела (+sv) — не материализацией всей галактики (МБ)
    const json2 = serializeGameState(restored);
    const deltaBytes = Math.abs(json2.length - sc.json.length);
    expect(deltaBytes, 'рост сейва ограничен (КБ, не МБ)').toBeLessThan(8 * 1024);
  });

  test('A9. Сейв без dv и без материализованных тел: побайтный round-trip (миграция не срабатывает)', () => {
    // Свежая галактика БЕЗ колонизаций: сносим только dv (сейвы до R-36)
    // — тел с dm=1 нет, миграции нечему срабатывать → рантрип побайтно.
    const json0 = serializeGameState(buildFreshState(42, 10));
    const json = ageSave(json0);
    const restored = deserializeGameState(json);
    const json2 = serializeGameState(restored);
    expect(json2).toBe(json);
  });

  test('A10. Неполные и граничные данные: отсутствующий пул/пустые залежи/неизвестный элемент/qty=0/dv=999 — предсказуемо, без тихого уничтожения', () => {
    const sc = buildOldMaterializedSave(42);

    // (1) отсутствующий пул у dm=1 тела → миграция создаёт полный пул из физики
    {
      const raw = JSON.parse(sc.json) as SaveJson;
      const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
      delete dmBody.resourceDeposits;
      const restored = deserializeGameState(JSON.stringify(raw));
      const p = findBody<Planet>(restored, sc.planet.id)!;
      expect(p.resourceDeposits.length).toBeGreaterThan(0);
      expectPoolMatchesPhysics(p, 'A10(1)');
    }

    // (2) пустые залежи всех гексов (всё истощено) → пул = чистые оценки hexCount=0
    {
      const raw = JSON.parse(sc.json) as SaveJson;
      const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
      for (const h of dmBody.hexes as Array<{ deposits?: unknown[][] }>) delete h.deposits;
      const restored = deserializeGameState(JSON.stringify(raw));
      const p = findBody<Planet>(restored, sc.planet.id)!;
      expect(p.hexes.every(h => h.deposits.length === 0)).toBe(true);
      expect(p.resourceDeposits.every(e => e.hexCount === 0), 'пул без обещанной физики').toBe(true);
      expect(p.resourceDeposits.length).toBeGreaterThan(0); // полный набор элементов
    }

    // (3) неизвестный элемент (нет в хим.модели и ELEMENT_MAP) → запись пула
    // сохраняется по фактическому ID (не исчезает молча)
    {
      const raw = JSON.parse(sc.json) as SaveJson;
      raw.galaxy.dict.push('Xx-ore'); // индекс за пределами старого словаря
      const xxIdx = raw.galaxy.dict.length - 1;
      const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
      const someHex = (dmBody.hexes as Array<{ deposits?: unknown[][] }>)[0]!;
      (someHex.deposits ??= []).push([xxIdx, 0.5, 40, 2]);
      const restored = deserializeGameState(JSON.stringify(raw));
      const p = findBody<Planet>(restored, sc.planet.id)!;
      const xx = p.resourceDeposits.find(e => e.elementId === 'Xx-ore');
      expect(xx, 'неизвестный элемент не уничтожен').toBeDefined();
      expect(xx!.totalQuantity).toBe(40);
      expect(xx!.hexCount).toBe(1);
    }

    // (4) некорректная версия генератора (dv=999, «будущая») на dm=1 теле →
    // свод нормализован текущим контрактом (sv=1), dv сохранён как есть
    {
      const raw = JSON.parse(sc.json) as SaveJson;
      const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
      dmBody.dv = 999;
      const restored = deserializeGameState(JSON.stringify(raw));
      const p = findBody<Planet>(restored, sc.planet.id)!;
      expect(p.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
      expect(p.depositRngVersion, 'dv не подменяется молча').toBe(999);
      expectPoolMatchesPhysics(p, 'A10(4)');
    }

    // (5) dm=1 при ПУСТЫХ гексах (маловероятная форма) → миграция
    // предсказуемо пропускает (не падает, пул не трогает)
    {
      const raw = JSON.parse(sc.json) as SaveJson;
      const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
      dmBody.hexes = [];
      const restored = deserializeGameState(JSON.stringify(raw));
      const p = findBody<Planet>(restored, sc.planet.id)!;
      expect(p.hexes.length).toBe(0);
      expect(p.depositSummaryVersion).toBeUndefined();
    }
  });
});

// ============ B. Согласованность сводки и физической добычи (§3B) ============

describe('R-38 B: сводка ↔ физическая добыча на мигрированных телах', () => {
  test('B1. Сводка соответствует физике: resourceDeposits мигрированного тела = агрегат фактических залежей (модель агрегации)', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;
    expectPoolMatchesPhysics(rPlanet, 'B1');
  });

  test('B2. Уникальный ресурс: запись пула подтверждается РЕАЛЬНОЙ физической залежью (не только строкой в своде)', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const rPlanet = findBody<Planet>(restored, sc.planet.id)!;

    // УСТАРЕВШАЯ сводка обещала константу (5) выбранному ultra — миграция
    // обязана заменить её фактической физикой выбранного элемента.
    const physicalUltra = new Set<string>();
    for (const hex of rPlanet.hexes) {
      for (const d of hex.deposits) {
        const pureId = d.elementId.replace(/-ore$/, '');
        if (ULTRA_RARE_ELEMENTS.includes(pureId) && d.quantity > 0) physicalUltra.add(pureId);
      }
    }
    expect(physicalUltra.size, 'на теле есть физические ultra-залежи').toBeGreaterThan(0);

    // каждая ultra-запись пула с hexCount>0 подтверждена физикой
    for (const entry of rPlanet.resourceDeposits) {
      if (!ULTRA_RARE_ELEMENTS.includes(entry.elementId)) continue;
      if (entry.hexCount > 0) {
        expect(physicalUltra.has(entry.elementId), `${entry.elementId}: hexCount>0 ⇒ физическая залежь есть`).toBe(true);
      }
    }
    // и наоборот: каждый физический ultra элемент имеет запись пула = Σ(qty × доля)
    const expected = independentAggregation(rPlanet);
    for (const elId of physicalUltra) {
      const entry = rPlanet.resourceDeposits.find(e => e.elementId === elId)!;
      expect(entry, `${elId}: запись пула есть`).toBeDefined();
      const exp = expected.get(elId) ?? 0;
      expect(entry.totalQuantity, `${elId}: пул = физика (не константа R-36)`).toBeGreaterThanOrEqual(exp - 1);
      expect(entry.totalQuantity).toBeLessThanOrEqual(exp + 1);
    }
  });

  test('B3. Буровая до истощения: добыча идёт ровно до остатка залежи, добытый объём = правилам движка', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const p = findBody<Planet>(restored, sc.planet.id)!;

    // ищем глубинную руду на свободном гексе (роль drilling_rig)
    const lookups = getCurrentLookups();
    let target: { hexIndex: number; oreId: string; qty: number } | null = null;
    p.hexes.forEach((hex, hexIndex) => {
      if (target || hex.buildingId !== null || hex.terrain === 'ocean') return;
      for (const d of hex.deposits) {
        const ore = lookups.oreMap.get(d.elementId);
        if (ore && ore.sourceBuildingId === 'drilling_rig' && d.quantity > 0) {
          target = { hexIndex, oreId: d.elementId, qty: d.quantity };
          return;
        }
      }
    });
    expect(target, 'найдена глубинная залежь на свободном гексе').not.toBeNull();
    const t = target!;

    const hex = p.hexes[t.hexIndex]!;
    hex.buildingId = 'drilling_rig';
    hex.buildingLevel = 10; // покрывает minSourceLevel ≤ 10
    if (p.energyBalance <= 0) p.energyBalance = 1000;

    const queues = new Map<EntityId, ProductionQueue>();
    let extracted = 0;
    for (let tick = 0; tick < 20000; tick++) {
      processEconomyTick([p], queues);
      const dep = hex.deposits.find(d => d.elementId === t.oreId);
      if (!dep || dep.quantity <= 0) {
        extracted = p.resources[t.oreId] ?? 0;
        break;
      }
    }
    const dep = hex.deposits.find(d => d.elementId === t.oreId);
    expect(dep?.quantity ?? 0, 'залежь исчерпана').toBeLessThanOrEqual(0);
    expect(extracted, 'добыто ровно содержимое залежи').toBeGreaterThanOrEqual(t.qty - 0.5);

    // пул (снимок миграции) не противоречит добыче: вклад залежи в запись её
    // элемента не превышает пула (элемент может поступать и из ДРУГИХ руд
    // планеты — поэтому проверка односторонняя: пул ≥ вклада этой залежи)
    const contained = findContainedElements(lookups, t.oreId)!;
    const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
    const fraction = contained[0]!.yield / totalYield;
    const entry = p.resourceDeposits.find(e => e.elementId === contained[0]!.elementId)!;
    expect(entry.totalQuantity, 'вклад добытой залежи покрыт пулом').toBeGreaterThanOrEqual(extracted * fraction - 1);
  });

  test('B4. После истощения: повторные тики не добывают дополнительных ресурсов', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const p = findBody<Planet>(restored, sc.planet.id)!;

    const lookups = getCurrentLookups();
    let target: { hexIndex: number; oreId: string } | null = null;
    p.hexes.forEach((hex, hexIndex) => {
      if (target || hex.buildingId !== null || hex.terrain === 'ocean') return;
      for (const d of hex.deposits) {
        const ore = lookups.oreMap.get(d.elementId);
        if (ore && ore.sourceBuildingId === 'drilling_rig' && d.quantity > 0) {
          target = { hexIndex, oreId: d.elementId };
          return;
        }
      }
    });
    const t = target!;
    const hex = p.hexes[t.hexIndex]!;
    hex.buildingId = 'drilling_rig';
    hex.buildingLevel = 10;
    if (p.energyBalance <= 0) p.energyBalance = 1000;

    const queues = new Map<EntityId, ProductionQueue>();
    for (let tick = 0; tick < 20000; tick++) {
      processEconomyTick([p], queues);
      const dep = hex.deposits.find(d => d.elementId === t.oreId);
      if (!dep || dep.quantity <= 0) break;
    }
    const extractedAtDepletion = p.resources[t.oreId] ?? 0;
    expect(extractedAtDepletion).toBeGreaterThan(0);

    // ещё 50 тиков после истощения — объём не растёт
    for (let tick = 0; tick < 50; tick++) processEconomyTick([p], queues);
    expect(p.resources[t.oreId] ?? 0).toBe(extractedAtDepletion);
  });

  test('B5. Уровни буровой: ниже minSourceLevel руды добыча НЕ идёт, на достаточном уровне — идёт', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const p = findBody<Planet>(restored, sc.planet.id)!;

    // ищем глубинную руду с minSourceLevel = 5 на свободном гексе
    const lookups = getCurrentLookups();
    let target: { hexIndex: number; oreId: string } | null = null;
    p.hexes.forEach((hex, hexIndex) => {
      if (target || hex.buildingId !== null || hex.terrain === 'ocean') return;
      for (const d of hex.deposits) {
        const ore = lookups.oreMap.get(d.elementId);
        if (ore && ore.sourceBuildingId === 'drilling_rig' && ore.minSourceLevel === 5 && d.quantity > 0) {
          target = { hexIndex, oreId: d.elementId };
          return;
        }
      }
    });
    expect(target, 'найдена руда с порогом 5').not.toBeNull();
    const t = target!;
    const hex = p.hexes[t.hexIndex]!;
    if (p.energyBalance <= 0) p.energyBalance = 1000;
    const queues = new Map<EntityId, ProductionQueue>();

    // ОТРИЦАТЕЛЬНЫЙ тест: буровая L4 (< 5) — руда не добывается
    hex.buildingId = 'drilling_rig';
    hex.buildingLevel = 4;
    for (let tick = 0; tick < 30; tick++) processEconomyTick([p], queues);
    expect(p.resources[t.oreId] ?? 0, 'L4 ниже порога — добычи нет').toBe(0);

    // ПОЛОЖИТЕЛЬНЫЙ тест: L5 (= порогу) — добыча идёт
    hex.buildingLevel = 5;
    for (let tick = 0; tick < 300; tick++) processEconomyTick([p], queues);
    expect(p.resources[t.oreId] ?? 0, 'L5 на пороге — добыча идёт').toBeGreaterThan(0);
  });

  test('B6. Океанический мир: отсутствие добычных гексов не даёт фиктивной физики/ложного hexCount', () => {
    const sc = buildOldMaterializedSave(42);
    // Превращаем материализованное тело в полностью океанский мир:
    // вся поверхность — ocean, залежей нет, свод — старый (с обещаниями).
    const raw = JSON.parse(sc.json) as SaveJson;
    const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
    for (const h of dmBody.hexes as Array<{ terrain: string; deposits?: unknown[][] }>) {
      h.terrain = 'ocean';
      delete h.deposits;
    }
    const restored = deserializeGameState(JSON.stringify(raw));
    const p = findBody<Planet>(restored, sc.planet.id)!;

    // физика не создана из ничего
    expect(p.hexes.every(h => h.deposits.length === 0), 'фиктивных залежей нет').toBe(true);
    // пул = геологическая оценка: hexCount=0 у ВСЕХ записей (никаких обещаний)
    expect(p.resourceDeposits.every(e => e.hexCount === 0), 'ложного hexCount нет').toBe(true);
    expect(p.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
  });

  test('B7. Планета без подходящих гексов: пустая физическая сводка, никаких искусственно добавленных залежей', () => {
    const sc = buildOldMaterializedSave(42);
    // Все залежи сняты (симуляция полной выработки), гексы обычные.
    const raw = JSON.parse(sc.json) as SaveJson;
    const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
    for (const h of dmBody.hexes as Array<{ deposits?: unknown[][] }>) delete h.deposits;
    const restored = deserializeGameState(JSON.stringify(raw));
    const p = findBody<Planet>(restored, sc.planet.id)!;

    expect(p.hexes.every(h => h.deposits.length === 0), 'залежи не добавлены').toBe(true);
    expect(p.resourceDeposits.every(e => e.hexCount === 0), 'свод = чистая оценка').toBe(true);
    // повторная загрузка идемпотентна
    const json2 = serializeGameState(restored);
    const restored2 = deserializeGameState(json2);
    const p2 = findBody<Planet>(restored2, sc.planet.id)!;
    expect(p2.resourceDeposits).toEqual(p.resourceDeposits);
  });

  test('B8. Запасная ветка генерации: трансурановые Np/Pu/Am (fallback «<элемент>-ore») — пул = физика, добыча базовым добытчиком', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json);
    const p = findBody<Planet>(restored, sc.planet.id)!;

    // контракт генератора: трансурановые без руды в хим.модели идут fallback
    // ID «Np-ore»/«Pu-ore»/«Am-ore», агрегируются 1:1 как элементы, доступны
    // базовым добытчикам (canMineDeposit: неизвестный ID = обычная порода).
    const lookups = getCurrentLookups();
    const npOre = 'Np-ore';
    expect(lookups.oreMap.has(npOre), 'Np-ore отсутствует в хим.модели (контракт fallback)').toBe(false);

    let hexIndex = -1;
    let totalQty = 0;
    let hexesWith = 0;
    p.hexes.forEach((hex, i) => {
      const deps = hex.deposits.filter(d => d.elementId === npOre && d.quantity > 0);
      if (deps.length > 0) { hexIndex = i; hexesWith++; totalQty += deps.reduce((s, d) => s + d.quantity, 0); }
    });
    expect(hexIndex, 'на теле есть залежи Np-ore').toBeGreaterThanOrEqual(0);

    // пул: запись Np = Σ(qty × 1:1) ± 1, hexCount = числу гексов с рудой
    const entry = p.resourceDeposits.find(e => e.elementId === 'Np')!;
    expect(entry, 'запись пула Np есть').toBeDefined();
    expect(entry.totalQuantity).toBeGreaterThanOrEqual(totalQty - 1);
    expect(entry.totalQuantity).toBeLessThanOrEqual(totalQty + 1);
    expect(entry.hexCount).toBe(hexesWith);

    // добыча: шахта на гексе извлекает Np-ore (fallback — обычная порода)
    const hex = p.hexes[hexIndex]!;
    if (hex.buildingId !== null) {
      // гекс занят — ставим шахту на любой другой гекс с Np-ore не проверяя
      const alt = p.hexes.findIndex(h => h.buildingId === null && h.deposits.some(d => d.elementId === npOre && d.quantity > 0));
      expect(alt, 'есть свободный гекс с Np-ore').toBeGreaterThanOrEqual(0);
      p.hexes[alt]!.buildingId = 'mine';
      p.hexes[alt]!.buildingLevel = 1;
    } else {
      hex.buildingId = 'mine';
      hex.buildingLevel = 1;
    }
    if (p.energyBalance <= 0) p.energyBalance = 1000;
    const queues = new Map<EntityId, ProductionQueue>();
    const before = p.resources[npOre] ?? 0;
    for (let tick = 0; tick < 200; tick++) processEconomyTick([p], queues);
    expect(p.resources[npOre] ?? 0, 'Np-ore добыт базовым добытчиком').toBeGreaterThan(before);
  });

  test('B9. Планета и луна: одинаковые инварианты миграции для обоих типов тел', () => {
    // Сценарий с МАТЕРИАЛИЗОВАННОЙ ЛУНОЙ (колонизация лун — post-MVP,
    // материализация доступна напрямую, как tests/save-format-v3 №11).
    const state = buildFreshState(77, 25);
    let moon: Moon | null = null;
    for (const b of allBodies(state)) {
      if ('planetId' in b && b.hexes.length > 0 && !b.depositsMaterialized) { moon = b as Moon; break; }
    }
    expect(moon, 'найдена луна с гексами').not.toBeNull();
    const m = moon!;

    // материализация (replay) + детерминированное истощение части залежей.
    // Луны не имеют склада resources (колонизация лун — post-MVP): их
    // «прогресс» — состояние самих залежей.
    expect(materializePlanetDeposits(m)).toBe(true);
    const dep = m.hexes.flatMap(h => h.deposits).find(d => d.quantity > 5)!;
    dep.quantity = Math.ceil(dep.quantity / 2);

    const json = ageSave(serializeGameState(state));
    const restored = deserializeGameState(json);
    const rMoon = findBody<Moon>(restored, m.id)!;

    // те же инварианты, что у планет (A3/B1; склад лунам не положен — post-MVP):
    expect(rMoon.depositsMaterialized).toBe(true);
    expect(rMoon.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
    const refDep = m.hexes.flatMap(h => h.deposits).find(d => d.elementId === dep.elementId)!;
    const rDep = rMoon.hexes.flatMap(h => h.deposits).find(d => d.elementId === dep.elementId)!;
    expect(rDep.quantity, 'остаток лунной залежи сохранён').toBe(refDep.quantity);
    expectPoolMatchesPhysics(rMoon, 'B9-луна');
  });

  test('B10. Генерация и загрузка: одинаковые данные + версия → идентичные результаты (пул переживает рантрип без изменений)', () => {
    // Свежее состояние (текущая dv/sv): пул каждого тела после Save→Load
    // побитово равен пулу генерации (никаких пересчётов/сдвигов).
    const state = buildFreshState(42, 10);
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);

    const refById = new Map<string, PlanetResourceLike>();
    for (const b of allBodies(state)) refById.set(b.id, b.resourceDeposits as PlanetResourceLike);
    let checked = 0;
    for (const b of allBodies(restored)) {
      const ref = refById.get(b.id)!;
      expect(b.resourceDeposits, `${b.id}: пул рантрип без изменений`).toEqual(ref);
      // sv актуален у тел с гексами (у ГГ поле не пишется — как dv)
      if (b.hexes.length > 0) {
        expect(b.depositSummaryVersion, `${b.id}: sv актуален`).toBe(DEPOSIT_SUMMARY_VERSION);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    // и повторная сериализация побайтно идентична (сигнатура формата стабильна)
    expect(serializeGameState(restored)).toBe(json);
  });
});

/** Локальный alias для B10 (тип записи пула). */
type PlanetResourceLike = Planet['resourceDeposits'];

// ============ C. Детерминизм и PRNG (задание R-38 §3C) ============

describe('R-38 C: детерминизм и PRNG миграции', () => {
  test('C1. Повторная генерация/загрузка: один seed + версия → одинаковые залежи, свод и результат миграции', () => {
    // генерация: два прогона одного seed → идентичные пулы (санити)
    const a = buildFreshState(42, 8);
    const b = buildFreshState(42, 8);
    const pa = a.galaxy.systems.flatMap(s => s.planets).map(p => p.resourceDeposits);
    const pb = b.galaxy.systems.flatMap(s => s.planets).map(p => p.resourceDeposits);
    expect(pb).toEqual(pa);

    // миграция: тот же старый сейв, две независимые загрузки → идентичный свод
    const sc = buildOldMaterializedSave(42);
    const r1 = deserializeGameState(sc.json);
    const r2 = deserializeGameState(sc.json);
    const p1 = findBody<Planet>(r1, sc.planet.id)!;
    const p2 = findBody<Planet>(r2, sc.planet.id)!;
    expect(p2.resourceDeposits).toEqual(p1.resourceDeposits);
    expect(p2.hexes.map(h => h.deposits)).toEqual(p1.hexes.map(h => h.deposits));
  });

  test('C2. Изоляция галактик: генерация/загрузка галактики A не влияет на миграцию сейва B', () => {
    const scB = buildOldMaterializedSave(200);

    // ХОЛОДНАЯ загрузка B (эталон)
    resetCurrentLookups();
    const cold = deserializeGameState(scB.json);
    const coldPool = findBody<Planet>(cold, scB.planet.id)!.resourceDeposits;

    // Загрузка B ПОСЛЕ активной игры A + генерации третьей галактики
    deserializeGameState(serializeGameState(buildFreshState(100, 8))); // игра A
    buildFreshState(300, 5); // генерация ещё одной галактики (lookups A остаются)
    const after = deserializeGameState(scB.json);
    const afterPool = findBody<Planet>(after, scB.planet.id)!.resourceDeposits;

    expect(afterPool, 'результат миграции B не зависит от предыстории процесса').toEqual(coldPool);
  });

  test('C3. Round-trip не меняет будущих случайных результатов: после миграции колонизация ленивого тела воспроизводит эталон бит-в-бит', () => {
    const sc = buildOldMaterializedSave(42);
    const restored = deserializeGameState(sc.json); // миграция dm=1 тела состоялась

    // Эталон: прямая генерация + колонизация ДРУГОГО (ленивого) тела того же seed
    const ref = buildFreshState(42, 10);
    const refLazy = ref.galaxy.systems.flatMap(s => s.planets)
      .find(p => p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0
        && p.id !== sc.planet.id)!;
    expect(colonizePlanet(refLazy)).toBe(true);
    const truth = refLazy.hexes.map(h => h.deposits.map(d => ({ ...d })));

    // Колонизация того же тела в загруженном состоянии (после миграции соседа)
    const rLazy = findBody<Planet>(restored, refLazy.id)!;
    expect(rLazy.depositsMaterialized).toBe(false);
    expect(colonizePlanet(rLazy)).toBe(true);
    expect(rLazy.hexes.length).toBe(truth.length);
    for (let i = 0; i < truth.length; i++) {
      expect(rLazy.hexes[i]!.deposits, `гекс ${i}: replay бит-в-бит (снимок не сдвинут)`).toEqual(truth[i]!);
    }
    // и версия физики стала честно текущей после replay
    expect(rLazy.depositRngVersion).toBe(DEPOSIT_RNG_VERSION);
    expect(rLazy.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
  });

  test('C4. Состояние PRNG на границах: миграция тела БЕЗ снимка ds детерминирована и конечна (нулевое состояние — защищено)', () => {
    const sc = buildOldMaterializedSave(42);
    // убираем ds у материализованного тела (повреждённый сейв):
    // deriveSummaryEstimateRng использует fromState(null) + соль id
    const raw = JSON.parse(sc.json) as SaveJson;
    const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
    delete dmBody.ds;
    const jsonNoDs = JSON.stringify(raw);

    const r1 = deserializeGameState(jsonNoDs);
    const r2 = deserializeGameState(jsonNoDs);
    const p1 = findBody<Planet>(r1, sc.planet.id)!;
    const p2 = findBody<Planet>(r2, sc.planet.id)!;

    expect(p1.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
    expect(p2.resourceDeposits, 'миграция без ds детерминирована').toEqual(p1.resourceDeposits);
    for (const e of p1.resourceDeposits) {
      expect(Number.isFinite(e.totalQuantity), `${e.elementId}: конечные значения`).toBe(true);
      expect(Number.isFinite(e.avgAvailability)).toBe(true);
      expect(Number.isFinite(e.maxAvailability)).toBe(true);
    }
  });

  test('C5. Версия генератора: старые dv не подменяются текущей молча; подмена происходит ТОЛЬКО через предусмотренную миграцию (replay)', () => {
    const sc = buildOldMaterializedSave(42);

    // (1) материализованное тело с ЯВНОЙ старой dv=2: миграция свода НЕ трогает dv
    const raw = JSON.parse(sc.json) as SaveJson;
    const dmBody = [...jsonBodies(raw)].find(b => b.dm === 1)!;
    dmBody.dv = 2;
    const restored = deserializeGameState(JSON.stringify(raw));
    const p = findBody<Planet>(restored, sc.planet.id)!;
    expect(p.depositRngVersion, 'dv материализованного тела сохранена (физика честно старая)').toBe(2);
    expect(p.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
    // и в сейве: dv:2 + sv:1 (свидетельство миграции свода, не физики)
    const json2 = serializeGameState(restored);
    const raw2 = JSON.parse(json2) as SaveJson;
    const dm2 = [...jsonBodies(raw2)].find(b => b.dm === 1)!;
    expect(dm2.dv).toBe(2);
    expect(dm2.sv).toBe(DEPOSIT_SUMMARY_VERSION);

    // (2) ленивое тело с dv=2: остаётся ленивым при загрузке, dv=2 в рантрипе;
    // колонизация = ПРЕДУСМОТРЕННАЯ миграция (replay текущим кодом → dv=3)
    const rawL = JSON.parse(sc.json) as SaveJson;
    const lazyBody = [...jsonBodies(rawL)].find(b => b.dm !== 1 && Array.isArray(b.ds)
      && (b.hexes as unknown[]).length > 0 && b.id !== dmBody.id)!;
    lazyBody.dv = 2;
    const restoredL = deserializeGameState(JSON.stringify(rawL));
    const lazy = findBody<Planet>(restoredL, lazyBody.id as string)!;
    expect(lazy.depositsMaterialized, 'ленивое тело остаётся ленивым').toBe(false);
    expect(lazy.depositRngVersion).toBe(2);
    // колонизация: replay → физика текущей семантики, dv честно становится 3
    expect(colonizePlanet(lazy)).toBe(true);
    expect(lazy.depositsMaterialized).toBe(true);
    expect(lazy.depositRngVersion, 'после replay dv = текущей (предусмотренная миграция)').toBe(DEPOSIT_RNG_VERSION);
    expect(lazy.depositSummaryVersion).toBe(DEPOSIT_SUMMARY_VERSION);
  });
});
