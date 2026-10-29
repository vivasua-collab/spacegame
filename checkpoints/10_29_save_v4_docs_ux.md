# Чекпоинт — SAVE-V4-DOCS-UX-01 (Issue #26) — Task 73 — 2026-10-29

**Ветка:** main. **База:** fd71996 (Task 72). **Коммит:** 79625e0.
**Задача:** актуализировать инструкции под fmt v4; UX отказа несовместимого
legacy-сейва — явный и честный; не выдавать сетевую/неизвестную ошибку за
старый формат.

## Выполнено

### 1. Документация
- **INSTRUCTIONS.md** (секция сейвов переписана): fmt v4
  (`SAVE_FORMAT_VERSION`, save-format-v4.ts); планетарные пулы — кортежи
  `op` на телах ([idx, initial, remaining, availability, tier], индексы из
  `galaxy.dict`); `HexCell.deposits` больше НЕ часть модели (удалён в v4);
  `resourceDeposits` — производное свод-превью (buildResourceSummary,
  пересчёт при загрузке), НЕ запас руды; загрузчик принимает только v4,
  v1/v2/v3 НЕ мигрируются (IncompatibleSaveFormatError — начать новую
  игру, docs/31 §12); `GameSave.version` зеркалит объявленный fmt при
  новом POST/PUT, историческая строка БД может хранить прежние метаданные
  — фактическая совместимость по маркеру fmt ВНУТРИ state; транспорт
  gzip-base64 ↔ plain JSON без обещаний совместимости.
- **docs/STATUS.md**: из текущего статуса снято «Issue #25 blocked by #24»
  → «зависимость удовлетворена (e22205d), runtime опубликован (fa50198),
  #25 открыт для ручной приёмки ORE-POOL-01…09 и НЕ блокируется».
  Актуальная строка гейтов записана по СОБСТВЕННЫМ прогонам (не из
  отчётов Task 71/72); цепочка «прежде…» сохранена append-style.
- **POST /api/save докблок**: убрано «plain JSON (version 1, совместимость
  с существующими сейвами)»; смысл version согласован с PUT и
  declaredFormatVersion(). Поведение API не менялось.
- **Зачистка v3-утверждений о ТЕКУЩЕМ состоянии** (поиск по src/tests/
  docs/plans/README): `src/ai/types.ts` и `src/ai/ai-module.ts`
  (3а-сериализация — прошедшее время: введена в 3б.1/R-44, «на момент 3а
  сейвы были v3»); `src/core/prng.ts` («ds структурно совместим» →
  помечено ИСТОРИЧЕСКИ (R-35), в v4 RNG-снимки выведены из модели);
  `README.md` («сериализация в сейв v3» → «(aiFactions/aiFactionsV)»).
  worklog.md / checkpoints / старые plans — исторические, не переписывались.

### 2. UX отказа загрузки — типизированный путь
- `save-format-v4.ts`: `IncompatibleSaveFormatError` (поля `fmt`,
  `legacy`; legacy = fmt ∈ REJECTED_LEGACY_FORMAT_VERSIONS). expandSaveV4
  выбрасывает его; тексты веток совместимы с прежними регрессиями
  («Несовместимый формат», «начните новую игру»).
- НОВЫЙ `src/lib/save-load-ux.ts` (чистый, без store/UI):
  `LoadFailureKind` = 'legacy-save-format' | 'other-load-failure';
  `classifyLoadFailure`; `loadFailureToast` — рекомендованная формулировка
  аудита, версии ТОЛЬКО из rejectedLegacyVersionsLabel()/SAVE_FORMAT_VERSION.
- `game-store.ts`: `loadFailure: LoadFailure | null` в интерфейсе и
  начальном состоянии; сброс на старте КАЖДОЙ попытки; заполнение в catch
  (первопричина остаётся в console.error — требование аудита).
  Recovery: fmt≠4 в payload checkpoint → `RecoveryError('bad-version')`
  («Checkpoint создан другой версией игры и несовместим») вместо
  'corrupted' — IndexedDB-чекпоинт мог остаться от до-v4 сборки; битый
  payload → corrupted как прежде.
- `page.tsx` handleLoad: тост по `loadFailureToast(store.loadFailure)`;
  fallback на other при null. Единственный call site loadGame (проверено).

