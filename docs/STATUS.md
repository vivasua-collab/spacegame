# STATUS — Статус реализации SpaceGame

> Дата: 2026-06 (после аудита) · Изменён: 2026-10-27 (R-44: этап 3б.1 — постоянное состояние AI-фракций + save/load контракт v3 (aiFactions/aiFactionsV), допуск владельца на 3б; R-43: синхронизация статуса после приёмки владельцем — этап 3а = PASS (Issue #5 закрыт), этап 3б НЕ НАЧАТ (gated Issue #6); docs-only, исходники не менялись; R-41: этап 3а — каркас AI (Issue #5); R-39: P0-1 Store→Mediator ЗАКРЫТ — единая шина gameBus=mediator.bus, instance-tracking, интеграционные тесты T1–T19, GameLoop lifecycle, saveGame race; P5/P6 закрыты с тестами; R-38: миграция сейвов с материализованными залежами — sv/DEPOSIT_SUMMARY_VERSION; R-37: контракт «свод = добыча» + версионно-совместимая материализация dv=3 + схема этапов 3/3а/3б/4; R-36: ultra_rare вариант «а» + drilling_rig в MVP; R-35: PRNG/радиус; R-32: восстановление; R-31: аудит Pass 12)
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
| **Схема этапов (синхронизация R-43)** | Этапы 0–2 завершены и опубликованы (R-33/R-34, коррекции R-35–R-40; R-42 — повторный аудит). **Этап 3а (подготовка AI) — ВЫПОЛНЕН (R-41) и ПРИНЯТ ВЛАДЕЛЬЦЕМ: PASS (2026-10-27, Issue #5 закрыт)** — архитектурный каркас (типы, world model/perception, инертная intent-очередь, модульная проводка), игровых действий НЕТ. **Этап 3б (исполнение) — срез 3б.1 ВЫПОЛНЕН (R-44, допуск владельца на 3б дан явно): постоянное состояние AI-фракций (GameState.aiFactions — ссылочные сущности БЕЗ копий владений/ресурсов) + save/load контракт v3 (aiFactions/aiFactionsV, старые сейвы совместимы побайтно); игровые действия по-прежнему НЕТ**. Срезы 3б.2 (per-faction perception), 3б.3 (Utility-экономика), 3б.4+ (GOAP/экспансия/военный/торговля/дипломатия) — НЕ НАЧАТЫ (план: plans/2026-10-27-r43-stage3b-roadmap.md). GOAP/Utility execution, per-faction fog-of-war — НЕ реализованы. **Переход к этапу 4 ЗАПРЕЩЁН до отдельной приёмки 3б**. Метки «Etap 4.1/4.2» — ВНУТРЕННИЙ трек data-driven-каталогов, НЕ этап 4 дорожной карты |
| Работает ли MVP | ✅ Да (генерация, колонизация, типовая синергия застройки 7 правил, авто-переработка базовых руд R-27, газовый склад v3.1, снос/понижение уровней, добыча (вкл. глубинную — буровая, R-36/R-37), крафт, флот, исследования R-SPLIT, сохранение/загрузка (ленивые залежи + версионно-совместимая материализация R-37)) |
| Критические баги | 0 ✅ (P0-1 Store→mediator sync ЗАКРЫТ в R-39: единая шина, instance-tracking, тесты T1–T19; см. §4.1) |
| Спецификации без игровой реализации | 1 (AI-фракции, docs/70-ai.md — этап 3: каркас 3а принят владельцем (PASS); 3б.1 — постоянное состояние фракций + save/load контракт выполнено (R-44, ожидает приёмки); игровое поведение (действия) 3б.2–3б.4 не начато) |
| Lint-ошибок | 0 ✅ (38 warnings) |
| Тестов | 900 / 900 ✅ (0 failing; R-44: +36 постоянное состояние AI-фракций 3б.1 — валидация/реестр/roster-детерминизм/save-load v3/lifecycle/инертность при фракциях; R-41: +33 каркас AI 3а; R-42 follow-up: +6; R-42: +32; R-40: +20; R-39: +19) |
| Рецепты | 75 / 75 ✅ (validate:recipes) |
| Валидаторы каталогов | 4 ✅ (buildings+synergy / recipes / ships / stars — `validate:all`) |
| Не реализовано из спеки (исключения, требуют одобрения владельца) | 0 — оба отклонения §2.4 (тех-гейт «Глубокое бурение», гео-бонусы) закрыты в R-40 (GitHub Issue #4); см. §3.3 |

---

## 2. Что реализовано

### 2.1 Ядро движка (`src/core/`, 11 файлов)

| Компонент | Спецификация | Реализация | Статус |
|-----------|--------------|------------|--------|
| PRNG (xoshiro128** канонический, R-35) | 00-ARCHITECTURE.md §3.1 · 10-galaxy.md §1.2 | `prng.ts` (эталонные векторы C) | ✅ |
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

**Реализовано 18 из 27 зданий** спецификации 40-buildings.md §10.1 (26 + colony_hub; R-36: + drilling_rig):

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
| 16 | `drilling_rig` | 40-buildings.md §2.4 | ✅ (R-36: deep_ore/drilling_rig, порог minSourceLevel; R-40: тех-гейт deep_drilling (build/upgrade + UI) и гео-бонусы по типу планеты — §2.4 соответствует целиком) |
| 17 | `deep_space_sensor` | 00-ARCHITECTURE.md §3.1.4 (сканер) | ⚠️ Только запись каталога (data-driven): строится, механики сканера НЕТ (см. §3.4) |
| 18 | `starlift_collector` | data-driven каталог | ⚠️ Только запись каталога (data-driven): строится, собственной механики НЕТ |

**Не реализовано 9 из 27 зданий** (см. §3.2 для списка post-MVP; две записи каталога — `deep_space_sensor`, `starlift_collector` — без собственной механики, см. §3.4).

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
| Сериализация (systemMap excl.) + **компактный формат v3 (R-29, ленивые залежи; R-30 — единственный формат)** | `game-store.ts:serializeGameState` + `src/lib/save-format-v3.ts` | ✅ |
| Таймаут 30с + AbortController | `game-store.ts:saveGame` | ✅ |
| Toast-уведомления | `game-layout.tsx:SaveButton` | ✅ |

> **R-30 (2026-08-31) — v3 — единственный формат:** совместимость v1/v2
> удалена по решению владельца (старые сейвы стёрты, заглушки захламляют
> код): `expandSaveV2`/`compactSaveV2`/`migrateLegacyDepositFlags` удалены,
> файл `save-format-v2.ts` удалён (хелперы round3/roundSig4/TIER —
> перенесены в v3). `deserializeGameState` принимает только `fmt:3` —
> сейвы старых форматов отклоняются явной ошибкой (не молчаливой порчей
> состояния); UI: тост «Не удалось загрузить сейв» при отказе. Тесты:
> `save-format-v2.test.ts` удалён (−11), тест 9 в v3 переписан на отказ
> старых форматов → 567/567.
>
> **R-29 (2026-08-31) — ленивые залежи + формат сейва v3:** при генерации
> галактики залежи гексов НЕ запекаются — известен только свод-пул
> `resourceDeposits` («верхнеуровневый пул», замысел владельца); снимок
> RNG (`depositRngState`) хранится для воспроизводимой материализации.
> `colonizePlanet` материализует залежи бит-в-бит (replay прогона
> генерации); флаг `depositsMaterialized` исключает дубли. Формат v3:
> словарь `galaxy.dict`
> (кортежи-индексы), `ds`/`dm` на телах, истощённые кортежи (qty≤0) не
> пишутся. Свежий сейв 200 систем: **8.86 → 2.74 МБ (−69%)**, gzip 0.59 МБ;
> «мёртвые» гексы не попадают в сейв. Анализ: `bun run save:size`.
>
> **R-38 (2026-10-27) — миграция материализованных тел + `sv`:** тела,
> колонизированные старым кодом (dm=1, dv≠текущей), при загрузке
> сохраняют ФИЗИКУ как есть (прогресс добычи/истощение/здания/склад
> неприкосновенны), а устаревший свод пересчитывается из фактических
> залежей контрактом «свод = физика» (migrateMaterializedBodySummary в
> deserializeGameState, ПОСЛЕ setCurrentLookups). Новое поле `sv`
> (DEPOSIT_SUMMARY_VERSION=1) — версия контракта СВОДА (dv описывает
> физику, sv — свод; пишется только если известна — рантрип сейвов без sv
> побайтно идемпотентен). dv НЕ поднимается при миграции свода — версия
> физики остаётся честной; оценки гарантии — детерминированный дочерний
> поток derive от ds. Ленивые тела (dm=0) миграцией не затрагиваются
> (материализация при колонизации — R-37). Замер (200 систем, 3 колонии):
> дельта размера −49 Б, накладные расходы < 1 мс. Тесты A1–A10/B1–B10/
> C1–C5: tests/r38-save-migration-materialized.test.ts.
>
> **R-28 (2026-08-31) — формат сейва v2 (история; декодер удалён в R-30):** залежи и
> свод resourceDeposits — кортежами, гексы без `coord` (восстанавливается
> из сетки), без пустых полей застройки, звёздные float — 4 значащих
> цифры. 200 систем: 31.4 → 8.9 МБ plain (−72%), gzip-транспорт
> 5.3 → 2.3 МБ. Достижения v2 (кортежи/округления/coord из сетки) живут
> в кодеке v3; чтение v2-сейвов удалено в R-30.

---

## 3. Что не реализовано

### 3.1 Крупные системы

| Система | Спецификация | Строк spec | Этап | Статус |
|---------|--------------|-----------|------|--------|
| **Флот и корабли** | `docs/50-ships.md` | 1 464 | (завершён ранее) | ✅ Реализовано (Block 02, MVP) |
| **Исследования** | `docs/60-research.md` | 1 348 | (завершён ранее) | ✅ Реализовано (Block 03, MVP) |
| **AI-фракции** | `docs/70-ai.md` | 2 350 | Этап 3: **3а выполнена (R-41) и принята владельцем (PASS, 2026-10-27); 3б.1 выполнена (R-44) — ожидает приёмки; 3б.2–3б.4 — НЕ НАЧАТЫ** | ⚠️ Каркас 3а + постоянное состояние фракций 3б.1 в коде (`src/ai/`: типы, world model/perception, инертная intent-очередь, AIModule; `src/ai/factions.ts` — AIFactionState/реестр GameState.aiFactions/setupAIFactions/deterministic roster; v3-секция aiFactions/aiFactionsV) — игровых действий НЕТ; игровое поведение (решения/действия, per-faction perception, GOAP/Utility execution, fog-of-war) — ❌ не начато (план срезов: plans/2026-10-27-r43-stage3b-roadmap.md) |
| **Боевая система** | (часть 70-ai.md) | — | Этап 4 | ❌ Не реализовано; **переход к этапу 4 ЗАПРЕЩЁН до приёмки 3б** |
| **Дипломатия** | (часть 70-ai.md) | — | Этап 4 | ❌ Не реализовано; переход запрещён до приёмки 3б |
| **Терраформирование** | 60-research.md | — | Этап 4 | ❌ Не реализовано; переход запрещён до приёмки 3б |
| **Макрообъекты галактики** | 10-galaxy.md §5 | — | Этап 4 | ❌ Не реализовано; переход запрещён до приёмки 3б |

> Спецификации AI/бой/дипломатия готовы — ИИ-агенты смогут реализовывать по ним.

### 3.2 Здания (9 из 27 не реализованы)

> Счёт: 27 (spec §10.1) − 18 (code, R-36: + drilling_rig) = 9. Ранние
> аудиторские оценки «12–14» относились к состоянию до R-BLD-MOD/R-36.

| ID | Название | Спецификация | Приоритет |
|----|----------|--------------|-----------|
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

> ✅ Реализованы (18): colony_hub, mine, quarry, gas_extractor, processor, synthesizer, refinery, solar_plant, nuclear_reactor, shipyard, warehouse, open_warehouse, high_tech_storage, spaceport, laboratory, **drilling_rig (R-36)**, deep_space_sensor, starlift_collector.

### 3.3 Осознанные исключения (НЕ реализовано из спеки — требуют ОТДЕЛЬНОГО одобрения владельца)

> Фиксация по требованию аудита (вердикт R-36, п.4): эти требования
> спецификации НЕ реализованы и НЕ входят в текущую приёмку без явного
> решения владельца.

| # | Требование спеки | Где | Текущее поведение | Статус |
|---|------------------|-----|-------------------|--------|
| 1 | Технологический гейт «Глубокое бурение» (tech-tree) | docs/40-buildings.md §2.4 | R-40: технология `deep_drilling` (materials, starter, 800 RP) + unlock + `requiresTechs` на drilling_rig; гейт build/upgrade в движке + UI-фильтр постройки + UI-гейт апгрейда; старые сейвы — здания не удаляются | ✅ Закрыт (R-40, Issue #4) |
| 2 | Бонусы геологической активности (×1.5/1.0/0.8/1.1/0.6 по типу планеты) | docs/40-buildings.md §2.4 | R-40: `GEOLOGICAL_ACTIVITY_BONUS` по Planet.type, применяется ровно один раз (terrainMult/synergy не удваиваются); UI-отображение в диалоге буровой; dwarf/gas_giant — ×1.0 (явное предположение, вне спеки) | ✅ Закрыт (R-40, Issue #4) |

> **Исключений §2.4 больше нет** — оба пункта реализованы с тестовым покрытием
> (tests/r40-stage2-spec-compliance.test.ts: G1–G10, T1–T9). Явные предположения
> R-40 (цена теха 800 RP без пререквизитов; dwarf ×1.0) — чекпоинт
> `10_27_r40_stage2_spec_compliance.md` §2; решение владельца может скорректировать
> баланс отдельным проходом без изменения механики.

### 3.4 Прочее

| Компонент | Спецификация | Статус |
|-----------|--------------|--------|
| Сканер (здание) | 00-ARCHITECTURE.md §3.1.4 | Частично: здание `deep_space_sensor` есть в каталоге (строится), функциональность сканера не реализована |
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
| **P0-1** | Store→mediator sync | (architecture/modular-bus.md §1.3/§9.1) | ✅ Закрыто (R-39): единая шина gameBus=mediator.bus (engine-события видимы подписчикам), дедупликация ре-эмичей, instance-tracking (resetGameMediator → перерегистрация), GameLoop lifecycle (setLoadedState без заморозки, saveGame race), phase-guards модулей; интеграционные тесты T1–T19 (tests/r39-store-mediator-sync.test.ts) — полный конвейер action→store→mediator→модуль, отсутствие двойной обработки, порядок событий, изоляция ошибок, save/load. Контракт: modular-bus.md §9.1 |

### 4.2 Значительные 🟡

| ID | Расхождение | Спецификация | Код | Влияние |
|----|-------------|---------------|-----|---------|
| ~~ID-N1~~ | ID ядерного реактора | 40-buildings.md §10.1: `nuclear_reactor` | buildings.ts: `nuclear_reactor` | ✅ Закрыто (Block 01 C8) |
| **P5** | Крафтовые материалы в UI | (нет spec) | ResourcePanel → planet-view: findResourceDisplay → ELEMENT_MAP → CRAFTED_MATERIALS | ✅ Закрыто (R-39): каталог crafted-materials с русскими именами + тест полноты (каждый выход рецепта разрешим) + производство crafted по ID через реальный тик (T18/T19). Проблема была ТОЛЬКО отображением — доступность для крафта не зависела от категорий |
| **P6** | Colony Hub стоимость | (нет spec, но логически) | `costPerLevel: {Fe:10, Si:5, Al:3}` (surface.json) | ✅ Закрыто (R-39): апгрейды L1→L2/L2→L3 списывают base×уровень (тест T17: Fe 150→140→120, Si 100→95→85, Al 80→77→71), потолок levels=3, нехватка ресурсов → отказ. Бесплатного апгрейда больше нет |
| **P7** | Тип `transuranic` | 33-chemistry.md §10 (трансурановые) | ElementCategory: есть, элементов: нет | Мёртвый тип (Block 01 P7 добавил 3 transuranic — частично закрыто) |

### 4.3 Незавершённость 🟢

| ID | Описание | Влияние |
|----|----------|---------|
| ~~P4~~ | ~~Нет UI очереди производства~~ | ✅ Закрыто (`production-queue-panel.tsx`) |
| ~~P2~~ | ~~Прямые мутации в game-store.ts~~ | ✅ Закрыто (Block 01 P2 — immer middleware) |
| ~~DEP-1~~ | ~~`event-bus.ts` (@deprecated) используется в engine.ts~~ | ✅ Закрыто (Block 01 C1 — файл удалён) |
| ~~DEAD-1~~ | ~~`extractOreToElements` в engine.ts (@deprecated)~~ | ✅ Закрыто |
| ~~P0-1~~ | ~~Store→mediator sync (21 прямое действие)~~ | ✅ Закрыто (R-39 — единая шина + instance-tracking + T1–T19, см. §4.1 и modular-bus.md §9.1) |
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
| ~~Store→mediator sync (P0-1)~~ | `game-store.ts` (26 прямых действий + syncMediatorState) | ~~6 ч~~ | ✅ Закрыто (R-39: единая шина + instance-tracking + T1–T19; контракт — modular-bus.md §9.1) |

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
| Зданий (data-driven JSON / по spec) | 18 / 27 (67%; R-36: + drilling_rig) + 7 правил синергии (synergy.json) |
| Рецептов (в коде) | 75 ✅ (validate:recipes 75/75) |
| Типов звёзд | 12 / 12 ✅ (data-driven: `src/data/stars/types.json`) |
| Типов планет | 7 / 7 ✅ + сетки планет/лун из `src/data/planets/grids.json` |
| Компонентов UI (game/) | 17 |
| Тестов | 900 / 900 ✅ (0 failing; R-44: +36 постоянное состояние AI-фракций 3б.1 — валидация/реестр/roster-детерминизм/save-load v3/lifecycle/инертность при фракциях; R-41: +33 каркас AI 3а; R-42 follow-up: +6; R-42: +32; R-40: +20; R-39: +19) |
| Lint-ошибок | 0 ✅ (38 warnings) |

### 6.2 Документация

| Метрика | Значение |
|---------|----------|
| Файлов в docs/ | 29 |
| Строк в docs/ | ~23 700 |
| Файлов в checkpoints/ | 53 (аудиты Pass 1-14: `08_27_audit_01..04`, `08_28_audit_05..09`, `08_31_audit_10..11`, `09_04_audit_12`, `10_26_repo_recovery`, `10_26_audit_13..14` — имена по `checkpoints/RULES.md`) |
| Спецификации без игрового поведения | 1 (AI-factions: каркас 3а принят владельцем (PASS), 3б.1 — постоянное состояние фракций + save/load контракт выполнено (R-44), игровое поведение 3б.2–3б.4 не начато; ships+research завершены как MVP в Block 02/03) |

### 6.3 Разработка

| Метрика | Значение |
|---------|----------|
| Git-коммитов | 7+ (history rewritten per audit Pass 1) |
| Активных дней разработки | 11+ (2026-05-03, 04, 12, 13, 22, 06-26, 08-27 + Block 01-08, 08-28, 08-31) |
| Lint-ошибок | 0 ✅ (38 warnings) |
| Тестов | 900 / 900 ✅ (0 failing; R-44: +36 постоянное состояние AI-фракций 3б.1 — валидация/реестр/roster-детерминизм/save-load v3/lifecycle/инертность при фракциях; R-41: +33 каркас AI 3а; R-42 follow-up: +6; R-42: +32; R-40: +20; R-39: +19) |

---

## 7. Рекомендации

### 7.1 Принцип

**Документация в `docs/` — источник истины.** Код должен быть приведён в соответствие со спецификациями, не наоборот.

### 7.2 Приоритеты следующего этапа (актуализация 2026-10-26, R-37)

> **Схема этапов (синхронизация R-43):** этапы 0–2 завершены и опубликованы;
> **этап 3а (подготовка AI) выполнен в R-41 и ПРИНЯТ ВЛАДЕЛЬЦЕМ (PASS, 2026-10-27)** —
> архитектурный каркас без игровых действий; **этап 3б: срез 3б.1 выполнен в R-44** (постоянное
> состояние фракций + save/load контракт; допуск владельца на 3б дан явно; игровые действия — нет);
> **срезы 3б.2–3б.4 — НЕ НАЧАТЫ**: план
> снятия gate R-42 (Issue #6 OPEN) и отдельного задания владельца;
> **переход к этапу 4 ЗАПРЕЩЁН до отдельной приёмки 3б**.
> Внутренние метки «Etap 4.1/4.2» ниже — имена трека data-driven-каталогов,
> НЕ этап 4 дорожной карты (переименованы бы во избежание путаницы — оставлены
> с пометкой, т.к. встречаются в чекпоинтах).

| Приоритет | Задача | Время | Тип |
|-----------|--------|-------|------|
| ✅ ~~⛔ БЛОКЕР: старт этапа 3~~ | ~~только после (а) приёмки аудитором этапа 2 и (б) официального задания владельца (план prep/hold: `plans/2026-10-26-task39-stage3-preparation.md`)~~ — выполнено: задание выдано (Issue #5), 3а реализована (R-41) и принята владельцем (PASS). **Новый гейт: старт 3б — только после снятия gate R-42 (Issue #6 OPEN) и отдельного задания владельца** | — | Процесс |
| 🟡 data-driven (внутр. трек «Etap 4.2», НЕ этап 4) | Планетарный каталог (planet-types.ts → planets/types.json, рекомендация Pass 9 §3.3.2) — исполнять только по явному указанию владельца | ~4 ч | Data-driven |
| 🟡 BACKLOG (в работе, по срезам) | AI-фракции 3б — исполнение: **3б.1 (постоянные фракции + save/load контракт) — выполнена (R-44), ожидает приёмки**; далее per-faction perception (3б.2), Utility-экономика (3б.3), GOAP/экспансия/военный/торговля/дипломатия (3б.4+ по срезам) — план срезов: `plans/2026-10-27-r43-stage3b-roadmap.md` | ~3 нед | Этап 3 |
| ✅ NEXT-2 | ~~Возврат кросс-типовых правил синергии~~ — **выполнено в R-27** (mine_processor +15%, warehouse_production +20%, + generator_cluster +5%; §5.5) | — | Геймплей |
| ~~P0-1~~ | ~~Store→mediator sync (21 прямое действие)~~ — **закрыто в R-39** (единая шина gameBus=mediator.bus, instance-tracking, интеграционные тесты T1–T19) | — | Арх. долг |
| 🟡 Pass 2 P1-2 | Cross-layer import в fleet-engine (clean architecture) | ~1 ч | Рефакторинг |
| 🟡 Pass 2 P3-5 | `FUEL_PRIORITY` вынести в `fuel-map.ts` | ~0.5 ч | Чистота |
| ✅ Pass 2 P3-6 | ~~`prng.ts` название «xoshiro256**» → уточнить (32-bit)~~ — **закрыто в R-35**: канонический xoshiro128** 1.1 + эталонные векторы (tests/prng-reference.test.ts) | — | Документация |
| 🟡 Будущее (этап 4, ЗАПРЕЩЁН до приёмки 3б) | resolveCombat, canColonizePlanet, antimatter fuel, terraforming | ~6 нед | Будущее |

### 7.3 Расхождения ID (решение за владельцем)

| Расхождение | Вариант A (править код) | Вариант B (править spec) |
|-------------|-------------------------|--------------------------|
| ~~`nuclear_plant` vs `nuclear_reactor`~~ | ✅ Закрыто (Block 01 C8): код использует `nuclear_reactor` | n/a |
| ~~`Fe-ore` vs `hematite`~~ | ✅ Закрыто (Block 01 P1): `recipes.ts` → `baked-lookups.ts` | n/a |
| ~~`smelter`/`chemical_plant`/`petrochem_plant`~~ | ✅ Закрыто (Block 05): переименованы в `processor`/`synthesizer`/`refinery` | n/a |

> Рекомендация: для всех будущих расхождений ID — править код (в плане иммерсивного рефакторинга, см. Pass 1 P0-1). Все исторические расхождения (`nuclear_plant`, `Fe-ore`, `smelter/chemical_plant/petrochem_plant`) — ✅ закрыты (Block 01 C8/P1, Block 05).

### 7.4 Дальнейшие этапы (по ROADMAP; схема этапов — фикс R-37)

| Этап | Срок | Содержание | Статус |
|------|------|------------|--------|
| 2.5 Стабилизация | ~1 неделя | P1-P7 + тесты | ✅ Завершён (Block 01, 08-27) |
| 2.6 Engineering quality | ~1 неделя | TS strict, ESLint, PRNG fix | ✅ Завершён (Block 07, 08-27) |
| (бывш. 3.0) Флот + исследования | 3-4 недели | По specs 50-ships.md, 60-research.md | ✅ Завершён (Block 02/03, 08-27) — ВНУТРЕННИЕ номера, не этап 3 схемы |
| **3 Этап AI-фракций** | 3 недели | По spec 70-ai.md (5 базовых); **подэтапы: 3а подготовка → 3б исполнение (срезы 3б.1–3б.4)** | ⚠️ 3а — ✅ выполнена (R-41) и принята владельцем (PASS, 2026-10-27); 3б.1 — ✅ выполнена (R-44), ожидает приёмки владельца; 3б.2–3б.4 — ❌ НЕ НАЧАТЫ (план срезов + допуск на 3б дан) |
| **4 Глубокие системы** | 6 недель | Бой, дипломатия, макрообъекты | ❌ ЗАПРЕЩЁН до приёмки 3б |
| 5 Полировка | 6 недель | Баланс, контент, оптимизация | ❌ Etap 5 |

### 7.5 Подход к разработке через ИИ-агентов

**Этапы 2.5/2.6/3.0 завершены:** P2 (immutable store), тесты, флот (Block 02), исследования (Block 03) — всё готово.

**Перед стартом этапа 3 (3а/3б):** ~~закрыть Pass 1 P0-1 (store→mediator sync для 21 прямого действия)~~ — ✅ **закрыто в R-39** (единая шина, instance-tracking, GameLoop lifecycle, тесты T1–T19): ИИ-агенты этапа 3 смогут подписываться на события engine (`economy:production-complete`, `fleet:*`, `ships:*`) на единой шине — прежде эти события уходили в «мёртвый» gameBus без подписчиков. Переход к этапу 4 — ТОЛЬКО после приёмки 3б.

**Актуализация R-43 (2026-10-27):** этап 3а выполнен (R-41) и ПРИНЯТ владельцем (PASS, Issue #5 закрыт); этап 3б не начат — старт после снятия gate R-42 (Issue #6 OPEN) и отдельного задания владельца; проект вертикальных срезов 3б — `plans/2026-10-27-r43-stage3b-roadmap.md`.

**Актуализация R-44 (2026-10-27):** gate снят (Issue #6 закрыт, R-42 = PASS независимой верификации; CLOSEOUT Issue #8 выполнен — открытых Issues нет); допуск владельца на 3б дан явно (ссылка на план срезов как «следующий план работ»). Срез **3б.1 выполнен** (R-44): постоянное состояние AI-фракций (`GameState.aiFactions` — ссылочные сущности, `src/ai/factions.ts`) + save/load контракт v3 (`aiFactions`/`aiFactionsV`, старые сейвы побайтно совместимы, битая AI-секция — явный отказ) + детерминированный setup (`setupAIFactions`, Xoshiro128StarStar derive) + синхронизация контроллеров AIModule от реестра. Игровые действия — НЕ начинались (3б.3+); Issue под приёмку 3б.1 (R-44) — за владельцем.

---

## История изменений

| Дата | Автор | Изменение |
|------|-------|-----------|
| 2026-10-27 | R-44 (Task 50) | **Этап 3б.1: постоянное состояние AI-фракций + save/load контракт** (задание владельца — «следующий план работ» = ссылка на план срезов `plans/2026-10-27-r43-stage3b-roadmap.md`; условия старта среза выполнены: R-42 PASS/Issue #6 closed, 3а принята/Issue #5 closed, R-43 принята/Issue #7 closed, CLOSEOUT #8 закрыт — открытых Issues нет). **Реализовано:** `src/ai/factions.ts` — AI_FACTION_STATE_VERSION=1, AIArchetype (docs/70 §2.1–2.6: CONFEDERATION/HEGEMONY/SYNDICATE/ORDER/SWARM), AIBudgetAllocation (5 категорий, сумма≈1±1e-6; веса — документированные плейсхолдеры, потребитель 3б.3+), AIFactionThresholds (Приложение C: attack/colonization/maxColonizations; RETREAT_THRESHOLD с Infinity НЕ в персистентном состоянии — не JSON-сериализуемо, решение за 3б.4), AIFactionGoal (в 3б.1 всегда []), AIFactionState — ССЫЛОЧНАЯ сущность БЕЗ копий владений/ресурсов/флотов/технологий (строгие поля + строгая схема загрузки), validateAIFactionState/validateAIFactionRegistry, createAIFactionRoster (детерминизм: Xoshiro128StarStar(seed).derive('ai:setup:factions'), Fisher–Yates архетипов, ids ai_faction_01..NN нулл-пад, count 1..8), withAIFactions (повторная регистрация — явный отказ), checkOwnershipIntegrity (каждый owner≠null разрешается в playerFactionId/реестр). **GameState.aiFactions** — ОПЦИОНАЛЬНОЕ поле (types.ts; type-only import — runtime-цикла нет): старые состояния/сейвы совместимы по построению, r39/r41 якоря sha256 сохранены побайтно. **v3-схема** (game-state-schema.ts): AIFactionsRegistrySchema (strictObject + refine ключ==id + refine суммы бюджета), корень aiFactions?/aiFactionsV?. **serializeGameState** — реестр вырезается из spread всегда, пишется ТОЛЬКО при непустом (+aiFactionsV) — AI-less состояния сериализуются побайтно как прежде; **deserializeGameState** — при наличии aiFactions маркер aiFactionsV обязан быть 1 (иначе явная ошибка, как fmt≠3), маркер из состояния удаляется (транспортный), отсутствие полей = предсказуемый дефолт «реестра нет». **store action setupAIFactions** (Pattern A-проводка через mediator.commitState; у AI-модуля mutator по-прежнему отсутствует — реестр пишет СТОР). **AIModule v0.2.0** — syncControllersFromState (тик, отсортированные ключи, attach/идемпотентный конфиг из faction.config, БЕЗ удаления ручных контроллеров, БЕЗ мутаций GameState; подписки НЕ растут). **Тесты +36** (tests/ai/factions.test.ts: валидация/IDs/дубликат-регистрация/integrity/roster-детерминизм/old-save рантрип без инъекции/с фракциями save→load→save→load побайтно/битая AI-секция ×3/lifecycle подписки/инертность при непустом реестре/синхронизация контроллеров/детерминизм ×3 сборки; адаптация 3а-теста: assert версии манифеста 0.1.0→0.2.0 — смысл теста не ослаблен). **Гейты:** bun test 900/900 (56 файлов, exit 0); lint exit 0 (0 errors/38 warnings Δ0); tsc exit 1 — 86 (src 71) Δ0 baseline, в файлах R-44 — 0 (НЕ именуется PASS); validate:all 4/4; детерминизм ×3 ОТДЕЛЬНЫХ процесса scripts/r44-factions-det-check.ts (seed 424242, 20 систем, 3 фракции, 25 тиков): sha256(roster)=4bbf006e7c7e1f62…87e2d == ×3, sha256(ai-snapshot)=28f6069edc7e087b…89b7 == ×3, sha256(gamestate)=011e2110aa79196e…dd3e == ×3; регресс якорей: r39-det-check sha256(gen)=eaed801144…1cd0 == базам R-39/R-40/R-42 ×3, r41-ai-det-check sha256(ai-snapshot)=45c41c3c…fbd39 / sha256(gamestate)=52fdea9e…ccd6 == отчёту R-41 ×3. CI отсутствует (.github/workflows нет) — не заявляется. **Браузер** (agent-browser): New Galaxy 424242 → колонизация Xi Ursae I → тики (42→103→199) → Save (БД tick 177) → reload → Load (Tick 177) → resume (→180, модули живы) → 0 ошибок консоли/page errors → тестовый сейв удалён (DELETE API), GET /api/save = [] (БД 0). **Запрещённое не сделано:** авто-создание фракций в newGame НЕ введено (якоря целы, поведение систем не менялось), стартовых бонусов нет, игровые действия отсутствуют, пулы/баланс не менялись, история не переписывалась. Чекпоинт: `10_27_r44_ai_stage3b1_factions.md` |
| 2026-10-27 | R-43 (Task 48) | **Синхронизация статуса + проектирование этапа 3б** (задание владельца, **GitHub Issue #7**; docs-only — при открытом Issue #6 исходники/runtime НЕ менялись). Основание: владелец подтвердил R-41/3а = **PASS** (Issue #5 закрыт, комментарий 2026-10-27T15:03:38Z; основной коммит bbc05836, docs-коммит 8b3a671d). **Фаза 1:** согласованы вводные README / docs/STATUS.md / checkpoints/ROADMAP.md / заголовок docs/70-ai.md — единая формулировка: этапы 0–2 завершены; 3а — PASS/принята (каркас: типы, world model/perception, инертная intent-очередь, модульная проводка; без игровых действий); 3б — НЕ НАЧАТ, ожидает отдельной задачи и снятия gate R-42 (Issue #6 OPEN); игровые решения/действия, постоянные AI-фракции, GOAP/Utility execution, per-faction fog-of-war, сериализация AI-state — НЕ реализованы; этап 4 запрещён до приёмки 3б; метрики честные: 864/864 тестов, lint 0 errors/38 warnings, tsc exit 2 — 86 baseline (71 в src, Δ0 — НЕ PASS), CI отсутствует и не заявляется. Исторические тексты не переписывались; в чекпоинт R-41 добавлено датированное дополнение §11 (приёмка владельца). **Фаза 2:** статический аудит принятого 3а перед 3б (mutable getters getWorldModel/attachController, глобальный discovery vs per-faction knowledge, отсутствие реестра AI-империй в GameState, save v3 не включает модульные serialize, командные контракты/ownership, детерминизм) — таблица контрактов в плане R-43. **Фазы 3–4:** план вертикальных срезов 3б (3б.1 постоянное состояние фракций + save/load контракт; 3б.2 per-faction perception; 3б.3 Utility-экономика — один доказуемый тип действия; 3б.4 расширения отдельными задачами) с dependency-порядком, явными запретами, тест-планом ДО кода и границей R-43 vs R-44+: `plans/2026-10-27-r43-stage3b-roadmap.md`. Runtime 3б НЕ начинался; Issue #6 не закрывался; CI не заявлялся |
| 2026-10-27 | R-41 (Task 47) | **Этап 3а: подготовка архитектуры AI-фракций** (задание владельца, **GitHub Issue #5**; база main 3faf5bc == SHA из комментария-гейта; допуск старта дан владельцем явно в чате при Issue #6 = OPEN — issue не закрывался, приёмка R-42 остаётся за владельцем; факт зафиксирован в чекпоинте §1). **Свёртка контрактов** (план R-41, таблица 16 строк): ModuleId 'ai' существовал, PRIORITY.REACTION задокументирован под AI, tickAll детерминирован initOrder; фактическая структура модулей — доменные папки (не src/modules из шаблона). **Реализовано (3а, без игровых действий):** src/ai/types.ts — AI_STATE_VERSION=1, AIDifficulty (docs/70 §7.6: easy 20/normal 10/hard 5/insane 1), AIConfig (детерминированный операционный бюджет maxControllersPerTick вместо wall-clock ms-бюджета §8.8 — запрещён runbook; перенос в 3б/4), инертная AIIntentQueue (статусы только pending/cancelled, 'executed' невалиден по построению), validateAIConfig/validateAIIntent; src/ai/perception.ts — buildWorldModel (shared лёгкие агрегаты: системы по owner, счётчики планет/флотов/кораблей; сортированные ключи/массивы; мир НЕ копируется) + buildPerception (defensive copy, без ссылок на GameState); src/ai/ai-module.ts — AIModule (IGameModule): id 'ai', dependencies ['economy'] → тикает ПОСЛЕДНИМ (initOrder [galaxy, economy, tech, ships, fleet, ai]), emits [] (ai:* остаются зарезервированы), подписки только lifecycle (core:game-created/game-loaded → reset кэша), query 'ai:state', budget maxControllersPerTick + периоды обновления, serialize={version} (формат сейва v3 НЕ менялся), mutator СОЗНАТЕЛЬНО не устанавливается — коммит GameState физически недоступен. Регистрация последней в getMediatorWithModules (game-store). **Тесты +33** (tests/ai/: model 14 — валидация/инертная очередь/агрегаты/defensive copy; module 13 — манифест/initOrder last/фазы/подписки без дублей/reset/phase-guard/бюджет/периоды/query; integration 6 — прод-проводка/инертность (тики с AI и без → serializeGameState бит-в-бит идентичен; 0 коммитов от AI)/детерминизм ×3 сборки/save-load v3 без AI-полей/подписки load-циклов). **Гейты:** bun test 864/864 (55 файлов, exit 0); lint exit 0 (0 errors/38 warnings, в файлах R-41 — 0); tsc exit 2 — 86 (src 71) СОХРАНЯЮТСЯ НА BASELINE, Δ0 (набор ошибок идентичен базовому), в файлах R-41 — 0; validate:all exit 0 (4/4); детерминизм ×3 ОТДЕЛЬНЫХ процесса (seed 424242, 20 систем, 25 тиков, 3 контроллера normal/hard/insane): sha256(ai-snapshot)=45c41c3cb1bcd5caef148170b2d9f3e6b72e5beaa72d2253750937436f5fbd39 == ×3, sha256(gamestate)=52fdea9ea5f39cc5…ccd6 == ×3 (scripts/r41-ai-det-check.ts). GitHub check-runs/workflows: 0 — CI отсутствует, не заявляется. **Браузер** (agent-browser, реальный dev-сервер): New Galaxy 424242 → колонизация Xi Ursae I (вулканическая) → playing ×1 (Tick 9→21) → Save (POST) → reload → Load (Tick 21, paused — семантика playing-сейва) → resume ×1 (Tick 23, тики идут) → 0 ошибок консоли → тестовый сейв удалён, GET /api/save = [] (БД 0). **Намеренно НЕ реализовано (3б после приёмки):** AI-фракции в мире, исполнение действий (build/move/research/trade/combat/diplomacy), GOAP/Utility, сериализация AI-состояния, fog-of-war per-faction (видимость 3а тривиальна), ms-бюджет/Web Worker, постоянное состояние фракций. Этапы 3б/4 НЕ начинались; пулы/баланс не менялись; тесты не ослаблялись; история не переписывалась. Чекпоинт: `10_27_r41_ai_stage3a.md` |
| 2026-10-27 | R-42 follow-up (Task 46) | Follow-up к Issue #6 (план владельца в комментарии): закрыт пробел контракта `TypedEventBus.once`, оставшийся в первоначальном R-42 — ВЛОЖЕННЫЙ emit того же события вызывал once-обработчик ВТОРОЙ раз. Три сценария: (а) вложенный emit из replay-обработчика (снятие было в finally ПОСЛЕ вызова), (б) вложенный emit из самого once-обработчика (удаление откладывалось в toRemove до конца обхода snapshot), (в) вложенный emit из обычного обработчика с более высоким приоритетом ДО достижения once во внешнем snapshot (вложенный dispatch вызывал и удалял подписку, но внешний snapshot всё ещё содержал её). Фикс (только typed-event-bus.ts): явный флаг потребления `consumed` в Subscription; once помечается потреблённой и удаляется из Set ДО вызова обработчика (и на replay-пути, и в emit); обход snapshot пропускает потреблённую once по флагу — ТОЛЬКО once: для обычных подписок проверка принадлежности Set не делается, snapshot-семантика «отписанный во время dispatch всё ещё вызывается в текущем dispatch» сохранена; механизм toRemove удалён за ненадобностью; изоляция исключений (ошибка обработчика не возвращает подписку), стабильная сортировка приоритетов, вложенный синхронный emit, replay для не-once — без изменений. TDD: T1–T5 добавлены в существующий tests/r42-stage01-reaudit.test.ts ДО фикса; T1/T2/T3/T5 падали на дефектном коде assertion-ом «Expected: 1, Received: 2» (двойной вызов), T4/T4b (изоляция исключений) зелёные до и после — инварианты. Гейты: bun test 831/831 (52 файла, exit 0); lint exit 0 (0 errors/38 warnings); tsc exit 2 — 86 ошибок (src 71) СОХРАНЯЮТСЯ НА BASELINE R-40/R-42, Δ0, в typed-event-bus.ts ошибок 0; validate:all exit 0 (4/4); детерминизм ×3 независимых процесса: sha256(gen)=eaed801144b8f255…1cd0 == базе R-39/R-40/R-42 (sha256(rt) совпадает); GitHub check-runs на базовом SHA: 0, workflow runs: 0 — CI отсутствует, зелёные check-runs не заявляются. Браузер (agent-browser): New Galaxy 424242 → колонизация → Солнечная станция → UI-пауза (тики 34→34) → resume (→38) → Save (tick 42) → reload → Load (tick 42, колония и станция пережили) → 0 ошибок консоли → БД очищена []. GameLoop/ModuleRegistry/экономика/PRNG/формат сейва НЕ тронуты (границы follow-up). Этапы 3а/3б и 4 не начинались. Чекпоинт: `10_27_r42_stage01_reaudit.md` §10 |
| 2026-10-27 | R-42 (Task 46) | Повторный аудит этапов 0–1: архитектура, шина, lifecycle и время (задание владельца, **GitHub Issue #6**; база main после R-40, 7258043). **F-01 ПОДТВЕРЖДЁН и исправлен** (TypedEventBus): подписка `{once:true}` при включённом replay получала немедленную replay-доставку, но НЕ снималась → обработчик срабатывал на replay И ещё раз на следующем emit (нарушение контракта once); теперь replay-доставка для once считается первым (и единственным) вызовом — подписка снимается немедленно (finally), ошибка обработчика на replay изолирована (как в emit), а не всплывает из on(). **F-02 ПОДТВЕРЖДЁН и исправлен** (GameLoop): `setSpeed(0)` при playing менял фазу на 'paused' БЕЗ события core:paused — путь паузы, неотличимый от `pause()` только отсутствием события; теперь setSpeed(0) при playing делегирует `pause()` (фаза + core:paused + остановка интервала — единый контракт; порядок событий core:paused → core:speed-changed зафиксирован тестом). Дополнительно: `core:resumed` (объявлен в events.ts и modular-bus §8, но не эмитился никем — тот же класс, что tech:fundamental-leveled до R-39) теперь эмитится GameLoop при возобновлении после паузы/stop (первый запуск — core:started); противоречие комментария `stop()` («без изменения фазы») коду устранено пересказом факта (teardown-путь БЕЗ события; фаза обязана уходить из playing, иначе повторный start() после remount стал бы no-op) + тест. **F-03 ПОДТВЕРЖДЁН и исправлен** (ModuleRegistry): register() мутировал Map (при замене — destroy старого модуля) ДО recalculateInitOrder(), бросающего при цикле → после исключения реестр оставался частично изменённым, а цикл в Map БЛОКИРОВАЛ все последующие register() (восстановление без пересоздания игры невозможно — подтверждено тестом); регистрация теперь атомарна: порядок вычисляется на «пробной» установке, при ошибке Map откатывается (старый модуль не тронут), destroy заменённого — только после успеха. **Дополнительно (шина):** защитный лимит MAX_FLUSH_BATCHES=1000 в flush() — прежде обработчик, безусловно повторно defer'ящий событие, зацикливал flush навсегда (подтверждено зависанием первичного прогона теста; splice(0) защищал только от рекурсии внутри одного пакета). **Этап 0 (документация):** сверка чекпоинта фазы 0/ROADMAP/README/docs с фактом — ROADMAP не актуализировался с 2026-06 (этапы 2/2.5/3.0 значились in_progress/pending при завершённости), README отставал от STATUS на R-38–R-40 (754 теста, «15 зданий», «исключения не реализованы»), Web Worker в 00-ARCHITECTURE/01-tech-stack/05-appendices заявлялся как часть выбранного стека при 0 упоминаний в src (реализован НЕ был — теперь честно помечен «проектная цель, этап 4+», единственный честный источник был 04-performance §1.2 — устранено его внутреннее противоречие «Etap 2.5+» vs «Etap 4+», обновлён устаревший контракт скорости §1.4 «Math.min(speed,50) итераций за тик» → контракт ×N), «инкрементальные сохранения» §5.7 не реализованы (полный компактный дамп v3 — помечено), 8 исторических имён документов в чекпоинте фазы 0 помечены legacy-примечанием (история не переписывалась), битая разметка ссылки modular-bus:6 исправлена, §8 каталога помечен как срез 2026-03 (канонический источник — events.ts), несуществующие пути кода (buildings.ts, star-types.ts, resource-panel.tsx) заменены актуальными (buildings/, stars/, reference-dialog.tsx). **Этап 1 (цепочка подтверждена):** PRNG — эталонные векторы xoshiro128** 1.1 (официальный C-харнесс), seed/snapshot/fromState/derive, валидность состояния (Z1–Z5) — существующие тесты зелёные; GameLoop — ×1/×5/×15/×50 по контракту (существующие + новые тесты), граница года 364/365 (core:year ровно один раз), setTime + ручной step = ровно 1 тик, переякоривание catch-up при катастрофическом отставании (monkeypatch performance.now: скачок 60 с → без лавины, цикл жив), stop()/start() teardown-семантика; TypedEventBus — приоритеты/равный приоритет (стабильный порядок подписки), отписка во время emit (снапшот), once добавленный во время emit (со следующего emit), вложенный emit, defer/flush + повторный defer, реентерабельный flush, clear() сбрасывает replay; ModuleRegistry/GameMediator — цикл/замена/отсутствующая зависимость/горячая регистрация/unregister/query-lifecycle; save/load Pass 13 подтверждён актуальными тестами (api-save 7: 400/429/gzip-бомба/минимальный ответ; HTTP-раундтрип; сериализация). Каталог событий: 86 объявлено / эмитится 42; 44 не эмитятся — зарезервированы под этапы 3/4 (diplomacy/trade/ai/combat + часть economy/ships/fleet/tech); 10 записей манифестов ссылаются на неэмитимые — вопрос владельцу (чистить или реализовать в своих этапах; поведение не затронуто). **Тесты**: +32 → 825/825 (52 файла) — tests/r42-stage01-reaudit.test.ts. **Гейты**: bun test 825/825 (два подряд прогона), lint 0/38, tsc 86 (src 71, Δ0 к базе R-40; +5 ошибок нового тест-файла исправлены до публикации), validate:all 4/4, детерминизм ×3 процесса (seed 2026, 200 систем): sha256 eaed801144b8f255…1cd0 — совпал ×3 и == базе R-39/R-40 (генерация не затронута). **Браузер** (agent-browser, seed 424242): New Galaxy → колонизация Xi Ursae I → playing ×1 (~1 тик/с) → ×50 (~52 тика/с, без двойного ускорения) → пауза (тик заморожен, phase paused) → resume → Save (POST 201) → reload → Load (tick 790, paused — семантика playing-сейв загружается на паузе) → resume (тики продолжились, модули живы) → 0 ошибок страницы/консоли → сейв удалён, GET /api/save → [] (БД 0). Замечание о среде: первый полный прогон после простоя дал 11 транзиентных отказов API/DB-тестов (Prisma 500 на INSERT — конкуренция за SQLite при параллельном прогоне); воспроизводятся на чистом дереве без правок R-42 (проверено git stash) и не повторились в двух последующих полных прогонах — регрессией R-42 не являются, зафиксированы честно. CI в репо НЕТ (не заявляются зелёные check-runs); production build не запускался (dev-only). Этап 3 (3а/3б) и этап 4 НЕ начинались; пулы не менялись; тесты не ослаблялись; история не переписывалась. Чекпоинт: `10_27_r42_stage01_reaudit.md` |
| 2026-10-27 | R-40 (Task 45) | Закрытие оставшихся расхождений этапа 2 с docs/40-buildings.md §2.4 (задание владельца, **GitHub Issue #4**). **1. Тех-гейт «Глубокое бурение»**: технология `deep_drilling` (materials, starter — без пререквизитов, baseCost 800 — цена/пререквизиты спекой не заданы, явное предположение R-40 по существующей модели; 16-я запись techs.json) + data-driven unlock (deep_drilling → building drilling_rig в tech-unlocks.json) + `requiresTechs` на drilling_rig в surface.json; единый механизм гейта: engine.buildOnHex/buildOnAtmosphereSlot/buildOnOrbitSlot + **upgradeBuilding (R-40: гейт распространён на АПГРЕЙД — researched передаётся из EconomyModule.onUpgrade)** + UI-фильтр BuildList (существовал) + UI-гейт апгрейда в UpgradeMode (предупреждение «Требуется технология: …» + disabled). Старые сейвы: буровые, построенные до R-40, при загрузке НЕ удаляются и продолжают добывать; гейт контролирует только новые действия (постройка новых буровых, апгрейд существующих); уровни тех не уменьшаются → для построенных после гейта зданий апгрейд всегда разрешён (регрессии synthesizer/refinery нет — T6). **2. Геологические бонусы**: `GEOLOGICAL_ACTIVITY_BONUS` в planet-types.ts по каноническому `Planet.type` (НЕ террейн гекса): volcanic ×1.5 / rocky ×1.0 / oceanic ×0.8 / desert ×1.1 / ice ×0.6; вне спеки — ×1.0 (dwarf — явное предположение «стандартные условия»; gas_giant — недостижимо, поверхность не застраивается). Применяется РОВНО ОДИН РАЗ в processExtraction для drilling_rig: `amount = availability × levelMult × terrainMult × miningMult × geologicalMult` — terrainMult каталога (mountains ×1.3/volcano ×1.2) и синергия mining_cluster сохранены и НЕ удваиваются (G8/G9). UI: строка «Геологическая активность: ×N (Тип)» в диалоге буровой рядом с бонусом местности. **Пулы/генерация НЕ тронуты**: ULTRA_RARE/RARE дословно, dv/sv без изменений, сейв-формат не менялся (множитель на лету — миграция не требуется); «свод = добыча» не нарушен (total ограничен quantity — G10). **Тесты**: +20 → 793/793 (51 файл) — tests/r40-stage2-spec-compliance.test.ts: G1–G6 (пять типов спеки точно по коэффициентам + dwarf), G7 (шахта без гео — формула прежняя), G8 (гео×террейн — по одному разу), G9 (гео×синергия — соотношение 1.1), G10 (истощение: ровно quantity, пустая залежь молчит), T1 (связность каталог/unlocks/стартер, нет дубликатов), T2–T5 (движок build/upgrade: backward-compat без researched, отказ/ресурсы целы до теха, успех после), T6 (UI/engine-согласованность areBuildingTechsMet ↔ buildOnHex на 5 картах researched + нерегресс synthesizer), T7 (старый сейв: serialize→deserialize — здание переживает, добыча идёт, апгрейд гейтится/разрешается), T8 (полный конвейер store→mediator→модуль: гейт постройки → лаборатория → startResearch → тики → completion + unlockedBuildings → постройка → апгрейд), T9 (конвейер: апгрейд старой буровой до теха отклонён, ресурсы целы). Guard-тесты tree-data обновлены на 16 тех/6 стартеров (добавление записи — не ослабление). **Гейты**: 793/793, lint 0/38, tsc 86 (src 71, Δ0 к базе R-39), validate:all 4/4, детерминизм ×3 процесса (seed 2026, 200 систем): sha256 eaed801144b8f255…1cd0 — совпал (= базе R-39, генерация не затронута). **Браузер** (agent-browser, seed 424242, вулканическая Xi Ursae I): буровой НЕТ в списке постройки до исследования; бейдж «требует технологию» в справочнике; лаборатория → «Глубокое бурение» через UI исследований (слот, RP) → завершено; буровая ПОЯВИЛАСЬ в списке, построена, диалог «Геологическая активность: ×1.5 (Вулканическая)»; апгрейд через UI → L2; Save → reload → Load → буровая L2 и множитель пережили раундтрип; 0 ошибок страницы/консоли; БД очищена (0 сейвов). CI в репо НЕТ (не заявляются зелёные check-runs); production build не запускался (dev-only). Явные предположения R-40 (цена 800/starter; dwarf ×1.0) — чекпоинт §2, владелец может скорректировать баланс без изменения механики. Этап 3 (3а/3б) и этап 4 НЕ начинались. Чекпоинт: `10_27_r40_stage2_spec_compliance.md` |
| 2026-10-27 | R-39 (Task 44) | Финальная приёмка этапа 2 + аудит блокеров этапа 1 (задание аудитора R-39, GitHub Issue #3). **P0-1 Store→Mediator ЗАКРЫТ доказательно**: (1) единая шина — GameMediator использует глобальный gameBus как свою шину (прежде ДВЕ шины: engine эмитил исходы `economy:production-complete`, `fleet:*`, `ships:*` в gameBus без единого подписчика — события терялись, нарушая modular-bus.md §1.3 «Шина — единственный канал»); (2) дедупликация — EconomyModule больше НЕ ре-эмитит building-constructed/upgraded/downgraded/demolished/planet-colonized (engine публикует идентичный payload на единой шине; прежде это стало бы дублем); (3) instance-tracking — `modulesRegisteredOn` вместо булева флага: resetGameMediator → перерегистрация модулей + восстановление gameState медиатора из стора (прежде флаг не сбрасывался — новый медиатор оставался без модулей навсегда); (4) tech:fundamental-leveled реально эмитится из levelUpFundamental (было заявлено в манифесте, не эмитилось никем); (5) контракт Pattern A (шина)/Pattern B (прямая мутация + syncMediatorState)/UI-only исключения — modular-bus.md §9.1. **GameLoop lifecycle**: setLoadedState больше НЕ stopAll (прежде модули замораживались навсегда при загрузке в активной сессии — loop тикал, экономика стояла), приводит loop в соответствие фазе сейва; newGame останавливает интервал прошлой игры; phase-guards в тиках Economy/Ships/Fleet (экономика не обрабатывается «в паузе»). **saveGame race**: loop.pause() реально вызывается на время сериализации+сети (прежде комментарий утверждал это, но интервал продолжал тикать — на x50 за время запроса до ~6 тиков обрабатывали экономику «в паузе», сейв убегал вперёд от увиденного игроком); фаза colonization больше НЕ портится в 'paused' при сохранении (баннер колонизации переживает загрузку). **Наблюдаемость миграций**: store.loadWarnings + UI-тост (отказы R-38, ожидающие R-37 — прежде только console.warn); защита lookups активной игры при отказе загрузки (откат только при реальном переключении). **P6 закрыт**: colony_hub costPerLevel {Fe:10,Si:5,Al:3} в surface.json (прежде `{}` — бесплатно), тест T17 всех уровней L2/L3 + потолок + нехватка → отказ. **P5 закрыт**: crafted-материалы (steel/microchip) в каталоге с русскими именами + цепочка отображения в UI; тесты T18/T19 — полнота реестра (каждый выход рецепта разрешим) + производство crafted по ID через реальный тик (доступность от категорий отображения не зависела — проблема была только отображением). **Тесты**: +19 → 773/773 (50 файлов) — tests/r39-store-mediator-sync.test.ts (T1–T19): полный конвейер action→store→mediator→модуль, отсутствие двойной обработки (ровно один коммит/событие), порядок событий, изоляция ошибок подписчиков, UI-only исключения, mid-session/cold load, newGame из playing, saveGame race (0 тиков в окне), повреждённые сейвы (мусор/fmt≠3/zod — активная игра не тронута), loadWarnings, tech:fundamental-leveled, resetGameMediator, P6, P5. Гейты: 773/773, lint 0/38, tsc 86 (src 71, Δ0 к базе R-38), validate:all 4/4. Отклонения docs/40 §2.4 (тех-гейт, гео-бонусы) — на решении владельца (чекпоинт §C), баланс/пулы не менялись. Этап 3 (3а/3б) и этап 4 НЕ начинались. Чекпоинт: `10_27_r39_stage1_stage2_gate.md` |
| 2026-10-26 | R-36 (Task 41) | Корректирующий проход по решениям владельца после приёмки R-35: **ultra_rare — вариант «а» реализован ЦЕЛИКОМ**. Пулы = спеке docs/31 §2 дословно: ULTRA_RARE_ELEMENTS = Ir,Os,Re,Ru,Rh,Pd,Hf,Ta,Nb,Zr; RARE_ELEMENTS = Co,W,Mo,V,Ag,Pt,Au,U,Li,Be (пулы дизъюнктны). **drilling_rig в MVP**: здание в surface.json (extraction/surface/10 уровней/энергия 4), порог глубины BakedOre.minSourceLevel в движке (Re 8 / Rh,Ta,Pd,Dy 6 / большинство 5; у mine/quarry все 1), синергия mining_cluster между буровыми. **Аудит rarity**: закреплена семантика (базовая категория распространённости — надкласс пулов); таблица соответствия 5 элементов (Pt/Au/U/Be ultra→rare, Zr rare→ultra) + замороженный снапшот 14/12/13/21 (tests/elements-rarity.test.ts); на запечённую химию не влияет (все 5 имеют курированные ORE_SPECS). **Генерация**: новая ultra-ветка следовых глубинных залежей (qty×0.05, depth 4-5, availability 0.02-0.10) — иначе после синхронизации пула все кандидаты получали qty ≥ 10 → 0 уникальных (регрессия G-06); выбор ultra — «повышенная концентрация» qty 4-6. **Защита сейвов** (требование аудитора): dv (версия RNG залежей, DEPOSIT_RNG_VERSION=2) в сейве v3; сейвы до R-36 материализуются при загрузке (migrateDepositsIfNeeded, явная миграция). **PRNG/нормализатор**: защита от [0,0,0,0]-состояния в конструкторе + тесты Z1-Z5; arms=±Infinity → 1 (прежде +Inf проходил guard → nextInt(0,∞) → NaN-координаты) + тесты 8-9. Статистика после: 2828 планет — 0 без уникального, 48.7% с двумя, 100% со следами всех 10 руд, выбор равномерен по 10 элементам. Гейты: 720/720 (+27), lint 0/38, tsc 82 (src 71, дельта 0), validate 4/4, кросс-процессный sha256, браузер (новая игра → буровая в UI → позитив: Ba-ore 59 добыта буровой; негатив: шахта на глубинном гексе дала 0 Zr/Rh/Ir за ~1000 тиков → Save/Load точны). Ограничения (утверждены владельцем в рамках варианта «а»): тех-гейт «Глубокое бурение» и бонусы геологической активности (docs/40 §2.4) отложены; production build не запускался (dev-only платформа), CI нет. Чекпоинт: `10_26_r36_ultra_rare_drilling_rig.md` |
| 2026-10-27 | R-38 (Task 43) | Миграция сейвов с УЖЕ МАТЕРИАЛИЗОВАННЫМИ залежами (непокрытый R-37 сценарий аудита R-38) + финальная верификация этапа 2. **Контракт**: тела, колонизированные старым кодом (dm=1, dv≠текущей, устаревший свод), при загрузке сохраняют ФИЗИКУ как есть (прогресс добычи, истощение, здания, склад, колонизация неприкосновенны), а свод пересчитывается из фактических залежей текущим контрактом «свод = физика» (migrateMaterializedBodySummary в deserializeGameState ПОСЛЕ setCurrentLookups — порядок Б1 R-37 сохранён); dv НЕ поднимается (версия физики честная — старое тело ≠ телу новой генерации; молчаливой регенерации нет); идемпотентность — новое поле **sv** (DEPOSIT_SUMMARY_VERSION=1, версия контракта СВОДА; пишется рядом с ds/dm/dv только если известна — рантрип сейвов без sv побайтно идемпотентен); оценки гарантии — детерминированный дочерний поток derive от ds (соль id тела); отказ миграции тела (NaN-данные) сохраняет прежний свод, атомарность на тело, загрузка продолжается; ленивые тела (dm=0) не затрагиваются (R-37 сохранён). materializePlanetDeposits теперь честно ставит dv=DEPOSIT_RNG_VERSION после replay (физика воспроизведена текущим кодом) + sv; генерация помечает sv у тел с гексами. **Тесты**: +25 → 754/754 (49 файлов) — A1–A10 (холодный старт/кросс-галактика с dm=1, старый сейв, частичное/полное истощение, load→save→load идемпотентность, отказ миграции, ленивость, побайтный рантрип без dv, граничные данные: отсутствующий пул/пустые залежи/неизвестный элемент/qty=0/dv=999), B1–B10 (свод=физика на мигрированных телах, уникальный ресурс подтверждён физикой, буровая до истощения/после истощения, уровни L4/L5, океанический мир, нуль гексов, трансурановые Np/Pu/Am fallback, луна, генерация↔загрузка), C1–C5 (детерминизм, изоляция галактик, round-trip RNG, состояние без ds, версии dv не подменяются молча). **Замеры** (scripts/r38-migration-bench.ts, 200 систем, 3 колонии): дельта размера сейва −49 Б, накладные расходы миграции < 1 мс (в шуме); кросс-процессный sha256 ×3 (seed 2026, 279 материализованных тел в миграции): 131952bf…0671 — совпал. **Браузер** (agent-browser, seed 424242 через реальный API): старый сейв загружен (миграция «пересчитано 2, отказов 0» в консоли; пул Fe 158.6K вместо устаревшего ~480K), буровая L1 НЕ добывает Y-ore (порог 2) но добывает Ba/Np/Am (порог 1/fallback), апгрейд L2 → Y-ore добыт до истощения (залежь 17 → 0, склад 16.99=полная), после истощения тики не добавляют, Save (sv=1 в сейве, dv не инъецирован) → reload → Load → повторная Load — состояние идентично, повторная миграция НЕ срабатывает; 0 ошибок страницы. Гейты: 754/754, lint 0/38, tsc 86 (src 71, Δ0 к базе R-37), validate:all 4/4, БД 0 сейвов. CI в репо НЕТ (не заявляются зелёные check-runs); production build не запускался (dev-only). Таблицы для решения владельца по отклонениям §2.4 (тех-гейт «Глубокое бурение», гео-бонусы) — чекпоинт §8. Чекпоинт: `10_27_r38_materialized_save_migration.md` |
| 2026-10-26 | R-37 (Task 42) | Корректирующий проход по вердикту аудитора R-36 (BLOCKED, 4 блокера). **Б1 порядок миграции**: deserializeGameState — baked-model загружаемой галактики + setCurrentLookups ДО всякой работы с залежами (прежде загрузочная миграция шла ДО установки lookups: холодный старт со старым сейвом = краш «BakedLookups не инициализированы», после активной игры — модель предыдущей галактики); zod-валидация ДО установки lookups (отклонённый сейв не затирает модель активной игры). **Б2 согласованность + масштаб**: загрузочная материализация УДАЛЕНА — версионно-совместимая материализация: загрузка не материализует тела (ленивость R-29 и размер сейва сохранены: повторная сериализация загруженного старого сейва побайтно исходной; колония добавляет только своё тело, < 64 КБ), materializePlanetDeposits при колонизации реплеит снимок ТЕКУЩИМ кодом и ПЕРЕСЧИТЫВАЕТ свод-пул из свежей физики продолжением того же RNG-потока (та же точка, что при генерации ⇒ пул при генерации и при replay бит-в-бит); dv 2→3; dv пишется только если известна (старые сейвы без dv — побайтный рантрип, прежде инъекция «dv":1). **Б3 физическая концентрация**: выбор уникального ресурса (1-2 из пула ULTRA_RARE, без повторов) переехал из aggregateResourceDeposits ВНУТРЬ assignResourceDeposits (фаза в конце потока — следовая физика R-36 бит-в-бит): выбранный элемент — единственная усиленная залежь (qty 4-6 ОРЕ, availability 0.03-0.10, depth 4-5) на не-океанском гексе; свод-пул = чистая агрегация физики (руды→элементы по долям выхода) + гарантия элементов (hexCount=0 = «геол. оценка», UI-метка); полностью океанские миры — выбора НЕТ, пул без обещанной физики; интеграционный тест: буровая L10 на реальной планете извлекает выбранный ресурс до исощения, пул = добыча×доля ± 1 (Os: пул 4 = 5 руды × 7.5/10); проверка сумм без пропусков (прежде выбранный ultra выпадал из сверки). **Б4 документация**: схема этапов в STATUS/README/plans (этап 3 = планирование, 3а/3б — будущие подэтапы, этап 4 ЗАПРЕЩЁН до приёмки 3б); осознанные исключения §3.3 (тех-гейт «Глубокое бурение», гео-бонусы docs/40 §2.4) — требуют отдельного одобрения владельца; §2.5/3.2 синхронизированы с каталогом (18 зданий, drilling_rig перенесён в реализованные). Тесты: +9 → 729/729 (48 файлов): migration-order (холодный старт, кросс-галактика, отказ не затирает lookups), unique-resource-contract (интеграция добычи, суммы, океанский мир), deposits D2 11a/D3 переписаны под физическую подпись выбора, save-format 15/17. Гейты: 729/729, lint 0/38, tsc 82 (src 71, Δ0), validate 4/4, sha256 ×3 процесса (ae0f6c6f…8b46), статистика 2828 планет — 0 без уникального, 50.6% с двумя, выбор равномерен (401-468), браузер: колонизация → буровая L1-L4 НЕ добывает Os (порог 5) → L5 добывает всю залежь (5/50) → Save/reload/Load точны, 0 ошибок консоли; БД 0 сейвов. CI в репо НЕТ (не заявляются зелёные check-runs). Чекпоинт: `10_26_r37_corrective_pass.md` |
| 2026-10-26 | R-35 (Task 40) | Корректирующий проход по замечаниям аудита опубликованного этапа 2 (база R-34 `fe00677`). **P1 PRNG**: класс назывался Xoshiro256, но был 32-битным мешапом с константами xoshiro256** (t=s1<<17, rotl(s3,45)); реализован канонический xoshiro128** 1.1 (t=s1<<9, rotl(s3,11); класс → Xoshiro128StarStar, 21 файл); эталонные векторы из официального C-кода (gcc, prng.di.unimi.it) — tests/prng-reference.test.ts; сидирование и макет snapshotState не менялись (совместимость ds сейвов v3); последовательности выходов изменились — задокументировано явно (в БД 0 сейвов, влияние нулевое); новый тест Save→Load→materialize бит-в-бит (№13); закрыт пункт Pass 2 P3-6. **P2 радиус**: разброс рукавов/радиальный шум считались от сырого cfg.radius → NaN-координаты при NaN/Infinity; единая нормализация всех параметров + 7 тестов. **ultra_rare**: состав НЕ менялся — все 10 элементов спеки = deep_ore/drilling_rig (здания нет в MVP), Y/Ba из текущего кода тоже глубокие; вопрос владельцу (3 варианта) — статус ОТКРЫТ/BLOCKED. **Отчётность**: §0 в чекпоинте Pass 14 (SHA публикации, нет CI, Task ID 35–38), docs/README — xoshiro128**. Гейты: 693/693 (+13), lint 0/38, tsc src 71 (дельта 0), validate 4/4, кросс-процессный sha256, браузер. Чекпоинт: `10_26_r35_corrective_pass.md` |
| 2026-10-26 | Аудит Pass 14 (Task ID 35–38) | Этап 2 внешнего ИИ-аудита: галактика/планеты/экономика добычи. Реверифицированы этап 0–1 (скорость ×N в браузере: 1/5/50 т/с; POST ответ 842 КБ→34 Б; раундтрип побайтно). Исправлено 14 дефектов с воспроизведением: G-02 (мосты JP без лимитов: 10600 дублей/400 сверхстепеней/2600 сверхдистанций), G-03 (позиции: доли захардкожены, диск не равномерен по площади, ореол внутри диска, arms=0→NaN), G-04 (склейка орбит: 2178 пар на 49611 планет), G-05 (sort-компаратор→Fisher–Yates, chi² 4637→58, кросс-движково бит-в-бит), G-06 (ультраредкие: 6.9% планет без ultra→0%, tier 87%→100%), G-08 (100% лун с двойным римским номером), G-01 (роли добытчиков: шахта добывала чужие руды, газовый экстрактор — руды вместо газов), +бонусы: коллизии seed в splitMix64 (seed 7≡42; →BigInt), nextGaussian u1=0→Infinity, аннигиляция He/Ne/Ar, диапазоны давления/парника, идемпотентность материализации. G-07 классифицирован как незавершённая фича (+архитектурный набросок). 97 новых тестов, гейты: 680/680, lint 0/38, tsc src 71 (−22), validate 4/4; браузерная верификация полная. На момент исполнения — без коммитов (правило аудитора); **опубликовано как R-34 `fe00677` (поверх R-33 `7ff0490`) — см. §0 чекпоинта и запись R-35**. Чекпоинт: `10_26_audit_14_galaxy_planets_economy.md` |
| 2026-10-26 | Аудит Pass 13 (Task ID 34) | Этап 0–1 внешнего ИИ-аудита: скорость применялась дважды (×5→фактически ~25 т/с) — исправлен catch-up по performance.now; POST/PUT сейвов возвращали 3.29 МБ — минимизированы до {id}; gzip-бомба разворачивалась в память до лимита — потоковая gunzipBounded; + мусор в БД→400, PUT/DELETE 500→404, расхождение времени mediator. 583/583, контракты проверены в изоляции и браузере. Чекпоинт: `10_26_audit_13_stage01_core_saves.md` |
| 2026-10-26 | R-32 (Task ID 33) | Восстановление audited-состояния после sandbox-restore: финальный коммит потерянной сессии (Task 32) поверх R-31 случайно зафиксировал 22 «файла-призрака», возвращённых restore-ом окружения из старого снапшота — byte-идентичные возвраты удалённого (`resource-panel.tsx` из R-31, монолитный `src/data/buildings.ts` из R-BLD-MOD, 11 чекпоинтов старого формата из R-25) + никогда не трекавшиеся (`save-format-v2.ts` и его тест из R-30, `star-types.ts`, runtime-скрипты `.zscripts`/`tests`, `doc_temp/`). Функциональный регресс подтверждён эмпирически: `@/data/buildings` резолвился в монолит (15 старых зданий) вместо модульного `buildings/index.ts` (17) — файл затенял директорию в 7 живых импортах (engine, диалоги, bonus-resolver, synergy). Все 22 удалены; `git diff 13e5270` = только worklog.md. Гейты = базлайн R-31: 567/567, lint 0/40, tsc src 93, validate 4/4, 17 зданий. Чекпоинт: `10_26_repo_recovery.md`. Код заморожен до внешнего ИИ-аудита (ChatGPT) |
| 2026-09-04 | R-31 (Task ID 32) | Аудит и ревью кода после слияния: 3 параллельных ревью-агента (economy / state-save / UI), 5 major + ~15 minor найдено, 10 багов исправлено: бесплатная смена специализации X→Y (теперь полная стоимость); двойной энергобюджет (порядок тика: очередь перед авто-переработкой); коллизия ID queue-элементов после Load (`restoreProductionItemCounter`); хардкод «+10/tick» в HexInfoCard (реальная формула P1-26); общий бар склада без газа (totalCapacity = 4 склада, 12000); молчаливый провал постройки (тост + disabled-карточка с причиной); тихая порча при битом словаре v3 (`idOf` throw); фантомные activeRecipes простаивающих переработчиков; byteLength в API; дрейф справки (4-й газовый склад, nuclear 25, точные выходы цепочек R-27, вместимости из констант). Уборка: `resource-panel.tsx` (мёртвый), дубль чекпоинта старого формата, мёртвые импорты/пропы/селекторы. Отложено (дизайн): гейты глубинных руд О1, мульти-рецептный штраф О2, липкость spec О3, счётчики ships О4 — таблица в `checkpoints/09_04_audit_12_code_review_code.md`. 567/567, lint 0/40, tsc src 93, validate 4/4; E2E: склад 1110/12000, HexInfoCard +1.6/tick, Save→Load→enqueue→cancel без коллизий. Аудит-чейн: Pass 12 |
| 2026-08-31 | R-30 (Task ID 30) | Снятие заглушек совместимости v1/v2 (решение владельца: сейвы стёрты, «нечего захламлять код»): удалены `src/lib/save-format-v2.ts` (хелперы → v3), `expandSaveV2`/`migrateLegacyDepositFlags`/fmt-детект в `deserializeGameState`; `expandSaveV3` — строгий контракт `fmt:3` (старые форматы → явная ошибка, не молчаливая порча); UI-тост при неудачной загрузке (`page.tsx:handleLoad`); INSTRUCTIONS.md — fmt-раздел только v3. Тесты: `save-format-v2.test.ts` удалён (−11), тест 9 v3 — «старые форматы отклоняются»; fixtures serialization.test.ts — `fmt:3`. 567/567, lint 0/48. План: `plans/2026-08-31-task30-remove-legacy-formats.md` |
| 2026-08-31 | R-29 (Task ID 29) | Ленивая материализация залежей (идея владельца): при генерации — только свод-пул + RNG-снимок `depositRngState` (`Xoshiro256.snapshotState/fromState`), при `colonizePlanet` — replay бит-в-бит (`materializePlanetDeposits`), луны — той же схемой. Формат сейва **v3**: словарь id, `ds`/`dm`, истощённые кортежи не пишутся; миграция v1/v2 (запечённые тела → материализованные). Свежий сейв 200 систем **8.86 → 2.74 МБ (−69%)**, gzip 0.59 МБ. UI: баннер «поверхность не разведана» на карте неколонизированных планет. INSTRUCTIONS.md: раздел «Где физически хранятся сейвы» (db/custom.db, GameSave) + чек-лист восстановления DEV. Тесты: `tests/save-format-v3.test.ts` (+12 → 578/578). План: `plans/2026-08-31-task29-lazy-deposits.md` |
| 2026-08-31 | R-28 (Task ID 28) | Компактный формат сейва v2 (`src/lib/save-format-v2.ts`): залежи/агрегаты кортежами, гексы без coord (восстановление из сетки), без пустых полей застройки, округление availability/звёздных float — 200 систем **31.4 → 8.9 МБ (−72%)**, gzip 5.3 → 2.3 МБ; анализ размера `bun run save:size`; UI: единый список «Хранилище · количество / резерв» (слияние «Резервов» и «Хранимых ресурсов», красный/зелёный). Docs: STATUS §2.7, 35-warehouse §1.4.2. План: `plans/2026-08-31-task28-save-format-v2.md` |
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
