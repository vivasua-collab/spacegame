# Чекпоинт: Блок 3 — Исследования и технологии MVP

**Дата:** 2026-08-27
**Фаза:** Etap 3.0
**Статус:** `pending`
**Зависимости:** Блок 1 (стабилизация P1–P7 + тесты) — обязательно; Блок 5 (переработчики) — желательно (для рецептов `steel`, `microchip` под M1/C5), но не блокирующе.

> 👉 Связанные документы:
> - [audit_summary](./08_27_audit_summary.md) — сводный аудит (§3.1: «60-research.md — ❌ 0% реализации»)
> - [highlevel_plan](./08_27_highlevel_plan.md) — Etap 3.0: флот + исследования
> - `docs/60-research.md` (1351 строка) — полная спецификация исследований: 6 веток × 12 технологий = 72, формулы RP/слотов/фокуса, DAG-преквизиты
> - `docs/research-unification.md` (638 строк) — двухуровневая система (фундаментальные ↔ специализированные), `BranchLink` и формулы потолков
> - `docs/00-ARCHITECTURE.md` §3.2.1 — фундаментальные ветки (Химия/Физика/Инженерия/Биология/Военные/Ксеноархеология)
> - `docs/40-buildings.md` §10.1 — здание `laboratory` (строка 1060): категория «Наука», 10 ур., +10% к смежной лаборатории
> - [block_01_stabilization](./08_27_block_01_stabilization.md) — должен закрыть P2 (immutable store) до начала Блока 3
> - [block_02_fleet](./08_27_block_02_fleet.md) — параллельный блок; tech-эффекты (`P2 ion_engine`) в будущем влияют на корабли

---

## 1. Цель блока

Реализовать **MVP системы исследований** — функциональный слой, в котором игрок:
1. Строит здание «Лаборатория» (`laboratory`) на планетах.
2. Накапливает очки исследований (RP/sec), производимые лабораториями.
3. Распределяет RP между параллельными слотами исследований с процентной аллокацией.
4. Исследует фундаментальные ветки (открывают + ограничивают потолок специализированных) и специализированные технологии по DAG-зависимостям.
5. Видит визуальное дерево технологий, прогресс, преквизиты, состояние (изучена/доступна/заблокирована/в процессе).
6. Получает разблокировки (зданий/рецептов/модулей) при завершении исследований.

**Что НЕ входит в MVP (выносится в Etap 4):**
- Полное дерево 72 технологий (Блок 3 реализует **15**).
- Артефакты и руины (`60-research.md` §7) — Etap 4.
- Торговля технологиями (`60-research.md` §8) — Etap 4 (зависимость от Блока 4 AI-фракций).
- Ксеноархеология (ветка X, требует `C2` и `B3` — заложены как фундамент для Etap 4).
- Терраформирование как активный процесс (B4/B7/B10 эффекты заглушены до Etap 4).
- Конструктор кораблей с модулем-привязкой tech-эффектов (Etap 4, Блок 2 → Блок 3 кооперация).
- Кластерные бонусы смежных лабораторий (40-buildings §5) — отложены, MVP использует линейную формулу.

---

## 2. Спецификация

### 2.1 Источники истины

| Документ | Раздел | Что покрывает |
|----------|--------|---------------|
| `docs/60-research.md` | §1 Обзор | Принципы, связь с другими системами |
| | §2.1 6 специализированных веток | `power`, `materials`, `weapons`, `computing`, `biology`, `xenoarch` |
| | §3 Механика | RP/sec, стоимость `baseCost × 1.5^(N-1)`, слоты `1 + floor(labs/10)`, фокус-бонус +20%, мин. время `baseCost/1000` сек |
| | §4 Уровни технологий | Линейный/Прогрессивный/Пороговый/Убывающий |
| | §5 Преквизиты | `tech_id >= N` (DAG, до 3 AND, без OR) |
| | §5.4 Состояния UI | 🟢 изучена / 🔵 доступна / 🟡 частично / 🔴 заблокирована / 🔄 в процессе |
| | §6.1–6.6 Деревья | P1–P12, M1–M12, W1–W12, C1–C12, B1–B12, X1–X12 |
| | §9.1 TypeScript-типы | `interface Technology`, `Prerequisite`, `TechEffect` |
| | §9.2–9.12 Функции | `getTechCost`, `getLabRPPerSec`, `getMaxResearchSlots`, `getFocusBonus`, `getEffectiveRPPerSec`, `getMinResearchTime`, `arePrerequisitesMet`, `validateTechTree`, `getBranchLevel` |
| `docs/research-unification.md` | §3 Таблица соответствия | Маппинг фундаментальная ↔ специализированная |
| | §4 Правила доступа | Primary unlock + ceiling, Secondary ceiling `floor(×1.5)`, Partial bonus `+5%/ур.`, свободная ветка |
| | §7 Структуры данных | `BranchLink`, `FundamentalBranch`, `BRANCH_LINKS`, `getPrimaryLink`, `getSecondaryLink`, `getPartialLinks`, `isSpecializedUnlocked`, `getEffectiveMaxLevel`, `getPartialBonus` |
| `docs/00-ARCHITECTURE.md` | §3.2.1 | 6 фундаментальных веток, базовая стоимость 200 RP |
| `docs/40-buildings.md` | §10.1 строка 1060 | `laboratory`: категория «Наука», уровни 1–10, +10% к смежной лаб. |

### 2.2 Ключевые правила MVP (выдержки)

