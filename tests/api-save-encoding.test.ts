/**
 * R-26 (2026-08-31): тесты сжатого транспорта сохранений (gzip-base64).
 *
 * Проблема: состояние 200-системной галактики ~31 МБ — шлюз отклонял
 * запросы больше 32 МБ (EntityTooLarge; жалоба владельца). Решение:
 * клиент сжимает state (gzip + base64), сервер декодирует и хранит
 * plain JSON; GET отдаёт большие state сжатыми.
 *
 * Проверки:
 *   1. Браузерный кодек (CompressionStream): round-trip + совместимость
 *      с серверным декодером (node:zlib) — один формат RFC 1952.
 *   2. POST c stateEncoding='gzip-base64' → 200, в БД лежит PLAIN JSON.
 *   3. POST: raw > MAX_STATE_BYTES после декодирования → 400.
 *   4. POST: битый base64/gzip → 400, а не 500.
 *   5. PUT c кодировкой → обновление plain.
 *   6. GET: state > 512 КБ → ответ gzip-base64 (декодируется в оригинал);
 *      state < порога — прежний plain (обратная совместимость).
 *
 * Run: bun test tests/api-save-encoding.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { POST } from '@/app/api/save/route';
import { GET as GET_BY_ID, PUT } from '@/app/api/save/[id]/route';
import { __resetRateLimitBucketsForTesting } from '@/lib/rate-limit';
import { MAX_STATE_BYTES } from '@/lib/schemas/save-schema';
import { decodeStatePayload, encodeStatePayload, STATE_ENCODING_THRESHOLD } from '@/lib/save-codec-server';
import { gzipBase64, gunzipBase64, isBrowserCodecAvailable } from '@/lib/save-codec-browser';
import { db } from '@/lib/db';

function makeRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function b64(data: string): string {
  return gzipSync(Buffer.from(data, 'utf-8')).toString('base64');
}

describe('R-26: Кодеки (браузер ↔ сервер, один формат RFC 1952)', () => {
  test('1. Браузерный кодек: round-trip через Web CompressionStream', async () => {
    if (!isBrowserCodecAvailable()) {
      console.warn('CompressionStream недоступен в этом окружении — пропуск');
      return;
    }
    const sample = JSON.stringify({ tick: 42, planets: [{ id: 'p1', g: 0.8 }, { id: 'p2', g: 1.2 }] });
    const encoded = await gzipBase64(sample);
    expect(typeof encoded).toBe('string');
    const decoded = await gunzipBase64(encoded);
    expect(decoded).toBe(sample);
  });

  test('2. Совместимость: браузерный gzip → серверный gunzip и обратно', async () => {
    if (!isBrowserCodecAvailable()) return;
    const sample = 'R-26 cross-codec: браузер сжимает, сервер читает';
    const browserEncoded = await gzipBase64(sample);
    // Серверный декодер (node:zlib) понимает выход CompressionStream
    expect(decodeStatePayload(browserEncoded, 'gzip-base64')).toBe(sample);
    // Серверный кодировщик понимается браузерным декодером
    const serverEncoded = encodeStatePayload(sample);
    expect(await gunzipBase64(serverEncoded.state)).toBe(sample);
    expect(serverEncoded.stateEncoding).toBe('gzip-base64');
  });

  test('3. decodeStatePayload: plain без кодировки — как есть', () => {
    expect(decodeStatePayload('{"a":1}', undefined)).toBe('{"a":1}');
  });
});

describe('R-26: API transport — POST/PUT/GET', () => {
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
        console.warn('R-26 API test: cleanup failed:', e);
      }
    }
  });

  test('4. POST gzip-base64 → 200, в БД хранится PLAIN JSON', async () => {
    const stateJson = JSON.stringify({ galaxy: { seed: 1, systems: [{ id: 's1' }] }, time: { tick: 5 } });
    const req = makeRequest('http://localhost/api/save', {
      name: 'R26EncodedSave',
      seed: 20260831,
      state: b64(stateJson),
      stateEncoding: 'gzip-base64',
      tick: 5,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    createdIds.push(data.id);
    // В БД — plain JSON (version 1, совместимость/инспекция)
    const row = await db.gameSave.findUnique({ where: { id: data.id } });
    expect(row?.state).toBe(stateJson);
    expect(row?.version).toBe(1);
  });

  test('5. POST: raw > MAX_STATE_BYTES после декодирования → 400', async () => {
    // Несжимаемый 51 МБ payload: gzip крошечный, декодер разворачивает 51 МБ
    const huge = 'A'.repeat(MAX_STATE_BYTES + 1);
    const req = makeRequest('http://localhost/api/save', {
      name: 'R26TooLarge',
      seed: 1,
      state: b64(huge),
      stateEncoding: 'gzip-base64',
      tick: 0,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('too large');
  });

  test('6. POST: битый base64/gzip → 400, не 500', async () => {
    const req = makeRequest('http://localhost/api/save', {
      name: 'R26Broken',
      seed: 1,
      state: '###not-base64-gzip###',
      stateEncoding: 'gzip-base64',
      tick: 0,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('malformed');
  });

  test('7. PUT gzip-base64 → обновление plain в БД', async () => {
    // Создаём строку напрямую
    const initial = JSON.stringify({ v: 1 });
    const row = await db.gameSave.create({
      data: { name: 'R26PutTarget', seed: 7, state: initial, tick: 0, version: 1 },
    });
    createdIds.push(row.id);
    const updated = JSON.stringify({ v: 2, note: 'updated via gzip' });
    const req = new Request(`http://localhost/api/save/${row.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: b64(updated), stateEncoding: 'gzip-base64', tick: 9 }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(200);
    const after = await db.gameSave.findUnique({ where: { id: row.id } });
    expect(after?.state).toBe(updated);
    expect(after?.tick).toBe(9);
  });

  test('8. GET: state > порога → gzip-base64 (декодируется в оригинал); малый — plain', async () => {
    // Большой state (600 КБ > 512 КБ порога)
    const bigState = JSON.stringify({ blob: 'x'.repeat(600_000) });
    const big = await db.gameSave.create({
      data: { name: 'R26BigGet', seed: 11, state: bigState, tick: 0, version: 1 },
    });
    createdIds.push(big.id);
    const resBig = await GET_BY_ID(new Request(`http://localhost/api/save/${big.id}`), { params: Promise.resolve({ id: big.id }) });
    expect(resBig.status).toBe(200);
    const dataBig = await resBig.json();
    expect(dataBig.stateEncoding).toBe('gzip-base64');
    expect(decodeStatePayload(dataBig.state, dataBig.stateEncoding)).toBe(bigState);
    // И браузерный декодер его понимает
    if (isBrowserCodecAvailable()) {
      expect(await gunzipBase64(dataBig.state)).toBe(bigState);
    }

    // Малый state — прежний контракт (plain, без stateEncoding)
    const smallState = JSON.stringify({ small: true });
    const small = await db.gameSave.create({
      data: { name: 'R26SmallGet', seed: 12, state: smallState, tick: 0, version: 1 },
    });
    createdIds.push(small.id);
    const resSmall = await GET_BY_ID(new Request(`http://localhost/api/save/${small.id}`), { params: Promise.resolve({ id: small.id }) });
    expect(resSmall.status).toBe(200);
    const dataSmall = await resSmall.json();
    expect(dataSmall.stateEncoding).toBeUndefined();
    expect(dataSmall.state).toBe(smallState);
  });

  test('9. Порог согласован: STATE_ENCODING_THRESHOLD = 512 КБ', () => {
    expect(STATE_ENCODING_THRESHOLD).toBe(512 * 1024);
  });
});
