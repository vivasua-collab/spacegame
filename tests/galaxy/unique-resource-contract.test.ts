/// <reference types="bun-types" />
/**
 * R-37 (Б3 аудита R-36): физическая концентрация уникального ресурса.
 *
 * Контракт (docs/31 §8.2, R-37): отображаемая концентрация (свод-пул)
 * ВСЕГДА равна доступной добыче:
 *   1. Выбранный уникальный ресурс планеты (1-2 из пула ULTRA_RARE) существует
 *      В ФИЗИКЕ: единственная усиленная залежь его руды (qty 4-6, depth 4-5,
 *      availability 0.03-0.10) на одном не-океанском гексе.
 *   2. Запись пула выбранного элемента = Σ(физика × доля выхода руды) —
 *      добыча буровой не противоречит сводке.
 *   3. Интеграционный тест на РЕАЛЬНОЙ сгенерированной планете: буровая
 *      установка L10 извлекает выбранный уникальный ресурс до исощения;
 *      добытое количество согласовано с свод-пулом.
 *   4. Полностью океанский мир: пул НЕ сообщает о залежах, отсутствующих
 *      в гексах (все записи hexCount=0 — «геологическая оценка»).
 *
 * Run: bun test tests/galaxy/unique-resource-contract.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import {
  assignResourceDeposits,
  aggregateResourceDeposits,
  materializePlanetDeposits,
} from '@/galaxy/generate-resources';
import { Xoshiro128StarStar } from '@/core/prng';
import { setCurrentLookups, getCurrentLookups, findContainedElements } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { BUILDING_MAP } from '@/data/buildings';
import { processEconomyTick, colonizePlanet } from '@/economy/engine';
import type { GameState, Planet, HexCell, EntityId, ProductionQueue } from '@/core/types';

setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));
const lookups = getCurrentLookups();

/** Подпись усиленной залежи (см. deposits.test.ts D3). */
function isBoostedDeposit(elementId: string, d: { quantity: number; availability: number; depth: number }): boolean {
  const m = /^([A-Za-z]+)-ore$/.exec(elementId);
  return m !== null
    && ULTRA_RARE_ELEMENTS.includes(m[1]!)
    && d.quantity >= 4 && d.quantity <= 6
    && d.availability >= 0.03 - 1e-9 && d.availability <= 0.10 + 1e-9
    && d.depth >= 4;
}

