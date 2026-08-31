# SpaceGame

> Однопользовательская космическая 4X-стратегия / песочница в реальном времени

## О проекте

SpaceGame — однопользовательская космическая стратегия, вдохновлённая **«Полдень XXI века»** и **Aurora 4X**. Исследуйте процедурно генерируемую галактику, колонизируйте планеты, проектируйте корабли, ведите дипломатию с AI-фракциями и достигайте победы — научной, экономической, военной или дипломатической.

### Ключевые особенности

- **Процедурная галактика** — 500 звёздных систем (параметризуемо до 2000), спиральная структура, уникальных при каждом seed
- **Физически корректная генерация** — закон Стефана-Больцмана для температуры звёзд, обитаемая зона Kopparapu (2013), гравитация через радиус×плотность
- **Глубокая колонизация** — гексагональная сетка застройки (19/37/61/91/127 гексов), бонусы местности, 8 типов атмосферы, 5 уровней жизни
- **Химически обоснованная экономика** — 60 элементов (57 базовых + 3 трансурановых Np/Pu/Am) с химическими характерами, автогенерация ~56 руд через BakedGalaxyModel, молярные расчёты
- **Многоуровневый крафт** — руда → элемент → материал → компонент → модуль → корабль
- **Модульная архитектура** — TypedEventBus с приоритетами и replay, ModuleRegistry с топологической сортировкой, GameMediator
- **Управление временем** — пауза, x1/x5/x15/x50, отдача приказов во время паузы

## 📋 Документы процесса (обязательны к прочтению при старте сессии)

> **Правило владельца (2026-08-31):** при холодном старте агент обязан сначала прочитать связанные
> документы и только потом создавать файлы. Порядок: хвост `worklog.md` (последние записи) →
> последний план в `plans/` → таблица ниже.

| Документ | Назначение |
|----------|------------|
| [`checkpoints/RULES.md`](./checkpoints/RULES.md) | ⚠️ **Правила чекпоинтов**: формат имени `ММ_ДД_цель.md`, структура файла, статусы. Все новые файлы в `checkpoints/` — ТОЛЬКО по этим правилам |
| [`plans/README.md`](./plans/README.md) | Протокол планов работ: Task ID, чеклисты с `[x]`, восстановление после сбоя |
| [`worklog.md`](./worklog.md) | Append-only журнал всех задач (Task ID → шаги → результат). Не переписывать, только дополнять в конец |
| [`checkpoints/ROADMAP.md`](./checkpoints/ROADMAP.md) | Глобальная дорожная карта этапов с чекпоинтами |
| [`docs/!listing.md`](./docs/!listing.md) | Индекс всей документации (токены, порядок чтения) |
| [`docs/STATUS.md`](./docs/STATUS.md) | Актуальный статус реализации: сделано / в плане / блокирует |

## Текущий статус

**Этапы 2 / 2.5 / 2.6 / 3.0 завершены. Data-driven экстракция каталогов завершена: R-BLD-MOD, R-RES, R-SHIPS-DATA (2026-08-28) + R-STARS-DATA = Etap 4.1 (2026-08-31).** Работающий MVP: генерация галактики (data-driven звёздный каталог), колонизация, гексовая застройка с **типовой синергией v2** (7 правил; R-27: кластеры ЭС + кросс-типовые шахта/склад → переработчик), **авто-переработка базовых строительных руд + газовый склад v3.1 + принуждение резервов** (R-27), реальный расчёт энергии P1-26 (R-23/R-24), понижение уровня и снос зданий с подтверждением, добыча, крафт, флот, исследования (накопительная + потоковая ветки, R-SPLIT), сохранение/загрузка. **555/555 тестов**, 4 валидатора каталогов зелёные, lint: 0 errors.

