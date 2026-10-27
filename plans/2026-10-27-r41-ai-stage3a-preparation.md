# План: R-41 — Этап 3а: подготовка архитектуры AI-фракций

Дата: 2026-10-27 · Источник: GitHub Issue #5 (vivasua-collab/spacegame) + комментарии владельца
(гейт 13:25:39Z, runbook 13:26:28Z) + явный допуск владельца в чате («запускай работу»).

## Фактическая база (проверено при старте)

- Branch: `main`, HEAD = `3faf5bc8405256421b62b2de90f6ff1c3f679be0` (== origin/main == SHA владельца
  из комментария-гейта; НЕ исторический R-40 SHA из тела Issue). `git fetch` — in sync.
- `git status --short` — чисто; рабочих изменений нет.
- Issue #6 (R-42) на GitHub остаётся **OPEN** на момент старта. Допуск старта R-41 получен
  ЯВНО в чате владельца; следуя правилу «Не закрывай Issue #6» — issue не закрывается,
  приёмка R-42 остаётся за владельцем. Риск зафиксирован в чекпоинте.
- Baseline-гейты (реальные прогоны в текущем окружении): bun test **831/831** (52 файла, exit 0),
  lint **0 errors / 38 warnings** (exit 0), `tsc --noEmit` **exit 1 = 86 ошибок (71 в src)** —
  совпадает с baseline R-42, `validate:all` **4/4** (exit 0). БД 0 сейвов.

## Объём 3а (из Issue #5) — границы

**ДЕЛАЕМ:** сверка контрактов (эта таблица) · типы AI-моделей · AI module skeleton + lifecycle
через ModuleRegistry/GameMediator · детерминированные perception/world-model · инертная
intent-очередь · тесты · гейты · документация · публикация.

**НЕ ДЕЛАЕМ:** исполнение любых игровых действий AI (build/move/research/trade/combat/diplomacy),
GOAP/utility-поиск, стратегические решения, сериализацию AI-состояния в сейв (формат v3 не
меняется), этапы 3б/4, изменение ресурсных пулов/баланса, ослабление тестов.

## Контрактная таблица: спецификация → существующий контракт → пробел → решение 3а

