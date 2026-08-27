# Чекпоинт: Блок 1 — Стабилизация (ход выполнения)

**Дата:** 2026-08-27
**Фаза:** Etap 2.5 — Стабилизация
**Статус:** `in_progress` (фаза 1 «Data fixes» — выполнено P6, P7; начат P5)

> 👉 План: [08_27_block_01_stabilization.md](./08_27_block_01_stabilization.md) (полный план P1–P7, T1–T6, C1–C5)
> 👉 Предыдущая фаза: [08_27_doc_fixes.md](./08_27_doc_fixes.md) — `complete` ✅

---

## Контекст

После исправления 5 противоречий в документации начато переписывание кода по плану Блока 1 (стабилизация). Фаза 1 «Data fixes» (легкие, независимые задачи) — P1, P5, P6, P7, C2, C3.

---

## Выполнено

### P7 — Трансурановые элементы ✅
**Файл:** `src/data/elements.ts`

Добавлены 3 трансурановых элемента (Np, Pu, Am) с `category: 'transuranic'` и `chemicalCharacter: 'transuranic'` (тип уже был определён в `types.ts`):
- Np (Нептуний, #93, 237.0, ρ=20.45, ox=4, ultra_rare, baseValue=25)
- Pu (Плутоний, #94, 244.0, ρ=19.84, ox=4, ultra_rare, baseValue=40)
- Am (Америций, #95, 243.0, ρ=13.69, ox=3, ultra_rare, baseValue=35)

**Результат:** тип `transuranic` больше не мёртвый (3 элемента). Всего элементов: **60** (было 57).

**Замечание:** трансурановые не встречаются как самородные руды — добываются синтезом в реакторах/ускорителях (см. `32-mendeleev.md` §2.11). Стандартные рудные цепочки их не покрывают.

### P6 — Стоимость апгрейда Colony Hub ✅
**Файл:** `src/data/buildings.ts`

`colony_hub.costPerLevel` изменён с `{}` (бесплатно) на `{ Fe: 10, Si: 5, Al: 3 }`.
- L1 остаётся бесплатным при колонизации (логика engine.ts, не затронута).
- L2/L3 требуют ресурсы: Fe×10×level, Si×5×level, Al×3×level.
- Устраняет эксплойт «бесконечный бесплатный апгрейд хаба».

---

## В процессе / pending

### P5 — Крафтовые материалы (категория 'crafted') 🟡
- [ ] Добавить `'crafted'` в `ElementCategory` (`types.ts:160`)
- [ ] Добавить `crafted: 'Синтезированные'` в `CATEGORY_LABELS` + цвет в `CATEGORY_COLORS` (`element-helpers.ts`)
- [ ] Создать `src/data/crafted-materials.ts` (CRAFTED_MATERIALS map: steel, microchip, superconductor, ...)
- [ ] Обновить `resource-panel.tsx` — lookup в CRAFTED_MATERIALS если не найден в ELEMENT_MAP

**Зависимость:** проверка exhaustiveness switch на ElementCategory — может потребовать правок в других файлах.

### P1 — Унификация ID руд 🔴 (pending — критический)
- [ ] `baked-lookups.ts`: добавить `getRecipeOreId(elementId)`
- [ ] `recipes.ts`: заменить хардкод `Fe-ore`/`Ti-ore` на динамический lookup
- [ ] `scripts/validate-recipes.ts` (новый): валидация всех рецептов

### Фаза 2 «Architecture» — P2, C1, C4, C5 (pending)
### Фаза 3 «UI» — P3, P4 (pending)
### Фаза 4 «Tests» — T1–T6 (pending)

---

## Проверки (после bun install)

- [x] `bun run lint` — **0 ошибок** ✅ (P6+P7 не сломали lint)
- [x] `tsc --noEmit` — 2 ошибки, но **pre-existing** в `src/galaxy/generate-systems.ts` (стр. 234, 244 — `Planet`/`never` тип), НЕ от правок P6/P7. Зафиксированы как техдолг.
- [x] Количество элементов: 60 ✅ (57 + Np, Pu, Am)
- [x] `transuranic` категория: 3 элемента ✅
- [x] `colony_hub.costPerLevel`: `{ Fe: 10, Si: 5, Al: 3 }` ✅

### Pre-existing tech debt (не от P6/P7, зафиксировано для Блока 1 фазы architecture)
- `src/galaxy/generate-systems.ts:234` — `Argument of type 'Planet' is not assignable to parameter of type 'never'`
- `src/galaxy/generate-systems.ts:244` — `Property 'type' does not exist on type 'never'`

(Вероятно, тип array выведен как `never[]` из-за пустого инициализатора — нужно типизировать `Planet[]`.)

---

## Следующие шаги

1. Дождаться `bun install` → запустить lint + typecheck.
2. Если P6+P7 не ломают lint — продолжить P5 (crafted).
3. Перейти к P1 (критический: ID руд) — фаза architecture.
4. Зафиксировать промежуточный чекпоинт после каждой фазы.

## Изменённые файлы (на этом шаге)
- `src/data/elements.ts` (P7 — +3 элемента)
- `src/data/buildings.ts` (P6 — colony_hub.costPerLevel)
- `checkpoints/08_27_block_01_progress.md` (этот файл)
