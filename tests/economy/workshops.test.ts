/// <reference types="bun-types" />
/**
 * PROC-WORKSHOPS-01 (Issue #23) — ОБЯЗАТЕЛЬНЫЕ тестовые контракты.
 *
 * Соответствие пунктам issue (docs/40-buildings.md §3.0 v3.0):
 *  C1  (п.1-2)  L1/L5/L10 имеют ровно 1/5/10 цехов; upgrade добавляет один
 *               plain-цех; номера/специализации остальных стабильны.
 *  C2  (п.3-4)  Специализация с уровня здания 1; профиль = recipeId; уровень
 *               1–5 по прежней формуле стоимости; снять/сменить/понизить НЕЛЬЗЯ.
 *  C3  (п.7)    2 цеха + 2 заказа → обе партии движутся каждый тик; третья
 *               ждёт; без потери/дублирования.
 *  C4  (п.7)    3 Fe-задания + 1 Fe-специалист + 1 обычный: специалисту —
 *               одна, обычному — одна, одна ждёт.
 *  C5  (п.8)    Специалист без runnable-задачи профиля берёт обычную задачу;
 *               вернувшаяся профильная получает приоритет на следующей
 *               границе партии; начатая партия не прерывается.
 *  C6  (п.9)    FIFO ротация: repeat → хвост; одна задача ≠ два цеха.
 *  C7  (п.7/17) Missing input / энергия / полный склад: входы не списываются,
 *               выход не создаётся, доступные задачи не starvation-ятся.
 *  C8  (п.5,11) Понижение L→L−1 удаляет цех №L; занятый — партия в хвост
 *               FIFO с сохранённым прогрессом; специализированный цех теряет
 *               данные; следующий upgrade — plain-цех.
 *  C9  (п.10)   6 базовых рецептов только construction_materials_plant; пулы
 *               изолированы; нет двойного исполнения (auto-loop удалён).
 *  C10 (п.59)   Несколько заводов: один цех ≤ 1 партии; пропускная
 *               способность ≤ общего числа цехов типа.
 *  C11 (п.24)   R-27 авто-производство через конечные цехи; партии ≤
 *               вместимости; каждый заказ — отдельные входы.
 *  C12 (п.61)   Save/load: сериализация специализаций/уровней/порядка
 *               очередей/repeat/прогресса без потерь и дублей.
 *  C13 (P1-1)   Аудит Issue #23 (2026-10-29): две одинаковые партии, для
 *               которых входов хватает только на одну; входы исчезли к
 *               завершению — проигравшая НЕ удерживает цех, другие задачи
 *               идут, заказ возвращается с прогрессом без потерь/дублей.
 *  C14 (P1-2)   Аудит Issue #23: место под выходы на одну партию из двух
 *               (включая specialist yield); место занято между назначением
 *               и завершением — без выхода сверх вместимости, без удержания
 *               цеха, досдача при появлении места.
 *
 * Run: bun test tests/economy/workshops.test.ts
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import '@/core/immer-setup';
import {
  processEconomyTick,
  buildOnHex,
  upgradeBuilding,
  downgradeBuilding,
  enqueueProduction,
  specializeWorkshop,
  upgradeWorkshopSpecialization,
} from '@/economy/engine';
import {
  collectWorkshops,
  findWorkshopExecutor,
  getRecipeRunability,
} from '@/economy/workshop-scheduler';
import { setCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import {
  createDefaultWarehouse,
  calculateWarehouseCapacities,
  getUsedCapacityByType,
  getReserveDebt,
  ensureReservesForResources,
  canStoreResource,
} from '@/data/warehouse';
import { compactSaveV4, expandSaveV4 } from '@/lib/save-format-v4';
import type {
  Planet,
  EntityId,
  ProductionQueue,
  HexCell,
  HexTerrain,
  WorkshopState,
} from '@/core/types';

setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

// ─── Helpers ────────────────────────────────────────────────────────────

function makePlanet(): Planet {
  const hexes: HexCell[] = Array.from({ length: 8 }, (_, i) => ({
    coord: { q: i, r: 0 },
    terrain: 'plains' as HexTerrain,
    buildingId: null,
    buildingLevel: 0,
  }));
  return {
    id: 'ws-planet' as EntityId,
    systemId: 'sys-1' as EntityId,
    name: 'Workshops Test',
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
    // Стартовые ресурсы: постройки/апгрейды/специализации + реактор +
    // сырьё. Сумма processed-запаса обязана быть < PROCESSED_WAREHOUSE_BASE
    // (3500) — иначе getRecipeRunability даёт no-output-space.
    resources: {
      Fe: 600, Si: 400, C: 300, Ti: 50, U: 20, Cu: 100,
      'Fe-ore': 0, 'Si-ore': 0, 'Al-ore': 0, 'Cr-ore': 0,
    },
    warehouse: createDefaultWarehouse(),
    energyBalance: 10000,
    owner: 'player',
  } as unknown as Planet;
}

/** Поставить цеховое здание уровня level; реактор — источник энергии. */
function buildWorkshopBuilding(
  planet: Planet,
  hexIndex: number,
  buildingId: 'construction_materials_plant' | 'processor',
  level: number,
): void {
  expect(buildOnHex(planet, hexIndex, buildingId)).toBe(true);
  const hex = planet.hexes[hexIndex]!;
  hex.buildingLevel = level;
  const workshops: WorkshopState[] = [];
  for (let i = 0; i < level; i++) workshops.push(hex.workshops?.[i] ?? {});
  hex.workshops = workshops;
  // Реактор (гекс 7): без него recalc даёт отрицательный баланс.
  if (!planet.hexes[7]!.buildingId) {
    expect(buildOnHex(planet, 7, 'nuclear_reactor')).toBe(true);
  }
}

