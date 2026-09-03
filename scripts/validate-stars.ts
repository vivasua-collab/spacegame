/**
 * Валидатор звёздного каталога + размерностей гекс-сеток (R-STARS-DATA / Etap 4.1).
 *
 * Проверяет (данные — источник истины, код должен им соответствовать):
 *
 * Раздел 1 — STARS (src/data/stars/types.json):
 *   1. Структура: mainSequence (ровно 7) + special (ровно 5) + comment.
 *   2. СПЕКТРАЛЬНАЯ ЦЕПОЧКА: mainSequence в точном порядке O→B→A→F→G→K→M
 *      (критично для selectCompanionStar «тот же класс или на 1 ниже» и
 *      STAR_TYPES.slice(0, 7) в generate-systems.ts).
 *   3. Специальные типы = {WD, RG, NS, PULSAR, BH}, каждый с ranges.
 *   4. Уникальность type-ID (12 шт.), weights > 0.
 *   5. Доля специальных звёзд: 2% ≤ fraction ≤ 5% (требование владельца
 *      2026-08-31: «несколько процентов, не больше 5»).
 *   6. Физическая монотонность ГП: T/M/L строго убывают вдоль цепочки
 *      O→M (спектральная последовательность).
 *   7. minPlanets ≤ maxPlanets, все числа ≥ 0, цвета — валидный hex.
 *   8. ranges: min ≤ max по каждому параметру.
 *   9. Loader API: STAR_TYPES (12), STAR_TYPE_MAP (12), STAR_WEIGHTS,
 *      SPECIAL_STAR_RANGES (5), MAIN_SEQUENCE_TYPES (7), SPECTRAL_CHAIN.
 *
 * Раздел 2 — GRIDS (src/data/planets/grids.json):
 *  10. Структура: planetGrids (ровно 5: tiny..huge) + moonGrids (ровно 2:
 *      tiny, small) + comment.
 *  11. Значения — центрированные гекс-числа 1+3k(k+1) (полные кольца).
 *  12. Планетарные сетки возрастают; малые сетки лун ≤ min планетарной.
 *  13. Loader API: PLANET_GRIDS/MOON_GRIDS соответствуют JSON;
 *      SIZE_HEX_COUNT (planet-types) === PLANET_GRIDS;
 *      MOON_SIZE_HEX_COUNT === MOON_GRIDS.
 *
 * Run: bun run validate:stars
 */

import {
  STAR_TYPES,
  STAR_TYPE_MAP,
  STAR_WEIGHTS,
  getStarTypeDef,
  SPECIAL_STAR_RANGES,
  MAIN_SEQUENCE_TYPES,
  MAIN_SEQUENCE_STAR_TYPES,
  MAIN_SEQUENCE_STAR_WEIGHTS,
  SPECTRAL_CHAIN,
  specialStarFraction,
} from '../src/data/stars';
import { PLANET_GRIDS, MOON_GRIDS } from '../src/data/planets/grids';
import { SIZE_HEX_COUNT, MOON_SIZE_HEX_COUNT } from '../src/data/planet-types';
import starsData from '../src/data/stars/types.json';
import gridsData from '../src/data/planets/grids.json';

let errors = 0;
let warnings = 0;

function err(msg: string): void {
  errors++;
  console.error(`  ❌ ${msg}`);
}

