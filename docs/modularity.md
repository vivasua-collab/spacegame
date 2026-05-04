# Принцип модульности системы ресурсов

> **Версия:** 2.0  
> **Дата создания:** 2026-05-04  
> **Дата обновления:** 2026-05-04 — интеграция с [chemistry.md](./chemistry.md), добавление химического характера как ключевого свойства элемента  
> **Назначение:** Документ архитектуры кода — описание модульной системы ресурсов SpaceGame: как добавлять новые элементы/руды, как они автоматически интегрируются в производственные цепочки, и как правила химии (chemistry.md) управляют автогенерацией  
> **Зависимости:** [chemistry.md](./chemistry.md) (правила химических взаимодействий), [mendeleev.md](./mendeleev.md) (химическая таблица элементов), [ores.md](./ores.md) (расчёты руд)

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

### 1.1 Ключевые принципы

- **Новый элемент** добавляется одной записью в массив `ELEMENTS` — и сразу становится доступным для системы ресурсов.
- **Новая руда** генерируется **автоматически** по правилам химии из [chemistry.md](./chemistry.md) — на основе химического характера элемента и его степени окисления.
- **Ни одна функция** не требует ручного обновления при расширении таблицы элементов или руд.

### 1.2 Роль chemistry.md

Документ [chemistry.md](./chemistry.md) — это **ядро системы модульности**. Он определяет:

| Вопрос | Ответ даёт |
|--------|-----------|
| Какую руду образует элемент? | chemistry.md §4 — правила образования руд по химическому характеру |
| Какое здание добывает руду? | chemistry.md §5 — матрица здание → тип руды |
| Какая переработка нужна? | chemistry.md §6 — правила назначения переработки |
| Сколько энергии и времени? | chemistry.md §7 — расчёт энергозатрат |
| Может ли элемент быть самородком? | chemistry.md §8 — самородные элементы |
| Атмосферное/ледяное соединение? | chemistry.md §9 — атмосферные и ледяные соединения |

### 1.3 Архитектура документов

```
                    chemistry.md
                   (Правила химии)
                        │
            ┌───────────┼───────────┐
            ▼           ▼           ▼
      mendeleev.md   ores.md   modularity.md
      (Элементы)    (Руды)    (Этот документ)
            │           │
            └─────┬─────┘
                  ▼
           elements.ts + processing-chains.ts
           (Код: данные и автогенерация)
```

---

## 2. Как добавить новый элемент

### 2.1 Обзор процедуры

Добавление нового элемента состоит из **4 шагов**, из которых шаги 2–3 выполняются автоматически по правилам [chemistry.md](./chemistry.md):

| Шаг | Действие | Ручной / Авто |
|-----|----------|---------------|
| 1 | Добавить элемент в таблицу `ELEMENTS` | **Ручной** |
| 2 | Определить химический характер и руду по правилам | **Авто** (по chemistry.md) |
| 3 | Рассчитать молярную массу и выход | **Авто** (по формулам) |
| 4 | Добавить рецепт переработки | **Ручной** (при необходимости) |

### 2.2 Шаг 1: Добавить элемент в таблицу

В файл `src/data/elements.ts` добавить новую запись в массив `ELEMENTS`:

```typescript
// Пример: добавление галлия (Ga)
{ id: 'Ga', name: 'Галлий', symbol: 'Ga', category: 'metal',
  baseValue: 5, density: 5.91, isAtmospheric: false,
  chemicalCharacter: 'reactive_metal', oxidationState: 3 }
```

> **Новое поле `chemicalCharacter`** (планируемое): определяет химический характер элемента по классификации [chemistry.md](./chemistry.md) §2. Позволяет системе автоматически генерировать руду.

> **Новое поле `oxidationState`** (планируемое): типичная степень окисления элемента в руде. Определяет формулу минерала-прототипа по [chemistry.md](./chemistry.md) §3.

В `docs/mendeleev.md` добавить описание элемента в соответствующую категорию с:
- Символом, названием, атомным номером и массой
- Категорией в игре
- Химическим характером (по chemistry.md §2.2)
- Степенью окисления (по chemistry.md §3)
- Описанием применения в космической индустрии
- 2–5 химическими взаимодействиями

### 2.3 Шаг 2: Автогенерация руды по правилам химии

По алгоритму [chemistry.md](./chemistry.md) §11:

1. **Определить химический характер** → `reactive_metal` (для Ga)
2. **Определить тип руды и здание добычи** → `metal_ore`, `mine` (по chemistry.md §5)
3. **Выбрать формулу минерала-прототипа** → Ga₂O₃ (по chemistry.md §4.1, степень +3)
4. **Рассчитать молярную массу** → M(Ga₂O₃) = 2×69.7 + 3×16.0 = 187.4 г/моль
5. **Рассчитать выход** → Ga ≈ 7.4, O ≈ 2.6 (по chemistry.md §7)
6. **Назначить переработку** → `processor`, мин. уровень 2 (по chemistry.md §6)
7. **Рассчитать энергозатраты** → энергия 4, время 200 (по chemistry.md §7)
8. **Определить самородный шанс** → 0 (по chemistry.md §8)

Результат — полная запись для `ORE_DEFINITIONS`:

```typescript
{
  id: 'Ga-ore', name: 'Галлиевая руда', type: 'metal_ore',
  sourceBuildingId: 'mine',
  containedElements: [
    { elementId: 'Ga', yield: 7.4 },
    { elementId: 'O', yield: 2.6 },
  ],
  minSourceLevel: 1, processingBuildingId: 'processor', minProcessingLevel: 2,
  processingEnergyCost: 4, processingTime: 200,
  prototype: 'Оксид галлия (Ga₂O₃)',
  molarFormula: 'Ga₂O₃', molarMass: 187.4,
}
```

В `docs/ores.md` добавить расчёт руды с полным разбором (как в ores.md §3.1–3.3).

### 2.4 Шаг 3: Добавить запись в ORE_FOR_ELEMENT_MAP

В `src/data/processing-chains.ts` добавить одну строку:

```typescript
Ga: 'Ga-ore',
```

### 2.5 Шаг 4: Создать рецепт (при необходимости)

В файл `src/data/recipes.ts` добавить рецепт, использующий новый элемент:

```typescript
// Пример: арсенид галлия для электроники
{
  id: 'gaas_chip',
  name: 'GaAs-кристалл',
  inputs: { Ga: 1, As: 1 },
  buildingId: 'synthesizer',
  minLevel: 5,
  energyCost: 8, time: 350,
}
```

### 2.6 Сводка: что нужно сделать вручную vs автоматически

| Действие | Ответственный |
|----------|--------------|
| Определить химический характер элемента | Разработчик (по chemistry.md §2) |
| Выбрать формулу минерала-прототипа | Автоматически (по chemistry.md §4) |
| Рассчитать молярную массу и выход | Автоматически (по формулам) |
| Назначить здание добычи | Автоматически (по chemistry.md §5) |
| Назначить здание переработки | Автоматически (по chemistry.md §6) |
| Рассчитать энергозатраты | Автоматически (по chemistry.md §7) |
| Определить самородный шанс | Автоматически (по chemistry.md §8) |
| Добавить запись в ELEMENTS | Разработчик |
| Добавить запись в ORE_FOR_ELEMENT_MAP | Разработчик (1 строка) |
| Создать рецепт переработки | Разработчик (при необходимости) |

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

Справочная таблица, которая определяет **основную** руду для каждого элемента. Заполняется при добавлении нового элемента — одна строка вида `Ga: 'Ga-ore'`. Используется функцией `buildElementSourcesMap()` для определения, какая руда является primary, а какие — альтернативными.

**Пример содержимого:**

| Элемент | Основная руда | Источник | Химический характер |
|---------|--------------|----------|---------------------|
| Fe | Fe-ore | Шахта | reactive_metal |
| Si | Si-ore | Карьер | reactive_nonmetal |
| Y | Y-ore | Глубинная | rare_earth |
| H | H2 | Атмосфера | gas |
| O | O2 | Атмосфера | gas |
| Au | Au-ore | Шахта | noble_metal |
| Ir | Ir-ore | Глубинная | platinoid |

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

**Планируемые поля (для автогенерации руд):**

| Поле | Тип | Описание |
|------|-----|----------|
| `chemicalCharacter` | `ChemicalCharacter` | Химический характер — определяет тип руды и здание добычи (см. [chemistry.md](./chemistry.md) §2) |
| `oxidationState` | `number` | Типичная степень окисления в руде — определяет формулу минерала (см. [chemistry.md](./chemistry.md) §3) |
| `rarity` | `'abundant'` \| `'common'` \| `'rare'` \| `'ultra_rare'` | Редкость — поправочный коэффициент для энергозатрат (см. [chemistry.md](./chemistry.md) §7.3) |