const queues = new Map<EntityId, ProductionQueue>();

function queueOf(planet: Planet): ProductionQueue {
  let q = queues.get(planet.id);
  if (!q) {
    q = { planetId: planet.id, items: [] };
    queues.set(planet.id, q);
  }
  return q;
}

function ws(planet: Planet, hexIndex: number, workshopNumber: number): WorkshopState {
  return planet.hexes[hexIndex]!.workshops![workshopNumber - 1]!;
}

// ─── C1: уровень = число цехов; upgrade добавляет plain-цех ─────────────

describe('C1 — уровень processing-здания = количество цехов', () => {
  beforeEach(() => queues.clear());

  test('L1/L5/L10 → ровно 1/5/10 цехов', () => {
    for (const level of [1, 5, 10]) {
      const planet = makePlanet();
      buildWorkshopBuilding(planet, 0, 'construction_materials_plant', level);
      expect(planet.hexes[0]!.workshops!.length).toBe(level);
      expect(collectWorkshops(planet, 'construction_materials_plant').length).toBe(level);
    }
  });

  test('Upgrade L→L+1 добавляет один plain-цех; существующие цехи стабильны', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    // Цех №1 — специалист; цех №2 — обычный.
    const spec = specializeWorkshop(planet, 0, 1, 'smelt_fe');
    expect(spec.success).toBe(true);

    expect(upgradeBuilding(planet, 0)).toBe(true);
    expect(planet.hexes[0]!.buildingLevel).toBe(3);
    const workshops = planet.hexes[0]!.workshops!;
    expect(workshops.length).toBe(3);
    // Стабильность: цех №1 сохранил специализацию, №2 — обычный, №3 — новый plain.
    expect(workshops[0]!.specializationRecipeId).toBe('smelt_fe');
    expect(workshops[0]!.specializationLevel).toBe(1);
    expect(workshops[1]!.specializationRecipeId).toBeUndefined();
    expect(workshops[2]).toEqual({});
  });
});

// ─── C2: специализация цеха — с L1, по recipeId, необратимая ────────────

describe('C2 — специализация цеха (необратимая)', () => {
  beforeEach(() => queues.clear());

  test('Специализировать можно с уровня здания 1 (L1)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    const result = specializeWorkshop(planet, 0, 1, 'smelt_fe');
    expect(result.success).toBe(true);
    expect(ws(planet, 0, 1).specializationRecipeId).toBe('smelt_fe');
    expect(ws(planet, 0, 1).specializationLevel).toBe(1);
  });

  test('Стоимость specializeCost списывается; при нехватке — cannot-afford', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    const feBefore = planet.resources['Fe']!;
    const result = specializeWorkshop(planet, 0, 1, 'smelt_fe');
    expect(result.success).toBe(true);
    expect(planet.resources['Fe']!).toBe(feBefore - 10); // specializeCost {Fe: 10}

    const planet2 = makePlanet();
    buildWorkshopBuilding(planet2, 0, 'construction_materials_plant', 1);
    planet2.resources['Fe'] = 5; // < 10
    const fail = specializeWorkshop(planet2, 0, 1, 'smelt_fe');
    expect(fail.success).toBe(false);
    expect(fail.reason).toBe('cannot-afford');
  });

  test('Повторная специализация / смена рецепта → отказ (необратимость)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    expect(specializeWorkshop(planet, 0, 1, 'smelt_fe').success).toBe(true);
    const again = specializeWorkshop(planet, 0, 1, 'smelt_fe');
    expect(again.success).toBe(false);
    expect(again.reason).toBe('already-specialized');
    const switchAttempt = specializeWorkshop(planet, 0, 1, 'smelt_si');
    expect(switchAttempt.success).toBe(false);
    expect(switchAttempt.reason).toBe('already-specialized');
  });

  test('Занятый цех специализировать нельзя (workshop-busy)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    planet.resources['Fe-ore'] = 100;
    processEconomyTick([planet], queues); // авто-партия заняла цех
    expect(ws(planet, 0, 1).currentBatch).toBeDefined();
    const result = specializeWorkshop(planet, 0, 1, 'smelt_fe');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('workshop-busy');
  });

  test('Рецепт не из пула здания → recipe-not-in-pool', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    // smelt_cr (хром) — продвинутый пул processor, не строительный.
    const result = specializeWorkshop(planet, 0, 1, 'smelt_cr');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('recipe-not-in-pool');
  });

  test('Уровень специализации 1→5 по формуле стоимости × level; L5 — max-level', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    specializeWorkshop(planet, 0, 1, 'smelt_fe');
    // upgradeSpecializationCost {Fe: 5, Si: 3, Cu: 2} × текущий уровень.
    for (let target = 2; target <= 5; target++) {
      const feBefore = planet.resources['Fe']!;
      const r = upgradeWorkshopSpecialization(planet, 0, 1);
      expect(r.success).toBe(true);
      expect(ws(planet, 0, 1).specializationLevel).toBe(target);
      expect(planet.resources['Fe']!).toBe(feBefore - 5 * (target - 1));
    }
    const max = upgradeWorkshopSpecialization(planet, 0, 1);
    expect(max.success).toBe(false);
    expect(max.reason).toBe('max-level');
  });

  test('Понизить уровень специализации нельзя (API отсутствует — контракт необратимости)', () => {
    // Единственные операции: specializeWorkshop (plain→specialist) и
    // upgradeWorkshopSpecialization (уровень вверх). Отката не существует.
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    specializeWorkshop(planet, 0, 1, 'smelt_fe');
    // Попытка «понизить» через повторную специализацию — уже covered выше.
    expect(ws(planet, 0, 1).specializationLevel).toBe(1);
  });
});

