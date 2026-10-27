# R-39 — Финальная приёмка этапа 2 + аудит блокеров этапа 1 (P0-1)

> **Дата:** 2026-10-27 · **Task ID:** 44 · **Задание:** GitHub Issue #3 (аудитор)
> **База:** `main` = `ee25618d33ac346b4238e8f327f49151c87912ae`
> (код R-38: `9c79bdc1dcc9d8b0f01203589b3a2b65ed20e1da` + docs `ee25618`)
> **Публикация:** SHA в §0 (вписывается отдельным docs-коммитом — конвенция
> R-35…R-38, история не переписывается).
> **Режим:** только исправления этапов 1–2. Этап 3 (3а/3б) и этап 4 НЕ
> начинались; пулы ресурсов и баланс НЕ менялись; тесты НЕ ослаблялись.

---

## 0. Публикация

| Параметр | Значение |
|---|---|
| База (до работы) | `ee25618d33ac346b4238e8f327f49151c87912ae` |
| Коммит R-39 | _(вписывается после push — см. ниже)_ |
| CI | В репозитории НЕТ workflows — зелёные check-runs НЕ заявляются |
| Production build | НЕ запускался (dev-only платформа, как в R-35…R-38) |

Все результаты ниже — фактические локальные запуски (команды указаны).

---

## A. Часть A — перепроверка R-38 по исходному коду

Выполнена по коду, не по чекпоинту: `generate-resources.ts`
(`migrateMaterializedBodySummary` / `needsSummaryMigration` /
`summaryContractVersion` / `materializePlanetDeposits`), `game-store.ts`
(`deserializeGameState`: expandSaveV3 → zod → setCurrentLookups →
migrateStaleMaterializedSummaries → countPendingDepositMigrations — порядок
Б1 R-37 сохранён), `save-format-v3.ts` (sv читается/пишется только при
известной версии), `tests/r38-save-migration-materialized.test.ts` (A1–A10,
B1–B10, C1–C5).

**Вывод: код соответствует опубликованному отчёту R-38.** Найденные
уточнения:

1. **Будущая dv (999) — политика внизгрейда, явно.** Сейв с dv >
   DEPOSIT_RNG_VERSION не может быть создан текущим кодом (пишем только 3);
   появиться может лишь при загрузке сейва БУДУЩЕЙ версии игры в текущую
   (downgrade). Текущее поведение (A10): dm=0 → версионная материализация
   при колонизации (replay текущим кодом); dm=1 → свод пересчитан текущим
   контрактом, **dv сохранён как есть** (не подменяется молча). Никаких
   данных не уничтожается; поведение задокументировано. Это осознанная
   политика совместимости вниз, а не «молчаливая безопасность».
2. **Наблюдаемость отказа миграции — дефект, закрытый в R-39.** Прежде
   отказ миграции тела (NaN-данные) был виден ТОЛЬКО в console.warn;
   загрузка возвращала «успех». R-39: `store.loadWarnings` + UI-тост в
   page.tsx (отказы R-38, ожидающие материализации R-37) — тест T14:
   отказ виден в сторе, загрузка продолжает работать, игра жива.
3. **Защита активной игры расширена.** zod-валидация отклоняет битый сейв
   ДО `setCurrentLookups` (порядок R-37 подтверждён); R-39 добавил откат
   lookups в catch loadGame — только если они РЕАЛЬНО переключились
   (успешный deserialize с последующим падением), чистый отказ refs не
   трогает (T12: ref lookups сохранён, buildOnHex продолжает работать).

---

## B. Часть B — этап 1: P0-1 Store→Mediator (главный блокер)

### B.0 Что было на самом деле (аудит до исправлений)

Пункт STATUS «21 прямое действие без sync» частично устарел: helper
`syncMediatorState()` существовал и вызывался (28 мест). Реальные дефекты
были ГЛУБЖЕ и выявлены аудитом R-39:

| # | Дефект | Воспроизведение/симптом |
|---|--------|--------------------------|
| D1 | Слой действий стора (`useGameStore` actions) не покрыт тестами ВООБЩЕ (тесты импортировали только serialize/deserialize) — контракт синхронизации недоказан | STATUS P0-1 «открыт» без доказательств |
| D2 | **Две шины**: GameMediator создавал собственный `TypedEventBus`, а engine-функции (`economy/engine.ts` ×16 мест, `ships/fleet-engine.ts` ×9, `shipyard-queue.ts` ×2) эмитили исходы в глобальный `gameBus`, где в продакшене **ноль подписчиков** — `economy:production-complete`, `fleet:movement-started`, `fleet:arrived`, `ships:construction-progress`, `ships:constructed`, `economy:resource-depleted` и др. терялись | Подписка на mediator.getBus() никогда не видит engine-событий; нарушение modular-bus.md §1.3 «Шина — единственный канал»; для AI этапа 3 это слепые зоны |
| D3 | EconomyModule РЕ-эмитил `building-constructed/upgraded/downgraded/demolished`, `planet-colonized` на шину медиатора (обходная подпорка D2) — после унификации шин это был бы ДУБЛЬ | payload engine и модуля идентичны (конвенция reportIndex сверена: surface → idx, atmosphere → −1−slot, orbit → −100−slot) |
| D4 | `modulesRegistered` (bool) не сбрасывался при `resetGameMediator()` → новый медиатор навсегда без модулей и без подписки core:state-changed | resetGameMediator → любой store-экшен Pattern A молча не работает |
| D5 | `setLoadedState` вызывал `registry.stopAll()` БЕЗ startAll: загрузка сейва в АКТИВНОЙ сессии (isInitialized=true — React-эффект mediator.start() не перезапускается) замораживала модули навсегда — loop тикал, registry.tickAll молча пропускал модули: время шло, экономика/флот/исследования стояли | mid-session loadGame(playing) → tick не даёт core:state-changed |
| D6 | `newGame` поверх активной игры: `stopAll` + живой интервал предыдущей игры (утечка тиков до следующего loop.start) | newGame из playing → интервал тикает впустую |
| D7 | **saveGame race**: блок паузы мутировал phase='paused' + syncMediatorState, комментарий утверждал «loop.pause() takes effect» — но loop.pause() НИКТО не вызывал; интервал продолжал тикать всё время сетевого запроса, а EconomyModule.tick не имел phase-guard → экономика обрабатывалась «в паузе»; на x50 за ~170 мс окна — до ~6 тиков, сериализуемое состояние убегало вперёд от увиденного игроком при клике Save | x50 + fetch 120 мс: core:tick > 0 в окне сохранения |
| D7b | Фаза `colonization` портилась в 'paused' при сохранении → после загрузки баннер «Выберите планету для колонизации» терялся навсегда | save в фазе colonization → phase в сейве 'paused' |
| D8 | Phase-guard был только у ResearchModule: тики интервала мутировали экономику/флот при phase≠playing (окно D7) | см. D7 |
| D9 | `tech:fundamental-leveled` заявлен в манифесте ResearchModule и events.ts, комментарий ссылался на store-экшен — но не эмитился НИКЕМ | подписка никогда не срабатывает |
| D10 | `getBuildingIdAt`-хелперы onDemolish читали состояние ДО produce для ре-эмита — мёртвый код после D3 | — |

### B.1 Таблица аудита всех действий стора (после исправлений R-39)

**Pattern A — через шину (store → событие → модуль → engine → commit →
core:state-changed → store):**