**Тип `ChemicalCharacter`:**
```typescript
type ChemicalCharacter =
  | 'reactive_metal'    // Fe, Ti, Cu, Ni, Cr, Mn, Zn, Sn, Pb, Co, V, Al, W, Mo, Cd, In
  | 'noble_metal'       // Au, Pt, Ag
  | 'refractory_metal'  // Ta, Nb, Zr, Hf, Re
  | 'platinoid'         // Ru, Rh, Pd, Ir, Os
  | 'rare_earth'        // Y, La, Ce, Nd, Dy
  | 'alkali'            // Li, Na, K
  | 'alkaline_earth'    // Be, Mg, Ca, Ba
  | 'reactive_nonmetal' // C, S, P, B, Se, Te
  | 'halogen'           // F, Cl
  | 'gas'               // H, He, N, O, Ne, Ar
  | 'transuranic';      // Np, Pu, Am, Cm, Cf, Fl, Og, Xn, Qn, Vd
```

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
| `NATIVE_ELEMENT_CHANCE` | `Record<string, number>` | Шанс самородка для 6 элементов |

**Объединённый массив:**
```typescript
const ALL_ORE_DEFS = [...ORE_DEFINITIONS, ...DEEP_ORES, ...REFINERY_PROCESSING];
```

### 4.3 `ORE_FOR_ELEMENT_MAP` — авто-маппинг элемент → руда

**Файл:** `src/data/processing-chains.ts`

```typescript
const ORE_FOR_ELEMENT_MAP: Record<string, string> = {
  // Шахта (reactive_metal, noble_metal)
  Fe: 'Fe-ore', Si: 'Si-ore', Ti: 'Ti-ore', Al: 'Al-ore',
  Cu: 'Cu-ore', Ni: 'Ni-ore', Cr: 'Cr-ore', W: 'W-ore',
  Co: 'Co-ore', Au: 'Au-ore', Pt: 'Pt-ore', U: 'U-ore',
  Li: 'Li-ore', V: 'V-ore', Mn: 'Mn-ore', Zn: 'Zn-ore',
  Sn: 'Sn-ore', Pb: 'Pb-ore', Mo: 'Mo-ore', Ag: 'Ag-ore',
  Cd: 'Cd-ore', Se: 'Se-ore',
  // Карьер (alkali, alkaline_earth, reactive_nonmetal, halogen)
  C: 'C-ore', S: 'S-ore', K: 'K-ore', B: 'B-ore', F: 'F-ore',
  Mg: 'Mg-ore', P: 'P-ore', Na: 'NaCl', Cl: 'NaCl', Ca: 'CaCO3',
  // Глубинные (refractory_metal, platinoid, rare_earth)
  Y: 'Y-ore', Ba: 'Ba-ore', Zr: 'Zr-ore', Be: 'Be-ore',
  In: 'In-ore', Nd: 'Nd-ore', Ce: 'Ce-ore', La: 'La-ore', Dy: 'Dy-ore',
  Ir: 'Ir-ore', Os: 'Os-ore', Ru: 'Ru-ore', Rh: 'Rh-ore',
  Pd: 'Pd-ore', Hf: 'Hf-ore', Ta: 'Ta-ore', Nb: 'Nb-ore', Re: 'Re-ore',
  // Атмосферные (gas)
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
| [chemistry.md](./chemistry.md) | **Ядро модульности** — правила химических взаимодействий, автогенерация руд, алгоритм добавления элемента |
| [mendeleev.md](./mendeleev.md) | Список элементов, атомные массы, химические характеры — входные данные |
| [ores.md](./ores.md) | Конкретные руды с расчётами — результат применения правил chemistry.md |
| [04-buildings.md](./04-buildings.md) | Здания добычи и переработки — соответствие ID зданий в коде и в документации |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Общая архитектура экономики (§3.1) |

---

*Документ обновлён 2026-05-04 (v2.0). Интегрирован с [chemistry.md](./chemistry.md). Согласовано с `src/data/elements.ts` (55 элементов), `src/data/processing-chains.ts` (33+18+3 руды, 11 газов, 5 льдов).*
