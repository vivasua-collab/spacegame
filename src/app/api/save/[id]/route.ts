import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SaveUpdateSchema } from '@/lib/schemas/save-schema';
import { checkRateLimit } from '@/lib/rate-limit';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/save/[id] — load a save.
 *
 * Not rate-limited (read-only). Returns the full save row including the
 * serialized `state` JSON blob — the client deserializes it via
 * `deserializeGameState` (which runs zod validation on the blob, see
 * Block 08 gap-9).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const save = await db.gameSave.findUnique({ where: { id } });
    if (!save) {
      return NextResponse.json({ error: 'Save not found' }, { status: 404 });
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
 *      state REQUIRED ≤ 50 MB, tick REQUIRED ≤ 10 000 000).
 *
 * The client `saveGame` action in `src/stores/game-store.ts` always sends
 * `{ name, state, tick }` when `currentSaveId` is set.
 */
export async function PUT(request: Request, context: RouteContext) {
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
    const { name, state, tick, settings } = parsed.data;

    // Build the Prisma update payload — only include `name` if provided.
    const data: { state: string; tick: number; version: number; name?: string; settings?: string } = {
      state,
      tick,
      version: 1, // current serialization format version (unchanged on PUT)
    };
    if (name !== undefined) data.name = name;
    if (settings !== undefined) data.settings = settings;

    const save = await db.gameSave.update({ where: { id }, data });
    return NextResponse.json(save);
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
    await db.gameSave.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Failed to delete save:', e);
    return NextResponse.json({ error: 'Failed to delete save' }, { status: 500 });
  }
}
