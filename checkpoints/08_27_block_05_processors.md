# Чекпоинт: Блок 5 — Переработчики (универсальный → специализированный)

**Дата:** 2026-08-27
**Фаза:** Etap 2.6 (новый)
**Статус:** `pending` (план зафиксирован, имплементация не начата)
**Зависимости:** правка `docs/40-buildings.md` §3 (см. `08_27_doc_fixes.md` пункт 4); может идти параллельно с Блоком 1 (стабилизация), но накладывается на P1 (ID руд) и DEP-1 (двойная шина) — см. §8.

> 👉 Связанные:
> - [08_27_audit_summary.md](./08_27_audit_summary.md) — контекст аудита (§2.5 экономика, §3.2 P1, §3.3 DEP-1)
> - [08_27_highlevel_plan.md](./08_27_highlevel_plan.md) — Etap 2.6 в общей карте
> - [08_27_doc_fixes.md](./08_27_doc_fixes.md) — пункт 4 (концепция 2 типов переработчиков)
> - `docs/40-buildings.md` §3 (процессоры), §11 (формулы), §12 (структуры данных)
> - `docs/33-chemistry.md`, `docs/34-ores.md`, `docs/35-warehouse-and-logistics.md`

---

## 1. Цель блока

Реализовать **один функциональный блок экономики** — 2 типа переработчиков с механизмом специализации:

1. **Универсальный переработчик** (`processor`): принимает ЛЮБОЙ тип входа (металл. руда, неметалл. руда, хим. соединение, лёд), низкий коэф. выхода, штраф за мульти-ресурс.
2. **Специализированный переработчик**: заточен под конкретную цепочку рецептов; высокий коэф. выхода; получается **апгрейдом** универсального с упором в категорию рецептов. `refinery` и `synthesizer` существуют как максимально специализированные формы (для металлов высшей чистоты и для сплавов/синтеза соответственно).

Это закрывает противоречие `40-buildings.md` v2.0 (где специализированные были удалены) и реализует решение владельца: «специализированный = апгрейд/подмножество универсального».

**Бизнес-результат:** игрок строит универсальный `processor` для ранней экономики, затем через UI «Специализировать» превращает его в одну из 4–6 узких цепочек (или доводит до `refinery`/`synthesizer`), получая высокий коэф. выхода и высшую чистоту для электроники/сверхпроводников/ядерного топлива.

---

## 2. Спецификация

**Источник истины (после правки):** `docs/40-buildings.md` §3 — переписанный раздел «2 типа переработчиков с механизмом специализации» (см. `08_27_doc_fixes.md` §4 — правки ещё НЕ внесены, должны быть сделаны до или параллельно с PR2).

### 2.1 Концепция 2 типов

| Свойство | Универсальный | Специализированный |
|----------|---------------|--------------------|
| ID по умолчанию | `processor` | апгрейд `processor` → выбор категории; `refinery`/`synthesizer` — предельные формы |
| Вход | ЛЮБОЙ: метал. руда, неметалл. руда, хим. соединение, лёд | ОДНА категория рецептов (напр. `metal_smelting`) |
| Формула выхода | `output = oreInput × baseYield × 0.75 × (1 / sqrt(activeRecipes))` | `output = oreInput × baseYield × 1.0 × purityBonus` |
| Чистота | 0.70–0.85 (техническая) | 0.92–0.99 (высшая — для электроники/сверхпроводников) |
| Скорость | Базовая, штраф за мульти-ресурс | Без штрафа, бонус к коэф. |
| Апгрейд | — | `specializeBuilding(buildingId, recipeCategory)` → необратимое (или昂 back-able за ресурсы) преобразование |
| Меню выбора | Активация нескольких рецептов одновременно | Один активный рецепт или узкая цепочка |

### 2.2 Формулы (точные)

```
// Универсальный (processor без specialization)
universal_output = oreInput × baseYield × 0.75 × (1 / sqrt(max(1, activeRecipes)))

// Специализированный
specialized_output = oreInput × baseYield × 1.0 × purityBonus
// где purityBonus = 1.0 + 0.02 × (specializationLevel - 1)  // +2%/ур. специализации
// specializationLevel ∈ [1..5], даёт чистоту 0.92..0.99 через формулу:
purity = 0.92 + 0.0175 × (specializationLevel - 1)  // L1=0.92, L5=0.99

// baseYield (из рецепта, упрощённо из recipes.ts как сумма outputs/inputs)
// oreInput — фактически переработанный объём входа за тик
```

> **Примечание к `activeRecipes`:** это число **активных рецептов** на конкретном экземпляре здания (HexCell.activeRecipes.length), НЕ количество рецептов в очереди производства. Логика производства переключается с «одна очередь на планету» на «виртуальные циклы по активным рецептам здания».

---

## 3. Текущее состояние кода

### 3.1 `src/data/buildings.ts` — 3 процессорных здания (стр. 66–106)

```typescript
{
  id: 'processor',
  name: 'Переработчик',
  description: 'Универсальная переработка руды в чистые элементы. Выход: 70–85% чистоты.',
  category: 'processing',
  layer: ['surface'],
  size: ['small', 'medium', 'large'],
  energyConsumption: 5,
  baseProductionTime: 10,
  levels: 10,
  costPerLevel: { Fe: 8, Si: 5, C: 3 },
  terrainBonus: {},
  requiresAtmosphere: false,
},
{
  id: 'synthesizer',
  name: 'Синтезатор',
  description: 'Синтез сплавов, материалов и химических соединений из чистых элементов.',
  category: 'processing',
  layer: ['surface'],
  size: ['medium', 'large'],
  energyConsumption: 4,
  baseProductionTime: 15,
  levels: 10,
  costPerLevel: { Fe: 6, Si: 4, Cu: 2 },
  terrainBonus: {},
  requiresAtmosphere: false,
},
{
  id: 'refinery',
  name: 'Очистительный комплекс',
  description: 'Глубокая очистка элементов. Выход: 95–99% чистоты, но 2× энергозатраты.',
  category: 'processing',
  layer: ['surface'],
  size: ['medium', 'large'],
  energyConsumption: 8,
  baseProductionTime: 15,
  levels: 10,
  costPerLevel: { Fe: 12, Si: 8, Cu: 4 },
  terrainBonus: {},
  requiresAtmosphere: false,
},
```

**Что есть:** 3 здания с базовыми полями (id, name, category, layer, size, energyConsumption, levels, costPerLevel, terrainBonus, requiresAtmosphere).
**Чего нет:** полей `isUniversalProcessor`, `baseCapacity`, `capacityPerLevel`, `multiplicityPenalty`, `recipeCategories`, `processorType`, `defaultSpecialization` — все эти поля описаны в `40-buildings.md` §12.1, но отсутствуют в кодовом `BuildingDef`.

### 3.2 `src/core/types.ts` — BuildingDef (стр. 188–204)

