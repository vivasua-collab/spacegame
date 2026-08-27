# Чекпоинт: Блок 2 — Флот и корабли MVP

**Дата:** 2026-08-27
**Фаза:** Etap 3.0
**Статус:** `pending`
**Зависимости:** Блок 1 (стабилизация) должен быть завершён (особенно P1 — ID руд/рецептов, P2 — immutable store, P4 — UI очереди производства).

> 👉 Связанные документы:
> - [08_27_audit_summary.md](./08_27_audit_summary.md) — сводный аудит (§3.1: флот 0%, типы есть, логики нет)
> - [08_27_highlevel_plan.md](./08_27_highlevel_plan.md) — укрупнённый план (§Этап 3.0)
> - [docs/50-ships.md](../docs/50-ships.md) (1466 строк) — первичная спецификация
> - [docs/00-ARCHITECTURE.md](../docs/00-ARCHITECTURE.md) §3 (Модули 1–5), §5.2 (модульная архитектура)

---

## 1. Цель блока

Реализовать **минимально жизнеспособный флот (Fleet MVP)** согласно `docs/50-ships.md` Приложение D:
игрок может на планете с верфью (`shipyard`) **спроектировать корабль** (выбрать корпус + модули по слотам), **поставить его в очередь** на верфи, **построить**, объединить построенные корабли во **флот**, отдавать флоту **приказы** (`move`, `patrol`, `colonize`, `attack`, `defend`) и видеть **перемещение флота по Jump Points** с прибытием в целевую систему.

**Что не входит в MVP** (явно отложить на Etap 4):
- Тактический бой (только stub-функция `resolveCombat` на будущее).
- Маскировка, ЭМИ-щиты, торпеды, ионные пушки, истребительные отсеки, варп-двигатели.
- Mk.II–Mk.V всех модулей (только Mk.I — Приложение D).
- Тяжёлые корпуса: Крейсер, Линкор, Флагман (только Скаут/Истребитель/Фрегат/Транспорт).
- Адмиральскую систему прогрессии уровней (ставится заглушка `admiralLevel: 1`).
- Добычу астероидов модулем mining, ремонт, датчикные массивы.

---

## 2. Спецификация

**Первичный источник истины:** `docs/50-ships.md` (1466 строк).

Ключевые разделы, на которые опирается блок:

| § 50-ships.md | Что используется в MVP |
|--------------|------------------------|
| §1.1–1.6 (строки 27–165) | Модульный принцип, HS, формулы массы/скорости/энергии/стоимости; обязательные модули (Корпус + ЦПУ + ≥1 двигатель) |
| §2.1 (строки 170–180) | 7 корпусов; для MVP берём 4: **Скаут, Истребитель, Фрегат, Транспорт** |
| §2.2 (строки 182–207) | Параметры: HS, HP, масса, слоты (weapon/engine/system/defense), стоимость |
| §2.3 (строки 209–219) | Толщина обшивки (4 типа) — для MVP только **Лёгкая** и **Стандартная** |
| §2.4 (строки 221–231) | Тех-требования к корпусам (мин. уровни Инженерии/Верфи) — используются как gate при постройке |
| §2.5 (строки 233–250) | Структура `HullType` (эталон) |
| §3.2.1 (строки 276–295) | Химический двигатель Mk.I |
| §3.2.2 (строки 297–315) | Ионный двигатель Mk.I |
| §3.3 (строки 362–374) | Реакторы: для MVP **Ядерный реактор Mk.I** (+50 МВт, U 0.01/тик) |
| §4.2 (строки 395–410) | ЦПУ-Микро и ЦПУ-Лёгкий (минимум для Скаута/Истребителя) + §4.2 ограничения ЦПУ по корпусам |
| §4.3 (строки 425–434) | Навигатор Mk.I (опционально) |
| §4.5 (строки 447–464) | Связь Mk.I / Mk.II — критично для межсистемных приказов |
| §5.1–5.6 (строки 482–560) | Life Support — опциональный, но **ЖО-Кабина** нужна для адмирала (§5.5 — MVP-рекомендация) |
| §6.2 (строки 589–611) | Лазерная пушка Mk.I (единственное оружие в MVP) |
| §6.4 (строки 637–661) | Ракетная установка Mk.I (второе оружие в MVP) |
| §7.2 (строки 818–836) | Лёгкий щит Mk.I |
| §7.5 (строки 875–895) | Стальная обшивка (броня) |
| §8.1 (строки 920–937) | Грузовой отсек-S (для транспорта) |
| §8.2 (строки 939–961) | Топливный бак-S (хим./ксенон/водород) |
| §8.3 (строки 963–978) | Сканер базовый |
| §8.7 (строки 1034–1049) | Колонизационный модуль (для приказа `colonize`) |
| §8.8 (строки 1051–1069) | Прыжковый модуль Mk.I (Jump Drive — критично для перемещения по JP) |
| §9 (строки 1090–1150) | Сводная таблица — эталон для данных |
| §10 (строки 1153–1300) | Примеры сборки: Разведчик, Истребитель, Транспорт (используются как пресеты «по умолчанию» и в тестах) |
| Приложение B (строки 1341–1389) | `validateShip(design)` — эталонная функция валидации |
| Приложение C (строки 1393–1434) | Зависимости от tech + таблица «Корпус → мин. уровень верфи → время постройки (тиков)» |
| Приложение D (строки 1439–1463) | Дорожная карта MVP — список модулей для реализации |

---

## 3. Текущее состояние кода

### 3.1 Типы в `src/core/types.ts` (строки 221–255, 432–478)

```typescript
// строки 221–249
export type HullSize = 'scout' | 'fighter' | 'frigate' | 'cruiser' | 'battleship' | 'transport' | 'flagship';

export interface HullDef {
  id: string;
  name: string;
  size: HullSize;
  moduleSlots: number;
  hp: number;
  cost: Record<string, number>;
}

export type ModuleType = 'engine' | 'weapon' | 'shield' | 'sensor' | 'cargo'
                       | 'life_support' | 'control' | 'cloaking';

export interface ModuleDef {
  id: string;
  name: string;
  type: ModuleType;
  size: HullSize[];          // ⚠ не соответствует спеке: должно быть HS: number + slotRestriction: SlotType
  hp: number;
  powerConsumption: number;
  cost: Record<string, number>;
  stats: Record<string, number>;
}

// строки 432–455
export interface Ship {
  id: EntityId;
  name: string;
  hullId: string;
  modules: string[];        // moduleId[]
  hp: number;
  maxHp: number;
  location: EntityId;       // systemId или planetId
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

// строки 470–478
export interface GameState {
  time: GameTime;
  speed: GameSpeed;
  phase: GamePhase;
  galaxy: Galaxy;
  productionQueues: Map<EntityId, ProductionQueue>;
  fleets: Fleet[];           // ✅ поле уже есть
  playerFactionId: EntityId;
}
```

**Что есть:** ✅ базовые типы `HullSize`, `HullDef`, `ModuleType`, `ModuleDef`, `Ship`, `Fleet`, `FleetOrder`, `GameState.fleets`.

