# Audit Pass 5 — UX-правки пользователя «новый день» (2026-08-28)

**Дата:** 2026-08-28 15:21 MSK (пт)
**Контекст:** После аудита Passes 1–4 (см. `08_27_audit_01..04_*.md`)
пользователь сообщил пакет конкретных UX-проблем в реальной игре. Этот
чекпоинт фиксирует их в кодовой базе.

---

## 1. Корневые причины (audit findings)

### 1.1. Seed галактики «прыгал» каждые 20-30 секунд
- **Симптом:** При возврате в главное меню и обратно в игру seed менялся.
- **Причина:** В `src/app/page.tsx` seed хранился в локальном `useState`
  с lazy-инициализатором `useState(() => Math.random()...)`. React
  перевычисляет его при каждом перемонтировании `Home` (выход в меню +
  возврат в игру), что при активной игре происходит часто (раз в 20-30 с).
- **Доп. фактор:** В `game-layout.tsx:153` кнопка «New Game» вызывала
  `newGame()` без аргументов → `newGame` брал `DEFAULT_CONFIG.seed = 42`
  (детерминированно). Тоже не идеально.

### 1.2. Кнопка случайного сида залита белым
- **Причина:** В `page.tsx` использовался `variant="outline"` из shadcn
  Button. На тёмном фоне `bg-[#060614]` CSS-переменная `--background`
  в светлой теме = белый → кнопка выглядела белым прямоугольником.

### 1.3. Генератор: немонотонные орбитальные радиусы
- **Симптом:** Epsilon Tauri IV имел больший период оборота, чем
  Epsilon Tauri V, хотя был ближе к звезде (нарушение 3-го закона Кеплера).
- **Причина:** В `src/galaxy/generate-planets.ts` формула
  `orbitalScale * (0.3 + orbit * (0.5 + rng.nextFloat() * 0.3))`
  использовала независимый `rng.nextFloat()` для каждой планеты →
  диапазоны соседних орбит перекрывались (orbit=4 мог дать 3.5,
  orbit=5 — 2.8). При меньшем r → меньший P = √(r³/M), отсюда P5 < P4.
- **Доп. симптом:** орбиты 8 и 9 тоже могли быть «перепутаны».

### 1.4. Газовый гигант с gravity 0.7G (нереалистично)
- **Симптом:** Газовый гигант показывал 0.7G — слишком мало для ГГ.
- **Причина:** В `src/data/planet-types.ts` плотность ГГ имела
  диапазон `0.3-1.6` г/см³. При радиусе 38000 км и плотности 0.3:
  `g = (38000/6371) × (0.3/5.51) = 0.32G` — физически невозможно
  (Сатурн = 1.07G, Уран = 0.89G, минимум для ГГ ≈ 0.7G).

### 1.5. Нет генерации лун для газовых гигантов
- В Солнечной системе: Jupiter=95, Saturn=146, Uranus=28, Neptune=16.
- В игре у газовых гигантов не было ни одной луны — пробел в реализации.

### 1.6. Прокрутка в панели построек отсутствует
- **Симптом:** Из-за отсутствия видимой прокрутки пользователь не мог
  построить «переработчик» (ниже видимой области списка зданий).
- **Причина:** `BuildList` уже имел `max-h-[55vh] overflow-y-auto pr-2
  custom-scrollbar`, но `.custom-scrollbar` в `globals.css` делал
  скроллбар невидимым (`rgba(255,255,255,0.18)`, ширина 8px, overlay).

### 1.7. Склад: чёрный текст на тёмно-синем фоне
- **Симптом:** Текст хранимых ресурсов во вкладке «Склад» не виден.
- **Причина:** `ResourcePanel` использовал `text-foreground/90` и
  `text-muted-foreground` из shadcn. В светлой теме `--foreground` =
  чёрный → на тёмно-синем фоне вкладки «Склад» (Sheet `bg-[#0d0d24]`)
  текст был невидим.
- **Доп. фактор:** В `WarehousePanel` (planet-view.tsx) приоритеты и
  minimum-резервы использовали `text-slate-600/700` — тоже невидно.