- **RP/сек лаборатории**: `base_output(5) × level × (1 + habitabilityPercent/500)` — макс. +20% при 100% габитабельности (`60-research.md` §3.1, §9.4).
- **Стоимость уровня N**: `floor(baseCost × 1.5^(N-1))` (§4.2, §9.2).
- **Кумулятивная стоимость до уровня N**: Σ `getTechCost(level)` (§9.3).
- **Макс. параллельных слотов**: `min(1 + floor(totalLabs/10), 10)` (§3.4, §9.5).
- **Фокус-бонус**: при `activeSlots == 1 && allocation == 100%` → ×1.2 (§3.5, §9.6).
- **Минимальное время**: `max(baseCost/1000, 10)` сек (§9.8) — защита от мгновенного «закупа».
- **DAG-валидация**: при загрузке дерева проверять (а) существование преквизитов, (б) отсутствие самозависимостей, (в) отсутствие циклов через DFS (§9.11).
- **Потолок специализированной ветки**:
  ```
  effectiveMax(specialized) = min(primaryLevel, floor(secondaryLevel × 1.5))
  partialBonus(specialized) = 1.0 + 0.05 × partialLevel
  ```
  Свободная ветка (`computing`) → `Infinity` потолок, только partial-бонус от Химии (`research-unification.md` §4.3, §7.3).

### 2.3 MVP-срез дерева (15 технологий + 5 фундаментальных веток)

Из 72 специфицированных выбираем **15 специализированных** технологий, покрывающих все 5 из 6 фундаментальных веток и все 4 типа `BranchLink`-связей:

| # | ID | Ветка | Базовая стоимость | Преквизиты | Связь фундам. |
|---|----|-------|-------------------|------------|---------------|
| **Фундаментальные (5 веток, базовая стоимость 200 RP)** |
| F1 | `chemistry` | — | 200 | — | primary → `materials`; partial → `computing` |
| F2 | `physics` | — | 200 | — | primary → `power` |
| F3 | `engineering` | — | 200 | — | secondary → `materials`; partial → `weapons` |
| F4 | `biology_fund` | — | 200 | — | primary → `biology` |
| F5 | `military_science` | — | 200 | — | primary → `weapons` |
| **Специализированные (15 технологий)** |
| P1 | `fusion_reactor` | power | 500 | — | потолок ≤ `physics` |
| P2 | `ion_engine` | power | 800 | P1≥1 | потолок ≤ `physics` |
| P3 | `power_systems` | power | 600 | P1≥1 | потолок ≤ `physics` |
| M1 | `steel_processing` | materials | 300 | — | потолок ≤ min(`chemistry`, floor(`engineering`×1.5)) |
| M2 | `light_alloys` | materials | 500 | M1≥1 | то же |
| M3 | `composites` | materials | 800 | M1≥2, M2≥1 | то же |
| M5 | `superconductors` | materials | 1 500 | M1≥2, C1≥1 | то же; кросс-веточный преквизит (computing) |
| W1 | `ballistic_weapons` | weapons | 400 | — | потолок ≤ `military_science`; partial-бонус от `engineering` |
| W2 | `laser_weapons` | weapons | 700 | W1≥2, C1≥1 | то же; кросс-веточный преквизит (computing) |
| W5 | `fleet_tactics` | weapons | 600 | W1≥1 | то же |
| C1 | `microelectronics` | computing | 300 | — | **свободная ветка**; partial-бонус от `chemistry` |
| C2 | `short_range_sensors` | computing | 500 | C1≥1 | то же |
| C3 | `communication_systems` | computing | 600 | C1≥1 | то же |
| B1 | `hydroponics` | biology | 300 | — | потолок ≤ `biology_fund` |
| B2 | `ecological_adaptation` | biology | 500 | B1≥1 | то же |

**Почему этот срез:** демонстрирует (а) все 4 BranchLink-типа (primary/secondary/partial/free), (б) кросс-веточные преквизиты (M5←C1, W2←C1), (в) каскадные DAG-цепочки (M1→M2→M3, C1→C2/C3, P1→P2/P3), (г) свободную ветку без потолка. Полный список 72 — Etap 4.

> Ксеноархеология (`xenoarch`) и ветка X исключены из MVP — требуют `C2≥1, B3≥2, X1` и т.д., а также механики руин (Etap 4). Базовая фундаментальная `xenoarchaeology` (200 RP) может быть добавлена как «призрак» (без специализированной ветки) для UI-целей, но в MVP не включается.

---

## 3. Текущее состояние кода

### 3.1 Что есть ✅

- **Модульная архитектура** (`src/core/typed-event-bus.ts`, `module-registry.ts`, `game-mediator.ts`, `module-types.ts`) — 2 модуля-гражданина: `EconomyModule`, `GalaxyModule`.
- **Карта событий** (`src/core/events.ts`) — включает заглушку `TechEvents` с **3 событиями**: `tech:research-started`, `tech:research-completed`, `tech:unlocked`. payload: `{ techId, factionId, etaTick/level/unlocks }`.
- **`BuildingCategory`** в `src/core/types.ts:184` — включает `'research'` (но ни одного здания этой категории нет).
- **`ColonyRole`** в `src/core/types.ts:354` — включает `'research'` (используется для пресета склада, но не для собственно исследований).
- **Pattern модуля**: `EconomyModule` (`src/economy/economy-module.ts`) — образец для копирования: `setGameStateAccessor`, `manifest` (emits/subscribes/handlesQueries/requiresQueries), `onTick`, `findPlanet`.
- **Pattern store**: `src/stores/game-store.ts` — Zustand-стор с делегированием медиатору; есть `serializeGameState` / `deserializeGameState` для save/load.
- **UI layout**: `src/components/game/game-layout.tsx` — левая навигация (`NavButton`) с переключением видов `galaxy | system | planet`; легко добавить `research`.
- **`60-research.md` §9** — готовые TypeScript-типы и функции (не реализованы в коде, но описаны).

### 3.2 Чего нет ❌

