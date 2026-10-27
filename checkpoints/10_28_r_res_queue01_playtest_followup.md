# Чекпоинт: R-RES-QUEUE-01 — playtest follow-up по очереди исследований

**Дата:** 2026-10-28  
**Issue:** [#15](https://github.com/vivasua-collab/spacegame/issues/15)  
**Docs-only commit:** [e09c99e](https://github.com/vivasua-collab/spacegame/commit/e09c99ef24e71297e04a11e88136a721a9b7a2d8)  
**Runtime/tests commit:** [f242121](https://github.com/vivasua-collab/spacegame/commit/f2421215e4720fdf2da53870a5abbf25b2d72e5c)  
**Статус:** runtime опубликован; автоматические тесты и повторный плейтест не выполнены, приёмка ожидается.

## Симптом

В пользовательском плейтесте первая технология достигла уровня 8, остальные поставленные в очередь не получали RP. Предыдущий smoke-отчёт не считается доказательством исправности этого длительного сценария.

## Решения владельца, внесённые в docs/60-research.md v1.2

- Неиспользованный RP после исчерпания всех допустимых проектов единожды переводится в `rpBank`.
- Вложенный RP текущего уровня сохраняется при временном снятии технологии и восстанавливается при повторном запуске.
- Пользовательский UI не имеет отдельной команды «Начать» с приоритетом в голову; обычная очередь работает FIFO.
- Старые save-версии несовместимы и не мигрируются; multi-active legacy consolidation удалена.

## Runtime/test изменения

- `cyclicCascade` передаёт ход после каждого завершённого уровня при наличии ожидающих проектов; убрана зависимость от `hasStartableQueuedTech`.
- `advanceQueue` просматривает не более длины очереди за один вызов, чтобы blocked prerequisites не приводили к бесконечной ротации.
- Остаток, который нельзя передать после закрытия последнего допустимого проекта, зачисляется в `rpBank` ровно один раз.
- `researchProgressByTech` добавлен в `ResearchState`; cancel → re-add/resume и save/load сохраняют частичный RP.
- Удалены `consolidateLegacySlots` и только миграционные тесты старых multi-slot saves.
- Убран UI-путь, который мог ставить технологию в голову очереди; пользовательский add остаётся обычным FIFO-хвостом.
- Добавлен integration test на 300 реальных тиков store→mediator→ResearchModule; добавлены проверки cancel/resume/save/load и отклонения старых сейвов.

## Проверки и приёмка

- Main HEAD подтверждён на `f2421215e4720fdf2da53870a5abbf25b2d72e5c`; изменённые файлы повторно получены через GitHub API.
- GitHub Actions runs: 0. Локальные `bun test`, `bunx tsc --noEmit`, lint и браузерный плейтест **не запускались**. Никаких PASS не заявляется.
- Следующий контроль: выполнить `bun test tests/research/cyclic-queue.test.ts tests/research/empire-rp-integration.test.ts`, полный набор gate-команд и повторить именно пользовательский сценарий с тремя технологиями.
- Issue #15 остаётся OPEN до подтверждения владельца.

## Затронутые runtime/test файлы

- `src/core/types.ts`
- `src/research/engine.ts`
- `src/stores/game-store.ts`
- `src/components/game/research-view.tsx`
- `tests/research/cyclic-queue.test.ts`
- `tests/research/empire-rp-integration.test.ts`
