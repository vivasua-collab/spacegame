/**
 * Основные типы данных игры.
 * Версия 2.0 — после аудита P1.
 * Документация (docs/) является единственным источником истины.
 */

// ============ Идентификаторы ============

export type EntityId = string;

// ============ Координаты ============

export interface Vec2 {
  x: number;
  y: number;
}

export interface AxialCoord {
  q: number;
  r: number;
}

// ============ Время ============

export interface GameTime {
  /** Текущий игровой тик */
  tick: number;
  /** Игровой день (1 тик = 1 секунда, 86400 тиков = 1 день) */
  day: number;
  /** Игровой год (365 дней = 1 год) */
  year: number;
}

export type GameSpeed = 0 | 1 | 5 | 15 | 50;

export type GamePhase = 'menu' | 'playing' | 'paused';

// ============ Звёзды ============

/**
 * Типы звёзд — ID из документации (02-stars.md §1.1, §2.1).
 * Формат: STAR_{класс} для основной последовательности,
 * STAR_{аббревиатура} для специальных типов.
 */
export type StarType =
  | 'STAR_O'       // Голубой сверхгигант
  | 'STAR_B'       // Бело-голубой гигант
  | 'STAR_A'       // Белая звезда
  | 'STAR_F'       // Жёлто-белая
  | 'STAR_G'       // Жёлтый карлик
  | 'STAR_K'       // Оранжевый карлик
  | 'STAR_M'       // Красный карлик
  | 'STAR_WD'      // Белый карлик
  | 'STAR_RG'      // Красный гигант
  | 'STAR_NS'      // Нейтронная звезда
  | 'STAR_PULSAR'  // Пульсар
  | 'STAR_BH';     // Чёрная дыра

export interface StarDef {
  type: StarType;
  name: string;
  mass: number;      // в солнечных массах (среднее)
  luminosity: number; // в солнечных светимостях (среднее)
  temperature: number; // в K (среднее)
  radius: number;     // в солнечных радиусах (среднее)
  color: string;      // hex цвет
  minPlanets: number;
  maxPlanets: number;
  weight: number;     // вес для генерации (пропорционален частоте из документации)
}

// ============ Двойные/тройные системы (P1-07) ============

/**
 * Тип звёздной системы: одиночная, двойная, тройная.
 * Из документации 02-stars.md §2.7.
 */
export type BinaryType = 'BINARY_NONE' | 'BINARY_CLOSE' | 'BINARY_WIDE' | 'BINARY_TRIPLE';

// ============ Планеты ============

export type PlanetType = 'rocky' | 'volcanic' | 'ice' | 'oceanic' | 'desert' | 'gas_giant' | 'dwarf';

/**
 * Классы размера планет.
 * Из документации 03-planets.md §2.1 (источник истины) и 04-buildings.md §1.1.
 * Количество гексов: tiny=19, small=37, medium=61, large=91, huge=127.
 */
export type PlanetSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

/**
 * Типы местности гексов.
 * Из документации 03-planets.md §3.3 — 7 типов (без crater, P1-20).
 */
export type HexTerrain = 'plains' | 'mountains' | 'desert' | 'ice' | 'ocean' | 'volcano' | 'jungle';

/**
 * Типы атмосферы (P1-16).
 * Из документации 03-planets.md §2.4.
 */
export type AtmosphereType = 'none' | 'thin' | 'standard' | 'dense' | 'toxic' | 'inert' | 'methane' | 'co2';

export interface Atmosphere {
  type: AtmosphereType;
  pressure: number;          // в атмосферах (атм)
  composition: {             // процентный состав (сумма = 100%)
    element: string;         // химический символ
    percentage: number;      // 0–100
  }[];
}

/**
 * Уровни жизни на планете (P1-17).
 * Из документации 03-planets.md §2.5.
 */
export type LifeLevel = 'none' | 'microbes' | 'plants' | 'simple' | 'complex';

export interface PlanetLife {
  level: LifeLevel;
  biodiversity: number;             // 0.0 – 1.0 — разнообразие
  compatibleWithColonists: boolean; // совместимость биохимии
  hazardLevel: number;              // 0–3 — уровень угрозы
}