| Что | Где должно быть | Статус |
|-----|-----------------|--------|
| Типы `Technology`, `Prerequisite`, `TechEffect`, `BranchLink`, `FundamentalBranch`, `ResearchState`, `ResearchSlot`, `ResearchProgress` | `src/core/types.ts` | отсутствуют |
| Файл данных `TECH_TREE`, `BRANCH_LINKS`, `FUNDAMENTAL_BRANCHES` | `src/data/research.ts` | файл не существует |
| Функции `getTechCost`, `getLabRPPerSec`, `getMaxResearchSlots`, `getFocusBonus`, `arePrerequisitesMet`, `validateTechTree`, `getBranchLevel`, `getEffectiveMaxLevel`, `getPartialBonus`, `processResearchTick` | `src/research/engine.ts` | файл не существует |
| Модуль `ResearchModule` (IGameModule-гражданин) | `src/research/research-module.ts` | не существует |
| Здание `laboratory` | `src/data/buildings.ts` | отсутствует (см. §3.3) |
| Поле `researchState` в `GameState` | `src/core/types.ts:470` | отсутствует |
| Стор-действия исследований | `src/stores/game-store.ts` | отсутствуют |
| События `tech:allocation-changed`, `tech:slot-added`, `tech:fundamental-leveled`, `tech:prerequisites-met`, `tech:tree-validated` | `src/core/events.ts:88–92` | отсутствуют |
| UI-компоненты дерева и очереди исследований | `src/components/game/research-*.tsx` | не существуют |
| Тесты на research | `tests/research.*.test.ts` | не существуют (тест-инфраструктура — Блок 1) |

### 3.3 Здание `laboratory` — текущее состояние

`src/data/buildings.ts` содержит **13 зданий**: `colony_hub`, `mine`, `quarry`, `gas_extractor`, `processor`, `synthesizer`, `refinery`, `solar_plant`, `nuclear_plant`, `shipyard`, `warehouse`, `open_warehouse`, `high_tech_storage`, `spaceport`.

Ни одного здания с `category: 'research'` нет. `CATEGORY_NAMES['research']` и `CATEGORY_ICONS['research']` уже определены (🔬) — UI готов отображать категорию при наличии здания.

`docs/40-buildings.md` §10.1 (строка 1060) фиксирует:
- `id: 'laboratory'`, категория «Наука», уровни 1–10, энергопотребление 10 ед./тик на ур.1 (×0.55 на ур.10 = 5.5 уд.), выход «Очки исследования», +10% к смежной лаборатории (кластерный эффект — отложен в MVP).

---

## 4. Подзадачи (детально)

### R1. Данные: дерево технологий (MVP-срез)

**Цель:** Создать immutable-источник истины для 15 специализированных + 5 фундаментальных веток + `BRANCH_LINKS` (8 связей).

**Файлы для изменения:**
- `src/core/types.ts` — добавить типы:
  ```ts
  export type SpecializedBranchId = 'power' | 'materials' | 'weapons' | 'computing' | 'biology' | 'xenoarch';
  export type FundamentalBranchId = 'chemistry' | 'physics' | 'engineering' | 'biology_fund' | 'military_science' | 'xenoarchaeology';
  export type BranchLinkType = 'primary' | 'secondary' | 'partial';
  export type TechImprovementType = 'linear' | 'progressive' | 'threshold' | 'diminishing';

  export interface BranchLink { fundamentalId: FundamentalBranchId; specializedId: SpecializedBranchId; linkType: BranchLinkType; }
  export interface FundamentalBranch { id: FundamentalBranchId; name: string; nameEn: string; description: string; baseCost: number; maxLevel: number; }
  export interface Prerequisite { techId: string; minLevel: number; }
  export interface TechEffect { target: string; operation: 'multiply' | 'add' | 'unlock'; value: number; perLevel: boolean; thresholdLevel?: number; }
  export interface Technology {
    id: string; name: string; nameEn: string; branch: SpecializedBranchId;
    baseCost: number; maxLevel: number; improvementType: TechImprovementType;
    improvementPerLevel: number; prerequisites: Prerequisite[];
    effects: TechEffect[]; description: string; icon: string; sortOrder: number;
  }
  export interface ResearchProgress { techId: string; currentLevel: number; rpInvested: number; }
  export interface ResearchSlot { slotId: string; techId: string; targetLevel: number; allocationPercent: number; rpInvested: number; }
  export interface ResearchState {
    fundamentalLevels: Record<FundamentalBranchId, number>; // 0..10
    fundamentalRpInvested: Partial<Record<FundamentalBranchId, number>>;
    researched: Record<string, number>; // techId → currentLevel (0 = не изучена)
    activeSlots: ResearchSlot[]; // длина ≤ getMaxResearchSlots(totalLabs)
    totalRpGenerated: number; // монотонный счётчик для отладки
  }
  ```
- `src/data/research.ts` (новый файл) — экспорты:
  - `BRANCH_LINKS: BranchLink[]` — 8 связей из `research-unification.md` §7.2.
  - `FUNDAMENTAL_BRANCHES: FundamentalBranch[]` — 5 веток MVP (`chemistry`, `physics`, `engineering`, `biology_fund`, `military_science`; `xenoarchaeology` как disabled/призрак).
  - `TECH_TREE: Technology[]` — 15 технологий MVP (см. таблицу §2.3).
  - `BRANCH_COLORS: Record<SpecializedBranchId, string>` — `power=#ef4444`, `materials=#f97316`, `weapons=#eab308`, `computing=#3b82f6`, `biology=#22c55e`, `xenoarch=#a855f7` (по `60-research.md` §2.1).
  - `STARTER_TECH_IDS: string[]` = `['fusion_reactor','steel_processing','ballistic_weapons','microelectronics','hydroponics']`.

**Ключевые функции (чистые, без side-эффектов):** выносятся в `src/research/engine.ts` (см. R3).

**Оценка времени:** ~3–4 часа (типы + 15 тех + 5 фундаменталов + 8 связей + цвета).

**Критерии готовности R1:** `TECH_TREE.length === 15`, `FUNDAMENTAL_BRANCHES.length === 5` (+1 призрак), `BRANCH_LINKS.length === 8`, `validateTechTree(TECH_TREE)` возвращает `[]`.

---

