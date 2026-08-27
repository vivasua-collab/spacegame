# Чекпоинт: Блок 1 — Стабилизация и технический долг (P1–P7 + тесты + чистота)

**Дата:** 2026-08-27
**Фаза:** Etap 2.5
**Статус:** `pending`
**Зависимости:** нет (фундаментальный блок; все остальные блоки зависят от него)

> 👉 Связанные:
> - [08_27_audit_summary.md](./08_27_audit_summary.md) §3.2 (расхождения) и §3.3 (незавершённость)
> - [08_27_highlevel_plan.md](./08_27_highlevel_plan.md) — Etap 2.5
> - [05_12_dev_plan.md](./05_12_dev_plan.md) — первоначальный план P1–P7
> - `docs/STATUS.md` §4–5

---

## 1. Цель блока

Один функциональный блок: **привести кодовую базу в стабильное, протестированное состояние**, готовое к добавлению флота/исследований/AI через ИИ-агентов. Закрыть 3 критических бага (P1, P2, P3), 4 средних (P4–P7), добавить 5 тестов (T1–T5) и 5 чисток (C1–C5).

**Без этого блока** ИИ-агенты не смогут верифицировать изменения при добавлении новых систем (флот/исследования/AI), что сделает невозможным безопасное переписывание кода.

---

## 2. Спецификация

- `docs/STATUS.md` §4 (расхождения) и §5 (тех. долг)
- `checkpoints/05_12_dev_plan.md` (исходный план P1–P7)
- `docs/00-ARCHITECTURE.md` §3.1 (PRNG, GameLoop)

---

## 3. Текущее состояние кода

| Файл | Проблема | Подтверждение |
|------|----------|---------------|
| `src/data/recipes.ts` (771 строка) | P1: хардкод `Fe-ore`/`Ti-ore` ID, не совпадает с `chemistry-generator` (`hematite`/`ilmenite`) | `recipes.ts:inputs` |
| `src/stores/game-store.ts` | P2: прямые мутации `planet.resources[X] += N` + поверхностный клон `{ ...gameState }` | `game-store.ts:serializeGameState` |
| `src/components/game/building-dialog.tsx` | P3: только surface-слой; нет UI для `buildOnAtmosphereSlot`/`buildOnOrbitSlot` | `building-dialog.tsx` |
| `src/components/game/resource-panel.tsx` | P5: крафтовые материалы в «Прочих» | `resource-panel.tsx` |
| `src/data/buildings.ts` | P6: `colony_hub.costPerLevel: {}` (бесплатно) | `buildings.ts` |
| `src/core/types.ts` | P7: `ElementCategory` включает `transuranic`, но элементов нет | `types.ts:ElementCategory` |
| `src/economy/engine.ts` | DEP-1: использует `@deprecated event-bus.ts`; DEAD-1: `extractOreToElements`; DUP-1: 3 цикла `recalcEnergyBalance`; HARDCODE-1: `ATMOSPHERE_GAS_MAP`/`DIRECT_GAS_MAP` | `engine.ts` |
| `src/core/event-bus.ts` | C1: @deprecated, нужно удалить после перевода engine на typed bus | `event-bus.ts` |
| `src/data/chemistry-generator.ts` (1704 строки) | C5: разбить на модули | `chemistry-generator.ts` |
| Тесты | 0 тестов ❌ | `tests/` (только `scripts/`) |

---

## 4. Подзадачи (детально)

### P1 — Унификация ID руд 🔴 (4 ч)

**Цель:** рецепты крафта используют `oreId` из `BakedGalaxyModel` (динамический lookup), а не хардкод `Fe-ore`/`Ti-ore`.

**Файлы:**
- `src/data/recipes.ts` — заменить хардкод на динамический lookup
- `src/data/baked-lookups.ts` — добавить `getRecipeOreId(elementId): string`
- `scripts/validate-recipes.ts` (новый) — валидация: для каждого рецепта проверить, что все `inputs` существуют в baked model

