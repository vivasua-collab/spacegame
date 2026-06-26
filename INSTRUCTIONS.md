# Инструкции для агента: управление DEV-сервером

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
cd /home/z/my-project && \
  ( node node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev2.log 2>&1 & echo $! > /tmp/next-dev.pid ) &
```

Ключевые моменты:
1. `( ... & ) &` — double-fork: внешний `&` запускает подгруппу в фоне, внутренний `&`
   запускает node в фоне внутри подгруппы. Подгруппа завершается, node остаётся жив.
2. `echo $! > /tmp/next-dev.pid` — сохраняем PID для последующей проверки/убийства.
3. Лог пишется в `/home/z/my-project/dev2.log` (не dev.log — он может использоваться
   командой `tee` из package.json).
4. Порт строго 3000.

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
cd /home/z/my-project && \
  ( node node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev2.log 2>&1 & echo $! > /tmp/next-dev.pid ) &

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