| # | Требование (Issue #5 / docs/70-ai.md) | Существующий контракт (проверено в коде) | Пробел | Решение 3а |
|---|---|---|---|---|
| 1 | AI-модуль по IGameModule/manifest через ModuleRegistry/GameMediator (п.3 Issue) | `ModuleId` уже содержит `'ai'` (module-types.ts); `IGameModule` — init/start/tick/stop/destroy/serialize/deserialize; `PRIORITY.REACTION=30..49` документирован как «AIModule анализирует тик»; регистрация атомарна (R-42 F-03); фактическая структура — модуль в доменной папке (`src/economy/economy-module.ts`, …) | Модуля AI не существует | `src/ai/ai-module.ts`: manifest id='ai', version 0.1.0, dependencies=['economy'], emits=[] (`ai:*` остаются зарезервированы — events.ts), subscribes — lifecycle-события, handlesQueries=['ai:state'] |
| 2 | Детерминированный порядок обработки (п.4 Issue) | `registry.tickAll()` обходит initOrder (топосорт зависимостей) — «Economy всегда тикает перед AI» (комментарий реестра); GameLoop.processTick: emit core:tick → tickAll; новый таймер/шина запрещены дизайн-контрактом | AI не в цепочке тиков | deps=['economy'] + регистрация ПОСЛЕДНЕЙ в `getMediatorWithModules()` → initOrder `[galaxy, economy, tech, ships, fleet, ai]` — AI тикает последним; работа ТОЛЬКО в tick(), никаких setInterval/таймеров |
| 3 | Подписки безопасны при start/stop/newGame/load/re-register (п.3 Issue) | Паттерн `unsubscribers[]` + cleanup в destroy() (research-модуль); `resetGameMediator()` → `bus.clear()` + instance-tracking `modulesRegisteredOn` (R-39); модули не владеют состоянием | — | Подписки создаются ТОЛЬКО в init(); снимаются в destroy(); обработчики инертны (dirty/reset-флаги); тесты: повторные циклы не растят `listenerCount` |
| 4 | AI не мутирует GameState, не обходит команды (п.3 Issue) | Модули получают accessor/mutator от store (game-store.ts:304-313); единственный путь коммита — `mediator.commitState()` | — | AI получает **ТОЛЬКО accessor**; mutator НЕ устанавливается (коммит физически недоступен); восприятие — defensive copy (новые объекты, без ссылок на state) |
| 5 | Постоянное состояние фракции vs вычисляемое (п.2 Issue; runbook фаза 1 в.1) | «Модули не владеют состоянием — всё в GameState»; в сейве v3 модульные serialize() не участвуют (`saveGame` → `serializeGameState(GameState)`); в GameState есть только `playerFactionId='player'` | AI-фракций в мире нет; persistent AI state некуда сериализовать без смены формата | В 3а persistent AI-состояния НЕТ: контроллеры — вычисляемый кэш, полностью пересчитываемый из GameState; `serialize()={version}`, deserialize — no-op; формат сейва v3 НЕ меняется; persistent фракции + сериализация — решение 3б |
| 6 | Тип фракции — не дублировать (runbook фаза 1 в.2) | `EntityId` + owner-поля на Planet/StarSystem/Ship/Fleet; `GameState.playerFactionId` | Отдельного реестра фракций нет | `AIControllerState.factionId: EntityId` — те же идентификаторы, что в owner-полях; реестра фракций в 3а НЕ создаём (решение 3б вместе с GameState-расширением) |
| 7 | Perception/world model без копирования мира и скрытых данных (п.2 Issue; фаза 1 в.3) | Источник — accessor.getGameState(): galaxy.systems (массивы, стабильный порядок), fleets, researchState; fog-of-war per-faction отсутствует (`system.discovered` — глобальный флаг) | Нет агрегатов и модели видимости | World model — SHARED лёгкие агрегаты (galaxyId/seed/systemCount; owner→sorted systemIds; counts по owner); perception per-controller — срез world model по factionId; НЕ копируем планеты/гексы/залежи; фильтры видимости — контракт-хук для 3б (в 3а видимость тривиальна — задокументировано) |
| 8 | Фиксированный порядок, без wall-clock/случайности (п.4 Issue; фаза 1 в.4) | Тик-контракт GameLoop (без wall-clock в игровых решениях); Xoshiro128** (R-35) для игры | — | В 3а AI НЕ использует PRNG вовсе (perception — чистые функции от state); итерации по массивам/отсортированным ключам; подписки только ставят флаги, обработка — в tick(); детерминизм — тест ×3 процесса |
| 9 | Границы бюджета работы AI на тик (п.4 Issue) | docs/70 §8.8 задаёт ms-бюджет (20 мс/тик) | ms-бюджет = wall-clock — запрещён runbook | Детерминированные операционные лимиты в `AIConfig`: `maxControllersPerTick` (default 8) + `maxSnapshotSystems`; ms-бюджет/Web Worker — перенос в 3б/4 (обоснование в плане) |
| 10 | Инертная goal/intent очередь (runbook фаза 3) | `ai:*` события объявлены в events.ts, никем не эмитятся (резерв этапов 3/4) | Нет типов | `AIIntent` — дискриминированный union действий из docs/70 §2–6 со статусами `pending/cancelled` (никогда не `executed` в 3а); enqueue/dispatch не вызывается вне тестов |
| 11 | AI config/difficulty (docs/70 §7) | Таблица частот обновления: easy 20 / normal 10 / hard 5 / insane 1 тик | Нет типов | `AIDifficulty = 'easy'\|'normal'\|'hard'\|'insane'` + `AIConfig { difficulty, updateIntervalTicks, maxControllersPerTick }` + валидация; дефолт normal |
| 12 | Интеграционные тесты lifecycle (п.5 Issue) | `listenerCount()` API шины; паттерны modular-integration.test.ts | — | tests/ai/: registration→init/start/tick/stop/destroy; повторные start/stop/load/re-register — подписки не дублируются |
| 13 | Детерминизм: same state+seed+events → идентичный snapshot ×3 (п.5 Issue) | Паттерн scripts/r39-det-check.ts (отдельные процессы, sha256) | — | scripts/r41-ai-det-check.ts: headless mediator+AI, фиксированные шаги, sha256 снимка ×3 процесса == |
| 14 | Save/load: старый сейв без AI-полей загружается (п.5 Issue) | save-format-v3: fmt-маркер, zod; R-38 миграции; модульный deserialize в сейв-путь не входит | — | Тест: serializeGameState→deserializeGameState с зарегистрированным AI-модулем (старый сейв совместим по построению — AI-полей в v3 нет); новый round-trip AI-состояния НЕ вводится |
| 15 | AI 3а не меняет экономику/флот/исследования (п.5 Issue) | — | — | Тест-инвариант: N тиков с AI-модулем и без → `serializeGameState` бит-в-бит идентичен |
| 16 | Гейты/документация/публикация (проверки Issue) | baseline R-42: 831/831, 0/38, tsc 86/71 (exit 1), validate 4/4; конвенция SHA в чекпоинт §0 | — | Реальные прогоны с exit codes; план/worklog/STATUS/README/ROADMAP-сверка; checkpoint по RULES.md; отдельный commit, push без force; Issue #5/#6 не закрываются; CI не заявляется |