### R2. Здание «Исследовательская лаборатория»

**Цель:** Добавить `laboratory` в `BUILDINGS` так, чтобы игрок мог его строить на колонизированных планетах и получать RP/сек.

**Файлы для изменения:**
- `src/data/buildings.ts` — добавить в `BUILDINGS` (после `spaceport`):
  ```ts
  {
    id: 'laboratory',
    name: 'Лаборатория',
    description: 'Производит очки исследований (RP). Базовый выход: 5 RP/сек × уровень × (1 + габитабельность/500).',
    category: 'research',
    layer: ['surface'],
    size: ['small', 'medium', 'large', 'huge'],
    energyConsumption: 10,
    baseProductionTime: 0, // RP — потоковый, не занимает цикл производства
    levels: 10,
    costPerLevel: { Fe: 30, Si: 20, Cu: 5 }, // из 40-buildings §10.1: 30/20/5/0
    terrainBonus: {},
    requiresAtmosphere: false,
  },
  ```
- `src/components/game/building-dialog.tsx` — добавить обработку категории `'research'`: вместо строки «Energy: +10/tick» показывать `RP: +5/сек × ур. × (1+габ/500)`; расчёт через `getLabRPPerSec(level, 5, planetHabitability)`.

**Внимание:** поле `habitabilityPercent` планеты сейчас не вычислено в типе `Planet` (есть только `life` со `biodiversity`). Для MVP принимать `habitabilityPercent = 0` (нейтральный бонус) с TODO-комментарием; полностью интегрировать после Etap 4 терраформирования.

**Оценка времени:** ~1 час.

**Критерии готовности R2:** `BUILDING_MAP.get('laboratory')` существует; `BuildingDialog` корректно показывает RP/сек; `laboratory` появляется в списке доступных для строительства зданий на планете.

---

### R3. Очередь исследований (research queue, прогресс, завершение)

**Цель:** Реализовать движок исследований (чистые функции + обработка тика).

**Файлы для изменения:**
- `src/research/engine.ts` (новый файл) — экспорт чистых функций (прямая реализация `60-research.md` §9):
  - `getTechCost(baseCost: number, level: number): number` — §9.2.
  - `getCumulativeCost(baseCost: number, targetLevel: number): number` — §9.3.
  - `getLabRPPerSec(labLevel: number, baseOutput?: number = 5, habitabilityPercent?: number = 0): number` — §9.4.
  - `getTotalRPPerSec(planet: Planet, allPlanets: Planet[]): number` — сумма по всем лабораториям всех колоний игрока.
  - `getMaxResearchSlots(totalLabCount: number): number` — §9.5.
  - `getFocusBonus(activeSlots: number, allocationPercent: number): number` — §9.6.
  - `getEffectiveRPPerSec(totalRPPerSec: number, allocationPercent: number, activeSlots: number, quantumComputingLevel?: number = 0): number` — §9.7 (в MVP `quantumComputingLevel = 0`, т.к. C10 не входит в срез).
  - `getMinResearchTime(baseCost: number): number` — §9.8.
  - `getEstimatedCompletionTime(remainingRP: number, effectiveRPPerSec: number, baseCost: number): number` — §9.9.
  - `arePrerequisitesMet(tech: Technology, researched: Record<string, number>): { met: boolean; details: Array<{ techId: string; requiredLevel: number; currentLevel: number; met: boolean }> }` — §9.10.
  - `validateTechTree(technologies: Technology[]): string[]` — §9.11 (DAG-валидация с DFS).
  - `getBranchLevel(branchId: SpecializedBranchId, researched: Record<string, number>, allTechs: Technology[]): number` — §9.12.
  - `getEffectiveMaxLevel(specializedId: SpecializedBranchId, fundamentalLevels: Record<FundamentalBranchId, number>): number` — `research-unification.md` §7.3.
  - `getPartialBonus(specializedId: SpecializedBranchId, fundamentalLevels: Record<FundamentalBranchId, number>): number` — там же.
  - `processResearchTick(state: ResearchState, totalRPPerSec: number, deltaSeconds: number): { state: ResearchState; completed: Array<{ techId: string; level: number }> }` — основная функция тика:
    1. Для каждого активного слота вычислить `effectiveRPPerSec = totalRPPerSec × (slot.allocationPercent / 100) × getFocusBonus(activeSlots, slot.allocationPercent) × getPartialBonus(tech.branch, fundLevels)`.
    2. Прибавить `effectiveRPPerSec × deltaSeconds` к `slot.rpInvested`.
    3. Пока `slot.rpInvested >= getTechCost(tech.baseCost, slot.targetLevel)` и `getEstimatedCompletionTime(...) >= getMinResearchTime(...)` → завершить уровень: `researched[techId] = slot.targetLevel`, `slot.targetLevel++` (если `targetLevel <= min(tech.maxLevel, getEffectiveMaxLevel)`) или удалить слот.
    4. Вернуть список завершённых технологий для эмита `tech:research-completed`.

- `src/research/index.ts` (новый файл) — `export * from './engine'; export { ResearchModule } from './research-module';`.

**Оценка времени:** ~5–6 часов (формулы + тесты на гранях).

**Критерии готовности R3:** все функции экспортированы; юнит-тесты (см. §7) покрывают граничные случаи (0 RP, переполнение, макс. уровень, потолок фундаментала, фокус-бонус).

---

### R4. Проверка требований (prerequisites, cost, ceilings)

**Цель:** Игрок не может поставить технологию в очередь, если (а) не выполнены преквизиты, (б) целевой уровень превышает потолок фундаментальной ветки, (в) слотов больше максимума, (г) аллокация нарушает 5% минимум или сумму 100%.