// ─── C3: параллельность партий ──────────────────────────────────────────

describe('C3 — 2 цеха + 2 заказа: обе партии движутся; третья ждёт', () => {
  beforeEach(() => queues.clear());

  test('Обе партии продвигаются за тик; третья ждёт без потери/дублирования', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 100;
    planet.resources['Si-ore'] = 100;
    const q = queueOf(planet);
    expect(enqueueProduction(planet, queues, 'smelt_fe', false)).toBe(true);
    expect(enqueueProduction(planet, queues, 'smelt_si', false)).toBe(true);
    expect(enqueueProduction(planet, queues, 'smelt_al', false)).toBe(true);

    processEconomyTick([planet], queues);
    const fe = q.items.find((i) => i.recipeId === 'smelt_fe')!;
    const si = q.items.find((i) => i.recipeId === 'smelt_si')!;
    const al = q.items.find((i) => i.recipeId === 'smelt_al')!;
    // Две партии стартовали (прогресс < total), третья ждёт (progress == total).
    expect(fe.progress).toBe(4);
    expect(si.progress).toBe(4);
    expect(al.progress).toBe(al.total);
    expect(q.items.length).toBe(3); // ничего не потеряно
  });
});

// ─── C4: специалист-приоритет (3 Fe + специалист + обычный) ─────────────

describe('C4 — приоритет специалиста + общий FIFO', () => {
  beforeEach(() => queues.clear());

  test('3 Fe-задания, 1 Fe-специалист, 1 обычный: специалист+обычный заняты, одна ждёт', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 100;
    // Цех №1 — специалист smelt_fe; цех №2 — обычный.
    expect(specializeWorkshop(planet, 0, 1, 'smelt_fe').success).toBe(true);

    const q = queueOf(planet);
    for (let i = 0; i < 3; i++) enqueueProduction(planet, queues, 'smelt_fe', false);

    processEconomyTick([planet], queues);
    const executing = q.items.filter((it) => findWorkshopExecutor(planet, it.id) !== null);
    expect(executing.length).toBe(2);
    // Специалист (цех №1) взял ПЕРВУЮ Fe-задачу; обычный (цех №2) — вторую.
    const exec1 = findWorkshopExecutor(planet, q.items[0]!.id);
    const exec2 = findWorkshopExecutor(planet, q.items[1]!.id);
    expect(exec1?.workshopNumber).toBe(1);
    expect(exec2?.workshopNumber).toBe(2);
    // Третья — ждёт.
    expect(findWorkshopExecutor(planet, q.items[2]!.id)).toBeNull();

    // После завершения первых партий (тик 5) и освобождения цехов — третья
    // задача стартует на следующей границе (тик 6): специалист свободен →
    // профильная задача по правилу A1.
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    // Обе не-repeat партии (items 0, 1) завершены и удалены; осталась одна.
    expect(q.items.length).toBe(1);
    const execThird = findWorkshopExecutor(planet, q.items[0]!.id);
    expect(execThird).not.toBeNull();
    expect(execThird?.workshopNumber).toBe(1); // специалист взял профильную
  });
});

// ─── C5: fallback специалиста + непрерываемость партии ──────────────────

describe('C5 — специалист не простаивает; приоритет на следующей границе', () => {
  beforeEach(() => queues.clear());

  test('Нет runnable-задачи профиля → специалист берёт обычную задачу', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    // Специалист smelt_fe; Fe-ore НЕТ (задача профиля не-runnable).
    planet.resources['Fe-ore'] = 0;
    planet.resources['Si-ore'] = 100;
    expect(specializeWorkshop(planet, 0, 1, 'smelt_fe').success).toBe(true);

    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_si', false);
    processEconomyTick([planet], queues);
    // Специалист взял Si-задачу (не простаивает; ×0.75 без второго штрафа).
    const exec = findWorkshopExecutor(planet, q.items[0]!.id);
    expect(exec?.workshopNumber).toBe(1);
  });

  test('Начатая партия не прерывается; профильная задача ждёт границы партии', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    planet.resources['Si-ore'] = 100;
    expect(specializeWorkshop(planet, 0, 1, 'smelt_fe').success).toBe(true);

    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_si', false); // не-профиль
    processEconomyTick([planet], queues);
    expect(ws(planet, 0, 1).currentBatch?.recipeId).toBe('smelt_si');
    expect(ws(planet, 0, 1).currentBatch?.progress).toBe(4);

    // Появляется профильная задача СЕРЕДИНА партии — не прерывает её.
    planet.resources['Fe-ore'] = 100;
    enqueueProduction(planet, queues, 'smelt_fe', false);
    processEconomyTick([planet], queues);
    expect(ws(planet, 0, 1).currentBatch?.recipeId).toBe('smelt_si'); // партия жива
    expect(ws(planet, 0, 1).currentBatch?.progress).toBe(3);

    // После завершения Si-партии (тик 5) специалист берёт профильную Fe
    // на следующей границе партии (тик 6).
    for (let t = 0; t < 4; t++) processEconomyTick([planet], queues);
    expect(ws(planet, 0, 1).currentBatch?.recipeId).toBe('smelt_fe');
  });
});

