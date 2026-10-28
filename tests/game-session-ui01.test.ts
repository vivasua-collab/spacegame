/// <reference types="bun-types" />
/**
 * GAME-SESSION-UI-01 (Issue #21, 2026-10-28) — тесты возврата в главное
 * меню и продолжения сессии: store-действия returnToMainMenu/continueGame
 * + контракт lifecycle-эффекта page.tsx (меню не тикает; Continue — ровно
 * один интервал; повторный Continue невозможен).
 *
 * UI-часть (видимость кнопок «Продолжить игру»/«В меню», подтверждения
 * замены сессии) проверена браузерным E2E — см. чекпоинт
 * checkpoints/10_28_game_session_ui01.md.
 *
 * Run: bun test tests/game-session-ui01.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { useGameStore } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';

// ============ Хелперы ============

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
    suspendedSpeed: null,
  });
}

/** Счётчик активных setInterval-вызовов (шпион на глобальном таймере). */
function spySetInterval(): { calls: number; active: number; restore: () => void } {
  const original = globalThis.setInterval;
  const origClear = globalThis.clearInterval;
  const state = { calls: 0, active: 0 };
  const wrappedIds = new Set<ReturnType<typeof setInterval>>();
  globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number) => {
    state.calls++;
    state.active++;
    const id = original(fn as TimerHandler, ms) as ReturnType<typeof setInterval>;
    wrappedIds.add(id);
    return id;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    if (id && wrappedIds.has(id)) {
      wrappedIds.delete(id);
      state.active--;
    }
    return origClear(id);
  }) as typeof clearInterval;
  return {
    get calls() { return state.calls; },
    get active() { return state.active; },
    restore: () => {
      globalThis.setInterval = original;
      globalThis.clearInterval = origClear;
      for (const id of wrappedIds) origClear(id);
      wrappedIds.clear();
    },
  };
}

/** Первая колонизируемая планета галактики. */
function firstColonizable(): string {
  const state = useGameStore.getState().gameState!;
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p.id;
    }
  }
  throw new Error('нет колонизируемых планет');
}

/** Полный сценарий: игра + колонизация + playing на заданной скорости. */
function startPlayingGame(speed: 1 | 50): void {
  useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
  const planetId = firstColonizable();
  useGameStore.getState().colonizePlanet(planetId);
  useGameStore.getState().setSpeed(speed);
  expect(useGameStore.getState().gameState!.phase).toBe('playing');
}

// ============ Тесты ============

