# Checkpoint — R-STARS-DATA / Etap 4.1: Экстракция звёздного каталога + размерности сеток

> **Дата:** 2026-08-31 (новый день, 09:55 MSK)
> **Задача владельца:** начать экстракцию звёздного каталога; проверить использования цепочки спектральных классов O–B–A–F–G–K–M; добавить несколько процентов (не больше 5) звёздных объектов вне основной диаграммы классов (гиганты, пульсары, чёрные дыры и т.п.); планеты генерируются процедурно, но во внешнем файле хранится размерность сетки (количество гексов на планете) — минимум 5 планетарных сеток и 2 маленькие для спутников.
> **Рекомендация-источник:** Audit Pass 9 §3.3.1 (Etap 4.1 HIGH, S, ~4h) — `checkpoints/08_28_audit_09_post_r_ships_galaxy_eval.md`.
> **HEAD до:** `ea389c7` (audit pass-9; хеш изменился с 2d51ea8 из-за отката окружения — контент идентичен, verified).
> **HEAD после:** см. git log (commit R-STARS-DATA).

---

## 1. Проверка актуальности окружения (после отката)

- Системная дата: **2026-08-31 09:55 MSK** (Europe/Moscow).
- HEAD `ea389c7` = пере-коммит аудита Pass 9 (тот же message, 606 insertions, checkpoint 303 строк идентичен). Working tree чист.
- Базовая линия подтверждена: lint 0/49, tsc 159, tests 417/0, validate:all green.
- Вывод: **откат окружения произошёл, контент цел** — можно работать.

## 2. Проверка цепочки спектральных классов O–B–A–F–G–K–M (просьба владельца)

Найдено **5 потребителей** цепочки (порядок O→B→A→F→G→K→M критичен для первых трёх):

| # | Потребитель | Файл | Тип зависимости | Статус после задачи |
|---|---|---|---|---|
| 1 | `STAR_TYPES.slice(0, 7)` — выделение ГП | `src/galaxy/generate-systems.ts:13` (было) | **ORDER-DEPENDENT** | Импорт из каталога; инвариант залочен валидатором + тестом 2 |
| 2 | `selectCompanionStar` — «тот же класс или на 1 ниже» через `indexOf` | `src/galaxy/generate-systems.ts:49-66` | **ORDER-DEPENDENT** | Работает поверх MAIN_SEQUENCE_STAR_TYPES из каталога; тест 21 (компаньоны только ГП) |
| 3 | `MAIN_SEQUENCE_TYPES` Set — createStar ветка ГП vs спец | `generate-systems.ts:101` (было hardcode-дубликат) | ORDER-INDEPENDENT (Set) | Дубликат удалён, импорт из каталога |
| 4 | `STAR_TYPE_MAP` — имена/цвета звёзд в UI | `src/components/game/system-view.tsx` | ORDER-INDEPENDENT | Импорт обновлён на `@/data/stars` |
| 5 | **Легенда карты галактики** O B A F G K M с цветами | `src/components/game/galaxy-map.tsx:537-543` (было 7 hardcode-строк) | ORDER-DEPENDENT (визуальный порядок) | **РЕФАКТОРНУТО**: `MAIN_SEQUENCE_STAR_TYPES.map(...)` — порядок и цвета автоматически из каталога |

Scripts (star-dist-test.ts, audit-generator.ts) — order-independent, импорты обновлены.

## 3. Что сделано

### 3.1 Звёздный каталог (data-driven)

- **NEW** `src/data/stars/types.json` — 12 типов звёзд:
  - `mainSequence` (7): **O→B→A→F→G→K→M в ОБЯЗАТЕЛЬНОМ порядке** (поля: type/name/mass/luminosity/temperature/radius/color/minPlanets/maxPlanets/weight);
  - `special` (5): WD/RG/NS/PULSAR/BH с `ranges` (massMin/Max, tempMin/Max, radiusMin/Max из 20-stars.md §2.1);
  - top-level `comment` с полным описанием semantics + per-entry `comment` у специальных;
  - **веса специальных подняты с 0.8% до 4.0%** (требование владельца «несколько процентов, не больше 5»): WD 1.5 / RG 1.0 / NS 0.68 / PULSAR 0.35 / BH 0.6 (сумма 4.13 от общего 103.333 = **3.997%**). ГП не менялись (M=76 доминирует, реалистично).
