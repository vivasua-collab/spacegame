# Чекпоинт: Интеграция BakedGalaxyModel + доработка UI

**Дата:** 2026-05-04 17:12 UTC (обновлено 14:40)
**Фаза:** 2
**Статус:** complete

👉 Предыдущие чекпоинты: [05_04_chemistry_bake.md](05_04_chemistry_bake.md), [05_04_resource_system.md](05_04_resource_system.md), [05_04_save_ui_economy.md](05_04_save_ui_economy.md)

## Контекст

Все основные баги исправлены (G-01, G-02, PRNG, hex-баг, баланс руд, Energy). Документация химии создана. Генератор `chemistry-generator.ts` реализован (1668 строк). Теперь `bakeGalaxyModel()` **вызывается** при генерации галактики и данные используются через `baked-lookups.ts`.

## Выполненные задачи

### P0: Интеграция BakedGalaxyModel (критическая) — ВСЕ ВЫПОЛНЕНЫ
- ✅ **BAKE-01**: Подключить `bakeGalaxyModel(seed, ELEMENTS)` к `GalaxyGenerator.generate()` — вызывается после генерации систем, результат сохраняется как `galaxy.bakedModel`, также вызывается `setCurrentLookups()`
- ✅ **BAKE-02**: Мигрировать `generate-resources.ts` на BakedGalaxyModel — заменены ORE_MAP / ATMOSPHERIC_COMPOUND_MAP на `findContainedElements()` и `getCurrentLookups()`
- ✅ **BAKE-03**: Сериализация BakedGalaxyModel в game-store + SQLite — bakedModel исключается из JSON (как systemMap), восстанавливается при загрузке. Обратная совместимость: старые сохранения без bakedModel → re-bake из seed
- ✅ **BAKE-04**: Устранить дублирование — все 4 потребителя processing-chains.ts мигрированы:
  - `engine.ts` → `findContainedElements(getCurrentLookups(), oreId)`
  - `generate-resources.ts` → `findContainedElements()`, `getCurrentLookups().elementToOre`
  - `planet-view.tsx` → `findResourceDisplay(getCurrentLookups(), id)`
  - `chemistry-generator.ts` → импортирует только типы из processing-chains

### P1: UI конвейера переработки
- ✅ **UI-01**: В HexInfoCard добавлена цепочка: `Железная руда → Переработчик → Железо×7.0 + Кислород×3.0`
- ✅ **UI-02**: DRY: CATEGORY_LABELS вынесен в `src/data/element-helpers.ts`, используется в resource-panel.tsx и planet-view.tsx

### P2: Финализация
- ⏳ **FINAL-01**: Пуш на GitHub

## Архитектурные решения

1. **BakedLookups как синглтон** — `setCurrentLookups()` / `getCurrentLookups()` в `baked-lookups.ts`. Устанавливается при newGame/loadGame. Аналогично BUILDING_MAP и ELEMENT_MAP.
2. **Сериализация** — bakedModel исключается из JSON (как systemMap) для экономии места. При загрузке восстанавливается из seed.
3. **Обратная совместимость** — старые сохранения без bakedModel автоматически re-bake из seed.
4. **Helper-функции** — `findContainedElements()`, `findResourceDisplay()`, `getOreIdForElement()` упрощают доступ к данным.

## Изменённые файлы
- src/core/types.ts (добавлено bakedModel в Galaxy)
- src/data/baked-lookups.ts (НОВЫЙ — lookup-помощники + синглтон)
- src/data/element-helpers.ts (НОВЫЙ — CATEGORY_LABELS, CATEGORY_COLORS)
- src/galaxy/generator.ts (вызов bakeGalaxyModel + setCurrentLookups)
- src/stores/game-store.ts (сериализация + десериализация bakedModel)
- src/economy/engine.ts (миграция на baked-lookups)
- src/galaxy/generate-resources.ts (миграция на baked-lookups)
- src/components/game/planet-view.tsx (миграция + цепочка переработки + DRY)
- src/components/game/resource-panel.tsx (DRY CATEGORY_LABELS)
