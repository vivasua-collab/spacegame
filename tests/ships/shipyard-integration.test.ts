/// <reference types="bun-types" />
/**
 * SHIPFLOW-00 (Issue #12): интеграционные регрессионные тесты прогресса
 * очереди верфи через РЕАЛЬНЫЙ конвейер store → mediator → ShipsModule.
 *
 * Историческое подозрение (Issue #12, Preflight): в
 * ShipsModule.processShipsTick() очередь меняется внутри produce()
 * (processShipyardTick инкрементирует progressTicks первого item), но
 * коммит нового состояния привязан ТОЛЬКО к факту создания корабля
 * (`if (shipsCreatedThisTick > 0) commitState(newState)`). Промежуточный
 * прогресс терялся: модуль каждый тик читает mediator.getGameState() заново,
 * а незакоммиченный produce-результат отбрасывается → progressTicks
 * навсегда застревал на 0 в закоммиченном состоянии → корабль не завершался
 * НИКОГДА (для totalTicks > 1). Существовавшие до этого тесты
 * (tests/ships/shipyard.test.ts) покрывали только pure-helper
 * processShipyardTick с ручной передачей newQueue — этот класс дефектов
 * они не ловят (что и требует задание: «тест только pure helper
 * недостаточен»).
 *
 * Тесты идут через реальные newGame → colonizePlanet → ручные тики
 * (mediator.tick(), speed=0 — детерминизм без интервалов, паттерн
 * tests/r39-store-mediator-sync.test.ts) и после КАЖДОГО промежуточного
 * тика читают состояние очереди из СТОРА (useGameStore.getState()
 * .gameState.shipyardQueues) — ровно то, что увидел бы UI.
 *
 * Дополнительно покрыто («Входит», Issue #12):
 * - завершение ровно один раз: один корабль, одно списание ресурсов,
 *   одно событие ships:constructed, одно удаление item'а из очереди;
 * - недостаток ресурсов при готовности к завершению (прогресс замирает,
 *   списания нет, корабля нет);
 * - отсутствующий/удалённый дизайн к тику завершения (item убирается
 *   из очереди без корабля и без списания);
 * - пауза (модульный phase-guard в глубину + отсутствие роста прогресса);
 * - изоляция очередей разных планет (разные дизайны/длительности,
 *   независимые прогресс и завершение).
 *
 * Контракты, которые НЕ должны измениться: стоимость (getShipBuildCost*),
 * длительности (getShipBuildTime), порядок очереди (FIFO), форма ShipDesign,
 * существующий save/load (новых полей сейва нет — этот файл их не вводит).
 *
 * Run: bun test tests/ships/shipyard-integration.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { produce } from 'immer';
import { useGameStore } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';
import { findPlanet } from '@/core/find-planet';
import { getShipBuildCostResources } from '@/data/ships/shipyard-queue';
import type { GameState, Planet, ShipDesign, ShipyardQueue, GameTime } from '@/core/types';

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

/** Все колонизируемые планеты состояния (не газовый гигант, без owner, с гексами). */
function colonizablePlanets(state: GameState): Planet[] {
  return state.galaxy.systems
    .flatMap((s) => s.planets)
    .filter((p) => p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0);
}

/**
 * Мутировать gameState через стор (immer-middleware) и синхронизировать
 * медиатор — тот же паттерн, что используют действия стора
 * (direct mutation + syncMediatorState).
 */
function mutateGameState(recipe: (draft: GameState) => void): void {
  useGameStore.setState((state) => {
    if (state.gameState) recipe(state.gameState);
  });
  const current = useGameStore.getState().gameState;
  if (current) getGameMediator().commitState(current);
}

/** Очередь верфи планеты, ВИДИМАЯ ИЗ СТОРА (как её видит UI). */
function storeQueue(planetId: string): ShipyardQueue | undefined {
  return useGameStore.getState().gameState?.shipyardQueues.get(planetId);
}

/** Прогресс первого item'а очереди планеты из стора (-1 — очереди/item'а нет). */
function storeProgress(planetId: string): number {
  const queue = storeQueue(planetId);
  if (!queue || queue.items.length === 0) return -1;
  return queue.items[0]?.progressTicks ?? -1;
}

