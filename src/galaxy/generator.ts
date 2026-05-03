/**
 * Генератор галактики.
 * Seed-based, детерминированный, спиральная структура.
 */

import { Xoshiro256 } from '@/core/prng';
import type { Galaxy, StarSystem, Star, Planet, JumpPoint, Vec2, EntityId, ResourceDeposit, HexTerrain } from '@/core/types';
import { STAR_TYPES, STAR_WEIGHTS } from '@/data/star-types';
import { PLANET_TYPES, SIZE_HEX_COUNT } from '@/data/planet-types';
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
}

export const DEFAULT_CONFIG: GalaxyGenConfig = {
  seed: 42,
  systemCount: 30,
  radius: 100,
  arms: 4,
  spread: 0.4,
};

/** Генерация галактики */
export function generateGalaxy(config: Partial<GalaxyGenConfig> = {}): Galaxy {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rng = new Xoshiro256(cfg.seed);
  nextId = 1; // сброс для воспроизводимости

  const systems: StarSystem[] = [];
  const systemMap = new Map<EntityId, StarSystem>();

  // 1. Генерация позиций систем (спиральная + случайная)
  const positions = generateSpiralPositions(cfg, rng);

  // 2. Для каждой позиции — генерация системы
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const systemRng = rng.child();
    const system = generateSystem(pos, i, systemRng);
    systems.push(system);
    systemMap.set(system.id, system);
  }

  // 3. Генерация Jump Points (связей между системами)
  generateJumpPoints(systems, rng);

  // 4. Отметить стартовую систему как открытую
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
function generateSpiralPositions(cfg: GalaxyGenConfig, rng: Xoshiro256): Vec2[] {
  const positions: Vec2[] = [];
  const armAngleStep = (2 * Math.PI) / cfg.arms;

  for (let i = 0; i < cfg.systemCount; i++) {
    if (rng.nextBool(0.7)) {
      // Спиральный рукав
      const arm = rng.nextInt(0, cfg.arms - 1);
      const armAngle = arm * armAngleStep;
      const dist = rng.nextFloat() * cfg.radius;
      const spiralAngle = armAngle + (dist / cfg.radius) * Math.PI * 1.5;
      const spread = rng.nextGaussian(0, cfg.spread * cfg.radius * 0.3);

      const angle = spiralAngle + (spread / cfg.radius);
      const r = dist + rng.nextGaussian(0, cfg.radius * 0.05);

      positions.push({
        x: Math.cos(angle) * Math.max(0, r),
        y: Math.sin(angle) * Math.max(0, r),
      });
    } else {
      // Случайная позиция (между рукавами)
      const angle = rng.nextFloat() * Math.PI * 2;
      const dist = rng.nextFloat() * cfg.radius;
      positions.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
      });
    }
  }

  return positions;
}

/** Генерация звёздной системы */
function generateSystem(position: Vec2, index: number, rng: Xoshiro256): StarSystem {
  const systemId = genId('sys');

  // Тип звезды
  const starDef = rng.weightedChoice(STAR_TYPES, STAR_WEIGHTS);

  // Имя системы
  const name = generateSystemName(rng, index);

  // Звезда
  const star: Star = {
    id: genId('star'),
    systemId,
    type: starDef.type,
    name: `${name} (звезда)`,
    mass: starDef.mass * (0.8 + rng.nextFloat() * 0.4),
    luminosity: starDef.luminosity * (0.8 + rng.nextFloat() * 0.4),
    temperature: starDef.temperature * (0.9 + rng.nextFloat() * 0.2),
    radius: starDef.radius * (0.8 + rng.nextFloat() * 0.4),
    color: starDef.color,
  };

  // Планеты
  const planetCount = rng.nextInt(starDef.minPlanets, starDef.maxPlanets);
  const planets: Planet[] = [];
  for (let i = 0; i < planetCount; i++) {
    const planetRng = rng.child();
    const planet = generatePlanet(systemId, i + 1, name, starDef, planetRng);
    planets.push(planet);
  }

  // Астероидные поля
  const asteroidFields = rng.nextInt(0, 2);

  return {
    id: systemId,
    name,
    position,
    star,
    planets,
    asteroidFields,
    jumpPoints: [],
    discovered: false,
    owner: null,
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
  const atmosphere = rng.nextBool(planetDef.atmosphereChance);
  const hasLife = atmosphere && rng.nextBool(planetDef.lifeChance);
  const orbitalRadius = 0.3 + orbit * (0.5 + rng.nextFloat() * 0.3);

  // Гекс-сетка
  const hexes = generateHexGrid(size, planetDef.terrainWeights, rng.child());

  // Ресурсные залежи на некоторых гексах
  assignResourceDeposits(hexes, rng.child());

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
    hasLife,
    orbitalRadius: Math.round(orbitalRadius * 100) / 100,
    hexes,
    resources: {},
    energyBalance: 0,
    owner: null,
  };
}

import type { PlanetSize } from '@/core/types';

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
  for (const hex of hexes) {
    // Не на океане
    if (hex.terrain === 'ocean') continue;

    // 40% шанс залежей
    if (!rng.nextBool(0.4)) continue;

    // 1-3 элемента в залежи
    const depositCount = rng.nextInt(1, 3);
    for (let i = 0; i < depositCount; i++) {
      const element = rng.nextChoice(ELEMENTS);
      hex.deposits.push({
        elementId: element.id,
        availability: 0.2 + rng.nextFloat() * 0.7,
        quantity: rng.nextInt(50, 500) * (element.category === 'rare' ? 0.1 : 1),
        depth: rng.nextInt(1, 5),
      });
    }
  }
}

/** Генерация Jump Points между ближайшими системами */
function generateJumpPoints(systems: StarSystem[], rng: Xoshiro256): void {
  if (systems.length < 2) return;

  // Для каждой системы — JP к 1-3 ближайшим
  for (let i = 0; i < systems.length; i++) {
    const system = systems[i];

    // Находим расстояния до всех систем
    const distances = systems.map((s, j) => ({
      index: j,
      dist: Math.sqrt(
        (s.position.x - system.position.x) ** 2 +
        (s.position.y - system.position.y) ** 2,
      ),
    })).filter(d => d.index !== i).sort((a, b) => a.dist - b.dist);

    // JP к 1-3 ближайшим (если ещё нет)
    const jpCount = Math.min(rng.nextInt(1, 3), distances.length);
    for (let j = 0; j < jpCount; j++) {
      const target = systems[distances[j].index];

      // Проверяем, нет ли уже JP
      const exists = system.jumpPoints.some(jp => jp.toSystemId === target.id) ||
                     target.jumpPoints.some(jp => jp.toSystemId === system.id);
      if (exists) continue;

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
