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
  /** Текущий игровой тик (= количество прошедших дней) */
  tick: number;
  /** День в текущем году (0–364) */
  dayInYear: number;
  /** Игровой год (начинается с 1) */
  year: number;
}

export type GameSpeed = 0 | 1 | 5 | 15 | 50;

export type GamePhase = 'menu' | 'colonization' | 'playing' | 'paused';

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
 * Луна планеты (естественный спутник).
 *
 * Генерируется только для газовых гигантов (Jupiter/Saturn-аналоги имеют
 * десятки спутников). В отличие от полноценной планеты, луна:
 * - не имеет собственной атмосферы (упрощение для MVP);
 * - не обращается вокруг звезды — у неё есть только орбита вокруг планеты;
 * - имеет гекс-сетку (можно колонизировать в будущем расширении);
 * - не имеет своих лун (без рекурсии).
 *
 * Физика:
 * - Радиус: 200-5000 км (Луна=1737, Ганимед=2634, Титан=2575).
 * - Плотность: 1.0-3.5 г/см³ (ледяные=1.0, скальные=3.0).
 * - Гравитация: g = (radiusKm/6371) × (density/5.51) — как у планет.
 * - Орбитальный радиус вокруг планеты: 50 000-2 000 000 км
 *   (Луна ≈ 384 000 км; внутренние спутники ГГ ≈ 100-500 тыс. км).
 * - Орбитальный период вокруг планеты: P = 2π√(a³/(G·Mпланеты)) — упрощённо.
 */
export interface Moon {
  id: EntityId;
  /** ID системы-владельца (для удобства поиска) */
  systemId: EntityId;
  /** ID планеты-владельца */
  planetId: EntityId;
  /** Имя луны (например «Epsilon Tauri IV-a») */
  name: string;
  /** Тип луны — rocky / ice / dwarf (не газовый гигант) */
  type: 'rocky' | 'ice' | 'dwarf';
  /** Размер луны — tiny / small (реже medium) */
  size: PlanetSize;
  /** Радиус в км */
  radiusKm: number;
  /** Плотность в г/см³ */
  density: number;
  /** Гравитация в g */
  gravity: number;
  /** Орбитальный радиус вокруг планеты (тыс. км) */
  orbitRadiusKm: number;
  /** Орбитальный период вокруг планеты (земные дни) */
  orbitPeriodDays: number;
  /** Гекс-сетка поверхности (для будущей колонизации) */
  hexes: HexCell[];
  /** Ресурсные залежи (как у планет — упрощённо) */
  resourceDeposits: PlanetResourceDeposit[];
  /** Владелец (factionId / playerId / null) */
  owner: EntityId | null;
}

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

/** Химический характер элемента — определяет тип руды, здание добычи и переработку.
 * Из документации docs/chemistry.md §2.1.
 */
export type ChemicalCharacter =
  | 'reactive_metal'     // Fe, Ti, Cu, Ni, Cr, Mn, Zn, Sn, Pb, Co, V, Al, W, Mo, Cd, In
  | 'noble_metal'        // Au, Pt, Ag
  | 'refractory_metal'   // Ta, Nb, Zr, Hf, Re
  | 'platinoid'          // Ru, Rh, Pd, Ir, Os
  | 'rare_earth'         // Y, La, Ce, Nd, Dy
  | 'alkali'             // Li, Na, K
  | 'alkaline_earth'     // Be, Mg, Ca, Ba
  | 'reactive_nonmetal'  // C, S, P, B, Se, Te
  | 'halogen'            // F, Cl
  | 'gas'                // H, He, N, O, Ne, Ar
  | 'transuranic';       // Np, Pu, Am, Cm, Cf, Fl, Og, Xn, Qn, Vd

/** Редкость элемента — поправочный коэффициент для энергозатрат.
 * Из документации docs/chemistry.md §7.3.
 */
export type ElementRarity = 'abundant' | 'common' | 'rare' | 'ultra_rare';

