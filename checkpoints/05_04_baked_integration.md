# Чекпоинт: Интеграция BakedGalaxyModel + доработка UI

**Дата:** 2026-05-04 17:12 UTC
**Фаза:** 2
**Статус:** in_progress

👉 Предыдущие чекпоинты: [05_04_chemistry_bake.md](05_04_chemistry_bake.md), [05_04_resource_system.md](05_04_resource_system.md), [05_04_save_ui_economy.md](05_04_save_ui_economy.md)

## Контекст

Все основные баги исправлены (G-01, G-02, PRNG, hex-баг, баланс руд, Energy). Документация химии создана. Генератор `chemistry-generator.ts` реализован (940+ строк). Но `bakeGalaxyModel()` **нигде не вызывается** — генератор галактики по-прежнему использует хардкод из `processing-chains.ts`.

## Первоочередные задачи

### P0: Интеграция BakedGalaxyModel (критическая)
- ⏳ **BAKE-01**: Подключить `bakeGalaxyModel(seed, ELEMENTS)` к `GalaxyGenerator.generate()` — вызов после генерации звёзд/планет, результат сохраняется как `galaxy.bakedModel`
- ⏳ **BAKE-02**: Мигрировать `generate-resources.ts` на BakedGalaxyModel — заменить ORE_MAP / ATMOSPHERIC_COMPOUND_MAP / ICE_COMPOUND_MAP на данные из baked model
- ⏳ **BAKE-03**: Сохранять BakedGalaxyModel в game-store (Zustand) + в сериализацию (SQLite)
- ⏳ **BAKE-04**: Мигрировать `processing-chains.ts` → `chemistry-generator.ts` как единый источник данных — устранить дублирование

### P1: UI конвейера переработки
- ⏳ **UI-01**: Отобразить цепочку переработки в UI: руда → здание → чистый элемент (сколько выходит)
- ⏳ **UI-02**: DRY: CATEGORY_LABELS определён дважды (resource-panel.tsx + planet-view.tsx) → вынести в общую константу

### P2: Финализация
- ⏳ **FINAL-01**: Пуш на GitHub

## Зависимости

```
BAKE-01 → BAKE-02 → BAKE-03 → BAKE-04
                                  ↓
                              UI-01 (может использовать BakedGalaxyModel)
UI-02 — независимая задача
FINAL-01 — после всех
```

## Проблемы
- processing-chains.ts и chemistry-generator.ts дублируют данные о рудах — BAKE-04 решает это
- BakedGalaxyModel может быть большим объектом — нужно оценить размер сериализации

## Следующие шаги
1. BAKE-01: Интегрировать bakeGalaxyModel() в GalaxyGenerator
2. BAKE-02: Переписать generate-resources.ts на baked model
3. BAKE-03: Сериализация BakedGalaxyModel
4. BAKE-04: Устранить дублирование processing-chains.ts
5. UI-01: Цепочка переработки в UI
6. UI-02: DRY категорий
7. FINAL-01: Пуш

## Изменённые файлы
- (пока нет — задачи не начаты)