| Действие | Событие | Обработчик | Исход-событие (publisher) | Тест |
|---|---|---|---|---|
| buildOnHex | economy:build | EconomyModule.onBuild | building-constructed (engine) | T1 |
| buildOnAtmosphereSlot | economy:build (layer) | onBuild | building-constructed (engine) | покрытие диспетча T1/T4 (тот же onBuild) |
| buildOnOrbitSlot | economy:build (layer) | onBuild | building-constructed (engine) | T4 |
| upgradeBuildingOnHex | economy:upgrade | onUpgrade | building-upgraded (engine) | T2, T17 |
| downgradeBuildingOnHex | economy:downgrade | onDowngrade | building-downgraded/demolished (engine) | T2 |
| demolishBuildingOnHex | economy:demolish | onDemolish | building-demolished (engine) | T2 (снос через downgrade L1), движок — downgrade-demolish.test |
| downgrade/demolishBuildingOnSlot | economy:downgrade/demolish (layer) | onDowngrade/onDemolish | engine | движковый уровень — downgrade-demolish.test (диспетчер идентичен T2) |
| enqueueProduction | economy:enqueue | onEnqueue | — (production-complete на тике, engine) | T3, T19 |
| specializeBuildingOnHex | economy:specialize | onSpecialize | building-specialized (engine) | processors.test (модуль+engine) |
| upgradeSpecializationOnHex | economy:upgrade-specialization | onUpgradeSpecialization | specialization-upgraded (engine) | processors.test |
| colonizePlanet | economy:colonize | onColonize | planet-colonized (engine) | T1 (хелпер), T9, T17 |
| setSpeed / togglePause | mediator.setSpeed / togglePause | — (loop + state) | core:speed-changed | T7, T10 |
| tick | mediator.tick → loop.step | registry.tickAll | core:tick | T3, T4, T19 |
| newGame | mediator.newGame | — | core:game-created | T9 |
| loadGame | fetch + mediator.setLoadedState | — | core:game-loaded | T7, T8, T12–T14 |
| saveGame | (пауза/восстановление вокруг сериализации) | — | — | T10, T11 |

**Pattern B — прямая мутация immer + syncMediatorState() → commitState →
core:state-changed (тот же ref, ре-рендера нет):**

| Действие | Тест / покрытие механизма |
|---|---|
| cancelProduction | **T3** (тик не воскрешает отменённый элемент — регресс «stale ref» из комментария Pass 1) |
| setColonyRole / setReserveMinimum / setWarehouseSpecialization | **T4** (role + reserves; specialization — тот же механизм) |
| moveToOrbit / moveFromOrbit | **T4** (буфер переживает тик — модуль работал с синкнутым ref) |
| saveShipDesign / deleteShipDesign / enqueueShipBuild / cancelShipyardItem | механизм T1–T4 идентичен (syncMediatorState → commitState); движковые функции — shipyard.test |
| createFleet / mergeFleets / splitFleet / renameFleet / issueFleetOrder / cancelFleetOrder | чистые engine-функции — fleet-engine.test / orders; стор-обёртка — тот же механизм B |
| startResearch / cancelResearch / setAllocation / autoAllocateSlots / addToResearchQueue / removeFromResearchQueue / reorderResearchQueue / clearResearchQueue | движок — research-тесты; механизм B идентичен |
| levelUpFundamental | **T15** (+ tech:fundamental-leveled, закрытие D9) |

**UI-only — задокументированное исключение (gameState не меняется,
синхронизация не требуется):** setView, selectSystem, selectPlanet,
selectFleet, rollGalaxySeed — **T5** (ref gameState и медиатора неизменны,
core:state-changed не эмитится). **Read-only:** getSystem/getPlanet/
getSelected*/getShipDesign/listShipDesigns/getShipyardQueue/getFleet/
getFleetsAtSystem/getShip/getLooseShips/getResearchState. **API-only:**
loadSaveList, deleteSave (gameState не трогают).

### B.2 Исправления R-39 (все — минимальные, один согласованный контракт)

1. **Единая шина** (`game-mediator.ts`): `this.bus = gameBus` — синглтон,
   один инстанс на процесс; `resetGameMediator()` перед пересозданием
   вызывает `bus.clear()` (подписки не протекают). Документация:
   modular-bus.md §9.1.
2. **Дедупликация**: EconomyModule больше НЕ ре-эмитит
   building-constructed/upgraded/downgraded/demolished и planet-colonized
   (engine публикует идентичный payload на той же шине); хелперы
   getBuildingIdAt/isCellEmptyAfter/getCellLevelAfter удалены (D10).
3. **Instance-tracking** (`game-store.ts`): `modulesRegisteredOn:
   GameMediator | null` вместо bool; при смене инстанса — перерегистрация
   модулей + восстановление gameState медиатора из стора
   (`setLoadedState`). Тест T16.
4. **setLoadedState**: без stopAll (модули не владеют состоянием); loop
   приводится в соответствие фазе загруженного сейва (playing+speed>0 →
   startAll+setSpeed+start; иначе loop.pause — интервал прошлой игры не
   переживает загрузку). Тесты T7 (mid-session), T8 (cold playing).
