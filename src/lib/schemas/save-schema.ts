/**
 * Block 08 (audit §2.3, gap-8) — Zod-схемы для API /api/save.
 *
 * Все POST/PUT в `src/app/api/save/*` валидируются этими схемами перед
 * попаданием в Prisma. Это закрывает audit gap-8: «API routes без валидации»
 * — клиент больше не может положить `state > 50 МБ` (DoS) или произвольный
 * тип в `name`/`seed`/`tick`.
 *
 * NOTE on seed type deviation from the original spec:
 *  - The Block 08 checkpoint proposed `seed: z.string().regex(/^[a-zA-Z0-9_-]+$/)`
 *    + `seed String @index` in Prisma. However, the existing codebase uses
 *    `galaxy.seed: number` everywhere (PRNG inputs, GalaxyGenConfig, baked
 *    model), and the existing DB rows already have `seed Int`. Changing the
 *    type to String would (a) be a destructive SQLite migration and (b)
 *    require touching unrelated subsystems (galaxy, PRNG, chemistry).
 *  - The audit's actual concern was MISSING INDEXES + MISSING VERSION field
 *    (gap-9). The seed-type was illustrative in the checkpoint. We keep
 *    `seed Int` (32-bit, nonnegative) — backward compatible with existing
 *    data + existing `saveGame`/`loadGame` client code in `game-store.ts`.
 *
 * Run: see tests/api-save.test.ts
 */

import { z } from 'zod';
import { MAX_ENCODED_STATE_CHARS, type StateEncoding } from '@/lib/save-codec-server';

/** Maximum serialized state size — 50 MB. Limits memory pressure on save. */
export const MAX_STATE_BYTES = 50_000_000;

/**
 * R-26 (2026-08-31): транспортная кодировка поля `state`.
 * 'gzip-base64' — клиент сжал state (шлюз ограничивает тело запроса 32 МБ);
 * сервер декодирует ДО проверки лимита (реальный лимит — на raw JSON).
 * См. src/lib/save-codec-server.ts.
 */
export const StateEncodingSchema = z.enum(['json', 'gzip-base64'] as const satisfies readonly StateEncoding[]);

/** Maximum tick value — 10 000 000 (≈ 27 397 years of game time at 1 tick = 1 day). */
export const MAX_TICK = 10_000_000;

/** Maximum name length — 100 chars. */
export const MAX_NAME_LENGTH = 100;

/**
 * POST /api/save — create a new save.
 *
 * `name` is required (1–100 chars), `seed` is a nonnegative 32-bit int,
 * `state` is an optional JSON-string ≤ 50 MB, `tick` is optional nonnegative
 * int ≤ 10 000 000.
 *
 * The existing `saveGame` client action always sends `name` + `seed` + `state`
 * + `tick`, but we allow `state`/`tick` to be optional for forward compat
 * (e.g. creating a placeholder save without serialized state).
 */
export const SaveCreateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  seed: z.number().int().nonnegative().max(2_000_000_000), // 32-bit signed int range
  state: z.string().max(MAX_ENCODED_STATE_CHARS).optional(),
  stateEncoding: StateEncodingSchema.optional(),
  settings: z.string().max(1_000_000).optional(), // GalaxyGenConfig JSON, kept for backward compat
  tick: z.number().int().nonnegative().max(MAX_TICK).optional(),
});

/**
 * PUT /api/save/[id] — update an existing save.
 *
 * `name` is optional (1–100 chars), `state` is REQUIRED (≤ 50 MB), `tick`
 * is REQUIRED (nonnegative int ≤ 10 000 000). Per the spec, PUT always
 * writes a new tick + state — that's what `saveGame` does when
 * `currentSaveId` is set.
 */
export const SaveUpdateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  state: z.string().max(MAX_ENCODED_STATE_CHARS),
  stateEncoding: StateEncodingSchema.optional(),
  tick: z.number().int().nonnegative().max(MAX_TICK),
  settings: z.string().max(1_000_000).optional(),
});

export type SaveCreateInput = z.infer<typeof SaveCreateSchema>;
export type SaveUpdateInput = z.infer<typeof SaveUpdateSchema>;
