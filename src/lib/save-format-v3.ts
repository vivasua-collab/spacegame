/**
 * R-29 (2026-08-31): формат сейва v3 — ленивые залежи.
 *
 *   1. `galaxy.dict: string[]` — словарь id элементов/руд (порядок
 *      первого вхождения при обходе). Кортежи залежей и свода пишут
 *      ИНДЕКС словаря вместо строки: [idx, avail3, qty, depth] и
 *      [idx, total, avg3, tierIdx, hexCount, max3]. ~112k записей
 *      свода экономят ~0.6 МБ на имёнах.
 *   2. Ленивые залежи: тела хранят `ds` (снимок RNG-состояния залежей,
 *      4×uint32) и `dm` (материализовано, пишется только true). Гексы
 *      НЕматериализованных тел не содержат залежей вовсе — «мёртвые»
 *      (не разведанные) гексы не попадают в сейв (замысел владельца:
 *      верхнеуровневый пул известен, детализация — при колонизации).
 *   3. Истощённые залежи (qty<=0) НЕ пишутся: добыча их пропускает,
 *      пул-агрегат не пересчитывается — «проще на поздних стадиях».
 *
 * R-30 (2026-08-31): v3 — ЕДИНСТВЕННЫЙ формат. Совместимость с v1/v2
 * (fmt-детект, expandSaveV2, миграция флагов) удалена: старые сейвы
 * стёрты владельцем, decode-заглушки не нужны. Загрузка строго требует
 * `fmt: 3` — сейвы старых форматов отклоняются явной ошибкой (вместо
 * молчаливой порчи состояния кортежами/формой v2).
 *
 * Идемпотентность: encode(decode(encode(s))) === encode(s) — обход
 * детерминирован, словарь строится в стабильном порядке, округления
 * стабильны.
 */

import { generateHexCoords } from '@/galaxy/hex-grid';
import type { HexTerrain, PlanetResourceDeposit } from '@/core/types';

/** Версия формата v3 (маркер в корне JSON). */
export const SAVE_FORMAT_V3_VERSION = 3;

// ============ Округление (унаследовано из v2-кодека при удалении v2, R-30) ============

/** Округление до 3 знаков после запятой (0..1 диапазоны: availability). */
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

export const TIER_TO_IDX: Record<PlanetResourceDeposit['tier'], number> = {
  profile: 0,
  rare: 1,
  ultra_rare: 2,
};

export const TIER_FROM_IDX: readonly PlanetResourceDeposit['tier'][] = ['profile', 'rare', 'ultra_rare'];

// ============ Внутренние типы (работа с plain JSON) ============

/** Простой JSON-объект (после JSON.parse / перед JSON.stringify). */
type Plain = Record<string, unknown>;

interface PlainHex {
  terrain?: HexTerrain;
  buildingId?: string | null;
  buildingLevel?: number;
  deposits?: Array<Plain | unknown[]>;
  processorType?: unknown;
  specialization?: unknown;
  specializationLevel?: unknown;
  activeRecipes?: unknown;
}

interface PlainBody {
  hexes?: PlainHex[];
  resourceDeposits?: Array<Plain | unknown[]>;
  depositsMaterialized?: boolean;
  depositRngState?: number[] | null;
}

// ============ Encode: v1-объекты → v3 (компакт + словарь) ============

/**
 * Уплотняет сериализуемую форму GameState в формат v3. Чистая функция:
 * строит НОВЫЕ объекты, живое состояние не мутируется.
 */