describe('GAME-SESSION-UI-01 (Issue #21): возврат в меню и продолжение', () => {
  let timerSpy: ReturnType<typeof spySetInterval> | null = null;

  beforeEach(() => {
    resetGameMediator();
    resetStore();
    timerSpy = null;
  });

  afterEach(() => {
    // Остановить интервалы игры до сброса (чистота между тестами).
    const gs = useGameStore.getState().gameState;
    if (gs) getGameMediator().loop.pause();
    timerSpy?.restore();
    resetGameMediator();
    resetStore();
  });

  test('T1. returnToMainMenu без сессии — no-op (главное меню и так показано)', () => {
    expect(useGameStore.getState().gameState).toBeNull();
    useGameStore.getState().returnToMainMenu();
    expect(useGameStore.getState().isInitialized).toBe(false);
    expect(useGameStore.getState().gameState).toBeNull();
  });

  test('T2. возврат в меню из playing: сессия сохранена (тот же объект/seed/tick), интервал остановлен, тиков нет', async () => {
    startPlayingGame(50); // x50 → интервал 20 мс: без остановки ~7 тиков/150 мс

    const before = useGameStore.getState().gameState!;
    const stateRef = before; // ссылка должна сохраниться (immer-мутация фазы меняет ссылку gameState, но НЕ содержимое галактики)
    const seedBefore = before.galaxy.seed;
    const tickBefore = before.time.tick;
    const systemsBefore = before.galaxy.systems.length;
    useGameStore.getState().selectSystem(stateRef.galaxy.systems[0]!.id);

    let ticks = 0;
    const unsub = gameBus.on('core:tick', () => { ticks++; });

    useGameStore.getState().returnToMainMenu();

    // Навигация: меню, но сессия жива в памяти.
    expect(useGameStore.getState().isInitialized).toBe(false);
    const suspended = useGameStore.getState().gameState!;
    expect(suspended).not.toBeNull();
    expect(suspended.galaxy.seed).toBe(seedBefore);
    expect(suspended.galaxy.systems.length).toBe(systemsBefore);
    expect(suspended.time.tick).toBe(tickBefore);
    // Выделение сохранено (выбранный контекст).
    expect(useGameStore.getState().selectedSystemId).toBe(stateRef.galaxy.systems[0]!.id);
    // Скорость для Continue зафиксирована.
    expect(useGameStore.getState().suspendedSpeed).toBe(50);
    // Loop остановлен: 150 мс тишины на x50.
    await new Promise((r) => setTimeout(r, 150));
    expect(ticks).toBe(0);
    expect(getGameMediator().loop.getPhase()).toBe('paused');

    unsub();
  });

  test('T3. Continue: та же сессия (seed/tick), играющая скорость восстановлена, РОВНО ОДИН интервал', async () => {
    startPlayingGame(50);
    useGameStore.getState().returnToMainMenu();
    const suspended = useGameStore.getState().gameState!;
    const seed = suspended.galaxy.seed;
    const tick = suspended.time.tick;

    let ticks = 0;
    const unsub = gameBus.on('core:tick', () => { ticks++; });

    timerSpy = spySetInterval();
    const ok = useGameStore.getState().continueGame();
    expect(ok).toBe(true);

    // Контракт lifecycle-эффекта page.tsx: isInitialized=true → эффект
    // вызывает mediator.start() (идемпотентно — НЕ добавляет интервал).
    getGameMediator().start();

    expect(useGameStore.getState().isInitialized).toBe(true);
    expect(useGameStore.getState().suspendedSpeed).toBeNull();
    const resumed = useGameStore.getState().gameState!;
    expect(resumed.galaxy.seed).toBe(seed);
    expect(resumed.time.tick).toBe(tick); // тики не убежали за время меню
    expect(resumed.phase).toBe('playing');
    expect(resumed.speed).toBe(50);
    expect(getGameMediator().loop.getPhase()).toBe('playing');

    // РОВНО ОДИН АКТИВНЫЙ интервал на всём пути Continue. Вызовов может
    // быть два: continueGame → setSpeed → loop.start (интервал №1), затем
    // эффект page.tsx → mediator.start → loop.setSpeed(playing) делает
    // штатный restart (stop+start — интервал №2 взамен №1, утечки нет).
    // Двойной ТИКИНГ исключён: активен ровно один, скорость не удваивается
    // (проверка количества тиков ниже).
    expect(timerSpy.calls).toBeGreaterThanOrEqual(1);
    expect(timerSpy.calls).toBeLessThanOrEqual(2);
    expect(timerSpy.active).toBe(1);

    // Тики пошли (x50 = 20 мс; за 150 мс — несколько, но не «двойная скорость»:
    // двойной интервал дал бы ~2× тиков; здесь только пороговые проверки).
    await new Promise((r) => setTimeout(r, 150));
    expect(ticks).toBeGreaterThanOrEqual(3);
    expect(ticks).toBeLessThanOrEqual(10); // один интервал на x50 ≈ 7 за 150 мс; два ≈ 14

    unsub();
  });

  test('T4. Повторный Continue при активной игре — false, ничего не меняется', () => {
    startPlayingGame(1);
    useGameStore.getState().returnToMainMenu();
    expect(useGameStore.getState().continueGame()).toBe(true);
    const speed = useGameStore.getState().gameState!.speed;
    expect(useGameStore.getState().continueGame()).toBe(false);
    expect(useGameStore.getState().isInitialized).toBe(true);
    expect(useGameStore.getState().gameState!.speed).toBe(speed);
  });

  test('T5. Continue без suspended-сессии — false (кнопки нет, состояние не тронуто)', () => {
    expect(useGameStore.getState().continueGame()).toBe(false);
    expect(useGameStore.getState().isInitialized).toBe(false);
  });

  test('T6. Пауза до возврата остаётся паузой после Continue (loop не запускается)', async () => {
    startPlayingGame(50);
    useGameStore.getState().setSpeed(0); // владелец сам поставил паузу
    expect(useGameStore.getState().gameState!.phase).toBe('paused');

    useGameStore.getState().returnToMainMenu();
    expect(useGameStore.getState().suspendedSpeed).toBe(0);

    let ticks = 0;
    const unsub = gameBus.on('core:tick', () => { ticks++; });

    timerSpy = spySetInterval();
    expect(useGameStore.getState().continueGame()).toBe(true);
    // Контракт эффекта: isInitialized=true → mediator.start() — но фаза
    // paused/speed 0 → интервал не запускается (guard в mediator.start).
    getGameMediator().start();

    expect(useGameStore.getState().gameState!.phase).toBe('paused');
    expect(timerSpy.calls).toBe(0); // ни одного setInterval
    await new Promise((r) => setTimeout(r, 100));
    expect(ticks).toBe(0);
    unsub();
  });

  test('T7. Фаза colonization: возврат не портит фазу — Continue возвращает баннер колонизации', () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    expect(useGameStore.getState().gameState!.phase).toBe('colonization');

    useGameStore.getState().returnToMainMenu();
    // colonization не мутируется (паттерн R-39/T11 — баннер переживёт возврат).
    expect(useGameStore.getState().gameState!.phase).toBe('colonization');
    expect(useGameStore.getState().suspendedSpeed).toBe(0);

    expect(useGameStore.getState().continueGame()).toBe(true);
    expect(useGameStore.getState().gameState!.phase).toBe('colonization');
    expect(useGameStore.getState().isInitialized).toBe(true);
  });

  test('T8. currentSaveId и серверные сейвы не тронуты: возврат/Continue не делают DELETE-запросов', async () => {
    startPlayingGame(1);
    useGameStore.setState({ currentSaveId: 'save-42' });

    const requests: Array<{ method: string; url: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ method: String(init?.method ?? 'GET'), url: String(url) });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    useGameStore.getState().returnToMainMenu();
    useGameStore.getState().continueGame();

    globalThis.fetch = original;
    expect(useGameStore.getState().currentSaveId).toBe('save-42');
    // Ни одного сетевого запроса — тем более DELETE.
    expect(requests).toEqual([]);
  });

  test('T9. Контракт lifecycle-эффекта: isInitialized=false → mediator.stop() не даёт тикать suspended-сессии', async () => {
    // Тот самый сценарий, который до фикса page.tsx тикал бы в фоне:
    // suspended-сессия (playing до возврата) + эффект вызывает start().
    startPlayingGame(50);
    useGameStore.getState().returnToMainMenu();

    let ticks = 0;
    const unsub = gameBus.on('core:tick', () => { ticks++; });

    // СТАРЫЙ эффект (до фикса): безусловный mediator.start() при
    // isInitialized=false → suspended-сессия в фазе playing ПЕРЕЗАПУСКАЛА
    // интервал. Наш returnToMainMenu ставит phase='paused' ДО остановки,
    // поэтому guard в mediator.start (playing && speed>0) не срабатывает.
    getGameMediator().start();
    await new Promise((r) => setTimeout(r, 150));
    expect(ticks).toBe(0);

    // НОВЫЙ контракт эффекта: isInitialized=false → mediator.stop().
    getGameMediator().stop();
    expect(getGameMediator().loop.getPhase()).toBe('paused');
    unsub();
  });
});