// ─── C6: FIFO ротация + repeat ──────────────────────────────────────────

describe('C6 — FIFO действительно ротируется; repeat → хвост', () => {
  beforeEach(() => queues.clear());

  test('repeat-задача после партии возвращается в ХВОСТ пула', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 1000;
    const q = queueOf(planet);
    const a = enqueueProduction(planet, queues, 'smelt_fe', true);
    const b = enqueueProduction(planet, queues, 'smelt_fe', true);
    expect(a && b).toBe(true);
    const idA = q.items[0]!.id;
    const idB = q.items[1]!.id;

    // Обе стартуют (2 цеха). После завершения обе — в хвост (порядок прежний).
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    expect(q.items.map((i) => i.id)).toEqual([idA, idB]);
    expect(q.items[0]!.progress).toBe(q.items[0]!.total); // сброшены и ждут
    expect(q.items[1]!.progress).toBe(q.items[1]!.total);

    // Один цех: партия A идёт (голова), B ждёт; после A → хвост = [B, A].
    // (queues.clear: обе части используют один planetId 'ws-planet' —
    // изолируем очередь второй части от repeat-остатков первой.)
    queues.clear();
    const planet2 = makePlanet();
    buildWorkshopBuilding(planet2, 0, 'construction_materials_plant', 1);
    planet2.resources['Fe-ore'] = 1000;
    const q2 = queueOf(planet2);
    enqueueProduction(planet2, queues, 'smelt_fe', true);
    enqueueProduction(planet2, queues, 'smelt_fe', true);
    const a2 = q2.items[0]!.id;
    const b2 = q2.items[1]!.id;
    processEconomyTick([planet2], queues);
    const execA2 = findWorkshopExecutor(planet2, a2);
    expect(execA2).not.toBeNull(); // голова исполняется
    expect(findWorkshopExecutor(planet2, b2)).toBeNull();
    for (let t = 0; t < 5; t++) processEconomyTick([planet2], queues);
    // A завершилась и ушла в хвост: теперь [B, A]; B — голова.
    expect(q2.items.map((i) => i.id)).toEqual([b2, a2]);
    expect(q2.items[0]!.progress).toBeLessThan(q2.items[0]!.total); // B началась
  });

  test('Одна задача никогда не исполняется двумя цехами одновременно', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 5);
    planet.resources['Fe-ore'] = 1000;
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', true);
    for (let t = 0; t < 12; t++) {
      processEconomyTick([planet], queues);
      const busy = collectWorkshops(planet, 'construction_materials_plant')
        .filter((r) => r.workshop.currentBatch?.queueItemId === q.items[0]!.id);
      expect(busy.length).toBeLessThanOrEqual(1);
    }
  });
});

// ─── C7: недоступные задачи не списывают и не блокируют ─────────────────

describe('C7 — missing input / энергия / полный склад', () => {
  beforeEach(() => queues.clear());

  test('Нет входов: партия не стартует, входы/выходы не меняются; доступные задачи идут', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 0; // Fe-задача не-runnable
    planet.resources['Si-ore'] = 100;
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', false); // нет руды
    enqueueProduction(planet, queues, 'smelt_si', false); // есть руда

    processEconomyTick([planet], queues);
    const fe = q.items.find((i) => i.recipeId === 'smelt_fe')!;
    const si = q.items.find((i) => i.recipeId === 'smelt_si')!;
    expect(getRecipeRunability(planet, 'smelt_fe')).toBe('no-inputs');
    expect(fe.progress).toBe(fe.total); // ждёт, не занимает цех
    expect(si.progress).toBe(4); // доступная задача НЕ заблокирована
    // Fe не произведён: стартовые 600 − постройка завода 8 − реактор 10.
    expect(planet.resources['Fe'] ?? 0).toBe(600 - 8 - 10);
  });

  test('Нет энергии: партия стоит, входы не списываются', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1, );
    // Убираем реактор (строили без него? — buildWorkshopBuilding ставит);
    // вручную: сносим реактор и обнуляем баланс.
    planet.hexes[7]!.buildingId = null;
    planet.hexes[7]!.buildingLevel = 0;
    planet.energyBalance = 0;
    planet.resources['Fe-ore'] = 100;
    processEconomyTick([planet], queues);
    // Баланс пересчитан в минус → авто-кандидат не стартует.
    expect(planet.resources['Fe-ore']).toBe(100);
  });

  test('Полный склад: canStoreResource гейтит назначение (no-output-space)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1);
    planet.resources['Fe-ore'] = 100;
    // Забиваем processed-склад ВЫШЕ вместимости (база 3500; стартовые уже
    // ~1350 processed → добираем Fe до переполнения).
    planet.resources['Fe'] = 3500;
    const runability = getRecipeRunability(planet, 'smelt_fe');
    expect(runability).toBe('no-output-space');
    processEconomyTick([planet], queues);
    // Входы не списаны (партия не стартовала).
    expect(planet.resources['Fe-ore']).toBe(100);
  });
});

// ─── C8: понижение = удаление цеха №L + ре-очередь ─────────────────────

