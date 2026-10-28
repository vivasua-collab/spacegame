# ARCH-BUS-MAP-01 — карта модулей и фактических контрактов шины (Issue #17)

**Дата:** 2026-10-28
**База:** main `9c84bb9` (+ docs-коммит этапа A на вершине). Runtime-код задачи НЕ менялся.
**Порядок коммитов (по ТЗ):** docs/contract schema → генератор + generated map + tests → checkpoint/worklog.

## 0. Результат одной строкой

Создана проверяемая карта действующей модульной архитектуры: `docs/architecture/module-contracts.md`
(схема, классификация статусов, инвентаризация с file:line, 10 findings) + read-only генератор
`scripts/gen-module-bus-map.ts` (TypeScript Compiler API), выдающий детерминированный
`docs/architecture/module-bus-map.json` с командой `bun run audit:module-bus` и drift-check
`--check` (exit 1 при устаревшем артефакте) + 16 тестов генератора на фикстурах и на реальном
репозитории. Runtime не менялся.

## 1. Этап A — инвентаризация (docs-only)

`docs/architecture/module-contracts.md`:
- схема полей карты (модуль/событие/запрос) и классификация: **7 статусов событий** с правилами
  приоритета (`declared_and_published` / `manifest_vs_runtime_mismatch` /
  `consumer_without_observed_publisher` / `observed_but_not_declared` /
  `published_without_observed_consumer` / `declared_but_not_observed_published` /
  `dynamic_or_unresolved`), статусы запросов и модулей, правило интерпретации резерва
  (declared_but_not_observed_published ≠ баг — R-42 каталог «вперёд», §2.4);
- инвентаризация 6 модулей (galaxy/economy/tech/ships/fleet/ai) + 4 reserved-идентификатора
  (core/combat/diplomacy/trade) + ядро-инфраструктура (GameLoop/GameMediator/gameBus/registry);
- полная таблица **86 событий** каталога `events.ts` (не 69 и не «~42» из исторических оценок):
  **43 эмитятся, 43 — задокументированный резерв**; у 24 эмитящихся нет production-потребителей;
- 9 query-регистраций, **0 production-вызовов** (`query()` не используется ни стором, ни модулями,
  ни UI; единственное `requiresQueries` — economy→galaxy:system-by-id — не exercised).

## 2. Этап B — генератор и drift-check

`scripts/gen-module-bus-map.ts` (read-only, синтаксический анализ без type-checker):
- проводкой считаются ТОЛЬКО вызовы `emit/on/once/registerQuery/unregisterQuery/query` со
  строковым литералом (или тернарником литералов) и получателем из набора шины/реестра
  (`this.bus`, `bus`, `gameBus`, `*.getBus()`, import-алиасы `gameBus`, `registry`, `this.registry`,
  `*.registry`); текстовые вхождения имени события фактом НЕ считаются;
- production (`src/`) сканируется ОТДЕЛЬНО от `tests/`/`scripts/` — test-only потребители не
  маскируют отсутствие production-потребителей (фикстурный тест фиксирует это поведение);
  `tests/arch/fixtures/` исключены из скана реального репо (входные данные тестов анализатора);
- нераспознанные формы фиксируются в `analyzer.unresolvedForms` (production-нераспознанные на
  распознанном получателе понижают события без издателей до `dynamic_or_unresolved`; механизменные
  `this.emit` внутри самой шины — transparency-only);
- регистрация модулей: `new XxxModule(` + `registerAndInit([...])`/`registerModule(...)` с резолвом
  локальных переменных; порядок init/tick — точная реплика `recalculateInitOrder` (DFS по deps в
  порядке вставки);
- детерминизм: сортированные коллекции, никаких времён/HEAD (проверено: два прогона —
  байт-в-бит; повторная генерация не даёт diff);
- `bun run audit:module-bus` — генерация; `--check` — exit 0/1 (демонстрация: расхождение найдено
  и локализовано строкой, exit 1 зафиксирован).

Итог генерации: **86 событий · 10 модулей (6 active + 4 reserved) · 9 запросов**; статусы:
`declared_and_published=10, manifest_vs_runtime_mismatch=2, observed_but_not_declared=7,
published_without_observed_consumer=24, declared_but_not_observed_published=43` (сумма 86 ✓).
`analyzer.unresolvedForms` = 3 (2 механизменных в typed-event-bus.ts:115/:200 с recognized=false;
1 test-side в shipyard-integration.test.ts:190).

## 3. Этап C — findings (полный список: module-contracts.md §7)

F-01 двойной канал тиков (registry.tickAll — рабочий; bus `core:tick` подписки модулей — no-op,
5 шт.) · F-02 `economy:downgrade/demolish` — runtime-подписки БЕЗ декларации (mismatch) ·
F-03 `economy:production-cancelled` эмитится engine, не заявлен никем · F-04 `combat:engaged`
эмитится stub-веткой, модуля combat нет · F-05 query API: 9 регистраций/0 вызовов, requiresQueries
не exercised · F-06 атрибуция core:state-changed (медиатор) и engine-эмитов · F-07
`tech:fundamental-leveled` эмитит store, а не tech-модуль · F-08 24 события «в пустоту» ·
F-09 43 события без издателей (12 из них заявлены манифестами) · F-10 динамические формы
(тернарник game-loop:112 разрешается; flush-редиспатч шины — dead в src; query-имена без типизации).