export type ElementCategory = 'structural' | 'fuel' | 'metal' | 'chemical' | 'noble' | 'rare' | 'alkali' | 'alkaline_earth' | 'halogen' | 'nonmetal' | 'lanthanide' | 'transmetal' | 'transuranic' | 'crafted';

export interface ElementDef {
  id: string;
  name: string;
  symbol: string;
  category: ElementCategory;
  baseValue: number;            // базовая ценность единицы
  density: number;              // кг/л
  isAtmospheric: boolean;       // можно ли добыть из атмосферы
  /** Атомный номер (Z) */
  atomicNumber: number;
  /** Атомная масса (г/моль) — для расчёта молярной массы руд */
  atomicMass: number;
  /** Химический характер — определяет тип руды и здание добычи (docs/chemistry.md §2) */
  chemicalCharacter: ChemicalCharacter;
  /** Типичная степень окисления в руде — определяет формулу минерала (docs/chemistry.md §3) */
  oxidationState: number;
  /** Редкость — поправочный коэффициент энергозатрат (docs/chemistry.md §7.3) */
  rarity: ElementRarity;
}

// ============ Здания ============

export type BuildingCategory = 'colonization' | 'extraction' | 'processing' | 'production' | 'energy' | 'military' | 'research' | 'logistics';

/**
 * Слой размещения здания.
 * - 'surface'   — на поверхности планеты (гекс-сетка).
 * - 'atmosphere' — атмосферный слот (газовые гиганты).
 * - 'orbit'     — орбитальный слот вокруг планеты.
 * - 'space'     — глубокий космос / вокруг звезды (R-BLD-MOD: post-MVP слой;
 *                на текущий момент движок не имеет buildOnSpaceSlot, поэтому
 *                здания этого слоя отображаются в справочнике, но не строятся).
 */
export type BuildingLayer = 'surface' | 'atmosphere' | 'orbit' | 'space';

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
  // ─── R-BLD-MOD: модульная data-driven система построек ─────────────
  /**
   * Технологии, необходимые для ОТКРЫТИЯ постройки здания.
   * Все записи должны быть выполнены: `researched[techId] >= minLevel`.
   * Если поле отсутствует — здание доступно с самого начала игры.
   * Источник истины: внешний JSON-файл (src/data/buildings/*.json).
   * Пример: `[{ "techId": "steel_processing", "minLevel": 1 }]`
   */
  requiresTechs?: { techId: string; minLevel: number }[];
  /**
   * Типы местности, на которых здание МОЖНО строить (allowlist).
   * Если отсутствует — здание строится на любой местности.
   * Отличается от `terrainBonus` (который даёт множитель к выходу на
   * определённой местности, но не ограничивает саму возможность постройки).
   * Пример: `['mountains', 'hills']` — только горы и холмы.
   */
  terrainTypes?: HexTerrain[];
  // ─── Block 05: специализация переработчиков ─────────────────────────
  /** true для processor/refinery/synthesizer — они поддерживают специализацию */
  isUniversalProcessor?: boolean;
  /** 'universal' по умолчанию; 'specialized' для refinery/synthesizer (предельные формы) */
  defaultProcessorType?: ProcessorType;
  /** Предельная специализация (для refinery = 'metal_smelting', для synthesizer = 'alloy_synthesis') */
  defaultSpecialization?: ProcessorRecipeCategory;
  /** Базовый коэф. выхода: 0.75 для universal, 1.0 для specialized */
  baseYield?: number;
  /** Базовая чистота: 0.70–0.85 для universal, 0.92–0.99 для specialized */
  basePurity?: number;
  /** Стоимость специализации (добавляется к costPerLevel при specializeBuilding) */
  specializeCost?: Partial<Record<string, number>>;
  /** Стоимость повышения уровня специализации (×specializationLevel) */
  upgradeSpecializationCost?: Partial<Record<string, number>>;
  // ─── R-RES §E: бонусы здания (data-driven) ─────────────────────────
  /**
   * Список бонусов, применяемых к расчётам (energy_output, research_rate, …).
   * Каждый бонус описывает target (id метрики), operation (add/multiply/
   * threshold), value, и флаг perLevel — умножается ли value на уровень
   * здания (для add). Источник: docs/60-research.md §9 (effects) extended.
   */
  bonuses?: Bonus[];
}