**Ключевые функции:**
```typescript
// baked-lookups.ts
export function getRecipeOreId(elementId: string): string | undefined {
  return getCurrentLookups().elementToOre.get(elementId);
}

// recipes.ts — заменить { ore: 'Fe-ore' } → { ore: getRecipeOreId('Fe') }
```

**Критерий готовности:** `validate-recipes.ts` проходит без ошибок; крафт Fe-руда → Fe работает.

---

### P2 — Immutable store (zustand-immer) 🔴 (6 ч)

**Цель:** устранить прямые мутации состояния; zustand обернут в immer-мидлвар.

**Файлы:**
- `src/stores/game-store.ts` — обернуть `create()` в `immer()`, переписать `set()` на прямую мутацию (immer создаст иммутабельный клон), убрать ручные `{ ...gameState }` клоны
- `package.json` — убедиться, что `zustand-immer` установлен

**Ключевые изменения:**
```typescript
import { immer } from 'zustand/middleware/immer';
// Было: set({ gameState: { ...gameState, planet: { ...planet, resources: { ...resources, [Fe]: resources[Fe]+10 } } } })
// Стало: set(state => { state.gameState.planet.resources[Fe] += 10; })
```

**Критерий готовности:** линтер не находит прямых мутаций вне immer-сеттера; сохранение/загрузка работает идемпотентно.

---

### P3 — UI для атмосферы/орбиты 🔴 (4 ч)

**Цель:** `BuildingDialog` поддерживает строительство на `AtmosphericSlot` и `OrbitalSlot` (не только surface).

**Файлы:**
- `src/components/game/building-dialog.tsx` — добавить вкладки «Поверхность» / «Атмосфера» / «Орбита»
- `src/components/game/planet-view.tsx` — визуализация занятости atmospheric/orbit слотов

**Ключевые функции (из `engine.ts`):**
- `buildOnAtmosphereSlot(planetId, slotIndex, buildingId)`
- `buildOnOrbitSlot(planetId, slotIndex, buildingId)`

**UI:** фильтрация зданий по `layer: ['surface' | 'atmosphere' | 'orbit']`.

**Критерий готовности:** на газовом гиганте можно построить `gas_extractor` на atmospheric-слоте; `spaceport` на orbit-слоте.

---

### P4 — UI очереди производства 🟡 (6 ч)

**Цель:** игрок может добавлять/просматривать/отменять задания в очереди производства через интерфейс.

**Файлы:**
- `src/components/game/production-queue-panel.tsx` (новый) — список доступных рецептов по зданиям, кнопка «Добавить», прогресс-бар, автоповтор, отмена
- `src/components/game/planet-view.tsx` — новая вкладка «Производство»

**Ключевые функции (из `engine.ts`):**
- `enqueueProduction(planetId, recipeId, count, repeat)`
- `cancelProduction(planetId, queueIndex)`

**Критерий готовности:** можно поставить `steel` в очередь на `processor`, видеть прогресс, отменить.

---

### P5 — ResourcePanel: крафтовые материалы 🟡 (2 ч)

**Цель:** крафтовые материалы (steel, microchip, superconductor) показываются с правильной категорией, а не в «Прочих».

**Файлы:**
- `src/core/types.ts` — добавить `'crafted'` в `ElementCategory`
- `src/data/element-helpers.ts` — `CATEGORY_LABELS['crafted'] = 'Синтезированные'`, `CATEGORY_COLORS['crafted']`
- `src/data/crafted-materials.ts` (новый) — `CRAFTED_MATERIALS` map: `{ steel: { name, category: 'crafted', icon, ... } }`
- `src/components/game/resource-panel.tsx` — lookup в `CRAFTED_MATERIALS` если не найден в `ELEMENT_MAP`

**Критерий готовности:** steel, microchip, superconductor видны в панели «Синтезированные» с иконками.

---

### P6 — Colony Hub: стоимость апгрейда 🟡 (1 ч)

**Цель:** апгрейд `colony_hub` стоит ресурсы (устранение эксплойта).

**Файлы:**
- `src/data/buildings.ts` — `colony_hub.costPerLevel: { Fe: 10, Si: 5, Al: 3 }` (с масштабированием по уровню)

