# Инструкции для агента: управление DEV-сервером и сейвами

## Где физически хранятся сейвы

Сейвы хранятся В БАЗЕ ДАННЫХ (не в файлах):

- **Файл БД:** `/home/z/my-project/db/custom.db` (SQLite, путь задан в `.env`:
  `DATABASE_URL=file:/home/z/my-project/db/custom.db`, Prisma).
- **Таблица:** `GameSave`; колонки: `id` (cuid), `name`, `seed`, `settings`,
  `state` (JSON всего GameState), `version`, `tick`, `createdAt`, `updatedAt`.
- **Формат `state`:** компактный JSON с маркером `fmt` в корне:
  - `fmt: 3` (R-29, актуальный): ленивые залежи (в сейве только гексы
    материализованных/колонизированных тел; истощённые кортежи не пишутся),
    словарь id `galaxy.dict`, кортежи-индексы.
  - `fmt: 2` (R-28): кортежи, без coord — читается без потерь.
  - без `fmt` (v1, старейшие) — тоже читается.
- **Транспорт клиент↔сервер** — не размер БД: `POST /api/save` принимает
  `gzip-base64` (`stateEncoding`) — фактический размер запроса ~0.6 МБ для
  свежей игры 200 систем; в БД лежит plain JSON (~2.7 МБ, R-29).

### Осмотр сейвов

```bash
# Список сейвов (имя/seed/tick/размер):
bun run save:inspect                # последний по updatedAt → dump в scripts/output/
bun run save:inspect --id=<cuid>    # конкретный сейв

# Прямые запросы к БД (sqlite3):
sqlite3 db/custom.db "SELECT id, name, seed, tick, version, length(state) AS bytes, updatedAt FROM GameSave ORDER BY updatedAt DESC;"

# ВАЖНО: не редактируйте custom.db руками при работающем DEV — SQLite-блокировки.
```

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
