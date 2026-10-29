/// <reference types="bun-types" />
/**
 * ORE-POOLS (Issue #25; наследник R-37 Б1): порядок инициализации lookups
 * при загрузке сейва.
 *
 * Контракт: deserializeGameState обязан установить baked-model ИМЕННО
 * загружаемой галактики (setCurrentLookups) ДО пересборки свод-превью из
 * пулов и ДО возврата состояния — любая последующая работа с ресурсами
 * (свод UI, добыча) видит модель этой галактики.
 *
 * ORE-POOLS v4: гекс-материализация удалена — на загрузке единственная
 * работа с ресурсами — пересборка свод-превью из планетарных пулов
 * (buildResourceSummary — она требует lookups загружаемой галактики).
 * Старые сейвы (fmt≠4) отклоняются ДО установки lookups (docs/31 §12).
 *
 * Хим.модель запечки seed-НЕзависима, поэтому порядок проверяется ССЫЛКАМИ
 * (какой record модели установлен) и работоспособностью полного цикла
 * «загрузка → колонизация → добыча из пулов».
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
    // ХОЛОДНЫЙ процесс: ни новой игры, ни загрузки (lookups = null).
    const json = serializeGameState(buildFreshState(42, 10));

    resetCurrentLookups();
    expect(hasCurrentLookups()).toBe(false);
    // Загрузка НЕ требует предварительных lookups: свод-превью пересобирается
    // ПОСЛЕ setCurrentLookups (порядок Б1 сохранён в v4).
    let restored: GameState | undefined;
    expect(() => { restored = deserializeGameState(json); }).not.toThrow();
    restored = deserializeGameState(json);

    // lookups установлены из модели ИМЕННО загруженной галактики
    // (ссылочное равенство: buildLookups возвращает record самой модели).
    expect(hasCurrentLookups()).toBe(true);
    expect(getCurrentLookups().elementToOre)
      .toBe(buildLookups(restored.galaxy.bakedModel).elementToOre);

    // свод-превью пересобран из пулов (не сериализован)
    const planet = firstColonizable(restored);
    expect(planet.orePools.length).toBeGreaterThan(0);
    expect(planet.resourceDeposits.length).toBeGreaterThan(0);

    // полный цикл работает: колонизация активирует пулы (без материализации
    // гексов — ORE-POOLS), добыча из пулов доступна сразу
    expect(colonizePlanet(planet)).toBe(true);
    expect(planet.orePools.length).toBeGreaterThan(0);
    expect(planet.hexes.some(h => 'deposits' in h && Array.isArray((h as unknown as Record<string, unknown>).deposits))).toBe(false);
  });

  test('2. Кросс-галактика: загрузка сейва B после активной игры A — lookups переключаются на B', () => {
    // Активная игра A (seed 100): lookups = модель A.
    const jsonA = serializeGameState(buildFreshState(100, 8));
    deserializeGameState(jsonA);
    const lookupsA = getCurrentLookups().elementToOre;

    // Сейв галактики B (seed 200).
    const jsonB = serializeGameState(buildFreshState(200, 8));
    const restoredB = deserializeGameState(jsonB);

    // lookups = модель ИМЕННО B (ссылка на record модели B из сейва),
    // НЕ прежняя модель A.
    expect(getCurrentLookups().elementToOre)
      .toBe(buildLookups(restoredB.galaxy.bakedModel).elementToOre);
    expect(getCurrentLookups().elementToOre).not.toBe(lookupsA);

    // колонизация тела B: пулы совпадают с эталоном прямой генерации B
    // (бит-в-бит — пулы в сейве, повторной генерации/накидки нет)
    const planetB = firstColonizable(restoredB);
    const truthRef = buildFreshState(200, 8);
    const truthPlanet = truthRef.galaxy.systems
      .flatMap(s => s.planets).find(p => p.id === planetB.id)!;
    expect(colonizePlanet(planetB)).toBe(true);
    // сравнение по точности сейва (round3 на remaining/availability при encode)
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    const norm = (pools: Planet['orePools']) =>
      pools.map((p) => ({ ...p, remainingQuantity: r3(p.remainingQuantity), availability: r3(p.availability) }));
    expect(norm(planetB.orePools)).toEqual(norm(truthPlanet.orePools));
  });

  test('3. Отклонённый сейв (битый формат) НЕ затирает lookups активной игры', () => {
    // Порядок ORE-POOLS: формат-валидация (fmt≠4 — docs/31 §12) ДО установки
    // lookups — отклонённый сейв не должен оставить процесс с моделью
    // НЕзагруженной галактики.
    const jsonA = serializeGameState(buildFreshState(42, 8));
    deserializeGameState(jsonA);
    const lookupsA = getCurrentLookups().elementToOre;

    expect(() => deserializeGameState('{"fmt":3,"galaxy":{}}')).toThrow('Несовместимый формат');
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