### 3. Артефакт карты модулей
- Новые импорты (game-store → save-load-ux → save-format-v4) сдвинули
  строки → `docs/architecture/module-bus-map.json` перегенерирован штатно
  (`bun run audit:module-bus`); diff — только сдвиги номеров строк,
  структурных изменений контрактов нет; `--check` OK.

## Тесты

- НОВЫЕ: `tests/save-v4-docs-ux.test.ts` — 14:
  1.1–1.4 типизация отказа expandSaveV4 (legacy=true для v1/v2/v3 с
  прежним текстом; legacy=false для fmt+1 и отсутствия маркера;
  propagation через deserializeGameState);
  2.1–2.4 classifyLoadFailure + тосты (legacy/other/не-Error/чужая
  несовместимость; тост legacy — версии из модуля, «начните новую игру»,
  без «повреждён»; тост other — без формата и без «начните новую игру»,
  диагностика в консоли);
  3.1–3.4 loadGame integration со stub-fetch (fmt:3 → legacy; 500 → other;
  битый JSON → other; сброс классификации на новой попытке);
  4.1–4.2 recovery fmt≠4 → bad-version (не «повреждён»), битый payload →
  corrupted (регрессия T11 game-recovery не сломана).
- Гейты — СОБСТВЕННЫЕ прогоны (не перенос из отчётов):

| Гейт | Результат |
|---|---|
| bun test (полный) | **1015/1015** (+14; после регенерации bus-map: 0 fail) |
| bun run lint | **0 ошибок** / 42 предупреждений (Δ0, все предсуществующие) |
| bun run validate:all | ok (recipes/buildings/ships/stars) |
| bun run audit:module-bus -- --check | **OK** (exit 0) |
| git diff --check | чисто |
| bunx tsc --noEmit | **63 = собственный baseline стартового HEAD fd71996** (замер до работ: 63, exit 2 предсуществующий; после: те же 63, diff — только сдвиг строк двух TS2532) |

## E2E (agent-browser, dev :3000)

| Шаг | Результат |
|---|---|
| Вставлены синтетические ряды: fmt:3 (version=3) и битый state | GET /api/save: 3 сейва |
| Load «E2E-LEGACY fmt:3» | тост: **«Этот сейв использует неподдерживаемый старый формат (v1/v2/v3). Поддерживается только v4; миграция старых сейвов не предусмотрена — чтобы продолжить, начните новую игру.»**; консоль: IncompatibleSaveFormatError(legacy=true), «Несовместимый формат сейва: fmt=3 (ожидается 4)» |
| Load «E2E-CORRUPT битый state» | тост: **«Не удалось получить или прочитать сейв (сеть, сейв отсутствует или повреждён). Подробности — в консоли.»** — БЕЗ «старого формата», БЕЗ «начните новую игру» |
| Load «Galaxy #459263» (v4) | игра загружена — рантрип не регрессировал |
| Ошибки браузера | только ожидаемые [error] Load failed (тестируемые отказы) |

Скриншоты: `checkpoints/assets/save-v4-docs-ux-legacy-toast-2026-10-29.png`,
`checkpoints/assets/save-v4-docs-ux-generic-toast-2026-10-29.png`.
Синтетические ряды удалены из БД после проверки; «Galaxy #459263»
(version=4) оставлен.

## Остаточные live-ссылки на v3 (намеренная история — не тронуты)

- `worklog.md`, `checkpoints/*.md`, старые `plans/2026-08-31-*` —
  исторические записи (приёмка явно запрещает их переписывать).
- `docs/STATUS.md` цепочка «прежде…» — историческая природа сохранена;
  формулировка «blocked by #24» снята по отдельному требованию задачи.
- В `src/**` текущих (не помеченных историческими) утверждений «fmt v3» /
  «v3 — единственный формат» / «version 1 для текущих сейвов» после
  зачистки не осталось.

## Границы соблюдены

docs/55-ship-production-flow.md не изменён; механика добычи/формат v4/
генерация пулов/рецепты/корабли не тронуты; runtime-миграция старых сейвов
не добавлялась; база старых сейвов не модифицировалась (синтетические ряды
удалены); force-push не использовался.
