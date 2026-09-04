# R-BLD-MOD: Модульная data-driven система построек (2026-08-28)

## Задача
Большой рефакторинг: вынести определения построек из единого TS-файла
(`src/data/buildings.ts`, 287 строк, 14 зданий) в модульную систему
внешних человеко-читаемых JSON-файлов, организованных по слою размещения.
Добавить поля: тип поверхности, технологии для открытия, бонусы от
уровней технологий (коэффициент влияния + минимальный уровень).

## Решение

### Формат данных
JSON (нативная поддержка TS `resolveJsonModule`, как и для research).
Каждый файл — объект `{ "comment": "...", "buildings": BuildingDef[] }`
с человеко-читаемым описанием и массивом определений.

### Структура файлов
```
src/data/buildings/
  surface.json   — 14 зданий (поверхность + атмосфера газ. гигантов)
  orbit.json     — 1 здание (Космопорт)
  space.json     — 2 stub-здания (вокруг звезды, post-MVP, tech-gated)
  index.ts       — loader: загружает 3 JSON, объединяет в BUILDINGS +
                   BUILDING_MAP, экспортирует CATEGORY_NAMES/ICONS/
                   LAYER_NAMES + areBuildingTechsMet helper
```
Старый `src/data/buildings.ts` удалён. Публичный API сохранён — все 11
потребителей работают без правок импортов.

### Новые поля BuildingDef (src/core/types.ts)
- `requiresTechs?: { techId: string; minLevel: number }[]` — технологии
  для ОТКРЫТИЯ постройки. Если отсутствует — здание доступно с старта.
- `terrainTypes?: HexTerrain[]` — allowlist местности (если отсутствует —
  любая местность). Отличается от `terrainBonus` (множитель выхода).
- `BuildingLayer` расширен: добавлен `'space'` (вокруг звезды, post-MVP).

### Расширение интерфейса Bonus
Добавлены поля для tech-sourced бонусов (источник — уровень технологии,
а не уровень здания):
- `sourceTech?: string` — ID технологии-источника.
- `minTechLevel?: number` — с какого уровня технологии начинается влияние.
- `perTechLevel?: boolean` — если true, value × (techLevel - minTechLevel + 1).

Семантика в bonus-resolver.ts:
- Building-sourced (без sourceTech): `value × buildingLevel` (если perLevel).
- Tech-sourced (с sourceTech): если `researched[sourceTech] >= minTechLevel`,
  contribution = `value × (perTechLevel ? techLevel - minTechLevel + 1 : 1)`.

### Data-driven гейт построек
- `areBuildingTechsMet(building, researched)` helper в `src/data/buildings/index.ts`.
- engine.ts: `buildOnHex`/`buildOnAtmosphereSlot`/`buildOnOrbitSlot` получили
  опциональный параметр `researched?` (backward-compat: 3-арг вызовы из
  тестов работают). При переданном researched проверяется requiresTechs
  и terrainTypes. Добавлены ранние guard'ы `if (!hex/slot) return false`
  (сузили noUncheckedIndexedAccess, -9 ошибок tsc).
- economy-module.ts: передаёт `currentState.researchState.researched` во
  все три engine-функции (гейт активен в реальной игре).
- building-dialog.tsx: `BuildList` фильтр скрывает здания с невыполненными
  requiresTechs (видны только в справочнике).

### Демонстрационные данные
- `synthesizer` + `refinery`: `requiresTechs: [{ steel_processing, minLevel: 1 }]`
  (формализовало ранее косметический хардкод `b.id === 'synthesizer' || 'refinery'`).
- `laboratory`: 2-й бонус `{ target: research_rate, add, 0.03,
  sourceTech: microelectronics, minTechLevel: 3, perTechLevel: true }`
  → +3% к research_rate за уровень микроэлектроники начиная с L3.
- `starlift_collector` (space.json): tech-sourced бонус `extraction_rate`
  от `fusion_reactor` ≥L5, perTechLevel.
- `deep_space_sensor` (space.json): requires `short_range_sensors` ≥L3.
- Оба space-здания — post-MVP stubs: слой 'space' (нет buildOnSpaceSlot),
  tech-gated, видны только в справке.

### UI обновления
- reference-dialog.tsx BuildingsTab: data-driven бейдж «требует технологию»
  (заменён хардкод), блок «Требуется:» с именами техов (через TECH_MAP),
  блок «Бонусы:» (building-sourced + tech-sourced, с указанием источника).
- building-dialog.tsx: LAYER_LABELS добавлен 'space', researched prop
  в BuildList, фильтр requiresTechs.

### Validator
`scripts/validate-buildings.ts` (+ `validate:buildings` в package.json):
проверяет уникальность ID, валидность layer/category/size/terrainBonus,
существование requiresTechs[].techId и bonuses[].sourceTech в TECH_MAP,
minTechLevel ≥ 1. Выводит разбивку по слоям + список tech-gated зданий.

## Quality gates (all green)
- `bun run lint`: 0 errors / 49 warnings (= baseline)
- `bunx tsc --noEmit`: **159 errors** (baseline 168, **-9** благодаря
  ранним guard'ам hex/slot в build-функциях)
- `bun test`: **391 pass / 0 fail** (было 369; +22 новых: 6 tech-sourced
  bonus + 16 building-tech-gate)
- `bun run validate:recipes`: 75/75
- `bun run validate:buildings`: 17/17 valid (4 tech-gated, 2 с бонусами)
- dev.log: 0 runtime errors, все GET 200
- agent-browser: Справка → Здания показывает все 17 зданий (14 surface +
  spaceport + 2 space stubs), data-driven бейджи «требует технологию»,
  блоки «Требуется:» (Обработка стали / fusion_reactor / short_range_sensors),
  блоки «Бонусы:» (2 у Лаборатории: research_rate building-sourced +
  microelectronics tech-sourced; 1 у Звёздного лифта: extraction_rate
  от fusion_reactor ≥L5)

## Изменённые файлы
- src/core/types.ts: + 'space' layer, + requiresTechs, + terrainTypes,
  + sourceTech/minTechLevel/perTechLevel на Bonus
- src/data/buildings.ts: УДАЛЕН
- src/data/buildings/surface.json: NEW (14 зданий)
- src/data/buildings/orbit.json: NEW (Космопорт)
- src/data/buildings/space.json: NEW (2 stubs)
- src/data/buildings/index.ts: NEW (loader + areBuildingTechsMet)
- src/research/bonus-resolver.ts: + tech-sourced branch в applyBuildingBonuses
- src/economy/engine.ts: + researched? param + terrainTypes gate +
  if(!hex/slot) guards в 3 build-функциях
- src/economy/economy-module.ts: + researched в engine-вызовы
- src/components/game/building-dialog.tsx: + researched prop в BuildList,
  + tech-gate фильтр, + 'space' в LAYER_LABELS
- src/components/game/reference-dialog.tsx: data-driven requiresTechs
  badge + блоки Требуется/Бонусы, + TECH_MAP import
- scripts/validate-buildings.ts: NEW
- package.json: + validate:buildings script
- tests/research/bonus-resolver.test.ts: + 6 tech-sourced тестов
- tests/economy/building-tech-gate.test.ts: NEW (16 тестов)