**Файлы для изменения:**
- `src/research/engine.ts` — дополнительные функции:
  - `canStartResearch(tech: Technology, targetLevel: number, state: ResearchState, totalLabCount: number): { ok: boolean; reasons: string[] }` — композиция всех проверок.
  - `canAllocate(activeSlots: ResearchSlot[], newAllocations: number[]): boolean` — `sum === 100 && all ≥ 5`.
  - `getTechCeiling(tech: Technology, state: ResearchState): number` — `min(tech.maxLevel, getEffectiveMaxLevel(tech.branch, state.fundamentalLevels))`.
- `src/research/research-module.ts` — вызвать `canStartResearch` в обработчике `tech:research-start` и отклонить с `tech:research-rejected` (см. §5).

**Оценка времени:** ~2 часа.

**Критерии готовности R4:** нельзя начать исследование с невыполненным преквизитом; нельзя превысить потолок фундаментальной ветки; нельзя добавить слот сверх `getMaxResearchSlots`; аллокация всегда суммируется в 100% с минимум 5%.

---

### R5. Разблокировка (зданий, рецептов, модулей кораблей)

**Цель:** При завершении уровня технологии эмитить `tech:unlocked` с конкретными `unlocks: string[]`, которые другие модули могут слушать.

**Файлы для изменения:**
- `src/data/research.ts` — добавить `TECH_UNLOCKS: Record<string, Array<{ level: number; type: 'building' | 'recipe' | 'module' | 'ship_hull'; id: string }>>` — для MVP таблица соответствий:
  | techId | level | unlocks |
  |--------|-------|---------|
  | `fusion_reactor` | 1 | `building: fusion_reactor` (по §8.3 40-buildings) |
  | `ion_engine` | 1 | `module: ion_engine` |
  | `steel_processing` | 1 | `recipe: steel_alloy` |
  | `light_alloys` | 1 | `recipe: titanium_alloy` |
  | `composites` | 1 | `recipe: composite_plate` |
  | `superconductors` | 1 | `recipe: superconductor` |
  | `microelectronics` | 1 | `recipe: microchip` |
  | `ballistic_weapons` | 1 | `module: ballistic_turret` |
  | `laser_weapons` | 1 | `module: laser_cannon` |
  | `fleet_tactics` | 1 | (эффект +5% бой — отложен до Etap 4) |
  | `hydroponics` | 1 | (эффект +10% food — заглушка в MVP) |
  | `ecological_adaptation` | 1 | (эффект +5% габитабельность — заглушка) |

- `src/research/research-module.ts` — на каждый `processResearchTick`-завершённый уровень: для каждой записи в `TECH_UNLOCKS[techId]` с `level ≤ newLevel` эмитить `tech:unlocked { techId, factionId, unlocks: [...] }`.
- `src/economy/economy-module.ts` — подписка на `tech:unlocked` → для `type === 'recipe'` разблокировать рецепт в `RECIPES` (добавить `unlocked: boolean` поле или `techGate: string` в `RecipeDef`); для `type === 'building'` — открыть в `BuildingDialog`.

**Оценка времени:** ~3 часа.

**Критерии готовности R5:** после исследования `M1 steel_processing` рецепт `steel_alloy` появляется в списке крафта; после `C1 microelectronics` — `microchip`; разблокировки не повторяются (idempotent).

---

### R6. UI: дерево исследований (visual tree, прогресс, выбор)

**Цель:** Игрок видит дерево, статусы, может ставить/убирать слот, менять аллокацию.

**Файлы для изменения/создания:**
- `src/components/game/research-tree.tsx` (новый) — основной компонент:
  - Левая колонка: список фундаментальных веток (5 шт.) с текущим уровнем, RP-вложенным, кнопкой «+1 уровень».
  - Центральная область: 6 групп (по веткам) технологий. Каждая технология — карточка с цветом ветки, иконкой, названием, уровнем (N/Max), прогресс-баром RP. Состояние: 🟢/🔵/🟡/🔴/🔄 (по §5.4). При клике → открытие модального окна с деталями.
  - Правая колонка: очередь исследований (см. `research-queue-panel`).
- `src/components/game/research-queue-panel.tsx` (новый) — `ResearchQueuePanel`:
  - Список активных слотов: `{techName} → ур.{targetLevel}` + прогресс + ETA + ползунок аллокации (5–100%).
  - Индикатор `Σ RP/сек: {totalRP}` + `слотов: {used}/{max}`.
  - Кнопка «Распределить поровну» (auto-balance).
- `src/components/game/research-detail-dialog.tsx` (новый) — модальное окно:
  - Имя, описание, эффект за уровень (формула), полный список преквизитов со статусами, кумулятивная стоимость до уровня N, кнопка «Начать исследование» → `startResearch`.
- `src/components/game/game-layout.tsx` — добавить:
  - `GameView` расширить до `'galaxy' | 'system' | 'planet' | 'research'`.
  - В `NavButton`-навигацию добавить пункт «Research» с иконкой `🔬` (Beaker из `lucide-react`).
  - Условный рендер `<ResearchTree />` при `view === 'research'`.
- `src/stores/game-store.ts` — `GameView` тип вынести и реэкспортировать (сейчас он внутренний).

**Оценка времени:** ~6–8 часов (дизайн + адаптивная верстка + ползунки).

**Критерии готовности R6:** вид «Research» открывается из навигации; видны все 15 технологий с корректными статусами; можно поставить слот, изменить аллокацию, увидеть прогресс в реальном времени (с обновлением на `core:tick`).

---

### R7. Интеграция в game-store + события typed-bus

**Цель:** Подключить `ResearchModule` к `GameMediator`, расширить `GameState`, добавить store-actions, обеспечить save/load round-trip.

**Файлы для изменения:**
- `src/core/types.ts` — расширить `GameState`:
  ```ts
  export interface GameState {
    time: GameTime;
    speed: GameSpeed;
    phase: GamePhase;
    galaxy: Galaxy;
    productionQueues: Map<EntityId, ProductionQueue>;
    fleets: Fleet[];
    playerFactionId: EntityId;
    researchState: ResearchState;  // ← НОВОЕ
  }
  ```