export interface PlanetDef {
  type: PlanetType;
  name: string;
  size: PlanetSize;
  hexCount: number;
  baseGravity: number;  // в g
  temperatureRange: [number, number]; // °C
  atmosphereChance: number;
  lifeChance: number;
  terrainWeights: Record<HexTerrain, number>;
}

// ============ Ресурсы ============

export type ElementCategory = 'structural' | 'fuel' | 'alloy' | 'electronics' | 'chemical' | 'energy' | 'rare' | 'light';

export interface ElementDef {
  id: string;
  name: string;
  symbol: string;
  category: ElementCategory;
  baseValue: number;     // базовая ценность единицы
  density: number;       // кг/л
  isAtmospheric: boolean; // можно ли добыть из атмосферы
}

// ============ Здания ============

export type BuildingCategory = 'extraction' | 'processing' | 'production' | 'energy' | 'military' | 'research' | 'logistics';

export type BuildingLayer = 'surface' | 'atmosphere' | 'orbit';

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  category: BuildingCategory;
  /** На каком слое можно строить здание */
  layer: BuildingLayer[];
  /** На каких размерах планет можно строить (для surface-зданий) */
  size: PlanetSize[];
  energyConsumption: number;
  baseProductionTime: number; // тиков на 1 цикл
  levels: number;
  costPerLevel: Record<string, number>; // elementId → количество
  terrainBonus: Partial<Record<HexTerrain, number>>; // множитель на определённой местности
  /** Требование атмосферы (для газового экстрактора и др.) */
  requiresAtmosphere: boolean;
}

// ============ Рецепты ============

export type RecipeCategory = 'raw_to_material' | 'material_to_component' | 'component_to_module' | 'module_to_ship';

export interface RecipeDef {
  id: string;
  name: string;
  category: RecipeCategory;
  inputs: Record<string, number>;  // elementId/materialId → количество
  outputs: Record<string, number>; // elementId/materialId → количество
  energyCost: number;
  time: number; // тиков
  buildingId: string; // в каком здании производится
}

// ============ Корабли ============

/**
 * Классы корпусов кораблей (P1-31).
 * Из документации 05-ships.md §2.1: 7 конкретных классов.
 */
export type HullSize = 'scout' | 'fighter' | 'frigate' | 'cruiser' | 'battleship' | 'transport' | 'flagship';

export interface HullDef {
  id: string;
  name: string;
  size: HullSize;
  moduleSlots: number;
  hp: number;
  cost: Record<string, number>;
}

export type ModuleType = 'engine' | 'weapon' | 'shield' | 'sensor' | 'cargo' | 'life_support' | 'control' | 'cloaking';

export interface ModuleDef {
  id: string;
  name: string;
  type: ModuleType;
  size: HullSize[];
  hp: number;
  powerConsumption: number;
  cost: Record<string, number>;
  stats: Record<string, number>;
}

// ============ Runtime-модели ============

export interface ResourceDeposit {
  elementId: string;
  availability: number;  // 0-1, лёгкость добычи
  quantity: number;      // оставшееся количество
  depth: number;         // уровень глубины (1-5)
}

export interface HexCell {
  coord: AxialCoord;
  terrain: HexTerrain;
  buildingId: string | null;
  buildingLevel: number;
  deposits: ResourceDeposit[];
}

/** Слот атмосферы газового гиганта (P1-01) */
export interface AtmosphericSlot {
  index: number;
  buildingId: string | null;
  buildingLevel: number;
}

/** Слот орбитальной станции (P1-01) */
export interface OrbitalSlot {
  index: number;
  buildingId: string | null;
  buildingLevel: number;
}

