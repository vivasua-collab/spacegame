/**
 * Генератор галактики.
 * Seed-based, детерминированный, спиральная структура.
 * Поддержка двойных/тройных систем (P1-07), именованных под-seed'ов (P1-29),
 * улучшенных JP с проверками (P1-23).
 *
 * Audit fixes applied:
 * G-02: Atmosphere generated BEFORE temperature (real atmo type for greenhouse)
 * G-03: generatePlanet receives real Star object (with ±20% variation)
 * G-04/G-06: Size/radius derived from PLANET_TYPE_RADIUS + getSizeFromRadius
 * G-05/G-14: Spiral positions: bulge 15%, disk 20%, arms 60%, halo 5%
 * G-07: Atmosphere probabilities match spec §2.4 (conditional)
 * G-08: Gas giant inert/toxic swap fixed (inert=5%, toxic=4%)
 * G-09/G-01/G-10/G-11: Life generation uses per-type LIFE_LEVEL_WEIGHTS + conditions
 * G-12: Companion star only from main sequence types
 * G-13: Orbital radius with binary type awareness
 * G-15: Orbit slots use ORBIT_SLOTS_BY_SIZE (non-gas-giant)
 * G-16: Snow line added to selectPlanetType
 * G-17: Asteroid fields with gas giant/binary bonuses
 * G-18: 278 → 278.5 in calculatePlanetTemperature
 */

import { Xoshiro256 } from '@/core/prng';
import type { Galaxy, StarSystem, Star, Planet, JumpPoint, Vec2, EntityId, ResourceDeposit, HexTerrain, PlanetSize, BinaryType, Atmosphere, AtmosphereType, PlanetLife, LifeLevel, AtmosphericSlot, OrbitalSlot, PlanetResourceDeposit } from '@/core/types';
import { STAR_TYPES, STAR_WEIGHTS } from '@/data/star-types';
import { PLANET_TYPES, SIZE_HEX_COUNT, ORBIT_SLOTS, ORBIT_SLOTS_BY_SIZE, GAS_GIANT_ATMOSPHERE_SLOTS, PLANET_DENSITY, PLANET_TYPE_RADIUS, getSizeFromRadius, LIFE_LEVEL_WEIGHTS, PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS, TYPE_NAMES } from '@/data/planet-types';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { generateHexGrid } from './hex-grid';

let nextId = 1;
function genId(prefix: string): EntityId {
  return `${prefix}_${nextId++}`;
}

/** Настройки генерации галактики */
export interface GalaxyGenConfig {
  seed: number;
  systemCount: number;
  /** Радиус галактики в парсеках */
  radius: number;
  /** Количество спиральных рукавов */
  arms: number;
  /** Разброс от спиральной линии (0-1) */
  spread: number;
  /** Плотность ядра */
  bulgeDensity: number;
  /** Ширина рукава */
  armWidth: number;
  /** Закрутка рукава */
  armTwist: number;
  /** Доля диска */
  diskFraction: number;
  /** Доля ореола */
  haloFraction: number;
  /** Максимальное расстояние для JP (парсек) */
  maxJumpDistance: number;
  /** Максимальное количество JP на систему */
  maxJumpPointsPerSystem: number;
}

export const DEFAULT_CONFIG: GalaxyGenConfig = {
  seed: 42,
  systemCount: 500,
  radius: 25000, // 25 кпк в парсеках
  arms: 4,
  spread: 0.4,
  bulgeDensity: 1.5,
  armWidth: 0.5,
  armTwist: 0.6,
  diskFraction: 0.2,
  haloFraction: 0.05,
  maxJumpDistance: 5000, // 5 кпк
  maxJumpPointsPerSystem: 6,
};

/** G-12: Main sequence star types only (indices 0-6 in STAR_TYPES) */
const MAIN_SEQUENCE_STAR_TYPES = STAR_TYPES.slice(0, 7);
const MAIN_SEQUENCE_STAR_WEIGHTS = MAIN_SEQUENCE_STAR_TYPES.map(s => s.weight);

/** Генерация галактики */
export function generateGalaxy(config: Partial<GalaxyGenConfig> = {}): Galaxy {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const mainRng = new Xoshiro256(cfg.seed);
  nextId = 1; // сброс для воспроизводимости
  usedNames.clear(); // L-02: сброс имён при новой генерации

  // P1-29: именованные под-seed'ы для воспроизводимости
  const armRng = mainRng.derive('arms');
  const bulgeRng = mainRng.derive('bulge');
  const diskRng = mainRng.derive('disk');
  const haloRng = mainRng.derive('halo');
  const jpRng = mainRng.derive('jump_points');

  const systems: StarSystem[] = [];
  const systemMap = new Map<EntityId, StarSystem>();

  // 1. Генерация позиций систем (спиральная + случайная)
  const positions = generateSpiralPositions(cfg, armRng, bulgeRng, diskRng, haloRng);

  // 2. Для каждой позиции — генерация системы
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const systemRng = mainRng.derive(`system_${i}`);
    const system = generateSystem(pos, i, systemRng, cfg);
    systems.push(system);
    systemMap.set(system.id, system);
  }

  // 3. Генерация Jump Points (связей между системами) — P1-23
  generateJumpPoints(systems, jpRng, cfg);

  // 4. Проверка связности — P1-23
  ensureConnectivity(systems, jpRng, cfg);

  // 5. Отметить стартовую систему как открытую
  if (systems.length > 0) {
    systems[0].discovered = true;
  }

  return {
    id: genId('galaxy'),
    seed: cfg.seed,
    systems,
    systemMap,
  };
}

/**
 * G-05/G-14 fix: Генерация позиций в спиральной структуре.
 * Распределение по спецификации §1.1:
 * - Bulge (ядро): ~15%
 * - Disk (межрукавное пространство): ~20%
 * - Arms (спиральные рукава): ~60%
 * - Halo (ореол): ~5%
 */
