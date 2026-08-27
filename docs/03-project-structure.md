# 03. Структура проекта

> **Номерной файл-источник истины.** Структура каталогов SpaceGame (Вариант A — веб-нативный).
>
> **Создан:** 2026-06-26
> **Изменён:** 2026-06-26
> **Версия:** 1.0 (вынесено из 00-ARCHITECTURE.md §8)
> **Зависимости:** [00-ARCHITECTURE.md](./00-ARCHITECTURE.md), [01-tech-stack.md](./01-tech-stack.md)

---

## Содержание

1. [Структура каталогов](#1-структура-каталогов)
2. [Назначение папок](#2-назначение-папок)
3. [Модули, запланированные но не реализованные](#3-модули-запланированные-но-не-реализованные)

---

## 1. Структура каталогов

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Главная страница игры
│   ├── layout.tsx                # Корневой layout (метаданные SpaceGame)
│   └── api/                      # API routes
│       ├── route.ts              # Базовый API
│       └── save/                 # Сохранения/загрузка
│           ├── route.ts          # POST (создать) / GET (список)
│           └── [id]/route.ts     # GET/PUT/DELETE по ID
│
├── core/                         # Ядро симуляции (НЕ зависит от UI)
│   ├── types.ts                  # Все типы и интерфейсы игры
│   ├── prng.ts                   # PRNG (xoshiro256**), derive()
│   ├── typed-event-bus.ts        # Типизированная шина событий
│   ├── events.ts                 # Каталог 60+ событий
│   ├── module-types.ts           # IGameModule, ModuleManifest
│   ├── module-registry.ts        # Реестр модулей с топосортом
│   ├── game-mediator.ts          # Центральный оркестратор
│   ├── game-loop.ts              # Игровой тик, пауза, ускорение
│   └── index.ts                  # Реэкспорты
│
├── galaxy/                       # Генерация галактики
│   ├── generator.ts              # Оркестратор генерации (seed-based)
│   ├── gen-context.ts            # Контекст генерации
│   ├── generate-positions.ts     # Спираль, ядро, диск, ореол
│   ├── generate-systems.ts       # Звёзды (Стефан-Больцман)
│   ├── generate-planets.ts       # Планеты (атмосфера, температура, жизнь)
│   ├── generate-resources.ts     # Залежи (из BakedGalaxyModel)
│   ├── generate-jump-points.ts   # JP + связность BFS
│   ├── hex-grid.ts               # Гексагональная сетка (axial coords)
│   ├── galaxy-module.ts          # Модуль галактики (для GameMediator)
│   └── index.ts                  # Публичный экспорт модуля
│
├── economy/                      # Экономический движок
│   ├── engine.ts                 # Добыча, производство, крафт, энергия
│   ├── economy-module.ts         # Модуль экономики (для GameMediator)
│   └── index.ts                  # Публичный экспорт модуля
│
├── ships/                        # Корабли (Block 02)
│   ├── designer.ts               # validateShip (11 правил) + calculateDesignStats
│   ├── orders.ts                 # planRoute + executeOrder + JUMP_RECHARGE_TICKS
│   ├── fleet-engine.ts           # processFleetTick + consumeFuel + FUEL_PRIORITY
│   ├── ships-module.ts           # Модуль кораблей (для GameMediator)
│   ├── fleet-module.ts           # Модуль флота (для GameMediator)
│   └── index.ts                  # Публичный экспорт
│
├── research/                     # Исследования (Block 03)
│   ├── engine.ts                 # getLabRPPerSec (/800), getTechCost, queue
│   ├── research-module.ts        # Модуль исследований (для GameMediator)
│   └── index.ts                  # Публичный экспорт
│
├── data/                         # Статические данные (TypeScript-модули)
│   ├── elements.ts               # 60 элементов (57 базовых + 3 трансурановых)
│   ├── buildings.ts              # 15 зданий (colony_hub, mine, processor...)
│   ├── recipes.ts                # ~75 рецептов крафта
│   ├── processing-chains.ts      # Цепочки руд (атмосфера/лёд/самородки)
│   ├── chemistry-generator.ts    # Реэкспорт-шим (30 строк; ~1700 строк в src/data/chemistry/)
│   ├── baked-lookups.ts          # Lookup-структуры (синглтон)
│   ├── element-helpers.ts        # CATEGORY_LABELS, CATEGORY_COLORS
│   ├── crafted-materials.ts      # steel, microchip, etc.
│   ├── atmosphere-gases.ts       # 11 атмосферных газов
│   ├── processor-categories.ts   # 7 категорий рецептов процессоров
│   ├── processor-recipe-categories.ts
│   ├── star-types.ts             # 12 типов звёзд
│   ├── planet-types.ts           # 7 типов планет, размеры, местность
│   ├── warehouse.ts              # Резервы, специализация, орбитальный буфер
│   ├── ships/                    # Подкаталог: hulls, modules, fuel-map, shipyard-queue, index
│   ├── research/                 # Подкаталог: tech-tree, branch-links, fundamental-branches, tech-unlocks, index
│   └── chemistry/                # Подкаталог: ore-specs, ore-generator, ice-generator, atmospheric-generator, bake, validate, baked-types, index
│
├── stores/                       # Zustand-сторы
│   └── game-store.ts             # Единый стор игрового состояния
│
├── components/                   # React компоненты UI
│   ├── game/                     # Игровые компоненты (17 файлов)
│   │   ├── game-layout.tsx       # Главный layout игры (topbar + sidebar + content)
│   │   ├── galaxy-map.tsx        # Карта галактики (SVG, зум 80x)
│   │   ├── system-view.tsx       # Экран звёздной системы
│   │   ├── planet-view.tsx       # Гекс-сетка планеты + застройка
│   │   ├── building-dialog.tsx   # Диалог строительства/улучшения
│   │   ├── resource-panel.tsx    # Панель ресурсов (по категориям)
│   │   ├── time-controls.tsx     # Пауза / Play / скорость (x1–x50)
│   │   ├── specialize-dialog.tsx # Диалог специализации зданий
│   │   ├── production-queue.tsx   # Очередь производства
│   │   ├── production-queue-panel.tsx # Панель очереди производства
│   │   ├── shipyard-dialog.tsx   # Диалог верфи
│   │   ├── ship-designer.tsx     # Конструктор кораблей
│   │   ├── ship-card.tsx         # Карточка корабля
│   │   ├── fleet-view.tsx       # Просмотр флота
│   │   ├── fleet-orders-panel.tsx # Панель приказов флоту
│   │   ├── fleet-route-overlay.tsx # Оверлей маршрута флота
│   │   └── research-view.tsx     # Экран исследований
│   └── ui/                       # shadcn/ui компоненты (не изменять)
│
├── hooks/                        # React хуки
│   ├── use-mobile.ts             # shadcn: определение мобильного
│   └── use-toast.ts              # shadcn: toast-уведомления
│
├── lib/
│   ├── db.ts                     # Prisma клиент
│   ├── rate-limit.ts             # Token bucket 10/min (Block 08)
│   ├── utils.ts                  # Утилиты (cn, и т.д.)
│   └── schemas/                  # Zod-схемы (save, game-state) — Block 08
│
└── prisma/                       # (в корне проекта)
    └── schema.prisma             # Схема БД (GameSave)
```

---

## 2. Назначение папок

| Папка | Назначение | Зависимости |
|-------|-----------|-------------|
| `src/app/` | Next.js App Router, страницы и API | React, Next.js |
| `src/core/` | Ядро движка: типы, PRNG, шина событий, модули | Только TypeScript (чистая логика) |
| `src/galaxy/` | Генератор галактики (оркестратор + модули) | `core/`, `data/` |
| `src/economy/` | Экономический движок (добыча, крафт, энергия) | `core/`, `data/` |
| `src/ships/` | Корабли: конструктор, приказы, флот (Block 02) | `core/`, `data/ships/` |
| `src/research/` | Исследования: дерево, очередь, RP/сек (Block 03) | `core/`, `data/research/` |
| `src/data/` | Статические данные: элементы, здания, рецепты | `core/types.ts` |
| `src/stores/` | Zustand-сторы (состояние + действия) | `core/`, `economy/`, `galaxy/` |
| `src/components/game/` | Игровые UI-компоненты | `stores/`, `data/`, shadcn/ui |
| `src/components/ui/` | shadcn/ui библиотека (не изменять) | Сторонняя |
| `src/hooks/` | React-хуки | React, shadcn |
| `src/lib/` | Утилиты (db.ts, utils.ts) | Prisma, clsx |

---

## 3. Модули, запланированные но не реализованные

> **Etap 3.0 (Флот + Исследования) завершён** в Block 02/03 (2026-08-27). См. §1 для фактических файлов `src/ships/` + `src/research/`. Ниже — только модули Etap 3.5/4.

Следующие модули запланированы, но ещё не созданы (см. [02-dev-process.md](./02-dev-process.md)):

```
# Этап 3.5: AI-фракции
src/
├── ai/                           # AI: фракции, экономика, война, дипломатия
│   ├── faction-types.ts          # Faction, MajorFaction, MinorFaction
│   ├── economy-ai.ts             # Экономический AI (потребности, строительство)
│   ├── military-ai.ts            # Военный AI (флоты, угрозы)
│   ├── diplomacy-ai.ts           # Дипломатический AI (отношения, предложения)
│   ├── minor-faction-ai.ts       # Упрощённая модель для мелких фракций
│   └── ai-module.ts              # Модуль AI (для GameMediator)

# Этап 4: Глубокие системы
src/
├── combat/                       # Боевая система (классическая механика)
│   ├── battle-resolver.ts        # Расчёт боя
│   ├── weapons.ts                # Оружие, урон, дальность
│   ├── shields.ts                # Щиты, регенерация
│   └── combat-module.ts          # Модуль боя (для GameMediator)
├── diplomacy/                    # Дипломатия (отдельно от AI)
│   ├── relations.ts              # Отношения, соглашения
│   └── trade.ts                  # Торговля, маршруты
├── logistics/                    # Межпланетная логистика
│   ├── trade-routes.ts           # Торговые маршруты
│   └── transport.ts              # Транспортные корабли
└── xenoarch/                     # Ксеноархеология
    ├── artifacts.ts              # Артефакты Странников
    └── ruins.ts                  # Руины
```

> Каждый новый модуль реализуется по шаблону из [architecture/modular-bus.md](./architecture/modular-bus.md) §10.

> ⚠️ **Stub'ы в коде (Etap 4 placeholder'ы):** `resolveCombat`, `canColonizePlanet`, антиматериальное топливо, терраформирование — все реализованы как заглушки, возвращающие константные значения, до Etap 4.

---

## Принципы организации кода

1. **Разделение движка и UI** — `src/core/`, `src/galaxy/`, `src/economy/`, `src/ships/`, `src/research/` не зависят от React
2. **Модульная архитектура** — каждый модуль реализует `IGameModule` (см. [architecture/modular-bus.md](./architecture/modular-bus.md))
3. **Данные в TypeScript-модулях** — не JSON, для типобезопасности
4. **shadcn/ui не изменять** — `src/components/ui/` содержит стандартную библиотеку
5. **Стор как точка входа** — `src/stores/game-store.ts` делегирует модулям через GameMediator, отвечает за реактивность (Block 06 контракт; Pass 1 P0-1 — sync store→mediator ещё частично открыт)