```typescript
export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  category: BuildingCategory;
  layer: BuildingLayer[];
  size: PlanetSize[];
  energyConsumption: number;
  baseProductionTime: number; // тиков на 1 цикл
  levels: number;
  costPerLevel: Record<string, number>; // elementId → количество
  terrainBonus: Partial<Record<HexTerrain, number>>;
  requiresAtmosphere: boolean;
}

export type RecipeCategory = 'raw_to_material' | 'material_to_component' | 'component_to_module' | 'module_to_ship';

export interface RecipeDef {
  id: string;
  name: string;
  category: RecipeCategory;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  energyCost: number;
  time: number; // тиков
  buildingId: string;
}
```

**Что есть:** `BuildingDef`, `RecipeDef`, `RecipeCategory` (4 значения), `HexCell` с `buildingId`/`buildingLevel`/`deposits`.
**Чего нет:** `isUniversalProcessor`, `ProcessorType`, `ProcessorRecipeCategory` (категории меню `metal_smelting`/`chemical_decomp`/…), `specialization`, `specializationLevel`, `activeRecipes`, `purity` в `HexCell`/`AtmosphericSlot`/`OrbitalSlot`, поле `purity` у `ResourceDef` в `RecipeDef`. `isUniversalProcessor` упомянут в `40-buildings.md` §12.1, но в коде отсутствует.

### 3.3 `src/economy/engine.ts` — `processProductionQueue` (стр. 217–269)

```typescript
function processProductionQueue(planet: Planet, queues: Map<EntityId, ProductionQueue>): void {
  const queue = queues.get(planet.id);
  if (!queue || queue.items.length === 0) return;

  const item = queue.items[0];
  const recipe = RECIPE_MAP.get(item.recipeId);
  if (!recipe) { queue.items.shift(); return; }

  const perTickCost = recipe.energyCost / item.total;
  if (planet.energyBalance < perTickCost && recipe.energyCost > 0) return;

  item.progress--;
  if (recipe.energyCost > 0) planet.energyBalance -= recipe.energyCost / item.total;

  if (item.progress <= 0) {
    let canProduce = true;
    for (const [resourceId, amount] of Object.entries(recipe.inputs)) {
      if ((planet.resources[resourceId] ?? 0) < amount) { canProduce = false; break; }
    }
    if (canProduce) {
      for (const [resourceId, amount] of Object.entries(recipe.inputs)) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) - amount;
      }
      for (const [resourceId, amount] of Object.entries(recipe.outputs)) {
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + amount;
      }
      gameBus.emit('production:complete', { planetId: planet.id, recipeId: recipe.id });
    }
    if (item.repeat) item.progress = item.total;
    else queue.items.shift();
  }
}
```

**Что есть:** тиковая обработка ОДНОГО рецепта из головы очереди планеты; трата энергии; проверка входов; запись выходов в `planet.resources`.
**Чего нет:**
- Нет учёта **специализации** здания (универсальный vs специализированный): выход всегда = `recipe.outputs` без множителя.
- Нет **штрафа за мульти-рецепт** (`sqrt(activeRecipes)`).
- Нет **чистоты** продукта: выходы пишутся в общий бак без тега purity. (Склад `35-warehouse-and-logistics.md` тоже не различает чистоту — см. §8 «Риски».)
- Нет понятия **`activeRecipes` на здании** — очередь хранится на планете целиком, а не по зданиям. Для блока 5 это требует либо новой структуры «per-building cycle», либо расширения `ProductionQueue` до per-building.
- Используется **legacy `gameBus`** (`@/core/event-bus`), не типизированный `typedBus` (это DEP-1, см. §8).

### 3.4 `src/data/recipes.ts` — 771 строка

- Все рецепты имеют `category: 'raw_to_material'` (мета-категория уровня рецепта), но **нет** подкатегорий `metal_smelting` / `chemical_decomp` / `ice_melting` / `gas_processing` / `alloy_synthesis`, которые нужны для специализации.
- Распределение рецептов по зданиям:
  - `processor`: ~54 рецепта (плавка металлических и неметаллических руд, химическое разложение, глубинные).
  - `refinery`: 3 рецепта (`refine_au`, `refine_pt`, `refine_u` — Au, Pt, U высшей чистоты).
  - `synthesizer`: ~14 рецептов (сплавы, пластик, кремниевый кристалл, сверхпроводник, синтетическое топливо и компоненты).

### 3.5 `src/components/game/building-dialog.tsx`

UI имеет только 2 режима:
1. **Build mode** — выбор здания из списка `BUILDINGS` (фильтр по `size`).
2. **Upgrade mode** — показывает уровень, стоимость апгрейда, кнопку Upgrade.

**Чего нет:** нет режима «Производство» (выбор рецепта — это P4 из Блока 1), нет кнопки «Специализировать», нет показа текущего коэф. выхода/чистоты.

### 3.6 `src/core/events.ts` — `EconomyEvents`

```typescript
'economy:build': { planetId: EntityId; hexIndex: number; buildingId: string };
'economy:building-constructed': { ... };
'economy:upgrade': { planetId; hexIndex };
'economy:building-upgraded': { planetId; hexIndex; level };
'economy:enqueue': { planetId; recipeId; repeat };
'economy:production-complete': { planetId; recipeId };
```

**Чего нет:** событий `economy:building-specialized`, `economy:processor-output-changed`, `economy:active-recipes-changed`.

---

## 4. Подзадачи (детально)

### PR1. Типы данных — `src/core/types.ts`

**Цель:** ввести типы для специализации переработчиков и расширить BuildingDef/HexCell/RecipeDef.

**Файлы:** `src/core/types.ts` (правка).

**Ключевые типы:**

