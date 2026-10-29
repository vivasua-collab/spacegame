# Чекпоинт — ORE-POOLS-RUNTIME-01 (Issue #25) — 2026-10-29

**Ветка:** main. **База:** a9aba69 (docs-only Issue #24 + Task 70).
**Задача:** планетарные пулы руд — авторитетное состояние добычи; единый бюджет
здания за тик; планировщик «минимумы → пропорциональный излишек»; сейвы v4.

## Выполнено

### Модель состояния и генерация
- `src/core/types.ts`: `PlanetOrePool` (oreId/initial/remaining/availability/tier);
  `Planet.orePools`/`Moon.orePools`; `HexCell.deposits` удалён; `ResourceDeposit`
  удалён; `PlanetResourceDeposit` без hexCount/maxAvailability (+`estimated`).
- `src/galaxy/generate-resources.ts` — переписан: `generatePlanetOrePools(rng,
  type, surfaceScale)` — прямая генерация пулов по seed (количественные профили
  гекс-модели сохранены: poolCount ≈ число «залежей» старой модели; вода R-27;
  богатые жилы; выбор 1–2 ULTRA_RARE с усиленным глубинным пулом qty 4–6,
  availability 0.03–0.10); `buildResourceSummary(pools, type)` — чистая
  производная БЕЗ RNG (руды → элементы по долям выхода; гарантийные оценки
  estimated). `ORE_POOLS_GENERATION_VERSION=1`. surfaceScale = не-океанские
  гексы (ГГ/полностью океанские миры — без коровых пулов, docs/31 §8.2/§9.3).
- `src/galaxy/generate-planets.ts`: пулы планет/лун из `derive('ore-pools')`
  (родительский поток не потребляется); вся R-29/R-37/R-38-механика
  (depositRngState/dm/dv/sv, materializePlanetDeposits, replay, миграция
  свод-пулов) удалена.

### Добыча: единый бюджет + планировщик
- НОВЫЙ `src/economy/mining-scheduler.ts`: `distributeMiningBudget(budget,
  candidates, ctx)` — фаза A (наименьший fulfillment → priority → oreId;
  переоценка в тике; исключение пустых/непомещаемых), фаза B (доли ∝
  remaining × availability от бюджета начала прохода; повторные проходы —
  перераспределение); стабильная сортировка oreId → бит-в-бит детерминизм.
- `src/economy/engine.ts`: processExtraction считает бюджет ОДИН раз на
  здание (baseRate 1.0 × levelMult × terrainMult × miningMult × geologicalMult
  — буровая ровно один раз); хаб — 0.5 × (1+ур.×0.1) поверхностных пулов;
  tryExtract-контракт: из пула вычитается только реально помещённое
  (canStoreResource); collectPoolCandidates — data-driven роли (BakedOre).
  colonizePlanet: хаб по территории/числу не-океанских соседей (не по залежам);
  материализации нет.

### Сейвы v4 и UI
- `src/lib/save-format-v4.ts` (v3 удалён): fmt=4; тела хранят `op` — кортежи
  пулов [dictIdx, initial, remaining, availability, tier] полной точности
  (JSON-раундрип без потерь); свод-превью не сериализуется; гекс-залежи,
  ds/dm/dv/sv не существуют; старые форматы отклоняются («Несовместимый
  формат… начните новую игру», docs/31 §12).
- `src/stores/game-store.ts`: v4-кодек; rebuildResourceSummaries после
  setCurrentLookups; R-37/R-38-миграционные блоки удалены.
- `planet-view.tsx`: секция «Планетарные пулы руды» (остаток/из, доступность,
  роль источника, % истощения, «пул исчерпан»); гекс-точки и список «Залежи
  гекса» удалены; estimated-метки в своде.

### Тесты
- Новые: `tests/economy/mining-scheduler.test.ts` (17 тестов, сценарии
  ORE-POOL-01…12), `tests/save-format-v4.test.ts` (11), `deposits.test.ts`
  переписан под пулы (14), `unique-resource-contract.test.ts` переписан (3).
- Обновлены: extraction-roles (единый бюджет: хаб 3 кандидата по 0.55/3;
  синергия сравнением пар), r40-stage2 (бюджетная математика G1–G10, T7 по
  пулам), save-migration-order (Б1-порядок на v4), r39 (T13/T14 v4),
  planet-invariants, economy/warehouse-gas/workshops и др. fixtures (orePools).
- Удалены: `tests/r38-save-migration-materialized.test.ts` (миграция не
  существует), `scripts/r38-migration-bench.ts`.
- Скрипты: save-size-analysis под v4; bus-map регенерирован.

## Гейты
- `bun test` 993/993 exit 0 (baseline 1019: −26 гекс-тестов, +30 пуловых).
- `bun run lint` 0 errors / 42 warnings (Δ0).
- `tsc --noEmit` 63 (baseline 75; новые файлы/тесты без ошибок).
- `bun run validate:all` exit 0; `git diff --check` чисто;
  `audit:module-bus -- --check` drift=0; `save:size` exit 0.

## Браузерный E2E (agent-browser, реальный dev-сервер :3000)
Новая галактика (seed 801355) → колонизация Upsilon Ursae I (ледяная) →
вкладка «Ресурсы»: секция «Планетарные пулы руды» — 54 пула с ролями
(Шахта/Карьер/Буровая L2+…L6+) и % истощения → шахта на произвольном гексе →
x15 ≈ 180 тиков: пул каолина (Al, Шахта) истощён 16% (306→255.99), склад
«Рудный» растёт (1306→1515/5000), список «количество/резерв» показывает
выравнивание минимумов фазой A (все руды ≈50 при бюджете одной шахты L1).
Консоль: только преждний aria-варнинг dialog. Скриншоты:
checkpoints/ore-pools-e2e-2026-10-29.png, ore-pools-e2e2-mining-…,
ore-pools-e2e3-warehouse-….

## Открытые вопросы / ограничения
- Ручная приёмка владельца ORE-POOL-01…ORE-POOL-09 — NOT TESTED
  (docs/playtest-checklist.md §4.2). Автотесты/E2E кодера не заменяют.
- Старые сейвы (fmt≤3) не поддерживаются по решению владельца (docs/31 §12).
- Атмосферная добыча gas_extractor не изменилась (отдельный источник).
