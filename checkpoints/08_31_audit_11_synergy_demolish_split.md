# Чекпоинт: Task 23 — Синергия · R-DEMOLISH · R-SPLIT · UI исследований
Дата: 2026-08-31 (восстановление после сбоя сессии) · Коммит: 4c78031 → amended

## Контекст

Упавшая сессия (08:28) закоммитила реализацию всех 4 запросов владельца, но
не успела: обновить 8 тестов, запушить, записать worklog, создать чекпоинт.
Текущая сессия: остановлен dev-сервер (по запросу), проведён анализ коммита,
до-завершение, введён новый протокол планирования (plans/).

## Что было в коммите 4c78031 (реализация упавшей сессии)

| Файл | Что |
|------|-----|
| src/data/buildings/synergy.json + synergy.ts | 4 правила синергии (data-driven) |
| src/economy/adjacency.ts (NEW) | движок соседства: axial, стекинг §5.2 |
| src/research/bonus-resolver.ts | интеграция lab_cluster → research_rate |
| src/economy/engine.ts | downgrade/demolish + synergy в energy/production |
| src/core/events.ts + types.ts | 4 события + SynergyRule + rpBank |
| src/research/engine.ts | R-SPLIT: rpBank, inflow split, tick rewrite |
| src/components/game/research-view.tsx | «Всего» → «Аккумулятор» + «Приток» |
| src/components/game/building-dialog.tsx | кнопки понижения/сноса |
| src/stores/game-store.ts + economy-module.ts | проводка экшенов/событий |
| scripts/validate-buildings.ts | валидация synergy-правил |

## Дефекты, найденные аудитом (задача 1) и исправленные

1. **Кластер лабораторий переусилен**: Σ вкладов всех лабораторий шла в
   глобальный множитель → 2×2 = +60% (docs: +15%). Фикс: средний агрегат
   `Σ boostSum / Σ labCount` по империи («на каждую»-семантика §5.1/§5.4).
2. **Редирект «100% в дерево» мёртв**: areAllFundamentalsMaxed требовал
   maxed у 6 веток, включая недоступный призрак xenoarchaeology → банк
   копился бы вечно. Фикс: проверка только 5 MVP-веток.
3. **Уровень-0 соседи давали бонус** (§5.3.2 «оба построены»). Фикс: isBuilt.

## Верификация

- lint: 0 errors / 48 warnings (базовая 49)
- tsc: 156 ошибок (базовая 159; паттерн идентичен)
- bun test: **496/496** (было 439 total / 8 fail; +57 тестов)
- validate:all: 4 валидатора (buildings+synergy, recipes, ships, stars)
- Новые тестфайлы: research-split (17), synergy-adjacency (22),
  downgrade-demolish (16); обновлены: process-tick, queue-and-rp,
  bonus-resolver

## Решение открытого вопроса владельца

«Куда девать RP, когда фундаменталы полностью изучены?» → **100% притока в
дерево технологий** (банк заморожен). RP не теряются никогда: простой
дерева → 100% в банк; обе активны → 50/50.

## Артефакты

- plans/README.md — новый протокол планирования (правило владельца)
- plans/2026-08-31-task23-synergy-demolish-research-split.md — план задачи
- docs/60-research.md §3.1.1, §3.3; docs/40-buildings.md §5.4-прим., §9.5
