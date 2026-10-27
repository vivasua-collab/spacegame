/**
 * Этап 3б.1 (R-44): постоянное состояние AI-фракций + save/load контракт.
 *
 * Границы среза 3б.1 (roadmap R-43, plans/2026-10-27-r43-stage3b-roadmap.md;
 *Issue #7 закрыт docs-приёмкой, допуск на 3б.1 дан владельцем явно):
 * - Фракция — ССЫЛОЧНАЯ сущность: stable EntityId (тот же namespace, что и
 *   owner-поля GameState) + archetype (docs/70 §2.1–2.6) + config (AIConfig
 *   этапа 3а) + AI-only постоянное состояние (цели/бюджет/пороги). Владения,
 *   ресурсы, флоты и технологии ВНУТРЬ фракции НЕ копируются — они читаются
 *   из GameState по owner-полям (аудит R-43, таблица контрактов №3);
 *   типо-уровневая гарантия: таких полей в AIFactionState нет, strict-схема
 *   загрузки отвергает их появление в сейвах.
 * - Реестр фракций живёт в GameState (`aiFactions`, опциональное поле) и
 *   сериализуется в v3-сейв с маркером версии (aiFactionsV). Состояния/сейвы
 *   без AI-полей совместимы по построению: serialize опускает пустой/отсут-
 *   ствующий реестр (побайтная идемпотентность прежних якорей sha256),
 *   deserialize даёт предсказуемый дефолт «реестра нет».
 * - Setup детерминирован по seed (Xoshiro128StarStar.derive — канонический
 *   PRNG проекта, аудит R-43 №6); повторная регистрация — явный отказ.
 * - ЗАПРЕЩЕНО в срезе: автоматические действия AI, изменение поведения
 *   существующих систем, стартовые бонусы (бюджет — конфигурационное поле,
 *   в 3б.1 никем не читается), авто-создание фракций в newGame.
 *
 * Источник констант: docs/70-ai.md Приложение C (ATTACK_THRESHOLD,
 * COLONIZATION_THRESHOLD, MAX_COLONIZATIONS). RETREAT_THRESHOLD в персистент-
 * ное состояние НЕ входит: значение SWARM = Infinity не JSON-сериализуемо —
 * представление («никогда») выберет военный срез 3б.4. Бюджетные веса по
 * архетипам — ДОКУМЕНТИРОВАННЫЕ ПЛЕЙСХОЛДЕРЫ (в docs/70 констант бюджета нет,
 * Приложение A задаёт только форму) — баланс решит владелец при 3б.3.
 */

import { Xoshiro128StarStar } from '@/core/prng';
import type { EntityId } from '@/core/types';
import type { AIConfig, AIDifficulty, AIIntentAction } from '@/ai/types';
import { AI_DIFFICULTY_UPDATE_INTERVAL, validateAIConfig } from '@/ai/types';

// ─── Версия AI-секции сейва ──────────────────────────────

/**
 * Версия контракта AI-секции v3-сейва. Пишется в JSON как `aiFactionsV`
 * ТОЛЬКО вместе с непустым реестром; при загрузке наличие `aiFactions`
 * требует `aiFactionsV === AI_FACTION_STATE_VERSION` (иначе явная ошибка —
 * контракт «строгая версия», как fmt≠3 в R-30).
 */
export const AI_FACTION_STATE_VERSION = 1;

// ─── Архетипы (docs/70-ai.md §2.1–2.6) ───────────────────

/** Архетипы AI-фракций (docs/70-ai.md §2, Приложение A: FactionType). */
export type AIArchetype = 'CONFEDERATION' | 'HEGEMONY' | 'SYNDICATE' | 'ORDER' | 'SWARM';

export const AI_FACTION_ARCHETYPES: readonly AIArchetype[] = [
  'CONFEDERATION',
  'HEGEMONY',
  'SYNDICATE',
  'ORDER',
  'SWARM',
];

// ─── AI-only состояние: бюджет / пороги / цели ───────────

/**
 * Распределение бюджетных весов (Приложение A: budget_allocation).
 * Веса ∈ [0..1], сумма ≈ 1 (допуск 1e-6). В 3б.1 никем не читается
 * (конфигурационное поле; исполнение бюджета — 3б.3+).
 */
export interface AIBudgetAllocation {
  economy: number;
  military: number;
  research: number;
  trade: number;
  diplomacy: number;
}