function generateSpiralPositions(
  cfg: GalaxyGenConfig,
  armRng: Xoshiro256,
  bulgeRng: Xoshiro256,
  diskRng: Xoshiro256,
  haloRng: Xoshiro256,
): Vec2[] {
  const positions: Vec2[] = [];
  const armAngleStep = (2 * Math.PI) / cfg.arms;

  // G-05/G-14 fix: Распределение систем строго по спецификации §1.1
  const bulgeFraction = 0.15;
  const diskFraction = 0.20;
  const armFraction = 0.60;
  // haloFraction = 0.05 (from config)

  const haloCount = Math.floor(cfg.systemCount * cfg.haloFraction);
  const bulgeCount = Math.floor(cfg.systemCount * bulgeFraction);
  const diskCount = Math.floor(cfg.systemCount * diskFraction);
  const armCount = cfg.systemCount - bulgeCount - diskCount - haloCount;

  // Ядро (bulge) — ~15%
  for (let i = 0; i < bulgeCount; i++) {
    const angle = bulgeRng.nextFloat() * Math.PI * 2;
    const dist = bulgeRng.nextFloat() * cfg.radius * 0.1;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  // G-05/G-14 fix: Диск (inter-arm space) — ~20%
  // Uniform random positions within the galaxy radius, NOT along arms
  for (let i = 0; i < diskCount; i++) {
    const angle = diskRng.nextFloat() * Math.PI * 2;
    const dist = diskRng.nextFloat() * cfg.radius;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  // Спиральные рукава — ~60%
  for (let i = 0; i < armCount; i++) {
    const arm = armRng.nextInt(0, cfg.arms - 1);
    const armAngle = arm * armAngleStep;
    const dist = armRng.nextFloat() * cfg.radius;
    const spiralAngle = armAngle + (dist / cfg.radius) * Math.PI * cfg.armTwist * 2;
    const spread = armRng.nextGaussian(0, cfg.spread * cfg.radius * cfg.armWidth * 0.3);

    const angle = spiralAngle + (spread / cfg.radius);
    const r = dist + armRng.nextGaussian(0, cfg.radius * 0.05);

    positions.push({
      x: Math.cos(angle) * Math.max(0, r),
      y: Math.sin(angle) * Math.max(0, r),
    });
  }

  // Ореол (halo) — ~5%
  for (let i = 0; i < haloCount; i++) {
    const angle = haloRng.nextFloat() * Math.PI * 2;
    const dist = haloRng.nextFloat() * cfg.radius;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  return positions;
}

/** Генерация звёздной системы */
function generateSystem(position: Vec2, index: number, rng: Xoshiro256, cfg: GalaxyGenConfig): StarSystem {
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
    // Вторая звезда (70% тот же класс или на 1 ниже, 30% случайный)
    const companionDef = selectCompanionStar(starDef, rng);
    const companionStar = createStar(systemId, name, companionDef, rng.derive('star_secondary'));
    stars.push(companionStar);

    if (binaryType === 'BINARY_TRIPLE') {
      // Третий компонент (обычно лёгкий)
      const tertiaryDef = selectCompanionStar(starDef, rng);
      const tertiaryStar = createStar(systemId, name, tertiaryDef, rng.derive('star_tertiary'));
      stars.push(tertiaryStar);
    }
  }

  // G-03 fix: Планеты используют РЕАЛЬНУЮ звезду (с ±20% вариацией)
  const totalPlanets = rng.nextInt(starDef.minPlanets, starDef.maxPlanets);
  // Множитель стабильности для двойных/тройных
  const stabilityMult = binaryType === 'BINARY_NONE' ? 1.0
    : binaryType === 'BINARY_WIDE' ? 0.9
    : binaryType === 'BINARY_CLOSE' ? 0.6 : 0.5;
  const planetCount = Math.floor(totalPlanets * stabilityMult);

  const planets: Planet[] = [];
  for (let i = 0; i < planetCount; i++) {
    const planetRng = rng.derive(`planet_${i}`);
    // G-03: передаём реальный Star и binaryType
    const planet = generatePlanet(systemId, i + 1, name, primaryStar, binaryType, planetRng);
    planets.push(planet);
  }

  // G-17 fix: Астероидные поля с бонусами за газовый гигант и двойную систему
  let asteroidFields = rng.nextInt(
    starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 1 : 0,
    starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 4 : 3,
  );
  const maxAsteroidFields = starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 4 : 3;

  // +1 если есть газовый гигант (10% bonus rounded up)
  const hasGasGiant = planets.some(p => p.type === 'gas_giant');
  if (hasGasGiant) {
    asteroidFields = Math.min(maxAsteroidFields, asteroidFields + 1);
  }
  // +1 если двойная/тройная система (15% bonus rounded up)
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
    // Тот же класс или на 1 ниже — только среди main sequence
    const currentIdx = MAIN_SEQUENCE_STAR_TYPES.indexOf(primaryDef);
    // If primary is not in main sequence (special type), pick a random main sequence star
    if (currentIdx === -1) {
      return rng.weightedChoice(MAIN_SEQUENCE_STAR_TYPES, MAIN_SEQUENCE_STAR_WEIGHTS);
    }
    const companionIdx = Math.max(0, Math.min(MAIN_SEQUENCE_STAR_TYPES.length - 1, currentIdx + rng.nextInt(0, 1)));
    return MAIN_SEQUENCE_STAR_TYPES[companionIdx];
  }
  // Случайный класс (взвешенный, main sequence only — компаньоны не бывают спецтипами)
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

/**
 * Генерация планеты.
 *
 * G-03 fix: получает реальный Star объект (с ±20% вариацией), не starDef
 * G-13 fix: получает binaryType для корректировки орбитального радиуса
 * G-02 fix: атмосфера генерируется ДО температуры
 * G-04/G-06 fix: радиус из PLANET_TYPE_RADIUS, размер из getSizeFromRadius
 *
 * Физика:
 * - Радиус: из PLANET_TYPE_RADIUS[тип], размер = getSizeFromRadius(radiusKm)
 * - Плотность: по типу планеты (из 03-planets.md §2.2)
 * - Гравитация: g = (radiusKm/6371) × (density/5.51) (из 03-planets.md §2.2)
 * - Равновесная температура: T_eq = 278.5K × (L/L☉)^(1/4) × (1AU/r)^(1/2)
 * - Парниковый эффект зависит от РЕАЛЬНОГО типа атмосферы
 * - Орбитальный период: P = 365.25 × sqrt(r³ / M) дней (3-й закон Кеплера)
 * - Ресурсы: ВСЯ таблица «Менделеева» на каждой планете (профильные/редкие/ультраредкие)
 */
function generatePlanet(systemId: EntityId, orbit: number, systemName: string, primaryStar: Star, binaryType: BinaryType, rng: Xoshiro256): Planet {
  const planetId = genId('planet');

  // G-13 + G-27 fix: Орбитальный радиус с учётом светимости звезды и типа двойной системы.
  // Базовая формула: hzCenter × (0.3 + orbit × (0.5 + rng × 0.3))
  // где hzCenter = sqrt(L/0.8) — центр обитаемой зоны.
  // Это гарантирует, что планеты M/K карликов попадают в HZ,
  // а не начинаются с 0.8 AU (далеко от HZ M-карликов на 0.1–0.2 AU).
  const hzCenter = Math.sqrt(Math.max(0.001, primaryStar.luminosity) / 0.8);
  // Для очень ярких звёзд ограничиваем множитель, чтобы планеты не улетали на 100+ AU
  const orbitalScale = Math.min(hzCenter, 5.0); // макс множитель 5 (для F/G звёзд)
  let orbitalRadius = orbitalScale * (0.3 + orbit * (0.5 + rng.nextFloat() * 0.3));

  if (binaryType === 'BINARY_CLOSE') {
    // Планеты должны быть дальше от центра масс двойной системы
    orbitalRadius = Math.max(1.0, orbitalRadius);
  } else if (binaryType === 'BINARY_WIDE') {
    // Дальние планеты менее стабильны — ограничиваем максимальный радиус
    const maxStableRadius = 30; // AU — приблизительный предел стабильности
    orbitalRadius = Math.min(maxStableRadius, orbitalRadius);
  }

  // Тип планеты зависит от орбитального радиуса и реальной светимости звезды
  const planetDef = selectPlanetType(orbitalRadius, primaryStar, rng);

  // G-04/G-06 fix: Радиус из PLANET_TYPE_RADIUS, размер из getSizeFromRadius
  let radiusKm: number;
  let size: PlanetSize;

  if (planetDef.type === 'gas_giant') {
    // Газовые гиганты: size = 'huge' (всегда), grid = 0 hexes
    size = 'huge';
    const radiusRange = PLANET_TYPE_RADIUS.gas_giant;
    radiusKm = radiusRange.min + rng.nextFloat() * (radiusRange.max - radiusRange.min);
  } else {
    // Остальные: радиус из диапазона типа, размер выводится из радиуса
    const radiusRange = PLANET_TYPE_RADIUS[planetDef.type];
    radiusKm = radiusRange.min + rng.nextFloat() * (radiusRange.max - radiusRange.min);
    size = getSizeFromRadius(radiusKm);
  }

  // Плотность — из диапазона по типу планеты (03-planets.md §2.2)
  const densityRange = PLANET_DENSITY[planetDef.type] ?? { min: 3.0, max: 6.0, avg: 4.5 };
  const density = densityRange.min + rng.nextFloat() * (densityRange.max - densityRange.min);

  // Гравитация из физической формулы: g = (R/R⊕) × (ρ/ρ⊕)
  // earthRadius=6371km, earthDensity=5.51 г/см³
  const gravity = (radiusKm / 6371) * (density / 5.51);

  // Орбитальный период по 3-му закону Кеплера: P = sqrt(r³ / M) лет
  // G-03 fix: используем реальную массу звезды
  const orbitalPeriodYears = Math.sqrt(Math.pow(orbitalRadius, 3) / primaryStar.mass);
  const orbitalPeriodDays = Math.round(orbitalPeriodYears * 365.25);

  // G-02 fix: Атмосфера генерируется ДО температуры
  const atmosphere = generateAtmosphere(planetDef, rng);

  // Температура: физическая модель с РЕАЛЬНОЙ атмосферой и РЕАЛЬНОЙ звездой
  const temperature = calculatePlanetTemperature(primaryStar, orbitalRadius, planetDef, atmosphere, rng);

  // Жизнь (передаём температуру для климатических ограничений)
  const life = generateLife(planetDef, atmosphere, temperature, rng);

  // Гекс-сетка (P1-01: 0 гексов для газовых гигантов)
  const hexes = planetDef.type === 'gas_giant'
    ? []
    : generateHexGrid(size, planetDef.terrainWeights, rng.derive('hexes'));

  // Ресурсные залежи на гексах — ВСЯ таблица «Менделеева»
  if (hexes.length > 0) {
    assignResourceDeposits(hexes, rng.derive('deposits'), planetDef.type);
  }

  // Атмосферные слоты (P1-01: только для газовых гигантов)
  const atmosphericSlots: AtmosphericSlot[] = planetDef.type === 'gas_giant'
    ? Array.from({ length: rng.nextInt(GAS_GIANT_ATMOSPHERE_SLOTS.min, GAS_GIANT_ATMOSPHERE_SLOTS.max) },
        (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }))
    : [];

  // G-15 fix: Орбитальные слоты по размеру (для не-газовых-гигантов)
  let orbitSlots: OrbitalSlot[];
  if (planetDef.type === 'gas_giant') {
    // Газовые гиганты: 6-12 слотов
    const ggRange = ORBIT_SLOTS.gas_giant;
    orbitSlots = Array.from(
      { length: rng.nextInt(ggRange.min, ggRange.max) },
      (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }),
    );
  } else {
    // Остальные: фиксированное количество по размеру
    const slotCount = ORBIT_SLOTS_BY_SIZE[size];
    orbitSlots = Array.from(
      { length: slotCount },
      (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }),
    );
  }

  // Имя планеты (с типом)
  const typeName = TYPE_NAMES[planetDef.type] ?? planetDef.type;
  const planetName = `${systemName} ${toRoman(orbit)} — ${typeName}`;

  // Сводная таблица ресурсов планеты (агрегация из гексов)
  const resourceDeposits = aggregateResourceDeposits(hexes, planetDef.type, rng.derive('ultra'));

  return {
    id: planetId,
    systemId,
    name: planetName,
    type: planetDef.type,
    size,
    radiusKm: Math.round(radiusKm),
    density: Math.round(density * 100) / 100,
    gravity: Math.round(gravity * 100) / 100,
    temperature: Math.round(temperature),
    atmosphere,
    life,
    orbitNumber: orbit,
    orbitalRadius: Math.round(orbitalRadius * 100) / 100,
    orbitalPeriod: orbitalPeriodDays,
    hexes,
    atmosphericSlots,
    orbitSlots,
    resourceDeposits,
    resources: {},
    energyBalance: 0,
    owner: null,
  };
}

