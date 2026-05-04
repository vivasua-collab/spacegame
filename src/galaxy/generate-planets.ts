/**
 * Генерация планет.
 *
 * Включает: выбор типа, радиус/гравитация, атмосфера, температура, жизнь,
 * гекс-сетка, слоты (атмосферные/орбитальные), имя.
 *
 * Физика:
 * - Радиус: из PLANET_TYPE_RADIUS[тип], размер = getSizeFromRadius(radiusKm)
 * - Плотность: по типу планеты (из 03-planets.md §2.2)
 * - Гравитация: g = (radiusKm/6371) × (density/5.51) (из 03-planets.md §2.2)
 * - Равновесная температура: T_eq = 278.5K × (L/L☉)^(1/4) × (1AU/r)^(1/2)
 * - Парниковый эффект зависит от РЕАЛЬНОГО типа атмосферы
 * - Орбитальный период: P = 365.25 × sqrt(r³ / M) дней (3-й закон Кеплера)
 */

import type { Xoshiro256 } from '@/core/prng';
import type { Star, Planet, PlanetSize, BinaryType, Atmosphere, AtmosphereType, PlanetLife, LifeLevel, AtmosphericSlot, OrbitalSlot } from '@/core/types';
import { PLANET_TYPES, ORBIT_SLOTS, ORBIT_SLOTS_BY_SIZE, GAS_GIANT_ATMOSPHERE_SLOTS, PLANET_DENSITY, PLANET_TYPE_RADIUS, getSizeFromRadius, LIFE_LEVEL_WEIGHTS, TYPE_NAMES } from '@/data/planet-types';
import { genId } from './gen-context';
import { generateHexGrid } from './hex-grid';
import { assignResourceDeposits, aggregateResourceDeposits } from './generate-resources';

// ============ Конвертация чисел ============

