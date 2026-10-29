/**
 * Формат сейва v4 — планетарные пулы сырьевых руд (ORE-POOLS-RUNTIME-01 /
 * Issue #25; решение владельца 2026-10-29, docs/31 §12).
 *
 *   1. `galaxy.dict: string[]` — словарь id руд/элементов (порядок первого
 *      вхождения при обходе). Кортежи пулов пишут ИНДЕКС словаря вместо
 *      строки: [idx, initial, remaining, availability, tier] — числа
 *      ПОЛНОЙ точности (JSON-раундрип float в JS без потерь; свод-превью,
 *      пересобранный при загрузке, бит-в-бит совпадает с живым).
 *   2. Планетарные пулы: тело (планета/луна) хранит `op` — кортежи
 *      PlanetOrePool по ТОЧНОМУ oreId (initialQuantity + remainingQuantity:
 *      состояние истощения сохраняется). Гекс-залежи (`ResourceDeposit`),
 *      RNG-снимки (`ds`) и флаги материализации (`dm`) выведены из модели —
 *      распределение депозитов по гексам не существует ни в состоянии,
 *      ни в сейвах (docs/31 §10.4).
 *   3. Свод-превью `resourceDeposits` НЕ сериализуется: это чистая производная
 *      пулов (buildResourceSummary, без RNG) — пересчитывается при загрузке
 *      из текущей baked-модели (загрузка → setCurrentLookups → rebuild).
 *
 * Совместимость (docs/31 §12, решение владельца): СТАРЫЕ СЕЙВЫ НЕ
 * МИГРИРУЮТ. `fmt` обязан быть 4; сейвы v1/v2/v3 (гекс-залежи) отклоняются
 * ЯВНОЙ ошибкой с понятным сообщением и предложением начать новую игру —
 * никакой тихой загрузки со сброшенными пулами, никаких «компенсационных»
 * запасов.
 *
 * Идемпотентность: encode(decode(encode(s))) === encode(s) — обход
 * детерминирован, словарь строится в стабильном порядке, округления
 * стабильны.
 */

import { generateHexCoords } from '@/galaxy/hex-grid';
import type { HexTerrain, PlanetOrePool } from '@/core/types';

/** Версия формата (маркер в корне JSON). */
export const SAVE_FORMAT_VERSION = 4;

// ============ Округление ============

/** Округление до 3 знаков после запятой (0..1 диапазоны + остатки пулов). */
export function round3(v: number): number {
  if (!Number.isFinite(v)) return v;
  return Math.round(v * 1000) / 1000;
}

/** 4 значащих цифры — для float любой magnitude (luminosity 2.3e-4 и т.п.). */
export function roundSig4(v: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  return Number(v.toPrecision(4));
}

// ============ Tier ↔ индекс ============

export const TIER_TO_IDX: Record<PlanetOrePool['tier'], number> = {
  profile: 0,
  rare: 1,
  ultra_rare: 2,
};

export const TIER_FROM_IDX: readonly PlanetOrePool['tier'][] = ['profile', 'rare', 'ultra_rare'];

// ============ Внутренние типы (работа с plain JSON) ============

/** Простой JSON-объект (после JSON.parse / перед JSON.stringify). */
type Plain = Record<string, unknown>;

interface PlainHex {
  terrain?: HexTerrain;
  buildingId?: string | null;
  buildingLevel?: number;
  processorType?: unknown;
  specialization?: unknown;
  specializationLevel?: unknown;
  activeRecipes?: unknown;
  /** PROC-WORKSHOPS-01: цехи processing-зданий (processor / plant) */
  workshops?: unknown;
}

interface PlainBody {
  hexes?: PlainHex[];
  orePools?: Array<Plain | unknown[]>;
}

// ============ Encode: v1-объекты → v4 (компакт + словарь) ============

/**
 * Уплотняет сериализуемую форму GameState в формат v4. Чистая функция:
 * строит НОВЫЕ объекты, живое состояние не мутируется.
 */