/**
 * Расчёт температуры планеты на основе физики.
 *
 * G-02 fix: принимает РЕАЛЬНУЮ атмосферу (не делает свой roll)
 * G-03 fix: принимает реальный Star (не starDef)
 * G-18 fix: 278 → 278.5 для лучшей точности
 * G-30 fix: парниковый эффект = ПРОЦЕНТ от T_eq (масштабируется с расстоянием)
 *
 * Физика: парниковый эффект захватывает ДОЛЮ исходящего излучения.
 * Исходящее излучение ≈ входящее (равновесие) → парник пропорционален T_eq.
 * Это гарантирует монотонное убывание температуры с расстоянием.
 *
 * 1. Равновесная температура (равновесие излучения звезды):
 *    T_eq = 278.5K × (L/L☉)^(1/4) × (1AU/r)^(1/2)
 *
 * 2. Парниковый эффект = ПРОЦЕНТ от T_eq (масштабируется с расстоянием):
 *    - none → 0%
 *    - thin → 3-10%
 *    - standard → 10-20% (Земля: ~13% = +33K/+255K)
 *    - dense → 20-45%
 *    - co2 → 30-60% (Венера: ~124% — экстремальный случай)
 *    - methane → 20-50%
 *    - toxic → 5-20%
 *    - inert → 2-7%
 *
 * 3. Тип планеты модифицирует (альбедо, геотермалка — плоские K):
 *    - volcanic → геотермальный нагрев +30..100K (внутренний источник, не зависит от звезды)
 *    - ice → высокое альбедо, охлаждение -20..-50K
 *    - gas_giant → внутренний нагрев +10..30K
 */