## Ответы на 6 вопросов фазы 1 (runbook)

1. **Постоянное vs вычисляемое**: в 3а постоянного AI-состояния нет — AI-империй в мире не
   существует (единственная фракция GameState — player). Всё AI-состояние 3а — кэш,
   пересчитываемый из GameState (world model + perception). Сериализация AI в сейв НЕ вводится
   (v3 не меняется, старые сейвы совместимы по построению). Постоянное состояние появится в 3б
   вместе с фракциями — тогда же расширение GameState/сейва с тестами совместимости.
2. **Тип фракции**: существующий `EntityId` (owner-поля Planet/StarSystem/Ship/Fleet,
   `playerFactionId`). Дубликат не создаётся; реестр фракций — решение 3б.
3. **Источник данных и скрытая информация**: только accessor.getGameState() — те же данные,
   что видит UI (systems/planets с owner-полями, fleets, ships, researchState, time).
   Per-faction fog-of-war в игре отсутствует, скрытых данных в GameState нет — в 3а видимость
   тривиальна (задокументировано); API фильтров видимости оставлен как точка расширения 3б.
   Perception — defensive copy агрегатов (строки-id, числа), ни одной ссылки на GameState.
4. **Гарантия порядка**: tick() AI вызывается последним (deps=['economy'], регистрация последней
   → initOrder [galaxy, economy, tech, ships, fleet, ai]); подписки (core:game-created/
   game-loaded/state-changed) только ставят dirty/reset-флаги; вся работа — в tick(); PRNG не
   используется; таймеров нет; итерации по массивам и отсортированным ключам.
5. **Без мутаций/дублирования**: mutator AI не устанавливается (коммит недоступен физически);
   единая шина gameBus; никаких новых интервалов; UI не затрагивается (AI не эмитит события в 3а).
6. **3а vs 3б**: 3а = типы, инертная intent-очередь, lifecycle, perception/world-model,
   детерминизм, тесты. 3б (отдельная приёмка) = AI-фракции в мире, GOAP/Utility, исполнение
   действий через существующие команды (economy:build, fleet:*), сериализация AI-состояния,
   стартовые бонусы сложности. В 3а — ни одного автоматического действия.

## Чеклист

### Фаза 0 — preflight
- [x] git status/branch/HEAD/log — чисто, main, 3faf5bc == origin/main == SHA владельца
- [x] Issue #6 проверен (OPEN; допуск владельца получен в чате; issue не закрывается)
- [x] Прочитаны: worklog-хвост, plans/README, checkpoints/RULES, ROADMAP, docs/STATUS,
      docs/70-ai.md (полностью), modular-bus.md (§9.1 R-39-контракт + §10 шаблон),
      events.ts, module-types.ts, module-registry.ts, game-mediator.ts, game-loop.ts,
      typed-event-bus.ts, types.ts (GameState/Planet/StarSystem/Ship/Fleet), game-store.ts
      (getMediatorWithModules), save-path (saveGame/loadGame), research/economy/galaxy/ships/fleet
      манифесты, тест-паттерны (modular-integration, r42)
- [x] Baseline-гейты: 831/831 · lint 0/38 · tsc 86/71 (exit 1) · validate 4/4
- [x] Контрактная таблица + ответы фазы 1 (этот план)
- [x] Отчёт фазы 0 владельцу (без изменений исходников)

