# Чекпоинт: Аудит и ревью кода после слияния (R-31)

**Дата:** 2026-09-04 06:14
**Фаза:** 4 (инфраструктура готова, контент-этапы)
**Статус:** complete

## Выполненные задачи

1. **Синхронизация с GitHub:** `git fetch` — local main == origin/main (`110bcd4`,
   merge R-26/R-27). «Изменения» в `git status` оказались только сменой прав
   файлов (644→755, шум песочницы) — `core.fileMode=false`, дерево чистое.
   Слияние из потерянной сессии ЗАВЕРШЕНО и запушено полностью.
2. **Гейты на входе:** bun test 567/567, lint 0/48, tsc src 91 (= базлайн
   слияния), validate:all 4/4 — дрейфа нет.
3. **Детальное ревью (3 параллельных агента, отчёты в worklog.md Task 32-a/b/c):**
   - economy-ядро (engine, adjacency, auto-processing, рецепты, химия);
   - state/save (game-store, save-format-v3, кодеки, ленивые залежи, API);
   - UI (building-dialog, planet-view, production-queue, reference-dialog).
   Итог аудита: 5 major, ~15 значимых minor. Полные таблицы багов —
   👉 Кодовая база: [09_04_audit_12_code_review_code.md](09_04_audit_12_code_review_code.md)
4. **Исправлено 10 багов** (все major + значимые minor; список в кодовой базе).
5. **Уборка:** удалён мёртвый `resource-panel.tsx` (0 импортов), дубль
   чекпоинта старого формата `audit_2026_08_28_09_*.md` (пропущен при R-25).
6. **Гейты на выходе:** 567/567 (=, поведение фиксов покрыто существующими
   тестами), lint 0 errors/40 warnings (−8: снят мёртвый код), tsc src 93
   (+2 strict-noise), validate:all 4/4.
7. **Браузерная E2E-верификация** (seed 42, Eta Eridani I): склад 1110/12000
   (газ в знаменателе), HexInfoCard «+1.6/tick (L☉ 0.00, R 0.0)» вместо
   хардкода «+10», очередь → Save → reload → Load → коллизия ID отсутствует
   (отмена новой задачи не трогает исходные), консоль без ошибок, тест-сейв
   удалён.

## Текущие задачи

- Нет открытых; код готов к следующему этапу.

## Проблемы

- **Осознанно отложено (дизайн-решения, не баги):** гейты уровней глубинных
  руд (minSourceLevel/minProcessingLevel/minSpecializationLevel — данные
  есть, потребителя нет; docs 31 §глубины, 40 §12.1 описывают будущую
  прогрессию); мульти-рецептный штраф 1/√n (карусель даёт экземпляру ≤1
  задачу — штраф структурно недостижим, семантику пересмотреть при
  мульти-задачности); липкость spec-экземпляров (вытеснение более ранней
  задачей той же категории — прогресс не теряется); счётчики ship/fleet/slot
  после Load (окно коллизии уже, чем у очереди).

## Следующие шаги

- Etap 4.2 (планетарный каталог data-driven) — кандидат по ROADMAP.
- Решение владельца по отложенным дизайн-вопросам (глубинные руды).
- Возврат кросс-типовых синергий (§5.5) по готовности.

## Изменённые файлы

- src/economy/engine.ts — 5 фиксов (см. кодовую базу)
- src/stores/game-store.ts — восстановление счётчика ID очереди
- src/lib/save-format-v3.ts — строгий idOf
- src/app/api/save/route.ts, src/app/api/save/[id]/route.ts — byteLength
- src/components/game/planet-view.tsx — HexInfoCard-энергия, бар склада, a11y
- src/components/game/building-dialog.tsx — тост при провале, блокировка карточек
- src/components/game/production-queue-panel.tsx — тост при провале enqueue
- src/components/game/reference-dialog.tsx — 4 склада, реальная энергия, цепочки
- src/app/page.tsx — снят мёртвый селектор gameState
- src/data/buildings/surface.json — актуальные описания вместимости складов
- Удалено: src/components/game/resource-panel.tsx,
  checkpoints/audit_2026_08_28_09_post_r_ships_galaxy_eval.md
