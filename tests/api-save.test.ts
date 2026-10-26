/// <reference types="bun-types" />
/**
 * Block 08 — API save route tests (zod validation + rate limiting).
 *
 * Tests (matches Block 08 spec from `08_27_block_08_security_data.md` §3.6
 * + аудит 2026-10-26, этап 0–1):
 *   1. Invalid payload (missing `name`) → 400 + structured zod issues.
 *   2. Valid payload → 201 + minimal `{ id }` response + creates record in the DB
 *      (аудит 2026-10-26: раньше возвращалась полная запись с несжатым state).
 *   3. Rate limit: 11th request from the same IP → 429 + `Retry-After: 60` header.
 *   4. Invalid JSON body → 400 + `Invalid JSON body` error.
 *   5. State size over the 50 MB limit → 400.
 *   6. Аудит 2026-10-26: state не являющийся JSON-объектом → 400 (не сохранять мусор).
 *   7. Аудит 2026-10-26: gzip-бомба → быстрый 400 В ПРОЦЕССЕ декодирования.
 *   8. Аудит 2026-10-26: ответ минимален — только id.
 *
 * Strategy:
 *   - Directly import `POST` handler from `src/app/api/save/route.ts` and
 *     call it with synthetic Request objects — avoids spinning up a Next.js
 *     server in tests.
 *   - Use the real Prisma client (same DB as dev server, but cleanup in
 *     afterEach deletes all records created during the test).
 *   - Reset rate-limit buckets in beforeEach via the test-only helper
 *     `__resetRateLimitBucketsForTesting()` so each test starts with a
 *     fresh bucket state.
 *
 * Run: bun test tests/api-save.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { POST } from '@/app/api/save/route';
import { __resetRateLimitBucketsForTesting } from '@/lib/rate-limit';
import { MAX_STATE_BYTES } from '@/lib/schemas/save-schema';
import { db } from '@/lib/db';

/** Build a synthetic POST Request with optional `x-forwarded-for` header. */
function makePostRequest(body: unknown, ip?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip !== undefined) headers['x-forwarded-for'] = ip;
  return new Request('http://localhost/api/save', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Build a valid base payload (cloned each time so tests can mutate freely). */
function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Block08TestSave', seed: 42, state: '{}', tick: 0, ...overrides };
}