/** Конвертация числа в римские цифры */
export function toRoman(num: number): string {
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

// ============ Выбор типа планеты ============

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
 * 5. Границы ОЗ по Kopparapu et al. 2013: S_eff_inner=1.107, S_eff_outer=0.356
 */
function selectPlanetType(orbitalRadius: number, star: Star, rng: Xoshiro256): typeof PLANET_TYPES[0] {
  const L = Math.max(0.001, star.luminosity);
  // Kopparapu et al. 2013 conservative HZ boundaries (§2.1):
  //   inner = runaway greenhouse: S_eff = 1.107
  //   outer = maximum greenhouse:  S_eff = 0.356
  const hzInner = Math.sqrt(L / 1.107);
  const hzOuter = Math.sqrt(L / 0.356);
  const snowLine = 2.7 * Math.sqrt(L);
  const r = Math.max(0.05, orbitalRadius);

  // 10% шанс аномальной планеты
  if (rng.nextBool(0.10)) {
    return rng.weightedChoice(
      PLANET_TYPES,
      [15, 10, 12, 8, 10, 20, 15],
    );
  }

  const inHZ = r >= hzInner && r <= hzOuter;
  const innerThanHZ = r < hzInner;
  const beyondSnowLine = r > snowLine;

  if (innerThanHZ) {
    const closeness = Math.max(0, 1 - r / Math.max(0.01, hzInner));
    return rng.weightedChoice(
      PLANET_TYPES,
      [
        Math.max(5, 25 + closeness * 15),  // rocky
        Math.max(5, 30 + closeness * 30),  // volcanic
        Math.max(2, 3),                     // ice
        Math.max(2, 5),                     // oceanic
        Math.max(3, 10 + closeness * 10),  // desert
        Math.max(1, 2),                     // gas_giant
        Math.max(3, 15 - closeness * 10),  // dwarf
      ],
    );
  } else if (inHZ) {
    return rng.weightedChoice(PLANET_TYPES, [30, 5, 3, 25, 15, 5, 12]);
  } else if (beyondSnowLine) {
    const farness = Math.min(1, (r - snowLine) / Math.max(0.1, snowLine));
    return rng.weightedChoice(
      PLANET_TYPES,
      [
        Math.max(2, 5 - farness * 4),
        Math.max(1, 2 - farness),
        Math.max(10, 35 + farness * 25),
        Math.max(1, 3 - farness * 2),
        Math.max(1, 4 - farness * 3),
        Math.max(15, 35 + farness * 20),
        Math.max(8, 15 + farness * 10),
      ],
    );
  } else {
    const farness = Math.min(1, (r - hzOuter) / Math.max(0.1, snowLine - hzOuter));
    return rng.weightedChoice(
      PLANET_TYPES,
      [
        Math.max(3, 10 - farness * 8),
        Math.max(1, 3 - farness * 2),
        Math.max(5, 20 + farness * 20),
        Math.max(2, 5 - farness * 3),
        Math.max(2, 8 - farness * 5),
        Math.max(5, 25 + farness * 25),
        Math.max(5, 15 + farness * 10),
      ],
    );
  }
}

// ============ Температура ============

/**
 * Расчёт температуры планеты на основе физики.
 *
 * G-02: принимает РЕАЛЬНУЮ атмосферу
 * G-03: принимает реальный Star
 * G-18: 278.5 вместо 278
 * G-30: парниковый эффект = ПРОЦЕНТ от T_eq (масштабируется с расстоянием)
 * v2.0: добавлен Bond albedo по типу планеты (Kopparapu et al. 2013)
 *       парниковый эффект привязан к давлению атмосферы
 *
 * Физика:
 * T_eq = 278.5 × (L/L☉)^(1/4) × ((1-A)/r²)^(1/2) K
 * T_surface = T_eq + ΔT_greenhouse + ΔT_type
 *
 * Парниковый эффект масштабируется с давлением:
 *   ΔT = base_ΔT × (pressure / 1 atm)^0.25
 */
function calculatePlanetTemperature(
  star: Star,
  orbitalRadiusAU: number,
  planetDef: typeof PLANET_TYPES[0],
  atmosphere: Atmosphere,
  rng: Xoshiro256,
): number {
  const r = Math.max(0.05, orbitalRadiusAU);
  const L = Math.max(0.001, star.luminosity);

  // Bond albedo по типу планеты (из научных данных)
  const albedo = getAlbedo(planetDef.type, atmosphere.type, rng);

  // G-18: T_eq = 278.5 * L^(1/4) * r^(-1/2) * (1-A)^(1/4) K
  const T_eq = 278.5 * Math.pow(L, 0.25) * Math.pow(r, -0.5) * Math.pow(1 - albedo, 0.25);

  // Парниковый эффект: базовое ΔT × масштаб по давлению
  let baseGreenhouseK = 0;
  switch (atmosphere.type) {
    case 'none': baseGreenhouseK = 0; break;
    case 'thin': baseGreenhouseK = 8 + rng.nextFloat() * 12; break;           // Mars-like: 5-20K
    case 'standard': baseGreenhouseK = 25 + rng.nextFloat() * 15; break;      // Earth-like: 25-40K
    case 'dense': baseGreenhouseK = 50 + rng.nextFloat() * 80; break;         // Archean Earth: 50-130K
    case 'co2': baseGreenhouseK = 80 + rng.nextFloat() * 200; break;          // Venus-like: 80-280K
    case 'methane': baseGreenhouseK = 30 + rng.nextFloat() * 60; break;       // Titan-like: 30-90K
    case 'toxic': baseGreenhouseK = 10 + rng.nextFloat() * 25; break;         // SO2/industrial: 10-35K
    case 'inert': baseGreenhouseK = 5 + rng.nextFloat() * 10; break;          // N2/Ar: 5-15K
  }
  // Масштабирование по давлению: ΔT × (P/1atm)^0.25
  const pressureScale = atmosphere.pressure > 0
    ? Math.pow(Math.max(0.001, atmosphere.pressure), 0.25)
    : 0;
  const greenhouseK = baseGreenhouseK * pressureScale;

  // Модификатор типа планеты (внутренние источники тепла/альбедо)
  let typeModifierK = 0;
  switch (planetDef.type) {
    case 'volcanic': typeModifierK = 30 + rng.nextFloat() * 70; break;      // +30-100K (приливной нагрев)
    case 'ice': typeModifierK = -20 - rng.nextFloat() * 30; break;           // -20 to -50K (высокое альбедо льда)
    case 'gas_giant': typeModifierK = 10 + rng.nextFloat() * 20; break;     // +10-30K (внутреннее тепло)
    case 'desert': typeModifierK = -5 + rng.nextFloat() * 15; break;        // -5 to +10K
    default: break;
  }

  const T_final = T_eq + greenhouseK + typeModifierK;
  return T_final - 273.15; // K → °C
}

/**
 * Bond albedo по типу планеты и атмосферы.
 * Данные: Kopparapu et al. 2013, Solar System observations.
 */
function getAlbedo(planetType: string, atmosphereType: string, rng: Xoshiro256): number {
  // Базовое альбедо по типу планеты
  let baseAlbedo: number;
  switch (planetType) {
    case 'rocky': baseAlbedo = 0.15 + rng.nextFloat() * 0.15; break;     // 0.15-0.30 (Mercury=0.07, Earth=0.30)
    case 'volcanic': baseAlbedo = 0.05 + rng.nextFloat() * 0.10; break;  // 0.05-0.15 (dark surface)
    case 'ice': baseAlbedo = 0.40 + rng.nextFloat() * 0.30; break;      // 0.40-0.70 (ice/snow reflection)
    case 'oceanic': baseAlbedo = 0.06 + rng.nextFloat() * 0.09; break;  // 0.06-0.15 (water absorbs)
    case 'desert': baseAlbedo = 0.15 + rng.nextFloat() * 0.15; break;   // 0.15-0.30 (sand/rock)
    case 'gas_giant': baseAlbedo = 0.30 + rng.nextFloat() * 0.20; break; // 0.30-0.50 (Jupiter=0.50, Saturn=0.34)
    case 'dwarf': baseAlbedo = 0.10 + rng.nextFloat() * 0.20; break;    // 0.10-0.30
    default: baseAlbedo = 0.20; break;
  }

  // Толстая CO2/метановая атмосфера → высокое альбедо (облака)
  if (atmosphereType === 'co2' || atmosphereType === 'dense') {
    baseAlbedo = Math.min(0.80, baseAlbedo + 0.20 + rng.nextFloat() * 0.20);
  }
  if (atmosphereType === 'methane') {
    baseAlbedo = Math.min(0.60, baseAlbedo + 0.10 + rng.nextFloat() * 0.15);
  }

  return Math.min(0.85, baseAlbedo);
}

// ============ Атмосфера ============

/** P1-16: Генерация атмосферы (C-01: газовые гиганты обрабатываются первым приоритетом) */
function generateAtmosphere(planetDef: typeof PLANET_TYPES[0], rng: Xoshiro256): Atmosphere {
  if (planetDef.type === 'gas_giant') {
    const type = selectGasGiantAtmosphereType(rng);
    const pressure = getAtmospherePressure(type, rng);
    return { type, pressure, composition: [] };
  }

  const hasAtmosphere = rng.nextBool(planetDef.atmosphereChance);
  if (!hasAtmosphere) {
    return { type: 'none', pressure: 0, composition: [] };
  }

  const type = selectAtmosphereType(planetDef.type, rng);
  const pressure = getAtmospherePressure(type, rng);
  return { type, pressure, composition: [] };
}

/** G-08 fix: Газовый гигант — распределение типов атмосферы */
function selectGasGiantAtmosphereType(rng: Xoshiro256): AtmosphereType {
  const roll = rng.nextFloat() * 100;
  if (roll < 36) return 'dense';
  if (roll < 41) return 'standard';
  if (roll < 66) return 'methane';
  if (roll < 91) return 'co2';
  if (roll < 96) return 'inert';
  return 'toxic';
}

/** G-07 fix: Условные вероятности типов атмосферы по спецификации §2.4 */
function selectAtmosphereType(planetType: string, rng: Xoshiro256): AtmosphereType {
  const roll = rng.nextFloat() * 100;
  switch (planetType) {
    case 'rocky':
      if (roll < 40) return 'thin';
      if (roll < 75) return 'standard';
      if (roll < 82.5) return 'dense';
      if (roll < 87.5) return 'toxic';
      if (roll < 92.5) return 'inert';
      if (roll < 95) return 'methane';
      return 'co2';
    case 'volcanic':
      if (roll < 10) return 'thin';
      if (roll < 15) return 'standard';
      if (roll < 35) return 'dense';
      if (roll < 65) return 'toxic';
      if (roll < 75) return 'inert';
      if (roll < 78.3) return 'methane';
      return 'co2';
    case 'ice':
      if (roll < 40) return 'thin';
      if (roll < 45) return 'standard';
      if (roll < 50) return 'dense';
      if (roll < 55) return 'toxic';
      if (roll < 70) return 'inert';
      if (roll < 80) return 'methane';
      return 'co2';
    case 'oceanic':
      if (roll < 14.1) return 'thin';
      if (roll < 69.4) return 'standard';
      if (roll < 89.4) return 'dense';
      if (roll < 91.8) return 'toxic';
      if (roll < 94.2) return 'inert';
      if (roll < 95.4) return 'methane';
      return 'co2';
    case 'desert':
      if (roll < 26.7) return 'thin';
      if (roll < 33.4) return 'standard';
      if (roll < 40.1) return 'dense';
      if (roll < 53.4) return 'toxic';
      if (roll < 66.7) return 'inert';
      if (roll < 80) return 'methane';
      return 'co2';
    case 'dwarf':
      if (roll < 50) return 'thin';
      if (roll < 60) return 'standard';
      if (roll < 90) return 'inert';
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

// ============ Жизнь ============

/**
 * G-09/G-01/G-10/G-11 fix: Генерация жизни.
 * 1. Per-type LIFE_LEVEL_WEIGHTS из спецификации §1.2
 * 2. Температурные ограничения: < -20°C или > +80°C → только microbes или none
 * 3. complex/simple → нужна standard или dense атмосфера
 * 4. Токсичная → экстремофилы (микробы), НЕ блокирует полностью
 * 5. Газовые гиганты — без жизни
 * 6. Без атмосферы — без жизни
 */
function generateLife(
  planetDef: typeof PLANET_TYPES[0],
  atmosphere: Atmosphere,
  temperature: number,
  rng: Xoshiro256,
): PlanetLife {
  if (planetDef.type === 'gas_giant') {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }
  if (atmosphere.type === 'none') {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  const weights = LIFE_LEVEL_WEIGHTS[planetDef.type as keyof typeof LIFE_LEVEL_WEIGHTS];
  if (!weights) {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  const levels: LifeLevel[] = ['none', 'microbes', 'plants', 'simple', 'complex'];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    return { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 };
  }

  let roll = rng.nextFloat() * totalWeight;
  let level: LifeLevel = 'none';
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      level = levels[i];
      break;
    }
  }

  // G-10: Температурные ограничения
  if (temperature < -20 || temperature > 80) {
    if (level !== 'none' && level !== 'microbes') {
      level = 'microbes';
    }
  }

  // G-11: complex/simple → нужна standard или dense атмосфера
  if ((level === 'complex' || level === 'simple') &&
      atmosphere.type !== 'standard' && atmosphere.type !== 'dense') {
    level = 'plants';
  }

  // Токсичная атмосфера → только microbes (экстремофилы)
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

// ============ Генерация планеты ============

/**
 * Генерация планеты.
 *
 * G-03: получает реальный Star объект (с ±20% вариацией)
 * G-13: получает binaryType для корректировки орбитального радиуса
 * G-02: атмосфера генерируется ДО температуры
 * G-04/G-06: радиус из PLANET_TYPE_RADIUS, размер из getSizeFromRadius
 */
export function generatePlanet(
  systemId: string,
  orbit: number,
  systemName: string,
  primaryStar: Star,
  binaryType: BinaryType,
  rng: Xoshiro256,
): Planet {
  const planetId = genId('planet');

  // G-13 + G-27: Орбитальный радиус с учётом светимости звезды
  const hzCenter = Math.sqrt(Math.max(0.001, primaryStar.luminosity) / 0.8);
  const orbitalScale = Math.min(hzCenter, 5.0);
  let orbitalRadius = orbitalScale * (0.3 + orbit * (0.5 + rng.nextFloat() * 0.3));

  if (binaryType === 'BINARY_CLOSE') {
    orbitalRadius = Math.max(1.0, orbitalRadius);
  } else if (binaryType === 'BINARY_WIDE') {
    orbitalRadius = Math.min(30, orbitalRadius);
  }

  // Тип планеты зависит от орбитального радиуса и светимости звезды
  const planetDef = selectPlanetType(orbitalRadius, primaryStar, rng);

  // Радиус и размер
  let radiusKm: number;
  let size: PlanetSize;

  if (planetDef.type === 'gas_giant') {
    size = 'huge';
    const radiusRange = PLANET_TYPE_RADIUS.gas_giant;
    radiusKm = radiusRange.min + rng.nextFloat() * (radiusRange.max - radiusRange.min);
  } else {
    const radiusRange = PLANET_TYPE_RADIUS[planetDef.type];
    radiusKm = radiusRange.min + rng.nextFloat() * (radiusRange.max - radiusRange.min);
    size = getSizeFromRadius(radiusKm);
  }

  // Плотность и гравитация
  const densityRange = PLANET_DENSITY[planetDef.type] ?? { min: 3.0, max: 6.0, avg: 4.5 };
  const density = densityRange.min + rng.nextFloat() * (densityRange.max - densityRange.min);
  const gravity = (radiusKm / 6371) * (density / 5.51);

  // Орбитальный период (3-й закон Кеплера)
  const orbitalPeriodYears = Math.sqrt(Math.pow(orbitalRadius, 3) / primaryStar.mass);
  const orbitalPeriodDays = Math.round(orbitalPeriodYears * 365.25);

  // Атмосфера (ДО температуры — G-02)
  const atmosphere = generateAtmosphere(planetDef, rng);

  // Температура
  const temperature = calculatePlanetTemperature(primaryStar, orbitalRadius, planetDef, atmosphere, rng);

  // Жизнь
  const life = generateLife(planetDef, atmosphere, temperature, rng);

  // Гекс-сетка (0 для газовых гигантов)
  const hexes = planetDef.type === 'gas_giant'
    ? []
    : generateHexGrid(size, planetDef.terrainWeights, rng.derive('hexes'));

  // Ресурсные залежи на гексах
  if (hexes.length > 0) {
    assignResourceDeposits(hexes, rng.derive('deposits'), planetDef.type);
  }

  // Атмосферные слоты (только для газовых гигантов)
  const atmosphericSlots: AtmosphericSlot[] = planetDef.type === 'gas_giant'
    ? Array.from({ length: rng.nextInt(GAS_GIANT_ATMOSPHERE_SLOTS.min, GAS_GIANT_ATMOSPHERE_SLOTS.max) },
        (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }))
    : [];

  // G-15: Орбитальные слоты
  let orbitSlots: OrbitalSlot[];
  if (planetDef.type === 'gas_giant') {
    const ggRange = ORBIT_SLOTS.gas_giant;
    orbitSlots = Array.from(
      { length: rng.nextInt(ggRange.min, ggRange.max) },
      (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }),
    );
  } else {
    const slotCount = ORBIT_SLOTS_BY_SIZE[size];
    orbitSlots = Array.from(
      { length: slotCount },
      (_, i) => ({ index: i, buildingId: null, buildingLevel: 0 }),
    );
  }

  // Имя планеты (с типом)
  const typeName = TYPE_NAMES[planetDef.type] ?? planetDef.type;
  const planetName = `${systemName} ${toRoman(orbit)} — ${typeName}`;

  // Сводная таблица ресурсов
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