/**
 * Пороги решений фракции (Приложение C; подмножество, JSON-сериализуемое).
 * attack — ATTACK_THRESHOLD (моя_сила / их_сила); colonization —
 * COLONIZATION_THRESHOLD [0..1]; maxColonizations — MAX_COLONIZATIONS.
 */
export interface AIFactionThresholds {
  attack: number;
  colonization: number;
  maxColonizations: number;
}

/** Словарь видов целей (docs/70 §2–6; в 3б.1 цели всегда пусты — GOAP 3б.4+). */
export const AI_GOAL_KINDS: readonly AIIntentAction[] = [
  'expand',
  'build_economy',
  'build_military',
  'research',
  'trade',
  'diplomacy',
  'defend',
  'attack',
];

/** Стратегическая цель фракции (Приложение A: GOAPGoal — форма, не исполнение). */
export interface AIFactionGoal {
  /** Стабильный уникальный идентификатор цели (уникальность внутри фракции). */
  id: string;
  /** Вид цели (словарь AI_GOAL_KINDS). */
  kind: AIIntentAction;
  /** Тик создания (GameTime.tick — никакого wall-clock). */
  createdAtTick: number;
}

// ─── Константы архетипов (docs/70 Приложение C + плейсхолдеры бюджета) ──

export interface AIArchetypeConstants {
  thresholds: AIFactionThresholds;
  budget: AIBudgetAllocation;
}

/**
 * Канонические константы архетипов.
 * thresholds — ТОЧНЫЕ значения docs/70 Приложение C.
 * budget — плейсхолдеры (см. заголовок файла): профиль §2.1, сумма = 1;
 * НЕ влияют на геймплей 3б.1 (нет потребителя).
 */
export const ARCHETYPE_CONSTANTS: Readonly<Record<AIArchetype, AIArchetypeConstants>> = {
  // Сбалансированная (§2.1/§2.2)
  CONFEDERATION: {
    thresholds: { attack: 1.5, colonization: 0.4, maxColonizations: 2 },
    budget: { economy: 0.30, military: 0.20, research: 0.20, trade: 0.15, diplomacy: 0.15 },
  },
  // Военная (§2.3)
  HEGEMONY: {
    thresholds: { attack: 1.2, colonization: 0.2, maxColonizations: 2 },
    budget: { economy: 0.25, military: 0.35, research: 0.15, trade: 0.10, diplomacy: 0.15 },
  },
  // Торговая (§2.4)
  SYNDICATE: {
    thresholds: { attack: 3.0, colonization: 0.6, maxColonizations: 1 },
    budget: { economy: 0.25, military: 0.10, research: 0.15, trade: 0.40, diplomacy: 0.10 },
  },
  // Научная (§2.5)
  ORDER: {
    thresholds: { attack: 1.5, colonization: 0.5, maxColonizations: 1 },
    budget: { economy: 0.20, military: 0.10, research: 0.45, trade: 0.10, diplomacy: 0.15 },
  },
  // Ксено-агрессивная (§2.6)
  SWARM: {
    thresholds: { attack: 1.0, colonization: 0.1, maxColonizations: 4 },
    budget: { economy: 0.40, military: 0.30, research: 0.20, trade: 0.10, diplomacy: 0.00 },
  },
};

// ─── Сущность фракции (постоянное состояние) ─────────────

/**
 * Постоянное состояние AI-фракции (3б.1).
 *
 * Хранится в GameState.aiFactions (реестр по id), сериализуется в v3.
 * НЕ содержит владений/ресурсов/флотов/технологий — ссылочная сущность
 * (см. заголовок файла). Бюджет/пороги — конфигурация будущего поведения;
 * в 3б.1 НИ ОДНО игровое действие не исполняется.
 */
export interface AIFactionState {
  /** Стабильный id (тот же namespace, что owner-поля GameState). */
  id: EntityId;
  /** Архетип поведения (docs/70 §2). */
  archetype: AIArchetype;
  /** Конфигурация контроллера (AIConfig этапа 3а). */
  config: AIConfig;
  /** Тик создания (GameTime.tick при setup; никакого wall-clock). */
  createdAtTick: number;
  /** Бюджетные веса (плейсхолдеры; потребитель — 3б.3+). */
  budget: AIBudgetAllocation;
  /** Пороги решений (Приложение C). */
  thresholds: AIFactionThresholds;
  /** Стратегические цели (в 3б.1 всегда [] — GOAP 3б.4+). */
  goals: AIFactionGoal[];
}

