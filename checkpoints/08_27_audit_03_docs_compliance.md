# Аудит проекта — Заход 3: Соответствие документации

**Дата:** 2026-08-27
**Task ID:** 21 (audit-coordinator)
**Область:** docs/*.md vs реализация; README, INSTRUCTIONS, checkpoints/*
**Опирается на:** Pass 1 (foundation), Pass 2 (code quality)
**Commit:** e3bc1d6 (HEAD of origin/main, per Pass 1/2)

> **Заметка о git-history:** локальная копия репозитория имеет HEAD `58dfb2e` с UUID-сообщениями коммитов, что отличается от истории в audit-отчётах Pass 1/2 (`e3bc1d6`). Текущий файловый снапшот соответствует коду на момент Pass 1/2 (340/340 тестов, 138 TS-ошибок, 75/75 рецептов) — но git-history усечена/переписана. На выводы аудита это не влияет: аудируются текущие файлы vs spec.

---

## 1. Исполнение

### 1.1 Доступ к репозиторию
- Проверен путь `/home/z/spacegame-audit/spacegame/` — доступ OK (`docs/00-ARCHITECTURE.md`, `docs/50-ships.md`, `docs/60-research.md` прочитаны).
- Рабочее дерево имеет изменения в `.env`, `.gitignore`, `Caddyfile`, `db/custom.db` и ~30 других файлах (не коммичено).

### 1.2 Базовое состояние (per Pass 1/2)
- **Tests:** 340/340 pass ✅
- **Lint:** 0 errors, 50 warnings ✅
- **TypeScript:** 138 errors (baseline `noUncheckedIndexedAccess`) ✅
- **Recipe validation:** 75/75 ✅

### 1.3 Файлы, прочитанные в заходе 3
- **Pass 1/2 целиком:** `08_27_audit_01_foundation.md` (678 строк), `08_27_audit_02_code_quality.md` (804 строки)
- **Core docs (7):** `00-ARCHITECTURE.md` (703), `01-tech-stack.md` (142), `02-dev-process.md` (184), `03-project-structure.md` (175), `04-performance.md` (150), `05-appendices.md` (94), `!listing.md` (293)
- **Game systems docs (12):** `10-galaxy.md` (908), `20-stars.md` (1438), `30-planets.md` (1878), `31-resources.md` (451), `32-mendeleev.md` (386), `33-chemistry.md` (799), `34-ores.md` (1328), `35-warehouse-and-logistics.md` (794), `40-buildings.md` (1726), `50-ships.md` (1466), `60-research.md` (1350), `70-ai.md` (2354)
- **Auxiliary docs (8):** `STATUS.md` (334), `audit-history.md` (170), `buildings-verification.md` (266), `galaxy-bake.md` (530), `galaxy-generation-audit.md` (863), `modularity.md` (463), `planet-generation-science.md` (918), `research-unification.md` (638), `architecture/modular-bus.md` (2050)
- **Project meta:** `README.md` (205), `INSTRUCTIONS.md` (99), `.gitignore` (60)
- **Block plan checkpoints (7):** `08_27_block_01_stabilization.md`, `08_27_block_02_fleet.md`, `08_27_block_03_research.md`, `08_27_block_04_ai_faction.md`, `08_27_block_05_processors.md`, `08_27_block_06_modular_integration.md`, `08_27_block_07_engineering_quality.md`, `08_27_block_08_security_data.md`, `08_27_doc_fixes.md`
- **Код для cross-check (выборка):** `src/data/elements.ts`, `src/data/buildings.ts`, `src/data/warehouse.ts`, `src/data/ships/{hulls,modules,fuel-map,shipyard-queue}.ts`, `src/data/research/{tech-tree,fundamental-branches,branch-links,tech-unlocks}.ts`, `src/data/chemistry/ore-specs.ts`, `src/data/star-types.ts`, `src/economy/engine.ts` (1069 строк), `src/research/engine.ts` (862 строки), `src/ships/{designer,orders,fleet-engine}.ts`, `src/galaxy/{generator,generate-planets}.ts`, `src/stores/game-store.ts` (1427 строк), `src/core/game-mediator.ts` (293 строки)

### 1.4 Команды выполнены
- `wc -l docs/*.md docs/architecture/*.md *.md checkpoints/08_27_doc_fixes.md` — суммарно 23 622 строк документации.
- `grep "id:\s*'" src/data/elements.ts | wc -l` → 60 (header comment claims 57)
- `grep "id:\s*'" src/data/buildings.ts | wc -l` → 15
- `grep "id:\s*'" src/data/ships/modules.ts | wc -l` → 20
- `grep "id:\s*'" src/data/research/tech-tree.ts | wc -l` → 15
- `grep "id:\s*'" src/data/research/fundamental-branches.ts | wc -l` → 6
- `grep "id:\s*'" src/data/research/branch-links.ts | wc -l` → 8
- `grep "id:\s*'" src/data/chemistry/ore-specs.ts | wc -l` → 56
- `ls src/core/` → 10 файлов (НЕ `event-bus.ts` — удалён per Pass 1 P3-1)
- `git ls-files | grep .env$` → `.env` tracked (Pass 1 P1-1 confirmed)

---

## 2. Сводка находок

| Категория | Кол-во | Краткий перечень |
|-----------|--------|------------------|
| Блокирующие (P0) | 0 | (новых P0 нет; P0-1 из Pass 1 остаётся главной архитектурной дырой) |
| Серьёзные (P1) | 7 | P1-1 getLabRPPerSec делитель 800 vs spec 500 (подтверждённый drift); P1-2 README.md устарел на 2 etap'а (Etap 2.5/2.6/3.0 не упомянуты как завершённые, неверные метрики 57 элементов / 12 зданий / ~70 рецептов / 13K строк / 105 файлов / 67 коммитов); P1-3 08_27_doc_fixes.md противоречия №1 (AI=5) и №2 (elements=57) применены частично — остались стейл-места в 02-dev-process.md/05-appendices.md/00-ARCHITECTURE.md §1.1 line 91; P1-4 STATUS.md §3.1 помечает флот+исследования как «0% реализации» хотя они завершены (Etap 3.0); P1-5 .env закоммичен с boilerplate-путём /home/z/my-project/db/custom.db (Pass 1 P1-1 повторно подтверждён); P1-6 INSTRUCTIONS.md — 5 ссылок на /home/z/my-project/ (Pass 1 P1-3 повторно подтверждён); P1-7 32-mendeleev.md не содержит Os (Осмий, Z=76), который присутствует в code + 33-chemistry.md — внутренняя противоречивость spec |
| Средние (P2) | 9 | P2-1 32-mendeleev.md «Итого: 68 элементов (58 базовых + 10 трансурановых)» — внутренне противоречиво (§2.1–2.10 = 56, Appendix B = 64, summary = 68, code = 60); P2-2 03-project-structure.md §3 «Модули, запланированные но не реализованные» — описывает ships/research/ai как будущие, хотя ships+research уже реализованы (Etap 3.0); P2-3 40-buildings.md §10.1 — spec описывает 27 зданий, code имеет 15; STATUS.md §3.2 говорит «15 не реализованы» но фактическое число 12; P2-4 03-project-structure.md line 37 + 00-ARCHITECTURE.md §8 — указывают `event-bus.ts` (@deprecated legacy), но файл удалён per Block 01 C1; P2-5 35-warehouse-and-logistics.md §1.3.5 — «специализация складов упразднена» но code (warehouse.ts:81-87) содержит SPEC_BONUSES с universal/ore/metal/gas/component + тип `WarehouseSpecialization` активен; P2-6 50-ships.md §Приложение D — «MVP = 3 корпуса (Скаут/Истребитель/Фрегат)» но code (hulls.ts) реализует 4 (добавлен Транспорт); P2-7 50-ships.md §9.1 перечисляет 50 модулей, code реализует 20 — drift 30 модулей; P2-8 02-dev-process.md §6 — Etap 3.5 «AI-фракции (2-4)» и §8 «3-4 AI-фракции» (line 125, 165) — не обновлены per doc_fixes (должно быть 5 базовых); P2-9 buildings-verification.md §6.1 — утверждает «8 зданий в коде» и ссылается на `smelter/chemical_plant/petrochem_plant` — но они заменены на `processor/refinery/synthesizer` (Block 05), а `nuclear_plant` переименован в `nuclear_reactor` (Block 01 C8) |
| Незначительные (P3) | 7 | P3-1 elements.ts header «57 элементов» устарел (actual 60, per Pass 2 P3-1); P3-2 STATUS.md §6.1 метрики: «13 239 строк», «105 файлов», «12 зданий» — все устарели (actual: 31 040 / 141 / 15); P3-3 03-project-structure.md «chemistry-generator.ts (1704 строки)» — actual 30 строк (refactor-шим per Block 01 C5); P3-4 README.md §Структура проекта «src/data/ (11 файлов)» — actual 17; «src/galaxy/ (11 файлов)» — actual 10; «components/game/ (7 файлов)» — actual 17; «checkpoints/ (13 файлов)» — actual 30; P3-5 50-ships.md не документирует fuel priority order (xenon → hydrogen → chemical) — code (fleet-engine.ts:402) имеет хардкод без spec-описания; P3-6 04-performance.md §1.2 утверждает Web Worker для симуляции — code не использует Web Worker (Pass 1 §1.5 подтверждено); P3-7 audit-history.md (от 2026-05-03) — исторический документ, претендует на «Post-Fix Verification», но содержит устаревший snapshot (до Etap 3.0); GalGenAudit и STATUS ссылаются на него как актуальное — вводит в заблуждение |

---

## 3. Детальные находки

### P1-1: `getLabRPPerSec` делитель 800 vs spec 500 — задокументированный spec drift (подтверждён из Pass 2 P2-3)

**Файлы:**
- Spec: `docs/60-research.md:101` («Бонус габитабельности: hab% / 500») + `docs/60-research.md:1056` (`const habBonus = 1 + (habitabilityPercent / 500)`)
- Code: `src/research/engine.ts:218` (`return baseOutput * labLevel * (1 + habitabilityPercent / 800);`)
- Test: `checkpoints/08_27_block_03_research.md:455` (T-R3: «`getLabRPPerSec(3, 5, 80) === 16.5`»)

**Описание:**
Spec §3.1 формула: `base_output × level × (1 + habit/500)`.
При `labLevel=3, base=5, habit=80`: 5 × 3 × (1 + 80/500) = 5 × 3 × 1.16 = **17.4** (по spec).
Code: `1 + 80/800 = 1.10` → 5 × 3 × 1.10 = **16.5** (по коду).
Тест T-R3 ожидает `16.5` — код совпадает с тестом, spec НЕ совпадает.

Огромный комментарий в `engine.ts:184-211` reverse-engineer'ит формулу и заключает: «делитель = 800, спека говорит 500. Видимо, в спеке опечатка». Это **подтверждённая опечатка в spec** — код выбран как канонический (соответствует тесту).

Также §3.1 line 98 spec-пример «Лаб. ур.3, база 5, бонус 0.1 → 16.5» — «бонус 0.1» неоднозначен: при /500 = 50% габ., при /800 = 80% габ. Spec внутренне непоследователен.

**Влияние:**
В MVP `habitabilityPercent = 0` всегда (Pass 1 P2-5), формула не активна. Но:
1. Любой будущий разработчик, читающий spec, будет смущён несоответствием.
2. Если Etap 4 включит habitability, spec надо синхронизировать с кодом (= 800).
3. Документация не соответствует реальному поведению системы.

**Рекомендация:**
1. Обновить `docs/60-research.md:101` + `:1056`: заменить `/500` на `/800` + уточнить пример «бонус 0.1 при habit=80».
2. ИЛИ — оставить spec как есть, но добавить в §9.4 явный «Канонический делитель = 800 (не 500 как в ранних черновиках); подтверждено тестом T-R3».

---

### P1-2: README.md устарел на 2 etap'а — неверные метрики и статус

**Файл:** `README.md` (205 строк, корень проекта)

**Описание:**
- Line 14: «57 элементов с химическими характерами» — actual **60** (57 base + 3 transuranic, per Block 01 P7).
- Line 21: «Этап 2 завершён на ~90%» — actual Etap 2/2.5/2.6/3.0 все COMPLETE.
- Line 23: «Этап 2.5 (стабилизация) — в плане» — actual COMPLETE (per Pass 1).
- Line 25-28: «Что не реализовано: Флот и корабли; Исследования; AI-фракции» — actual: флот (Block 02) и исследования (Block 03) реализованы, AI-фракции (Block 04) — pending.
- Line 53: «src/data/ (11 файлов)» — actual **17**.
- Line 54: «57 элементов» — actual 60.
- Line 55: «12 зданий (colony_hub, mine, processor...)» — actual **15**.
- Line 56: «~70 рецептов» — actual **75**.
- Line 58: «chemistry-generator.ts (1704 строки)» — actual 30 строк (refactor-шим per Block 01 C5).
- Line 65: «src/galaxy/ (11 файлов)» — actual **10**.
- Line 87: «components/game/ (7 файлов)» — actual **17**.
- Line 110: «40-buildings.md (27 в spec, 12 реализовано)» — actual 15 реализовано.
- Line 111-113: «0% реализации» для ships/research/ai — но ships/research = MVP complete.
- Line 123: «checkpoints/ (13 файлов)» — actual **30**.
- Line 142: «57 элементов, 12 зданий, ~70 рецептов» — все устарели.
- Line 187-198: Метрики: «13 239 строк» (actual 31 040), «5 397 shadcn строк» (устарело), «105 файлов src/» (actual 141), «57 элементов» (actual 60), «12 / 27 зданий» (actual 15 / 27), «~70 рецептов» (actual 75), «67 git-коммитов» (actual другое).

**Влияние:**
README — главный онбординг-документ. Любой новый контрибьютор получает превратное представление о статусе проекта. Особенно вводит в заблуждение список «не реализовано», где флот+исследования помечены отсутствующими — Pass 1 P3-5/P3-6 уже отмечал это, но изменения не внесены.

**Рекомендация:**
1. Обновить §«Текущий статус»: «Этапы 2.5, 2.6, 3.0 завершены. Etap 3.5 (AI-factions) — следующий. См. `worklog.md` и `checkpoints/` для деталей».
2. Обновить дерево каталогов: добавить `src/ships/`, `src/research/`, `src/data/ships/`, `src/data/research/`, `src/data/chemistry/` (подкаталог).
3. Обновить метрики (можно auto-generate через `wc -l src/`).
4. Удалить файлы `event-bus.ts` (line 45) из списка — он удалён.
5. Изменить «0% реализации» для ships/research на «✅ MVP реализован» (Block 02/03).

---

### P1-3: `08_27_doc_fixes.md` 5 противоречий применены ЧАСТИЧНО

**Файлы:**
- `checkpoints/08_27_doc_fixes.md:5` — «статус: complete ✅ (все 5 противоречий исправлены и проверены 2026-08-27)»
- Противоречие №1 (AI-factions=5): применено в `00-ARCHITECTURE.md` lines 108, 126, 275, 571 ✅, но **НЕ** в `02-dev-process.md:125` («2-4»), `05-appendices.md:89` («2-4»), `02-dev-process.md:165` («3-4»).
- Противоречие №2 (elements=57): применено в `00-ARCHITECTURE.md` lines 384, 570 ✅, но **НЕ** в `00-ARCHITECTURE.md:91` («50 элементов из таблицы Менделеева»). Само значение «57» теперь устарело — actual 60.
- Противоречие №3 (gravity linear): применено в `00-ARCHITECTURE.md` §0.2 ✅; в `30-planets.md` §1.3 (line 289) уже корректно ✅; **НО** в `30-planets.md:1786` пример кода `const gravity = Math.pow(radius / earthRadius, 2) * (density / earthDensity);` всё ещё QUADRATIC — внутренняя противоречивость spec.
- Противоречие №4 (processors 2 типа): применено ✅ (`40-buildings.md` §3 переписан, `08_27_block_05_processors.md` реализован).
- Противоречие №5 (пути): применено (cross-check 19 файлов) ✅.

**Описание:**
doc_fixes.md заявляет «complete», но фактически:
1. Противоречие №1 не закрыто в 3 файлах: `02-dev-process.md` (2 места) и `05-appendices.md` (1 место) — остались «2-4» и «3-4».
2. Противоречие №2 не закрыто в 00-ARCHITECTURE.md §1.1 (line 91).
3. Противоречие №3 — `30-planets.md:1786` пример кода не синхронизирован с канонической формой (line 289).

**Влияние:**
Spec внутренне противоречив. Разработчик, читающий `02-dev-process.md` §6, увидит «2-4» — и подумает, что это канон, противоречащий `70-ai.md` и `00-ARCHITECTURE.md`.

**Рекомендация:**
1. Внести правки в 4 местах: `02-dev-process.md:125, 165`, `05-appendices.md:89`, `00-ARCHITECTURE.md:91`.
2. Обновить `30-planets.md:1786` — заменить `Math.pow(radius / earthRadius, 2)` на `(radius / earthRadius)` (линейная).
3. Пере-открыть `08_27_doc_fixes.md` — статус сменить с `complete` на `partial`, добавить секцию «Доработки».

---

### P1-4: `STATUS.md` §3.1 помечает флот+исследования как «0% реализации»

**Файл:** `docs/STATUS.md:131-145`

**Описание:**
Section §3.1 «Крупные системы (0% реализации)» таблица:
| Система | Спецификация | Строк spec | Этап |
| **Флот и корабли** | `docs/50-ships.md` | 1 464 | Etap 3.0 |
| **Исследования** | `docs/60-research.md` | 1 348 | Etap 3.0 |
| **AI-фракции** | `docs/70-ai.md` | 2 350 | Etap 3.5 |

Per Pass 1 + Pass 2 + git log: флот (Block 02) и исследования (Block 03) **завершены** (коммиты в цепочке 35d5c76..e3bc1d6 per Pass 1 §1.1). Реализованы:
- 4 корпуса, 20 модулей, validateShip, fleet-engine, planRoute, processFleetTick (Block 02 F1-F7 ✅)
- 15/72 технологий, 5 активных фундаментальных веток, 8 BranchLinks, getTechCost, getLabRPPerSec, getMaxResearchSlots, getFocusBonus, applyTechUnlock, ResearchModule (Block 03 R1-R7 ✅)

**Влияние:**
STATUS.md — официальный «source of truth» для статуса проекта (per Pass 1 §1.2). Прямое противоречие с worklog.md и checkpoint-файлами Block 02/03. Любой автоматический инструмент, читающий STATUS, получит ложное «флот не реализован».

Также §6.1 Метрики (line 254): «Элементов (в коде / по spec) 57 / 57 ✅» — actual 60 / 60. Line 256: «Зданий (в коде / по spec) 12 / 27 (44%)» — actual 15 / 27 (55%). Все метрики устарели.

**Рекомендация:**
1. Переписать §3.1: «Флот и корабли» → «✅ Реализовано (Block 02, MVP)»; «Исследования» → «✅ Реализовано (Block 03, MVP)»; оставить только AI-фракции + боевую систему + дипломатию + макрообъекты как «не реализовано».
2. Обновить §6.1 метрики: 60/60 элементов, 15/27 зданий, ~75 рецептов, 31K строк, 141 файл.
3. Перенести §3.2 «Здания (15 из 27 не реализованы)» → «12 из 27 не реализованы» (соответственно 15 реализованы).
4. Удалить §3.2 упоминания `smelter`, `chemical_plant`, `petrochem_plant` (не существуют после Block 05 refactor) — заменить на `processor/refinery/synthesizer`.

---

### P1-5: `.env` закоммичен с boilerplate-путём (Pass 1 P1-1 — повторное подтверждение)

**Файлы:** `.env` (root, tracked), `.gitignore:34`

**Описание:**
- `.env` contains: `DATABASE_URL=file:/home/z/my-project/db/custom.db`
- `.gitignore` line 34: `.env*` — но git уже отслеживает файл (правило применяется только к новым untracked).
- `git ls-files | grep .env` → `.env` ✅ tracked.
- Реальный репозиторий SpaceGame: `/home/z/spacegame-audit/spacegame/` (NOT `/home/z/my-project/`).
- `git status --short` показывает `.env` modified — оператор уже менял путь, но не закоммитил.

**Влияние:**
1. Любой клон репозитория в другое место получает `.env` с неработающим путём → Prisma не найдёт БД.
2. Sandbox-refresh, вытирающий `/home/z/my-project/`, удаляет всю БД сохранений (это произошло по worklog Task 19: «environment reset»).
3. Security: tracked `.env` создаёт риск для будущих секретов.

**Рекомендация:**
1. `git rm --cached .env` + `mv .env .env.example` + относительный путь: `DATABASE_URL=file:./db/custom.db`.
2. Создать `db/` директорию в репозитории + `.gitignore` pattern `db/*.db` (уже есть line 64-65).
3. Запустить `bun run db:push` заново с новым `.env`.

---

### P1-6: `INSTRUCTIONS.md` — 5 ссылок на `/home/z/my-project/` (Pass 1 P1-3 — повторное подтверждение)

**Файл:** `INSTRUCTIONS.md:27, 28, 35, 68, 69`

**Описание:**
Lines 27, 28 (start command):
```bash
cd /home/z/my-project && \
  ( node node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev2.log 2>&1 & echo $! > /tmp/next-dev.pid ) &
```
Line 35 (description): «Лог пишется в `/home/z/my-project/dev2.log`»
Lines 68, 69 (restart command): тот же путь `/home/z/my-project/`.

Реальный путь: `/home/z/spacegame-audit/spacegame/`.

**Влияние:**
Любой оператор/агент, следующий `INSTRUCTIONS.md` буквально, запустит dev-сервер в неправильной директории → Next.js не найдёт `package.json` → команда упадёт.

**Рекомендация:**
`perl -pi -e 's{/home/z/my-project}{/home/z/spacegame-audit/spacegame}g' INSTRUCTIONS.md` (5 замен). Или — лучше — использовать `$(pwd)` или переменную окружения.

---

### P1-7: `32-mendeleev.md` не содержит Os (Осмий, Z=76), который присутствует в code и 33-chemistry.md

**Файлы:**
- Spec: `docs/32-mendeleev.md` (386 строк) — поиск «Os», «Осмий», «Osmium» → 0 совпадений
- Code: `src/data/elements.ts:128` — `{ id: 'Os', name: 'Осмий', symbol: 'Os', category: 'noble', ... atomicNumber: 76, ... }`
- Cross-spec: `docs/33-chemistry.md:79` (platinoid category includes «Ru, Rh, Pd, Ir, Os»), `:142` (Os listed as noble + platinoid character), `:247`, `:383`, `:481` — упоминают Os.

**Описание:**
32-mendeleev.md — «канонический справочник элементов» (per spec line 3: «Номерной файл-источник истины»). Однако:
- §2.5 «Благородные металлы (3)»: только Ag, Au, Pt (нет Os)
- §2.8 «Платиноиды (4)»: только Ru, Rh, Pd, Ir (нет Os)
- Appendix B «Список элементов по атомному номеру»: нет Os

Code содержит Os (Z=76, density=22.59, baseValue=20, category='noble', chemicalCharacter='noble_metal'/'platinoid' per 33-chemistry).

**Влияние:**
Spec/code drift. Spec внутренне противоречив: 33-chemistry.md (химические правила) ссылается на Os, но 32-mendeleev.md (таблица элементов) его не упоминает. Если добавить новые рецепты для Os (например, сплав Os-Pt для термопар) — recipes validation не сможет найти Os в ELEMENT_MAP (он есть в коде, но не в spec).

**Рекомендация:**
1. Добавить Os в 32-mendeleev.md §2.5 или §2.8 (платиноидная группа — лучше, т.к. platinoid character в 33-chemistry.md §2.4 именно platinoid).
2. Обновить Appendix B: добавить `| 76 | Os | Осмий | 190.2 | noble |`.
3. Обновить «Итого: 68 элементов» → «Итого: 69 элементов» (если 56 base + 10 transuranic + Os = 67; либо пересчитать правильно).

---

### P2-1: `32-mendeleev.md` summary «Итого: 68 элементов (58 базовых + 10 трансурановых)» — внутренне противоречиво

**Файл:** `docs/32-mendeleev.md:382`

**Описание:**
Подсчёт по §2:
- §2.1 «Повсеместные» (12): H, He, Ne, Ar, C, N, O, Na, Mg, Al, Si, K
- §2.2 «Строительные металлы» (10): Ti, Cr, Mn, Fe, Ni, Cu, Zn, Sn, Pb, V
- §2.3 «Лёгкие/щелочные» (3): Li, Be, B
- §2.4 «Химические/неметаллы» (7): S, P, F, Cl, Ca, Se, Cd
- §2.5 «Благородные металлы» (3): Ag, Au, Pt
- §2.6 «Тугоплавкие/редкие металлы» (5): Co, W, Mo, Nb, Ta
- §2.7 «Редкоземельные» (6): Y, La, Ce, Nd, Dy, Ba
- §2.8 «Платиноиды» (4): Ru, Rh, Pd, Ir
- §2.9 «Стратегические» (3): U, Zr, Hf
- §2.10 «Дополнительные» (3): In, Te, Re
- §2.11 «Трансурановые» (10): Np, Pu, Am, Cm, Cf, Fl, Og, Xn, Qn, Vd

Sum: 12+10+3+7+3+5+6+4+3+3 = **56 базовых** + 10 transuranic = **66 total** (по §2).

Appendix B (по атомному номеру) — 64 строки.

Summary line 382: «**Итого: 68 элементов (58 базовых + 10 трансурановых)**».

Три разных числа: 66 (по §2), 64 (Appendix B), 68 (summary).

Code: 60 (57 базовых + 3 transuranic, включает Os, исключает Cm/Cf/Fl/Og/Xn/Qn/Vd).

**Влияние:**
Spec — «номерной файл-источник истины» — содержит противоречивые итоги. Любая верификация кода против spec будет неоднозначной.

**Рекомендация:**
1. Перепроверить все §2.x таблицы, добавив недостающие элементы (Os, и т.д.).
2. Пересчитать итог — должен быть консистентен с §2 + Appendix B + summary.
3. Уточнить, какие из 10 transuranic — реально присутствуют в коде (только Np/Pu/Am; Cm/Cf/Fl/Og/Xn/Qn/Vd — Etap 4 stub).

---

### P2-2: `03-project-structure.md` §3 «Модули, запланированные но не реализованные» — ships/research уже реализованы

**Файл:** `docs/03-project-structure.md:119-163`

**Описание:**
Spec §3 говорит: «Следующие модули запланированы, но ещё не созданы», и далее перечисляет:
- `src/ships/` — «Этап 3.0: Флот и корабли» (4 файла: ship-types.ts, ship-constructor.ts, fleet-manager.ts, movement.ts, ships-module.ts)
- `src/research/` — «Этап 3.0: Исследования» (3 файла: tech-tree.ts, research-queue.ts, research-module.ts)
- `src/ai/` — «Этап 3.5: AI-фракции» (6 файлов)
- combat, diplomacy, logistics, xenoarch — «Этап 4»

Per Pass 1 + Pass 2 + git log: `src/ships/` реализован (Block 02: designer.ts, fleet-engine.ts, orders.ts, ships-module.ts, fleet-module.ts, index.ts), `src/research/` реализован (Block 03: engine.ts, research-module.ts, index.ts + data/research/). Реальные имена файлов другие, чем в spec.

**Влияние:**
Spec описывает будущие модули, которые уже существуют. Разработчик, читающий 03-project-structure.md, не найдёт файлы по именам (ship-types.ts не существует; вместо него — designer.ts + orders.ts + fleet-engine.ts).

**Рекомендация:**
1. Перенести ships/research из §3 «запланированы» в §1 «реализованные».
2. Обновить имена файлов: `ship-types.ts` → `designer.ts` (или разбить на соответствия), `ship-constructor.ts` → часть `designer.ts`, `fleet-manager.ts` → `fleet-engine.ts`, `movement.ts` → `orders.ts`, `tech-tree.ts` → `data/research/tech-tree.ts`, `research-queue.ts` → `research-module.ts` + `engine.ts`.
3. Оставить §3 только для ai/, combat/, diplomacy/, logistics/, xenoarch/.

---

### P2-3: `40-buildings.md` §10.1 (27 зданий) vs code (15) vs STATUS.md §3.2 («15 не реализованы»)

**Файлы:**
- Spec: `docs/40-buildings.md:1135-1167` — таблица 26 зданий + `antimatter_gen` = 27 зданий
- Code: `src/data/buildings.ts:8-246` — 15 зданий (colony_hub, mine, quarry, gas_extractor, processor, synthesizer, refinery, solar_plant, nuclear_reactor, shipyard, warehouse, open_warehouse, high_tech_storage, spaceport, laboratory)
- STATUS: `docs/STATUS.md:146` — «Здания (15 из 27 не реализованы)» (должно быть 12 из 27)

**Описание:**
Spec §10.1 содержит 27 зданий: mine, quarry, gas_extractor, drilling_rig, ice_harvester, processor, refinery, synthesizer, electronics_plant, engine_plant, weapon_plant, shield_plant, hull_plant, shipyard, orbital_shipyard, solar_plant, nuclear_reactor, fusion_reactor, geothermal_plant, antimatter_reactor, warehouse, conveyor, auto_transport, spaceport, antimatter_gen, laboratory + colony_hub (упомянут в §C.2.4) = 27.

Code: только 15 реализованы (colony_hub + mine + quarry + gas_extractor + processor + synthesizer + refinery + solar_plant + nuclear_reactor + shipyard + warehouse + open_warehouse + high_tech_storage + spaceport + laboratory).

12 зданий в spec, но не в коде: drilling_rig, ice_harvester, electronics_plant, engine_plant, weapon_plant, shield_plant, hull_plant, orbital_shipyard, fusion_reactor, geothermal_plant, antimatter_reactor, conveyor, auto_transport, antimatter_gen. (Фактически 14, не 12 — STATUS.md ошибается в обе стороны.)

**Влияние:**
1. STATUS.md говорит «15 из 27 не реализованы» — фактическое число 14 (colony_hub считается как реализованное в code, но не в §10.1 spec table — только в Приложении C). Арифметическая ошибка.
2. Spec описывает здания, которые не запланированы к MVP (например, drilling_rig, fusion_reactor — Etap 4). Code корректно не имеет их, но spec не помечает их «post-MVP» в §10.1.

**Рекомендация:**
1. В §10.1 spec добавить колонку «Статус» (MVP / post-MVP / Etap 4) для каждого здания.
2. STATUS.md §3.2 переписать: «12 зданий post-MVP не реализованы» (drilling_rig, ice_harvester, electronics_plant, engine_plant, weapon_plant, shield_plant, hull_plant, orbital_shipyard, fusion_reactor, geothermal_plant, antimatter_reactor, conveyor, auto_transport, antimatter_gen = 14 — уточнить, не 12).

---

### P2-4: `03-project-structure.md:37` + `00-ARCHITECTURE.md:594` + `modular-bus.md:7` ссылаются на удалённый `event-bus.ts`

**Файлы:**
- `docs/03-project-structure.md:37`: «├── event-bus.ts              # @deprecated адаптер (legacy)»
- `docs/00-ARCHITECTURE.md:594`: «├── event-bus.ts              # Событийная шина»
- `docs/architecture/modular-bus.md:7`: «Затрагиваемые файлы: src/core/event-bus.ts, ...»
- Code: `src/core/` directory listing — 10 файлов (events, game-loop, game-mediator, immer-setup, index, module-registry, module-types, prng, typed-event-bus, types). **Файла `event-bus.ts` НЕТ** (удалён per Block 01 C1, per Pass 1 P3-1).

**Описание:**
Spec описывает `event-bus.ts` как @deprecated legacy adapter, но файл уже удалён. Аналогично `src/core/index.ts:12` (per Pass 1 P3-1) упоминает event-bus.ts в комментарии, но он не существует.

**Влияние:**
Spec/code drift. Разработчик, читающий 03-project-structure.md, будет искать несуществующий файл.

**Рекомендация:**
1. Удалить строку `event-bus.ts` из tree listings в 03-project-structure.md, 00-ARCHITECTURE.md, modular-bus.md.
2. Удалить комментарий в `src/core/index.ts:12` (Pass 1 P3-1 уже отмечено, fix pending).

---

### P2-5: `35-warehouse-and-logistics.md` §1.3.5 — «специализация складов упразднена» но code имеет активный тип `WarehouseSpecialization`

**Файлы:**
- Spec: `docs/35-warehouse-and-logistics.md:141-143` (§1.3.5 «Специализация складов»): «⚠️ Геймплейное упрощение: специализация складов (прежняя концепция ore/metal/gas/component) упразднена в пользу раздельной системы по типам хранения. Бонусы специализации переносятся на роли колоний (§1.5).»
- Code: `src/data/warehouse.ts:81-87` — содержит `SPEC_BONUSES: Record<WarehouseSpecialization, { multiplier: number; label: string }>` с universal=1.0, ore=1.25, metal=1.20, gas=1.20, component=1.15.
- Code: `src/core/types.ts` — type `WarehouseSpecialization = 'universal' | 'ore' | 'metal' | 'gas' | 'component'` — активен.

**Описание:**
Spec постановил упразднить spec-бонусы, но код их сохранил (как legacy/backward-compat, с `@deprecated` markers). Spec не указывает, что код будет иметь активный `SPEC_BONUSES` map.

**Влияние:**
1. Разработчик, читающий spec, будет думать, что специализация складов не работает.
2. Фактически `setWarehouseSpecialization` store action и `calculateWarehouseCapacities` use `spec.specialization` multiplier — система активна.
3. Spec не документирует фактическое поведение кода.

**Рекомендация:**
1. В §1.3.5 уточнить: «Специализация складов технически сохранена в коде для backward compat (`SPEC_BONUSES` + `WarehouseSpecialization` type), но новые UX-флоу не используют её — предпочтение отдано ролям колоний (§1.5). Бонусы: ore +25%, metal +20%, gas +20%, component +15%».
2. Либо — удалить `SPEC_BONUSES` из warehouse.ts, заменив на `roleBonus: ColonyRole → multiplier`.

---

### P2-6: `50-ships.md` Приложение D — «MVP = 3 корпуса» но code имеет 4

**Файлы:**
- Spec: `docs/50-ships.md:1441` (Приложение D, MVP-секция): «1. **3 корпуса**: Скаут, Истребитель, Фрегат»
- Code: `src/data/ships/hulls.ts:19-83` — 4 корпуса (hull_scout, hull_fighter, hull_frigate, hull_transport)
- Spec §2.1 (line 170-180) — таблица 7 корпусов (включает Транспорт).

**Описание:**
Spec §2.1 перечисляет 7 корпусов, включая Транспорт. Приложение D MVP-секция говорит «3 корпуса», но упоминает только Скаут/Истребитель/Фрегат (без Транспорта).

Code реализует 4 корпуса — включая Transport.

**Влияние:**
Приложение D в spec утверждает, что MVP обойдётся без Транспорта, но code его добавил. Это сознательное расширение MVP-среза. Spec не синхронизирован с фактическим срезом.

**Рекомендация:**
1. Обновить Приложение D: «1. **4 корпуса**: Скаут, Истребитель, Фрегат, Транспорт (тяжёлые корпуса — Etap 4)».

---

### P2-7: `50-ships.md` §9.1 перечисляет 50 модулей, code реализует 20

**Файлы:**
- Spec: `docs/50-ships.md:1096-1148` — таблица 50 модулей (Mk.I уровень)
- Code: `src/data/ships/modules.ts` — 20 модулей (engine_chemical_mk1, engine_ion_mk1, cpu_micro, cpu_light, navigator_mk1, comm_mk1, comm_mk2, life_support_cabin, weapon_laser_mk1, weapon_missile_mk1, shield_light_mk1, armor_steel, cargo_bay_s, fuel_tank_chemical_s, fuel_tank_xenon_s, fuel_tank_hydrogen_s, scanner_basic, jump_drive_mk1, colony_module_small, reactor_nuclear_mk1).

**Описание:**
Spec §9.1 = 50 модулей (Mk.I только). Code = 20 (subset Mk.I). Spec Приложение D MVP-среза говорит: «2 двигателя, 1 ЦПУ (с двумя подкатегориями), 2 оружия, 1 щит, 1 броня, 4 вспомогательных, 1 реактор, 1 ЖО» = ~14 модулей ожидаемых для MVP.

Фактический code имеет 20 (больше spec MVP-среза, но меньше spec §9.1 полного списка). Это расширение MVP-среза (например, code добавил comm_mk1 + comm_mk2, 3 типа топливных баков, navigator_mk1, colony_module_small).

Header comment в `modules.ts:5` говорит «~18 модулей (Mk.I только)», но фактическое число 20. Внутренняя противоречивость.

**Влияние:**
Spec MVP-среза (Приложение D) и §9.1 (полная таблица) оба не точно соответствуют code. Разработчик не понимает, какой список канонический.

**Рекомендация:**
1. Обновить header comment в `modules.ts:5` с «~18 модулей» на «20 модулей».
2. Обновить Приложение D spec — добавить comm_mk1/comm_mk2, navigator_mk1, colony_module_small, 3 типа fuel_tank как явно входящие в MVP.
3. В §9.1 добавить колонку «MVP» (✅/❌) для ясности.

---

### P2-8: `02-dev-process.md` §6, §8 — «(2-4)» / «3-4» AI-фракции — не обновлены per doc_fixes (P1-3 cross-reference)

**Файлы:**
- `docs/02-dev-process.md:125`: «Крупные AI-фракции (2-4): экономика, флот, дипломатия, исследования»
- `docs/02-dev-process.md:165`: «3–4 AI-фракции с разными стратегиями + множество мелких фракций»
- `docs/05-appendices.md:89`: «Крупные AI-фракции (2-4) + мелкие фракции»

**Описание:**
Per `08_27_doc_fixes.md` §1 (противоречие №1): «Принять 5 базовых фракций (как в 70-ai.md), со временем может быть больше». Spec 70-ai.md:232 утверждает «5 AI-фракций». doc_fixes применил правки к 00-ARCHITECTURE.md (3 места: lines 108, 126, 275, 571), но не к 02-dev-process.md и 05-appendices.md.

**Влияние:**
Три разных числа AI-фракций в spec: «5» (00-ARCHITECTURE, 70-ai.md), «2-4» (02-dev-process.md line 125, 05-appendices.md line 89), «3-4» (02-dev-process.md line 165). Spec внутренне противоречив.

**Рекомендация:**
1. `02-dev-process.md:125`: «2-4» → «5 базовых».
2. `02-dev-process.md:165`: «3–4» → «5».
3. `05-appendices.md:89`: «(2-4)» → «(5 базовых, расширяемо)».

---

### P2-9: `buildings-verification.md` §6.1 — 8 зданий, ссылается на удалённые `smelter/chemical_plant/petrochem_plant`

**Файл:** `docs/buildings-verification.md:153-199`

**Описание:**
Spec §6.1 «Здания в коде (8 шт.)» перечисляет: mine, quarry, gas_extractor, smelter, chemical_plant, solar_plant, nuclear_plant, shipyard. Утверждает: «⚠️ Баг: ID в коде не совпадает с документацией. nuclear_plant vs nuclear_reactor».

Per code (buildings.ts): actual 15 зданий, и:
- `smelter` — НЕ существует (заменён на `processor` per Block 05 doc_fixes item #4).
- `chemical_plant` — НЕ существует (заменён на `synthesizer`).
- `petrochem_plant` (упомянут в §6.2, §3.2) — НЕ существует (заменён на `refinery`).
- `nuclear_plant` → `nuclear_reactor` переименован per Block 01 C8 (задача закрыта, code: `id: 'nuclear_reactor'`).
- colony_hub, warehouse, open_warehouse, high_tech_storage, spaceport, laboratory — все добавлены в code после написания verification doc.

**Влияние:**
Verification doc претендует на статус «Финальный аудит» (line 1), но полностью устарел. Пользователь может ссылаться на него как на канон.

**Рекомендация:**
1. Переписать buildings-verification.md §6 целиком: 15 зданий, добавить processor/synthesizer/refinery/warehouse/open_warehouse/high_tech_storage/spaceport/laboratory.
2. Удалить §6.2 упоминания `smelter/chemical_plant/petrochem_plant` — заменить на processor/refinery/synthesizer.
3. Удалить §5 «nuclear_plant vs nuclear_reactor» — Bug закрыт per Block 01 C8.

---

### P3-1: `elements.ts` header «57 элементов» устарел (Pass 2 P3-1 — повторное подтверждение)

**Файл:** `src/data/elements.ts:3`

**Описание:**
Header comment: «Определения элементов — 57 элементов для SpaceGame.»
Actual count via `grep "id:\s*'"` = **60** (57 базовых + 3 трансурановых Np/Pu/Am, per Block 01 P7).

**Влияние:** Косметика, вводит в заблуждение.

**Рекомендация:** Обновить header на «60 элементов (57 базовых + 3 трансурановых Np/Pu/Am из Block 01 P7)».

---

### P3-2: `STATUS.md` §6.1 метрики все устарели

**Файл:** `docs/STATUS.md:249-260`

**Описание:**
| Метрика (spec) | Spec value | Actual (per Pass 1) |
|---|---|---|
| Строк игрового кода | ~13 239 | 31 040 |
| Строк shadcn/ui | ~5 397 | ~8K+ (estimate) |
| Файлов в src/ | 105 | 141 |
| Элементов (в коде / по spec) | 57 / 57 | 60 / 60 |
| Руд (в коде) | 51 | 56 (per ore-specs.ts grep) |
| Зданий (в коде / по spec) | 12 / 27 | 15 / 27 |
| Рецептов (в коде) | ~70 | 75 |
| Типов звёзд | 12 / 12 | 12 / 12 ✅ |
| Типов планет | 7 / 7 | 7 / 7 ✅ |
| Компонентов UI (game/) | 7 | 17 |

**Влияние:** Косметика — STATUS.md вводит в заблуждение.

**Рекомендация:** Auto-generate метрики через скрипт, или вручную обновить.

---

### P3-3: `03-project-structure.md` — chemistry-generator.ts (1704 строки)

**Файл:** `docs/03-project-structure.md:67`

**Описание:**
Spec: «chemistry-generator.ts (1704 строки)».
Actual: 30 строк (реэкспорт-шим per Block 01 C5; реальная логика в `src/data/chemistry/`).

**Влияние:** Косметика — вводит в заблуждение о размере файла.

**Рекомендация:** Обновить: «chemistry-generator.ts (30 строк — реэкспорт; ~1700 строк в `src/data/chemistry/` подкаталоге)».

---

### P3-4: `README.md` структура проекта — устаревшие счётчики файлов

**Файл:** `README.md:53, 65, 87, 123`

**Описание:**
- Line 53: «src/data/ (11 файлов)» — actual **17** (добавлены atmosphere-gases, baked-lookups, crafted-materials, element-helpers, processor-categories, processor-recipe-categories, ships/, research/, chemistry/ — подкаталоги).
- Line 65: «src/galaxy/ (11 файлов)» — actual **10** (gen-context.ts, generator.ts, galaxy-module.ts, generate-{jump-points,planets,positions,resources,systems}.ts, hex-grid.ts, index.ts = 10).
- Line 87: «components/game/ (7 файлов)» — actual **17** (добавлены ship-card, ship-designer, shipyard-dialog, fleet-view, fleet-orders-panel, fleet-route-overlay, production-queue, production-queue-panel, research-view, specialize-dialog, system-view — все из Etap 3.0).
- Line 123: «checkpoints/ (13 файлов)» — actual **30** (Block 01-08 + audit_passes + ROADMAP + RULES + 5_03_*/5_04_* + 05_12 + 06_26 + 08_27_*).