### 1.8. Стартовый склад переполняется (1623/1110)
- **Симптом:** Сразу на старте склад переполнен, ресурсы теряются.
- **Причина:** В `src/data/warehouse.ts` базы:
  `ORE_WAREHOUSE_BASE=1000 + PROCESSED_WAREHOUSE_BASE=100 +
  HIGH_TECH_STORAGE_BASE=10 = 1110`. Этого мало для нормального старта.
- **Доп. фактор:** `createDefaultWarehouse()` устанавливал
  `totalCapacity: PROCESSED_WAREHOUSE_BASE` (= 100) — становилось
  правильным только после первого tick (`engine.ts:538` пересчитывал
  в сумму). До первого tick — переполнение.

### 1.9. Не показано количество гексов на планете
- В planet-view не отображалось, сколько гексов на выбранной планете.
- Также не показывались орбитальный радиус и период.

### 1.10. Research-view — не было дерева с рёбрами
- Технологии показывались карточками по 5 веткам, но без визуальных
  рёбер между пререквизитами. Пользователь хотел «лежачее дерево» с
  плавными соединительными линиями и прокруткой вправо.

---

## 2. Внесённые правки (по задачам)

### Task 1 — Остановка DEV (✅)
- Системная дата: 2026-08-28 15:21 MSK.
- `pkill -f 'next dev'` + проверка `lsof -ti :3000` → порт свободен.
- DEV не запускался во время кодинга (по требованию пользователя).

### Task 2 — Seed в Zustand store (✅)
- `src/stores/game-store.ts`:
  - Добавлено поле `galaxySeed: number` в интерфейс `GameStore`.
  - Инициализируется один раз при создании store через
    `Math.floor(Math.random() * 1_000_000) + 1`.
  - Добавлено действие `rollGalaxySeed: ()` для кнопки «кости».
  - В `newGame(config = {})`: если `config.seed` не передан, использует
    `get().galaxySeed` (а не DEFAULT_CONFIG.seed = 42).
- `src/app/page.tsx`:
  - Убран локальный `useState` для seed.
  - Используются `galaxySeed` и `rollGalaxySeed` из store.
  - Ручной ввод seed → `useGameStore.setState({ galaxySeed: v })`.
  - Кнопка «кости»: `variant="ghost"` (вместо `outline`) + явные классы
    `bg-black/40 border border-white/10 text-cyan-300
    hover:bg-cyan-500/10 hover:border-cyan-500/40 hover:text-cyan-200`.
  - Текст-подсказка расширен: «Нажмите на иконку кубика, чтобы
    перебросить seed».

### Task 3 — Аудит и фикс генератора (✅)

#### 3.1. Монотонные орбитальные радиусы
- `src/galaxy/generate-planets.ts`:
  - Прежняя формула заменена на:
    `orbitalRadius = orbitalScale * (0.3 + (orbit - 1) * 0.5 + jitter)`,
    где `jitter = rng.nextFloat() * 0.25` (строго меньше шага 0.5).
  - Гарантирует `r[orbit+1] - r[orbit] ∈ [0.25, 0.75] > 0`.
  - Соответствует эмпирике: Меркурий 0.39, Венера 0.72, Земля 1.0,
    Марс 1.52 AU (шаги 0.3-0.5 AU для внутренних).
  - Орбитальный период `P = √(r³/M)` теперь строго возрастает с orbit.

#### 3.2. Реалистичная гравитация газовых гигантов
- `src/data/planet-types.ts`:
  - `PLANET_DENSITY.gas_giant`: `0.3-1.6` → `1.0-1.8` (avg 1.0→1.4).
    Покрытие: Saturn=0.69 (теперь исключён, минимум Уран-класс 1.27),
    Jupiter=1.33, Neptune=1.64.
  - `PLANET_TYPE_RADIUS.gas_giant`: `38000-90000` → `25000-80000`.
    Теперь включает ледяных гигантов (Уран=25362, Нептун=24622).
  - Минимальная gravity = (25000/6371) × (1.0/5.51) = 0.71G (Уран).

