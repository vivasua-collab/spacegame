# Чекпоинт: Гравитационная градация планет + сжатый транспорт сейвов

**Дата:** 2026-08-31 11:30
**Фаза:** R-26 (вне этапов ROADMAP — доработка по запросу владельца)
**Статус:** complete

## Контекст

Владелец: «планета 0.9g — средняя, а 0.8g — большая; ледяная 0.4g — большая. Необходима чёткая градация: чем планета больше (в рамках одного геологического типа), тем гравитация выше. Реализовать чтение дампа (сейва) галактики для анализа. Ошибка сохранения: EntityTooLarge 33554432 bytes». План: plans/2026-08-31-task26-planet-gravity-save.md (Task ID 26).

## Выполненные задачи

- Диагноз: радиус и плотность — независимые случайные величины → g = R×ρ/5.51 не упорядочена по классам; сейв 200 систем = 30.7 МБ ≥ лимит шлюза 32 МБ → EntityTooLarge.
- R-26 градация: PLANET_GRAVITY_BANDS / MOON_GRAVITY_BANDS (тип × класс) — непересекающиеся, возрастающие по классу; внутри класса линейно по радиусу; плотность выводится ρ = g×5.51×6371/R (в диапазоне типа). RNG-серия генерации сохранена (снапшоты стабильны). Файлы: src/data/planet-types.ts, src/galaxy/generate-planets.ts.
- Транспорт сейвов: клиент gzip+base64 (save-codec-browser.ts) → POST/PUT stateEncoding='gzip-base64' → сервер node:zlib (save-codec-server.ts) → raw-лимит 50 МБ → plain JSON (version 1) в БД; GET > 512 КБ сжатый. save-schema.ts + routes + game-store.ts. 200 систем: 30.7 → 6.9 МБ; 500: 79.3 → 17.7 МБ.
- Инспектор дампа: scripts/inspect-save.ts (`bun run save:inspect`) — дамп + сводка (матрица тип×размер, проверки градации, метрики состояния).
- Тесты (+19): planet-gravity-gradation.test.ts (10), api-save-encoding.test.ts (9); обновлён api-save.test.ts (лимит — пост-декод, контракт 400 сохранён).
- Docs: 30-planets.md §1.1/§2.2.1; STATUS.md история.

## Текущие задачи

- (нет — задача закрыта)

## Проблемы

- Шелл основного агента сбоил на финальной стадии — верификация и финализация выполнены через субагента; на результат не влияет.

## Следующие шаги

- Etap 4.2 — планетарный каталог (рек. Pass 9).
- Возврат кросс-типовых правил синергии (STATUS §7.2 NEXT-2).
- P0-1: Store→mediator sync.

## Изменённые файлы

- src/data/planet-types.ts, src/galaxy/generate-planets.ts
- src/lib/save-codec-server.ts, src/lib/save-codec-browser.ts (новые), src/lib/schemas/save-schema.ts
- src/app/api/save/route.ts, src/app/api/save/[id]/route.ts, src/stores/game-store.ts
- scripts/inspect-save.ts (новый), package.json
- tests/galaxy/planet-gravity-gradation.test.ts, tests/api-save-encoding.test.ts (новые), tests/api-save.test.ts
- docs/30-planets.md, docs/STATUS.md, plans/2026-08-31-task26-planet-gravity-save.md, worklog.md, этот чекпоинт

## Верификация

- Гейты: lint 0/48; tsc 156 (=); bun test 532/532 (+19); validate:all 4/4.
- Браузер (seed 20260831): лёд Малая 0.3 < Средняя 0.4 < Большая 0.8; скалистые Средняя 0.7 < Большая 1.2/1.3; «Save» → «✓ Сохранено», POST /api/save 200 (EntityTooLarge устранён); сейв в Load-списке; ошибок нет.
- save:inspect реального сейва: 200 систем / 536 планет / 342 луны; инверсии 0, монотонность 0, расхождения формулы 0.
