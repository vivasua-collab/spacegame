# Чекпоинт: Система запекания химии и генератор рабочей модели

**Дата:** 2026-05-04 17:12 UTC (обновлено)
**Фаза:** 2
**Статус:** complete ✅

## Выполненные задачи

### Система запекания галактики (концепция + реализация)
- ✅ Создан `docs/galaxy-bake.md` — концепция запекания (Galaxy Baking)
- ✅ Определены структуры данных: BakedGalaxyModel, BakedElement, BakedOre, BakedAtmospheric, BakedIce, BakedProcessingChain, BakedElementSource
- ✅ Описан алгоритм запекания (6 шагов)
- ✅ Правила неизменности: новый элемент → только новая галактика
- ✅ Формат хранения: в памяти (Zustand) + SQLite
- ✅ Жизненный цикл галактики описан

### Добавление полей в ElementDef
- ✅ `chemicalCharacter: ChemicalCharacter` — 11 значений (reactive_metal, noble_metal, refractory_metal, platinoid, rare_earth, alkali, alkaline_earth, reactive_nonmetal, halogen, gas, transuranic)
- ✅ `oxidationState: number` — типичная степень окисления в руде
- ✅ `rarity: ElementRarity` — 4 уровня (abundant, common, rare, ultra_rare)
- ✅ `atomicNumber: number` — атомный номер
- ✅ `atomicMass: number` — атомная масса (для расчётов молярной массы)
- ✅ Все 57 элементов в `elements.ts` обновлены с новыми полями

### Документация химии
- ✅ Создан `docs/chemistry.md` (v1.0) — полные правила химических взаимодействий:
  - 11 химических характеров с шаблонами руд
  - Степени окисления (§3)
  - Правила образования руд (§4)
  - Матрица здание → тип руды (§5)
  - Правила переработки (§6)
  - Расчёт энергозатрат (§7)
  - Самородные элементы (§8)
  - Атмосферные/ледяные соединения (§9)
  - Трансурановые (§10)
  - Алгоритм автогенерации (§11)
  - Примеры автогенерации (§12)
- ✅ Обновлён `docs/mendeleev.md` (v2.1) — 57 элементов с химическими характерами
- ✅ Обновлён `docs/ores.md` (v2.2) — 47+ руд с полными химическими расчётами
- ✅ Обновлён `docs/modularity.md` (v2.0) — интеграция с chemistry.md

### Создание генератора химии
- ✅ Создан `src/data/chemistry-generator.ts` — ядро системы запекания:
  - Типы BakedGalaxyModel и все вложенные интерфейсы
  - ORE_SPECS — полная спецификация руд для 50+ элементов
  - calculateMolarMass() — расчёт молярной массы
  - calculateYieldsFromFormula() — расчёт выхода из молярных масс
  - getDefaultFormula() — автогенерация формулы по chemicalCharacter + oxidationState
  - getDefaultBuildingAndType() — автогенерация здания добычи
  - getDefaultProcessingParams() — автогенерация энергозатрат
  - Рефакторные альтернативы (Au, Pt, U через refinery)
  - ATMOSPHERE_TYPE_MAP — матрица доступности газов

### Исправленные баги (подтверждено аудитом 2026-05-04)
- ✅ PRNG derive() — переписан на 4 независимых хеша (FNV-1a + Murmur2/3), без SplitMix64 коллапса, 6/6 тестов PASS
- ✅ Баг G-02 (температура горячих звёзд) — атмосфера генерируется ДО температуры, убран Math.min(hzCenter, 5.0)
- ✅ Баг G-01 (lifeChance) — gate по planetDef.lifeChance + модификаторы температуры/атмосферы
- ✅ Баланс атмосферных/ледяных руд — все суммы yield = 10 (химически корректные)
- ✅ Баг гексов — deposit.elementId теперь содержит ID руды (Fe-ore, NaCl, H2O-ice), а не чистого элемента
- ✅ Депрекация `doc_temp/ores-and-chains.md` — помечен устаревшим 2026-05-04

## Текущие задачи

### Интеграция baked model в генератор галактики — ВСЕ ВЫПОЛНЕНЫ
- ✅ Подключить `bakeGalaxyModel(seed, ELEMENTS)` к `GalaxyGenerator.generate()` — ДО генерации систем
- ✅ Использовать BakedGalaxyModel вместо хардкода руд в generate-resources.ts
- ✅ Сохранять BakedGalaxyModel в game-store и в сериализацию
- ✅ Мигрировать processing-chains.ts → chemistry-generator.ts как единый источник данных

## Проблемы
- ~~processing-chains.ts и chemistry-generator.ts дублируют данные о рудах~~ → РЕШЕНО: все потребители мигрированы на baked-lookups

## Следующие шаги
1. ✅ Интегрировать bakeGalaxyModel() в генератор галактики → `05_04_baked_integration.md` (complete)
2. ⏳ Запушить на GitHub

## Изменённые файлы
- docs/galaxy-bake.md (новый)
- docs/chemistry.md (новый)
- docs/mendeleev.md (обновлён)
- docs/ores.md (обновлён)
- docs/modularity.md (обновлён)
- src/data/elements.ts (добавлены поля chemicalCharacter, oxidationState, rarity, atomicNumber, atomicMass)
- src/data/chemistry-generator.ts (новый — 940+ строк)
- src/core/prng.ts (переписан derive() — 4 хеша)
- src/galaxy/generate-planets.ts (G-01, G-02 исправлены)
- src/galaxy/generate-resources.ts (руды вместо элементов в deposits)
- src/data/warehouse.ts (Energy исключён из capacity)
- doc_temp/ores-and-chains.md (депрекация)
