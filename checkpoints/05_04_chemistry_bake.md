# Чекпоинт: Система запекания химии и генератор рабочей модели

**Дата:** 2026-05-04 17:05 MSK (обновлено)
**Фаза:** 2
**Статус:** in_progress

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

## Текущие задачи

### Интеграция baked model в генератор галактики
- ⏳ Подключить `bake(seed, ELEMENTS)` к `GalaxyGenerator.generate()`
- ⏳ Использовать BakedGalaxyModel вместо хардкода руд в generate-resources.ts
- ⏳ Сохранять BakedGalaxyModel в game-store и в сериализацию

### Исправление багов
- ❌ Балансные значения в атмосферных/ледяных соединениях (сумма > 10) — в chemistry-generator.ts используются формулы (химически корректные), но в processing-chains.ts ещё балансные
- ❌ Температурный баг G-02 (горячие звёзды) — НЕ ИСПРАВЛЕН
- ❌ Баг G-01 lifeChance — НЕ ИСПРАВЛЕН

### Депрекация временных документов
- ⏳ `doc_temp/ores-and-chains.md` — пометить как устаревший (заменён ores.md + chemistry.md)

## Проблемы
- processing-chains.ts и chemistry-generator.ts дублируют данные о рудах — нужна миграция на единый источник (baked model)
- Атмосферные/ледяные соединения в processing-chains.ts используют «балансные» значения (сумма > 10), в chemistry-generator.ts — химически корректные
- PRNG derive() даёт коррелированные seed'ы — только 2 из 12 типов звёзд генерируются (см. аудит)

## Следующие шаги
1. Интегрировать bake() в генератор галактики
2. Мигрировать generate-resources.ts на BakedGalaxyModel
3. Исправить баги G-01, G-02
4. Заменить балансные значения атмосферных/ледяных руд
5. Депрекейтнуть doc_temp/ores-and-chains.md
6. Запушить на GitHub

## Изменённые файлы
- docs/galaxy-bake.md (новый)
- docs/chemistry.md (новый)
- docs/mendeleev.md (обновлён)
- docs/ores.md (обновлён)
- docs/modularity.md (обновлён)
- src/data/elements.ts (добавлены поля chemicalCharacter, oxidationState, rarity, atomicNumber, atomicMass)
- src/data/chemistry-generator.ts (новый — 940+ строк)
