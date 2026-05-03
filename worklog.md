# Worklog

---
Task ID: 1
Agent: Main Agent
Task: Настройка системы чекпоинтов и подготовительный план Этапа 1

Work Log:
- Получена системная дата/время: 2026-05-03 16:07 MSK
- Создана директория checkpoints/
- Создан checkpoints/RULES.md — полные правила чекпоинтов (формат имени, содержимое, вынос кода, логика)
- Создан checkpoints/ROADMAP.md — глобальная дорожная карта с 5 этапами
- Создан checkpoints/05_03_phase0_complete.md — финальный чекпоинт этапа 0
- Создан checkpoints/05_03_phase1_prep.md — подготовительный план этапа 1 с 8 подзадачами
- Закоммичено и запушено в GitHub (commit 8f19588)

Stage Summary:
- Система чекпоинтов настроена и работает
- Этап 1 спланирован: 8 шагов от PRNG до сохранений
- MVP: 10 систем, 20 элементов, 8 зданий, базовые рецепты, 2 типа кораблей
- Порядок: bottom-up (фундамент → данные → логика → обёртка)

---
Task ID: 6
Agent: UI Agent
Task: Create all UI components for SpaceGame 4X strategy game

Work Log:
- Read existing codebase: game-store.ts, types.ts, galaxy module, economy engine, data definitions
- Created `src/components/game/time-controls.tsx` — Pause/Play toggle + speed buttons (x1/x5/x15/x50) using useGameStore
- Created `src/components/game/resource-panel.tsx` — Scrollable resource list grouped by ElementCategory with color coding and formatted amounts
- Created `src/components/game/building-dialog.tsx` — Building selection/upgrade dialog using shadcn Dialog; shows available buildings with costs, terrain bonuses, energy info; greys out unaffordable buildings; upgrade mode for existing buildings
- Created `src/components/game/galaxy-map.tsx` — SVG galaxy map with star systems as colored dots (by star type color), jump point lines (dashed=unstabilized, solid=stabilized), hover tooltips, click-to-select, background stars
- Created `src/components/game/system-view.tsx` — Star info card with temperature/mass/luminosity, planet list with type/size/temperature/atmosphere, jump point navigation with clickable links to other systems
- Created `src/components/game/planet-view.tsx` — SVG hex grid using axialToPixel() with terrain-colored hexes, building indicators (letter + level), deposit dots, click-to-build dialog, hex info card on hover, planet info sidebar, resource panel
- Created `src/components/game/game-layout.tsx` — Main layout with top bar (title, time display, speed controls, new game), left sidebar (nav buttons for Galaxy/System/Planet views), main content area, bottom status bar
- Updated `src/app/page.tsx` — New Game screen with seed input when not initialized; GameLayout when initialized; game tick loop via useEffect + setInterval at 200ms
- All components use 'use client' directive, dark space theme (#060614/#0a0a1a/#0d0d24), shadcn/ui components, lucide-react icons
- Lint passes with zero errors, app compiles and renders correctly

Stage Summary:
- 8 UI components created in src/components/game/
- Main page.tsx updated with new game screen and tick loop
- Complete game flow: New Game → Galaxy Map → System View → Planet View → Build/Upgrade
- Dark space theme with glowing effects, consistent styling
- All components integrate with useGameStore Zustand store

---
Task ID: 2-5, 7-8
Agent: Main Agent
Task: Реализация Этапа 1 — Ядро симуляции SpaceGame

Work Log:
- Создано ядро движка: PRNG (xoshiro256**), EventBus, GameLoop, полная система типов
- Созданы данные: 20 элементов, 10 типов звёзд, 7 типов планет, 8 зданий, 16 рецептов
- Создан генератор галактики: спиральная структура, seed-based, системы, планеты, гекс-сетка, JP
- Создана экономика: добыча, производство, энергия, крафт, строительство/улучшение зданий
- Создан Zustand-стор для игрового состояния
- Обновлён layout.tsx (метаданные SpaceGame)
- Обновлён prisma/schema.prisma (GameSave)
- Созданы API-роуты для сохранения/загрузки (/api/save)
- Пуш в GitHub (commit b5d8d1f)
- Обновлён checkpoints/05_03_phase1_impl.md

Stage Summary:
- Полный рабочий прототип: генерация галактики, застройка планет, добыча ресурсов, крафт
- UI: карта галактики (SVG), экран системы, гекс-сетка планеты, строительство, управление временем
- 31 файл изменён, ~3736 строк добавлено
- Lint: 0 ошибок
- Dev server: компиляция без ошибок

---
Task ID: 15
Agent: General Agent
Task: P1-25 — Создать doc_temp/ores-and-chains.md — документ со всеми рудами и цепочками трансформации

Work Log:
- Изучены все исходные файлы: elements.ts (19 элементов), recipes.ts (15 RAW_ORES, 16 рецептов), buildings.ts (8 зданий), 04-buildings.md (5 добывающих зданий), 03-planets.md (7 типов планет), ARCHITECTURE.md (экономика), audit_final.md (69 расхождений)
- Определено 22 элемента (20 базовых + Y, Ba для сверхпроводника) → 24 вида руд/соединений
- Создан doc_temp/ores-and-chains.md (8 разделов + 2 приложения):
  - §1: Обзор концепции цепочки руда → элемент, 6 уровней переработки
  - §2: Полная таблица руд (13 шахтных, 8+ карьерных, 9 атмосферных газов, 5 ледяных, 13 глубинных)
  - §3: Атмосферные соединения — таблица доступности газов по типам атмосферы
  - §4: Ледяные соединения — с бонусами температуры и цепочками переработки
  - §5: Глубинные ресурсы — 3 уровня глубины (ур.1-4, 5-7, 8-10), связь с рецептом сверхпроводника
  - §6: 8 визуальных цепочек трансформации (строительные, электроника, топливо, сплавы, химия, энергия, редкие, полная цепочка до ионного двигателя)
  - §7: Сводные таблицы: элемент→источник→переработка, здание→список руд, распределение по источникам
  - §8: TypeScript структуры данных (OreDef), исправление бага Р3-01 (deposits должны производить руды, не элементы)
  - Приложение А: Таблица распространённости руд по типам планет (resource_availability)
  - Приложение Б: Полный список недостающих рецептов (14 плавильня + 8 химзавод + 3 исправления)
- Документ на русском языке, согласован с ARCHITECTURE.md и 04-buildings.md

Stage Summary:
- Создан полный справочник руд и цепочек трансформации: 50+ руд/соединений определено
- Исправление критического бага Р3-01 задокументировано (deposit.oreId вместо deposit.elementId)
- Определены все недостающие рецепты для recipes.ts (22 новых + 3 исправления)
- Цепочка «руда → ионный двигатель» полностью прослежена и задокументирована

---
Task ID: 1 (audit)
Agent: General Agent
Task: P1-01 & P1-02 — Update docs/03-planets.md (Gas Giant Building Layers + Unify Size System)

Work Log:
- **P1-01: Gas Giant Building Layers**
  - Updated §1.1 summary table: gas giant row now references §3.2 layers instead of "0 гексов (нет застройки)"
  - Updated §1.2.6 Gas Giant description: added references to upper atmosphere (6-12 slots) and orbit (6-12 slots) layers
  - Added 3 new rows to gas giant parameter table: surface (0 hexes → see §3.2), upper atmosphere (6-12 slots), orbit layer (6-12 slots)
  - Updated gas giant "Игровая роль" to reference atmospheric platforms and §3.2
  - Added new §3.2 "Слои застройки" with 3 subsections:
    - §3.2.1 Surface (solid planets only, 19-127 hex grid)
    - §3.2.2 Upper atmosphere (gas giants only, 6-12 slots, atmospheric buildings only)
    - §3.2.3 Orbit (all planets, 3-6 slots for solid, 6-12 for gas giants)
  - Added TypeScript interfaces: AtmosphericSlot, AtmosphericBuildingType, AtmosphericBuilding
  - Added getOrbitSlots() function
  - Updated §3.1 to introduce the 3-layer system
  - Renumbered §3.2→§3.3 (Размер сетки поверхности), §3.3→§3.4 (Типы местности), §3.4→§3.5 (Здания на гексах)
  - Updated §3.4 to note that atmosphere and orbit layers don't have terrain types
  - Updated §3.5 to reference atmosphere and orbit layers
  - Updated §6.1 orbital station limits to use new orbit layer slot numbers (3-6 by size, 6-12 gas giant)
  - Added atmosphericSlots and orbitSlots fields to Planet interface (§7.1)
  - Updated generatePlanet() to include atmosphericSlots and orbitSlots generation

- **P1-02: Unify Size System**
  - Replaced §2.1 size table: old (Карликовая/6, Малая/12, Средняя/24, Крупная/36) → new (Крошечная/19, Малая/37, Средняя/61, Большая/91, Огромная/127)
  - Size classes now based on Earth-radius (R⊕), not km ranges
  - Updated getGridSize() to use radiusInEarthRadii parameter and new thresholds (0.3/0.7/1.3/2.0)
  - Removed getSizeMultiplier() function (no longer needed with unified system)
  - Added source-of-truth note: "Единственный источник истины для размеров планет — данный файл (03-planets.md)"
  - Updated §1.1 table size class column: Карликовая→Крошечная, Крупная→Большая, added Огромная
  - Updated §1.3 satellite note: "Крошечная (19 гексов) или Малая (37 гексов)"
  - Updated §3.3 size table with new hex counts (19/37/61/91/127)
  - All sizes are complete hexagonal rings (no truncation needed): 2-6 rings
  - New visual schemas for Крошечная (19 hex, 2 rings) and Малая (37 hex, 3 rings)
  - Updated generateHexGrid() to use ringsBySize lookup, return full rings (no slice)
  - Updated PlanetSizeClass type: 'tiny' | 'small' | 'medium' | 'large' | 'huge'
  - Updated PLANET_CONFIG.GRID_SIZES: { tiny: 19, small: 37, medium: 61, large: 91, huge: 127, gas_giant: 0 }
  - Added ORBIT_SLOTS and ATMOSPHERE_SLOTS to PLANET_CONFIG
  - Marked MAX_ORBITAL_STATIONS as deprecated (refers to ORBIT_SLOTS)
  - Updated 04-buildings.md §1.1: added cross-reference note to 03-planets.md §2.1

- **Consistency fixes throughout 03-planets.md:**
  - "крупные планеты" → "большие планеты" (§1.3)
  - "крупных колоний" → "больших колоний" (§1.2.7)
  - generatePlanet(): added radiusInEarthRadii calculation, conditional hexGrid for gas giants
  - Updated return object with atmosphericSlots and orbitSlots

Stage Summary:
- Two audit items (P1-01, P1-02) fully resolved in docs/03-planets.md
- 04-buildings.md §1.1 updated with cross-reference note
- New unified size system: 5 classes (Крошечная/Малая/Средняя/Большая/Огромная) with 19/37/61/91/127 hexes
- New 3-layer building system: Surface + Upper Atmosphere + Orbit
- All old size references (6/12/24/36) eliminated from both docs files

---
Task ID: 17
Agent: General Agent
Task: Fix all UI components that reference old types after type system migration

Work Log:
- Read all 5 target component files + types.ts + data files (planet-types.ts, star-types.ts)
- **system-view.tsx**: Fixed `system.star` → `system.stars[0]` with null safety (primaryStar variable), updated PlanetCard atmosphere display from boolean `planet.atmosphere ? 'Atmo' : 'Vacuum'` → `ATMO_DISPLAY[planet.atmosphere.type]`, added ATMO_DISPLAY and LIFE_DISPLAY constant maps, added companion stars display section for binary/triple systems, added Separator import usage
- **planet-view.tsx**: Fixed atmosphere display from `planet.atmosphere ? 'Yes' : 'None'` → `ATMO_DISPLAY[planet.atmosphere.type]` + pressure, fixed life display from `planet.hasLife ? 'Detected' : 'None'` → `LIFE_DISPLAY[planet.life.level]` + biodiversity, added ATMO_DISPLAY/LIFE_DISPLAY constant maps, added AtmosphereComposition card showing element percentages, added SlotCard component for AtmosphericSlot[] and OrbitalSlot[] display, imported new types (AtmosphereType, LifeLevel, AtmosphericSlot, OrbitalSlot)
- **galaxy-map.tsx**: Fixed `sys.star.color` → `sys.stars[0]?.color ?? '#666'` in both glow circle and star dot circle elements (2 occurrences)
- **building-dialog.tsx**: Verified — no crater references found, terrain typing already uses HexTerrain which excludes crater
- **resource-panel.tsx**: Verified — no type issues, only uses ElementCategory and ELEMENT_MAP which are unchanged
- TypeScript compilation: 0 errors in game components (5 pre-existing errors in unrelated files: examples/, skills/, generator.ts)

Stage Summary:
- 3 files modified (system-view.tsx, planet-view.tsx, galaxy-map.tsx)
- 2 files verified clean (building-dialog.tsx, resource-panel.tsx)
- All old type references (system.star, planet.atmosphere boolean, planet.hasLife boolean, sys.star) updated to new types
- New UI: companion star display, atmosphere pressure+composition, life level+biodiversity, atmosphere/orbit slot panels
- Display helpers ATMO_DISPLAY and LIFE_DISPLAY added to both system-view.tsx and planet-view.tsx

---
Task ID: 14
Agent: General Agent
Task: P1-24 — Верификация 04-buildings.md против ARCHITECTURE.md §3.1.4

Work Log:
- Прочитаны ARCHITECTURE.md §3.1.4 (9 обобщённых зданий) и 04-buildings.md §10.1 (27 детальных зданий)
- Прочитан src/data/buildings.ts (8 зданий в коде)
- Сравнение завершено, выявлены расхождения:
  - ARCHITECTURE.md: 9 обобщённых типов (Шахта, Завод, Верфь, Электростанция, Лаборатория, Склад, Сканер, Оборонительная платформа, Торговый хаб)
  - 04-buildings.md: 27 специализированных зданий — детализация обобщённых категорий + логистика + спецздания
  - 3 здания из архитектуры отсутствуют в 04-buildings.md: Сканер, Оборонительная платформа, Торговый хаб (все post-MVP)
  - 20 зданий из 04-buildings.md не упомянуты явно в архитектуре — это логичная детализация обобщённых категорий
  - Баг ID: код использует `nuclear_plant`, док — `nuclear_reactor`
- Создан doc_temp/buildings-verification.md (8 разделов):
  - §1: Список зданий ARCHITECTURE.md (9 шт.)
  - §2: Список зданий 04-buildings.md (27 шт., с разбивкой по категориям)
  - §3: Здания только в архитектуре (3 шт.) + рекомендации
  - §4: Здания только в детальном документе (20 шт.) + обоснование
  - §5: Расхождение ID (nuclear_plant vs nuclear_reactor)
  - §6: Статус реализации в коде (8 есть, 19 отсутствуют)
  - §7: Итоговая матрица соответствия
  - §8: Выводы и рекомендации

Stage Summary:
- Верификация завершена: 04-buildings.md — качественная детализация архитектурного черновика
- Критических противоречий нет; 3 здания из архитектуры нужно добавить в 04-buildings.md (post-MVP)
- Обнаружен баг ID: nuclear_plant (код) vs nuclear_reactor (док)
- MVP-дополнение: warehouse, electronics_plant, hull_plant (указаны в Приложении A 04-buildings.md)

---
Task ID: 13
Agent: General Agent
Task: P1-08 — Создать объединённую двухуровневую систему исследований (research-unification.md)

Work Log:
- Изучены ARCHITECTURE.md §3.2.1 (6 фундаментальных веток: Химия, Физика, Инженерия, Биология, Военные науки, Ксеноархеология)
- Изучен docs/06-research.md §2.1 (6 специализированных веток: Энергетика, Материаловедение, Военные науки, Вычислительные системы, Биотехнологии, Ксеноархеология)
- Выявлено расхождение: списки не идентичны (Химия не имеет прямого специализированного аналога, Вычислительные системы не имеют фундаментального аналога)
- Создан doc_temp/research-unification.md (8 разделов + 2 приложения):
  - §1: Проблема двух списков — сравнение фундаментальных и специализированных веток
  - §2: Двухуровневая модель — определения, принципы, аналогия
  - §3: Таблица соответствия — полный маппинг фундаментальные ↔ специализированные + обратный маппинг
  - §4: Схема зависимостей — правила доступа (primary unlock/ceiling, secondary ceiling, partial bonus, свободная ветка)
  - §5: Механика ограничения — формулы, пример прогрессии, таблица стоимости фундаментальных уровней
  - §6: Визуализация двухуровневого дерева + диаграмма связей
  - §7: Структуры данных — TypeScript-типы (FundamentalBranch, BranchLink, BranchLinkType), константа BRANCH_LINKS, функции расчёта (isSpecializedUnlocked, getEffectiveMaxLevel, getPartialBonus)
  - §8: Влияние на существующие документы — конкретные изменения для ARCHITECTURE.md и 06-research.md
  - Приложение А: Сводная таблица всех 8 связей
  - Приложение Б: Глоссарий терминов
- Обновлён docs/ARCHITECTURE.md §3.2.1:
  - Добавлено описание двухуровневой системы с перекрёстными ссылками на 06-research.md и research-unification.md
  - Простой список заменён на таблицу с ID и маппингом на специализированные ветки
  - Добавлено описание роли фундаментальных уровней (разблокировка + потолок, базовая стоимость 200 RP)
- Обновлён docs/06-research.md:
  - Добавлено описание двухуровневой системы в §1 с перекрёстными ссылками
  - В §2.1 добавлен столбец «Фундаментальная ветка» с типами связей (primary/secondary/partial)
  - Добавлено пояснение о типах связей и ссылке на research-unification.md

Stage Summary:
- Создан полный документ унификации: двухуровневая система исследований фундаментальный ↔ специализированный
- Маппинг: 8 связей между 6 фундаментальными и 6 специализированными ветками
- 3 типа связей: primary (разблокировка + потолок), secondary (потолок), partial (бонус скорости)
- Вычислительные системы — свободная ветка (доступна с начала, бонус от Химии)
- Оба исходных документа обновлены с перекрёстными ссылками
- TypeScript-структуры данных готовы для реализации

---
Task ID: Main-P1-Audit-Fix
Agent: Main Agent
Task: Выполнение исправлений по результатам аудита P1 (31 пункт)

Work Log:
- P1-01: Газовые гиганты — 0 гексов поверхности + 3 слоя застройки (поверхность/атмосфера/орбита)
- P1-02: Унификация размеров планет (19/37/61/91/127) — единый источник истины в 03-planets.md
- P1-03: Добавлены типы звёзд STAR_RG (красный гигант) и STAR_PULSAR (пульсар)
- P1-04: ID звёзд приведены к формату документации (STAR_O, STAR_WD и т.д.)
- P1-05: Пропущен (не нужен для MVP)
- P1-06: Пропущен (не нужен для MVP, ИИ не готов)
- P1-07: Реализованы двойные/тройные системы (BinaryType, 4 типа)
- P1-08: Создана двухуровневая система исследований (fundamental ↔ specialized)
- P1-09: Параметры звёзд приведены к усреднённым значениям из документации
- P1-10: Веса вероятностей звёзд приведены к частотам из документации
- P1-11: Мин/макс планет у звёзд приведены к документации
- P1-12: Добавлен элемент V (Ванадий) + Y (Иттрий), Ba (Барий) для сверхпроводника
- P1-13: Рецепт сверхпроводника: Y(1) + Ba(2) + Cu(3) + O(4) + Energy(15)
- P1-14: Рецепт титанового сплава: Ti(8) + Al(4) + V(1) + Energy(8)
- P1-15: Рецепт микрочипа: Au(0.1) вместо Au(1)
- P1-16: Атмосфера: boolean → AtmosphereType (8 типов) + Atmosphere интерфейс
- P1-17: Жизнь: boolean → LifeLevel (5 уровней) + PlanetLife интерфейс
- P1-18: Вероятность атмосферы приведена к документации
- P1-19: Температурные диапазоны планет приведены к документации
- P1-20: Удалён тип местности 'crater' из HexTerrain
- P1-21: Веса местности приведены к документации
- P1-22: Пропущен (MVP)
- P1-23: JP: макс 6, ограничение по расстоянию, гарантия связности (BFS)
- P1-24: Верификация зданий — создан doc_temp/buildings-verification.md
- P1-25: Создан doc_temp/ores-and-chains.md — все руды и цепочки трансформации
- P1-26: Солнечная станция зависит от светимости звезды и расстояния
- P1-27: Газовый экстрактор требует атмосферу (requiresAtmosphere)
- P1-28: Пропущен (не нужен на данном этапе)
- P1-29: Именованные под-seed'ы через PRNG.derive(name)
- P1-30: Отложено (следующий этап)
- P1-31: HullSize: 7 конкретных классов вместо 4 абстрактных

Stage Summary:
- 20 файлов изменено в src/, docs/, doc_temp/
- Типы: StarType (12), BinaryType (4), AtmosphereType (8), LifeLevel (5), HullSize (7)
- Здания: добавлены layer[] и requiresAtmosphere
- Планеты: 3 слоя застройки, атмосфера как объект, жизнь как объект
- 22 элемента (было 19), 18 рецептов (+ щит, V-ore, Y-ore, Ba-ore)
- Генератор: двойные системы, именованные seed'ы, JP с проверками
- Экономика: светимость звезды, проверка атмосферы
- Lint: 0 ошибок

---
Task ID: 2
Agent: Critical Fix Agent
Task: Р3-01 + Р2-03 — Fix ore deposits producing pure elements + add missing smelting recipes

Work Log:
- Read worklog.md, generator.ts, recipes.ts, engine.ts, elements.ts to understand current state
- **Problem 1 (Р3-01)**: Fixed `assignResourceDeposits()` in `src/galaxy/generator.ts`:
  - Added `mineableElements = ELEMENTS.filter(e => !e.isAtmospheric)` to skip atmospheric elements (H, He, O, N, C, S) from deposit generation — these are extracted via gas_extractor from atmosphere slots
  - Changed `elementId: element.id` → `elementId: \`${element.id}-ore\`` so deposits produce ore IDs (e.g., 'Fe-ore') instead of pure element IDs (e.g., 'Fe')
- **Problem 2 (Р2-03)**: Added 14 missing smelting recipes to `src/data/recipes.ts`:
  - smelt_al: Al-ore(10) → Al(8), energyCost=2, time=150
  - smelt_c: C-ore(10) → C(7), energyCost=2, time=150
  - smelt_ni: Ni-ore(10) → Ni(7), energyCost=3, time=180
  - smelt_w: W-ore(10) → W(6), energyCost=4, time=200
  - smelt_u: U-ore(10) → U(5), energyCost=5, time=250
  - smelt_co: Co-ore(10) → Co(7), energyCost=3, time=180
  - smelt_au: Au-ore(10) → Au(6), energyCost=4, time=200
  - smelt_pt: Pt-ore(10) → Pt(5), energyCost=5, time=250
  - smelt_cr: Cr-ore(10) → Cr(7), energyCost=3, time=180
  - smelt_li: Li-ore(10) → Li(6), energyCost=3, time=180
  - smelt_s: S-ore(10) → S(8), energyCost=2, time=150
  - smelt_v: V-ore(10) → V(6), energyCost=4, time=200
  - smelt_y: Y-ore(10) → Y(4), energyCost=5, time=250
  - smelt_ba: Ba-ore(10) → Ba(6), energyCost=3, time=200
- **Problem 3**: Verified `processExtraction` in `src/economy/engine.ts` — uses `deposit.elementId` directly, which will now correctly be ore IDs. Atmospheric extraction from slots produces pure element IDs (H, He, C, N) as before. No changes needed.
- **Problem 4**: Verified `giveStarterResources` in `src/economy/engine.ts` — already provides ore resources with correct IDs (Fe-ore, Si-ore, etc.). V-ore, Y-ore, Ba-ore already present. No changes needed.
- Lint: 0 errors
- Dev server: compiles successfully

Stage Summary:
- Critical economic bug fixed: mines now produce ores (Fe-ore), not pure elements (Fe)
- 14 smelting recipes added — full coverage for all 18 mineable ores (4 existing + 14 new)
- Atmospheric elements (H, He, O, N, C, S) excluded from surface deposits — only available via gas_extractor
- Smelting chain now works: mine → ore → smelter → pure element → crafting
- 2 files modified (generator.ts, recipes.ts), 0 new files created

---
Task ID: 3
Agent: Bugfix Agent
Task: Fix Critical Engine Bugs in SpaceGame (6 fixes)

Work Log:
- Read current files: src/economy/engine.ts, src/stores/game-store.ts, src/data/buildings.ts
- **Fix 1 (P2-06/P2-07)**: Nuclear plant base output changed from 10 to 25 in all 3 energy loops of recalcEnergyBalance (surface hexes, atmospheric slots, orbit slots). Added `else if (buildingDef.id === 'nuclear_plant')` branch with `production += 25 * levelMult` (no luminosity factor). Fallback remains `10 * levelMult` for unknown energy buildings.
- **Fix 2 (P3-02)**: Energy balance check in processProductionQueue now uses per-tick cost (`recipe.energyCost / item.total`) instead of full recipe cost (`recipe.energyCost`). Prevents production from being blocked when per-tick cost is affordable but full cost isn't.
- **Fix 3 (P3-04)**: Added building size validation in `buildOnHex` — checks `buildingDef.size.includes(planet.size)` after atmosphere check and before resource check. Prevents building structures on planets that are too small/large.
- **Fix 4 (P3-06)**: Added building existence check in `enqueueProduction` — verifies that the recipe's required building (`recipe.buildingId`) exists on the planet across all 3 layers (hexes, atmosphericSlots, orbitSlots) before adding to queue.
- **Fix 5 (P2-26)**: Added `Math.max(0.0001, ...)` guard on `starLuminosity` in `recalcEnergyBalance` to prevent division by zero for black holes or stars with ~0 luminosity.
- **Fix 6 (P3-05)**: Economy tick now scales with game speed in `game-store.ts` `tick()` method. Processes economy `Math.min(gameState.speed, 50)` times per tick (capped at 50 to avoid lag).
- Lint: 0 errors
- Dev server: compiles without errors

Stage Summary:
- 2 files modified: src/economy/engine.ts, src/stores/game-store.ts
- 6 critical engine bugs fixed (P2-06/P2-07, P3-02, P3-04, P3-06, P2-26, P3-05)
- Nuclear plant now produces 2.5x more energy than solar (25 vs 10 base)
- Production queue no longer blocked by full energy cost check
- Building placement validates planet size compatibility
- Production requires building to exist on planet
- Black hole star luminosity safely clamped to prevent division by zero
- Game speed properly scales economy processing (up to 50x)

---
Task ID: 4
Agent: General Agent
Task: Fix Documentation Issues (5 fixes: Р2-02/Р2-17, Р2-04, Р2-11, Р3-11, Р1-45)

Work Log:
- **Fix 1 (Р2-02/Р2-17)**: Gravity formula error in docs/03-planets.md §2.2
  - Changed `(radius / earthRadius)² × (density / earthDensity)` → `(radius / earthRadius) × (density / earthDensity)` (removed erroneous square)
  - Added derivation note: g = GM/r² = G(4/3)πρr³/r² = (4/3)πGρr → g/g_E = (ρ/ρ_E)(r/r_E)
  - Added Mars verification: r=3390km, ρ=3.93 → g = 0.532 × 0.713 = 0.38g ✓
  - Added Р2-17 self-contradiction note: gas giant gravity 1.5–3.0g is consistent with linear formula only (squared would give ~33g)

- **Fix 2 (Р2-04)**: Temperature formula missing unit conversion in docs/03-planets.md §2.3
  - Changed `T_star × sqrt(R_star / (2 × D))` → `T_star × sqrt(R_star × 0.00465 / (2 × D_AU))`
  - Added unit specifications: R_star in R☉, D_AU in AU, conversion factor 0.00465 (1 R☉ = 0.00465 AU)
  - Added Earth verification: 5778 × sqrt(0.00465/2) − 273 = 5.5°C ✓

- **Fix 3 (Р2-11)**: Added 'карликовая' (dwarf) to ARCHITECTURE.md §3.1.2 surface type list
  - Changed: "скалистая, вулканическая, ледяная, газовый гигант, океаническая, пустынная" → added "карликовая" (7 types)

- **Fix 4 (Р3-11)**: Fixed "50 vs 20 elements" contradiction in ARCHITECTURE.md
  - §3.1.3: Changed "Система из **50 элементов**" → "Система из **50 элементов** (полная версия; MVP: 22 ключевых)"
  - §3.1.3 note: Changed generic warning → explicit clarification that §3.1.3 describes full target, §5.1 defines MVP scope
  - §5.1: Changed "Начать с 20 элементов" → "Начать с 22 ключевых элементов"

- **Fix 5 (Р1-45)**: Updated file structure in ARCHITECTURE.md §8 to match actual project
  - `src/core/galaxy/star.ts` → `src/data/star-types.ts`
  - `src/core/galaxy/planet.ts` → `src/data/planet-types.ts`
  - `src/core/economy/elements.ts` → `src/data/elements.ts`
  - `src/core/economy/recipes.ts` → `src/data/recipes.ts`
  - `src/data/*.json` → `src/data/*.ts` (TypeScript, not JSON)
  - `src/core/game-loop/` → `src/core/game-loop.ts` (single file)
  - Added `src/core/event-bus.ts`, `src/core/prng.ts`, `src/core/types.ts`
  - Added `src/stores/game-store.ts` (not in hooks/)
  - Added `src/hooks/use-mobile.ts` and `src/hooks/use-toast.ts` (shadcn hooks)
  - Added `src/galaxy/` module (generator.ts, hex-grid.ts, index.ts)
  - Added `src/economy/` module (engine.ts, index.ts)
  - `src/components/game/` updated to actual files (7 components)
  - Added commented section for planned-but-not-yet-implemented modules (ships/, ai/, tech/, save/)

Stage Summary:
- 2 documentation files modified: docs/03-planets.md, docs/ARCHITECTURE.md
- 0 source code files modified (documentation-only changes)
- Gravity formula corrected from squared to linear radius ratio
- Temperature formula corrected with R☉→AU unit conversion factor
- ARCHITECTURE.md surface types now match 03-planets.md (7 types including карликовая)
- Element count contradiction resolved: §3.1.3 = full target (50), §5.1 = MVP (22)
- §8 file structure now reflects actual codebase layout
