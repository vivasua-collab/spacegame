/// <reference types="bun-types" />
/**
 * Аудит 2026-10-29 (обратная связь владельца по системе сейвов) — регрессия
 * на два дефекта миграции формата v4 (ORE-POOLS-RUNTIME-01 / Issue #25):
 *
 *   Д1. Метаданные БД сообщали неправильную версию формата: POST /api/save
 *       и PUT /api/save/[id] хардкодили `version: 1` при фактическом
 *       state в формате v4 (маркер fmt:4 пишется compactSaveV4).
 *       Фикс: GameSave.version зеркалит фактический маркер fmt состояния
 *       (declaredFormatVersion); payload без маркера — legacy-дефолт 1.
 *
 *   Д2. Сообщение об ошибке загрузки не соответствовало v4: тост в page.tsx
 *       сообщал «v1/v2 не поддерживаются» — остаток эпохи v3 (при fmt=4
 *       отвергаются v1/v2/v3). Фикс: текст строится из модуля формата
 *       (rejectedLegacyVersionsLabel) и не может протухнуть снова.
 *
 * Strategy: как tests/api-save.test.ts — прямой вызов хендлеров POST/PUT
 * с синтетическими Request, реальный Prisma-клиент, очистка в afterEach.
 *
 * Run: bun test tests/save-metadata-v4.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { POST } from '@/app/api/save/route';
import { PUT } from '@/app/api/save/[id]/route';
import { __resetRateLimitBucketsForTesting } from '@/lib/rate-limit';
import { db } from '@/lib/db';
import {
  SAVE_FORMAT_VERSION,
  REJECTED_LEGACY_FORMAT_VERSIONS,
  rejectedLegacyVersionsLabel,
  declaredFormatVersion,
} from '@/lib/save-format-v4';

/** Минимальный v4-state: для метаданных важен ТОЛЬКО маркер fmt. */
const V4_STATE = JSON.stringify({ fmt: SAVE_FORMAT_VERSION });

function makeRequest(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
  ip: string,
): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

