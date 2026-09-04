# Checkpoint: R-SHIPS-DATA — Data-driven ships catalog + documentation

**Дата:** 2026-08-28
**Task ID:** 20 (R-SHIPS-DATA)
**Commit:** (см. git log)
**Baseline перед задачей:** lint 0/49, tsc 159, tests 391/0, recipes 75/75, buildings 17/17

## Контекст

После завершения R-BLD-MOD (Task 19 — модульные здания в JSON) пользователь
попросил:
1. Обновить документацию о новой структуре хранения данных.
2. Сделать вынос данных по комплектующим космических кораблей в
   отдельные файлы (по тому же паттерну, что и здания/research).

## Сделано

### A. Data extraction (ships → JSON)

Создано 3 JSON-файла данных:

- `src/data/ships/hulls.json` — 4 корпуса MVP (Скаут, Истребитель, Фрегат,
  Транспорт). Формат: `{ "comment": "...", "hulls": HullType[] }`.
- `src/data/ships/modules.json` — 20 модулей Mk.I (2 engine + 5 control +
  1 life_support + 2 weapon + 2 defense + 8 auxiliary).
  Формат: `{ "comment": "...", "modules": ShipModule[] }`.
- `src/data/ships/fuel-map.json` — маппинг `FuelType ↔ elementId` +
  стоимость конверсии. Формат: `{ "comment", "fuelToElement",
  "elementToFuel", "fuelElementCostPerUnit", "allFuelTypes" }`.

Рефакторнутые тонкие TS-loader'ы (публичный API сохранён для обратной
совместимости со всеми 10 потребителями):

- `src/data/ships/hulls.ts` — импортирует `hulls.json`, кастит к
  `HullType[]` через `unknown`, строит `HULL_MAP`. Экспорт: `HULLS`,
  `HULL_MAP`, `getHull`, `listHulls`.
- `src/data/ships/modules.ts` — импортирует `modules.json`. Экспорт:
  `SHIP_MODULES`, `MODULE_MAP`, `getModule`, `listModulesByCategory`,
  `listModulesForHull`.
- `src/data/ships/fuel-map.ts` — импортирует `fuel-map.json`. Экспорт:
  `FUEL_TO_ELEMENT`, `ELEMENT_TO_FUEL`, `FUEL_ELEMENT_COST_PER_UNIT`,
  `ALL_FUEL_TYPES`, `emptyFuelStore`.
- `src/data/ships/shipyard-queue.ts` — НЕ тронут (это runtime-логика
  очереди постройки, не данные).
- `src/data/ships/index.ts` — обновлённый barrel с подробным комментом
  про data-driven структуру.

### B. Validator (scripts/validate-ships.ts + package.json)

Создан валидатор по образцу `validate-buildings.ts`. Проверяет:

- Hulls: уникальность ID, валидность `size`/`armorOptions`, все числовые
  поля > 0, `requiredEngineeringLevel`/`requiredShipyardLevel >= 1`.
- Modules: уникальность ID, валидность `category`/`slotRestriction`/
  `controlType`/`weaponType`/`damageType`/`defenseType`/`auxiliaryType`/
  `fuelType`/`minHull`, ссылки `requiredTechs` на `TECH_MAP`, корректность
  `bonuses` (target непустой, operation валиден, `sourceTech` ∈ TECH_MAP).
- Fuel-map: ключи `FUEL_TO_ELEMENT`, `FUEL_ELEMENT_COST_PER_UNIT` и
  `ALL_FUEL_TYPES` согласованы, все FuelType валидны.

Выводит разбивку по category, список tech-gated модулей (0 в MVP),
список модулей с бонусами (engine_ion_mk1).

Добавлены скрипты в `package.json`:
- `validate:ships` — одиночный запуск
- `validate:all` — все три валидатора подряд (recipes + buildings + ships)

### C. Тесты (tests/ships/data-files.test.ts)

26 новых тестов в 3 describe-блоках:

- Hulls (9 тестов): JSON-структура, ровно 4 корпуса, корректные ID,
  `HULL_MAP` O(1) поиск, `getHull`/`listHulls`, T-FLEET-1 spec fixture
  для `hull_scout`, отсутствие тяжёлых корпусов, уникальность ID,
  валидность armorOptions.
- Modules (10 тестов): JSON-структура, ровно 20 модулей с правильной
  разбивкой по 6 категориям, `MODULE_MAP`, `getModule`,
  `listModulesByCategory`, `listModulesForHull`, бонус engine_ion_mk1,
  T-FLEET-1 fixture (8 модулей Разведчика), уникальность ID, наличие
  `requiredTechs` (хотя бы пустого массива).
- Fuel-map (7 тестов): JSON-структура, `FUEL_TO_ELEMENT` 4 типа,
  `ELEMENT_TO_FUEL` обратная мапа, `FUEL_ELEMENT_COST_PER_UNIT` 1:1,
  `ALL_FUEL_TYPES` 4 типа, `emptyFuelStore`, согласованность ключей
  между мапами.

### D. Документация

#### D.1 Новый документ: `docs/data-driven-architecture.md` (~9K токенов, 360 строк)

Главный архитектурный документ, консолидирующий описание data-driven
хранения для всех трёх каталогов (buildings/research/ships). Разделы:

1. Принцип data-driven хранения (мотивация, архитектура, принципы)
2. Реализованные каталоги (buildings 17 зданий / research 15 тех / ships
   4+20+4) с указанием полей записей
3. Паттерн тонкого TS-loader'а (пример кода, зачем каст через `unknown`,
   сохранение публичного API)
4. Общая бонус-система (`Bonus` interface, 2 источника: building-sourced
   vs tech-sourced, примеры, резолвер)
5. Валидаторы каталогов (3 валидатора + `validate:all`)
6. DATA-DRIVEN расширение (пошаговые инструкции: как добавить новое
   здание/модуль/тип топлива/технологию)
7. Совместимость с кодом (resolveJsonModule, разделение толстых JSON
   и тонких TS, обратная совместимость)
8. Дорожная карта расширений (recipes/elements/ores → JSON, Etap 4)

#### D.2 Обновлён `docs/50-ships.md` (v1.0 → v1.1)

- Шапка: добавлена отметка изменения (2026-08-28 — R-SHIPS-DATA),
  статус обновлён с «0% реализации» на «Block 02 + R-SHIPS-DATA».
- Содержание: добавлен §11 «Data-driven структура хранения».
- Создан раздел §11 (8 подразделов): принцип, тонкие loader'ы,
  публичный API, DATA-DRIVEN расширение, валидатор `validate:ships`,
  тесты, структура каталога `src/data/ships/`, бонусы модулей
  (общая система с зданиями).

#### D.3 Обновлён `docs/03-project-structure.md`

- Дерево `src/data/`: заменены устаревшие комментарии про
  `buildings.ts`/`ships/`/`research/` на актуальные, отражающие
  data-driven JSON + тонкие TS-loaders. Удалён старый `buildings.ts`
  из дерева (он удалён в R-BLD-MOD Task 19, но комментарий остался).
- Принцип 3 в «Принципах организации кода»: переписан с «Данные в
  TypeScript-модулях — не JSON, для типобезопасности» на «Data-driven
  JSON + тонкие TS-loaders» с описанием паттерна и ссылкой на
  `data-driven-architecture.md`.

#### D.4 Обновлён `docs/!listing.md`

- Шапка: всего 28 → 29 документов, ~375K → ~384K токенов, дата
  обновления 2026-06-26 → 2026-08-28.
- Раздел «Научная база и аудиты»: 5 → 6 документов, добавлена строка
  про `data-driven-architecture.md` с описанием и версией.
- Раздел «Задача: Рефакторинг архитектуры»: добавлен
  `data-driven-architecture.md` (2-я позиция после modular-bus).
- Создан новый раздел «Задача: Добавить новую сущность
  (здание/модуль/технологию)» с пошаговым планом.