**Чего нет / не соответствует спеке 50-ships.md:**
- ❌ `HullDef` минимален: нет `totalHS`, `baseHP`, `baseMass`, `weaponSlots/engineSlots/systemSlots/defenseSlots`, `baseCost`, `requiredEngineeringLevel`, `requiredShipyardLevel`. Спека §2.5 требует полную структуру.
- ❌ `ModuleDef.size: HullSize[]` — не соответствует спеке §1.4: должно быть `size: number` (HS) + `slotRestriction?: SlotType`. Поле `size` семантически другое.
- ❌ `ModuleType` не покрывает категории спеки §1.4 (`'engine' | 'control' | 'life_support' | 'weapon' | 'defense' | 'auxiliary'`). Нет подтипов: `controlType`, `weaponType`, `defenseType`, `auxiliaryType`, `damageType`, `fuelType`.
- ❌ Нет `ShipDesign` (проект корабля, отделяемый от runtime-`Ship`): пресет чертежа, который сохраняется и переиспользуется. Спека §10 + Приложение B работает с `ShipDesign`.
- ❌ Нет `SlotType` (`'any' | 'weapon' | 'engine' | 'system' | 'defense'`).
- ❌ Нет `HullArmorThickness` (Лёгкая/Стандартная/Утолщённая/Тяжёлая).
- ❌ Нет `FuelType` (хим/ксенон/водород/антиматерия).
- ❌ Нет `JumpDrive`, `JumpPoint`-маршрутизации во `Fleet` (поля `orders[].path`, `etaTick`, `currentLegIndex`).
- ❌ `FleetOrder` минимален — нет `issuedTick`, `etaTick`, `path: EntityId[]` (маршрут по JP).
- ❌ Нет `Admiral`-типа (даже stub-уровня).
- ❌ Нет отдельной сущности `ShipyardQueue` — постройка кораблей сейчас не отличается от произвольной рецептурной очереди.

### 3.2 Верфь в `src/data/buildings.ts` (строки 136–148)

```typescript
{
  id: 'shipyard',
  name: 'Верфь',
  description: 'Сборка и ремонт космических кораблей',
  category: 'production',
  layer: ['surface', 'orbit'],     // ✅ может быть планетарной или орбитальной
  size: ['medium', 'large'],
  energyConsumption: 8,
  baseProductionTime: 30,
  levels: 10,
  costPerLevel: { Fe: 15, Ti: 8, Si: 10 },
  terrainBonus: {},
  requiresAtmosphere: false,
}
```

✅ Верфь определена. ❌ Не используется: `engine.ts` обрабатывает только `category: 'extraction'`, `category: 'energy'`, `colony_hub` и `production`-рецепты через `processProductionQueue`, но нет логики «корабль построен → создать `Ship`, поместить на орбиту планеты».

### 3.3 Экономика — `src/economy/engine.ts`

- `processProductionQueue` (строки 217–269) — работает с `RECIPE_MAP`, по завершении кладёт outputs в `planet.resources`. ❌ Не эмитит `ships:constructed`, не создаёт `Ship`-сущность, не декрементирует «корабельные модули» со склада как физические предметы.
- `recalcEnergyBalance` — не учитывает корабельные реакторы (это нормально: они onboard).
- `buildOnHex` — общая функция, не специфичная для верфи. ❌ Нет метода `enqueueShipConstruction(planet, designId)`.
- Использует **legacy `event-bus.ts`** (`gameBus.emit('production:complete', …)` и `'building:constructed'`, `'planet:colonized'`, `'building:upgraded'`) — P1-DEP-1 из аудита. В Блоке 1 должны перейти на `typed-event-bus`, мы в Блоке 2 используем только typed-bus.

### 3.4 Рецепты — `src/data/recipes.ts` (строки 701–741)

Уже определены 4 рецепта на верфи (`make_ion_engine`, `make_laser`, `make_cargo_bay`, `make_scanner`) — это производство **компонент-модулей**, не готовых кораблей. Это уровень 3 по `00-ARCHITECTURE.md §3.2.2` (Компоненты → Модули). Необходимо добавить уровень 4 — **Модули → Корабль** (через дизайн).

### 3.5 Stores — `src/stores/game-store.ts`

- `GameState.fleets` передаётся через `newGame`/`deserializeGameState` (строки 169, 78 в game-mediator.ts).
- ❌ Нет действий `designShip`, `enqueueShipBuild`, `createFleet`, `mergeFleet`, `splitFleet`, `issueFleetOrder`.
- ❌ `GameView = 'galaxy' | 'system' | 'planet'` — нет `'fleet'` и `'ship-designer'`.
- ❌ `tick()` (строки 232–251) обрабатывает только `processEconomyTick` — нет `processFleetTick` для движения флотов по JP.

### 3.6 Каталог событий — `src/core/events.ts`

✅ `ShipsEvents` (строки 57–65) уже декларирует: `ships:designed`, `ships:constructed`, `ships:destroyed`, `ships:movement-started`, `ships:arrived`, `ships:damaged`, `ships:repaired`.
✅ `FleetEvents` (строки 69–75) декларирует: `fleet:created`, `fleet:order-issued`, `fleet:order-completed`, `fleet:merged`, `fleet:split`.

❌ Недостающие события (см. §5 ниже): `ships:design-validated`, `ships:construction-started`, `ships:construction-progress`, `fleet:movement-started`, `fleet:arrived`, `fleet:order-cancelled`, `ships:fuel-consumed`, `fleet:fuel-low`.

### 3.7 UI — `src/components/game/`

Существуют: `galaxy-map.tsx`, `system-view.tsx`, `planet-view.tsx`, `building-dialog.tsx`, `game-layout.tsx`, `resource-panel.tsx`, `time-controls.tsx`.

❌ Нет `ship-designer.tsx`, `fleet-view.tsx`, `shipyard-dialog.tsx`, `fleet-orders-panel.tsx`, `fleet-route-overlay.tsx` (для отрисовки маршрутов на галактик-мапе).

### 3.8 Модули (модульная архитектура)

Реализованы `EconomyModule` (`src/economy/economy-module.ts`) и `GalaxyModule` (`src/galaxy/galaxy-module.ts`).
❌ Нет `ShipsModule` и `FleetModule` (хотя `ModuleId = 'ships' | 'fleet'` уже есть в `module-types.ts` строка 15–25).

---

## 4. Подзадачи (детально, по одной задаче на раздел)

> Принципы нумерации: F1–F7 — подзадачи блока. Каждая подзадача имеет: цель, файлы для изменения, ключевые функции, UI, оценку времени.

---

### F1. Типы и данные (корпуса, модули, классы кораблей)

**Цель:** Привести типы `HullDef`, `ModuleDef`, `Ship`, `ShipDesign` в полное соответствие `docs/50-ships.md` §2.5, §1.4, §9. Создать каталог данных MVP-корпусов (4 шт.) и MVP-модулей (~15 шт. из Приложения D).