function calculatePlanetTemperature(
  star: Star,
  orbitalRadiusAU: number,
  planetDef: typeof PLANET_TYPES[0],
  atmosphere: Atmosphere,
  rng: Xoshiro256,
): number {
  // Защита от деления на ноль и отрицательных значений
  const r = Math.max(0.05, orbitalRadiusAU);
  const L = Math.max(0.001, star.luminosity);

  // G-18 fix: Равновесная температура в Кельвинах — 278.5 вместо 278
  // T_eq = 278.5 * L^(1/4) * r^(-1/2) K
  const T_eq = 278.5 * Math.pow(L, 0.25) * Math.pow(r, -0.5);

  // G-30 fix: Парниковый эффект = ПРОЦЕНТ от T_eq
  // Физика: greenhouse захватывает долю исходящего излучения, которое
  // пропорционально приходящему → эффект масштабируется с T_eq.
  // Это гарантирует, что далёкие планеты с CO₂ не нагреваются до +200°C.
  let greenhousePercent = 0;
  switch (atmosphere.type) {
    case 'none':
      greenhousePercent = 0;
      break;
    case 'thin':
      greenhousePercent = 3 + rng.nextFloat() * 7;        // 3-10%
      break;
    case 'standard':
      greenhousePercent = 10 + rng.nextFloat() * 10;       // 10-20%
      break;
    case 'dense':
      greenhousePercent = 20 + rng.nextFloat() * 25;       // 20-45%
      break;
    case 'co2':
      greenhousePercent = 30 + rng.nextFloat() * 30;       // 30-60%
      break;
    case 'methane':
      greenhousePercent = 20 + rng.nextFloat() * 30;       // 20-50%
      break;
    case 'toxic':
      greenhousePercent = 5 + rng.nextFloat() * 15;        // 5-20%
      break;
    case 'inert':
      greenhousePercent = 2 + rng.nextFloat() * 5;         // 2-7%
      break;
  }
  const greenhouseK = T_eq * (greenhousePercent / 100);

  // Модификатор типа планеты (плоские K — внутренние источники/альбедо)
  let typeModifierK = 0;
  switch (planetDef.type) {
    case 'volcanic':
      typeModifierK = 30 + rng.nextFloat() * 70;   // +30-100K геотермальный нагрев
      break;
    case 'ice':
      typeModifierK = -20 - rng.nextFloat() * 30;  // -20 to -50K высокое альбедо → охлаждение
      break;
    case 'gas_giant':
      typeModifierK = 10 + rng.nextFloat() * 20;   // +10-30K внутренний нагрев (Кельвин-Гельмгольц)
      break;
    case 'desert':
      typeModifierK = -5 + rng.nextFloat() * 15;   // -5 to +10K
      break;
    default:
      break;
  }

  // Итоговая температура в Кельвинах → перевод в °C
  const T_final = T_eq + greenhouseK + typeModifierK;
  return T_final - 273.15; // K → °C
}

/** P1-16: Генерация атмосферы (C-01 fix: газовые гиганты обрабатываются первым приоритетом) */
function generateAtmosphere(planetDef: typeof PLANET_TYPES[0], rng: Xoshiro256): Atmosphere {
  // Газовые гиганты ВСЕГДА имеют атмосферу — обрабатываем первым
  if (planetDef.type === 'gas_giant') {
    const type = selectGasGiantAtmosphereType(rng);
    const pressure = getAtmospherePressure(type, rng);
    return { type, pressure, composition: [] };
  }

  const hasAtmosphere = rng.nextBool(planetDef.atmosphereChance);
  if (!hasAtmosphere) {
    return { type: 'none', pressure: 0, composition: [] };
  }

  // Тип атмосферы зависит от типа планеты
  const type = selectAtmosphereType(planetDef.type, rng);
  const pressure = getAtmospherePressure(type, rng);

  return { type, pressure, composition: [] };
}

/**
 * G-08 fix: Газовый гигант — распределение типов атмосферы.
 * inert = 5%, toxic = 4% (было наоборот).
 * dense=36%, standard=5%, methane=25%, co2=25%, inert=5%, toxic=4%
 */
function selectGasGiantAtmosphereType(rng: Xoshiro256): AtmosphereType {
  const roll = rng.nextFloat() * 100;
  if (roll < 36) return 'dense';
  if (roll < 41) return 'standard';
  if (roll < 66) return 'methane';
  if (roll < 91) return 'co2';
  if (roll < 96) return 'inert';    // G-08 fix: 5% (было 4%)
  return 'toxic';                    // G-08 fix: 4% (было 5%)
}

/**
 * G-07 fix: Условные вероятности типов атмосферы по спецификации §2.4.
 * Даны УСЛОВНЫЕ вероятности (при наличии атмосферы).
 * Порядок: thin, standard, dense, toxic, inert, methane, co2
 */
