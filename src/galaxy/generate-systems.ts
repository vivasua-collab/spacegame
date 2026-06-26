/**
 * Генерация звёздных систем.
 * Создаёт звёзды (одиночные/двойные/тройные), назначает имена.
 */

import type { Xoshiro256 } from '@/core/prng';
import type { StarSystem, Star, EntityId, BinaryType } from '@/core/types';
import { STAR_TYPES, STAR_WEIGHTS } from '@/data/star-types';
import { genId, usedNames } from './gen-context';
import { generatePlanet, toRoman } from './generate-planets';

/** G-12: Main sequence star types only (indices 0-6 in STAR_TYPES) */
const MAIN_SEQUENCE_STAR_TYPES = STAR_TYPES.slice(0, 7);
const MAIN_SEQUENCE_STAR_WEIGHTS = MAIN_SEQUENCE_STAR_TYPES.map(s => s.weight);

/** Пулы имён для систем (L-02) */
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];
const CONSTELLATIONS = ['Centauri', 'Cygni', 'Draconis', 'Eridani', 'Hydrae', 'Leonis', 'Lyrae', 'Orionis', 'Pegasi', 'Phoenicis', 'Serpentis', 'Tauri', 'Ursae', 'Velorum', 'Virginis'];

/** Генерация имени системы (L-02 fix: расширены пулы + числовой суффикс для уникальности) */
function generateSystemName(rng: Xoshiro256, index: number): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const greek = rng.nextChoice(GREEK);
    const constellation = rng.nextChoice(CONSTELLATIONS);
    const suffix = attempt > 0 ? `-${rng.nextInt(1, 999)}` : '';
    const name = `${greek} ${constellation}${suffix}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  return `System-${index + 1}`;
}

/** P1-07: Выбор типа звёздной системы */
function selectBinaryType(rng: Xoshiro256): BinaryType {
  const roll = rng.nextFloat() * 100;
  if (roll < 60) return 'BINARY_NONE';
  if (roll < 80) return 'BINARY_CLOSE';
  if (roll < 95) return 'BINARY_WIDE';
  return 'BINARY_TRIPLE';
}

/**
 * G-12 fix: Выбор спутника для двойной/тройной системы.
 * «Тот же класс или на 1 ниже» — только среди главной последовательности (indices 0-6).
 * Специальные типы (WD, RG, NS, PULSAR, BH) не используются для компаньонов.
 */
function selectCompanionStar(primaryDef: typeof STAR_TYPES[0], rng: Xoshiro256): typeof STAR_TYPES[0] {
  if (rng.nextBool(0.7)) {
    const currentIdx = MAIN_SEQUENCE_STAR_TYPES.indexOf(primaryDef);
    if (currentIdx === -1) {
      return rng.weightedChoice(MAIN_SEQUENCE_STAR_TYPES, MAIN_SEQUENCE_STAR_WEIGHTS);
    }
    const companionIdx = Math.max(0, Math.min(MAIN_SEQUENCE_STAR_TYPES.length - 1, currentIdx + rng.nextInt(0, 1)));
    return MAIN_SEQUENCE_STAR_TYPES[companionIdx];
  }
  return rng.weightedChoice(MAIN_SEQUENCE_STAR_TYPES, MAIN_SEQUENCE_STAR_WEIGHTS);
}

/**
 * G-32 fix: Создать объект звезды по алгоритму из 02-stars.md §6, Шаг 4.
 *
 * Главная последовательность:
 *   1. Масса: ±15% от среднего, clamp в диапазон типа
 *   2. Светимость: L = M^3.5 (M<2) или M^2.3 (M≥2) — из массы
 *   3. Радиус: R = M^0.8 (M<1) или M^0.57 (M≥1) — из массы
 *   4. Температура: T = 5778 × (L/R²)^0.25 — Стефан-Больцман
 *
 * Специальные типы (WD, RG, NS, PULSAR, BH):
 *   - T и R выбираются из документированных диапазонов
 *   - L вычисляется из T и R: L = R² × (T/5778)⁴ — гарантирует Стефан-Больцман
 *   - Для NS/PULSAR: L ≈ 0 (косметическая T)
 *   - Для BH: L = 0, T = 0
 *
 * Стефан-Больцман: L = 4πR²σT⁴ → L/L☉ = (R/R☉)² × (T/T☉)⁴
 * T☉ = 5778K
 */

/** Диапазоны параметров для специальных типов звёзд (из 02-stars.md §2.1) */
const SPECIAL_STAR_RANGES: Record<string, {
  massMin: number; massMax: number;
  tempMin: number; tempMax: number;
  radiusMin: number; radiusMax: number;
}> = {
  STAR_WD:     { massMin: 0.5, massMax: 1.4, tempMin: 8000,  tempMax: 40000,  radiusMin: 0.008, radiusMax: 0.02 },
  STAR_RG:     { massMin: 0.5, massMax: 8.0, tempMin: 3000,  tempMax: 5000,   radiusMin: 10,    radiusMax: 200 },
  STAR_NS:     { massMin: 1.1, massMax: 2.1, tempMin: 500000, tempMax: 700000, radiusMin: 0.00001, radiusMax: 0.00001 },
  STAR_PULSAR: { massMin: 1.1, massMax: 2.1, tempMin: 800000, tempMax: 1200000, radiusMin: 0.00001, radiusMax: 0.00001 },
  STAR_BH:     { massMin: 3,   massMax: 50,  tempMin: 0,     tempMax: 0,      radiusMin: 0,     radiusMax: 0 },
};

/** Главная последовательность: индексы 0-6 в STAR_TYPES */
const MAIN_SEQUENCE_TYPES = new Set(['STAR_O', 'STAR_B', 'STAR_A', 'STAR_F', 'STAR_G', 'STAR_K', 'STAR_M']);

/** Стефан-Больцман: L/L☉ = (R/R☉)² × (T/T☉)⁴ */
function stefanBoltzmannLuminosity(radiusRs: number, temperatureK: number): number {
  const T_SUN = 5778;
  return radiusRs * radiusRs * Math.pow(temperatureK / T_SUN, 4);
}

/** Стефан-Больцман: T = T☉ × (L/R²)^0.25 */
function stefanBoltzmannTemperature(luminosityLs: number, radiusRs: number): number {
  const T_SUN = 5778;
  return T_SUN * Math.pow(luminosityLs / (radiusRs * radiusRs), 0.25);
}

function createStar(systemId: EntityId, systemName: string, starDef: typeof STAR_TYPES[0], rng: Xoshiro256): Star {
  const isMainSequence = MAIN_SEQUENCE_TYPES.has(starDef.type);

  let mass: number;
  let luminosity: number;
  let temperature: number;
  let radius: number;

  if (isMainSequence) {
    // === Главная последовательность: алгоритм из 02-stars.md §6, Шаг 4 ===
    // Вариация ±15% для массы и светимости, R из массы, T из L/R (Стефан-Больцман)
    // Это гарантирует физическую согласованность T, L, R.

    // 1. Масса: ±15% вариация от среднего
    const massVariation = 1.0 + (rng.nextFloat() * 0.3 - 0.15); // 0.85–1.15
    mass = starDef.mass * massVariation;

    // 2. Светимость: ±15% вариация от табличного среднего
    // (M^3.5/M^2.3 — грубое приближение, занижает O/B классы;
    //  табличные значения точнее, а T вычисляется для согласованности)
    const lumVariation = 1.0 + (rng.nextFloat() * 0.3 - 0.15); // 0.85–1.15
    luminosity = starDef.luminosity * lumVariation;

    // 3. Радиус из массы (02-stars.md §6, Шаг 4)
    if (mass < 1) {
      radius = Math.pow(mass, 0.8);
    } else {
      radius = Math.pow(mass, 0.57);
    }

    // 4. Температура из L и R — закон Стефана-Больцмана (02-stars.md §6, Шаг 4)
    // T = T☉ × (L / R²)^0.25 — гарантирует L = R² × (T/T☉)⁴
    temperature = stefanBoltzmannTemperature(luminosity, Math.max(0.001, radius));
  } else {
    // === Специальные типы: T и R из диапазонов, L из Стефана-Больцмана ===
    const ranges = SPECIAL_STAR_RANGES[starDef.type];

    if (!ranges) {
      // Fallback — не должно происходить
      mass = starDef.mass;
      luminosity = starDef.luminosity;
      temperature = starDef.temperature;
      radius = starDef.radius;
    } else if (starDef.type === 'STAR_BH') {
      // Чёрная дыра: L=0, T=0
      mass = ranges.massMin + rng.nextFloat() * (ranges.massMax - ranges.massMin);
      luminosity = 0;
      temperature = 0;
      radius = 0;
    } else if (starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR') {
      // Нейтронная звезда / пульсар: L≈0 в оптике, T косметическая
      mass = ranges.massMin + rng.nextFloat() * (ranges.massMax - ranges.massMin);
      temperature = ranges.tempMin + rng.nextFloat() * (ranges.tempMax - ranges.tempMin);
      radius = ranges.radiusMin;
      // L для NS/PULSAR пренебрежимо мала в оптике, но используем Стефана-Больцмана
      // для корректного расчёта температуры планет (должна быть ≈0)
      luminosity = Math.max(0.0001, stefanBoltzmannLuminosity(radius, temperature));
    } else {
      // Белый карлик (WD) / Красный гигант (RG):
      // Выбираем T и R из диапазонов, L из Стефана-Больцмана
      mass = ranges.massMin + rng.nextFloat() * (ranges.massMax - ranges.massMin);
      temperature = ranges.tempMin + rng.nextFloat() * (ranges.tempMax - ranges.tempMin);
      radius = ranges.radiusMin + rng.nextFloat() * (ranges.radiusMax - ranges.radiusMin);
      luminosity = stefanBoltzmannLuminosity(radius, temperature);
    }
  }

  return {
    id: genId('star'),
    systemId,
    type: starDef.type,
    name: `${systemName} (звезда)`,
    mass,
    luminosity,
    temperature,
    radius,
    color: starDef.color,
  };
}

/** Генерация звёздной системы */
export function generateSystem(
  position: { x: number; y: number },
  index: number,
  rng: Xoshiro256,
  cfg: { maxJumpPointsPerSystem: number },
): StarSystem {
  const systemId = genId('sys');

  // P1-07: определить тип системы (одиночная/двойная/тройная)
  const binaryType = selectBinaryType(rng);

  // Тип главной звезды
  const starDef = rng.weightedChoice(STAR_TYPES, STAR_WEIGHTS);

  // Имя системы
  const name = generateSystemName(rng, index);

  // Звёзды в системе
  const stars: Star[] = [];
  const primaryStar = createStar(systemId, name, starDef, rng.derive('star_primary'));
  stars.push(primaryStar);

  if (binaryType !== 'BINARY_NONE') {
    const companionDef = selectCompanionStar(starDef, rng);
    const companionStar = createStar(systemId, name, companionDef, rng.derive('star_secondary'));
    stars.push(companionStar);

    if (binaryType === 'BINARY_TRIPLE') {
      const tertiaryDef = selectCompanionStar(starDef, rng);
      const tertiaryStar = createStar(systemId, name, tertiaryDef, rng.derive('star_tertiary'));
      stars.push(tertiaryStar);
    }
  }

  // G-03 fix: Планеты используют РЕАЛЬНУЮ звезду (с ±20% вариацией)
  const totalPlanets = rng.nextInt(starDef.minPlanets, starDef.maxPlanets);
  const stabilityMult = binaryType === 'BINARY_NONE' ? 1.0
    : binaryType === 'BINARY_WIDE' ? 0.9
    : binaryType === 'BINARY_CLOSE' ? 0.6 : 0.5;
  const planetCount = Math.floor(totalPlanets * stabilityMult);

  const planets = [];
  for (let i = 0; i < planetCount; i++) {
    const planetRng = rng.derive(`planet_${i}`);
    const planet = generatePlanet(systemId, i + 1, name, primaryStar, binaryType, planetRng);
    planets.push(planet);
  }

  // G-17 fix: Астероидные поля с бонусами за газовый гигант и двойную систему
  let asteroidFields = rng.nextInt(
    starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 1 : 0,
    starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 4 : 3,
  );
  const maxAsteroidFields = starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 4 : 3;

  const hasGasGiant = planets.some(p => p.type === 'gas_giant');
  if (hasGasGiant) {
    asteroidFields = Math.min(maxAsteroidFields, asteroidFields + 1);
  }
  if (binaryType !== 'BINARY_NONE') {
    asteroidFields = Math.min(maxAsteroidFields, asteroidFields + 1);
  }

  return {
    id: systemId,
    name,
    position,
    binaryType,
    stars,
    planets,
    asteroidFields,
    jumpPoints: [],
    discovered: false,
    owner: null,
  };
}
