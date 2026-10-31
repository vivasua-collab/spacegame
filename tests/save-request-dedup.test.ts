/// <reference types="bun-types" />
/**
 * CORE-SAVE-REPRO-01 (Issue #27) — идемпотентность POST /api/save против
 * дубликатов при «неоднозначном» исходе (ambiguous POST).
 *
 * Воспроизведение (2026-10-31, §6 Issue #27): клиент (raw TCP) отправил
 * валидный POST и закрыл соединение ДО чтения ответа — сервер УСПЕШНО
 * завершил запрос (201, INSERT), строка осталась в БД, но клиент не получил
 * { id } и не установил currentSaveId. Повторное нажатие Save создало бы
 * ВТОРУЮ запись (дубль «Galaxy #seed»).
 *
 * Фикс (узкий, без изменения схемы БД):
 *   - Клиент: на POST отправляется `x-save-request-id` (UUID). ID живёт в
 *     рамках ОДНОЙ игровой сессии (привязан к монотонному sessionVersion,
 *     который инкрементируется ровно при замене сессии: newGame / успешный
 *     loadGame / restoreFromCheckpoint) и ПЕРЕЖИВАЕТ неудачную попытку —
 *     это отличает «повтор после потери ответа» от намеренного нового сейва.
 *     При УСПЕХЕ ID освобождается (следующий Save — новая операция).
 *   - Сервер: in-memory Map requestId → saveId (TTL 10 мин, cap 500,
 *     eviction старейшего). Повтор POST с тем же requestId возвращает
 *     УЖЕ СОЗДАННУЮ запись ({ id, deduplicated: true }) вместо новой строки.
 *     Схема БД и формат v4 не меняются; PUT не затрагивается (идемпотентен
 *     по ID записи естественным образом; header логируется для корреляции).
 *
 * Что фиксируют тесты:
 *   A. lib save-request-dedup: plausibility, hit, TTL, cap-eviction, reset.
 *   B. route POST: дедуп-хит возвращает существующий ID без новой записи;
 *      новый requestId → новая запись; кривой header → игнорируется;
 *      валидация (zod) выполняется ДО дедупа; requestId в старт-логе.
 *   C. клиент saveGame: тот же x-save-request-id при повторе после сбоя
 *      (ambiguous), освобождение после успеха, сброс при замене сессии.
 *
 * Run: bun test tests/save-request-dedup.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { POST } from '@/app/api/save/route';
import { PUT } from '@/app/api/save/[id]/route';
import { __resetRateLimitBucketsForTesting } from '@/lib/rate-limit';
import {
  __resetSaveRequestDedupForTesting,
  checkSaveRequestDuplicate,
  isPlausibleSaveRequestId,
  rememberSaveRequest,
  SAVE_REQUEST_DEDUP_TTL_MS,
  SAVE_REQUEST_DEDUP_MAX_ENTRIES,
} from '@/lib/save-request-dedup';
import { db } from '@/lib/db';
import { useGameStore } from '@/stores/game-store';
import { resetGameMediator } from '@/core/game-mediator';

// ============ Хелперы (паттерн tests/core-save-01.test.ts) ============

function makePostRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeRouteContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'DedupTestSave', seed: 42, state: '{"fmt":4,"note":"dedup"}', tick: 0, ...overrides };
}

function spyConsole(method: 'log' | 'error' | 'info'): { calls: unknown[][]; restore: () => void } {
  const original = console[method];
  const calls: unknown[][] = [];
  console[method] = ((...args: unknown[]) => { calls.push(args); }) as typeof console.log;
  return { calls, restore: () => { console[method] = original; } };
}

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

function abortLike(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

type FetchCall = { url: string; init?: RequestInit };

function recordFetch(
  handler: (call: FetchCall, callNumber: number) => Promise<unknown>,
): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const call: FetchCall = { url: String(url), init };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function requestHeader(call: FetchCall, name: string): string | undefined {
  const headers = call.init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

// ============ A. lib: save-request-dedup ============

describe('CORE-SAVE-REPRO-01: lib save-request-dedup', () => {
  beforeEach(() => {
    __resetSaveRequestDedupForTesting();
  });

  test('A1. isPlausibleSaveRequestId: UUID проходит, мусор — нет', () => {
    expect(isPlausibleSaveRequestId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    expect(isPlausibleSaveRequestId('12345678')).toBe(true); // ровно 8 валидных символов
    expect(isPlausibleSaveRequestId('1234567')).toBe(false); // < 8
    expect(isPlausibleSaveRequestId('x'.repeat(65))).toBe(false); // > 64
    expect(isPlausibleSaveRequestId('bad id with spaces')).toBe(false);
    expect(isPlausibleSaveRequestId('юникод-идентификатор')).toBe(false);
    expect(isPlausibleSaveRequestId(null)).toBe(false);
    expect(isPlausibleSaveRequestId(undefined)).toBe(false);
  });

  test('A2. remember + check → hit возвращает тот же saveId', () => {
    const t0 = 1_000_000;
    rememberSaveRequest('req-A2', 'save-xyz', t0);
    expect(checkSaveRequestDuplicate('req-A2', t0 + 1)).toBe('save-xyz');
  });

  test('A3. TTL: ровно на границе жив, после — истёк (null + удаление)', () => {
    const t0 = 2_000_000;
    rememberSaveRequest('req-A3', 'save-abc', t0);
    expect(checkSaveRequestDuplicate('req-A3', t0 + SAVE_REQUEST_DEDUP_TTL_MS)).toBe('save-abc');
    expect(checkSaveRequestDuplicate('req-A3', t0 + SAVE_REQUEST_DEDUP_TTL_MS + 1)).toBeNull();
  });

  test('A4. cap: старейший вытесняется, размер ограничен (поведенчески)', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < SAVE_REQUEST_DEDUP_MAX_ENTRIES + 1; i++) {
      rememberSaveRequest(`req-cap-${i}`, `save-${i}`, t0 + i);
    }
    // Самый старый вытеснен — дедупа нет; новый создаст новую запись.
    expect(checkSaveRequestDuplicate('req-cap-0', t0)).toBeNull();
    // Самый свежий жив.
    expect(
      checkSaveRequestDuplicate(`req-cap-${SAVE_REQUEST_DEDUP_MAX_ENTRIES}`, t0),
    ).toBe(`save-${SAVE_REQUEST_DEDUP_MAX_ENTRIES}`);
  });

  test('A5. reset для тестов очищает карту', () => {
    rememberSaveRequest('req-A5', 'save-a5');
    __resetSaveRequestDedupForTesting();
    expect(checkSaveRequestDuplicate('req-A5')).toBeNull();
  });
});

// ============ B. route: POST /api/save дедуп ============

describe('CORE-SAVE-REPRO-01: POST /api/save идемпотентность', () => {
  const R1 = '11111111-aaaa-bbbb-cccc-dddddddd1111';
  const R2 = '22222222-aaaa-bbbb-cccc-dddddddd2222';
  let createdIds: string[] = [];

  beforeEach(() => {
    __resetRateLimitBucketsForTesting();
    __resetSaveRequestDedupForTesting();
    createdIds = [];
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      await db.gameSave.deleteMany({ where: { id: { in: createdIds } } });
    }
    __resetSaveRequestDedupForTesting();
  });

  test('B1. POST с requestId → 201, запись создана, ответ {id}', async () => {
    const res = await POST(makePostRequest(validPayload(), { 'x-save-request-id': R1 }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    createdIds.push(body.id);
    const row = await db.gameSave.findUnique({ where: { id: body.id } });
    expect(row).not.toBeNull();
    expect(row!.version).toBe(4); // метаданные v4 не сломаны дедупом
  });

  test('B2. повтор POST с тем же requestId → СУЩЕСТВУЮЩИЙ id, deduplicated:true, БЕЗ новой записи', async () => {
    const res1 = await POST(makePostRequest(validPayload(), { 'x-save-request-id': R1 }));
    const body1 = (await res1.json()) as { id: string };
    createdIds.push(body1.id);

    // Повтор с ДРУГИМ payload (как реальный retry: то же имя, чуть иное состояние)
    const res2 = await POST(
      makePostRequest(validPayload({ name: 'DedupTestSave-retry', tick: 17 }), {
        'x-save-request-id': R1,
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { id: string; deduplicated: boolean };
    expect(body2.id).toBe(body1.id);
    expect(body2.deduplicated).toBe(true);

    const rows = await db.gameSave.findMany({ where: { name: { in: ['DedupTestSave', 'DedupTestSave-retry'] } } });
    expect(rows).toHaveLength(1); // дубль НЕ создан
  });

  test('B3. новый requestId → обычная новая запись (нормальное поведение сохранено)', async () => {
    const res1 = await POST(makePostRequest(validPayload(), { 'x-save-request-id': R1 }));
    const body1 = (await res1.json()) as { id: string };
    const res2 = await POST(makePostRequest(validPayload({ name: 'DedupTestSave-2' }), { 'x-save-request-id': R2 }));
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { id: string };
    createdIds.push(body1.id, body2.id);
    expect(body2.id).not.toBe(body1.id);
  });

  test('B4. кривой requestId (пробелы) → игнорируется, обычный 201 без дедуп-семантики', async () => {
    const res1 = await POST(makePostRequest(validPayload(), { 'x-save-request-id': 'bad id!' }));
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { id: string };
    createdIds.push(body1.id);
    const res2 = await POST(makePostRequest(validPayload(), { 'x-save-request-id': 'bad id!' }));
    expect(res2.status).toBe(201); // не дедуп-хит (который был бы 200)
    const body2 = (await res2.json()) as { id: string };
    createdIds.push(body2.id);
    expect(body2.id).not.toBe(body1.id);
    expect((body2 as { deduplicated?: boolean }).deduplicated).toBeUndefined();
  });

  test('B5. zod-валидация выполняется ДО дедупа: невалидный payload с известным requestId → 400, не хит', async () => {
    rememberSaveRequest(R1, 'pre-existing-save-id');
    const res = await POST(
      makePostRequest({ seed: 42, state: '{}' }, { 'x-save-request-id': R1 }), // name отсутствует
    );
    expect(res.status).toBe(400);
  });

  test('B6. старт-лог содержит requestId (корреляция этапов §4)', async () => {
    const logSpy = spyConsole('log');
    try {
      const res = await POST(makePostRequest(validPayload(), { 'x-save-request-id': R1 }));
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      createdIds.push(body.id);
      const startLine = logSpy.calls.find((args) =>
        String(args[0]).includes('[save-api] POST /api/save start'));
      expect(startLine).toBeDefined();
      expect(String(startLine![0])).toContain(`requestId=${R1}`);
    } finally {
      logSpy.restore();
    }
  });

  test('B7. PUT: requestId проходит в лог для корреляции, поведение не меняется', async () => {
    // Создать запись напрямую в БД (PUT тестируем изолированно от POST).
    const row = await db.gameSave.create({
      data: { name: 'DedupPutTest', seed: 7, state: '{"fmt":4}', tick: 0, version: 4 },
    });
    createdIds.push(row.id);

    const logSpy = spyConsole('log');
    try {
      const req = new Request(`http://localhost/api/save/${row.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-save-request-id': R2 },
        body: JSON.stringify({ name: 'DedupPutTest', state: '{"fmt":4,"t":2}', tick: 5 }),
      });
      const res = await PUT(req, makeRouteContext(row.id));
      expect(res.status).toBe(200);
      const startLine = logSpy.calls.find((args) =>
        String(args[0]).includes('[save-api] PUT'));
      expect(startLine).toBeDefined();
      expect(String(startLine![0])).toContain(`requestId=${R2}`);
      // PUT не дедуплицируется и не удаляет запись — обновляет.
      const after = await db.gameSave.findUnique({ where: { id: row.id } });
      expect(after!.tick).toBe(5);
    } finally {
      logSpy.restore();
    }
  });
});

// ============ C. клиент: saveGame retention/release/epoch ============

describe('CORE-SAVE-REPRO-01: клиент saveGame — жизненный цикл x-save-request-id', () => {
  let fetchStub: { calls: FetchCall[]; restore: () => void } | null = null;
  const createdIds: string[] = [];

  beforeEach(() => {
    resetGameMediator();
    resetStore();
    fetchStub = null;
  });

  afterEach(async () => {
    fetchStub?.restore();
    if (createdIds.length > 0) {
      await db.gameSave.deleteMany({ where: { id: { in: createdIds } } });
      createdIds.length = 0;
    }
    resetGameMediator();
    resetStore();
  });

  test('C1. повтор saveGame после сбоя (ambiguous abort) использует ТОТ ЖЕ requestId; успех ставит currentSaveId', async () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });

    fetchStub = recordFetch((call, n) => {
      if (n === 1) throw abortLike(); // попытка 1: ответ потерян (таймаут/abort)
      return Promise.resolve(new Response(JSON.stringify({ id: 'dedup-client-test' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      })); // попытка 2: сервер вернул (реально — дедуп-хит с существующим id)
    });

    const ok1 = await useGameStore.getState().saveGame();
    expect(ok1).toBe(false);
    const ok2 = await useGameStore.getState().saveGame();
    expect(ok2).toBe(true);
    expect(useGameStore.getState().currentSaveId).toBe('dedup-client-test');

    expect(fetchStub.calls.length).toBe(2);
    const h1 = requestHeader(fetchStub.calls[0]!, 'x-save-request-id');
    const h2 = requestHeader(fetchStub.calls[1]!, 'x-save-request-id');
    expect(h1).toBeDefined();
    expect(isPlausibleSaveRequestId(h1 ?? null)).toBe(true);
    expect(h2).toBe(h1); // тот же ID → сервер вернёт существующую запись, дубля нет
  });

  test('C2. после УСПЕШНОГО сохранения ID освобождён: следующий Save — новый requestId', async () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
    let counter = 0;
    fetchStub = recordFetch(() => {
      counter += 1;
      return Promise.resolve(new Response(JSON.stringify({ id: `dedup-client-${counter}` }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));
    });

    await useGameStore.getState().saveGame();
    await useGameStore.getState().saveGame();

    expect(fetchStub.calls.length).toBe(2);
    const h1 = requestHeader(fetchStub.calls[0]!, 'x-save-request-id');
    const h2 = requestHeader(fetchStub.calls[1]!, 'x-save-request-id');
    expect(h1).toBeDefined();
    expect(h2).toBeDefined();
    expect(h2).not.toBe(h1); // новая операция — новый ID
  });

  test('C3. замена сессии (newGame) сбрасывает pending ID: ID не переезжает в чужую игру', async () => {
    useGameStore.getState().newGame({ seed: 42, systemCount: 5 });

    let counter = 0;
    fetchStub = recordFetch(() => {
      counter += 1;
      if (counter === 1) throw abortLike(); // сбой первой попытки (ID запоминается)
      return Promise.resolve(new Response(JSON.stringify({ id: `dedup-epoch-${counter}` }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      }));
    });

    await useGameStore.getState().saveGame(); // false, pending ID запомнен (сессия A)
    const failedId = requestHeader(fetchStub.calls[0]!, 'x-save-request-id');
    expect(failedId).toBeDefined();

    // Владелец выходит из зависшей игры и начинает НОВУЮ (замена сессии).
    useGameStore.getState().newGame({ seed: 777, systemCount: 5 });
    await useGameStore.getState().saveGame(); // сессия B

    const secondId = requestHeader(fetchStub.calls[1]!, 'x-save-request-id');
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(failedId); // ID старой сессии НЕ переиспользован
  });
});
