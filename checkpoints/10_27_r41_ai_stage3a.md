# Чекпоинт: R-41 — Этап 3а: подготовка архитектуры AI-фракций

**Дата:** 2026-10-27
**Фаза:** 3а (подготовка/каркас; 3б НЕ начинался)
**Статус:** complete (выполнен; приёмка — за владельцем)
**Источник:** GitHub Issue #5 (vivasua-collab/spacegame) + комментарии владельца (гейт 13:25:39Z, runbook 13:26:28Z)

## 0. Публикация (SHA)

> Заполняется docs-коммитом после пуша основного коммита (конвенция R-35…R-42).

- Основной коммит R-41: **bbc05836b0a9637f0cd537414390f94411e7688b** (push 3faf5bc..bbc0583, без force)
- origin/main после публикации: **bbc05836b0a9637f0cd537414390f94411e7688b** (проверено git rev-parse origin/main == local)
- Серия: один основной коммит (код+тесты+доки) + один docs-коммит (SHA в этот раздел). Push без force.

## 1. Вход и допуск

- Branch `main`, HEAD = `3faf5bc8405256421b62b2de90f6ff1c3f679be0` — совпал с SHA из комментария-гейта владельца (НЕ исторический R-40 SHA из тела Issue). `git fetch`: in sync; дерево чисто.
- **Issue #6 (R-42) на GitHub остаётся OPEN на момент старта.** Гейт-комментарий владельца ставит условие «Когда владелец явно разрешит старт R-41» — допуск дан владельцем ЯВНО в чате («запускай работу») после публикации runbook. Следуя правилу runbook «Не закрывай Issue #6» — issue не закрывался; приёмка R-42 остаётся за владельцем. Отклонение от буквального условия фазы 0 шага 2 («если Open — остановиться») зафиксировано здесь ЧЕСТНО: старт выполнен на основании прямого разрешения владельца в чате, позже написанного, чем runbook.
- Baseline (реальные прогоны в чистом окружении): bun test 831/831 (52 файла, exit 0); lint exit 0 (0 errors/38 warnings); `tsc --noEmit` exit 1 — **86 ошибок / 71 в src** (совпадает с заявленным baseline R-42); validate:all exit 0 (4/4); БД 0 сейвов.

## 2. Свёртка контрактов (фаза 0/1 runbook)

Полная таблица «спецификация → существующий контракт → пробел → решение 3а» (16 строк) и ответы на 6 обязательных вопросов фазы 1 — в плане `plans/2026-10-27-r41-ai-stage3a-preparation.md`. Ключевое:

| Факт кода (проверено) | Следствие для 3а |
|---|---|
| `ModuleId` уже содержит `'ai'`; `PRIORITY.REACTION` (30–49) задокументирован как «AIModule анализирует тик» | Слот модуля существовал до этапа; манифест id='ai' без изменений каталога |
| `registry.tickAll()` обходит initOrder (топосорт deps); комментарий реестра «Economy всегда тикает перед AI» | deps=['economy'] + регистрация последней → AI тикает последним: `[galaxy, economy, tech, ships, fleet, ai]` |
| Модули фактически живут в доменных папках (`src/economy/…`), а не в `src/modules/` шаблона docs §10 | AI-модуль размещён в `src/ai/` |
| `saveGame()` сериализует ТОЛЬКО GameState (`serializeGameState`); модульные `serialize()` в сейв не входят (research — no-op) | AI-состояние 3а — вычисляемый кэш; сериализация AI в v3 НЕ вводится; формат сейва не меняется |
| Per-faction fog-of-war отсутствует (`system.discovered` — глобальный флаг), GameState.owner-поля — единственная модель владения | Видимость 3а тривиальна (документировано); фильтры видимости — точка расширения 3б; дубликата фракций нет (EntityId из owner-полей) |

Ответы на вопросы фазы 1 (кратко): (1) постоянного AI-состояния в 3а нет — всё кэш, пересчитываемый из GameState; (2) фракция = существующий `EntityId` (owner-поля, `playerFactionId`), дубликат не создан; (3) данные — только через accessor (то же, что видит UI), perception — defensive copy; (4) порядок — tick() последним, PRNG не используется, таймеров нет, подписки только ставят reset-флаги; (5) mutator не устанавливается (коммит физически недоступен), вторая шина/интервал не создаются; (6) 3а = каркас, 3б = фракции/действия/GOAP/сериализация после приёмки.