**Файлы для изменения:**
- `src/core/types.ts` — расширить типы.
- `src/data/ships/hulls.ts` — **новый файл**: каталог `HULLS: HullType[]` (4 корпуса MVP).
- `src/data/ships/modules.ts` — **новый файл**: каталог `SHIP_MODULES: ShipModule[]` (двигатели, ЦПУ, оружие, щиты, броня, груз, топливо, сканер, прыжок, реактор, ЖО-Кабина).
- `src/data/ships/index.ts` — **новый файл**: экспорты + lookup-мапы `HULL_MAP`, `MODULE_MAP`.

**Ключевые типы (в `types.ts`):**

```typescript
export type SlotType = 'any' | 'weapon' | 'engine' | 'system' | 'defense';
export type ModuleCategory = 'engine' | 'control' | 'life_support' | 'weapon' | 'defense' | 'auxiliary';
export type DamageType = 'energy' | 'kinetic' | 'ion' | 'plasma' | 'missile' | 'torpedo';
export type FuelType = 'chemical' | 'xenon' | 'hydrogen' | 'antimatter';
export type HullArmorThickness = 'light' | 'standard' | 'thick' | 'heavy';

export interface HullType {                 // §2.5
  id: string;                               // 'hull_scout'
  name: string;
  totalHS: number;
  baseHP: number;
  baseMass: number;                         // т
  weaponSlots: number;
  engineSlots: number;
  systemSlots: number;
  defenseSlots: number;
  baseCost: number;                         // у.е.р.
  requiredEngineeringLevel: number;
  requiredShipyardLevel: number;
  armorOptions: HullArmorThickness[];      // какие обшивки доступны
}

export interface ShipModule {               // §1.4
  id: string;
  name: string;
  category: ModuleCategory;
  size: number;                             // HS
  mass: number;                              // т
  energyConsumption: number;                 // МВт (0 — не потребляет)
  cost: number;                              // у.е.р.
  techLevel: number;
  requiredTechs: string[];
  slotRestriction?: SlotType;
  // Специфичные поля per category — см. спеку §4.6, §6.9, §7.6, §8.9
  // Для MVP: расширяем через optional-поля (не делаем 6 интерфейсов)
  thrust?: number;                          // engine
  fuelType?: FuelType;                      // engine + fuel_tank
  fuelPerThrust?: number;                   // engine
  warpRange?: number;                       // engine warp
  controlType?: 'cpu' | 'navigation' | 'tactical' | 'communication';
  combatBonus?: number;
  fuelEfficiencyBonus?: number;
  communicationRange?: number;              // св. лет
  minHull?: HullSize;                       // для ЦПУ (см. §4.2 таблицу)
  weaponType?: 'laser' | 'plasma' | 'missile' | 'gauss' | 'ion' | 'torpedo' | 'fighter_bay';
  damage?: number;
  range?: number;                           // км
  fireRate?: number;                        // выстрелов/тик
  energyPerShot?: number;
  accuracy?: number;                        // %
  damageType?: DamageType;
  ammo?: number;                            // null = бесконечный
  defenseType?: 'shield' | 'stealth' | 'emi_shield' | 'armor';
  shieldHP?: number;
  regenRate?: number;                       // %/тик
  hpPerHS?: number;                         // броня
  massPerHS?: number;                       // броня
  auxiliaryType?: 'cargo' | 'fuel_tank' | 'scanner' | 'sensor_array'
                 | 'repair' | 'mining' | 'colony' | 'jump_drive' | 'reactor';
  capacity?: number;                        // груз/топливо/колонисты
  maxJumpMass?: number;                     // т
  energyOutput?: number;                    // для реактора (МВт, > 0)
}

export interface ShipDesign {               // Приложение B
  id: EntityId;
  name: string;                             // 'Разведчик-α'
  hullId: string;                           // 'hull_scout'
  armor: HullArmorThickness;                // 'light'
  moduleIds: string[];                      // [moduleId, …] — порядок не важен
  owner: EntityId;
  createdAtTick: number;
}

export interface Ship {
  id: EntityId;
  name: string;
  designId: EntityId;                        // ⚠ ссылка на дизайн, не на hullId напрямую
  hullId: string;                           // snapshot из дизайна (на случай удаления дизайна)
  moduleIds: string[];                      // snapshot из дизайна
  armor: HullArmorThickness;                // snapshot
  hp: number;
  maxHp: number;
  fuel: Record<FuelType, number>;           // текущее топливо по типам
  location: EntityId;                       // systemId (для летающих) или planetId (на верфи)
  owner: EntityId;
  designName: string;                       // для UI
}

export interface FleetOrder {
  type: 'move' | 'patrol' | 'colonize' | 'attack' | 'defend';
  targetId: EntityId;
  issuedTick: number;
  // Маршрут для move/patrol — последовательность systemId через JP
  path: EntityId[];
  currentLegIndex: number;                  // 0..path.length-1
  etaTick: number;                          // ожидаемый тик прибытия в цель
  repeat?: boolean;                         // для patrol
}

export interface Fleet {
  id: EntityId;
  name: string;
  shipIds: EntityId[];                      // ⚠ не Ship[], а ID — immutable store
  location: EntityId;                       // systemId
  owner: EntityId;
  orders: FleetOrder[];
  fuelStores: Record<FuelType, number>;     // суммарное топливо флота
}
```

> ⚠ Изменение `Fleet.ships: Ship[]` → `Fleet.shipIds: EntityId[]` — вынужденное: `Ship[]` нарушает принцип immutable store (P2 Блока 1). Делать после Блока 1.

**Ключевые функции (в `src/data/ships/index.ts`):**
- `getHull(id: string): HullType | undefined`
- `getModule(id: string): ShipModule | undefined`
- `listModulesByCategory(cat: ModuleCategory): ShipModule[]`
- `listModulesForHull(hullId: string): ShipModule[]` — фильтр по `minHull`/`slotRestriction`

**Каталог корпусов MVP** (4 шт., из §2.1 + §2.4):
`hull_scout` (HS 25, HP 200, масса 500, 1/2/3/1 слотов, Eng.1, Verf.1, у.е.р. 50),
`hull_fighter` (HS 50, HP 400, 1kт, 2/2/2/2, Eng.1, Verf.1, 120),
`hull_frigate` (HS 100, HP 1k, 2.5kт, 4/3/4/3, Eng.2, Verf.2, 300),
`hull_transport` (HS 150, HP 800, 4kт, 2/3/5/2, Eng.2, Verf.2, 250).

**Каталог модулей MVP** (~15 шт., из Приложения D):
двигатели: `engine_chemical_mk1`, `engine_ion_mk1`;
ЦПУ: `cpu_micro`, `cpu_light`;
оружие: `weapon_laser_mk1`, `weapon_missile_mk1`;
оборона: `shield_light_mk1`, `armor_steel` (броня 1+ HS);
вспомогательные: `cargo_bay_s`, `fuel_tank_chemical_s`, `fuel_tank_xenon_s`, `fuel_tank_hydrogen_s`, `scanner_basic`, `jump_drive_mk1`, `colony_module_small`;
реактор: `reactor_nuclear_mk1`;
жизнеобеспечение: `life_support_cabin` (для адмирала, stub);
связь: `comm_mk1`, `comm_mk2` (нужна для межсистемных приказов — §4.5).