- **NEW** `src/data/stars/index.ts` — тонкий loader (каст через `as unknown as StarsFile` по паттерну data-driven-architecture.md §3.1). Публичный API старого star-types.ts сохранён (STAR_TYPES, STAR_TYPE_MAP, STAR_WEIGHTS, getStarTypeDef) + новые экспорты: MAIN_SEQUENCE_STAR_TYPES/WEIGHTS, SPECIAL_STAR_TYPES, SPECIAL_STAR_RANGES, MAIN_SEQUENCE_TYPES, SPECTRAL_CHAIN, specialStarFraction().
- **DELETED** `src/data/star-types.ts` — 4 потребителя обновлены напрямую (system-view.tsx, generate-systems.ts, star-dist-test.ts, audit-generator.ts), без шима.
- `generate-systems.ts` — удалены 3 локальных hardcode-дубликата (MAIN_SEQUENCE_STAR_TYPES/WEIGHTS line 13-14, SPECIAL_STAR_RANGES line 88-98, MAIN_SEQUENCE_TYPES Set line 101) — теперь единый источник: каталог. Логика createStar/selectCompanionStar НЕ изменена (физика: Стефан-Больцман, R=M^0.8/0.57 — в коде, как рекомендовал audit Pass 9).

### 3.2 Размерности гекс-сеток (data-driven)

- **NEW** `src/data/planets/grids.json`:
  - `planetGrids` — **5 планетарных сеток** (требование владельца «минимум 5»): tiny=19, small=37, medium=61, large=91, huge=127 (центрированные гекс-числа 1+3k(k+1), кольца 2–6);
  - `moonGrids` — **2 малые сетки для спутников** (требование «2 маленькие»): tiny=7 (1 кольцо), small=19 (2 кольца);
  - top-level `comment`.
- **NEW** `src/data/planets/grids.ts` — тонкий loader (PLANET_GRIDS, MOON_GRIDS).
- `src/data/planet-types.ts` — `SIZE_HEX_COUNT` = PLANET_GRIDS (обратная совместимость, значения идентичны старым — планеты не изменились) + новый экспорт `MOON_SIZE_HEX_COUNT` = MOON_GRIDS.
- `src/galaxy/hex-grid.ts` — `generateHexGrid(size, weights, rng, gridMap?)` — опциональная карта сеток (по умолчанию планетарные; луны передают лунные). Fallback на планетарную при отсутствии ключа.
- `src/galaxy/generate-planets.ts` — generateMoons: размер луны теперь **2-уровневый** (R<0.15 R⊕ → tiny=7 гексов; иначе → small=19; раньше 3 уровня до medium=61 — луны использовали планетарные сетки, что противоречило требованию). Луна Ганимед-класса (≥0.15 R⊕) получает «small» = 19 гексов.
- `src/core/types.ts` — комментарий Moon.size обновлён («2 выделенные малые сетки из planets/grids.json: 7/19 гексов»).

### 3.3 Валидатор

- **NEW** `scripts/validate-stars.ts` (`bun run validate:stars`) — 29 проверок в 2 разделах:
  - STARS: структура (7+5), **спектральная цепочка в точном порядке O→B→A→F→G→K→M**, SPECTRAL_CHAIN совпадение, special = {WD,RG,NS,PULSAR,BH} с валидными ranges, уникальность ID, weights>0, **доля specials 2%≤x≤5%** (падает при нарушении), физическая монотонность T/M/L вдоль цепочки, числовая валидность, hex-цвета, loader API, инвариант slice(0,7);
  - GRIDS: ≥5 планетарных, ≥2 лунных, ключи {tiny..huge}/{tiny,small}, центрированные гекс-числа, возрастание, max(moon) ≤ min(planet), loader API, SIZE_HEX_COUNT/MOON_SIZE_HEX_COUNT соответствие.
- `package.json`: `validate:stars` + `validate:all` теперь включает 4 валидатора.

### 3.4 Тесты

