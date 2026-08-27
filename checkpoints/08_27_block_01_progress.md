# Чекпоинт: Блок 1 — Стабилизация (ход выполнения)

**Дата:** 2026-08-27
**Фаза:** Etap 2.5 — Стабилизация
**Статус:** `in_progress` (фаза 1 «Data fixes» — P5/P6/P7 + C6/C8 + P8 + P9 + pre-existing TS fix выполнены; P1 начат)

> 👉 План: [08_27_block_01_stabilization.md](./08_27_block_01_stabilization.md) (полный план P1–P9, T1–T7, C1–C9)
> 👉 Предыдущая фаза: [08_27_doc_fixes.md](./08_27_doc_fixes.md) — `complete` ✅
> 👉 Связанный Блок: [08_27_block_06_modular_integration.md](./08_27_block_06_modular_integration.md) — `complete` ✅ (commit 51742ed)

---

## Контекст

После исправления 5 противоречий в документации и Блока 06 (modular integration) продолжается переписывание кода по плану Блока 1 (стабилизация). Фаза 1 «Data fixes» (P5, P6, P7, C2, C3, C6, C8) и P8 (complex gas recipes) + P9 (ProductionItem IDs) — выполнены. Фаза 2 «Architecture» (P2, C1, C4, C5) — pending.

---

## Выполнено

### P7 — Трансурановые элементы ✅ (commit 6312bfe)
**Файл:** `src/data/elements.ts`
Добавлены Np, Pu, Am. Всего элементов: 60 (57 + 3 трансурановых).

### P6 — Стоимость апгрейда Colony Hub ✅ (commit 6312bfe)
**Файл:** `src/data/buildings.ts`
`colony_hub.costPerLevel`: `{ Fe: 10, Si: 5, Al: 3 }` (с масштабированием по уровню).

### C6 — warehouse.ts dead comparisons cleanup ✅ (commit 9b14fca, gap-5)
**Файл:** `src/data/warehouse.ts:277`
Удалены мёртвые проверки `category === 'platinoid' || category === 'rare_earth'` (значения ChemicalCharacter, не ElementCategory — всегда false). Элементы с chemicalCharacter 'platinoid' (Ru/Rh/Pd/Ir/Os) имеют category 'noble'; 'rare_earth' (Y/La/Ce/Nd/Dy) — 'lanthanide'; оба случая уже покрыты существующими проверками.

### C8 — nuclear_reactor rename ✅ (commit 9b14fca, gap-11)
**Файлы:** `src/data/buildings.ts:122`, `src/economy/engine.ts:295,319,341`
ID `nuclear_plant` → `nuclear_reactor` (соответствие `docs/40-buildings.md §10.1` — источник истины). 4 места изменены.

### P5 — Крафтовые материалы (категория 'crafted') ✅ (commit 9b14fca, gap-10)
**Файлы:**
- `src/core/types.ts:160` — добавлено `'crafted'` в `ElementCategory`
- `src/data/element-helpers.ts` — `crafted: 'Синтезированные'` (label) + `text-fuchsia-400` (color)
- `src/data/crafted-materials.ts` (NEW) — каталог 12 крафтовых материалов (steel, microchip, superconductor, titanium_alloy, silicon_crystal, sensor_array, shield_generator, engine_section, ion_engine, laser, cargo_bay, scanner) с русскими названиями + символами
- `src/components/game/resource-panel.tsx` — lookup в `CRAFTED_MATERIALS` для ресурсов, не найденных в `ELEMENT_MAP`; теперь steel/microchip показываются в группе «Синтезированные» с русскими названиями, а не в «Прочих» с `id.replace(/-/g, ' ')`.

### P8 — Complex gas recipes ✅ (commit 9b14fca, gap-2)
**Файл:** `src/data/recipes.ts` — добавлены 5 рецептов для атмосферных соединений:
- `process_CO2`: CO₂ → C(2.7) + O(7.3)
- `process_CH4`: CH₄ → C(2.5) + H(7.5)
- `process_NH3`: NH₃ → N(5.6) + H(4.4)
- `process_H2S`: H₂S → H(2.5) + S(7.5)
- `process_SO2`: SO₂ → S(5.0) + O(5.0)

Все рецепты: `buildingId: 'processor'`, `time: 150`, `energyCost: 4`. Закрывает геймплейный блокер audit §2.3 — газовые экстракторы на co2/methane/toxic планетах больше не копят «мусорные» газы в складе.

### P9 — ProductionItem deterministic IDs ✅ (commit 9b14fca, gap-6)
**Файлы:** `src/economy/engine.ts`, `src/stores/game-store.ts`
- Заменён `id: \`prod_\${Date.now()}_\${Math.random().toString(36).slice(2,6)}\`` (недетерминированный) на `id: \`prod_\${planet.id}_\${productionItemCounter++}\`` (детерминированный монотонный счётчик).
- Добавлена `export function resetProductionItemCounter()` — для сброса в `newGame()` и `loadGame()` (синхронизация с новым seed).
- `game-store.ts` вызывает `resetProductionItemCounter()` в `newGame` и `loadGame`.