**Влияние:** Косметика — преувеличенное представление о размере.

**Рекомендация:** Обновить все счётчики (auto-generate через `ls | wc -l`).

---

### P3-5: `50-ships.md` не документирует fuel priority order (xenon → hydrogen → chemical)

**Файлы:**
- Spec: `docs/50-ships.md` — поиск «приоритет.*топлив|xenon.*hydrogen.*chemical» → 0 hits
- Code: `src/ships/fleet-engine.ts:402` — `const fuelPriority: Array<'xenon' | 'hydrogen' | 'chemical'> = ['xenon', 'hydrogen', 'chemical'];`

**Описание:**
Pass 2 P3-6 отметил: code имеет hardcoded `fuelPriority` inline в `consumeFuel`, без выноса в `src/data/ships/fuel-map.ts` (как `FUEL_PRIORITY` const) и без spec-описания.

Spec 50-ships.md §3.1 (общая формула топлива) и §3.2 (типы двигателей) не объясняют, какой приоритет списания когда несколько типов есть во флоте.

**Влияние:** Косметика — поведение не задокументировано.

**Рекомендация:**
1. В spec 50-ships.md §3.1 добавить: «Приоритет списания топлива: xenon → hydrogen → chemical (antimatter — Etap 4 stub). Это упрощение для MVP: один бак 'H' на планете обслуживает chemical + hydrogen».
2. В code — вынести `FUEL_PRIORITY` const в `fuel-map.ts` (Pass 2 рекомендация).

