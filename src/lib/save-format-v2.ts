/**
 * R-28 (2026-08-31): компактный формат сейва v2.
 *
 * Анализ (scripts/save-size-analysis.ts, 200 систем / 531 планета / 418 лун):
 * свежая галактика сериализуется в 31.4 МБ plain JSON, из которых:
 *   - 21.9 МБ (70%) — 276 тыс. ресурсных залежей: ~11 МБ имена ключей
 *     (elementId/availability/quantity/depth × 276k) + ~8.6 МБ «хвосты»
 *     чисел вида 0.7168055555555554 (ср. 18.4 символа на availability);
 *   - 6.4 МБ — свод resourceDeposits (планеты+луны): объектная форма
 *     (те же имена ключей × ~38k записей);
 *   - 2.0 МБ — координаты гексов (детерминированы сеткой по индексу) и
 *     buildingId:null/buildingLevel:0 для незастроенных гексов.
 *
 * Формат v2 (маркер `fmt: 2` верхнего уровня) решает всё сразу:
 *   1. Залежи → кортежи [elementId, availability, quantity, depth];
 *      availability округляется до 3 знаков (генератор уже даёт ~0.001
 *      точность в агрегатах — семантика не меняется).
 *   2. Свод resourceDeposits → кортежи [elementId, totalQuantity,
 *      avgAvailability, tierIdx, hexCount, maxAvailability], tierIdx:
 *      0=profile, 1=rare, 2=ultra_rare. ВАЖНО: свод НЕ пересчитывается из
 *      гексов — aggregateResourceDeposits() добавляет RNG-контент
 *      (гарантированные элементы таблицы + ультраредкие), которого в гексах
 *      нет, поэтому данные сохраняются полностью, меняется только форма.
 *   3. Гексы: без coord (восстанавливается generateHexCoords(length)[i] —
 *      порядок массива = порядок сетки, count неизменен после генерации),
 *      без buildingId/buildingLevel для незастроенных (→ null/0), без
 *      deposits:[] (→ []); поля специализации процессора — только у
 *      застроенных (как и раньше).
 *   4. Звёзды: mass/luminosity/temperature/radius → 4 значащих цифры
 *      (хвосты float-арифметики не несут смысла).
 *
 * Орбитальные/атмосферные слоты НЕ сжимаются: все пустые слоты всей
 * галактики дают 0.18 МБ (0.6%), а их количество для ГГ — RNG и требует
 * отдельного поля-счётчика. Слоп-эффект не стоит сложности.
 *
 * Обратная совместимость: сейвы без `fmt` (= v1, объектная форма) читаются
 * как раньше — decode проверяет `raw.fmt === 2` и иначе не трогает объект.
 * Идемпотентность: encode(decode(encode(s))) === encode(s) (округления
 * стабильны, кортежи восстанавливаются в объекты и обратно).
 *
 * Замер (200 систем, seed 42): 31.42 МБ → ~8.4 МБ plain (−73%),
 * gzip-транспорт (R-26): 5.26 → ~1.8 МБ. БД хранит v2 → место под сейвы
 * экономится в 3.7 раза.
 */

import { generateHexCoords } from '@/galaxy/hex-grid';
import type { HexTerrain, PlanetResourceDeposit, ResourceDeposit } from '@/core/types';

/** Версия компактного формата (маркер в корне JSON). */
export const SAVE_FORMAT_VERSION = 2;

// ============ Округление ============

/** Округление до 3 знаков после запятой (0..1 диапазоны: availability). */
function round3(v: number): number {
  if (!Number.isFinite(v)) return v;
  return Math.round(v * 1000) / 1000;
}

/** 4 значащих цифры — для float любой magnitude (luminosity 2.3e-4 и т.п.). */
function roundSig4(v: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  return Number(v.toPrecision(4));
}

// ============ Tier ↔ индекс ============

const TIER_TO_IDX: Record<PlanetResourceDeposit['tier'], number> = {
  profile: 0,
  rare: 1,
  ultra_rare: 2,
};

const TIER_FROM_IDX: readonly PlanetResourceDeposit['tier'][] = ['profile', 'rare', 'ultra_rare'];

// ============ Внутренние типы (работа с plain JSON) ============

/** Простой JSON-объект (после JSON.parse / перед JSON.stringify). */
type Plain = Record<string, unknown>;

interface PlainHex {
  coord?: { q: number; r: number };
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
}

// ============ Encode: v1 (объекты) → v2 (компакт) ============

/**
 * Уплотняет уже-сериализуемую форму GameState (systemMap/bakedModel удалены,
 * Map'ы конвертированы в entries) в формат v2.
 *
 * Чистая функция: строит НОВЫЕ объекты (system/star/planet/hex), не мутируя
 * живое состояние — serde caller'а может передавать shallow-копию живого
 * state (как делает serializeGameState).
 */