5. **newGame** из активной игры: loop.pause() вместо stopAll (интервал
   прошлой игры остановлен, модули живы). Тест T9.
6. **saveGame**: loop.pause() на время сериализации+сети (race закрыт —
   0 core:tick в окне, T10); фаза playing сериализуется как paused
   (сохранённая семантика «playing-сейв загружается на паузе»); фаза
   colonization НЕ мутируется (честный сейв, баннер переживает загрузку,
   T11); восстановление: phase+speed + loop.setSpeed/start.
7. **Phase-guards** в processEconomyTick/processShipsTick/
   processFleetTicks (экономика/флот не обрабатываются при phase≠playing;
   ResearchModule уже имел). Защита в глубину к D7.
8. **tech:fundamental-leveled** эмитится из levelUpFundamental
   пост-мутации (D9 закрыт). Тест T15.
9. **loadWarnings** (наблюдаемость миграций, D10-наблюдаемость):
   deserializeWarnings-канал → store.loadWarnings → тост в page.tsx.
   Тест T14.
10. **Защита lookups** в loadGame: откат только при реальном переключении
    (успешный deserialize + падение после); чистый отказ refs не трогает.
    Тест T12.

### B.3 P6 — Colony Hub (закрыт)

Стоимость в data-driven каталоге `surface.json`:
`costPerLevel: {Fe:10, Si:5, Al:3}`, levels=3. `upgradeBuilding` списывает
`base × текущий_уровень`. Тест T17 (полный конвейер store → модуль →
engine): L1→L2: Fe 150→140, Si 100→95, Al 80→77; L2→L3: →120/85/71;
потолок L3 → отказ; нехватка (Fe=5 < 10) → отказ; достаточно (Fe=15) →
списание ровно 10. Защита от сноса/понижения хаба — downgrade-demolish.test
(перепроверено). Бесплатного апгрейда больше нет — эксплойт закрыт.

### B.4 P5 — crafted materials (закрыт: только отображение)

- Каталог `src/data/crafted-materials.ts`: steel→«Сталь», microchip→
  «Микрочип», superconductor, sensor_array, hull_element, armor_plate,
  plastic, synfuel, slag и др. — русские имена, категория `crafted`.
- UI-цепочка (planet-view склад): `findResourceDisplay(lookups, id)` →
  `ELEMENT_MAP` → `getCraftedMaterial` → fallback id.replace — steel/
  microchip отображаются русскими именами в своей категории.
- **Доступность крафта от категорий отображения НЕ зависела и не зависит**:
  производство работает по ID ресурсов (`planet.resources[resourceId]`,
  рецепты `inputs/outputs` — ID). Тест T19: make_steel (Fe+C → steel)
  через реальный тик экономики производит steel.
- Тест T18 (полнота реестра): каждый выход каждого из 75 рецептов разрешим
  для отображения (ELEMENT_MAP ∪ CRAFTED_MATERIALS) — ни один crafted-
  ресурс не останется с английским ID-заглушкой.

### B.5 Разделение записей (задание: «разделить подтверждённые блокеры,
неблокирующие дефекты и исторические записи»)

- **Подтверждённые блокеры (были) — закрыты в R-39:** P0-1 = D2/D4/D5
  (единая шина, instance-tracking, заморозка после mid-session load) +
  недоказанность контракта (D1). saveGame race (D7) — блокер корректности
  сейвов.
- **Подтверждённые неблокирующие дефекты — закрыты:** D3 (дубли ре-эмита),
  D6 (утечка интервала), D8 (phase-guards), D9 (fundamental-leveled),
  D10 (мёртвый код), наблюдаемость миграций, порча colonization-фаз в
  сейвах (D7b). P5/P6 — закрыты с тестами.
- **Исторические записи, закрытые ранее (перепроверены, не воспроизводятся):**
  P1/P2/P3/P4/ID-N1/DEP-1/DEAD-1 (STATUS §4). STATUS обновлён — устаревших
  «открытых» строк не осталось (P0-1/P5/P6 → закрыты с датой и ссылкой на
  тесты).

---