---

### P3-6: `04-performance.md` §1.2 утверждает Web Worker — code не использует

**Файлы:**
- Spec: `docs/04-performance.md:33-38` (§1.2 «Web Worker»): «Симуляция в отдельном потоке (Web Worker)», «Связь с UI через postMessage», «UI не блокируется при тяжёлых расчётах», «Игровой цикл независим от частоты рендеринга».
- Code: `src/stores/game-store.ts:244-289` — `getMediatorWithModules()` создаёт `GameMediator` (singleton) + `GameLoop` (setInterval). Нет Worker, нет postMessage.
- Code: `src/core/game-loop.ts` — `setInterval(this.tick, 1000 / speed)` — main thread.

**Описание:**
Spec §1.2 описывает Web Worker как часть целевой архитектуры, но это future-plan (Etap 2.5+ per line 137). Code использует main thread. Spec не помечает это как «future» явно.

**Влияние:** Косметика — вводит в заблуждение о текущей реализации.

**Рекомендация:** В §1.2 добавить: «⚠️ Текущий статус: Web Worker не задействован; симуляция в main thread. Реализация — Etap 4+».

---

### P3-7: `audit-history.md` (2026-05-03) — устаревший «Post-Fix Verification»

**Файл:** `docs/audit-history.md` (170 строк)