## 4. Этап D — документация и тесты

- `docs/architecture/modular-bus.md` — добавлен блок «Фактическая реализация vs дизайн-документ»
  (ссылки на карту + объяснение declaration vs observed runtime); остальное содержимое не тронуто.
- `docs/!listing.md` — строка module-contracts.md в архитектурной секции.
- `docs/architecture/module-bus-map.json` — помечен как инвентаризация фактической реализации,
  НЕ замена канонических контрактов (note в самом артефакте).
- Тесты генератора `tests/arch/module-bus-map.test.ts` — **16/16** на представительных фикстурах
  (alias/import, прямой typed emit/on, метод-обработчик, reserved event, test-only consumer,
  query register/lookup, неподдерживаемая форма → unresolvedForms + понижение только
  безиздательских событий, mismatch, топосорт, детерминизм байт-в-бит, drift-check) и на реальном
  репозитории (артефакт актуален + сводные числа == §4).

## 5. Гейты (реальные прогоны, дерево задачи)

| Команда | Exit | Результат |
|---|---|---|
| `bun test` | 0 | **949/949** (60 файлов) = 933 + 16 новых; Δ к базе +16 (новые тесты генератора) |
| `bun run lint` | 0 | 0 errors / 38 warnings (Δ0; lint покрывает только src/, новых файлов не касается) |
| `bunx tsc --noEmit` | 2 | **86 ошибок / 71 src = baseline Δ0**; в новых файлах (генератор, фикстуры, тесты) 0 ошибок; PASS не заявляется |
| `bun run validate:all` | 0 | 4/4 |
| `git diff --check` | 0 | чисто |
| `bun run audit:module-bus --check` | 0 | артефакт актуален (дрейф-демо: exit 1 при подмене) |
| детерминизм генерации | — | два прогона байт-в-бит идентичны |

Примечание к окружению: во время раунда песочница перегенерировала prisma-клиент (12:24) по схеме
заглушки и откатила локальную ветку к 3cda0f1 — восстановлено (`bun run db:push`, rebase на
origin/main 9c84bb9); инвентаризация и карта перепроверены/регенерированы на правильном дереве
9c84bb9 (bun test вернулся к 933 до +16 новых).

## 6. Инцидент восстановления (для честности аудита)

Локальная ветка была откатана средой к `3cda0f1` (потеряны коммиты 54b63a8..9c84bb9 из origin);
первичная генерация карты выполнена на откатанном дереве. После обнаружения (bun test 931 vs 933,
`git merge-base`) выполнено: `git stash` → `git rebase origin/main` → `stash pop`; commit этапа A
переложен на 9c84bb9 (стал `206e4f7`). Все ссылки на строки в `module-contracts.md` и артефакт
сверены с деревом `9c84bb9` (research-module.ts:240/:255/:262; game-store.ts:830/…/1892 — после
сдвигов от 70a2c7b/f242121). Финальные гейты — на правильном дереве.

## 7. Трассируемость по критериям приёмки Issue #17

| Критерий | Статус | Доказательство |
|---|---|---|
| Каждый зарегистрированный модуль в карте; неактивные помечены | DONE | карта modules: 6 active + 4 reserved (union ModuleId); unregistered-классы поддержаны тестом фикстуры |
| Для каждого события: декларация, production emitters/consumers с file:line | DONE | карта events.* (declared/productionEmitters/productionConsumers с file:line); human-таблица §5 |
| Для queries различены декларация/регистрация/вызовы | DONE | карта queries.* (declaredHandles/declaredRequires/registeredBy/productionCallers/testCallers) |
| Manifest-vs-runtime расхождения и unconsumed/unpublished перечислены; reserved не объявлены ошибками | DONE | 7 статусов с правилом резерва §2.4; findings F-02..F-09 |
| Генерация детерминирована; повторная генерация без diff; --check ловит устаревание | DONE | байт-в-бит ×2; drift-демо exit 1; тест drift-check |
| Тесты: test-only consumer не маскирует отсутствие production consumer | DONE | tests/arch: «test-only потребитель НЕ маскирует…» (фикстура fx-nonprod-consumer) |
| Документация, индекс, ограничения синхронизированы | DONE | modular-bus.md блок, !listing.md, analyzer.limitations (8 пунктов) |
| Runtime-код не изменён; findings — отдельно | DONE | diff раунда: docs/ + scripts/ + tests/ + package.json только |
| Команды и exit codes приложены; issue не закрывается | DONE | §5; issue остаётся OPEN |

## 8. Вопросы владельцу (решения по findings — НЕ в этом issue)

1. F-01: убрать no-op bus-подписки `core:tick` у модулей или зафиксировать «tick() — основной канал» в контракте.
2. F-02: дополнить `manifest.subscribes` economy (`downgrade`/`demolish`) — runtime-правка под отдельную задачу.
3. F-03/F-07: декларировать `production-cancelled`; перенести emit `fundamental-leveled` в tech-модуль или задокументировать store-издателя.
4. F-05: судьба query API (перевести потребителей или понизить статус контракта «единственный способ»).
5. F-08/F-09: реализация резерва при этапах 3б/4 или чистка каталога (43 события).

Runtime-код не менялся; Issue #17 остаётся OPEN — приёмка за владельцем/аудитором.