describe('C8 — понижение уровня: удаление цеха №L и ре-очередь', () => {
  beforeEach(() => queues.clear());

  test('Занятый цех: партия в хвост FIFO с сохранённым прогрессом', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 1000;
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    enqueueProduction(planet, queues, 'smelt_si', false);
    planet.resources['Si-ore'] = 100;
    for (let t = 0; t < 2; t++) processEconomyTick([planet], queues);
    // Обе партии в процессе: Fe (цех 1, progress 3), Si (цех 2, progress 3).
    const feItem = q.items.find((i) => i.recipeId === 'smelt_fe')!;
    expect(ws(planet, 0, 1).currentBatch?.queueItemId).toBe(feItem.id);
    expect(feItem.progress).toBe(3);

    // Понижение: удаляется цех №2 (исполнял Si) — его партия в хвост с прогрессом.
    expect(downgradeBuilding(planet, 'surface', 0, queues)).toBe(true);
    expect(planet.hexes[0]!.workshops!.length).toBe(1);
    expect(ws(planet, 0, 1).currentBatch?.queueItemId).toBe(feItem.id); // цех 1 жив
    // Порядок: Si теперь в хвосте: [Fe(исполняется), Si(ждёт, progress 3)].
    expect(q.items.map((i) => i.recipeId)).toEqual(['smelt_fe', 'smelt_si']);
    expect(q.items[1]!.progress).toBe(3); // прогресс СОХРАНЁН
  });

  test('Специализированный цех №L теряется безвозвратно; новый цех — plain', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    expect(specializeWorkshop(planet, 0, 2, 'smelt_ti').success).toBe(true);
    expect(downgradeBuilding(planet, 'surface', 0, queues)).toBe(true);
    expect(planet.hexes[0]!.workshops!.length).toBe(1);
    // Апгрейд обратно: новый цех №2 — ОБЫЧНЫЙ.
    expect(upgradeBuilding(planet, 0)).toBe(true);
    expect(planet.hexes[0]!.workshops![1]!.specializationRecipeId).toBeUndefined();
    expect(planet.hexes[0]!.workshops![1]!.specializationLevel).toBeUndefined();
  });
});

// ─── C9: изоляция пулов ─────────────────────────────────────────────────

describe('C9 — два независимых пула', () => {
  beforeEach(() => queues.clear());

  test('Базовые рецепты — только завод; processor-задачи не занимают цехи завода (и наоборот)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 1); // 1 цех
    buildWorkshopBuilding(planet, 1, 'processor', 1); // 1 цех
    planet.resources['Fe-ore'] = 100;
    planet.resources['Cr-ore'] = 100;
    const q = queueOf(planet);
    expect(enqueueProduction(planet, queues, 'smelt_cr', false)).toBe(true); // processor-пул
    expect(enqueueProduction(planet, queues, 'smelt_fe', false)).toBe(true); // стройматериалы

    processEconomyTick([planet], queues);
    const cr = q.items.find((i) => i.recipeId === 'smelt_cr')!;
    const fe = q.items.find((i) => i.recipeId === 'smelt_fe')!;
    // Каждый — в цехе СВОЕГО пула (по 1 цеху на пул).
    const crExec = findWorkshopExecutor(planet, cr.id);
    const feExec = findWorkshopExecutor(planet, fe.id);
    expect(crExec?.buildingId).toBe('processor');
    expect(feExec?.buildingId).toBe('construction_materials_plant');
    expect(crExec?.instanceKey).not.toBe(feExec?.instanceKey);
  });

  test('enqueue базового рецепта требует завод (не processor)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'processor', 1); // только processor
    planet.resources['Fe-ore'] = 100;
    // Нет завода → smelt_fe не принимается в очередь.
    expect(enqueueProduction(planet, queues, 'smelt_fe', false)).toBe(false);
  });
});

// ─── C10: несколько заводов — общий пул ─────────────────────────────────

describe('C10 — несколько заводов: общий пул цехов', () => {
  beforeEach(() => queues.clear());

  test('Один цех ≤ 1 партии; пропускная ≤ общего числа цехов', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2); // 2 цеха
    buildWorkshopBuilding(planet, 1, 'construction_materials_plant', 3); // 3 цеха
    planet.resources['Fe-ore'] = 1000;
    const q = queueOf(planet);
    for (let i = 0; i < 7; i++) enqueueProduction(planet, queues, 'smelt_fe', false);

    processEconomyTick([planet], queues);
    const executing = q.items.filter((it) => findWorkshopExecutor(planet, it.id) !== null);
    expect(executing.length).toBe(5); // 2 + 3 цеха, не больше
    // Каждый цех — не более одной партии.
    const all = collectWorkshops(planet, 'construction_materials_plant');
    const busy = all.filter((r) => r.workshop.currentBatch);
    expect(busy.length).toBe(5);
    expect(all.length).toBe(5);
  });
});

// ─── C11: R-27 авто-производство через цехи ─────────────────────────────

describe('C11 — R-27: автоматическое производство подчинено цехам', () => {
  beforeEach(() => queues.clear());

  test('Число завершённых авто-партий ≤ вместимости цехов; входы по отдельности', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    // Руда НАД авто-резервным полом: ensureReservesForResources создаёт
    // резерв minimum=50 после первого тика → даём запас 1000.
    planet.resources['Fe-ore'] = 1000;
    const fe0 = planet.resources['Fe']!;
    for (let t = 0; t < 10; t++) processEconomyTick([planet], queues);
    // 10 тиков / 5 тиков на партию = 2 цикла × 2 цеха = 4 партии ≤ 2 цехам
    // (пропускная способность ограничена вместимостью цехов, не рудой).
    const consumed = 1000 - (planet.resources['Fe-ore'] ?? 0);
    expect(consumed).toBe(40); // ровно 4 партии по 10
    expect((planet.resources['Fe'] ?? 0) - fe0).toBeCloseTo(4 * 7 * 0.75, 3);
  });
});

