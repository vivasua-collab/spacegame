/**
 * R-29 (2026-08-31): формат сейва v3 — ленивые залежи.
 *
 * Основа — v2 (кортежи залежей/свода, coord из сетки, округления,
 * звёзды 4 знач. цифры). Новое:
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
 * Обратная совместимость: сейвы fmt:2 разворачиваются expandSaveV2,
 * затем migrateLegacyDepositFlags помечает тела с запечёнными залежами
 * (depositsMaterialized=true) — повторная материализация невозможна.
 * Сейвы без fmt (v1) идут тем же путём после объектного парса.
 *
 * Идемпотентность: encode(decode(encode(s))) === encode(s) — обход
 * детерминирован, словарь строится в стабильном порядке, округления
 * стабильны.
 */

import { generateHexCoords } from '@/galaxy/hex-grid';
import type { HexTerrain, PlanetResourceDeposit } from '@/core/types';
import { round3, roundSig4, TIER_TO_IDX, TIER_FROM_IDX } from './save-format-v2';

/** Версия формата v3 (маркер в корне JSON). */
export const SAVE_FORMAT_V3_VERSION = 3;

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
 * часть deserializeGameState). Сейвы с fmt!==3 возвращаются как есть.
 * Мутирует raw на месте (объект свежий из JSON.parse — владеем им).
 */
export function expandSaveV3<T extends Plain>(raw: T): T {
  if (raw.fmt !== SAVE_FORMAT_V3_VERSION) return raw;
  const galaxy = raw.galaxy as Plain | undefined;
  if (!galaxy || !Array.isArray(galaxy.systems)) return raw;

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

// ============ Миграция v1/v2 → флаги ленивых залежей ============

/**
 * R-29: миграция сейвов ДО v3 (после их объектного разворота).
 *
 * Старые сейвы запекали залежи во все геки всех тел при генерации.
 * Тело, в гексах которого есть хоть одна залежь, считается
 * материализованным (depositsMaterialized=true) — materializePlanetDeposits
 * его не тронет (иначе повторный replay продублировал бы залежи).
 * Тело без залежей (ГГ, пустые фикстуры) — depositRngState=null:
 * материализация невозможна и не нужна.
 */
export function migrateLegacyDepositFlags<T extends Plain>(raw: T): T {
  const galaxy = raw.galaxy as Plain | undefined;
  const systems = (galaxy?.systems as Plain[] | undefined) ?? [];
  for (const sys of systems) {
    const planets = sys.planets as Plain[] | undefined;
    if (!Array.isArray(planets)) continue;
    for (const p of planets) {
      migrateBody(p as Plain);
      const moons = p.moons as Plain[] | undefined;
      if (Array.isArray(moons)) {
        for (const m of moons) migrateBody(m as Plain);
      }
    }
  }
  return raw;
}

function migrateBody(body: Plain): void {
  if (body.depositsMaterialized !== undefined) return; // уже помечено (fixture)
  let materialized = false;
  if (Array.isArray(body.hexes)) {
    materialized = (body.hexes as PlainHex[]).some(
      (h) => Array.isArray(h.deposits) && h.deposits.length > 0,
    );
  }
  body.depositsMaterialized = materialized;
  if (body.depositRngState === undefined) body.depositRngState = null;
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