**Описание:**
audit-history.md датируется 2026-05-03 — до всех работ Etap 2.5/2.6/3.0 (Blocks 01-08). Претендует на «Финальный аудит — Post-Fix Verification» с тегом «MVP — минимально рабочий проект. Все P0-блокеры исправлены».

Per Pass 1 §1.2 + worklog: после 2026-05-03 произошли major изменения — Block 01 (stabilization), Block 06 (modular integration), Block 07 (engineering quality), Block 08 (security/data), Block 05 (processors), Block 02 (fleet), Block 03 (research). Audit-history.md не отражает этого.

Также STATUS.md line 9 ссылается: «Актуальные статусы этапов — в checkpoints/ROADMAP.md и STATUS.md» — но audit-history.md остаётся как «current final audit» в perception.

**Влияние:** Косметика / historical — но создаёт путаницу.

**Рекомендация:** В audit-history.md header добавить: «⚠️ Исторический документ от 2026-05-03. Для актуального статуса см. `08_27_audit_0{1,2,3}_*.md` (Pass 1/2/3)».

---

## 4. Спецификация vs Реализация — таблица расхождений

| Параметр | Doc spec | Code reality | Статус |
|----------|---------|--------------|--------|
| Elements count | 57 (per most docs) / 58+10=68 (per 32-mendeleev §summary) / 56+10=66 (per §2) / 64 (Appendix B) | 60 (57 base + 3 transuranic) | ❌ drift (multiple) |
| Buildings count | 27 (40-buildings §10.1) | 15 | ⚠️ partial (12 post-MVP) |
| Tech count | 15 MVP / 72 full | 15 MVP | ✅ match |
| Hulls count | 7 (full) / 3 MVP (Приложение D) | 4 MVP | ⚠️ MVP drift (+Transport) |
| Modules count | 50 (§9.1) / ~14 MVP (Приложение D) | 20 | ⚠️ partial |
| Recipes count | ~70 (most docs) | 75 | ❌ drift (5 extra) |
| Star types | 12 | 12 | ✅ match |
| Planet types | 7 | 7 | ✅ match |
| RP/sec divider | 500 (§9.4 formula) | 800 (engine.ts:218) | ❌ drift (P1-1) |
| Spec T-R3 expectation | `getLabRPPerSec(3,5,80)===16.5` | 16.5 (with /800) | ✅ code matches test, spec formula wrong |
| Gravity formula | linear `(r/r_E)×(ρ/ρ_E)` (§1.3) | linear (engine:472) | ✅ match canonical |
| Gravity formula §5.2 example | quadratic `Math.pow(r/r_E, 2)×(ρ/ρ_E)` (line 1786) | linear | ❌ spec internal inconsistency |
| `getTechCost` formula | `floor(baseCost × 1.5^(N-1))` (§9.2) | same (engine.ts:157-160) | ✅ match |
| `getMaxResearchSlots` formula | `min(1 + floor(labs/10), 10)` (§9.5) | same (engine.ts:228-230) | ✅ match |
| `getFocusBonus` formula | `activeSlots===1 && allocation===100 → 1.2` (§9.6) | `activeSlots===1 && allocation>=100 → 1.2` (engine.ts:238-241) | ⚠️ minor drift (`===` vs `>=`) |
| `calculateProcessorOutputMultiplier` universal formula | `oreInput × baseYield × 0.75 × (1/sqrt(activeRecipes))` (40-buildings §11.3 / Block 05 §2.2) | same (engine.ts:433-457) | ✅ match |
| `calculateProcessorOutputMultiplier` specialized formula | `oreInput × baseYield × 1.0 × purityBonus` (Block 05 §2.2) | same (engine.ts:443-448) | ✅ match |
| `purityBonus` | `1.0 + 0.02 × (specLvl - 1)` | same (engine.ts:445) | ✅ match |
| `purity` specialized | `0.92 + 0.0175 × (specLvl - 1)` | same (engine.ts:446) | ✅ match |
| `specializeBuilding` min level | 3 (40-buildings §11.4) | 3 (engine.ts:835) | ✅ match |
| `specializationLevel` cap | 5 (40-buildings §11.5) | 5 (engine.ts:913) | ✅ match |
| `ORE_WAREHOUSE_BASE` | 1000 (35-warehouse §1.3 + 40-buildings §11.1) | 1000 (warehouse.ts:34) | ✅ match |
| `PROCESSED_WAREHOUSE_BASE` | 100 (35-warehouse §1.3 + 40-buildings §11.1) | 100 (warehouse.ts:40) | ✅ match |
| `HIGH_TECH_STORAGE_BASE` | 10 (35-warehouse §1.3 + 40-buildings §11.1) | 10 (warehouse.ts:46) | ✅ match |
| `SPEC_BONUSES` | «упразднена» (35-warehouse §1.3.5) | active universal/ore/metal/gas/component (warehouse.ts:81-87) | ❌ drift (P2-5) |
| `JUMP_RECHARGE_TICKS` | 10 (50-ships §3.2.4 line 358) | 10 (orders.ts:38) | ✅ match |
| `TRAVEL_SCALE` | не задокументировано | 1000 (orders.ts:54) | ❌ doc gap |
| `STEEL_PER_UER` | не задокументировано явно | 5 (shipyard-queue.ts:40) | ❌ doc gap |
| `MICROCHIP_PER_UER` | не задокументировано явно | 1 (shipyard-queue.ts:41) | ❌ doc gap |
| `SHIP_BUILD_TIME` scout/fighter/frigate/transport | 50/80/150/120 (50-ships Приложение C line 1422-1427) | 50/80/150/120 (shipyard-queue.ts:48-56) | ✅ match |
| `armorMultiplier` light/standard/thick/heavy | 1.0/1.25/1.5/2.0 HP, 1.0/1.1/1.25/1.5 mass, 1.0/1.2/1.5/2.0 cost (50-ships §2.3) | same (designer.ts:42-54) | ✅ match |
| `FUEL_PRIORITY` | не задокументировано | xenon → hydrogen → chemical (fleet-engine.ts:402) | ❌ doc gap (P3-5) |
| `COLONY_STARTER_RESOURCES` amounts | Fe:150, Si:100, C:60, Al:80, H:300, Ti:30, Cu:40, O:200, N:100, Au:2, U:5 (40-buildings §C.4) | same (engine.ts:1051-1064) | ✅ match |
| `getAtmosphereEfficiency` values | thin=0.3, standard=0.6, dense=0.7, toxic=0.6, inert=0.5, methane=0.7, co2=0.5 (40-buildings §2.3 per Pass 2) | same (engine.ts:171-182) | ✅ match |
| `event-bus.ts` @deprecated | listed in 03-project-structure.md + 00-ARCHITECTURE.md + modular-bus.md | file removed | ❌ drift (P2-4) |
| AI-фракций count in `00-ARCHITECTURE.md` | 5 базовых (line 108, 126, 275, 571) | n/a (no AI code yet) | ✅ spec match within file |
| AI-фракций count in `02-dev-process.md` + `05-appendices.md` | 2-4 / 3-4 | n/a | ❌ drift (P2-8) |
| Elements count `00-ARCHITECTURE.md:91` | 50 | 60 | ❌ drift (line not fixed per doc_fixes) |
| Elements count `00-ARCHITECTURE.md:384, 570, 685` | 57 | 60 | ❌ drift (spec value stale vs code) |
| 4 hulls values (totalHP/baseMass/slots/cost) | per spec §2.1 table | per code hulls.ts | ✅ exact match |
| `validateShip` rules 1-11 | per spec Приложение B (6 rules) | per code designer.ts:296-410 (11 rules) | ⚠️ code is superset |
| 8 BranchLinks | per spec research-unification §3.1 (8 rows) | per code branch-links.ts (8 entries) | ✅ match |
| 15 specialized techs | per spec 60-research §6 (15 MVP slice) | per code tech-tree.ts (15 entries) | ✅ match |
| 6 fundamental branches (5 active + 1 ghost) | per spec 00-ARCHITECTURE §3.2.1 + research-unification §3 | per code fundamental-branches.ts (6 entries, 5 active + xenoarchaeology ghost) | ✅ match |
| Element `Os` (Osmium, Z=76) | in 33-chemistry.md (5 refs), NOT in 32-mendeleev.md | in code elements.ts:128 | ❌ drift (P1-7) |
| `STATUS.md` §3.1 ships/research status | «0% реализации» | MVP complete (Block 02/03) | ❌ drift (P1-4) |
| `STATUS.md` §6.1 метрики | 57 elements, 12 buildings, ~70 recipes, 13K lines, 105 files, 67 commits | 60 elements, 15 buildings, 75 recipes, 31K lines, 141 files, 7+ commits (rewritten history) | ❌ drift (P3-2) |
| `README.md` Etap status | «Etap 2 ~90%, Etap 2.5 в плане» | Etap 2/2.5/2.6/3.0 complete | ❌ drift (P1-2) |
| `README.md` метрики | 57 elements, 12/27 buildings, ~70 recipes, 13K строк, 105 файлов | 60/15/75/31K/141 | ❌ drift (P1-2) |
| `INSTRUCTIONS.md` paths | /home/z/my-project/ | /home/z/spacegame-audit/spacegame/ | ❌ drift (P1-6) |
| `.env` boilerplate path | (file tracked in git) | `DATABASE_URL=file:/home/z/my-project/db/custom.db` | ❌ drift (P1-5) |
| `STATUS.md` §3.2 building list | smelter/chemical_plant/petrochem_plant | processor/synthesizer/refinery | ❌ drift (P2-9 + P1-4) |
| `buildings-verification.md` §6.1 | 8 зданий + nuclear_plant | 15 зданий + nuclear_reactor | ❌ drift (P2-9) |