**Время:** 1.5–2 дня (200–250 строк кода данных + 80 строк типов).

---

### F2. Конструктор кораблей (верфь → выбор корпуса → модули → запуск) — UI drag&drop

**Цель:** Экран `ShipDesigner` открывается из `BuildingDialog` верфи или из панели флота. Игрок выбирает корпус, толщину обшивки, перетаскивает модули в слоты (weapon/engine/system/defense), видит live-расчёт массы/скорости/энергобаланса/стоимости/HP, сохраняет `ShipDesign`.

**Файлы для изменения:**
- `src/ships/designer.ts` — **новый файл**: чистая логика валидации и расчёта характеристик.
- `src/components/game/ship-designer.tsx` — **новый UI-компонент** (~500 строк).
- `src/components/game/building-dialog.tsx` — добавить кнопку «Конструктор кораблей» при `buildingId === 'shipyard'`.
- `src/components/game/game-layout.tsx` — добавить `view: 'ship-designer'` в `GameView` и роутинг.

**Ключевые функции (в `src/ships/designer.ts`):**

```typescript
export interface DesignStats {
  totalHS: number;          // сумма HS модулей
  usedHS: number;           // свободные HS
  mass: number;             // масса (т), с учётом обшивки
  speed: number;            // км/с = Σthrust / mass × 10 (§3.1)
  thrust: number;
  energyBalance: number;   // МВт (output - consumption)
  totalHP: number;          // hull HP × armorMult + armor bonus HP
  shieldHP: number;         // Σ shield.shieldHP
  cost: number;             // у.е.р.
  cargoCapacity: number;
  fuelCapacity: Record<FuelType, number>;
  jumpRangeMass: number;    // min(maxJumpMass всех jump_drive)
  commRange: number;        // св. лет
  scanRange: number;        // а.е.
  canJump: boolean;         // есть ли jump_drive или warp
  isValid: boolean;
  errors: string[];         // из validateShip
}

export function calculateDesignStats(design: ShipDesign): DesignStats;
export function validateShip(design: ShipDesign, ctx: { shipyardLevel: number; engineeringLevel: number; researchedTechs: string[] }): { valid: boolean; errors: string[] };
// По спецификации Приложение B:
// 1. ЦПУ присутствует (controlType === 'cpu')
// 2. ≥1 двигатель
// 3. ΣHS ≤ hull.totalHS
// 4. weaponCount ≤ hull.weaponSlots, и т.д.
// 5. energyBalance ≥ 0
// 6. ЦПУ достаточно для корпуса (minHull check)
// 7. Все requiredTechs исследованы
// 8. shipyardLevel ≥ hull.requiredShipyardLevel
// 9. engineeringLevel ≥ hull.requiredEngineeringLevel

export function armorMultiplier(armor: HullArmorThickness): { hpMult: number; massMult: number; costMult: number };
// §2.3: light {1.0, 1.0, 1.0}; standard {1.25, 1.10, 1.2}; thick {1.50, 1.25, 1.5}; heavy {2.0, 1.50, 2.0}
```

**UI `ship-designer.tsx`:**
- Левая колонка: селектор корпуса (4 карточки), селектор обшивки (4 кнопки).
- Центр: 4 столбца-списка слотов (weapon/engine/system/defense) с droppable-зонами; под ними список «не размещено».
- Правая колонка: live-`DesignStats` (масса, скорость, HP, щиты, энерго, стоимость, дальность связи, прыжок), кнопка «Сохранить дизайн», кнопка «Построить на верфи» (если верфь активна).
- DnD: использовать `@dnd-kit/core` (или HTML5 drag&drop — см. risk в §8).

**Время:** 3 дня (1 день — `designer.ts` + тесты; 2 дня — UI).

---

### F3. Флот-менеджер (экран флота, список кораблей, группировка)

**Цель:** Экран `FleetView` — список всех флотов игрока + список «свободных» кораблей (не в составе флота) на текущей планете/верфи. Действия: создать флот из выбранных кораблей, слить два флота, расщепить флот, переименовать.

**Файлы для изменения:**
- `src/components/game/fleet-view.tsx` — **новый UI-компонент** (~350 строк).
- `src/components/game/game-layout.tsx` — добавить `view: 'fleet'` + кнопка «Флот» в верхнем меню.
- `src/stores/game-store.ts` — действия: `createFleet`, `mergeFleets`, `splitFleet`, `renameFleet`, `getFleet(id)`, `getLooseShips(planetId)`.

**Ключевые функции в store:**

```typescript
createFleet: (name: string, shipIds: EntityId[], atSystemId: EntityId) => EntityId | null;
mergeFleets: (targetId: EntityId, sourceId: EntityId) => boolean;     // source расформировывается
splitFleet: (sourceId: EntityId, shipIds: EntityId[], newName: string) => EntityId | null;
renameFleet: (id: EntityId, name: string) => void;
```

**UI:**
- Список флотов: имя, кол-во кораблей, локация, текущий приказ, ETA.
- Раскрытие флота → список кораблей с параметрами (HP/щиты/скорость/груз).
- Drag&drop кораблей между флотами (опционально — можно кнопками «→»/«←»).
- Кнопка «+ Флот» открывает диалог выбора кораблей на текущей планете.

**Время:** 2 дня.

---

### F4. Приказы (move / patrol / colonize / attack / defend)

**Цель:** Игрок может выделить флот и отдать приказ. Приказ `move` — лететь к системе/планете через JP; `patrol` — циклически между N системами; `colonize` — к планете → основать колонию (тратится колониальный модуль); `attack` — к системе врага → stub-бой; `defend` — удерживать текущую систему.

**Файлы для изменения:**
- `src/ships/orders.ts` — **новый файл**: парсинг приказов, расчёт пути.
- `src/components/game/fleet-orders-panel.tsx` — **новый UI-компонент** (~250 строк).
- `src/stores/game-store.ts` — действие `issueFleetOrder(fleetId, type, targetId)`.
- `src/components/game/galaxy-map.tsx` — добавить клик-правый на систему → контекстное меню «Отправить выбранный флот сюда».

**Ключевые функции (в `src/ships/orders.ts`):**

```typescript
export function planRoute(
  fromSystemId: EntityId,
  toSystemId: EntityId,
  galaxy: Galaxy,
): EntityId[] | null;
// BFS по jumpPoints через systemMap (см. src/galaxy/generate-jump-points.ts — структура JP есть)
// Возвращает [systemId, …, toSystemId] или null если пути нет

export function calculateTravelTime(
  path: EntityId[],
  fleetStats: { mass: number; thrust: number; speed: number; jumpDrivePresent: boolean },
): number;
// §3.1: speed = thrust / mass × 10 (км/с)
// Каждый переход JP = расстояние между системами (из galaxy.systems[].position) / speed
// + 10 тиков перезарядки jump_drive (§3.2.4)
// Если jumpDrivePresent === false → переход невозможен (return Infinity)

export function executeOrder(
  fleet: Fleet,
  state: GameState,
  currentTick: number,
): { completed: boolean; newFleet: Fleet; events: EventPayload<'fleet:order-completed' | 'ships:arrived' | 'fleet:arrived'>[] };
// Двигает currentLegIndex по пути, декрементирует топливо, вызывает colonizePlanet при colonize
```

