/**
 * Генератор галактики.
 * Seed-based, детерминированный, спиральная структура.
 * Поддержка двойных/тройных систем (P1-07), именованных под-seed'ов (P1-29),
 * улучшенных JP с проверками (P1-23).
 */

import { Xoshiro256 } from '@/core/prng';
import type { Galaxy, StarSystem, Star, Planet, JumpPoint, Vec2, EntityId, ResourceDeposit, HexTerrain, PlanetSize, BinaryType, Atmosphere, AtmosphereType, PlanetLife, LifeLevel, AtmosphericSlot, OrbitalSlot } from '@/core/types';
import { STAR_TYPES, STAR_WEIGHTS } from '@/data/star-types';
import { PLANET_TYPES, SIZE_HEX_COUNT, ORBIT_SLOTS, GAS_GIANT_ATMOSPHERE_SLOTS } from '@/data/planet-types';
import { ELEMENTS } from '@/data/elements';
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

/** Генерация галактики */
export function generateGalaxy(config: Partial<GalaxyGenConfig> = {}): Galaxy {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const mainRng = new Xoshiro256(cfg.seed);
  nextId = 1; // сброс для воспроизводимости

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

/** Генерация позиций в спиральной структуре */
function generateSpiralPositions(
  cfg: GalaxyGenConfig,
  armRng: Xoshiro256,
  bulgeRng: Xoshiro256,
  diskRng: Xoshiro256,
  haloRng: Xoshiro256,
): Vec2[] {
  const positions: Vec2[] = [];
  const armAngleStep = (2 * Math.PI) / cfg.arms;

  // Распределение систем по областям
  const bulgeCount = Math.floor(cfg.systemCount * cfg.diskFraction * cfg.bulgeDensity);
  const armCount = cfg.systemCount - bulgeCount - Math.floor(cfg.systemCount * cfg.haloFraction);
  const haloCount = cfg.systemCount - bulgeCount - armCount;

  // Ядро (bulge)
  for (let i = 0; i < bulgeCount; i++) {
    const angle = bulgeRng.nextFloat() * Math.PI * 2;
    const dist = bulgeRng.nextFloat() * cfg.radius * 0.1;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  // Спиральные рукава
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

  // Ореол (halo)
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

  // Планеты (генерируются вокруг главной звезды)
  const totalPlanets = rng.nextInt(starDef.minPlanets, starDef.maxPlanets);
  // Множитель стабильности для двойных/тройных
  const stabilityMult = binaryType === 'BINARY_NONE' ? 1.0
    : binaryType === 'BINARY_WIDE' ? 0.9
    : binaryType === 'BINARY_CLOSE' ? 0.6 : 0.5;
  const planetCount = Math.floor(totalPlanets * stabilityMult);

  const planets: Planet[] = [];
  for (let i = 0; i < planetCount; i++) {
    const planetRng = rng.derive(`planet_${i}`);
    const planet = generatePlanet(systemId, i + 1, name, starDef, planetRng);
    planets.push(planet);
  }

  // Астероидные поля
  const asteroidFields = rng.nextInt(
    starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 1 : 0,
    starDef.type === 'STAR_NS' || starDef.type === 'STAR_PULSAR' ? 4 : 3,
  );

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

/** P1-07: Выбор спутника для двойной/тройной системы */
function selectCompanionStar(primaryDef: typeof STAR_TYPES[0], rng: Xoshiro256): typeof STAR_TYPES[0] {
  if (rng.nextBool(0.7)) {
    // Тот же класс или на 1 ниже
    const currentIdx = STAR_TYPES.indexOf(primaryDef);
    const companionIdx = Math.max(0, Math.min(STAR_TYPES.length - 1, currentIdx + rng.nextInt(0, 1)));
    return STAR_TYPES[companionIdx];
  }
  // Случайный класс (взвешенный)
  return rng.weightedChoice(STAR_TYPES, STAR_WEIGHTS);
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

/** Генерация планеты */
function generatePlanet(systemId: EntityId, orbit: number, systemName: string, starDef: typeof STAR_TYPES[0], rng: Xoshiro256): Planet {
  const planetId = genId('planet');

  // Тип планеты зависит от орбиты и звезды
  const planetDef = selectPlanetType(orbit, starDef, rng);

  // Размер с вариацией
  const sizes: PlanetSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];
  const baseSize = planetDef.size;
  const sizeIndex = sizes.indexOf(baseSize);
  const sizeVar = rng.nextInt(Math.max(0, sizeIndex - 1), Math.min(sizes.length - 1, sizeIndex + 1));
  const size = sizes[sizeVar];

  // Параметры
  const gravity = planetDef.baseGravity * (0.8 + rng.nextFloat() * 0.4);
  const tempRange = planetDef.temperatureRange;
  const temperature = tempRange[0] + rng.nextFloat() * (tempRange[1] - tempRange[0]);
  const orbitalRadius = 0.3 + orbit * (0.5 + rng.nextFloat() * 0.3);

  // Атмосфера (P1-16: полноценная структура вместо boolean)
  const atmosphere = generateAtmosphere(planetDef, rng);

  // Жизнь (P1-17: полноценная структура вместо boolean)
  const life = generateLife(planetDef, atmosphere, rng);

  // Гекс-сетка (P1-01: 0 гексов для газовых гигантов)
  const hexes = planetDef.type === 'gas_giant'
    ? []
    : generateHexGrid(size, planetDef.terrainWeights, rng.derive('hexes'));

  // Ресурсные залежи на некоторых гексах
  if (hexes.length > 0) {
    assignResourceDeposits(hexes, rng.derive('deposits'));
  }

  // Атмосферные слоты (P1-01: только для газовых гигантов)
  const atmosphericSlots: AtmosphericSlot[] = planetDef.type === 'gas_giant'
    ? Array.from({ length: rng.nextInt(GAS_GIANT_ATMOSPHERE_SLOTS.min, GAS_GIANT_ATMOSPHERE_SLOTS.max) },
        (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }))
    : [];

  // Орбитальные слоты (P1-01: для всех планет)
  const orbitSlotRange = ORBIT_SLOTS[planetDef.type];
  const orbitSlots: OrbitalSlot[] = Array.from(
    { length: rng.nextInt(orbitSlotRange.min, orbitSlotRange.max) },
    (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }),
  );

  // Имя планеты
  const planetName = `${systemName} ${toRoman(orbit)}`;

  return {
    id: planetId,
    systemId,
    name: planetName,
    type: planetDef.type,
    size,
    gravity: Math.round(gravity * 100) / 100,
    temperature: Math.round(temperature),
    atmosphere,
    life,
    orbitalRadius: Math.round(orbitalRadius * 100) / 100,
    hexes,
    atmosphericSlots,
    orbitSlots,
    resources: {},
    energyBalance: 0,
    owner: null,
  };
}

/** P1-16: Генерация атмосферы */
function generateAtmosphere(planetDef: typeof PLANET_TYPES[0], rng: Xoshiro256): Atmosphere {
  const hasAtmosphere = rng.nextBool(planetDef.atmosphereChance);

  if (!hasAtmosphere || planetDef.type === 'gas_giant' && !rng.nextBool(planetDef.atmosphereChance)) {
    // Для газовых гигантов атмосфера всегда есть
    if (planetDef.type === 'gas_giant') {
      return { type: selectGasGiantAtmosphereType(rng), pressure: rng.nextFloat() * 5 + 1, composition: [] };
    }
    return { type: 'none', pressure: 0, composition: [] };
  }

  // Тип атмосферы зависит от типа планеты
  const type = selectAtmosphereType(planetDef.type, rng);
  const pressure = getAtmospherePressure(type, rng);

  return { type, pressure, composition: [] };
}

function selectGasGiantAtmosphereType(rng: Xoshiro256): AtmosphereType {
  const roll = rng.nextFloat() * 100;
  if (roll < 36) return 'dense';
  if (roll < 41) return 'standard';
  if (roll < 66) return 'methane';
  if (roll < 91) return 'co2';
  return 'inert';
}

function selectAtmosphereType(planetType: string, rng: Xoshiro256): AtmosphereType {
  const roll = rng.nextFloat() * 100;
  switch (planetType) {
    case 'rocky':
      if (roll < 40) return 'thin';
      if (roll < 75) return 'standard';
      if (roll < 88) return 'dense';
      if (roll < 93) return 'toxic';
      if (roll < 96) return 'inert';
      if (roll < 98) return 'methane';
      return 'co2';
    case 'volcanic':
      if (roll < 15) return 'thin';
      if (roll < 25) return 'standard';
      if (roll < 42) return 'dense';
      if (roll < 72) return 'toxic';
      if (roll < 82) return 'inert';
      if (roll < 88) return 'methane';
      return 'co2';
    case 'ice':
      if (roll < 50) return 'thin';
      if (roll < 55) return 'standard';
      if (roll < 58) return 'dense';
      if (roll < 60) return 'toxic';
      if (roll < 72) return 'inert';
      if (roll < 78) return 'methane';
      return 'co2';
    case 'oceanic':
      if (roll < 20) return 'thin';
      if (roll < 72) return 'standard';
      if (roll < 90) return 'dense';
      if (roll < 93) return 'toxic';
      if (roll < 96) return 'inert';
      if (roll < 98) return 'methane';
      return 'co2';
    case 'desert':
      if (roll < 30) return 'thin';
      if (roll < 35) return 'standard';
      if (roll < 38) return 'dense';
      if (roll < 50) return 'toxic';
      if (roll < 60) return 'inert';
      if (roll < 75) return 'methane';
      return 'co2';
    case 'dwarf':
      if (roll < 70) return 'thin';
      if (roll < 75) return 'standard';
      if (roll < 85) return 'inert';
      return 'co2';
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

/** P1-17: Генерация жизни */
function generateLife(planetDef: typeof PLANET_TYPES[0], atmosphere: Atmosphere, rng: Xoshiro256): PlanetLife {
  // Нет жизни на газовых гигантах и без атмосферы
  if (planetDef.type === 'gas_giant' || atmosphere.type === 'none' || atmosphere.type === 'toxic') {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  if (!rng.nextBool(planetDef.lifeChance)) {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  // Определяем уровень жизни
  const roll = rng.nextFloat() * 100;
  let level: LifeLevel;
  if (roll < 50) level = 'microbes';
  else if (roll < 75) level = 'plants';
  else if (roll < 90) level = 'simple';
  else level = 'complex';

  return {
    level,
    biodiversity: rng.nextFloat(),
    compatibleWithColonists: rng.nextBool(0.3),
    hazardLevel: level === 'complex' ? rng.nextInt(1, 3) : 0,
  };
}

function selectPlanetType(orbit: number, starDef: typeof STAR_TYPES[0], rng: Xoshiro256): typeof PLANET_TYPES[0] {
  // Внутренние орбиты → скалистые/вулканические, внешние → ледяные/газ. гиганты
  if (orbit <= 2) {
    return rng.weightedChoice(
      [PLANET_TYPES[0], PLANET_TYPES[1], PLANET_TYPES[6]], // rocky, volcanic, dwarf
      [50, 30, 20],
    );
  } else if (orbit <= 4) {
    return rng.weightedChoice(
      [PLANET_TYPES[0], PLANET_TYPES[4], PLANET_TYPES[3]], // rocky, desert, oceanic
      [40, 30, 30],
    );
  } else {
    return rng.weightedChoice(
      [PLANET_TYPES[2], PLANET_TYPES[5], PLANET_TYPES[3]], // ice, gas_giant, oceanic
      [30, 40, 30],
    );
  }
}

/** Назначить ресурсные залежи на гексах */
function assignResourceDeposits(hexes: HexCell[], rng: Xoshiro256): void {
  // Р3-01: Deposits produce ores, not pure elements.
  // Atmospheric elements (H, He, O, N, C, S) are extracted via gas_extractor, not mines.
  const mineableElements = ELEMENTS.filter(e => !e.isAtmospheric);

  for (const hex of hexes) {
    // Не на океане
    if (hex.terrain === 'ocean') continue;

    // 40% шанс залежей
    if (!rng.nextBool(0.4)) continue;

    // 1-3 элемента в залежи
    const depositCount = rng.nextInt(1, 3);
    for (let i = 0; i < depositCount; i++) {
      const element = rng.nextChoice(mineableElements);
      hex.deposits.push({
        elementId: `${element.id}-ore`, // Р3-01: ore ID, not pure element
        availability: 0.2 + rng.nextFloat() * 0.7,
        quantity: rng.nextInt(50, 500) * (element.category === 'rare' ? 0.1 : 1),
        depth: rng.nextInt(1, 5),
      });
    }
  }
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

/** Генерация имени системы */
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu'];
const CONSTELLATIONS = ['Centauri', 'Cygni', 'Draconis', 'Eridani', 'Hydrae', 'Leonis', 'Lyrae', 'Orionis', 'Pegasi', 'Phoenicis', 'Serpentis', 'Tauri', 'Ursae', 'Velorum'];

function generateSystemName(rng: Xoshiro256, index: number): string {
  const greek = rng.nextChoice(GREEK);
  const constellation = rng.nextChoice(CONSTELLATIONS);
  return `${greek} ${constellation}`;
}

/** Число → римская цифра */
function toRoman(n: number): string {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let result = '';
  let num = n;
  for (const [value, symbol] of map) {
    while (num >= value) {
      result += symbol;
      num -= value;
    }
  }
  return result;
}
