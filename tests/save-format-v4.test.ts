/// <reference types="bun-types" />
/**
 * ORE-POOLS-RUNTIME-01 (Issue #25): формат сейва v4 — планетарные пулы.
 *
 * Контракт (docs/31 §12, docs/35):
 *   - fmt = 4 — единственный формат; сейвы v1/v2/v3 (гекс-залежи) отклоняются
 *     ЯВНОЙ ошибкой с понятным сообщением «начните новую игру» (без миграции,
 *     без тихой загрузки со сброшенными пулами);
 *   - тела хранят `op` — кортежи PlanetOrePool по точному oreId
 *     (initial + remaining: состояние истощения сохраняется, включая
 *     исчерпанные пулы);
 *   - свод-превью resourceDeposits НЕ сериализуется — пересобирается при
 *     загрузке из пулов (buildResourceSummary, «свод = добыча»);
 *   - HexCell.deposits / depositRngState / dm/dv/sv не существуют;
 *   - идемпотентность: serialize(deserialize(serialize(s))) === serialize(s).
 *
 * Run: bun test tests/save-format-v4.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { compactSaveV4, expandSaveV4, SAVE_FORMAT_VERSION, isSaveFormatV4 } from '@/lib/save-format-v4';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import { colonizePlanet, processEconomyTick } from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState, Planet, Moon, EntityId, ProductionQueue } from '@/core/types';

setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

/**
 * Нормализация пулов к точности сейва (round3 на remaining/availability
 * при encode — docs/35: округления стабильны; живое состояние хранит
 * полную точность). Сравнение живое↔загруженное идёт по этой норме.
 */
function roundedPools(pools: Array<{ oreId: string; initialQuantity: number; remainingQuantity: number; availability: number; tier: string }>) {
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  return pools.map((p) => ({ ...p, remainingQuantity: r3(p.remainingQuantity), availability: r3(p.availability) }));
}