- **NEW** `tests/galaxy/star-catalog.test.ts` — **22 теста** в 3 describe:
  - Звёздный каталог (10): структура 12=7+5, цепочка O→B→A→F→G→K→M (mainSequence + SPECTRAL_CHAIN + slice-инвариант), доля specials ~0.03997 в (0.02, 0.05], уникальность/веса, STAR_TYPE_MAP/getStarTypeDef (fixture STAR_G), SPECIAL_STAR_RANGES (fixture WD), MAIN_SEQUENCE_TYPES, веса компаньонов, монотонность T/M/L, зафиксированные спец-веса;
  - Сетки (6): 5 планетарных (fixture 19/37/61/91/127), 2 лунные (7/19) + малость, центрированные гекс-числа + формула, обратная совместимость SIZE_HEX_COUNT, generateHexGrid с MOON_GRIDS (7/19) и fallback (61/19);
  - Интеграция генератора (6): звёзды соответствуют каталогу (type+color), **все луны size∈{tiny,small}, hexes∈{7,19}**, планеты hexes∈планетарным сеткам, детерминизм (2 вызова идентичны), компаньоны только ГП, 2-уровневый размер лун.
- **UPDATED** `tests/galaxy-snapshot.test.ts` — EXPECTED_STAR_TYPES перезаписан (документированная политика breakage): seed=42 теперь даёт 11 типов (добавились NS/PULSAR/RG — следствие поднятия весов specials с 0.8% до 4%; O отсутствует — вес 0.003).

### 3.5 UI

- `src/components/game/galaxy-map.tsx` — легенда спектральных классов O B A F G K M рефакторнута с 7 hardcode-строк на `MAIN_SEQUENCE_STAR_TYPES.map()` (порядок + цвета автоматически из каталога).
- `src/components/game/system-view.tsx` — импорт STAR_TYPE_MAP обновлён (логика не тронута).

### 3.6 Документация

- `docs/data-driven-architecture.md` (v1.0 → v1.1): NEW §2.4 «Stars + Planet Grids» (таблица файлов, поля, 8 особенностей, валидатор, тесты); §6.5 «Добавить новый тип звезды» + §6.6 «Изменить размерность сетки» (DATA-DRIVEN расширение); §8.1 +stars; §8.2 +planets-catalog (Etap 4.2) + galaxy-config (4.6); header v1.1 + статус + зависимости.
- `docs/20-stars.md`: §7.1 — частоты Freq для WD/RG/NS/PULSAR/BH обновлены (1.5/1.0/0.68/0.35/0.6) + примечание о требовании владельца; §7.2 — переименован в «РЕАЛИЗОВАНО», описан фактический формат types.json + ключевые инварианты, старый концепт завёрнут в `<details>` (post-MVP); §7.3 — примечание: научная палитра vs игровая (источник истины для рендера — каталог).
- `docs/30-planets.md`: §2.1 — примечание о data-driven grids.json (5 планетарных + 2 лунные, требование владельца).

## 4. Детерминизм PRNG (главный риск из аудита — проверен)

- `weightedChoice` потребляет ровно **один** `nextFloat()` независимо от результата → изменение весов меняет содержимое галактики, но НЕ сдвигает PRNG-поток (alignment стабильный).
- Луны используют derived-стримы (`rng.derive('hexes')` и т.д.) → изменение числа гексов лун не влияет на соседние стримы.
- Тест 20 (детерминизм) зелёный; тест 2 снапшота (детерминизм) зелёный; снапшот-контент обновлён один раз (осознанное изменение баланса, авторизовано владельцем).
- Seed=42, 500 систем: 710 звёзд (543 M / 75 K / 45 G / 17 F / 11 WD / 5 RG / 4 NS / 3 PULSAR / 3 BH / 3 A / 1 B), спец. = 26/710 = 3.66% ✓; 1003 луны, гексы только {7,19} ✓; планеты {19,37,61,91,127} + 0 (ГГ) ✓.

## 5. Качественные метрики

| Gate | До | После | Δ |
|---|---|---|---|
| lint | 0 errors / 49 warnings | 0 errors / 49 warnings | 0 (= baseline) |
| tsc --noEmit | 159 | 159 | 0 (= baseline, паттерн кодов идентичен) |
| bun test | 417/0 | **439/0** | **+22** |
| validate:recipes | 75/75 ✓ | 75/75 ✓ | 0 |
| validate:buildings | 17/17 ✓ | 17/17 ✓ | 0 |
| validate:ships | 4+20+4 ✓ | 4+20+4 ✓ | 0 |
| validate:stars | — | **12 звёзд + 7 сеток ✓** | NEW |
| validate:all | 3 валидатора | **4 валидатора** | +1 |

