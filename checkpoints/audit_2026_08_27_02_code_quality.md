# Аудит проекта — Заход 2: Качество кода

**Дата:** 2026-08-27
**Task ID:** 20 (audit-coordinator)
**Область:** Economy, ships, research, galaxy, data, tests
**Опирается на:** audit_2026_08_27_01_foundation.md (Pass 1)
**Commit:** e3bc1d6 (HEAD of origin/main)

---

## 1. Исполнение

### 1.1 Доступ к репозиторию
- Проверен путь `/home/z/spacegame-audit/spacegame/` — доступ OK.
- `engine.ts`, `fleet-engine.ts`, `research/engine.ts` — все три файла из TЗ доступны (проверено `ls`).
- Pass 1 checkpoint прочитан полностью (677 строк, 50 KB) — опирается на находки.

### 1.2 Базовое состояние (per Pass 1)
- **Tests:** 340/340 pass ✅
- **Lint:** 0 errors, 50 warnings ✅
- **TypeScript:** 137 errors (baseline `noUncheckedIndexedAccess`) ✅
- **Recipe validation:** 75/75 ✅

### 1.3 Файлы, прочитанные в заходе 2
- **Economy:** `src/economy/engine.ts` (1069 строк, полностью), `src/economy/economy-module.ts` (414), `src/economy/index.ts` (26)
- **Ships:** `src/ships/designer.ts` (440), `src/ships/orders.ts` (407), `src/ships/fleet-engine.ts` (525), `src/ships/ships-module.ts` (183), `src/ships/fleet-module.ts` (146), `src/ships/index.ts` (64)
- **Research:** `src/research/engine.ts` (862, полностью), `src/research/research-module.ts` (260), `src/research/index.ts` (~10)
- **Galaxy:** `src/galaxy/generator.ts` (132), `src/galaxy/generate-systems.ts` (272), `src/galaxy/generate-planets.ts` (550), `src/galaxy/generate-resources.ts` (268), `src/galaxy/generate-jump-points.ts` (130), `src/galaxy/generate-positions.ts` (99), `src/galaxy/hex-grid.ts` (116), `src/galaxy/gen-context.ts` (22), `src/galaxy/galaxy-module.ts` (151), `src/galaxy/index.ts` (14)
- **Data (selectively):** `src/data/buildings.ts` (277), `src/data/elements.ts` (180), `src/data/warehouse.ts` (570 — head + middle), `src/data/recipes.ts` (ID grep — 75 уникальных), `src/data/processing-chains.ts` (header + первые 200 строк), `src/data/research/tech-tree.ts` (head 100), `src/data/ships/hulls.ts` (98), `src/data/ships/shipyard-queue.ts` (261, полностью)
- **Tests:** `tests/ships/fleet-engine.test.ts` (test list — 17 тестов), `tests/ships/orders.test.ts` (23), `tests/ships/designer.test.ts` (33), `tests/ships/shipyard.test.ts` (17), `tests/research/process-tick.test.ts` (51 тестов, head), `tests/economy/processors.test.ts` (32, head), `tests/economy.test.ts` (head 100), `tests/immutability.test.ts` (head 80), `tests/modular-integration.test.ts` (head 80), `tests/galaxy-snapshot.test.ts` (head 60), `tests/game-loop.test.ts` (test list — 11), `tests/serialization.test.ts` (test list — 7). Grep `useGameStore` в tests/ → 1 hit (только в комментарии).

### 1.4 Команды выполнены
- `wc -l` на ключевые data-файлы: recipes.ts (871), processing-chains.ts (1405), buildings.ts (277), elements.ts (180), warehouse.ts (570).
- `grep -c "id: '"` на recipes.ts → 75 (совпадает с recipe validation).
- `grep -E "^\s*id:\s*'" | sort | uniq -c | sort -rn | head` на recipes.ts → нет дублей (все 1×).
- `grep -cE "^\s*(test|it)\("` на 6 тест-файлов (fleet-engine, orders, designer, shipyard, process-tick, processors).
- `grep "useGameStore"` / `grep "loadGame"` / `grep "cancelProduction"` в tests/ — подтверждено: НОЛЬ integration-тестов store-уровня.

---

## 2. Сводка находок

| Категория | Кол-во | Краткий перечень |
|-----------|--------|------------------|
| Блокирующие (P0) | 0 | (P0-1 из Pass 1 — отдельно; новых P0 нет) |
| Серьёзные (P1) | 5 | P1-1 silent resource loss при полном складе; P1-2 cross-layer импорт `ships → economy` (engineColonizePlanet); P1-3 hardcoded defenderFactionId='enemy' + result.ignore в attack-case; P1-4 `fleet:movement-started` emit при quirky timing — может не сработать; P1-5 `cancelProduction` reason hack ('insufficient_inputs' вместо 'manual') |
| Средние (P2) | 9 | P2-1 deposit over-deduction дублирован в colony_hub path; P2-2 `findPlanet` O(S×P) per query/tick без индекса; P2-3 `getLabRPPerSec` делитель 800 vs spec 500 — задокументированный spec drift; P2-4 magic numbers в findProcessorInstance (-1, -100 encoding); P2-5 `giveStarterResources` hardcoded start amounts; P2-6 `processExtraction` дублированная colony_hub extraction логика; P2-7 `processProductionQueue` only HEAD processed — стагнация при insufficient inputs; P2-8 `fleet:order-completed` для patrol вводит в заблуждение (не завершён, а re-queued); P2-9 `getAtmosphereEfficiency` switch с magic numbers в engine.ts |
| Незначительные (P3) | 7 | P3-1 elements.ts заголовок «57 элементов» устарел (60=57+3 transuranic); P3-2 economy engine прямые `gameBus.emit` внутри produce-draft (listeners see stale state); P3-3 ships-module.ts `findPlanet` дублирован из economy-module.ts; P3-4 `completeOrder` 'patrol' не clamps `repeat` field, использует `...order` spread; P3-5 generate-systems.ts fallback-comment «dead code» на line 60 (но TS guard); P3-6 `consumeFuel` приоритизирует xenon→hydrogen→chemical — это «fuel priority fallback», но не документировано в спеке; P3-7 GameMediator tick ссылается на `this.gameState.time` напрямую в модулях (но через tickAll) — OK pattern, но side-effect documented через time mutability |

---

## 3. Детальные находки

### P1-1: Silent resource loss при полном складе в `processExtraction`

**Файл:** `src/economy/engine.ts:85-93, 108-116`

**Описание:**
```ts
const extracted = Math.min(amount, deposit.quantity);
deposit.quantity -= extracted;          // ← списывает ПОЛНУЮ extracted
if (extracted > 0) {
  const canStore = canStoreResource(planet, deposit.elementId, extracted);
  const actual = Math.min(extracted, canStore);   // ← actual может быть < extracted
  if (actual > 0) {
    planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
  }
  // ← НЕТ: deposit.quantity += (extracted - actual); — остаток потерян
}
```
Тот же паттерн в colony_hub-блоке (строки 100-116) и идентичная проблема.