// ─── C12: сохранение/загрузка нового формата ────────────────────────────

describe('C12 — save/load: цехи, партии, очереди', () => {
  beforeEach(() => queues.clear());

  test('Раундтрип compactSaveV4↔expandSaveV4: специализации/партии/прогресс без потерь', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 3);
    expect(specializeWorkshop(planet, 0, 2, 'smelt_si').success).toBe(true);
    expect(upgradeWorkshopSpecialization(planet, 0, 2).success).toBe(true); // L2
    planet.resources['Fe-ore'] = 100;
    planet.resources['Si-ore'] = 100;
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', true); // repeat!
    enqueueProduction(planet, queues, 'smelt_ti', false);
    planet.resources['Ti-ore'] = 100;
    for (let t = 0; t < 2; t++) processEconomyTick([planet], queues);

    // Снимок ДО.
    const hex = planet.hexes[0]!;
    const before = {
      workshops: JSON.parse(JSON.stringify(hex.workshops)),
      queue: JSON.parse(JSON.stringify(q.items)),
    };
    expect(before.workshops[1].specializationRecipeId).toBe('smelt_si');
    expect(before.workshops[1].specializationLevel).toBe(2);
    const running = before.workshops.filter((w: WorkshopState) => w.currentBatch).length;
    expect(running).toBeGreaterThan(0);

    // Раундтрип через компактный формат сейва (как serializeGameState).
    const payload = {
      galaxy: { systems: [{ planets: [planet] }] },
      productionQueues: Array.from(queues.entries()),
    };
    const packed = compactSaveV4(payload as never) as unknown as Record<string, unknown>;
    const unpacked = expandSaveV4(JSON.parse(JSON.stringify(packed))) as never as typeof payload;
    const loadedPlanet = (unpacked.galaxy.systems[0].planets[0]) as Planet;
    const loadedQueue = new Map(unpacked.productionQueues as [string, ProductionQueue][]);

    // Цехи: специализация/уровень/партии восстановлены.
    const lws = loadedPlanet.hexes[0]!.workshops!;
    expect(lws.length).toBe(3);
    expect(lws[1]!.specializationRecipeId).toBe('smelt_si');
    expect(lws[1]!.specializationLevel).toBe(2);
    for (let i = 0; i < 3; i++) {
      expect(lws[i]!.currentBatch ?? null).toEqual(before.workshops[i].currentBatch ?? null);
    }
    // Очередь: порядок/repeat/прогресс без дублей и потерь.
    const lq = loadedQueue.get(planet.id)!;
    expect(lq.items.length).toBe(before.queue.length);
    lq.items.forEach((item, i) => {
      expect(item.id).toBe(before.queue[i].id);
      expect(item.recipeId).toBe(before.queue[i].recipeId);
      expect(item.repeat).toBe(before.queue[i].repeat);
      expect(item.progress).toBe(before.queue[i].progress);
      expect(item.total).toBe(before.queue[i].total);
    });

    // Загруженное состояние продолжает работать (тик жив после раундтрипа).
    processEconomyTick([loadedPlanet], loadedQueue);
    expect(collectWorkshops(loadedPlanet, 'construction_materials_plant').length).toBe(3);
  });
});

// ─── C13: P1-1 — конкурентные партии не захватывают входы друг друга ───

