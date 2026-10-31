# План CORE-SAVE-REPRO-01 (Issue #27) — воспроизведение и устранение повторного timeout Save

**База:** main `7c66eae` (== origin/main, дерево чистое)
**Дата:** 2026-10-31 · Порядок работ по §9 Issue #27: preflight → браузерный repro → узкие тесты → гейты последовательно.

## Preflight (зафиксировано 2026-10-31 14:3x UTC)

- git: main, HEAD `7c66eae`, 0/0 vs origin/main, dirty 0.
- DEV: double-fork PID 2782/2794, :3000 LISTEN, HTTP 200 за 34 мс.
- Ресурсы: 3.9Gi RAM (next-server RSS 1.8Gi = 43.5%, available 1.7Gi), диск 7.6Gi свободно.
- OOM-история ядра: ровно 1 событие — bun (PID 4514, 1.74Gi) убит OOM при аптайме 24135s ≈ мой первый полный `bun test` сегодня (объясняет оборванный вывод). ООМ во время игры/сейва НЕ зафиксирован.
- БД: `/home/z/my-project/db/custom.db`, схема {id,name,seed,settings,state,version,tick,createdAt,updatedAt}, **0 строк** (чистая после восстановления 28–31.10).
- TypeScript baseline на стартовом HEAD: `bunx tsc --noEmit` → **exit 2, 63 ошибки (55 src/)** — в конце сравнить Δ.
- Мензурация масштаба (INSTRUCTIONS.md, R-31): свежая 200-системная галактика ≈ raw 2.7 МБ JSON, транспорт gzip-base64 ≈ 0.6–0.9 МБ. Размер галактики в UI НЕ конфигурируется (только seed) — сценарий «5–10 систем» недоступен, A/C идут на дефолтных 200.

## Гипотезы (проверять доказательствами, не объявлять без repro)

- H1: client main-thread/event-loop starvation (serialize 31МБ-эры устарела; сегодня 2.7МБ — маловероятно).
- H2: gzip CompressionStream не завершается (зависание flush) — редкий, проверить encode-тайминг в логах.
- H3: сеть/сервер: Turbopack compile первой POST, rate-limit 429 (это НЕ timeout), SQLite lock, Prisma зависание — серверные старт/decoded-логи дадут границу.
- H4: memory pressure (GC-thrash/tab crash/OOM) — следить RSS/free во время тестов; в песочнице уже 1 OOM-bun сегодня.
- H5: внешний preview-proxy владельца (вне песочницы) — изнутри НЕ достижим; если локальные прогоны чистые → статус NOT REPRODUCED (in-sandbox) + границы доказанной достижимости.
- H6: ambiguous POST (DB commit успел, ответ потерян) — проверить через искусственный abort + сверку БД.

## Сценарии (§3, последовательно, без параллельных тяжёлых прогонов) — ВЫПОЛНЕНО 2026-10-31

- [x] A: POST свежей игры (seed 424242, 200 систем — UI не конфигурирует размер, минимум доступный) → `[save] OK total=497ms` (serialize=29, encode=115, network=302) → GET list ✓ → Load round-trip (tick 0 → Year 1|Day 1) ✓.
- [x] B: колонизация Xi Ursae I → Save = **PUT** cmvwmidx1.../cmvwlmlhm... → 200, tick 17, version=4, дублей 0.
- [x] C: развитие (Солнечная станция + Космопорт + Верфь, x50 до Year 19+ / tick 5520) → PUT 650ms/426ms → PUT 561ms/353ms → Load round-trip ✓ (Year 30|Day 176, КОЛОНИИ:1).
- [x] D: 3+ последовательных PUT на одном состоянии (621/582/604ms) + сейв на x1 (632ms) + GameLoop восстановлен ровно один раз (Day 178→184 за 6с = ровно x1) + x50-сейвы ✓.
- [x] E: локальный :3000 (POST 201 за 286ms) vs Caddy :81 (POST 201 за 264ms) — gateway не добавляет значимой задержки. Внешний preview-прокси платформы изнутри песочницы недостижим (нет внешнего hostname; граница зафиксирована).
- [x] H4 memory pressure: 2 хога (999MB) → avail 274MB → реальный UI Save под давлением: **795ms, успех** (network 600ms vs обычных ~300). Гипотеза «pressure → 30s timeout» на этом масштабе опровергнута.
- [x] H6 ambiguous POST: ВОСПРОИЗВЕДЁН raw-TCP-пробой (клиент закрыл соединение до чтения ответа; сервер завершил 201; запись осталась) → фикс идемпотентности реализован и доказан end-to-end (retry с тем же requestId → 200 {тот же id, deduplicated:true}, в БД 1 запись).