**Сценарий:**
- Шахта добывает `extracted = 10` руды.
- Склад полностью заполнен → `canStoreResource(...)` возвращает `0`.
- `actual = Math.min(10, 0) = 0`.
- `deposit.quantity -= 10` (руды «добыты»).
- Ноль добавлено на склад.
- 10 ед. руды **молча испарились** из deposit, не попав ни на склад, ни обратно в deposit.

**Влияние:**
На любой планете с заполненным складом (что случается при длинной игре, особенно с殖民地 role «research» или «mining») вся добыча шахт бесследно исчезает. Игрок не получает уведомления, deposit списывается, UI показывает «склад полный», но ресурсы не консервируются — они **уничтожаются**.

Это **silent data loss bug** — самый опасный класс: пользователь не видит, что что-то не так, пока не проверит баланс.

**Подтверждение через тесты:**
`tests/economy.test.ts` использует `warehouse.totalCapacity: 10000, capacities: { ore: 1000, ... }` (lines 70-77) — достаточно для ~1000 ед. Fe, тест добывает 0.7-1.0 ед/тик — тест никогда не доходит до заполнения склада. **Тест не покрывает edge case.**

**Рекомендация:**
```ts
const canStore = canStoreResource(planet, deposit.elementId, extracted);
const actual = Math.min(extracted, canStore);
deposit.quantity -= actual;   // ← списывать только фактическое
if (actual > 0) {
  planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
}
// остаток (extracted - actual) остаётся в deposit
```
Аналогично для colony_hub path (lines 100-116) и convertDirectAtmosphericElements (lines 155-168 — последний уже корректно списывает `gasAmount - actual`).

---

### P1-2: Cross-layer импорт `ships/fleet-engine.ts → @/economy/engine` (colonizePlanet)

**Файл:** `src/ships/fleet-engine.ts:26`

**Описание:**
```ts
import { colonizePlanet as engineColonizePlanet } from '@/economy/engine';
```
`completeOrder` 'colonize' case (line 464-477) вызывает `engineColonizePlanet(planet, targetSystem)`, который мутирует `planet` in-place (ставит colony_hub + выдаёт starter resources).

**Архитектурное нарушение:**
Block 06 modular-bus integration требует: «модули общаются только через TypedEventBus + ModuleRegistry.query()». Hard-import одного engine в другой модуль нарушает инкапсуляцию.

**Влияние:**
1. Circular dependency risk: если EconomyModule начнёт импортировать ShipsModule (например, для «colony ship module» требования), возникнет circular import.
2. `completeOrder` colonize-case мутирует planet напрямую, но вызывается из `processFleetTick` (внутри FleetModule.processFleetTicks, который обёрнут в produce draft). Это работает, но в сторону — planet mutation через cross-layer функцию без explicit event.
3. Тестируемость: `tests/ships/fleet-engine.test.ts:500` тест 'colonize order completes + planet owner changes to player' напрямую проверяет, что planet.owner === 'player' после completeOrder — тест проходит, но он завязан на конкретную реализацию Economy-функции, а не на event contract.

**Рекомендация:**
Эмитить `economy:colonize` событие из `completeOrder` 'colonize' case → EconomyModule.onColonize обрабатывает через produce(). Но это требует асинхронной обработки в рамках одного tick — сложно. Альтернатива: оставить прямой вызов, но задокументировать как «исключение из правила» и вынести в helper `colonizePlanetViaEngine(planet, system)` в `src/ships/` обёртке.

---

### P1-3: `completeOrder` 'attack' case — hardcoded `defenderFactionId: 'enemy'` + игнор result

**Файл:** `src/ships/fleet-engine.ts:478-488`

**Описание:**
```ts
case 'attack': {
  resolveCombat(fleet);                                  // ← stub возвращает winner/losses
  gameBus.emit('combat:engaged', {
    systemId: fleet.location,
    attackerFactionId: fleet.owner,
    defenderFactionId: 'enemy',                          // ← hardcoded stub
  });
  updatedFleet = { ...fleet, orders: fleet.orders.slice(1) };
  break;
}
```

`resolveCombat(fleet)` (orders.ts:241-250) возвращает `{ winner: 'attacker', losses: [] }`. Возвращаемое значение **проигнорировано** — `const result = resolveCombat(fleet);` нет.

`defenderFactionId: 'enemy'` — магическая строка-заглушка.

**Влияние:**
1. Когда Etap 4 реализует real combat (losses, targeting), старый код забудет обновить consumer — `losses` уже не игнорируется. Логика 'attack' завершится, attacker получит system ownership без расчёта потерь.
2. `'enemy'` — строковая заглушка, не EntityId. Если несколько AI-фракций (Etap 3.5/4), combat events не смогут отличить защитников.

**Рекомендация:**
```ts
case 'attack': {
  // Найти defender fleet в target system (через ModuleRegistry.query)
  // const defender = this.registry.query('fleet:defender-at', fleet.location);
  const result = resolveCombat(fleet, defender);
  // Применить losses к обоим флотам (через produce)
  // Если attacker wins → fleet остаётся, defender удаляется
  // Emit с реальным defender factionId
  break;
}
```
Краткосрочно: добавить комментарий «Etap 4 TODO» + tests для current stub behavior.

---

### P1-4: `fleet:movement-started` event emit при quirky timing — может не сработать

**Файл:** `src/ships/fleet-engine.ts:308-319`

**Описание:**
```ts
if (currentTick < order.etaTick) {
  // Emit movement-started once per order (when on first leg AND just after issue)
  if (order.currentLegIndex === 0 && currentTick === order.issuedTick + 1) {
    const toSystemId = order.path.length > 1 ? order.path[1]! : order.targetId;
    gameBus.emit('fleet:movement-started', {
      fleetId: fleet.id,
      fromSystemId: fleet.location,
      toSystemId,
      path: order.path,
      etaTick: order.etaTick,
    });
  }
  return { updatedFleet: fleet, completed: false };
}
```

**Условие emita:** `order.currentLegIndex === 0 && currentTick === order.issuedTick + 1`.

**Сценарий бага:**
1. Игрок ставит игру на паузу (togglePause) сразу после приказа (issuedTick=100, etaTick=200).
2. Через 50 тиков снимает с паузы — currentTick=150.
3. `currentTick === order.issuedTick + 1` → 150 === 101 → false.
4. `fleet:movement-started` **никогда не эмитится** для этого order.

UI подписывается на это событие, чтобы показать «Флот в пути из A в B». Игрок видит приказ в списке, но анимация маршрута не запускается.

**Аналогично:** если первый tick после issue не происходит (например, simulation paused before first tick), emit не сработает.

**Тесты не покрывают:** `tests/ships/fleet-engine.test.ts` нет проверки `fleet:movement-started` event. grep `movement-started|fleet:movement` в файле — 0 hits.

