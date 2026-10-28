# GAME-SESSION-UI-01 — возврат в главное меню и продолжение сессии (Issue #21)

> **Задача:** Issue [#21 [P1] GAME-SESSION-UI-01 — возврат в главное меню и продолжение текущей сессии](https://github.com/vivasua-collab/spacegame/issues/21).
> **Источник:** плейтест владельца: из запущенной игры нельзя вернуться на начальный экран; сброс — только F5 с потерей in-memory state.
> **База:** main `757835e` (= origin/main на старте).

## 1. Что было (разбор lifecycle ДО правок)

- `page.tsx` рендерит `<GameLayout />` при `isInitialized === true`, иначе меню.
- Lifecycle-эффект `useEffect([isInitialized])` вызывал `mediator.start()` **безусловно** — в том
  числе при `isInitialized=false`. Без игры это no-op (`if (!this.gameState) return` в
  mediator.start), но с suspended-сессией (после возврата в меню) он бы **перезапустил
  интервал — игра тикала бы в фоне под меню** (главная ловушка этой задачи).
- `game-layout.tsx`: Save/справка/New Game есть, команды возврата в меню нет.
- `loop.pause()/stop()` — идемпотентны; `mediator.setSpeed`/`setLoadedState`/`setGameState`
  приводят loop в соответствие фазе — надёжная база для честного Continue.

## 2. Реализация

| Файл | Что |
|---|---|
| `src/stores/game-store.ts` | +`suspendedSpeed: GameSpeed \| null`; +`returnToMainMenu()` (паттерн R-39 saveGame: playing → phase='paused'/speed=0 через immer + sync + `loop.pause()`; colonization не мутируется — баннер переживёт Continue; gameState/currentSaveId/выделение НЕ трогаются; `isInitialized=false`); +`continueGame()` (guard: только suspended-сессия; `isInitialized=true`; `setSpeed(suspendedSpeed)` при speed>0 — ровно один интервал; пауза остаётся паузой; повторный Continue невозможен — guard) |
| `src/app/page.tsx` | Lifecycle-эффект: **меню → гарантированный `mediator.stop()`** (не start!); активная сессия → start/stop. +Карточка «Текущая игра приостановлена» (seed · тик · «прогресс в памяти этой вкладки») с кнопкой **«Продолжить игру»** — селектор БУЛЕВО (паттерн R-31, без перерисовок на тик). +`LaunchGameButton`/`LoadSaveButton`: при suspended-сессии — AlertDialog «Заменить текущую игру?» / «Загрузить сейв вместо текущей игры?» (Отмена ничего не меняет; подтверждение — штатный newGame()/loadGame(); серверные сейвы не удаляются) |
| `src/components/game/game-layout.tsx` | +кнопка **«В меню»** в топ-баре (aria-label «В главное меню (приостановить сессию)», tooltip; без подтверждения — действие не деструктивно, Continue доступен). Семантика существующего подтверждения «New Game» в игре НЕ менялась |
| `docs/architecture/module-bus-map.json` | регенерация (сдвиг строк game-store) |
| `tests/game-session-ui01.test.ts` (новый) | 9 тестов (см. §4) |

Не используется `window.close()` (запрещено задачей); не используется F5/reload; правила
генерации/экономики/AI не тронуты; save-механика #18 не тронута.

## 3. Браузерная верификация (выполнена реально, публичный превью-URL)

| Сценарий | Результат |
|---|---|
| Кнопка «В главное меню» | видна в топ-баре (фазы playing и colonization) |
| Возврат в меню из playing (тик 13) | меню + карточка «Seed 474574 · тик 13 — прогресс в памяти этой вкладки» |
| Тики в меню | **заморожены**: 4 с в меню — тик остался 13 (x1) |
| «Продолжить игру» | тот же seed/состояние: тик 13 → 16 (3 с) → 19 (ещё 3 с) — **одинарная скорость**, двойного интервала нет |
| New Galaxy поверх suspended | AlertDialog «Заменить текущую игру?» |
| Отмена | сессия нетронута (карточка на месте, тик 27 — продолжала бы расти после Continue, но заморожена в меню) |
| Подтверждение «Начать новую игру» | новая галактика, Tick: 0 (сессия заменена штатным newGame()) |
| Ошибки консоли | 0 |

## 4. Тесты (tests/game-session-ui01.test.ts, 9/9)

- T1: returnToMainMenu без сессии — no-op
- T2: возврат из playing(x50): сессия сохранена (seed/tick/системы), выделение сохранено,
  suspendedSpeed=50, loop paused, **0 тиков за 150 мс на x50**
- T3: Continue: тот же seed/tick, phase playing, speed 50, **активных интервалов ровно 1**
  (шпион setInterval; до 2 вызовов — штатный restart через идемпотентный mediator.start,
  без утечки), тики 3–10 за 150 мс на x50 (не двойная скорость)
- T4: повторный Continue при активной игре — false, состояние не меняется
- T5: Continue без сессии — false
- T6: пауза до возврата → пауза после Continue (0 setInterval, 0 тиков)
- T7: фаза colonization не портится возвратом (баннер переживёт Continue)
- T8: currentSaveId сохранён; **0 сетевых запросов** (тем более DELETE — серверные сейвы не тронуты)
- T9: контракт lifecycle-эффекта: suspended-сессия + `mediator.start()` (старое поведение
  эффекта) → 0 тиков (phase='paused' до остановки — guard в mediator.start не пускает);
  новый контракт `mediator.stop()` — loop paused

## 5. Гейты (фактические коды выхода)

| Гейт | Результат |
|---|---|
| `bun test` | **990 pass / 0 fail, exit 0** (= 981 + 9 новых) |
| `bun run lint` | 0 errors / 43 warnings, exit 0 (Δ0) |
| `bunx tsc --noEmit` | exit 2, **86 ошибок = baseline Δ0** (2×TS2532 game-store — pre-existing moveToOrbit/moveFromOrbit, сдвиг строк); НЕ PASS |
| `bun run validate:all` | 4/4, exit 0 |
| `git diff --check` | чисто |
| `audit:module-bus` | артефакт регенерирован, drift-check зелёный |
| Браузерный E2E | выполнен реально (§3) |

Инциденты, пойманные гейтами до коммита: TS2345 (suspendedSpeed: number → GameSpeed);
TS2345 в шпионаже setInterval (каст ReturnType); lint-ошибка setState-в-эффекте
избежана дизайном (первичный fit уже в ResizeObserver-колбэке — раунд #19).

## 6. Границы

- In-memory сессия не переживает F5 — это отдельная задача [#22 GAME-RECOVERY-01](https://github.com/vivasua-collab/spacegame/issues/22) (не решалась здесь).
- Подтверждение для Load-кнопки реализовано тем же паттерном, что и Launch (браузером
  проверен Launch-путь; Load — идентичный компонент AlertDialog).
- `view` (активная вкладка игры) сохраняется между возвратами — по дизайну «тот же контекст».
- Issue остаётся OPEN до ручной проверки владельцем в превью.

## 7. Коммиты

| SHA | Тип | Описание |
|---|---|---|
| (см. git log) | feat(session-ui) | returnToMainMenu/continueGame + «В меню»/«Продолжить игру» + подтверждения замены + lifecycle-фикс эффекта (Issue #21) |
| (см. git log) | docs(checkpoint) | этот чекпоинт + worklog Task 64 |