## 6. Agent-browser верификация (dev server, hot-reload)

- ✓ Главное меню + Launch Game (seed 298447).
- ✓ Карта галактики: 200 систем, маркеры с числом планет («Omicron Phoenicis 3P»).
- ✓ **Легенда O B A F G K M** — рендерится из каталога (после рефактора galaxy-map.tsx: «Unstabilized Stabilized O B A F G K M»).
- ✓ System view: звезда «Жёлто-белая» (F, 7kK, 1.16 M☉, 2.82 L☉ — ±15% вариация из createStar), компаньон «Жёлтый карлик» (G) — имена из STAR_TYPE_MAP нового каталога; «Красный карлик» (M) в Omega Virginis.
- ✓ Jump point навигация (Omicron Phoenicis → Omega Virginis).
- ✓ Газовый гигант «Omega Virginis IV»: вид планеты показывает **«ЛУНЫ ГАЗОВОГО ГИГАНТА (2): IV-a Карликовая 3142км 0.16g 19 гекс; IV-b Карликовая 1569км 0.09g 19 гекс»** — лунные сетки из grids.json работают в UI.
- ✓ Справка → Планеты: «Гексов» 61/37/37/61/61/—/19 — из data-driven SIZE_HEX_COUNT.
- ✓ agent-browser errors: пусто; console: без error/warn; dev.log: GET / 200, GET /api/save 200, prisma OK, компиляция HMR успешна.
- Скриншот: /tmp/stars-verification.png.

## 7. Изменённые файлы

| Файл | Действие |
|---|---|
| `src/data/stars/types.json` | NEW — каталог 12 звёзд (7 ГП цепочкой + 5 спец., веса 4%) |
| `src/data/stars/index.ts` | NEW — тонкий loader + API |
| `src/data/planets/grids.json` | NEW — 5 планетарных + 2 лунные сетки |
| `src/data/planets/grids.ts` | NEW — тонкий loader |
| `src/data/star-types.ts` | DELETED (заменён каталогом) |
| `src/galaxy/generate-systems.ts` | Импорты из каталога, удалены 3 hardcode-дубликата |
| `src/galaxy/generate-planets.ts` | Луны: 2-уровневый размер + MOON_SIZE_HEX_COUNT |
| `src/galaxy/hex-grid.ts` | Опциональный параметр gridMap |
| `src/data/planet-types.ts` | SIZE_HEX_COUNT из grids.json + MOON_SIZE_HEX_COUNT |
| `src/components/game/galaxy-map.tsx` | Легенда цепочки — data-driven |
| `src/components/game/system-view.tsx` | Импорт обновлён |
| `src/core/types.ts` | Комментарий Moon.size |
| `scripts/validate-stars.ts` | NEW — валидатор (29 проверок) |
| `package.json` | validate:stars + validate:all |
| `tests/galaxy/star-catalog.test.ts` | NEW — 22 теста |
| `tests/galaxy-snapshot.test.ts` | Снапшот перезаписан (политика breakage) |
| `docs/data-driven-architecture.md` | v1.1: §2.4, §6.5, §6.6, §8.1, §8.2 |
| `docs/20-stars.md` | §7.1 частоты, §7.2 РЕАЛИЗОВАНО, §7.3 примечание |
| `docs/30-planets.md` | §2.1 примечание о grids.json |

Создано: 6 файлов. Изменено: 14. Удалено: 1.

## 8. Что дальше (не тронуто)

- Etap 4.2 — планетарный каталог (PLANET_TYPES + density/radius/life → `src/data/planets/types.json`) — по рекомендации аудита Pass 9.
- Etap 4.3–4.6 — atmosphere-tables, zone-weights, resource-multipliers, galaxy-config.
- Документационный долг из Task 21-c (STATUS.md, 40-buildings, 60-research, !listing, 00-ARCHITECTURE §8) — отдельная задача.

---

> **Конец checkpoint R-STARS-DATA.**