```typescript
// Тип переработчика
export type ProcessorType = 'universal' | 'specialized';

// Категория специализации (подкатегория рецептов; не путать с RecipeCategory!)
export type ProcessorRecipeCategory =
  | 'metal_smelting'      // плавка металлических руд
  | 'nonmetal_smelting'  // плавка неметаллических руд (Si, C, S, P, Mg, B)
  | 'chemical_decomp'     // химическое разложение (H2O, CO2, NH3, NaCl, …)
  | 'ice_melting'         // переработка льда (H2O-ice, CO2-ice, NH3-ice, CH4-ice)
  | 'gas_processing'     // газовая переработка (атмосферные газы)
  | 'deep_ore_smelting'  // глубинные руды (Y, Ba, Zr, Be, …) — требует ур. 5+
  | 'alloy_synthesis';   // сплавы/синтез материалов — для synthesizer

// Расширение BuildingDef
export interface BuildingDef {
  // … (существующие поля)
  /** true для processor/refinery/synthesizer — они поддерживают специализацию */
  isUniversalProcessor?: boolean;
  /** 'universal' по умолчанию; 'specialized' для refinery/synthesizer (предельные формы) */
  defaultProcessorType?: ProcessorType;
  /** Предельная специализация (для refinery = 'metal_smelting', для synthesizer = 'alloy_synthesis') */
  defaultSpecialization?: ProcessorRecipeCategory;
  /** Базовый коэф. выхода для универсального (0.75) или специализированного (1.0) */
  baseYield?: number; // default 0.75 universal, 1.0 specialized
  /** Базовая чистота для универсального (0.70..0.85) или специализированного (0.92..0.99) */
  basePurity?: number; // default 0.78 universal, 0.95 specialized
  /** Стоимость специализации (добавляется к costPerLevel) */
  specializeCost?: Partial<Record<string, number>>;
}

// Расширение HexCell / AtmosphericSlot / OrbitalSlot — instance state
export interface HexCell {
  // … (существующие поля)
  /** Тип переработчика для processor/refinery/synthesizer; undefined для других */
  processorType?: ProcessorType;
  /** Категория специализации (если processorType === 'specialized') */
  specialization?: ProcessorRecipeCategory;
  /** Уровень специализации 1..5 (влияет на purityBonus; 0 если universal) */
  specializationLevel?: number;
  /** Активные рецепты на этом экземпляре (для universal — мульти, для specialized — 1..2) */
  activeRecipes?: string[];
}

// Аналогично добавить processorType/specialization/specializationLevel/activeRecipes
// в AtmosphericSlot и OrbitalSlot.

// Расширение RecipeDef — подкатегория для специализации
export interface RecipeDef {
  // … (существующие поля)
  /** Подкатегория для специализации процессоров; undefined для не-процессорных рецептов */
  processorCategory?: ProcessorRecipeCategory;
  /** Мин. уровень специализации здания для рецепта (default 1) */
  minSpecializationLevel?: number;
}
```

**Оценка:** 1.5–2 ч.

**Критерий готовности:** типы компилируются, lint чистый, существующий код работает (новые поля опциональны).

---

### PR2. Данные зданий — `src/data/buildings.ts` + `src/data/recipes.ts`

**Цель:** описать роли зданий в новой модели и промаркировать рецепты подкатегориями.

**Файлы:**
- `src/data/buildings.ts` — обновить definitions processor/synthesizer/refinery.
- `src/data/recipes.ts` — добавить `processorCategory` к каждому рецепту; группировка по категориям.
- `src/data/processor-categories.ts` (новый) — таблица специализаций (см. PR5).

**Изменения в `buildings.ts`:**

```typescript
// processor — универсальный по умолчанию
{
  id: 'processor',
  name: 'Переработчик',
  description: 'Универсальная переработка любого сырья. Низкий коэф. (0.75), штраф за мульти-рецепт. Можно специализировать под конкретную цепочку.',
  category: 'processing',
  layer: ['surface'],
  size: ['small', 'medium', 'large'],
  energyConsumption: 5,
  baseProductionTime: 10,
  levels: 10,
  costPerLevel: { Fe: 8, Si: 5, C: 3 },
  terrainBonus: {},
  requiresAtmosphere: false,
  isUniversalProcessor: true,
  defaultProcessorType: 'universal',
  baseYield: 0.75,
  basePurity: 0.78,
  specializeCost: { Fe: 10, Si: 5, Cu: 3 },  // доплата за специализацию
},
// synthesizer — предельная специализированная форма для alloy_synthesis
{
  id: 'synthesizer',
  name: 'Синтезатор',
  description: 'Максимально специализированный переработчик для сплавов и хим. синтеза. Высокий коэф. (1.0), чистота не ниже входной. Строится сразу как специализированный (требует технологию).',
  category: 'processing',
  layer: ['surface'],
  size: ['medium', 'large'],
  energyConsumption: 4,
  baseProductionTime: 15,
  levels: 10,
  costPerLevel: { Fe: 6, Si: 4, Cu: 2 },
  terrainBonus: {},
  requiresAtmosphere: false,
  isUniversalProcessor: true,
  defaultProcessorType: 'specialized',
  defaultSpecialization: 'alloy_synthesis',
  baseYield: 1.0,
  basePurity: 0.95,
  specializeCost: {},
},
// refinery — предельная специализированная форма для metal_smelting высшей чистоты
{
  id: 'refinery',
  name: 'Очистительный комплекс',
  description: 'Максимально специализированный переработчик для металлов высшей чистоты (0.95–0.99). 2× энергозатраты. Строится сразу как специализированный (требует технологию).',
  category: 'processing',
  layer: ['surface'],
  size: ['medium', 'large'],
  energyConsumption: 8,
  baseProductionTime: 15,
  levels: 10,
  costPerLevel: { Fe: 12, Si: 8, Cu: 4 },
  terrainBonus: {},
  requiresAtmosphere: false,
  isUniversalProcessor: true,
  defaultProcessorType: 'specialized',
  defaultSpecialization: 'metal_smelting',
  baseYield: 1.0,
  basePurity: 0.95,
  specializeCost: {},
},
```

**Изменения в `recipes.ts`:** пройтись по ~71 рецепту processor/synthesizer/refinery и добавить `processorCategory`:
- Все `smelt_*` (Fe, Ti, Cu, Cr, V, Ni, Mn, Zn, Sn, Pb, Co, W, Mo, Ag, Au, Li, Al) → `processorCategory: 'metal_smelting'`.
- `smelt_si`, `smelt_c`, `smelt_s`, `smelt_p`, `smelt_mg`, `smelt_b` → `'nonmetal_smelting'`.
- Рецепты разложения H2O/CO2/NH3/H2S/CaCO3/NaCl/KCl/CaF2 → `'chemical_decomp'`.
- Ледяные рецепты (если есть в recipes.ts; если нет — пометить как TODO для будущего) → `'ice_melting'`.
- Глубинные руды (Y, Ba, Zr, Be, Nb, …) → `'deep_ore_smelting'` + `minSpecializationLevel: 5`.
- `refine_au`/`refine_pt`/`refine_u` → `'metal_smelting'` + `minSpecializationLevel: 5`.
- Все `make_*` (steel, titanium_alloy, plastic, silicon_crystal, superconductor, synfuel, …) → `'alloy_synthesis'`.

> **Связь с P1 (Блок 1):** P1 правит ID руд `Fe-ore` → `hematite` и т.д. PR2 Блока 5 маркирует `processorCategory` — если P1 ещё не выполнен, маркировка делается по текущим `*-ore` ID; при мердже P1 категории остаются валидны (меняются только строки ID). **PR2 Блока 5 не зависит от P1.**

**Оценка:** 2 ч.

**Критерий готовности:** все 71 процессорный рецепт имеют `processorCategory`; 3 здания имеют новые поля; `BUILDING_MAP`/`RECIPE_MAP` работают; тест «все рецепты валидны по категориям» — зелёный (см. §7).

