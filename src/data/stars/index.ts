/**
 * Etap 4.1 — R-STARS-DATA: Каталог типов звёзд (data-driven JSON).
 *
 * Источник истины: `src/data/stars/types.json` (человекочитаемый JSON).
 * Этот файл — тонкий loader: импортирует JSON, кастит к типам и строит
 * lookup-мапы для O(1) поиска по type.
 *
 * Структура каталога:
 *   - mainSequence (7): спектральная цепочка O→B→A→F→G→K→M — ПОРЯДОК
 *     ОБЯЗАТЕЛЕН. От него зависит:
 *       1) generate-systems.ts `STAR_TYPES.slice(0, 7)` — выделение ГП;
 *       2) selectCompanionStar — «тот же класс или на 1 ниже» через indexOf.
 *     Порядок залочен валидатором (scripts/validate-stars.ts) и тестами
 *     (tests/galaxy/star-catalog.test.ts).
 *   - special (5): типы вне главной последовательности (WD/RG/NS/PULSAR/BH)
 *     с физическими диапазонами (ranges). Суммарная доля ~4% (не больше 5%
 *     — требование владельца 2026-08-31).
 *
 * Спека: docs/20-stars.md §1.1, §2.1, §7.2.
 *
 * DATA-DRIVEN: изменение weight/добавление записи в types.json автоматически
 * меняет распределение звёзд в генераторе (weightedChoice) — без правок кода.
 *
 * Публичный API перенесён из старого `src/data/star-types.ts` (удалён):
 * STAR_TYPES, STAR_TYPE_MAP, STAR_WEIGHTS, getStarTypeDef. Плюс новые
 * экспорты: MAIN_SEQUENCE_STAR_TYPES/WEIGHTS, SPECIAL_STAR_TYPES,
 * SPECIAL_STAR_RANGES, MAIN_SEQUENCE_TYPES, SPECTRAL_CHAIN.
 */

import type { StarDef, StarType } from '@/core/types';
import starsData from './types.json';

/** Диапазоны физических параметров для специальных типов звёзд (20-stars.md §2.1). */
export interface SpecialStarRanges {
  massMin: number;
  massMax: number;
  tempMin: number;
  tempMax: number;
  radiusMin: number;
  radiusMax: number;
}

type SpecialStarDef = StarDef & { ranges: SpecialStarRanges; comment?: string };

type StarsFile = {
  comment?: string;
  mainSequence: StarDef[];
  special: SpecialStarDef[];
};

const file = starsData as unknown as StarsFile;

/**
 * 7 типов главной последовательности — ПОРЯДОК O→B→A→F→G→K→M обязателен
 * (используется selectCompanionStar через indexOf; slice(0,7) в STAR_TYPES).
 */
export const MAIN_SEQUENCE_STAR_TYPES: StarDef[] = file.mainSequence;

/** Веса только главной последовательности (для выбора компаньонов). */
export const MAIN_SEQUENCE_STAR_WEIGHTS: number[] =
  MAIN_SEQUENCE_STAR_TYPES.map((s) => s.weight);

/** 5 типов вне главной последовательности (WD/RG/NS/PULSAR/BH). */
export const SPECIAL_STAR_TYPES: SpecialStarDef[] = file.special;

/**
 * Единый каталог: главная последовательность (индексы 0–6) + специальные
 * (индексы 7–11). Порядок: mainSequence → special.
 */
export const STAR_TYPES: StarDef[] = [
  ...MAIN_SEQUENCE_STAR_TYPES,
  ...SPECIAL_STAR_TYPES,
];

/** Map starType → StarDef для O(1) поиска. */
export const STAR_TYPE_MAP = new Map<StarType, StarDef>(
  STAR_TYPES.map((s) => [s.type, s]),
);

/** Веса для генерации (пропорциональны частотам из документации). */
export const STAR_WEIGHTS = STAR_TYPES.map((s) => s.weight);

/** Получить определение типа звезды по StarType. */
export function getStarTypeDef(type: StarType): StarDef {
  return STAR_TYPE_MAP.get(type)!;
}

/**
 * Диапазоны физических параметров специальных типов (WD/RG/NS/PULSAR/BH).
 * createStar выбирает T и R из диапазона, L вычисляет по Стефану-Больцману.
 * Для типов главной последовательности записи отсутствуют (undefined).
 */
export const SPECIAL_STAR_RANGES: Record<string, SpecialStarRanges> =
  Object.fromEntries(SPECIAL_STAR_TYPES.map((s) => [s.type, s.ranges]));

/**
 * Set типов главной последовательности — быстрая проверка в createStar
 * (раньше дублировался hardcode-Set в generate-systems.ts:101).
 */
export const MAIN_SEQUENCE_TYPES: Set<string> = new Set(
  MAIN_SEQUENCE_STAR_TYPES.map((s) => s.type),
);

/** Спектральная цепочка — для валидации и документации. */
export const SPECTRAL_CHAIN: StarType[] = [
  'STAR_O', 'STAR_B', 'STAR_A', 'STAR_F', 'STAR_G', 'STAR_K', 'STAR_M',
];

/**
 * Доля специальных типов (вне главной последовательности) от суммарного веса.
 * Требование владельца: несколько процентов, но НЕ больше 5%.
 */
export function specialStarFraction(): number {
  const special = SPECIAL_STAR_TYPES.reduce((a, s) => a + s.weight, 0);
  const total = STAR_TYPES.reduce((a, s) => a + s.weight, 0);
  return total > 0 ? special / total : 0;
}
