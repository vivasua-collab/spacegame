# Audit Pass 9 — Post R-SHIPS-DATA + Galaxy Generation Evaluation

> **Дата:** 2026-08-28
> **Скоуп:** пост-аудит после рефакторингов R-BLD-MOD (Task 19) + R-SHIPS-DATA (Task 20) + главный вопрос владельца: *«Возможно параметры генерации звёзд и планет так же необходимо вынести в файлы»*.
> **HEAD:** `f68be41 R-SHIPS-DATA: modular data-driven ships catalog (hulls/modules/fuel-map JSON)`
> **Базовая линия:** lint 0/49, tsc 159 errors (= baseline), tests 417/0, validate:all green (recipes 75/75, buildings 17/17, ships 4+20+4).

---

## 1. Качественные метрики (после R-SHIPS-DATA)

| Gate | До R-BLD-MOD | После R-SHIPS-DATA | Δ | Статус |
|---|---|---|---|---|
| `bun run lint` (errors/warnings) | 0 / 49 | 0 / 49 | 0 | ✅ |
| `bunx tsc --noEmit` | 159 | 159 | 0 | ✅ (= baseline) |
| `bun test` (pass/fail) | 391 / 0 | 417 / 0 | +26 | ✅ |
| `bun run validate:recipes` | 75/75 ✓ | 75/75 ✓ | 0 | ✅ |
| `bun run validate:buildings` | — | 17/17 ✓ | 0 | ✅ |
| `bun run validate:ships` | — | 4 hulls + 20 modules + 4 FuelType ✓ | NEW | ✅ |
| `bun run validate:all` | — | all 3 green | NEW | ✅ |

Паттерн TS error-кодов (159) идентичен baseline: TS18048(114) / TS2532(22) / TS2345(8) / TS2322(8) / TS2741(3) / TS2769(1) / TS2561(1) / TS2538(1) / TS18047(1).

**Все quality gates зелёные, регрессий нет.**

---

## 2. Целостность data-driven каталогов (buildings/research/ships)

### 2.1 Сводная таблица реализованных каталогов

| Каталог | JSON-файлы | Thin loader | Validator | Тесты | Публичный API | Статус |
|---|---|---|---|---|---|---|
| **Buildings** (R-BLD-MOD) | `surface.json` (14) + `orbit.json` (1) + `space.json` (2) = 17 | `index.ts` (через `as unknown as BuildingsFile`) | `validate-buildings.ts` | `economy/building-tech-gate.test.ts` | `BUILDINGS / BUILDING_MAP / CATEGORY_NAMES / CATEGORY_ICONS / LAYER_NAMES / areBuildingTechsMet` | ✅ complete |
| **Research** (R-RES) | `techs.json` (15) + `fundamentals.json` (6) + `branch-links.json` (8) + `bonuses.json` + `tech-unlocks.json` (9) | `index.ts` + `tech-tree.ts` + `fundamental-branches.ts` + `branch-links.ts` + `tech-unlocks.ts` | `validateTechTree` in `research/engine.ts` (init-time, не отдельный script) | `tests/research/*` (9 files) | `TECH_TREE / TECH_MAP / BRANCH_COLORS / STARTER_TECH_IDS / FUNDAMENTAL_BRANCHES / ...` | ✅ complete (без `validate:research` script) |
| **Ships** (R-SHIPS-DATA) | `hulls.json` (4) + `modules.json` (20) + `fuel-map.json` (4 FuelType) | `index.ts` + `hulls.ts` + `modules.ts` + `fuel-map.ts` (через `as unknown as`) | `validate-ships.ts` | `ships/data-files.test.ts` (26 tests) | `HULLS / HULL_MAP / getHull / listHulls / MODULES / MODULE_MAP / ...` | ✅ complete |

### 2.2 Найденные пробелы / запахи

| # | Файл:line | Проблема | Severity | Рекомендация |
|---|---|---|---|---|
| G1 | `src/data/research/tech-tree.ts:24` | Direct cast `techsData as Technology[]` (НЕ через `as unknown as`) — нарушает документированный паттерн из `data-driven-architecture.md §3.1` (line 138) и §3.2 (line 155) | MINOR | Переписать на `(techsData as unknown as { techs: Technology[] }).techs` или обернуть в `{ comment, techs }` для симметрии с buildings/ships |
| G2 | `src/data/research/tech-tree.ts:32-39` | `BRANCH_COLORS` — hard-coded inline в TS (6 веток + цвета) | MINOR | Можно вынести в `branch-colors.json` (S effort), но 6 записей — пограничный случай (не критично) |
| G3 | `src/data/ships/fuel-map.ts` | `emptyFuelStore()` hardcode'ит 4 FuelType, не data-driven | MINOR | Уже отмечен в `data-driven-architecture.md §3.1` и §8.2 как TODO Etap 4 |
| G4 | `scripts/` — НЕТ `validate-research.ts` | Research валидатор встроен в `engine.ts:validateTechTree` (init-time), а не как standalone script (в отличие от buildings/ships) | MINOR | Добавить `validate:research` script для CI-симметрии с buildings/ships; валидатор уже есть, нужен только thin-cli-обёртка |
| G5 | `src/data/research/tech-unlocks.json` | В `data-driven-architecture.md §2.2:101` назван «stub» — фактически содержит 9 записей | DOC STALE | Обновить доку, не код |
| G6 | Вне скоупа — но уже зафиксировано в `data-driven-architecture.md §8.2` | `recipes.ts` (75 рецептов), `elements.ts` (60 элементов), `ore-specs.ts`, `processing-chains.ts` — всё ещё inline TS | TODO Etap 4 (уже в roadmap) | Не срочно, паттерн established |