**Кандидат на следующий этап — Etap 4.2 (планетарный каталог, data-driven; рекомендация аудита Pass 9).** AI-фракции (3.5) — после пересмотра порядка этапов. Полная информация: [`docs/STATUS.md`](./docs/STATUS.md) + [`docs/data-driven-architecture.md`](./docs/data-driven-architecture.md). Аудит-чейн: `checkpoints/08_27_audit_0{1..4}_*.md` → `08_28_audit_0{5..9}_*.md` → `08_31_audit_1{0,1}_*.md`.

**Что не реализовано** (спецификации готовы, кода нет):
- AI-фракции ([`docs/70-ai.md`](./docs/70-ai.md))
- Боевая система (Etap 4+)
- Терраформирование (Etap 4+)

## Структура проекта

```
spacegame/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Главная (New Game / Load Game)
│   │   ├── layout.tsx          # Root layout
│   │   ├── globals.css         # Глобальные стили (тёмная тема)
│   │   └── api/save/           # API сохранений (GET/POST/PUT/DELETE)
│   │
│   ├── core/                   # Ядро движка (9 файлов, чистый TS)
│   │   ├── types.ts            # Все типы и интерфейсы игры
│   │   ├── prng.ts             # PRNG xoshiro256** (детерминированный)
│   │   ├── typed-event-bus.ts  # Типизированная шина (приоритеты, replay)
│   │   ├── events.ts           # Каталог 60+ событий
│   │   ├── module-types.ts     # IGameModule, ModuleManifest
│   │   ├── module-registry.ts  # Реестр модулей с топосортом
│   │   ├── game-mediator.ts    # Центральный оркестратор
│   │   ├── game-loop.ts        # Тиковая система
│   │   └── index.ts            # Реэкспорты
│   │
│   ├── data/                   # Справочные данные (17 файлов + 3 подкаталога)
│   │   ├── elements.ts         # 60 элементов (57 базовых + 3 трансурановых)
│   │   ├── buildings.ts        # 15 зданий (colony_hub, mine, processor...)
│   │   ├── recipes.ts          # ~75 рецептов крафта
│   │   ├── processing-chains.ts # Цепочки руд (атмосфера/лёд/самородки)
│   │   ├── chemistry-generator.ts # Реэкспорт-шим (30 строк; ~1700 строк в src/data/chemistry/)
│   │   ├── baked-lookups.ts    # Lookup-структуры (синглтон)
│   │   ├── element-helpers.ts  # CATEGORY_LABELS, CATEGORY_COLORS
│   │   ├── crafted-materials.ts # steel, microchip, etc.
│   │   ├── atmosphere-gases.ts # 11 атмосферных газов
│   │   ├── processor-categories.ts # 7 категорий рецептов процессоров
│   │   ├── processor-recipe-categories.ts
│   │   ├── star-types.ts       # 12 типов звёзд
│   │   ├── planet-types.ts     # 7 типов планет, размеры, местность
│   │   ├── warehouse.ts        # Резервы, специализация, орбитальный буфер
│   │   ├── ships/              # Подкаталог: hulls, modules, fuel-map, shipyard-queue, index
│   │   ├── research/           # Подкаталог: tech-tree, branch-links, fundamental-branches, tech-unlocks, index
│   │   └── chemistry/          # Подкаталог: ore-specs, ore-generator, ice-generator, atmospheric-generator, bake, validate, baked-types, index
│   │
│   ├── galaxy/                 # Генератор галактики (10 файлов)
│   │   ├── generator.ts        # Оркестратор (~118 строк)
│   │   ├── gen-context.ts      # Контекст генерации
│   │   ├── generate-positions.ts # Спираль, ядро, диск, ореол
│   │   ├── generate-systems.ts # Звёзды (Стефан-Больцман)
│   │   ├── generate-planets.ts # Планеты (атмосфера, температура, жизнь)
│   │   ├── generate-resources.ts # Залежи (из BakedGalaxyModel)
│   │   ├── generate-jump-points.ts # JP + связность BFS
│   │   ├── hex-grid.ts         # Гекс-сетка (axial)
│   │   ├── galaxy-module.ts    # Модуль галактики
│   │   └── index.ts
│   │
│   ├── economy/                # Экономический движок (3 файла)
│   │   ├── engine.ts           # Добыча, производство, крафт, энергия
│   │   ├── economy-module.ts   # Модуль экономики
│   │   └── index.ts
│   │
│   ├── ships/                  # Корабли (Block 02, 6 файлов)
│   │   ├── designer.ts         # validateShip (11 правил) + calculateDesignStats
│   │   ├── orders.ts           # planRoute + executeOrder + JUMP_RECHARGE_TICKS
│   │   ├── fleet-engine.ts     # processFleetTick + consumeFuel + FUEL_PRIORITY
│   │   ├── ships-module.ts    # Модуль кораблей
│   │   ├── fleet-module.ts     # Модуль флота
│   │   └── index.ts
│   │
│   ├── research/               # Исследования (Block 03, 3 файла)
│   │   ├── engine.ts           # getLabRPPerSec (/800), getTechCost, queue
│   │   ├── research-module.ts  # Модуль исследований
│   │   └── index.ts
│   │
│   ├── stores/                 # Zustand-сторы
│   │   └── game-store.ts       # Главный стор (состояние + действия)
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui (50+ компонентов)
│   │   └── game/               # Игровые компоненты (17 файлов)
│   │       ├── game-layout.tsx           # Лейаут (топбар, сайдбар, статус)
│   │       ├── galaxy-map.tsx            # SVG-карта галактики (зум 80x)
│   │       ├── system-view.tsx           # Экран звёздной системы
│   │       ├── planet-view.tsx           # Экран планеты (гекс-сетка)
│   │       ├── building-dialog.tsx       # Диалог строительства
│   │       ├── time-controls.tsx         # Управление временем
│   │       ├── resource-panel.tsx        # Панель ресурсов
│   │       ├── specialize-dialog.tsx     # Диалог специализации зданий
│   │       ├── production-queue.tsx       # Очередь производства
│   │       ├── production-queue-panel.tsx # Панель очереди производства
│   │       ├── shipyard-dialog.tsx       # Диалог верфи
│   │       ├── ship-designer.tsx         # Конструктор кораблей
│   │       ├── ship-card.tsx             # Карточка корабля
│   │       ├── fleet-view.tsx            # Просмотр флота
│   │       ├── fleet-orders-panel.tsx   # Панель приказов флоту
│   │       ├── fleet-route-overlay.tsx   # Оверлей маршрута флота
│   │       └── research-view.tsx         # Экран исследований
│   │
│   ├── hooks/                  # React-хуки (use-toast, use-mobile)
│   └── lib/                    # Утилиты (db.ts, rate-limit.ts, schemas/, utils.ts)
│
├── docs/                       # Проектная документация (номерные файлы — носители истины)
│   ├── !listing.md             # ← Индекс документов с количеством токенов
│   ├── STATUS.md               # ← Текущий статус проекта (подробно)
│   ├── 00-ARCHITECTURE.md      # Архитектура v4.0 + научные правила
│   ├── 10-galaxy.md            # Галактика: структура, форма, JP
│   ├── 20-stars.md             # Звёзды: типы, параметры, влияние
│   ├── 30-planets.md           # Планеты: застройка, ресурсы, атмосфера
│   ├── 31-resources.md         # Ресурсы: концепция распределения
│   ├── 32-mendeleev.md         # Элементы (таблица Менделеева)
│   ├── 33-chemistry.md         # Правила химии
│   ├── 34-ores.md              # Руды
│   ├── 40-buildings.md         # Здания (27 в spec, 15 реализовано)
│   ├── 50-ships.md             # Корабли (✅ Block 02)
│   ├── 60-research.md          # Исследования (✅ Block 03)
│   ├── 70-ai.md                # AI: крупные фракции (Etap 3.5, не реализовано)
│   ├── 71-minor-factions.md    # ⏳ Мелкие фракции (планируется)
│   ├── 80-combat.md            # ⏳ Боевая система (планируется, Etap 4)
│   ├── architecture/modular-bus.md  # Модульная шина событий
│   ├── audit-history.md        # История аудитов (⚠️ historical — 2026-05-03)
│   ├── buildings-verification.md    # Верификация зданий
│   ├── galaxy-generation-audit.md   # Аудит генерации (v3)
│   └── research-unification.md # Унификация системы исследований
│
├── worklog.md                  # Append-only журнал работы агентов (Task ID 1-25+)
├── plans/                      # Планы работ по задачам (протокол: plans/README.md)
│   ├── README.md               # Правила планов: Task ID, чеклисты, статусы
│   └── YYYY-MM-DD-task*-*.md   # План каждой задачи с чекбоксами [x]
├── checkpoints/                # Чекпоинты разработки (43 файла; именование — RULES.md)
│   ├── RULES.md                # ⚠️ ПРАВИЛА чекпоинтов (имя ММ_ДД_цель.md + формат)
│   ├── ROADMAP.md              # Глобальная дорожная карта этапов
│   ├── 08_27_audit_0{1..4}_*.md  # Аудиты Pass 1-4 (2026-08-27)
│   ├── 08_27_block_0{1..8}_*.md  # Блоки 01-08 (стабилизация → security)
│   ├── 08_28_audit_0{5..9}_*.md  # Аудиты Pass 5-9 (UX, research, buildings, ships, galaxy)
│   ├── 08_31_audit_1{0,1}_*.md   # Etap 4.1 (stars) + R-23/R-24 (2026-08-31)
│   ├── 08_27_doc_fixes.md + 08_27_gap_analysis.md + 08_27_audit_summary.md
│   └── 05_03_*.md, 05_04_*.md, 05_12_*.md, 06_26_*.md   # Исторические
│
├── prisma/schema.prisma        # Схема БД (GameSave)
├── db/custom.db                # SQLite (в .gitignore)
├── public/                     # Статика (logo.svg, robots.txt)
└── scripts/                    # Тестовые скрипты (PRNG, распределения)
```

