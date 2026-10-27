# Чекпоинт: SHIPFLOW-DOCS — документирование утверждённого конвейера производства и сборки кораблей

**Дата:** 2026-10-27
**Фаза:** docs-implementation (Issue #13 SHIPFLOW-DOCS, заменяет superseded Issue #11)
**Статус:** `complete` (ожидает приёмки владельца; Issue #13 НЕ закрывался — по условию задания)
**Источники:** Issue #13 «SHIPFLOW-DOCS — документировать утверждённый конвейер производства и сборки
кораблей» (вкл. ADDENDUM 2026-10-27); worklog Task 52; предпосылка — SHIPFLOW-00 (Issue #12, принят
владельцем: «SHIPFLOW-00 принят; переходим к Issue #13»)

## 0. Preflight

- База: `main` HEAD = `1f92db4613af9e890f9b0c0db31029007c6aa3fb` == origin/main (SHIPFLOW-00),
  дерево чисто после `git pull` (fast-forward 41afb93→1f92db4).
- Порядок выполнения Issue #13 соблюдён: сначала Issue #12 (закрыт + принят владельцем,
  комментарий 2026-10-27T18:59:31Z), после его checkpoint/commit — Issue #13.

## 1. Обязательный аудит до правок (docs ↔ код) — выполнен по фактическим исходникам

Прочитаны: `docs/40-buildings.md` (§3.0, §4.4–4.6, §6.1–6.5, §7.1–7.2, §11.5, §12.1–12.5),
`docs/50-ships.md` (§1.4, §2, Приложения A–D, §11), `src/data/ships/hulls.json` (4 корпуса),
`src/data/ships/modules.json` (20 модулей), `src/data/buildings/surface.json` (14 записей; заводы §6
и универсальный завод комплектующих ОТСУТСТВУЮТ, `shipyard` — layer surface+orbit),
`src/data/buildings/orbit.json` (spaceport), `src/data/ships/shipyard-queue.ts` (enqueue/process/
cancel, SHIP_BUILD_TIME по корпусу, списание в тик завершения, конверсия 1 у.е.р.=5 steel+1 microchip),
`src/ships/ships-module.ts` (tick-проводка, SHIPFLOW-00 фикс коммита), `src/core/types.ts`
(ShipDesign, ShipyardQueue/Item, ProductionQueue/Item, RecipeDef, RecipeCategory, GameState),
`src/data/recipes.ts` (уровни 2–4: материалы/компоненты/модули; component_to_module на shipyard),
`src/economy/engine.ts` (карусель производства R-26), `src/core/module-types.ts` (PRIORITY),
`src/stores/game-store.ts` (сериализация очередей), `tests/ships/shipyard.test.ts` +
`tests/ships/shipyard-integration.test.ts`, `docs/STATUS.md`.

**14 расхождений D1–D14 зафиксированы** (полная таблица — docs/55 §3). Ключевые:
очередь хранит корабль целиком/время только по корпусу (getShipBuildTime по hull.size; «Σ(время_модуля)»
docs/50 Прил. C не соответствует коду); три взаимоисключающих правила конкурентности (docs/40 §7.1
таблица 1–4 проектов vs docs/50 ceil(N/2) vs runtime FIFO `items[0]`); 4 legacy-рецепта
component_to_module с buildingId 'shipyard' (make_ion_engine/make_laser/make_cargo_bay/make_scanner);
выходы рецептов не связаны с module IDs (ion_engine≠engine_ion_mk1); 16/20 ShipModule без рецептов;
заводы §6.1–6.5 и универсальный завод отсутствуют в surface.json (концепция, не код); у ShipModule нет
productionTime/recipeId; нет durable-статусов (ProductionItem/ShipyardQueueItem); резервирования нет
(списание в тик завершения); ShipDesign — мутабельная ссылка (designId читается в тик завершения);
наблюдение: в docs/40 две секции «11.5» (дублирование нумерации, вне рамок среза).

## 2. Создан docs/55-ship-production-flow.md (главный артефакт, 21 раздел)

- §1 принятые решения владельца (7 из тела Issue + 2 из ADDENDUM); §2 термины (build order, module job,
  цех, буферы, ledger); §3 аудит D1–D14 (таблица «расхождение → факт кода → факт docs → решение»).
- §4 стабильная схема `DESIGN_VALIDATED → BUILD_ORDER_CREATED → (HULL_WELDING ||
  MODULE_JOBS_QUEUED/RUNNING) → HULL_READY + ALL_REQUIRED_MODULES_READY → ORBITAL_FINAL_ASSEMBLY →
  LAUNCHED_TO_ORBIT` + enum статусов заказа (DESIGN_VALIDATED/BUILD_ORDER_CREATED/ACTIVE/
  READY_FOR_ASSEMBLY/FINAL_ASSEMBLY/LAUNCHED_TO_ORBIT/CANCEL_REQUESTED/DRAINING/CANCELLED) и задач
  (QUEUED/RUNNING/COMPLETED/BLOCKED_BY_SPECIALIZED_FACTORY/RETURN_TO_STOCK); критический путь, не сумма.
- §5 буферы per-planet + orbital assembly buffer; межпланетной логистики нет; internal transfer;
  переполнение не теряет изделия; хранение по количеству (индивидуальные ID — отдельный риск).
- §6 линии §6.1–6.5 + правила маршрутизации (явный recipe/product ID, НЕ ShipModule.category;
  canProduceRecipeAtFacility — единый runtime-authority helper для UI/enqueue/planner/backend) +
  mapping-таблицы: А (продукты §6 → аналоги recipes.ts → ShipModule, пробелы: процессор/датчик/квантовый
  процессор/система наведения/Гаусс/плазма/аннигилятор/щиты средний+тяжёлый+фазовый/нанитная броня —
  нет в каталогах; маршруты synthesizer vs §6), Б (20 ShipModule → предлагаемая линия; «нет линии» у
  ЦПУ/связь/навигатор/ЖО/баки/прыжковый/колонизационный/реактор), В (legacy component_to_module на
  верфи). Прямое покрытие — 4 из 20 модулей.
- §7 универсальный завод комплектующих: другой ID (не processor); −90% производительности ≈ 10×
  длительность — ЯВНОЕ балансное допущение (плейтест); per-planet блокировка после появления профильного
  завода (завод другой планеты не блокирует; policy возврата — «рецепт разрешён, только когда на планете
  нет рабочего профильного завода», детерминированно, не по порядку тикания); running jobs завершаются,
  not-started → BLOCKED_BY_SPECIALIZED_FACTORY (сохраняются, не удаляются, отмена вручную).
- §8 последовательная очередь (≤1 активного ship build project на верфь; детали только когда заказ стал
  текущим; Queue≠Stock; фиксация снимка дизайна при создании заказа — позднее изменение чертежа не
  меняет заказ); demand только от активного проекта, без дубликатов на повторных тиках/загрузках;
  арбитраж с ручными очередями: активные не прерываются, manual FIFO сохраняется, LPT только на
  свободных совместимых цехах, без скрытого starvation-решения.
- §9 ledger-инварианты (available≥0; reserved≤остаток; одно изделие — одно место
  free_stock/reserved_for_order/in_progress_output/assembly_buffer/installed_on_ship; готовые изделия
  привязаны к orderId; output не теряется при переполнении) + атомарность + решение refund при отмене.
- §10 LPT-планировщик: DAG, O(M+E) валидация циклов до активации, готовые задачи → сортировка по
  убыванию длительности (tie-break stable task ID), назначение в свободный совместимый цех с
  наименьшим ожидаемым завершением (tie-break facility ID → индекс цеха); один цех — ≤1 изделие;
  пример 100 деталей/10 заводов T; в смешанной системе мощность только по совместимым заводам;
  детерминизм, без Web Workers.
- §11 отмена: до FINAL_ASSEMBLY — CANCEL_REQUESTED/DRAINING (новые работы запрещены, активные
  доworkывают, готовое → на склад ровно один раз, резервы освобождаются атомарно); на/после
  FINAL_ASSEMBLY — явный not cancellable без мутаций; clear queue — ожидания отменяются, активный
  отменяемый — draining, FINAL_ASSEMBLY не трогается, потребившие ресурсы jobs не удаляются тихо;
  готовый корпус — reusable hull buffer (рекомендация, не измерено; без salvage-стоимостей).
- §12 финальная сборка: валидатор на границе READY_FOR_ASSEMBLY→FINAL_ASSEMBLY; одним commit —
  потребление + ровно один Ship; idempotency на стабильных ID; round-trip без дублей/утечек.
- §13 фиксированный порядок фаз тика (отмены/очистка → запрет новых работ draining → продвижение
  активных → однократная маршрутизация output → проверка перехода к FINAL_ASSEMBLY).
- §14 производительность: O(M+E) активация, O(A) тик (A≤ΣW_p), O(J log J)→heap O(log J), O(k) проверка
  ресурсов; 1 000–10 000 slots иллюстративно (не FPS/мс); bottleneck-список; bench/profiling до границ;
  UI батчить; планировщик внутри game tick.
- §15 failure analysis: 14 рисков → защита (двойное резервирование, дубли completion, утечка резервов,
  расхождение UI/backend — один helper, потеря blocked-записей, cancel race, консервация ledger,
  переполнение, DAG-валидация, starvation/LPT, legacy-миграция, O(all jobs log all jobs), чужая планета,
  mapping без category).
- §16 баланс цехов W(L): 4 модели, округление nearest integer half-up; таблицы L=1..10 — линейная
  1..10; линейная с бонусом 1,2,4,5..11 (явное пояснение: «1,2,4» — не строгая арифметическая
  прогрессия, невозможна при W(1)=1/W(3)=4; зафиксирован бонусный цех на L3 + 1/уровень); квадратичные
  round(1+2·((L−1)/2)²) → 1,2,3,6,9,14,19,26,33,42 и round(1+3·((L−1)/2)²) → 1,2,4,8,13,20,28,38,49,62;
  таблица волн ceil(100/(10·W(L))) для всех четырёх; запрет применять W(L) как speed multiplier
  (двойное масштабирование); РЕКОМЕНДАЦИЯ — линейная W(L)=L (простота, 1..10 цехов, без квадратичного
  взрыва 42–62); «4 цеха на L3» — только осознанный milestone-бонус.
- §17 расширение текущей системы (не дублирующий движок): RecipeDef+ (productKind/moduleId/
  facilityLine/universalAllowed — предложения), эволюция ProductionQueue (карусель R-26 сохраняется) и
  ShipyardQueue; перенастройка legacy component_to_module — отдельным шагом миграции; пробелы данных
  перечислены (числа НЕ придуманы).
- §18 данные/сейв: новые building records только описаны (electronics_plant/engine_plant/weapon_plant/
  shield_plant/hull_plant/universal_component_factory); будущие структуры (PlanetProductionPipeline,
  ShipBuildOrder + designSnapshot, ModuleJob) — optional; старые сейвы → пустой pipeline; legacy-заказы
  не теряются/не пересчитываются; никакого производства при deserialize; zod-валидация по образцу v3.
- §19 тест-контракты runtime-среза (12 пунктов: изоляция планет, конкуренция за последнюю деталь,
  enqueue без jobs/резерва, queue≠stock, universal plant lifecycle, cancel/draining/clear, save/load по
  фазам, переполнение, детерминизм ≥3 процессов, один активный проект на верфь, baseline-гейты).
- §20 продуктовые допущения (6, не хардкодить молча); §21 открытые вопросы владельцу (10, включая
  цены/энергии/времена новых заводов и модулей — НЕ выдуманы).

## 3. Согласующие правки (additive-first, рецепты/формулы не переписывались)

- `docs/40-buildings.md`: ссылка на docs/55 в Зависимостях; Изменён-строка; блок-примечание в §6
  (§6.1–6.5 — концепция, в surface.json записей нет; §6.5 не выпускает готовый корпус); таблица
  «Параллельная сборка» §7.1 помечена ⚠️ SUPERSEDED + блок LEGACY/SUPERSEDED с утверждённой
  последовательной очередью; формула assembly_time_ticks помечена ⚠️ LEGACY; примечание §7.2
  (сварка корпуса + финальная сборка, локальные буферы, internal transfer).
- `docs/50-ships.md`: Изменён-строка; примечание §1.4 (нет productionTime/recipeId — пробел данных;
  маршрутизация по явному ID; docs/55 §6.3/§17/§21); MIGRATION NOTE в Приложении C (docs/55 — целевая
  схема; правила ниже legacy текущего runtime: время по корпусу, списание без резерва); пометки legacy
  у трёх способов «сократить время» (Σ(время_модуля) не соответствует runtime; ceil(N/2) superseded);
  ссылка на docs/55 в §11 (Связанные документы).
- `docs/STATUS.md`: Сводка — «Спецификаций без игровой реализации» 1→2 (+SHIPFLOW docs/55); «Тестов»
  900→906 (+6 SHIPFLOW-00, актуализация после Task 51 — правка точности статуса); §3.1 — строка
  «Потоковое производство кораблей (SHIPFLOW)»: специфицировано, НЕ реализовано runtime (docs-only);
  История изменений — строка Task 52.

## 4. Запреты — соблюдены

src/ НЕ менялся (git status: только docs/40, docs/50, docs/55, STATUS.md + checkpoint/worklog);
runtime-тесты, scripts, каталоги зданий (`src/data/buildings/*`) и существующие production JSON —
не менялись; рецепты специализаций §6.1–6.5 сохранены дословно; численные стоимости/времена не
выдумывались (все числа — либо из Issue #13, либо из фактического кода/каталогов); статус
«реализовано» нигде не заявлен; история не переписывалась; push без force.

## 5. Гейты (реальные прогоны на рабочем дереве с docs-правками)

| Гейт | Результат |
|---|---|
| `bun test` (полный) | **906/906** (57 файлов, exit 0, Δ0 к базе SHIPFLOW-00 — docs-only, тесты не затронуты) |
| `bun run lint` | exit 0 — **0 errors / 38 warnings** (Δ0 к базе) |
| `bunx tsc --noEmit` | exit **1** (измерен) — **86 ошибок, Δ0 к baseline** (src/economy 50, src/components 15, …), в docs-файлах — 0; исторический ненулевой exit НЕ именуется PASS |
| `bun run validate:all` | exit 0 — **4/4** |
| `git diff --check` | чисто |
| Состав диффа | только `docs/40-buildings.md`, `docs/50-ships.md`, `docs/STATUS.md`, `docs/55-ship-production-flow.md` (новый), checkpoint, worklog — БЕЗ src/tests/scripts/JSON |
| CI | `.github/workflows` отсутствует — не заявляется |
| Браузерный smoke | НЕ выполнялся (docs-only; по условию задания отмечается только реально выполненный) |

Примечание к среде (не изменение репозитория): локальный `.env` создан из значения
`DATABASE_URL=file:/home/z/spacegame/db/custom.db` + `bun run db:push` (файл gitignored, в коммит не
входит) — та же средовая особенность, что задокументирована в worklog Tasks 50/51 (без .env 11 DB-тестов
падают в свежем клоне).

## 6. Изменённые файлы

- `docs/55-ship-production-flow.md` — НОВЫЙ, главная спецификация (21 раздел)
- `docs/40-buildings.md` — ссылки + пометки legacy §6/§7.1/§7.2 (текст рецептов §6.1–6.5 не менялся)
- `docs/50-ships.md` — ссылки + migration note + пометки legacy §1.4/Приложение C/§11
- `docs/STATUS.md` — Сводка (2 спецификации; 906 тестов) + §3.1 SHIPFLOW-строка + changelog
- `checkpoints/10_27_shipflow_docs_production_flow.md` — этот чекпоинт
- `worklog.md` — Task 52 (append-only)

## 7. Следующие шаги

- Приёмка SHIPFLOW-DOCS — за владельцем (Issue #13 НЕ закрывался агентом — по условию задания).
- Runtime-реализация заводов/конвейера — только после проверки владельцем результата спецификации
  (отдельный срез; тест-контракты §19 готовы).
- Issue #9 (R-45 AI, срез 3б.2) — остаётся открытым; к нему вернуться после SHIPFLOW-приёмки
  (порядок по последнему указанию владельца: производственная последовательность приоритетна).