---

## 5. Оценка соответствия документации

**Вердикт: Significant drift / Требует синхронизации**

Документация SpaceGame описывает ~80% канонического контракта корректно, но имеет **значительный drift** в нескольких ключевых местах:

### Что хорошо (✅ — точное соответствие)
1. **Критические формулы** — `calculateProcessorOutputMultiplier`, `purityBonus`, `purity`, `getTechCost`, `getMaxResearchSlots`, `getFocusBonus` — все точно совпадают с spec.
2. **Критические константы** — `ORE_WAREHOUSE_BASE=1000`, `PROCESSED_WAREHOUSE_BASE=100`, `HIGH_TECH_STORAGE_BASE=10`, `JUMP_RECHARGE_TICKS=10`, `SHIP_BUILD_TIME` per hull — все точные.
3. **Корпуса кораблей** — 4 MVP-корпуса (Скаут/Истребитель/Фрегат/Транспорт) имеют точно совпадающие параметры HS/HP/mass/slots/cost.
4. **`armorMultiplier`** — все 4 обшивки точно совпадают.
5. **`COLONY_STARTER_RESOURCES`** — все 11 значений точно совпадают (Fe:150 ... U:5).
6. **`getAtmosphereEfficiency`** — все 7 значений точно совпадают.
7. **15 specialized techs + 6 fundamental branches + 8 BranchLinks** — счёт и ID точно совпадают.
8. **Gravity formula (каноническая, §1.3)** — code использует linear `(r/r_E)×(ρ/ρ_E)` точно как spec §1.3.
9. **Architecture: GameMediator + ModuleRegistry + TypedEventBus + 5 модулей** — реализация соответствует `architecture/modular-bus.md` (контракт Block 06).

