# Task: processing-chains — Создание системы конвейера переработки ресурсов

## Задача
Разработать систему конвейера переработки ресурсов на основе документа `doc_temp/ores-and-chains.md`.

## Что было сделано

### 1. Создан файл `src/data/processing-chains.ts`

Полный файл с типами, константами и функциями для системы переработки ресурсов.

### 2. Типы данных (согласованы с §8 документа)
- `OreType` — тип сырьевого ресурса (metal_ore, nonmetal_ore, gas_compound, ice_compound, deep_ore)
- `SourceBuildingId` — здание добычи (mine, quarry, gas_extractor, drilling_rig, ice_harvester)
- `ProcessingBuildingId` — здание переработки (processor, refinery, synthesizer, null)
- `ContainedElement` — элемент, содержащийся в руде
- `OreDefinition` — определение руды/сырьевого ресурса (§8.1)
- `AtmosphericCompound` — атмосферное соединение (§3.1)
- `IceCompound` — ледяное соединение (§4.1)
- `ProcessingStep` — шаг цепочки переработки
- `ProcessingChain` — полная цепочка переработки
- `ElementSource` — источник элемента (основной + альтернативы)

### 3. Константы
- `ORE_DEFINITIONS` — 33 руды (21 шахта + 12 карьер)
- `ATMOSPHERIC_COMPOUNDS` — 11 атмосферных газов
- `ICE_COMPOUNDS` — 5 ледяных соединений
- `DEEP_ORES` — 18 глубинных руд
- `REFINERY_PROCESSING` — 3 альтернативных пути через Очистительный комплекс (Au, Pt, U)
- `ATMOSPHERE_GAS_AVAILABILITY` — доступность газов по типу атмосферы
- `ICE_TEMP_BONUSES` — бонусы температуры для ледодобывающей станции
- `NATIVE_ELEMENT_CHANCE` — шанс нахождения самородков
- Сводные списки ID: `MINE_ORE_IDS`, `QUARRY_ORE_IDS`, `ATMOSPHERIC_GAS_IDS`, `ICE_COMPOUND_IDS`, `DEEP_ORE_IDS`
- Маппинги: `ORE_MAP`, `ATMOSPHERIC_COMPOUND_MAP`, `ICE_COMPOUND_MAP`

### 4. Экспортированные функции
- `getProcessingChain(elementId)` — возвращает полную цепочку от руды до чистого элемента
- `getRecipesForBuilding(buildingId)` — все рецепты для здания переработки
- `getAtmosphericRecipesForBuilding(buildingId)` — атмосферные соединения для здания
- `getIceRecipesForBuilding(buildingId)` — ледяные соединения для здания
- `getElementSource(elementId)` — откуда добывается элемент
- `getOreForElement(elementId)` — какая руда нужна для элемента
- `getOresForSourceBuilding(buildingId)` — руды для здания добычи
- `getAtmosphericCompoundsForType(atmosphereType)` — доступные газы по типу атмосферы
- `getIceCompoundsForTemp(temperature)` — доступные льды по температуре
- `getIceTempBonus(temperature)` — бонус добычи льда
- `getElementsFromOre(oreId)` — элементы из сырья
- `getProcessingRequirementsForBuilding(buildingId)` — требования переработки

### 5. Здания переработки маппятся на существующие ID из buildings.ts
- Плавильня → `processor`
- Химзавод → `processor`
- Очистительный комплекс → `refinery`
- Синтезатор → `synthesizer`
- Новые здания (drilling_rig, ice_harvester) — как строковые ID для будущей интеграции

## Результаты проверок
- ✅ ESLint: без ошибок
- ✅ TypeScript: без ошибок компиляции
- ✅ Все функции протестированы и работают корректно
- ✅ Существующие файлы (recipes.ts, engine.ts, buildings.ts) не изменены