#### 3.3. Луны газовых гигантов
- `src/core/types.ts`:
  - Добавлен интерфейс `Moon` (id, systemId, planetId, name, type
    rocky/ice/dwarf, size, radiusKm, density, gravity, orbitRadiusKm,
    orbitPeriodDays, hexes, resourceDeposits, owner).
  - Добавлено поле `moons: Moon[]` в интерфейс `Planet`.
- `src/data/planet-types.ts`:
  - `GAS_GIANT_MOON_COUNT = { min: 2, max: 7 }` (MVP-представление).
  - `MOON_RADIUS = { min: 250, max: 3500 }` км (Энцелад=252, Ганимед=2634).
  - `MOON_DENSITY` по типам (rocky 2.5-3.5, ice 1.0-1.9, dwarf 1.5-2.5).
  - `MOON_ORBIT_RADIUS_KM = { min: 80000, max: 3000000 }`.
  - `MOON_TYPE_WEIGHTS` (rocky 35, ice 45, dwarf 20).
- `src/galaxy/generate-planets.ts`:
  - Добавлена функция `generateMoons(systemId, planetId, planetName,
    orbit, rng)`.
  - Генерирует 2-7 лун для газовых гигантов.
  - Строгая монотонность орбит лун вокруг планеты (детерминированный
    шаг + jitter 0.4× шага).
  - Орбитальный период: `P = 1.77 × (a/421700)^(3/2)` дней
    (относительно Ио Юпитера, a=421700 км, P=1.77 дн).
  - Каждая луна получает гекс-сетку (для будущей колонизации) и
    ресурсные залежи.
  - Имя: «Epsilon Tauri IV-a», «...-b», и т.д.

### Task 4 — Research-view как дерево (✅, делегирован subagent)
- `src/components/game/research-view.tsx`:
  - SVG `<defs>` с двумя `<marker>` для стрелочек (met/unmet prereq).
  - Цвет ребра = цвет ветки-источника (BRANCH_COLORS[fromTech.branch]).
  - Met-рёбра: яркие (source color, opacity 0.85, strokeWidth 2.2, solid).
  - Unmet-рёбра: тусклые (`#475569` slate-600, opacity 0.55,
    strokeWidth 1.2, dashed `5 4`).
  - Минимальная ширина 1264px → гарантированная горизонтальная
    прокрутка вправо (`overflow-x-auto custom-scrollbar`).
  - Константы подправлены (NODE_W 188→200, COL_GAP 76→88,
    BRANCH_GAP 22→26) для читаемости.

### Task 5 — Явная прокрутка в панели построек (✅)
- `src/app/globals.css`:
  - `.custom-scrollbar`: `scrollbar-width: auto` (вместо `thin`),
    цвет `rgba(34, 211, 238, 0.55)` (cyan), ширина 10px.
  - Track: `rgba(255,255,255,0.04)` (слегка заметный фон).
  - Thumb-hover: opacity 0.75 (более яркий).
  - Всегда видим (non-overlay) — пользователь сразу видит, что
    список прокручивается, и может построить «переработчик».

### Task 6 — Светлый текст в складе (✅)
- `src/components/game/resource-panel.tsx`:
  - `text-muted-foreground` → `text-slate-400` (для названий).
  - `text-foreground/90` → `text-white/95` (для значений).
  - `text-foreground/70` → `text-slate-200` (для символов).
  - Fleet fuel: `text-cyan-400/70` → `text-cyan-300` (ярче).
- `src/components/game/planet-view.tsx` (`WarehousePanel`):
  - `text-slate-400/500/600/700` → `text-slate-300/400/500` (осветлены).

### Task 7 — Гексы и луны в отображении планеты (✅)
- `src/components/game/planet-view.tsx`:
  - Импортированы `SIZE_HEX_COUNT` и `Globe` (lucide-react).
  - В compact planet info добавлены строки:
    - «Орбита»: `{orbitalRadius} а.е. • {orbitalPeriod} дн.`
    - «Поверхность»: `{hexes.length} гексов ({SIZE_HEX_COUNT[size]} на
      размер «{SIZE_NAMES[size]}»)` — или «Газовый гигант (без гексов)».
  - Блок «Луны газового гиганта (N)»: для каждого спутника имя +
    `{TYPE_NAMES[type]} • {radiusKm}км • {gravity}g • {hexes.length} гекс`.