### 2.3 Сходимость с документацией

`data-driven-architecture.md` (главный архитектурный документ, Task 20):
- ✅ Описаны 3 реализованных каталога (buildings/research/ships) с их схемой.
- ✅ Описан паттерн thin TS-loader (через `as unknown as`).
- ✅ Описана общая бонус-система (building-sourced + tech-sourced через `Bonus` interface).
- ✅ Описаны валидаторы + roadmap §8.2 (recipes/elements/ores → JSON в Etap 4).
- ⚠️ §3.1 (line 138, 155) утверждает, что ВСЕ loaders кастуют через `as unknown as` — фактически research loader использует прямой cast (G1).

`50-ships.md §11` (v1.1): описывает data-driven структуру ships — соответствует коду.

`03-project-structure.md`: дерево `src/data/` приведено в соответствие с реальностью — соответствует.

`!listing.md`: header (29 docs, ~384K tokens) — **STALE**, фактически 29 docs, ~23 448 строк (~407K tokens). Зафиксировано в Task 21-c.

**Итог каталогов:** data-driven система **согласованная, работает**, есть 1 структурный пробел (G1 — research loader не следует паттерну через `as unknown as`), 1 процессный пробел (G4 — нет `validate:research` standalone script), и несколько doc-stale items.

---

## 3. Аудит: генерация галактики / звёзд / планет (главный вопрос владельца)

### 3.1 Структура генератора (файлы)

| Файл | LOC | Роль |
|---|---|---|
| `src/galaxy/generator.ts` | 139 | Оркестратор (5 модулей + PRNG seed) |
| `src/galaxy/gen-context.ts` | 22 | Глобальное состояние (genId, usedNames) |
| `src/galaxy/generate-positions.ts` | 98 | Спиральные позиции (bulge/disk/arms/halo) |
| `src/galaxy/generate-systems.ts` | 271 | Звёзды + имена + binary-type + companion selection |
| `src/galaxy/generate-planets.ts` | 688 | Планеты: тип/орбита/атмосфера/температура/жизнь/луны |
| `src/galaxy/generate-resources.ts` | 267 | Ресурсные залежи на гексах |
| `src/galaxy/generate-jump-points.ts` | 130 | Jump Points + связность |
| `src/galaxy/hex-grid.ts` | 116 | Гексагональная сетка (axial coords) |
| `src/galaxy/galaxy-module.ts` | — | Module wrapper (init/tick) |
| `src/data/star-types.ts` | 38 | **TS-inline** каталог 12 типов звёзд |
| `src/data/planet-types.ts` | 327 | **TS-inline** каталог 7 типов планет + density/radius/moon/life tables |
| `src/data/atmosphere-gases.ts` | 77 | **TS-inline** atmospheric gas maps |
| `src/data/elements.ts` | 179 | **TS-inline** каталог 60 элементов |
| `src/data/chemistry-generator.ts` | 30 | Re-export shim → `./chemistry/*` (7 sub-files) |

### 3.2 Классификация параметров по критерию «data vs physics»

Для каждого параметра генератора определён тип: **DATA** (чистый справочник — кандидат на вынос в JSON), **PHYS** (формула/константа физики — не выносится), **MIXED** (часть параметр + часть логика).

#### 3.2.1 Параметры генерации галактики (оркестратор + позиции)