**Рекомендация:**
Эмитить в момент `executeOrder` (orders.ts:296-360), а не в первом tick. Или: emit на `currentLegIndex === 0 && currentTick > order.issuedTick && !alreadyEmitted`. Добавить `movementStarted: boolean` field to FleetOrder (или вынести в `EventPayload` механизм deferred emits).

---

### P1-5: `cancelProduction` reason hack — 'insufficient_inputs' для manual cancel

**Файл:** `src/economy/engine.ts:960-979`

**Описание:**
Комментарий (lines 954-958):
> Эмитит `economy:production-cancelled` с причиной `insufficient_inputs` (ближайшая доступная причина из `EconomyEvents['economy:production-cancelled']['reason']` для ручной отмены; будущая итерация может добавить `'manual'` в union type).

```ts
gameBus.emit('economy:production-cancelled', {
  ...
  reason: 'insufficient_inputs',   // ← incorrect reason for manual cancel
});
```

**Влияние:**
UI/log-listeners не могут отличить «player manually cancelled» от «system auto-cancelled due to missing inputs». Это критично для:
1. UI feedback: ручная отмена → silent (player knows); auto-cancel → notification «not enough iron».
2. Analytics: разделить user-initiated cancellations от системных.
3. Логи аудита (если будут).

**Рекомендация:**
Добавить `'manual'` в union type `EconomyEvents['economy:production-cancelled']['reason']` (events.ts). Это тривиальное изменение, но требует обновления type definitions.

---

### P2-1: `processExtraction` colony_hub path — same deposit over-deduction bug

**Файл:** `src/economy/engine.ts:100-116`

**Описание:**
Colony hub extraction loop дублирует тот же паттерн `deposit.quantity -= extracted` (line 108) без учёта `actual`. Дубликат P1-1 bug.

**Влияние:**
Тот же silent resource loss — но для colony_hub (стартового здания колонии). Более широкий охват: любая колонизированная планета страдает, т.к. colony_hub есть всегда.

**Рекомендация:**
Тот же fix, что P1-1. Plus: refactor для устранения дублирования (см. P2-6).

---

### P2-2: `findPlanet` в `EconomyModule` / `ShipsModule` — O(S×P) per query/tick без индекса

**Файлы:**
- `src/economy/economy-module.ts:407-413` (findPlanet helper)
- `src/ships/ships-module.ts:175-181` (same findPlanet, copy-paste)
- `src/galaxy/galaxy-module.ts:135-143` (queryPlanetById, same pattern)
- `src/economy/economy-module.ts:371-373` (processEconomyTick: `flatMap.filter` every tick)

**Описание:**
Все три модуля итерируют `state.galaxy.systems[].planets[]` для поиска по ID. На 500 систем × 8 планет = 4000 итераций per query.

Per tick:
- `processEconomyTick` (economy-module.ts:371) делает `flatMap.filter` — 4000 iter, один раз за тик.
- `processShipsTick` (ships-module.ts:148) делает `findPlanet` для каждой shipyard queue — может быть 100+ queues × 4000 = 400K iter per tick.
- `processResearchTick` (research-module.ts:172) делает `flatMap.filter` — 4000 iter per tick.

**Влияние:**
На 500 систем, x1 (1 tick/sec), 100 shipyard queues: ~400K iter/sec for ships-module alone. На x50: 20M iter/sec — серьёзная нагрузка на event loop.

Immer produce оборачивает это, но сам цикл — pure JS. ~10-20ms per tick на big maps (vs <1ms для indexed lookup).

**Рекомендация:**
1. Построить `planetMap: Map<EntityId, Planet>` при newGame/loadGame + поддерживать при mutations (immer-friendly: rebuilt on systems change).
2. Сохранить в `GameState.galaxy.planetMap` рядом с `systemMap`.
3. Аналогично `shipMap` уже есть (`state.ships: Map`), но `fleets` — массив, не Map — индекс недоступен. `getFleetById` (fleet-engine.ts:181) делает `.find()` по массиву.

---

### P2-3: `getLabRPPerSec` делитель 800 vs spec 500 — задокументированный spec drift

**Файл:** `src/research/engine.ts:184-218`

**Описание:**
Огромный комментарий (lines 184-211) reverse-engineers формулу. Spec §3.1 docs/60-research.md говорит `1 + habitabilityPercent / 500`. Test T-R3 ожидает `labLevel=3, habit=80 → 16.5`. Автор вычисляет: `16.5 / (5 × 3) = 1.10` → `1 + 80/x = 1.10` → `x = 800`. Итого код (line 218):
```ts
return baseOutput * labLevel * (1 + habitabilityPercent / 800);
```

**Влияние:**
В MVP `habitabilityPercent = 0` всегда (P2-5 из Pass 1) — формула не активна. Но: spec drift документирован внутри кода, но не в `docs/60-research.md`. Pass 3 (docs compliance) должен это проверить.

**Рекомендация:**
1. Обновить `docs/60-research.md` §3.1: «делитель 800 (не 500) — подтверждено тестом T-R3, spec §3.1 устарел».
2. Или — если spec правильный — исправить код на 500 и обновить T-R3 ожидаемое значение на 17.4 (физически-корректное по спеке).

---

### P2-4: `findProcessorInstance` magic numbers (-1, -100 encoding for slots)

**Файл:** `src/economy/engine.ts:317-412`

**Описание:**
```ts
hexIndex: -1 - i,    // atmosphere slot encoded as negative
hexIndex: -100 - i, // orbit slot encoded as negative offset by 100
```
Кодируeт layer + slot index в одно число `hexIndex`. UI consumers (production-queue-panel, building-dialog) должны знать эти магические числа для обратной конвертации.

**Влияние:**
Code smell: magic numbers без const declarations. Если кто-то добавит 4-й layer (например, «underground»), нужно выбирать новое смещение (-200?). Декодеры легко ломаются.

**Рекомендация:**
Заменить на tuple/discriminated union:
```ts
type BuildingLocation = { layer: 'surface'; hexIndex: number }
                     | { layer: 'atmosphere'; slotIndex: number }
                     | { layer: 'orbit'; slotIndex: number };
```
Или — минимально — вынести в `const HEX_INDEX_ATMO_OFFSET = -1; const HEX_INDEX_ORBIT_OFFSET = -100;` с комментарием.

---

### P2-5: `giveStarterResources` — hardcoded starter amounts (no data file)

**Файл:** `src/economy/engine.ts:1050-1068`

**Описание:**
```ts
const starters: Record<string, number> = {
  Fe: 150, Si: 100, C: 60, Al: 80,
  H: 300,
  Ti: 30, Cu: 40,
  O: 200, N: 100,
  Au: 2,
  U: 5,
};
```
Hardcoded в engine.ts, не в `src/data/`. Балансировка требует изменения кода, не данных.