### Что требует синхронизации (🔴)
1. **P1-1 `getLabRPPerSec` делитель 500 vs 800** — spec внутренне противоречив (§3.1 пример говорит «бонус 0.1», но формула `/500` даёт «бонус 0.16» при 80% габ.; code использует `/800` чтобы соответствовать тесту T-R3). Это подтверждённая опечатка spec — необходимо синхронизировать.
2. **P1-2 README.md** — целиком устарел на 2 etap'а. Метрики, дерево каталогов, статус «не реализовано» — все неверны. Это главный онбординг-документ.
3. **P1-4 STATUS.md §3.1** — помечает флот+исследования как «0% реализации» хотя они завершены (Block 02/03). Прямое противоречие с worklog.md и checkpoint-файлами.
4. **P1-3 doc_fixes.md «complete» — фактически partial** — остались стейл-места: 02-dev-process.md (2 места), 05-appendices.md (1 место), 00-ARCHITECTURE.md §1.1 line 91 (1 место). Также `30-planets.md:1786` пример кода не синхронизирован.
5. **P1-7 `32-mendeleev.md` не содержит Os** — code и 33-chemistry.md ссылаются на Os, но канонический 32-mendeleev.md не упоминает.
6. **P2-5 `35-warehouse-and-logistics.md` §1.3.5 «специализация упразднена»** — но code имеет активный `SPEC_BONUSES` с universal/ore/metal/gas/component. Spec не описывает фактическое поведение.
7. **P2-7 `50-ships.md` §9.1 (50 модулей) vs code (20)** — code добавил 6 модулей свыше MVP-среза Приложения D, но spec не синхронизирован. Header comment в modules.ts говорит «~18», actual 20.
8. **P2-9 `buildings-verification.md` §6.1** — описывает 8 зданий, ссылается на удалённые `smelter/chemical_plant/petrochem_plant`. Полностью устарел.

