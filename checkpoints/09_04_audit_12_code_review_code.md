# 📦 Кодовая база: Аудит и ревью кода после слияния (R-31)

👉 Основной план: [09_04_audit_12_code_review.md](09_04_audit_12_code_review.md)

**Дата:** 2026-09-04 06:14
**Статус:** complete

## Аудит текущего кода (консолидированная таблица)

Источники: три параллельных ревью-агента (полные отчёты — worklog.md,
Task ID 32-a / 32-b / 32-c). Severity: major — влияет на геймплей/данные;
minor — UX/согласованность; noise — strict-режим tsc.

### Исправленные баги (R-31)

| # | Sev | Место | Баг | Фикс |
|---|-----|-------|-----|------|
| 1 | major | engine.ts `specializeBuilding` | Бесплатное переключение категории специализации X→Y (стоимость списывалась только при universal→specialized) — после одной оплаты бесконечная смена категорий с бустом | Полная стоимость specializeCost и при switch (isSwitching-гейт) |
| 2 | major | engine.ts `processEconomyTick` + `processAutoProcessing` | Двойной энергобюджет: авто-переработка гейтилась по статическому балансу ДО трат очереди; декремент очереди не виден авто-режиму | Порядок тика: очередь ПЕРЕД авто-переработкой; комментарий семантики «внутритиковый бюджет, recalc сбрасывает» |
| 3 | major | game-store.ts:1039 + engine.ts | Коллизия ID queue-элементов после Load: `resetProductionItemCounter()` → 0, а сейв содержит `prod_<planet>_0..N`; `cancelProduction` удаляет по ПЕРВОМУ совпадению → отменялась не та задача; дубли React-ключей | `restoreProductionItemCounter(queues)` — max числовой суффикс + 1 |
| 4 | major | planet-view.tsx HexInfoCard | Хардкод «+10/tick» (energy) и «+5/tick» (colony_hub) — игнорировались уровень, светимость P1-26, орб. радиус | `getBuildingEnergyOutput(...)` + starLuminosity/orbitalRadius из системы |
| 5 | major | engine.ts:989 + planet-view.tsx | Общий бар склада: used включал газ, totalCapacity — нет («прыжок» 12000→10000 после первой постройки; бар мог показывать >100%) | engine: totalCapacity = ore+processed+highTech+**gas**; UI: знаменатель из живых caps |
| 6 | major | building-dialog.tsx `handleBuild` | Boolean-результат buildOn* игнорировался — при отказе engine диалог молча закрывался; gas_extractor на безатмосферной планете выглядел доступным | Тост «Не удалось построить» + диалог остаётся; карточка disabled с причиной («Требуется атмосфера»/«Неподходящая местность») |
| 7 | minor | save-format-v3.ts `idOf` | Битый индекс словаря молча возвращал число-строкой как elementId (тихая порча данных) | throw «Повреждённый сейв: индекс вне словаря» (строгий контракт v3) |
| 8 | minor | engine.ts карусель | `activeRecipes` не очищался у простаивающих экземпляров → фантомный «активный рецепт» в диалоге здания | Сброс: пустая очередь → все; незадействованные в assignQueueTasks |
| 9 | minor | api/save (POST/PUT) | Лимит проверялся по `stateJson.length` (символы), а не UTF-8 байтам | `Buffer.byteLength(stateJson, 'utf8')` |
| 10 | minor | reference-dialog + surface.json | Справка/описания дрейфовали от данных: 3 склада вместо 4 (газ 2000), «+10 энерг.» для всех, «100 ед.» вместимости вместо 3500/5000/1500, цепочки без точных выходов | 4-й газовый тир + сумма 12000; `getBuildingEnergyOutput` (nuclear 25); описания из констант; цепочки с точными выходами (C×8+Sl×2, Si×4.7+O×5.3, Al×2.1+Si×2.2+O×5.6+H×0.2, H×1.1+O×8.9) |

Дополнительно (уборка, без изменения поведения): мёртвый импорт
`getCurrentLookups`/`calculateWarehouseCapacity` и осиротевший комментарий в
engine.ts; неиспользуемые `getSpecInfo`/`getResourceCategory`, `centerX/Y` в
planet-view; неиспользуемый prop `specialization` панели; мёртвый селектор
`gameState` в page.tsx (лишняя перерисовка меню на каждый тик); мёртвый файл
`resource-panel.tsx` (0 импортов, логика разошлась с R-28); занятый слот
`<span onClick>` → `<button>` (a11y); тост при отказе enqueue в
production-queue-panel; дубль чекпоинта старого формата (R-25 пропустил).

### Отложенные (дизайн-решения — не баги)

| # | Sev | Место | Суть | Рекомендация |
|---|-----|-------|------|--------------|
| О1 | major-дизайн | ore-specs / processor-recipe-categories | Гейты уровней не применяются: L1 шахта добывает глубинные руды, L1 universal плавит smelt_y (minSpecializationLevel=5) — данные без потребителя | Владелец решает: реализовать гейты (processExtraction фильтр по depth; enqueue/карусель — по min уровню) или удалить данные |
| О2 | minor | engine.ts calculateProcessorOutputMultiplier | Мульти-рецептный штраф 1/√n недостижим (карусель: ≤1 задача на экземпляр) | Пересмотреть семантику при мульти-задачности либо удалить |
| О3 | minor | assignQueueTasks Pass 1/2 | Липкость spec-экземпляров: более ранняя задача той же категории вытесняет выполняющуюся (прогресс не теряется) | Приоритет sticky в Pass 1 или док |
| О4 | minor | ships-module/game-store | Счётчики ship/fleet/slot после Load — окно коллизии уже (tick в ID), но `ships.set` при коллизии молча перезапишет | Аналог restore-подхода при Load |
| О5 | minor | save-codec-browser | Фолбэк plain-JSON без CompressionStream (стар. браузеры): 200-системный сейв ~31 МБ → риск 413 | Задокументировано; сжатие при любой доступности |
| О6 | noise | tsc src | 91→93 (+2 strict-noise от isSwitching-строки) — все 93 рантайм-безопасны (границы проверены; классификация агентов) | Базлайн поднять при следующем аудите |

## Сниппеты реализации

### Восстановление счётчика ID очереди (engine.ts)

```ts
export function restoreProductionItemCounter(queues: Map<EntityId, ProductionQueue>): void {
  let max = -1;
  for (const queue of queues.values()) {
    for (const item of queue.items) {
      const m = /_(\d+)$/.exec(item.id);
      const suffix = m?.[1];
      if (suffix !== undefined) {
        const n = parseInt(suffix, 10);
        if (!Number.isNaN(n) && n > max) max = n;
      }
    }
  }
  productionItemCounter = max + 1;
}
// game-store.ts (loadGame): restoreProductionItemCounter(loadedState.productionQueues);
```

### Порядок тика экономики (engine.ts — фикс двойного энергобюджета)

```ts
processExtraction(planet);          // 1. добыча
processProductionQueue(planet, queues); // 2. очередь (тратит энергию первой)
processAutoProcessing(planet);      // 3. авто-переработка (гейт по остатку)
recalcEnergyBalance(planet, system); // 4. сброс на статический нетто
ensureReservesForResources(planet); // 5. резервы
```

### Оплата смены специализации (engine.ts)

```ts
const isSwitching = hex.processorType === 'specialized' && hex.specialization !== category;
if (hex.processorType !== 'specialized' || isSwitching) {
  if (!spendSpecializeCost(planet, def.specializeCost ?? {})) {
    return { success: false, reason: 'cannot-afford' };
  }
}
```