export function compactSaveV3<T extends Plain>(raw: T): T & { fmt: number } {
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
    fmt: SAVE_FORMAT_V3_VERSION,
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
 * Уплотнение тела (планета/луна): гексы (залежи кортежами-индексами,
 * истощённые отбрасываются), свод-пул кортежами-индексами, ds/dm.
 */
function compactBody(body: Plain & PlainBody, idxOf: (id: unknown) => number): Plain {
  const out: Plain = { ...body };

  // ds — снимок RNG (только для тел с гексами и имеющих состояние)
  if (Array.isArray(out.hexes) && out.hexes.length > 0) {
    if (Array.isArray(body.depositRngState)) {
      out.ds = body.depositRngState.slice();
    }
  } else {
    // ГГ без гексов: пустой свод-пул остаётся, гексы []
    out.hexes = [];
  }
  delete out.depositRngState;
  delete out.depositsMaterialized;
  if (body.depositsMaterialized === true) out.dm = 1;

  if (Array.isArray(body.hexes) && body.hexes.length > 0) {
    out.hexes = (body.hexes as PlainHex[]).map((h) => compactHex(h, idxOf));
  }
  if (Array.isArray(body.resourceDeposits)) {
    out.resourceDeposits = (body.resourceDeposits as Plain[]).map((rd) => [
      idxOf(rd.elementId),
      rd.totalQuantity,
      round3(rd.avgAvailability as number),
      TIER_TO_IDX[(rd.tier as PlanetResourceDeposit['tier']) ?? 'rare'] ?? 1,
      rd.hexCount,
      round3(rd.maxAvailability as number),
    ]);
  }
  return out;
}

function compactHex(hex: PlainHex, idxOf: (id: unknown) => number): Plain {
  const out: Plain = { terrain: hex.terrain };
  if (hex.buildingId !== null && hex.buildingId !== undefined) {
    out.buildingId = hex.buildingId;
    out.buildingLevel = hex.buildingLevel;
    if (hex.processorType !== undefined) out.processorType = hex.processorType;
    if (hex.specialization !== undefined) out.specialization = hex.specialization;
    if (hex.specializationLevel !== undefined) out.specializationLevel = hex.specializationLevel;
    if (hex.activeRecipes !== undefined) out.activeRecipes = hex.activeRecipes;
  }
  if (Array.isArray(hex.deposits) && hex.deposits.length > 0) {
    // Истощённые (qty<=0) НЕ пишутся — «проще на поздних стадиях»:
    // добыча их пропускает, пул не пересчитывается, dm защищает от
    // повторной материализации.
    const alive = (hex.deposits as Plain[]).filter((d) => (d.quantity as number) > 0);
    if (alive.length > 0) {
      out.deposits = alive.map((d) => [
        idxOf(d.elementId),
        round3(d.availability as number),
        d.quantity,
        d.depth,
      ]);
    }
  }
  return out;
}

// ============ Decode: v3 (компакт) → v1-объекты ============

/**
 * Разворачивает v3-форму в каноничную объектную (которую ждёт остальная
 * часть deserializeGameState). Мутирует raw на месте (объект свежий из
 * JSON.parse — владеем им).
 *
 * R-30: строгий контракт — `fmt` обязан быть 3. Сейвы старых форматов
 * (fmt:2 или без маркера) отклоняются явной ошибкой: совместимость
 * удалена, молчаливая интерпретация чужой формы портила бы состояние.
 */
export function expandSaveV3<T extends Plain>(raw: T): T {
  if (raw.fmt !== SAVE_FORMAT_V3_VERSION) {
    throw new Error(
      `Неподдерживаемый формат сейва: fmt=${String(raw.fmt)} (ожидается ${SAVE_FORMAT_V3_VERSION}). `
      + 'Форматы v1/v2 больше не поддерживаются — начните новую игру.',
    );
  }
  const galaxy = raw.galaxy as Plain | undefined;
  if (!galaxy || !Array.isArray(galaxy.systems)) {
    delete raw.fmt;
    return raw;
  }

  const dict = (galaxy.dict as string[] | undefined) ?? [];
  const idOf = (i: unknown): string => {
    const idx = typeof i === 'number' ? i : -1;
    return dict[idx] ?? String(i);
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

/** Реконструкция тела: гексы, свод-пул, ds/dm → канонические поля. */
function expandBody(body: Plain, idOf: (i: unknown) => string): void {
  if (Array.isArray(body.hexes)) {
    const coords = generateHexCoords(body.hexes.length);
    body.hexes = (body.hexes as PlainHex[]).map((h, i) => {
      const out: Plain = {
        coord: coords[i] ?? { q: 0, r: 0 },
        terrain: h.terrain,
        buildingId: h.buildingId ?? null,
        buildingLevel: h.buildingLevel ?? 0,
        deposits: Array.isArray(h.deposits)
          ? (h.deposits as unknown[][]).map((d) => ({
            elementId: idOf(d[0]),
            availability: d[1] as number,
            quantity: d[2] as number,
            depth: d[3] as number,
          }))
          : [],
      };
      if (h.processorType !== undefined) out.processorType = h.processorType;
      if (h.specialization !== undefined) out.specialization = h.specialization;
      if (h.specializationLevel !== undefined) out.specializationLevel = h.specializationLevel;
      if (h.activeRecipes !== undefined) out.activeRecipes = h.activeRecipes;
      return out;
    });
  }

  if (Array.isArray(body.resourceDeposits) && body.resourceDeposits.length > 0
    && Array.isArray(body.resourceDeposits[0])) {
    body.resourceDeposits = (body.resourceDeposits as unknown[][]).map((rd) => ({
      elementId: idOf(rd[0]),
      totalQuantity: rd[1] as number,
      avgAvailability: rd[2] as number,
      tier: TIER_FROM_IDX[rd[3] as number] ?? 'rare',
      hexCount: rd[4] as number,
      maxAvailability: rd[5] as number,
    }));
  }

  // ds/dm → канонические поля (всегда определены — форма состояния единая)
  body.depositsMaterialized = body.dm === 1;
  body.depositRngState = Array.isArray(body.ds) ? (body.ds as number[]).slice() : null;
  delete body.dm;
  delete body.ds;
}

// ============ Хелперы для тестов/инспекции ============

/** Истинно, если JSON-строка — формат v3 (маркер fmt). */
export function isSaveFormatV3(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Plain;
    return parsed.fmt === SAVE_FORMAT_V3_VERSION;
  } catch {
    return false;
  }
}