/**
 * R-RES §E: универсальное описание бонуса (для зданий и модулей кораблей).
 *
 * - target: ключ метрики, к которой применяется бонус
 *   (например 'energy_output', 'research_rate', 'ship_thrust').
 * - operation: тип операции:
 *     - 'add' — добавить `value` (×level, если perLevel) к базовому показателю.
 *     - 'multiply' — умножить базовый показатель на `value` (×level для perLevel,
 *       но обычно 1.10 за уровень для мультипликативных бонусов).
 *     - 'threshold' — бонус применяется только если уровень >= value.
 * - value: численное значение операции.
 * - perLevel: если true — value умножается на текущий уровень источника
 *   (уровень здания или уровень технологии).
 * - source: опционально — id источника (buildingId/techId), для отладки.
 */
export interface Bonus {
  target: string;
  operation: 'add' | 'multiply' | 'threshold';
  value: number;
  perLevel?: boolean;
  source?: string;
  // ─── R-BLD-MOD: бонусы, источником которых является уровень технологии ──
  /**
   * ID технологии-источника бонуса. Если задано — величина бонуса
   * зависит от уровня изученной технологии (а не от уровня здания).
   * Бонус активируется только когда `researched[sourceTech] >= minTechLevel`.
   *
   * Пример (из JSON):
   *   {
   *     "target": "research_rate",
   *     "operation": "add",
   *     "value": 0.03,
   *     "sourceTech": "microelectronics",
   *     "minTechLevel": 3,
   *     "perTechLevel": true
   *   }
   * → начиная с 3-го уровня микроэлектроники, +3% к research_rate
   *   за каждый уровень выше minTechLevel-1 (т.е. на L3=+3%, L4=+6%, L5=+9%...).
   *
   * Если `sourceTech` не задан — бонус building-sourced (существующая модель):
   * величина зависит от уровня самого здания (см. `perLevel`).
   */
  sourceTech?: string;
  /**
   * Минимальный уровень технологии, с которого начинается влияние (включительно).
   * Используется только при заданном `sourceTech`. По умолчанию 1.
   */
  minTechLevel?: number;
  /**
   * Если true — `value` умножается на количество уровней технологии
   * выше `minTechLevel - 1` (т.е. effectiveTechLevels = techLevel - minTechLevel + 1).
   * Если false — применяется ровно `value` (один раз) при достижении minTechLevel.
   * Используется только при заданном `sourceTech`.
   */
  perTechLevel?: boolean;
}

// ============ Переработчики (Block 05) ============

/**
 * Тип переработчика.
 * - 'universal'  — processor без специализации: ЛЮБОЙ вход, низкий коэф. (0.75),
 *                  штраф за мульти-рецепт через sqrt(activeRecipes).
 * - 'specialized' — процессор, специализированный под одну категорию рецептов:
 *                  высокий коэф. (1.0) + purityBonus; или refinery/synthesizer
 *                  (предельные специализированные формы).
 */
export type ProcessorType = 'universal' | 'specialized';

/**
 * Категория специализации переработчика (подкатегория рецептов).
 * НЕ путать с RecipeCategory (raw_to_material / material_to_component / …) —
 * это уровень рецепта, а ProcessorRecipeCategory — уровень цепочки переработки.
 *
 * Источник: docs/40-buildings.md §3 (после правки 08_27_doc_fixes.md §4).
 */
