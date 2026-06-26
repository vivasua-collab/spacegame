# Запекание галактики (Galaxy Baking)

> **Версия:** 1.0  
> **Дата создания:** 2026-05-04  
> **Назначение:** Документ, описывающий процесс создания «запечённой» модели галактики — предрасчёт химии, физики и базовых технологий при генерации новой галактики  
> **Зависимости:** [chemistry.md](./chemistry.md), [mendeleev.md](./mendeleev.md), [ores.md](./ores.md), [modularity.md](./modularity.md)

---

## Содержание

1. [Проблема](#1-проблема)
2. [Концепция запекания](#2-концепция-запекания)
3. [Архитектура генератора](#3-архитектура-генератора)
4. [Алгоритм запекания](#4-алгоритм-запекания)
5. [Структуры данных запечённой модели](#5-структуры-данных-запечённой-модели)
6. [Жизненный цикл галактики](#6-жизненный-цикл-галактики)
7. [Правила неизменности](#7-правила-неизменности)
8. [Формат хранения](#8-формат-хранения)
9. [Пример: добавление нового элемента](#9-пример-добавление-нового-элемента)

---

## 1. Проблема

При текущей реализации правила химии (формулы руд, молярные массы, выход элементов) рассчитываются **каждый раз при обращении**. Это создаёт проблемы:

1. **Производительность** — повторные расчёты молярных масс для одних и тех же руд
2. **Непоследовательность** — если изменить параметры элемента, все руды с ним изменятся в существующей игре
3. **Модифицируемость** — игрок не может модифицировать конкретную галактику без влияния на глобальные правила
4. **Детерминированность** — при seed-based генерации все галактики с одним seed идентичны, но если изменить список элементов, все сохранения ломаются

---

## 2. Концепция запекания

**Запекание (Baking)** — процесс предрасчёта всех производных данных на основе базовых свойств элементов при создании новой галактики. Результат — **запечённая модель** (Baked Galaxy Model), неизменная в течение жизни галактики.

### Ключевой принцип

> **Новый элемент может быть добавлен только в новую галактику.**  
> Галактика (химия, физика, наборы базовых технологий) становится **запечённой** для данной галактики.

### Аналогия

Как в кулинарии: ингредиенты (элементы) смешиваются по рецепту (химия), выпекаются (генерация), и результат (галактика) уже нельзя «развернуть» обратно. Если нужен другой пирог — нужно печь заново.

### Что запекается

| Компонент | Источник | Результат запекания |
|-----------|----------|---------------------|
| Список элементов | `ELEMENTS` из кода | Снимок списка элементов на момент генерации |
| Химические характеры | `chemicalCharacter` + `oxidationState` | Закреплённые характеристики |
| Руды | Автогенерация по chemistry.md | Полный набор руд с рассчитанными выходами |
| Атмосферные соединения | Правила из chemistry.md §9 | Набор газов с рассчитанным составом |
| Ледяные соединения | Правила из chemistry.md §9 | Набор льдов с рассчитанным составом |
| Цепочки переработки | На основе руд | Маппинг «элемент → руда → переработка» |
| Самородные элементы | Правила из chemistry.md §8 | Шансы самородков |
| Технологический минимум | Уровни зданий для руд | Минимальные требования для добычи |

### Что НЕ запекается

| Компонент | Почему |
|-----------|--------|
| Планеты | Генерируются из seed + запечённая модель |
| Ресурсы планет | Рассчитываются на основе запечённой модели + seed |
| Технологии | Игрок исследует в процессе игры |
| Экономика | Динамическая, зависит от действий игрока |

---

## 3. Архитектура генератора

```
                    ┌─────────────────────────────┐
                    │      ELEMENTS (из кода)      │
                    │  id, name, mass, category,   │
                    │  chemicalCharacter,           │
                    │  oxidationState, rarity       │
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │   chemistry.md (правила)     │
                    │   §4  — шаблоны руд          │
                    │   §5  — здание → тип руды    │
                    │   §6  — переработка          │
                    │   §7  — энергозатраты        │
                    │   §8  — самородки            │
                    │   §9  — атмосфера / лёд      │
                    │   §11 — алгоритм автогенер.  │
                    └──────────────┬────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │  ChemistryGenerator          │
                    │  (src/data/chemistry-         │
                    │   generator.ts)              │
                    │                              │
                    │  Вход: ELEMENTS[]             │
                    │  Выход: BakedGalaxyModel      │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
        ┌───────────────────┐         ┌────────────────────┐
        │ BakedGalaxyModel  │         │  Galaxy Generator  │
        │ (в памяти / файл) │◄───────│  (seed-based)      │
        │                   │         │  использует        │
        │ • elements[]      │         │  BakedGalaxyModel  │
        │ • ores[]          │         │  для генерации     │
        │ • atmospherics[]  │         │  ресурсов планет   │
        │ • ices[]          │         └────────────────────┘
        │ • chains[]        │
        │ • nativeChances   │
        │ • techMinimum     │
        └───────────────────┘
```

---

## 4. Алгоритм запекания

### Шаг 1: Снимок элементов

```
bakedElements = ELEMENTS.map(e => ({
  ...e,
  // Фиксируем все свойства элемента на момент генерации
  atomicNumber: e.atomicNumber,
  atomicMass: e.atomicMass,
  chemicalCharacter: e.chemicalCharacter,
  oxidationState: e.oxidationState,
  rarity: e.rarity,
}))
```

### Шаг 2: Автогенерация руд

Для каждого элемента, у которого `chemicalCharacter !== 'gas' && chemicalCharacter !== 'transuranic'`:

1. Определить тип руды и здание добычи по chemistry.md §5
2. Выбрать формулу минерала-прототипа по chemistry.md §4
3. Рассчитать молярную массу: `M = Σ(nᵢ × Mᵢ)`
4. Рассчитать выход: `outputᵢ = 10 × (nᵢ × Mᵢ) / M`
5. Назначить переработку по chemistry.md §6
6. Рассчитать энергозатраты по chemistry.md §7
7. Определить самородный шанс по chemistry.md §8

### Шаг 3: Атмосферные соединения

Для элементов с `chemicalCharacter === 'gas'`:

1. Определить чистые газы (H₂, He, Ne, Ar, N₂, O₂) — выход 10:1
2. Определить сложные газы (CO₂, CH₄, NH₃, H₂S, SO₂) — рассчитать по молярной массе
3. Заполнить матрицу доступности по типам атмосферы

### Шаг 4: Ледяные соединения

Для атмосферных газов с температурными порогами замерзания:

1. Создать ледяные аналоги с теми же расчётами выхода
2. Добавить температурные условия добычи

### Шаг 5: Цепочки переработки

Для каждого элемента:

1. Найти основную руду
2. Найти альтернативные источники (руда содержит элемент как побочный)
3. Построить цепочку: руда → здание переработки → чистый элемент

### Шаг 6: Технологический минимум

Рассчитать минимальные требования:

- Уровень здания добычи для каждого элемента
- Уровень здания переработки для каждой руды
- Связи с технологическим деревом

---

## 5. Структуры данных запечённой модели

```typescript
/** Запечённая модель галактики — неизменна после генерации */
export interface BakedGalaxyModel {
  /** Версия алгоритма запекания (для миграции) */
  version: number;
  /** Дата генерации */
  createdAt: string; // ISO 8601
  /** Seed галактики */
  seed: number;
  /** Снимок элементов на момент генерации */
  elements: BakedElement[];
  /** Сгенерированные руды (шахта + карьер + глубинные) */
  ores: BakedOre[];
  /** Атмосферные соединения */
  atmosphericCompounds: BakedAtmospheric[];
  /** Ледяные соединения */
  iceCompounds: BakedIce[];
  /** Цепочки переработки */
  processingChains: BakedProcessingChain[];
  /** Шансы самородков */
  nativeChances: Record<string, number>;
  /** Маппинг: элемент → ID основной руды */
  elementToOre: Record<string, string>;
  /** Маппинг: элемент → все источники (руда + атм. + лёд) */
  elementSources: Record<string, BakedElementSource>;
}

/** Снимок элемента на момент генерации */
export interface BakedElement {
  id: string;
  name: string;
  symbol: string;
  category: ElementCategory;
  atomicNumber: number;
  atomicMass: number;
  chemicalCharacter: ChemicalCharacter;
  oxidationState: number;
  rarity: ElementRarity;
  baseValue: number;
  density: number;
  isAtmospheric: boolean;
}

/** Химический характер элемента */
export type ChemicalCharacter =
  | 'reactive_metal'
  | 'noble_metal'
  | 'refractory_metal'
  | 'platinoid'
  | 'rare_earth'
  | 'alkali'
  | 'alkaline_earth'
  | 'reactive_nonmetal'
  | 'halogen'
  | 'gas'
  | 'transuranic';

/** Редкость элемента */
export type ElementRarity = 'abundant' | 'common' | 'rare' | 'ultra_rare';

/** Запечённая руда */
export interface BakedOre {
  id: string;
  name: string;
  type: OreType;
  sourceBuildingId: SourceBuildingId;
  containedElements: ContainedElement[];
  minSourceLevel: number;
  processingBuildingId: ProcessingBuildingId;
  minProcessingLevel: number | null;
  processingEnergyCost: number;
  processingTime: number;
  prototype: string;
  molarFormula: string;
  molarMass: number;
  /** Элемент, для которого эта руда является основной */
  primaryElement: string;
  /** Химический характер первичного элемента */
  chemicalCharacter: ChemicalCharacter;
}

/** Запечённое атмосферное соединение */
export interface BakedAtmospheric {
  id: string;
  name: string;
  formula: string;
  containedElements: ContainedElement[];
  atmosphereTypes: AtmosphereType[];
  processingBuildingId: ProcessingBuildingId;
  minProcessingLevel: number | null;
  processingEnergyCost: number;
  processingTime: number;
}

/** Запечённое ледяное соединение */
export interface BakedIce {
  id: string;
  name: string;
  formula: string;
  containedElements: ContainedElement[];
  maxTemp: number;
  processingBuildingId: ProcessingBuildingId;
  minProcessingLevel: number | null;
  processingEnergyCost: number;
  processingTime: number;
}

/** Запечённая цепочка переработки */
export interface BakedProcessingChain {
  elementId: string;
  steps: BakedProcessingStep[];
}

export interface BakedProcessingStep {
  resourceId: string;
  resourceName: string;
  buildingId: ProcessingBuildingId;
  minBuildingLevel: number | null;
  energyCost: number;
}

/** Источник элемента в запечённой модели */
export interface BakedElementSource {
  elementId: string;
  primaryOreId: string;
  primarySourceBuilding: SourceBuildingId;
  alternativeOreIds: string[];
  atmosphericIds: string[];
  iceIds: string[];
  nativeChance: number;
}
```

---

## 6. Жизненный цикл галактики

```
Новая игра
    │
    ├── Игрок выбирает seed
    │
    ▼
Генерация запечённой модели
    │   ChemistryGenerator.bake(seed, ELEMENTS)
    │
    │   ─── Создаётся BakedGalaxyModel ───
    │   • Элементы зафиксированы
    │   • Руды сгенерированы и рассчитаны
    │   • Атмосферные/ледяные соединения готовы
    │   • Цепочки переработки построены
    │
    ▼
Генерация галактики
    │   GalaxyGenerator.generate(seed, bakedModel)
    │
    │   ─── Создаётся Galaxy ───
    │   • Планеты получают ресурсы из bakedModel
    │   • Состав руд — из запечённых данных
    │   • Не нужно пересчитывать химию
    │
    ▼
Геймплей
    │   Все расчёты используют bakedModel
    │   • Добыча: руда → bakedModel.ores[id]
    │   • Переработка: цепочка → bakedModel.processingChains[elementId]
    │   • Атмосфера: газ → bakedModel.atmosphericCompounds[id]
    │
    ▼
Сохранение
    │   bakedModel сохраняется вместе с GameState
    │   • В SQLite (сериализация JSON)
    │   • Или в отдельный файл baked-model.json
    │
    ▼
Загрузка
    │   Восстановление bakedModel из сохранения
    │   • Все данные идентичны моменту генерации
    │   • Не зависит от изменений в ELEMENTS
```

---

## 7. Правила неизменности

### 7.1 Что нельзя изменить после запекания

| Что | Почему |
|-----|--------|
| Список элементов | Руды рассчитаны для конкретного набора |
| Химические характеры | Определяют тип руды |
| Степени окисления | Определяют формулу минерала |
| Атомные массы | Используются в расчётах молярной массы |
| Выход элементов из руд | Рассчитан по молярной массе |
| Здания добычи/переработки | Привязаны к химическому характеру |

### 7.2 Что можно изменить после запекания

| Что | Почему |
|-----|--------|
| Балансные множители | Не влияют на структуру |
| Энергозатраты переработки | Могут быть пересчитаны |
| Время переработки | Балансовый параметр |
| Минимальные уровни зданий | Балансовый параметр |
| Цены элементов | Экономический баланс |

### 7.3 Добавление нового элемента

```
Хотим добавить галлий (Ga):
    │
    ├── Текущая галактика? → НЕЛЬЗЯ!
    │   Ga не входит в bakedModel.elements
    │   Нет Ga-руды, нет цепочки переработки
    │
    └── Новая галактика? → МОЖНО!
        Ga добавляется в ELEMENTS в коде
        → ChemistryGenerator.bake() создаст Ga-руду
        → Новая запечённая модель включает Ga
```

---

## 8. Формат хранения

### 8.1 В памяти

`BakedGalaxyModel` хранится в Zustand-сторе как часть `GameState`:

```typescript
interface GameState {
  // ... существующие поля
  bakedModel: BakedGalaxyModel;
}
```

### 8.2 В базе данных

Запечённая модель сериализуется в JSON и хранится в таблице `GameSave`:

```prisma
model GameSave {
  id        String   @id @default(cuid())
  name      String
  seed      Int
  state     String   // JSON: GameState (включая bakedModel)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 8.3 В отдельном файле (опционально)

При больших размерах модели можно хранить отдельно:

```
saves/
  ├── save_abc123.json          // GameState (без bakedModel)
  └── baked_abc123.json         // BakedGalaxyModel
```

---

## 9. Пример: добавление нового элемента

### Сценарий: добавление галлия (Ga) в версию 2.0

**Шаг 1: Добавить элемент в код**

```typescript
// src/data/elements.ts
{ id: 'Ga', name: 'Галлий', symbol: 'Ga', category: 'metal',
  atomicNumber: 31, atomicMass: 69.7,
  chemicalCharacter: 'reactive_metal', oxidationState: 3,
  rarity: 'common', baseValue: 5, density: 5.91,
  isAtmospheric: false }
```

**Шаг 2: Запустить новую галактику**

```
Новая игра → seed: 12345
    │
    ▼
ChemistryGenerator.bake(12345, ELEMENTS)
    │
    │   Для Ga:
    │   • chemicalCharacter = 'reactive_metal'
    │   • oxidationState = +3
    │   • → Формула: Ga₂O₃ (оксид)
    │   • → Здание: mine
    │   • → M(Ga₂O₃) = 2×69.7 + 3×16.0 = 187.4
    │   • → w(Ga) = 139.4/187.4 = 74.4%, w(O) = 25.6%
    │   • → Выход: Ga≈7.4, O≈2.6
    │   • → Переработка: processor, ур.2
    │   • → Энергия: 4, время: 200
    │
    ▼
BakedGalaxyModel {
  elements: [..., { id: 'Ga', ... }],
  ores: [..., {
    id: 'Ga-ore', primaryElement: 'Ga',
    molarFormula: 'Ga₂O₃', molarMass: 187.4,
    containedElements: [
      { elementId: 'Ga', yield: 7.4 },
      { elementId: 'O', yield: 2.6 }
    ],
    ...
  }],
  ...
}
```

**Шаг 3: Старая галактика не затронута**

```
Сохранение от seed: 99999
    │
    ▼
Загрузка bakedModel из сохранения
    │
    │   Ga отсутствует в bakedModel.elements
    │   Нет Ga-руды, нет цепочки
    │   Ga просто не существует в этой галактике
    │
    ▼
Игра продолжается без Ga
```

---

## Приложение: Сравнение подходов

| Аспект | Без запекания | С запеканием |
|--------|--------------|-------------|
| Добавление элемента | Влияет на все сохранения | Только новая галактика |
| Изменение массы | Ломает все руды | Не влияет на существующие |
| Производительность | Расчёт при каждом обращении | Предрасчёт один раз |
| Детерминированность | Зависит от версии кода | Зависит от seed + версии запекания |
| Размер сохранения | Меньше | Больше (+bakedModel) |
| Совместимость сохранений | Хрупкая | Надёжная |

---

*Документ создан 2026-05-04 (v1.0). Согласовано с [chemistry.md](./chemistry.md), [modularity.md](./modularity.md), [ores.md](./ores.md), [mendeleev.md](./mendeleev.md).*