### Назначение папок

| Папка | Назначение | Статус |
|-------|-----------|--------|
| `docs/` | Финальная проектная документация. Начать с `!listing.md`. | ✅ Актуальная |
| `plans/` | Планы работ по задачам (Task ID + чеклисты). Протокол — `plans/README.md`. | ✅ С 2026-08-31 |
| `worklog.md` | Append-only журнал работы агентов. Читать хвост при старте сессии. | ✅ Ведётся |
| `checkpoints/` | История разработки по этапам. **Именование строго по `checkpoints/RULES.md` (`ММ_ДД_цель.md`).** | 📚 Архив + правила |
| `src/core/` | Ядро движка: типы, PRNG, EventBus, GameLoop, модули. | ✅ MVP завершён |
| `src/data/` | Data-driven JSON-каталоги: 60 элементов, 17 зданий + синергия, ~75 рецептов, 12 звёзд, сетки планет/лун. | ✅ Data-driven |
| `src/galaxy/` | Генератор галактики: оркестратор + 5 модулей. | ✅ MVP завершён |
| `src/economy/` | Экономический движок: добыча, крафт, энергия. | ✅ MVP завершён |
| `src/ships/` | Конструктор кораблей, приказы флоту, тик флота. | ✅ Block 02 завершён |
| `src/research/` | Движок исследований, очередь, tech-tree. | ✅ Block 03 завершён |
| `src/stores/` | Zustand-сторы. | ✅ Immutable (immer) завершён |
| `src/components/game/` | Игровые UI-компоненты (17 файлов). | ✅ MVP завершён (атмосфера/орбита/fleet/research UI готовы) |
| `src/components/ui/` | shadcn/ui библиотека (не изменять). | ✅ Сторонняя |