---

### PR3. Формулы выхода — `src/economy/engine.ts`

**Цель:** реализовать универсальную и специализированную формулы в `processProductionQueue` (или новой `processProcessorBuilding`).

**Файлы:** `src/economy/engine.ts` (правка `processProductionQueue`, новая функция `processProcessorOutput`).

**Ключевая функция:**

```typescript
/**
 * Расчёт множителя выхода для процессорного здания.
 * Универсальный: output = base × 0.75 × (1 / sqrt(activeRecipes))
 * Специализированный: output = base × 1.0 × purityBonus
 */
export function calculateProcessorOutputMultiplier(
  building: BuildingDef,
  instance: { processorType?: ProcessorType; specializationLevel?: number; activeRecipes?: string[] },
): { yieldMult: number; purity: number } {
  // Специализированная ветка (refinery/synthesizer или специализированный processor)
  if (instance.processorType === 'specialized') {
    const specLvl = Math.max(1, Math.min(5, instance.specializationLevel ?? 1));
    const purityBonus = 1.0 + 0.02 * (specLvl - 1);       // +0%/+2%/+4%/+6%/+8%
    const purity = 0.92 + 0.0175 * (specLvl - 1);         // 0.92..0.99
    return { yieldMult: (building.baseYield ?? 1.0) * purityBonus, purity };
  }
  // Универсальная ветка (processor без specialization)
  const activeRecipes = Math.max(1, instance.activeRecipes?.length ?? 1);
  const multiPenalty = 1 / Math.sqrt(activeRecipes);       // 1.0 / 0.707 / 0.577 / 0.5 / 0.447 …
  return {
    yieldMult: (building.baseYield ?? 0.75) * multiPenalty,
    purity: building.basePurity ?? 0.78,                    // 0.70..0.85 (можно рандомно в диапазоне)
  };
}
```

**Интеграция в `processProductionQueue`:** перед записью выходов в `planet.resources` умножить `amount` на `yieldMult` и записать с тегом чистоты (см. §3.3 — склад пока не различает чистоту; **временное решение PR3-min**: хранить purity в отдельной карте `planet.resourcePurity: Record<string, number>`; полное решение — в будущем расширении склада, см. §8).

**Альтернатива (per-building cycles):** если делать честно, нужно перенести логику с «очередь на планете» на «циклы по активным рецептам каждого здания». Это крупная правка; **рекомендация — разделить на 2 шага:**
- **PR3-min (этот блок):** оставить per-planet queue, но при выполнении рецепта найти здание-исполнитель на планете, взять из него `processorType`/`specialization`/`activeRecipes`, применить множитель. Это даёт корректные формулы без переписывания архитектуры очереди.
- **PR3-full (отложено в Блок 1 или отдельный рефакторинг):** per-building активные рецепты через UI Building → recipe toggle. Событие `economy:active-recipes-changed`.

**Оценка:** 3–4 ч (PR3-min); PR3-full вне блока.

**Критерий готовности:** юнит-тесты (см. §7) — `processor universal 1 рецепт` vs `3 рецепта` дают разный выход; `specialized` даёт ≥ выхода universal; `refinery` даёт чистоту ≥ 0.95.

---

### PR4. Механизм апгрейда — `specializeBuilding`

**Цель:** реализовать функцию превращения универсального `processor` в специализированный.

**Файлы:**
- `src/economy/engine.ts` (новая экспортируемая функция `specializeBuilding`).
- `src/stores/game-store.ts` (новый action `specializeBuildingOnHex`).
- `src/economy/index.ts` (re-export).

**Ключевая функция:**

```typescript
/**
 * Превратить универсальный processor в специализированный под конкретную категорию.
 * - Проверка: здание должно быть processor (не refinery/synthesizer — они уже specialized).
 * - Проверка: уровень здания ≥ 3 (требование специализации).
 * - Проверка: спецкатегория доступна на этом уровне (deep_ore_smelting требует ур. 5+).
 * - Списание specializeCost с planet.resources.
 * - Мутация: hex.processorType = 'specialized', hex.specialization = category, hex.specializationLevel = 1.
 * - Активные рецепты фильтруются: остаются только те, чей processorCategory === category.
 * - Эмит economy:building-specialized.
 * Необратимо? Решение: ОБРАТИМО через specializeBuilding(..., 'universal') за 50% возврата стоимости.
 */
export function specializeBuilding(
  planet: Planet,
  hexIndex: number,
  category: ProcessorRecipeCategory | 'universal',  // 'universal' = откат специализации
  options?: { silent?: boolean },
): { success: boolean; reason?: string } {
  const hex = planet.hexes[hexIndex];
  if (!hex?.buildingId) return { success: false, reason: 'no-building' };
  const def = BUILDING_MAP.get(hex.buildingId);
  if (!def?.isUniversalProcessor) return { success: false, reason: 'not-processor' };
  if (def.defaultProcessorType === 'specialized') return { success: false, reason: 'already-specialized-form' };

  // Случай: откат к универсальному
  if (category === 'universal') {
    if (hex.processorType !== 'specialized') return { success: false, reason: 'not-specialized' };
    hex.processorType = 'universal';
    hex.specialization = undefined;
    hex.specializationLevel = 0;
    // Возврат 50% specializeCost
    refundSpecializeCost(planet, def.specializeCost ?? {}, 0.5);
    gameBus.emit('economy:building-specialized', {
      planetId: planet.id, hexIndex, specialization: 'universal', specializationLevel: 0,
    });
    return { success: true };
  }

  // Минимальный уровень здания
  if (hex.buildingLevel < 3) return { success: false, reason: 'level-too-low' };
  // Категория требует мин. уровень специализации
  const catDef = PROCESSOR_CATEGORIES.get(category);
  if (catDef?.minBuildingLevel && hex.buildingLevel < catDef.minBuildingLevel) {
    return { success: false, reason: 'category-level-too-low' };
  }
  // Списание стоимости
  if (!spendSpecializeCost(planet, def.specializeCost ?? {})) {
    return { success: false, reason: 'cannot-afford' };
  }
  // Мутация
  hex.processorType = 'specialized';
  hex.specialization = category;
  hex.specializationLevel = 1;
  // Фильтр активных рецептов
  hex.activeRecipes = (hex.activeRecipes ?? []).filter(rid => {
    const r = RECIPE_MAP.get(rid);
    return r?.processorCategory === category;
  });
  gameBus.emit('economy:building-specialized', {
    planetId: planet.id, hexIndex, specialization: category, specializationLevel: 1,
  });
  return { success: true };
}

/**
 * Поднять уровень специализации (1→2→…→5). Каждый уровень даёт +2% purityBonus
 * и +0.0175 к чистоте. Стоимость = specializeCost × specializationLevel.
 */
export function upgradeSpecialization(planet: Planet, hexIndex: number): { success: boolean; reason?: string } {
  // аналогично specializeBuilding, но +1 к specializationLevel (макс 5)
}
```