**UI `fleet-orders-panel.tsx`:**
- При выделении флота в `FleetView` или на `GalaxyMap` — правая панель:
  - Кнопки: Двигаться / Патруль / Колонизировать / Атаковать / Защищать.
  - Подсветка валидных целей на карте (`colonize` → только незанятые планеты; `attack` → системы врага; `move` → любая система).
  - Превью маршрута: список промежуточных систем, ETA, расход топлива.

**Время:** 2.5 дня.

---

### F5. Перемещение по Jump Points (расчёт времени пути, прибытие)

**Цель:** Каждый тик `processFleetTick` продвигает флоты по их маршрутам: декремент `etaTick`, при достижении `currentLegIndex + 1` — флот «перепрыгивает» в следующую систему, эмитит `ships:arrived` + `fleet:arrived`, списывает топливо. По прибытии в конечную цель — `fleet:order-completed` и переход к следующему приказу (или завершение).

**Файлы для изменения:**
- `src/ships/fleet-engine.ts` — **новый файл**: тиковый движок.
- `src/ships/index.ts` — **новый**: экспорты + `ShipsModule`, `FleetModule`.
- `src/ships/ships-module.ts` — **новый**: `ShipsModule implements IGameModule` (создание/уничтожение/ремонт кораблей).
- `src/ships/fleet-module.ts` — **новый**: `FleetModule implements IGameModule` (движение, приказы).
- `src/stores/game-store.ts` — в `tick()` после `processEconomyTick` вызвать `processFleetTick(state.fleets, state.galaxy, state.time.tick)`.
- `src/core/game-mediator.ts` — регистрировать `ShipsModule` и `FleetModule` в `getMediatorWithModules()`.

**Ключевые функции:**

```typescript
// src/ships/fleet-engine.ts
export function processFleetTick(
  fleets: Fleet[],
  galaxy: Galaxy,
  currentTick: number,
  shipMap: Map<EntityId, Ship>,
): Fleet[];  // возвращает обновлённый массив флотов

function advanceFleet(fleet: Fleet, …): Fleet;
function consumeFuel(fleet: Fleet, legDistance: number): { fleet: Fleet; insufficient: boolean };
function completeOrder(fleet: Fleet, currentTick: number): Fleet;
```

**Логика:**
1. Для каждого флота с активным приказом:
   - Если `currentTick < order.etaTick` → проверить достаточность топлива на текущем leg; если мало — эмитить `fleet:fuel-low`, флот «застывает» на полпути (state: 'stranded').
   - Если `currentTick >= order.etaTick` → `currentLegIndex++`, `fleet.location = path[currentLegIndex]`, эмитить `ships:arrived` (для каждого корабля) + `fleet:arrived`, пересчитать `etaTick` для следующего leg.
   - Если `currentLegIndex === path.length - 1` → выполнить целевое действие:
     - `colonize` → найти планету по `targetId`, вызвать `colonizePlanet` (из `engine.ts`), декрементировать колониальный модуль с флагмана/транспорта.
     - `attack` → stub: эмитить `combat:engaged`, пометить как «бой начат» (детальный бой — Etap 4).
     - `patrol` → зациклить: `path = reverse(path)`, `currentLegIndex = 0` (или `repeat: true`).
     - `defend` → `order` удаляется, флот остаётся в системе в статусе «defending».
2. Эмитить `fleet:order-completed` при завершении.

**Тесты:** модульный тест «флот из системы A в B через 1 JP, скорость 7.4 км/с, расстояние 5 св.лет → ETA = X тиков» (см. §7).

**Время:** 3 дня (1 день — движок; 1 день — модули; 1 день — интеграция в `tick()` + медиатор).

---

### F6. Интеграция в экономику (стоимость постройки, потребление ресурсов)

**Цель:** Постройка корабля занимает ресурсы со склада планеты и время на верфи. После завершения — `Ship` создаётся и помещается на орбиту планеты (в «свободные корабли»). Топливо флота — отдельный ресурс, потребляется в пути.

**Файлы для изменения:**
- `src/data/recipes.ts` — добавить рецепты уровня 4 «Модули → Корабль» (генерируются из `ShipDesign`), либо сделать отдельную очередь `ShipyardQueue`.
- `src/economy/engine.ts` — расширить `processProductionQueue`: при `recipe.category === 'module_to_ship'` и завершении → создать `Ship`, эмитить `ships:constructed`, поместить на орбиту планеты.
- `src/data/ships/shipyard-queue.ts` — **новый файл**: `ShipyardQueue` (отдельная от `ProductionQueue`, т.к. нужны поля `designId`, `progressTicks`, `totalTicks`).
- `src/stores/game-store.ts` — действие `enqueueShipBuild(planetId, designId)`.
- `src/components/game/shipyard-dialog.tsx` — **новый UI**: очередь постройки кораблей + кнопка «Построить из дизайна».

**Ключевые функции:**

```typescript
// src/data/ships/shipyard-queue.ts
export interface ShipyardQueueItem {
  id: EntityId;
  designId: EntityId;
  shipName: string;
  progressTicks: number;
  totalTicks: number;       // из Приложения C: scout=50, fighter=80, frigate=150, transport=120
}

export interface ShipyardQueue {
  planetId: EntityId;
  items: ShipyardQueueItem[];
}

export function enqueueShipBuild(planet: Planet, queue: ShipyardQueue | undefined, design: ShipDesign): ShipyardQueue;
export function processShipyardTick(planet: Planet, queue: ShipyardQueue, shipIdGenerator: () => EntityId): { ship?: Ship; newQueue: ShipyardQueue };
```

**Стоимость постройки** (§1.3 формула + §2.5):
```
cost_total = hull.baseCost × armorMultiplier(armor).costMult + Σ(modules[i].cost)
```
В ресурсах: каждая `у.е.р.` конвертируется через `STEEL_PER_UER` (Стальной сплав, 1 у.е.р. = 5 ед. steel + 1 ед. microchip) — **упрощение для MVP**. Полный крафт компонент-модулей (через `make_ion_engine` и пр.) — это уже уровень 3, его оставляем как опциональный «пред-степ» в очереди верфи.

**Время:** 2 дня.

---

### F7. Интеграция в game-store + события на typed-bus

**Цель:** Все действия флота идут через `useGameStore` → `GameMediator` → `ShipsModule`/`FleetModule` → `TypedEventBus`. UI подписывается на typed-bus для reactive-обновлений (тосты, маршрут-оверлей). Сохранение/загрузка работает (флоты + дизайны в `GameState`).

