/// <reference types="bun-types" />
/**
 * R-40 (GitHub Issue #4): закрытие оставшихся расхождений этапа 2 с
 * docs/40-buildings.md §2.4 — ЗАДАНИЕ владельца (аудит R-39).
 *
 * Две спецификационные нормы, реализованные в R-40:
 *
 *   1. Технологический гейт «Глубокое бурение» (deep_drilling): буровая
 *      установка (drilling_rig) доступна только после исследования.
 *      Единый механизм requiresTechs: engine.buildOnHex/upgradeBuilding +
 *      UI (фильтр списка постройки + гейт апгрейда). Существующие здания
 *      старых сейвов при загрузке НЕ удаляются и работают; гейт контролирует
 *      НОВЫЕ действия (постройка нового здания, апгрейд существующего).
 *
 *   2. Бонус геологической активности планеты: множитель добычи буровой
 *      по ТИПУ планеты (Planet.type — канонический enum, НЕ террейн гекса):
 *        вулканическая ×1.5, скалистая ×1.0, океаническая ×0.8,
 *        пустынная ×1.1, ледяная ×0.6.
 *      Применяется РОВНО ОДИН РАЗ в формуле добычи: НЕ удваивает
 *      terrainMult каталога (mountains ×1.3 / volcano ×1.2) и синергию
 *      mining_cluster.
 *
 * Разделы:
 *   G1–G10 — геологические коэффициенты (5 типов спеки + dwarf вне спеки,
 *            отсутствие двойного применения, истощение, синергия);
 *   T1–T9  — тех-гейт (движок, полный конвейер store→mediator→модуль,
 *            UI/engine-согласованность, старый сейв, каталог/unlocks).
 *
 * Run: bun test tests/r40-stage2-spec-compliance.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { produce } from 'immer';
import { processEconomyTick, buildOnHex, upgradeBuilding, colonizePlanet } from '@/economy/engine';
import { GEOLOGICAL_ACTIVITY_BONUS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { BUILDING_MAP, areBuildingTechsMet } from '@/data/buildings';
import { TECH_MAP, TECH_TREE, TECH_UNLOCKS, STARTER_TECH_IDS } from '@/data/research';
import { setCurrentLookups, getCurrentLookups } from '@/data/baked-lookups';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { createDefaultWarehouse } from '@/data/warehouse';
import { generateGalaxy } from '@/galaxy';
import { createDefaultResearchState } from '@/research/engine';
import {
  useGameStore,
  serializeGameState,
  deserializeGameState,
} from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import type { Planet, HexCell, HexTerrain, EntityId, ProductionQueue, ResourceDeposit, GameState } from '@/core/types';

// Baked lookups — детерминированный seed (как в extraction-roles).
setCurrentLookups(bakeGalaxyModel(42, ELEMENTS));

// ============ Хелперы (движок, синтетические планеты) ============

interface MkOptions {
  buildingId?: string | null;
  buildingLevel?: number;
  terrain?: HexTerrain;
  planetType?: string;
  deposits?: ResourceDeposit[];
  extraHexes?: Array<{ buildingId: string | null; buildingLevel?: number; terrain?: HexTerrain; coord: { q: number; r: number } }>;
  resources?: Record<string, number>;
}

/** Минимальная планета с настраиваемым типом/гексом/зданием/залежами. */
function makePlanet(opts: MkOptions = {}): Planet {
  const hexes: HexCell[] = [{
    coord: { q: 0, r: 0 },
    terrain: opts.terrain ?? ('plains' as HexTerrain),
    buildingId: opts.buildingId ?? null,
    buildingLevel: opts.buildingId ? (opts.buildingLevel ?? 1) : 0,
    deposits: opts.deposits ?? [],
  }];
  for (const extra of opts.extraHexes ?? []) {
    hexes.push({
      coord: extra.coord,
      terrain: extra.terrain ?? ('plains' as HexTerrain),
      buildingId: extra.buildingId,
      buildingLevel: extra.buildingId ? (extra.buildingLevel ?? 1) : 0,
      deposits: [],
    });
  }
  return {
    id: 'p1' as EntityId,
    systemId: 's1' as EntityId,
    name: 'R-40 Spec Compliance',
    type: (opts.planetType ?? 'rocky') as Planet['type'],
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1,
    temperature: 15,
    atmosphere: { type: 'standard' as never, pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes,
    atmosphericSlots: [],
    orbitSlots: [],
    moons: [],
    resourceDeposits: [],
    resources: opts.resources ?? { Fe: 500, Ti: 100, Cu: 100 },
    warehouse: createDefaultWarehouse(),
    energyBalance: 1000,
    owner: 'player' as EntityId,
  };
}

function runTicks(planet: Planet, ticks: number): void {
  const queues = new Map<EntityId, ProductionQueue>();
  for (let i = 0; i < ticks; i++) processEconomyTick([planet], queues);
}

/** Глубинная залежь буровой (ultra-пул, порог ≤ 10 покрывается L10). */
function deepDeposit(availability = 0.5, quantity = 1000): ResourceDeposit[] {
  return [{ elementId: 'Zr-ore', availability, quantity, depth: 5 }];
}

// ============ G: геологические коэффициенты (§2.4) ============

describe('R-40 G: геологическая активность планеты (docs/40-buildings.md §2.4)', () => {
  // Буровая L10 на plains (terrainMult = 1), availability 0.5:
  // per tick = 0.5 × (1 + 10×0.15) × geo = 1.25 × geo; за 10 тиков ×10.

  test('G1. Вулканическая ×1.5 (спека §2.4)', () => {
    const p = makePlanet({ planetType: 'volcanic', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    expect(p.resources['Zr-ore']).toBeCloseTo(10 * 1.25 * 1.5, 5); // 18.75
  });

  test('G2. Скалистая ×1.0 — формула прежняя (базовая линия)', () => {
    const p = makePlanet({ planetType: 'rocky', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    expect(p.resources['Zr-ore']).toBeCloseTo(12.5, 5); // идентично R-36 R2
  });

  test('G3. Океаническая ×0.8 (спека §2.4)', () => {
    const p = makePlanet({ planetType: 'oceanic', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    expect(p.resources['Zr-ore']).toBeCloseTo(10 * 1.25 * 0.8, 5); // 10.0
  });

  test('G4. Пустынная ×1.1 (спека §2.4)', () => {
    const p = makePlanet({ planetType: 'desert', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    expect(p.resources['Zr-ore']).toBeCloseTo(10 * 1.25 * 1.1, 5); // 13.75
  });

  test('G5. Ледяная ×0.6 (спека §2.4)', () => {
    const p = makePlanet({ planetType: 'ice', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    expect(p.resources['Zr-ore']).toBeCloseTo(10 * 1.25 * 0.6, 5); // 7.5
  });

  test('G6. Dwarf — ×1.0 (вне спеки §2.4, явное предположение R-40: нейтральные условия)', () => {
    const p = makePlanet({ planetType: 'dwarf', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    expect(p.resources['Zr-ore']).toBeCloseTo(12.5, 5);
    expect(GEOLOGICAL_ACTIVITY_BONUS.dwarf).toBe(1.0);
  });

  test('G7. НЕ удваивается: шахта на вулканической планете — формула БЕЗ гео-множителя', () => {
    const p = makePlanet({ planetType: 'volcanic', buildingId: 'mine', buildingLevel: 1, deposits: [
      { elementId: 'Fe-ore', availability: 0.5, quantity: 1000, depth: 1 },
    ] });
    runTicks(p, 10);
    // Точно как на rocky (существующий тест D1.1) — гео НЕ применяется к шахте.
    expect(p.resources['Fe-ore']).toBeCloseTo(10 * 0.5 * 1.15, 5); // 5.75
  });

  test('G8. Геология × террейн каталога: оба применены РОВНО ОДИН РАЗ (volcanic + mountains)', () => {
    const p = makePlanet({ planetType: 'volcanic', terrain: 'mountains', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit() });
    runTicks(p, 10);
    // 0.5 × 2.5 × 1.3 (terrainMult каталога, один раз) × 1.5 (гео, один раз)
    expect(p.resources['Zr-ore']).toBeCloseTo(10 * 1.25 * 1.3 * 1.5, 5); // 24.375
  });

  test('G9. Геология × синергия mining_cluster: гео не удваивается между буровыми', () => {
    const solo = makePlanet({ planetType: 'volcanic', buildingId: 'drilling_rig', buildingLevel: 3, deposits: deepDeposit(0.5, 100000) });
    const paired = makePlanet({
      planetType: 'volcanic', buildingId: 'drilling_rig', buildingLevel: 3, deposits: deepDeposit(0.5, 100000),
      extraHexes: [{ buildingId: 'drilling_rig', buildingLevel: 1, coord: { q: 1, r: 0 } }],
    });
    runTicks(solo, 10);
    runTicks(paired, 10);
    // solo: 0.5 × (1+3×0.15) × 1.5 = 1.0875/тик
    expect(solo.resources['Zr-ore']).toBeCloseTo(10 * 0.5 * 1.45 * 1.5, 5);
    // paired/solo = 1.1 (синергия одна; гео одинакова в обоих — НЕ стекается второй раз)
    expect(paired.resources['Zr-ore']! / solo.resources['Zr-ore']!).toBeCloseTo(1.1, 5);
  });

  test('G10. Истощение: добыча ограничена количеством залежи, сверх не добывается; пустая залежь молчит', () => {
    // Малая залежь: 3 единицы. rocky L10: 1.25/тик → тик3 добирает остаток 0.5.
    const small = makePlanet({ planetType: 'rocky', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit(0.5, 3) });
    runTicks(small, 5);
    expect(small.resources['Zr-ore']).toBeCloseTo(3, 5); // РОВНО количество залежи
    expect(small.hexes[0]!.deposits[0]!.quantity).toBe(0);
    // Дальнейшие тики ничего не добавляют
    const before = small.resources['Zr-ore'];
    runTicks(small, 5);
    expect(small.resources['Zr-ore']).toBe(before);

    // Уже истощённая залежь (qty 0) — тики не меняют ничего
    const empty = makePlanet({ planetType: 'volcanic', buildingId: 'drilling_rig', buildingLevel: 10, deposits: deepDeposit(0.5, 0) });
    runTicks(empty, 10);
    expect(empty.resources['Zr-ore']).toBeUndefined();
    expect(empty.hexes[0]!.deposits[0]!.quantity).toBe(0);
  });
});

// ============ T: технологический гейт «Глубокое бурение» ============

describe('R-40 T: тех-гейт deep_drilling → drilling_rig (единый requiresTechs)', () => {
  test('T1. Каталог/unlocks связны: drilling_rig гейтится deep_drilling ≥1; тех — starter materials; unlock building', () => {
    const def = BUILDING_MAP.get('drilling_rig');
    expect(def).toBeDefined();
    expect(def!.requiresTechs).toEqual([{ techId: 'deep_drilling', minLevel: 1 }]);

    const tech = TECH_MAP.get('deep_drilling');
    expect(tech, 'технология deep_drilling в TECH_MAP').toBeDefined();
    expect(tech!.name).toBe('Глубокое бурение');
    expect(tech!.branch).toBe('materials');
    expect(tech!.baseCost).toBe(800); // задокументированное предположение R-40
    expect(tech!.prerequisites).toEqual([]); // starter — доступна с начала исследований
    expect(STARTER_TECH_IDS).toContain('deep_drilling');

    // Нет дубликатов в дереве
    expect(TECH_TREE.filter((t) => t.id === 'deep_drilling').length).toBe(1);

    // Data-driven unlock: deep_drilling → building drilling_rig
    expect(TECH_UNLOCKS['deep_drilling']).toEqual([{ level: 1, type: 'building', id: 'drilling_rig' }]);
  });

  test('T2. Движок build: без researched — гейт пропускается (backward-compat прямых вызовов/тестов)', () => {
    const p = makePlanet({ planetType: 'rocky' });
    expect(buildOnHex(p, 0, 'drilling_rig')).toBe(true);
    expect(p.hexes[0]!.buildingId).toBe('drilling_rig');
  });

  test('T3. Движок build: тех не изучена → постройка отклонена, ресурсы НЕ списаны', () => {
    const p = makePlanet({ planetType: 'rocky' });
    expect(buildOnHex(p, 0, 'drilling_rig', {})).toBe(false);
    expect(p.hexes[0]!.buildingId).toBeNull();
    expect(p.resources['Fe']).toBe(500);
    expect(p.resources['Ti']).toBe(100);
    expect(p.resources['Cu']).toBe(100);
    // level 0 теха — тоже отказ
    expect(buildOnHex(p, 0, 'drilling_rig', { deep_drilling: 0 })).toBe(false);
  });

  test('T4. Движок build: тех изучена (level 1) → постройка разрешена, ресурсы списаны', () => {
    const p = makePlanet({ planetType: 'volcanic' });
    expect(buildOnHex(p, 0, 'drilling_rig', { deep_drilling: 1 })).toBe(true);
    expect(p.hexes[0]!.buildingId).toBe('drilling_rig');
    expect(p.hexes[0]!.buildingLevel).toBe(1);
    expect(p.resources['Fe']).toBe(492); // 500 − 8
    expect(p.resources['Ti']).toBe(96);  // 100 − 4
    expect(p.resources['Cu']).toBe(97);  // 100 − 3
  });

  test('T5. Движок upgrade: гейт симметричен постройке (отказ без теха, успех после)', () => {
    // «Старый сейв»: буровая стоит (прямое размещение), тех не изучена.
    const p = makePlanet({ planetType: 'rocky', buildingId: 'drilling_rig', buildingLevel: 2 });
    expect(upgradeBuilding(p, 0, {})).toBe(false);          // гейт: отказ
    expect(p.hexes[0]!.buildingLevel).toBe(2);               // уровень не изменился
    expect(upgradeBuilding(p, 0, { deep_drilling: 1 })).toBe(true); // после изучения
    expect(p.hexes[0]!.buildingLevel).toBe(3);
    // Backward-compat: без researched гейт пропускается
    const q = makePlanet({ buildingId: 'drilling_rig', buildingLevel: 1 });
    expect(upgradeBuilding(q, 0)).toBe(true);
    expect(q.hexes[0]!.buildingLevel).toBe(2);
  });

  test('T6. UI/engine согласованность: areBuildingTechsMet предсказывает исход buildOnHex', () => {
    const def = BUILDING_MAP.get('drilling_rig')!;
    const cases: Record<string, number>[] = [{}, { deep_drilling: 0 }, { deep_drilling: 1 }, { deep_drilling: 3 }, { steel_processing: 10 }];
    for (const researched of cases) {
      const uiVerdict = areBuildingTechsMet(def, researched);
      const p = makePlanet({ planetType: 'desert' });
      const engineVerdict = buildOnHex(p, 0, 'drilling_rig', researched);
      expect(uiVerdict, `researched=${JSON.stringify(researched)}`).toBe(engineVerdict);
    }
    // Отдельно: синтезатор/рефайнери — общий механизм гейта не регрессировал
    const synth = BUILDING_MAP.get('synthesizer')!;
    expect(areBuildingTechsMet(synth, {})).toBe(false);
    expect(areBuildingTechsMet(synth, { steel_processing: 1 })).toBe(true);
  });

  test('T7. Старый сейв: буровая без теха загружается, здание НЕ удаляется, добыча идёт; апгрейд гейтится', () => {
    const state = buildFreshState(42, 5);
    const planet = firstColonizable(state);
    expect(colonizePlanet(planet, undefined)).toBe(true);

    // «Старый сейв»: буровая построена ДО введения гейта (прямое размещение
    // в физике — как это было в R-36…R-39), тех deep_drilling НЕ изучена.
    const hexIdx = planet.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
    expect(hexIdx).toBeGreaterThanOrEqual(0);
    planet.hexes[hexIdx]!.buildingId = 'drilling_rig';
    planet.hexes[hexIdx]!.buildingLevel = 5;
    const hexBefore = planet.hexes[hexIdx]!;

    // Serialize → deserialize — реальный путь загрузки сейва (формат v3).
    const serialized = serializeGameState(state);
    const loaded = deserializeGameState(serialized);
    const loadedPlanet = findPlanetById(loaded, planet.id)!;
    const loadedHex = loadedPlanet.hexes[hexIdx]!;
    // Здание пережило загрузку, уровень сохранён, тех в сейве отсутствует
    expect(loadedHex.buildingId).toBe('drilling_rig');
    expect(loadedHex.buildingLevel).toBe(5);
    expect(loaded.researchState.researched['deep_drilling'] ?? 0).toBe(0);

    // Добыча продолжается после загрузки (гео-множитель — на лету, без миграции)
    const queues = new Map<EntityId, ProductionQueue>();
    const qtyBefore = hexBefore.deposits.reduce((s, d) => s + d.quantity, 0);
    processEconomyTick([loadedPlanet], queues);
    const qtyAfter = loadedPlanet.hexes[hexIdx]!.deposits.reduce((s, d) => s + d.quantity, 0);
    const extractedSum = qtyBefore - qtyAfter;
    // На выбранном гексе может не быть deep-залежей — берём сумму; если залежи
    // есть, добыча строго положительна (все гео-множители > 0)
    const hadDeepDeposit = hexBefore.deposits.some((d) => d.elementId.endsWith('-ore') && isDeepOre(d.elementId));
    if (hadDeepDeposit) {
      expect(extractedSum).toBeGreaterThan(0);
    }

    // Апгрейд старой буровой — НОВОЕ действие: гейтится до изучения теха
    expect(upgradeBuilding(loadedPlanet, hexIdx, loaded.researchState.researched)).toBe(false);
    // …и разрешён после изучения (уровни тех не уменьшаются — регрессии нет)
    const withTech = produce(loaded.researchState.researched, (draft) => { draft['deep_drilling'] = 1; });
    expect(upgradeBuilding(loadedPlanet, hexIdx, withTech)).toBe(true);
    expect(loadedPlanet.hexes[hexIdx]!.buildingLevel).toBe(6);
  });

  test('T8. Полный конвейер store→mediator→модуль: гейт постройки, честное исследование через UI-механику, unlock, апгрейд', () => {
    const { planetId } = startGameAndColonize();
    const store = useGameStore.getState();
    let state = useGameStore.getState().gameState!;
    const planet = findPlanetById(state, planetId)!;
    const rigHex = planet.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
    expect(rigHex).toBeGreaterThanOrEqual(0);

    // (а) UI-фильтр: буровая скрыта в списке постройки (гейт активен)
    const rigDef = BUILDING_MAP.get('drilling_rig')!;
    expect(areBuildingTechsMet(rigDef, state.researchState.researched)).toBe(false);

    // (б) build через СТОР до исследования — отклонён, ресурсы целы
    const feBefore = planet.resources['Fe'] ?? 0;
    expect(store.buildOnHex(planetId, rigHex, 'drilling_rig')).toBe(false);
    state = useGameStore.getState().gameState!;
    expect(findPlanetById(state, planetId)!.hexes[rigHex]!.buildingId).toBeNull();
    expect(findPlanetById(state, planetId)!.resources['Fe']).toBe(feBefore);

    // (в) Честный путь исследования: лаборатория → startResearch → тики модуля.
    // labHex ищем в СВЕЖЕМ состоянии (после неудачной постройки (б)) и НЕ на
    // гексе буровой — иначе обе findIndex вернут один и тот же гекс.
    state = useGameStore.getState().gameState!;
    const labHex = findPlanetById(state, planetId)!.hexes.findIndex((h, idx) => idx !== rigHex && !h.buildingId && h.terrain !== 'ocean');
    expect(labHex).toBeGreaterThanOrEqual(0);
    expect(store.buildOnHex(planetId, labHex, 'laboratory')).toBe(true);
    const slotId = store.startResearch('deep_drilling', 1);
    expect(slotId, 'слот исследования создан (1 лаборатория = 1 слот)').not.toBeNull();

    const mediator = getGameMediator();
    // RP начисляется как totalRPPerSec × speed (deltaSeconds = speed) — при
    // speed=0 исследование стоит. Включаем скорость на окно тиков (синхронный
    // цикл — реальный интервал не успевает сработать), затем возвращаем 0.
    mediator.setSpeed(50);
    let completed = false;
    for (let i = 0; i < 1000 && !completed; i++) {
      mediator.tick();
      state = useGameStore.getState().gameState!;
      completed = (state.researchState.researched['deep_drilling'] ?? 0) >= 1;
    }
    mediator.setSpeed(0);
    expect(completed, 'deep_drilling L1 завершена за ≤1000 тиков').toBe(true);
    // Data-driven unlock сработал по завершении исследования
    // (unlockedBuildings — лениво инициализируемое поле applyTechUnlock)
    const unlocked = (state.researchState as { unlockedBuildings?: string[] }).unlockedBuildings ?? [];
    expect(unlocked).toContain('drilling_rig');

    // (г) build через СТОР после исследования — разрешён (единый гейт UI+engine)
    expect(store.buildOnHex(planetId, rigHex, 'drilling_rig')).toBe(true);
    state = useGameStore.getState().gameState!;
    expect(findPlanetById(state, planetId)!.hexes[rigHex]!.buildingId).toBe('drilling_rig');

    // (д) upgrade через СТОР — тоже разрешён (гейт апгрейда симметричен)
    expect(store.upgradeBuildingOnHex(planetId, rigHex)).toBe(true);
    state = useGameStore.getState().gameState!;
    expect(findPlanetById(state, planetId)!.hexes[rigHex]!.buildingLevel).toBe(2);
  });

  test('T9. Полный конвейер: апгрейд старой буровой ДО изучения теха отклоняется модулем (гейт новых действий)', () => {
    const { planetId } = startGameAndColonize();
    let state = useGameStore.getState().gameState!;
    const planet = findPlanetById(state, planetId)!;
    const hexIdx = planet.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');

    // «Старый сейв»: буровая в физике, теха нет (прямая мутация + sync)
    const manual = produce(state, (draft) => {
      const p = findPlanetById(draft as unknown as GameState, planetId)!;
      p.hexes[hexIdx]!.buildingId = 'drilling_rig';
      p.hexes[hexIdx]!.buildingLevel = 1;
    });
    useGameStore.setState({ gameState: manual });
    getGameMediator().commitState(useGameStore.getState().gameState!);

    const store = useGameStore.getState();
    expect(store.upgradeBuildingOnHex(planetId, hexIdx)).toBe(false);
    state = useGameStore.getState().gameState!;
    expect(findPlanetById(state, planetId)!.hexes[hexIdx]!.buildingLevel).toBe(1);
    // Ресурсы не списаны гейтом
    expect(findPlanetById(state, planetId)!.resources['Fe']).toBe(150); // стартовые
  });
});

// ============ Хелперы (полное состояние/конвейер) ============

function buildFreshState(seed: number, systemCount: number): GameState {
  const galaxy = generateGalaxy({ seed, systemCount });
  return {
    time: { tick: 100, dayInYear: 100, year: 1 },
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

function findPlanetById(state: GameState, id: string): Planet | undefined {
  for (const sys of state.galaxy.systems) {
    const p = sys.planets.find((pl) => pl.id === id);
    if (p) return p;
  }
  return undefined;
}

/** Является ли руда глубинной (роль drilling_rig в хим.модели). */
function isDeepOre(oreId: string): boolean {
  const ore = getCurrentLookups().oreMap.get(oreId);
  return ore?.sourceBuildingId === 'drilling_rig';
}

/**
 * Стартовый сценарий конвейерных тестов (паттерн R-39 T1):
 * newGame (seed 42, 5 систем) → колонизация через СТОР → ручные тики
 * (phase=playing, speed=0 — интервал не запущен, тики mediator.tick()).
 */
function startGameAndColonize(): { planetId: string } {
  const store = useGameStore.getState();
  store.newGame({ seed: 42, systemCount: 5 });
  const state = useGameStore.getState().gameState!;
  const planet = firstColonizable(state);
  const ok = useGameStore.getState().colonizePlanet(planet.id);
  if (!ok) throw new Error('колонизация через стор не удалась');

  const mediator = getGameMediator();
  mediator.setSpeed(0);
  const cur = mediator.getGameState()!;
  const manualTicks = produce(cur, (draft) => {
    draft.phase = 'playing';
    draft.speed = 0;
  });
  mediator.setGameState(manualTicks);

  return { planetId: planet.id };
}

// ============ Setup/teardown конвейерных тестов ============

describe('R-40: изоляция конвейерных тестов', () => {
  beforeEach(() => {
    resetGameMediator();
    useGameStore.setState({
      gameState: null,
      view: 'galaxy',
      selectedSystemId: null,
      selectedPlanetId: null,
      selectedFleetId: null,
      isInitialized: false,
      currentSaveId: null,
      isSaving: false,
      saveError: null,
      isLoading: false,
      loadWarnings: [],
    });
  });

  afterEach(() => {
    resetGameMediator();
    useGameStore.setState({ gameState: null, isInitialized: false });
  });

  test('изоляция: ULTRA_RARE пул не изменён R-40 (граница задания — пулы не трогаем)', () => {
    expect(ULTRA_RARE_ELEMENTS).toEqual(['Ir', 'Os', 'Re', 'Ru', 'Rh', 'Pd', 'Hf', 'Ta', 'Nb', 'Zr']);
    expect(GEOLOGICAL_ACTIVITY_BONUS).toEqual({
      volcanic: 1.5, rocky: 1.0, oceanic: 0.8, desert: 1.1, ice: 0.6, gas_giant: 1.0, dwarf: 1.0,
    });
  });
});