function findChosen(planet: Planet): Array<{ hexIndex: number; oreId: string; elementId: string; deposit: Planet['hexes'][number]['deposits'][number] }> {
  const found: ReturnType<typeof findChosen> = [];
  planet.hexes.forEach((hex: HexCell, hexIndex: number) => {
    for (const d of hex.deposits) {
      if (isBoostedDeposit(d.elementId, d)) {
        found.push({ hexIndex, oreId: d.elementId, elementId: d.elementId.replace(/-ore$/, ''), deposit: d });
      }
    }
  });
  return found;
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

describe('R-37 (Б3): уникальный ресурс — отображаемая концентрация = доступная добыча', () => {
  test('1. ИНТЕГРАЦИЯ: реальная планета — буровая L10 извлекает выбранный ресурс до исощения, добыча = сводке', () => {
    const state = buildState(12);
    let planet: Planet | null = null;
    let chosen: ReturnType<typeof findChosen> = [];

    // Ищем колонизируемую планету, где выбранный уникальный ресурс есть,
    // а его гекс свободен после colony_hub (хаб идёт на богатейший гекс —
    // усиленная залежь одна, почти всегда свободен).
    for (const sys of state.galaxy.systems) {
      for (const p of sys.planets) {
        if (p.type === 'gas_giant' || p.owner || p.hexes.length === 0) continue;
        if (!colonizePlanet(p)) continue;
        const c = findChosen(p);
        const free = c.filter(x => p.hexes[x.hexIndex]!.buildingId === null);
        if (free.length > 0) {
          planet = p;
          chosen = c;
          break;
        }
      }
      if (planet) break;
    }
    expect(planet, 'найдена планета с выбранным уникальным ресурсом').not.toBeNull();
    const p = planet!;
    const target = chosen.find(x => p.hexes[x.hexIndex]!.buildingId === null)!;

    // Каталог: буровая без terrainTypes-allowlist → ставится на любую местность
    const def = BUILDING_MAP.get('drilling_rig');
    expect(def).toBeDefined();
    expect(def!.terrainTypes, 'drilling_rig без ограничений местности').toBeUndefined();

    // Ставим буровую L10 (покрывает все minSourceLevel ≤ 8) на гекс залежи
    const hex = p.hexes[target.hexIndex]!;
    hex.buildingId = 'drilling_rig';
    hex.buildingLevel = 10;
    const ore = lookups.oreMap.get(target.oreId)!;
    expect(ore.sourceBuildingId).toBe('drilling_rig');
    expect(ore.minSourceLevel).toBeLessThanOrEqual(10);

    // Начальное состояние залежи и записи пула
    const initialQty = target.deposit.quantity;
    expect(initialQty).toBeGreaterThanOrEqual(4);
    expect(initialQty).toBeLessThanOrEqual(6);
    const contained = findContainedElements(lookups, target.oreId)!;
    const totalYield = contained.reduce((s, ce) => s + ce.yield, 0);
    const fraction = contained.find(ce => ce.elementId === target.elementId)!.yield / totalYield;
    const poolEntryBefore = p.resourceDeposits.find(d => d.elementId === target.elementId)!;
    expect(poolEntryBefore).toBeDefined();
    expect(poolEntryBefore.totalQuantity).toBeGreaterThanOrEqual(initialQty * fraction - 1);
    expect(poolEntryBefore.totalQuantity).toBeLessThanOrEqual(initialQty * fraction + 1);

    // ДОБЫЧА: тики экономики до исощения залежи (энергобаланс ≥ 0 — после
    // колонизации recalcEnergyBalance; страхуемся явным положительным)
    if (p.energyBalance <= 0) p.energyBalance = 1000;
    const queues = new Map<EntityId, ProductionQueue>();
    let extractedAtEnd = 0;
    for (let tick = 0; tick < 20000; tick++) {
      processEconomyTick([p], queues);
      const dep = hex.deposits.find(d => d.elementId === target.oreId);
      if (!dep || dep.quantity <= 0) {
        extractedAtEnd = p.resources[target.oreId] ?? 0;
        break;
      }
    }
    const dep = hex.deposits.find(d => d.elementId === target.oreId);
    expect(dep?.quantity ?? 0, 'залежь исощена буровой').toBeLessThanOrEqual(0);
    // добытая руда = физика залежи (склад без ограничений — warehouse нет)
    expect(extractedAtEnd, 'добыто ровно содержимое залежи').toBeGreaterThanOrEqual(initialQty - 0.5);
    // РЕГРЕССИЯ Б3: сводка не противоречит добыче (пул = физика × доля)
    expect(poolEntryBefore.totalQuantity)
      .toBeGreaterThanOrEqual(extractedAtEnd * fraction - 1);
    expect(poolEntryBefore.totalQuantity)
      .toBeLessThanOrEqual(extractedAtEnd * fraction + 1);
  });

  test('2. Реальная генерация: у колонизируемых планет пул = Σ(физика × доля) по ВСЕМ элементам, без пропусков', () => {
    const state = buildState(10);
    let checked = 0;
    for (const sys of state.galaxy.systems) {
      for (const p of sys.planets) {
        if (p.type === 'gas_giant' || p.hexes.length === 0) continue;
        // ленивая материализация (как при колонизации): физика + пересчёт пула
        if (!materializePlanetDeposits(p)) continue;
        checked++;
        if (checked > 12) break;

        // независимая сумма по ВСЕЙ физике (руды → элементы по долям выхода;
        // разрешение зеркалит aggregateResourceDeposits: руда модели →
        // fallback «<элемент>-ore» (трансурановые Np/Pu/Am) → ID как есть)
        const expected = new Map<string, number>();
        for (const hex of p.hexes) {
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
        // пул = сумма; проверка БЕЗ пропусков (в R-36 выбранный ultra
        // перезаписывался в пуле и выпадал из сверки)
        for (const [elId, expQty] of expected) {
          const entry = p.resourceDeposits.find(d => d.elementId === elId)!;
          expect(entry, `${p.id} ${elId}: запись пула есть`).toBeDefined();
          expect(entry.totalQuantity, `${p.id} ${elId}`).toBeGreaterThanOrEqual(expQty - 1);
          expect(entry.totalQuantity, `${p.id} ${elId}`).toBeLessThanOrEqual(expQty + 1);
        }
        // и обратно: каждая запись пула с hexCount>0 имеет физику
        for (const entry of p.resourceDeposits) {
          if (entry.hexCount === 0) continue;
          expect(expected.has(entry.elementId), `${p.id} ${entry.elementId}: физика есть`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('3. Полностью океанский мир: пул НЕ обещает физику (все hexCount=0), материализация согласована', () => {
    // Синтетический полностью океанский мир (генерация даёт не-океанские
    // гексы всегда — проверяем модель на граничном случае явно).
    const hexes: HexCell[] = Array.from({ length: 19 }, (_, i) => ({
      coord: { q: i % 8, r: Math.floor(i / 8) },
      terrain: 'ocean' as const,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    }));
    const rng = new Xoshiro128StarStar(9).derive('deposits');
    const snapshot = rng.snapshotState();
    assignResourceDeposits(hexes, rng, 'oceanic');
    expect(hexes.every(h => h.deposits.length === 0)).toBe(true);
    const pool = aggregateResourceDeposits(hexes, 'oceanic', rng);
    expect(pool.length).toBe(ELEMENTS.length);
    expect(pool.every(d => d.hexCount === 0), 'пул = чистая оценка').toBe(true);

    // материализация тела (как при колонизации): физика остаётся пустой,
    // пул пересчитан и согласован (никаких «залежей вне гексов»)
    const body = {
      hexes, type: 'oceanic', depositsMaterialized: false,
      depositRngState: [...snapshot],
      resourceDeposits: [{ elementId: 'Ir', totalQuantity: 6, avgAvailability: 0.05, tier: 'ultra_rare' as const, hexCount: 1, maxAvailability: 0.05 }],
    };
    expect(materializePlanetDeposits(body)).toBe(true);
    expect(body.hexes.every(h => h.deposits.length === 0)).toBe(true);
    expect(body.resourceDeposits!.every(d => d.hexCount === 0)).toBe(true);
    expect(body.resourceDeposits!.find(d => d.elementId === 'Ir')!.hexCount).toBe(0);
  });
});