## 3. Реализовано (изменённые файлы)

**Новые:**
- `src/ai/types.ts` — AI_STATE_VERSION=1; AIDifficulty + AI_DIFFICULTY_UPDATE_INTERVAL (docs/70 §7.6: easy 20/normal 10/hard 5/insane 1); AIConfig + DEFAULT_AI_CONFIG (детерминированный операционный бюджет `maxControllersPerTick` вместо wall-clock ms-бюджета §8.8 — запрещён runbook; ms/Web Worker → 3б/4); инертная AIIntentQueue (статусы только `pending|cancelled`, `'executed'` невалиден по построению) + validateAIConfig/validateAIIntent/createIntentQueue/enqueueIntent; AIWorldModel (shared агрегаты); AIPerceptionSnapshot; AIControllerState; AIControllerSummary.
- `src/ai/perception.ts` — `buildWorldModel(state)` (системы по owner, счётчики планет/флотов/кораблей; сортированные ключи/массивы; мир НЕ копируется) и `buildPerception(world, factionId, tick)` (defensive copy; ноль ссылок на GameState).
- `src/ai/ai-module.ts` — `AIModule implements IGameModule`: манифест id='ai', deps=['economy'], **emits []** (ai:* остаются зарезервированными каталогом events.ts), subscribes — только lifecycle (`core:game-created`/`core:game-loaded` → reset вычисляемого кэша; safe при replay), query `ai:state`; `tick()`: phase-guard 'playing', пересборка world model каждый игровой тик, контроллеры в порядке вставки Map с бюджетом `maxControllersPerTick` и периодом `updateIntervalTicks`; attachController (идемпотентен)/detachController/getControllerSummaries (сортированы); serialize={version, aiStateVersion, controllerCount}, deserialize — no-op.
- `src/ai/index.ts` — публичный экспорт.
- `tests/ai/ai-model.test.ts` (14), `tests/ai/ai-module.test.ts` (13), `tests/ai/ai-integration.test.ts` (6) — см. §5.
- `scripts/r41-ai-det-check.ts` — 3-процессная проверка детерминизма.

**Изменённые:**
- `src/stores/game-store.ts` — импорт AIModule; в `getMediatorWithModules()`: accessor ДЛЯ ЧТЕНИЯ, **mutator сознательно НЕ устанавливается** (AI не может коммитить GameState), регистрация ПОСЛЕДНЕЙ в `registerAndInit([...])`.
- Документация: README.md (864/864), docs/STATUS.md (счётчики + changelog R-41), checkpoints/ROADMAP.md (этап 3: 3а выполнена — ожидает приёмки, 3б не начинался), plans/…r41….md (новый план), этот чекпоинт, worklog.md.

## 4. Чего НЕТ в 3а (намеренно, решение 3б/4)

Исполнение любых игровых действий (build/move/research/trade/combat/diplomacy) · сами AI-фракции в мире (прод-контроллеров 0) · GOAP/Utility · сериализация AI-состояния в сейв · fog-of-war per-faction · ms-бюджет/Web Worker (wall-clock запрещён runbook → операционные лимиты) · постоянное состояние фракций-«империй» · события ai:* (зарезервированы).

## 5. Тесты (+33 → 864/864)

- `ai-model.test.ts` (14): валидация конфига/интента (граница 3а: `'executed'` отклоняется); таблица частот == docs/70 §7.6; инертная очередь (дубликат id/переполнение — отказ без бросков, исполнятора нет); агрегаты world model; сортированные ключи (детерминизм сериализации); пустой мир; defensive copy в обе стороны; снапшот — только примитивы.
- `ai-module.test.ts` (13): манифест-контракт; initOrder заканчивается 'ai' (AI тикает последним); фазы; подписки создаются в init и снимаются в destroy, замена модуля ×3 без дублей; тики не создают подписок/таймеров; reset при game-created/game-loaded; phase-guard; периоды обновления (insane — каждый тик, easy — 21-й); бюджет maxControllersPerTick=1 (строго по одному контроллеру за тик, порядок вставки); stop/start; attach идемпотентен; query жива до destroy и снята после; serialize/deserialize.
- `ai-integration.test.ts` (6): прод-проводка стора (initOrder [..., 'ai']); **инертность**: 10 тиков с AI-контроллерами и без — `serializeGameState` бит-в-бит идентичен; AI не добавляет коммитов (счётчик core:state-changed одинаков при выключенном/включённом AI); **детерминизм** ×3 свежих сборки (sha256 снимка ==); save/load: v3-раундтрип сейва без AI-полей с зарегистрированным AI (старые сейвы совместимы по построению), кэш сбрасывается при load и пересобирается тиком; подписки прод-проводки не растут при повторных setLoadedState.

