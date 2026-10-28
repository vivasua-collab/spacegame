/// <reference types="bun-types" />
/**
 * CORE-SAVE-01 (Issue #18, 2026-10-28) — регрессионные тесты failure/success
 * путей saveGame + серверного старт-логирования.
 *
 * Контекст инцидента: владелец нажал Save в превью; fetch не завершился за
 * 30 с (AbortController в game-store.ts) и запрос НЕ дошёл до сервера (в
 * dev-логе за окно плейтеста нет ни одного POST/PUT /api/save). Диагностика
 * показала: сам путь сохранения работает (POST реального payload 0.77 МБ
 * через публичный превью-URL — 201 за 0.3 с; 3.6 МБ через локальный шлюз —
 * 1.9 с), сбой был транзиентным (окно совпало с тяжёлыми гейтами агента на
 * машине 4 ГБ RAM без swap). Чекпоинт: checkpoints/10_28_core_save01.md.
 *
 * Что фиксируют эти тесты (узкий охват, без изменения поведения успеха):
 *   T1. AbortError от таймаута → false + ЧЕСТНОЕ сообщение (таймаут,
 *       состояние не потеряно, повтор безопасен) вместо сырой строки
 *       «The operation was aborted»; isSaving сброшен; фаза/loop restored.
 *   T2. HTTP 500 → false + сообщение содержит статус.
 *   T3. Успешный POST → true + currentSaveId установлен + saveError null.
 *   T4. Серверный POST-хендлер логирует старт ДО любых await — зависший
 *       запрос виден в логе мгновенно (строка старта без строки завершения).
 *
 * Run: bun test tests/core-save-01.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { useGameStore, SAVE_REQUEST_TIMEOUT_MS } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { POST } from '@/app/api/save/route';
import { __resetRateLimitBucketsForTesting } from '@/lib/rate-limit';

// ============ Хелперы (паттерн tests/r39-store-mediator-sync.test.ts) ============

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

/** Заглушить globalThis.fetch. Возвращает restore. */
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init)) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** AbortError той же формы, что бросает браузерный fetch по controller.abort(). */
function abortLike(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

/** Шпион на console.*: собирает вызовы, возвращает restore. */
function spyConsole(method: 'log' | 'error' | 'info'): { calls: unknown[][]; restore: () => void } {
  const original = console[method];
  const calls: unknown[][] = [];
  console[method] = ((...args: unknown[]) => { calls.push(args); }) as typeof console.log;
  return { calls, restore: () => { console[method] = original; } };
}

/** Ответ «успешный JSON». */
function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// ============ Тесты ============

describe('CORE-SAVE-01 (Issue #18): saveGame failure paths + observability', () => {
  let restoreFetch: (() => void) | null = null;
  let consoleSpies: Array<() => void> = [];

  beforeEach(() => {
    resetGameMediator();
    resetStore();
    restoreFetch = null;
    consoleSpies = [];
  });

  afterEach(() => {
    restoreFetch?.();
    for (const restore of consoleSpies) restore();
    resetGameMediator();
    resetStore();
  });

  test('T1. таймаут (AbortError): false, честное сообщение, isSaving сброшен, фаза/loop восстановлены', async () => {
    // Игра в playing на x50 (как у владельца в CORE-06) — проверяем и
    // восстановление фазы/loop в finally после отказа.
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    useGameStore.getState().setSpeed(50);
    expect(useGameStore.getState().gameState!.phase).toBe('playing');
    const tickBefore = useGameStore.getState().gameState!.time.tick;
    const saveIdBefore = useGameStore.getState().currentSaveId;

    const errSpy = spyConsole('error');
    consoleSpies.push(errSpy.restore);

    restoreFetch = stubFetch(async () => {
      // Имитация реального таймаута: fetch отклоняется AbortError-подобной
      // ошибкой ровно как при controller.abort() из fetchWithTimeout.
      throw abortLike();
    });

    const ok = await useGameStore.getState().saveGame();
    expect(ok).toBe(false);

    // Честное сообщение: НЕ сырая «The operation was aborted», а объяснение
    // таймаута + явное «состояние не пострадало» + рекомендация повтора.
    const saveError = useGameStore.getState().saveError!;
    expect(saveError).toContain('таймаут');
    expect(saveError).toContain(`${Math.round(SAVE_REQUEST_TIMEOUT_MS / 1000)} с`);
    expect(saveError).toContain('не пострадало');
    expect(saveError).toContain('Save ещё раз');

    // Структурная диагностика в консоли: граница отказа видна сразу.
    expect(errSpy.calls.length).toBeGreaterThan(0);
    const detailArg = errSpy.calls[0]!.find((a) =>
      typeof a === 'object' && a !== null && 'reason' in (a as Record<string, unknown>));
    expect(detailArg).toBeDefined();
    expect((detailArg as Record<string, unknown>).reason).toBe('request-timeout');
    expect((detailArg as Record<string, unknown>).timeoutMs).toBe(SAVE_REQUEST_TIMEOUT_MS);

    // UI не остаётся в pending, ложный успех не заявляется.
    expect(useGameStore.getState().isSaving).toBe(false);

    // Фаза/loop восстановлены, тик не убежал (интервал был остановлен).
    expect(useGameStore.getState().gameState!.phase).toBe('playing');
    expect(useGameStore.getState().gameState!.speed).toBe(50);
    expect(getGameMediator().loop.getPhase()).toBe('playing');
    expect(useGameStore.getState().gameState!.time.tick).toBe(tickBefore);

    // currentSaveId не изменился (ложный ID не приписан).
    expect(useGameStore.getState().currentSaveId).toBe(saveIdBefore);

    useGameStore.getState().setSpeed(0); // остановить интервал до afterEach
  });

  test('T2. HTTP 500 от API: false, сообщение содержит статус, состояние живо', async () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    const tickBefore = useGameStore.getState().gameState!.time.tick;

    restoreFetch = stubFetch(async () =>
      new Response('Internal Server Error', { status: 500 }),
    );

    const ok = await useGameStore.getState().saveGame();
    expect(ok).toBe(false);
    const saveError = useGameStore.getState().saveError!;
    expect(saveError).toContain('500');
    expect(useGameStore.getState().isSaving).toBe(false);
    // Игра не пострадала от отказа сохранения.
    expect(useGameStore.getState().gameState).not.toBeNull();
    expect(useGameStore.getState().gameState!.time.tick).toBe(tickBefore);
  });

  test('T3. успешный POST: true, currentSaveId установлен, saveError сброшен, диагностика в консоли', async () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });

    const infoSpy = spyConsole('info');
    consoleSpies.push(infoSpy.restore);

    restoreFetch = stubFetch(async () => jsonResponse({ id: 'core-save-01-test' }, 201));

    const ok = await useGameStore.getState().saveGame();
    expect(ok).toBe(true);
    expect(useGameStore.getState().currentSaveId).toBe('core-save-01-test');
    expect(useGameStore.getState().saveError).toBeNull();
    expect(useGameStore.getState().isSaving).toBe(false);

    // Структурная диагностика успешного пути: serialize/encode/network + размеры.
    expect(infoSpy.calls.length).toBeGreaterThan(0);
    const diag = String(infoSpy.calls[0]![0]);
    expect(diag).toContain('[save] OK');
    expect(diag).toContain('serialize=');
    expect(diag).toContain('network=');
    expect(diag).toContain('encoding=');
  });

  test('T4. сервер: POST-хендлер логирует старт ДО любых await (зависший запрос виден мгновенно)', async () => {
    __resetRateLimitBucketsForTesting();

    const logSpy = spyConsole('log');
    consoleSpies.push(logSpy.restore);

    // Даже невалидный запрос (400) обязан оставить старт-строку — она пишется
    // синхронно до rate-limit/чтения тела. Свойство: если запрос зависнет на
    // любом await, старт-строка уже в логе (строка завершения не появится).
    const req = new Request('http://localhost/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'content-length': '2' },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(400); // name отсутствует → zod 400 (существующее поведение)

    const startLine = logSpy.calls.find((args) =>
      String(args[0]).includes('[save-api] POST /api/save start'));
    expect(startLine).toBeDefined();
    expect(String(startLine![0])).toContain('content-length=');
  });
});
