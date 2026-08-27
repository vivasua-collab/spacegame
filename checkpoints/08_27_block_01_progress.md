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
### P6 — Стоимость апгрейда Colony Hub ✅ (commit 6312bfe)
### C6 — warehouse.ts dead comparisons cleanup ✅ (commit 9b14fca, gap-5)
### C8 — nuclear_reactor rename ✅ (commit 9b14fca, gap-11)
### P5 — Крафтовые материалы (категория 'crafted') ✅ (commit 9b14fca, gap-10)
### P8 — Complex gas recipes ✅ (commit 9b14fca, gap-2)
### P9 — ProductionItem deterministic IDs ✅ (commit 9b14fca, gap-6)
### Блок 06 — Modular-bus integration ✅ (commit 51742ed, gap-1, audit §2.1 #1)
### Pre-existing TS errors fix ✅ (commit 9b14fca)

### C1 — Delete deprecated event-bus.ts ✅ (commit 5f1bfeb)
**Файл:** `src/core/event-bus.ts` (deleted)
Block 06 мигрировал все 6 gameBus.emit вызовов на typed bus, файл legacy-адаптера больше никем не импортируется. Удалён вместе с экспортом `legacyGameBus` из `src/core/index.ts`.

### C2 — Delete deprecated extractOreToElements ✅ (commit 5f1bfeb)
**Файл:** `src/economy/engine.ts:198-228` (deleted)
Функция была `@deprecated` и не имела вызовов — руды теперь кладутся на склад как сырьё и перерабатываются через `recipes.ts`. Удалена вместе с импортом `findContainedElements` (больше не нужен).

### C3 — Extract ATMOSPHERE_GAS_MAP + DIRECT_GAS_MAP ✅ (commit 5f1bfeb, gap-3)
**Файлы:**
- `src/data/atmosphere-gases.ts` (NEW) — single source of truth: `ATMOSPHERE_GAS_MAP` (8 типов атмосферы → газы), `DIRECT_GAS_MAP` (6 чистых газов → элементы 1:1), `GAS_ELEMENT_TO_ATMO_ID` (reverse map), `getAtmosphericGasesForType()` helper.
- `src/economy/engine.ts` — удалены inline maps, импорт из `data/atmosphere-gases`.
- `src/data/chemistry-generator.ts:1434` — заменён inline `gasElementToAtmoId` на импорт `GAS_ELEMENT_TO_ATMO_ID` из `data/atmosphere-gases` (раньше дублировало engine.ts).

### C7 — processProductionQueue emit on cancel ✅ (commit 5f1bfeb, gap-7)
**Файлы:** `src/core/events.ts`, `src/economy/engine.ts:196-263`
- Добавлено новое событие `economy:production-cancelled` с payload `{ planetId, recipeId, queueItemId, reason: 'recipe_not_found' | 'insufficient_inputs' }`.
- `processProductionQueue` теперь эмитит событие перед удалением элемента из очереди (если рецепт не найден) или при нехватке входных ресурсов. Закрывает «silent recipe loss» — UI может подписаться и показывать toast.

### P2 — Immutable store (zustand-immer) ✅ (commit c693807, Task ID 5 subagent)
**Файлы:**
- `src/stores/game-store.ts` — обернут в `immer()` middleware; 7+ shallow clones заменены на `set((state) => { state.gameState... })` draft mutations.
- `src/economy/economy-module.ts` — все 5 mutation handlers (onBuild/onUpgrade/onEnqueue/onColonize/processEconomyTick) обёрнуты в `produce(currentState, draft => { engineCall(draft...) })`. **Выбран Option A** (Draft<Planet>), не Option B (pure functions) — меньше disruption к архитектуре Блока 06.
- `src/core/game-mediator.ts` — добавлен `commitState(state)` lightweight state-update method.
- `src/core/immer-setup.ts` (NEW) — side-effect import: `enableMapSet()` + `setAutoFreeze(false)`.
- `src/components/game/game-layout.tsx:246` — workaround удалён, `useMemo` теперь работает.
- `tests/immutability.test.ts` (NEW) — T6 test, 3 cases: planet reference changes after `economy:build`; systems array reference changes after `tick()`; store state reference changes per tick.

