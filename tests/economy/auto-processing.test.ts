/// <reference types="bun-types" />
/**
 * PROC-WORKSHOPS-01 (Issue #23): авто-режим R-27 через цеха завода
 * строительных материалов — детерминированный планировщик строительного
 * пула заменяет старый processAutoProcessing (вторая исполнительная
 * дорога удалена).
 *
 * Проверяется (docs/40-buildings.md §11.4 v3.0):
 *  A1. Свободный цех завода автоматически берёт базовую руду (Fe → Si →
 *      Al → C → Cu → Ti): smelt_fe завершается через recipe.time тиков,
 *      выход ×0.75 (baseYield), чистота 0.78 (basePurity).
 *  A2. Резервный пол: авто-кандидат не стартует, если входы только до
 *      reserves.minimum (player-задача при этом не блокируется полем).
 *  A3. Приоритет равноприоритетного выбора: Fe → Si → Al → … (первый
 *      runnable кандидат).
 *  A4. Пропускная способность ограничена числом цехов: L1 = 1 партия
 *      за раз; число завершённых партий ≤ вместимость цехов.
 *  A5. Энергогейт: energyBalance < per-tick → авто-партия стоит.
 *  A6. Отсутствующий вход не блокирует готовые задачи (skip кандидата).
 *  A7. Множественные player-заказы одного рецепта исполняются по
 *      отдельности (каждая партия — свои входные ресурсы).
 *  A8. Специалист на заводе получает профильного авто-кандидата.
 *  A9. Авто-режим НЕ работает на processor (продвинутый пул — без
 *      авто-кандидатов; изоляция пулов).
 *
 * Run: bun test tests/economy/auto-processing.test.ts
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import { processEconomyTick, buildOnHex, enqueueProduction } from '@/economy/engine';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { createDefaultWarehouse } from '@/data/warehouse';
import type { Planet, EntityId, ProductionQueue, HexCell, HexTerrain, WorkshopState } from '@/core/types';

// Initialize baked lookups once for all tests (deterministic seed).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

/**
 * Планета с гексами; цеховое здание construction_materials_plant можно
 * поднять через buildPlant(). hexDefs: q/r координаты (геки пустые).
 */