function ok(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

function warn(msg: string): void {
  warnings++;
  console.warn(`  ⚠️  ${msg}`);
}

/** Центрированное гекс-число: 1 + 3k(k+1) для целого k ≥ 1 (7, 19, 37, ...). */
function isCenteredHex(n: number): boolean {
  // n = 1 + 3k(k+1) → 3k² + 3k + (1 - n) = 0 → k = (-3 + √(9-12(1-n)))/6
  const disc = 9 - 12 * (1 - n);
  if (disc < 0) return false;
  const sqrtDisc = Math.sqrt(disc);
  const k = (-3 + sqrtDisc) / 6;
  return Number.isInteger(k) && k >= 1;
}

// ============ Раздел 1: STARS ============

console.log('═══════════════════════════════════════════════════════════════');
console.log('  STARS VALIDATION REPORT (R-STARS-DATA / Etap 4.1)');
console.log('═══════════════════════════════════════════════════════════════');

const starsFile = starsData as unknown as {
  comment?: string;
  mainSequence: Array<{ type: string; name: string; mass: number; luminosity: number; temperature: number; radius: number; color: string; minPlanets: number; maxPlanets: number; weight: number }>;
  special: Array<{ type: string; ranges?: Record<string, number>; weight: number }>;
};

// 1. Структура
if (!starsFile.comment || starsFile.comment.length < 50) err('types.json: отсутствует/короткий top-level comment');
if (!Array.isArray(starsFile.mainSequence)) err('types.json: нет массива mainSequence');
if (!Array.isArray(starsFile.special)) err('types.json: нет массива special');
if (starsFile.mainSequence?.length === 7) ok(`mainSequence: ровно 7 записей (ГП)`);
else err(`mainSequence: ожидалось 7 записей, найдено ${starsFile.mainSequence?.length}`);

const specialCount = starsFile.special?.length ?? 0;
if (specialCount === 5) ok('special: ровно 5 записей (вне ГП)');
else err(`special: ожидалось 5 записей, найдено ${specialCount}`);

// 2. СПЕКТРАЛЬНАЯ ЦЕПОЧКА O→B→A→F→G→K→M (порядок обязателен!)
const EXPECTED_CHAIN = ['STAR_O', 'STAR_B', 'STAR_A', 'STAR_F', 'STAR_G', 'STAR_K', 'STAR_M'];
const actualChain = (starsFile.mainSequence ?? []).map(s => s.type);
if (JSON.stringify(actualChain) === JSON.stringify(EXPECTED_CHAIN)) {
  ok('СПЕКТРАЛЬНАЯ ЦЕПОЧКА: mainSequence в точном порядке O→B→A→F→G→K→M');
} else {
  err(`СПЕКТРАЛЬНАЯ ЦЕПОЧКА: порядок нарушен! Ожидалось ${EXPECTED_CHAIN.join('→')}, найдено ${actualChain.join('→')}`);
}

// Проверка совпадения с SPECTRAL_CHAIN из loader'а
if (JSON.stringify(SPECTRAL_CHAIN) === JSON.stringify(EXPECTED_CHAIN)) {
  ok('SPECTRAL_CHAIN (loader) совпадает с эталоном O→B→A→F→G→K→M');
} else {
  err('SPECTRAL_CHAIN (loader) не совпадает с эталоном');
}

// 3. Специальные типы
const EXPECTED_SPECIAL = new Set(['STAR_WD', 'STAR_RG', 'STAR_NS', 'STAR_PULSAR', 'STAR_BH']);
const actualSpecial = new Set((starsFile.special ?? []).map(s => s.type));
let specialSetOk = actualSpecial.size === EXPECTED_SPECIAL.size;
for (const t of EXPECTED_SPECIAL) if (!actualSpecial.has(t)) specialSetOk = false;
if (specialSetOk) ok('special: типы = {WD, RG, NS, PULSAR, BH}');
else err(`special: неожиданный набор типов: ${[...actualSpecial].join(', ')}`);

for (const s of starsFile.special ?? []) {
  const r = s.ranges;
  if (!r) {
    err(`special ${s.type}: отсутствует ranges`);
    continue;
  }
  for (const key of ['massMin', 'massMax', 'tempMin', 'tempMax', 'radiusMin', 'radiusMax']) {
    if (typeof r[key] !== 'number' || Number.isNaN(r[key])) err(`special ${s.type}.ranges.${key}: не число`);
  }
  if (r.massMin !== undefined && r.massMax !== undefined && r.massMin > r.massMax) err(`special ${s.type}.ranges: massMin > massMax`);
  if (r.tempMin !== undefined && r.tempMax !== undefined && r.tempMin > r.tempMax) err(`special ${s.type}.ranges: tempMin > tempMax`);
  if (r.radiusMin !== undefined && r.radiusMax !== undefined && r.radiusMin > r.radiusMax) err(`special ${s.type}.ranges: radiusMin > radiusMax`);
}
ok('special: все ranges валидны (min ≤ max, 6 числовых полей)');

// 4. Уникальность + веса
const allIds = [...actualChain, ...(starsFile.special ?? []).map(s => s.type)];
const uniqueIds = new Set(allIds);
if (uniqueIds.size === allIds.length) ok(`Уникальность: ${allIds.length} type-ID без дубликатов`);
else err(`Дубликаты type-ID: ${allIds.length - uniqueIds.size} шт.`);

for (const s of [...(starsFile.mainSequence ?? []), ...(starsFile.special ?? [])] as Array<{ type: string; weight: number }>) {
  if (!(s.weight > 0)) err(`${s.type}: weight должен быть > 0 (найдено ${s.weight})`);
}
ok('weights: все > 0');

// 5. Доля специальных звёзд (требование владельца)
const fraction = specialStarFraction();
const fractionPct = fraction * 100;
if (fractionPct > 5) err(`Доля специальных звёзд ${fractionPct.toFixed(3)}% > 5% (лимит владельца)`);
else if (fractionPct < 2) err(`Доля специальных звёзд ${fractionPct.toFixed(3)}% < 2% («несколько процентов»)`);
else ok(`Доля специальных звёзд: ${fractionPct.toFixed(3)}% (2% ≤ x ≤ 5%) — требование владельца выполнено`);

// 6. Физическая монотонность ГП вдоль цепочки
const ms = starsFile.mainSequence ?? [];
let monotonicOk = true;
for (let i = 1; i < ms.length && ms[i]; i++) {
  const prev = ms[i - 1]!;
  const cur = ms[i]!;
  if (prev.temperature <= cur.temperature) { monotonicOk = false; err(`Цепочка: T(${prev.type})=${prev.temperature}K ≤ T(${cur.type})=${cur.temperature}K — температура должна убывать O→M`); }
  if (prev.mass <= cur.mass) { monotonicOk = false; err(`Цепочка: M(${prev.type})=${prev.mass} ≤ M(${cur.type})=${cur.mass} — масса должна убывать O→M`); }
  if (prev.luminosity <= cur.luminosity) { monotonicOk = false; err(`Цепочка: L(${prev.type})=${prev.luminosity} ≤ L(${cur.type})=${cur.luminosity} — светимость должна убывать O→M`); }
}
if (monotonicOk) ok('Физическая монотонность ГП: T, M, L строго убывают вдоль O→B→A→F→G→K→M');

// 7. Числовая валидность + цвета
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
for (const s of [...ms, ...(starsFile.special ?? [])] as Array<{ type: string; name: string; mass: number; luminosity: number; temperature: number; radius: number; color: string; minPlanets: number; maxPlanets: number }>) {
  if (s.mass < 0 || s.luminosity < 0 || s.temperature < 0 || s.radius < 0) err(`${s.type}: отрицательные физические параметры`);
  if (s.minPlanets < 0) err(`${s.type}: minPlanets < 0`);
  if (s.minPlanets > s.maxPlanets) err(`${s.type}: minPlanets (${s.minPlanets}) > maxPlanets (${s.maxPlanets})`);
  if (!s.name || s.name.length < 2) err(`${s.type}: пустое name`);
  if (!HEX_RE.test(s.color)) err(`${s.type}: color «${s.color}» не соответствует формату #rrggbb`);
}
ok('Числовые параметры и цвета валидны (≥0, min≤max, #rrggbb)');

// 8. Loader API
if (STAR_TYPES.length === 12) ok('STAR_TYPES (loader): 12 записей = 7 ГП + 5 специальных');
else err(`STAR_TYPES (loader): ожидалось 12, найдено ${STAR_TYPES.length}`);

if (STAR_TYPE_MAP.size === 12) ok('STAR_TYPE_MAP: 12 записей');
else err(`STAR_TYPE_MAP: ${STAR_TYPE_MAP.size} записей (ожидалось 12)`);

const gDef = getStarTypeDef('STAR_G');
if (gDef?.name === 'Жёлтый карлик' && gDef?.mass === 0.92) ok('getStarTypeDef(STAR_G): имя и масса верны');
else err(`getStarTypeDef(STAR_G): неожиданный результат (${gDef?.name}, ${gDef?.mass})`);

if (STAR_WEIGHTS.length === 12 && STAR_WEIGHTS.every(w => w > 0)) ok('STAR_WEIGHTS: 12 положительных весов');
else err('STAR_WEIGHTS: неверная длина или неположительные веса');

if (Object.keys(SPECIAL_STAR_RANGES).length === 5) ok('SPECIAL_STAR_RANGES: 5 записей (WD/RG/NS/PULSAR/BH)');
else err(`SPECIAL_STAR_RANGES: ${Object.keys(SPECIAL_STAR_RANGES).length} записей (ожидалось 5)`);

if (MAIN_SEQUENCE_TYPES.size === 7 && !MAIN_SEQUENCE_TYPES.has('STAR_WD') && !MAIN_SEQUENCE_TYPES.has('STAR_BH')) {
  ok('MAIN_SEQUENCE_TYPES: 7 записей ГП, без специальных');
} else {
  err('MAIN_SEQUENCE_TYPES: неверное содержимое');
}

if (MAIN_SEQUENCE_STAR_TYPES.length === 7 && MAIN_SEQUENCE_STAR_WEIGHTS.length === 7) {
  ok('MAIN_SEQUENCE_STAR_TYPES/WEIGHTS: по 7 записей (для выбора компаньонов)');
} else {
  err('MAIN_SEQUENCE_STAR_TYPES/WEIGHTS: неверная длина');
}

// STAR_TYPES.slice(0, 7) === mainSequence — инвариант generate-systems
const sliceTypes = STAR_TYPES.slice(0, 7).map(s => s.type);
if (JSON.stringify(sliceTypes) === JSON.stringify(EXPECTED_CHAIN)) {
  ok("STAR_TYPES.slice(0, 7) === ГП цепочка (инвариант generate-systems.ts)");
} else {
  err('STAR_TYPES.slice(0, 7) !== ГП цепочка — generate-systems сломается!');
}

// ============ Раздел 2: GRID DIMENSIONS ============

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  PLANET GRID DIMENSIONS VALIDATION (grids.json)');
console.log('═══════════════════════════════════════════════════════════════');

const gridsFile = gridsData as unknown as {
  comment?: string;
  planetGrids: Record<string, number>;
  moonGrids: Record<string, number>;
};

// 10. Структура: минимум 5 планетарных + 2 малые лунные (требование владельца)
const planetKeys = Object.keys(gridsFile.planetGrids ?? {});
const moonKeys = Object.keys(gridsFile.moonGrids ?? {});
if (planetKeys.length >= 5) ok(`planetGrids: ${planetKeys.length} сеток (≥ 5 — требование владельца)`);
else err(`planetGrids: ${planetKeys.length} сеток < 5 (минимум владельца)`);

if (moonKeys.length >= 2) ok(`moonGrids: ${moonKeys.length} малые сетки (≥ 2 — требование владельца)`);
else err(`moonGrids: ${moonKeys.length} сеток < 2 (минимум владельца)`);

const EXPECTED_SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];
for (const sz of EXPECTED_SIZES) {
  if (!(sz in (gridsFile.planetGrids ?? {}))) err(`planetGrids: отсутствует ключ ${sz}`);
}
for (const sz of ['tiny', 'small']) {
  if (!(sz in (gridsFile.moonGrids ?? {}))) err(`moonGrids: отсутствует ключ ${sz}`);
}
ok('Ключи: planetGrids {tiny,small,medium,large,huge}, moonGrids {tiny,small}');