function selectAtmosphereType(planetType: string, rng: Xoshiro256): AtmosphereType {
  const roll = rng.nextFloat() * 100;
  switch (planetType) {
    case 'rocky':
      // G-07: thin=40%, standard=35%, dense=7.5%, toxic=5%, inert=5%, methane=2.5%, co2=5%
      if (roll < 40) return 'thin';
      if (roll < 75) return 'standard';       // 40+35=75
      if (roll < 82.5) return 'dense';         // 75+7.5=82.5
      if (roll < 87.5) return 'toxic';         // 82.5+5=87.5
      if (roll < 92.5) return 'inert';         // 87.5+5=92.5
      if (roll < 95) return 'methane';         // 92.5+2.5=95
      return 'co2';                             // 95+5=100

    case 'volcanic':
      // G-07: thin=10%, standard=5%, dense=20%, toxic=30%, inert=10%, methane=3.3%, co2=21.7%
      if (roll < 10) return 'thin';
      if (roll < 15) return 'standard';        // 10+5=15
      if (roll < 35) return 'dense';            // 15+20=35
      if (roll < 65) return 'toxic';            // 35+30=65
      if (roll < 75) return 'inert';            // 65+10=75
      if (roll < 78.3) return 'methane';        // 75+3.3=78.3
      return 'co2';                              // 78.3+21.7=100

    case 'ice':
      // G-07: thin=40%, standard=5%, dense=5%, toxic=5%, inert=15%, methane=10%, co2=20%
      if (roll < 40) return 'thin';
      if (roll < 45) return 'standard';        // 40+5=45
      if (roll < 50) return 'dense';            // 45+5=50
      if (roll < 55) return 'toxic';            // 50+5=55
      if (roll < 70) return 'inert';            // 55+15=70
      if (roll < 80) return 'methane';          // 70+10=80
      return 'co2';                              // 80+20=100

    case 'oceanic':
      // G-07: thin=14.1%, standard=55.3%, dense=20%, toxic=2.4%, inert=2.4%, methane=1.2%, co2=4.7%
      if (roll < 14.1) return 'thin';
      if (roll < 69.4) return 'standard';      // 14.1+55.3=69.4
      if (roll < 89.4) return 'dense';          // 69.4+20=89.4
      if (roll < 91.8) return 'toxic';          // 89.4+2.4=91.8
      if (roll < 94.2) return 'inert';          // 91.8+2.4=94.2
      if (roll < 95.4) return 'methane';        // 94.2+1.2=95.4
      return 'co2';                              // 95.4+4.7≈100

    case 'desert':
      // G-07: thin=26.7%, standard=6.7%, dense=6.7%, toxic=13.3%, inert=13.3%, methane=13.3%, co2=20%
      if (roll < 26.7) return 'thin';
      if (roll < 33.4) return 'standard';      // 26.7+6.7=33.4
      if (roll < 40.1) return 'dense';          // 33.4+6.7=40.1
      if (roll < 53.4) return 'toxic';          // 40.1+13.3=53.4
      if (roll < 66.7) return 'inert';          // 53.4+13.3=66.7
      if (roll < 80) return 'methane';          // 66.7+13.3=80
      return 'co2';                              // 80+20=100

    case 'dwarf':
      // G-07: thin=50%, standard=10%, inert=30%, co2=10%
      if (roll < 50) return 'thin';
      if (roll < 60) return 'standard';        // 50+10=60
      if (roll < 90) return 'inert';            // 60+30=90
      return 'co2';                              // 90+10=100

    default:
      return 'thin';
  }
}

function getAtmospherePressure(type: AtmosphereType, rng: Xoshiro256): number {
  switch (type) {
    case 'none': return 0;
    case 'thin': return 0.001 + rng.nextFloat() * 0.5;
    case 'standard': return 0.5 + rng.nextFloat() * 1.0;
    case 'dense': return 1.5 + rng.nextFloat() * 3.5;
    case 'toxic': return 0.1 + rng.nextFloat() * 4.9;
    case 'inert': return 0.01 + rng.nextFloat() * 2.0;
    case 'methane': return 0.5 + rng.nextFloat() * 2.5;
    case 'co2': return 0.5 + rng.nextFloat() * 9.5;
  }
}

/**
 * G-09/G-01/G-10/G-11 fix: Генерация жизни.
 *
 * 1. Использует per-type LIFE_LEVEL_WEIGHTS из спецификации §1.2
 * 2. Температурные ограничения: если < -20°C или > +80°C → только microbes или none
 * 3. Для complex/simple жизни требуется standard или dense атмосфера
 * 4. Токсичная атмосфера разрешает микробов (экстремофилы), НЕ блокирует полностью
 * 5. Газовые гиганты — без жизни
 * 6. Без атмосферы — без жизни
 */
