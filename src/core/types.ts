/**
 * Основные типы данных игры.
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

export type StarType = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'white_dwarf' | 'neutron' | 'black_hole';

export interface StarDef {
  type: StarType;
  name: string;
  mass: number;      // в солнечных массах
  luminosity: number; // в солнечных светимостях
  temperature: number; // в K
  radius: number;     // в солнечных радиусах
  color: string;      // hex цвет
  minPlanets: number;
  maxPlanets: number;
  weight: number;     // вес для генерации
}

// ============ Планеты ============

export type PlanetType = 'rocky' | 'volcanic' | 'ice' | 'oceanic' | 'desert' | 'gas_giant' | 'dwarf';

export type PlanetSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

export type HexTerrain = 'plains' | 'mountains' | 'desert' | 'ice' | 'ocean' | 'volcano' | 'jungle' | 'crater';

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

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  category: BuildingCategory;
  size: PlanetSize[];     // на каких планетах можно строить
  energyConsumption: number;
  baseProductionTime: number; // тиков на 1 цикл
  levels: number;
  costPerLevel: Record<string, number>; // elementId → количество
  terrainBonus: Partial<Record<HexTerrain, number>>; // множитель на определённой местности
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

export type HullSize = 'small' | 'medium' | 'large' | 'capital';

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

export interface Planet {
  id: EntityId;
  systemId: EntityId;
  name: string;
  type: PlanetType;
  size: PlanetSize;
  gravity: number;
  temperature: number;
  atmosphere: boolean;
  hasLife: boolean;
  orbitalRadius: number; // AU
  hexes: HexCell[];
  resources: Record<string, number>; // elementId → количество на складе
  energyBalance: number;
  owner: EntityId | null; // factionId или playerId
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
  star: Star;
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
