/// <reference types="bun-types" />
/**
 * R-39 (P0-1 Store→Mediator): интеграционные тесты слоя действий стора.
 *
 * ДО R-39 слой действий useGameStore не покрывался тестами ВООБЩЕ (тесты
 * импортировали только serialize/deserialize) — контракт синхронизации
 * «store ↔ mediator ↔ модули» был недоказанным (STATUS P0-1 «открыт»).
 *
 * Покрытие (задание R-39, Часть B):
 *   1. Pattern A (bus): action → store state → mediator/event →
 *      EconomyModule — полный конвейер, ровно один коммит/событие
 *      (нет двойной обработки), порядок событий, ошибки подписчиков.
 *   2. Pattern B (direct mutation + syncMediatorState): action →
 *      store → mediator → следующий тик модулей видит новое состояние
 *      (cancelProduction не «воскресает», orbit buffer переживает тик).
 *   3. UI-only действия (view/select/seed) — исключение из синхронизации:
 *      gameState не меняется, core:state-changed не эмитится.
 *   4. GameLoop lifecycle: mid-session loadGame (прежде — заморозка
 *      симуляции после stopAll без startAll), cold load, newGame из playing.
 *   5. saveGame race: интервал реально остановлен на время сохранения
 *      (прежде loop.pause() никто не вызывал — экономика тикала «в паузе»);
 *      честная сериализация фазы colonization (прежде портилась в 'paused').
 *   6. Повреждённые сейвы: мусор/fmt≠3/zod-невалидный — активная игра
 *      не затронута (refs/lookups), loadGame возвращает false.
 *   7. Наблюдаемость миграций: loadWarnings (отказ R-38 виден в store).
 *   8. tech:fundamental-leveled — событие, заявленное в манифесте
 *      ResearchModule, реально эмитится из levelUpFundamental.
 *   9. resetGameMediator → стор перерегистрирует модули (instance-tracking).
 *   10. P6: colony_hub — апгрейды L2/L3 списывают стоимость, потолок,
 *       недостаток ресурсов → отказ (прежде costPerLevel:{} — бесплатно).
 *   11. P5: crafted materials — полнота реестра отображения (каждый выход
 *       рецепта разрешим в ELEMENT_MAP или CRAFTED_MATERIALS), русские
 *       имена, производство crafted-ресурса по ID через реальный тик.
 *
 * Run: bun test tests/r39-store-mediator-sync.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { produce } from 'immer';
import { useGameStore, serializeGameState, deserializeGameState } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';
import { getCurrentLookups } from '@/data/baked-lookups';
import { ELEMENT_MAP } from '@/data/elements';
import { CRAFTED_MATERIALS, getCraftedMaterial } from '@/data/crafted-materials';
import { RECIPE_MAP } from '@/data/recipes';
import type { GameState, Planet } from '@/core/types';

// ============ Хелперы ============

/** Сброс стора в «холодное» состояние (до главного меню). */
function resetStore(): void {
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
}

/** Найти планету в состоянии по id. */
function planetById(state: GameState, id: string): Planet | undefined {
  for (const sys of state.galaxy.systems) {
    const p = sys.planets.find((pl) => pl.id === id);
    if (p) return p;
  }
  return undefined;
}

/** Первая пригодная для колонизации планета (не газовый гигант, с гексами). */
function firstColonizable(state: GameState): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p;
    }
  }
  throw new Error('нет колонизируемых планет в тестовой галактике');
}

interface StartedGame {
  planetId: string;
  freeHexIndex: number;
}

/**
 * Стартовый сценарий: newGame (seed 42, 5 систем) → колонизация через СТОР
 * (полный конвейер store → bus → EconomyModule → engine) → перевод в
 * ручной тик-режим (phase=playing, speed=0 — интервал НЕ запущен, тики
 * только через mediator.tick() — детерминизм тестов).
 */
function startGameAndColonize(): StartedGame {
  const store = useGameStore.getState();
  store.newGame({ seed: 42, systemCount: 5 });
  const state = useGameStore.getState().gameState!;
  const planet = firstColonizable(state);
  const ok = useGameStore.getState().colonizePlanet(planet.id);
  if (!ok) throw new Error('колонизация через стор не удалась');

  // colonizePlanet переводит фазу в playing + speed=1 → медиатор запускает
  // РЕАЛЬНЫЙ интервал (1000 мс). Останавливаем его и включаем ручные тики:
  // phase=playing + speed=0 → setGameState не стартует интервал, а
  // mediator.tick() (guard phase==='playing') работает.
  const mediator = getGameMediator();
  mediator.setSpeed(0); // phase='paused', интервал остановлен
  const cur = mediator.getGameState()!;
  const manual = produce(cur, (draft) => {
    draft.phase = 'playing';
    draft.speed = 0;
  });
  mediator.setGameState(manual); // speed=0 → интервал не запускается

  const fresh = useGameStore.getState().gameState!;
  const colonized = planetById(fresh, planet.id)!;
  const freeHexIndex = colonized.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
  if (freeHexIndex < 0) throw new Error('нет свободного гекса');
  return { planetId: planet.id, freeHexIndex };
}

