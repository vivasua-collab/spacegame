# Чекпоинт: Блок 06 — Интеграция store → mediator (модульная шина)

**Дата:** 2026-08-27
**Фаза:** Etap 2.5
**Статус:** `pending`
**Зависимости:** нет (фундаментальный архитектурный блок; критично выполнять первым)
**Оценка:** 4–6 дней

> 👉 Связанные:
> - [08_27_audit_summary.md](./08_27_audit_summary.md) §2.1 (архитектурное нарушение)
> - [08_27_gap_analysis.md](./08_27_gap_analysis.md) Gap-1
> - [08_27_block_01_stabilization.md](./08_27_block_01_stabilization.md) C1 (после Блока 06 — удалить event-bus.ts)
> - `docs/architecture/modular-bus.md` (~2050 строк, источник истины)
> - `src/core/*` (TypedEventBus, ModuleRegistry, GameMediator, EconomyModule, GalaxyModule)

---

## 1. Цель блока

Сделать modular-bus **живой архитектурой** — все мутации состояния идут через медиатор, события обрабатываются модулями, store становится тонким слоем над медиатором. Устранить архитектурный долг #1 (gap-1 аудита): 1500+ строк модульной архитектуры — декоративны.

## 2. Контекст

Текущее состояние (см. audit §2.1):
- `page.tsx:52` (setInterval) → `useGameStore.tick()` → `engine.ts` напрямую (минуя mediator)
- `game-store.ts:247` (tick) → `processEconomyTick(...)` → `engine.ts` напрямую
- `game-store.ts:270,281,290,303` → `buildOnHex/upgrade/enqueue/colonize` → `engine.ts` напрямую
- `EconomyModule.tick()` зарегистрирован, **никогда не вызывается**
- `GameMediator.tick()` **никогда не вызывается**
- `GameLoop.start()` (через `mediator.togglePause()`) **никогда не запускается**
- `gameBus.emit('production:complete', ...)` и 5 других событий уходят в пустоту — ни один модуль не подписан

## 3. Задачи

### 3.1 Рефакторинг `game-store.ts` 🟢 (1.5 дня)

**Файл:** `src/stores/game-store.ts`

- Удалить прямой импорт `processEconomyTick`, `buildOnHex`, `upgradeBuilding`, `enqueueProduction`, `colonizePlanet` из `@/economy`.
- В action `tick()`: вызывать `mediator.tick()` (который внутри дёргает `loop.tick()` → эмитит `core:tick` → `EconomyModule.onTick()` → `processEconomyTick`).
- В actions `buildOnHex/upgrade/enqueue/colonize`: эмитить события `economy:build`, `economy:upgrade`, `economy:enqueue`, `economy:colonize` через `mediator.getBus().emit(...)`.
- В action `setSpeed`: вызывать `mediator.setSpeed(speed)`.
- В action `togglePause`: вызывать `mediator.togglePause()`.
- Сохранить существующий API (все action-имена и сигнатуры), чтобы UI-компоненты не требовали правок.

**Ключевая правка:**
```typescript
// Было:
tick: () => set((state) => {
  processEconomyTick(state.gameState.galaxy, state.gameState.productionQueues, /*time*/);
  return { ... };
}),
// Стало:
tick: () => {
  mediator.tick();  // внутри: loop.tick() → bus.emit('core:tick') → EconomyModule.onTick() → processEconomyTick(state)
  // store обновляется через подписку на state:changed event
},
```

### 3.2 Доработка `EconomyModule` 🟢 (1 день)

**Файл:** `src/economy/economy-module.ts`

- В `onTick(time)`: вызвать `processEconomyTick(state.galaxy, state.productionQueues, time)` (через переданный `IQueryContext` или `mediator.getState()`).
- Подписаться на `economy:build` → вызвать `buildOnHex(planet, hexIndex, buildingId, deposits)` → после успеха эмитить `economy:building-constructed`.
- Подписаться на `economy:upgrade` → `upgradeBuilding(...)`.
- Подписаться на `economy:enqueue` → `enqueueProduction(...)`.
- Подписаться на `economy:colonize` → `colonizePlanet(...)`.
- Подписаться на `economy:production-complete` (для UI-обновления, если нужно).

**Подписки регистрируются в `manifest.events.subscribed` (см. `IGameModule`).**

### 3.3 Доработка `GameLoop` 🟢 (0.5 дня)

**Файл:** `src/core/game-loop.ts`

- В `start()`: `setInterval(() => this.tick(), this._intervalMs)`.
- В `tick()`: `for (let i = 0; i < Math.min(this._speed, 50); i++) { this._bus.emit('core:tick', this._time); this._time.tick(); }`.
- Скорость x1 → interval 1000ms, x5 → 200ms, x15 → ~67ms, x50 → 20ms (защита от перегрузки — `Math.min(speed, 50)`).
- В `stop()`: `clearInterval(this._handle)`.

### 3.4 Интеграция с `page.tsx` 🟢 (0.5 дня)

**Файл:** `src/app/page.tsx`

