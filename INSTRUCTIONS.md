# Инструкции для агента: управление DEV-сервером и сейвами

## Где физически хранятся сейвы

Сейвы хранятся В БАЗЕ ДАННЫХ (не в файлах):

- **Файл БД:** `/home/z/my-project/db/custom.db` (SQLite, путь задан в `.env`:
  `DATABASE_URL=file:/home/z/my-project/db/custom.db`, Prisma).
- **Таблица:** `GameSave`; колонки: `id` (cuid), `name`, `seed`, `settings`,
  `state` (JSON всего GameState), `version`, `tick`, `createdAt`, `updatedAt`.
- **Формат `state`:** компактный JSON с маркером `fmt: 4` в корне
  (`SAVE_FORMAT_VERSION`, `src/lib/save-format-v4.ts`) — планетарные
  сырьевые пулы сериализуются кортежами `op` на каждом теле
  ([idx, initial, remaining, availability, tier]; индексы — из словаря
  `galaxy.dict`). `HexCell.deposits` больше НЕ часть модели (удалён в v4,
  распределение депозитов по гексам не существует ни в состоянии, ни в
  сейвах), а `resourceDeposits` — производное свод-превью (чистая функция
  `buildResourceSummary` от пулов, пересчитывается при загрузке), а НЕ
  запас руды.
  - **Загрузчик принимает только fmt v4.** Сейвы v1/v2/v3 (гекс-залежи)
    НЕ мигрируются и отклоняются явной ошибкой
    (`IncompatibleSaveFormatError`) — для продолжения начать новую игру
    (docs/31 §12).
- **Метаданные `GameSave.version`:** зеркалят объявленный `fmt` при новом
  POST/PUT (`declaredFormatVersion` — текущий клиент → 4). Историческая
  строка БД может хранить прежние метаданные: фактическая совместимость
  определяется маркером `fmt` ВНУТРИ state, а не колонкой БД.
- **Транспорт клиент↔сервер** — не размер БД: `POST /api/save` принимает
  `gzip-base64` (`stateEncoding`) — фактический размер запроса ~0.6 МБ для
  свежей игры 200 систем; в БД лежит plain JSON (~2.7 МБ). Совместимость
  со старыми сейвами транспортным слоем не заявляется.

### Осмотр сейвов

```bash
# Список сейвов (имя/seed/tick/размер):
bun run save:inspect                # последний по updatedAt → dump в scripts/output/
bun run save:inspect --id=<cuid>    # конкретный сейв

# Прямые запросы к БД (sqlite3):
sqlite3 db/custom.db "SELECT id, name, seed, tick, version, length(state) AS bytes, updatedAt FROM GameSave ORDER BY updatedAt DESC;"

# ВАЖНО: не редактируйте custom.db руками при работающем DEV — SQLite-блокировки.
```

## Текущее состояние (обновлено 2026-10-29, SAVE-V4-DOCS-UX-01 / Issue #26)

DEV-сервер запущен через **double-fork** (порт 3000, PID в `/tmp/next-dev.pid`,
лог — `dev2.log`). Этот способ переживает завершение Bash-сессий — используйте
его всегда (команда ниже). После сброса песочницы порядок восстановления:
`bun install` → проверить `.env` (`DATABASE_URL=file:/home/z/my-project/db/custom.db`,
абсолютный путь к БД сейвов) → `bun run db:generate` → остановить заглушку
песочницы на :3000 → double-fork запуск.

Быстрая проверка живости (одной командой):
```bash
ps aux | grep -E "next dev|next-server" | grep -v grep
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/
tail -20 dev.log
```

Лог большой — читать только хвост (`tail`), не весь файл.

## Проблема

Каждый вызов Bash-инструмента создаёт **новую shell-сессию**. Когда сессия завершается,
ядро отправляет SIGHUP всем дочерним процессам этой сессии — в том числе Next.js DEV-серверу.
В результате сервер **падает** при каждом завершении Bash-вызова.

Симптомы:
- Сервер запускается и отвечает 200, но через несколько секунд/минут (при следующем
  Bash-вызове) он уже мёртв
- В логах нет ошибок — процесс просто исчезает
- `nohup` и `disown` НЕ помогают, потому что shell убивает дочерние процессы до того,
  как `disown` успевает сработать в другой сессии

## Решение: Double-fork