export function compactSaveV4<T extends Plain>(raw: T): T & { fmt: number } {
  const dict = new Map<string, number>();
  const idxOf = (id: unknown): number => {
    const key = String(id);
    let i = dict.get(key);
    if (i === undefined) {
      i = dict.size;
      dict.set(key, i);
    }
    return i;
  };

  const galaxy = raw.galaxy as Plain | undefined;
  const systems = (galaxy?.systems as Plain[] | undefined) ?? [];

  const result: T & { fmt: number } = {
    ...raw,
    fmt: SAVE_FORMAT_VERSION,
    galaxy: {
      ...(galaxy ?? {}),
      dict: [] as string[], // заполняется в конце (после обхода)
      systems: systems.map((sys) => {
        const stars = (sys.stars as Plain[] | undefined) ?? [];
        const planets = (sys.planets as Plain[] | undefined) ?? [];
        return {
          ...sys,
          stars: stars.map(compactStar),
          planets: planets.map((p) => {
            const planet = compactBody({ ...p } as Plain & PlainBody, idxOf);
            const moons = (planet.moons as Plain[] | undefined) ?? [];
            planet.moons = moons.map((m) => compactBody({ ...m } as Plain & PlainBody, idxOf));
            return planet;
          }),
        };
      }),
    },
  };

  (result.galaxy as Plain).dict = Array.from(dict.keys());
  return result;
}

function compactStar(star: Plain): Plain {
  return {
    ...star,
    mass: roundSig4(star.mass as number),
    luminosity: roundSig4(star.luminosity as number),
    temperature: roundSig4(star.temperature as number),
    radius: roundSig4(star.radius as number),
  };
}

/**
 * Уплотнение тела (планета/луна): планетарные пулы кортежами-индексами
 * (все пулы, включая исчерпанные — состояние истощения сохраняется).
 * Свод-превью resourceDeposits НЕ пишется (производная пулов).
 */
function compactBody(body: Plain & PlainBody, idxOf: (id: unknown) => number): Plain {
  const out: Plain = { ...body };

  if (!Array.isArray(out.hexes)) out.hexes = [];

  if (Array.isArray(body.orePools)) {
    out.op = (body.orePools as Plain[]).map((p) => [
      idxOf(p.oreId),
      p.initialQuantity,
      p.remainingQuantity,
      p.availability,
      TIER_TO_IDX[(p.tier as PlanetOrePool['tier']) ?? 'rare'] ?? 1,
    ]);
  } else {
    out.op = [];
  }
  delete out.orePools;
  delete out.resourceDeposits; // производная пулов — пересчитывается при загрузке

  if (Array.isArray(body.hexes) && body.hexes.length > 0) {
    out.hexes = (body.hexes as PlainHex[]).map((h) => compactHex(h));
  }
  return out;
}

function compactHex(hex: PlainHex): Plain {
  const out: Plain = { terrain: hex.terrain };
  if (hex.buildingId !== null && hex.buildingId !== undefined) {
    out.buildingId = hex.buildingId;
    out.buildingLevel = hex.buildingLevel;
    if (hex.processorType !== undefined) out.processorType = hex.processorType;
    if (hex.specialization !== undefined) out.specialization = hex.specialization;
    if (hex.specializationLevel !== undefined) out.specializationLevel = hex.specializationLevel;
    if (hex.activeRecipes !== undefined) out.activeRecipes = hex.activeRecipes;
    // PROC-WORKSHOPS-01: цехи (specialization/batch) — компактная форма:
    // каждый цех = [specializationRecipeId|null, specializationLevel, batch|null],
    // batch = [queueItemId|null, recipeId, progress, total].
    if (Array.isArray(hex.workshops) && hex.workshops.length > 0) {
      out.workshops = (hex.workshops as Plain[]).map((ws) => {
        const batch = ws.currentBatch as Plain | undefined;
        return [
          (ws.specializationRecipeId as string | undefined) ?? null,
          (ws.specializationLevel as number | undefined) ?? 0,
          batch
            ? [
                (batch.queueItemId as string | null) ?? null,
                batch.recipeId as string,
                batch.progress as number,
                batch.total as number,
              ]
            : null,
        ];
      });
    }
  }
  return out;
}

// ============ Decode: v4 (компакт) → v1-объекты ============

/**
 * Разворачивает v4-форму в каноничную объектную (которую ждёт остальная
 * часть deserializeGameState). Мутирует raw на месте (объект свежий из
 * JSON.parse — владеем им).
 *
 * Совместимость (docs/31 §12): `fmt` обязан быть 4. Сейвы старых форматов
 * (fmt:1/2/3 — гекс-залежи, или без маркера) отклоняются ЯВНОЙ ошибкой
 * с понятным сообщением и предложением начать новую игру. Молчаливая
 * интерпретация чужой формы запрещена (тихая загрузка со сброшенными
 * пулами / «компенсационные» запасы — docs/31 §12).
 */