| Параметр | Файл:line | Тип | Сейчас | Кандидат на вынос? |
|---|---|---|---|---|
| `DEFAULT_CONFIG` (seed/systemCount/radius/arms/spread/bulgeDensity/armWidth/armTwist/diskFraction/haloFraction/maxJumpDistance/maxJumpPointsPerSystem) | `generator.ts:57-78` | DATA | TS const block | ✅ ДА — чистый справочник параметров |
| Спиральное распределение (bulge=15%, disk=20%, arms=60%, halo=5%) | `generate-positions.ts:39-41` | DATA | inline const | ✅ ДА — designer-tunable |
| Количество гексов по размеру (`SIZE_HEX_COUNT`) | `planet-types.ts:240-246` | DATA | TS Record | ✅ ДА |
| Геометрия гексов (`directions`, `ringSize = 6*ring`) | `hex-grid.ts:45-46, 38` | PHYS | inline | ❌ НЕТ — структурная константа гекс-решётки |
| `axialToPixel` / `pixelToAxial` формулы | `hex-grid.ts:85-95` | PHYS | inline | ❌ НЕТ — математика |
| `selectBinaryType` вероятности (60/20/15/5%) | `generate-systems.ts:36-42` | DATA | inline switch | ✅ ДА — designer-tunable |
| `GREEK` / `CONSTELLATIONS` (имена систем) | `generate-systems.ts:17-18` | DATA | TS const | ✅ ДА — явный справочник имён |
| Jump point: `targetCount = rng.nextInt(1,3)`, `stabilized = rng.nextBool(0.3)` | `generate-jump-points.ts:37, 53` | DATA | inline literals | ✅ ДА — выносимо |

#### 3.2.2 Звёзды (star-types.ts + generate-systems.ts)

| Параметр | Файл:line | Тип | Сейчас | Кандидат? |
|---|---|---|---|---|
| `STAR_TYPES` (12 типов: O/B/A/F/G/K/M + WD/RG/NS/PULSAR/BH с mass/luminosity/temperature/radius/color/minPlanets/maxPlanets/weight) | `star-types.ts:9-25` | DATA | **TS-inline array** | ✅ ДА — primary candidate (уже отражён в `docs/20-stars.md §7.2` как JSON-структура!) |
| `SPECIAL_STAR_RANGES` (massMin/Max, tempMin/Max, radiusMin/Max для WD/RG/NS/PULSAR/BH) | `generate-systems.ts:88-98` | DATA | TS const Record | ✅ ДА — должен слиться с `STAR_TYPES` или быть рядом |
| `MAIN_SEQUENCE_TYPES` (Set для определения логики) | `generate-systems.ts:101` | DATA | TS const Set | ✅ ДА (можно вычислять из категории в JSON) |
| `selectCompanionStar` weights (0.7 same-class, 0.3 random) | `generate-systems.ts:50` | DATA | inline literal | ✅ ДА — designer-tunable |
| Mass variation ±15% (`1.0 + (rng.nextFloat() * 0.3 - 0.15)`) | `generate-systems.ts:129` | DATA | inline literal | ✅ ДА — выносимо |
| Luminosity variation ±15% | `generate-systems.ts:135` | DATA | inline literal | ✅ ДА |
| Радиус из массы: `R = M^0.8` (M<1) или `M^0.57` (M≥1) | `generate-systems.ts:139-143` | PHYS | inline formula | ❌ НЕТ — физический закон (Zeng et al. 2016) |
| Stefan-Boltzmann: `T = 5778 × (L/R²)^0.25` | `generate-systems.ts:104-113` | PHYS | inline functions | ❌ НЕТ — физика |
| `T_SUN = 5778` | `generate-systems.ts:105, 111` | PHYS | inline literal | ⚠️ borderline — физическая константа, можно вынести как physicalConstant, но не designer-tunable |
| Moon `selectCompanionStar` Math.max/min clamp | `generate-systems.ts:55` | LOGIC | inline | ❌ НЕТ |
| Asteroid field counts (`rng.nextInt(0,3)`, NS/PULSAR 1-4, GG bonus +1, binary +1) | `generate-systems.ts:246-257` | DATA | inline literals | ✅ ДА — designer-tunable |

#### 3.2.3 Планеты (planet-types.ts + generate-planets.ts)

