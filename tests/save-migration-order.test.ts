/// <reference types="bun-types" />
/**
 * R-37 (Б1 аудита R-36): порядок инициализации lookups при загрузке сейва.
 *
 * Контракт: deserializeGameState обязан установить baked-model ИМЕННО
 * загружаемой галактики (setCurrentLookups) ДО возврата состояния — любая
 * последующая работа с залежами (материализация при колонизации, добыча)
 * видит модель этой галактики.
 *
 * Дефект R-36 (исправлен): загрузочная миграция залежей шла ДО установки
 * lookups:
 *   - холодный старт (процесс без активной игры) → getCurrentLookups()
 *     бросал «BakedLookups не инициализированы» — загрузка старого v3-сейва
 *     крашилась;
 *   - загрузка после активной игры → материализация шла с моделью
 *     ПРЕДЫДУЩЕЙ галактики.
 *
 * Хим.модель запечки seed-НЕзависима (проверено: ores/elements/elementToOre
 * идентичны для разных seed), поэтому «чужая модель» проявлялась как краш
 * и рассинхрон ссылок, а не порча данных. Тесты проверяют ССЫЛКИ (какой
 * именно record модели установлен) и работоспособность полного цикла
 * «загрузка → колонизация (материализация)».
 *
 * Run: bun test tests/save-migration-order.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import {
  resetCurrentLookups,
  hasCurrentLookups,
  getCurrentLookups,
  setCurrentLookups,
  buildLookups,
} from '@/data/baked-lookups';
import { colonizePlanet } from '@/economy/engine';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState, Planet } from '@/core/types';

function buildFreshState(seed: number, systemCount: number): GameState {
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

/** Сейв «до R-37»: поле dv отсутствует у всех тел (v3-кодек трактует как версию 1). */
function stripDv(json: string): string {
  const raw = JSON.parse(json) as {
    galaxy: { systems: Array<{ planets: Array<Record<string, unknown>> }> };
  };
  for (const sys of raw.galaxy.systems) {
    for (const p of sys.planets) {
      delete p.dv;
      for (const m of (p.moons as Array<Record<string, unknown>> | undefined) ?? []) delete m.dv;
    }
  }
  return JSON.stringify(raw);
}

function firstColonizable(state: GameState): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p;
    }
  }
  throw new Error('нет колонизируемых планет');
}

describe('R-37 (Б1): lookups при загрузке — модель загружаемой галактики', () => {
  test('1. Холодный старт: загрузка старого v3-сейва без активной игры — без краша, lookups установлены, колонизация работает', () => {
    // Имитируем старый сейв (до R-37: без dv) и ХОЛОДНЫЙ процесс:
    // ни новой игры, ни загрузки до этого момента (lookups = null).
    const json = stripDv(serializeGameState(buildFreshState(42, 10)));

    resetCurrentLookups();
    expect(hasCurrentLookups()).toBe(false);
    // Раньше (R-36): deserializeGameState → миграция залежей → getCurrentLookups()
    // → throw «BakedLookups не инициализированы» — загрузка была невозможна.
    let restored: GameState;
    expect(() => { restored = deserializeGameState(json); }).not.toThrow();
    restored = deserializeGameState(json);

    // lookups установлены из модели ИМЕННО загруженной галактики
    // (ссылочное равенство: buildLookups возвращает record самой модели).
    expect(hasCurrentLookups()).toBe(true);
    expect(getCurrentLookups().elementToOre)
      .toBe(buildLookups(restored.galaxy.bakedModel).elementToOre);

    // тела остались ленивыми (Б2: загрузка не материализует)
    const planet = firstColonizable(restored);
    expect(planet.depositsMaterialized).toBe(false);

    // полный цикл работает: колонизация = версионная материализация
    // (раньше упала бы внутри getCurrentLookups / шла бы без модели)
    expect(colonizePlanet(planet)).toBe(true);
    expect(planet.depositsMaterialized).toBe(true);
    expect(planet.hexes.some(h => h.deposits.length > 0)).toBe(true);
  });

  test('2. Кросс-галактика: загрузка сейва B после активной игры A — lookups переключаются на B', () => {
    // Активная игра A (seed 100): lookups = модель A.
    const jsonA = serializeGameState(buildFreshState(100, 8));
    deserializeGameState(jsonA);
    const lookupsA = getCurrentLookups().elementToOre;

    // Старый сейв галактики B (seed 200, без dv).
    const jsonB = stripDv(serializeGameState(buildFreshState(200, 8)));
    const restoredB = deserializeGameState(jsonB);

    // lookups = модель ИМЕННО B (ссылка на record модели B из сейва),
    // НЕ прежняя модель A.
    expect(getCurrentLookups().elementToOre)
      .toBe(buildLookups(restoredB.galaxy.bakedModel).elementToOre);
    expect(getCurrentLookups().elementToOre).not.toBe(lookupsA);

    // колонизация тела B: материалзиация с корректной моделью — залежи
    // совпадают с эталоном прямой генерации B (бит-в-бит)
    const planetB = firstColonizable(restoredB);
    const truthRef = buildFreshState(200, 8);
    const truthPlanet = truthRef.galaxy.systems
      .flatMap(s => s.planets).find(p => p.id === planetB.id)!;
    expect(colonizePlanet(truthPlanet)).toBe(true);
    expect(colonizePlanet(planetB)).toBe(true);
    expect(planetB.hexes.length).toBe(truthPlanet.hexes.length);
    for (let i = 0; i < truthPlanet.hexes.length; i++) {
      expect(planetB.hexes[i]!.deposits).toEqual(truthPlanet.hexes[i]!.deposits);
    }
  });

  test('3. Отклонённый сейв (битый формат) НЕ затирает lookups активной игры', () => {
    // Порядок R-37: zod/формат-валидация ДО установки lookups — отклонённый
    // сейв не должен оставить процесс с моделью НЕзагруженной галактики.
    const jsonA = serializeGameState(buildFreshState(42, 8));
    deserializeGameState(jsonA);
    const lookupsA = getCurrentLookups().elementToOre;

    expect(() => deserializeGameState('{"fmt":2,"galaxy":{}}')).toThrow('Неподдерживаемый формат');
    expect(getCurrentLookups().elementToOre).toBe(lookupsA); // модель A не тронута
  });

  test('4. Явная установка модели (setCurrentLookups) остаётся точкой входа newGame', () => {
    // санити: reset → setCurrentLookups → hasCurrentLookups
    resetCurrentLookups();
    expect(hasCurrentLookups()).toBe(false);
    setCurrentLookups(buildFreshState(7, 5).galaxy.bakedModel);
    expect(hasCurrentLookups()).toBe(true);
  });
});
