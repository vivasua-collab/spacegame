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
- [ ] `docs/40-buildings.md`: §3.0 → модель цехов + два класса зданий + каталог
      специализаций по recipeId + контракт планировщика (правила 1–11 issue);
      §3.1 processor → цехи/продвинутый пул, убрать level-multiplier пропускной
      способности; новый §3.6 «Завод строительных материалов»; §11.3 →
      пропускная способность = число цехов (PROCESSING_LEVEL_MULT убрать из
      переработки); §11.4 → R-27 авто-режим через цехи строительного пула;
      §12.1/12.2 → поля BuildingDef.usesWorkshops / cell.workshops.
- [ ] `docs/STATUS.md`: сводка + системы + changelog-строка.
- [ ] `docs/!listing.md`: дата/счётчики/описание 40-buildings.
- [ ] План закоммичен вместе с docs.

### Коммит 2 — runtime/данные
- [ ] `src/core/types.ts`: WorkshopState/WorkshopBatch; cell.workshops?;
      BuildingDef.usesWorkshops?; ProductionItem.assignedTo — УДАЛИТЬ.
- [ ] `src/core/events.ts`: payload specialize/upgrade-specialization →
      workshopNumber + recipeId.
- [ ] `src/data/buildings/surface.json`: processor (usesWorkshops, описание);
      НОВОЕ здание construction_materials_plant (surface, L1–10).
- [ ] `src/data/recipes.ts`: 6 базовых рецептов → buildingId
      construction_materials_plant.
- [ ] ProcessingBuildingId (processing-chains.ts) + ore-specs 6 руд → завод;
      validate.ts допуск нового id.
- [ ] `src/data/workshop-specializations.ts`: каталог специализаций цехов
      (ID/имя/совместимый пул) — data-driven из RECIPES.
- [ ] `src/data/auto-processing.ts`: только приоритетный список R-27
      (Fe→Si→Al→C→Cu→Ti); LEVEL_INCREMENT/AUTO_SPECIALIZATIONS удалить.
- [ ] `src/economy/workshop-scheduler.ts` (новый): deterministic scheduler
      двух пулов; specialist-priority + FIFO + fallback специалиста;
      runnable-гейты (входы/энергия/место); auto-кандидаты R-27; повторное
      встраивание repeat в хвост; партия не прерывается.
- [ ] `src/economy/engine.ts`: processAutoProcessing УДАЛИТЬ;
      processProductionQueue → диспетчер (workshop-здания → планировщик,
      refinery/synthesizer/прочие → прежняя карусель); specializeWorkshop /
      upgradeWorkshopSpecialization (необратимость); downgradeBuilding/
      demolishBuilding — requeue партий удалённого цеха в хвост с прогрессом;
      build/upgrade — инициализация/добавление обычного цеха.
- [ ] `src/economy/economy-module.ts`: обработчики новых событий; onDowngrade/
      onDemolish передают queues в engine.
- [ ] `src/stores/game-store.ts`: действия specializeWorkshopOnHex /
      upgradeWorkshopSpecializationOnHex (старые specializeBuildingOnHex/
      upgradeSpecializationOnHex — по назначению процессора удалить);
      нормализация workshops при десериализации (guard, не миграция).
- [ ] `src/lib/save-format-v3.ts`: PlainHex.workshops + compactHex/expandBody.

### Коммит 3 — UI
- [ ] building-dialog: панель цехов (карточки 1..L: статус/профиль/уровень/
      партия/прогресс), «Специализировать» с выбором recipeId + предупреждение
      необратимости, «Улучшить специализацию» с ценой; апгрейд = +обычный цех;
      понижение = −цех №L с потерей специализации (предупреждение).
- [ ] specialize-dialog.tsx (категорийный) — удалить; новый диалог
      специализации цеха по рецептам пула.
- [ ] planet-view: два раздельных пула (стройматериалы / продвинутый) +
      секции прочих зданий; статусы задач FIFO (выполняется/ожидает/
      пропущено: нет входов/энергии/места).
- [ ] production-queue: бейдж исполнителя «гекс #N · цех M» через lookup
      по workshops (не сохраняемая привязка).

### Коммит 4 — тесты + чекпоинт
- [ ] tests/economy/workshops.test.ts: обязательные контракты issue
      (L1/L5/L10; специализация с L1; необратимость; параллельность;
      3Fe+специалист+обычный; fallback специалиста; ротация FIFO/repeat;
      missing-input/energy/full-warehouse без starvation; downgrade/requeue;
      изоляция пулов; R-27 через цехи; save/load рантрип).
- [ ] Обновить tests/economy/auto-processing.test.ts (новая модель),
      processors.test.ts (цеховая модель), downgrade-demolish.test.ts.
- [ ] Гейты: bun test / lint / validate:all / tsc (baseline 86, Δ0) /
      git diff --check / audit:module-bus drift.
- [ ] Чекпоинт + worklog + план [x] + push + комментарий в Issue #23
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

- Статус: (заполняется в конце)