function makePlanet(resources: Record<string, number> = {}): Planet {
  const hexes: HexCell[] = Array.from({ length: 6 }, (_, i) => ({
    coord: { q: i, r: 0 },
    terrain: 'plains' as HexTerrain,
    buildingId: null,
    buildingLevel: 0,
  }));
  // Стартовые стройресурсы (стоимость постройки завода {Fe:8, Si:5, C:3}).
  return {
    id: 'auto-planet' as EntityId,
    systemId: 'sys-1' as EntityId,
    name: 'Auto Workshops Test',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1,
    temperature: 15,
    atmosphere: { type: 'standard', pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes,
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    orePools: [],
    resources: { Fe: 200, Si: 100, C: 100, Ti: 50, U: 10, ...resources },
    warehouse: createDefaultWarehouse(),
    energyBalance: 1000,
    owner: 'player',
  };
}

/**
 * Поднять завод стройматериалов уровня level на гексе hexIndex.
 * withReactor: добавить ядерный реактор (гекс 5) — иначе recalcEnergyBalance
 * в конце каждого тика сбрасывает баланс в минус (потребление завода без
 * генераторов) и все партии встают по энергогейту.
 */
function buildPlant(planet: Planet, hexIndex: number, level: number, withReactor = true): void {
  const ok = buildOnHex(planet, hexIndex, 'construction_materials_plant');
  expect(ok).toBe(true);
  const hex = planet.hexes[hexIndex]!;
  hex.buildingLevel = level;
  const workshops: WorkshopState[] = [];
  for (let i = 0; i < level; i++) workshops.push(hex.workshops?.[i] ?? {});
  hex.workshops = workshops;
  if (withReactor) {
    expect(buildOnHex(planet, 5, 'nuclear_reactor')).toBe(true);
  }
}

const queues = new Map<EntityId, ProductionQueue>();

describe('R-27 авто-режим через цеха завода (PROC-WORKSHOPS-01)', () => {
  beforeEach(() => {
    queues.clear();
  });

  test('A1. Свободный цех автоматически берёт базовую руду: smelt_fe за 5 тиков, ×0.75/0.78', () => {
    const planet = makePlanet({ 'Fe-ore': 100 });
    buildPlant(planet, 0, 1);
    // Энергобаланс положительный; рецепт smelt_fe: Fe-ore 10 → Fe 7 + O 3, time 5.
    const fe0 = planet.resources['Fe'] ?? 0;
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    // Авто-партия завершена: Fe-ore −10, Fe +7×0.75 = +5.25, O +3×0.75.
    expect(planet.resources['Fe-ore']).toBe(90);
    expect((planet.resources['Fe'] ?? 0) - fe0).toBeCloseTo(5.25, 5);
    // Чистота партии = 0.78 (basePurity); складская — средневзвешенная со
    // стартерным запасом (чистота по умолчанию 1.0) → в диапазоне [0.78, 1].
    const purity = planet.resourcePurity?.['Fe'] ?? 0;
    expect(purity).toBeGreaterThanOrEqual(0.78 - 1e-9);
    expect(purity).toBeLessThanOrEqual(1.0 + 1e-9);
  });

  test('A2. Резервный пол: авто-кандидат не стартует на резерве руды', () => {
    // Fe-ore 15, резерв minimum 10 → над полом только 5 < 10 входа партии.
    const planet = makePlanet({ 'Fe-ore': 15 });
    planet.warehouse!.reserves['Fe-ore'] = { resourceId: 'Fe-ore', minimum: 10, priority: 1 };
    buildPlant(planet, 0, 1);
    for (let t = 0; t < 10; t++) processEconomyTick([planet], queues);
    expect(planet.resources['Fe-ore']).toBe(15); // ничего не потрачено
    // player-задача НЕ ограничена полем (raw stock 15 ≥ 10) — стартует.
    const q: ProductionQueue = { planetId: planet.id, items: [] };
    queues.set(planet.id, q);
    expect(enqueueProduction(planet, queues, 'smelt_fe', false)).toBe(true);
    processEconomyTick([planet], queues);
    expect(q.items[0]!.progress).toBeLessThan(q.items[0]!.total);
  });

  test('A3. Приоритет авто-кандидатов: Fe → Si (первый runnable по порядку)', () => {
    const planet = makePlanet({ 'Fe-ore': 50, 'Si-ore': 50 });
    buildPlant(planet, 0, 1);
    const siAfterBuild = planet.resources['Si'] ?? 0;
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    // Первой завершилась партия Fe (приоритет R-27), Si-ore не тронут.
    expect(planet.resources['Fe-ore']).toBe(40);
    expect(planet.resources['Si-ore']).toBe(50);
    expect(planet.resources['Si'] ?? 0).toBe(siAfterBuild); // Si не произведён
  });

  test('A4. Вместимость: L1 — 1 партия за раз; авто-партии ≤ числа цехов', () => {
    const planet = makePlanet({ 'Fe-ore': 100, 'Si-ore': 100 });
    buildPlant(planet, 0, 1);
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    // За 5 тиков могла завершиться только ОДНА партия (1 цех).
    const consumed = (100 - (planet.resources['Fe-ore'] ?? 0)) + (100 - (planet.resources['Si-ore'] ?? 0));
    expect(consumed).toBe(10);
  });

  test('A5. Энергогейт: без энергии авто-партия стоит (входы не списываются)', () => {
    const planet = makePlanet({ 'Fe-ore': 100 });
    buildPlant(planet, 0, 1, /* withReactor */ false); // только потребитель
    // per-tick стоимость smelt_fe = 2/5 = 0.4; статический баланс = −6
    // (recalc каждого тика) → партия не стартует и не движется.
    for (let t = 0; t < 10; t++) processEconomyTick([planet], queues);
    expect(planet.resources['Fe-ore']).toBe(100);
    const feAfterBuild = planet.resources['Fe'] ?? 0;
    expect(planet.resources['Fe'] ?? 0).toBe(feAfterBuild);
  });

  test('A6. Отсутствующий вход пропускает кандидата: нет Fe-ore → берётся Si-ore', () => {
    const planet = makePlanet({ 'Si-ore': 50 });
    buildPlant(planet, 0, 1);
    const siAfterBuild6 = planet.resources['Si'] ?? 0;
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    // Fe-ore нет → первый runnable кандидат = Si (равноприоритетный порядок).
    expect(planet.resources['Si-ore']).toBe(40);
    // smelt_si: Si 4.7 × 0.75 = 3.525.
    expect(planet.resources['Si'] ?? 0).toBeCloseTo(siAfterBuild6 + 4.7 * 0.75, 5);
  });

  test('A7. Множественные заказы одного рецепта — отдельные входные ресурсы', () => {
    const planet = makePlanet({ 'Fe-ore': 40 });
    buildPlant(planet, 0, 2); // 2 цеха
    const q: ProductionQueue = { planetId: planet.id, items: [] };
    queues.set(planet.id, q);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    // Обе player-партии стартуют (2 цеха) и обе завершатся: 2 × 10 руды.
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    expect(planet.resources['Fe-ore']).toBe(20);
    expect(q.items.length).toBe(0); // обе не-repeat задачи удалены
  });

  test('A8. Специалист завода получает профильного авто-кандидата', () => {
    const planet = makePlanet({ 'Fe-ore': 50, 'Si-ore': 50 });
    buildPlant(planet, 0, 2);
    // Цех №2 — специалист smelt_si; цех №1 — обычный.
    planet.hexes[0]!.workshops![1] = { specializationRecipeId: 'smelt_si', specializationLevel: 1 };
    const siAfterBuild8 = planet.resources['Si'] ?? 0;
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    const w2 = planet.hexes[0]!.workshops![1]!;
    // Оба цеха работали: Fe −10 (обычный цех №1), Si −10 (специалист — профиль).
    expect(planet.resources['Fe-ore']).toBe(40);
    expect(planet.resources['Si-ore']).toBe(40);
    // Специалист завершил ПРОФИЛЬНУЮ партию: smelt_si выход Si 4.7 × 1.0
    // (обычный цех дал бы 4.7 × 0.75 = 3.525).
    expect(planet.resources['Si'] ?? 0).toBeCloseTo(siAfterBuild8 + 4.7, 5);
    expect(w2.specializationRecipeId).toBe('smelt_si');
  });

  test('A9. Продвинутый пул (processor) — авто-кандидатов НЕТ (изоляция пулов)', () => {
    const planet = makePlanet({ 'Fe-ore': 100, 'Cr-ore': 100 });
    // Только processor (продвинутый пул): базовых цехов НЕТ.
    buildOnHex(planet, 0, 'processor');
    planet.energyBalance = 1000; // recalc в buildOnHex — вернуть избыток
    const feAfterBuild = planet.resources['Fe'] ?? 0;
    const crAfterBuild = planet.resources['Cr'] ?? 0;
    for (let t = 0; t < 10; t++) processEconomyTick([planet], queues);
    // Базовые руды не перерабатываются (нет завода), Cr-ore не трогается
    // (продвинутый пул без авто-кандидатов).
    expect(planet.resources['Fe-ore']).toBe(100);
    expect(planet.resources['Cr-ore']).toBe(100);
    expect(planet.resources['Fe'] ?? 0).toBe(feAfterBuild);
    expect(planet.resources['Cr'] ?? 0).toBe(crAfterBuild);
  });
});