### Блок 06 — Modular-bus integration ✅ (commit 51742ed, gap-1, audit §2.1 #1)
Архитектурный долг #1 закрыт:
- `src/stores/game-store.ts` — делегирует `mediator.tick()/setSpeed/togglePause`; build/upgrade/enqueue/colonize эмитят `economy:*` события; подписка на `core:state-changed`.
- `src/economy/economy-module.ts` — `onTick` вызывает `processEconomyTick`; подписки на `economy:build/upgrade/enqueue/colonize`; эмитит `core:state-changed` после мутаций.
- `src/core/game-loop.ts` — `start()`/`stop()` с `setInterval`; cap 50 ticks per interval.
- `src/app/page.tsx` — удалён `setInterval`; useEffect вызывает `mediator.start()/stop()`.
- `src/economy/engine.ts` — 6 `gameBus.emit` мигрированы на typed `bus.emit` (`production:complete` → `economy:production-complete`, и т.д.); удалены `as any` касты.
- Тесты: `tests/modular-integration.test.ts` (9 тестов) + `tests/game-loop.test.ts` (9 тестов) — 18/18 зелёные.

### Pre-existing TS errors fix ✅ (commit 9b14fca)
**Файл:** `src/galaxy/generate-systems.ts:7,230`
- Добавлен `Planet` в imports (строка 7)
- `const planets: Planet[] = []` (был `never[]` из-за пустого инициализатора → TS2345, TS2339 в строках 234, 244)
- Блок 07 (TS strict) теперь разблокирован.

---

## В процессе / pending

### P1 — Унификация ID руд 🔴 (pending — критический)
- [ ] `baked-lookups.ts`: добавить `getRecipeOreId(elementId)`
- [ ] `recipes.ts`: заменить хардкод `Fe-ore`/`Ti-ore` на динамический lookup
- [ ] `scripts/validate-recipes.ts` (новый): валидация всех рецептов

### Фаза 2 «Architecture» — P2, C1, C4, C5 (pending)
- [ ] **P2** — Immutable store (zustand-immer): 13+ shallow clones → immer draft
- [ ] **C1** — Delete `src/core/event-bus.ts` (Блок 06 мигрировал вызовы, файл можно удалить)
- [ ] **C4** — Объединить 3 цикла `recalcEnergyBalance` в один
- [ ] **C5** — Разбить `chemistry-generator.ts` (1704 строки) на 6 модулей

### Фаза 3 «UI» — P3, P4, C9 (pending)
- [ ] **P3** — UI для атмосферы/орбиты (`building-dialog.tsx`: вкладки Surface/Atmosphere/Orbit)
- [ ] **P4** — UI очереди производства (`production-queue-panel.tsx` новый)
- [ ] **C9** — a11y improvements (aria-label, role="tab", SVG role, replace confirm() with AlertDialog)

### Фаза 4 «Tests» — T1–T7 (pending)
- [ ] **T1** — PRNG детерминизм
- [ ] **T2** — Snapshot генерации галактики
- [ ] **T3** — Экономика: добыча → крафт → энергия
- [ ] **T4** — Chemistry-generator: молярные массы
- [ ] **T5** — Сериализация: save → load → equals
- [ ] **T6** — Immutability test (после P2)
- [ ] **T7** — PRNG reference conformance (после Блока 07)

### Фаза 5 «Cleanup» — C2, C3, C7 (pending)
- [ ] **C2** — Delete `@deprecated extractOreToElements` from `engine.ts:182-212`
- [ ] **C3** — Extract `ATMOSPHERE_GAS_MAP`, `DIRECT_GAS_MAP` to `src/data/atmosphere-gases.ts`
- [ ] **C7** — `processProductionQueue` emit `economy:production-cancelled` on cancel (Блок 06 готов — typed bus работает)

---

## Проверки

- [x] `bun run lint` — **0 ошибок** ✅
- [x] `bunx tsc --noEmit` — **0 ошибок** ✅ (pre-existing TS errors в generate-systems.ts исправлены)
- [x] Количество элементов: 60 ✅ (57 + Np, Pu, Am)
- [x] `transuranic` категория: 3 элемента ✅
- [x] `colony_hub.costPerLevel`: `{ Fe: 10, Si: 5, Al: 3 }` ✅
- [x] `crafted` категория добавлена в `ElementCategory` + 12 материалов в `CRAFTED_MATERIALS` ✅
- [x] 5 рецептов сложных газов добавлены в `recipes.ts` ✅
- [x] ProductionItem IDs детерминированы (счётчик вместо Date.now/Math.random) ✅
- [x] warehouse.ts: нет мёртвых сравнений `platinoid`/`rare_earth` ✅
- [x] `nuclear_plant` → `nuclear_reactor` rename завершён ✅
- [x] Modular-bus integration: mediator.tick() вызывается; EconomyModule подписки работают ✅

---

## Следующие шаги

1. ✅ Фаза 1 «Data fixes» — завершена (P5/P6/P7/P8/P9 + C6/C8 + pre-existing TS)
2. ✅ Блок 06 (modular integration) — завершён
3. 🔧 Фаза 2 «Architecture» — P2 (immutable store) + C1 (delete deprecated bus) + C4 + C5
4. 🔧 Фаза 3 «UI» — P3 + P4 + C9
5. 🔧 Фаза 4 «Tests» — T1-T7
6. 🔧 Фаза 5 «Cleanup» — C2 + C3 + C7
7. 🔧 Блок 07 (engineering quality) — TS strict + ESLint + PRNG port fix
8. 🔧 Блок 08 (security/data) — API validation + Prisma schema
9. 🔧 Блок 05 (переработчики) — после P1+C3

## Изменённые файлы (зафиксированные в коммитах)

- `6312bfe` — P6, P7 (elements.ts, buildings.ts)
- `51742ed` — Блок 06: modular integration (8 файлов + 2 теста)
- `9b14fca` — C6 + C8 + P5 + P8 + P9 + pre-existing TS fix (10 файлов)

## Обновлено
- `checkpoints/08_27_block_01_progress.md` (этот файл)