- `src/core/events.ts` — расширить `TechEvents` (см. §5).
- `src/research/research-module.ts` (новый) — `ResearchModule implements IGameModule`:
  - `manifest.dependencies: ['economy']` (нужен доступ к планетам для подсчёта лабораторий).
  - `manifest.emits`: все события из §5.
  - `manifest.subscribes`: `core:tick` (приоритет `PRIORITY.SIMULATION`), `tech:research-start`, `tech:cancel`, `tech:allocate`, `tech:fundamental-level-up`.
  - `manifest.handlesQueries`: `research:state` (вся ResearchState), `research:tech-status` (по techId).
  - `setGameStateAccessor` — как в `EconomyModule`.
  - В `onTick(time)`: `deltaSeconds = 1` (тик = 1 сек при `speed=1`; масштабируется через `time.speed` → ×1/5/15/50). Вызвать `processResearchTick(...)` и эмиты.
- `src/stores/game-store.ts`:
  - Импортировать `ResearchModule`, регистрировать в `getMediatorWithModules()` после `EconomyModule`.
  - Инициализация `researchState`: при `newGame()` создавать `createDefaultResearchState()` (все ветки 0, `researched = {}`, `activeSlots = []`, `totalRpGenerated = 0`).
  - Новые store-действия:
    - `startResearch(techId: string, targetLevel: number): boolean`
    - `cancelResearch(slotId: string): boolean`
    - `setAllocation(slotId: string, percent: number): boolean`
    - `levelUpFundamental(branchId: FundamentalBranchId): boolean`
    - `autoAllocateSlots(): void` — распределить поровну.
  - Сериализация: `serializeGameState` уже строкует весь `GameState` — убедиться, что `ResearchState` сериализуется (простые объекты, без `Map`). `fundamentalRpInvested: Partial<Record<...>>` сериализуется как plain object; `activeSlots: ResearchSlot[]` — массив.
- `src/app/page.tsx` — если использует `newGame`, убедиться, что создаётся дефолтный `researchState`.

**Оценка времени:** ~4–5 часов (включая отладку save/load round-trip).

**Критерии готовности R7:** `ResearchModule` зарегистрирован и обрабатывает тики; все 4 store-action работают; после save → load `researchState` идентичен; `tech:research-completed` эмитируется в момент завершения уровня.

---

## 5. События typed-bus (новые и расширенные)

`src/core/events.ts` — расширить `TechEvents` (текущие 3 + 5 новых = 8):

```ts
export interface TechEvents {
  // Существующие (payload расширен):
  'tech:research-started': {
    techId: string; factionId: EntityId; targetLevel: number; etaTick: number;
  };
  'tech:research-completed': {
    techId: string; factionId: EntityId; level: number; unlocks: string[];
  };
  'tech:unlocked': {
    techId: string; factionId: EntityId; unlocks: string[];
  };

  // НОВЫЕ:
  'tech:research-cancelled': {
    slotId: string; factionId: EntityId; techId: string; rpRefunded: number;
  };
  'tech:allocation-changed': {
    factionId: EntityId; slots: Array<{ slotId: string; percent: number }>;
  };
  'tech:fundamental-leveled': {
    branchId: FundamentalBranchId; factionId: EntityId; newLevel: number;
  };
  'tech:prerequisites-met': {
    techId: string; factionId: EntityId; met: boolean; missing: string[];
  };
  'tech:tree-validated': {
    ok: boolean; errors: string[];
  };
  'tech:research-rejected': {
    techId: string; factionId: EntityId; reasons: string[];
  };
}
```

> `etaTick` в `tech:research-started` остаётся для обратной совместимости; для точного ETA использовать `getEstimatedCompletionTime`. Поле `factionId` сейчас всегда `playerFactionId`, но закладывается под будущее AI (Блок 4).

`src/research/research-module.ts` manifest.emits должен перечислить все 8. `EconomyModule` должен добавить `'tech:unlocked'` в `manifest.subscribes`.

---

## 6. UI-компоненты

| Компонент | Файл | Назначение | shadcn/ui зависимости |
|-----------|------|------------|----------------------|
| `ResearchTree` | `src/components/game/research-tree.tsx` (новый) | Главная панель: 5 фундаменталов + 15 технологий по 5 веткам + очередь справа | `Card`, `Badge`, `Progress`, `ScrollArea`, `Separator` |
| `ResearchQueuePanel` | `src/components/game/research-queue-panel.tsx` (новый) | Активные слоты, аллокация, RP/сек, ETA | `Progress`, `Slider`, `Button` |
| `ResearchDetailDialog` | `src/components/game/research-detail-dialog.tsx` (новый) | Модалка с преквизитами, эффектами, стоимостью, кнопкой «Начать» | `Dialog`, `Badge`, `Button` |
| `GameLayout` | `src/components/game/game-layout.tsx` (правка) | Навигация + рендер `<ResearchTree />` при `view === 'research'` | — |
| `BuildingDialog` | `src/components/game/building-dialog.tsx` (правка) | Отображение RP/сек для `laboratory` | — |
| `ResourcePanel` | `src/components/game/resource-panel.tsx` (правка, опционально) | Показатель RP/сек рядом с энергией | — |

**Цветовая палитра** — по `60-research.md` §2.1 (см. `BRANCH_COLORS` в R1).

**Адаптив:** при ширине < 768px — стек вертикально; очередь уезжает под дерево; карточки технологий — grid `1fr`.

---

## 7. Тесты

**Инфраструктура:** Блок 1 (стабилизация) должен установить vitest + sample-тесты. Если Блок 3 запускается раньше Блока 1, дополнительно создать `vitest.config.ts` + `tests/` директорию.