describe('Block 08: API save POST', () => {
  /** IDs created during a single test — deleted in afterEach. */
  let createdIds: string[] = [];

  beforeEach(() => {
    __resetRateLimitBucketsForTesting();
    createdIds = [];
  });

  afterEach(async () => {
    if (createdIds.length > 0) {
      try {
        await db.gameSave.deleteMany({ where: { id: { in: createdIds } } });
      } catch (e) {
        console.warn('Block 08 API save test: cleanup failed:', e);
      }
    }
  });

  // ─── Test 1: invalid payload → 400 ─────────────────────────────────

  test('1. Invalid payload (missing name) → 400 + zod issues', async () => {
    // Drop `name` from the payload — should fail SaveCreateSchema validation.
    const req = makePostRequest({ seed: 42, state: '{}', tick: 0 }, '1.2.3.4');
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: Array<{ path: PropertyKey[]; message: string; code: string }> };
    expect(body.error).toBe('Invalid input');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);

    // Confirm the failure is specifically about the missing `name` field.
    const nameIssue = body.issues.find((i) => i.path.includes('name'));
    expect(nameIssue).toBeDefined();
  });

  // ─── Test 2: valid payload → 201 + minimal { id } + creates record ──

  test('2. Valid payload → 201 + минимальный ответ { id } + создаёт запись в БД', async () => {
    const req = makePostRequest(validPayload(), '5.6.7.8');
    const res = await POST(req);

    // Аудит 2026-10-26: 201 Created + минимальный ответ (клиенту нужен только id)
    expect(res.status).toBe(201);
    const data = await res.json() as { id?: string; state?: unknown; [k: string]: unknown };
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe('string');
    // Минимальность: в ответе НЕ должно быть тяжёлых полей записи
    expect(data.state).toBeUndefined();

    // Полнота данных — проверяем в самой БД, а не в ответе
    const row = await db.gameSave.findUnique({ where: { id: data.id! } });
    expect(row?.name).toBe('Block08TestSave');
    expect(row?.seed).toBe(42);
    expect(row?.tick).toBe(0);
    expect(row?.version).toBe(1);

    // Track for cleanup.
    createdIds.push(data.id!);
  });

  // ─── Test 3: rate limit → 429 + Retry-After ─────────────────────────

  test('3. Rate limit: 11th request → 429 + Retry-After header', async () => {
    // Use a fixed IP unique to this test (bucket is reset in beforeEach).
    const ip = '9.10.11.12';

    // The first 10 requests should succeed (bucket starts with 10 tokens,
    // refilling at 10/min — so 10 immediate requests are within budget).
    for (let i = 0; i < 10; i++) {
      const req = makePostRequest(
        validPayload({ name: `Block08RateLimit-${i}` }),
        ip,
      );
      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json() as { id: string };
      expect(data.id).toBeDefined();
      createdIds.push(data.id);
    }

    // 11th request — bucket is empty (0 tokens after 10 decrements, no
    // measurable time elapsed to refill). Should return 429.
    const req11 = makePostRequest(
      validPayload({ name: 'Block08RateLimit-11' }),
      ip,
    );
    const res11 = await POST(req11);
    expect(res11.status).toBe(429);
    expect(res11.headers.get('retry-after')).toBe('60');
    const body11 = await res11.json() as { error: string };
    expect(body11.error).toMatch(/rate limit/i);
  });

  // ─── Test 4: invalid JSON body → 400 ───────────────────────────────

  test('4. Invalid JSON body → 400', async () => {
    const req = new Request('http://localhost/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '13.14.15.16' },
      body: 'not-valid-json{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid json/i);
  });

  // ─── Test 5: state size over 50 MB → 400 ───────────────────────────

  test('5. State size > MAX_STATE_BYTES → 400', async () => {
    // R-26 (2026-08-31): raw-лимит 50 МБ теперь проверяется в РОУТЕ после
    // транспортного декодирования (gzip-base64), а не на уровне zod-схемы
    // (схема допускает до 100 МБ символов base64 — см. save-schema.ts и
    // tests/api-save-encoding.test.ts). Семантика та же: oversized state
    // отклоняется с 400, но ответ — 'State too large after decoding'.
    const oversizedState = 'x'.repeat(MAX_STATE_BYTES + 1);
    const req = makePostRequest(
      validPayload({ state: oversizedState }),
      '17.18.19.20',
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('too large');
  });

  // ─── Test 6 (аудит 2026-10-26): мусорный state → 400, не сохраняется ──

  test('6. Аудит: state не-JSON → 400 «must be a valid JSON object»', async () => {
    const req = makePostRequest(
      validPayload({ state: 'this is not json at all, just garbage' }),
      '21.22.23.24',
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('valid JSON object');

    // JSON-массив — тоже не объект-состояние
    const reqArr = makePostRequest(validPayload({ state: '[1,2,3]' }), '21.22.23.25');
    const resArr = await POST(reqArr);
    expect(resArr.status).toBe(400);
  });

  // ─── Test 7 (аудит 2026-10-26): gzip-бомба → ранний отказ ─────────────

  test('7. Аудит: gzip-бомба 60 МБ → быстрый 400 В ПРОЦЕССЕ декодирования', async () => {
    // До фикса: gunzipSync разворачивал весь payload в память ДО проверки
    // лимита (замер: 200 МБ бомба → +533 МБ RSS сервера). Теперь: поток
    // уничтожается при превышении MAX_STATE_BYTES на выходе.
    const { gzipSync } = await import('node:zlib');
    // 60 МБ нулей сжимаются в ~60 КБ — но развернуться должны лишь до лимита 50 МБ
    const bomb = gzipSync(Buffer.alloc(60 * 1024 * 1024)).toString('base64');
    expect(bomb.length).toBeLessThan(200_000); // действительно «бомба»

    const t0 = performance.now();
    const req = makePostRequest(
      validPayload({ state: bomb, stateEncoding: 'gzip-base64' }),
      '25.26.27.28',
    );
    const res = await POST(req);
    const elapsed = performance.now() - t0;

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('too large');
    expect(body.error).toContain('during decoding');
    // Ранний отказ: не тратим время на разворачивание всех 60 МБ — но и не
    // требуем мгновенности (стрим всё же прочитает чуть больше лимита)
    expect(elapsed).toBeLessThan(2000);
  });
});