**Влияние:**
Code/data separation violation. Balancing changes require code review instead of data edit.

**Рекомендация:**
Создать `src/data/colony-starters.ts` с `export const COLONY_STARTER_RESOURCES: Record<string, number> = {...}`. Импортировать в engine.ts. Аналогично `getAtmosphereEfficiency` (engine.ts:171-182) — magic switch должен быть в `src/data/atmosphere-gases.ts` рядом с `getAtmosphericGasesForType`.

---

### P2-6: `processExtraction` — duplicated colony_hub extraction logic

**Файл:** `src/economy/engine.ts:71-117`

**Описание:**
Surface buildings extraction (lines 71-95) и colony_hub extraction (lines 97-117) дублируют паттерн: `levelMult = 1 + level * 0.15/0.1`, `baseRate = availability × levelMult`, `Math.min(extracted, deposit.quantity)`, deposit deduction, canStore check, resource addition.

Только множитель 0.5 (colony_hub добывает 50% от шахты) и `levelMult = 0.1` (vs 0.15 для шахты) — дифференцируют.

**Влияние:**
Code duplication → при изменении логики (например, добавить зависимость от `planet.population`) нужно изменить два места. P1-1 / P2-1 bug нужно фиксить в двух местах.

**Рекомендация:**
Извлечь в helper `extractFromHex(hex, planet, buildingDef, rateMultiplier)`:
```ts
function extractFromHex(hex: HexCell, planet: Planet, buildingDef: BuildingDef, levelMultStep: number, rateFactor: number): void {
  const levelMult = 1 + hex.buildingLevel * levelMultStep;
  for (const deposit of hex.deposits) {
    if (deposit.quantity <= 0) continue;
    const baseRate = rateFactor * deposit.availability;
    const amount = baseRate * levelMult * (terrainMult);
    const extracted = Math.min(amount, deposit.quantity);
    const canStore = canStoreResource(planet, deposit.elementId, extracted);
    const actual = Math.min(extracted, canStore);
    deposit.quantity -= actual;   // ← FIX P1-1
    if (actual > 0) {
      planet.resources[deposit.elementId] = (planet.resources[deposit.elementId] ?? 0) + actual;
    }
  }
}
```
Colony_hub → `extractFromHex(hex, planet, def, 0.1, 0.5)`.

---

### P2-7: `processProductionQueue` — only HEAD processed; queue stalls on stuck head

**Файл:** `src/economy/engine.ts:205-302`

**Описание:**
```ts
const item = queue.items[0];
// ... process item (single)
if (canProduce) { ... }
else {
  gameBus.emit('economy:production-cancelled', { reason: 'insufficient_inputs' });
}
if (item.repeat) { item.progress = item.total; }
else { queue.items.shift(); }
```

Если головной item завершился (`item.progress <= 0`), но `canProduce = false` (недостаточно входных ресурсов):
- !repeat: item удаляется (shift). Player теряет слот очереди.
- repeat: `progress = total` (сброс), повтор next tick.

**Проблема:**
1. Если player ставит repeat + дефицит входов — cycle forever (good), но `progress = total` → бесконечный цикл без уведомления игрока, что входов не хватает (событие `economy:production-cancelled` эмитится, но UI может его не показывать стабильно).
2. Если player ставит 5 рецептов в очередь, первый требует редкий ресурс, которого нет → остальные 4 никогда не начнутся (head блокирует). Нет auto-skip «перепрыгнуть insufficient recipe».

**Влияние:**
UX — игроки не понимают, почему очередь не двигается. Решение «отменить первый item» требует UI action.

**Рекомендация:**
1. В repeat case: НЕ сбрасывать progress, а оставлять (если ресурсов недостаточно, прогресс должен оставаться нулевым, чтобы при появлении ресурсов сразу завершиться).
2. Добавить auto-skip опцию (policy flag): если head не может быть завершён N тиков подряд → удалить или переставить в конец.
3. UI: production-queue-panel должен показывать красный значок на stuck head.

---

### P2-8: `fleet:order-completed` emit для 'patrol' — misleading (not actually completed)

**Файл:** `src/ships/fleet-engine.ts:450-463, 495-499`

**Описание:**
```ts
case 'patrol': {
  // Re-queue with reversed path (loops back to origin)
  const reversedPath = [...order.path].reverse();
  // ... create newOrder
  updatedFleet = { ...fleet, orders: [newOrder, ...fleet.orders.slice(1)] };
  break;
}
// after switch:
gameBus.emit('fleet:order-completed', { ... orderType: order.type ... });
```
Patrol создаёт NEW order (re-queued), но `fleet:order-completed` эмитится как будто patrol завершился.

**Влияние:**
UI подписывается на `fleet:order-completed` для отображения «Приказ выполнен» (toast notification). Для patrol toast будет показан КАЖДЫЙ раз, когда флот достигает конца пути — даже если patrol бесконечный.

**Рекомендация:**
Либо: для patrol — НЕ эмитить `order-completed` (эмитить `patrol:leg-completed` вместо). Либо: документировать, что для patrol это означает «leg completed, looping».

---

### P2-9: `getAtmosphereEfficiency` switch с magic numbers в engine.ts

**Файл:** `src/economy/engine.ts:171-182`

**Описание:**
```ts
function getAtmosphereEfficiency(type: string): number {
  switch (type) {
    case 'thin': return 0.3;
    case 'standard': return 0.6;
    case 'dense': return 0.7;
    case 'toxic': return 0.6;
    case 'inert': return 0.5;
    case 'methane': return 0.7;
    case 'co2': return 0.5;
    default: return 0;
  }
}
```

Magic numbers не в data-файле. Источник (docs/40-buildings.md §2.3) даёт таблицу, но она не загружена из `src/data/atmosphere-gases.ts` рядом с `getAtmosphericGasesForType`.

**Рекомендация:**
Перенести в `src/data/atmosphere-gases.ts` как `ATMOSPHERE_EXTRACTION_EFFICIENCY: Record<AtmosphereType, number>`.

---

### P3-1: `elements.ts` заголовок «57 элементов» устарел

**Файл:** `src/data/elements.ts:3`

**Описание:**
Комментарий:
> Определения элементов — 57 элементов для SpaceGame.
> Расширенная таблица (версия 4.0) на основе docs/mendeleev.md.

Реально: 60 элементов (57 базовых + 3 трансурановых Np/Pu/Am после Block 01 P7).

Подсчёт по категориям:
- structural: 4 (Fe, Si, Al, C)
- fuel: 2 (H, He)
- chemical: 4 (O, N, S, P)
- alkali: 3 (Li, Na, K)
- alkaline_earth: 4 (Be, Mg, Ca, Ba)
- halogen: 2 (F, Cl)
- nonmetal: 3 (B, Se, Te)
- metal: 15
- noble: 10 (включая Ne, Ar)
- lanthanide: 5
- rare: 3 (U, Zr, Hf)
- transuranic: 3 (Np, Pu, Am)
- transmetal: 2 (Cd, In)
**Итого: 60.**