| ID | Файл | Что проверяет | Граничные случаи |
|----|------|---------------|-------------------|
| T-R1 | `tests/research/tree-data.test.ts` | `TECH_TREE` имеет 15 элементов; `validateTechTree` возвращает `[]`; стартовых технологий 5; `BRANCH_LINKS` = 8 | дубль ID, неизвестный преквизит, цикл (внести временно → должна быть ошибка) |
| T-R2 | `tests/research/cost-formulas.test.ts` | `getTechCost(800, 1) === 800`; `getTechCost(800, 5) === 4050`; `getCumulativeCost(800, 3) === 3800`; `getMinResearchTime(800) === 10` (база); `getMinResearchTime(15000) === 15` | уровень 0 (должно бросать/NaN-сторож), уровень > maxLevel |
| T-R3 | `tests/research/lab-rp.test.ts` | `getLabRPPerSec(1) === 5`; `getLabRPPerSec(3, 5, 80) === 16.5`; `getMaxResearchSlots(0) === 1`; `getMaxResearchSlots(10) === 2`; `getMaxResearchSlots(100) === 10` (cap) | лаб 0, лаб 95 |
| T-R4 | `tests/research/focus-bonus.test.ts` | `getFocusBonus(1, 100) === 1.2`; `getFocusBonus(2, 50) === 1.0`; `getFocusBonus(1, 50) === 1.0`; `getEffectiveRPPerSec(100, 100, 1, 0) === 120` | activeSlots=0 (должно быть 0) |
| T-R5 | `tests/research/prerequisites.test.ts` | `arePrerequisitesMet(M5, {M1:2, C1:1}) → met:true`; `arePrerequisitesMet(M5, {M1:2}) → met:false, details содержит C1` | пустой researched, все выполнены |
| T-R6 | `tests/research/branch-ceilings.test.ts` | `getEffectiveMaxLevel('materials', {chemistry:5, engineering:2}) === 3`; `getEffectiveMaxLevel('computing', {chemistry:5}) === Infinity`; `getPartialBonus('weapons', {engineering:4}) === 1.2`; `getPartialBonus('computing', {chemistry:5}) === 1.25` | все фундаменталы = 0 |
| T-R7 | `tests/research/process-tick.test.ts` | Один слот, 100% аллокация, 100 RP/сек → за 10 сек = 1000 RP, уровень P1 (cost 500) завершён; с `getMinResearchTime` = 1 сек → не мешает; 5-секундный tick на `speed=5` → ×5; превышение потолка фундаментала → уровень не растёт | 0 RP/сек (не прогрессирует), макс. уровень (слот закрывается) |
| T-R8 | `tests/research/serialization.test.ts` | `serializeGameState(state) → deserialize → researchState` идентичен (deep equal), включая `fundamentalRpInvested`, `researched`, `activeSlots` | пустой state, state с активным слотом |

**Минимум:** T-R1–T-R7 (≥7 тестов). T-R8 — критичен для save/load; обязателен.

---

## 8. Риски и зависимости

| ID | Риск | Вероятность | Влияние | Митигация |
|----|------|-------------|---------|-----------|
| RISK-1 | **Блок 1 (стабилизация) не закрыт** — `game-store.ts` всё ещё мутирует состояние напрямую (P2), тест-инфраструктура не установлена | Высокая (если порядок нарушен) | Высокое — невозможно верифицировать MVP | **Hard-зависимость:** начинать Блок 3 только после закрытия Блока 1; если параллельно — изолировать в ветке `feature/research` и снимать merge до Блока 1 |
| RISK-2 | **Сериализация `ResearchState` ломается** из-за `Partial<Record>` / `Infinity` (при `getEffectiveMaxLevel`) | Средняя | Высокое — save/load теряет прогресс | Заменять `Infinity` на `null` в сериализации; T-R8 обязателен |
| RISK-3 | **Производительность `processResearchTick`** при 100+ слотах / 500 планетах | Низкая (MVP ≤ 10 слотов) | Низкое | Кэшировать `totalRPPerSec` (обновлять при `economy:building-constructed` / `economy:building-upgraded`); пересчёт по событию, а не каждый тик |
| RISK-4 | **`habitabilityPercent` отсутствует в `Planet`** — формула RP/сек упрощена | Высокая | Низкое (MVP совместимо) | Принять `0` для MVP с TODO; полностью интегрировать в Etap 4 (Блок терраформинга) |
| RISK-5 | **Блок 2 (флот) параллельно меняет `events.ts`** — merge-конфликты в `TechEvents` | Средняя | Низкое | Координировать через общий git-флоу; в `events.ts` держать `TechEvents` и `ShipsEvents` в отдельных блоках |
| RISK-6 | **UI дерева тяжёлый для рендера** — 15 карточек с прогресс-барами, обновление каждый тик | Средняя | Среднее | throttle React-апдейтов до 250 мс (`useDeferredValue` на `researchState`); не ререндерить всё дерево при изменении 1 слота |
| RISK-7 | **`xenoarchaeology` фундаментал без специализированной ветки** — UI показывает пустую ветку | Низкая | Низкое | Не включать `xenoarchaeology` в MVP-список `FUNDAMENTAL_BRANCHES` (5 вместо 6) |
| RISK-8 | **Кросс-веточные преквизиты (M5←C1, W2←C1) ломают DAG, если C1 не в MVP** | — | — | C1 включён в MVP-срез по определению (см. §2.3) |

---

## 9. Критерии готовности блока

Блок 3 считается завершённым, если **все** следующие условия выполнены:

1. **Lint:** `npm run lint` — 0 ошибок, 0 предупреждений (новых).
2. **Тесты:** `npm run test` проходит; ≥7 research-тестов (T-R1…T-R7) + T-R8 (serialization) зелёные.
3. **Функциональность (ручной чек-лист):**
   - [ ] На колонизированной планете можно построить `laboratory` (через `BuildingDialog`).
   - [ ] Слот `view=research` открывается из навигации; видны 5 фундаменталов + 15 технологий.
   - [ ] Можно начать исследование `P1 fusion_reactor` (нет преквизитов); виден прогресс-бар.
   - [ ] Нельзя начать `P2 ion_engine` без `P1≥1` (кнопка «Начать» disabled + tooltip с причиной).
   - [ ] Можно поднять фундаментал `physics` → ур.1 → потолок ветки `power` поднят с 0 до 1.
   - [ ] Можно открыть 2-й слот исследований при наличии ≥10 лабораторий суммарно.
   - [ ] Аллокация 100% на 1 слот → фокус-бонус ×1.2 (видно в `effectiveRPPerSec`).
   - [ ] По завершении уровня `M1 steel_processing` эмитится `tech:unlocked` и в `EconomyModule` разблокируется рецепт `steel_alloy`.
   - [ ] Подняв `engineering` фундаментал → потолок `materials` ограничивается `floor(engineering×1.5)`.
4. **Save/Load:** сохранение и загрузка сохраняют `researchState` 1:1 (T-R8 зелёный; ручная проверка: построить лабораторию, начать исследование, сохранить, перезагрузить — прогресс идентичен).
5. **События:** `ResearchModule` emits все 8 событий из §5; в консоли разработчика видно логи (если включён `debug`-режим `TypedEventBus`).
6. **Документация:** `docs/60-research.md` строка состояния обновлена с `Draft (0% реализации)` на `MVP (15/72 технологий)`; в `docs/STATUS.md` (если есть) отмечен Etap 3.0-блок-3 как `in_progress → complete`.
7. **Чекпоинт:** создан файл `checkpoints/08_27_block_03_research_complete.md` с подтверждением всех критериев.

---

## 10. Порядок внедрения внутри блока

```
R1 (данные)  ──► R2 (laboratory)  ──►  R3 (engine + тесты)
                                          │
                                          ▼
                       R4 (validation) ──► R5 (unlocks)
                                          │
                                          ▼
                       R7 (store + module + serialization)
                                          │
                                          ▼
                                  R6 (UI)
                                          │
                                          ▼
                       Критерии готовности (§9)
```

**Оценка общего времени:** ~24–30 часов (~5–7 рабочих дней):
- R1: 3–4 ч
- R2: 1 ч
- R3: 5–6 ч (с тестами)
- R4: 2 ч
- R5: 3 ч
- R6: 6–8 ч
- R7: 4–5 ч
- Интеграция + отладка + правка тестов: 4–6 ч

**Milestones:**
- **M1** (после R1+R3): движок + данные готовы; проходят юнит-тесты — research-логика работает в изоляции.
- **M2** (после R2+R5+R7): в игре можно построить лабораторию, копить RP, завершать исследования (без UI — через devtools Zustand).
- **M3** (после R6): полный цикл доступен через UI.

---

## Изменённые/созданные файлы

### Созданные (новые)

| Файл | Назначение |
|------|------------|
| `src/data/research.ts` | `TECH_TREE` (15 техн.), `FUNDAMENTAL_BRANCHES` (5), `BRANCH_LINKS` (8), `BRANCH_COLORS`, `STARTER_TECH_IDS`, `TECH_UNLOCKS` |
| `src/research/engine.ts` | Чистые функции: `getTechCost`, `getLabRPPerSec`, `getMaxResearchSlots`, `getFocusBonus`, `arePrerequisitesMet`, `validateTechTree`, `getBranchLevel`, `getEffectiveMaxLevel`, `getPartialBonus`, `processResearchTick`, `canStartResearch`, `getTechCeiling` |
| `src/research/research-module.ts` | `ResearchModule implements IGameModule` (подписки, emits, query handlers) |
| `src/research/index.ts` | Barrel-экспорт |
| `src/components/game/research-tree.tsx` | Главная панель дерева исследований |
| `src/components/game/research-queue-panel.tsx` | Активная очередь + аллокация |
| `src/components/game/research-detail-dialog.tsx` | Модалка деталей технологии |
| `tests/research/tree-data.test.ts` | T-R1 |
| `tests/research/cost-formulas.test.ts` | T-R2 |
| `tests/research/lab-rp.test.ts` | T-R3 |
| `tests/research/focus-bonus.test.ts` | T-R4 |
| `tests/research/prerequisites.test.ts` | T-R5 |
| `tests/research/branch-ceilings.test.ts` | T-R6 |
| `tests/research/process-tick.test.ts` | T-R7 |
| `tests/research/serialization.test.ts` | T-R8 |
| `checkpoints/08_27_block_03_research_complete.md` | Подтверждение завершения (после имплементации) |

### Изменённые

| Файл | Что меняется |
|------|--------------|
| `src/core/types.ts` | Добавить типы `SpecializedBranchId`, `FundamentalBranchId`, `BranchLink`, `BranchLinkType`, `FundamentalBranch`, `Prerequisite`, `TechEffect`, `Technology`, `TechImprovementType`, `ResearchState`, `ResearchSlot`, `ResearchProgress`; расширить `GameState.researchState` |
| `src/core/events.ts` | Расширить `TechEvents` 5 новыми событиями (§5) |
| `src/data/buildings.ts` | Добавить `laboratory` в `BUILDINGS` (category: `research`) |
| `src/economy/economy-module.ts` | Подписаться на `tech:unlocked` → разблокировать рецепты/здания; добавить в `manifest.subscribes` |
| `src/stores/game-store.ts` | Расширить `GameView` до `galaxy\|system\|planet\|research`; зарегистрировать `ResearchModule`; действия `startResearch`, `cancelResearch`, `setAllocation`, `levelUpFundamental`, `autoAllocateSlots`; инициализация `researchState` в `newGame` |
| `src/components/game/game-layout.tsx` | Добавить пункт навигации «Research»; условный рендер `<ResearchTree />` |
| `src/components/game/building-dialog.tsx` | Отображение RP/сек для `laboratory` |
| `docs/60-research.md` | Обновить шапку: `Статус: MVP (15/72)` (после имплементации) |
| `worklog.md` | Запись об имплементации Блока 3 (по факту завершения) |