**Критерий готовности:** апгрейд colony_hub с L1 → L2 списывает ресурсы; недостаток ресурсов блокирует апгрейд.

---

### P7 — Убрать мёртвый тип `transuranic` 🟢 (0.5 ч) — ✅ ВЫПОЛНЕНО

**Цель:** либо добавить трансурановые элементы (Np, Pu, Am), либо убрать `'transuranic'` из `ElementCategory`.

**Решение (предпочтительное):** добавить элементы Np, Pu, Am (Нептуний, Плутоний, Америций) — это расширит игру и сохранит тип. (Если владелец решит иначе — убрать из `ElementCategory` и из `element-helpers.ts`.)

**Файлы:**
- `src/data/elements.ts` — добавить Np, Pu, Am (если расширяем)
- `docs/32-mendeleev.md` — добавить в таблицу (если расширяем)

**Критерий готовности:** `transuranic` либо используется (≥1 элемент), либо убран из `ElementCategory`.

**Статус:** ✅ Выполнено (см. `08_27_block_01_progress.md`). Добавлены Np, Pu, Am. Всего элементов: 60 (57 + 3 трансурановых).

---

### T1–T5 — Тесты 🔴 (8 ч)

**Цель:** 5 детерминированных тестов, покрывающих фундаментальные системы.

| # | Тест | Файл | Что проверяет |
|---|------|------|---------------|
| T1 | PRNG детерминизм | `tests/prng.test.ts` | seed → одинаковая последовательность; распределение 4-х `derive()` независимо |
| T2 | Snapshot генерации галактики | `tests/galaxy-snapshot.test.ts` | seed=X → ожидаемая структура (количество систем, типы звёзд) |
| T3 | Экономика: добыча → крафт → энергия | `tests/economy.test.ts` | `processExtraction` даёт руду; `processProductionQueue` даёт продукт; `recalcEnergyBalance` считает правильно |
| T4 | Chemistry-generator: молярные массы | `tests/chemistry.test.ts` | ID руд консистентны с `baked-lookups`; молярные массы корректны |
| T5 | Сериализация: save → load → equals | `tests/serialization.test.ts` | `serializeGameState(gameState) → parse → equals(gameState)` |

**Инфраструктура:** использовать `bun test` (Bun встроенный); тесты в `tests/` (создать, если нет).

**Критерий готовности:** `bun test` проходит 5/5; CI-готовность.

---

### P8 — Complex gas recipes 🔴 (gap-2 из аудита §2.3) (2 ч)