| Параметр | Файл:line | Тип | Сейчас | Кандидат? |
|---|---|---|---|---|
| `PLANET_TYPES` (7 типов: rocky/volcanic/ice/oceanic/desert/gas_giant/dwarf с size/hexCount/baseGravity/temperatureRange/atmosphereChance/lifeChance/terrainWeights) | `planet-types.ts:154-232` | DATA | **TS-inline array** | ✅ ДА — primary candidate |
| `PLANET_DENSITY` (min/max/avg по типу планеты) | `planet-types.ts:26-34` | DATA | TS Record | ✅ ДА |
| `PLANET_TYPE_RADIUS` (min/max радиуса в км по типу) | `planet-types.ts:49-57` | DATA | TS Record | ✅ ДА |
| `GAS_GIANT_MOON_COUNT`, `MOON_RADIUS`, `MOON_DENSITY`, `MOON_ORBIT_RADIUS_KM`, `MOON_TYPE_WEIGHTS` | `planet-types.ts:66-99` | DATA | TS const | ✅ ДА — moon params block |
| `ORBIT_SLOTS_BY_SIZE`, `ORBIT_SLOTS`, `GAS_GIANT_ATMOSPHERE_SLOTS` | `planet-types.ts:118-311` | DATA | TS Records | ✅ ДА |
| `PROFILE_ELEMENTS`, `RARE_ELEMENTS`, `ULTRA_RARE_ELEMENTS` | `planet-types.ts:131-152` | DATA | TS Records/arrays | ✅ ДА |
| `LIFE_LEVEL_WEIGHTS` (по типу: [нет, микробы, растения, простая, сложная]) | `planet-types.ts:318-326` | DATA | TS Record | ✅ ДА |
| `TERRAIN_COLORS`, `TERRAIN_NAMES`, `SIZE_NAMES`, `TYPE_NAMES` | `planet-types.ts:254-290` | DATA | TS Records | ✅ ДА — UI lookup tables |
| `getSizeFromRadius` thresholds (R<0.3/0.7/1.3/2.0) | `planet-types.ts:105-112` | DATA | inline function | ⚠️ borderline — можно вынести как size-classification-table |
| `SIZE_HEX_COUNT` (19/37/61/91/127) | `planet-types.ts:240-246` | DATA | TS Record | ✅ ДА |
| Kopparapu HZ boundaries (`S_eff_inner=1.107, outer=0.356`, snowLine `2.7 × √L`) | `generate-planets.ts:60-62` | PHYS+DATA | inline literals | ⚠️ MIXED — Kopparapu coefficients физические (нельзя), но способ их комбинирования — data |
| Planet type selection weights (per zone: inner/HZ/beyondSnow/outer) | `generate-planets.ts:65-121` | DATA | inline weightedChoice arrays | ✅ ДА — огромный блок tunable-параметров |
| Anomaly chance 10%, anomaly weights `[15,10,12,8,10,20,15]` | `generate-planets.ts:66-70` | DATA | inline literal | ✅ ДА |
| Greenhouse ΔT tables (per atmosphereType: thin 8-20K, standard 25-40K, dense 50-130K, co2 80-280K, methane 30-90K, toxic 10-35K, inert 5-15K) | `generate-planets.ts:161-170` | DATA | inline switch | ✅ ДА — primary candidate (8 типов × 2 значения) |
| Pressure scale exponent 0.25 | `generate-planets.ts:174` | PHYS | inline literal | ⚠️ borderline |
| Type temperature modifiers (volcanic +30-100K, ice -20-50K, GG +10-30K, desert -5-10K) | `generate-planets.ts:179-185` | DATA | inline switch | ✅ ДА |
| Bond albedo ranges per planet type (e.g. rocky 0.15-0.30, ice 0.40-0.70, gas_giant 0.30-0.50) | `generate-planets.ts:198-206` | DATA | inline switch | ✅ ДА — primary candidate |
| Atmosphere composition bonuses (co2/dense +0.20-0.40, methane +0.10-0.25) | `generate-planets.ts:210-215` | DATA | inline | ✅ ДА |
| Atmosphere type probability tables (per planet type, e.g. rocky: thin 40%, standard 35%, ...) | `generate-planets.ts:252-303` | DATA | inline switch | ✅ ДА — primary candidate (7 типов × 7 строк) |
| Atmosphere pressure ranges per type (thin 0.001-0.5, standard 0.5-1.5, dense 1.5-5.0, ...) | `generate-planets.ts:305-316` | DATA | inline switch | ✅ ДА — primary candidate |
| Habitable temperature range `[-20, 80]°C` | `generate-planets.ts:355, 395` | DATA | inline literals | ✅ ДА |
| LifeChance modifiers (temp outside range × 0.1, toxic × 0.2) | `generate-planets.ts:357-361` | DATA | inline literals | ✅ ДА |
| Life level downgrade rules (complex→standard, simple→standard; toxic→microbes) | `generate-planets.ts:399-408` | LOGIC | inline switch | ❌ НЕТ — runtime rules |
| `compatibleWithColonists` chance 0.3, `hazardLevel` 1-3 | `generate-planets.ts:413-414` | DATA | inline literals | ✅ ДА |
| Orbital step constants (`BASE_STEP_AU = 0.5`, `MAX_JITTER_AU = 0.25`, `orbitalScale = hzCenter`) | `generate-planets.ts:457-460` | DATA | inline const | ✅ ДА — primary candidate (формулы documented in `galaxy-generation-audit.md`) |
| Binary-type orbit modifiers (BINARY_CLOSE → max(1.0), BINARY_WIDE → min(30)) | `generate-planets.ts:462-466` | DATA | inline literals | ✅ ДА |
| Moon orbital period formula `P = 1.77 × (a/421700)^1.5` | `generate-planets.ts:650` | PHYS | inline formula | ❌ НЕТ — 3-й закон Кеплера |
| Moon terrain weights (ice/rocky/dwarf variants) | `generate-planets.ts:653-657` | DATA | inline objects | ✅ ДА — выносимо |
| Moon size thresholds (R<0.15 tiny, <0.4 small, else medium) | `generate-planets.ts:637-639` | DATA | inline | ⚠️ borderline |
| Resource category multipliers (`CATEGORY_MULTIPLIERS` per planet type × 8 categories) | `generate-resources.ts:22-30` | DATA | **TS-inline Record** | ✅ ДА — primary candidate (7×8 = 56 значений) |
| Profile/Rare/Atmospheric/Default baseQuantity & hexFraction ranges | `generate-resources.ts:74-89` | DATA | inline literals | ✅ ДА |
| "Rich deposit" 15% chance + bonus ×2 | `generate-resources.ts:113, 124` | DATA | inline literals | ✅ ДА |
| Ultra-rare count `rng.nextInt(1,2)` | `generate-resources.ts:224` | DATA | inline literal | ✅ ДА |