- Удалить `setInterval` (строка 52).
- В `useEffect` (mount): вызывать `mediator.start()` (который вызывает `loop.start()`).
- В `useEffect` (unmount): `mediator.stop()`.

### 3.5 Миграция `engine.ts` на typed bus 🟢 (0.5 дня)

**Файл:** `src/economy/engine.ts`

- Заменить `import { gameBus } from '@/core/event-bus'` на `import { mediator } from '@/core'` (или прокинуть `bus` через параметры).
- Заменить `gameBus.emit('production:complete', ...)` на `bus.emit('economy:production-complete', ...)` (typed).
- Заменить 6 вызовов `gameBus.emit(...)` на typed эквиваленты.
- После миграции всех 6 вызовов — удалить `src/core/event-bus.ts` (это уже Блок 01 C1, но можно сделать здесь).

### 3.6 Подписка store на `state:changed` 🟢 (0.5 дня)

**Файл:** `src/stores/game-store.ts`

- `mediator.getBus().subscribe('state:changed', (newState) => set({ gameState: newState }))`.
- `state:changed` эмитится модулями после мутаций (например, `EconomyModule.onTick` после `processEconomyTick`).
- Альтернатива: mediator держит ссылку на state; store дёргает `mediator.getState()` в `tick()` после мутаций.

### 3.7 Тесты 🟢 (0.5 дня)

- `tests/modular-integration.test.ts` — unit-тест:
  - После `mediator.tick()` вызывается `EconomyModule.tick()` (spy на `processEconomyTick`).
  - После `mediator.emit('economy:build', ...)` вызывается `buildOnHex` (spy).
  - Интеграционный: `setSpeed(5)` → 5 тиков за интервал.
- `tests/game-loop.test.ts` — unit-тест:
  - `loop.start()` запускает интервал.
  - `loop.stop()` останавливает интервал.
  - `loop.setSpeed(5)` → 5 эмитов `core:tick` за интервал (через spy на `bus.emit`).

## 4. Файлы

**Изменяемые:**
- `src/stores/game-store.ts` (3.1, 3.6)
- `src/core/game-mediator.ts` (добавить `start/stop/setSpeed/togglePause` публичные методы, если нет)
- `src/core/game-loop.ts` (3.3)
- `src/economy/economy-module.ts` (3.2)
- `src/economy/engine.ts` (3.5 — миграция на typed bus)
- `src/app/page.tsx` (3.4 — удалить setInterval)

**Создаваемые:**
- `tests/modular-integration.test.ts`
- `tests/game-loop.test.ts`

**Удаляемые:**
- `src/core/event-bus.ts` (после 3.5; если Блок 01 C1 ещё не сделан — оставить до него)

## 5. Критерий готовности

- [ ] `mediator.tick()` вызывается при каждом тике (через `useGameStore.tick()`).
- [ ] `EconomyModule.tick()` вызывается через подписку на `core:tick`.
- [ ] События `economy:build`, `economy:upgrade`, `economy:enqueue`, `economy:colonize` доходят до `EconomyModule` и обрабатываются.
- [ ] `event-bus.ts` удалён, нет `as any` кастов в коде.
- [ ] `page.tsx` не содержит `setInterval` — интервал управляется `GameLoop.start()`.
- [ ] Все существующие UI-тесты проходят (галактика, колонизация, сохранение).
- [ ] `tests/modular-integration.test.ts` и `tests/game-loop.test.ts` зелёные.
- [ ] `bun run lint` — 0 ошибок.

## 6. Риски

| Риск | Митигация |
|------|-----------|
| Изменение семантики тика (mediator vs direct) ломает существующий UI | Сохранить action-имена в store; UI не трогать. Тесты UI сохраняются зелёными. |
| Подписка `state:changed` создаёт цикл (store update → mediator → event → store update) | Сравнивать state по ссылке; если не изменился — не эмитить. Или использовать `produce` из immer для иммутабельности. |
| `GameLoop` с setInterval может дрейфовать во времени | Использовать `requestAnimationFrame` + накопительный dt; или scheduled timer с компенсацией дрейфа. |

## 7. Порядок внедрения

```
3.4 (page.tsx — удалить setInterval) ─► 3.3 (GameLoop.start/stop)
                                          │
3.1 (game-store — миграция на mediator) ──┤
                                          │
3.2 (EconomyModule — подписки) ───────────┤
                                          │
3.5 (engine.ts — typed bus миграция) ─────┤
                                          │
3.6 (store подписка на state:changed) ────┤
                                          ▼
                                  3.7 (тесты)
```

## 8. Связь с другими блоками

- **После Блока 06** можно выполнить **Блок 01 C1** (удалить `event-bus.ts`) — миграция уже сделана в 3.5.
- **Блок 01 P2** (immutable store) — ортогонален, можно делать параллельно.
- **Блок 01 P9** (ProductionItem deterministic IDs) — можно делать параллельно.
- **Блок 05** (переработчики) — DEP-1 (двойная шина) закрывается здесь.

## Изменённые/созданные файлы
- `checkpoints/08_27_block_06_modular_integration.md` (этот файл)