// 11. Центрированные гекс-числа
let hexOk = true;
for (const [sz, n] of Object.entries(gridsFile.planetGrids ?? {})) {
  if (!isCenteredHex(n)) { hexOk = false; err(`planetGrids.${sz} = ${n}: не центрированное гекс-число (1+3k(k+1))`); }
}
for (const [sz, n] of Object.entries(gridsFile.moonGrids ?? {})) {
  if (!isCenteredHex(n)) { hexOk = false; err(`moonGrids.${sz} = ${n}: не центрированное гекс-число`); }
}
if (hexOk) ok('Все размерности — центрированные гекс-числа 1+3k(k+1) (полные кольца axial-сетки)');

// 12. Возрастание + малость лунных
const planetValues = Object.values(gridsFile.planetGrids ?? {});
const moonValues = Object.values(gridsFile.moonGrids ?? {});
let ascending = true;
for (let i = 1; i < planetValues.length; i++) {
  if (planetValues[i]! <= planetValues[i - 1]!) { ascending = false; err(`planetGrids: значения не возрастают (${planetValues[i - 1]} → ${planetValues[i]})`); }
}
if (ascending && planetValues.length > 1) ok('planetGrids: значения строго возрастают tiny→huge');

const minPlanet = Math.min(...planetValues);
const maxMoon = Math.max(...moonValues);
if (maxMoon <= minPlanet) ok(`moonGrids: max (${maxMoon}) ≤ min planetGrids (${minPlanet}) — сетки лун действительно малые`);
else err(`moonGrids: max (${maxMoon}) > min planetGrids (${minPlanet}) — лунные сетки должны быть малыми`);

