/// <reference types="bun-types" />
/**
 * ORE-POOLS-RUNTIME-01 (Issue #25): физическая концентрация уникального
 * ресурса (наследник R-37 Б3-контракта «свод = добыча» на пуловой модели).
 *
 * Контракт (docs/31 §8.2, ORE-POOLS-DOCS-01):
 *   1. Выбранный уникальный ресурс планеты (1-2 из пула ULTRA_RARE)
 *      существует В ФИЗИКЕ: единственный усиленный глубинный пул его руды
 *      (qty 4-6, availability 0.03-0.10, источник drilling_rig).
 *   2. Запись свод-превью выбранного элемента = Σ(пул × доля выхода руды) —
 *      добыча буровой не противоречит сводке.
 *   3. Интеграционный тест на РЕАЛЬНОЙ сгенерированной планете: буровая
 *      установка L10 извлекает выбранный уникальный ресурс до исчерпания;
 *      добытое количество согласовано со свод-превью.
 *   4. Полностью океанский мир / ГГ: пулов нет (surfaceScale=0) — свод
 *      состоит из оценочных записей (estimated), физика не обещается.
 *
 * Run: bun test tests/galaxy/unique-resource-contract.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { generatePlanetOrePools, buildResourceSummary } from '@/galaxy/generate-resources';
import { Xoshiro128StarStar } from '@/core/prng';
import { setCurrentLookups, getCurrentLookups, findContainedElements } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { BUILDING_MAP } from '@/data/buildings';
import { processEconomyTick, colonizePlanet } from '@/economy/engine';
import type { GameState, Planet, PlanetOrePool, EntityId, ProductionQueue } from '@/core/types';

setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));
const lookups = getCurrentLookups();

/** Подпись усиленного пула выбранного уникального ресурса (docs/31 §8.2). */
function isBoostedPool(pool: PlanetOrePool): boolean {
  const m = /^([A-Za-z]+)-ore$/.exec(pool.oreId);
  return m !== null
    && ULTRA_RARE_ELEMENTS.includes(m[1]!)
    && pool.initialQuantity >= 4 && pool.initialQuantity <= 6
    && pool.availability >= 0.03 - 1e-9 && pool.availability <= 0.10 + 1e-9;
}

function findChosen(planet: Planet): PlanetOrePool[] {
  return planet.orePools.filter((pool) => isBoostedPool(pool));
}

function buildState(systemCount: number): GameState {
  const galaxy = generateGalaxy({ seed: 42, systemCount });
  return {
    time: { tick: 0, dayInYear: 100, year: 2 },
    speed: 1,
    phase: 'playing',
    galaxy,
    productionQueues: new Map(),
    fleets: [],
    playerFactionId: 'player',
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map(),
    researchState: (require('@/research/engine') as typeof import('@/research/engine')).createDefaultResearchState(),
  };
}