export function compactSaveV2<T extends Plain>(raw: T): T & { fmt: number } {
  const galaxy = raw.galaxy as Plain | undefined;
  const systems = (galaxy?.systems as Plain[] | undefined) ?? [];
  return {
    ...raw,
    fmt: SAVE_FORMAT_VERSION,
    galaxy: {
      ...galaxy,
      systems: systems.map((sys) => {
        const stars = (sys.stars as Plain[] | undefined) ?? [];
        const planets = (sys.planets as Plain[] | undefined) ?? [];
        return {
          ...sys,
          stars: stars.map(compactStar),
          planets: planets.map((p) => {
            const planet = { ...p } as Plain & { moons?: Plain[] };
            compactBody(planet);
            const moons = (planet.moons as Plain[] | undefined) ?? [];
            planet.moons = moons.map((m) => {
              const moon = { ...m };
              compactBody(moon);
              return moon;
            });
            return planet;
          }),
        };
      }),
    },
  };
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

/** Уплотнение гексов + свода залежей планеты или луны. */
function compactBody(body: Plain & Partial<PlainBody>): void {
  if (Array.isArray(body.hexes) && body.hexes.length > 0) {
    body.hexes = body.hexes.map((h) => compactHex(h as PlainHex));
  }
  if (Array.isArray(body.resourceDeposits)) {
    body.resourceDeposits = (body.resourceDeposits as Plain[]).map((rd) => [
      rd.elementId,
      rd.totalQuantity,
      rd.avgAvailability,
      TIER_TO_IDX[(rd.tier as PlanetResourceDeposit['tier']) ?? 'rare'] ?? 1,
      rd.hexCount,
      rd.maxAvailability,
    ]);
  }
}

function compactHex(hex: PlainHex): Plain {
  const out: Plain = { terrain: hex.terrain };
  if (hex.buildingId !== null && hex.buildingId !== undefined) {
    out.buildingId = hex.buildingId;
    out.buildingLevel = hex.buildingLevel;
    // Поля специализации — только у застроенных (как в v1: undefined опускается)
    if (hex.processorType !== undefined) out.processorType = hex.processorType;
    if (hex.specialization !== undefined) out.specialization = hex.specialization;
    if (hex.specializationLevel !== undefined) out.specializationLevel = hex.specializationLevel;
    if (hex.activeRecipes !== undefined) out.activeRecipes = hex.activeRecipes;
  }
  if (Array.isArray(hex.deposits) && hex.deposits.length > 0) {
    out.deposits = (hex.deposits as Plain[]).map((d) => [
      d.elementId,
      round3(d.availability as number),
      d.quantity,
      d.depth,
    ] as unknown[]);
  }
  return out;
}

// ============ Decode: v2 (компакт) → v1 (объекты) ============

/**
 * Разворачивает v2-форму в каноничную v1-объектную (которую ждёт остальная
 * часть deserializeGameState: migratePlanet, zod-валидация и т.д.).
 *
 * Сейвы без `fmt: 2` (v1 и более старые) возвращаются как есть — полная
 * обратная совместимость.
 */
export function expandSaveV2<T extends Plain>(raw: T): T {
  if (raw.fmt !== SAVE_FORMAT_VERSION) return raw;
  const galaxy = raw.galaxy as Plain | undefined;
  if (!galaxy || !Array.isArray(galaxy.systems)) return raw;
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
      expandBody(p as Plain);
      const moons = p.moons as Plain[] | undefined;
      if (Array.isArray(moons)) {
        for (const m of moons) expandBody(m);
      }
    }
  }
  delete raw.fmt;
  return raw;
}

/** Реконструкция гексов и свода залежей (обратная к compactBody). */
function expandBody(body: Plain): void {
  if (Array.isArray(body.hexes)) {
    const coords = generateHexCoords(body.hexes.length);
    body.hexes = body.hexes.map((h, i) => {
      const hex = h as PlainHex;
      const out: Plain = {
        coord: coords[i] ?? { q: 0, r: 0 },
        terrain: hex.terrain,
        buildingId: hex.buildingId ?? null,
        buildingLevel: hex.buildingLevel ?? 0,
        deposits: Array.isArray(hex.deposits)
          ? (hex.deposits as unknown[][]).map((d) => ({
            elementId: d[0] as string,
            availability: d[1] as number,
            quantity: d[2] as number,
            depth: d[3] as number,
          }))
          : ([] as ResourceDeposit[]),
      };
      if (hex.processorType !== undefined) out.processorType = hex.processorType;
      if (hex.specialization !== undefined) out.specialization = hex.specialization;
      if (hex.specializationLevel !== undefined) out.specializationLevel = hex.specializationLevel;
      if (hex.activeRecipes !== undefined) out.activeRecipes = hex.activeRecipes;
      return out;
    });
  }
  if (Array.isArray(body.resourceDeposits) && body.resourceDeposits.length > 0 && Array.isArray(body.resourceDeposits[0])) {
    body.resourceDeposits = (body.resourceDeposits as unknown[][]).map((rd) => ({
      elementId: rd[0] as string,
      totalQuantity: rd[1] as number,
      avgAvailability: rd[2] as number,
      tier: TIER_FROM_IDX[rd[3] as number] ?? 'rare',
      hexCount: rd[4] as number,
      maxAvailability: rd[5] as number,
    }));
  }
}

// ============ Хелперы для тестов/инспекции ============

/** Истинно, если JSON-строка — компактный формат v2 (маркер fmt). */
export function isSaveFormatV2(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Plain;
    return parsed.fmt === SAVE_FORMAT_VERSION;
  } catch {
    return false;
  }
}
