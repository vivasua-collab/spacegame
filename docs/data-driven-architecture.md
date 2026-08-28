# Data-driven архитектура хранения данных

> **Архитектурный документ.** Описывает модульную систему хранения статических игровых данных во внешних человекочитаемых JSON-файлах с тонкими TS-loader'ами, валидаторами и общей бонус-системой.
>
> **Создан:** 2026-08-28 (R-SHIPS-DATA)
> **Версия:** 1.0
> **Статус:** ✅ Реализовано для buildings (R-BLD-MOD), research (R-RES), ships (R-SHIPS-DATA)
> **Зависимости:** [00-ARCHITECTURE.md](./00-ARCHITECTURE.md), [03-project-structure.md](./03-project-structure.md), [40-buildings.md](./40-buildings.md) §R-BLD-MOD, [50-ships.md](./50-ships.md) §11, [60-research.md](./60-research.md), [architecture/modular-bus.md](./architecture/modular-bus.md), [modularity.md](./modularity.md)

---

## Содержание

1. [Принцип data-driven хранения](#1-принцип-data-driven-хранения)
2. [Реализованные каталоги](#2-реализованные-каталоги)
3. [Паттерн тонкого TS-loader'а](#3-паттерн-тонкого-ts-loaderа)
4. [Общая бонус-система (Bonus interface)](#4-общая-бонус-система-bonus-interface)
5. [Валидаторы каталогов](#5-валидаторы-каталогов)
6. [DATA-DRIVEN расширение (как добавить новую сущность)](#6-data-driven-расширение-как-добавить-новую-сущность)
7. [Совместимость с кодом](#7-совместимость-с-кодом)

---

## 1. Принцип data-driven хранения

### 1.1 Мотивация

До рефакторинга статические игровые данные (списки зданий, модулей, корпусов, технологий) хранились как **inline TypeScript-массивы** в `*.ts`-файлах. Это создавало три проблемы:

1. **Неудобство редактирования** — изменения данных требовали правок TS-кода, риск сломать импорты/типы; нельзя редактировать без TypeScript-окружения.
2. **Жёсткая структура** — добавление новой сущности (здание/модуль/технология) требовало не только добавления записи, но и проверки, что код её отображает; никаких «бесконечных» расширений без кодирования.
3. **Дублирование semantics** — прекод-хардкод вроде `if (b.id === 'synthesizer' || b.id === 'refinery')` для определения tech-gate был размазан по engine и UI; не было единого data-driven источника истины.

Решение — **вынести все статические каталоги в человекочитаемые JSON-файлы**, оставив TS только тонкими loader'ами (импорт + типизация + lookup-мапы). Runtime-логика (validate, plan, process, calc) живёт отдельно, в `src/ships/`, `src/economy/`, `src/research/`, `src/galaxy/`.

### 1.2 Архитектура

```
                ┌─────────────────────────────────────────┐
                │     Человекочитаемые JSON-файлы        │
                │   (источник истины, редактируется без  │
                │    TypeScript-окружения, с комментария-│
                │    ми в поле "comment")                │
                └──────────────┬──────────────────────────┘
                               │ import (resolveJsonModule:true)
                               ▼
                ┌─────────────────────────────────────────┐
                │      Тонкие TS-loader'ы (*.ts)         │
                │   (каст через unknown к типам из       │
                │    core/types.ts; строят lookup-мапы)   │
                └──────────────┬──────────────────────────┘
                               │ типизированный API + Map<id,T>
                               ▼
                ┌─────────────────────────────────────────┐
                │  Потребители (engine + UI + tests)    │
                │   (10+ файлов на каждый каталог)      │
                └─────────────────────────────────────────┘

                ┌─────────────────────────────────────────┐
                │      Валидаторы (scripts/)             │
                │  (проверка целостности данных:         │
                │   уникальность ID, типы полей, ссылки  │
                │   на TECH_MAP, согласованность мап)    │
                └─────────────────────────────────────────┘
```

### 1.3 Принципы

1. **JSON — источник истины.** Все статические данные лежат в `*.json`. `.ts`-файлы не содержат массивов данных, только thin-loader boilerplate.
2. **TS — типобезопасный API.** Loader кастерует JSON к типам из `core/types.ts` (через `unknown` — TS не может напрямую вывести `string[]` vs `BuildingLayer[]`/`HullArmorThickness[]`).
3. **Lookup-мапы предвычисляются в loader'е** (`BUILDING_MAP`, `HULL_MAP`, `MODULE_MAP`, `TECH_MAP`) для O(1) поиска по id.
4. **Поле `"comment"`** в JSON (опционально) содержит человекочитаемое описание формата и semantics — игнорируется кодом, но помогает редактору.
5. **Runtime-логика НЕ в JSON.** Функции очереди (`processShipyardTick`), валидации (`validateShip`), расчёта статов (`calculateDesignStats`) — в отдельных `.ts`-файлах; они потребляют данные, но не являются данными.
6. **DATA-DRIVEN расширение.** Добавление записи в JSON = автоматическое появление в UI/engine/справочнике. Никаких правок кода не требуется.

---

## 2. Реализованные каталоги

### 2.1 Buildings (R-BLD-MOD, 2026-08-28)

| Файл | Что содержит | Записей |
|------|--------------|---------|
| `src/data/buildings/surface.json` | Здания поверхности планеты (гекс-сетка) + атмосферы газ. гигантов | 14 |
| `src/data/buildings/orbit.json` | Орбитальные слоты вокруг планеты | 1 (spaceport) |
| `src/data/buildings/space.json` | Глубокий космос / вокруг звезды (post-MVP stub) | 2 (starlift_collector, deep_space_sensor) |

**Поля записи** (`BuildingDef` в `core/types.ts`): `id`, `name`, `description`, `category`, `layer[]`, `size[]`, `energyConsumption`, `baseProductionTime`, `levels`, `costPerLevel`, `terrainBonus`, `requiresAtmosphere`, опционально `requiresTechs[]`, `terrainTypes[]`, `bonuses[]`, специализация переработчиков.

**Особенность:** разделение по **слою размещения** (surface/orbit/space) — каждый файл соответствует физическому месту, где строится здание. Loader (`buildings/index.ts`) мержит все 3 файла в единый `BUILDINGS` массив (порядок surface→orbit→space) и строит `BUILDING_MAP`.

**Подробнее:** [40-buildings.md](./40-buildings.md) + checkpoint `audit_2026_08_28_07_modular_buildings.md`.

### 2.2 Research (R-RES, 2026-08-28)

| Файл | Что содержит | Записей |
|------|--------------|---------|
| `src/data/research/techs.json` | Технологии (15 в MVP, data-driven «infinite research») | 15 |
| `src/data/research/fundamentals.json` | Фундаментальные ветки | 6 |
| `src/data/research/branch-links.json` | Связи между ветками | 8 |
| `src/data/research/tech-unlocks.json` | Что открывают технологии (Record<techId, TechUnlock[]>) | stub |
| `src/data/research/bonuses.json` | Реестр бонусов | stub |

**Поля записи Technology** (`Technology` в `core/types.ts`): `id`, `name`, `nameEn`, `branch`, `baseCost`, `maxLevel`, `improvementType`, `improvementPerLevel`, `prerequisites[]` (зависимости!), `effects[]` (bonuses), `description`, `icon`, `sortOrder`.

**Особенность:** R-RES добавил **очередь исследований** (active tech + queue) вместо модели прямого списания RP. Окно дерева авто-масштабируется под количество технологий.

**Подробнее:** [60-research.md](./60-research.md) + checkpoint `audit_2026_08_28_06_research_redesign.md`.

### 2.3 Ships (R-SHIPS-DATA, 2026-08-28)

| Файл | Что содержит | Записей |
|------|--------------|---------|
| `src/data/ships/hulls.json` | Корпуса кораблей MVP | 4 (Скаут/Истребитель/Фрегат/Транспорт) |
| `src/data/ships/modules.json` | Модули кораблей Mk.I | 20 (2 engine + 5 control + 1 life_support + 2 weapon + 2 defense + 8 auxiliary) |
| `src/data/ships/fuel-map.json` | Маппинг `FuelType ↔ elementId` + стоимость конверсии | 4 FuelType + 3 elementId reverse + 4 cost-per-unit |

**Поля HullType** (`core/types.ts`): `id`, `name`, `size`, `totalHS`, `baseHP`, `baseMass`, `weaponSlots/engineSlots/systemSlots/defenseSlots`, `baseCost`, `requiredEngineeringLevel`, `requiredShipyardLevel`, `armorOptions[]`.

**Поля ShipModule** (`core/types.ts`): `id`, `name`, `category`, `size`, `mass`, `energyConsumption`, `cost`, `techLevel`, `requiredTechs[]`, `slotRestriction`, + per-category optional (thrust/fuelType для engine, controlType/minHull для control, weaponType/damage/range для weapon, defenseType/shieldHP для defense, auxiliaryType/capacity для auxiliary, bonuses[]).

**Особенность:** `src/data/ships/shipyard-queue.ts` — это **runtime-логика очереди постройки**, а не данные; он остаётся `.ts`. Валидация дизайна корабля — `src/ships/designer.ts`.

**Подробнее:** [50-ships.md](./50-ships.md) §11.

---

## 3. Паттерн тонкого TS-loader'а

Все тонкие loader'ы следуют одному паттерну. Пример (`src/data/ships/hulls.ts`):

```typescript
import type { HullType } from '@/core/types';
import hullsData from './hulls.json';

type HullsFile = { comment?: string; hulls: HullType[] };

// Каст через unknown: TS не может напрямую скастить JSON-inferred типы
// к HullType[] из-за string[] vs HullArmorThickness[]
export const HULLS: HullType[] = (hullsData as unknown as HullsFile).hulls;

export const HULL_MAP = new Map<string, HullType>(HULLS.map((h) => [h.id, h]));

export function getHull(id: string): HullType | undefined {
  return HULL_MAP.get(id);
}

export function listHulls(): HullType[] {
  return HULLS;
}
```

### 3.1 Зачем каст через `unknown`?

TypeScript с `resolveJsonModule: true` умеет импортировать JSON, но выводит **литеральные строковые типы** (`"scout"`, `"fighter"`, ...). Строгие интерфейсы требуют **union-типов** (`HullSize = 'scout' | 'fighter' | ...`). Прямое присваивание вызывает TS-ошибку несовместимости. Каст через `unknown` обходит это: `json as unknown as ExpectedType` — TS доверяет программисту, а валидатор (`scripts/validate-*.ts`) проверяет на CI, что данные реально соответствуют типам.

### 3.2 Публичный API сохраняется

Главное правило миграции в data-driven формат: **публичный API тонкого loader'а должен совпадать со старым inline-TS-модулем**, чтобы все потребители продолжали работать без правок импортов.

Для buildings это: `BUILDINGS`, `BUILDING_MAP`, `CATEGORY_NAMES`, `CATEGORY_ICONS`, `LAYER_NAMES`, `areBuildingTechsMet`.
Для ships это: `HULLS`, `HULL_MAP`, `getHull`, `listHulls`, `SHIP_MODULES`, `MODULE_MAP`, `getModule`, `listModulesByCategory`, `listModulesForHull`, `FUEL_TO_ELEMENT`, `ELEMENT_TO_FUEL`, `FUEL_ELEMENT_COST_PER_UNIT`, `ALL_FUEL_TYPES`, `emptyFuelStore`.
Для research это: `TECH_TREE`, `TECH_MAP`, `STARTER_TECH_IDS`, `BRANCH_COLORS`, `FUNDAMENTAL_BRANCHES`, `FUNDAMENTAL_BRANCHES_MVP`, `FUNDAMENTAL_BRANCH_MAP`, `BRANCH_LINKS`, `TECH_UNLOCKS`.

---

## 4. Общая бонус-система (Bonus interface)

Единый интерфейс `Bonus` в `core/types.ts` (R-RES §E + R-BLD-MOD расширение) используется тремя каталогами:

```typescript
export interface Bonus {
  target: string;                          // метрика (energy_output, research_rate, ship_thrust, extraction_rate, ...)
  operation: 'add' | 'multiply' | 'threshold';
  value: number;
  perLevel?: boolean;                       // для building-sourced: value × buildingLevel
  source?: string;                          // id источника (для отладки)
  // ─── tech-sourced расширение (R-BLD-MOD) ───
  sourceTech?: string;                      // id технологии-источника
  minTechLevel?: number;                    // порог активации (default 1)
  perTechLevel?: boolean;                   // value × (techLevel - minTechLevel + 1)
}
```

### 4.1 Два источника бонуса

| Источник | Условие | Масштабирование | Где определено |
|----------|---------|-----------------|----------------|
| **Building-sourced** (нет `sourceTech`) | Всегда применяется, если здание построено | `perLevel: true` → `value × buildingLevel` | `BuildingDef.bonuses[]` |
| **Tech-sourced** (`sourceTech` задан) | Только если `researched[sourceTech] >= minTechLevel` | `perTechLevel: true` → `value × (techLevel - minTechLevel + 1)` | `BuildingDef.bonuses[]` ИЛИ `Technology.effects[]` |

### 4.2 Примеры

**Building-sourced (лаборатория)** — `laboratory` даёт `+0.02` к `research_rate` за уровень здания:

```json
{
  "target": "research_rate",
  "operation": "add",
  "value": 0.02,
  "perLevel": true,
  "source": "laboratory"
}
```

**Tech-sourced (лаборатория × микроэлектроника)** — лаборатория также даёт `+3%` к `research_rate` за уровень технологии `microelectronics` начиная с L3:

```json
{
  "target": "research_rate",
  "operation": "add",
  "value": 0.03,
  "sourceTech": "microelectronics",
  "minTechLevel": 3,
  "perTechLevel": true,
  "source": "laboratory_tech_microelectronics"
}
```

При L3 microelectronics: вклад = `0.03 × (3 - 3 + 1) = 0.03`. При L5: `0.03 × 3 = 0.09`.

**Module-sourced (ионный двигатель)** — `engine_ion_mk1` даёт `×1.10` к `ship_thrust`:

```json
{
  "target": "ship_thrust",
  "operation": "multiply",
  "value": 1.10,
  "source": "engine_ion_mk1"
}
```

**Tech-sourced на space-здании (Звёздный лифт-сборщик)** — бонус к `extraction_rate` от `fusion_reactor >= 5`:

```json
{
  "target": "extraction_rate",
  "operation": "add",
  "value": 0.10,
  "sourceTech": "fusion_reactor",
  "minTechLevel": 5,
  "perTechLevel": true
}
```

### 4.3 Резолвер бонусов

`src/research/bonus-resolver.ts` — pure function `resolveBonuses(state, target)`:

```
result = (1 + Σ add) × Π multiply
```

Источники бонусов (для зданий): `state.researchState.researched` (для проверки `sourceTech`-порогов) + все построенные здания на планете (hexes + atmosphericSlots + orbitSlots) с их `buildingLevel`. Бонусы модулей кораблей разрешаются в `src/ships/designer.ts` (для дизайна) и `src/ships/fleet-engine.ts` (для runtime-флота).

---

## 5. Валидаторы каталогов

Каждый каталог имеет собственный валидатор в `scripts/`:

| Команда | Скрипт | Что проверяет |
|---------|--------|---------------|
| `bun run validate:recipes` | `scripts/validate-recipes.ts` | Целостность рецептов крафта (75 рецептов) |
| `bun run validate:buildings` | `scripts/validate-buildings.ts` | 17 зданий: уникальность ID, layer/category/size/terrain валидность, ссылки requiresTechs на TECH_MAP, корректность bonuses |
| `bun run validate:ships` | `scripts/validate-ships.ts` | 4 корпуса + 20 модулей + fuel-map: уникальность ID, валидность всех per-category полей, ссылки requiredTechs, корректность bonuses, согласованность fuel-map |
| `bun run validate:all` | — | Запускает все три подряд |

Валидаторы запускаются на CI / перед коммитом. Они — **первая линия защиты** от неконсистентных данных (поскольку TS-каст через `unknown` не проверяет семантику, только структуру).

### 5.1 Что НЕ проверяют валидаторы

- Баланс игры (масса/тяга/HP/стоимость) — это дизайн-решение, валидируется тестами типа T-FLEET-1.
- Ссылки `costPerLevel` на elementId — это делает `validate:recipes` косвенно.
- Семантическую корректность (например, «газовый экстрактор должен иметь `requiresAtmosphere: true`»).

---

## 6. DATA-DRIVEN расширение (как добавить новую сущность)

### 6.1 Добавить новое здание

1. Открыть `src/data/buildings/surface.json` (или `orbit.json` / `space.json` в зависимости от слоя).
2. Скопировать существующую запись того же `category` как шаблон.
3. Изменить `id`, `name`, `description`, числовые поля.
4. Если здание требует технологий — добавить `requiresTechs: [{ "techId": "...", "minLevel": N }]`.
5. Если здание даёт бонусы — добавить `bonuses: [...]` (см. §4).
6. Сохранить. Здание автоматически появится:
   - В UI постройки (`building-dialog.tsx`) — если слой соответствует открытому слоту планеты.
   - В справочнике (`reference-dialog → Здания`).
   - В bonus-resolver (если есть `bonuses`).
   - В engine (`buildOnHex`/`buildOnAtmosphereSlot`/`buildOnOrbitSlot`) — если `layer` подходит.

Никаких правок кода не требуется.

### 6.2 Добавить новый модуль корабля

1. Открыть `src/data/ships/modules.json`.
2. Скопировать существующую запись того же `category` как шаблон.
3. Изменить `id`, `name`, `size`, `mass`, `cost`, per-category поля (`thrust`/`damage`/`shieldHP`/...).
4. Если модуль требует технологий — заполнить `requiredTechs: ["techId1", ...]` (MVP: tech-gate отключён, но список нужен для будущего).
5. Если модуль даёт бонусы — добавить `bonuses: [...]`.
6. Сохранить. Модуль автоматически появится:
   - В палитре конструктора кораблей (`ship-designer.tsx`) по категории.
   - В справочнике (`reference-dialog → Флот`).
   - В `MODULE_MAP` (O(1) поиск).
   - В валидаторе `validate:ships` (теперь его нужно прогнать).

### 6.3 Добавить новый тип топлива

1. Открыть `src/data/ships/fuel-map.json`.
2. Добавить запись в `fuelToElement`, `elementToFuel`, `fuelElementCostPerUnit` и `allFuelTypes` (согласованно!).
3. Сохранить. Топливо автоматически подхватится в `emptyFuelStore()` (нужно добавить ключ в функцию — это единственное место, где данные не полностью data-driven; TODO Etap 4: генерировать emptyFuelStore из `ALL_FUEL_TYPES`).

### 6.4 Добавить новую технологию

1. Открыть `src/data/research/techs.json`.
2. Скопировать существующую запись.
3. Изменить `id`, `name`, `branch`, `baseCost`, `maxLevel`, `prerequisites[]`, `effects[]`.
4. Сохранить. Технология автоматически появится в дереве исследований (canvas авто-масштабируется) и в `TECH_MAP`.

---

## 7. Совместимость с кодом

### 7.1 Обратная совместимость

Миграция в data-driven формат **сохраняет публичный API** каждого каталога. Все 10+ потребителей (UI компоненты, engine, tests) продолжают импортировать `@/data/buildings`, `@/data/ships`, `@/data/research/*` без правок.

### 7.2 resolveJsonModule

`tsconfig.json` имеет `"resolveJsonModule": true` — это позволяет импортировать `.json`-файлы как ES-модули с автогенерёнными типами.

### 7.3 Хранение `.json`-файлов в Next.js

`.json`-файлы в `src/data/` обрабатываются Bun (тесты) и Next.js (рендер) одинаково — как обычные ES-модули. Никакой special-cfg не требуется.

### 7.4 Жирные vs тонкие файлы

| Тип файла | Размер | Назначение |
|-----------|--------|------------|
| `*.json` | Большой (200–2000+ строк) | Человекочитаемые данные; редактируются без TS-окружения |
| `*.ts` loader | ~30–80 строк | Импорт + каст + lookup-мапа; boilerplate |
| `*.ts` logic | 100–500+ строк | Runtime-функции (validate, plan, process, calc) |

---

## 8. Дорожная карта расширений

### 8.1 Уже реализовано

- ✅ Buildings (R-BLD-MOD) — 17 зданий, 3 слоя, requiresTechs, terrainTypes, building-sourced + tech-sourced bonuses.
- ✅ Research (R-RES) — 15 технологий + 6 фундаменталов + branch-links + tech-unlocks + active research + queue.
- ✅ Ships (R-SHIPS-DATA) — 4 корпуса + 20 модулей + fuel-map.

### 8.2 TODO / Etap 4

- ⏳ **Recipes → JSON** — `src/data/recipes.ts` (75 рецептов) сейчас inline TS; миграция в `recipes.json` + тонкий loader по тому же паттерну.
- ⏳ **Elements → JSON** — `src/data/elements.ts` (60 элементов) inline TS.
- ⏳ **Ore definitions → JSON** — `src/data/chemistry/ore-specs.ts` + `processing-chains.ts` inline TS.
- ⏳ **Empty fuel store data-driven** — `emptyFuelStore()` сейчас hardcode'ит 4 ключа; должна генерироваться из `ALL_FUEL_TYPES`.
- ⏳ **AI catalog** (Etap 3.5) — `src/data/ai/factions.json` + loader.
- ⏳ **Combat catalog** (Etap 4) — `src/data/combat/weapons.json` (или расширение ships/modules.json).

---

> **Конец документа data-driven-architecture.md**