## C. Часть C — решения владельца (НЕ принимаются за него)

Баланс, пулы и механики НЕ менялись. Таблицы обновлены под формат задания
(исходная норма / фактическое поведение / риск / минимальный объём /
рекомендация):

### C.1 Технологический гейт «Глубокое бурение» (docs/40-buildings.md §2.4)

| Колонка | Содержание |
|---|---|
| Исходная норма | Буровая установка требует исследования «Глубокое бурение» |
| Фактическое поведение | Гейта нет: drilling_rig доступен с основания колонии; прогрессию глубины даёт порог `BakedOre.minSourceLevel` (Re 8 / Rh,Ta,Pd,Dy 6 / большинство 5 / Y 2 / Ba 1); технологии с таким именем в каталоге нет |
| Риск/влияние | Ранние колонии получают доступ к глубоким рудам (Ba/Y) без исследований; расхождение со спецификацией |
| Минимальный объём реализации | ~0.5 дня: технология в `techs.json` + `requiresTechs` в `surface.json` (механизм гейта УЖЕ реализован: engine.buildOn* проверяет requiresTechs через researched, UI фильтрует) + тесты |
| Рекомендуемый вариант | Реализовать в расширении tech-tree (после этапа 3б — как зафиксировано в STATUS §3.3); альтернатива — убрать пункт из спеки, оставив minSourceLevel единственной прогрессией |

### C.2 Бонусы геологической активности (docs/40-buildings.md §2.4)

| Колонка | Содержание |
|---|---|
| Исходная норма | `production_rate = deep_availability × drill_level × geological_activity_bonus`; бонус по типу планеты: вулканическая ×1.5, скалистая ×1.0, океаническая ×0.8, пустынная ×1.1, ледяная ×0.6 |
| Фактическое поведение | Единая формула: `availability × levelMult(1+L×0.15) × terrainMult(mountains ×1.3 / volcano ×1.2) × mining_cluster`; отдельного множителя геологии нет |
| Риск/влияние | Геймплейная глубина (ценность типов планет для буровых) — не блокер; расхождение со спецификацией |
| Минимальный объём реализации | ~0.5 дня: константа-таблица + множитель в processExtraction (drilling_rig) + UI-отображение + тесты; сейвы — без миграции (вычисляется на лету) |
| Рекомендуемый вариант | Реализовать вместе с C.1 одним малым PR после этапа 3б; альтернатива — зафиксировать terrainMult как реализацию «геологии» и скорректировать §2.4 |

**Без решения владельца этап 2 не объявляется полностью соответствующим
docs/40 §2.4** — это единственные два оставшихся отклонения (STATUS §3.3).

---

## D. Часть D — обязательные проверки (фактические запуски)

| Проверка | Команда | Результат |
|---|---|---|
| Полный набор тестов | `DATABASE_URL=file:/home/z/spacegame/db/custom.db bun test` | **773 pass / 0 fail** (50 файлов; +19 R-39: tests/r39-store-mediator-sync.test.ts) |
| Lint | `bun run lint` | **0 errors / 38 warnings** (базовая линия R-38 сохранена) |
| TypeScript | `bunx tsc --noEmit` | **86 total / 71 src** — Δ0 к базе R-38 (86/71) |
| Валидаторы каталогов | `bun run validate:all` | **4/4** (buildings+synergy / recipes / ships / stars) |
| Детерминизм ×3 процесса | `bun scripts/r39-det-check.ts` (seed 2026, 200 систем, 3 отдельных процесса) | sha256 **eaed801144b8f255…1cd0** — совпал ×3; рантрип gen→deserialize→serialize побайтно идентичен (3 157 800 Б) |
| Save/load старого и текущего сейва | r38-тесты A1–A10 (перезапуск в этом прогоне) + T7/T8/T12–T14 | pass |
| Смена галактики / колонизация / материализация | save-migration-order.test (4) + r38 C1–C5 + T9 | pass |
| Интеграционные Store→Mediator | tests/r39-store-mediator-sync.test.ts T1–T19 | 19/19 |
| Браузер | agent-browser (см. §D.1) | pass, 0 ошибок консоли |
| Незакоммиченные/временные артефакты | `git status` | чисто (только целевые файлы) |