## Качественные метрики (all green)

- `bun run lint`: **0 errors / 49 warnings** (= baseline 49, 0 новых).
- `bunx tsc --noEmit`: **159 errors** (= baseline 159, 0 новых;
  паттерн-дифф по TS-кодам ошибок идентичен).
- `bun test`: **417 pass / 0 fail** (было 391; +26 новых тестов
  в data-files.test.ts).
- `bun run validate:recipes`: 75/75 ✓
- `bun run validate:buildings`: 17/17 ✓
- `bun run validate:ships`: 4 корпуса + 20 модулей + 4 FuelType ✓
- `bun run validate:all`: все три валидатора зелёные ✓

## Agent-browser end-to-end verification

- ✓ Главное меню загружается (SpaceGame, New Galaxy, Launch Game).
- ✓ Игра запускается (layout с Save/Справка/Конструктор кораблей/
  Флоты/Исследования/Galaxy Map).
- ✓ Справка (reference-dialog) открывается, 5 вкладок (Планеты/
  Исследования/Экономика/Флот/Здания).
- ✓ Вкладка «Флот» — таблица «Корпуса кораблей (4 в MVP)»
  показывает все 4 корпуса из hulls.json с корректными параметрами:
  Скаут (25 HS, 200 HP, 500т, 1/2/3/1, L1), Истребитель, Фрегат,
  Транспорт.
- ✓ Конструктор кораблей открывается и отображает:
  - 4 корпуса (через `HULLS` из thin loader)
  - 4 варианта брони (light/standard активны, thick/heavy disabled —
    фильтруются по `armorOptions`)
  - все 20 модулей из `modules.json` (2 двигателя, 5 контрольных,
    ЖО-Кабина, 2 оружия, 2 обороны, 8 вспомогательных) с корректными
    HS/массой/стоимостью/энергией/thrust.
- ✓ dev.log чист: 0 runtime errors, все GET 200, prisma-запросы OK.
- ✓ agent-browser errors пуст.

## Изменённые/созданные файлы

**Создано (7 файлов):**
- `src/data/ships/hulls.json` (47 строк) — данные 4 корпусов
- `src/data/ships/modules.json` (200+ строк) — данные 20 модулей
- `src/data/ships/fuel-map.json` (38 строк) — данные маппинга топлива
- `scripts/validate-ships.ts` (240+ строк) — валидатор
- `tests/ships/data-files.test.ts` (190+ строк) — 26 тестов
- `docs/data-driven-architecture.md` (360+ строк) — новый архитектурный документ

**Изменено (5 файлов):**
- `src/data/ships/hulls.ts` — рефактор из 98 строк в 41-строчный thin
  loader (json import + cast + lookup map)
- `src/data/ships/modules.ts` — рефактор из 376 строк в 60-строчный
  thin loader
- `src/data/ships/fuel-map.ts` — рефактор из 53 строк в 56-строчный
  thin loader (с html-комментом data-driven)
- `src/data/ships/index.ts` — обновлён комментарий barrel
- `package.json` — добавлены `validate:ships` и `validate:all` скрипты
- `docs/50-ships.md` — добавлен §11, обновлена шапка и содержание
- `docs/03-project-structure.md` — обновлено дерево `src/data/` и
  принцип 3
- `docs/!listing.md` — зарегистрирован новый документ, обновлены итоги

## Конфликты с предыдущими задачами

Нет. R-SHIPS-DATA полностью обратно-совместим:
- Публичный API `@/data/ships` сохранён (10 потребителей работают без
  правок импортов).
- Валидаторы buildings/research не тронуты (новый `validate:ships`
  использует тот же паттерн).
- Бонус-система в `Bonus` interface — общая с зданиями (R-RES §E +
  R-BLD-MOD расширение), работает без правок.
- Тесты ships/* (81 существующих + 26 новых) все зелёные.
- R-RES очередь исследований и активная модель — не тронуты.
- R-BLD-MOD layered JSON (surface/orbit/space) — не тронут.
