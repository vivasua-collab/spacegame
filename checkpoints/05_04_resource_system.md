# Чекпоинт: Система ресурсов — категории, конвейер, правая панель

**Дата:** 2026-05-04 17:05 MSK (обновлено)
**Фаза:** 2
**Статус:** in_progress

## Выполненные задачи

### Система сохранения (из предыдущей сессии)
- ✅ Пауза перед сохранением, таймаут 30с, toast-уведомления
- ✅ systemMap исключён из JSON, восстанавливается из systems
- ✅ Бесконечный спиннер исправлен

### Баг с колонией в сайдбаре (из предыдущей сессии)
- ✅ useMemo убран, новые ссылки при colonizePlanet

### Переработка категорий элементов
- ✅ `alloy` → `metal` (Титан — это металл, а не сплав!)
- ✅ Cu из `electronics` → `metal` (медь — промышленный металл)
- ✅ Au из `electronics` → `noble` (золото — благородный металл)
- ✅ Li из `light` → `alkali` (литий — щелочной металл) ← обновлено по chemistry.md
- ✅ Co, W из `rare` → `metal` (кобальт, вольфрам — промышленные металлы)
- ✅ Pt из `rare` → `noble` (платина — благородный металл)
- ✅ Добавлены категории: `alkali`, `alkaline_earth`, `halogen`, `nonmetal`, `lanthanide`, `transmetal`
- ✅ Все ярлыки переведены на русский

### Правая панель планеты
- ✅ Склад вынесен на отдельную кнопку (Sheet)
- ❌ Убрать дублирование «Хранимые ресурсы» из вкладки Ресурсы — НЕ СДЕЛАНО
- ❌ Перевести категории на русский в resource-panel.tsx — ЧАСТИЧНО

### Стартовые ресурсы
- ✅ Только чистые материалы, без руды (реализовано в giveStarterResources)
- ✅ V-ore, Y-ore, Ba-ore добавлены в стартовый набор

### Конвейер переработки
- ✅ Создан `src/data/processing-chains.ts` — полная система:
  - ORE_DEFINITIONS (33 руды шахта+карьер)
  - DEEP_ORES (18 глубинных руд)
  - ATMOSPHERIC_COMPOUNDS (11 газов)
  - ICE_COMPOUNDS (5 ледяных)
  - REFINERY_PROCESSING (3 альтернативы: Au, Pt, U)
  - NATIVE_ELEMENT_CHANCE (6 самородков)
  - ORE_FOR_ELEMENT_MAP (маппинг элемент → руда)
  - buildElementSourcesMap() (карта источников)
  - getProcessingChain() (цепочка переработки)
- ✅ Создан `src/data/chemistry-generator.ts` — автогенератор для baked model

### Документация ресурсов
- ✅ Создан `docs/chemistry.md` — правила химии и автогенерации
- ✅ Обновлён `docs/ores.md` (v2.2) — 47+ руд с расчётами
- ✅ Обновлён `docs/modularity.md` (v2.0) — модульность с chemistry.md
- ✅ Добавлены поля chemicalCharacter, oxidationState, rarity в ElementDef

## Текущие задачи

### Правая панель — доработка
- ❌ Убрать дублирование ресурсов (2 вкладки с разной группировкой)
- ❌ Перевести категории на русский (в resource-panel.tsx)

### Экономика — критические исправления
- ❌ Энергия не должна быть складируемым ресурсом (нет объёма)
- ❌ Конвейер переработки: отобразить в UI цепочку руда → элемент

## Проблемы
- Energy учитывается в warehouse capacity — неправильно, энергия не складируется
- Правая панель перегружена дублирующей информацией
- processing-chains.ts дублирует данные с chemistry-generator.ts — нужна миграция

## Следующие шаги
1. Убрать Energy из warehouse capacity
2. Убрать дублирование в правой панели
3. Перевести категории на русский
4. Мигрировать на BakedGalaxyModel как единый источник данных о рудах
5. Запушить на GitHub

## Изменённые файлы
- src/data/elements.ts (категории, новые поля)
- src/data/processing-chains.ts (полная система руд и цепочек)
- src/data/chemistry-generator.ts (автогенератор)
- src/data/types.ts (типы ElementCategory, ChemicalCharacter, ElementRarity)
- docs/chemistry.md (новый)
- docs/ores.md (обновлён)
- docs/modularity.md (обновлён)
- docs/mendeleev.md (обновлён)