**Файлы для изменения:**
- `src/stores/game-store.ts` — добавить все fleet/ship-действия, обернуть в immutable-update (после Блока 1 P2).
- `src/core/types.ts` — добавить `GameState.shipDesigns: Map<EntityId, ShipDesign>` и `GameState.shipyardQueues: Map<EntityId, ShipyardQueue>`.
- `src/stores/game-store.ts` `serializeGameState` / `deserializeGameState` — добавить новые поля.
- `src/components/game/fleet-route-overlay.tsx` — **новый UI**: SVG-оверлей на `GalaxyMap` с линиями активных маршрутов флотов + иконка ETA.
- `src/components/game/galaxy-map.tsx` — интеграция оверлея.

**Ключевые действия в store (финальный список):**

```typescript
// Конструктор
saveShipDesign: (design: Omit<ShipDesign, 'id' | 'createdAtTick'>) => EntityId | null;
deleteShipDesign: (id: EntityId) => boolean;

// Верфь
enqueueShipBuild: (planetId: EntityId, designId: EntityId) => boolean;

// Флот
createFleet: (name: string, shipIds: EntityId[], atSystemId: EntityId) => EntityId | null;
mergeFleets: (targetId: EntityId, sourceId: EntityId) => boolean;
splitFleet: (sourceId: EntityId, shipIds: EntityId[], newName: string) => EntityId | null;
renameFleet: (id: EntityId, name: string) => void;
issueFleetOrder: (fleetId: EntityId, type: FleetOrder['type'], targetId: EntityId) => boolean;
cancelFleetOrder: (fleetId: EntityId) => boolean;

// Подписки на события (для тостов)
subscribeToFleetEvents: () => () => void;   // возвращает unsubscribe
```

**Сериализация** — добавить в `serializeGameState`:
```typescript
const serializable = {
  ...state,
  galaxy: galaxyWithoutMap,
  productionQueues: Array.from(state.productionQueues.entries()),
  shipDesigns: Array.from(state.shipDesigns.entries()),         // ⚠ НОВОЕ
  shipyardQueues: Array.from(state.shipyardQueues.entries()),  // ⚠ НОВОЕ
  fleets: state.fleets,                                         // уже есть
};
```

**Время:** 2 дня.

---

## 5. События typed-bus (новые)

**Уже существуют в `src/core/events.ts`** (используем как есть):
- `ships:designed`, `ships:constructed`, `ships:destroyed`, `ships:movement-started`, `ships:arrived`, `ships:damaged`, `ships:repaired`.
- `fleet:created`, `fleet:order-issued`, `fleet:order-completed`, `fleet:merged`, `fleet:split`.

**Новые события — добавить в `events.ts`:**

```typescript
export interface ShipsEvents {
  // ⚠ существующие + новые:
  'ships:design-validated': { designId: EntityId; valid: boolean; errors: string[] };
  'ships:construction-started': { planetId: EntityId; designId: EntityId; shipId: EntityId; etaTick: number };
  'ships:construction-progress': { planetId: EntityId; shipId: EntityId; progressTicks: number; totalTicks: number };
  'ships:fuel-consumed': { fleetId: EntityId; fuelType: string; amount: number; remaining: number };
}

export interface FleetEvents {
  // ⚠ существующие + новые:
  'fleet:movement-started': { fleetId: EntityId; fromSystemId: EntityId; toSystemId: EntityId; path: EntityId[]; etaTick: number };
  'fleet:arrived': { fleetId: EntityId; systemId: EntityId };
  'fleet:order-cancelled': { fleetId: EntityId; orderType: string; reason: 'manual' | 'impossible' | 'fuel' };
  'fleet:fuel-low': { fleetId: EntityId; remainingFuel: number; requiredFuel: number };
  'fleet:stranded': { fleetId: EntityId; systemId: EntityId };   // застрял без топлива
}
```

**Подписки `ShipsModule`:**
- `core:tick` (priority: PRIORITY.SIMULATION + 10, после economy) — обрабатывает `ShipyardQueue`.
- `economy:production-complete` — если `recipeId` соответствует кораблю, пометить `shipyardQueueItem` завершённым.

**Подписки `FleetModule`:**
- `core:tick` (priority: PRIORITY.SIMULATION + 20, после ships) — `processFleetTick`.
- `fleet:order-issued` — пересчёт пути и ETA.

**Эмитты `ShipsModule` (в manifest):** `ships:design-validated`, `ships:constructed`, `ships:construction-started`, `ships:construction-progress`, `ships:destroyed`, `ships:damaged`, `ships:repaired`, `ships:arrived`, `ships:movement-started`, `ships:fuel-consumed`.

**Эмитты `FleetModule`:** `fleet:created`, `fleet:order-issued`, `fleet:order-completed`, `fleet:order-cancelled`, `fleet:movement-started`, `fleet:arrived`, `fleet:merged`, `fleet:split`, `fleet:fuel-low`, `fleet:stranded`.

---

## 6. UI-компоненты

**Новые файлы в `src/components/game/`:**

| Файл | Назначение | Оценка строк |
|------|-----------|--------------|
| `ship-designer.tsx` | Конструктор кораблей (drag&drop модулей в слоты) | ~500 |
| `fleet-view.tsx` | Список флотов + свободных кораблей, drag кораблей между флотами | ~350 |
| `fleet-orders-panel.tsx` | Панель приказов: кнопки + превью маршрута | ~250 |
| `shipyard-dialog.tsx` | Очередь постройки кораблей на верфи + кнопка «Новый дизайн» | ~200 |
| `fleet-route-overlay.tsx` | SVG-оверлей маршрутов на галактик-мапе | ~120 |
| `ship-card.tsx` | Переиспользуемая карточка корабля (HP/щиты/скорость) | ~80 |

**Изменяемые UI-файлы:**

| Файл | Что добавить |
|------|--------------|
| `game-layout.tsx` | `GameView += 'ship-designer' | 'fleet'`; кнопки «🚀 Флот» и «🔧 Дизайнер» в верхнем меню; роутинг |
| `galaxy-map.tsx` | Правый клик по системе → контекстное меню «Отправить флот»; интеграция `FleetRouteOverlay` |
| `building-dialog.tsx` | При `buildingId === 'shipyard'` — кнопка «Конструктор кораблей» (открывает `ship-designer`), кнопка «Очередь верфи» (открывает `shipyard-dialog`) |
| `planet-view.tsx` | В панели зданий показать наличие верфи и текущую очередь постройки кораблей |
| `resource-panel.tsx` | Показывать топливо флотов (хим/ксенон/водород) отдельной строкой |

**Библиотеки:**
- DnD: `@dnd-kit/core` + `@dnd-kit/sortable` (легковеснее react-dnd, лучше TS-поддержка).
- Если DnD слишком тяжёлый — fallback на HTML5 drag&drop API (5 колбеков, без либы).

---

## 7. Тесты

**Минимум — 5 тестов** (соответствует метрике из `08_27_highlevel_plan.md`):

