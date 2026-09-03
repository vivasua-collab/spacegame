/// <reference types="bun-types" />
/**
 * Block 08 — API save route tests (zod validation + rate limiting).
 *
 * Tests (matches Block 08 spec from `08_27_block_08_security_data.md` §3.6):
 *   1. Invalid payload (missing `name`) → 400 + structured zod issues.
 *   2. Valid payload → 200 + creates a record in the DB.
 *   3. Rate limit: 11th request from the same IP → 429 + `Retry-After: 60` header.
 *   4. Invalid JSON body → 400 + `Invalid JSON body` error.
 *   5. State size over the 50 MB limit → 400.
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

  // ─── Test 2: valid payload → 200 + creates record ───────────────────

  test('2. Valid payload → 200 + creates record', async () => {
    const req = makePostRequest(validPayload(), '5.6.7.8');
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json() as { id: string; name: string; seed: number; tick: number; version: number };
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe('string');
    expect(data.name).toBe('Block08TestSave');
    expect(data.seed).toBe(42);
    expect(data.tick).toBe(0);
    expect(data.version).toBe(1);

    // Track for cleanup.
    createdIds.push(data.id);
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
      expect(res.status).toBe(200);
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
});