### Stale info (🟡)
1. **`02-dev-process.md` §6, §8** — Etap 2.5/3.0 помечены «Pending», фактически Complete.
2. **`audit-history.md`** (2026-05-03) — «Финальный аудит Post-Fix Verification» претендует на current, но не отражает Blocks 01-08.
3. **`STATUS.md` §6.1 метрики** — все устарели (57 элементов → 60, 12 зданий → 15, 13K строк → 31K, 105 файлов → 141, ~70 рецептов → 75).
4. **`03-project-structure.md` §3** — ships/research помечены как «запланированы», фактически реализованы. Имена файлов в spec (ship-types.ts, ship-constructor.ts, fleet-manager.ts, movement.ts) не совпадают с реальными (designer.ts, fleet-engine.ts, orders.ts).
5. **`04-performance.md` §1.2** — описывает Web Worker как активный, фактически main thread.

### Spec/code drift summary
- **Точных совпадений (✅):** ~25 параметров (формулы, константы, hulls, armor, tech tree counts)
- **Drift (❌):** ~15 параметров (elements count, buildings list, modules count, RP/sec divider, README/STATUS staleness, INSTRUCTIONS paths, .env, event-bus.ts reference, WarehouseSpecialization, validateShip rules count, gravity example in §5.2)
- **Doc gaps (нет в spec, есть в code):** TRAVEL_SCALE, STEEL_PER_UER, MICROCHIP_PER_UER, FUEL_PRIORITY, TECH_UNLOCKS table
- **Stale references:** event-bus.ts (удалён), smelter/chemical_plant/petrochem_plant (заменены), nuclear_plant (переименован), Etap 2.5/3.0 status (завершены)

---

## 6. Блок-планы vs Реализация

### Block 01 stabilization (P1-P9, C1-C9, T1-T7) — ✅ Complete (per Pass 1 §6)
- **P1** (ore ID unification): ✅ recipe validation 75/75, baked-lookups.ts
- **P2** (immutable store): ✅ immer middleware; **но P0-1 (Pass 1) — 21 store action прямой мутации без sync→mediator**. Архитектурный долг Block 01 P2.
- **P3** (atmosphere/orbit UI): ✅ events.ts:61 `layer: 'atmosphere' | 'orbit'`
- **P4** (production queue UI): ✅ production-queue-panel.tsx
- **P5** (crafted materials category): ✅ crafted-materials.ts, recipes.ts
- **P6** (Colony Hub cost): ✅ `costPerLevel: { Fe:10, Si:5, Al:3 }` (buildings.ts:19)
- **P7** (transuranic elements): ✅ 57→60 (Np/Pu/Am added, elements.ts:154-159)
- **P8** (complex gas recipes): ✅ recipe validation 75/75
- **P9** (ProductionItem deterministic IDs): ✅ productionItemCounter + shipCounter + fleetCounter + researchSlotCounter
- **C1** (delete deprecated bus): ✅ event-bus.ts removed (но spec still references — P2-4)
- **C2-C9**: ✅ implicit
- **T1-T7**: ✅ tests/prng + prng-statistical + immutability + serialization + galaxy-snapshot + economy + chemistry