## Результат (2026-10-31)

- **Timeout NOT REPRODUCED**: 12 реальных браузерных сейвов (POST+PUT, свежие/развитые состояния, x1/x50, прямой+gateway пути, под давлением памяти) — все 485–1255ms; бюджет 30 000ms (запас ≥24×). Server 201/200 за 264–1030ms (decode 17–113ms).
- **Доказанная причина повторных инцидентов — класс среды**: 4 ГБ RAM без swap; сегодня задокументированы ДВА kernel OOM-kill (uptime 24135s: bun 1.74GB — мой полный bun test; uptime 31251s: bun вызвал oom-killer → ядро убило next-server 1.72GB во время тяжёлых гейтов). Владельческий инцидент #18 имел ту же сигнатуру (запроса нет в серверном логе окна плейтеста + тяжёлые гейты параллельно). Dev-сервер Turbopack держит ~1.7–1.8GB RSS постоянно — крупнейший процесс в системе.
- **Реальный кодовый дефект найден и исправлен**: ambiguous POST → дубль при повторе (§6). Фикс: client pending requestId (привязан к sessionVersion, переживает неудачу, освобождается успехом) + server in-memory dedup (TTL 10 мин, cap 500). Схема БД/формат v4 не тронуты.

## Гейты (последовательно, §9.4) — ВЫПОЛНЕНО

- [x] bun test: **1030/1030, exit 0** (70 файлов; +15 новых = 1015 + 15).
- [x] lint: **0 ошибок / 43 предупреждения** (Δ+1: новый `[save-api]` no-console в PUT — тот же намеренный паттерн stage-лога §4, что и 5 существующих).
- [x] bunx tsc --noEmit: exit 2, **63/55 — Δ0 к baseline** (только сдвиг строк game-store).
- [x] validate:all: exit 0.
- [x] gen-module-bus-map: дрейф из-за нового модуля → регенерирован, --check OK.
- [x] git diff --check: чисто.
- [x] §9.5 финальный UI round-trip после изменений: POST 508ms (requestId в логе) → PUT 200 → Load ✓; E2E-дедуп на реальном сервере ✓; тестовые сейвы удалены по собственным ID (GET → []).

## Evidence-правила

- Для каждого шага: время (UTC+MSK), seed/tick, POST/PUT, saveId, raw/body chars, encoding, serialize/encode/network ms, HTTP status, серверные логи, RSS/free, дубли в БД.
- Тестовые сейвы удалять только по собственным ID (DELETE), пользовательские не трогать.
- Логи: client `[save] OK`/`Save failed`, server `[save-api] POST start`/`decoded`.

## Fix-политика

Фикс только доказанной причины; НЕ увеличивать таймаут как единственный фикс; идемпотентность только если ambiguous-сценарий воспроизведён; регрессия — на реальный дефект; UI-ошибка понятная, isSaving восстанавливается, GameLoop восстанавливается ровно один раз.

## Гейты (в конце, последовательно)

bun test → lint → tsc (Δ vs baseline 63/55) → validate:all → module-bus --check (если карта затронута) → git diff --check → финальный UI round-trip.

## Артефакты

checkpoint `checkpoints/10_31_core_save_repro01.md`, worklog Task 74, STATUS-точечно, RCA-комментарий в #18, ответ в #27.