// 13. Loader API + обратная совместимость
if (JSON.stringify(PLANET_GRIDS) === JSON.stringify(gridsFile.planetGrids)) ok('PLANET_GRIDS (loader) === JSON planetGrids');
else err('PLANET_GRIDS (loader) не соответствует JSON');

if (JSON.stringify(MOON_GRIDS) === JSON.stringify(gridsFile.moonGrids)) ok('MOON_GRIDS (loader) === JSON moonGrids');
else err('MOON_GRIDS (loader) не соответствует JSON');

if (JSON.stringify(SIZE_HEX_COUNT) === JSON.stringify(gridsFile.planetGrids)) {
  ok('SIZE_HEX_COUNT (planet-types, обратная совместимость) === PLANET_GRIDS');
} else {
  err('SIZE_HEX_COUNT !== PLANET_GRIDS — обратная совместимость нарушена');
}

if (JSON.stringify(MOON_SIZE_HEX_COUNT) === JSON.stringify(gridsFile.moonGrids)) {
  ok('MOON_SIZE_HEX_COUNT (planet-types) === MOON_GRIDS');
} else {
  err('MOON_SIZE_HEX_COUNT !== MOON_GRIDS');
}

// ============ Итог ============

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Star catalog:      ${STAR_TYPES.length} types (${MAIN_SEQUENCE_STAR_TYPES.length} ГП + ${Object.keys(SPECIAL_STAR_RANGES).length} специальных)`);
console.log(`  Special fraction:  ${fractionPct.toFixed(3)}% (лимит 5%)`);
console.log(`  Spectral chain:    ${MAIN_SEQUENCE_STAR_TYPES.map(s => s.type.replace('STAR_', '')).join('→')}`);
console.log(`  Planet grids:      ${planetKeys.map(k => `${k}=${gridsFile.planetGrids?.[k]}`).join(', ')}`);
console.log(`  Moon grids:        ${moonKeys.map(k => `${k}=${gridsFile.moonGrids?.[k]}`).join(', ')}`);
console.log('');
if (errors > 0) {
  console.error(`❌ FAILED: ${errors} error(s), ${warnings} warning(s) — каталог звёзд/сеток НЕ валиден.`);
  process.exit(1);
} else {
  console.log(`✅ All stars + grids data valid — data-driven каталог консистентен.`);
}