### D.1 Браузерная верификация (agent-browser, http://localhost:3000, dev-сервер)

Сценарий (seed 424242, 200 систем):

1. **Меню → New Galaxy** → галактика создана, фаза colonization.
2. **System view → «Колонизировать»** (Xi Ursae I) → `Phase: playing,
   Speed: x1, Tick: 3 → 11` — loop работает, экономика тикает.
3. **Planet view → гекс → диалог → «Шахта»** — здание построено (гекс
   показывает «Ш») — Pattern A e2e через реальный UI: store → шина →
   EconomyModule → engine → commit → core:state-changed → ре-рендер.
4. **Save** (POST) → БД: 1 сейв, tick 86.
5. **Reload (холодный старт) → Load** → `Phase: paused, Tick: 86`
   (playing-сейв загружается в паузе — семантика сохранена), шахта на
   гексе пережила раундтрип.
6. **x1** → `Phase: playing, Tick: 90` — модули живы после загрузки
   (экономика обрабатывается — главный симптом D5 не воспроизводится).
7. **Save после Load** → PUT на тот же id (не дубль POST), tick консистентен.
8. **Ошибки:** `agent-browser errors` — пусто; консоль — 0 error/failed
   за всю сессию.
9. **Очистка:** сейв удалён, БД 0 записей (как в R-35…R-38).

---

## 1. Вердикт

**P0-1 закрыт доказательно:** единая шина (gameBus === mediator.getBus()),
дедупликация эмишенов, instance-tracking, GameLoop lifecycle (заморозка
mid-session load устранена), saveGame race закрыт, phase-guards,
tech:fundamental-leveled, наблюдаемость миграций — всё покрыто
интеграционными тестами T1–T19 (полный конвейер action → store →
mediator/event → модуль, отсутствие двойной обработки, порядок событий,
изоляция ошибок, save/load после действий). Остаточных исключений из
контракта, кроме задокументированных UI-only действий, нет.

**Этап 2, техническое состояние:** все блокеры этапа 1, способные влиять на
этап 2 (P0-1, P5, P6, saveGame race, GameLoop lifecycle), устранены с
регрессионным покрытием; 773/773, lint 0/38, tsc Δ0, validate 4/4.

**Этап 2 НЕ объявляется принятым самовольно:** (а) два отклонения
docs/40 §2.4 (тех-гейт, гео-бонусы) ожидают решения владельца (§C);
(б) независимая приёмка аудитором по фактическому диффу. По критериям
задания R-39 итог для исполнителя: **выполнено, BLOCKED-условий не
осталось со стороны кода** — финальное решение за владельцем/аудитором.

## 2. Ограничения и остаточные риски (явно)

1. **Порядок engine-событий — до коммита.** События исходов, публикуемые
   engine-функциями, эмитятся внутри produce() модуля (до commitState);
   модульные события (core:state-changed, tech:*) — после. Это
   задокументированный контракт (modular-bus.md §9.1.3): payload
   самодостаточен; подписчикам, читающим state, — core:state-changed или
   момент после действия. Изменение порядка потребовало бы ре-дизайна
   publisher-модели (вынесение эмишенов из engine) — не делалось (объём vs
   ценность; UI на события не подписан).
2. **UI не подписан на события шины** (реактивность через store) —
   проверено аудитом R-39: ни один компонент не вызывает bus.on. События
   engine теперь ДОСТУПНЫ будущим подписчикам (AI этапа 3), но
   потребителей кроме тестов пока нет — это честно отражено в манифестах.
3. **Старые сейвы с dv=999 (будущая версия):** dm=0 → replay при
   колонизации текущим кодом; dm=1 → свод пересчитан текущим контрактом,
   dv сохранён (§A.1) — политика внизгрейда, не «молчаливая безопасность».
4. **Прежние ограничения R-38 §9 сохраняются** (старая физика остаётся
   старой; оценки гарантии миграции из derive-потока; транзит R-37→R-38).
5. **CI нет, production build не запускался** — не заявляется.
6. **Тест T15 мутирует rpBank напрямую** (сетап) — осознанно: проверяется
   событие и синк, а не заработок RP (заработок — research-тесты).