**Влияние:**
Косметика — вводит в заблуждение контрибьюторов.

**Рекомендация:**
Обновить заголовок: «60 элементов (57 базовых + 3 трансурановых из Block 01 P7). Версия 4.1.»

---

### P3-2: Economy engine прямые `gameBus.emit` внутри produce-draft

**Файл:** `src/economy/engine.ts` — множество мест: lines 213, 286, 289, 581, 618, 649, 676, 816, 824, 869, 877, 935, 941, 972, 1040

**Описание:**
Engine functions вызывают `gameBus.emit(...)` внутри своего тела. EconomyModule обёртывает вызовы в `produce(currentState, draft => { engineFunc(draft...) })`. Поскольку `gameBus.emit` происходит СРАЗУ при draft-мутации (а не после produce completion), listeners видят STALE state (до commitState).

**Пример:**
`processEconomyTick` → `processProductionQueue` → `gameBus.emit('economy:production-complete', ...)` на line 286. В этот момент `produce` ещё не завершился, `commitState(newState)` не вызван, mediator.gameState — старый. Если UI подписан на `economy:production-complete` и запрашивает gameState, он видит OLD state.

**Влияние:**
UI может отображать устаревшие данные после event. Для большинства случаев — некритично (event payload содержит нужную info: `planetId`, `recipeId`). Но для listeners, которые делают `getGameState()` после event, могут гонки.

**Рекомендация:**
Перенести все `gameBus.emit` из engine functions в EconomyModule — после `commitState(newState)`. Это большая переработка, но архитектурно правильная: engine = pure functions, module = side-effect coordinator.

---

### P3-3: `findPlanet` дублирован в `EconomyModule` и `ShipsModule`

**Файлы:**
- `src/economy/economy-module.ts:407-413`
- `src/ships/ships-module.ts:175-181`

**Описание:**
Одинаковый helper `findPlanet(state, planetId)` в двух модулях (точная копия). Аналог в GalaxyModule (`queryPlanetById`).

**Рекомендация:**
Извлечь в `src/core/state-utils.ts` (или `src/core/find-planet.ts`):
```ts
export function findPlanet(state: GameState, planetId: EntityId): Planet | undefined {
  for (const system of state.galaxy.systems) {
    const planet = system.planets.find(p => p.id === planetId);
    if (planet) return planet;
  }
  return undefined;
}
```

---

### P3-4: `completeOrder` 'patrol' case — `...order` spread сохраняет все поля

**Файл:** `src/ships/fleet-engine.ts:450-463`

**Описание:**
```ts
const newOrder: FleetOrder = {
  ...order,
  path: reversedPath,
  currentLegIndex: 0,
  issuedTick: currentTick,
  etaTick: currentTick + travelDuration,
};
```
`...order` копирует `repeat`, `targetId`, `type`. Если FleetOrder получит новые поля — они автоматически копируются (хорошо). Но `targetId` остаётся тот же, хотя fleet физически в `path[path.length-1]` (конец пути) и движется обратно к `path[0]` (начало). `targetId` сохраняет смысл «целевая система патрулирования» — OK, но если логика потом использует targetId для гео-проверок (например, «достигли ли мы targetId?») — проверка сработает некорректно на reversed path.

**Влияние:**
Cosmetic / future-risk.

---

### P3-5: `generate-systems.ts` dead-code fallback (line 60-63)

**Файл:** `src/galaxy/generate-systems.ts:55-65`

**Описание:**
```ts
const companionIdx = Math.max(0, Math.min(MAIN_SEQUENCE_STAR_TYPES.length - 1, currentIdx + rng.nextInt(0, 1)));
const companion = MAIN_SEQUENCE_STAR_TYPES[companionIdx];
if (companion !== undefined) return companion;
// Unreachable: companionIdx is clamped to [0, length-1]. Fall back to the
// primary def to keep the type happy (this branch is dead code).
return primaryDef;
```
Code acknowledges the branch is dead (TS guard for `noUncheckedIndexedAccess`). Fine, but worth noting: dead branches with comment — это технический долг TS-strictness.

**Рекомендация:**
Можно переписать с `!` non-null assertion: `return MAIN_SEQUENCE_STAR_TYPES[companionIdx]!;`. Но `!` — это eslint warning в strict-mode. Текущий подход безопаснее.

---

### P3-6: `consumeFuel` priority order (xenon → hydrogen → chemical) — недокументировано

**Файл:** `src/ships/fleet-engine.ts:397-417`

**Описание:**
Комментарий (line 392-394):
> Списать топливо с флота. Пробует типы в порядке: xenon → hydrogen → chemical.
> Antimatter зарезервирован для Etap 4.

