# Module Contracts — инвентаризация фактической реализации модульной шины

> **ARCH-BUS-MAP-01** (Issue #17), Этап A. База: main `9c84bb9`.
> **Ревизия follow-up 2026-10-28:** схема синхронизирована с генератором и JSON
> по находкам независимого аудита (комментарий 6471533872): F1 — query-регистрации
> production отдельно от test-only; F2 — атрибуция emits «владение файлом
> объявления» + топ-уровневый `fileLevelEmits`; F3 — `registrationStatus`
> (только ось регистрации), убраны обещания несуществующих полей (observed
> dependencies) и статусов зрелости partial/stub из схемы карты.
> **Статус:** инвентаризация фактической реализации. НЕ заменяет канонические
> архитектурные контракты (`docs/architecture/modular-bus.md`, `src/core/events.ts`).
> Машинно-читаемая карта: `docs/architecture/module-bus-map.json` — генерируется
> из исходников (`bun run audit:module-bus`), дрейф проверяется
> `bun run audit:module-bus --check`. Этот документ фиксирует схему карты,
> классификацию статусов и инвентаризацию с точными ссылками на исходники.
> Runtime-код задачей не менялся.

## 0. Роли источников истины

| Источник | Роль |
|---|---|
| `src/core/events.ts` | Канонический каталог ТИПОВ событий (`EventMap`, `EventName`). Единственное место определения payload-типов. |
| `ModuleManifest` каждого модуля (`src/*/…-module.ts`) | ДЕКЛАРАЦИЯ НАМЕРЕНИЙ: dependencies, emits, subscribes, handlesQueries, requiresQueries. Декларация ≠ факт (см. §3). |
| Фактические вызовы `emit/on/registerQuery/query` в `src/` | ФАКТИЧЕСКИЙ runtime. Только они доказывают проводку. |
| `docs/architecture/module-bus-map.json` | Сгенерированная инвентаризация фактов (этап B). Обновляется генератором, руками не редактируется. |
| Этот документ | Схема карты, классификация, human-readable инвентаризация и findings. |

**Главный принцип (по ТЗ):** заявленный контракт (манифест) и фактическое
runtime-использование — разные сущности. Событие без подписчиков — не «ошибка»
автоматически: часть каталога `events.ts` — осознанный резерв «вперёд» под
этапы 3б/4 (зафиксировано в комментарии R-42 в `src/core/events.ts:14-22` и
чекпоинте R-42).

## 1. Схема полей карты (`module-bus-map.json`)

### 1.1. Модуль (`modules.<id>`)

| Поле | Определение |
|---|---|
| `className`, `file` | Класс, реализующий `IGameModule`, и файл его объявления. |
| `name`/`version`/`description` | Человекочитаемые поля манифеста (как объявлено). |
| `manifest.dependencies` | ДЕКЛАРИРОВАННЫЕ зависимости (ModuleId[]). Карта не вычисляет «observed dependencies»: `wiring.initOrder` строится ИЗ этих деклараций алгоритмом, реплицирующим `ModuleRegistry.recalculateInitOrder` (вычисление над декларациями, не наблюдаемый факт). |
| `manifest.emits` / `observed.emits` | Объявленные / фактически найденные emit-вызовы — ТОЛЬКО в файле объявления класса модуля (file:line каждого). Emissions из engine/инфраструктурных файлов модулю НЕ приписываются — они в топ-уровневом `fileLevelEmits` (F2). |
| `manifest.subscribes` / `observed.subscriptions` | Объявленные подписки (с priority) / фактические `bus.on/once` в файле модуля (file:line). |
| `manifest.handlesQueries` / `observed.queriesRegistered` | Объявленные / фактически зарегистрированные в файле модуля обработчики запросов (file:line). |
| `manifest.requiresQueries` / `observed.queriesCalled` | Объявленные / фактически вызываемые из файла модуля запросы (file:line). |
| `registration` | Точка(и) создания и регистрации (file:line, порядок в `registerAndInit`). |
| `tick` | Участие в тиках — ТОЛЬКО `positionInInitOrder` (позиция в `initOrder`, вычисленном из декларированных зависимостей). Наличие `tick()`-тела, bus-подписка `core:tick` (видна отдельно в `observed.subscriptions`) и факт реальной работы тика картой НЕ утверждаются (F-01). |
| `registrationStatus` | ТОЛЬКО ось регистрации (что статанализ доказал): `active` (зарегистрирован в production-wiring) / `unregistered` (класс есть, регистрации нет) / `reserved` (id в `ModuleId`, класса нет). Зрелость реализации (`partial`/`stub`) машинно НЕ выводится и полем карты не является (§2.3, F3). |

Топ-уровневая секция `fileLevelEmits` (не поле модуля): ВСЕ production emit-факты
из файлов, не являющихся файлом объявления ни одного модуля (engine:
`src/economy/engine.ts`, `src/ships/fleet-engine.ts`, `src/data/ships/shipyard-queue.ts`; store:
`src/stores/game-store.ts`; ядро: `game-mediator.ts`, `game-loop.ts`). Каждый факт — file:line,
опубликован ровно один раз, БЕЗ утверждения владения модулем (F-06; регресс-тест F2 —
два модуля одной директории). Event-level ссылки сохраняются в `events.*.productionEmitters`.

### 1.2. Событие (`events.<name>`)

| Поле | Определение |
|---|---|
| `declared` | Объявление в каноническом каталоге: `src/core/events.ts:line`, payload-тип. |
| `manifestEmittedBy` | Модули, объявившие событие в `manifest.emits` (file:line декларации). |
| `manifestSubscribedBy` | Модули, объявившие в `manifest.subscribes` (с priority, file:line). |
| `productionEmitters` | Фактические emit-вызовы в `src/`: file:line, издатель (класс/метод), форма вызова. |
| `productionConsumers` | Фактические `bus.on/once` в `src/`: file:line, подписчик, priority. |
| `testEmitters` / `testConsumers` | Агрегированно по файлам `tests/` и `scripts/` (test/debug-only использование НЕ считается production-проводкой). |
| `status` | Один из 7 статусов (§2.1). |

### 1.3. Запрос (`queries.<name>`)

| Поле | Определение |
|---|---|
| `declaredHandles` | Модули, объявившие запрос в `handlesQueries` (file:line). |
| `declaredRequires` | Модули, объявившие в `requiresQueries` (file:line). |
| `registeredBy` | Фактические `registerQuery` ТОЛЬКО в production `src/` (file:line). Тестовые регистрации НЕ включаются и не влияют на `status` (F1). |
| `unregisteredBy` | Фактические `unregisterQuery` ТОЛЬКО в `src/` (file:line). |
| `testRegisteredBy` / `testUnregisteredBy` | Test-only регистрации/снятия из `tests/` и `scripts/`, агрегированные по файлам (`{file, lines[]}`). Публикуются отдельно; на production-статус НЕ влияют (регресс-тест F1). |
| `productionCallers` / `testCallers` | Фактические вызовы `query(name)` в `src/` / в `tests/` (file:line). |
| `status` | §2.2 — вычисляется ТОЛЬКО по production-фактам. |

## 2. Классификация статусов

### 2.1. Статусы событий (выбирается ровно один, правила приоритета 1→7)

| # | Статус | Правило (по фактам, не по интерпретациям) |
|---|---|---|
| 1 | `dynamic_or_unresolved` | Имя события в фактическом вызове не является строковым литералом (переменная, динамическая конструкция), которую анализатор не смог разрешить к catalog-имени. |
| 2 | `manifest_vs_runtime_mismatch` | Модуль M выполняет роль в runtime, противоречащую его манифесту для этого события: (b) фактическая подписка M без декларации в `manifest.subscribes`, либо (a) декларация `subscribes` без фактической подписки M. |
| 3 | `consumer_without_observed_publisher` | Есть production-потребители, нет production-издателей. |
| 4 | `observed_but_not_declared` | Есть production-проводка (emit или подписка), но событие не заявлено НИ в одном манифесте ни в какой роли. |
| 5 | `published_without_observed_consumer` | Есть production-издатели; production-потребителей ноль (test-only потребители не считаются, но фиксируются в `testConsumers`). |
| 6 | `declared_but_not_observed_published` | Событие в каталоге `events.ts`, но production-издателей нет. Может быть future/reserved — само по себе НЕ баг (см. §2.4). |
| 7 | `declared_and_published` | Есть production-издатели и событие заявлено ≥1 манифестом в согласованной роли. |

Замечания:
- Emit-вызовы engine-функций (`src/economy/engine.ts`, `src/ships/fleet-engine.ts`, `src/data/ships/shipyard-queue.ts`) через импортированный синглтон `gameBus` — факты публикуются как есть (file:line двигателя) в event-level `productionEmitters` и в топ-уровневом `fileLevelEmits`. Атрибуция «это события СИСТЕМЫ economy» — интерпретация манифеста (комментарий `src/economy/economy-module.ts:54-58`); владение модулю НЕ приписывается: `modules.*.observed.emits` содержит только факты файла объявления класса (F2).
- `core:*` lifecycle-события публикует ядро-инфраструктура (GameLoop/GameMediator), которая НЕ является зарегистрированным модулем реестра — для них честен статус 4 (`observed_but_not_declared`), кроме `core:tick`/`core:game-created`/`core:game-loaded`/`core:state-changed`, заявленных манифестами модулей (в подписочной роли).
- Статус 2 покрывает только подписочную сторону и несогласованность подписок; emit-сторона «декларировано, но не эмитится» — это статус 6 (резерв/намерение), не mismatch.

### 2.2. Статусы запросов

Статус вычисляется ТОЛЬКО по production-фактам `src/` — тестовые регистрации/снятия
(`testRegisteredBy`/`testUnregisteredBy`) и вызовы (`testCallers`) НЕ классифицируют
запрос как зарегистрированный в production (F1; регресс-фикстура `fx-f1-*`).

`declared_and_registered` (есть декларация handlesQueries и фактическая production-регистрация) ·
`registered_not_declared` · `declared_not_registered` · `unregistered_call` (production-вызов незарегистрированного) ·
`unused` (нет ни production-регистрации, ни декларации, ни production-вызовов; test-only
активность при этом видна в `test*`-полях, статус не меняет). Число production-вызовов —
отдельное поле (сейчас 0 у всех — см. F-05).

### 2.3. Статусы модулей (`registrationStatus` — только ось регистрации)

Карта доказывает ТОЛЬКО факт регистрации; зрелость реализации машинно не выводится
(оси не смешиваются — F3):

- `active` — зарегистрирован в production-wiring (найден `registerAndInit`/`registerModule` в `src/`); позиция в init/tick-порядке — в `tick.positionInInitOrder`.
- `unregistered` — класс модуля существует в `src/`, но не регистрируется ни одной точкой wiring.
- `reserved` — идентификатор объявлен в union `ModuleId`, класс не найден.

Зрелость реализации (`active`/`partial`/`stub` как human-оценка полноты контракта) —
ПРЕДМЕТ ИНТЕРПРЕТАЦИИ вне схемы карты: см. §3.6 (AIModule: `registrationStatus: active`,
зрелость «partial — инертный по дизайну этапа 3а/3б.1» — человеческая оценка с
доказательствами в таблице §3.6, а не поле JSON). Тест схемы
(`tests/arch/module-bus-map-schema.test.ts`) гарантирует, что у модулей нет полей
`status`/`implementationStatus`, а enum ограничен тремя значениями выше.

### 2.4. Правило интерпретации резерва

Событие статуса 6 (`declared_but_not_observed_published`) — **не считается ошибкой автоматически**. Основания резерва: комментарий R-42 в `src/core/events.ts:14-22` (каталог «вперёд» под этапы 3/4: diplomacy:*, trade:*, ai:*, combat:*, часть economy:/ships:/fleet:/tech:) и комментарии манифестов (например, `src/ai/ai-module.ts:80-82`). Решение «чистить или реализовывать» — за владельцем (findings, §7).

## 3. Инвентаризация модулей (факты с file:line)

Wiring-точка production — единственная: `getMediatorWithModules()`
(`src/stores/game-store.ts:298-369`): создание модулей (:302-318), accessor/mutator
(:323-336; у AI сознательно нет mutator, :334-336), `mediator.registerAndInit([galaxy,
economy, research, ships, fleet, ai])` (:338-345), подписка стора на
`core:state-changed` (:350-352). React-mount: `src/app/page.tsx:77-80` →
`mediator.start()` / `mediator.stop()`.

Порядок регистрации (вставки в реестр): `[galaxy, economy, research, ships, fleet, ai]`.
Порядок init/tick (`recalculateInitOrder`, DFS по deps — `src/core/module-registry.ts:217-248`):
**`[galaxy, economy, tech, ships, fleet, ai]`** — этот же порядок использует
`registry.tickAll()` (`src/core/module-registry.ts:133-143`, затем `bus.flush()` :142).

### 3.1. GalaxyModule — `galaxy` — `registrationStatus: active`

| Аспект | Манифест (декларация) | Факт (runtime) | Согласовано |
|---|---|---|---|
| Файл/манифест | `src/galaxy/galaxy-module.ts:19-39` | — | — |
| dependencies | `[]` (:23) | ни от кого не зависит | ✅ |
| emits | `galaxy:generated`, `galaxy:system-discovered`, `galaxy:system-surveyed` (:24-28) | эмитится только `galaxy:generated` (:121, из `onGameCreated`) | ⚠️ 2 из 3 — резерв (F-09) |
| subscribes | `core:tick` (SIMULATION), `core:game-created` (:29-32) | фактические: `core:tick`→`onTick` (:72, **no-op** — «Галактика статична», :116-118), `core:game-created`→`onGameCreated` (:73) | ✅ (F-01 о no-op) |
| handlesQueries | `galaxy:system-by-id`, `galaxy:planet-by-id`, `galaxy:colonized-planets` (:33-37) | зарегистрированы :76-78, снятие :99-101 | ✅ |
| requiresQueries | `[]` (:38) | query-вызовов нет | ✅ |
| tick() | — | пустой (:86-88) — галактика статична | ✅ |

### 3.2. EconomyModule — `economy` — `registrationStatus: active`

| Аспект | Манифест | Факт | Согласовано |
|---|---|---|---|
| Файл/манифест | `src/economy/economy-module.ts:46-93` | — | — |
| dependencies | `['galaxy']` (:51) | — | ✅ |
| emits | 13 × `economy:*` + `core:state-changed` (:52-73) | фактические emit-вызовы модуля — НЕТ; события исходов эмитит engine через `gameBus` (см. §5); `core:state-changed` эмитит GameMediator.commitState по вызову из модуля (F-06) | ⚠️ атрибуция, F-06 |
| subscribes | `core:tick`, `economy:build`, `economy:upgrade`, `economy:enqueue`, `economy:colonize`, `economy:specialize`, `economy:upgrade-specialization` (:74-84) | фактические: те же (:136-147) **ПЛЮС `economy:downgrade` (:140) и `economy:demolish` (:141) — НЕ заявлены** → F-02 | ❌ F-02 |
| handlesQueries | `economy:planet-resources`, `economy:planet-energy`, `economy:production-queue` (:85-89) | зарегистрированы :150-152, снятие :174-176 | ✅ |
| requiresQueries | `galaxy:system-by-id` (:90-92) | query-вызовов в src НЕТ (F-05) | ⚠️ F-05 |
| tick() | — | `processEconomyTick()` (:160-162) — реальная работа | ✅ |

### 3.3. ResearchModule — `tech` — `registrationStatus: active`

| Аспект | Манифест | Факт | Согласовано |
|---|---|---|---|
| Файл/манифест | `src/research/research-module.ts:46-70` | — | — |
| dependencies | `['economy']` (:51) | — | ✅ |
| emits | `tech:research-completed`, `tech:unlocked`, `tech:fundamental-leveled`, `tech:tree-validated`, `tech:queue-advanced`, `tech:queue-added`, `tech:queue-removed`, `core:state-changed` (:52-61) | фактические emit-вызовы модуля: `tech:tree-validated` (:103), `tech:queue-advanced` (:240), `tech:research-completed` (:255), `tech:unlocked` (:262) — 4 из 8; `tech:fundamental-leveled` эмитит store (`src/stores/game-store.ts:1892`), `core:state-changed` — медиатор (F-06); `tech:queue-added`/`queue-removed` не эмитятся никем (F-09) | ⚠️ F-09 |
| subscribes | `core:tick` (SIMULATION+5) (:62-64) | фактическая :109-112 → `onTick` no-op (:155-157, «tick() called via ModuleRegistry.tickAll()») | ✅ (F-01) |
| handlesQueries | `research:state`, `research:tech-status` (:65-68) | зарегистрированы :116-117, снятие :140-141 | ✅ |
| requiresQueries | `[]` (:69) | — | ✅ |
| tick() | — | `processResearchTick(time)` (:127-129) — реальная работа | ✅ |

### 3.4. ShipsModule — `ships` — `registrationStatus: active`

| Аспект | Манифест | Факт | Согласовано |
|---|---|---|---|
| Файл/манифест | `src/ships/ships-module.ts:41-60` | — | — |
| dependencies | `['economy']` (:46) | — | ✅ |
| emits | `ships:constructed`, `ships:construction-progress`, `ships:construction-started`, `ships:arrived`, `ships:fuel-consumed`, `core:state-changed` (:47-54) | emit-вызовы модуля — НЕТ; фактически эмитят engine: shipyard-queue (`constructed` :234, `construction-progress` :175) и fleet-engine (`arrived` :391, `fuel-consumed` :417); `ships:construction-started` не эмитится никем (F-09) | ⚠️ F-06/F-09 |
| subscribes | `core:tick` (SIMULATION+10) (:55-57) | фактическая :88-91 → `onTick` no-op (:126-129) | ✅ (F-01) |
| handlesQueries / requiresQueries | `[]` / `[]` (:58-59) | — | ✅ |
| tick() | — | обрабатывает shipyard-очереди через `processShipyardTick` (:100-124) | ✅ |

### 3.5. FleetModule — `fleet` — `registrationStatus: active`

| Аспект | Манифест | Факт | Согласовано |
|---|---|---|---|
| Файл/манифест | `src/ships/fleet-module.ts:25-45` | — | — |
| dependencies | `['ships','galaxy']` (:30) | — | ✅ |
| emits | `fleet:arrived`, `fleet:stranded`, `fleet:order-completed`, `fleet:movement-started`, `fleet:fuel-low`, `fleet:order-cancelled`, `core:state-changed` (:31-39) | emit-вызовы модуля — НЕТ; фактически эмитит fleet-engine (`order-completed` :296,:509; `movement-started` :317; `fuel-low` :346; `stranded` :351; `arrived` :389); `fleet:order-cancelled` не эмитится никем (F-09) | ⚠️ F-06/F-09 |
| subscribes | `core:tick` (SIMULATION+20) (:40-42) | фактическая :70-73 → `onTick` no-op (:108-111) | ✅ (F-01) |
| handlesQueries / requiresQueries | `[]` / `[]` (:43-44) | — | ✅ |
| tick() | — | итерирует флоты, `processFleetTick` (:82-106) | ✅ |

### 3.6. AIModule — `ai` — `registrationStatus: active`; зрелость реализации (вне карты, human-оценка): partial — этап 3а/3б.1, инертный по дизайну

| Аспект | Манифест | Факт | Согласовано |
|---|---|---|---|
| Файл/манифест | `src/ai/ai-module.ts:70-99` | — | — |
| dependencies | `['economy']` (:79) | — | ✅ |
| emits | `[]` — «ai:* остаются зарезервированными» (:80-82) | emit-вызовов нет | ✅ (резерв задокументирован) |
| subscribes | `core:game-created`, `core:game-loaded` (NOTIFICATION) (:83-89) | фактические :139-148 → `resetDerivedState()` (сброс вычисляемого кэша) | ✅ |
| handlesQueries | `ai:state` (:90-97) | зарегистрирован :151, снятие :167 | ✅ |
| requiresQueries | `[]` (:98) | — | ✅ |
| tick() | — | :211+ — пересборка world model (лёгкие агрегаты), без мутаций GameState; НЕТ подписки `core:tick` в манифесте, но `registry.tickAll` вызывает `tick()` каждого started-модуля | ✅ (нюанс F-01) |

### 3.7. Ядро-инфраструктура (не модули реестра)

| Компонент | Роль | Факты |
|---|---|---|
| `TypedEventBus` / `gameBus` | Шина. Синглтон: `src/core/typed-event-bus.ts:268`. R-39 «единая шина»: `mediator.bus === gameBus` (`src/core/game-mediator.ts:38-53`). | `flush()` редиспатчит отложенные события через переменную (`typed-event-bus.ts:200`) — динамическая форма; production `defer()` не вызывает никто. |
| `GameMediator` | Оркестратор: newGame/load/speed/регистрация. | emit: `core:game-created` :153, `core:game-loaded` :196, `core:state-changed` :208/:227; подписка `core:tick` priority −1 (синхронизация времени) :78-97; replay для `core:tick`/`core:game-created` :58-59. |
| `GameLoop` | Тики: интервал → `processTick()` :190-205. | emit: `core:tick` :196, `core:year` :203, `core:speed-changed` :97, `core:paused` :119, `core:started`/`core:resumed` :112 (тернарник — динамическая форма с двумя литералами). |
| `ModuleRegistry` | Реестр: регистрация, топосортировка, тики, query-реестр. | `tickAll` :133-143; query API :148-171 (строковые имена, без типизированной карты — см. §8). |

## 4. Итоги по статусам (86 событий каталога)

| Статус | Кол-во | События |
|---|---|---|
| `declared_and_published` | 10 | `core:tick`, `core:game-created`, `core:game-loaded`, `core:state-changed`, `economy:build`, `economy:upgrade`, `economy:enqueue`, `economy:colonize`, `economy:specialize`, `economy:upgrade-specialization` |
| `manifest_vs_runtime_mismatch` | 2 | `economy:downgrade`, `economy:demolish` (F-02) |
| `observed_but_not_declared` | 7 | `core:year`, `core:started`, `core:paused`, `core:resumed`, `core:speed-changed`, `economy:production-cancelled` (F-03), `combat:engaged` |
| `published_without_observed_consumer` | 24 | `galaxy:generated`; `economy:building-constructed/-upgraded/-downgraded/-demolished`, `economy:production-complete`, `economy:planet-colonized`, `economy:building-specialized`, `economy:specialization-upgraded`, `economy:processor-output-changed` (9); `ships:constructed`, `ships:construction-progress`, `ships:arrived`, `ships:fuel-consumed` (4); `fleet:movement-started`, `fleet:order-completed`, `fleet:arrived`, `fleet:fuel-low`, `fleet:stranded` (5); `tech:research-completed`, `tech:unlocked`, `tech:tree-validated`, `tech:queue-advanced`, `tech:fundamental-leveled` (5) |
| `declared_but_not_observed_published` | 43 | полный список в §5 и карте; исторически задокументированный резерв этапов 3б/4 (§2.4) |
| `consumer_without_observed_publisher` | 0 | — |
| `dynamic_or_unresolved` | 0 | на уровне событий; динамические формы механизмов — §8 |

Сверка: 10+2+7+24+43 = **86** = |EventMap|. Историческая оценка в комментарии
`src/core/events.ts:16` («эмитятся ~42 из объявленных») уточняется фактом:
эмитятся **43 из 86**, у 24 из них нет production-потребителей (F-08).

## 5. Полная таблица событий (evidence — краткая; поимённо с file:line — в `module-bus-map.json`)

Обозначения: Изд = production-издатель (file:line); Потр = production-потребитель (file:line); М = модуль(и) в манифестах (e=emits, s=subscribes).

### Core (9)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `core:tick` | :30 | galaxy:s, economy:s, tech:s, ships:s, fleet:s | game-loop:196 | game-mediator:78 (+5 no-op подписчиков модулей, F-01) | declared_and_published |
| `core:year` | :31 | — | game-loop:203 | — | observed_but_not_declared |
| `core:started` | :32 | — | game-loop:112 | — | observed_but_not_declared |
| `core:paused` | :33 | — | game-loop:119 | — | observed_but_not_declared |
| `core:resumed` | :34 | — | game-loop:112 | — | observed_but_not_declared |
| `core:speed-changed` | :35 | — | game-loop:97 | — | observed_but_not_declared |
| `core:game-created` | :36 | galaxy:s, ai:s | game-mediator:153 | galaxy-module:73, ai-module:140 | declared_and_published |
| `core:game-loaded` | :37 | ai:s | game-mediator:196 | ai-module:145 | declared_and_published |
| `core:state-changed` | :44 | economy:e, tech:e, ships:e, fleet:e | game-mediator:208,:227 | game-store:350 | declared_and_published (F-06) |

### Galaxy (3)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `galaxy:generated` | :50 | galaxy:e | galaxy-module:121 | — | published_without_observed_consumer |
| `galaxy:system-discovered` | :51 | galaxy:e | — | — | declared_but_not_observed_published |
| `galaxy:system-surveyed` | :52 | galaxy:e | — | — | declared_but_not_observed_published |

### Economy (23)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `economy:build` | :71 | economy:s | game-store:830,:946,:970 | economy-module:137 | declared_and_published |
| `economy:building-constructed` | :72 | economy:e | engine:1186,:1244,:1296 | — | published_without_observed_consumer |
| `economy:upgrade` | :73 | economy:s | game-store:847 | economy-module:138 | declared_and_published |
| `economy:building-upgraded` | :74 | economy:e | engine:1342 | — | published_without_observed_consumer |
| `economy:downgrade` | :81 | — (НЕ в манифесте) | game-store:867,:906 | economy-module:140 | **manifest_vs_runtime_mismatch** (F-02) |
| `economy:building-downgraded` | :83 | economy:e | engine:1448 | — | published_without_observed_consumer |
| `economy:demolish` | :88 | — (НЕ в манифесте) | game-store:888,:927 | economy-module:141 | **manifest_vs_runtime_mismatch** (F-02) |
| `economy:building-demolished` | :90 | economy:e | engine:1495 | — | published_without_observed_consumer |
| `economy:enqueue` | :91 | economy:s | game-store:991 | economy-module:142 | declared_and_published |
| `economy:production-complete` | :92 | economy:e | engine:679 | — | published_without_observed_consumer |
| `economy:production-cancelled` | :93 | — | engine:592,:682,:1803 | — | observed_but_not_declared (F-03) |
| `economy:colonize` | :94 | economy:s | game-store:1079 | economy-module:143 | declared_and_published |
| `economy:planet-colonized` | :95 | economy:e | engine:1877 | — | published_without_observed_consumer |
| `economy:energy-recalced` | :96 | economy:e | — | — | declared_but_not_observed_published |
| `economy:resource-depleted` | :97 | economy:e | — | — | declared_but_not_observed_published |
| `economy:warehouse-full` | :98 | economy:e | — | — | declared_but_not_observed_published |
| `economy:warehouse-updated` | :99 | economy:e | — | — | declared_but_not_observed_published |
| `economy:specialize` | :102 | economy:s | game-store:1036 | economy-module:145 | declared_and_published |
| `economy:upgrade-specialization` | :108 | economy:s | game-store:1061 | economy-module:146 | declared_and_published |
| `economy:building-specialized` | :111 | economy:e | engine:1638,:1695 | — | published_without_observed_consumer |
| `economy:specialization-upgraded` | :118 | economy:e | engine:1761 | — | published_without_observed_consumer |
| `economy:processor-output-changed` | :128 | economy:e | engine:1646,:1703,:1767 | — | published_without_observed_consumer |
| `economy:active-recipes-changed` | :135 | economy:e | — | — | declared_but_not_observed_published |

### Ships (11)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `ships:designed` | :145 | — | — | — | declared_but_not_observed_published |
| `ships:constructed` | :146 | ships:e | shipyard-queue:234 | — | published_without_observed_consumer |
| `ships:destroyed` | :147 | — | — | — | declared_but_not_observed_published |
| `ships:movement-started` | :148 | — | — | — | declared_but_not_observed_published |
| `ships:arrived` | :149 | ships:e | fleet-engine:391 | — | published_without_observed_consumer |
| `ships:damaged` | :150 | — | — | — | declared_but_not_observed_published |
| `ships:repaired` | :151 | — | — | — | declared_but_not_observed_published |
| `ships:design-validated` | :154 | — | — | — | declared_but_not_observed_published |
| `ships:construction-started` | :156 | ships:e | — | — | declared_but_not_observed_published (F-09) |
| `ships:construction-progress` | :158 | ships:e | shipyard-queue:175 | — | published_without_observed_consumer |
| `ships:fuel-consumed` | :160 | ships:e | fleet-engine:417 | — | published_without_observed_consumer |

### Fleet (10)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `fleet:created` | :166 | — | — | — | declared_but_not_observed_published |
| `fleet:order-issued` | :167 | — | — | — | declared_but_not_observed_published |
| `fleet:order-completed` | :168 | fleet:e | fleet-engine:296,:509 | — | published_without_observed_consumer |
| `fleet:merged` | :169 | — | — | — | declared_but_not_observed_published |
| `fleet:split` | :170 | — | — | — | declared_but_not_observed_published |
| `fleet:movement-started` | :173 | fleet:e | fleet-engine:317 | — | published_without_observed_consumer |
| `fleet:arrived` | :175 | fleet:e | fleet-engine:389 | — | published_without_observed_consumer |
| `fleet:order-cancelled` | :177 | fleet:e | — | — | declared_but_not_observed_published (F-09) |
| `fleet:fuel-low` | :179 | fleet:e | fleet-engine:346 | — | published_without_observed_consumer |
| `fleet:stranded` | :181 | fleet:e | fleet-engine:351 | — (tests: fleet-engine.test:406) | published_without_observed_consumer |

### Combat (4) — модуля combat нет (id зарезервирован)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `combat:engaged` | :187 | — | fleet-engine:495 (stub-ветка attack) | — | observed_but_not_declared (F-04) |
| `combat:round` | :188 | — | — | — | declared_but_not_observed_published |
| `combat:resolved` | :189 | — | — | — | declared_but_not_observed_published |
| `combat:planet-bombarded` | :190 | — | — | — | declared_but_not_observed_published |

### Tech (12)
| Событие | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `tech:research-started` | :211 | — | — | — | declared_but_not_observed_published |
| `tech:research-completed` | :213 | tech:e | research-module:255 | — | published_without_observed_consumer |
| `tech:unlocked` | :215 | tech:e | research-module:262 | — | published_without_observed_consumer |
| `tech:research-cancelled` | :218 | — | — | — | declared_but_not_observed_published |
| `tech:allocation-changed` | :220 | — | — | — | declared_but_not_observed_published |
| `tech:fundamental-leveled` | :222 | tech:e | game-store:1892 | — | published_without_observed_consumer (F-07) |
| `tech:prerequisites-met` | :224 | — | — | — | declared_but_not_observed_published |
| `tech:tree-validated` | :226 | tech:e | research-module:103 | — | published_without_observed_consumer |
| `tech:research-rejected` | :228 | — | — | — | declared_but_not_observed_published |
| `tech:queue-advanced` | :233 | tech:e | research-module:240 | — | published_without_observed_consumer |
| `tech:queue-added` | :235 | tech:e | — | — | declared_but_not_observed_published (F-09) |
| `tech:queue-removed` | :237 | tech:e | — | — | declared_but_not_observed_published (F-09) |

### Diplomacy (6), Trade (5), AI (3) — модулей diplomacy/trade нет; ai события зарезервированы манифестом AI (emits: [])
| События | events.ts | М | Изд | Потр | Статус |
|---|---|---|---|---|---|
| `diplomacy:proposal` … `diplomacy:peace-signed` | :243-248 | — | — | — | declared_but_not_observed_published |
| `trade:offer-created` … `trade:route-raided` | :254-258 | — | — | — | declared_but_not_observed_published |
| `ai:decision`, `ai:colony-founded`, `ai:fleet-sent` | :264-266 | — (ai: emits[]) | — | — | declared_but_not_observed_published (резерв 3б/4) |

## 6. Запросы (реестр `ModuleRegistry.queryHandlers` — строковые имена)

| Запрос | Декларация (handles) | Требование (requires) | Регистрация | Снятие | Production-вызовы | Test-вызовы | Статус |
|---|---|---|---|---|---|---|---|
| `galaxy:system-by-id` | galaxy :33 | economy :90 | galaxy-module:76 | :99 | **0** | r42-stage01-reaudit.test:679-685 | declared_and_registered |
| `galaxy:planet-by-id` | galaxy :34 | — | :77 | :100 | 0 | — | declared_and_registered (unused) |
| `galaxy:colonized-planets` | galaxy :35 | — | :78 | :101 | 0 | — | declared_and_registered (unused) |
| `economy:planet-resources` | economy :85 | — | economy-module:150 | :174 | 0 | — | declared_and_registered (unused) |
| `economy:planet-energy` | economy :86 | — | :151 | :175 | 0 | — | declared_and_registered (unused) |
| `economy:production-queue` | economy :87 | — | :152 | :176 | 0 | — | declared_and_registered (unused) |
| `research:state` | tech :65 | — | research-module:116 | :140 | 0 | — | declared_and_registered (unused) |
| `research:tech-status` | tech :66 | — | :117 | :141 | 0 | — | declared_and_registered (unused) |
| `ai:state` | ai :90-97 | — | ai-module:151 | :167 | 0 | ai-module.test:322,:333 | declared_and_registered |

Сводка: **9 production-регистраций, 0 production-вызовов**. Единственное `requiresQueries`
(economy → `galaxy:system-by-id`) не exercised ни разу (F-05). Обращения UI/стора
к данным идут напрямую через accessor'ы (e.g. `useGameStore` → `getMediatorWithModules().get*()`),
минуя query API — см. F-05.

Test-only регистрации/снятия публикуются отдельно (`testRegisteredBy`/`testUnregisteredBy`)
и на статусы не влияют (F1): `galaxy:system-by-id` — регистрации `tests/r42-stage01-reaudit.test.ts:678,681`,
снятие `:684`; статус запроса при этом определён production-фактом (`galaxy-module:76`) —
`declared_and_registered`.

## 7. Findings (спорные случаи; поведение не меняется — только фиксация)

Формат: **F-XX · severity · категория · уверенность** (доказано анализатором / подозревается).

- **F-01 · info · архитектура · доказано.** Двойной канал тиков. Реальное
  распределение тиков — `registry.tickAll()` → `module.tick()` (module-registry:133-143);
  bus-подписки модулей на `core:tick` (`galaxy-module:72`, `economy-module:136`,
  `research-module:109`, `ships-module:88`, `fleet-module:70`) — **no-op** (тела
  onTick: «Not used — tick() called via ModuleRegistry.tickAll()»). Рабочий
  потребитель `core:tick` — GameMediator (синхронизация времени, game-mediator:78,
  priority −1). Манифесты декларируют `core:tick` в subscribes — декларация
  соответствует no-op подпискам, но не механизму тиков. Последствие: читатель
  манифеста может ошибочно считать шину каналом тиков. Шаг: решение владельца —
  убрать no-op подписки или задокументировать как контракт «tick() — основной канал».
- **F-02 · medium · manifest_vs_runtime · доказано.** `EconomyModule` фактически
  подписан на `economy:downgrade` (:140) и `economy:demolish` (:141), но в
  `manifest.subscribes` (:74-84) их нет. Рабочий путь (store → module) существует:
  game-store:847,:886 (downgrade), :868,:907 (demolish). Шаг: дополнить манифест
  (runtime-правка — вне этого issue).
- **F-03 · medium · observed_but_not_declared · доказано.** `economy:production-cancelled`
  эмитится engine (`engine.ts:592,:682,:1803`), но не заявлен ни в одном
  манифесте (economy emits :52-73 его не содержит). Событие не имеет потребителей
  ни в src, ни в tests. Шаг: декларировать в манифесте или зафиксировать резерв.
- **F-04 · low · observed_but_not_declared · доказано.** `combat:engaged` эмитится
  stub-веткой attack в `fleet-engine.ts:495` (боевая система этапа 4 не реализована);
  модуля `combat` нет, событие никем не потребляется. Шаг: оставить как маркер
  этапа 4 или убрать stub-emit.
- **F-05 · medium · query API не используется · доказано.** 9 query-регистраций,
  0 production-вызовов `query()`. UI/модули берут данные через accessor'ы медиатора
  (напр. `getMediatorWithModules().getMediator()`-стиль в game-store) и прямые
  чтения GameState. `economy.requiresQueries=['galaxy:system-by-id']` — декларация
  без единого вызова. Контракт `modular-bus.md` («запросы — единственный способ
  межмодульного доступа») и фактическая практика расходятся. Шаг: решение владельца
  (перевести потребители на query API либо понизить статус контракта).
- **F-06 · info · атрибуция издателя · доказано + задокументировано.** `core:state-changed`
  эмитится ТОЛЬКО GameMediator (:208 emitStateChanged, :227 commitState) по вызову
  из модулей/стора; 4 модуля декларируют его в emits. Аналогично события исходов
  economy/ships/fleet эмитят engine-функции (`gameBus`), а не классы модулей.
  Комментарий манифеста economy (:54-58) честно описывает эту конвенцию. Шаг: None
  (конвенция зафиксирована), либо перенести декларации в engine-контракты.
- **F-07 · info · издатель вне подсистемы · доказано.** `tech:fundamental-leveled`
  заявлен в tech-манифесте, но фактический emit — `game-store.ts:1892`
  (`levelUpFundamental`), т.е. publisher — store, не ResearchModule. Шаг: перенести
  emit в ResearchModule/engine или задокументировать.
- **F-08 · medium · события «в пустоту» · доказано.** 24 события имеют
  production-издателей и ноль production-потребителей (полный список §4). Их
  слушают только тесты. Это не баг сам по себе (события — API для будущих
  подписчиков, напр. AI этапа 3б/4), но объём «непроведённой» шины стоит знать.
  Шаг: решения по каждому — при реализации этапов 3б/4.
- **F-09 · info · декларации без реализации · доказано.** 43 события не эмитятся
  никем (§4); из них 12 заявлены в манифестах модулей: `galaxy:system-discovered`,
  `galaxy:system-surveyed`, `ships:construction-started`, `fleet:order-cancelled`,
  `tech:queue-added`, `tech:queue-removed` (+6 из economy, см. §5). Резерв
  этапов 3б/4 (§2.4). Шаг: реализация при соответствующих этапах или чистка по
  решению владельца.
- **F-10 · info · динамические формы · доказано.** (1) `game-loop.ts:112` — тернарник
  `resuming ? 'core:resumed' : 'core:started'` (оба литерала разрешаются анализатором);
  (2) `typed-event-bus.ts:200` — `flush()` редиспатчит через переменную (production
  `defer()` не вызывается — форма мертва в src); (3) query API — строковые имена без
  типизированной карты, связь «декларация↔регистрация↔вызов» только текстовая.
  Шаг: None; ограничения зафиксированы в карте (`limitations`).

## 8. Ограничения анализатора (полный список — в `module-bus-map.json` → `analyzer.limitations`)

1. Проводкой считаются ТОЛЬКО вызовы `emit/on/once/registerQuery/unregisterQuery/query`
   со строковым литералом первым аргументом и получателем из известного набора шины
   (`this.bus`, `bus`, `gameBus`, `*.getBus()`, алиасы импорта `gameBus`). Текстовые
   вхождения имени события в комментарии/строки/тест-фикстуры проводкой НЕ считаются.
2. Разрешаются: прямой литерал; условное выражение с двумя литералами (тернарник);
   алиасы импорта синглтона. Остальное — `dynamic_or_unresolved` + запись в `unresolvedForms`.
3. Query-имена не типизированы (`Map<string, QueryHandler>`) — связь declaration↔handler↔call
   устанавливается по совпадению строк.
4. Call-graph не строится: emit через `mediator.commitState()` атрибутируется
   файлу метода (game-mediator), а не вызывающему модулю (см. F-06).
5. Сканируются `src/` (production) отдельно от `tests/` и `scripts/` (non-production);
   test-only потребители не маскируют отсутствие production-потребителей; test-only
   регистрации/снятия query публикуются в `testRegisteredBy`/`testUnregisteredBy` и не
   классифицируют запрос как зарегистрированный (тесты генератора фиксируют оба поведения).
6. Регистрация модулей — по `new XxxModule(` + `registerAndInit([...])`/`registerModule(...)`
   call-sites; порядок init/tick воспроизводит `recalculateInitOrder` (DFS по deps в
   порядке вставки). Иные (будущие) способы регистрации потребуют расширения анализатора.
7. Атрибуция emits: модуль владеет ТОЛЬКО emit-фактами файла объявления своего класса;
   emissions engine/инфраструктурных файлов — в топ-уровневом `fileLevelEmits` без
   утверждения владения; два модуля одной директории не получают одинаковый список как
   подтверждённое владение (регресс-фикстура `tests/arch/fixtures/shared/`).
8. Зрелость реализации модулей (`partial`/`stub`) машинно НЕ выводится: карта содержит
   только `registrationStatus`; человеческая оценка — вне схемы (§2.3, §3.6).

## 9. Воспроизведение

```bash
bun run audit:module-bus            # сгенерировать docs/architecture/module-bus-map.json
bun run audit:module-bus --check    # дрейф: exit ≠ 0, если артефакт устарел
```

Генератор: `scripts/gen-module-bus-map.ts` (TypeScript Compiler API, read-only,
детерминированный вывод). Тесты генератора: `tests/arch/module-bus-map.test.ts`
(фикстуры: alias/import, typed emit/on, метод-обработчик, reserved event,
test-only consumer, query register/lookup, неподдерживаемая форма, детерминизм,
drift-check артефакта; регрессии follow-up: F1 — `tests/arch/fixtures/fx-f1-*`,
test-only регистрация query не засчитывается в production; F2 — `tests/arch/fixtures/shared/`,
общий engine двух модулей одной директории не приписывается обоим как владение).
Тест конформности схемы: `tests/arch/module-bus-map-schema.test.ts` (F3 — поля и
enum-значения артефакта не расходятся с этим документом).