function generateLife(
  planetDef: typeof PLANET_TYPES[0],
  atmosphere: Atmosphere,
  temperature: number,
  rng: Xoshiro256,
): PlanetLife {
  // Газовые гиганты — без жизни
  if (planetDef.type === 'gas_giant') {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  // Без атмосферы — без жизни
  if (atmosphere.type === 'none') {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  // G-09 fix: Токсичная атмосфера НЕ блокирует жизнь полностью — экстремофилы возможны
  // (убрано из блока "нет жизни", микробы разрешены)

  // G-09: Используем per-type взвешенный выбор из LIFE_LEVEL_WEIGHTS
  const weights = LIFE_LEVEL_WEIGHTS[planetDef.type as keyof typeof LIFE_LEVEL_WEIGHTS];
  if (!weights) {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  // levels: [none, microbes, plants, simple, complex]
  const levels: LifeLevel[] = ['none', 'microbes', 'plants', 'simple', 'complex'];
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  if (totalWeight === 0) {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  // Взвешенный выбор уровня жизни
  let roll = rng.nextFloat() * totalWeight;
  let level: LifeLevel = 'none';
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      level = levels[i];
      break;
    }
  }

  // G-10 fix: Температурные ограничения — экстремальные температуры
  // Если температура < -20°C или > +80°C → только microbes или none
  if (temperature < -20 || temperature > 80) {
    if (level !== 'none' && level !== 'microbes') {
      level = 'microbes';
    }
  }

  // G-11 fix: Для complex/simple жизни требуется standard или dense атмосфера
  if ((level === 'complex' || level === 'simple') &&
      atmosphere.type !== 'standard' && atmosphere.type !== 'dense') {
    // Понижаем до plants если атмосфера тонкая/токсичная/и т.д.
    level = 'plants';
    // Для plants тоже нужна хотя бы thin атмосфера (уже есть, т.к. none обработан выше)
  }

  // Токсичная атмосфера ограничивает до microbes (экстремофилы)
  if (atmosphere.type === 'toxic' && level !== 'none' && level !== 'microbes') {
    level = 'microbes';
  }

  return {
    level,
    biodiversity: level === 'none' ? 0 : rng.nextFloat(),
    compatibleWithColonists: level !== 'none' && rng.nextBool(0.3),
    hazardLevel: level === 'complex' ? rng.nextInt(1, 3) : 0,
  };
}

/**
 * Выбор типа планеты на основе РЕАЛЬНОГО орбитального радиуса и типа звезды.
 *
 * G-03 fix: принимает реальный Star объект
 * G-16 fix: добавлена линия снега (snow line) как вторая зона
 *
 * Ключевые отличия:
 * 1. Использует РЕАЛЬНЫЙ orbitalRadius и РЕАЛЬНУЮ светимость звезды
 * 2. Все 7 типов планет доступны в КАЖДОЙ зоне (с разными весами)
 * 3. 10% шанс «аномальной» планеты — тип не из основной зоны
 * 4. Линия снега: R_snow = 2.7 × sqrt(L) AU — за ней лед/газовые гиганты вероятнее
 */
function selectPlanetType(orbitalRadius: number, star: Star, rng: Xoshiro256): typeof PLANET_TYPES[0] {
  const L = Math.max(0.001, star.luminosity);
  const hzInner = Math.sqrt(L / 1.1);
  const hzOuter = Math.sqrt(L / 0.53);

  // G-16 fix: Линия снега — R_snow = 2.7 × sqrt(L) AU
  const snowLine = 2.7 * Math.sqrt(L);

  const r = Math.max(0.05, orbitalRadius);

  // 10% шанс аномальной планеты (любой тип с равными весами)
  if (rng.nextBool(0.10)) {
    return rng.weightedChoice(
      PLANET_TYPES,
      [15, 10, 12, 8, 10, 20, 15], // rocky, volcanic, ice, oceanic, desert, gas_giant, dwarf
    );
  }

  // Определяем зону (с учётом линии снега)
  const inHZ = r >= hzInner && r <= hzOuter;
  const innerThanHZ = r < hzInner;
  // G-16: за линией снега лед и газовые гиганты значительно вероятнее
  const beyondSnowLine = r > snowLine;

  if (innerThanHZ) {
    // Внутренняя зона → горячие планеты преобладают
    const closeness = Math.max(0, 1 - r / Math.max(0.01, hzInner));
    return rng.weightedChoice(
      PLANET_TYPES, // rocky, volcanic, ice, oceanic, desert, gas_giant, dwarf
      [
        Math.max(5, 25 + closeness * 15),  // rocky — частый
        Math.max(5, 30 + closeness * 30),  // volcanic — очень частый у звезды
        Math.max(2, 3),                     // ice — редко
        Math.max(2, 5),                     // oceanic — редко
        Math.max(3, 10 + closeness * 10),  // desert — умеренно
        Math.max(1, 2),                     // gas_giant — крайне редко внутри
        Math.max(3, 15 - closeness * 10),  // dwarf — частый (мелкие обломки)
      ],
    );
  } else if (inHZ) {
    // Обитаемая зона → землеподобные
    return rng.weightedChoice(
      PLANET_TYPES,
      [
        30,  // rocky — частый
        5,   // volcanic — редкий
        3,   // ice — крайне редкий
        25,  // oceanic — частый
        15,  // desert — умеренно
        5,   // gas_giant — редкий
        12,  // dwarf — умеренно
      ],
    );
  } else if (beyondSnowLine) {
    // G-16 fix: За линией снега → лед и газовые гиганты значительно вероятнее
    const farness = Math.min(1, (r - snowLine) / Math.max(0.1, snowLine));
    return rng.weightedChoice(
      PLANET_TYPES,
      [
        Math.max(2, 5 - farness * 4),     // rocky — очень редко
        Math.max(1, 2 - farness),          // volcanic — почти нет
        Math.max(10, 35 + farness * 25),  // ice — доминирует
        Math.max(1, 3 - farness * 2),      // oceanic — почти нет
        Math.max(1, 4 - farness * 3),      // desert — редко
        Math.max(15, 35 + farness * 20),  // gas_giant — очень частый
        Math.max(8, 15 + farness * 10),   // dwarf — умеренно
      ],
    );
  } else {
    // Между HZ и снеговой линией → переходная зона
    const farness = Math.min(1, (r - hzOuter) / Math.max(0.1, snowLine - hzOuter));
    return rng.weightedChoice(
      PLANET_TYPES,
      [
        Math.max(3, 10 - farness * 8),    // rocky — убывает
        Math.max(1, 3 - farness * 2),      // volcanic — редко
        Math.max(5, 20 + farness * 20),   // ice — возрастает
        Math.max(2, 5 - farness * 3),      // oceanic — убывает
        Math.max(2, 8 - farness * 5),      // desert — убывает
        Math.max(5, 25 + farness * 25),   // gas_giant — возрастает
        Math.max(5, 15 + farness * 10),   // dwarf — возрастает
      ],
    );
  }
}

/** Назначить ресурсные залежи на гексах.
 *
 * Философия: на каждой планете есть ВСЯ таблица элементов (как таблица Менделеева).
 * Профильные ресурсы (соответствующие типу планеты) — в ЗНАЧИТЕЛЬНОМ количестве.
 * Редкие — в следовых количествах (но всегда есть).
 * Ультраредкие — 1-2 уникальных для планеты.
 *
 * Атмосферные элементы (H, He, O, N, C, S) добываются газовым экстрактором,
 * но их залежи в породе тоже присутствуют в меньших количествах.
 */
function assignResourceDeposits(hexes: HexCell[], rng: Xoshiro256, planetType: string): void {
  if (hexes.length === 0) return;

  const nonOceanHexes = hexes.filter(h => h.terrain !== 'ocean');
  if (nonOceanHexes.length === 0) return;

  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);

  // Множители количества по категории для каждого типа планеты
  const categoryMultipliers: Record<string, Record<string, number>> = {
    rocky:    { structural: 2.5, fuel: 0.5, alloy: 1.5, electronics: 0.8, chemical: 0.6, energy: 0.5, rare: 0.3, light: 0.5 },
    volcanic: { structural: 1.8, fuel: 0.3, alloy: 2.5, electronics: 0.6, chemical: 1.2, energy: 2.0, rare: 0.8, light: 0.2 },
    ice:      { structural: 0.4, fuel: 2.0, alloy: 0.3, electronics: 0.2, chemical: 1.8, energy: 0.2, rare: 0.15, light: 1.0 },
    oceanic:  { structural: 0.7, fuel: 1.0, alloy: 0.5, electronics: 0.5, chemical: 1.8, energy: 0.3, rare: 0.2, light: 0.6 },
    desert:   { structural: 1.2, fuel: 0.2, alloy: 1.0, electronics: 0.6, chemical: 0.3, energy: 0.6, rare: 0.5, light: 0.3 },
    gas_giant:{ structural: 0.1, fuel: 3.0, alloy: 0.1, electronics: 0.1, chemical: 2.5, energy: 0.1, rare: 0.1, light: 1.5 },
    dwarf:    { structural: 0.6, fuel: 0.3, alloy: 0.4, electronics: 0.2, chemical: 0.3, energy: 0.2, rare: 0.15, light: 0.3 },
  };
  const catMult = categoryMultipliers[planetType] ?? categoryMultipliers.rocky;

  // Для КАЖДОГО элемента из таблицы — создаём залежи
  for (const element of ELEMENTS) {
    const cat = element.category;
    const mult = catMult[cat] ?? 0.3;
    const isProfile = profileSet.has(element.id);
    const isRare = rareSet.has(element.id);

    // Количество зависит от принадлежности к профилю/редкости
    let baseQuantity: number;
    let hexFraction: number; // доля гексов с этим ресурсом
    let baseAvailability: number;

    if (isProfile) {
      // Профильные — ЗНАЧИТЕЛЬНОЕ количество, много гексов, высокая доступность
      baseQuantity = (200 + rng.nextFloat() * 800) * mult * 3.0;  // ×3 профильный бонус
      hexFraction = Math.min(0.6, 0.2 + mult * 0.3);
      baseAvailability = 0.3 + rng.nextFloat() * 0.5;
    } else if (isRare) {
      // Редкие — следовые количества, минимум 1 гекс, низкая доступность
      baseQuantity = (5 + rng.nextFloat() * 30) * mult * 0.15;  // следовые
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.1);
      baseAvailability = 0.02 + rng.nextFloat() * 0.12;
    } else if (element.isAtmospheric) {
      // Атмосферные в породе — умеренные
      baseQuantity = (15 + rng.nextFloat() * 60) * mult;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.1);
      baseAvailability = 0.05 + rng.nextFloat() * 0.2;
    } else {
      // Обычные непрофильные — малые/средние количества
      baseQuantity = (20 + rng.nextFloat() * 120) * mult;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.15);
      baseAvailability = 0.1 + rng.nextFloat() * 0.3;
    }

    // Количество гексов для этого элемента
    const hexCount = Math.max(1, Math.min(
      nonOceanHexes.length,
      Math.ceil(hexFraction * nonOceanHexes.length),
    ));

    // Выбираем случайные гексы
    const shuffled = [...nonOceanHexes].sort(() => rng.nextFloat() - 0.5);
    for (let h = 0; h < hexCount && h < shuffled.length; h++) {
      const quantityVariance = 0.5 + rng.nextFloat();
      shuffled[h].deposits.push({
        elementId: `${element.id}-ore`,
        availability: Math.min(1, baseAvailability * (0.7 + rng.nextFloat() * 0.6)),
        quantity: Math.max(1, Math.round(baseQuantity * quantityVariance)),
        depth: isRare ? rng.nextInt(3, 5) : rng.nextInt(1, 4),
      });
    }
  }

  // Дополнительно: случайные богатые залежи профильных ресурсов на 15% гексов
  for (const hex of nonOceanHexes) {
    if (rng.nextBool(0.15)) {
      const profileElements = ELEMENTS.filter(e => profileSet.has(e.id));
      const element = profileElements.length > 0
        ? rng.nextChoice(profileElements)
        : rng.nextChoice(ELEMENTS.filter(e => !e.isAtmospheric));
      const cat = element.category;
      const mult = catMult[cat] ?? 0.3;
      hex.deposits.push({
        elementId: `${element.id}-ore`,
        availability: 0.5 + rng.nextFloat() * 0.5,
        quantity: Math.round((200 + rng.nextFloat() * 800) * mult * 2),
        depth: rng.nextInt(1, 3),
      });
    }
  }
}