#### 3.2.4 Документация vs код (нашли расхождения)

| Doc | Section | Doc claim | Code reality | Severity |
|---|---|---|---|---|
| `docs/20-stars.md` | §7.2 (line 1258) | Демонстрирует JSON-структуру для starTypes + binaryTypes с РАСШИРЕННЫМ набором полей (`temperatureRange`, `massRange`, `radiusRange`, `luminosityRange`, `lifespan`, `gasGiantMultiplier`, `asteroidResourceMultiplier`, `radiationDamage`, `specialMechanics`) | `src/data/star-types.ts` фактически TS-inline с более узким форматом (`mass/luminosity/temperature/radius` — single value, не Range) | HIGH — doc предвосхищает extraction, но формат не совпадает |
| `docs/20-stars.md` | §7.3 (colors) | Цвет O=`#9bb0ff`, G=`#fff4ea` | `star-types.ts:11` STAR_O `color: '#6e8eff'`, STAR_G `color: '#ffe8a0'` | HIGH — цвета не совпадают с докой |
| `docs/planet-generation-science.md` | §1.1 | rocky radius 0.5-1.6 R⊕ | `planet-types.ts:50` `rocky: { min: 3200, max: 10200 }` = 0.5-1.6 R⊕ | ✅ OK |
| `docs/planet-generation-science.md` | §1.1 | rocky density 4-8 | `planet-types.ts:27` `rocky: { min: 4.0, max: 8.0 }` | ✅ OK |
| `docs/30-planets.md` | §2.4 | 8 atmosphere types (none/thin/standard/dense/toxic/inert/methane/co2) | `generate-planets.ts:161-170` switch на 8 case | ✅ OK |
| `docs/planet-generation-science.md` | §3 | T_eq = 278.5 × L^0.25 × r^-0.5 × (1-A)^0.25 | `generate-planets.ts:157` exactly | ✅ OK |
| `docs/galaxy-generation-audit.md` | Kepler monotonicity | строгая монотонность r[orbit+1] > r[orbit] | `generate-planets.ts:444-460` формула с BASE_STEP_AU=0.5, MAX_JITTER_AU=0.25 (jitter < step, guaranteed) | ✅ OK |

### 3.3 Рекомендация: вынос параметров генерации звёзд/планет в JSON

#### 3.3.1 Рекомендуемая таблица приоритетов