| ID | Файл | Что проверяет | Утверждение |
|----|------|---------------|-------------|
| T-FLEET-1 | `tests/ships/designer.test.ts` | `validateShip` | Скаут без ЦПУ → `valid: false`, ошибка «Отсутствует ЦПУ»; с ЦПУ-Микро + Ионный двигатель + Jump Drive → `valid: true`, `mass` ≈ 1075 т, `speed` ≈ 7.4 км/с (пример из §10.1) |
| T-FLEET-2 | `tests/ships/designer.test.ts` | `calculateDesignStats` | Энергобаланс Скаута из §10.1 = −2 МВт (профицит = 2); стоимость = 415 у.е.р. |
| T-FLEET-3 | `tests/ships/orders.test.ts` | `planRoute` (BFS по JP) | Галактика из 3 систем A-B-C с JP A↔B, B↔C, без A↔C: `planRoute(A, C)` → `[A, B, C]`; `planRoute(A, A)` → `[A]`; `planRoute(A, D)` где D изолирована → `null` |
| T-FLEET-4 | `tests/ships/fleet-engine.test.ts` | `processFleetTick` + `calculateTravelTime` | Флот с скоростью 7.4 км/с, расстояние 5 св.лет (≈ 4.73e13 км) → ETA ≈ 730 тиков + 10 перезарядки; через 740 тиков `currentLegIndex` = 1, `fleet.location` = целевая система, эмитированы `ships:arrived` и `fleet:arrived` |
| T-FLEET-5 | `tests/ships/shipyard.test.ts` | `enqueueShipBuild` + `processShipyardTick` | Скаут (50 тиков) → через 50 тиков `processShipyardTick` создаёт `Ship` с `designId`, `location = planetId`, эмитит `ships:constructed`; ресурсы планеты уменьшаются на `cost_total = 415 у.е.р. × ресурсы/у.е.р.` |

**Запуск:** `npm test` (или `vitest run`). Все тесты должны быть детерминированными (фиксированный seed PRNG для галактики в T-FLEET-3/4).

**Покрытие по чек-листу аудита (из `08_27_audit_summary.md` §7):** эти 5 тестов + тесты Блока 1 = ≥5 итоговых тестов на конец Etap 3.0.

---

## 8. Риски и зависимости

| # | Риск / Зависимость | Влияние | Митигация |
|---|---------------------|---------|-----------|
| R1 | **Блок 1 (стабилизация) не завершён** — особенно P2 (immutable store) | `Fleet.ships: Ship[]` → `Fleet.shipIds: EntityId[]` требует immutable-update. Без P2 — риск stale-ссылок на `Ship` после `tick()`. | Строго ждать Блок 1. Если Блок 1 задерживается — начать с F1 (типы и данные), которые не зависят от store. |
| R2 | **Блок 1 P1 (ID руд/рецептов) не завершён** | `recipes.ts` использует `ion_engine`, `laser`, `cargo_bay`, `scanner` как outputs — это level-3 компоненты. Если P1 не сделан — рецепт `make_ion_engine` не найдёт inputs. | Для MVP-флота используем **упрощённую модель**: `cost_total` (в у.е.р.) конвертируется напрямую в ресурсы (steel, microchip), минуя многоуровневый крафт. Полный крафт — пост-MVP. |
| R3 | **Блок 3 (Исследования) не начат** | 50-ships.md требует `requiredTechs: string[]` для модулей; без tech-дерева валидация всегда падает. | F1: для всех MVP-модулей `requiredTechs: []` (пустой массив). Gate по `techLevel` отключён (или stub: `researchedTechs = ['all']` в тестовом контексте). Раскомментировать в Блоке 3. |
| R4 | **Drag&Drop библиотека** — `@dnd-kit` не установлена | Зависимость `package.json` отсутствует, нужно `npm install @dnd-kit/core @dnd-kit/sortable`. | Сначала проверить `package.json`; если нет — установить. Fallback на HTML5 DnD API (без зависимостей). |
| R5 | **Производительность `processFleetTick`** — 1000+ флотов на тик | На Etap 3.5 (AI-фракции) количество флотов вырастет. Для MVP (только игрок) — не критично. | В F5 оставить TODO-комментарий: «профилировать на >100 флотов; при необходимости — spatial hash по `location`». |
| R6 | **`JumpPoint` маршрутизация** — `galaxy.systemMap` имеет JP только в `system.jumpPoints[]` | BFS в `planRoute` должен строить граф из `systems.flatMap(s => s.jumpPoints)`. Проверить, что JP двунаправлены (см. `generate-jump-points.ts` — да, создаётся пара). | Покрыто тестом T-FLEET-3. |
| R7 | **Топливо как ресурс** — в `planet.resources` уже есть `H`, `U`, но нет «химического топлива» как сущности | Химическое топливо = упрощённо `C + H` (8:2), ксенон = `Xe` (есть в elements), водород = `H`. | В F1: `FuelType = 'chemical' | 'xenon' | 'hydrogen' | 'antimatter'` — маппинг к elementId вынести в `src/data/ships/fuel-map.ts`. |
| R8 | **Сохранение/загрузка новых полей GameState** | Старые сейвы (без `shipDesigns`, `shipyardQueues`, расширенных `Fleet`) ломаются. | В `deserializeGameState` — defensive parsing: `shipDesigns: new Map(raw.shipDesigns ?? [])`, `shipyardQueues: new Map(raw.shipyardQueues ?? [])`. |
| R9 | **Бой (attack) — нет боевой системы** (Etap 4) | `attack` приказ не может быть реально выполнен. | Stub: при `attack` и прибытии в целевую систему эмитится `combat:engaged`, флот переходит в состояние «осаждает» (без реального урона). В UI — тост «Боевая система в разработке (Etap 4)». |

---

## 9. Критерии готовности блока

Блок считается завершённым, когда выполнены ВСЕ пункты:

### 9.1 Функциональные (демонстрируемые)
- [ ] **C1.** Игрок строит верфь (`shipyard`) на medium/large планете.
- [ ] **C2.** Из `BuildingDialog` верфи открывается «Конструктор кораблей».
- [ ] **C3.** В конструкторе выбирается корпус Скаут, обшивка Лёгкая, переносятся модули: ЦПУ-Микро, Ионный двигатель Mk.I, Сканер базовый, Связь Mk.II, Бак ксенона-S, Прыжковый модуль Mk.I, Навигатор Mk.I, Ядерный реактор Mk.I → live-расчёт показывает: масса ≈ 1075 т, скорость ≈ 7.4 км/с, энерго ≈ −2 МВт (профицит), стоимость ≈ 415 у.е.р. (соответствует §10.1).
- [ ] **C4.** `validateShip` блокирует сохранение дизайна без ЦПУ или без двигателя (сообщение об ошибке).
- [ ] **C5.** Дизайн сохраняется (`ships:designed` emit), появляется в списке пресетов.
- [ ] **C6.** Из верфи — «Построить из дизайна» → ставит в `ShipyardQueue`, ресурсы списываются, через 50 тиков появляется `Ship` на орбите планеты (`ships:constructed` emit).
- [ ] **C7.** Создаётся флот из построенного корабля + кнопкой «+ Флот» (`fleet:created` emit).
- [ ] **C8.** На `GalaxyMap` правый клик по соседней системе (доступной через JP) → «Отправить флот» → рисуется линия маршрута, показывается ETA.
- [ ] **C9.** При нажатии «play» (x5) флот движется по маршруту, через расчётное количество тиков — появляется в целевой системе (`ships:arrived`, `fleet:arrived`).
- [ ] **C10.** Флоту можно отдать приказ `colonize` на подходящую (не газовый гигант, не занятую) планету — по прибытии создаётся колония (`economy:planet-colonized`), колониальный модуль тратится.
- [ ] **C11.** Сохранение и загрузка игры сохраняет флоты, дизайны и очереди верфи.

