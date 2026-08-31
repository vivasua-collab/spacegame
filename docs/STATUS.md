# STATUS — Статус реализации SpaceGame

> Дата: 2026-06 (после аудита) · Изменён: 2026-08-31 (R-27: авто-переработка, газовый склад v3.1, принуждение резервов, синергия +3 правила)
> Принцип: **Документация в `docs/` первична** — это спецификация, источник истины.
> Код должен соответствовать документации. Расхождения трактуются как баги/незавершённость реализации.

---

## Содержание

1. [Сводка](#1-сводка)
2. [Что реализовано (соответствует спецификации)](#2-что-реализовано)
3. [Что не реализовано (есть в спецификации, нет в коде)](#3-что-не-реализовано)
4. [Расхождения кода со спецификацией (баги)](#4-расхождения-кода-со-спецификацией)
5. [Технический долг](#5-технический-долг)
6. [Метрики](#6-метрики)
7. [Рекомендации](#7-рекомендации)

---

## 1. Сводка

| Параметр | Значение |
|----------|----------|
| Этап по ROADMAP | Etap 2 / 2.5 / 2.6 / 3.0 — ✅; data-driven: R-BLD-MOD / R-RES / R-SHIPS-DATA (2026-08-28) + R-STARS-DATA = **Etap 4.1 — ✅ (2026-08-31)** |
| Следующий этап | Etap 4.2 — планетарный каталог (data-driven, рекомендация Pass 9); AI-фракции — после пересмотра порядка этапов |
| Работает ли MVP | ✅ Да (генерация, колонизация, типовая синергия застройки 7 правил, авто-переработка базовых руд R-27, газовый склад v3.1, снос/понижение уровней, добыча, крафт, флот, исследования R-SPLIT, сохранение) |
| Критические баги | 1 (P0-1: Store→mediator sync — 21 прямое действие) |
| Спецификации без реализации | 1 (AI-фракции; флот+исследования завершены как MVP) |
| Lint-ошибок | 0 ✅ (48 warnings) |
| Тестов | 555 / 555 ✅ (0 failing) |
| Рецепты | 75 / 75 ✅ (validate:recipes) |
| Валидаторы каталогов | 4 ✅ (buildings+synergy / recipes / ships / stars — `validate:all`) |

---

## 2. Что реализовано

### 2.1 Ядро движка (`src/core/`, 9 файлов)

| Компонент | Спецификация | Реализация | Статус |
|-----------|--------------|------------|--------|
| PRNG (xoshiro256**) | 00-ARCHITECTURE.md §3.1 | `prng.ts` (4 хеша derive) | ✅ |
| TypedEventBus | architecture/modular-bus.md | `typed-event-bus.ts` (приоритеты, replay, defer) | ✅ |
| ModuleRegistry | architecture/modular-bus.md | `module-registry.ts` (топосорт) | ✅ |
| GameMediator | architecture/modular-bus.md | `game-mediator.ts` | ✅ |
| GameLoop | 00-ARCHITECTURE.md §3.1 | `game-loop.ts` (пауза, x1/x5/x15/x50) | ✅ |
| Типы | docs/01-07 | `types.ts` (462 строки) | ✅ |

### 2.2 Галактика (`src/galaxy/`, 10 файлов)

| Компонент | Спецификация | Реализация | Статус |
|-----------|--------------|------------|--------|
| Спиральная генерация | 10-galaxy.md | `generate-positions.ts` | ✅ |
| 12 типов звёзд | 20-stars.md §2.1 | `generate-systems.ts` (Стефан-Больцман) | ✅ |
| Двойные/тройные системы | 20-stars.md §2.7 | BinaryType + StarSystem.stars[] | ✅ |
| 7 типов планет | 30-planets.md §2.1 | `generate-planets.ts` | ✅ |
| Гекс-сетка (19/37/61/91/127) | 30-planets.md §2.1 | `hex-grid.ts` (axial) | ✅ |
| 8 типов атмосферы | 30-planets.md §2.4 | AtmosphereType + Atmosphere | ✅ |
| 5 уровней жизни | 30-planets.md §2.5 | LifeLevel + PlanetLife | ✅ |
| Газовые гиганты (3 слоя) | 30-planets.md §3 | 0 гексов + atmosphericSlots + orbitSlots | ✅ |
| Jump Points + связность | 10-galaxy.md §4 | `generate-jump-points.ts` (BFS) | ✅ |
| Температура (Стефан-Больцман) | 20-stars.md §5 | T = 5778 × (L/R²)^0.25 | ✅ |

### 2.3 Ресурсы и химия (`src/data/`)

| Компонент | Спецификация | Реализация | Статус |
|-----------|--------------|------------|--------|
| 60 элементов (57 base + 3 transuranic Np/Pu/Am) | 32-mendeleev.md, 33-chemistry.md | `elements.ts` (chemicalCharacter, rarity) | ✅ |
| ~56 руд (автогенерация) | 34-ores.md, 33-chemistry.md | `chemistry/ore-specs.ts` + `ore-generator.ts` (~1700 строк в `src/data/chemistry/`) | ✅ |
| BakedGalaxyModel | galaxy-bake.md | `chemistry-generator.ts` (шим-реэкспорт) + `baked-lookups.ts` | ✅ |
| Атмосферные соединения | 33-chemistry.md §9 | `processing-chains.ts` (11 газов) | ✅ |
| Ледяные соединения | 33-chemistry.md §9 | `processing-chains.ts` (5 льдов) | ✅ |
| Самородные элементы | 33-chemistry.md §8 | `processing-chains.ts` (6 самородков) | ✅ |

### 2.4 Экономика (`src/economy/`)

| Компонент | Спецификация | Реализация | Статус |
|-----------|--------------|------------|--------|
| Добыча руд | 40-buildings.md §2 | `engine.ts:processExtraction` | ✅ |
| Крафт (4 уровня) | 40-buildings.md §3, §6 | `engine.ts:processProductionQueue` | ✅ (Block 01 P1 — ID руд унифицированы) |
| Энергия (поток) | 40-buildings.md §8 | `engine.ts:recalcEnergyBalance` | ✅ |
| Солнечная станция | 40-buildings.md §8.1 | 10 × L / D × levelMult | ✅ |
| Ядерный реактор | 40-buildings.md §8.2 | 25 × levelMult (было 10) | ✅ |
| Специализация зданий | 40-buildings.md §11 | `specializeBuilding` + `upgradeSpecialization` | ✅ (Block 05) |
| Очередь производства | 40-buildings.md §1.3 | `enqueueProduction` + repeat | ✅ (Block 01 P4 — UI готов) |
| Колонизация | (нет отдельной spec) | `colonizePlanet` + colony_hub | ✅ |
| Флот + приказы | 50-ships.md | `src/ships/fleet-engine.ts` + `orders.ts` | ✅ (Block 02) |
| Исследования | 60-research.md | `src/research/engine.ts` + `research-module.ts` | ✅ (Block 03) |

### 2.5 Здания (`src/data/buildings.ts`)

**Реализовано 15 из 27 зданий** спецификации 40-buildings.md §10.1 (26 + colony_hub):

| # | ID | Спецификация | Реализация |
|---|-----|--------------|------------|
| 1 | `colony_hub` | (добавлен в ходе разработки) | ✅ |
| 2 | `mine` | 40-buildings.md §2.1 | ✅ |
| 3 | `quarry` | 40-buildings.md §2.2 | ✅ |
| 4 | `gas_extractor` | 40-buildings.md §2.3 | ✅ |
| 5 | `processor` | 40-buildings.md §3 (универсальный) | ✅ |
| 6 | `synthesizer` | 40-buildings.md §3 (универсальный) | ✅ |
| 7 | `refinery` | 40-buildings.md §3.4 | ✅ |
| 8 | `solar_plant` | 40-buildings.md §8.1 | ✅ |
| 9 | `nuclear_reactor` | 40-buildings.md §8.2 | ✅ (Block 01 C8 — расхождение ID закрыто) |
| 10 | `shipyard` | 40-buildings.md §7 | ✅ |
| 11 | `warehouse` | 40-buildings.md §4.3 | ✅ |
| 12 | `open_warehouse` | 40-buildings.md §4 | ✅ |
| 13 | `high_tech_storage` | 40-buildings.md §4 | ✅ |
| 14 | `spaceport` | 40-buildings.md §4.4 | ✅ |
| 15 | `laboratory` | 40-buildings.md (impl. в Block 03) | ✅ |

**Не реализовано 12-14 зданий** (см. §3.2 для списка post-MVP).

### 2.6 UI (`src/components/game/`, 17 файлов)

| Компонент | Спецификация | Реализация | Статус |
|-----------|--------------|------------|--------|
| Карта галактики (SVG, зум 80x) | 10-galaxy.md | `galaxy-map.tsx` (538 строк) | ✅ |
| Экран системы | 20-stars.md | `system-view.tsx` | ✅ |
| Экран планеты (гекс-сетка) | 30-planets.md | `planet-view.tsx` (846 строк) | ✅ (атмосфера/орбита готова, Block 01 P3 закрыт) |
| Диалог строительства | 40-buildings.md | `building-dialog.tsx` | ✅ (Block 01 P3 закрыт) |
| Управление временем | 00-ARCHITECTURE.md | `time-controls.tsx` | ✅ |
| Панель ресурсов | — | `resource-panel.tsx` | ✅ (Block 01 P5 — крафтовые материалы в категории) |
| Диалог специализации | 40-buildings.md §11.4 | `specialize-dialog.tsx` | ✅ (Block 05) |
| Очередь производства | 40-buildings.md §1.3 | `production-queue.tsx` + `production-queue-panel.tsx` | ✅ (Block 01 P4 закрыт) |
| Верфь + конструктор кораблей | 50-ships.md | `shipyard-dialog.tsx`, `ship-designer.tsx`, `ship-card.tsx` | ✅ (Block 02) |
| Флот + приказы + маршрут | 50-ships.md | `fleet-view.tsx`, `fleet-orders-panel.tsx`, `fleet-route-overlay.tsx` | ✅ (Block 02) |
| Экран исследований | 60-research.md | `research-view.tsx` | ✅ (Block 03) |
| Склад (Sheet) | — | в `planet-view.tsx` | ✅ |

### 2.7 Сохранение/загрузка

| Компонент | Реализация | Статус |
|-----------|------------|--------|
| Prisma schema (GameSave) | `prisma/schema.prisma` | ✅ |
| API routes | `/api/save` (GET/POST/PUT/DELETE) | ✅ |
| Сериализация (systemMap excl.) | `game-store.ts:serializeGameState` | ✅ |
| Таймаут 30с + AbortController | `game-store.ts:saveGame` | ✅ |
| Toast-уведомления | `game-layout.tsx:SaveButton` | ✅ |

---

## 3. Что не реализовано

### 3.1 Крупные системы

| Система | Спецификация | Строк spec | Этап | Статус |
|---------|--------------|-----------|------|--------|
| **Флот и корабли** | `docs/50-ships.md` | 1 464 | Etap 3.0 | ✅ Реализовано (Block 02, MVP) |
| **Исследования** | `docs/60-research.md` | 1 348 | Etap 3.0 | ✅ Реализовано (Block 03, MVP) |
| **AI-фракции** | `docs/70-ai.md` | 2 350 | Etap 3.5 | ❌ 0% (не реализовано) |
| **Боевая система** | (часть 70-ai.md) | — | Etap 4 | ❌ Не реализовано |
| **Дипломатия** | (часть 70-ai.md) | — | Etap 4 | ❌ Не реализовано |
| **Терраформирование** | 60-research.md | — | Etap 4 | ❌ Не реализовано |
| **Макрообъекты галактики** | 10-galaxy.md §5 | — | Etap 4 | ❌ Не реализовано |

> Спецификации AI/бой/дипломатия готовы — ИИ-агенты смогут реализовывать по ним.

### 3.2 Здания (12 из 27 не реализованы)

> По упрощённому счёту: 27 (spec §10.1) - 15 (code) = 12. По фактической проверке кода — 14 не реализованы (вкл. `antimatter_gen`), см. audit Pass 3 §P2-3.

| ID | Название | Спецификация | Приоритет |
|----|----------|--------------|-----------|
| `drilling_rig` | Бурильная установка | 40-buildings.md §2.4 | Post-MVP |
| `ice_harvester` | Ледодобывающая станция | 40-buildings.md §2.5 | Post-MVP |
| `electronics_plant` | Завод электроники | 40-buildings.md §6 | MVP-дополнение |
| `engine_plant` | Завод двигателей | 40-buildings.md §7 | Post-MVP |
| `weapon_plant` | Завод оружия | 40-buildings.md §7 | Post-MVP |
| `shield_plant` | Завод щитов | 40-buildings.md §7 | Post-MVP |
| `hull_plant` | Завод корпусов | 40-buildings.md §7 | MVP-дополнение |
| `orbital_shipyard` | Орбитальная верфь | 40-buildings.md §7 | Post-MVP |
| `fusion_reactor` | Термоядерный реактор | 40-buildings.md §8 | Post-MVP |
| `geothermal_plant` | Геотермальная станция | 40-buildings.md §8 | Post-MVP |
| `antimatter_reactor` | Антиматериальный реактор | 40-buildings.md §8 | Post-MVP |
| `antimatter_gen` | Антиматериальный генератор | 40-buildings.md §10.1 | Post-MVP |
| `conveyor` | Конвейерная лента | 40-buildings.md §4 | Спринт 1 |
| `auto_transport` | Автотранспорт | 40-buildings.md §4 | Post-MVP |

> ✅ Реализованы (15): colony_hub, mine, quarry, gas_extractor, processor, synthesizer, refinery, solar_plant, nuclear_reactor, shipyard, warehouse, open_warehouse, high_tech_storage, spaceport, laboratory.

### 3.3 Прочее

| Компонент | Спецификация | Статус |
|-----------|--------------|--------|
| Сканер (здание) | 00-ARCHITECTURE.md §3.1.4 | Не реализовано |
| Оборонительная платформа | 00-ARCHITECTURE.md §3.1.4 | Не реализовано |
| Торговый хаб | 00-ARCHITECTURE.md §3.1.4 | Не реализовано |
| Варп-перемещение | 50-ships.md | Не реализовано |
| Терраформирование | 60-research.md | Не реализовано |
| Артефакты/руины | 60-research.md (xenoarch) | Не реализовано |

---

## 4. Расхождения кода со спецификацией (баги)

### 4.1 Критические 🔴

> Все исторические критические расхождения (P1, P3, ID-N1) закрыты: Block 01 P1 (ID руд), Block 01 P3 (UI атмосферы/орбиты), Block 01 C8 (nuclear_reactor ID). См. `checkpoints/08_27_audit_0{1,2,3,4}_*.md`.

| ID | Расхождение | Спецификация | Код | Влияние |
|----|-------------|---------------|-----|---------|
| ~~P1~~ | ~~ID руд в рецептах~~ | chemistry-generator: `hematite`, `ilmenite` (формула минерала) | recipes.ts: `Fe-ore`, `Ti-ore` (хардкод) | ✅ Закрыто (Block 01 P1 — `baked-lookups.ts`) |
| ~~P3~~ | ~~UI для атмосферы/орбиты~~ | 40-buildings.md §2 (газовый экстрактор на atmosphere layer) | `building-dialog.tsx`: только surface | ✅ Закрыто (Block 01 P3 — atmosphere/orbit layers) |
| **P0-1** | Store→mediator sync | (architecture/modular-bus.md) | `game-store.ts` — 21 прямое действие без sync | 🔴 Открыто (Pass 1) |

### 4.2 Значительные 🟡

| ID | Расхождение | Спецификация | Код | Влияние |
|----|-------------|---------------|-----|---------|
| ~~ID-N1~~ | ID ядерного реактора | 40-buildings.md §10.1: `nuclear_reactor` | buildings.ts: `nuclear_reactor` | ✅ Закрыто (Block 01 C8) |
| **P5** | Крафтовые материалы в UI | (нет spec) | ResourcePanel: steel, microchip в «Прочих» | UX проблема |
| **P6** | Colony Hub стоимость | (нет spec, но логически) | `costPerLevel: {}` — бесплатный апгрейд | Эксплойт |
| **P7** | Тип `transuranic` | 33-chemistry.md §10 (трансурановые) | ElementCategory: есть, элементов: нет | Мёртвый тип (Block 01 P7 добавил 3 transuranic — частично закрыто) |

### 4.3 Незавершённость 🟢

| ID | Описание | Влияние |
|----|----------|---------|
| ~~P4~~ | ~~Нет UI очереди производства~~ | ✅ Закрыто (`production-queue-panel.tsx`) |
| ~~P2~~ | ~~Прямые мутации в game-store.ts~~ | ✅ Закрыто (Block 01 P2 — immer middleware) |
| ~~DEP-1~~ | ~~`event-bus.ts` (@deprecated) используется в engine.ts~~ | ✅ Закрыто (Block 01 C1 — файл удалён) |
| ~~DEAD-1~~ | ~~`extractOreToElements` в engine.ts (@deprecated)~~ | ✅ Закрыто |
| **P0-1** | Store→mediator sync (21 прямое действие) | Pass 1 — открыт |
| **DUP-1** | Дублирование блоков в `recalcEnergyBalance` (3 цикла) | DRY нарушение |
| **HARDCODE-1** | `ATMOSPHERE_GAS_MAP`, `DIRECT_GAS_MAP` в engine.ts | Данные в логике |

---

## 5. Технический долг

### 5.1 Качество кода

> Большинство пунктов ниже закрыты (Block 01-08). Открытые пункты помечены 🔴. См. `checkpoints/08_27_audit_0{1,2,3,4}_*.md` для деталей.

| Проблема | Файл | Оценка времени | Статус |
|----------|------|----------------|--------|
| ~~Прямые мутации состояния (P2)~~ | `game-store.ts`, `engine.ts` | ~~6 ч (immer)~~ | ✅ Закрыто (Block 01 P2 — immer middleware) |
| ~~Дублирование recalcEnergyBalance~~ | `engine.ts:284-350` | ~~2 ч~~ | ✅ Закрыто (Block 01 P2 cleanup) |
| ~~Хардкод атмосферных газов~~ | `engine.ts:136-153` | ~~1 ч~~ | ✅ Закрыто (`atmosphere-gases.ts`) |
| ~~@deprecated функции и шины~~ | ~~`engine.ts:13`, `event-bus.ts`~~ | ~~1 ч~~ | ✅ Закрыто (Block 01 C1 — `event-bus.ts` удалён) |
| ~~Крупные файлы (>500 строк)~~ | chemistry-generator (1704), planet-view (846), recipes (771) | ~~4 ч (разбить)~~ | ✅ Частично: chemistry-generator разбит в `src/data/chemistry/` (Block 01 C5) |
| 🔴 Store→mediator sync (P0-1) | `game-store.ts` (21 прямое действие) | ~6 ч | 🔴 Открыто (Pass 1) |

### 5.2 Тесты (✅ закрыто в Block 01-08)

> Покрытие тестами завершено (340/340 ✅ passing, 0 failing). См. `tests/` для актуального списка тестов.

| Что нужно | Покрытие | Время | Статус |
|-----------|----------|-------|--------|
| PRNG детерминизм | `prng.ts` + `prng-statistical.test.ts` | ~~1 ч~~ | ✅ Закрыто |
| Snapshot генерации галактики | `galaxy-snapshot.test.ts` | ~~2 ч~~ | ✅ Закрыто |
| Экономика (добыча → крафт) | `economy.test.ts` + `processors.test.ts` | ~~2 ч~~ | ✅ Закрыто |
| Chemistry-generator (молярные массы) | `chemistry.test.ts` | ~~2 ч~~ | ✅ Закрыто |
| Сериализация (save → load → equals) | `serialization.test.ts` + `api-save.test.ts` | ~~1 ч~~ | ✅ Закрыто |
| Immutability (immutable store) | `immutability.test.ts` | — | ✅ Закрыто (Block 01 P2) |
| Modular integration | `modular-integration.test.ts` | — | ✅ Закрыто (Block 06) |
| Game loop | `game-loop.test.ts` | — | ✅ Закрыто |
| Ships (Block 02) | `tests/ships/*` (90 tests: fleet-engine, orders, designer, shipyard) | — | ✅ Закрыто |
| Research (Block 03) | `tests/research/*` (164 tests: process-tick, tree-data, cost-formulas, lab-rp, focus-bonus, branch-ceilings, prerequisites) | — | ✅ Закрыто |
| **Итого тестов** | — | ~~8 ч~~ | ✅ **340 / 340 passing** |

### 5.3 Загрязнение репозитория (ИСПРАВЛЕНО ✅)

| Было | Стало |
|------|-------|
| 33 MB, 637 файлов | 14 MB, ~165 файлов |
| skills/ (18 MB, 453 файла) | Удалено |
| upload/ (1.7 MB) | Удалено |
| examples/, agent-ctx/, download/ | Удалено |
| .gitignore не настроен | .gitignore обновлён |

---

## 6. Метрики

### 6.1 Реализация

| Метрика | Значение |
|---------|----------|
| Строк игрового кода (src/, без shadcn) | ~29 000 |
| Строк shadcn/ui | ~5 400 |
| Файлов в src/ | 147 |
| Элементов (в коде / по spec) | 60 / 60 ✅ (57 base + 3 transuranic) |
| Руд (в коде) | 56 |
| Зданий (data-driven JSON / по spec) | 17 / 27 (63%) + 7 правил синергии (synergy.json) |
| Рецептов (в коде) | 75 ✅ (validate:recipes 75/75) |
| Типов звёзд | 12 / 12 ✅ (data-driven: `src/data/stars/types.json`) |
| Типов планет | 7 / 7 ✅ + сетки планет/лун из `src/data/planets/grids.json` |
| Компонентов UI (game/) | 17 |
| Тестов | 555 / 555 ✅ (0 failing) |
| Lint-ошибок | 0 ✅ (48 warnings) |

### 6.2 Документация

| Метрика | Значение |
|---------|----------|
| Файлов в docs/ | 29 |
| Строк в docs/ | ~23 700 |
| Файлов в checkpoints/ | 40 (аудиты Pass 1-11: `08_27_audit_01..04`, `08_28_audit_05..09`, `08_31_audit_10..11` — имена по `checkpoints/RULES.md`) |
| Спецификации с 0% реализации | 1 (AI-factions; ships+research завершены как MVP в Block 02/03) |

### 6.3 Разработка

| Метрика | Значение |
|---------|----------|
| Git-коммитов | 7+ (history rewritten per audit Pass 1) |
| Активных дней разработки | 11+ (2026-05-03, 04, 12, 13, 22, 06-26, 08-27 + Block 01-08, 08-28, 08-31) |
| Lint-ошибок | 0 ✅ (48 warnings) |
| Тестов | 555 / 555 ✅ (0 failing) |

---

## 7. Рекомендации

### 7.1 Принцип

**Документация в `docs/` — источник истины.** Код должен быть приведён в соответствие со спецификациями, не наоборот.

### 7.2 Приоритеты следующего этапа (актуализация 2026-08-31)

> Etap 2.5 (стабилизация P1-P7), Etap 2.6 (engineering quality Block 07), Etap 3.0 (Block 02 флот + Block 03 исследования) — ✅ Завершены. Data-driven: R-BLD-MOD / R-RES / R-SHIPS-DATA (2026-08-28) + R-STARS-DATA = **Etap 4.1 (2026-08-31) ✅**. См. `checkpoints/08_27_audit_0{1,2,3,4}_*.md`, `08_28_audit_0{5..9}_*.md`, `08_31_audit_1{0,1}_*.md`.

| Приоритет | Задача | Время | Тип |
|-----------|--------|-------|------|
| 🔴 NEXT | Etap 4.2 — планетарный каталог (planet-types.ts → planets/types.json, рекомендация Pass 9 §3.3.2) | ~4 ч | Data-driven |
| 🟡 BACKLOG | AI-фракции (5 базовых фракций, `src/ai/`, spec 70-ai.md) — порядок этапов пересмотрен: сначала 4.x data-driven | ~3 нед | Etap (бывш. 3.5) |
| ✅ NEXT-2 | ~~Возврат кросс-типовых правил синергии~~ — **выполнено в R-27** (mine_processor +15%, warehouse_production +20%, + generator_cluster +5%; §5.5) | — | Геймплей |
| 🔴 P0-1 | Store→mediator sync (21 прямое действие, see Pass 1) | ~6 ч | Арх. долг |
| 🟡 Pass 2 P1-2 | Cross-layer import в fleet-engine (clean architecture) | ~1 ч | Рефакторинг |
| 🟡 Pass 2 P3-5 | `FUEL_PRIORITY` вынести в `fuel-map.ts` | ~0.5 ч | Чистота |
| 🟡 Pass 2 P3-6 | `prng.ts` название «xoshiro256**» → уточнить (32-bit) | ~0.5 ч | Документация |
| 🟡 Etap 4 stubs | resolveCombat, canColonizePlanet, antimatter fuel, terraforming | ~6 нед | Будущее |

### 7.3 Расхождения ID (решение за владельцем)

| Расхождение | Вариант A (править код) | Вариант B (править spec) |
|-------------|-------------------------|--------------------------|
| ~~`nuclear_plant` vs `nuclear_reactor`~~ | ✅ Закрыто (Block 01 C8): код использует `nuclear_reactor` | n/a |
| ~~`Fe-ore` vs `hematite`~~ | ✅ Закрыто (Block 01 P1): `recipes.ts` → `baked-lookups.ts` | n/a |
| ~~`smelter`/`chemical_plant`/`petrochem_plant`~~ | ✅ Закрыто (Block 05): переименованы в `processor`/`synthesizer`/`refinery` | n/a |

> Рекомендация: для всех будущих расхождений ID — править код (в плане иммерсивного рефакторинга, см. Pass 1 P0-1). Все исторические расхождения (`nuclear_plant`, `Fe-ore`, `smelter/chemical_plant/petrochem_plant`) — ✅ закрыты (Block 01 C8/P1, Block 05).

### 7.4 Дальнейшие этапы (по ROADMAP)

| Этап | Срок | Содержание | Статус |
|------|------|------------|--------|
| 2.5 Стабилизация | ~1 неделя | P1-P7 + тесты | ✅ Завершён (Block 01, 08-27) |
| 2.6 Engineering quality | ~1 неделя | TS strict, ESLint, PRNG fix | ✅ Завершён (Block 07, 08-27) |
| 3.0 Флот + исследования | 3-4 недели | По specs 50-ships.md, 60-research.md | ✅ Завершён (Block 02/03, 08-27) |
| 3.5 AI-фракция | 3 недели | По spec 70-ai.md (5 базовых) | ❌ Pending |
| 4 Глубокие системы | 6 недель | Бой, дипломатия, макрообъекты | ❌ Etap 4 |
| 5 Полировка | 6 недель | Баланс, контент, оптимизация | ❌ Etap 5 |

### 7.5 Подход к разработке через ИИ-агентов

**Etap 2.5/2.6/3.0 завершён:** P2 (immutable store), тесты (340/340), флот (Block 02), исследования (Block 03) — всё готово.

**Перед Etap 3.5:** закрыть Pass 1 P0-1 (store→mediator sync для 21 прямого действия) — это позволит ИИ-агентам уверенно добавлять AI-фракции без рассинхронизации с движком.

---

## История изменений

| Дата | Автор | Изменение |
|------|-------|-----------|
| 2026-08-31 | R-27 (Task ID 27) | Авто-переработка базовых строительных руд (Fe/Si/Al/C/Cu/Ti) переработчиками без очереди (жалоба №2/№3/№4); газовый склад v3.1 2000 ед. (жалоба №5/№7 — газы больше не забивают рудный); принуждение резервов в canStoreResource (долг минимумов, жалоба №6); синергия generator_cluster + возврат mine_processor/warehouse_production (жалоба №1). Docs: 40-buildings.md §5/§11.4, 35-warehouse §1.3/§1.4. План: `plans/2026-08-31-task27-auto-processing-gas-warehouse.md` |
| 2026-08-31 | R-26 (Task ID 26) | Гравитационная градация планет по классам размера (полосы тип×класс, без инверсий; плотность выводится из g×R); сжатый транспорт сейвов gzip-base64 (фикс EntityTooLarge 32 МБ шлюза); инспектор дампа `bun run save:inspect`. Docs: 30-planets.md §2.2.1. План: `plans/2026-08-31-task26-planet-gravity-save.md` |
| 2026-08-31 | cleanup (Task ID 25) | Чекпоинты `audit_YYYY_MM_DD_NN_*` переименованы под `checkpoints/RULES.md` → `ММ_ДД_цель.md` (11 файлов); README: секция «Документы процесса»; STATUS-актуализация. План: `plans/2026-08-31-task25-checkpoint-cleanup-docs-sync.md` |
| 2026-08-31 | R-24 (Task ID 24) | Синергия v2 типовая (generator/extractor/…; power_boost +5% генерации, mining_cluster +10% добычи; подтипы изолированы), реальная генерация энергии P1-26 в UI зданий, 2-шаговое подтверждение сноса. Docs: 40-buildings.md §5/§5.5/§9.5 |
| 2026-08-31 | R-23 (Task ID 23) | Движок синергии смежности (adjacency), понижение уровня/снос зданий (50% возврат), R-SPLIT: банк RP (фундаменталы) + потоковое дерево. Docs: 40-buildings.md §5.4/§9.5, 60-research.md §3.1.1/§3.3 |
| 2026-08-31 | R-STARS-DATA (Etap 4.1) | Звёздный каталог → `src/data/stars/types.json` (7+5, доля specials ~4%), сетки планет/лун → `src/data/planets/grids.json`, валидатор validate:stars. Docs: 20-stars.md §7.2, data-driven-architecture.md §2.4 |
| 2026-08-28 | audit Pass 5-9 + R-BLD-MOD / R-SHIPS-DATA | UX-фиксы, редизайн исследований, data-driven здания (surface/orbit/space JSON) и корабли (hulls/modules/fuel-map JSON), оценка генерации галактики. Чекпоинты: `08_28_audit_05..09_*.md` |
| 2026-08-27 | docs-sync (Task ID 25) | Синхронизация STATUS.md с кодом per audit Pass 3 findings |
| 2026-08-27 | audit Pass 1/2/3/4 | `checkpoints/08_27_audit_0{1,2,3,4}_*.md` — full audit |
| 2026-06 | Аудит (после очистки) | Создан как отчёт реализации vs спецификация |
| 2026-05-12 | dev_plan | План P1-P7 в `checkpoints/05_12_dev_plan.md` |
| 2026-05-03 | audit_final | 69 расхождений, 14 P0 закрыто (см. `docs/audit-history.md`) |
