# ARCH-BUS-MAP-01 — Follow-up: исправление трёх находок независимого аудита (F1/F2/F3)

> **Задача:** Issue #17, follow-up round (комментарий владельца
> [6472418955](https://github.com/vivasua-collab/spacegame/issues/17#issuecomment-6472418955)).
> **База:** main `d38bae1e22c6f069c9df25a4db6f43e4b59993f4` (= origin/main на старте раунда).
> **Границы:** только генератор карты, его фикстуры/тесты, generated JSON и
> архитектурная документация. **Runtime-код `src/` не менялся** (см. §6).
> F-01…F-10 из module-contracts.md §7 не исправлялись (вне scope раунда).
> Визуальный портал не строился.

## 0. Что исправляется (находки аудита, комментарий 6471533872)

| # | Находка аудита | Решение |
|---|---|---|
| **F1** | `registeredBy`/`unregisteredBy`/`status` запросов считались по объединённому множеству prod+test (`everything`): тестовая регистрация `galaxy:system-by-id` попадала в production-поле JSON | production-поля — только из `src/`; test-only факты — отдельные поля `testRegisteredBy`/`testUnregisteredBy`; статус вычисляется только по production-регистрации |
| **F2** | `observed.emits` модуля собирался по правилу «файл модуля ИЛИ любой файл его директории»: `ShipsModule` и `FleetModule` (`src/ships/`) оба получали одинаковый список 9 фактов из `src/ships/fleet-engine.ts` как подтверждённое владение | владение = только файл объявления класса модуля; все прочие (engine/инфраструктура) — новая топ-уровневая секция `fileLevelEmits`, каждый факт ровно один раз, без утверждения владения |
| **F3** | контракт обещал статусы `active/partial/stub/reserved` (JSON — только 3 значения), поле `observed.dependencies` (в JSON отсутствует), тик-факты (в JSON только `positionInInitOrder`); в документе AIModule назван `partial`, в JSON — `active` | контракт сужен до того, что генератор доказывает: `registrationStatus` (только ось регистрации: active/unregistered/reserved); `observed.dependencies` убран из обещаний (dependencies — только declared; initOrder вычисляется ИЗ деклараций); `tick` задокументирован как только `positionInInitOrder`; зрелость реализации (`partial`) — human-оценка вне схемы (§3.6) |

## 1. Изменённые файлы (полный список)

**Runtime `src/` — 0 файлов.**

| Файл | Тип | Что изменено |
|---|---|---|
| `scripts/gen-module-bus-map.ts` | генератор | F1: `registeredBy`/`unregisteredBy` — prod-only, +`testRegisteredBy`/`testUnregisteredBy` (+2 помощника `testFactsQueryRegisters/Unregisters`); F2: `observed.emits` — own-file only, удалена эвристика `dirOf`, +топ-секция `fileLevelEmits` (`moduleFileSet`); F3: `status`→`registrationStatus`; +2 ограничения в `analyzer.limitations` (итого 10) |
| `docs/architecture/module-bus-map.json` | артефакт | перегенерирован (детерминизм байт-в-бит, §4) |
| `docs/architecture/module-contracts.md` | контракт | §1.1 (registrationStatus, fileLevelEmits, tick-only-position, dependencies-declared), §1.3 (prod-only + test-поля), §2.2 (production-only семантика), §2.3 (пере-писан: ось регистрации), §3.1–3.6 (заголовки), §6 (test-регистрации отдельно), §8 (+ограничения 7–8), §9 (новые фикстуры/тест схемы); шапка — ревизия follow-up |
| `tests/arch/module-bus-map.test.ts` | тесты | переименование `status`→`registrationStatus`; +регресс-тест F1; +регресс-тест F2; +2 теста на реальном репозитории (F1 prod-only; F2 fleet-engine не приписан ships/fleet); расширён query-тест (пустые test-поля при prod-регистрации) |
| `tests/arch/module-bus-map-schema.test.ts` | тесты (новый) | F3-конформность: наборы ключей (топ-уровень/модуль/observed/tick/событие/запрос), enum-значения 3 классификаций, запрет `status`/`implementationStatus`/`observed.dependencies`, границы файлов в prod/test полях, fileLevelEmits вне module-файлов, doc-sync проверки module-contracts.md |
| `tests/arch/fixtures/fx-f1-module.ts` | фикстура (новая) | F1: production-модуль объявляет `fx:f1-q`, регистрации в production НЕТ |
| `tests/arch/fixtures/fx-f1-nonprod-reg.ts` | фикстура (новая) | F1: единственные register/query/unregister — в non-production файле |
| `tests/arch/fixtures/shared/fx2-{events,module-types}.ts` | фикстуры (новые) | F2: отдельный каталог событий и ModuleId ('f2a'\|'f2b') |
| `tests/arch/fixtures/shared/fx2-{engine,alpha,beta}.ts` | фикстуры (новые) | F2: общий engine + два модуля одной директории, у каждого свой own-emit |

## 2. F1 — production query registration не satisfied тестами

- `QueryEntry.registeredBy/unregisteredBy` = `prod.queriesRegistered/queriesUnregistered` (только `src/`); `status` — по ним.
- Новые поля `testRegisteredBy`/`testUnregisteredBy` (агрегация `{file, lines[]}`, как `testCallers`) — тестовые регистрации/снятия видны, но на статус не влияют. `queryNames` по-прежнему включает test-регистрации (запрос виден в карте со статусом `unused`/`declared_not_registered` — честно).
- **Фикстура доказывает:** query объявлен production-модулем (`fx:f1-q`, `declaredHandles=['f1q']`), register/query/unregister только в тестовом файле → `status='declared_not_registered'`, `registeredBy=[]`, test-факты — только в `testRegisteredBy`/`testUnregisteredBy`/`testCallers`. Production-регистрация (`fx:q` в fx-module.ts) сохраняет `declared_and_registered` с пустыми test-полями.
- **На реальном репозитории:** `galaxy:system-by-id` — `registeredBy` = только `src/galaxy/galaxy-module.ts:76`; тестовые регистрации `tests/r42-stage01-reaudit.test.ts:678,681` → `testRegisteredBy`, снятие `:684` → `testUnregisteredBy`.

## 3. F2 — shared engine emissions без импликации владения

- Выбранный вариант (из двух предложенных аудитором): **топ-уровневая секция `fileLevelEmits`** — все production emit-факты из файлов, не являющихся файлом объявления ни одного модуля. `modules.*.observed.emits` — только own-file факты. Дублирования нет вовсе: каждый engine-факт встречается в JSON ровно один раз на module-уровне (плюс event-level `productionEmitters` по дизайну).
- **Фикстура доказывает:** два модуля одной директории (`f2a`/`f2b` в `tests/arch/fixtures/shared/`) + общий `fx2-engine.ts` с emission `f2:shared` → engine-факт НЕ в `observed.emits` ни одного модуля, в `fileLevelEmits` ровно 1 раз, списки владения модулей различны, event-level ссылка сохранена.
- **На реальном репозитории:** `src/ships/fleet-engine.ts` (9 фактов) больше не приписан ships/fleet; их `observed.emits` пусты (own-file без emit-вызовов); engine-факты в `fileLevelEmits` (51 факт: economy/engine 17, fleet-engine 9, game-store 13, game-loop 6, game-mediator 4, shipyard-queue 2). Event-level ссылки (`ships:arrived` → fleet-engine:391 и т.д.) сохранены байт-в-бит.

## 4. F3 — контракт = JSON (без смешения осей)

- `ModuleEntry.status` → **`registrationStatus`** ∈ {`active`,`unregistered`,`reserved`} — только ось регистрации. Зрелость (`partial`/`stub`) машинно не выводится; AIModule в §3.6: `registrationStatus: active`, зрелость partial — явно помечена как human-оценка вне карты.
- Обещание `observed.dependencies` удалено: `manifest.dependencies` — declared; `wiring.initOrder` задокументирован как вычисление ИЗ деклараций (реплика `recalculateInitOrder`), не «observed».
- `tick` задокументирован как ТОЛЬКО `positionInInitOrder`; подписки `core:tick` видны отдельно в `observed.subscriptions`; факт работающего тика картой не утверждается (F-01).
- **Тест схемы** (`tests/arch/module-bus-map-schema.test.ts`, 6 тестов): точные наборы ключей всех уровней карты, enum-членство (3/7/5 значений), отсутствие `status`/`implementationStatus`/`observed.dependencies` у модулей, file-границы prod/test в query-полях, `fileLevelEmits` вне module-файлов, doc-sync module-contracts.md. Любое расхождение генератора с контрактом теперь падает тестом.

## 5. Гейты (реальные прогоны на итоговом дереве; база d38bae1)

| Команда | Результат | Exit code |
|---|---|---|
| `bun test` | **959/959 pass** (61 файл) = 949 + 10 новых (F1, F2, 2 real-repo, 6 schema) | **0** |
| `bun run lint` | 0 errors / 38 warnings (Δ0 к базе) | **0** |
| `bunx tsc --noEmit` | exit 0 после правки схемы-теста; **86 ошибок baseline, 0 в изменённых файлах (Δ0)**. Промежуточно: 89 (3 × TS2769 в schema-тесте, `toContain` на readonly-кортеже) — исправлены | **0** (измерено на финальном дереве) |
| `bun run validate:all` | 4/4 валидатора | **0** |
| `git diff --check` | чисто | **0** |
| `bun run audit:module-bus --check` | артефакт актуален | **0** |
| Детерминизм | два последовательных `bun run audit:module-bus` — `cmp` байт-в-бит | identical |
| `git diff --stat -- src/` | пусто — runtime не менялся | — |

Честные примечания: TypeScript-гейт в этом раунде завершён с exit 0 (исторический
baseline-деревьев ранее давал exit 2 с 86 ошибками; на итоговом дереве этого раунда
ошибок 0 — воспроизведено повторным прогоном). Браузерный E2E в этом раунде не
запускался и не требуется (изменения — только инструмент/доки/тесты; UI не затронут).
CI/GitHub Actions в репозитории нет — не заявляется.

## 6. Подтверждение границы (runtime не менялся)

`git diff --stat -- src/` → пусто. Diff раунда: `scripts/gen-module-bus-map.ts`,
`tests/arch/*` (+9 файлов), `docs/architecture/module-bus-map.json`,
`docs/architecture/module-contracts.md`. Findings F-01…F-10 (module-contracts.md §7)
не исправлялись — решения за владельцем.

## 7. Ограничения / что не проверялось

- Анализатор по-прежнему синтаксический (без type-checker, без call-graph) — ограничения `analyzer.limitations` (10 пунктов, +2 новых).
- Два модуля, объявленных в ОДНОМ файле, разделят own-file emits (атрибуция файловая — задокументировано; в SpaceGame таких нет).
- `fileLevelEmits` — плоский список без группировки по подсистемам; владельческая интерпретация engine-фактов — за человеком (F-06).
- Схема-тест синхронизирован с текущей схемой вручную: добавление поля генератором потребует обновления теста (это намеренная защита от дрейфа).
- Не проверялось: поведение генератора на Windows-путях (только POSIX), производительность на деревьях > текущего размера.

## 8. Статус

Issue **#17 остаётся OPEN** — ожидается новый независимый аудит. Findings F-01…F-10 —
отдельные решения владельца. Визуальный портал поверх generated JSON — отдельная задача.