export type ProcessorRecipeCategory =
  | 'metal_smelting'      // плавка металлических руд (Fe, Ti, Cu, Cr, Ni, Mn, W, Mo, Au, Pt, U и др.)
  | 'nonmetal_smelting'   // плавка неметаллических руд (Si, C, S, P, Mg, B)
  | 'chemical_decomp'     // химическое разложение (H2O, CO2, NH3, NaCl, CaCO3 и др.)
  | 'ice_melting'         // переработка льда (H2O-лед, CO2-лед, NH3-лед, CH4-лед)
  | 'gas_processing'      // газовая переработка (атмосферные газы)
  | 'deep_ore_smelting'   // глубинные руды (Y, Ba, Zr, Be, Nb и др.) — требует ур. здания 5+
  | 'alloy_synthesis';    // сплавы/синтез материалов — для synthesizer

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
  // ─── Block 05: подкатегория для специализации процессоров ──────────
  /** Подкатегория для специализации процессоров; undefined для не-процессорных рецептов (напр. shipyard) */
  processorCategory?: ProcessorRecipeCategory;
  /** Мин. уровень специализации здания для рецепта (default 1). Глубинные руды = 5. */
  minSpecializationLevel?: number;
}

// ============ Корабли ============

/**
 * Классы корпусов кораблей (P1-31).
 * Из документации 05-ships.md §2.1: 7 конкретных классов.
 */
export type HullSize = 'scout' | 'fighter' | 'frigate' | 'cruiser' | 'battleship' | 'transport' | 'flagship';

/**
 * Block 02 (F1): толщина обшивки корабля — docs/50-ships.md §2.3.
 * - light     — Лёгкая, множители 1.0/1.0/1.0 (HP/mass/cost)
 * - standard  — Стандартная, 1.25/1.10/1.20
 * - thick     — Утолщённая, 1.50/1.25/1.50
 * - heavy     — Тяжёлая, 2.00/1.50/2.00
 */
export type HullArmorThickness = 'light' | 'standard' | 'thick' | 'heavy';

/**
 * Block 02 (F1): тип слота под модуль — docs/50-ships.md §1.4.
 * - 'any'     — слот принимает модуль любой категории
 * - 'weapon'  — только оружие
 * - 'engine'  — только двигатели
 * - 'system'  — ЦПУ/связь/сканер/прыжок/реактор/ЖО
 * - 'defense' — щиты, броня
 */
export type SlotType = 'any' | 'weapon' | 'engine' | 'system' | 'defense';

/**
 * Block 02 (F1): категория модуля — docs/50-ships.md §1.4.
 * Заменяет ModuleType (который был слишком «плоским»).
 */
export type ModuleCategory = 'engine' | 'control' | 'life_support' | 'weapon' | 'defense' | 'auxiliary';

/** Block 02 (F1): тип урона — docs/50-ships.md §6.9. */
export type DamageType = 'energy' | 'kinetic' | 'ion' | 'plasma' | 'missile' | 'torpedo';

/** Block 02 (F1): тип топлива — docs/50-ships.md §1.6 + §3.1. */
export type FuelType = 'chemical' | 'xenon' | 'hydrogen' | 'antimatter';

/**
 * Block 02 (F1): полная структура корпуса — docs/50-ships.md §2.5.
 *
 * Расширяет минимальный HullDef (который был только {id, name, size,
 * moduleSlots, hp, cost}). Теперь содержит все поля спеки:
 * totalHS, baseHP, baseMass, weaponSlots/engineSlots/systemSlots/defenseSlots,
 * baseCost, requiredEngineeringLevel, requiredShipyardLevel, armorOptions.
 */
export interface HullType {
  id: string;
  name: string;
  size: HullSize;
  totalHS: number;
  baseHP: number;
  baseMass: number; // т
  weaponSlots: number;
  engineSlots: number;
  systemSlots: number;
  defenseSlots: number;
  baseCost: number; // у.е.р.
  requiredEngineeringLevel: number;
  requiredShipyardLevel: number;
  armorOptions: HullArmorThickness[];
}

