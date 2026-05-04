# Принцип модульности системы ресурсов

> **Версия:** 1.0  
> **Дата создания:** 2026-05-05  
> **Назначение:** Документ архитектуры кода — описание модульной системы ресурсов SpaceGame: как добавлять новые элементы/руды и как они автоматически интегрируются в производственные цепочки  
> **Зависимости:** [mendeleev.md](./mendeleev.md) (химическая таблица элементов и руд), [ores.md](./ores.md) (расчёты руд — если существует)

---

## Содержание

1. [Введение](#1-введение)
2. [Как добавить новый элемент](#2-как-добавить-новый-элемент)
3. [Как новая руда автоматически вписывается в цепочку](#3-как-новая-руда-автоматически-вписывается-в-цепочку)
4. [Структуры данных](#4-структуры-данных)
5. [Зависимости](#5-зависимости)

---

## 1. Введение

Система ресурсов SpaceGame спроектирована по модульному принципу: добавление нового химического элемента или руды требует минимальных изменений в коде, а все производственные цепочки строятся **автоматически** на основе декларативных определений.

Это означает, что:

- **Новый элемент** добавляется одной записью в массив `ELEMENTS` — и сразу становится доступным для системы ресурсов.
- **Новая руда** добавляется одной записью в `ORE_DEFINITIONS` / `DEEP_ORES` — и автоматически интегрируется во все маппинги и цепочки переработки.
- **Ни одна функция** не требует ручного обновления при расширении таблицы элементов или руд.

Данный документ описывает:
- Пошаговую процедуру добавления нового элемента (§2)
- Механизм автоматической интеграции новых руд в производственные цепочки (§3)
- Ключевые структуры данных в кодовой базе (§4)

---

## 2. Как добавить новый элемент (3 шага)

### Шаг 1: Добавить элемент в таблицу

В файл `src/data/elements.ts` добавить новую запись в массив `ELEMENTS`:

```typescript
// Пример: добавление теллура (Te)
{ id: 'Te', name: 'Теллур', symbol: 'Te', category: 'nonmetal',
  baseValue: 8, density: 6.24, isAtmospheric: false }
```

В `docs/mendeleev.md` добавить описание элемента в соответствующую категорию с:
- Символом, названием, атомным номером и массой
- Категорией в игре
- Описанием применения в космической индустрии
- 2–5 химическими взаимодействиями

### Шаг 2: Создать руду для элемента

В файл `src/data/processing-chains.ts` добавить запись в `ORE_DEFINITIONS` (шахта/карьер) или `DEEP_ORES` (бурильная установка):

```typescript
// Пример: Te-ore из теллурида висмута
{
  id: 'Te-ore', name: 'Теллуровая руда', type: 'metal_ore',
  sourceBuildingId: 'mine',
  containedElements: [
    { elementId: 'Te', yield: 3 },   // 27.6% массовой доли из PbTe
    { elementId: 'Pb', yield: 7 },   // 72.4%
  ],
  minSourceLevel: 1,
  processingBuildingId: 'processor',
  minProcessingLevel: 4,
  processingEnergyCost: 6, processingTime: 300,
  prototype: 'Алтаит (PbTe)',
}
```

В `docs/mendeleev.md` добавить расчёт руды в §3 с полным разбором:
- Химическая формула минерала-прототипа
- Расчёт молярной массы
- Массовые доли
- Выход из 10 ед. руды

### Шаг 3: Создать рецепт переработки

В файл `src/data/recipes.ts` добавить рецепт, использующий новый элемент:

```typescript
// Пример: термоэлектрический генератор из Bi₂Te₃
{
  id: 'thermoelectric_gen',
  name: 'Термоэлектрический генератор',
  inputs: { Bi: 2, Te: 3 },
  buildingId: 'synthesizer',
  minLevel: 5,
  energyCost: 10, time: 400,
}
```

---

## 3. Как новая руда автоматически вписывается в цепочку

При добавлении руды в `processing-chains.ts`:

1. **Маппинг `ORE_FOR_ELEMENT_MAP`** — автоматически создаёт связь «элемент → руда»
2. **Функция `buildElementSourcesMap()`** — автоматически находит все источники элемента (основной + альтернативные)
3. **Функция `getProcessingChain()`** — автоматически строит цепочку «руда → здание переработки → чистый элемент»
4. **Побочные элементы** — если руда содержит несколько элементов (например, CuFeS₂ → Cu + Fe + S), каждый из них автоматически получает эту руду как альтернативный источник

```
Новая руда добавлена в ORE_DEFINITIONS
        │
        ▼
containedElements → каждый элемент получает источник
        │
        ▼
ORE_FOR_ELEMENT_MAP → элемент знает свою основную руду
        │
        ▼
getProcessingChain() → цепочка строится автоматически
        │
        ▼
Рецепт в recipes.ts → элемент используется в производстве
```

### 3.1 Подробное описание автоматических маппингов

#### `ORE_FOR_ELEMENT_MAP`

Справочная таблица, которая определяет **основную** руду для каждого элемента. Заполняется вручную при добавлении нового элемента — одна строка вида `Te: 'Te-ore'`. Используется функцией `buildElementSourcesMap()` для определения, какая руда является primary, а какие — альтернативными.

**Пример содержимого:**

| Элемент | Основная руда | Источник |
|---------|--------------|----------|
| Fe | Fe-ore | Шахта |
| Si | Si-ore | Карьер |
| Y | Y-ore | Глубинная |
| H | H2 | Атмосфера |
| O | O2 | Атмосфера |

#### `buildElementSourcesMap()`

Функция, вызываемая при инициализации модуля. Она:

1. Обходит **все** руды из `ORE_DEFINITIONS`, `DEEP_ORES` и `REFINERY_PROCESSING`
2. Обходит все `ATMOSPHERIC_COMPOUNDS`
3. Обходит все `ICE_COMPOUNDS`
4. Для каждого `containedElement` в каждом источнике создаёт запись о том, что данный элемент можно получить из этого источника
5. Разделяет источники на **primary** (по `ORE_FOR_ELEMENT_MAP`) и **alternative** (все остальные)
6. Возвращает `Map<string, ElementSource>` — полную карту источников для каждого элемента

#### `getProcessingChain(elementId)`

Функция, строящая цепочку переработки:

1. Находит `ElementSource` для элемента в `ELEMENT_SOURCES_MAP`
2. Формирует **Шаг 0** — добыча сырья (buildingId: null, это не переработка)
3. Если нужна переработка (`processingBuildingId !== null`), формирует **Шаг 1** — переработка с указанием здания, уровня и энергозатрат
4. Возвращает `ProcessingChain` с полной информацией о цепочке

#### Побочные элементы

Ключевая особенность системы: **каждая руда может давать несколько элементов**. Например:

- `Cu-ore` (халькопирит CuFeS₂) → **Cu** (primary) + **Fe** (alternative) + **S** (alternative)
- `Ti-ore` (ильменит FeTiO₃) → **Ti** (primary) + **Fe** (alternative) + **O** (alternative)
- `Pt-ore` (ультрамафиты) → **Pt** (primary) + **Fe** + **Ni** + **S** + **O** (все alternative)

Это означает, что строительство шахты на медной руде автоматически даёт игроку доступ к побочным железу и сере — без каких-либо дополнительных действий или записей в коде.

---

## 4. Структуры данных

### 4.1 `ELEMENTS` — массив элементов

**Файл:** `src/data/elements.ts`

```typescript
export const ELEMENTS: ElementDef[] = [
  { id: 'Fe', name: 'Железо', symbol: 'Fe', category: 'structural',
    baseValue: 1, density: 7.87, isAtmospheric: false },
  // ... 55 элементов
];
```

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `string` | Уникальный ID элемента (напр. `'Fe'`, `'H'`, `'Y'`) |
| `name` | `string` | Человекочитаемое название (напр. `'Железо'`) |
| `symbol` | `string` | Химический символ (совпадает с `id`) |
| `category` | `string` | Категория в игре: `structural`, `fuel`, `metal`, `chemical`, `noble`, `rare`, `alkali`, `alkaline_earth`, `halogen`, `nonmetal`, `lanthanide`, `transmetal` |
| `baseValue` | `number` | Базовая стоимость единицы элемента |
| `density` | `number` | Плотность (г/см³) — для расчёта массы грузов |
| `isAtmospheric` | `boolean` | `true` для газов (H, He, O, N) — добываются газовым экстрактором, а не шахтой |

**Производная структура:**
```typescript
export const ELEMENT_MAP = new Map(ELEMENTS.map(e => [e.id, e]));
```

### 4.2 `ORE_DEFINITIONS` / `DEEP_ORES` — массивы руд

**Файл:** `src/data/processing-chains.ts`

```typescript
export const ORE_DEFINITIONS: OreDefinition[] = [ ... ]; // 33 руды (шахта + карьер)
export const DEEP_ORES: OreDefinition[] = [ ... ];        // 18 глубинных руд
```

Тип `OreDefinition`:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | `string` | Уникальный ID руды (напр. `'Fe-ore'`, `'Y-ore'`) |
| `name` | `string` | Человекочитаемое название |
| `type` | `OreType` | `'metal_ore'` \| `'nonmetal_ore'` \| `'gas_compound'` \| `'ice_compound'` \| `'deep_ore'` |
| `sourceBuildingId` | `SourceBuildingId` | Здание добычи: `'mine'` \| `'quarry'` \| `'gas_extractor'` \| `'drilling_rig'` \| `'ice_harvester'` |
| `containedElements` | `ContainedElement[]` | Массив элементов, получаемых из руды, с выходом из 10 ед. |
| `minSourceLevel` | `number` | Минимальный уровень здания добычи |
| `processingBuildingId` | `ProcessingBuildingId` | Здание переработки: `'processor'` \| `'refinery'` \| `'synthesizer'` \| `null` |
| `minProcessingLevel` | `number \| null` | Минимальный уровень здания переработки |
| `processingEnergyCost` | `number` | Энергозатраты на переработку |
| `processingTime` | `number` | Время переработки (тиков) |
| `prototype` | `string?` | Реальный минерал-прототип (напр. `'Гематит (Fe₂O₃)'`) |
| `molarFormula` | `string?` | Химическая формула |
| `molarMass` | `number?` | Молярная масса (г/моль) |

**Дополнительные массивы руд:**

| Константа | Тип | Описание |
|-----------|-----|----------|
| `ATMOSPHERIC_COMPOUNDS` | `AtmosphericCompound[]` | 11 атмосферных газов |
| `ICE_COMPOUNDS` | `IceCompound[]` | 5 ледяных соединений |
| `REFINERY_PROCESSING` | `OreDefinition[]` | 3 альтернативных пути через Очистительный комплекс (Au, Pt, U) |

**Объединённый массив:**
```typescript
const ALL_ORE_DEFS = [...ORE_DEFINITIONS, ...DEEP_ORES, ...REFINERY_PROCESSING];
```

### 4.3 `ORE_FOR_ELEMENT_MAP` — авто-маппинг элемент → руда

**Файл:** `src/data/processing-chains.ts`

```typescript
const ORE_FOR_ELEMENT_MAP: Record<string, string> = {
  // Шахта
  Fe: 'Fe-ore', Si: 'Si-ore', Ti: 'Ti-ore', Al: 'Al-ore',
  Cu: 'Cu-ore', Ni: 'Ni-ore', Cr: 'Cr-ore', W: 'W-ore',
  Co: 'Co-ore', Au: 'Au-ore', Pt: 'Pt-ore', U: 'U-ore',
  Li: 'Li-ore', V: 'V-ore', Mn: 'Mn-ore', Zn: 'Zn-ore',
  Sn: 'Sn-ore', Pb: 'Pb-ore', Mo: 'Mo-ore', Ag: 'Ag-ore',
  Cd: 'Cd-ore', Se: 'Se-ore',
  // Карьер
  C: 'C-ore', S: 'S-ore', K: 'K-ore', B: 'B-ore', F: 'F-ore',
  Mg: 'Mg-ore', P: 'P-ore', Na: 'NaCl', Cl: 'NaCl', Ca: 'CaCO3',
  // Глубинные
  Y: 'Y-ore', Ba: 'Ba-ore', Zr: 'Zr-ore', Be: 'Be-ore',
  In: 'In-ore', Nd: 'Nd-ore', Ce: 'Ce-ore', La: 'La-ore', Dy: 'Dy-ore',
  Ir: 'Ir-ore', Os: 'Os-ore', Ru: 'Ru-ore', Rh: 'Rh-ore',
  Pd: 'Pd-ore', Hf: 'Hf-ore', Ta: 'Ta-ore', Nb: 'Nb-ore', Re: 'Re-ore',
  // Атмосферные (используются напрямую, руда = газ)
  H: 'H2', He: 'He', Ne: 'Ne', Ar: 'Ar', N: 'N2', O: 'O2',
};
```

Определяет **основную** руду для каждого элемента. При добавлении нового элемента нужно добавить одну строку в этот маппинг.

### 4.4 `buildElementSourcesMap()` — функция построения карты источников

**Файл:** `src/data/processing-chains.ts`

Вызывается однократно при инициализации модуля. Алгоритм:

1. Создаёт пустой `Map<string, ElementSource>`
2. Обходит все руды (`ALL_ORE_DEFS`), атмосферные соединения (`ATMOSPHERIC_COMPOUNDS`) и ледяные соединения (`ICE_COMPOUNDS`)
3. Для каждого `containedElement` в каждом источнике:
   - Определяет, является ли источник **primary** (совпадает с `ORE_FOR_ELEMENT_MAP`) или **alternative**
   - Добавляет запись в массив источников элемента
4. Для каждого элемента формирует `ElementSource`:
   - `primarySource` — первый primary-источник (или первый из списка, если primary нет)
   - `alternativeSources` — все остальные источники

**Возвращаемый тип:**

```typescript
interface ElementSource {
  elementId: string;
  primarySource: {
    oreId: string;
    oreName: string;
    sourceBuildingId: SourceBuildingId;
    processingBuildingId: ProcessingBuildingId;
    minProcessingLevel: number | null;
  };
  alternativeSources: {
    oreId: string;
    oreName: string;
    sourceBuildingId: SourceBuildingId;
    processingBuildingId: ProcessingBuildingId;
    minProcessingLevel: number | null;
  }[];
}
```

### 4.5 `getProcessingChain()` — функция построения цепочки переработки

**Файл:** `src/data/processing-chains.ts`

```typescript
export function getProcessingChain(elementId: string): ProcessingChain | null
```

Принимает ID элемента, возвращает полную цепочку переработки или `null` если элемент неизвестен.

**Возвращаемый тип:**

```typescript
interface ProcessingChain {
  elementId: string;
  elementName: string;
  steps: ProcessingStep[];
}

interface ProcessingStep {
  resourceId: string;
  resourceName: string;
  buildingId: ProcessingBuildingId;
  minBuildingLevel: number | null;
  energyCost: number;
}
```

**Пример цепочки для Fe:**

| Шаг | resourceId | buildingId | energyCost |
|-----|-----------|------------|------------|
| 0 — Добыча | Fe-ore | null | 0 |
| 1 — Переработка | Fe | processor | 2 |

**Пример цепочки для H (атмосферный):**

| Шаг | resourceId | buildingId | energyCost |
|-----|-----------|------------|------------|
| 0 — Добыча | H2 | null | 0 |

(Переработка не нужна — водород используется напрямую)

---

## 5. Зависимости

| Документ | Связь |
|----------|-------|
| [mendeleev.md](./mendeleev.md) | Химическая таблица элементов (§2) и расчёты руд (§3) — источник истины для молярных масс и выходов |
| [ores.md](./ores.md) | Детальные расчёты руд и цепочек трансформации (если существует) |
| [04-buildings.md](./04-buildings.md) | Здания добычи и переработки — соответствие ID зданий в коде и в документации |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Общая архитектура экономики (§3.1) |

---

*Документ создан 2026-05-05. Согласовано с `src/data/elements.ts` (55 элементов), `src/data/processing-chains.ts` (33+18+3 руды, 11 газов, 5 льдов).*