### Фаза 2 — минимальная модель (без исполнения)
- [x] `src/ai/types.ts`: AIDifficulty, AIConfig + DEFAULT_AI_CONFIG, AIIntentAction/AIIntent
      (инертный), AIIntentQueue, AIWorldModel, AIPerceptionSnapshot, AIControllerState,
      AI_STATE_VERSION + validateAIConfig/validateAIIntent (чистые функции)
- [x] `src/ai/perception.ts`: buildWorldModel(state) / buildPerception(world, factionId) —
      чистые, детерминированные, defensive copy, сортированные ключи/массивы
- [x] `src/ai/index.ts` — публичный экспорт

### Фаза 3 — module skeleton + lifecycle
- [x] `src/ai/ai-module.ts`: AIModule implements IGameModule — manifest (id 'ai', deps ['economy'],
      emits [], subscribes [core:game-created, core:game-loaded],
      handlesQueries ['ai:state']); attachController/detachController/getControllerSummaries;
      tick(): phase-guard 'playing', бюджет maxControllersPerTick, пересборка world model +
      perception по updateIntervalTicks; intent-очередь инертна; serialize={version}; unregisterQuery в destroy
- [x] Регистрация в `game-store.getMediatorWithModules()` — ПОСЛЕДНЕЙ, accessor без mutator
- [x] Проверка диффов после каждой фазы + целевые тесты (после фазы 3: 831/831 — регрессий 0)

### Фаза 4 — тесты (tests/ai/)
- [x] Валидация AIConfig/AIIntent + построение world model/perception (юнит, 14 тестов)
- [x] Perception: defensive copy (мутация снапшота не трогает GameState; мутация state не ломает
      снапшот), нет ссылок на state
- [x] Lifecycle: init→start→tick→stop→destroy; повторные start/stop; newGame/load;
      повторная регистрация — listenerCount/query не дублируются (13 тестов)
- [x] Детерминизм: same state+последовательность → идентичный snapshot (×3 сборки в тесте;
      ×3 ОТДЕЛЬНЫХ процесса через scripts/r41-ai-det-check.ts — sha256 ==)
- [x] Инертность: тики с AI и без AI → serializeGameState идентичен; AI не коммитит state (6 тестов интеграции)
- [x] Save/load: v3-раундтрип сейва без AI-полей с зарегистрированным AI-модулем
- [x] Регрессии GameLoop/mediator/шины — 831 старых тестов зелёные, не ослаблены

### Фаза 5 — гейты, документация, публикация
- [x] bun test 864/864 (exit 0, +33) · bun run lint exit 0 (0/38, в R-41 — 0) ·
      bunx tsc --noEmit exit 2 = 86/71 СОХРАНЯЮТСЯ НА BASELINE, Δ0 (набор идентичен), в R-41 — 0 ·
      bun run validate:all exit 0 (4/4)
- [x] Детерминизм ×3 отдельных процесса: sha256(ai-snapshot)=45c41c3c…fbd39 == ×3,
      sha256(gamestate)=52fdea9e…ccd6 == ×3
- [x] Браузерный smoke test (agent-browser): New Galaxy 424242 → колонизация Xi Ursae I →
      ×1 тики → Save → reload → Load (tick 21, paused) → resume → 0 ошибок консоли; БД очищена []
- [x] CI: .github/workflows отсутствуют, check-runs не заявляются
- [x] git diff --check / --stat / полный diff / clean status; worklog (append-only), STATUS,
      README, ROADMAP; чекпоинт checkpoints/10_27_r41_ai_stage3a.md
- [ ] Отдельный commit + push без force; SHA в чекпоинт §0 отдельным docs-коммитом
- [ ] Отчёт владельцу самодостаточный (SHA, таблица, файлы, тесты, exit codes, вердикт)

## Открытые вопросы / решения

- ms-бюджет docs/70 §8.8 → операционные лимиты в 3а (wall-clock запрещён runbook) — решение
  зафиксировано, перенос ms-бюджета в 3б/4. Не блокирует.
- Видимость (fog-of-war per-faction) в 3а тривиальна — задокументировано как точка расширения 3б. Не блокирует.
- Если при реализации обнаружится конфликт спеки с кодом — ОСТАНОВИТЬСЯ и спросить владельца
  (правило runbook), вместо выдумывания механики.

## Результат

- Статус: done (все фазы runbook выполнены); вердикт 3а — **PASS** (гейты зелёные;
  приёмка — за владельцем). Серия публикаций: см. чекпоинт §0.
