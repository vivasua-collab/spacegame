import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SaveUpdateSchema } from '@/lib/schemas/save-schema';
import { checkRateLimit } from '@/lib/rate-limit';
import { decodeStatePayload, encodeStatePayload, STATE_ENCODING_THRESHOLD, StateTooLargeDuringDecodingError } from '@/lib/save-codec-server';
import { MAX_STATE_BYTES } from '@/lib/schemas/save-schema';
import { declaredFormatVersion } from '@/lib/save-format-v4';
import { isPlausibleSaveRequestId } from '@/lib/save-request-dedup';
import type { Prisma } from '@prisma/client';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/save/[id] — load a save.
 *
 * Not rate-limited (read-only). Returns the full save row including the
 * serialized `state` JSON blob — the client deserializes it via
 * `deserializeGameState` (which runs zod validation on the blob, see
 * Block 08 gap-9).
 *
 * R-26 (2026-08-31): если `state` больше STATE_ENCODING_THRESHOLD (512 КБ),
 * ответ отдаётся сжатым — `{ ..., state: base64(gzip), stateEncoding:
 * 'gzip-base64' }` (ответ тоже проходит через шлюз с лимитом тела).
 * Клиент (`loadGame`) декодирует через gunzipBase64; малые сейвы —
 * прежний plain JSON (обратная совместимость).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const save = await db.gameSave.findUnique({ where: { id } });
    if (!save) {
      return NextResponse.json({ error: 'Save not found' }, { status: 404 });
    }
    if (save.state.length > STATE_ENCODING_THRESHOLD) {
      return NextResponse.json({ ...save, ...encodeStatePayload(save.state) });
    }
    return NextResponse.json(save);
  } catch (e) {
    console.error('Failed to load save:', e);
    return NextResponse.json({ error: 'Failed to load save' }, { status: 500 });
  }
}

/**
 * PUT /api/save/[id] — update an existing save.
 *
 * Block 08 (audit §2.3, gap-8 + gap-9):
 *   1. Rate limit: 10 requests / minute / IP (token bucket).
 *      On exhaustion → 429 + `Retry-After: 60`.
 *   2. Body validation: zod `SaveUpdateSchema` (name optional 1–100 chars,
 *      state REQUIRED ≤ 50 MB raw, tick REQUIRED ≤ 10 000 000).
 *
 * R-26 (2026-08-31): `state` может приходить в `gzip-base64` (см. POST).
 * В БД хранится plain JSON; GameSave.version зеркалит фактический маркер
 * fmt НОВОГО state (аудит 2026-10-29: раньше хардкодился 1 «unchanged on
 * PUT» — вдвойне неверно, PUT заменяет state целиком).
 *
 * The client `saveGame` action in `src/stores/game-store.ts` always sends
 * `{ name, state, stateEncoding?, tick }` when `currentSaveId` is set.
 */