| Группа параметров | Текущее место | Pure data? | Приоритет выноса | Effort | Risk |
|---|---|---|---|---|---|
| **A. Star types** (`STAR_TYPES` 12 записей) | `src/data/star-types.ts:9-25` (TS-inline) | ✅ Да | **HIGH** | **S** (≈4h) | LOW — публичный API `STAR_TYPES/STAR_TYPE_MAP/STAR_WEIGHTS/getStarTypeDef` сохраняется |
| **B. Special star ranges** (`SPECIAL_STAR_RANGES`) | `generate-systems.ts:88-98` | ✅ Да | HIGH (merge with A) | S (within A) | LOW |
| **C. Planet types** (`PLANET_TYPES` 7 записей + PLANET_DENSITY + PLANET_TYPE_RADIUS + LIFE_LEVEL_WEIGHTS) | `src/data/planet-types.ts:26-326` (TS-inline) | ✅ Да | **HIGH** | **M** (≈8h, ~327 LOC) | LOW — публичный API сохраняется |
| **D. Atmosphere tables** (greenhouse ΔT, albedo, pressure, type-probabilities per planet) | `generate-planets.ts:161-303` inline switches | ✅ Да | **HIGH** (large tunable block) | **M** (≈6h) | MEDIUM — логика переключения остаётся в коде, но данные переезжают в JSON |
| **E. Planet zone weights** (per-orbit-zone planet type selection, 4 zones × 7 weights) | `generate-planets.ts:65-121` inline | ✅ Да | MEDIUM | **S** (≈3h) | MEDIUM — порядок вызовов rng.weightedChoice критичен для детерминизма; нужно очень осторожно сохранить последовательность rng-вызовов |
| **F. Resource category multipliers** (`CATEGORY_MULTIPLIERS` 7×8) | `generate-resources.ts:22-30` (TS-inline) | ✅ Да | MEDIUM | **S** (≈3h) | LOW |
| **G. Galaxy DEFAULT_CONFIG** (12 полей) | `generator.ts:57-78` (TS const) | ✅ Да | LOW (уже частично в config-объекте) | **S** (≈2h) | LOW |
| **H. Position fractions** (bulge=15%, disk=20%, halo=5%) | `generate-positions.ts:39-41` | ✅ Да | LOW (part of G) | S | LOW |
| **I. System names** (`GREEK`, `CONSTELLATIONS`) | `generate-systems.ts:17-18` | ✅ Да | LOW | S | LOW |
| **J. Jump point tunables** (targetCount range, stabilized chance) | `generate-jump-points.ts:37, 53` | ✅ Да | LOW | S | LOW |
| **K. Moon parameters** (`GAS_GIANT_MOON_COUNT` etc.) | `planet-types.ts:66-99` | ✅ Да (включено в C) | — | — | — |
| **L. Atmosphere gases** (`ATMOSPHERE_GAS_MAP`, `DIRECT_GAS_MAP`) | `atmosphere-gases.ts:33-60` | ✅ Да | MEDIUM | S | LOW |
| **M. Orbital step constants** (`BASE_STEP_AU=0.5`, `MAX_JITTER_AU=0.25`) | `generate-planets.ts:457-458` | ✅ Да | LOW (фиксируется в galaxy-generation-audit) | S | MEDIUM — критично для монотонности Кеплера |
| **N. Asteroid field tunables** (NS/PULSAR 1-4, GG bonus, binary bonus) | `generate-systems.ts:246-257` | ✅ Да | LOW | S | LOW |
| **O. Bond albedo ranges per planet type** | `generate-planets.ts:198-206` | ✅ Да (включено в D) | — | — | — |
| **P. Type temperature modifiers** | `generate-planets.ts:179-185` | ✅ Да (включено в D) | — | — | — |
| **NOT extracting — Physics constants / formulas** | | | | | |
| ~Stefan-Boltzmann formula~ | `generate-systems.ts:104-113` | ❌ PHYS | — | — | — |
| ~Mass-radius formula `M^0.8/M^0.57`~ | `generate-systems.ts:139-143` | ❌ PHYS | — | — | — |
| ~T_eq formula~ | `generate-planets.ts:157` | ❌ PHYS | — | — | — |
| ~Kepler's 3rd law (orbital period)~ | `generate-planets.ts:491` | ❌ PHYS | — | — | — |
| ~Moon period formula `1.77 × (a/421700)^1.5`~ | `generate-planets.ts:650` | ❌ PHYS | — | — | — |
| ~Kopparapu HZ coefficients~ | `generate-planets.ts:60-62` | ❌ PHYS (peer-reviewed) | — | — | — |
| ~T_SUN = 5778K~ | `generate-systems.ts:105, 111` | ❌ PHYS | — | — | — |
| ~Hex grid geometry~ | `hex-grid.ts:38, 45-46, 85-95` | ❌ PHYS | — | — | — |

#### 3.3.2 Итоговый вердикт