### Task 8 — Стартовый склад 10000 (✅)
- `src/data/warehouse.ts`:
  - `ORE_WAREHOUSE_BASE`: 1000 → 5000 (+5 млрд т).
  - `PROCESSED_WAREHOUSE_BASE`: 100 → 3500 (+35×, до 3.5 млрд т).
  - `HIGH_TECH_STORAGE_BASE`: 10 → 1500 (+150×, до 1.5 млрд т).
  - `TOTAL = 10000` (точно, как просил пользователь).
  - Per-level бонусы пропорционально (×5/×35/×150):
    `ORE_WAREHOUSE_PER_LEVEL = 1250`, `PROCESSED_PER_LEVEL = 875`,
    `HIGH_TECH_PER_LEVEL = 375`.
  - `BASE_CAPACITY` (legacy) = 10000, `WAREHOUSE_PER_LEVEL` = 2500
    (для обратной совместимости).
  - `createDefaultWarehouse()`: `totalCapacity = ORE + PROCESSED +
    HIGH_TECH = 10000` (раньше был `PROCESSED_WAREHOUSE_BASE = 100`,
    что вызывало переполнение до первого tick).

---

## 3. Качество (post-fix checks)

| Метрика              | Baseline | После правок | Δ        |
|---------------------|----------|-------------|----------|
| Lint errors         | 0        | 0           | 0        |
| Lint warnings      | 50       | 49          | -1       |
| `bunx tsc --noEmit` (src/) | 138 | 138         | 0        |
| `bun test` pass     | 340/340  | 340/340     | 0        |
| `bun run validate:recipes` | 75/75 | 75/75 | 0        |

Все baseline-метрики сохранены. Новых ошибок типов не добавлено.
Все тесты проходят. Рецепты валидны.

---

## 4. Файлы, изменённые в этом заходе

- `src/core/types.ts` — добавлен интерфейс `Moon`, поле `moons` в `Planet`.
- `src/data/planet-types.ts` — обновлены `PLANET_DENSITY` /
  `PLANET_TYPE_RADIUS` для `gas_giant`; добавлены константы лун.
- `src/galaxy/generate-planets.ts` — фикс формулы `orbitalRadius`;
  добавлена `generateMoons()`.
- `src/data/warehouse.ts` — увеличены базы складов; `createDefaultWarehouse`
  считает `totalCapacity` как сумму.
- `src/stores/game-store.ts` — добавлены `galaxySeed` + `rollGalaxySeed`;
  `newGame` использует `galaxySeed` по умолчанию.
- `src/app/page.tsx` — seed в store (не в useState); кнопка «кости»
  `variant="ghost"` + явные классы; ручной ввод через `setState`.
- `src/app/globals.css` — `.custom-scrollbar` видимый (cyan, 10px, auto).
- `src/components/game/resource-panel.tsx` — светлый текст на тёмном фоне.
- `src/components/game/planet-view.tsx` — добавлены Орбита / Поверхность /
  Луны в compact info; осветлены `text-slate-600/700` в `WarehousePanel`.
- `src/components/game/research-view.tsx` — SVG markers + met/unmet рёбра
  + min width 1264px для горизонтальной прокрутки.

---

## 5. Нерешённое / будущее

- **Block 04 (AI/противники):** остаётся отложенным по решению владельца.
- **Колонизация лун:** луны имеют гекс-сетку, но UI не даёт их
  колонизировать (только информационная панель). Будущее расширение.
- **Аудит генератора вглубь:** проведён только для жалоб пользователя
  (монотонность орбит, ГГ gravity, луны). Др. аспекты (массы звёзд,
  альбедо, парник) — из прошлых Passes 1-4, не трогались.