export async function PUT(request: Request, context: RouteContext) {
  // ─── CORE-SAVE-01 (Issue #18): старт-лог ДО любых await ──────────
  // См. комментарий в POST /api/save: делает зависший запрос видимым
  // в логе мгновенно (строка старта без строки завершения).
  // ─── CORE-SAVE-REPRO-01 (Issue #27 §4): requestId для корреляции
  // этапов. PUT идемпотентен по ID записи естественно — дедуп не нужен.
  const rawRequestId = request.headers.get('x-save-request-id');
  const requestId = isPlausibleSaveRequestId(rawRequestId) ? rawRequestId : null;
  console.log(
    `[save-api] PUT /api/save/[id] start: content-length=${request.headers.get('content-length') ?? 'unknown'}, requestId=${requestId ?? '-'}`,
  );
  // ─── Rate limit (gap-8) ────────────────────────────────────────────
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`save:${ip}`)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  try {
    const { id } = await context.params;

    // ─── Body validation (gap-8) ────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parsed = SaveUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          issues: parsed.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
            code: i.code,
          })),
        },
        { status: 400 },
      );
    }
    const { name, state, stateEncoding, tick, settings } = parsed.data;

    // ─── R-26: декодирование транспорта (gzip-base64 → plain JSON) ────
    // Аудит 2026-10-26 (этап 0–1): потоковая распаковка с РАННИМ лимитом
    // байтов — как в POST (gzip-бомба отклоняется в процессе декодирования).
    const tDecode0 = Date.now();
    let stateJson: string;
    try {
      stateJson = await decodeStatePayload(state, stateEncoding, MAX_STATE_BYTES);
    } catch (e) {
      if (e instanceof StateTooLargeDuringDecodingError) {
        return NextResponse.json(
          { error: `State too large during decoding (max ${MAX_STATE_BYTES} bytes)` },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: 'Invalid state payload: malformed gzip/base64' },
        { status: 400 },
      );
    }
    // CORE-SAVE-01 (Issue #18): метрика декодирования (как в POST).
    console.log(
      `[save-api] PUT /api/save/${id} decoded: raw=${Buffer.byteLength(stateJson, 'utf8')} bytes, decodeMs=${Date.now() - tDecode0}`,
    );
    // R-31: считаем байты UTF-8, а не символы (как в POST /api/save).
    // (gzip-путь уже ограничен потоком; эта проверка — для plain-JSON пути)
    const stateBytes = Buffer.byteLength(stateJson, 'utf8');
    if (stateBytes > MAX_STATE_BYTES) {
      return NextResponse.json(
        { error: `State too large after decoding: ${stateBytes} bytes (max ${MAX_STATE_BYTES})` },
        { status: 400 },
      );
    }

    // ─── Аудит 2026-10-26: state обязан быть валидным JSON-объектом ───
    let parsedState: unknown;
    try {
      parsedState = JSON.parse(stateJson);
      if (typeof parsedState !== 'object' || parsedState === null || Array.isArray(parsedState)) {
        throw new Error('not an object');
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid state payload: state must be a valid JSON object' },
        { status: 400 },
      );
    }

    // ─── Аудит 2026-10-29: метаданные = фактическая версия формата ────
    // PUT заменяет state целиком → version описывает НОВЫЙ state (текущий
    // клиент пишет v4). Обновление старой строки (version:1) v4-сейвом
    // корректно меняет метаданные на 4.
    const version = declaredFormatVersion(parsedState);

    // Build the Prisma update payload — only include `name` if provided.
    const data: { state: string; tick: number; version: number; name?: string; settings?: string } = {
      state: stateJson,
      tick,
      version, // фактический fmt нового state (аудит 2026-10-29)
    };
    if (name !== undefined) data.name = name;
    if (settings !== undefined) data.settings = settings;

    // Аудит 2026-10-26: несуществующий id → 404 (раньше Prisma P2025
    // падал в общий catch → 500, маскируя причину).
    let save;
    try {
      save = await db.gameSave.update({ where: { id }, data });
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        return NextResponse.json({ error: 'Save not found' }, { status: 404 });
      }
      throw e;
    }
    // Аудит 2026-10-26: минимальный ответ — клиент проверяет только res.ok
    // (раньше возвращалась полная запись с несжатым state — 3.29 МБ).
    return NextResponse.json({ success: true, id: save.id, updatedAt: save.updatedAt });
  } catch (e) {
    console.error('Failed to update save:', e);
    return NextResponse.json({ error: 'Failed to update save' }, { status: 500 });
  }
}

/**
 * DELETE /api/save/[id] — delete a save.
 *
 * Not rate-limited (idempotent + low cost — single row delete by id).
 * Returns `{ success: true }` on success, 500 on Prisma failure.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    // Аудит 2026-10-26: несуществующий id → 404 (раньше P2025 → 500).
    try {
      await db.gameSave.delete({ where: { id } });
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        return NextResponse.json({ error: 'Save not found' }, { status: 404 });
      }
      throw e;
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Failed to delete save:', e);
    return NextResponse.json({ error: 'Failed to delete save' }, { status: 500 });
  }
}