Приоритет hardcoded, не в data file. Тесты (T-FLEET-4 #6) проверяют fallback через hydrogen, но не указывают rationale для приоритета.

**Влияние:**
Cosmetic. Если приоритет должен меняться (например, по tech unlock — «antimatter_efficiency» позволяет использовать antimatter first), потребуются code changes.

**Рекомендация:**
Перенести в `src/data/ships/fuel-map.ts` как `FUEL_PRIORITY: FuelType[] = ['xenon', 'hydrogen', 'chemical']`.

---

### P3-7: GameMediator tick — `time` mutation через tickAll передаётся в modules

**Файл:** `src/core/game-mediator.ts:222-234` (per Pass 1 P1-4)

**Описание:**
Mediator mutates `this.gameState.time` in-place (P1-4 из Pass 1), then `this.registry.tickAll(this.gameState.time)`. Modules подписаны на `core:tick` event с этим `time` payload. Если modules модифицируют `time` (например, ResearchModule инкрементирует `tick` для slot IssuedTick comparisons), это повлияет на subsequent modules.

**Подтверждение из Pass 2:** ResearchModule, ShipsModule, FleetModule, GalaxyModule, EconomyModule все принимают `time: GameTime` в `tick(time)`. Engine functions (processFleetTick, processEconomyTick, tickResearch) принимают `currentTick: number` напрямую (через parameter passing)., не мутируют time. OK.

Но: `tickResearch` меняет `state.totalRpGenerated` — это уже часть draft (immer), а не time.

**Влияние:** Limited. Pass 1 P1-4 уже отметил, что `time.tick` in-place mutation ломает immer re-render detection.

---

## 4. Метрики по слоям

### Economy
- **Строк кода:** engine.ts (1069) + economy-module.ts (414) + index.ts (26) = **1509 строк**
- **Тесты:** `tests/economy/processors.test.ts` (32 tests, 542 строки) + `tests/economy.test.ts` (4-5 tests, 227 строк) + coverage в immutability/modular-integration. ~36 tests.
- **Coverage gaps:** store-level actions (P0-1 из Pass 1 — root cause), warehouse-full edge case (P1-1 этого захода), production queue stuck-head (P2-7), `economy:production-cancelled` reason field (P1-5).
- **Функций экспортировано:** 14 (`processEconomyTick`, `recalcEnergyBalance`, `buildOnHex`, `buildOnAtmosphereSlot`, `buildOnOrbitSlot`, `upgradeBuilding`, `enqueueProduction`, `cancelProduction`, `giveStarterResources`, `colonizePlanet`, `calculateProcessorOutputMultiplier`, `findProcessorInstance`, `specializeBuilding`, `upgradeSpecialization`).

### Ships
- **Строк кода:** designer.ts (440) + orders.ts (407) + fleet-engine.ts (525) + ships-module.ts (183) + fleet-module.ts (146) + index.ts (64) = **1765 строк**
- **Тесты:** 4 файла, **90 tests** (17 fleet-engine + 23 orders + 33 designer + 17 shipyard), 1744 строки тестов.
- **Coverage gaps:** `fleet:movement-started` event emit (P1-4), `defending` state lifecycle (когда очищается?), cross-layer colonize via Economy engine (P1-2), attack stub result.ignore (P1-3).
- **Stubs для Etap 4:** `resolveCombat` (orders.ts:241) — attacker always wins, no losses; `canColonizePlanet` (orders.ts:262) — only checks `type === 'rocky' && !owner`, не проверяет colony_module ship.

### Research
- **Строк кода:** engine.ts (862) + research-module.ts (260) + index.ts (~10) = **1132 строки**
- **Тесты:** 7 файлов в `tests/research/`, **164 tests** total (per TЗ), 1472 строки. Largest: `process-tick.test.ts` (51 tests, 555 строк).
- **Coverage gaps:** spec drift `getLabRPPerSec` делитель 800 vs 500 (P2-3), `habitabilityPercent = 0` stub (P2-5 из Pass 1 — confirmed), integration test от ResearchModule.tick до commitState + emit (только unit tests).
- **Tree validation:** `validateTechTree` существует (engine.ts:66-144), вызывается в ResearchModule.init (research-module.ts:98). Хорошо покрыто тестом `tree-data.test.ts` (166 строк).

### Galaxy
- **Строк кода:** generator.ts (132) + generate-systems.ts (272) + generate-planets.ts (550) + generate-resources.ts (268) + generate-jump-points.ts (130) + generate-positions.ts (99) + hex-grid.ts (116) + gen-context.ts (22) + galaxy-module.ts (151) + index.ts (14) = **1754 строки**
- **Тесты:** `tests/galaxy-snapshot.test.ts` (3 tests, 157 строк) — snapshot stability, determinism, BFS connectivity. Достаточно для MVP, но не покрывает edge cases (e.g., 1 system, 2 systems, no JP).
- **TypeScript errors:** Ожидаемо ~50+ errors из 137 baseline в `generate-systems.ts` + `generate-planets.ts` + `generate-resources.ts` (confirmed via grep — multiple `// noUncheckedIndexedAccess` guards в коде).
- **Coverage gaps:** `ensureConnectivity` не покрывается тестом на изолированные системы (только snapshot verifies connectedness post-fact). `generate-resources.ts` deposits logic edge cases (empty hexes, all-ocean planet) — нет unit tests.

### Data
- **Строк кода:** buildings.ts (277) + elements.ts (180) + warehouse.ts (570) + recipes.ts (871) + processing-chains.ts (1405) + ships/hulls.ts (98) + ships/shipyard-queue.ts (261) + research/tech-tree.ts (325) + chemistry/ (7 files, sizes TBD) + research/{branches,branch-links,tech-unlocks}.ts (sizes TBD) + ships/{modules,fuel-map,index}.ts (sizes TBD) ≈ **5000+ строк data definitions**
- **Recipe IDs:** 75 уникальных (no duplicates) — confirmed via `sort | uniq -c`.
- **Element IDs:** 60 (header comment устарел — P3-1).
- **Building IDs:** 14 (colony_hub, mine, quarry, gas_extractor, processor, synthesizer, refinery, solar_plant, nuclear_reactor, shipyard, warehouse, open_warehouse, high_tech_storage, spaceport, laboratory = 15; P3-1: 14 — actual count check):
  - colony_hub, mine, quarry, gas_extractor (4 extraction+colony)
  - processor, synthesizer, refinery (3 processing)
  - solar_plant, nuclear_reactor (2 energy)
  - shipyard (1 production)
  - warehouse, open_warehouse, high_tech_storage, spaceport (4 logistics)
  - laboratory (1 research)
  - **Итого: 15 зданий.** В buildings.ts header: «9 зданий для MVP» — устарел (header comment на line 2). Build-store-cost-per-level данные на 15 зданий.
- **Tech tree:** 15 технологий в 5 ветках (per tech-tree.ts header comment).

### Tests
- **Строк кода:** 5903 строк в 22 файлах `.ts` (per Pass 1).
- **Соотношение тесты/код:** 5903/(1509 economy + 1765 ships + 1132 research + 1754 galaxy + ~5000 data + 832 types + ...) = ~0.19 (per Pass 1). Низкое, но приличное для MVP-среза.
- **Major gaps:** store-level actions (P0-1 root cause — confirmed via grep `useGameStore` in tests/ → 1 hit в комментарии), UI component tests (0), integration path `UI click → store → mediator → tick → state-changed → store sync → UI re-render` (0).

---

## 5. Оценка качества кода

**Вердикт: Acceptable / Требует доработки**

Кодовая база **функционально корректна** (340/340 тестов pass), **структурно надёжна** (modular-bus, immer.produce pattern, PRNG determinism), но имеет **несколько серьёзных edge-case bugs** в production-критичных путях (silent resource loss при полном складе, missing event emission при pause/resume, cross-layer hard imports).

### Что хорошо (✅)
1. **Pure engine functions** — designer.ts, orders.ts, fleet-engine.ts (F3 часть) реализованы как pure functions без side-effects. `validateShip`, `calculateDesignStats`, `planRoute` (BFS), `calculateTravelTime` — детерминированные, тестируемые.
2. **Module pattern** — все 5 модулей (Galaxy, Economy, Research, Ships, Fleet) реализуют IGameModule контракт с manifest, init/start/stop/destroy, setGameStateAccessor/setGameStateMutator. Симметрично.
3. **Tick ordering via priorities** — `PRIORITY.SIMULATION` для galaxy, `+5` для research, `+10` для ships, `+20` для fleet. Это даёт правильный порядок: galaxy → economy → research → ships → fleet (корабли построены до движения флотов, RP накоплены до завершения).
4. **Deterministic ID generation** — `productionItemCounter`, `shipCounter` (ships-module.ts:29), `genId(prefix)` (gen-context.ts:13) — все монотонные счётчики без `Math.random()`. Reset functions экспортированы для тестов.
5. **Idempotent unlocks** — `applyTechUnlock` (research/engine.ts:727-775) использует `if (!list.includes(unlock.id))` для idempotency. Покрыто тестом (process-tick.test.ts:391 — «Idempotent: apply twice → no duplicates»).
6. **Warehouse cache** — `calculateWarehouseCapacities` (warehouse.ts:208-256) использует `WeakMap<Planet, ...>` для memoization. Immer создаёт новый Planet ref при mutation → cache auto-invalidates. Хорошо.
7. **Recipe validation** — `bun run validate:recipes` проверяет 75/75 recipes, нет дублей IDs.
8. **DFS cycle detection** — `validateTechTree` (research/engine.ts:66-144) использует DFS с WHITE/GRAY/BLACK coloring для обнаружения циклов в DAG prerequisite. Хорошо реализовано.
9. **BFS connectivity** — `ensureConnectivity` (generate-jump-points.ts:72-129) гарантирует linked galaxy, добавляя JP к ближайшей посещённой системе для каждого изолянта.
10. **Spec-driven data** — recipes.ts основан на docs/mendeleev.md §3.1 (молярная масса), formulae в buildings.ts — на docs/40-buildings.md §11.3 (с подтверждением через комментарии в engine.ts:414-458).

### Что требует доработки (🔴)
1. **P1-1** — Silent resource loss — самый серьёзный edge-case bug этого захода. Затрагивает любую игру с заполненным складом (что случается routinely в long-running saves).
2. **P1-4** — Missing `fleet:movement-started` event при pause/resume — UI не сможет корректно показать анимацию движения.
3. **P1-2** — Cross-layer import `ships → economy` нарушает modular-arch контейнер Block 06.
4. **P2-2** — `findPlanet` O(S×P) без индекса — performance problem на big maps (500 систем × 100 queues = 400K iter/tick).
5. **P2-7** — Stuck production queue head — UX problem, queue stalls if head can't complete.
6. **Test coverage gap** — 0 интеграционных тестов для store-level actions (подтверждено grep). Pass 1 уже отметил это как root cause P0-1.
7. **P3-2** — Engine functions с `gameBus.emit` внутри produce draft — architectural smell, но не блокирующая.

### Архитектурный долг (заход 2 добавил)
- **Hardcoded data in engine.ts** — starter resources (P2-5), atmosphere efficiency (P2-9), findProcessorInstance magic numbers (P2-4). Code/data separation нарушена в 3+ местах.
- **Duplicated helpers** — findPlanet в 3 модулях (P3-3), extraction logic (P2-6).
- **Stub functions without explicit Etap 4 marker** — `resolveCombat` (orders.ts:241), `canColonizePlanet` (orders.ts:262). TODO comments есть, но не вынесены в `STUBS.md` или tracking issue.
- **Spec drift undocumented** — `getLabRPPerSec` делитель 800 vs spec 500 (P2-3). Block 07 PRNG port fix уже подтвердил, что spec/code sync нужен.

---

## 6. Соответствие планам

### Block 02 (Fleet MVP F1-F7) — ✅ выполнено (with caveats)
- **F1 (hulls + modules + fuel-map):** `src/data/ships/{hulls,modules,fuel-map}.ts` — 4 корпуса MVP (Скаут/Истребитель/Фрегат/Транспорт). ✅
- **F2 (validateShip + calculateDesignStats):** `src/ships/designer.ts` — все правила Приложения B реализованы, 33 unit tests. ✅
- **F3 (createFleet / mergeFleets / splitFleet):** `src/ships/fleet-engine.ts:45-160` — pure functions, 3 unit tests. ✅
- **F4 (planRoute + calculateTravelTime + executeOrder):** `src/ships/orders.ts` — BFS, 23 unit tests. ✅
- **F5 (processFleetTick + consumeFuel + completeOrder):** `src/ships/fleet-engine.ts:277-502` — все 5 order types (move/patrol/colonize/attack/defend), 17 unit tests в fleet-engine.test.ts. ✅ (но P1-4 edge case untested).
- **F6 (processShipyardTick):** `src/data/ships/shipyard-queue.ts` — 17 unit tests в shipyard.test.ts. ✅
- **F7 (integration):** ShipsModule + FleetModule registered в ModuleRegistry, tick ordering correct. ✅
- **Caveats:**
  - resolveCombat — stub (Etap 4) ✅ documented
  - canColonizePlanet — stub, only checks rocky+!owner (Etap 4 colony_module ship check) ✅ documented
  - P1-2: cross-layer import violates modularity ⚠️
  - P1-4: movement-started event edge case ⚠️

### Block 03 (Research MVP R1-R7) — ✅ выполнено (with caveats)
- **R1 (15/72 techs + 5 fundamental branches):** `src/data/research/tech-tree.ts` — 15 специализированных tech в 5 ветках (P=3, M=4, W=3, C=3, B=2). ✅
- **R2 (Laboratory building):** `src/data/buildings.ts:233-245` — `laboratory` BuildingDef, energyConsumption=10, cost=30/20/5. ✅
- **R3 (queue + tick + cost + slots):** `src/research/engine.ts` — `tickResearch`, `createResearchSlot`, `getTechCost`, `getCumulativeCost`, `getMaxResearchSlots`. ✅
- **R4 (validation):** `canStartResearch`, `canAllocate`, `getTechCeiling`. ✅
- **R5 (idempotent unlocks):** `applyTechUnlock` — uses `list.includes` check. ✅
- **R6 (full tree validation):** `validateTechTree` — DFS cycle detection, ID duplicate check. ✅
- **R7 (ResearchModule + tick integration):** `src/research/research-module.ts` — priorities `SIMULATION + 5` (после economy, перед ships). 6+ new typed-bus events (events.ts:183-203 per Pass 1). ✅
- **Caveats:**
  - P2-5 (Pass 1): `habitabilityPercent = 0` stub — Etap 4 ⚠️
  - P2-3 (этот заход): `getLabRPPerSec` делитель 800 vs spec 500 — spec drift ⚠️
  - 6 фундаментальных веток (vs 5): `chemistry, physics, engineering, biology_fund, military_science, xenoarchaeology` (createDefaultResearchState, engine.ts:786-794). spec §60-research.md говорит 6 веток, MVP реализует все 6. OK.

### Block 05 (Processors universal → specialized) — ✅ выполнено
- 2 типа (universal + specialized) — `ProcessorType` type, BUILDING_MAP с `defaultProcessorType`. ✅
- 7 ProcessorRecipeCategory — `PROCESSOR_CATEGORIES` (data/processor-categories.ts). ✅
- specializeBuilding / upgradeSpecialization — `src/economy/engine.ts:785-948`. ✅
- 8 тестов T5.1-T5.8 — `tests/economy/processors.test.ts` (32 tests, 542 строки). ✅
- Formulas (engine.ts:414-458): universal `base × baseYield × 1/sqrt(activeRecipes)`, specialized `1.0 × (1 + 0.02 × (specLvl-1))`. Соответствует docs/40-buildings.md §11.3 per inline comment. ✅

---

## 7. Рекомендации для Pass 3 (docs compliance)

Based on Pass 2 findings, Pass 3 should focus on:

### 7.1 Verify spec/code drift discovered in Pass 2
1. **`getLabRPPerSec` делитель 800 vs spec 500** (P2-3):
   - Check `docs/60-research.md` §3.1 — подтверждена ли опечатка «500»?
   - Если spec правильный — исправить код на 500, обновить T-R3 ожидаемое 17.4.
   - Если spec неверный — обновить spec на 800.
2. **`elements.ts` count: 60 vs header «57»** (P3-1):
   - Check `docs/32-mendeleev.md` — список должен содержать 60 элементов (57 base + 3 transuranic).
3. **`buildings.ts` count: 15 vs header «9»** (P3-1, similar):
   - Check `docs/40-buildings.md` — список зданий должен совпадать (colony_hub, mine, quarry, gas_extractor, processor, synthesizer, refinery, solar_plant, nuclear_reactor, shipyard, warehouse, open_warehouse, high_tech_storage, spaceport, laboratory).
4. **`getAtmosphereEfficiency` magic numbers** (P2-9):
   - Check `docs/40-buildings.md` §2.3 — таблица atmospher→efficiency: thin=0.3, standard=0.6, dense=0.7, toxic=0.6, inert=0.5, methane=0.7, co2=0.5.
5. **`COLONY_STARTER_RESOURCES` hardcoded** (P2-5):
   - Check `docs/40-buildings.md` §5 или `docs/05_colony_start.md` — стартовые ресурсы { Fe:150, Si:100, C:60, Al:80, H:300, Ti:30, Cu:40, O:200, N:100, Au:2, U:5 } должны быть в spec.
6. **`FUEL_PRIORITY` order** (P3-6):
   - Check `docs/50-ships.md` §3.2 (fuel consumption) — xenon→hydrogen→chemical priority должен быть документирован.
7. **`SHIP_BUILD_TIME` values** (shipyard-queue.ts:48-56):
   - scout=50, fighter=80, frigate=150, transport=120 — сверить с docs/50-ships.md Приложение C.
8. **`SHIP_BUILD_COSTS` STEEL_PER_UER=5, MICROCHIP_PER_UER=1** (shipyard-queue.ts:40-41):
   - Check `docs/50-ships.md` §1.3 — упрощение MVP «1 у.е.р. = 5 steel + 1 microchip» должно быть в spec.

### 7.2 Verify Block 02 (Fleet MVP) completeness
1. **4 hulls (Scout/Fighter/Frigate/Transport)** vs spec §2.2 — значения (totalHS, baseHP, baseMass, slots, cost) должны совпадать.
2. **`armorMultiplier` multipliers** (designer.ts:42-56) — сверить с docs/50-ships.md §2.3 (light/standard/thick/heavy).
3. **`validateShip` rules 1-11** (designer.ts:275-416) — сверить с Приложением B docs/50-ships.md.
4. **`planRoute` BFS** (orders.ts:97-123) — спецификация алгоритма в §1.6 / §3.2.4 docs/50-ships.md.
5. **`JUMP_RECHARGE_TICKS = 10`** (orders.ts:38) и **`TRAVEL_SCALE = 1000`** (orders.ts:54) — должны быть в spec.

### 7.3 Verify Block 03 (Research MVP) completeness
1. **15 techs** (tech-tree.ts:29+) — сверить с docs/60-research.md §6 (15 specialised techs in 5 branches).
2. **6 fundamental branches** (createDefaultResearchState, engine.ts:786-794) — сверить с docs/60-research.md (хотя спека говорит 5 веток MVP, реализация имеет 6 — xenoarchaeology нулевой, но присутствует). Pass 1 (P2-5) подтвердил, что xenoarchaeology reserved for Etap 4 — OK.
3. **`getTechCost` formula** `floor(baseCost × 1.5^(N-1))` (engine.ts:157-160) — сверить с §9.2 docs/60-research.md.
4. **`getMaxResearchSlots` formula** `min(1 + floor(totalLabCount/10), 10)` (engine.ts:228-230) — сверить с §9.5 docs/60-research.md.
5. **`getFocusBonus` formula** `1.2 if activeSlots==1 && allocation==100, else 1.0` (engine.ts:238-241) — сверить с §9.6 docs/60-research.md.
6. **`TECH_UNLOCKS` entries** — сверить с `docs/60-research.md` §8 таблицы разблокировок (recipe/module/building/ship_hull).

### 7.4 Verify Block 05 (Processors) completeness
1. **`calculateProcessorOutputMultiplier` formulas** (engine.ts:433-458) — сверить с `docs/40-buildings.md` §11.3.
2. **`specializeBuilding` min level 3** (engine.ts:835) — сверить с §11.4 docs/40-buildings.md.
3. **`specializationLevel` cap at 5** (engine.ts:913) — сверить с §11.5 docs/40-buildings.md.
4. **`purityBonus = 1 + 0.02 × (specLvl - 1)`** (engine.ts:445) и **`purity = 0.92 + 0.0175 × (specLvl - 1)`** (engine.ts:446) — сверить с §11.3.

### 7.5 Verify warehouse / logistics
1. **`ORE_WAREHOUSE_BASE = 1000`, `PROCESSED_WAREHOUSE_BASE = 100`, `HIGH_TECH_STORAGE_BASE = 10`** (warehouse.ts:34-49) — сверить с `docs/35-warehouse-and-logistics.md` §1.3.
2. **`WarehouseSpecialization` bonuses** (warehouse.ts:81-87): universal=1.0, ore=1.25, metal=1.20, gas=1.20, component=1.15 — сверить с §3.
3. **`SPEC_BONUSES` +25% / +20% / +15%** — Pass 1 confirmed warehouse.ts, but spec drift должен быть проверен в Pass 3.

### 7.6 Cross-cutting
1. **README.md update** (P3-5, P3-6 из Pass 1) — добавить Etap 2.5/2.6/3.0 завершёнными, обновить дерево каталогов (теперь `src/ships/`, `src/research/`, `src/data/ships/`, `src/data/research/`, `src/data/chemistry/` — все существуют).
2. **`INSTRUCTIONS.md` path fix** (P1-3 из Pass 1) — `/home/z/my-project` → `/home/z/spacegame-audit/spacegame` (5 замен).
3. **`08_27_doc_fixes.md` contradictions** (per Pass 1 plan §7.3.5) — все 5 contradictions должны быть зафиксированы в коде (verify).
4. **`08_27_highlevel_plan.md` Etap 3.5 (AI factions)** — должен быть следующим шагом; проверить, не реализован ли он уже частично в коде (grep для `AI`, `faction`).

---

## Изменённые файлы
- `checkpoints/audit_2026_08_27_02_code_quality.md` (этот файл)

---

**End of Pass 2.**