export function expandSaveV4<T extends Plain>(raw: T): T {
  if (raw.fmt !== SAVE_FORMAT_VERSION) {
    throw new Error(
      `Несовместимый формат сейва: fmt=${String(raw.fmt)} (ожидается ${SAVE_FORMAT_VERSION}). `
      + 'Сейвы предыдущей модели игры (залежи на гексах) не поддерживаются — '
      + 'начните новую игру.',
    );
  }
  const galaxy = raw.galaxy as Plain | undefined;
  if (!galaxy || !Array.isArray(galaxy.systems)) {
    delete raw.fmt;
    return raw;
  }

  const dict = (galaxy.dict as string[] | undefined) ?? [];
  // Строгий контракт — битый индекс словаря (кортеж ссылается за пределы
  // dict) — явная ошибка, как и fmt≠4 (молчаливая порча данных запрещена).
  const idOf = (i: unknown): string => {
    const idx = typeof i === 'number' ? i : -1;
    const id = idx >= 0 && idx < dict.length ? dict[idx] : undefined;
    if (id === undefined) {
      throw new Error(
        `Повреждённый сейв: индекс ${String(i)} вне словаря id (dict.len=${dict.length})`,
      );
    }
    return id;
  };

  for (const sys of galaxy.systems as Plain[]) {
    const stars = sys.stars as Plain[] | undefined;
    if (Array.isArray(stars)) {
      for (const star of stars) {
        star.mass = roundSig4(star.mass as number);
        star.luminosity = roundSig4(star.luminosity as number);
        star.temperature = roundSig4(star.temperature as number);
        star.radius = roundSig4(star.radius as number);
      }
    }
    const planets = sys.planets as Plain[] | undefined;
    if (!Array.isArray(planets)) continue;
    for (const p of planets) {
      expandBody(p as Plain, idOf);
      const moons = p.moons as Plain[] | undefined;
      if (Array.isArray(moons)) {
        for (const m of moons) expandBody(m as Plain, idOf);
      }
    }
  }

  delete (galaxy as Plain).dict;
  delete raw.fmt;
  return raw;
}

/** Реконструкция тела: гексы (террейн/здания), планетарные пулы → канонические поля. */
function expandBody(body: Plain, idOf: (i: unknown) => string): void {
  if (Array.isArray(body.hexes)) {
    const coords = generateHexCoords(body.hexes.length);
    body.hexes = (body.hexes as PlainHex[]).map((h, i) => {
      const out: Plain = {
        coord: coords[i] ?? { q: 0, r: 0 },
        terrain: h.terrain,
        buildingId: h.buildingId ?? null,
        buildingLevel: h.buildingLevel ?? 0,
      };
      if (h.processorType !== undefined) out.processorType = h.processorType;
      if (h.specialization !== undefined) out.specialization = h.specialization;
      if (h.specializationLevel !== undefined) out.specializationLevel = h.specializationLevel;
      if (h.activeRecipes !== undefined) out.activeRecipes = h.activeRecipes;
      // PROC-WORKSHOPS-01: восстановление цехов из компактной формы.
      if (Array.isArray(h.workshops)) {
        out.workshops = (h.workshops as unknown[][]).map((ws) => {
          const spec = (ws[0] as string | null) ?? undefined;
          const batch = ws[2] as unknown[] | null;
          return {
            ...(spec !== undefined ? { specializationRecipeId: spec } : {}),
            ...(typeof ws[1] === 'number' && ws[1] > 0 ? { specializationLevel: ws[1] } : {}),
            ...(batch
              ? {
                  currentBatch: {
                    queueItemId: (batch[0] as string | null) ?? null,
                    recipeId: batch[1] as string,
                    progress: batch[2] as number,
                    total: batch[3] as number,
                  },
                }
              : {}),
          };
        });
      }
      return out;
    });
  }

  if (Array.isArray(body.op) && body.op.length > 0 && Array.isArray(body.op[0])) {
    body.orePools = (body.op as unknown[][]).map((t) => ({
      oreId: idOf(t[0]),
      initialQuantity: t[1] as number,
      remainingQuantity: t[2] as number,
      availability: t[3] as number,
      tier: TIER_FROM_IDX[t[4] as number] ?? 'rare',
    }));
  } else {
    body.orePools = [];
  }
  delete body.op;
}

// ============ Хелперы для тестов/инспекции ============

/** Истинно, если JSON-строка — формат v4 (маркер fmt). */
export function isSaveFormatV4(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Plain;
    return parsed.fmt === SAVE_FORMAT_VERSION;
  } catch {
    return false;
  }
}