/** Корабли из стора. */
function storeShips(): number {
  return useGameStore.getState().gameState?.ships.size ?? 0;
}

/** Дизайн Разведчик §10.1 (cost=415 у.е.р., hull_scout → 50 тиков). */
function makeScoutDesign(id: string): ShipDesign {
  return {
    id,
    name: `Разведчик-${id}`,
    hullId: 'hull_scout',
    armor: 'light',
    moduleIds: [
      'cpu_micro', 'engine_ion_mk1', 'scanner_basic', 'comm_mk2',
      'fuel_tank_xenon_s', 'jump_drive_mk1', 'navigator_mk1', 'reactor_nuclear_mk1',
    ],
    owner: 'player',
    createdAtTick: 0,
  };
}

/** Дизайн Истребитель (hull_fighter → 80 тиков) — для изоляции очередей. */
function makeFighterDesign(id: string): ShipDesign {
  return {
    ...makeScoutDesign(id),
    name: `Истребитель-${id}`,
    hullId: 'hull_fighter',
  };
}

interface StartedGame {
  mediator: ReturnType<typeof getGameMediator>;
  planetIds: string[];
}

/**
 * Стартовый сценарий: newGame (seed 42, 5 систем) → колонизация первых
 * `count` планет через СТОР → ручной тик-режим (phase=playing, speed=0 —
 * интервал НЕ запущен, тики только через mediator.tick() — детерминизм
 * тестов; паттерн tests/r39-store-mediator-sync.test.ts).
 */
function startGame(count: number): StartedGame {
  resetGameMediator();
  resetStore();
  useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
  const state = useGameStore.getState().gameState!;
  const planets = colonizablePlanets(state).slice(0, count);
  if (planets.length < count) throw new Error(`нужно ${count} колонизируемых планет, найдено ${planets.length}`);
  const planetIds: string[] = [];
  for (const planet of planets) {
    const ok = useGameStore.getState().colonizePlanet(planet.id);
    if (!ok) throw new Error(`колонизация ${planet.id} через стор не удалась`);
    planetIds.push(planet.id);
  }

  // colonizePlanet переводит фазу в playing + speed=1 → медиатор запускает
  // РЕАЛЬНЫЙ интервал. Останавливаем и включаем ручные тики (speed=0).
  const mediator = getGameMediator();
  mediator.setSpeed(0); // phase='paused', интервал остановлен
  const current = mediator.getGameState()!;
  const manual = produce(current, (draft) => {
    draft.phase = 'playing';
    draft.speed = 0;
  });
  mediator.setGameState(manual); // speed=0 → интервал не запускается

  return { mediator, planetIds };
}

/** Выдать планете достаточно steel/microchip для постройки. */
function giveResources(planetId: string, steel: number, microchip: number): void {
  mutateGameState((draft) => {
    const planet = findPlanet(draft, planetId);
    if (!planet) throw new Error(`планета ${planetId} не найдена`);
    planet.resources['steel'] = steel;
    planet.resources['microchip'] = microchip;
  });
}

/** Подписка-копилка событий с обязательной отпиской. */
function collect<T>(event: 'ships:constructed' | 'ships:construction-progress'): {
  payloads: T[];
  unsub: () => void;
} {
  const payloads: T[] = [];
  const unsub = gameBus.on(event, ((p: T) => payloads.push(p)) as never);
  return { payloads, unsub };
}

// ============ Тесты ============

