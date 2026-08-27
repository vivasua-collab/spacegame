/**
 * Block 08 (audit §2.3, gap-9) — Zod-схема для сериализованного GameState.
 *
 * `serializeGameState(state)` в `src/stores/game-store.ts` выпиливает
 * `galaxy.systemMap` (Map) и `galaxy.bakedModel` (regenerated on load),
 * а `productionQueues` (Map) превращает в массив пар `[id, queue]`.
 * Значит, схема валидирует именно SERIALIZED форму — то, что лежит в JSON
 * в колонке `state` таблицы `GameSave`.
 *
 * Per audit recommendation: «начать с валидации верхнего уровня, глубокую
 * валидацию — на Etap 4». Top-level fields (`time`, `speed`, `phase`,
 * `galaxy.id`, `galaxy.seed`, `galaxy.systems`, `productionQueues`,
 * `fleets`, `playerFactionId`) get strict validation; nested planet/system
 * shapes are validated loosely (z.unknown() + presence check) — Etap 4 can
 * tighten this once Planet/System types are stable.
 *
 * Migration:
 *   - v1 (current): top-level validation only.
 *   - v2+ (future): nested planet/system/resource validation.
 */

import { z } from 'zod';

/** v1 time format — `tick` + `dayInYear` + `year`. */
const GameTimeV1Schema = z.object({
  tick: z.number().int().nonnegative(),
  dayInYear: z.number().int().nonnegative().max(364),
  year: z.number().int().positive(),
});

/**
 * v0 time format — used `time.day` instead of `time.dayInYear`.
 * `deserializeGameState` migrates this on load (dayInYear = day % 365).
 */
const GameTimeV0Schema = z.object({
  tick: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  year: z.number().int().positive(),
});

const GameTimeSchema = z.union([GameTimeV1Schema, GameTimeV0Schema]);

const GameSpeedSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(5),
  z.literal(15),
  z.literal(50),
]);

const GamePhaseSchema = z.enum([
  'menu',
  'colonization',
  'playing',
  'paused',
]);

/**
 * Serialized galaxy — `systemMap` and `bakedModel` are STRIPPED by
 * `serializeGameState` (rebuilt on load). We require `id`, `seed`, and
 * `systems` (array, may be empty for forward-compat test fixtures).
 * The remaining galaxy fields are passthrough — top-level validation
 * only, per audit recommendation.
 */
const SerializedGalaxySchema = z.object({
  id: z.string().min(1),
  seed: z.number(),
  systems: z.array(z.unknown()),
}).passthrough();

/**
 * `productionQueues` — serialized as an array of `[planetId, queue]` pairs
 * (Map.entries() output). Each pair is a 2-tuple; we validate the array
 * structure + first element being a string (planetId). The queue payload
 * is z.unknown() — top-level validation only.
 */
const ProductionQueuesSchema = z.array(
  z.tuple([z.string(), z.unknown()]),
);

/**
 * Top-level serialized GameState schema (v1).
 *
 * `passthrough()` on the root object — extra fields are tolerated (forward
 * compat: if a future version adds `version: 2` etc., the v1 schema still
 * parses successfully, allowing migration logic to handle the upgrade).
 */
export const SerializedGameStateSchema = z.object({
  time: GameTimeSchema,
  speed: GameSpeedSchema,
  phase: GamePhaseSchema,
  galaxy: SerializedGalaxySchema,
  productionQueues: ProductionQueuesSchema,
  fleets: z.array(z.unknown()),
  playerFactionId: z.string(),
}).passthrough();

/**
 * Validates a raw JSON string against the SerializedGameStateSchema.
 *
 * Returns `{ success: true, data }` if the JSON parses AND conforms to the
 * schema; otherwise `{ success: false, error }` where `error` is either
 * a SyntaxError (from JSON.parse) or a ZodError (from schema mismatch).
 *
 * Used by `deserializeGameState` in `src/stores/game-store.ts` (Block 08
 * gap-9 fix) — on failure, the deserializer logs the issues and falls back
 * to returning the parsed-as-is object (backward compat).
 */
export function validateGameState(json: string):
  | { success: true; data: unknown }
  | { success: false; error: unknown } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { success: false, error: e };
  }
  const result = SerializedGameStateSchema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