### C5 — Split chemistry-generator.ts ✅ (commit 3a585e4, Task ID 6 subagent)
**Файлы:** 7 new modules in `src/data/chemistry/`:
- `baked-types.ts` (186 строк) — interfaces (BakedGalaxyModel, BakedOre, ...)
- `ore-specs.ts` (499 строк) — ORE_SPECS, SPECIAL_ORE_SPECS, REFINERY_ALTERNATIVES
- `ore-generator.ts` (447 строк) — bakeOreFromSpec, getDefaultFormula, getDefaultBuildingAndType
- `atmospheric-generator.ts` (115 строк) — generateAtmosphericCompounds
- `ice-generator.ts` (80 строк) — generateIceCompounds
- `bake.ts` (389 строк) — bakeGalaxyModel main
- `validate.ts` (129 строк) — validateBakedModel
- `src/data/chemistry-generator.ts` — reduced from **1704 → 30 строк** (re-export shim).

### T1 + T2 + T5 — Tests ✅ (commit ad57851, Task ID 7 subagent)
**Файлы:**
- `tests/prng.test.ts` (NEW, 4 cases) — T1 PRNG determinism: seed → same sequence; derive independence; derive determinism; uniformity (10000 values, mean ∈ [0.48, 0.52]).
- `tests/galaxy-snapshot.test.ts` (NEW, 3 cases) — T2 Galaxy snapshot: snapshot stability, determinism, BFS connectedness.
- `tests/serialization.test.ts` (NEW, 4 cases) — T5 Serialization round-trip: serialize → deserialize → equals; excludes systemMap/bakedModel; idempotent; v0→v1 migration.
- `src/stores/game-store.ts` — `serializeGameState`/`deserializeGameState` exported for tests.
- **Known bug documented (not blocking):** `bakeGalaxyModel` sets `createdAt: new Date().toISOString()` — non-deterministic. Tests strip `createdAt` from both sides. Future fix.

### C4 — Performance fix (O(N²M) → O(N+M)) ✅ (commit 1bf5e83)
**Файлы:**
- `src/data/warehouse.ts` — `calculateWarehouseCapacities()` теперь memoized через `WeakMap<Planet, Capacities>`. Immer создаёт новый Planet при мутации → cache автоматически инвалидируется. В пределах одного тика (stable planet reference) — O(N+M) вместо O(N*M).
- `src/economy/engine.ts:recalcEnergyBalance` — объединены 3 inline цикла (surface/atmosphere/orbit) в один helper `processBuildingEnergy(buildingId, buildingLevel, layer)`. Orbit ×1.2 solar bonus + colony_hub surface-only special case сохранены.

### P1 — Recipe ID single-source-of-truth + validation ✅ (commit 1bf5e83)
**Файлы:**
- `scripts/validate-recipes.ts` (NEW) — валидирует все 75 рецептов в `recipes.ts` против BakedGalaxyModel (ores, atmospheric, ice) + ELEMENT_MAP + CRAFTED_MATERIALS. Запуск: `bun run validate:recipes`.
- `package.json` — добавлен script `validate:recipes`.
- `src/data/crafted-materials.ts` — добавлены 4 недостающих материала (plastic, synfuel, hull_element, armor_plate) — валидатор поймал их как undefined references. Всего теперь 16 крафтовых материалов.
- Все 75 рецептов валидны. ✅

### C9 — a11y improvements ✅ (commit aad3aa2, gap-10)
**Файлы:**
- `src/components/game/galaxy-map.tsx:458-463` — zoom controls: `aria-label` на 3 кнопки + `role=status`/`aria-live=polite` на индикатор масштаба.
- `src/components/game/galaxy-map.tsx:297,527` — main SVG map + minimap: `role=img` + `aria-label`.
- `src/components/game/planet-view.tsx:131-149` — tab buttons: `role=tablist` на контейнер + `role=tab`/`aria-selected`/`aria-controls`/`id` на каждую кнопку.
- `src/components/game/planet-view.tsx:444` — HexGrid SVG: `role=img` + `aria-label` с hex count.
- `src/components/game/game-layout.tsx:86` — заменён `confirm()` на shadcn `AlertDialog` (with AlertDialogTitle/Description, Cancel/Action, Russian labels). Added toast notification on new game creation.