describe('C13 — P1-1 (аудит): входы на одну партию из двух', () => {
  beforeEach(() => queues.clear());

  test('Два заказа smelt_fe при Fe-ore=10: назначается ОДНА партия (не две и не авто)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 10; // ровно на ОДНУ партию (10 ед.)
    const q = queueOf(planet);
    expect(enqueueProduction(planet, queues, 'smelt_fe', false)).toBe(true);
    expect(enqueueProduction(planet, queues, 'smelt_fe', false)).toBe(true);

    processEconomyTick([planet], queues);
    // Ровно один цех занят: второй заказ И авто-кандидат не стартуют —
    // входов на одну партию (до фикса независимо прошли бы гейт «на двоих»).
    const busy = collectWorkshops(planet, 'construction_materials_plant')
      .filter((r) => r.workshop.currentBatch);
    expect(busy.length).toBe(1);
    const executing = q.items.filter((it) => findWorkshopExecutor(planet, it.id) !== null);
    expect(executing.length).toBe(1);
    const waiting = q.items.find((it) => findWorkshopExecutor(planet, it.id) === null)!;
    expect(waiting.progress).toBe(waiting.total); // ждёт, не занимая цех
    expect(planet.resources['Fe-ore']).toBe(10); // не списано до завершения

    // Доходим партию до конца: входы не уходят в минус ни на одном тике.
    for (let t = 0; t < 4; t++) {
      processEconomyTick([planet], queues);
      expect((planet.resources['Fe-ore'] ?? 0)).toBeGreaterThanOrEqual(0);
    }
    // Тик 5: первая партия рассчиталась — входы списаны, выходы начислены.
    const fe0 = 600 - 8 - 10; // стартовые 600 − завод 8 − реактор 10
    expect(planet.resources['Fe-ore'] ?? 0).toBe(0);
    expect(planet.resources['Fe']!).toBeCloseTo(fe0 + 7 * 0.75, 3);
    expect((planet.resources['O'] ?? 0)).toBeCloseTo(3 * 0.75, 3);
    expect(q.items.length).toBe(1); // второй заказ цел (не потерян, не дублирован)

    // Руда появилась снова → ожидавший заказ досдаётся теми же правилами.
    planet.resources['Fe-ore'] = 10;
    for (let t = 0; t < 5; t++) processEconomyTick([planet], queues);
    expect(q.items.length).toBe(0);
    expect(planet.resources['Fe-ore'] ?? 0).toBe(0); // ровно два расчёта, без дублей
    expect(planet.resources['Fe']!).toBeCloseTo(fe0 + 2 * 7 * 0.75, 3);
    expect((planet.resources['O'] ?? 0)).toBeCloseTo(2 * 3 * 0.75, 3);
  });

  test('Входы исчезли к завершению: цех освобождается, заказ в очереди с прогрессом, другие идут', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    planet.resources['Fe-ore'] = 20; // на ДВЕ партии
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    processEconomyTick([planet], queues);
    // Обе назначены (входов достаточно на обе — бронь честно делится).
    expect(collectWorkshops(planet, 'construction_materials_plant')
      .filter((r) => r.workshop.currentBatch).length).toBe(2);

    // Середина партии: внешний потребитель забирает 10 руды (гонка P1-1).
    processEconomyTick([planet], queues); // тик 2 (progress 3)
    planet.resources['Fe-ore'] = (planet.resources['Fe-ore'] ?? 0) - 10;
    for (let t = 0; t < 3; t++) processEconomyTick([planet], queues); // тики 3–5

    // Тик 5: первая партия рассчиталась; вторая — НЕ удерживает цех (до
    // фикса висела бы на цехе №2 с progress=0 навсегда, starvation остальных).
    const feLeft = q.items.filter((i) => i.recipeId === 'smelt_fe');
    expect(feLeft.length).toBe(1); // первая удалена, вторая цела
    expect(feLeft[0]!.progress).toBe(0); // прогресс сохранён: работа сделана
    expect(ws(planet, 0, 1).currentBatch).toBeUndefined();
    expect(ws(planet, 0, 2).currentBatch).toBeUndefined(); // ← до фикса цех №2 занят
    expect((planet.resources['Fe-ore'] ?? 0)).toBeGreaterThanOrEqual(0); // без отрицательных
    const fe0 = 600 - 8 - 10;
    expect(planet.resources['Fe']!).toBeCloseTo(fe0 + 7 * 0.75, 3); // ровно ОДИН расчёт
    expect((planet.resources['O'] ?? 0)).toBeCloseTo(3 * 0.75, 3);

    // Доступная задача другого профиля идёт, пока Fe-заказ ждёт входов.
    planet.resources['Si-ore'] = 100;
    enqueueProduction(planet, queues, 'smelt_si', false);
    processEconomyTick([planet], queues);
    const si = q.items.find((i) => i.recipeId === 'smelt_si')!;
    expect(findWorkshopExecutor(planet, si.id)).not.toBeNull(); // не starved
    expect(findWorkshopExecutor(planet, feLeft[0]!.id)).toBeNull(); // ждёт в очереди

    // Входы вернулись → ожидавший заказ досдаётся (бронь не «протекла»).
    planet.resources['Fe-ore'] = 10;
    for (let t = 0; t < 6; t++) processEconomyTick([planet], queues);
    expect(q.items.filter((i) => i.recipeId === 'smelt_fe').length).toBe(0);
    expect((planet.resources['Fe-ore'] ?? 0)).toBe(0); // ровно два расчёта, без дублей
    // Fe производится только smelt_fe (smelt_si даёт Si/O) — точный счёт по Fe:
    expect(planet.resources['Fe']!).toBeCloseTo(fe0 + 2 * 7 * 0.75, 3);
    // (глобальный O не утверждаем: сюда же legitimately идут партии smelt_si)
  });
});

// ─── C14: P1-2 — место под выходы резервируется партиями ─────────────