## Документация

**Начать чтение с [`docs/!listing.md`](./docs/!listing.md)** — индекс всех документов с количеством токенов для каждого.

Ключевые документы:

| Документ | Описание |
|----------|----------|
| [`!listing.md`](./docs/!listing.md) | Индекс документов (с токенами) |
| [`STATUS.md`](./docs/STATUS.md) | Текущий статус: что работает, что в плане, что блокирует |
| [`00-ARCHITECTURE.md`](./docs/00-ARCHITECTURE.md) | Архитектура v4.0, научные правила, модули |
| [`10-galaxy.md`](./docs/10-galaxy.md) | Галактика: структура, форма, сетка, макрообъекты |
| [`20-stars.md`](./docs/20-stars.md) | Звёзды: типы, влияние на планеты и астероиды |
| [`30-planets.md`](./docs/30-planets.md) | Планеты: сетка застройки, бонусы, атмосфера, жизнь |
| [`31-resources.md`](./docs/31-resources.md) | Ресурсы: концепция распределения по типам планет |
| [`40-buildings.md`](./docs/40-buildings.md) | Здания: спецификация (27 зданий, 15 реализовано) |
| [`50-ships.md`](./docs/50-ships.md) | Корабли: спецификация (✅ Block 02 завершён — 4 корпуса, 20 модулей) |
| [`60-research.md`](./docs/60-research.md) | Исследования: спецификация (✅ R-SPLIT: банк + дерево, §3.1.1) |
| [`70-ai.md`](./docs/70-ai.md) | AI: спецификация (не реализовано) |
| [`data-driven-architecture.md`](./docs/data-driven-architecture.md) | Data-driven JSON-каталоги: buildings / research / ships / stars / synergy |

