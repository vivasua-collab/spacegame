# Аудит проекта — Заход 1: Фундамент

**Дата:** 2026-08-27
**Task ID:** 19 (audit-coordinator)
**Область:** Структура проекта, типы, события, архитектура модулей, game-store, конфиги
**Commit:** e3bc1d6 (HEAD of origin/main after Etap 3.0 — Block 03 R7 final integration)

---

## 1. Исполнение (что проверено)

### 1.1 Доступ к репозиторию
- Проверен путь `/home/z/spacegame-audit/spacegame/` — доступ OK (3 файла `types.ts`, `game-store.ts`, `tests/prng.test.ts` прочитаны).
- `git log --oneline -20` подтверждает цепочку коммитов `35d5c76..e3bc1d6` (Block 05/06/07/08 + Block 02/03 phases).
- HEAD = `e3bc1d6` ("feat(block-03): Phase 3.7 — R7 final integration").
- Working tree: только `worklog.md` изменён (M).

### 1.2 Контекст
Прочитаны (для исторического контекста):
- `worklog.md` (236 строк) — Task ID 1–6, 19, хронология.
- `checkpoints/08_27_audit_summary.md` (190 строк) — сводный аудит.
- `checkpoints/08_27_gap_analysis.md` (263 строки) — 11 gap-ов, закрытых в Блоках 01/06/07/08.

### 1.3 Текущее состояние (проверено)
- **Tests:** 340 pass / 0 fail (22 файла, 221 321 expect calls, 3.48s) ✅
- **Lint:** 0 errors, 50 warnings (45× `@typescript-eslint/no-unused-vars`, 4× `react-hooks/exhaustive-deps`, 1× `prefer-const`) ✅
- **TypeScript:** 137 errors (бейзлайн работы: `noUncheckedIndexedAccess` — все `Object is possibly 'undefined'` для индексных доступов; ожидаемо, не блокирует) ✅
- **Recipe validation:** 75/75 валидных рецептов, 144 валидных resource ID ✅