/** RouteContext для прямого вызова PUT (params — Promise в Next 15+). */
function makeRouteContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('Аудит 2026-10-29 · Д1: метаданные БД = фактическая версия формата', () => {
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
        console.warn('save-metadata-v4 cleanup failed:', e);
      }
    }
  });

  test('Д1-a: POST с state fmt:4 → в БД записывается version=4 (было: 1)', async () => {
    const res = await POST(makeRequest(
      'http://localhost/api/save',
      'POST',
      { name: 'MetaV4-POST', seed: 42, state: V4_STATE, tick: 7 },
      '30.30.30.1',
    ));
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    createdIds.push(id);

    const row = await db.gameSave.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.version).toBe(SAVE_FORMAT_VERSION); // 4 — регрессия
    expect(row!.state).toContain('"fmt":4');
  });

  test('Д1-b: POST с state без маркера fmt → legacy-дефолт version=1', async () => {
    // Метаданные не выдумывают версию: записано ровно то, что объявлено.
    // (Историческое поведение — совпадает с default(1) колонки и
    // tests/api-save.test.ts «Valid payload».)
    const res = await POST(makeRequest(
      'http://localhost/api/save',
      'POST',
      { name: 'MetaLegacy-POST', seed: 43, state: '{}', tick: 0 },
      '30.30.30.2',
    ));
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    createdIds.push(id);

    const row = await db.gameSave.findUnique({ where: { id } });
    expect(row!.version).toBe(1);
  });

  test('Д1-c: PUT обновляет version 1→4 при перезаписи legacy-строки v4-state (было: хардкод 1 «unchanged on PUT»)', async () => {
    // Легаси-строка домиграционная: state без маркера, version=1.
    const legacy = await db.gameSave.create({
      data: { name: 'MetaLegacy-Row', seed: 44, state: '{"old":true}', version: 1, tick: 3 },
    });
    createdIds.push(legacy.id);

    const res = await PUT(
      makeRequest(
        `http://localhost/api/save/${legacy.id}`,
        'PUT',
        { state: V4_STATE, tick: 10 },
        '30.30.30.3',
      ),
      makeRouteContext(legacy.id),
    );
    expect(res.status).toBe(200);

    const row = await db.gameSave.findUnique({ where: { id: legacy.id } });
    // PUT заменяет state целиком → метаданные описывают НОВЫЙ state.
    expect(row!.version).toBe(SAVE_FORMAT_VERSION); // 4 — регрессия
    expect(row!.tick).toBe(10);
    expect(row!.state).toContain('"fmt":4');
  });

  test('Д1-d: PUT с state без маркера → version остаётся 1 (не выдумываем v4)', async () => {
    const row0 = await db.gameSave.create({
      data: { name: 'MetaJunk-Row', seed: 45, state: '{"fmt":4}', version: 4, tick: 0 },
    });
    createdIds.push(row0.id);

    const res = await PUT(
      makeRequest(
        `http://localhost/api/save/${row0.id}`,
        'PUT',
        { state: '{"anything":1}', tick: 1 },
        '30.30.30.4',
      ),
      makeRouteContext(row0.id),
    );
    expect(res.status).toBe(200);

    const row = await db.gameSave.findUnique({ where: { id: row0.id } });
    expect(row!.version).toBe(1);
  });

  test('Д1-e: declaredFormatVersion — честное зеркало маркера fmt', () => {
    expect(declaredFormatVersion({ fmt: 4 })).toBe(4);
    expect(declaredFormatVersion({ fmt: 3 })).toBe(3); // храним как есть; загрузка отклонит fmt≠4
    expect(declaredFormatVersion({ fmt: 2 })).toBe(2);
    expect(declaredFormatVersion({})).toBe(1); // нет маркера — legacy-дефолт
    expect(declaredFormatVersion({ fmt: '4' })).toBe(1); // строка — не версия
    expect(declaredFormatVersion({ fmt: 0 })).toBe(1); // версии начинаются с 1
    expect(declaredFormatVersion({ fmt: 4.5 })).toBe(1); // не целое
    expect(declaredFormatVersion(null)).toBe(1);
    expect(declaredFormatVersion(undefined)).toBe(1);
    expect(declaredFormatVersion('not-an-object')).toBe(1);
  });
});

describe('Аудит 2026-10-29 · Д2: сообщение об ошибке загрузки соответствует v4', () => {
  test('Д2-a: список отвергаемых версий = v1..v{N-1} (при v4 — [1,2,3])', () => {
    expect(REJECTED_LEGACY_FORMAT_VERSIONS).toEqual([1, 2, 3]);
    // Производность: при смене SAVE_FORMAT_VERSION список обновится сам.
    expect(REJECTED_LEGACY_FORMAT_VERSIONS.length).toBe(SAVE_FORMAT_VERSION - 1);
    expect(Math.max(...REJECTED_LEGACY_FORMAT_VERSIONS)).toBe(SAVE_FORMAT_VERSION - 1);
    expect(REJECTED_LEGACY_FORMAT_VERSIONS).not.toContain(SAVE_FORMAT_VERSION);
  });

  test('Д2-b: rejectedLegacyVersionsLabel = «v1/v2/v3» (тост в page.tsx)', () => {
    // Регрессия: до фикса тост сообщал «v1/v2» — остаток эпохи v3.
    expect(rejectedLegacyVersionsLabel()).toBe('v1/v2/v3');
    // Строка тоста page.tsx собирается ровно так (формат «vN/vN...»).
    expect(`(${rejectedLegacyVersionsLabel()} не поддерживаются)`).toBe('(v1/v2/v3 не поддерживаются)');
  });

  test('Д2-c: expandSaveV4 отклоняет каждую легаси-версию явной ошибкой с fmt в тексте', async () => {
    const { expandSaveV4 } = await import('@/lib/save-format-v4');
    for (const v of REJECTED_LEGACY_FORMAT_VERSIONS) {
      let err: unknown;
      try {
        expandSaveV4({ fmt: v } as Record<string, unknown>);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(`fmt=${v}`);
      expect((err as Error).message).toContain(`ожидается ${SAVE_FORMAT_VERSION}`);
    }
  });
});
