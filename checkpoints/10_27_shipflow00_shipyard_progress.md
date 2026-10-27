# Чекпоинт: SHIPFLOW-00 — регрессионный тест и минимальное исправление прогресса очереди верфи

**Дата:** 2026-10-27
**Фаза:** bugfix (Issue #12 SHIPFLOW-00, заменяет superseded Issue #10)
**Статус:** `complete` (ожидает приёмки владельца; Issue #12 НЕ закрывался — по условию задания)
**Источники:** Issue #12 «SHIPFLOW-00 — регрессионный тест и минимальное исправление прогресса очереди верфи»; worklog Task 51

## 0. Preflight (по заданию)

- База: `main` HEAD = `41afb939760f84e92b9fcc90cf82be9d718636f7` == origin/main (проверено `git ls-remote` —
  «историческая база» из текста Issue #12 действительно актуальна), дерево чисто.
- Прочитаны: `src/ships/ships-module.ts`, `src/data/ships/shipyard-queue.ts`, `src/stores/game-store.ts`
  (wiring `getMediatorWithModules`, действия `saveShipDesign`/`enqueueShipBuild`, `syncMediatorState`),
  `src/core/game-mediator.ts` (commitState, time-sync подписка priority −1, guard'ы), `src/core/game-loop.ts`
  (processTick: emit core:tick → registry.tickAll), `src/core/module-registry.ts`, `tests/ships/shipyard.test.ts`
  (только pure-helper покрытие), `tests/r39-store-mediator-sync.test.ts` (паттерн реального конвейера в тестах).

## 1. Подозрение из задания — ПОДТВЕРЖДЕНО

В `ShipsModule.processShipsTick()` (`src/ships/ships-module.ts`) очередь менялась внутри `produce(...)`
(`processShipyardTick` инкрементирует `progressTicks` первого item, удаляет item при отсутствующем дизайне),
но коммит нового состояния был привязан ТОЛЬКО к созданию корабля:

```ts
if (shipsCreatedThisTick > 0) {   // ← дефект: прогресс вычислялся, но отбрасывался
  this.commitState?.(newState);
}
```

Модуль каждый тик читает `mediator.getGameState()` заново → незакоммиченный produce-результат терялся →
`progressTicks` навсегда застревал на 0 в закоммиченном состоянии → корабль НЕ ЗАВЕРШАЛСЯ НИКОГДА
(для totalTicks > 1; scout=50, fighter=80, frigate=150, transport=120). Попутно были недостижимы на реальном
конвейере ветки «нехватка ресурсов в тик готовности» и «удалённый дизайн». Существовавший
`tests/ships/shipyard.test.ts` покрывал только pure-helper с ручной передачей `newQueue` — класс дефектов
не ловил (что и зафиксировано в Issue #12: «тест только pure helper недостаточен»).

## 2. TDD: доказательство дефектом через реальный конвейер

Новый файл `tests/ships/shipyard-integration.test.ts` (+6 тестов, 167 expect) — РЕАЛЬНЫЙ путь
store → mediator → ShipsModule (паттерн r39: newGame seed 42 → colonizePlanet через стор →
phase=playing/speed=0 → ручные `mediator.tick()`), после КАЖДОГО промежуточного тика очередь читается
ИЗ СТОРА (`useGameStore.getState().gameState.shipyardQueues`) — как её увидит UI:

- **T1** главный регрессионный: прогресс виден в сторе после каждого тика (1→2→3); ref-равенство
  store ↔ mediator после тика с коммитом (контракт R-39).
- **T2** завершение ровно один раз: 49 тиков → прогресс 49, 0 кораблей; 50-й тик → ровно 1 корабль
  (location/designId/owner/hp=maxHp=200), ровно одно списание (2075 steel + 415 microchip = 415 у.е.р. × 5/1),
  ровно одно `ships:constructed`, item удалён, очередь пуста; хвостовые тики по пустой очереди ничего не меняют.
- **T3** нехватка ресурсов в тик готовности: прогресс замирает на 49, списания и корабля нет, событий нет.
- **T4** удалённый дизайн к тику готовности: item тихо убирается из очереди, БЕЗ корабля и списания.
- **T5** пауза: `mediator.tick()` — no-op по контракту; прямой `registry.tickAll` при phase=paused НЕ
  продвигает очередь (модульный guard ShipsModule в глубину, R-39); после возобновления прогресс
  продолжается с прерванного значения (очередь паузу пережила).
- **T6** изоляция очередей разных планет: scout(50)/fighter(80) на двух планетах — независимые прогресс,
  завершения (тики 50 и 80), корабли приписаны своим планетам.

**Красный прогон подтверждён ДО фикса: 0 pass / 6 fail** — во всех тестах прогресс в сторе оставался 0
(`Expected: 1/2/3/49, Received: 0`) — дефект воспроизведён точно так, как описано в Issue #12.

## 3. Минимальный фикс (условие коммита, без изменения контрактов)

`src/ships/ships-module.ts` — единственный изменённый src-файл (+22/−2):

- добавлен флаг `queueChangedThisTick`: внутри цикла — ссылочное сравнение `result.newQueue !== queue`
  (helper возвращает ТОТ ЖЕ объект при отсутствии изменений — пустая очередь/нехватка ресурсов — и НОВЫЙ
  при любом изменении: инкремент прогресса, удаление item'а, завершение);
- условие коммита: `if (shipsCreatedThisTick > 0 || queueChangedThisTick) commitState(newState)`.

**Не менялось:** pure-helper `processShipyardTick` (стоимости/длительности/порядок FIFO/форма ShipDesign
сохранены), формат сейва (НОВЫХ ПОЛЕЙ НЕТ), `game-store.ts`, `game-mediator.ts`, docs/40/docs/50, формулы
баланса, старые тесты (ни один не ослаблен/не удалён), история (без force-push).

## 4. Гейты (реальные прогоны, SHA см. worklog Task 51)

| Гейт | Результат |
|---|---|
| `bun test tests/ships/shipyard-integration.test.ts` | 6/6 pass, exit 0 (после фикса; до фикса 0/6) |
| `bun test` (полный) | **906/906** (57 файлов), exit 0 (baseline 900 + 6 новых; старые не ослаблены) |
| `bun run lint` | exit 0 — **0 errors / 38 warnings** (Δ0 к базе) |
| `bunx tsc --noEmit` | exit **2** — **86 total / 71 src, Δ0 к baseline** (в файлах задачи — 0); исторический ненулевой exit НЕ именуется PASS |
| `bun run validate:all` | exit 0 — 4/4 |
| `git diff --check` | exit 0 (чисто) |
| Детерминизм (релевантен — pipeline модулей тронут) | `scripts/r39-det-check.ts` ×3 ОТДЕЛЬНЫХ процесса: sha256(gen)=eaed801144b8f255…1cd0 == ×3 == базам R-39/R-40/R-42/R-43/R-44; `scripts/r41-ai-det-check.ts`: sha256(ai-snapshot)=45c41c3cb1bcd5caef148170b2d9f3e6b72e5beaa72d2253750937436f5fbd39, sha256(gamestate)=52fdea9ea5f39cc5…ccd6 == отчёту R-41 → пустая очередь верфи = no-op, якоря целы |
| Браузерный smoke | НЕ выполнялся (задание: отмечать только если реально выполнен); реальный store/mediator/module-путь — ровно тот, что проходит UI — покрыт интеграционными тестами T1–T6 |

Примечание к среде (не изменение репозитория): в свежем клоне не было `.env` → 11 DB-тестов
(Prisma/sqlite) падали Environment'но — воспроизведено на чистом HEAD, устранено локальным
`.env` из `.env.example` + `bun run db:push` (файл `.env` в .gitignore, в коммит не входит); после
этого полный набор зелёный 906/906. Это та же средовая особенность, что задокументирована в
worklog Task 50.

## 5. Изменённые файлы

- `src/ships/ships-module.ts` — минимальный фикс условия коммита (+22/−2, включая комментарии)
- `tests/ships/shipyard-integration.test.ts` — НОВЫЙ, +6 интеграционных тестов
- `checkpoints/10_27_shipflow00_shipyard_progress.md` — этот чекпоинт
- `worklog.md` — Task 51 (append-only)

## 6. Следующие шаги

- Приёмка SHIPFLOW-00 — за владельцем (Issue #12 НЕ закрывался агентом — по условию задания).
- SHIPFLOW (следующие срезы владельца: новые производственные здания/рецепты) — только после приёмки.