**Аналог для atmosphericSlots/orbitSlots:** `specializeAtmosphericBuilding(planet, slotIndex, category)` — дублировать или обобщить через общий `BuildingLocation`.

**Необратимость:** решение владельца не зафиксировано; в плане — **обратимо за 50% возврата** (мягче для игрока, упрощает тестирование). Зафиксировать в `40-buildings.md` §3 при правке.

**Оценка:** 3–4 ч.

**Критерий готовности:** тест (см. §7) — specialize processor на Fe-цепочке → выход в `make_steel` вырастает; `economy:building-specialized` эмитится; `specializeCost` списывается; нельзя специализировать на deep_ore_smelting при ур. < 5.

---

### PR5. Таблица специализаций — `src/data/processor-categories.ts` (новый)

**Цель:**集中 описать доступные категории специализации с условиями и бонусами.

**Файл:** `src/data/processor-categories.ts` (новый).

**Контент:**

```typescript
import type { ProcessorRecipeCategory } from '@/core/types';

export interface ProcessorCategoryDef {
  id: ProcessorRecipeCategory;
  name: string;                    // "Плавка металлических руд"
  description: string;
  minBuildingLevel: number;        // мин. уровень здания для выбора этой специализации
  /** Чистота по умолчанию (L1) — будет расти с specializationLevel */
  basePurity: number;              // 0.92 для всех specialized
  /** Уникальный бонус специализации (опционально) */
  bonusText?: string;              // "+15% к выходу при переработке руд этого типа"
  /** Соответствует существующему зданию-предельной-форме (для UI подсказки) */
  equivalentTo?: string;           // 'metal_smelting' → 'refinery'
}

export const PROCESSOR_CATEGORIES: Map<ProcessorRecipeCategory, ProcessorCategoryDef> = new Map([
  ['metal_smelting', {
    id: 'metal_smelting',
    name: 'Плавка металлических руд',
    description: 'Fe, Ti, Cu, Cr, Ni, Mn, W, Mo, Au, Pt, U и др.',
    minBuildingLevel: 3,
    basePurity: 0.92,
    bonusText: '+15% выход металлов',
    equivalentTo: 'refinery',
  }],
  ['nonmetal_smelting', {
    id: 'nonmetal_smelting',
    name: 'Плавка неметаллических руд',
    description: 'Si, C, S, P, Mg, B — для электроники и химии',
    minBuildingLevel: 3,
    basePurity: 0.92,
    bonusText: '+10% выход Si и C',
  }],
  ['chemical_decomp', {
    id: 'chemical_decomp',
    name: 'Химическое разложение',
    description: 'H2O→H2+O2, CO2→C+O2, NH3→N+H2, NaCl→Na+Cl и др.',
    minBuildingLevel: 3,
    basePurity: 0.92,
    bonusText: '+20% выход газов (H, O, N)',
  }],
  ['ice_melting', {
    id: 'ice_melting',
    name: 'Переработка льда',
    description: 'H2O-лед, CO2-лед, NH3-лед, CH4-лед — для колоний без атмосферы',
    minBuildingLevel: 3,
    basePurity: 0.93,
    bonusText: '+30% выход при работе с ледяными рудами',
  }],
  ['gas_processing', {
    id: 'gas_processing',
    name: 'Газовая переработка',
    description: 'Атмосферные газы (N2, O2, CO2, Ar, He и др.)',
    minBuildingLevel: 4,
    basePurity: 0.93,
    bonusText: 'Доступна на газовых гигантах через атмосферные слоты',
  }],
  ['deep_ore_smelting', {
    id: 'deep_ore_smelting',
    name: 'Плавка глубинных руд',
    description: 'Y, Ba, Zr, Be, Nb, Pt, U, Ir, Os — редкие и ультраредкие',
    minBuildingLevel: 5,
    basePurity: 0.95,
    bonusText: 'Требует ур. здания 5+; доступ к сверхпроводникам',
  }],
  ['alloy_synthesis', {
    id: 'alloy_synthesis',
    name: 'Синтез сплавов и материалов',
    description: 'Сталь, титановый сплав, пластик, кремниевый кристалл, сверхпроводник',
    minBuildingLevel: 3,
    basePurity: 0.95,
    equivalentTo: 'synthesizer',
  }],
]);
```

**Оценка:** 1 ч.

**Критерий готовности:** карта компилируется; UI в PR6 использует её для списка категорий; тест «все ProcessorRecipeCategory имеют def» — зелёный.

---

### PR6. UI — `building-dialog.tsx` + `specialize-dialog.tsx`

**Цель:** добавить в диалог здания кнопку «Специализировать» и панель выбора категории; показывать текущий коэф. выхода и чистоту.

**Файлы:**
- `src/components/game/building-dialog.tsx` (правка — новый блок в upgrade mode для процессорных зданий).
- `src/components/game/specialize-dialog.tsx` (новый) — отдельный диалог выбора специализации.
- `src/components/ui/*` — использовать существующие Badge/Dialog/Button.

**UI-флоу:**

1. Игрок кликает на гекс с `processor` → открывается `BuildingDialog` в upgrade mode.
2. Если `building.isUniversalProcessor && instance.processorType === 'universal'`:
   - Под кнопкой «Upgrade» появляется кнопка «🛠 Специализировать».
   - Ниже — плашка «Текущий коэф.: ×0.75 (universal), 3 активных рецепта → штраф ×0.577 = эффективный ×0.433».
3. Клик «Специализировать» → открывает `SpecializeDialog`:
   - Список `PROCESSOR_CATEGORIES` (фильтр по `minBuildingLevel ≤ hex.buildingLevel`).
   - Для каждой категории: имя, описание, `basePurity`, `bonusText`, эквивалентное здание (refinery/synthesizer), стоимость.
   - Кнопка «Специализировать» → вызывает `specializeBuildingOnHex(planetId, hexIndex, category)`.
4. Если `instance.processorType === 'specialized'`:
   - Показать `specialization` (имя), `specializationLevel`, текущую чистоту (формула), эффективный коэф.
   - Кнопка «↑ Повысить уровень специализации» (если specializationLevel < 5).
   - Кнопка «↩ Вернуть к универсальному» (с предупреждением о 50% возврате).
5. UI также должен показывать **список активных рецептов** этого экземпляра (TODO: зависит от PR3-full — per-building cycle; в PR3-min показываем только то, что в очереди планеты для этого здания).

**Зависимости:** P4 из Блока 1 (UI очереди производства) — если P4 не выполнен, активные рецепты в UI показываются как read-only (из `hex.activeRecipes`, который пока может быть пустым). PR6 работает в обоих случаях.

**Оценка:** 4–6 ч (включая верстку и стили).