/**
 * @deprecated используйте HullType. Alias для backward compat.
 * Block 02: переименовано HullDef → HullType (см. выше).
 */
export type HullDef = HullType;

/**
 * Block 02 (F1): каталог модулей кораблей — docs/50-ships.md §1.4.
 *
 * Поле `size` теперь HS (number, не HullSize[]).
 * Поле `category` — это новая ModuleCategory (замена ModuleType).
 *
 * Специфичные поля per category — расширяем через optional-поля
 * (не делаем 6 интерфейсов). Поле со значением undefined означает
 * «неприменимо к этой категории».
 */
export interface ShipModule {
  id: string;
  name: string;
  category: ModuleCategory;
  size: number; // HS
  mass: number; // т
  energyConsumption: number; // МВт (0 — не потребляет)
  cost: number; // у.е.р.
  techLevel: number;
  requiredTechs: string[];
  slotRestriction?: SlotType;

  // ─── Engine category ──────────────────────────────
  thrust?: number; // двигатель: тяга (кН)
  fuelType?: FuelType; // двигатель + топливный бак
  fuelPerThrust?: number; // двигатель: расход топлива на 1 ед. тяги
  warpRange?: number; // двигатель-варп (св. лет/прыжок) — НЕ используется в MVP

  // ─── Control category (ЦПУ) ───────────────────────
  controlType?: 'cpu' | 'navigation' | 'tactical' | 'communication';
  combatBonus?: number;
  fuelEfficiencyBonus?: number;
  communicationRange?: number; // св. лет
  minHull?: HullSize; // мин. класс корпуса для этого ЦПУ

  // ─── Weapon category ───────────────────────────────
  weaponType?: 'laser' | 'plasma' | 'missile' | 'gauss' | 'ion' | 'torpedo' | 'fighter_bay';
  damage?: number;
  range?: number; // км
  fireRate?: number; // выстрелов/тик
  energyPerShot?: number;
  accuracy?: number; // %
  damageType?: DamageType;
  ammo?: number | null; // null = бесконечный

  // ─── Defense category ──────────────────────────────
  defenseType?: 'shield' | 'stealth' | 'emi_shield' | 'armor';
  shieldHP?: number;
  regenRate?: number; // %/тик
  hpPerHS?: number; // броня: HP на 1 HS
  massPerHS?: number; // броня: масса на 1 HS

  // ─── Auxiliary category ────────────────────────────────────
  auxiliaryType?: 'cargo' | 'fuel_tank' | 'scanner' | 'sensor_array'
    | 'repair' | 'mining' | 'colony' | 'jump_drive' | 'reactor';
  capacity?: number; // груз/топливо/колонисты
  maxJumpMass?: number; // т — jump drive
  energyOutput?: number; // МВт — реактор (> 0)

  // ─── R-RES §E: бонусы модуля (data-driven) ─────────────────
  /**
   * Список бонусов, применяемых при расчёте статов корабля/флота.
   * Например, двигатель может давать multiply к ship_thrust, реактор —
   * add к energy_output и т.д.
   */
  bonuses?: Bonus[];
}

/**
 * @deprecated используйте ShipModule. Alias для backward compat.
 * Block 02: переименовано ModuleDef → ShipModule (см. выше).
 */
export type ModuleDef = ShipModule;

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
  // ─── Block 05: специализация переработчиков (instance state) ──────────
  /** Тип переработчика для processor/refinery/synthesizer; undefined для других зданий */
  processorType?: ProcessorType;
  /** Категория специализации (если processorType === 'specialized') */
  specialization?: ProcessorRecipeCategory;
  /** Уровень специализации 1..5 (влияет на purityBonus); 0 если universal */
  specializationLevel?: number;
  /** Активные рецепты на этом экземпляре (для universal — мульти, для specialized — 1..2) */
  activeRecipes?: string[];
}