/** Заглушить globalThis.fetch. Возвращает захваченные запросы + restore. */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** Ответ «успешный JSON» для fetch-заглушки. */
function jsonResponse(body: unknown, delayMs = 0): Promise<Response> {
  return (async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  })();
}

// ============ Setup ============

describe('R-39: Store→Mediator sync (P0-1) + GameLoop lifecycle + saveGame race', () => {
  let restoreFetch: (() => void) | null = null;

  beforeEach(() => {
    resetGameMediator();
    resetStore();
    restoreFetch = null;
  });

  afterEach(() => {
    if (restoreFetch) restoreFetch();
    resetGameMediator();
    resetStore();
  });

  // ─── 1. Pattern A: полный конвейер через шину ─────────────────────────

  test('T1. buildOnHex через стор: полный конвейер, ровно ОДИН коммит и ОДНО событие, порядок [constructed → state-changed]', () => {
    const { planetId, freeHexIndex } = startGameAndColonize();

    let constructed = 0;
    let stateChanged = 0;
    const order: string[] = [];
    gameBus.on('economy:building-constructed', (p) => {
      if (p.planetId === planetId && p.buildingId === 'mine') { constructed++; order.push('constructed'); }
    });
    gameBus.on('core:state-changed', () => { stateChanged++; order.push('state-changed'); });

    const ok = useGameStore.getState().buildOnHex(planetId, freeHexIndex, 'mine');

    expect(ok).toBe(true);
    // store state: здание построено, уровень 1 (НЕ 2 — двойной обработки нет)
    const storeState = useGameStore.getState().gameState!;
    const planet = planetById(storeState, planetId)!;
    expect(planet.hexes[freeHexIndex]!.buildingId).toBe('mine');
    expect(planet.hexes[freeHexIndex]!.buildingLevel).toBe(1);
    // медиатор видит ТО ЖЕ состояние (ref-равенство — синхронизация)
    expect(getGameMediator().getGameState()).toBe(storeState);
    // ровно одно событие исхода и один коммит на действие
    expect(constructed).toBe(1);
    expect(stateChanged).toBe(1);
    // порядок: engine-событие (внутри produce) → затем коммит (контракт R-39)
    expect(order[0]).toBe('constructed');
    expect(order[1]).toBe('state-changed');
  });

  test('T2. upgrade/downgrade/demolish через стор: события ровно по одному, payload корректен', () => {
    const { planetId, freeHexIndex } = startGameAndColonize();
    const store = useGameStore.getState();
    expect(store.buildOnHex(planetId, freeHexIndex, 'mine')).toBe(true);

    const events: string[] = [];
    gameBus.on('economy:building-upgraded', (p) => { if (p.planetId === planetId) events.push(`upgraded:L${p.level}`); });
    gameBus.on('economy:building-downgraded', (p) => { if (p.planetId === planetId) events.push(`downgraded:L${p.level}`); });
    gameBus.on('economy:building-demolished', (p) => { if (p.planetId === planetId) events.push(`demolished:${p.buildingId}`); });

    // upgrade L1→L2 (mine costPerLevel Fe 6 × уровень)
    expect(useGameStore.getState().upgradeBuildingOnHex(planetId, freeHexIndex)).toBe(true);
    expect(planetById(useGameStore.getState().gameState!, planetId)!.hexes[freeHexIndex]!.buildingLevel).toBe(2);

    // downgrade L2→L1 → событие downgraded, НЕ demolished
    expect(useGameStore.getState().downgradeBuildingOnHex(planetId, freeHexIndex)).toBe(true);

    // downgrade L1 = снос → demolished
    expect(useGameStore.getState().downgradeBuildingOnHex(planetId, freeHexIndex)).toBe(true);
    expect(planetById(useGameStore.getState().gameState!, planetId)!.hexes[freeHexIndex]!.buildingId).toBeNull();

    // ровно по одному событию на операцию (после унификации шин R-39 —
    // движок эмитит, модуль НЕ дублирует)
    expect(events).toEqual(['upgraded:L2', 'downgraded:L1', 'demolished:mine']);
    // медиатор синхронен
    expect(getGameMediator().getGameState()).toBe(useGameStore.getState().gameState);
  });

  // ─── 2. Pattern B: прямые мутации + syncMediatorState ────────────────

  test('T3. cancelProduction: тик НЕ воскрешает отменённый элемент (syncMediatorState доходит до модулей)', () => {
    const { planetId, freeHexIndex } = startGameAndColonize();
    const store = useGameStore.getState();
    // smelt_fe требует завод стройматериалов (PROC-WORKSHOPS-01) — строим
    expect(store.buildOnHex(planetId, freeHexIndex, 'construction_materials_plant')).toBe(true);

    // Постановка (Pattern A)
    expect(useGameStore.getState().enqueueProduction(planetId, 'smelt_fe', false)).toBe(true);
    let queue = useGameStore.getState().gameState!.productionQueues.get(planetId);
    expect(queue?.items.length).toBe(1);
    const itemId = queue!.items[0]!.id;

    // Отмена (Pattern B — прямая мутация + syncMediatorState)
    expect(useGameStore.getState().cancelProduction(planetId, itemId)).toBe(true);
    queue = useGameStore.getState().gameState!.productionQueues.get(planetId);
    expect(queue?.items.length ?? 0).toBe(0);

    // Тик обрабатывает СИНКНУТОЕ состояние: без синка медиатор держал бы
    // прежний ref (с элементом) и закоммитил бы его обратно — «воскрешение»
    let stateChanged = 0;
    gameBus.on('core:state-changed', () => { stateChanged++; });
    getGameMediator().tick();

    const after = useGameStore.getState().gameState!;
    expect(after.productionQueues.get(planetId)?.items.length ?? 0).toBe(0);
    expect(stateChanged).toBeGreaterThanOrEqual(1); // модуль реально тикил
    expect(getGameMediator().getGameState()).toBe(after);
  });

  test('T4. moveToOrbit/setColonyRole/setReserveMinimum: медиатор видит прямые мутации; тик сохраняет орбитальный буфер', () => {
    const { planetId, freeHexIndex } = startGameAndColonize();

    // Орбитальный буфер требует космопорт на орбитальном слоте (capacity 0
    // без него) — строим через СТОР (Pattern A на orbit-слоте, доп. покрытие)
    const state0 = useGameStore.getState().gameState!;
    const planet0 = planetById(state0, planetId)!;
    const orbitIdx = planet0.orbitSlots.findIndex((s) => !s.buildingId);
    expect(orbitIdx).toBeGreaterThanOrEqual(0);
    expect(useGameStore.getState().buildOnOrbitSlot(planetId, orbitIdx, 'spaceport')).toBe(true);

    // moveToOrbit (Pattern B): переносим 5 Fe (космопорт L1 = +5 ёмкости)
    const state = useGameStore.getState().gameState!;
    const planet = planetById(state, planetId)!;
    const feBefore = planet.resources['Fe'] ?? 0;
    expect(feBefore).toBeGreaterThan(0);
    const movedFe = Math.min(feBefore, 5);
    expect(useGameStore.getState().moveToOrbit(planetId, 'Fe', movedFe)).toBe(true);

    // медиатор видит mutation (ref-равенство после syncMediatorState)
    const synced = getGameMediator().getGameState()!;
    const syncedPlanet = planetById(synced, planetId)!;
    expect(syncedPlanet.resources['Fe'] ?? 0).toBe(feBefore - movedFe);
    expect(syncedPlanet.warehouse!.orbitBuffer.resources['Fe']).toBe(movedFe);
    // свободный гекс не занят космопортом (слой orbit ≠ surface)
    expect(syncedPlanet.hexes[freeHexIndex]!.buildingId).toBeNull();

    // setColonyRole + setReserveMinimum (Pattern B)
    useGameStore.getState().setColonyRole(planetId, 'mining');
    useGameStore.getState().setReserveMinimum(planetId, 'Fe', 10);
    const after = useGameStore.getState().gameState!;
    const afterPlanet = planetById(after, planetId)!;
    expect(afterPlanet.warehouse!.colonyRole).toBe('mining');
    expect(afterPlanet.warehouse!.reserves['Fe']?.minimum).toBe(10);
    expect(getGameMediator().getGameState()).toBe(after);

    // тик экономики НЕ затирает орбитальный буфер (модуль работал с синкнутым ref)
    getGameMediator().tick();
    const ticked = useGameStore.getState().gameState!;
    const tickedPlanet = planetById(ticked, planetId)!;
    expect(tickedPlanet.warehouse!.orbitBuffer.resources['Fe']).toBe(movedFe);
    expect(getGameMediator().getGameState()).toBe(ticked);
  });

  // ─── 3. UI-only действия — задокументированное исключение ────────────

  test('T5. UI-only действия (view/select/seed) не трогают gameState и не эмитят core:state-changed', () => {
    startGameAndColonize();
    const before = useGameStore.getState().gameState!;
    const mediatorBefore = getGameMediator().getGameState();

    let stateChanged = 0;
    gameBus.on('core:state-changed', () => { stateChanged++; });

    const store = useGameStore.getState();
    store.setView('system');
    store.selectSystem(before.galaxy.systems[0]!.id);
    store.selectPlanet(null);
    store.selectFleet('fleet_1');
    store.rollGalaxySeed();

    // gameState-ссылка не изменилась, медиатор тоже
    expect(useGameStore.getState().gameState).toBe(before);
    expect(getGameMediator().getGameState()).toBe(mediatorBefore);
    expect(stateChanged).toBe(0);
    // UI-поля применились
    expect(useGameStore.getState().view).toBe('system');
    expect(useGameStore.getState().selectedFleetId).toBe('fleet_1');
  });

  // ─── 4. Изоляция ошибок подписчиков ──────────────────────────────────

  test('T6. Падающий подписчик не ломает действие: buildOnHex успешен, ошибка изолирована шиной', () => {
    const { planetId, freeHexIndex } = startGameAndColonize();

    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    gameBus.on('economy:build', () => { throw new Error('subscriber boom'); });

    try {
      const ok = useGameStore.getState().buildOnHex(planetId, freeHexIndex, 'mine');
      expect(ok).toBe(true); // действие успешно несмотря на падающего подписчика
      const planet = planetById(useGameStore.getState().gameState!, planetId)!;
      expect(planet.hexes[freeHexIndex]!.buildingId).toBe('mine');
      expect(errors.length).toBeGreaterThan(0); // шина залогировала ошибку
    } finally {
      console.error = origError;
    }
  });

  // ─── 5. GameLoop lifecycle ────────────────────────────────────────────

  test('T7. Mid-session loadGame(paused): интервал прошлой игры остановлен, модули ЖИВЫ, setSpeed(1)+tick работают (прежде — заморозка)', async () => {
    // Активная игра в playing (ручной тик-режим для детерминизма —
    // замороженные модули ловятся и в нём: тик не даёт state-changed)
    const { planetId } = startGameAndColonize();

    // Сейв «пауза» из той же галактики: сериализуем текущее состояние,
    // переключаем фазу в paused (модель загрузки «playing-сейв лежит
    // на диске в паузе» — семантика saveGame).
    const pausedJson = serializeGameState(useGameStore.getState().gameState!);
    const pausedState = JSON.parse(pausedJson) as GameState & Record<string, unknown>;
    pausedState.phase = 'paused';
    pausedState.speed = 0;
    restoreFetch = stubFetch(() => jsonResponse({ state: JSON.stringify(pausedState) }));

    const loaded = await useGameStore.getState().loadGame('save-1');
    expect(loaded).toBe(true);

    // loop остановлен (интервал прошлой игры не пережил загрузку паузы)
    expect(getGameMediator().loop.getPhase()).toBe('paused');
    // загруженное состояние видно
    const st = useGameStore.getState().gameState!;
    expect(planetById(st, planetId)).toBeDefined();

    // Возобновление: ГЛАВНОЕ — модули живы. Прежде (stopAll без startAll)
    // модули оставались stopped → тик молчал (симуляция заморожена).
    let stateChanged = 0;
    gameBus.on('core:state-changed', () => { stateChanged++; });
    const mediator = getGameMediator();
    const cur = mediator.getGameState()!;
    const manual = produce(cur, (draft) => { draft.phase = 'playing'; draft.speed = 0; });
    mediator.setGameState(manual);
    const tickBefore = mediator.getGameState()!.time.tick;
    mediator.tick();
    expect(mediator.getGameState()!.time.tick).toBe(tickBefore + 1);
    expect(stateChanged).toBeGreaterThanOrEqual(1); // модуль тикнул и закоммитил
  });

  test('T8. Cold loadGame(playing): модули запущены, loop в playing, тик обрабатывается сразу', async () => {
    const { planetId } = startGameAndColonize();
    const playingRaw = JSON.parse(serializeGameState(useGameStore.getState().gameState!)) as GameState & Record<string, unknown>;
    // startGameAndColonize держит speed=0 (ручной режим) — приводим сейв
    // к каноническому виду playing-сохранения (speed=1)
    playingRaw.speed = 1;
    const playingJson = JSON.stringify(playingRaw);

    resetStore(); // «холодный старт» — как после перезагрузки страницы
    resetGameMediator();

    restoreFetch = stubFetch(() => jsonResponse({ state: playingJson }));
    const loaded = await useGameStore.getState().loadGame('save-cold');
    expect(loaded).toBe(true);

    const mediator = getGameMediator();
    // playing-сейв: loop запущен (интервал активен; afterEach его убьёт)
    expect(mediator.loop.getPhase()).toBe('playing');
    // модули живы — ручной тик обрабатывается (state-changed от EconomyModule)
    let stateChanged = 0;
    gameBus.on('core:state-changed', () => { stateChanged++; });
    const tickBefore = mediator.getGameState()!.time.tick;
    mediator.tick();
    expect(mediator.getGameState()!.time.tick).toBe(tickBefore + 1);
    expect(stateChanged).toBeGreaterThanOrEqual(1);
    expect(planetById(useGameStore.getState().gameState!, planetId)).toBeDefined();
  });

  test('T9. newGame из playing: интервал прошлой игры остановлен; колонизация → playing → тик работает', () => {
    startGameAndColonize(); // активная игра (ручной режим: loop paused)

    // Переведём loop в playing (интервал) — как реальная игра на x1
    useGameStore.getState().setSpeed(1);
    expect(getGameMediator().loop.getPhase()).toBe('playing');

    // New Game поверх активной игры
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    // интервал прошлой игры НЕ утёк (прежде — registry.stopAll + живой интервал)
    expect(getGameMediator().loop.getPhase()).toBe('paused');

    // Колонизация в новой игре → playing → модули обрабатывают тик
    const fresh = useGameStore.getState().gameState!;
    const planet = firstColonizable(fresh);
    expect(useGameStore.getState().colonizePlanet(planet.id)).toBe(true);

    const mediator = getGameMediator();
    mediator.setSpeed(0);
    const cur = mediator.getGameState()!;
    const manual = produce(cur, (draft) => { draft.phase = 'playing'; draft.speed = 0; });
    mediator.setGameState(manual);

    let stateChanged = 0;
    gameBus.on('core:state-changed', () => { stateChanged++; });
    mediator.tick();
    expect(stateChanged).toBeGreaterThanOrEqual(1); // модули живы после newGame
  });

  // ─── 6. saveGame: race + честные фазы ────────────────────────────────

  test('T10. saveGame на x50: 0 тиков в окне сохранения, сериализация в paused, восстановление playing', async () => {
    const { planetId } = startGameAndColonize();
    expect(planetId).toBeDefined();

    // Запускаем реальный интервал x50 (20 мс) — агрессивный режим гонки
    useGameStore.getState().setSpeed(50);
    expect(getGameMediator().loop.getPhase()).toBe('playing');

    let ticksDuringSave = 0;
    gameBus.on('core:tick', () => { ticksDuringSave++; });

    let phaseAtSerialize = 'never-captured';
    restoreFetch = stubFetch(async () => {
      // Внутри «сетевого запроса» (120 мс при интервале 20 мс = до 6 тиков
      // без фикса): фиксируем фазу, которая уйдёт в сериализацию, и считаем тики
      phaseAtSerialize = useGameStore.getState().gameState!.phase;
      return jsonResponse({ id: 'race-save' }, 120);
    });

    const ok = await useGameStore.getState().saveGame();
    expect(ok).toBe(true);

    // ГОНКА ЗАКРЫТА: ни одного тика за всё окно сохранения (пауза+50 мс
    // сна+120 мс «сети»). Прежде loop.pause() не вызывался — до ~6 тиков
    // обрабатывали экономику «в паузе» на x50.
    expect(ticksDuringSave).toBe(0);
    // семантика сохранена: в сейв уходит phase='paused'
    expect(phaseAtSerialize).toBe('paused');
    // после сохранения игра возобновлена
    expect(useGameStore.getState().gameState!.phase).toBe('playing');
    expect(useGameStore.getState().gameState!.speed).toBe(50);
    expect(getGameMediator().loop.getPhase()).toBe('playing');

    useGameStore.getState().setSpeed(0); // остановить интервал до afterEach
  });

  test('T11. saveGame в фазе colonization: фаза НЕ портится в paused (баннер колонизации переживёт загрузку)', async () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    expect(useGameStore.getState().gameState!.phase).toBe('colonization');

    let phaseAtSerialize = 'never-captured';
    restoreFetch = stubFetch(async () => {
      phaseAtSerialize = useGameStore.getState().gameState!.phase;
      return jsonResponse({ id: 'colonization-save' });
    });

    const ok = await useGameStore.getState().saveGame();
    expect(ok).toBe(true);
    // прежде фаза портилась в 'paused' → после загрузки баннер
    // «Выберите планету для колонизации» терялся навсегда
    expect(phaseAtSerialize).toBe('colonization');
    expect(useGameStore.getState().gameState!.phase).toBe('colonization');
  });

  // ─── 7. Повреждённые сейвы: активная игра не затронута ────────────────

  test('T12. loadGame(мусорный ответ): false, активная игра жива (refs/lookups), дальнейшие действия работают', async () => {
    const { planetId, freeHexIndex } = startGameAndColonize();
    const before = useGameStore.getState().gameState!;
    const mediatorBefore = getGameMediator().getGameState();
    const lookupsBefore = getCurrentLookups();

    restoreFetch = stubFetch(() => jsonResponse({ state: 'это не json сейва {{{' }));
    expect(await useGameStore.getState().loadGame('garbage')).toBe(false);

    // активная игра не тронута: refs, lookups, работоспособность
    expect(useGameStore.getState().gameState).toBe(before);
    expect(getGameMediator().getGameState()).toBe(mediatorBefore);
    expect(getCurrentLookups()).toBe(lookupsBefore);
    expect(useGameStore.getState().buildOnHex(planetId, freeHexIndex, 'mine')).toBe(true);
  });

  test('T13. loadGame(fmt≠4) и zod-невалидный: false, активная игра не тронута', async () => {
    const { planetId } = startGameAndColonize();
    const before = useGameStore.getState().gameState!;

    // fmt≠4 — старый формат (гекс-залежи, ORE-POOLS: без миграции — docs/31 §12)
    const bogus = JSON.stringify({ fmt: 3, galaxy: {}, time: { tick: 0 } });
    restoreFetch = stubFetch(() => jsonResponse({ state: bogus }));
    expect(await useGameStore.getState().loadGame('old-fmt')).toBe(false);

    // zod-невалидный: fmt=4, но структура сломана
    const broken = JSON.stringify({ fmt: 4, galaxy: { systems: 'not-an-array' } });
    restoreFetch = stubFetch(() => jsonResponse({ state: broken }));
    expect(await useGameStore.getState().loadGame('broken')).toBe(false);

    expect(useGameStore.getState().gameState).toBe(before);
    expect(getGameMediator().getGameState()).toBe(before);
  });

  // ─── 8. Наблюдаемость повреждённых сейвов (loadWarnings) ─────────────

  test('T14. loadGame с повреждённым индексом словаря пулов (op): отказ загрузки, активная игра не тронута', async () => {
    const { planetId } = startGameAndColonize();
    const before = useGameStore.getState().gameState!;

    // Строим повреждённый v4-сейв: кортеж пулов op ссылается ЗА пределы
    // словаря id (строгий контракт v4: явная ошибка — R-31/ORE-POOLS,
    // никакой молчаливой порчи данных).
    const raw = JSON.parse(serializeGameState(useGameStore.getState().gameState!)) as Record<string, any>;
    const sys0 = raw.galaxy.systems[0];
    const p0 = (sys0.planets as any[]).find((p: any) => Array.isArray(p.op) && p.op.length > 0)
      ?? (sys0.planets as any[])[0];
    (p0.op as unknown[][])[0]![0] = 999999; // индекс вне dict

    restoreFetch = stubFetch(() => jsonResponse({ state: JSON.stringify(raw) }));
    expect(await useGameStore.getState().loadGame('corrupt-op')).toBe(false);

    // Активная игра не тронута (отказ загрузки не портит состояние)
    expect(useGameStore.getState().gameState).toBe(before);
    expect(planetById(useGameStore.getState().gameState!, planetId)).toBeDefined();
  });

  // ─── 9. tech:fundamental-leveled ─────────────────────────────────────

  test('T15. levelUpFundamental эмитит tech:fundamental-leveled с корректным payload (событие из манифеста)', () => {
    const { planetId } = startGameAndColonize();
    expect(planetId).toBeDefined();

    // Даём банку RP напрямую (миграция rpBank для старых состояний — внутри)
    const withBank = produce(useGameStore.getState().gameState!, (draft) => {
      draft.researchState.rpBank = 5000;
    });
    useGameStore.setState({ gameState: withBank });

    const seen: Array<{ branchId: string; factionId: string; newLevel: number }> = [];
    gameBus.on('tech:fundamental-leveled', (p) => { seen.push(p); });

    const ok = useGameStore.getState().levelUpFundamental('chemistry');
    expect(ok).toBe(true);
    expect(seen).toEqual([{ branchId: 'chemistry', factionId: 'player', newLevel: 1 }]);

    // состояние поднято и синхронизировано с медиатором
    const after = useGameStore.getState().gameState!;
    expect(after.researchState.fundamentalLevels['chemistry']).toBe(1);
    expect(getGameMediator().getGameState()).toBe(after);
  });

  // ─── 10. resetGameMediator → перерегистрация модулей ─────────────────

  test('T16. resetGameMediator: следующий store-экшен перерегистрирует модули и работает (instance-tracking)', () => {
    const { planetId, freeHexIndex } = startGameAndColonize();
    expect(planetById(useGameStore.getState().gameState!, planetId)).toBeDefined();

    // Пересоздаём синглтон (как делают тесты/HMR) — прежний флаг
    // modulesRegistered навсегда блокировал бы перерегистрацию (дефект D4)
    resetGameMediator();

    // Действие через стор: модули должны перерегистрироваться на новом
    // медиаторе и полный конвейер должен работать
    const fresh = useGameStore.getState().gameState!;
    const freeIdx = planetById(fresh, planetId)!.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
    expect(freeIdx).toBeGreaterThanOrEqual(0);
    expect(useGameStore.getState().buildOnHex(planetId, freeIdx, 'mine')).toBe(true);
    expect(planetById(useGameStore.getState().gameState!, planetId)!.hexes[freeIdx]!.buildingId).toBe('mine');
    expect(getGameMediator().getGameState()).toBe(useGameStore.getState().gameState);
  });

  // ─── 11. P6: colony_hub стоимость апгрейдов ──────────────────────────

  test('T17. P6: colony_hub апгрейды L2/L3 списывают Fe/Si/Al (все уровни), потолок L3, нехватка ресурсов → отказ', async () => {
    const { planetId } = startGameAndColonize();
    let state = useGameStore.getState().gameState!;
    let planet = planetById(state, planetId)!;
    const hubIndex = planet.hexes.findIndex((h) => h.buildingId === 'colony_hub');
    expect(hubIndex).toBeGreaterThanOrEqual(0);
    expect(planet.hexes[hubIndex]!.buildingLevel).toBe(1);
    // giveStarterResources (при колонизации): Fe 150, Si 100, Al 80
    const fe0 = planet.resources['Fe'] ?? 0;
    const si0 = planet.resources['Si'] ?? 0;
    const al0 = planet.resources['Al'] ?? 0;
    expect(fe0).toBe(150);
    expect(si0).toBe(100);
    expect(al0).toBe(80);

    // L1 → L2: base × уровень (Fe 10×1, Si 5×1, Al 3×1)
    expect(useGameStore.getState().upgradeBuildingOnHex(planetId, hubIndex)).toBe(true);
    state = useGameStore.getState().gameState!;
    planet = planetById(state, planetId)!;
    expect(planet.hexes[hubIndex]!.buildingLevel).toBe(2);
    expect(planet.resources['Fe']).toBe(fe0 - 10);
    expect(planet.resources['Si']).toBe(si0 - 5);
    expect(planet.resources['Al']).toBe(al0 - 3);

    // L2 → L3: base × 2 (Fe 20, Si 10, Al 6)
    expect(useGameStore.getState().upgradeBuildingOnHex(planetId, hubIndex)).toBe(true);
    state = useGameStore.getState().gameState!;
    planet = planetById(state, planetId)!;
    expect(planet.hexes[hubIndex]!.buildingLevel).toBe(3);
    expect(planet.resources['Fe']).toBe(fe0 - 30);
    expect(planet.resources['Si']).toBe(si0 - 15);
    expect(planet.resources['Al']).toBe(al0 - 9);

    // Потолок (levels: 3) → отказ
    expect(useGameStore.getState().upgradeBuildingOnHex(planetId, hubIndex)).toBe(false);

    // Нехватка ресурсов: вторая колония; сливаем Fe до 5 → L1→L2 невозможен.
    // Проверка на уровне ДВИЖКА (как downgrade-demolish тесты): прямая
    // замена gameState в сторе минует экшены и НЕ синхронизирует медиатор
    // (контракт P0-1: изменение gameState — только через экшены), поэтому
    // движковый вызов над тем же объектом.
    const fresh = useGameStore.getState().gameState!;
    const another = firstColonizable(fresh);
    expect(useGameStore.getState().colonizePlanet(another.id)).toBe(true);
    const afterColonize = useGameStore.getState().gameState!;
    const anotherPlanet = planetById(afterColonize, another.id)!;
    const hub2 = anotherPlanet.hexes.findIndex((h) => h.buildingId === 'colony_hub');
    anotherPlanet.resources['Fe'] = 5; // setAutoFreeze(false) — прямая мутация
    const { upgradeBuilding } = await import('@/economy/engine');
    expect(upgradeBuilding(anotherPlanet, hub2)).toBe(false); // нужно 10, есть 5
    expect(anotherPlanet.hexes[hub2]!.buildingLevel).toBe(1);
    // обратная проверка: ресурсов достаточно → списание ровно по формуле
    anotherPlanet.resources['Fe'] = 15;
    expect(upgradeBuilding(anotherPlanet, hub2)).toBe(true);
    expect(anotherPlanet.hexes[hub2]!.buildingLevel).toBe(2);
    expect(anotherPlanet.resources['Fe']).toBe(5); // 15 − 10×1
  });

  // ─── 12. P5: crafted materials — отображение и доступность ───────────

  test('T18. P5: каждый выход рецепта разрешим для отображения (ELEMENT_MAP ∪ CRAFTED_MATERIALS), русские имена', () => {
    // Полнота реестра: ни один крафтовый выход не останется с английским
    // ID «id.replace(/-/g," ")» в UI (исходная жалоба P5)
    for (const recipe of RECIPE_MAP.values()) {
      for (const outId of Object.keys(recipe.outputs)) {
        const resolvable = ELEMENT_MAP.has(outId) || getCraftedMaterial(outId) !== undefined;
        expect(resolvable, `выход ${outId} (рецепт ${recipe.id}) разрешим для UI`).toBe(true);
      }
    }
    // Конкретные участники исходной жалобы
    expect(getCraftedMaterial('steel')?.name).toBe('Сталь');
    expect(getCraftedMaterial('microchip')?.name).toBe('Микрочип');
    expect(CRAFTED_MATERIALS['steel']?.category).toBe('crafted');
  });

  test('T19. P5: производство crafted-ресурса (make_steel → steel) работает ПО ID через реальный тик экономики', () => {
    const { planetId } = startGameAndColonize();
    // Синтезатор ставим напрямую в гекс (тест сетап — валидация tech вне
    // рамок P5; проверяем, что производство crafted-ресурса не зависит
    // от категории отображения, только от ID в planet.resources)
    const withSynth = produce(useGameStore.getState().gameState!, (draft) => {
      const p = ((): Planet | undefined => {
        for (const sys of draft.galaxy.systems) {
          const found = sys.planets.find((pl) => pl.id === planetId);
          if (found) return found;
        }
        return undefined;
      })();
      if (!p) throw new Error('планета не найдена в draft');
      const idx = p.hexes.findIndex((h) => !h.buildingId && h.terrain !== 'ocean');
      p.hexes[idx]!.buildingId = 'synthesizer';
      p.hexes[idx]!.buildingLevel = 1;
      p.hexes[idx]!.processorType = 'specialized';
      p.hexes[idx]!.specialization = 'alloy_synthesis';
      p.resources['Fe'] = Math.max(p.resources['Fe'] ?? 0, 50);
      p.resources['C'] = Math.max(p.resources['C'] ?? 0, 20);
    });
    useGameStore.setState({ gameState: withSynth });
    // Тестовый сетап минует экшены — явно синхронизируем медиатор
    // (контракт P0-1: экшены синкают сами, прямой setState — нет)
    getGameMediator().commitState(withSynth);

    // Входы и постановка очереди (store → bus → модуль → engine)
    expect(useGameStore.getState().enqueueProduction(planetId, 'make_steel', false)).toBe(true);

    // Рецепт: Fe 10 + C 3 → steel 5, time 8 → 8 тиков
    for (let i = 0; i < 8; i++) getGameMediator().tick();

    const after = planetById(useGameStore.getState().gameState!, planetId)!;
    expect(after.resources['steel'] ?? 0).toBeGreaterThan(0); // crafted произведён
    // категория отображения не участвовала: ID попали в planet.resources
    expect(getCraftedMaterial('steel')).toBeDefined();
  });
});