function buildFreshState(systemCount: number, seed = 42): GameState {
  const galaxy = generateGalaxy({ seed, systemCount });
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

/** Все планеты и луны всех систем. */
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

describe('ORE-POOLS: формат сейва v4 — планетарные пулы', () => {
  test('1. Свежая галактика: у не-ГГ тел есть пулы; у тел нет ds/dm/dv/sv и hex-залежей', () => {
    const state = buildFreshState(6);
    let withPools = 0;
    for (const body of allBodies(state)) {
      const anyBody = body as unknown as Record<string, unknown>;
      expect('depositRngState' in anyBody, 'нет depositRngState').toBe(false);
      expect('depositsMaterialized' in anyBody, 'нет depositsMaterialized').toBe(false);
      for (const h of body.hexes) {
        expect('deposits' in h, 'гекс без deposits').toBe(false);
      }
      if (body.hexes.length > 0) {
        expect(body.orePools.length, `${body.id}: пулы у поверхности`).toBeGreaterThan(0);
        withPools++;
        for (const pool of body.orePools) {
          expect(pool.remainingQuantity).toBe(pool.initialQuantity);
        }
      } else {
        expect(body.orePools.length, `${body.id}: ГГ без коровых пулов`).toBe(0);
      }
    }
    expect(withPools).toBeGreaterThan(0);
  });

  test('2. Детерминизм: один seed → одинаковые пулы', () => {
    const a = buildFreshState(5).galaxy.systems;
    const b = buildFreshState(5).galaxy.systems;
    for (let i = 0; i < a.length; i++) {
      const pa = a[i]!.planets;
      const pb = b[i]!.planets;
      for (let j = 0; j < pa.length; j++) {
        expect(pb[j]!.orePools).toEqual(pa[j]!.orePools);
      }
    }
  });

  test('3. Round-trip v4 (свежая): fmt=4, словарь, op; пулы и свод восстанавливаются', () => {
    const state = buildFreshState(6);
    const json = serializeGameState(state);
    expect(isSaveFormatV4(json)).toBe(true);

    const packed = JSON.parse(json) as Record<string, unknown>;
    expect(packed.fmt).toBe(SAVE_FORMAT_VERSION);
    const systems = (packed.galaxy as Record<string, unknown>).systems as Array<Record<string, unknown>> | undefined;
    const firstPlanet = systems?.[0]?.planets
      ? (systems[0]!.planets as Array<Record<string, unknown>>)[0] as Record<string, unknown>
      : undefined;
    expect(Array.isArray(firstPlanet!.op), 'кортежи пулов op').toBe(true);
    expect(firstPlanet!.ds).toBeUndefined();
    expect(firstPlanet!.dm).toBeUndefined();
    // свод-превью НЕ сериализуется (производная пулов)
    expect(firstPlanet!.resourceDeposits).toBeUndefined();

    const restored = deserializeGameState(json);
    const original = firstColonizable(state);
    const loaded = (restored.galaxy.systems.flatMap(s => s.planets).find(p => p.id === original.id))!;
    expect(roundedPools(loaded.orePools)).toEqual(roundedPools(original.orePools));
    // свод пересобран из пулов (без сериализации) и согласован
    expect(loaded.resourceDeposits.length).toBeGreaterThan(0);
    const feOriginal = original.orePools.find(p => p.oreId === 'Fe-ore');
    if (feOriginal) {
      const feSummary = loaded.resourceDeposits.find(d => d.elementId === 'Fe');
      expect(feSummary, 'Fe в своде из пулов').toBeDefined();
      expect(feSummary!.totalQuantity).toBeGreaterThan(0);
    }
  });

  test('4. Round-trip v4 (после колонизации/добычи): истощение пулов сохраняется', () => {
    const state = buildFreshState(6);
    const planet = firstColonizable(state);
    expect(colonizePlanet(planet)).toBe(true);
    // Немного добычи
    const hexIdx = planet.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
    planet.hexes[hexIdx]!.buildingId = 'mine';
    planet.hexes[hexIdx]!.buildingLevel = 3;
    planet.energyBalance = 1000;
    const queues = new Map<EntityId, ProductionQueue>();
    for (let i = 0; i < 10; i++) processEconomyTick([planet], queues);

    const poolsBefore = JSON.parse(JSON.stringify(planet.orePools));
    const minedOre = Object.keys(planet.resources).find(k => k.endsWith('-ore'));
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    const loaded = (restored.galaxy.systems.flatMap(s => s.planets).find(p => p.id === planet.id))!;

    expect(roundedPools(loaded.orePools)).toEqual(roundedPools(poolsBefore));
    // Есть истощение: хотя бы один пул уменьшился, и оно пережило сейв
    const depleted = poolsBefore.filter((p: { remainingQuantity: number; initialQuantity: number }) => p.remainingQuantity < p.initialQuantity);
    if (minedOre) {
      expect(depleted.length, 'добыча уменьшила пулы').toBeGreaterThan(0);
      expect(loaded.resources[minedOre] ?? 0).toBeCloseTo(planet.resources[minedOre] ?? 0, 6);
    }
  });

  test('5. Исчерпанные пулы (remaining ≤ 0) сериализуются (состояние истощения сохраняется)', () => {
    const state = buildFreshState(4);
    const planet = firstColonizable(state);
    // Исчерпаем первый пул вручную (имитация долгой добычи)
    const pool = planet.orePools[0]!;
    pool.remainingQuantity = 0;
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    const loaded = (restored.galaxy.systems.flatMap(s => s.planets).find(p => p.id === planet.id))!;
    const loadedPool = loaded.orePools.find(p => p.oreId === pool.oreId)!;
    expect(loadedPool).toBeDefined();
    expect(loadedPool.remainingQuantity).toBe(0);
    expect(loadedPool.initialQuantity).toBe(pool.initialQuantity);
  });

  test('6. Словарь: кортежи пишут индексы, decode восстанавливает oreId', () => {
    const state = buildFreshState(4);
    const packed = compactSaveV4({
      galaxy: { systems: (state.galaxy.systems as unknown as Array<Record<string, unknown>>).map((s) => ({ ...s })) },
    } as never) as unknown as Record<string, unknown>;
    const dict = (packed.galaxy as Record<string, unknown>).dict as string[];
    const sys0 = ((packed.galaxy as Record<string, unknown>).systems as Array<Record<string, unknown>>)[0]!;
    const p0 = (sys0.planets as Array<Record<string, unknown>>)[0]!;
    const op = p0.op as Array<Array<unknown>>;
    for (const tuple of op) {
      const idx = tuple[0] as number;
      expect(Number.isInteger(idx)).toBe(true);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(dict.length);
      expect(typeof dict[idx]).toBe('string');
    }
    // Распаковка восстанавливает oreId
    const expanded = expandSaveV4(JSON.parse(JSON.stringify(packed)) as never) as unknown as Record<string, unknown>;
    const exSys0 = ((expanded.galaxy as Record<string, unknown>).systems as Array<Record<string, unknown>>)[0]!;
    const exP0 = (exSys0.planets as Array<Record<string, unknown>>)[0]!;
    const pools = exP0.orePools as Array<Record<string, unknown>>;
    expect(pools.length).toBe(op.length);
    for (let i = 0; i < pools.length; i++) {
      expect(pools[i]!.oreId).toBe(dict[op[i]![0] as number]);
    }
  });

  test('7. R-31/ORE-POOLS: старые форматы (fmt:3 / fmt:2 / без fmt) отклоняются ЯВНОЙ ошибкой', () => {
    for (const [label, raw] of [
      ['fmt:3 (гекс-залежи)', { fmt: 3, galaxy: { systems: [] } }],
      ['fmt:2', { fmt: 2, galaxy: { systems: [] } }],
      ['без fmt', { galaxy: { systems: [] } }],
    ] as const) {
      let message = '';
      try {
        expandSaveV4(raw as never);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message, `${label}: сообщение о несовместимости`).toContain('Несовместимый формат');
      expect(message, `${label}: предложение начать новую игру`).toContain('начните новую игру');
    }
  });

  test('8. Идемпотентность: serialize(deserialize(serialize(s))) === serialize(s)', () => {
    const state = buildFreshState(4);
    const s1 = serializeGameState(state);
    const restored = deserializeGameState(s1);
    const s2 = serializeGameState(restored);
    expect(s2).toBe(s1);
  });

  test('9. Луны: пулы сериализуются и восстанавливаются', () => {
    const state = buildFreshState(6);
    const moonWithHexes = state.galaxy.systems
      .flatMap(s => s.planets).flatMap(p => p.moons)
      .find(m => m.hexes.length > 0);
    expect(moonWithHexes, 'есть луна с гексами').toBeDefined();
    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    const loadedMoon = restored.galaxy.systems
      .flatMap(s => s.planets).flatMap(p => p.moons)
      .find(m => m.id === moonWithHexes!.id)!;
    expect(roundedPools(loadedMoon.orePools)).toEqual(roundedPools(moonWithHexes!.orePools));
  });

  test('10. Размер: свежий сейв 200 систем — пулы компактны (кратно меньше гекс-коробки)', () => {
    const state = buildFreshState(200);
    const json = serializeGameState(state);
    // Пулы: ~30-40 кортежей на тело (вместо десятков кортежей залежей на
    // КАЖДЫЙ гекс гекс-модели); гексы (террейн/здания) пишутся как в v3.
    // Граница: свежий сейв 200 систем < 3 МБ JSON.
    expect(json.length).toBeLessThan(3_000_000);
  });

  test('11. Save → Load → mine: добыча после загрузки уменьшает пулы согласованно', () => {
    const state = buildFreshState(6);
    const planet = firstColonizable(state);
    expect(colonizePlanet(planet)).toBe(true);
    const hexIdx = planet.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
    planet.hexes[hexIdx]!.buildingId = 'mine';
    planet.hexes[hexIdx]!.buildingLevel = 1;
    planet.energyBalance = 1000;

    const json = serializeGameState(state);
    const restored = deserializeGameState(json);
    const loaded = (restored.galaxy.systems.flatMap(s => s.planets).find(p => p.id === planet.id))!;
    const before = loaded.orePools.reduce((s, p) => s + p.remainingQuantity, 0);

    const queues = new Map<EntityId, ProductionQueue>();
    processEconomyTick([loaded], queues);
    const after = loaded.orePools.reduce((s, p) => s + p.remainingQuantity, 0);
    expect(before - after, 'добыча уменьшила суммарный остаток пулов').toBeGreaterThan(0);
    const mined = Object.entries(loaded.resources).filter(([k]) => k.endsWith('-ore'));
    expect(mined.length, 'добытая руда на складе').toBeGreaterThan(0);
    // sum(extracted) ≤ исходного остатка: склад точно равен убыли пулов
    const minedSum = mined.reduce((s, [, v]) => s + (v as number), 0);
    expect(minedSum).toBeCloseTo(before - after, 2); // round3(remaining) в сейве
  });
});