Double-fork — классический UNIX-паттерн для демонов. Запускаем процесс в подоболочке,
которая немедленно завершается. Процесс становится «сиротой» и усыновляется init (PID 1),
после чего он не получает SIGHUP от завершающейся shell-сессии.

## Как правильно запустить DEV-сервер

### Запуск

```bash
PROJECT_DIR=$(pwd) && \
  cd "$PROJECT_DIR" && \
  ( node node_modules/.bin/next dev -p 3000 > "$PROJECT_DIR/dev2.log" 2>&1 & echo $! > /tmp/next-dev.pid ) &
```

Ключевые моменты:
1. `( ... & ) &` — double-fork: внешний `&` запускает подгруппу в фоне, внутренний `&`
   запускает node в фоне внутри подгруппы. Подгруппа завершается, node остаётся жив.
2. `echo $! > /tmp/next-dev.pid` — сохраняем PID для последующей проверки/убийства.
3. Лог пишется в `"$PROJECT_DIR/dev2.log"` (не dev.log — он может использоваться
   командой `tee` из package.json).
4. Порт строго 3000.
5. `PROJECT_DIR=$(pwd)` — инструкции работают из любой директории репозитория,
   не зависят от абсолютного пути клонирования.

### Проверка, что сервер работает

```bash
NEXT_PID=$(cat /tmp/next-dev.pid 2>/dev/null)
ps -p $NEXT_PID -o pid,stat,rss 2>&1
ss -tlnp | grep 3000
curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1:3000/
```

### Остановка сервера

```bash
NEXT_PID=$(cat /tmp/next-dev.pid 2>/dev/null)
kill $NEXT_PID 2>/dev/null
# Также убить дочерние next-server процессы:
pkill -f "next dev -p 3000" 2>/dev/null
rm -f /tmp/next-dev.pid
```

### Перезапуск сервера

```bash
# 1. Остановить
NEXT_PID=$(cat /tmp/next-dev.pid 2>/dev/null)
kill $NEXT_PID 2>/dev/null
pkill -f "next dev -p 3000" 2>/dev/null
sleep 2

# 2. Запустить с double-fork
PROJECT_DIR=$(pwd) && \
  cd "$PROJECT_DIR" && \
  ( node node_modules/.bin/next dev -p 3000 > "$PROJECT_DIR/dev2.log" 2>&1 & echo $! > /tmp/next-dev.pid ) &

# 3. Подождать и проверить
sleep 6
curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1:3000/
```

## НЕОБХОДИМОЕ ПРАВИЛО

**ВСЕГДА запускайте DEV-сервер через double-fork!**

Следующие способы НЕ работают (сервер умрёт при завершении Bash-сессии):
- `bun run dev &` — сервер умрёт
- `node ... next dev &` — сервер умрёт
- `nohup bun run dev &` — сервер умрёт
- `bun run dev & disown` — сервер умрёт
- `setsid node ... next dev &` — может работать, но double-fork надёжнее

## Почему `bun run dev` не подходит

`bun run dev` выполняет скрипт `next dev -p 3000 2>&1 | tee dev.log` — это создаёт
дополнительный pipe-процесс (`tee`), который тоже умирает с shell-сессией, утягивая за собой
всю цепочку. Поэтому нужно запускать `node node_modules/.bin/next dev -p 3000` напрямую,
а лог писать через перенаправление `>`.

## Дополнительные замечания

- Лог Prisma запросов включен (db.ts: `log: ['query']`). Если логи становятся слишком
  большими, можно временно убрать.
- Не используйте `bun run build` — только dev-сервер.
- Не используйте порт, отличный от 3000.
- Живой лог DEV: `tail -f dev.log` (запуск через `bun run dev` + tee) или
  `dev2.log` (double-fork запуск). Для диагностики смотрите последние строки.

## Чек-лист восстановления после падения DEV (R-29)

```bash
# 1. Диагноз: жив ли процесс / порт / отвечает ли HTTP
ps aux | grep "next dev" | grep -v grep
ss -tlnp | grep 3000
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/
tail -30 dev.log        # или dev2.log для double-fork запуска

# 2. Если мёртв — перезапуск double-fork (см. выше) и проверка
# 3. Если отвечает 500 — смотреть dev.log на предмет ошибок компиляции/API;
#    сейвы в БД не теряются при падении сервера (SQLite-файл не меняется).
```