describe('ORE-POOLS (Б3): уникальный ресурс — отображаемая концентрация = доступная добыча', () => {
  test('1. ИНТЕГРАЦИЯ: реальная планета — буровая L10 извлекает выбранный ресурс до исчерпания, добыча = сводке', () => {
    const state = buildState(12);
    let planet: Planet | null = null;
    let chosen: PlanetOrePool[] = [];

    // Ищем колонизируемую планету с выбранным уникальным ресурсом.
    for (const sys of state.galaxy.systems) {
      for (const p of sys.planets) {
        if (p.type === 'gas_giant' || p.owner || p.hexes.length === 0) continue;
        if (!colonizePlanet(p)) continue;
        const c = findChosen(p);
        if (c.length > 0) {
          planet = p;
          chosen = c;
          break;
        }
      }
      if (planet) break;
    }
    expect(planet, 'найдена планета с выбранным уникальным ресурсом').not.toBeNull();
    const p = planet!;
    const target = chosen[0]!;

    // Каталог: буровая без terrainTypes-allowlist → ставится на любую местность
    const def = BUILDING_MAP.get('drilling_rig');
    expect(def).toBeDefined();
    expect(def!.terrainTypes, 'drilling_rig без ограничений местности').toBeUndefined();

    // Ставим буровую L10 (покрывает все minSourceLevel ≤ 8) на любой свободный гекс —
    // ORE-POOLS: положение здания не влияет на доступ к пулу.
    const hexIdx = p.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
    expect(hexIdx, 'есть свободный не-океанский гекс').toBeGreaterThanOrEqual(0);
    p.hexes[hexIdx]!.buildingId = 'drilling_rig';
    p.hexes[hexIdx]!.buildingLevel = 10;
    const ore = lookups.oreMap.get(target.oreId)!;
    expect(ore.sourceBuildingId).toBe('drilling_rig');
    expect(ore.minSourceLevel).toBeLessThanOrEqual(10);

    // Начальное состояние пула и записи свода
    const initialQty = target.remainingQuantity;
    expect(initialQty).toBeGreaterThanOrEqual(4);
    expect(initialQty).toBeLessThanOrEqual(6);
    const contained = findContainedElements(lookups, target.oreId)!;
    const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
    const elementId = contained[0]!.elementId;
    const fraction = contained[0]!.yield / totalYield;
    const summaryBefore = buildResourceSummary(p.orePools, p.type);
    const poolEntryBefore = summaryBefore.find(d => d.elementId === elementId)!;
    expect(poolEntryBefore).toBeDefined();
    expect(poolEntryBefore.totalQuantity).toBeGreaterThanOrEqual(initialQty * fraction - 1);
    expect(poolEntryBefore.totalQuantity).toBeLessThanOrEqual(initialQty * fraction + 1);

    // ДОБЫЧА: тики экономики до исчерпания пула (энергобаланс ≥ 0)
    if (p.energyBalance <= 0) p.energyBalance = 1000;
    const queues = new Map<EntityId, ProductionQueue>();
    let extractedAtEnd = 0;
    for (let tick = 0; tick < 20000; tick++) {
      processEconomyTick([p], queues);
      const pool = p.orePools.find(pp => pp.oreId === target.oreId)!;
      if (pool.remainingQuantity <= 0) {
        extractedAtEnd = p.resources[target.oreId] ?? 0;
        break;
      }
    }
    const pool = p.orePools.find(pp => pp.oreId === target.oreId)!;
    expect(pool.remainingQuantity, 'пул исчерпан буровой').toBeLessThanOrEqual(0);
    // добытая руда = физика пула (склад почти пуст — минимумы/вместимость не мешают)
    expect(extractedAtEnd, 'добыто ровно содержимое пула').toBeGreaterThanOrEqual(initialQty - 0.5);
    // РЕГРЕССИЯ Б3: сводка не противоречит добыче (пул = физика × доля)
    expect(poolEntryBefore.totalQuantity)
      .toBeGreaterThanOrEqual(extractedAtEnd * fraction - 1);
    expect(poolEntryBefore.totalQuantity)
      .toBeLessThanOrEqual(extractedAtEnd * fraction + 1);
  });

  test('2. Реальная генерация: свод-превью = Σ(пулы × доля) по ВСЕМ элементам, без пропусков', () => {
    const state = buildState(10);
    let checked = 0;
    for (const sys of state.galaxy.systems) {
      for (const p of sys.planets) {
        if (p.type === 'gas_giant' || p.hexes.length === 0) continue;
        checked++;
        if (checked > 12) break;

        // Независимая сумма по ВСЕМ пулам (руды → элементы по долям выхода;
        // разрешение зеркалит buildResourceSummary: руда модели →
        // fallback «<элемент>-ore» (трансурановые Np/Pu/Am) → ID как есть)
        const expected = new Map<string, number>();
        for (const pool of p.orePools) {
          const contained = findContainedElements(lookups, pool.oreId) ?? [];
          if (contained.length > 0) {
            const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
            for (const ce of contained) {
              expected.set(ce.elementId, (expected.get(ce.elementId) ?? 0) + pool.remainingQuantity * (ce.yield / totalYield));
            }
          } else {
            const pureId = pool.oreId.replace(/-ore$/, '');
            const id = ELEMENT_MAP.has(pureId) ? pureId : pool.oreId;
            expected.set(id, (expected.get(id) ?? 0) + pool.remainingQuantity);
          }
        }
        // свод = сумма; проверка БЕЗ пропусков
        const summary = buildResourceSummary(p.orePools, p.type);
        for (const [elId, expQty] of expected) {
          const entry = summary.find(d => d.elementId === elId)!;
          expect(entry, `${p.id} ${elId}: запись свода есть`).toBeDefined();
          expect(entry.totalQuantity, `${p.id} ${elId}`).toBeGreaterThanOrEqual(expQty - 1);
          expect(entry.totalQuantity, `${p.id} ${elId}`).toBeLessThanOrEqual(expQty + 1);
          expect(entry.estimated ?? false, `${p.id} ${elId}: физика = не оценка`).toBe(false);
        }
      }
      if (checked > 12) break;
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('3. Полностью океанский мир: surfaceScale=0 → пулов нет, свод = оценки (estimated)', () => {
    // Граничный случай явно: не-океанских гексов 0 → коровых пулов нет
    // (G-07: модель морской добычи отсутствует; docs/31 §8.2).
    const pools = generatePlanetOrePools(new Xoshiro128StarStar(9).derive('ore-pools'), 'oceanic', 0);
    expect(pools).toEqual([]);
    const summary = buildResourceSummary(pools, 'oceanic');
    expect(summary.length).toBe(ELEMENTS.length);
    expect(summary.every(d => d.estimated === true), 'пул = чистая оценка').toBe(true);
    expect(summary.every(d => !('hexCount' in d)), 'полей гекс-модели нет').toBe(true);
  });
});