describe('SHIPFLOW-00 (Issue #12): прогресс очереди верфи через реальный store/mediator/ShipsModule', () => {
  let restoreFetchSpy: (() => void) | null = null;

  beforeEach(() => {
    resetGameMediator();
    resetStore();
    restoreFetchSpy = null;
  });

  afterEach(() => {
    if (restoreFetchSpy) restoreFetchSpy();
    resetGameMediator();
    resetStore();
  });

  test('T1. Промежуточный прогресс виден в сторе после КАЖДОГО тика (главный регрессионный)', () => {
    const { mediator, planetIds } = startGame(1);
    const planetId = planetIds[0]!;

    useGameStore.getState().saveShipDesign(makeScoutDesign('design_t1'));
    const itemId = useGameStore.getState().enqueueShipBuild(planetId, 'design_t1', 'Разведчик-T1');
    if (itemId === null) throw new Error('enqueueShipBuild вернул null');
    expect(storeProgress(planetId)).toBe(0); // поставлен в очередь, прогресс 0/50

    // РЕАЛЬНЫЕ тики через mediator.tick() → loop.step() → registry.tickAll
    // → ShipsModule.processShipsTick. После КАЖДОГО промежуточного тика
    // читаем очередь из СТОРА — прогресс обязан сохраняться.
    mediator.tick();
    expect(storeProgress(planetId)).toBe(1);

    mediator.tick();
    expect(storeProgress(planetId)).toBe(2);

    mediator.tick();
    expect(storeProgress(planetId)).toBe(3);

    // Ни одного корабля, item на месте, totalTicks не изменился
    expect(storeShips()).toBe(0);
    const queue = storeQueue(planetId)!;
    expect(queue.items.length).toBe(1);
    expect(queue.items[0]?.id).toBe(itemId);
    expect(queue.items[0]?.totalTicks).toBe(50);
    expect(queue.items[0]?.designId).toBe('design_t1');

    // Синхронизация store ↔ mediator (контракт R-39): после тика с коммитом
    // прогресса ссылки обязаны совпадать
    expect(getGameMediator().getGameState()).toBe(useGameStore.getState().gameState);
  });

  test('T2. Завершение ровно один раз: 1 корабль, 1 списание, 1 событие, item удалён', () => {
    const { mediator, planetIds } = startGame(1);
    const planetId = planetIds[0]!;

    useGameStore.getState().saveShipDesign(makeScoutDesign('design_t2'));
    useGameStore.getState().enqueueShipBuild(planetId, 'design_t2', 'Разведчик-T2');
    giveResources(planetId, 100_000, 100_000);

    const constructed = collect<{ shipId: string }>('ships:constructed');
    const progress = collect<{ progressTicks: number }>('ships:construction-progress');

    // 49 промежуточных тиков — прогресс доезжает до 49, корабля ещё нет
    for (let tick = 1; tick <= 49; tick++) {
      mediator.tick();
      expect(storeProgress(planetId)).toBe(tick);
      expect(storeShips()).toBe(0);
    }
    expect(constructed.payloads.length).toBe(0);
    // Прогресс-события эмитятся из helper'а на каждом промежуточном тике
    expect(progress.payloads.length).toBe(49);
    expect(progress.payloads[48]?.progressTicks).toBe(49);

    const planetBefore = findPlanet(useGameStore.getState().gameState!, planetId)!;
    const steelBefore = planetBefore.resources['steel'] ?? 0;
    const microchipBefore = planetBefore.resources['microchip'] ?? 0;

    // 50-й тик — завершение
    mediator.tick();
    expect(storeShips()).toBe(1);
    expect(storeProgress(planetId)).toBe(-1); // item удалён, очередь пуста
    expect(storeQueue(planetId)!.items.length).toBe(0);
    expect(constructed.payloads.length).toBe(1);

    // Ровно одно списание стоимости (415 у.е.р. × 5 steel + 415 microchip),
    // экономика на пустой колонии steel/microchip не трогает
    const design = makeScoutDesign('design_t2');
    const cost = getShipBuildCostResources(design);
    const planetAfter = findPlanet(useGameStore.getState().gameState!, planetId)!;
    expect(steelBefore).toBe(100_000);
    expect(planetAfter.resources['steel'] ?? 0).toBe(100_000 - cost.steel);
    expect(planetAfter.resources['microchip'] ?? 0).toBe(100_000 - cost.microchip);

    // Созданный корабль корректен
    const state = useGameStore.getState().gameState!;
    const ships = Array.from(state.ships.values());
    expect(ships.length).toBe(1);
    expect(ships[0]?.name).toBe('Разведчик-T2');
    expect(ships[0]?.designId).toBe('design_t2');
    expect(ships[0]?.hullId).toBe('hull_scout');
    expect(ships[0]?.location).toBe(planetId);
    expect(ships[0]?.owner).toBe('player');
    expect(ships[0]?.hp).toBe(ships[0]?.maxHp);
    expect(ships[0]?.maxHp).toBe(200); // Скаут HP × light 1.0 (Приложение C)

    // Хвостовые тики по пустой очереди — ничего не меняют (нет второго
    // корабля/списания/события)
    mediator.tick();
    mediator.tick();
    expect(storeShips()).toBe(1);
    expect(constructed.payloads.length).toBe(1);
    expect(storeQueue(planetId)!.items.length).toBe(0);
    const planetTail = findPlanet(useGameStore.getState().gameState!, planetId)!;
    expect(planetTail.resources['steel'] ?? 0).toBe(100_000 - cost.steel);

    constructed.unsub();
    progress.unsub();
  });

  test('T3. Недостаток ресурсов при готовности к завершению: прогресс замирает, списания и корабля нет', () => {
    const { mediator, planetIds } = startGame(1);
    const planetId = planetIds[0]!;

    useGameStore.getState().saveShipDesign(makeScoutDesign('design_t3'));
    useGameStore.getState().enqueueShipBuild(planetId, 'design_t3', 'Разведчик-T3');
    // Ресурсов не хватает на стоимость завершения (нужно 2075 steel + 415 microchip)
    giveResources(planetId, 100, 10);

    // Прогресс растёт ДО готовности (ресурсы нужны только в тик завершения)
    for (let tick = 1; tick <= 49; tick++) {
      mediator.tick();
    }
    expect(storeProgress(planetId)).toBe(49);
    expect(storeShips()).toBe(0);

    const constructed = collect<{ shipId: string }>('ships:constructed');

    // Тики готовности — завершения нет: прогресс замирает на 49,
    // ресурсы не списываются, корабль не создаётся
    mediator.tick();
    mediator.tick();
    mediator.tick();
    expect(storeProgress(planetId)).toBe(49);
    expect(storeShips()).toBe(0);
    expect(constructed.payloads.length).toBe(0);
    const planet = findPlanet(useGameStore.getState().gameState!, planetId)!;
    expect(planet.resources['steel'] ?? 0).toBe(100);
    expect(planet.resources['microchip'] ?? 0).toBe(10);

    constructed.unsub();
  });

  test('T4. Удалённый дизайн к тику готовности: item убирается из очереди, без корабля и списания', () => {
    const { mediator, planetIds } = startGame(1);
    const planetId = planetIds[0]!;

    useGameStore.getState().saveShipDesign(makeScoutDesign('design_t4'));
    useGameStore.getState().enqueueShipBuild(planetId, 'design_t4', 'Разведчик-T4');
    giveResources(planetId, 100_000, 100_000);

    for (let tick = 1; tick <= 49; tick++) {
      mediator.tick();
    }
    expect(storeProgress(planetId)).toBe(49);

    const constructed = collect<{ shipId: string }>('ships:constructed');

    // Удаляем дизайн до тика завершения
    const deleted = useGameStore.getState().deleteShipDesign('design_t4');
    expect(deleted).toBe(true);
    expect(useGameStore.getState().gameState!.shipDesigns.has('design_t4')).toBe(false);

    // Тик готовности: design отсутствует → item тихо убирается из очереди
    mediator.tick();
    expect(storeQueue(planetId)!.items.length).toBe(0);
    expect(storeProgress(planetId)).toBe(-1);
    expect(storeShips()).toBe(0);
    expect(constructed.payloads.length).toBe(0);

    // Списание ресурсов за несостоявшийся корабль НЕ происходит
    const planet = findPlanet(useGameStore.getState().gameState!, planetId)!;
    expect(planet.resources['steel'] ?? 0).toBe(100_000);
    expect(planet.resources['microchip'] ?? 0).toBe(100_000);

    constructed.unsub();
  });

  test('T5. Пауза: очередь не продвигается (guard модуля в глубину), после возобновления прогресс продолжается', () => {
    const { mediator, planetIds } = startGame(1);
    const planetId = planetIds[0]!;

    useGameStore.getState().saveShipDesign(makeScoutDesign('design_t5'));
    useGameStore.getState().enqueueShipBuild(planetId, 'design_t5', 'Разведчик-T5');

    mediator.tick();
    mediator.tick();
    expect(storeProgress(planetId)).toBe(2);

    // Пауза БЕЗ интервальных побочек: phase='paused' через setGameState
    const paused = produce(useGameStore.getState().gameState!, (draft) => {
      draft.phase = 'paused';
    });
    mediator.setGameState(paused);

    // (а) mediator.tick() в паузе — no-op по контракту
    mediator.tick();
    expect(storeProgress(planetId)).toBe(2);

    // (б) защита в глубину: даже прямой registry.tickAll при phase=paused
    // не продвигает очередь (модульный guard ShipsModule, R-39)
    const fakeTime: GameTime = { tick: 999, dayInYear: 999, year: 2 };
    mediator.registry.tickAll(fakeTime);
    expect(storeProgress(planetId)).toBe(2);
    expect(storeShips()).toBe(0);

    // Возобновление (phase=playing, speed=0 — ручные тики): очередь пережила
    // паузу, прогресс продолжается с 2
    const resumed = produce(useGameStore.getState().gameState!, (draft) => {
      draft.phase = 'playing';
      draft.speed = 0;
    });
    mediator.setGameState(resumed);
    mediator.tick();
    expect(storeProgress(planetId)).toBe(3);
  });

  test('T6. Изоляция очередей разных планет: независимые прогресс и завершение', () => {
    const { mediator, planetIds } = startGame(2);
    const planetA = planetIds[0]!;
    const planetB = planetIds[1]!;

    // Разные дизайны и длительности: scout=50, fighter=80
    useGameStore.getState().saveShipDesign(makeScoutDesign('design_t6a'));
    useGameStore.getState().saveShipDesign(makeFighterDesign('design_t6b'));
    useGameStore.getState().enqueueShipBuild(planetA, 'design_t6a', 'Разведчик-T6A');
    useGameStore.getState().enqueueShipBuild(planetB, 'design_t6b', 'Истребитель-T6B');
    giveResources(planetA, 100_000, 100_000);
    giveResources(planetB, 100_000, 100_000);

    const constructed = collect<{ shipId: string; designId: string }>('ships:constructed');

    // Промежуточные тики: обе очереди растут независимо
    mediator.tick();
    mediator.tick();
    mediator.tick();
    expect(storeProgress(planetA)).toBe(3);
    expect(storeProgress(planetB)).toBe(3);
    expect(storeQueue(planetA)!.items[0]?.totalTicks).toBe(50);
    expect(storeQueue(planetB)!.items[0]?.totalTicks).toBe(80);

    // Тик 50: scout планеты A завершён, fighter планеты B — ещё нет
    for (let tick = 4; tick <= 50; tick++) mediator.tick();
    expect(storeShips()).toBe(1);
    expect(storeQueue(planetA)!.items.length).toBe(0);
    expect(storeProgress(planetA)).toBe(-1);
    expect(storeQueue(planetB)!.items.length).toBe(1);
    expect(storeProgress(planetB)).toBe(50);
    expect(constructed.payloads.length).toBe(1);
    expect(constructed.payloads[0]?.designId).toBe('design_t6a');

    // Тики 51..80: fighter планеты B завершается независимо
    for (let tick = 51; tick <= 80; tick++) mediator.tick();
    expect(storeShips()).toBe(2);
    expect(storeQueue(planetB)!.items.length).toBe(0);
    expect(constructed.payloads.length).toBe(2);
    expect(constructed.payloads[1]?.designId).toBe('design_t6b');

    // Корабли приписаны своим планетам
    const state = useGameStore.getState().gameState!;
    const locations = Array.from(state.ships.values()).map((s) => s.location).sort();
    expect(locations).toEqual([planetA, planetB].sort());

    constructed.unsub();
  });
});