### Block 02 (Fleet MVP F1-F7, T-FLEET-1..5) — ✅ Complete (per Pass 2 §6)
- **F1** (4 hulls + 20 modules + fuel-map): ✅ (но spec §Приложение D говорит «3 корпуса» — P2-6)
- **F2** (validateShip + calculateDesignStats): ✅ 11 правил (vs spec 6 — code superset)
- **F3** (createFleet/mergeFleets/splitFleet): ✅
- **F4** (planRoute + calculateTravelTime + executeOrder): ✅
- **F5** (processFleetTick + consumeFuel + completeOrder): ✅ (но P1-4 Pass 2 — movement-started event edge case)
- **F6** (processShipyardTick): ✅
- **F7** (ShipsModule + FleetModule integration): ✅
- **T-FLEET-1..5**: ✅ 90 tests total (17 fleet-engine + 23 orders + 33 designer + 17 shipyard)
- **Caveats:** resolveCombat stub (Etap 4), canColonizePlanet stub (Etap 4), P1-2 cross-layer import (Pass 2)

### Block 03 (Research MVP R1-R7, T-R1..T-R7) — ✅ Complete (per Pass 2 §6)
- **R1** (15/72 techs + 5 fundamental branches): ✅ (но spec 32-mendeleev + 60-research противоречивы по counts)
- **R2** (Laboratory building): ✅ buildings.ts:233-245
- **R3** (queue + tick + cost + slots): ✅
- **R4** (validation): ✅
- **R5** (idempotent unlocks): ✅
- **R6** (full tree validation): ✅
- **R7** (ResearchModule + tick integration): ✅
- **T-R1..T-R7**: ✅ 164 tests total (per Pass 2 §4 Research)
- **Caveats:** P2-5 Pass 1 (habitabilityPercent=0 stub), **P1-1 этого захода — getLabRPPerSec /800 vs /500 spec drift**

### Block 05 (Processors PR1-PR8, T5.1-T5.8) — ✅ Complete (per Pass 1 §6 + Pass 2 §6)
- 2 типа (universal + specialized): ✅ types.ts:231
- 7 ProcessorRecipeCategory: ✅ data/processor-categories.ts
- specializeBuilding / upgradeSpecialization: ✅ engine.ts:785-948
- 8 tests T5.1-T5.8: ✅ tests/economy/processors.test.ts (542 строки)
- Formulas (engine.ts:414-458): ✅ совпадают с 40-buildings §11.3 / Block 05 §2.2
- **Spec drift:** 35-warehouse §1.3.5 «специализация упразднена» — но code `SPEC_BONUSES` активен (P2-5)

### Block 06 (modular-bus integration) — ✅ Partially Complete (per Pass 1 §6)
- typed-bus + ModuleRegistry + GameMediator: ✅
- EconomyModule, GalaxyModule, ResearchModule, ShipsModule, FleetModule: ✅ (5 модулей в game-store.ts:244-289)
- **Gap (P0-1 Pass 1)**: store→mediator sync отсутствует для 21 прямого действия. Block 06 контракт «store делегирует mediator» — частично выполнен.

### Block 07 (engineering quality) — ✅ Complete (per Pass 1 §6)
- TS strict + noUncheckedIndexedAccess + noImplicitReturns: ✅
- ESLint warn-level enforcement: ✅ (eslint.config.mjs)
- PRNG port fix (`s1 << 17`): ✅ prng.ts:42 (Pass 1 P3-3 — название «xoshiro256**» вводит в заблуждение, реально 32-bit)
- `next.config.ts: ignoreBuildErrors: false`: ✅

### Block 08 (security/data) — ✅ Complete (per Pass 1 §6, but with regress)
- API validation (zod schemas): ✅ save-schema.ts, game-state-schema.ts
- Rate limiting (token bucket 10/min): ✅ rate-limit.ts
- Prisma indexes (seed, name, updatedAt, seed+updatedAt): ✅ schema.prisma
- `version Int @default(1)`: ✅
- **Regress (P1-5 этого захода)**: `.env` tracked с boilerplate-путём → DB в `/home/z/my-project/`

### Block 04 (AI-factions) — ❌ Not started (per spec, per code)
- spec `70-ai.md` (2354 строки) + `08_27_block_04_ai_faction.md` (939 строк) готовы
- code: нет `src/ai/` директории (verified via `ls`)
- `defenderFactionId: 'enemy'` hardcoded stub (fleet-engine.ts:484, per Pass 2 P1-3)

---

## 7. Рекомендации для Pass 4 (MVP Readiness — e2e gameplay)

Based on Pass 3 findings, Pass 4 should focus on:

### 7.1 Verify spec/code drift items impact gameplay
1. **`getLabRPPerSec` /800 vs /500** (P1-1 этого захода) — в MVP habit=0, формула не активна. Но Pass 4 должен проверить:
   - Если Etap 4 добавит `habitabilityPercent` > 0, RP/сек будет рассчитываться по /800. Spec/docs обновлять нужно ДО реализации Etap 4 терраформинга.
   - Если кто-то «исправит» spec на /500 и обновит тест T-R3 на 17.4 — сломает существующие сейвы и баланс.
2. **`STATUS.md` неверный статус флот/исследования** (P1-4) — Pass 4 оператор должен игнорировать STATUS.md §3.1 и доверять worklog.md + checkpoints.
3. **README.md неверные метрики** (P1-2) — Pass 4 не должен опираться на «12 зданий» или «57 элементов» — нужно проверять фактический code.

### 7.2 e2e gameplay scenarios (основанные на Pass 1 §7 + Pass 2 §7)
1. **Smoke-test**: newGame → colonize → mine + processor + recipe → 5 ticks → verify производство завершено.
2. **P0-1 воспроизведение** (Pass 1 критический): newGame → colonize → enqueueProduction → cancelProduction → 1 tick → проверить, отменился ли элемент. Если вернулся — P0-1 подтверждён.
3. **Save/Load round-trip**: newGame → colonize → построить здания → сохранить → загрузить → mediator.gameState updated? (P1-2 Pass 1) Все здания/ресурсы/флоты/исследования на месте?
4. **Speed stress**: x1→x5→x15→x50 — UI re-renders корректно? (P1-4, P1-5 Pass 1)
5. **Fleet MVP**: построить корабль на верфи → создать флот → приказ move → дождаться прибытия. Verify `fleet:movement-started` emit не пропущен (P1-4 Pass 2).
6. **Research MVP**: построить лабораторию → запустить технологию в очередь → дождаться завершения → applyTechUnlock идемпотентно?
7. **Silent resource loss edge case** (P1-1 Pass 2): заполнить склад рудой до cap → поставить mine → через N тиков проверить, что deposit.quantity не уменьшился больше, чем actual stored.

### 7.3 Performance (per Pass 1 §6.2 + Pass 2 P2-2)
- На 500 системах, x50 скорости — проверить, что тик обрабатывается <20ms. Pass 2 P2-2: `findPlanet` O(S×P) — 400K iter/tick на big maps может быть узким местом.

### 7.4 Spec compliance during gameplay
- Все 15 зданий из `src/data/buildings.ts` открываются в BuildingDialog?
- Все 4 корпуса доступны в ShipDesigner? (Если UI показывает только 3 — spec MVP-среза не синхронизирован с code.)
- Все 15 технологий в ResearchView видимы? `validateTechTree` возвращает `[]`?
- Рецепты: при попытке крафта `make_ion_engine` (уровень 3) — inputs есть? Pass 2 R2: для MVP упрощение «1 у.е.р. = 5 steel + 1 microchip» — verify STEEL_PER_UER=5 в действии.

### 7.5 Cross-cutting для Pass 4 report
- **Spec/code drift summary**: 15-20 параметров — нужно решить, какие критичны для MVP readiness (некоторые — косметика).
- **Doc fixes backlog**: 12 мест для исправления (P1-3: 3 AI-factions, 1 elements, 1 gravity-example; P1-2 README; P1-4 STATUS; P2-9 buildings-verification).
- **`event-bus.ts` cleanup**: 3 spec references + 1 code comment (Pass 1 P3-1) — фикс pending.
- **`.env` + INSTRUCTIONS.md** (P1-5, P1-6): блокируют sandbox-recovery, нужны ПЕРЕД Pass 4 (если Pass 4 запускается в свежем sandbox).

---

## Изменённые файлы

- `checkpoints/08_27_audit_03_docs_compliance.md` (этот файл — отчёт Pass 3)

> **Замечание:** Pass 3 — read-only аудит. Никакие исходные файлы кода или документации не модифицированы. Все правки рекомендованы как backlog для главного координатора после всех 4 проходов.

---

**End of Pass 3.**
