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

/** Создать объект звезды */
function createStar(systemId: EntityId, systemName: string, starDef: typeof STAR_TYPES[0], rng: Xoshiro256): Star {
  return {
    id: genId('star'),
    systemId,
    type: starDef.type,
    name: `${systemName} (звезда)`,
    mass: starDef.mass * (0.8 + rng.nextFloat() * 0.4),
    luminosity: starDef.luminosity * (0.8 + rng.nextFloat() * 0.4),
    temperature: starDef.temperature * (0.9 + rng.nextFloat() * 0.2),
    radius: starDef.radius * (0.8 + rng.nextFloat() * 0.4),
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