**Цель:** добавить рецепты для атмосферных соединений CO₂, CH₄, NH₃, H₂S, SO₂, которые сейчас копятся в складе как мусор (audit §2.3 — gameplay-блокер #1).

**Файлы:**
- `src/data/recipes.ts` (или `src/data/recipe-generator.ts` после Блока 01 P1) — добавить 5 рецептов:

```typescript
// CO₂ → C (2.7) + O (7.3) — время 150, энергия 4
{ id: 'process_CO2', buildingId: 'processor', inputs: { 'CO2': 10 }, outputs: { 'C': 2.7, 'O': 7.3 }, time: 150, energy: 4 },
// CH₄ → C (2.5) + H (7.5)
{ id: 'process_CH4', buildingId: 'processor', inputs: { 'CH4': 10 }, outputs: { 'C': 2.5, 'H': 7.5 }, time: 150, energy: 4 },
// NH₃ → N (5.6) + H (4.4)
{ id: 'process_NH3', buildingId: 'processor', inputs: { 'NH3': 10 }, outputs: { 'N': 5.6, 'H': 4.4 }, time: 150, energy: 4 },
// H₂S → H (2.5) + S (7.5)
{ id: 'process_H2S', buildingId: 'processor', inputs: { 'H2S': 10 }, outputs: { 'H': 2.5, 'S': 7.5 }, time: 150, energy: 4 },
// SO₂ → S (5.0) + O (5.0)
{ id: 'process_SO2', buildingId: 'processor', inputs: { 'SO2': 10 }, outputs: { 'S': 5.0, 'O': 5.0 }, time: 150, energy: 4 },
```

**Критерий готовности:** на планете с co2/methane/toxic атмосферой газовый экстрактор производит CO₂/CH₄/... → processor перерабатывает в C + O + ... → в складе нет «мусорных» газов.

**Зависимость:** Блок 01 P1 (если recipes.ts мигрирует на recipe-generator.ts — рецепты сложных газов тоже должны быть в generator, а не в хардкод-recipes.ts).

---

### P9 — ProductionItem deterministic IDs 🟡 (gap-6 из аудита §2.3) (1 ч)

**Цель:** устранить недетерминизм в `engine.ts:532` — `id: \prod_{Date.now()}}_{Math.random().toString(36).slice(2, 6)}` — нарушает принцип детерминизма игры.

**Файлы:**
- `src/economy/engine.ts` — заменить генерацию ID:
  - Использовать счётчик: `id: \`item-${planetId}-${queueCounter++}\`` (глобальный или на planet).
  - Альтернатива: `id: \`item-${planetId}-${queue.length}-${tick}\`` (детерминированный по позиции).
- Добавить `let queueCounter = 0` в module scope (или `productionQueues.counter`).

**Критерий готовности:** для одинакового seed и одинаковой последовательности actions — ProductionItem IDs одинаковые. T1 (PRNG) + новый T7 не выявляют недетерминизма.

---

### C6 — warehouse.ts dead comparisons cleanup 🟡 (gap-5 из аудита §2.3) (0.5 ч)

**Цель:** убрать мёртвый код в `warehouse.ts:275-279` — сравнения `category === 'platinoid' || category === 'rare_earth'`, которые всегда false (это значения `ChemicalCharacter`, а не `ElementCategory`).

**Файлы:**
- `src/data/warehouse.ts` — удалить две dead-проверки (или заменить на корректные: `chemicalCharacter === 'platinoid' || chemicalCharacter === 'rare_earth'`).

**Критерий готовности:** `grep -n "platinoid\|rare_earth" src/data/warehouse.ts` — либо отсутствует, либо в правильном месте (сравнение с `chemicalCharacter`, не с `category`).

---

### C7 — processProductionQueue emit on cancellation 🟡 (gap-7 из аудита §2.3) (1 ч)

**Цель:** `engine.ts:243-268` — при удалении элемента из очереди (не хватает ресурсов) эмитить событие `economy:production-cancelled` с `{ recipeId, reason: 'insufficient_inputs', queueItemId }`.

**Файлы:**
- `src/economy/engine.ts` — добавить `bus.emit('economy:production-cancelled', { ... })` перед `queue.splice(i, 1)`.
- UI в Блоке 01 P4 — подписаться на это событие → показывать toast «Рецепт X отменён: не хватает Y».

**Критерий готовности:** при отмене рецепта из-за нехватки ресурсов — UI показывает уведомление (не silent loss).

**Зависимость:** Блок 06 (modular integration) — без typed bus событие уходит в пустоту.

---

### C8 — nuclear_reactor rename 🟢 (gap-11 из аудита §3.2) (0.5 ч)

**Цель:** синхронизировать ID ядерного реактора: `nuclear_reactor` (40-buildings.md §10.1) vs `nuclear_plant` (buildings.ts:122).

**Решение:** переименовать в коде с `nuclear_plant` → `nuclear_reactor` (документация — источник истины).

**Файлы:**
- `src/data/buildings.ts` — `id: 'nuclear_reactor'` (вместо `'nuclear_plant'`).
- `src/economy/engine.ts` — grep на `'nuclear_plant'` → заменить.
- Любые UI или store ссылки на `'nuclear_plant'` → заменить.

**Критерий готовности:** `grep -rn "nuclear_plant" src/` → 0 результатов.

---

### C9 — a11y improvements 🟡 (gap-10 из аудита §2.3) (4 ч)

**Цель:** устранить a11y-проблемы, выявленные в аудите §2.3:
- Кнопки без `aria-label` (`galaxy-map.tsx:458-463` — zoom controls).
- Tab buttons без `role="tab"`, `aria-selected`, `aria-controls` (`planet-view.tsx:132-149`).
- SVG без `role="img"` / `aria-label` (карта галактики, гекс-сетка).
- `confirm()` в `game-layout.tsx:86` — блокирующий native dialog вместо `AlertDialog` из shadcn/ui.

**Файлы:**
- `src/components/game/galaxy-map.tsx` — добавить `aria-label` на zoom-in/zoom-out кнопки.
- `src/components/game/planet-view.tsx` — добавить `role="tab"`, `aria-selected`, `aria-controls` на табы.
- `src/components/game/galaxy-map.tsx` + `src/components/game/planet-view.tsx` — SVG `role="img"` + `<title>` + `aria-label`.
- `src/components/game/game-layout.tsx:86` — заменить `confirm()` на shadcn `AlertDialog`.

**Критерий готовности:** Lighthouse a11y score ≥ 90; ручной скрин-ридер проходка по основным экранам.

---

### T7 — PRNG reference conformance 🟡 (gap-3 из аудита §2.3) (1 ч)

**Цель:** тест, проверяющий, что порт `xoshiro256**` соответствует reference implementation Vigna.

**Файлы:**
- `tests/prng-reference.test.ts` (новый) —
  - Известный тест-вектор: для seed `[1, 2, 3, 4]` → первые 5 чисел должны совпадать с эталонной реализацией.
  - Сверка с C-reference Vigna: для seed `[0x9E3779B97F4A7C15, ...]` → первые 100 чисел сравниваются с выходом C-кода.

**Критерий готовности:** тест зелёный. Если порт неверный (gap-3) — тест красный; правка в Блоке 07.

**Зависимость:** Блок 07 (PRNG port fix).

---

### C1–C5 — Чистота кода 🟢 (8 ч)

| # | Задача | Файл | Время |
|---|--------|------|-------|
| C1 | Удалить `@deprecated event-bus.ts`; перевести `engine.ts` на `TypedEventBus` | `src/core/event-bus.ts` (удалить), `src/economy/engine.ts` | 1 ч |
| C2 | Удалить `@deprecated extractOreToElements` | `src/economy/engine.ts` | 0.5 ч |
| C3 | Вынести `ATMOSPHERE_GAS_MAP`, `DIRECT_GAS_MAP` в `src/data/` | `src/data/atmosphere-gases.ts` (новый), `src/economy/engine.ts` | 1 ч |
| C4 | Объединить 3 цикла `recalcEnergyBalance` в один | `src/economy/engine.ts:284-350` | 2 ч |
| C5 | Разбить `chemistry-generator.ts` (1704 строки) на модули | `src/data/chemistry/` (новый каталог): `ore-generator.ts`, `atmosphere-generator.ts`, `ice-generator.ts`, `baked-model.ts`, `index.ts` | 4 ч |

**Критерий готовности:** `@deprecated` удалён; хардкод вынесен; `chemistry-generator.ts` ≤ 300 строк на файл; lint=0.

---

## 5. События typed-bus (новые)

Не требуются — блок стабилизации не добавляет фич, а исправляет существующие. Возможные события для UI-обновления:
- `ui:production-queue-changed` (P4)
- `ui:resource-panel-updated` (P5)

(Использовать существующий механизм `TypedEventBus.emit` + подписку в компонентах.)

---

## 6. UI-компоненты

- `src/components/game/production-queue-panel.tsx` (новый, P4)
- `src/components/game/building-dialog.tsx` (правка, P3)
- `src/components/game/planet-view.tsx` (правка, P3 — вкладки)
- `src/components/game/resource-panel.tsx` (правка, P5)

---

## 7. Тесты

T1–T5 описаны в §4. После P2 (immutable store) добавить T6: `state.planet.resources[Fe] += 10` не мутирует старое состояние (иммутабельность).

---

## 8. Риски и зависимости

| Риск | Митигация |
|------|-----------|
| P1 может сломать существующие сохранения (другие ID руд) | Миграция: при загрузке старых сейвов конвертировать `Fe-ore` → `getRecipeOreId('Fe')` |
| P2 (immer) меняет семантику всех `set()` | Тщательно переписать, прогнать T5 (сериализация) |
| C5 (разбить chemistry-generator) может внести баги | Сохранить T4 (химия) зелёным; делать по одному модулю |
| Тесты могут выявить скрытые баги | Хорошо — фиксим, не откладываем |

---

## 9. Критерии готовности блока

- [ ] P1: `validate-recipes.ts` проходит; крафт работает.
- [ ] P2: нет прямых мутаций; T6 зелёный.
- [ ] P3: газовый экстрактор строится на atmospheric-слоте газового гиганта.
- [ ] P4: очередь производства видна и управляема.
- [ ] P5: steel/microchip в «Синтезированных».
- [ ] P6: апгрейд colony_hub стоит ресурсы.
- [ ] P7: `transuranic` либо используется, либо убран.
- [ ] T1–T5: `bun test` проходит 5/5.
- [ ] C1–C5: `@deprecated` удалён, хардкод вынесен, `chemistry-generator` разбит.
- [ ] Lint: 0 ошибок.
- [ ] Существующие сохранения загружаются (с миграцией при P1).

---

## 10. Порядок внедрения внутри блока

```
P1 (ID руд) ──► P7 (transuranic) ──► P5 (crafted) ──► P6 (colony hub)
                                                              │
P2 (immutable store) ──► T6 (immutability test) ──────────────┤
                                                              │
C1 (delete deprecated bus) ──► C2 (dead code) ──► C3 (hardcode) ──► C4 (recalcEnergy) ──► C5 (split chemistry) ──► T4 (chemistry test)
                                                              │
P3 (atmosphere/orbit UI) ──► P4 (production queue UI)         │
                                                              ▼
                                          T1 (PRNG) ──► T2 (snapshot) ──► T3 (economy) ──► T5 (serialization)
```

**Фазы:**
1. **Data fixes (легко):** P1, P5, P6, P7, C2, C3 — 1 день.
2. **Architecture (тяжело):** P2 (immer), C1 (typed bus), C4 (recalc), C5 (split) — 2–3 дня.
3. **UI:** P3, P4 — 1.5 дня.
4. **Tests:** T1–T6 — 1 день.

**Итого: ~5–6 рабочих дней.**

---

## 11. Обратная совместимость

- **P1 миграция:** при загрузке сейва с `Fe-ore` в `planet.resources` → конвертировать в `hematite` (lookup по элементу).
- **P2:** immer не ломает формат сохранения (только внутреннее представление состояния).
- **C5:** `chemistry-generator` API остаётся совместимым (реэкспорт из `chemistry/index.ts`).

---

## Изменённые/созданные файлы

**Изменяемые:**
- `src/data/recipes.ts` (P1)
- `src/data/baked-lookups.ts` (P1)
- `src/data/elements.ts` (P7, если расширяем)
- `src/data/buildings.ts` (P6)
- `src/data/element-helpers.ts` (P5)
- `src/core/types.ts` (P5, P7)
- `src/stores/game-store.ts` (P2)
- `src/economy/engine.ts` (C1, C2, C3, C4)
- `src/components/game/building-dialog.tsx` (P3)
- `src/components/game/planet-view.tsx` (P3, P4)
- `src/components/game/resource-panel.tsx` (P5)

**Новые:**
- `src/components/game/production-queue-panel.tsx` (P4)
- `src/data/crafted-materials.ts` (P5)
- `src/data/atmosphere-gases.ts` (C3)
- `src/data/chemistry/` каталог (C5): `ore-generator.ts`, `atmosphere-generator.ts`, `ice-generator.ts`, `baked-model.ts`, `index.ts`
- `scripts/validate-recipes.ts` (P1)
- `tests/prng.test.ts` (T1)
- `tests/galaxy-snapshot.test.ts` (T2)
- `tests/economy.test.ts` (T3)
- `tests/chemistry.test.ts` (T4)
- `tests/serialization.test.ts` (T5)
- `tests/immutability.test.ts` (T6)

**Удаляемые:**
- `src/core/event-bus.ts` (C1, после перевода engine на typed bus)