/** Слот атмосферы газового гиганта (P1-01) */
export interface AtmosphericSlot {
  index: number;
  buildingId: string | null;
  buildingLevel: number;
  // ─── Block 05: специализация переработчиков ──────────
  processorType?: ProcessorType;
  specialization?: ProcessorRecipeCategory;
  specializationLevel?: number;
  activeRecipes?: string[];
}

/** Слот орбитальной станции (P1-01) */
export interface OrbitalSlot {
  index: number;
  buildingId: string | null;
  buildingLevel: number;
  // ─── Block 05: специализация переработчиков ──────────
  processorType?: ProcessorType;
  specialization?: ProcessorRecipeCategory;
  specializationLevel?: number;
  activeRecipes?: string[];
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
  /**
   * Луны планеты (естественные спутники).
   *
   * Генерируются только для газовых гигантов (как в Солнечной системе:
   * у Юпитера 95 спутников, у Сатурна 146). Для остальных типов — пустой
   * массив. Луны упорядочены по возрастанию орбитального радиуса вокруг
   * планеты.
   */
  moons: Moon[];
  /** Сводная таблица ресурсных залежей планеты (агрегация из гексов + атмосферных) */
  resourceDeposits: PlanetResourceDeposit[];
  resources: Record<string, number>; // elementId → количество на складе
  /**
   * Block 05 (PR3-min): средневзвешенная чистота ресурсов на складе.
   * Ключ — elementId/materialId, значение — число в диапазоне [0..1].
   * 0.70–0.85 = техническая (universal), 0.92–0.99 = высшая (specialized).
   * Полное решение (per-purity-batch) — в будущем расширении склада; см. §8 R3 плана Блока 05.
   */
  resourcePurity?: Record<string, number>;
  /** Виртуальный склад планеты (ограничивает вместимость ресурсов) */
  warehouse?: PlanetWarehouse;
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

// ============ Склад планеты ============

/** Конфигурация резерва для одного типа ресурса */
export interface WarehouseReserve {
  resourceId: string;
  /** Минимальный зарезервированный объём (0 = нет гарантии) */
  minimum: number;
  /** Приоритет при конкуренции за пул переполнения (1-10, 10=высший) */
  priority: number;
}

/** Тип специализации склада (влияет на бонусы) — deprecated, сохранён для обратной совместимости */
export type WarehouseSpecialization = 'universal' | 'ore' | 'metal' | 'gas' | 'component';

/** Роль колонии (определяет пресет резервов) */
export type ColonyRole = 'mining' | 'industrial' | 'research' | 'capital' | 'custom';

/**
 * Раздельная система складов (3 типа).
 * См. docs/35-warehouse-and-logistics.md §1.3.
 * Единица измерения: 1 ед. = 1 млн т = 0.001 млрд т.
 */
export interface WarehouseCapacities {
  /** Рудный склад (открытое хранение): руды, газы (сырые), ледяные. Базовая 1000 ед. = 1 млрд т */
  ore: number;
  /** Переработанный склад (крытое хранение): чистые элементы, конструкционные материалы. Базовая 100 ед. = 0.1 млрд т */
  processed: number;
  /** Высокотехнологичный склад (спец хранение): электроника, сверхпроводники, редкие элементы. Базовая 10 ед. = 0.01 млрд т */
  highTech: number;
}

/** Виртуальный склад планеты */
export interface PlanetWarehouse {
  /** Общая вместимость (legacy, вычисляется как сумма ore+processed+highTech) */
  totalCapacity: number;
  /** Раздельные вместимости по типам складов (v3.0) */
  capacities: WarehouseCapacities;
  /** Специализация склада (deprecated, сохранён для обратной совместимости) */
  specialization: WarehouseSpecialization;
  /** Конфигурация резервов по типам ресурсов */
  reserves: Record<string, WarehouseReserve>;
  /** Роль колонии */
  colonyRole: ColonyRole;
  /** Орбитальный буфер */
  orbitBuffer: {
    capacity: number;
    resources: Record<string, number>;
  };
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
  /** Запечённая модель химии — immutable после генерации */
  bakedModel: import('@/data/chemistry-generator').BakedGalaxyModel;
}

export interface Ship {
  id: EntityId;
  name: string;
  designId: EntityId;
  hullId: string;
  moduleIds: string[];
  armor: HullArmorThickness;
  hp: number;
  maxHp: number;
  fuel: Record<FuelType, number>;
  location: EntityId;
  owner: EntityId;
  designName: string;
}

export interface Fleet {
  id: EntityId;
  name: string;
  shipIds: EntityId[];
  location: EntityId;
  owner: EntityId;
  orders: FleetOrder[];
  fuelStores: Record<FuelType, number>;
  /**
   * Block 02 (F5): true когда флот находится в режиме защиты текущей системы.
   * Устанавливается в completeOrder для order.type === 'defend' (после прибытия
   * или мгновенно, т.к. defend не требует перемещения). Снимается при новой
   * issue-fleet-order (store action сбрасывает в false при любом новом приказе).
   */
  defending?: boolean;
}

export interface FleetOrder {
  type: 'move' | 'patrol' | 'colonize' | 'attack' | 'defend';
  targetId: EntityId;
  issuedTick: number;
  path: EntityId[];
  currentLegIndex: number;
  etaTick: number;
  repeat?: boolean;
  /**
   * Audit Pass 2 P1-4 (fix): whether the `fleet:movement-started` event
   * has already been emitted for the current leg of this order. Used to
   * guarantee the event fires exactly once per leg, regardless of pause/
   * resume timing. Old saves that pre-date this field treat `undefined`
   * as `false` (the event will fire on the next observed tick).
   */
  movementStarted?: boolean;
}

/**
 * Block 02 (F1): Проект корабля — docs/50-ships.md Приложение B.
 * Сохраняемый чертёж (без runtime-состояния), переиспользуется для постройки
 * нескольких кораблей. Хранится в `GameState.shipDesigns`.
 */
export interface ShipDesign {
  id: EntityId;
  name: string;
  hullId: string;
  armor: HullArmorThickness;
  moduleIds: string[];
  owner: EntityId;
  createdAtTick: number;
}

/**
 * Block 02 (F1, F6): Элемент очереди постройки кораблей на верфи.
 * Хранит designId (какой дизайн строить), прогресс (progressTicks) и
 * totalTicks (время постройки из Приложения C).
 */
export interface ShipyardQueueItem {
  id: EntityId;
  designId: EntityId;
  shipName: string;
  progressTicks: number;
  totalTicks: number;
}

/**
 * Block 02 (F1, F6): Очередь постройки кораблей на верфи планеты.
 * Отдельная от `ProductionQueue`, т.к. постройка кораблей завершается
 * созданием новой Ship-сущности на орбите планеты, а не только списанием
 * ресурсов со склада. Хранится в `GameState.shipyardQueues`.
 */
export interface ShipyardQueue {
  planetId: EntityId;
  items: ShipyardQueueItem[];
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
  // Block 02 (F1, F7): дизайны кораблей (Map для O(1) lookup по id)
  shipDesigns: Map<EntityId, ShipDesign>;
  // Block 02 (F1, F6): очереди постройки кораблей на верфи каждой планеты
  shipyardQueues: Map<EntityId, ShipyardQueue>;
  // Block 02 (F3, F7): runtime-корабли игрока. Key — ship.id.
  // Map для O(1) lookup по id (для fleet-view, ship-card UI, ship lookup из fleet.shipIds).
  ships: Map<EntityId, Ship>;
  // Block 03 (R7): состояние исследований — фундаментальные ветки,
  // специализированные techs, активные слоты очереди, монотонный счётчик RP.
  researchState: ResearchState;
}

// ============ Block 03 (R1): Исследования ============

/** Специализированная ветка исследований (6 веток по 12 техн — в MVP 5/6). */
export type SpecializedBranchId =
  | 'power'
  | 'materials'
  | 'weapons'
  | 'computing'
  | 'biology'
  | 'xenoarch';

/** Фундаментальная ветка исследований (5 в MVP; 6-я xenoarchaeology — Etap 4). */
export type FundamentalBranchId =
  | 'chemistry'
  | 'physics'
  | 'engineering'
  | 'biology_fund'
  | 'military_science'
  | 'xenoarchaeology';

/** Тип связи фундаментал ↔ специализированная ветка (research-unification.md §7). */
export type BranchLinkType = 'primary' | 'secondary' | 'partial';

/** Тип улучшения технологии за уровень (60-research.md §4). */
export type TechImprovementType = 'linear' | 'progressive' | 'threshold' | 'diminishing';

/** Связь фундаментальной ветки со специализированной (research-unification.md §7). */
export interface BranchLink {
  fundamentalId: FundamentalBranchId;
  specializedId: SpecializedBranchId;
  linkType: BranchLinkType;
}

/** Фундаментальная ветка исследований (docs/00-ARCHITECTURE.md §3.2.1). */
export interface FundamentalBranch {
  id: FundamentalBranchId;
  name: string;
  nameEn: string;
  description: string;
  baseCost: number;
  maxLevel: number;
}

/** Преквизит технологии: другая технология должна быть изучена до minLevel. */
export interface Prerequisite {
  techId: string;
  minLevel: number;
}

/** Эффект технологии на другую систему (60-research.md §9.1). */
export interface TechEffect {
  target: string;
  operation: 'multiply' | 'add' | 'unlock';
  value: number;
  perLevel: boolean;
  thresholdLevel?: number;
}

/** Специализированная технология (15 в MVP, всего 72 в Etap 4). */
export interface Technology {
  id: string;
  name: string;
  nameEn: string;
  branch: SpecializedBranchId;
  baseCost: number;
  maxLevel: number;
  improvementType: TechImprovementType;
  improvementPerLevel: number;
  prerequisites: Prerequisite[];
  effects: TechEffect[];
  description: string;
  icon: string;
  sortOrder: number;
}

/**
 * Активный слот исследования: одна технология в очереди с аллокацией RP.
 * rpInvested — сколько RP уже вложено в текущий targetLevel.
 */
export interface ResearchSlot {
  slotId: string;
  techId: string;
  targetLevel: number;
  allocationPercent: number;
  rpInvested: number;
}

/**
 * Block 03 (R7): состояние исследований.
 *
 * - fundamentalLevels — уровень каждой фундаментальной ветки (0..10).
 * - fundamentalRpInvested — сколько RP уже вложено в каждую ветку.
 * - researched — карта techId → текущий уровень (0 = не изучена).
 * - activeSlots — активные слоты очереди (не более getMaxResearchSlots).
 *   Первый слот — «активное исследование».
 * - researchQueue — упорядоченный список techId, ожидающих старта
 *   (R-RES task §B). Когда активный слот завершается (достигает maxLevel),
 *   первый элемент очереди автоматически становится активным (shift+create).
 *   Элементы очереди не занимают слотов до старта.
 * - totalRpGenerated — монотонный lifetime-счётчик RP (для отладки и
 *   «банка» фундаменталов). Не уменьшается при списаниях в слоты/фундаменталы.
 *
 * Используем Record/Partial вместо Map для нативной JSON-сериализации
 * (без Array.from(entries)). T-R8 (serialization round-trip) работает
 * «из коробки» — нет нужды конвертировать в массив пар.
 */
export interface ResearchState {
  fundamentalLevels: Record<FundamentalBranchId, number>;
  fundamentalRpInvested: Partial<Record<FundamentalBranchId, number>>;
  researched: Record<string, number>;
  activeSlots: ResearchSlot[];
  /** R-RES §B: ordered queue of techIds waiting to become active research. */
  researchQueue: string[];
  totalRpGenerated: number;
}