describe('C14 — P1-2 (аудит): место под выходы на одну партию из двух', () => {
  beforeEach(() => queues.clear());

  /**
   * Точно выставить доступное место processed-склада (с точки зрения O):
   * доливаем Fe так, чтобы canStoreResource(planet,'O',∞) === target.
   * Резервы создаём заранее (как после первого тика) — долг учитывается.
   * O сеем ≥ 50: иначе после первого же депозита O ensure создаёт резерв
   * с минимумом 50, его «долг» выедает место в Fe-проверках и меняет причину
   * ожидания — тесты должны гейтиться именно МЕСТОМ, а не резервом O.
   */
  function tuneProcessedSpace(planet: Planet, target: number): void {
    if ((planet.resources['O'] ?? 0) < 60) planet.resources['O'] = 60;
    ensureReservesForResources(planet);
    const caps = calculateWarehouseCapacities(planet);
    const used = getUsedCapacityByType(planet, 'processed');
    const debt = getReserveDebt(planet, 'processed', 'O');
    const add = caps.processed - debt - target - used;
    expect(add).toBeGreaterThan(0); // в этих тестах всегда доливаем, не сливаем
    planet.resources['Fe'] = (planet.resources['Fe'] ?? 0) + add;
    expect(canStoreResource(planet, 'O', 1e9)).toBeCloseTo(target, 6);
  }

  test('Специалист L5 + обычный, два заказа: место есть только на ОДНУ (по факту, с yieldMult)', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    // Цех №1 — специалист smelt_fe L5: yieldMult = 1.08 → выход 7×1.08+3×1.08 = 10.8.
    expect(specializeWorkshop(planet, 0, 1, 'smelt_fe').success).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(upgradeWorkshopSpecialization(planet, 0, 1).success).toBe(true);
    }
    expect(ws(planet, 0, 1).specializationLevel).toBe(5);

    // Окно 12: специалист 10.8 ≤ 12 ✓; 10.8 + обычная 7.5 = 18.3 > 12 ✗;
    // даже две обычных 15 > 12 ✗. Место гейтит именно НАЗНАЧЕНИЕ.
    tuneProcessedSpace(planet, 12);
    planet.resources['Fe-ore'] = 1000; // входов достаточно — гейтит только место
    const feBase = planet.resources['Fe']!;
    const oBase = planet.resources['O'] ?? 0; // сеяно tuneProcessedSpace (≥ 50)
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    enqueueProduction(planet, queues, 'smelt_fe', false);

    processEconomyTick([planet], queues);
    // До фикса обе партии + авто прошли бы гейт независимо и вместе превысили
    // вместимость; сейчас назначается ровно одна (специалист — A1).
    const busy = collectWorkshops(planet, 'construction_materials_plant')
      .filter((r) => r.workshop.currentBatch);
    expect(busy.length).toBe(1);
    const exec1 = findWorkshopExecutor(planet, q.items[0]!.id);
    expect(exec1?.workshopNumber).toBe(1); // профильная задача — специалисту
    expect(findWorkshopExecutor(planet, q.items[1]!.id)).toBeNull(); // ждёт

    // Склад не переполняется ни на одном тике (до фикса — выход сверх вместимости).
    for (let t = 0; t < 4; t++) {
      processEconomyTick([planet], queues);
      expect(getUsedCapacityByType(planet, 'processed')).toBeLessThanOrEqual(
        calculateWarehouseCapacities(planet).processed + 1e-9,
      );
    }
    // Тик 5: партия специалиста рассчиталась по формулам §3.0.2 (1.08).
    expect(planet.resources['Fe']!).toBeCloseTo(feBase + 7 * 1.08, 3);
    expect((planet.resources['O'] ?? 0)).toBeCloseTo(oBase + 3 * 1.08, 3);
    expect((planet.resources['Fe-ore'] ?? 0)).toBe(1000 - 10); // ровно ОДНА партия
    expect(q.items.length).toBe(1); // вторая всё ещё ждёт (места 12−10.8=1.2 < 7.5)
    expect(getUsedCapacityByType(planet, 'processed')).toBeLessThanOrEqual(
      calculateWarehouseCapacities(planet).processed + 1e-9,
    );
  });

  test('Место занято между назначением и завершением: без выхода сверх вместимости, досдача позже', () => {
    const planet = makePlanet();
    buildWorkshopBuilding(planet, 0, 'construction_materials_plant', 2);
    // Место ровно на две обычных партии: 7.5 + 7.5 = 15 (назначаются ОБЕ).
    tuneProcessedSpace(planet, 15);
    planet.resources['Fe-ore'] = 1000;
    const feBase = planet.resources['Fe']!;
    const oBase = planet.resources['O'] ?? 0; // сеяно tuneProcessedSpace (≥ 50)
    const q = queueOf(planet);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    enqueueProduction(planet, queues, 'smelt_fe', false);
    processEconomyTick([planet], queues);
    expect(collectWorkshops(planet, 'construction_materials_plant')
      .filter((r) => r.workshop.currentBatch).length).toBe(2);

    // Середина партии: внешняя доставка занимает 6 места processed-склада.
    processEconomyTick([planet], queues); // тик 2
    planet.resources['Si'] = (planet.resources['Si'] ?? 0) + 6; // Si — processed-тип
    for (let t = 0; t < 3; t++) {
      processEconomyTick([planet], queues); // тики 3–5
      // НИКОГДА не выше вместимости (до фикса обе партии добавляли выход
      // без проверки — склад уходил в плюс).
      expect(getUsedCapacityByType(planet, 'processed')).toBeLessThanOrEqual(
        calculateWarehouseCapacities(planet).processed + 1e-9,
      );
    }

    // Тик 5: первая рассчиталась (5.25 Fe + 2.25 O); вторая — места хватило
    // только одной: цех освобождён, заказ в очереди с progress=0.
    const feLeft = q.items.filter((i) => i.recipeId === 'smelt_fe');
    expect(feLeft.length).toBe(1);
    expect(feLeft[0]!.progress).toBe(0);
    expect(ws(planet, 0, 1).currentBatch).toBeUndefined();
    expect(ws(planet, 0, 2).currentBatch).toBeUndefined(); // ← до фикса цех №2 занят
    expect(planet.resources['Fe']!).toBeCloseTo(feBase + 7 * 0.75, 3); // ровно ОДИН расчёт
    expect((planet.resources['O'] ?? 0)).toBeCloseTo(oBase + 3 * 0.75, 3);
    expect((planet.resources['Fe-ore'] ?? 0)).toBe(1000 - 10);

    // Место освободилось → ожидавший заказ досдаётся в тот же тик.
    planet.resources['Si'] = (planet.resources['Si'] ?? 0) - 6;
    processEconomyTick([planet], queues);
    expect(q.items.filter((i) => i.recipeId === 'smelt_fe').length).toBe(0);
    expect(planet.resources['Fe']!).toBeCloseTo(feBase + 2 * 7 * 0.75, 3); // ровно ДВЕ, без дублей
    expect((planet.resources['O'] ?? 0)).toBeCloseTo(oBase + 2 * 3 * 0.75, 3);
    expect((planet.resources['Fe-ore'] ?? 0)).toBe(1000 - 20);
    expect(getUsedCapacityByType(planet, 'processed')).toBeLessThanOrEqual(
      calculateWarehouseCapacities(planet).processed + 1e-9,
    );
  });
});
