# План: PROC-WORKSHOPS-01 — переработка руд через цехи и отдельный завод строительных материалов
Дата: 2026-10-28 · Источник: Issue #23 (владелец, согласовано 2026-10-28)

## Цели

Архитектурное обновление системы переработки руд: уровень processing-здания =
количество цехов; специализация на цехе по конкретному recipeId (необратимая);
детерминированный планировщик (специалист-приоритет + общий FIFO + ротация
repeat); два независимых пула — `processor` (продвинутые) и новое здание
`construction_materials_plant` (6 базовых рецептов R-27); R-27 авто-режим
полностью подчинён цехам (старый `processAutoProcessing` — вторая исполни-
тельная дорога — удаляется). Не трогать: корабельные компоненты, верфи,
`docs/55-ship-production-flow.md`. Старые сейвы — НЕ требование обратной
совместимости (защитная нормализация цехов при загрузке — да, legacy-
миграция специализаций — нет).

## Чеклист

### Коммит 1 — docs-only (до runtime-изменений)
- [x] `docs/40-buildings.md`: §3.0 → модель цехов + два класса зданий + каталог
      специализаций по recipeId + контракт планировщика (правила 1–11 issue);
      §3.1 processor → цехи/продвинутый пул, убрать level-multiplier пропускной
      способности; новый §3.6 «Завод строительных материалов»; §11.3 →
      пропускная способность = число цехов (PROCESSING_LEVEL_MULT убрать из
      переработки); §11.4 → R-27 авто-режим через цехи строительного пула;
      §12.1/12.2 → поля BuildingDef.usesWorkshops / cell.workshops.
- [x] `docs/STATUS.md`: сводка + системы + changelog-строка.
- [x] `docs/!listing.md`: дата/счётчики/описание 40-buildings.
- [x] План закоммичен вместе с docs.

### Коммит 2 — runtime/данные
- [x] `src/core/types.ts`: WorkshopState/WorkshopBatch; cell.workshops?;
      BuildingDef.usesWorkshops?; ProductionItem.assignedTo — УДАЛИТЬ.
- [x] `src/core/events.ts`: payload specialize/upgrade-specialization →
      workshopNumber + recipeId.
- [x] `src/data/buildings/surface.json`: processor (usesWorkshops, описание);
      НОВОЕ здание construction_materials_plant (surface, L1–10).
- [x] `src/data/recipes.ts`: 6 базовых рецептов → buildingId
      construction_materials_plant.
- [x] ProcessingBuildingId (processing-chains.ts) + ore-specs 6 руд → завод;
      validate.ts допуск нового id.
- [x] `src/data/workshop-specializations.ts`: каталог специализаций цехов
      (ID/имя/совместимый пул) — data-driven из RECIPES.
- [x] `src/data/auto-processing.ts`: только приоритетный список R-27
      (Fe→Si→Al→C→Cu→Ti); LEVEL_INCREMENT/AUTO_SPECIALIZATIONS удалить.
- [x] `src/economy/workshop-scheduler.ts` (новый): deterministic scheduler
      двух пулов; specialist-priority + FIFO + fallback специалиста;
      runnable-гейты (входы/энергия/место); auto-кандидаты R-27; повторное
      встраивание repeat в хвост; партия не прерывается.
- [x] `src/economy/engine.ts`: processAutoProcessing УДАЛИТЬ;
      processProductionQueue → диспетчер (workshop-здания → планировщик,
      refinery/synthesizer/прочие → прежняя карусель); specializeWorkshop /
      upgradeWorkshopSpecialization (необратимость); downgradeBuilding/
      demolishBuilding — requeue партий удалённого цеха в хвост с прогрессом;
      build/upgrade — инициализация/добавление обычного цеха.
- [x] `src/economy/economy-module.ts`: обработчики новых событий; onDowngrade/
      onDemolish передают queues в engine.
- [x] `src/stores/game-store.ts`: действия specializeWorkshopOnHex /
      upgradeWorkshopSpecializationOnHex (старые specializeBuildingOnHex/
      upgradeSpecializationOnHex — по назначению процессора удалить);
      нормализация workshops при десериализации (guard, не миграция).
