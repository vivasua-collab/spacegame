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
 * R-26: слои совместимости со старыми форматами удалены (старые сейвы
 * потерты, совместимость не требуется): GameTimeV0 (поле `day` вместо
 * `dayInYear`) и миграции в deserializeGameState убраны. Формат сейва —
 * единственный текущий.
 */

import { z } from 'zod';
import { AI_FACTION_ARCHETYPES, AI_GOAL_KINDS } from '@/ai/factions';
import { AI_DIFFICULTIES } from '@/ai/types';

/** Текущий формат времени — `tick` + `dayInYear` + `year`. */
const GameTimeSchema = z.object({
  tick: z.number().int().nonnegative(),
  dayInYear: z.number().int().nonnegative().max(364),
  year: z.number().int().positive(),
});

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

// ─── Этап 3б.1 (R-44): AI-секция сейва (версионированная) ────────────────
//
// `aiFactions` — постоянный реестр AI-фракций (Record<id, AIFactionState>).
// STRICT-схемы: лишние поля во фракции (например, попытка прокрасти копии
// владений/ресурсов — нарушение ссылочного контракта) отклоняют сейв.
// Семантические инварианты (сумма бюджета ≈ 1, ключ == faction.id) — refine.
// Пишется serializeGameState'ом ТОЛЬКО при непустом реестре вместе с маркером
// `aiFactionsV` (см. serialize/deserialize в game-store). Старые сейвы без
// этих полей валидируются как прежде (поля optional).

const AIBudgetSchema = z.strictObject({
  economy: z.number(),
  military: z.number(),
  research: z.number(),
  trade: z.number(),
  diplomacy: z.number(),
});

const AIFactionThresholdsSchema = z.strictObject({
  attack: z.number(),
  colonization: z.number(),
  maxColonizations: z.number().int(),
});

const AIFactionGoalSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(AI_GOAL_KINDS),
  createdAtTick: z.number().int().nonnegative(),
});

const AIFactionStateSchema = z.strictObject({
  id: z.string().min(1),
  archetype: z.enum(AI_FACTION_ARCHETYPES),
  config: z.strictObject({
    difficulty: z.enum(AI_DIFFICULTIES),
    updateIntervalTicks: z.number().int().min(1),
    maxControllersPerTick: z.number().int().min(0),
  }),
  createdAtTick: z.number().int().nonnegative(),
  budget: AIBudgetSchema,
  thresholds: AIFactionThresholdsSchema,
  goals: z.array(AIFactionGoalSchema),
});

/**
 * Реестр AI-фракций: ключ обязан совпадать с faction.id, суммы бюджетов
 * в допуске 1e-6 (двойная проверка с validateAIFactionRegistry — защита
 * загрузки от повреждённых/рукодельных сейвов).
 */
const AIFactionsRegistrySchema = z
  .record(z.string(), AIFactionStateSchema)
  .refine(
    (reg) => Object.entries(reg).every(([key, f]) => f.id === key),
    { message: 'ключ реестра aiFactions обязан совпадать с faction.id' },
  )
  .refine(
    (reg) => Object.values(reg).every((f) => {
      const s = f.budget.economy + f.budget.military + f.budget.research + f.budget.trade + f.budget.diplomacy;
      return Number.isFinite(s) && Math.abs(s - 1) <= 1e-6;
    }),
    { message: 'сумма бюджетных весов фракции должна быть 1 (±1e-6)' },
  );

/**
 * Top-level serialized GameState schema (v1).
 *
 * `passthrough()` on the root object — extra fields are tolerated (forward
 * compat: if a future version adds `version: 2` etc., the v1 schema still
 * parses successfully, allowing migration logic to handle the upgrade).
 *
 * Block 02 (F7) migration: `fleets`, `shipDesigns`, `shipyardQueues`, `ships`
 * are now OPTIONAL with default empty arrays. This allows pre-Block-02 saves
 * (which lack these fields) to pass strict validation rather than falling
 * back to the unvalidated parse path. The migration step in
 * `deserializeGameState` (`fleets: raw.fleets || []`, `new Map(raw.X ?? [])`)
 * already initializes missing fields; making the schema permissive just
 * removes the spurious validation warning on old saves.
 */
export const SerializedGameStateSchema = z.object({
  time: GameTimeSchema,
  speed: GameSpeedSchema,
  phase: GamePhaseSchema,
  galaxy: SerializedGalaxySchema,
  productionQueues: ProductionQueuesSchema,
  fleets: z.array(z.unknown()).optional().default([]),
  // Block 02 (F7): serialized as arrays of [id, value] pairs (Map.entries())
  shipDesigns: z.array(z.tuple([z.string(), z.unknown()])).optional().default([]),
  shipyardQueues: z.array(z.tuple([z.string(), z.unknown()])).optional().default([]),
  ships: z.array(z.tuple([z.string(), z.unknown()])).optional().default([]),
  playerFactionId: z.string(),
  // Этап 3б.1 (R-44): AI-секция — ТОЛЬКО при непустом реестре (serialize
  // опускает пустой); маркер версии aiFactionsV — транспортный (int).
  // Старые сейвы без AI-полей проходят как прежде (обязательства нет).
  aiFactions: AIFactionsRegistrySchema.optional(),
  aiFactionsV: z.number().int().optional(),
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