**ДА, параметры генерации звёзд и планет ДОЛЖНЫ быть вынесены в JSON-файлы**, но **НЕ все, а только справочно-табличные** — те, что уже описаны в `docs/20-stars.md §7.2` (JSON-структура stars) и частично в `docs/30-planets.md`. Физические формулы и константы (Stefan-Boltzmann, Kepler's 3rd law, mass-radius power laws, Kopparapu HZ coefficients, T_SUN) **остаются в коде** — это научные законы, а не designer-tunable данные.

**Рекомендуемый объём миграции (MVP-scope):**

1. **Etap 4.1 (HIGH, S effort, ~4h): Star catalog** — вынос `STAR_TYPES` + `SPECIAL_STAR_RANGES` в `src/data/stars/types.json` + thin loader `src/data/stars/index.ts` + validator `scripts/validate-stars.ts` + тесты. Это закрывает doc-vs-code разрыв (`docs/20-stars.md §7.2` уже описывает JSON-формат). **Bonus:** приведение цвета звёзд к стандартным спектральным (Doc §7.3), иначе расхождение останется.

2. **Etap 4.2 (HIGH, M effort, ~8h): Planet catalog** — вынос `PLANET_TYPES` + `PLANET_DENSITY` + `PLANET_TYPE_RADIUS` + `LIFE_LEVEL_WEIGHTS` + `GAS_GIANT_MOON_COUNT` + `MOON_RADIUS/DENSITY/ORBIT_RADIUS/TYPE_WEIGHTS` в `src/data/planets/types.json` + `src/data/planets/moons.json` + thin loaders + validator + тесты.

3. **Etap 4.3 (HIGH, M effort, ~6h): Atmosphere tables** — вынос greenhouse-ΔT / pressure / albedo / type-probability per planet в `src/data/planets/atmosphere-tables.json`. Логика `selectAtmosphereType` / `getAtmospherePressure` / `getAlbedo` остаётся как thin function поверх JSON.

4. **Etap 4.4 (MEDIUM, S effort, ~3h): Planet zone weights** — вынос `selectPlanetType` весов (4 зоны × 7 типов) в `src/data/planets/zone-weights.json`. **Risk:** критично сохранить последовательность `rng.weightedChoice` вызовов для детерминизма (тесты T-GALAXY должны это верифицировать).

5. **Etap 4.5 (MEDIUM, S effort, ~3h): Resource multipliers** — вынос `CATEGORY_MULTIPLIERS` (7×8) + baseQuantity/hexFraction в `src/data/planets/resource-multipliers.json`.

6. **Etap 4.6 (LOW, total ~6h, S each): Galaxy config + names + jump-points + orbital-step** — вынос `DEFAULT_CONFIG`, fractions, `GREEK`/`CONSTELLATIONS`, JP-tunables, `BASE_STEP_AU`/`MAX_JITTER_AU` в `src/data/galaxy/config.json` + `src/data/galaxy/names.json`. Это low-priority, но симметрично с тем, что делает владелец вEtape 4 для recipes/elements.

**Общий объём:** ~30 часов работы (4 medium + 4 small tasks). Покрывается тем же установленным паттерном JSON + thin loader + validator + tests (см. `data-driven-architecture.md §6`). После миграции data-driven-architecture.md roadmap §8.2 пополнится 4 новыми завершёнными позициями (stars/planets/atmosphere-tables/zone-weights).

**Главный риск для всех 6 подзадач:** детерминизм PRNG. Порядок вызовов `rng.weightedChoice()` / `rng.nextFloat()` / `rng.nextInt()` **должен быть сохранён идентично** — иначе сломаются snapshot-тесты (`tests/galaxy-snapshot.test.ts`, `tests/prng-statistical.test.ts`) и сериализованные сейвы. Митигация: TDD — сначала написать `tests/galaxy/snapshot-before-extraction.json`, потом делать вынос, потом дифф-тест на идентичность galaxy-вывода.

---

## 4. Аудит docs consistency (Task 21-c, summary)

Подагент 21-c провёл полную сверку документации vs репо. Главные расхождения (полный список в worklog Task 21-c):

| Doc | Severity | Key issue |
|---|---|---|
| `STATUS.md` §1/§2.5/§3.2 | HIGH | Лишние/недостающие building entries; metrics (49/417 not 50/340); path references DELETED `src/data/buildings.ts` |
| `40-buildings.md` | HIGH | Header date stale; §1.5:96 references DELETED `buildings.ts`; §10.1:1139 «15 зданий» (actual 17) |
| `60-research.md` | HIGH | Header «72 технологии, Draft 0%» (actually 15 techs, fully implemented in R-RES) |
| `!listing.md` | HIGH | Header lines/tokens stale (23 448 lines actual vs ~20 560 stated); row counts off; statuses 50-ships/60-research say «❌ 0%» but both implemented |
| `00-ARCHITECTURE.md` §8 | HIGH | Outdated project tree (DELETED buildings.ts, wrong counts 8/22/18 vs actual 17/60/75, missing src/ships/, src/research/, src/data/{buildings,ships,research,chemistry}/ subdirs) |
| `02-dev-process.md` §5 | HIGH | Etap 3.0 marked «⏳ Pending» — actually COMPLETE (Tasks 4, 17-20) |
| `20-stars.md` §7.2 | HIGH (galaxy-specific) | Doc уже описывает JSON-структуру stars, но код — TS-inline. Подтверждает, что владелец в своё время задумывал extraction, но не сделал. |

Полный worklog с file:line каждой inconsistency находится в worklog Task 21-c.

**Top-5 priority doc fixes:**
1. `STATUS.md` — path build/*.json, counts (17/27), metrics (49/417), implemented list.
2. `40-buildings.md` — header date, paths, counts, remove §13 TODO.
3. `60-research.md` — header fix «15 techs MVP, ✅ Реализовано (R-RES)».
4. `!listing.md` — recompute row line counts + header totals (23 448 lines, ~407K tokens), statuses 50-ships/60-research → ✅ MVP, fix «27 зданий (12 реализовано)» → 17.
5. `00-ARCHITECTURE.md §8` — обновить project tree (delete buildings.ts, fix counts 8→17/22→60/18→75, add src/ships/, src/research/, src/data/{buildings,ships,research,chemistry}/).

---

## 5. Конечный итог аудита

### 5.1 Что работает (✅ green)

- **Quality gates**: lint 0/49, tsc 159 (=baseline), tests 417/0, validate:all (recipes 75/75 + buildings 17/17 + ships 4+20+4) — **все зелёные**.
- **Data-driven catalog system**: buildings/research/ships — 3 реализованных каталога, паттерн работает, public API стабилен, валидаторы + тесты зелёные.
- **Modular building system** (R-BLD-MOD): 17 зданий в 3 JSON-файлах по слою (surface/orbit/space) + requiresTechs gate + bonus system (building-sourced + tech-sourced).
- **Modular ships catalog** (R-SHIPS-DATA): 4 корпуса + 20 модулей + 4 FuelType в 3 JSON-файлах + thin loaders + validator + 26 тестов.
- **Bonus unification**: единый `Bonus` interface, 2 источника, обратная совместимость.
- **Documentation**: data-driven-architecture.md (новый 360-строчный главный документ), 50-ships.md §11 (новый раздел), 03-project-structure.md (дерево обновлено).

### 5.2 Пробелы / TODO

| # | Пробел | Severity | Effort | Owner |
|---|---|---|---|---|
| Q1 | Research loader не следует `as unknown as` паттерну (data-driven-architecture.md §3.1) | MINOR | S | Etap 4 cleanup |
| Q2 | Нет `validate:research` standalone script (только init-time в engine) | MINOR | S | Etap 4 |
| Q3 | Stale docs (STATUS.md / 40-buildings.md / 60-research.md / !listing.md / 00-ARCHITECTURE.md §8) | HIGH | M | Independent doc-fix task |
| Q4 | `emptyFuelStore()` hardcode (4 FuelType) | MINOR | S | Etap 4 (уже в roadmap) |
| Q5 | recipes/elements/ores — inline TS (не data-driven) | MEDIUM | M (each) | Etap 4 (уже в roadmap §8.2) |
| Q6 | **Star/planet generation params — TS-inline, не data-driven** (главный вопрос владельца) | MEDIUM → HIGH | ~30h (4.1-4.6) | **NEW Etap 4.x — рекомендуется** |

### 5.3 Рекомендация владельцу (ответ на главный вопрос)

**ДА, параметры генерации звёзд и планет необходимо вынести в файлы**, следуя уже установленному паттерну (JSON + thin loader через `as unknown as` + validator + tests). Подтверждение: `docs/20-stars.md §7.2` уже описывает целевую JSON-структуру — то есть extraction был запланирован изначально, но не выполнен.

**Рекомендуемый объём миграции (4 HIGH-priority + 2 LOW-priority tasks):**

- **HIGH: Star catalog (Etap 4.1, ~4h, S)** — `STAR_TYPES` + `SPECIAL_STAR_RANGES` → `src/data/stars/types.json`
- **HIGH: Planet catalog (Etap 4.2, ~8h, M)** — `PLANET_TYPES` + density/radius/moon/life tables → `src/data/planets/types.json` + `moons.json`
- **HIGH: Atmosphere tables (Etap 4.3, ~6h, M)** — greenhouse ΔT / pressure / albedo / type-probabilities → `src/data/planets/atmosphere-tables.json`
- **HIGH: Planet zone weights (Etap 4.4, ~3h, S)** — selectPlanetType weights → `src/data/planets/zone-weights.json`
- **MEDIUM: Resource multipliers (Etap 4.5, ~3h, S)** — CATEGORY_MULTIPLIERS → `src/data/planets/resource-multipliers.json`
- **LOW: Galaxy config + names + JP-tunables + orbital-step (Etap 4.6, ~6h, S each)** → `src/data/galaxy/config.json` + `names.json`

**НЕ выносить (научные формулы/константы):** Stefan-Boltzmann, Kepler's 3rd law, mass-radius power laws, Kopparapu HZ coefficients, T_SUN=5778K, hex grid geometry — остаются в коде.

**Главный риск для всех подзадач — детерминизм PRNG.** Митигация: TDD с pre-extraction snapshot, потом дифф-тест на идентичность galaxy-вывода. Если сохранять идентичный порядок вызовов `rng.weightedChoice/nextFloat/nextInt`, snapshot-тесты (`galaxy-snapshot.test.ts`, `prng-statistical.test.ts`) и сериализованные сейвы останутся зелёными.

---

## 6. Файлы, изменённые в этом аудите

- `checkpoints/audit_2026_08_28_09_post_r_ships_galaxy_eval.md` (NEW — этот файл)
- `worklog.md` (NEW section: Task ID 21 — main audit coordinator)

**Кода не изменено.** Аудит чисто исследовательский. Все recommendations будут выполняться в отдельных задачах (если владелец одобрит).

---

> **Конец аудита Pass 9.**