export interface Planet {
  id: EntityId;
  systemId: EntityId;
  name: string;
  type: PlanetType;
  size: PlanetSize;
  /** Радиус планеты в км */
  radiusKm: number;
  /** Плотность планеты в г/см³ */
  density: number;
  /** Гравитация в g (вычисляется: gravity = (radiusKm/6371) × (density/5.51)) */
  gravity: number;
  temperature: number;
  /** Атмосфера — полноценная структура вместо boolean (P1-16) */
  atmosphere: Atmosphere;
  /** Жизнь на планете — полноценная структура вместо boolean (P1-17) */
  life: PlanetLife;
  /** Номер орбиты (1 = ближайшая к звезде) */
  orbitNumber: number;
  /** Расстояние от звезды в а.е. */
  orbitalRadius: number;
  /** Орбитальный период в земных днях (по третьему закону Кеплера) */
  orbitalPeriod: number;
  /** Гекс-сетка поверхности (0 для газовых гигантов) */
  hexes: HexCell[];
  /** Атмосферные слоты (газовые гиганты, 6-12) */
  atmosphericSlots: AtmosphericSlot[];
  /** Орбитальные слоты (все планеты, 3-12) */
  orbitSlots: OrbitalSlot[];
  /** Сводная таблица ресурсных залежей планеты (агрегация из гексов + атмосферных) */
  resourceDeposits: PlanetResourceDeposit[];
  resources: Record<string, number>; // elementId → количество на складе
  energyBalance: number;
  owner: EntityId | null; // factionId или playerId
}

/**
 * Сводная залежь ресурса на планете.
 * Агрегирует все залежи одного элемента со всех гексов.
 * Три уровня: профильный, редкий, ультраредкий (уникальный для планеты).
 */
export interface PlanetResourceDeposit {
  elementId: string;
  /** Суммарное количество ресурса (тыс. тонн) */
  totalQuantity: number;
  /** Средняя доступность (0-1) */
  avgAvailability: number;
  /** Категория: 'profile' | 'rare' | 'ultra_rare' */
  tier: 'profile' | 'rare' | 'ultra_rare';
  /** Количество гексов, где ресурс присутствует */
  hexCount: number;
  /** Максимальная доступность среди всех залежей этого элемента */
  maxAvailability: number;
}

export interface Star {
  id: EntityId;
  systemId: EntityId;
  type: StarType;
  name: string;
  mass: number;
  luminosity: number;
  temperature: number;
  radius: number;
  color: string;
}

export interface JumpPoint {
  id: EntityId;
  fromSystemId: EntityId;
  toSystemId: EntityId;
  stabilized: boolean;
}

export interface StarSystem {
  id: EntityId;
  name: string;
  position: Vec2;
  /** Тип системы: одиночная, двойная, тройная (P1-07) */
  binaryType: BinaryType;
  /** Звёзды в системе (1-3, в зависимости от binaryType) */
  stars: Star[];
  planets: Planet[];
  asteroidFields: number;
  jumpPoints: JumpPoint[];
  discovered: boolean;
  owner: EntityId | null;
}

export interface Galaxy {
  id: EntityId;
  seed: number;
  systems: StarSystem[];
  systemMap: Map<EntityId, StarSystem>;
}

export interface Ship {
  id: EntityId;
  name: string;
  hullId: string;
  modules: string[]; // moduleId[]
  hp: number;
  maxHp: number;
  location: EntityId; // systemId или planetId
  owner: EntityId;
}

export interface Fleet {
  id: EntityId;
  name: string;
  ships: Ship[];
  location: EntityId;
  owner: EntityId;
  orders: FleetOrder[];
}

export interface FleetOrder {
  type: 'move' | 'patrol' | 'colonize' | 'attack' | 'defend';
  targetId: EntityId;
}

export interface ProductionQueue {
  planetId: EntityId;
  items: ProductionItem[];
}

export interface ProductionItem {
  id: EntityId;
  recipeId: string;
  progress: number;    // оставшиеся тики
  total: number;       // всего тиков
  repeat: boolean;
}

export interface GameState {
  time: GameTime;
  speed: GameSpeed;
  phase: GamePhase;
  galaxy: Galaxy;
  productionQueues: Map<EntityId, ProductionQueue>;
  fleets: Fleet[];
  playerFactionId: EntityId;
}