### 9.2 Технические
- [ ] **C12.** Все новые события из §5 добавлены в `events.ts` и эмитятся в коде.
- [ ] **C13.** `ShipsModule` и `FleetModule` зарегистрированы в `getMediatorWithModules()`, manifest-ы корректны (зависимости: `ships: ['economy']`, `fleet: ['ships', 'galaxy']`).
- [ ] **C14.** Lint: 0 ошибок (сохраняется метрика из highlevel_plan).
- [ ] **C15.** Тесты T-FLEET-1…T-FLEET-5 проходят (`npm test` зелёный).
- [ ] **C16.** Документация: разделы `docs/50-ships.md` помечены как «реализовано (MVP)» в `docs/STATUS.md` (если есть) или в новом чекпоинте.

### 9.3 Что НЕ обязательно (отложить на Etap 4)
- Тактический бой, реальный урон, разрушение кораблей в бою.
- Mk.II–Mk.V модулей.
- Тяжёлые корпуса (Крейсер/Линкор/Флагман).
- Адмиральская прогрессия уровней.
- Варп-двигатели (свободные прыжки без JP).
- Маскировка, ЭМИ-щиты, торпеды, ионные пушки, истребительные отсеки.
- Межпланетная логистика через транспортные корабли.

---

## 10. Порядок внедрения внутри блока

```
F1 (типы и данные)
  │
  ├── F2 (конструктор кораблей) ──► UI ship-designer
  │        │
  │        └── F6 (интеграция в экономику) ──► shipyard-queue, постройка
  │                  │
  │                  └── F3 (флот-менеджер) ──► fleet-view, create/merge/split
  │                           │
  │                           └── F4 (приказы) ──► orders.ts, planRoute
  │                                    │
  │                                    └── F5 (перемещение по JP) ──► fleet-engine, processFleetTick
  │                                              │
  │                                              └── F7 (интеграция в store + события) ──► serialize, typed-bus
  │
  └── Тесты пишутся параллельно с каждым шагом (T-FLEET-1..5)
```

**Линейный порядок для одного агента:**
1. F1 (1.5–2 дня) — фундамент.
2. F2 (3 дня) — конструктор + `designer.ts` + тесты T-FLEET-1, T-FLEET-2.
3. F6 (2 дня) — постройка + тест T-FLEET-5.
4. F3 (2 дня) — флот-менеджер.
5. F4 (2.5 дня) — приказы + `planRoute` + тест T-FLEET-3.
6. F5 (3 дня) — movement engine + тест T-FLEET-4.
7. F7 (2 дня) — финальная интеграция, сериализация, оверлей маршрутов.

**Итого:** ~16 рабочих дней (3 недели) — вписывается в оценку «3–4 недели» из `highlevel_plan.md` для Etap 3.0 (флот + исследования).

---

## Изменённые/созданные файлы

### Созданные (новые)
| Путь | Назначение |
|------|-----------|
| `src/data/ships/hulls.ts` | Каталог 4 MVP-корпусов |
| `src/data/ships/modules.ts` | Каталог ~15 MVP-модулей |
| `src/data/ships/fuel-map.ts` | Маппинг `FuelType` → elementId |
| `src/data/ships/shipyard-queue.ts` | `ShipyardQueue` тип + функции |
| `src/data/ships/index.ts` | Экспорты + lookup-мапы |
| `src/ships/designer.ts` | `validateShip`, `calculateDesignStats`, `armorMultiplier` |
| `src/ships/orders.ts` | `planRoute`, `calculateTravelTime`, `executeOrder` |
| `src/ships/fleet-engine.ts` | `processFleetTick`, `advanceFleet`, `consumeFuel`, `completeOrder` |
| `src/ships/ships-module.ts` | `ShipsModule implements IGameModule` |
| `src/ships/fleet-module.ts` | `FleetModule implements IGameModule` |
| `src/ships/index.ts` | Реэкспорты |
| `src/components/game/ship-designer.tsx` | UI конструктора |
| `src/components/game/fleet-view.tsx` | UI менеджера флотов |
| `src/components/game/fleet-orders-panel.tsx` | UI панели приказов |
| `src/components/game/shipyard-dialog.tsx` | UI очереди верфи |
| `src/components/game/fleet-route-overlay.tsx` | SVG-оверлей маршрутов |
| `src/components/game/ship-card.tsx` | Карточка корабля |
| `tests/ships/designer.test.ts` | T-FLEET-1, T-FLEET-2 |
| `tests/ships/orders.test.ts` | T-FLEET-3 |
| `tests/ships/fleet-engine.test.ts` | T-FLEET-4 |
| `tests/ships/shipyard.test.ts` | T-FLEET-5 |

### Изменённые
| Путь | Что меняется |
|------|--------------|
| `src/core/types.ts` | Расширение `HullDef`→`HullType`, `ModuleDef`→`ShipModule`, `Ship`, `Fleet`, `FleetOrder`; новый `ShipDesign`, `SlotType`, `ModuleCategory`, `DamageType`, `FuelType`, `HullArmorThickness`; `GameState.shipDesigns`, `GameState.shipyardQueues` |
| `src/core/events.ts` | + 8 новых событий (см. §5) |
| `src/data/recipes.ts` | + 4 рецепта уровня 4 «module_to_ship» (опционально — если делаем полный крафт) |
| `src/economy/engine.ts` | `processProductionQueue` + branch для `module_to_ship`; экспорт `colonizePlanet` (уже есть) |
| `src/stores/game-store.ts` | + 9 действий (см. F7); `GameView += 'ship-designer' | 'fleet'`; `serializeGameState`/`deserializeGameState` + новые поля; `tick()` + `processFleetTick`; регистрация `ShipsModule`/`FleetModule` в `getMediatorWithModules()` |
| `src/core/game-mediator.ts` | (возможно) регистрация `ShipsModule`/`FleetModule` по умолчанию |
| `src/components/game/game-layout.tsx` | + 2 кнопки в верхнем меню, + 2 view в роутинге |
| `src/components/game/galaxy-map.tsx` | Контекстное меню по правому клику; интеграция `FleetRouteOverlay` |
| `src/components/game/building-dialog.tsx` | Кнопки «Конструктор» и «Очередь» для `shipyard` |
| `src/components/game/planet-view.tsx` | Индикатор верфи + очередь постройки кораблей |
| `src/components/game/resource-panel.tsx` | Строка «Топливо флотов» |
| `package.json` | (опц.) `@dnd-kit/core`, `@dnd-kit/sortable`, `vitest` если ещё нет |

---

> **Конец чекпоинта Блок 2 — Флот и корабли MVP.**