## 6. Гейты (реальные команды, exit codes)

| Гейт | Команда | Результат |
|---|---|---|
| Тесты | `bun test` | **864/864** (55 файлов, +33; exit 0) |
| Lint | `bun run lint` | exit 0 — **0 errors / 38 warnings** (в файлах R-41 — 0) |
| TypeScript | `bunx tsc --noEmit` | **exit 2 — 86 ошибок / 71 в src** — СОХРАНЯЮТСЯ НА BASELINE R-40/R-42: набор ошибок идентичен базовому (сверено diff'ом нормализованных списков), Δ0; в файлах R-41 — 0 ошибок |
| Валидаторы | `bun run validate:all` | exit 0 (4/4) |
| Детерминизм ×3 процесса | `scripts/r41-ai-det-check.ts` (seed 424242, 200→20 систем, 25 тиков, 3 контроллера normal/hard/insane) | `sha256(ai-snapshot)=45c41c3cb1bcd5caef148170b2d9f3e6b72e5beaa72d2253750937436f5fbd39` — совпал ×3; `sha256(gamestate)=52fdea9ea5f39cc5…ccd6` — совпал ×3 |
| CI | локально `.github/workflows` отсутствуют | CI нет — зелёные check-runs НЕ заявляются |

## 7. Браузерная верификация (agent-browser, реальный dev-сервер :3000)

New Galaxy seed 424242 (200 систем) → колонизация Xi Ursae I (вулканическая) → playing ×1: тики идут (Tick 9→21) → Save (POST /api/save, 201) → reload → Load Game → состояние восстановлено (Tick 21, phase paused — контракт «playing-сейв загружается на паузе», Xi Ursae I на месте) → resume ×1 → Tick 23 (симуляция продолжается, AI-модуль в проводке) → ошибок страницы/консоли 0 → тестовый сейв удалён (DELETE 200), `GET /api/save` → `[]` (БД 0 сейвов).

## 8. Риски / ограничения

1. **Issue #6 остаётся OPEN** — старт R-41 выполнен на основании явного чат-допуска владельца (см. §1); приёмка R-42 и вердикт по 3а — за владельцем.
2. ms-бюджет docs/70 §8.8 заменён детерминированными операционными лимитами (wall-clock запрещён runbook) — при желании вернуть ms-бюджет: решение владельца (3б/4, вместе с Web Worker).
3. Видимость в 3а тривиальна (per-faction fog-of-war в игре отсутствует) — фильтры видимости заложены как точка расширения 3б; при появлении скрытых данных perception обязан фильтроваться до включения в снапшот.
4. Прод-контроллеров 0 (AI-фракций в мире нет) — module тикает «вхолостую» (дёшево: только пересборка лёгких агрегатов world model в фазе playing).

## 9. Следующие шаги (за владельцем)

- Приёмка 3а (вердикт по Issue #5); приёмка R-42 (Issue #6) — независимо.
- 3б (после явной приёмки 3а): фракции в мире, постоянное состояние + сериализация, GOAP/Utility, исполнение действий через существующие команды, ms-бюджет/Web Worker, fog-of-war.

## 10. Изменённые файлы

- Новые: `src/ai/types.ts`, `src/ai/perception.ts`, `src/ai/ai-module.ts`, `src/ai/index.ts`, `tests/ai/ai-model.test.ts`, `tests/ai/ai-module.test.ts`, `tests/ai/ai-integration.test.ts`, `scripts/r41-ai-det-check.ts`, `plans/2026-10-27-r41-ai-stage3a-preparation.md`, этот чекпоинт.
- Изменённые: `src/stores/game-store.ts`, `README.md`, `docs/STATUS.md`, `checkpoints/ROADMAP.md`, `worklog.md`.

👉 Вердикт этапа 3а: **PASS** (все обязательные проверки Issue #5 выполнены с реальными результатами; автоматических игровых действий нет; приёмка — за владельцем).