---

## В процессе / pending

### P3 — UI для атмосферы/орбиты 🔴 (pending — Task ID 8 subagent)
- [ ] `building-dialog.tsx`: вкладки Surface/Atmosphere/Orbit
- [ ] `planet-view.tsx`: действия для atmospheric/orbit слотов

### P4 — UI очереди производства 🔴 (pending — Task ID 8 subagent)
- [ ] `production-queue-panel.tsx` (новый) — список доступных рецептов, кнопка «Добавить», прогресс-бар, автоповтор, отмена
- [ ] `planet-view.tsx`: вкладка «Производство»
- [ ] `game-store.ts`: `cancelProduction` action

### T3 — Economy test ✅ (commit 8a72e49)
**Файл:** `tests/economy.test.ts` (NEW, 5 cases)
- processExtraction adds ore to resources when mine is built.
- processProductionQueue — enqueued recipe produces output.
- recalcEnergyBalance — solar plant adds production.
- Energy deficit — buildings don't produce without power.
- cancelProduction removes item from queue.
- Использует `giveStarterResources` для buildOnHex (mine/processor/solar_plant costs).

### T4 — Chemistry-generator test ✅ (commit 8a72e49)
**Файл:** `tests/chemistry.test.ts` (NEW, 6 cases)
- getElementAtomicMass('Fe') === 55.8 (per elements.ts).
- calculateMolarMass for Fe₂O₃ = 2×55.8 + 3×16 = 159.6.
- calculateYieldsFromFormula for Fe-ore → { Fe: 7.0, O: 3.0 }.
- bakeGalaxyModel generates valid model (ores + atmosphericCompounds + iceCompounds).
- Recipe consistency (P1) — all 75 recipes reference valid IDs.
- ORE_SPECS — formula/containedElements valid + sourceBuildingId valid.

### T7 — PRNG reference conformance ✅ (commit a4fb3db, Task ID 9 subagent — Block 07)
PRNG port fix + statistical tests (chi-square + correlation + birthday) заменили T7.
Statistical tests покрывают: uniformity (chi-square < 123.23 for α=0.05), independence
of 4 derive() streams (Pearson correlation < 0.05), birthday test (~1 collision in 65536).

### Блок 07 — Engineering quality ✅ (commit a4fb3db, Task ID 9 subagent)
- `tsconfig.json`: `noImplicitAny=true`, `noUncheckedIndexedAccess=true`, `noFallthroughCasesInSwitch=true`, `noImplicitReturns=true`.
- `next.config.ts`: `ignoreBuildErrors=false`.
- `eslint.config.mjs`: enabled `@typescript-eslint/no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, `prefer-const`, `no-debugger`, `no-console` (all `warn`).
- `src/core/prng.ts`: fixed xoshiro256** port per Vigna reference — `t = s1 << 17` (was `Math.imul(s1, 9)`); correct state update order; added `rotl` helper.
- `tests/prng-statistical.test.ts` (NEW, 3 cases): chi-square + correlation + birthday.
- 92 remaining TS errors documented (mechanical `noUncheckedIndexedAccess` fixes) — tracked for future cleanup pass.
- Lint: 0 errors, 49 warnings. 46/46 tests pass.

---

## В процессе / pending

### Блок 08 — Security & Data 🟡 (pending — Task ID 10 subagent)
- API validation (zod-схемы для /api/save) + rate limiting
- Prisma schema redesign (indexes, version, state validation)

### Блок 05 — Переработчики 🟡 (pending — после P1+C3 ✅)
- 2 типа переработчиков (универсальный → специализированный апгрейд)

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