**Критерий готовности:** ручной тест — specialize processor → эффект виден в следующем тике (выход продукта увеличен); specialize-dialog открывается/закрывается корректно; кнопки disabled при нехватке ресурсов или низком уровне.

---

### PR7. Интеграция в game-store + события typed-bus

**Цель:** провести action `specializeBuildingOnHex` через store; добавить новые события в `events.ts`; эмитить их.

**Файлы:**
- `src/core/events.ts` — новые события в `EconomyEvents`.
- `src/economy/engine.ts` — эмитить новые события (через `gameBus` legacy; после DEP-1 — через `typedBus`).
- `src/stores/game-store.ts` — новый action `specializeBuildingOnHex(planetId, hexIndex, category)`.
- `src/economy/economy-module.ts` — подписка на новые события (если нужно для логирования/сохранения).

**Новые события:**

```typescript
// В src/core/events.ts → EconomyEvents
'economy:building-specialized': {
  planetId: EntityId;
  hexIndex: number;
  specialization: ProcessorRecipeCategory | 'universal';
  specializationLevel: number;
};
'economy:specialization-upgraded': {
  planetId: EntityId;
  hexIndex: number;
  specializationLevel: number;
};
'economy:processor-output-changed': {
  planetId: EntityId;
  hexIndex: number;
  yieldMult: number;
  purity: number;
};
'economy:active-recipes-changed': {  // для PR3-full
  planetId: EntityId;
  hexIndex: number;
  activeRecipes: string[];
};
```

**Action в store:**

```typescript
specializeBuildingOnHex: (planetId, hexIndex, category) => {
  const { gameState } = get();
  if (!gameState) return false;
  const planet = findPlanet(gameState, planetId);
  if (!planet) return false;
  const result = specializeBuilding(planet, hexIndex, category);
  if (result.success) {
    recalcEnergyBalance(planet);
    set({ gameState: { ...gameState } });
  }
  return result.success;
},
upgradeSpecializationOnHex: (planetId, hexIndex) => { /* аналогично */ },
```

> **DEP-1 (Блок 1):** `engine.ts` использует legacy `gameBus`. Новые события эмитятся через тот же `gameBus` (legacy adapter проксирует в typedBus). После миграции DEP-1 достаточно заменить `gameBus` на `typedBus` — события уже в типизированной карте.

**Оценка:** 2–3 ч.

**Критерий готовности:** action вызывает `specializeBuilding`; событие `economy:building-specialized` ловится в тестах/логах; lint чистый.

---

### PR8. Балансировка — значения baseYield / purityBonus / specializeCost

**Цель:** подобрать значения, чтобы:
- Универсальный с 1 рецептом был эффективнее специализированного L1 на 25–35% (по чистоте), но специализированный L3+ выигрывал по выходу.
- Специализация на `deep_ore_smelting` давала заметный буст для Y/Ba/Cu-сверхпроводников.
- `refinery` оставался привлекательным для прямого строительства высшей чистоты (без апгрейда).

**Файлы:** `src/data/buildings.ts` (значения baseYield/basePurity), `src/data/processor-categories.ts` (basePurity/bonusText), `src/economy/engine.ts` (константы формул).

**Стартовые значения (подвергаются тюнингу):**

| Параметр | Стартовое | Диапазон итерации |
|----------|-----------|--------------------|
| Universal `baseYield` | 0.75 | 0.65–0.85 |
| Specialized `baseYield` | 1.0 | 1.0–1.1 |
| Universal `basePurity` | 0.78 (диапазон 0.70–0.85) | 0.70–0.85 |
| Specialized `basePurity` L1 | 0.92 | 0.90–0.93 |
| `purityBonus` per spec-level | +2% yield | +1.5% / +2% / +2.5% |
| `purity` per spec-level | +0.0175 | +0.015 / +0.0175 / +0.02 |
| `specializeCost` (Fe/Si/Cu) | 10/5/3 | 8–15 / 4–8 / 2–5 |
| `specializationLevel` max | 5 | 3 / 5 / 7 |
| `upgradeSpecialization` cost mult | ×specializationLevel | ×0.5 / ×1 / ×2 |

**Подход:** написать балансировочный скрипт `scripts/processor-balance-sim.ts` (Node CLI), который прогоняет 100 тиков на 5 сценариях (1 universal 1 рецепт; 1 universal 3 рецепта; 1 specialized L1; 1 specialized L3; 1 refinery) и выдаёт таблицу выхода/чистоты. Тюнить константы до приемлемого профиля.

**Оценка:** 2–3 ч + итерации (1–2 ч на повторные прогоны после плейтеста).

**Критерий готовности:** сценарии из §7 показывают ожидаемые пропорции (specialized L3 ≥ universal 1-recipe по выходу; refinery чистота ≥ 0.95; universal 3 рецепта ≤ universal 1 рецепт по выходу на каждый).

---

## 5. События typed-bus (новые)

Добавить в `src/core/events.ts` → `EconomyEvents` (см. PR7):

| Событие | Payload | Когда эмитится |
|---------|---------|----------------|
| `economy:building-specialized` | `{ planetId, hexIndex, specialization: ProcessorRecipeCategory \| 'universal', specializationLevel }` | После вызова `specializeBuilding` (включая откат к universal) |
| `economy:specialization-upgraded` | `{ planetId, hexIndex, specializationLevel }` | После `upgradeSpecialization` (+1 уровень) |
| `economy:processor-output-changed` | `{ planetId, hexIndex, yieldMult, purity }` | После любого изменения, влияющего на выход (specialize/upgrade/activeRecipes change) — для UI чтобы перерисовать плашку коэф. |
| `economy:active-recipes-changed` | `{ planetId, hexIndex, activeRecipes: string[] }` | (для PR3-full) При изменении набора активных рецептов здания |

> Все события кладутся в типизированную карту `EventMap`; до миграции DEP-1 эмитятся через `gameBus` (legacy adapter).

---

## 6. UI-компоненты

### 6.1 Обновить `src/components/game/building-dialog.tsx`

Добавить в upgrade-mode (для зданий с `isUniversalProcessor === true`):
- Плашка «Тип переработчика»: Universal / Specialized ({specialization} L{level}).
- Плашка «Текущий коэф. выхода»: `×{yieldMult.toFixed(3)}` и «Чистота»: `{purity.toFixed(2)}`.
- Кнопка «🛠 Специализировать» (если universal) → открывает `SpecializeDialog`.
- Кнопка «↑ Повысить спец-уровень» (если specialized и level < 5).
- Кнопка «↩ Вернуть к универсальному» (если specialized).

### 6.2 Новый `src/components/game/specialize-dialog.tsx`