- [x] `src/lib/save-format-v3.ts`: PlainHex.workshops + compactHex/expandBody.

### Коммит 3 — UI
- [x] building-dialog: панель цехов (карточки 1..L: статус/профиль/уровень/
      партия/прогресс), «Специализировать» с выбором recipeId + предупреждение
      необратимости, «Улучшить специализацию» с ценой; апгрейд = +обычный цех;
      понижение = −цех №L с потерей специализации (предупреждение).
- [x] specialize-dialog.tsx (категорийный) — удалить; новый диалог
      специализации цеха по рецептам пула.
- [x] planet-view: два раздельных пула (стройматериалы / продвинутый) +
      секции прочих зданий; статусы задач FIFO (выполняется/ожидает/
      пропущено: нет входов/энергии/места).
- [x] production-queue: бейдж исполнителя «гекс #N · цех M» через lookup
      по workshops (не сохраняемая привязка).

### Коммит 4 — тесты + чекпоинт
- [x] tests/economy/workshops.test.ts: обязательные контракты issue
      (L1/L5/L10; специализация с L1; необратимость; параллельность;
      3Fe+специалист+обычный; fallback специалиста; ротация FIFO/repeat;
      missing-input/energy/full-warehouse без starvation; downgrade/requeue;
      изоляция пулов; R-27 через цехи; save/load рантрип).
- [x] Обновить tests/economy/auto-processing.test.ts (новая модель),
      processors.test.ts (цеховая модель), downgrade-demolish.test.ts.
- [x] Гейты: bun test / lint / validate:all / tsc (baseline 86, Δ0) /
      git diff --check / audit:module-bus drift.
- [x] Чекпоинт + worklog + план [x] + push + комментарий в Issue #23
      (issue НЕ закрывать).

## Открытые вопросы

- Refinery/synthesizer НЕ переводятся на цехи (вне границ issue: «оба типа»
  = processor + construction_materials_plant) → сохранить текущую карусель
  и категорийную специализацию для предельных форм. → Решение: принято.
- Потребление входов в момент ЗАВЕРШЕНИЯ партии (как сегодня), не старта;
  гейты runnable — при назначении. Крайний случай «входы исчезли к концу» →
  партия стоит на progress=0, удерживая цех (документировано). → Решение: принято.
- Энергия: партия тратит recipe.energyCost/total за тик (ручная очередь и
  авто-партии одинаково; старый авто-режим энергию рецепта не тратил —
  изменение задокументировано). → Решение: принято.
- minSpecializationLevel рецептов (глубинные руды) в новой модели не гейтит
  (был привязан к категорийной специализации; дважды не вводить). → Решение: принято.
- assignedTo удаляется полностью; исполнитель для UI — lookup по workshops.
  → Решение: принято.

## Результат

- Статус: done
- 4 коммита: a1a8078 (docs-only, ДО runtime — по протоколу issue) → 76d80d2
  (runtime/данные) → cfa0b00 (UI) → 4383fab (тесты + bus-map 85 событий).
- Гейты: bun test 1015/1015 (0 fail; +25 workshops C1–C12, +9 auto R-27
  через планировщик, +19 множители; baseline 1005); lint 0 err / 42 warn
  (baseline 43, Δ−1); tsc 75 ошибок < baseline 86 (Δ−11; список сверен,
  новых видов ошибок в файлах задачи нет); validate:all 4/4;
  git diff --check чисто; bus-map drift зелёный (85 событий).
- Браузерный E2E (agent-browser, реально): завод+шахта+процессор+солнечная
  через UI → цех №1 завода: АВТО-партия R-27 «Плавка железа · авто 20%» →
  «Специализировать» → диалог профиль-рецептов пула → smelt_fe → бейдж
  «Цех №1 · Плавка железа (гематит) · ур. 1» → апгрейд-подсказка «+1 обычный
  цех №2» → раздельные пулы во вкладке Производство. 0 ошибок консоли.
  Скриншот: checkpoints/proc-workshops-e2e-2026-10-28.png.
- Issue #23 НЕ закрыт — приёмка/плейтест за владельцем (PROC-01..PROC-12
  appended в чекпоинт как pending manual checks).