// ─── Валидация (чистые функции, стиль этапа 3а) ──────────

const BUDGET_SUM_TOLERANCE = 1e-6;

/** Валидация одной фракции. Не бросает — возвращает список ошибок. */
export function validateAIFactionState(faction: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (faction === null || typeof faction !== 'object') {
    return { ok: false, errors: ['AIFactionState должен быть объектом'] };
  }
  const f = faction as Record<string, unknown>;
  if (typeof f.id !== 'string' || f.id.length === 0) {
    errors.push('id должен быть непустой строкой');
  }
  if (!AI_FACTION_ARCHETYPES.includes(f.archetype as AIArchetype)) {
    errors.push(`archetype должен быть одним из ${AI_FACTION_ARCHETYPES.join('|')}, получено: ${String(f.archetype)}`);
  }
  const cfg = validateAIConfig(f.config);
  if (!cfg.ok) errors.push(...cfg.errors.map((e) => `config: ${e}`));
  if (typeof f.createdAtTick !== 'number' || !Number.isInteger(f.createdAtTick) || f.createdAtTick < 0) {
    errors.push(`createdAtTick должен быть целым >= 0, получено: ${String(f.createdAtTick)}`);
  }

  // Бюджет: 5 категорий, веса конечные [0..1], сумма ≈ 1.
  if (f.budget === null || typeof f.budget !== 'object') {
    errors.push('budget должен быть объектом');
  } else {
    const b = f.budget as Record<string, unknown>;
    const keys = ['economy', 'military', 'research', 'trade', 'diplomacy'] as const;
    let sum = 0;
    for (const k of keys) {
      const w = b[k];
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1) {
        errors.push(`budget.${k} должен быть конечным числом в [0..1], получено: ${String(w)}`);
      } else {
        sum += w;
      }
    }
    if (errors.every((e) => !e.startsWith('budget.')) && Math.abs(sum - 1) > BUDGET_SUM_TOLERANCE) {
      errors.push(`сумма бюджетных весов должна быть 1 (±${BUDGET_SUM_TOLERANCE}), получено: ${sum}`);
    }
  }

  // Пороги: attack > 0 конечный; colonization ∈ [0..1]; maxColonizations — целое >= 0.
  if (f.thresholds === null || typeof f.thresholds !== 'object') {
    errors.push('thresholds должен быть объектом');
  } else {
    const t = f.thresholds as Record<string, unknown>;
    if (typeof t.attack !== 'number' || !Number.isFinite(t.attack) || t.attack <= 0) {
      errors.push(`thresholds.attack должен быть конечным числом > 0, получено: ${String(t.attack)}`);
    }
    if (typeof t.colonization !== 'number' || !Number.isFinite(t.colonization) || t.colonization < 0 || t.colonization > 1) {
      errors.push(`thresholds.colonization должен быть числом в [0..1], получено: ${String(t.colonization)}`);
    }
    if (typeof t.maxColonizations !== 'number' || !Number.isInteger(t.maxColonizations) || t.maxColonizations < 0) {
      errors.push(`thresholds.maxColonizations должен быть целым >= 0, получено: ${String(t.maxColonizations)}`);
    }
  }

  // Цели: массив, уникальные id, вид из словаря, тик — целое >= 0.
  if (!Array.isArray(f.goals)) {
    errors.push('goals должен быть массивом');
  } else {
    const seen = new Set<string>();
    for (const g of f.goals) {
      if (g === null || typeof g !== 'object') {
        errors.push('элемент goals должен быть объектом');
        continue;
      }
      const goal = g as Record<string, unknown>;
      if (typeof goal.id !== 'string' || goal.id.length === 0) {
        errors.push('goal.id должен быть непустой строкой');
      } else if (seen.has(goal.id)) {
        errors.push(`дубликат goal.id: "${goal.id}"`);
      } else {
        seen.add(goal.id);
      }
      if (!AI_GOAL_KINDS.includes(goal.kind as AIIntentAction)) {
        errors.push(`goal.kind должен быть одним из ${AI_GOAL_KINDS.join('|')}, получено: ${String(goal.kind)}`);
      }
      if (typeof goal.createdAtTick !== 'number' || !Number.isInteger(goal.createdAtTick) || goal.createdAtTick < 0) {
        errors.push(`goal.createdAtTick должен быть целым >= 0, получено: ${String(goal.createdAtTick)}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Валидация реестра фракций (ключ == faction.id; каждая фракция валидна). */
export function validateAIFactionRegistry(registry: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    return { ok: false, errors: ['Реестр AI-фракций должен быть объектом (Record<EntityId, AIFactionState>)'] };
  }
  for (const [key, value] of Object.entries(registry as Record<string, unknown>)) {
    const v = validateAIFactionState(value);
    if (!v.ok) {
      errors.push(`фракция "${key}": ${v.errors.join('; ')}`);
      continue;
    }
    const f = value as AIFactionState;
    if (f.id !== key) {
      errors.push(`ключ реестра "${key}" не совпадает с faction.id "${f.id}"`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── Детерминированный setup (расстановка по seed) ───────

export interface AIFactionSetupOptions {
  /** Число фракций (по умолчанию 3; допустимо 1..8). */
  count?: number;
  /** Словарь сложностей для выбора (по умолчанию все 4, docs/70 §7.1). */
  difficulties?: readonly AIDifficulty[];
  /** Тик создания (по умолчанию 0; прод-путь стора передаёт текущий). */
  createdAtTick?: number;
}

/** Дефолтное число фракций (MVP Приложение D: этап 3 — одна фракция; 3б.1 даёт до 8). */
const DEFAULT_FACTION_COUNT = 3;
/** Верхняя граница реестра (детерминированная; больше — явный отказ). */
const MAX_FACTIONS = 8;
/** Префикс/форма id: ai_faction_NN (нуль-пад → лексика == числовой порядок). */
const FACTION_ID_PREFIX = 'ai_faction_';

function factionId(index1based: number): EntityId {
  return `${FACTION_ID_PREFIX}${String(index1based).padStart(2, '0')}`;
}

/**
 * Детерминированный реестр фракций по seed.
 *
 * Поток: Xoshiro128StarStar(seed).derive('ai:setup:factions') — канонический
 * derived-поток (аудит R-43 №6: никаких Math.random/wall-clock). Архетипы —
 * перемешанный (Fisher–Yates этим потоком) канонический список; при count ≤ 5
 * повторов нет, при 6..8 — цикл по перемешанному порядку. Сложность — draw
 * из переданного словаря. Ключи вставляются в отсортированном порядке
 * (нулл-пад id → порядок вставки == лексикографическому == детерминизм
 * сериализации).
 *
 * Бросает Error на невалидных опциях (программная ошибка, не данные):
 * count ∉ [1..8] целое, seed не конечный, неизвестная сложность, тик < 0.
 */
export function createAIFactionRoster(
  seed: number,
  options: AIFactionSetupOptions = {},
): Record<EntityId, AIFactionState> {
  const count = options.count ?? DEFAULT_FACTION_COUNT;
  if (!Number.isInteger(count) || count < 1 || count > MAX_FACTIONS) {
    throw new Error(`createAIFactionRoster: count должен быть целым в [1..${MAX_FACTIONS}], получено: ${String(count)}`);
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new Error(`createAIFactionRoster: seed должен быть конечным числом, получено: ${String(seed)}`);
  }
  const difficulties = options.difficulties ?? (['easy', 'normal', 'hard', 'insane'] as const).slice();
  for (const d of difficulties) {
    if (!['easy', 'normal', 'hard', 'insane'].includes(d)) {
      throw new Error(`createAIFactionRoster: неизвестная сложность "${String(d)}"`);
    }
  }
  const createdAtTick = options.createdAtTick ?? 0;
  if (!Number.isInteger(createdAtTick) || createdAtTick < 0) {
    throw new Error(`createAIFactionRoster: createdAtTick должен быть целым >= 0, получено: ${String(createdAtTick)}`);
  }

  const rng = new Xoshiro128StarStar(seed).derive('ai:setup:factions');

  // Fisher–Yates по каноническому списку архетипов (детерминированный).
  const archetypes = [...AI_FACTION_ARCHETYPES];
  for (let i = archetypes.length - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    const tmp: AIArchetype = archetypes[i]!;
    archetypes[i] = archetypes[j]!;
    archetypes[j] = tmp;
  }

  const roster: Record<EntityId, AIFactionState> = {};
  for (let i = 0; i < count; i++) {
    const id = factionId(i + 1);
    // `!` — недостижимо: модульная арифметика по НЕПУСТОМУ массиву
    // (AI_FACTION_ARCHETYPES — 5 архетипов, difficulties валидированы выше).
    const archetype = archetypes[i % archetypes.length]!;
    const difficulty = difficulties[rng.nextU32() % difficulties.length]!;
    const constants = ARCHETYPE_CONSTANTS[archetype];
    const faction: AIFactionState = {
      id,
      archetype,
      config: {
        difficulty,
        updateIntervalTicks: AI_DIFFICULTY_UPDATE_INTERVAL[difficulty],
        maxControllersPerTick: 8,
      },
      createdAtTick,
      budget: { ...constants.budget },
      thresholds: { ...constants.thresholds },
      goals: [],
    };
    roster[id] = faction;
  }
  return roster;
}

// ─── Регистрация в GameState (чистая) ────────────────────

export interface WithAIFactionsResult<T> {
  ok: boolean;
  errors: string[];
  /** Новое состояние (или null при отказе — вход не мутируется никогда). */
  state: T | null;
}

/**
 * Установить реестр фракций в состояние (чистая функция: новое состояние,
 * вход не мутируется). Контракт 3б.1: повторная регистрация при НЕПУСТОМ
 * реестре — явный отказ (ok:false); пустой существующий реестр регистрации
 * не мешает. Реестр валидируется перед установкой.
 */
export function withAIFactions<T extends { aiFactions?: Record<EntityId, AIFactionState> }>(
  state: T,
  roster: Record<EntityId, AIFactionState>,
): WithAIFactionsResult<T> {
  if (state.aiFactions && Object.keys(state.aiFactions).length > 0) {
    return {
      ok: false,
      errors: [`Реестр AI-фракций уже существует (${Object.keys(state.aiFactions).length} шт.) — повторная регистрация отклонена`],
      state: null,
    };
  }
  const check = validateAIFactionRegistry(roster);
  if (!check.ok) {
    return { ok: false, errors: check.errors, state: null };
  }
  return { ok: true, errors: [], state: { ...state, aiFactions: roster } };
}

// ─── Referential integrity (тест-план п.2) ───────────────

export interface OwnershipIntegrityResult {
  ok: boolean;
  /** Нарушения вида «путь → owner-значение не разрешается в реестр/игрока». */
  violations: string[];
}

/**
 * Проверка ссылочной целостности владения: каждый owner ≠ null
 * (системы/планеты/флоты/корабли) разрешается в playerFactionId или ключ
 * реестра aiFactions. Чистая функция, только чтение. Отсутствие реестра —
 * не нарушение (все владельцы обязаны быть игроком).
 */
export function checkOwnershipIntegrity(state: {
  galaxy: { systems: Array<{ id: EntityId; owner: EntityId | null; planets: Array<{ id: EntityId; owner: EntityId | null }> }> };
  fleets?: Array<{ id: EntityId; owner: EntityId }>;
  ships?: Map<EntityId, { id: EntityId; owner: EntityId }>;
  playerFactionId: EntityId;
  aiFactions?: Record<EntityId, AIFactionState>;
}): OwnershipIntegrityResult {
  const violations: string[] = [];
  const known = new Set<EntityId>([state.playerFactionId, ...(state.aiFactions ? Object.keys(state.aiFactions) : [])]);
  const bad = (path: string, owner: EntityId): void => {
    if (!known.has(owner)) violations.push(`${path}: owner "${owner}" не разрешается в playerFactionId/aiFactions`);
  };
  for (const sys of state.galaxy.systems) {
    if (sys.owner !== null) bad(`galaxy.systems[${sys.id}].owner`, sys.owner);
    for (const p of sys.planets) {
      if (p.owner !== null) bad(`galaxy.systems[${sys.id}].planets[${p.id}].owner`, p.owner);
    }
  }
  for (const fl of state.fleets ?? []) bad(`fleets[${fl.id}].owner`, fl.owner);
  for (const ship of (state.ships ?? new Map()).values()) bad(`ships[${ship.id}].owner`, ship.owner);
  return { ok: violations.length === 0, violations };
}