/**
 * Агрегация ресурсных залежей из гексов в сводную таблицу планеты.
 * Также добавляет ультраредкие ресурсы (1-2 уникальных для планеты).
 */
function aggregateResourceDeposits(
  hexes: HexCell[],
  planetType: string,
  rng: Xoshiro256,
): PlanetResourceDeposit[] {
  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  const deposits = new Map<string, { totalQuantity: number; totalAvailability: number; hexCount: number; maxAvailability: number }>();

  // Агрегируем из гексов
  for (const hex of hexes) {
    for (const dep of hex.deposits) {
      const elId = dep.elementId.replace('-ore', '');
      const existing = deposits.get(elId);
      if (existing) {
        existing.totalQuantity += dep.quantity;
        existing.totalAvailability += dep.availability;
        existing.hexCount++;
        existing.maxAvailability = Math.max(existing.maxAvailability, dep.availability);
      } else {
        deposits.set(elId, {
          totalQuantity: dep.quantity,
          totalAvailability: dep.availability,
          hexCount: 1,
          maxAvailability: dep.availability,
        });
      }
    }
  }

  // Гарантируем ВСЕ элементы из таблицы (для газовых гигантов без гексов — генерируем напрямую)
  for (const element of ELEMENTS) {
    if (!deposits.has(element.id)) {
      const isProfile = profileSet.has(element.id);
      const isRare = rareSet.has(element.id);
      const mult = planetType === 'gas_giant' ? (element.category === 'fuel' ? 3 : element.category === 'chemical' ? 2 : 0.2) : 0.3;
      const quantity = isProfile
        ? Math.round((300 + rng.nextFloat() * 1000) * mult)
        : isRare
          ? Math.round((3 + rng.nextFloat() * 15) * mult * 0.1)
          : Math.round((10 + rng.nextFloat() * 50) * mult);

      deposits.set(element.id, {
        totalQuantity: Math.max(1, quantity),
        totalAvailability: isProfile ? 0.4 + rng.nextFloat() * 0.4 : isRare ? 0.02 + rng.nextFloat() * 0.08 : 0.05 + rng.nextFloat() * 0.15,
        hexCount: 0, // атмосферные/газовые — не привязаны к гексам
        maxAvailability: isProfile ? 0.5 + rng.nextFloat() * 0.5 : 0.1 + rng.nextFloat() * 0.2,
      });
    }
  }

  // Добавляем 1-2 ультраредких элемента (уникальных для планеты)
  const ultraCount = rng.nextInt(1, 2);
  const availableUltra = ULTRA_RARE_ELEMENTS.filter(e => !profileSet.has(e));
  for (let i = 0; i < ultraCount && i < availableUltra.length; i++) {
    const elId = rng.nextChoice(availableUltra);
    if (!deposits.has(elId) || (deposits.get(elId)?.totalQuantity ?? 0) < 10) {
      deposits.set(elId, {
        totalQuantity: Math.max(1, Math.round(1 + rng.nextFloat() * 5)),  // 1-6 тыс. тонн — уникальная находка
        totalAvailability: 0.01 + rng.nextFloat() * 0.04,  // минимальная доступность
        hexCount: 1,
        maxAvailability: 0.05,
      });
    }
  }

  // Собираем результат
  const result: PlanetResourceDeposit[] = [];
  for (const [elementId, data] of deposits) {
    const isProfile = profileSet.has(elementId);
    const isRare = rareSet.has(elementId);
    const isUltra = !isProfile && !isRare && (data.totalQuantity < 20 || data.maxAvailability < 0.05);

    let tier: 'profile' | 'rare' | 'ultra_rare';
    if (isProfile) tier = 'profile';
    else if (isUltra) tier = 'ultra_rare';
    else if (isRare) tier = 'rare';
    else if (data.totalAvailability / Math.max(1, data.hexCount) < 0.1 && data.totalQuantity < 50) tier = 'ultra_rare';
    else tier = 'rare';

    result.push({
      elementId,
      totalQuantity: data.totalQuantity,
      avgAvailability: data.hexCount > 0 ? Math.round((data.totalAvailability / data.hexCount) * 1000) / 1000 : Math.round(data.totalAvailability * 1000) / 1000,
      tier,
      hexCount: data.hexCount,
      maxAvailability: Math.round(data.maxAvailability * 1000) / 1000,
    });
  }

  // Сортировка: профильные → редкие → ультраредкие, внутри группы — по количеству
  const tierOrder = { profile: 0, rare: 1, ultra_rare: 2 };
  result.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.totalQuantity - a.totalQuantity);

  return result;
}