## Технологический стек

| Компонент | Технология |
|-----------|------------|
| Фреймворк | Next.js 16 + TypeScript 5 |
| Рендеринг игры | SVG (MVP), PixiJS 8 (план) |
| UI | React 19 + shadcn/ui + Tailwind CSS 4 |
| Состояние | Zustand (план: zustand-immer для иммутабельности) |
| База данных | SQLite (Prisma ORM) |
| Справочники | Data-driven JSON + тонкие TS-loader'ы (см. `docs/data-driven-architecture.md`) |
| Архитектура | GameMediator + ModuleRegistry + TypedEventBus |

## Метрики реализации (на 2026-08-31)

> Числа отражают текущее состояние КОДА. Спецификации в `docs/` могут описывать больше.
> Полный аудит-чейн: `checkpoints/08_27_audit_0{1..4}_*.md` → `08_28_audit_0{5..9}_*.md` → `08_31_audit_1{0,1}_*.md` (Pass 1-11).

| Метрика | Значение |
|---------|----------|
| Строк игрового кода (src/, без shadcn/ui) | ~29 000 |
| Строк shadcn/ui | ~5 400 |
| Файлов в src/ | 147 |
| Элементов (в коде / по spec) | 60 / 60 ✅ (57 base + 3 transuranic) |
| Руд (в коде) | 56 |
| Зданий (data-driven JSON / по спецификации) | 17 / 27 + 7 правил синергии |
| Рецептов (в коде) | 75 ✅ (validate:recipes 75/75) |
| Типов звёзд | 12 ✅ (data-driven, `src/data/stars/types.json`) |
| Типов планет | 7 ✅ + сетки планет/лун из `grids.json` |
| Компонентов UI (game/) | 17 |
| Документов в docs/ | 29 |
| Чекпоинтов в checkpoints/ | 43 |
| Lint-ошибок | 0 ✅ (48 warnings) |
| Тестов | 555/555 ✅ (0 failing) |
| Валидаторов каталогов | 4 ✅ (buildings+synergy / recipes / ships / stars) |

Полный отчёт о расхождениях кода со спецификацией — в [`docs/STATUS.md`](./docs/STATUS.md).

## Лицензия

Частный проект. Все права защищены.
