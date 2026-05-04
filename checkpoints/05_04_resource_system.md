# Чекпоинт: Система ресурсов — категории, конвейер, правая панель

**Дата:** 2026-05-04 17:12 UTC (обновлено)
**Фаза:** 2
**Статус:** complete ✅

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
- ✅ Дублирование «Хранимые ресурсы» устранено — ResourcePanel используется 1 раз (в WarehousePanel)
- ✅ Категории переведены на русский во всех компонентах (12 категорий в CATEGORY_LABELS)

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

### Исправленные баги (подтверждено 2026-05-04)
- ✅ Баланс атмосферных/ледяных руд — все суммы yield = 10
- ✅ Баг гексов — руды вместо чистых элементов (deposit.elementId = oreId)
- ✅ Energy исключена из warehouse capacity

## Текущие задачи

### Конвейер переработки — UI
- ✅ Отобразить цепочку руда → элемент в UI (какому зданию перерабатывать, сколько выходит) — реализовано в HexInfoCard

### Качество кода
- ✅ DRY: CATEGORY_LABELS вынесен в `src/data/element-helpers.ts`

## Проблемы
- ~~processing-chains.ts дублирует данные с chemistry-generator.ts~~ → РЕШЕНО: все потребители мигрированы на baked-lookups

## Следующие шаги
1. ✅ Создать UI отображения цепочки переработки
2. ✅ Мигрировать на BakedGalaxyModel как единый источник данных
3. ⏳ Запушить на GitHub

## Изменённые файлы
- src/data/elements.ts (категории, новые поля)
- src/data/processing-chains.ts (полная система руд и цепочек)
- src/data/chemistry-generator.ts (автогенератор)
- src/data/types.ts (типы ElementCategory, ChemicalCharacter, ElementRarity)
- src/data/warehouse.ts (Energy исключена из capacity)
- src/components/game/resource-panel.tsx (категории RU)
- src/components/game/planet-view.tsx (категории RU)
- docs/chemistry.md (новый)
- docs/ores.md (обновлён)
- docs/modularity.md (обновлён)
- docs/mendeleev.md (обновлён)
