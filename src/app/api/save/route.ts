import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SaveCreateSchema } from '@/lib/schemas/save-schema';
import { checkRateLimit } from '@/lib/rate-limit';
import { decodeStatePayload, StateTooLargeDuringDecodingError } from '@/lib/save-codec-server';
import { MAX_STATE_BYTES } from '@/lib/schemas/save-schema';

/**
 * GET /api/save — list all saves.
 *
 * Not rate-limited (read-only, low cost; SQLite handles the orderBy index
 * lookup in microseconds). Returns the save list shown in the load-game UI.
 */
export async function GET() {
  try {
    const saves = await db.gameSave.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        seed: true,
        tick: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json(saves);
  } catch (e) {
    console.error('Failed to list saves:', e);
    return NextResponse.json({ error: 'Failed to list saves' }, { status: 500 });
  }
}

/**
 * POST /api/save — create a new save.
 *
 * Block 08 (audit §2.3, gap-8 + gap-9):
 *   1. Rate limit: 10 requests / minute / IP (token bucket).
 *      On exhaustion → 429 + `Retry-After: 60`.
 *   2. Body validation: zod `SaveCreateSchema` (name 1–100 chars, seed int,
 *      state ≤ 50 MB raw, tick ≤ 10 000 000). On validation failure → 400 with
 *      structured zod issues.
 *
 * R-26 (2026-08-31): `state` может приходить в кодировке `gzip-base64`
 * (`stateEncoding`) — сериализованное состояние 200-системной галактики
 * ~31 МБ превышает лимит шлюза 32 МБ (EntityTooLarge). Сервер декодирует
 * ДО проверки лимита (лимит применяется к raw JSON) и хранит в БД
 * plain JSON (version 1, совместимость с существующими сейвами).
 *
 * The client `saveGame` action in `src/stores/game-store.ts` always sends
 * `{ name, seed, state, stateEncoding?, tick }` — all within the schema's accepted shape.
 */
export async function POST(request: Request) {
  // ─── Rate limit (gap-8) ────────────────────────────────────────────
  // `x-forwarded-for` is set by Caddy in production. In dev (direct Next
  // server access), it's absent — fall back to 'unknown' so all dev
  // requests share a single bucket (10 req/min — plenty for one developer).
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(`save:${ip}`)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  try {
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

    const parsed = SaveCreateSchema.safeParse(body);
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
    const { name, seed, state, stateEncoding, settings, tick } = parsed.data;

    // ─── R-26: декодирование транспорта (gzip-base64 → plain JSON) ────
    // Аудит 2026-10-26 (этап 0–1): потоковая распаковка с РАННИМ лимитом
    // байтов — gzip-бомба отклоняется в процессе декодирования (расход
    // памяти ≤ MAX_STATE_BYTES), а не после полного разворачивания.
    let stateJson: string;
    try {
      stateJson = await decodeStatePayload(state ?? '{}', stateEncoding, MAX_STATE_BYTES);
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
    // Реальный лимит — на raw JSON (после декодирования), Block 08 gap-8.
    // R-31: считаем байты UTF-8, а не символы (многобайтовые юникод-строки
    // раздули бы фактический размер до 4× без этой проверки).
    // (gzip-путь уже ограничен потоком; эта проверка — для plain-JSON пути)
    const stateBytes = Buffer.byteLength(stateJson, 'utf8');
    if (stateBytes > MAX_STATE_BYTES) {
      return NextResponse.json(
        { error: `State too large after decoding: ${stateBytes} bytes (max ${MAX_STATE_BYTES})` },
        { status: 400 },
      );
    }

    // ─── Аудит 2026-10-26: state обязан быть валидным JSON-объектом ───
    // Раньше сервер сохранял любой декодируемый мусор («this is not json» — 200 OK),
    // и ошибка обнаруживалась только при загрузке (молчаливая порча сейва).
    try {
      const parsedState: unknown = JSON.parse(stateJson);
      if (typeof parsedState !== 'object' || parsedState === null || Array.isArray(parsedState)) {
        throw new Error('not an object');
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid state payload: state must be a valid JSON object' },
        { status: 400 },
      );
    }

    // ─── Persist (в БД — plain JSON, version 1) ─────────────────────
    const save = await db.gameSave.create({
      data: {
        name,
        seed,
        settings: settings ?? '{}',
        state: stateJson,
        tick: tick ?? 0,
        version: 1, // current serialization format version
      },
    });

    // Аудит 2026-10-26: минимально необходимый ответ. Раньше возвращалась
    // ПОЛНАЯ запись (включая несжатый state — замер: 3.29 МБ ответа на
    // каждое сохранение 200-системной галактики при 871 КБ запроса),
    // хотя клиенту для нового сохранения нужен только id.
    return NextResponse.json({ id: save.id }, { status: 201 });
  } catch (e) {
    console.error('Failed to create save:', e);
    return NextResponse.json({ error: 'Failed to create save' }, { status: 500 });
  }
}
