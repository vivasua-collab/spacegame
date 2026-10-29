# План — SAVE-V4-DOCS-UX-01 (Issue #26) — Task 73, 2026-10-29

**Base:** fd71996 (Task 72) · Follow-up к ORE-POOLS-RUNTIME-01 (Issue #25).
**Цель:** согласовать эксплуатационные инструкции с fmt v4; UX отказа
несовместимого legacy-сейва — явный и честный, без подмены причин.

## Границы (из задачи)

- Не менять механику добычи, формат v4, генерацию пулов, рецепты,
  производственные цепочки, корабельное производство, базу старых сейвов.
- Не добавлять runtime-миграцию старых сейвов.
- Не переписывать исторические checkpoint/worklog/plans записи.
- docs/55-ship-production-flow.md не трогать.

## Работы

### 1. Документация
- [x] `INSTRUCTIONS.md`: fmt v4 (op-кортежи + galaxy.dict), HexCell.deposits
      удалён, resourceDeposits — производное свод-превью (не запас руды),
      загрузчик только v4, v1/v2/v3 без миграции, GameSave.version =
      зеркало объявленного fmt (историческая строка БД — свои метаданные;
      совместимость по fmt ВНУТРИ state), транспорт gzip-base64 ↔ plain
      JSON без обещаний совместимости.
- [x] `docs/STATUS.md`: снять «Issue #25 blocked by #24» из текущего
      статуса (зависимость ЗАВЕРШЕНА — e22205d + fa50198; #25 открыт для
      ручной приёмки ORE-POOL-01…09); актуальная строка гейтов — по
      СОБСТВЕННЫМ прогонам на HEAD (не из отчётов Task 71/72); исторические
      записи цепочки «прежде…» сохранены.
- [x] `src/app/api/save/route.ts` докблок POST: убрать «plain JSON
      (version 1, совместимость с существующими сейвами)»; согласовать с
      PUT и declaredFormatVersion(). Поведение API не менять.

### 2. UX отказа загрузки (типизированный путь)
- [x] `save-format-v4.ts`: `IncompatibleSaveFormatError` с `fmt`/`legacy`
      (legacy = fmt ∈ REJECTED_LEGACY_FORMAT_VERSIONS); expandSaveV4
      выбрасывает его; тексты веток сохранены (регрессия сообщений).
- [x] НОВЫЙ `src/lib/save-load-ux.ts`: `LoadFailureKind`
      ('legacy-save-format' | 'other-load-failure'), `classifyLoadFailure`,
      `loadFailureToast` (рекомендованная формулировка аудита; версии
      ТОЛЬКО из модуля формата). Чистый модуль без store/UI.
- [x] `game-store.ts`: `loadFailure: LoadFailure | null` (сброс на старте
      каждой попытки, заполнение в catch); первопричина остаётся в
      console.error. Recovery: fmt≠4 в payload checkpoint → `bad-version`
      (не corrupted) — IndexedDB мог остаться от до-v4 сборки.
- [x] `page.tsx` handleLoad: тост по классификации. Не-legacy причины
      (сеть/404/битый JSON/fmt «новее») — честное общее сообщение БЕЗ
      «старого формата» и БЕЗ «начните новую игру».

### 3. Зачистка устаревших v3-утверждений о текущем состоянии
- [x] `src/ai/types.ts`, `src/ai/ai-module.ts`: 3а-сериализация — прошедшее
      время (введена в 3б.1/R-44; «на момент 3а сейвы были v3»).
- [x] `src/core/prng.ts`: «ds структурно совместим» — помечено
      ИСТОРИЧЕСКИ (R-35; в v4 RNG-снимки выведены из модели).
- [x] `README.md`: «сериализация в сейв v3» → «(aiFactions/aiFactionsV)».
- [x] worklog/checkpoints/plans — не тронуты (история).

## Регрессионные тесты (не проверка статической строки)

`tests/save-v4-docs-ux.test.ts` — 14 тестов:
- 1.x: типизация отказа (legacy=true для v1/v2/v3 с прежним текстом;
  legacy=false для fmt «новее» и отсутствия маркера; propagation через
  deserializeGameState);
- 2.x: classifyLoadFailure (legacy/other/не-Error/чужая несовместимость),
  тосты (legacy: версии из модуля + «начните новую игру», без «повреждён»;
  other: без формата и без «начните новую игру», диагностика в консоли);
- 3.x: loadGame integration со stub-fetch (fmt:3 → legacy; 500 → other;
  битый JSON → other; сброс классификации на новой попытке);
- 4.x: recovery fmt≠4 → bad-version (не «повреждён»); битый payload →
  corrupted как прежде (регрессия T11).

## Гейты (собственный прогон, результаты — в STATUS.md/чекпоинте)

bun test (полный) · bun run lint · bun run validate:all ·
bun run audit:module-bus -- --check · git diff --check ·
bunx tsc --noEmit vs baseline, снятый на стартовом HEAD (fd71996).

## E2E (agent-browser, dev :3000)

1. fmt:3-сейв → тост новой формулировки; консоль: IncompatibleSaveFormatError.
2. Битый state → честное общее сообщение.
3. v4-сейв → рантрип (load → игра) успешен.
Скриншоты: checkpoints/assets/save-v4-docs-ux-*.png.