- Props: `open, onOpenChange, planet, hexIndex`.
- Содержимое: список `PROCESSOR_CATEGORIES` (фильтр по `minBuildingLevel ≤ hex.buildingLevel`), для каждой — карточка с именем, описанием, `basePurity`, `bonusText`, стоимостью, кнопкой «Выбрать».
- При выборе вызывает `specializeBuildingOnHex(planet.id, hexIndex, category)`.
- Показывает предупреждение: «Это действие можно отменить за 50% возврата стоимости».

### 6.3 (Опц.) Переработать resource-panel

Показывать чистоту ресурса рядом с количеством, если `resourcePurity[resourceId] < 0.9` (техническая) — маркер «⚠ техн. чистота». Это поможет игроку понимать, почему электроника не производится.

---

## 7. Тесты

Тест-раннер: **vitest** (рекомендуется; добавить в `package.json` `devDependencies` и `scripts.test`). Каталог: `tests/economy/processors.test.ts`. Если Блок 1 (стабилизация) ещё не добавил vitest, этот блок добавляет его минимально (см. «Зависимости» §8).

### T5.1 — Универсальный с 1 рудой vs 3 рудами
- Setup: 1 `processor` ур.3 на планете; рецепты `smelt_fe`, `smelt_ti`, `smelt_cu` в очереди.
- Case A: активирован только `smelt_fe` → выход Fe = 7.0 × 0.75 × 1/√1 = 5.25 ед.
- Case B: активированы все 3 → выход Fe = 7.0 × 0.75 × 1/√3 ≈ 3.03 ед. (штраф ≈ 42%).
- Assert: Case A выход > Case B выход в ~1.73× (1/√3).

### T5.2 — Специализированный vs универсальный (та же руда)
- Setup: 1 universal `processor` (1 рецепт) vs 1 specialized `processor` (specialization=`metal_smelting`, L1) на одинаковых планетах.
- Universal: 7.0 × 0.75 × 1.0 = 5.25 ед.
- Specialized L1: 7.0 × 1.0 × 1.0 (purityBonus=1.0) = 7.0 ед. (+33%).
- Assert: specialized ≥ universal × 1.33.

### T5.3 — Уровень специализации растёт → растёт чистота и выход
- Specialized L1: purity 0.92, yieldMult 1.0.
- Specialized L3: purity 0.955, yieldMult 1.04.
- Specialized L5: purity 0.99, yieldMult 1.08.
- Assert: монотонный рост.

### T5.4 — Апгрейд universal→specialized
- Setup: `processor` ур.3, ресурсы для `specializeCost`.
- Call `specializeBuilding(planet, hexIndex, 'metal_smelting')`.
- Assert: `hex.processorType === 'specialized'`, `hex.specialization === 'metal_smelting'`, `hex.specializationLevel === 1`, ресурсы списаны, эмит `economy:building-specialized`.

### T5.5 — Отказ при нехватке условий
- `processor` ур.2 + specialize → `{success: false, reason: 'level-too-low'}`.
- `processor` ур.4 + specialize на `deep_ore_smelting` (требует ур.5) → `{success: false, reason: 'category-level-too-low'}`.
- `refinery` (уже specialized form) + specialize → `{success: false, reason: 'already-specialized-form'}`.

### T5.6 — Чистота электронного кремния
- `processor` universal → `smelt_si` → Si с purity 0.78.
- Specialized `nonmetal_smelting` L3 → Si с purity 0.955.
- Electronics Plant (требует Si purity ≥ 0.9) — universal НЕ подходит, specialized подходит.
- Assert: проверка `purity >= 0.9` корректно фильтрует.

### T5.7 — Обратный апгрейд (universal → specialized → universal)
- После `specializeBuilding(..., 'universal')`: `hex.processorType === 'universal'`, `hex.specialization === undefined`, 50% стоимости возвращено.

### T5.8 — Recipe categories валидны
- Для каждого рецепта в `RECIPES` с `buildingId` ∈ {processor, refinery, synthesizer} поле `processorCategory` определено и присутствует в `PROCESSOR_CATEGORIES`.

---

## 8. Риски и зависимости

| # | Риск/Зависимость | Влияние | Митигация |
|---|------------------|---------|-----------|
| R1 | **Блок 1 (P1 — ID руд)** ещё не выполнен | Recipes.ts использует `Fe-ore`/`hematite` несогласованно; может ломать интеграцию | PR2 маркирует `processorCategory` независимо от ID строк. Блок 5 работает на текущих ID; после P1 — просто переименование. |
| R2 | **DEP-1 (двойная шина)** — engine.ts использует legacy `gameBus` | Новые события могут не дойти до typedBus-подписчиков | Эмитить через `gameBus` (legacy adapter проксирует в typedBus). После Блока 1 DEP-1 миграция заменяет импорт. |
| R3 | **Склад не различает чистоту** (`35-warehouse-and-logistics.md` не описывает purity) | Невозможно хранить «грязный» и «чистый» Fe в одном баке | PR3-min: хранить purity в `planet.resourcePurity: Record<string, number>` (средневзвешенное). Полное решение — расширение склада (отдельный блок в будущем). Документировать в `35-warehouse-and-logistics.md` как TODO. |
| R4 | **P4 (UI очереди производства)** из Блока 1 не выполнен | Активные рецепты на здании невозможно редактировать через UI | PR3-min работает без UI activeRecipes (использует то, что в очереди планеты). PR6 показывает `activeRecipes` read-only. Полный per-building cycle — после P4. |
| R5 | **Балансировка может потребовать итераций** | После плейтеста константы (baseYield, purityBonus) могут быть несбалансированы | PR8 включает симуляционный скрипт; заложить 1–2 ч на повторные прогоны. |
| R6 | **UI-флоу специализации может быть неочевиден** | Игроки не понимают, зачем специализировать | Описать в `40-buildings.md` §3 спойлер «оптимальные конфигурации»; добавить tooltip в UI. |
| R7 | **Обратная совместимость сохранений** | Старые сохранения имеют `processor` без `processorType`/`specialization`/`activeRecipes` | См. §11 — миграция при загрузке (defaults universal). |
| R8 | **`recipes.ts` большой (771 строка)** — ручная маркировка 71 рецепта трудоёмка и подвержена ошибкам | Пропуск категории ломает UI specialize-списка | Написать скрипт `scripts/mark-recipe-categories.ts` или строго прогнать через T5.8. |
| R9 | **`chemistry-generator.ts` (1704 строки)** может поставлять динамические рецепты | Если рецепты генерируются в рантайме, маркировка `processorCategory` нужна и там | Проверить, есть ли генерация процессорных рецептов в `chemistry-generator.ts`. Если да — добавить детерминированное отображение elementId→category. |

---

## 9. Критерии готовности блока