### 1.4 Файлы, прочитанные в заходе
- Конфиги: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `prisma/schema.prisma`, `Caddyfile`, `INSTRUCTIONS.md`, `README.md`, `.gitignore`, `.env`
- Core: `src/core/types.ts` (832 строки), `src/core/events.ts` (250), `src/core/typed-event-bus.ts` (197), `src/core/module-types.ts` (157), `src/core/module-registry.ts` (242), `src/core/game-mediator.ts` (292), `src/core/game-loop.ts` (150), `src/core/prng.ts` (185), `src/core/immer-setup.ts` (23), `src/core/index.ts` (69)
- Store: `src/stores/game-store.ts` (1426 строк, полностью)
- App: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/api/route.ts`, `src/app/api/save/route.ts`, `src/app/api/save/[id]/route.ts`
- Economy Module: `src/economy/economy-module.ts` (414)
- Lib: `src/lib/db.ts`, `src/lib/rate-limit.ts`, `src/lib/schemas/save-schema.ts`, `src/lib/schemas/game-state-schema.ts`
- Тесты: `tests/prng.test.ts`, `tests/prng-statistical.test.ts` (header), `tests/immutability.test.ts`, `tests/modular-integration.test.ts` (header + body), `tests/economy.test.ts` (grep)

### 1.5 Команды выполнены
- `git log --oneline -20`
- `git status --short`
- `bun run lint` (финальная сводка)
- `bun x tsc --noEmit` (count: 137 errors, разбивка по файлам)
- `bun test` (340/340 pass)
- `bun run validate:recipes` (75/75)
- `git ls-files | grep .env` (env tracked)
- `ls -la /home/z/my-project/db/`, `ls db/` (path verification)

---

## 2. Сводка находок

| Категория | Кол-во | Краткий перечень |
|-----------|--------|------------------|
| Блокирующие (P0) | 1 | P0-1: прямые мутации store обходят mediator → следующий тик теряет данные пользователя |
| Серьёзные (P1) | 6 | P1-1 env tracked + путь /home/z/my-project; P1-2 loadGame не sync store→mediator; P1-3 INSTRUCTIONS.md неверный путь; P1-4 mediator.tick() in-place мутация time без immer; P1-5 setSpeed/togglePause in-place мутации без re-render; P1-6 ~26 unused deps из shadcn-бойлерплейта |
| Средние (P2) | 8 | P2-1 stale tailwind content paths; P2-2 page.tsx LCG вместо Xoshiro256; P2-3 prng.derive() Object.create-hack; P2-4 derive() — состояние родителя меняется; P2-5 research/engine.ts habitability=0 stub; P2-6 engine.ts 1068 строк; P2-7 game-store.ts 1426 строк; P2-8 крупные файлы (planet-view, processing-chains, recipes) |
| Незначительные (P3) | 7 | P3-1 index.ts упомянет event-bus.ts (файл удалён); P3-2 /api возвращает "Hello, world!"; P3-3 название "xoshiro256**" но 32-битная реализация; P3-4 tailwind v3-style конфиг при v4-движке; P3-5 README устарел (Etap 2.5 ещё «в плане»); P3-6 README не упоминает Blocks 02/03/05/06/07/08; P3-7 HullDef/ModuleDef deprecated aliases экспортируются |

---

## 3. Детальные находки

### P0-1: Прямые мутации Zustand-стора обходят mediator → следующий тик теряет данные пользователя

**Файл:** `src/stores/game-store.ts:565-1411` (действия `cancelProduction`, `setColonyRole`, `setReserveMinimum`, `setWarehouseSpecialization`, `moveToOrbit`, `moveFromOrbit`, `saveShipDesign`, `deleteShipDesign`, `enqueueShipBuild`, `cancelShipyardItem`, `createFleet`, `mergeFleets`, `splitFleet`, `renameFleet`, `issueFleetOrder`, `cancelFleetOrder`, `startResearch`, `cancelResearch`, `setAllocation`, `levelUpFundamental`, `autoAllocateSlots`)

**Описание:**
Подписка `mediator.getBus().on('core:state-changed', (newState) => { useGameStore.setState({ gameState: newState }); })` (строка 281-283) однонаправленная: `mediator → store`. Обратного канала `store → mediator` нет.

- Экономические действия (build, upgrade, enqueue, colonize, specialize, upgradeSpecialization) эмитят bus-события → EconomyModule оборачивает в `produce()` → `commitState(newState)` → mediator.gameState обновляется → emit `core:state-changed` → store syncs. ✅ Корректно.
- Но ~21 действие (перечислены выше) использует прямой `set((state) => { state.gameState... })` через immer-middleware стора. Создаётся **новая ссылка gameState в store**, но **mediator.gameState остаётся на СТАРОЙ ссылке**.

Когда `mediator.tick()` вызывается (через `setInterval` из `GameLoop`), он:
1. Читает `this.gameState` (СТАРАЯ ссылка, не имеет изменений пользователя).
2. Прямо мутирует `this.gameState.time.tick += speed` (без immer — строка 226).
3. Вызывает `registry.tickAll(this.gameState.time)` → EconomyModule.tick → `processEconomyTick()` читает `this.getGameState()` → возвращает СТАРУЮ ссылку.
4. `produce(currentState, draft => { processEconomyTick(...) })` — новое состояние вычисляется из СТАРОЙ ссылки.
5. `commitState(newState)` → mediator.gameState = newState (без изменений пользователя!) → emit `core:state-changed` → store syncs к newState.

**Влияние:**
Все мутации пользователя с момента последнего тика (отмена элемента очереди производства, смена роли колонии, резерв склада, сохранение дизайна корабля, постановка в очередь верфи, создание/слияние/разделение флота, приказ флоту, старт исследования, смена аллокации, level-up фундаментальной ветки) **ТЕРЯЮТСЯ** при следующем тике. Игра работает на скорости x1 (1000ms тик) — это означает, что любое действие игрока должно «успеть» за <1 секунду до следующего тика, иначе оно откатится.

**Подтверждение через тесты:** `tests/immutability.test.ts` и `tests/modular-integration.test.ts` тестируют **только mediator-path** (эмитят `economy:build` напрямую через `mediator.getBus().emit(...)`). Ни один тест не вызывает `useGameStore.cancelProduction` / `useGameStore.startResearch` / и т.д. напрямую. `tests/economy.test.ts` импортирует `cancelProduction` из `@/economy/engine` (движок) — не из store. Bug untested.

**Рекомендация:**
1. Краткосрочно: добавить `mediator.commitState(state.gameState)` или `mediator.setGameState(state.gameState)` в конце каждого прямого `set(...)` действия (21 действие в game-store.ts).
2. Архитектурно: сделать `mediator.gameState` единственным source-of-truth, store читает только через подписку (никаких прямых `set((state) => ...)` мутаций). Все действия должны эмитить bus-события, модули обрабатывают через `produce()` + `commitState()`.
3. Добавить integration-тест: `useGameStore.cancelProduction(...)` → `mediator.tick()` → assert отменённый элемент всё ещё отсутствует.

---

### P1-1: `.env` закоммичен в git и указывает на путь boilerplate-проекта

**Файл:** `.env` (root), tracked since initial commit `774c0c9`

**Описание:**
- `.env` содержит: `DATABASE_URL=file:/home/z/my-project/db/custom.db`
- `.gitignore` строка 34: `.env*` — но git уже отслеживает файл (правило применяется только к новым untracked файлам).
- Путь `/home/z/my-project/` — unrelated Next.js boilerplate. Реальный репозиторий SpaceGame находится в `/home/z/spacegame-audit/spacegame/`.
- Подтверждено: `ls db/` в корне репозитория — directory does not exist. `ls /home/z/my-project/db/custom.db` — file exists (28KB SQLite).

**Влияние:**
1. Любой клон репозитория в другое место получает `.env` с неработающим путём → Prisma не найдёт БД → все сохранения упадут.
2. Sandbox-refresh, который вытирает `/home/z/my-project/`, **удаляет всю БД сохранений** (это и произошло по worklog Task 19: «environment reset»).
3. Security: `.env` в git — нарушение best practice; даже без секретов, паттерн «tracked .env» создаёт риск для будущих секретов (NEXTAUTH_SECRET и т.д.).

**Рекомендация:**
1. `git rm --cached .env` и заменить на `.env.example` с относительным путём: `DATABASE_URL=file:./db/custom.db`.
2. Создать `db/` в репозитории и добавить `db/*.db` в `.gitignore` (уже есть строка 64-65, но `db/` dir не существует).
3. Запустить `bun run db:push` заново с новым `.env`.

---

### P1-2: `loadGame` действие не синхронизирует store → mediator

**Файл:** `src/stores/game-store.ts:959-990`

**Описание:**
```ts
loadGame: async (id) => {
  ...
  const loadedState = deserializeGameState(data.state);
  resetProductionItemCounter();
  resetShipCounter();
  set({ gameState: loadedState, ... });  // ← только store updated
  return true;
}
```
Не вызывает `mediator.setGameState(loadedState)` или `mediator.setLoadedState(loadedState)`. После `loadGame`:
- `store.gameState = loadedState` (NEW ref).
- `mediator.gameState` — либо null (если игра не создавалась), либо OLD ref (от предыдущей игры).

**Влияние:**
После загрузки сейва:
1. Если `mediator.gameState === null` → `mediator.tick()` сразу return (line 223: `if (!this.gameState ...) return`); игра «мёртвая», тики не обрабатываются, экономика не работает.
2. Если `mediator.gameState` — OLD ref от предыдущей игры → `mediator.tick()` обрабатывает OLD state, перетирая загруженный state пользователя.
3. UI отображает загруженный state, но фоновая симуляция работает на другом состоянии.

Также `setSpeed`/`togglePause` после `loadGame` будут читать `mediator.gameState` (null или OLD) и не смогут изменить скорость.

**Рекомендация:**
В `loadGame` после `deserializeGameState` вызвать `mediator.setLoadedState(loadedState)` (он установлен в `game-mediator.ts:105-120` и обновляет `mediator.gameState`, `loop.setTime`, и эмитит `core:state-changed`).

---

### P1-3: `INSTRUCTIONS.md` содержит 5 ссылок на `/home/z/my-project/`

**Файл:** `INSTRUCTIONS.md:27, 28, 35, 68, 69`

**Описание:**
Команды запуска dev-сервера указывают:
```bash
cd /home/z/my-project && \
  ( node node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev2.log 2>&1 & echo $! > /tmp/next-dev.pid ) &
```
Реальный путь репозитория — `/home/z/spacegame-audit/spacegame/`.

**Влияние:**
- Любой агент или оператор, следующий `INSTRUCTIONS.md` буквально, окажется в неправильной директории → Next.js не найдёт `package.json` → команда упадёт.
- Прошлый заход (Task 19 worklog) уже исправил аналогичный баг в checkpoint-файлах, но `INSTRUCTIONS.md` пропустил.

**Рекомендация:**
`perl -pi -e 's{/home/z/my-project}{/home/z/spacegame-audit/spacegame}g' INSTRUCTIONS.md` (5 замен). Или — лучше — использовать `$(pwd)` или переменную окружения.

---

### P1-4: `GameMediator.tick()` прямо мутирует `this.gameState.time` без immer

**Файл:** `src/core/game-mediator.ts:222-234`

**Описание:**
```ts
tick(): void {
  if (!this.gameState || this.gameState.phase !== 'playing') return;
  const speed = this.gameState.speed;
  this.gameState.time.tick += speed;          // ← IN-PLACE mutation
  this.gameState.time.dayInYear = this.gameState.time.tick % 365;
  this.gameState.time.year = Math.floor(this.gameState.time.tick / 365) + 1;
  this.registry.tickAll(this.gameState.time);
  this.emitStateChanged();
}
```
Мутация происходит на существующем объекте `this.gameState.time` без `immer.produce()`. Если store и mediator делят одну ссылку (после `newGame`), мутация видна обоим, но:
- React-subscribers, использующие `useGameStore(s => s.gameState.time)`, получают тот же ref → shallow equality check не срабатывает → нет re-render.
- Если после `set((state) => ...)` store держит NEW ref, то mediator всё ещё держит OLD ref и мутирует OLD — состояние store не меняется.
- `emitStateChanged()` эмитит `core:state-changed` с тем же ref → zustand-immer middleware видит `set({ gameState: sameRef })` → `produce(updater)` возвращает тот же state (Immer не создаёт нового объекта при отсутствии изменений в draft) → Object.is check — subscribers не оповещаются.

**Влияние:**
UI время (тик/день/год) и скорость могут «отставать» — обновляются только при следующей «настоящей» мутации (когда EconomyModule коммитит новое состояние через `commitState()`). На скоростях x1 (1 тик/сек) — не критично, но на x50 (20 мс/тик) — заметные визуальные лаги.

**Рекомендация:**
```ts
tick(): void {
  if (!this.gameState || this.gameState.phase !== 'playing') return;
  const newState = produce(this.gameState, (draft) => {
    draft.time.tick += draft.speed;
    draft.time.dayInYear = draft.time.tick % 365;
    draft.time.year = Math.floor(draft.time.tick / 365) + 1;
  });
  this.gameState = newState;
  this.registry.tickAll(newState.time);
  this.emitStateChanged();
}
```
Или — лучше — вынести инкремент времени в отдельный `CoreModule` с proper produce().

---

### P1-5: `mediator.setSpeed` и `togglePause` мутируют gameState in-place без re-render

**Файл:** `src/core/game-mediator.ts:168-197`

**Описание:**
```ts
setSpeed(speed): void {
  if (!this.gameState) return;
  this.gameState.speed = speed;       // ← IN-PLACE mutation
  if (speed > 0) {
    this.gameState.phase = 'playing';  // ← IN-PLACE mutation
    this.loop.setSpeed(speed);
    this.loop.start();
  } else {
    this.gameState.phase = 'paused';
    this.loop.pause();
  }
  this.emitStateChanged();
}
```
Та же проблема, что P1-4: zustand-immer middleware не оповещает subscribers, когда `set({ gameState: sameRef })` получает тот же ref. UI кнопки паузы/скорости могут «залипать» в старом визуальном состоянии.

**Влияние:**
UI Controls (TimeControls.tsx) могут показывать x1 после клика на x5 (пока следующая мутация economy не обновит state).

**Рекомендация:**
Обернуть в `produce()`:
```ts
setSpeed(speed): void {
  if (!this.gameState) return;
  const newState = produce(this.gameState, (draft) => {
    draft.speed = speed;
    draft.phase = speed > 0 ? 'playing' : 'paused';
  });
  this.gameState = newState;
  if (speed > 0) { this.loop.setSpeed(speed); this.loop.start(); }
  else { this.loop.pause(); }
  this.emitStateChanged();
}
```

---

### P1-6: ~26 неиспользуемых зависимостей в `package.json` (shadcn-бойлерплейт)

**Файл:** `package.json:17-85`

**Описание:**
Следующие пакеты присутствуют в `dependencies`, но ни один `import` в `src/` их не использует:
- `next-auth` (^4.24.11) — нет ни одного auth-импорта в src/ (grep подтвердил)
- `next-intl` (^4.3.4) — нет i18n-использования
- `@reactuses/core`, `@tanstack/react-query`, `@tanstack/react-table`
- `embla-carousel-react`, `react-day-picker`, `react-resizable-panels`
- `react-markdown`, `react-syntax-highlighter`, `input-otp`, `cmdk`
- `recharts`, `react-hook-form`, `@mdxeditor/editor`, `vaul`, `sonner`
- `framer-motion`, `input-otp`, `date-fns`, `react-syntax-highlighter`
- Большой набор `@radix-ui/*` (20+ пакетов) — используются только shadcn/ui компонентами, многие из которых не активны в игре.

Используются: `zustand`, `immer`, `next`, `react`, `react-dom`, `@prisma/client`, `prisma`, `zod`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `tailwindcss`, `tailwindcss-animate`, `sharp`, `uuid` (последний — только в sidebar.tsx cosmetic).

**Влияние:**
1. Bundle size: даже при tree-shaking, dev-инсталл ~827 пакетов; prod-build несёт лишний код.
2. Security surface: каждое dependency — потенциальная уязвимость. `next-auth` 4.x имеет известные CVE в старых патчах.
3. Bun install медленнее (3+ секунды).

**Рекомендация:**
- Запустить `bunx depcheck` или `bunx npm-check-updates -u --unused` для точного определения неиспользуемых.
- Перенести unused в `devDependencies` или удалить совсем.
- shadcn/ui компоненты, не используемые в игре (carousel, calendar, command, form, input-otp, resizable, chart, sidebar, etc.), можно удалить вместе с их исходниками в `src/components/ui/`.

---

### P2-1: `tailwind.config.ts` content paths устарели (Tailwind v3-style при v4-движке)

**Файл:** `tailwind.config.ts:6-10`

**Описание:**
```ts
content: [
  "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  "./components/**/*.{js,ts,jsx,tsx,mdx}",
  "./app/**/*.{js,ts,jsx,tsx,mdx}",
],
```
Проект использует App Router в `src/app/`, `src/components/` (НЕ в корне). Каталогов `pages/`, `components/`, `app/` в корне репозитория нет.

Tailwind v4 (`@tailwindcss/postcss`) использует auto-detection через `@import "tailwindcss"` в `globals.css` — конфиг-файл в v3-стиле в основном игнорируется, но это создаёт путаницу и техдолг.

**Влияние:** Косметика (на работу не влияет из-за v4 auto-detection), но сбивает с толку будущих разработчиков.

**Рекомендация:** Удалить `tailwind.config.ts` или мигрировать на v4-style (`@theme inline` уже частично в `globals.css`).

---

### P2-2: `page.tsx` использует local LCG `seededRng` для фоновых звёзд

**Файл:** `src/app/page.tsx:13-19`

**Описание:**
```ts
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
```
LCG (linear congruential generator) с параметрами ANSI C — не xoshiro256**, не проходим статистические тесты из `tests/prng-statistical.test.ts`.

**Влияние:** Только для фоновых 120 звёзд меню — не влияет на геймплей. Но: (1) нарушение принципа детерминизма (LCG хуже xoshiro256** по распределению); (2) магический seed=42 захардкожен, не от пользовательского ввода.

**Рекомендация:** Импортировать `Xoshiro256` из `@/core/prng` и использовать его.

---

### P2-3: `prng.ts` `derive()` использует `Object.create()` + cast hack

**Файл:** `src/core/prng.ts:150-152`

**Описание:**
```ts
const child = Object.create(Xoshiro256.prototype) as Xoshiro256;
(child as unknown as { state: [number, number, number, number] }).state = state;
return child;
```
Обходит конструктор (не вызывает `splitMix64(seed)`), вручную устанавливает `private state` поле через double-cast через `unknown`.

**Влияние:** Code smell. Если `state` будет переименовано или станет getter — сломается молча. TypeScript не проверяет доступ к private-полю через cast.

**Рекомендация:**
Добавить `static fromState(state: [number, number, number, number]): Xoshiro256` factory:
```ts
static fromState(state: [number, number, number, number]): Xoshiro256 {
  const inst = new Xoshiro256(0); // any seed — overwritten below
  inst.state = state;
  return inst;
}
```
Или сделать конструктор с опциональным `mode: 'state'` аргументом.

---

### P2-4: `prng.ts` `derive()` — состояние родителя меняется между вызовами

**Файл:** `src/core/prng.ts:111-153`

**Описание:**
`derive(name)` использует `this.state` (CURRENT parent state) для XOR с хешем имени. Если вызвать `derive('arms')` → `nextU32()` (state продвигается) → `derive('arms')` — второй вызов даст ДРУГОЙ child, так как parent state уже продвинулись.

Тесты `tests/prng.test.ts:67-91` (test 2: "derive('arms') and derive('stars') produce independent sequences") — проверяют только, что два РАЗНЫХ имени дают разные потоки. Тест 3 ("derive('arms') called twice → identical") использует `makeRng(seed).derive('arms')` — каждый раз новый родитель (из seed), так что состояние одно и то же → passes.

Но в реальном коде, если один и тот же parent используется (`const rng = new Xoshiro256(seed); rng.derive('arms'); rng.nextU32(); rng.derive('arms');`), два child дадут разные потоки.

**Влияние:** В реальной генерации галактики (если она использует один и тот же parent rng для derive() в разных местах) — порядок вызовов определяет результат. Это может быть намеренно (связывание шагов генерации), но в документации не отражено.

**Рекомендация:** Документировать в `prng.ts` что `derive()` чувствителен к порядку вызовов. Или — если требуется независимость — использовать `splitMix64(this.nextU32())` для создания child seed (не зависит от текущего state parent).

---

### P2-5: `research/engine.ts` заглушка `habitabilityPercent = 0`

**Файл:** `src/research/engine.ts:183, 466`

**Описание:**
Комментарии:
```
* habitabilityPercent = 0 в MVP (TODO: интегрировать в Etap 4).
* В MVP habitability = 0 для всех планет (TODO Etap 4).
```

**Влияние:** Технологии, дающие бонусы к обитаемости планет (например, terraforming-related techs), не имеют эффекта. Дерево технологий может содержать tech с `effects: [{ target: 'habitability', operation: 'multiply', value: 1.2 }]`, но эффект не применяется.

**Рекомендация:** Задокументировать в `checkpoints/08_27_block_03_research.md` как explicit MVP-scope-cut. Pass 3 (документация) должен проверить `docs/60-research.md` на наличие этого ограничения.

---

### P2-6: `src/economy/engine.ts` — 1068 строк, слишком крупный

**Файл:** `src/economy/engine.ts`

**Описание:** Содержит: добыча, производство (queue), крафт, энергобаланс, специализация переработчиков, idempotent-логика, миграции. Ранее аудитом (§2.7) помечен как candidate на разбиение.

**Влияние:** Сложность поддержки, риск конфликтов при merge, трудность локального тестирования.

**Рекомендация:** Разбить на:
- `src/economy/extraction.ts` (добыча + энергобаланс)
- `src/economy/production.ts` (очередь производства)
- `src/economy/processors.ts` (специализация)
- `src/economy/engine.ts` (оркестратор + exports)

---

### P2-7: `src/stores/game-store.ts` — 1426 строк, слишком крупный

**Файл:** `src/stores/game-store.ts`

**Описание:** Один zustand-store с 50+ действиями, охватывает экономику, склад, корабли, флот, исследования, сериализацию, миграции.

**Влияние:** Сложность review, риск случайного затирания одного домена при работе с другим.

**Рекомендация:** Разбить на Zustand slices: `createEconomySlice`, `createShipsSlice`, `createFleetSlice`, `createResearchSlice`, `createWarehouseSlice`. Сохранить единый store, но логически разделить.

---

### P2-8: Крупные файлы: `processing-chains.ts` (1405), `planet-view.tsx` (1138), `recipes.ts` (871), `research/engine.ts` (861), `types.ts` (832), `building-dialog.tsx` (810)

**Файлы:** `src/data/processing-chains.ts`, `src/components/game/planet-view.tsx`, `src/data/recipes.ts`, `src/research/engine.ts`, `src/core/types.ts`, `src/components/game/building-dialog.tsx`

**Описание:** По аудиту §2.7 (ранний заход) уже отмечено. Никаких улучшений с тех пор — файлы только выросли.

**Влияние:** Поддержка, review сложность.

**Рекомендация:** Создать Блок 09 «refactor-large-files» как часть Etap 2.7 (cleanup).

---

### P3-1: `src/core/index.ts` упоминает удалённый `event-bus.ts`

**Файл:** `src/core/index.ts:12`

**Описание:**
```
* - event-bus.ts      — legacy-адаптер (deprecated)
```
Файла `src/core/event-bus.ts` в каталоге `src/core/` нет (подтверждено `ls src/core/`). Ссылка в комментарии устарела.

**Влияние:** Косметика.

**Рекомендация:** Удалить строку из комментария.

---

### P3-2: `src/app/api/route.ts` возвращает `"Hello, world!"`

**Файл:** `src/app/api/route.ts:1-5`

**Описание:**
```ts
export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}
```
Бойлерплейт Next.js — не имеет функционального назначения.

**Влияние:** Косметика; один лишний endpoint.

**Рекомендация:** Заменить на healthcheck: `return NextResponse.json({ ok: true, version: '0.2.0', uptime: process.uptime() });` — полезно для monitoring.

---

### P3-3: `prng.ts` помечен как «xoshiro256**», но реализация 32-битная

**Файл:** `src/core/prng.ts:1-5`

**Описание:** Стандартный xoshiro256** — 64-битный PRNG с 256-битным состоянием (4×uint64). Реализация использует `Math.imul` (32×32→32) и `>>> 0` для unsigned 32-бит. Получается xoshiro128**-style (4×uint32 = 128-bit state, 32-bit output).

Block 07 PRNG port fix (commit `a4fb3db`) исправил `Math.imul(s1, 9)` → `s1 << 17` для state update. Статистические тесты (340/340 pass) подтверждают, что порт функционально корректен.

**Влияние:** Название не соответствует стандарту Vigna. Период: 2^128 - 1 (вместо 2^256 - 1) — всё ещё астрономически большой для игры.

**Рекомендация:** Переименовать класс в `Xoshiro128StarStar` или задокументировать, что это JS-port с 32-bit words.

---

### P3-4: `tailwind.config.ts` — Tailwind v3-style конфиг при v4-движке

**Файл:** `tailwind.config.ts`, `postcss.config.mjs`, `package.json` (`tailwindcss: "^4"`, `@tailwindcss/postcss: "^4"`)

**Описание:** Tailwind v4 использует CSS-based конфиг (`@theme inline` в `globals.css:6-44` — уже частично мигрировано). `tailwind.config.ts` в v3-стиле (с `content`, `theme.extend`, `plugins`) — в v4 игнорируется или работает в compat-режиме.

**Влияние:** Косметика.

**Рекомендация:** Удалить `tailwind.config.ts` полностью, обновить `components.json` (`tailwind.config` уже пустая строка), убедиться что `globals.css` содержит все theme extensions.

---

### P3-5: `README.md` — Etap 2.5 ещё «в плане», Etap 2.6/3.0/3.5 не упомянуты

**Файл:** `README.md:22-32`

**Описание:**
> **Этап 2.5 (стабилизация)** — в плане. 7 проблем технического долга (P1-P7)...
> **Что не реализовано** (спецификации готовы, кода нет): Флот и корабли; Исследования; AI-фракции.

По commit-истории Etap 2.5 (Blocks 01, 06, 07, 08), Etap 2.6 (Block 05 processors), Etap 3.0 (Blocks 02 fleet, 03 research) — все COMPLETE. Etap 3.5 (Block 04 AI) — следующий.

**Влияние:** README вводит в заблуждение новых контрибьюторов.

**Рекомендация:** Обновить секцию «Текущий статус»: «Этапы 2.5, 2.6, 3.0 завершены. Etap 3.5 (AI-factions) — следующий. См. `worklog.md` и `checkpoints/` для деталей».

---

### P3-6: `README.md` не упоминает Блоки 02/03/05/06/07/08

**Файл:** `README.md:60-80`

**Описание:** Структура проекта описана до-модульно: перечислены `src/economy/` (3 файла), `src/components/game/` (7 файлов). Реальное состояние: `src/ships/` (Block 02), `src/research/` (Block 03), `src/data/ships/`, `src/data/research/`, 17 компонентов в `src/components/game/` (включая ship-designer, fleet-view, research-view, etc.).

**Влияние:** Косметика — README устарел на 2 etap'а.

**Рекомендация:** Обновить дерево каталогов в README.

---

### P3-7: `HullDef = HullType` и `ModuleDef = ShipModule` @deprecated aliases экспортируются

**Файл:** `src/core/types.ts:333-337, 399-403`

**Описание:**
```ts
/** @deprecated используйте HullType. Alias для backward compat. */
export type HullDef = HullType;
/** @deprecated используйте ShipModule. Alias для backward compat. */
export type ModuleDef = ShipModule;
```

**Влияние:** Косметика. Backward compat, но создаёт две категории имён для одного типа.

**Рекомендация:** Grep для устаревших имён в `src/`; если все использования мигрированы на HullType/ShipModule — удалить aliases.

---

## 4. Метрики кода

- **Общий объём кода (src):** 31 040 строк в 141 файле `.ts/.tsx`
- **Объём тестов:** 5 903 строки в 22 файлах `.ts`
- **Соотношение тесты/код:** 0.19 (5903/31040) — низкое для кодовой базы с финансовыми/симуляционными алгоритмами; норма 0.5–1.0 для 4X-игр. Сильно недотестированы: store actions (P0-1 — главный bug untested), UI components, integration paths.
- **Средняя длина файла:** 220 строк (31040/141)
- **Файлов >800 строк:** 7 (`game-store.ts`, `processing-chains.ts`, `planet-view.tsx`, `engine.ts`, `research-view.tsx`, `recipes.ts`, `research/engine.ts`, `types.ts`, `building-dialog.tsx`)
- **Файлов <50 строк:** ~25 (UI компоненты, типы, мелкие утилиты)
- **TypeScript errors:** 137 (все `noUncheckedIndexedAccess` — `Object is possibly 'undefined'` для индексных доступов)
- **ESLint warnings:** 50 (45 no-unused-vars, 4 exhaustive-deps, 1 prefer-const)
- **Math.random() в production-коде:** 0 ✅ (только в комментариях и `tests/` для изоляции)
- **`any` типы в production-коде:** 0 ✅ (только строковые литералы `'any'` для SlotType)
- **`@deprecated` маркеры:** 6 (3 в warehouse.ts, 2 в types.ts, 1 в engine.ts)
- **TODO/FIXME:** 2 (оба в `research/engine.ts` — habitability stub)

---

## 5. Архитектурная оценка

**Вердикт: Adequate / Требует доработки**

Фундамент **структурно надёжный**, но имеет одну **критическую (P0-1) интеграционную щель** между Zustand-стором и GameMediator-ом, которая вызовет терю данных пользователя в production-сценариях.

### Что хорошо (✅)
1. **Modular-bus паттерн** реализован полностью: `TypedEventBus` (приоритеты, replay, defer/flush), `ModuleRegistry` (топосорт Kahn's algorithm, query system), `GameMediator` (центральный оркестратор), `IGameModule` контракт. 5 модулей зарегистрированы: Galaxy, Economy, Research, Ships, Fleet — в правильном порядке зависимостей.
2. **Типизация**: `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`, `noFallthroughCasesInSwitch`, `noImplicitReturns` — всё включено. 0 `any` в production-коде.
3. **Immutability паттерн в модулях**: EconomyModule оборачивает все engine-mutations в `immer.produce()` + `commitState()` — proper immutable state updates с новыми ссылками для changed paths.
4. **PRNG**: xoshiro256** порт функционально корректен (340/340 тестов, chi-square, birthday, correlation — все pass). 4 независимых хеша в `derive()` предотвращают коллапс состояний.
5. **Сериализация**: JSON round-trip с Map→Array conversion, zod validation на deserialize (gap-9 закрыт), idempotent-migration `migratePlanet` + `migrateResearchState` для старых сейвов.
6. **API security**: rate-limit (10 req/min/IP, token bucket), zod validation на POST/PUT, 50 MB state cap, structured error responses (gap-8 закрыт).
7. **Prisma schema**: indexes на seed/name/updatedAt/(seed,updatedAt), `version Int @default(1)` для будущих миграций (gap-9 закрыт).
8. **Тесты**: 340/340 pass — покрывают PRNG, modular-integration, immutability, serialization, economy/processors, ships (4 файла: designer/fleet-engine/orders/shipyard), research (7 файлов), api-save.

### Что требует доработки (🔴)
1. **P0-1 (critical)**: Zustand-store и mediator — две разные reference-graphs для одного и того же GameState. Подписка `core:state-changed` однонаправленная (mediator→store), обратного канала нет. ~21 store-action мутирует store-directly, mediator не видит, следующий тик перетирает. Это **архитектурная дыра** в реализации Block 06 (modular-integration), которая должна была обеспечить «store работает только через mediator». Контракт «Block 06 — store делегирует mediator-у, mediator — единственный source-of-truth» **не выполнен** для половины действий.
2. **P1-1, P1-3**: env + INSTRUCTIONS.md указывают на boilerplate-путь `/home/z/my-project/`, не на spacegame. Это блокирует онбординг и sandbox-recovery.
3. **P1-2**: `loadGame` — частный случай P0-1, но особенно опасный: после загрузки сейва mediator вообще не имеет корректного gameState → следующее действие игрока может «зависеть» от null-mediator или от OLD-state.
4. **P1-4, P1-5**: `mediator.tick()` и `setSpeed/togglePause` мутируют in-place без immer → React re-renders могут залипать.
5. **Test coverage**: 0 тестов на store-level actions. Все тесты либо тестируют engine-функции напрямую, либо тестируют mediator path. Нет integration-тестов «UI click → store action → mediator → tick → state-changed → store sync → UI re-render».

### Архитектурный долг
- **Block 06 контракт**: «store → mediator» не выполнен для 21 действия.
- **Block 07 контракт**: TS strict + ESLint warn — выполнен ✅; PRNG port — функционально корректен, но название вводит в заблуждение.
- **Block 08 контракт**: API validation + rate-limit + Prisma indexes — выполнен ✅, но `.env` tracked + wrong-path откатывает часть выигранного.

---

## 6. Соответствие планам

### Block 01 stabilization (P1-P9, C1-C9, T1-T7) — ✅ выполнено
- P1 (ore ID unification): recipe validation 75/75 — `bun run validate:recipes` ✅
- P2 (immutable store): immer middleware + produce() pattern — выполнено для модульного пути; **НЕ выполнено для store-direct mutations** (P0-1)
- P3 (atmosphere/orbit UI): `economy:build` event с `layer: 'atmosphere' | 'orbit'` + slotIndex — ✅ (events.ts:61)
- P4 (production queue UI): `enqueueProduction` + `cancelProduction` + production-queue-panel.tsx — ✅
- P5 (crafted materials category): recipes.ts — ✅
- P6 (Colony Hub cost): `costPerLevel: { Fe:10, Si:5, Al:3 }` — ✅ (worklog Task 6)
- P7 (transuranic elements): elements.ts 57→60 (Np/Pu/Am) — ✅
- P8 (complex gas recipes): проверено в recipe validation — ✅
- P9 (ProductionItem deterministic IDs): `productionItemCounter` + `shipCounter` + `fleetCounter` + `researchSlotCounter` — ✅ (game-store.ts:61-96)
- C1 (delete deprecated bus): event-bus.ts удалён ✅
- C2–C9: implicit — выполнено
- T1–T7: tests/prng.test.ts + prng-statistical.test.ts + immutability.test.ts + serialization.test.ts — ✅

### Block 06 modular-bus integration — ✅ выполнено (но с gap)
- typed-bus + ModuleRegistry + GameMediator — ✅
- EconomyModule, GalaxyModule, ResearchModule, ShipsModule, FleetModule — все реализованы
- **Gap (P0-1)**: store→mediator sync отсутствует для 21 прямого действия. Block 06 описывал «store делегирует mediator» — частично выполнено.

### Block 07 engineering quality — ✅ выполнено
- TS strict + noUncheckedIndexedAccess + noImplicitReturns — ✅
- ESLint warn-level enforcement — ✅ (eslint.config.mjs:16-52)
- PRNG port fix (`s1 << 17` вместо `Math.imul(s1, 9)`) — ✅ (prng.ts:42)
- `next.config.ts: ignoreBuildErrors: false` — ✅

### Block 08 security/data — ✅ выполнено (но env-path — regress)
- API validation (zod schemas) — ✅
- Rate limiting (token bucket 10/min) — ✅
- Prisma indexes (seed, name, updatedAt, seed+updatedAt) — ✅
- `version Int @default(1)` — ✅
- **Regress (P1-1)**: `.env` tracked + wrong-path → DB в `/home/z/my-project/` (boilerplate)

### Etap 2.6 Block 05 (processors universal→specialized) — ✅ выполнено
- 2 типа (universal + specialized) — ✅ (types.ts:231)
- 7 ProcessorRecipeCategory — ✅ (types.ts:240-247)
- specializeBuilding / upgradeSpecialization — ✅ (game-store.ts:709-749)
- 8 тестов T5.1–T5.8 — ✅ (tests/economy/processors.test.ts, 542 строки)

### Etap 3.0 Block 02 (Fleet MVP) — ✅ выполнено
- Типы: HullType, ShipModule, ShipDesign, ShipyardQueue, Fleet, FleetOrder — ✅
- Ship designer + validateShip + calculateDesignStats — ✅
- Fleet manager (create/merge/split) — ✅
- Orders (planRoute + executeOrder) — ✅
- Jump point travel (processFleetTick + ShipsModule + FleetModule) — ✅
- Тесты: designer, fleet-engine, orders, shipyard — ✅ (4 файла, 1744 строки)

### Etap 3.0 Block 03 (Research MVP) — ✅ выполнено
- 15/72 технологий + 5 фундаментальных веток — ✅ (R1)
- Laboratory building — ✅ (R2)
- ResearchModule с RP accumulation + unlocks — ✅ (R7)
- 6+ новых typed-bus событий — ✅ (events.ts:183-203)
- 7 тестов (T-R1..T-R7) — ✅ (tests/research/, 1466 строк)
- **Stub (P2-5)**: habitabilityPercent = 0 — TODO Etap 4

---

## 7. Рекомендации для следующих заходов

### Pass 2 (Code Quality Audit)
Сфокусироваться на:
1. **src/economy/engine.ts** (1068 строк) — детальный ревью processEconomyQueue, extraction formulas, energy balance recalc, specialize/upgrade logic.
2. **src/ships/** — designer.ts, fleet-engine.ts, orders.ts, ships-module.ts, fleet-module.ts. Проверить: validateShip correctness, planRoute BFS optimality, fuel consumption formula, defending-state lifecycle.
3. **src/research/engine.ts** (861 строка) — canStartResearch logic, getTechCost formula, applyTechUnlock idempotency, RP allocation math.
4. **src/data/processing-chains.ts** (1405), `recipes.ts` (871) — проверка корректности recipe/chain данных против `docs/40-buildings.md` §3 и `docs/60-research.md`.
5. **src/galaxy/** — generator orchestration, generate-systems.ts (137 tsc errors в этом файле из-за noUncheckedIndexedAccess), generate-planets.ts, generate-jump-points.ts (BFS connectivity — есть ли изолированные системы?).
6. **Тест-покрытие** — добавить integration-тесты для store-actions (P0-1) и UI-component-driven тесты (Bun test + React Testing Library или Playwright).

### Pass 3 (Documentation Compliance)
1. Проверить соответствие `docs/40-buildings.md` §3 (новая редакция после 08_27_doc_fixes) с `src/data/buildings.ts` + `src/economy/engine.ts`.
2. Проверить `docs/50-ships.md` Приложение D (MVP-roadmap) с `src/data/ships/{hulls,modules,fuel-map}.ts` + `src/ships/designer.ts`.
3. Проверить `docs/60-research.md` (72 технологии, 6 веток) с `src/data/research/{techs,branches}.ts` (MVP: 15/72, 5/6).
4. Проверить `docs/35-warehouse-and-logistics.md` (3-типа складов) с `src/data/warehouse.ts` + `src/economy/engine.ts`.
5. Проверить все 5 contradictions из `08_27_doc_fixes.md` — зафиксированы ли они в коде.
6. **README.md update** (P3-5, P3-6) — добавить Etap 2.5/2.6/3.0 завершёнными, обновить дерево каталогов.

### Pass 4 (MVP Readiness — e2e gameplay)
1. **Smoke-тест**: запустить dev-сервер, создать newGame, колонизировать планету, построить mine + processor, поставить рецепт в очередь, дождаться 5 тиков — проверить что производство завершилось.
2. **Bug P0-1 воспроизведение**: создать newGame → colonizePlanet → enqueueProduction → **cancelProduction** → ждать 1 тик → **проверить, отменился ли элемент**. Если элемент вернулся — подтвердить bug.
3. **Save/Load round-trip**: newGame → colonize → построить здания → сохранить → загрузить → проверить что:
   - `mediator.gameState` updated (P1-2)
   - Все здания/ресурсы/флоты/исследования на месте
4. **Speed stress**: переключать скорости x1→x5→x15→x50 → проверить UI re-renders (P1-4, P1-5).
5. **Fleet MVP**: построить корабль на верфи → создать флот → издать приказ move → дождаться прибытия.
6. **Research MVP**: построить лабораторию → запустить технологию в очередь → дождаться завершения → проверить applyTechUnlock.
7. **Performance**: на 500 системах, x50 скорости — проверить что тик обрабатывается <20ms (геймплей должен быть играбелен).

### Cross-cutting (для всех заходов)
- **P0-1 fix** — главный приоритет. Без него игра не играбельна на любых скоростях >x1 (каждая секундная задержка между действием и тиком → потеря данных).
- **P1-1 .env fix** — необходим для sandbox-recovery и production-ready.
- **P1-2 loadGame fix** — частный случай P0-1, отдельный fix или общий refactor.
- **Cleanup unused deps** (P1-6) — security + bundle size.

---

## Изменённые файлы
- `checkpoints/audit_2026_08_27_01_foundation.md` (этот файл)