/**
 * Генерация Jump Points (P1-23: max 6, distance limit, connectivity).
 */
function generateJumpPoints(systems: StarSystem[], rng: Xoshiro256, cfg: GalaxyGenConfig): void {
  if (systems.length < 2) return;

  const maxJP = cfg.maxJumpPointsPerSystem;
  const maxDist = cfg.maxJumpDistance;

  // Для каждой системы — JP к ближайшим (до maxJP)
  for (let i = 0; i < systems.length; i++) {
    const system = systems[i];
    if (system.jumpPoints.length >= maxJP) continue;

    // Находим расстояния до всех систем
    const distances = systems.map((s, j) => ({
      index: j,
      dist: Math.sqrt(
        (s.position.x - system.position.x) ** 2 +
        (s.position.y - system.position.y) ** 2,
      ),
    })).filter(d => d.index !== i && d.dist <= maxDist)
      .sort((a, b) => a.dist - b.dist);

    // JP к ближайшим (если ещё нет и лимит не превышен)
    const targetCount = Math.min(rng.nextInt(1, 3), distances.length, maxJP - system.jumpPoints.length);
    for (let j = 0; j < targetCount; j++) {
      if (system.jumpPoints.length >= maxJP) break;

      const target = systems[distances[j].index];

      // Проверяем, нет ли уже JP
      const exists = system.jumpPoints.some(jp => jp.toSystemId === target.id) ||
                     target.jumpPoints.some(jp => jp.toSystemId === system.id);
      if (exists) continue;

      // Проверяем лимит целевой системы
      if (target.jumpPoints.length >= maxJP) continue;

      const jpId = genId('jp');
      const jp: JumpPoint = {
        id: jpId,
        fromSystemId: system.id,
        toSystemId: target.id,
        stabilized: rng.nextBool(0.3),
      };

      system.jumpPoints.push(jp);

      // Обратный JP
      const reverseJp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: target.id,
        toSystemId: system.id,
        stabilized: jp.stabilized,
      };
      target.jumpPoints.push(reverseJp);
    }
  }
}

/**
 * P1-23: Проверка связности графа систем.
 * Если есть изолированные компоненты, добавляем JP для обеспечения связности.
 */
function ensureConnectivity(systems: StarSystem[], rng: Xoshiro256, cfg: GalaxyGenConfig): void {
  if (systems.length < 2) return;

  const visited = new Set<EntityId>();
  const queue: EntityId[] = [systems[0].id];
  visited.add(systems[0].id);

  // BFS от первой системы
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const system = systems.find(s => s.id === currentId);
    if (!system) continue;

    for (const jp of system.jumpPoints) {
      if (!visited.has(jp.toSystemId)) {
        visited.add(jp.toSystemId);
        queue.push(jp.toSystemId);
      }
    }
  }

  // Если есть непосещённые системы — добавляем JP
  const unvisited = systems.filter(s => !visited.has(s.id));
  for (const isolated of unvisited) {
    // Найти ближайшую посещённую систему
    let minDist = Infinity;
    let nearestVisited: StarSystem | null = null;

    for (const s of systems) {
      if (!visited.has(s.id)) continue;
      const dist = Math.sqrt(
        (s.position.x - isolated.position.x) ** 2 +
        (s.position.y - isolated.position.y) ** 2,
      );
      if (dist < minDist) {
        minDist = dist;
        nearestVisited = s;
      }
    }

    if (nearestVisited) {
      // Добавляем двунаправленный JP
      const jp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: isolated.id,
        toSystemId: nearestVisited.id,
        stabilized: false,
      };
      isolated.jumpPoints.push(jp);

      const reverseJp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: nearestVisited.id,
        toSystemId: isolated.id,
        stabilized: false,
      };
      nearestVisited.jumpPoints.push(reverseJp);

      // Добавляем в посещённые
      visited.add(isolated.id);
    }
  }
}

/** Генерация имени системы (L-02 fix: расширены пулы + числовой суффикс для уникальности) */
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];
const CONSTELLATIONS = ['Centauri', 'Cygni', 'Draconis', 'Eridani', 'Hydrae', 'Leonis', 'Lyrae', 'Orionis', 'Pegasi', 'Phoenicis', 'Serpentis', 'Tauri', 'Ursae', 'Velorum', 'Virginis'];
const usedNames = new Set<string>();

function generateSystemName(rng: Xoshiro256, index: number): string {
  // Пробуем сгенерировать уникальное имя
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
  // Fallback — числовое имя
  return `System-${index + 1}`;
}

/** Конвертация числа в римские цифры */
function toRoman(num: number): string {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const numerals = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  let n = num;
  for (let i = 0; i < values.length; i++) {
    while (n >= values[i]) {
      result += numerals[i];
      n -= values[i];
    }
  }
  return result;
}
