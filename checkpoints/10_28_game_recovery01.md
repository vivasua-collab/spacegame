# GAME-RECOVERY-01 — локальный recovery checkpoint и продолжение после F5 (Issue #22)

> **Задача:** Issue [#22 [P1] GAME-RECOVERY-01 — recover session after page reload](https://github.com/vivasua-collab/spacegame/issues/22).
> **Зависимости выполнены:** #18 (save-путь стабилен), #21 (меню/Continue).
> **База:** main `736b89a` (= origin/main на старте).

## 1. Архитектура (без циклических импортов — требование задачи)

```
src/lib/game-recovery-contract.ts   типы + RECOVERY_SCHEMA_VERSION + RecoveryError (без зависимостей)
src/lib/game-recovery.ts            IndexedDB-бэкенд + RecoveryService (пишет serializeGameState)
src/hooks/use-game-recovery.ts      React-хук записи (единственный инстанс в page.tsx)
src/stores/game-store.ts            restoreFromCheckpoint — общий с loadGame integrator
src/app/page.tsx                    карточка «Восстановить последнюю игру»
```
Цикл разорван контрактом: game-store импортирует ТОЛЬКО контракт (type + константа);
game-recovery импортирует serializeGameState из game-store; хук импортирует оба.

## 2. Storage-слой (src/lib/game-recovery.ts)

- **IndexedDB** (отдельная БД `spacegame-recovery`, стор `checkpoint`, одна запись по
  ключу `current-session`) — ключ не конфликтует с серверными сейвами (это вообще
  другая БД, не SQLite-строки /api/save). localStorage/sessionStorage для полного
  состояния НЕ используются (десятки МБ).
- Запись: `{ schemaVersion, savedAt, seed, tick, encoding, payload }`; payload —
  serializeGameState (тот же v3-формат) + gzipBase64 при >512 КБ (те же хелперы,
  что у сейвов; фолбэк plain JSON).
- **Атомарность**: put в IDB-транзакции — новая запись либо применяется целиком,
  либо старая остаётся; сбой сериализации происходит ДО put (старая не тронута);
  квота (QuotaExceededError) → честная причина `quota`, старая запись цела.
- SSR/недоступность: `getRecoveryBackend()` → null вне браузера/без indexedDB —
  все операции честно падают `storage-unavailable`, симуляция не трогается.
- **Правило параллельности**: не более одной полной сериализации in-flight;
  при пропуске — ровно ОДИН свежий снимок (последний) в очередь, пишется сразу
  после завершения текущей; ошибки повтора — console.warn (следующий тик таймера
  напишет снова).
- Играющая сессия сериализуется как **paused/speed=0** (поверхностная копия, живое
  состояние не мутируется) — восстановление НЕ стартует игровой цикл молча
  (требование задачи).

## 3. Запись checkpoint'ов (use-game-recovery.ts, инстанс в page.tsx)

| Событие | Действие |
|---|---|
| Смена галактики (new game / загрузка серверного сейва / восстановление) | немедленный checkpoint — новая запись атомарно заменяет старую; «отмена New Game ничего не удаляет» (состояние не менялось — записи нет) |
| Активная сессия | стабильный setInterval 30 с (RECOVERY_INTERVAL_MS; НЕ пересоздаётся на тиках/рендерах — эффект зависит только от isInitialized) |
| «В главное меню» (#21) / unmount | свежий checkpoint приостановленной сессии (эффект-очистка по isInitialized) |
| document.visibilitychange → hidden | попытка свежего checkpoint (не полагаемся на async при закрытии — периодичность обязательна) |
| Ошибка записи | console.warn + ненавязчивый toast ОДИН раз за сессию (квота → «прошлый checkpoint цел»); игра продолжает работать |

Max потеря прогресса при живом хранилище: интервал 30 с + попытки на hidden/переходе в меню.

## 4. Восстановление (page.tsx + game-store.restoreFromCheckpoint)

- Холодная проверка IndexedDB при загрузке меню — НЕ блокирует экран создания
  галактики (карточка появляется по завершении async-проверки).
- Карточка «Последняя игра (после перезагрузки): Seed N · тик T · дата» с кнопкой
  **«Восстановить последнюю игру»** (loading-состояние на время восстановления).
  Показывается только при отсутствии suspended-сессии (после F5 её нет; живая
  сессия обслуживается Continue из #21).
- Восстановление: версия схемы → gunzip/plain (тот же хелпер) →
  deserializeGameState → **общий с loadGame integrator** (вынесен из loadGame в
  `integrateLoadedStateIntoStore`: restoreProductionItemCounter → resetShipCounter →
  mediator.setLoadedState → store) — путь не копировался, а переиспользован.
- Согласованные значения: isInitialized=true, currentSaveId=**null** (локальный
  checkpoint НЕ приписывает несуществующий серверный ID), loadWarnings (миграции)
  — как у loadGame; фаза — paused (не стартует loop молча; игрок жмёт Play).
- Ошибки: повреждённый payload / чужая версия схемы / чтение — честное сообщение
  (recoveryError, RECOVERY_ERROR_MESSAGES) в карточке и тосте; предложение удалить
  запись и начать новую игру (удаление — только явный выбор пользователя).
- Recovery-данные полностью отделены от серверных сейвов: список сейвов не
  меняется, автосохранений на сервер не создаётся.

## 5. Тесты (tests/game-recovery.test.ts, 13/13)

Storage (мок-бэкенд, новая библиотека не вводилась — интерфейс RecoveryStorageBackend):
- T1 write→read: поля/версия/payload валиден форматом сейвов (десериализация тем же путём)
- T2 **атомарность**: квота на новой записи → старый пригодный checkpoint цел
- T3 прочий сбой записи → reason=write, старая запись цела
- T4 недоступный бэкенд → storage-unavailable (write/read/clear)
- T5 **параллельность**: 3 вызова при in-flight → начата ОДНА запись; после
  завершения — ровно один отложенный снимок (put-entries: 1 → 2)
- T6 чужая schemaVersion → bad-version
- T7 битый base64/gzip → corrupted
- T8 сбой чтения → read; clear (явный выбор) работает
- T9 играющая сессия → checkpoint сериализуется как paused/0; живое состояние не мутировано

Store-интеграция:
- T10 успешный restore: тот же seed/tick/колония (не «похожая карта по seed»);
  paused; currentSaveId=null; isRestoring сброшен; 0 тиков за 120 мс (loop не стартовал)
- T11 повреждённый checkpoint → false + «повреждён» в recoveryError, ничего не подменено
- T12 чужая версия → false + «версией»
- T13 New Game заменяет запись (seed 4242 → 777); «отмена» (без изменения состояния) — запись не тронута

## 6. Браузерный E2E (выполнен реально, публичный превью-URL)

| Шаг | Результат |
|---|---|
| Launch Game → колонизация Theta Hydrae I | играющая сессия, Tick 2 |
| «В главное меню» | переходный checkpoint (тик 9) |
| **F5 (reload)** | in-memory сессия исчезла; меню + карточка «Последняя игра (после перезагрузки) Seed 17076 · тик 9 · 10/28/2026, 5:11:04 PM» |
| «Восстановить последнюю игру» | игра восстановлена: **Tick 9**, та же галактика, «Колонии: 1» (колония пережила F5→Restore) |
| Пауза после восстановления | тик заморожен (9 → 9 за 4 с) — цикл НЕ стартовал молча |
| Ошибки консоли | 0 |

## 7. Гейты (фактические коды выхода)

| Гейт | Результат |
|---|---|
| `bun test` | **1003 pass / 0 fail, exit 0** (= 990 + 13 новых) |
| `bun run lint` | 0 errors / 43 warnings, exit 0 (Δ0) |
| `bunx tsc --noEmit` | exit 2, **86 ошибок = baseline Δ0**; НЕ PASS |
| `bun run validate:all` | 4/4, exit 0 |
| `git diff --check` | чисто |
| `audit:module-bus` | артефакт регенерирован (сдвиг строк game-store), drift-check зелёный |

## 8. Границы

- Восстановление возвращает состояние на последний checkpoint (≤30 с потери при
  живом хранилище); ручные серверные сейвы — отдельный механизм, не заменялись.
- Private-режимы браузеров с отключённым IndexedDB — честная деградация
  (карточка не появляется / причина storage-unavailable), игра полностью работает.
- Браузерный E2E F5-сценария выполнен; приёмка владельцем (свой браузер, своя
  сессия) — issue остаётся OPEN.
- Скорость после восстановления не восстанавливается автоматически (сессия на
  паузе — осознанно, требование «не стартовать цикл молча»); игрок жмёт Play/xN.

## 9. Коммиты

| SHA | Тип | Описание |
|---|---|---|
| (см. git log) | feat(recovery) | IndexedDB recovery-checkpoint: контракт+сервис+хук+карточка+restoreFromCheckpoint (Issue #22) |
| (см. git log) | docs(checkpoint) | этот чекпоинт + worklog Task 65 |