1. **Типы:** `ProcessorType`, `ProcessorRecipeCategory` в `types.ts`; `BuildingDef` расширен `isUniversalProcessor`/`defaultProcessorType`/`baseYield`/`basePurity`/`specializeCost`; `HexCell`/`AtmosphericSlot`/`OrbitalSlot` расширен `processorType`/`specialization`/`specializationLevel`/`activeRecipes`; `RecipeDef` расширен `processorCategory`/`minSpecializationLevel`.
2. **Данные:** 3 здания (`processor`/`synthesizer`/`refinery`) имеют новые поля с правильными ролями; все 71 процессорный рецепт имеют `processorCategory`; `PROCESSOR_CATEGORIES` содержит 7 категорий.
3. **Формулы:** `calculateProcessorOutputMultiplier` реализован и вызывается из `processProductionQueue`; тесты T5.1, T5.2, T5.3 — зелёные.
4. **Апгрейд:** `specializeBuilding` и `upgradeSpecialization` реализованы и вызываются из store; тесты T5.4, T5.5, T5.7 — зелёные.
5. **UI:** в `BuildingDialog` для процессорных зданий показывается тип/специализация/коэф./чистота; `SpecializeDialog` открывается и работает; кнопки disabled при невыполнении условий.
6. **События:** 4 новых события в `EventMap`; эмитятся при specialize/upgrade/activeRecipes-change.
7. **Балансировка:** симуляционный скрипт `scripts/processor-balance-sim.ts` показывает ожидаемые пропорции (см. §7).
8. **Документация:** `docs/40-buildings.md` §3 переписан под 2 типа (правка из `08_27_doc_fixes.md` §4); формулы §11.3 обновлены; §12.1/12.2 — структуры данных актуализированы.
9. **Lint:** 0 ошибок.
10. **Тесты:** 8 тестов (T5.1–T5.8) зелёные.

---

## 10. Порядок внедрения внутри блока

```
PR1 (типы)  ──►  PR2 (данные зданий + рецепты)  ──►  PR5 (таблица категорий)
                                                          │
                                                          ▼
                            PR3 (формулы в engine.ts) ◄──┘
                                       │
                                       ▼
                            PR4 (specializeBuilding)
                                       │
                                       ▼
                            PR7 (events + store actions)
                                       │
                                       ▼
                            PR6 (UI: building-dialog + specialize-dialog)
                                       │
                                       ▼
                            PR8 (балансировка + симуляция)
```

- **PR1 → PR2 → PR5** — чисто данные/типы, можно делать одним коммитом.
- **PR3** — формулы; зависит от PR1/PR2 (нужны новые поля).
- **PR4** — апгрейд; зависит от PR3 (нужен `calculateProcessorOutputMultiplier`) и PR5 (нужна таблица категорий).
- **PR7** — события/store; зависит от PR4 (нужен `specializeBuilding`).
- **PR6** — UI; зависит от PR7 (нужны actions) и PR5 (нужен список категорий).
- **PR8** — балансировка; итеративная, последняя.

Параллельно: правка `docs/40-buildings.md` §3 может делаться до/во время PR2 (контракт должен быть зафиксирован до имплементации).

---

## 11. Обратная совместимость

### 11.1 Миграция существующих сохранений

При загрузке старого сохранения (где `HexCell` не имеет полей `processorType`/`specialization`/`specializationLevel`/`activeRecipes`):

```typescript
// В src/stores/game-store.ts → loadGame / hydration:
function migratePlanet(planet: Planet): Planet {
  for (const hex of planet.hexes) {
    const def = hex.buildingId ? BUILDING_MAP.get(hex.buildingId) : null;
    if (def?.isUniversalProcessor) {
      // Если specialization уже есть — оставляем; иначе defaults
      if (def.defaultProcessorType === 'specialized') {
        // refinery/synthesizer — специализированные по умолчанию
        hex.processorType ??= 'specialized';
        hex.specialization ??= def.defaultSpecialization;
        hex.specializationLevel ??= 1;
      } else {
        // processor — универсальный по умолчанию
        hex.processorType ??= 'universal';
        hex.specialization ??= undefined;
        hex.specializationLevel ??= 0;
      }
      hex.activeRecipes ??= [];
    }
  }
  // Аналогично для atmosphericSlots и orbitSlots.
  // resourcePurity — новая карта, defaults пустой.
  planet.resourcePurity ??= {};
  return planet;
}
```

### 11.2 Старая очередь производства

Старые `ProductionItem` в `productionQueues` продолжают работать — они не имеют полей специализации и обрабатываются как универсальные (множитель universal × 0.75 × 1/√1 = 0.75). Это обратная совместимость на уровне формул: старые сейвы не «ломаются», но выход немного снижается по сравнению с предыдущей версией (где множитель был ×1.0). **Решение:** в `08_27_doc_fixes.md` §4 указать, что это breaking change баланса, и предложить компенсацию игрокам (стартовые ресурсы ×1.1 при первой загрузке после обновления) — если владелец одобрит. Иначе оставить как есть и зафиксировать в changelog.

### 11.3 Идемпотентность миграции

`migratePlanet` безопасна для повторного вызова (использует `??=`). Запускать её в `loadGame` всегда.

---

## Изменённые/созданные файлы

### Правки
- `src/core/types.ts` — новые типы `ProcessorType`, `ProcessorRecipeCategory`; расширение `BuildingDef`, `HexCell`, `AtmosphericSlot`, `OrbitalSlot`, `RecipeDef`.
- `src/data/buildings.ts` — расширение definitions processor/synthesizer/refinery новыми полями.
- `src/data/recipes.ts` — добавление `processorCategory`/`minSpecializationLevel` к ~71 рецепту.
- `src/economy/engine.ts` — `calculateProcessorOutputMultiplier`, интеграция в `processProductionQueue`, `specializeBuilding`, `upgradeSpecialization`, эмит новых событий.
- `src/economy/index.ts` — re-export `specializeBuilding`, `upgradeSpecialization`, `calculateProcessorOutputMultiplier`.
- `src/core/events.ts` — 4 новых события в `EconomyEvents`.
- `src/stores/game-store.ts` — новые actions `specializeBuildingOnHex`, `upgradeSpecializationOnHex`; миграция `migratePlanet` в `loadGame`.
- `src/components/game/building-dialog.tsx` — блок специализации в upgrade mode.
- `docs/40-buildings.md` §3, §11.3, §12.1, §12.2 — правка под 2 типа (см. `08_27_doc_fixes.md` §4).
- `docs/35-warehouse-and-logistics.md` — TODO-комментарий про хранение чистоты.
- `package.json` — добавить `vitest` в devDependencies, `scripts.test = "vitest run"`.

### Созданные
- `src/data/processor-categories.ts` — `PROCESSOR_CATEGORIES`, `ProcessorCategoryDef`.
- `src/components/game/specialize-dialog.tsx` — UI выбора специализации.
- `tests/economy/processors.test.ts` — T5.1–T5.8.
- `scripts/processor-balance-sim.ts` — балансировочный симулятор.

### Контрольные точки
- `checkpoints/08_27_block_05_processors.md` — этот файл.
