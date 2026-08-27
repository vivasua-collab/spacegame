# Чекпоинт: Блок 08 — Security & Data (API validation + Prisma schema)

**Дата:** 2026-08-27
**Фаза:** Etap 2.5 (security/data tech debt)
**Статус:** `pending`
**Зависимости:** Блок 01 (P2 immutable store — для стабилизации формата state перед schema)
**Оценка:** 2–3 дня

> 👉 Связанные:
> - [08_27_audit_summary.md](./08_27_audit_summary.md) §2.3 (API routes, Prisma schema)
> - [08_27_gap_analysis.md](./08_27_gap_analysis.md) Gap-8, Gap-9
> - `prisma/schema.prisma`, `src/app/api/save/*` (главные файлы)

---

## 1. Цель блока

Привести persistence и API-слой к production-стандарту:
1. **API validation** — zod-схемы для POST/PUT `/api/save`, rate limiting, опциональная аутентификация.
2. **Prisma schema redesign** — индексы, version, поля для SQL-запросов; завершение схемы сохранений.
3. **State validation** — на входе `deserializeGameState` проверять структуру.

## 2. Контекст (audit §2.3)

### API routes без валидации
- `/api/save/route.ts` (POST) и `/api/save/[id]/route.ts` (PUT)
- Нет zod-схемы (хотя zod в package.json).
- `name`, `seed`, `state`, `tick` — любой тип.
- Можно положить `state > 1 ГБ` → DoS.
- Нет rate limiting.
- Нет аутентификации (next-auth в deps, но не настроен).

### Prisma schema — один JSON blob
- `schema.prisma` — одна таблица `GameSave`, всё состояние в JSON `state`.
- Нет индексов на `seed`, `updatedAt`, `name`.
- Нет `version` для миграций.
- Невозможно SQL-запросом найти «все rocky планеты».
- `deserializeGameState` использует ad-hoc обратную совместимость — не масштабируется.

## 3. Задачи

### 3.1 Zod-схема для API 🟢 (0.5 дня)

**Файлы:** `src/app/api/save/route.ts`, `src/app/api/save/[id]/route.ts`, новый `src/lib/schemas/save-schema.ts`

```typescript
// src/lib/schemas/save-schema.ts
import { z } from 'zod';

export const SaveCreateSchema = z.object({
  name: z.string().min(1).max(100),
  seed: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  state: z.string().max(50_000_000).optional(), // 50 МБ max
  tick: z.number().int().nonnegative().max(10_000_000).optional(),
});

export const SaveUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  state: z.string().max(50_000_000),
  tick: z.number().int().nonnegative().max(10_000_000),
});

export type SaveCreateInput = z.infer<typeof SaveCreateSchema>;
export type SaveUpdateInput = z.infer<typeof SaveUpdateSchema>;
```

В `route.ts`:
```typescript
const parsed = SaveCreateSchema.safeParse(await req.json());
if (!parsed.success) {
  return Response.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 });
}
// parsed.data — типизированный объект
```

### 3.2 Rate limiting 🟢 (0.5 дня)

**Файл:** новый `src/lib/rate-limit.ts` (in-memory token bucket)

- Token bucket: 10 запросов в минуту на IP (для `/api/save`).
- В `route.ts`: проверять rate-limit перед обработкой.
- Ответ 429 Too Many Requests с `Retry-After` header.

```typescript
// src/lib/rate-limit.ts
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

export function checkRateLimit(key: string, maxTokens = 10, refillPerMinute = 10): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: maxTokens, lastRefill: now };
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(maxTokens, bucket.tokens + (elapsed / 60000) * refillPerMinute);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
```

### 3.3 Аутентификация (опционально, через next-auth) 🟡 (1 день — если нужно)

**Файлы:** `src/app/api/auth/[...nextauth]/route.ts` (новый), `src/lib/auth.ts` (новый)

- Credentials provider с одним admin-пользователем (для dev-режима).
- В `route.ts`: `getServerSession(authOptions)` — проверять сессию.
- Без аутентификации → 401 Unauthorized.
- Для dev: env-переменные `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (bcrypt).

**Решение:** для текущего MVP — отложить auth на Etap 4 (мультиплеер), но заложить структуру (rate-limit достаточно для dev).

### 3.4 Prisma schema redesign 🟢 (1 день)

**Файл:** `prisma/schema.prisma`

Текущая схема:
```prisma
model GameSave {
  id        String   @id @default(cuid())
  name      String
  seed      String
  state     String   // JSON blob
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Новая схема:
```prisma
model GameSave {
  id        String   @id @default(cuid())
  name      String
  seed      String   @index
  state     String   // JSON blob — backward compat
  version   Int      @default(1)  // для миграций сериализации
  tick      Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt @index

  @@index([name])
  @@index([updatedAt])
  @@index([seed, updatedAt])
}

// Лёгкая таблица для поиска по системам (без раскрытия всего state)
model GameSaveSystemIndex {
  id          String   @id @default(cuid())
  saveId      String
  systemId    String
  systemType  String   // 'spiral_arm', 'core', etc.
  starType    String   // 'G', 'K', etc.
  
  save        GameSave @relation(fields: [saveId], references: [id], onDelete: Cascade)
  
  @@index([saveId])
  @@index([systemType])
  @@index([starType])
}
```

**Миграция:** `bun run db:push` после правки schema.

### 3.5 State validation в `deserializeGameState` 🟢 (0.5 дня)

**Файл:** `src/stores/game-store.ts` (или `src/lib/serialization.ts`)

- Zod-схема для `GameState` (рекурсивная, с проверкой типов Planet/System/Resources).
- На входе `deserializeGameState(json)`: `GameStateSchema.parse(parsed)` → если не валидно — throw с информативной ошибкой.
- `version` в схеме: `if (version === 1) migrateV1toV2(parsed)`.

### 3.6 Тесты 🟢 (0.5 дня)

- `tests/api-save.test.ts` — invalid payload → 400.
- `tests/api-save.test.ts` — valid payload → 200 + создаётся запись.
- `tests/api-save.test.ts` — rate limit: 11-й запрос → 429.
- `tests/serialization.test.ts` — `GameStateSchema.parse(invalidJson)` throws.
- `tests/serialization.test.ts` — миграция v1→v2 сохраняет целостность данных.

## 4. Файлы

**Изменяемые:**
- `prisma/schema.prisma` (3.4)
- `src/app/api/save/route.ts` (3.1, 3.2)
- `src/app/api/save/[id]/route.ts` (3.1, 3.2)
- `src/stores/game-store.ts` или `src/lib/serialization.ts` (3.5)

**Создаваемые:**
- `src/lib/schemas/save-schema.ts` (3.1)
- `src/lib/schemas/game-state-schema.ts` (3.5)
- `src/lib/rate-limit.ts` (3.2)
- `tests/api-save.test.ts` (3.6)
- `tests/serialization.test.ts` (3.6 — extends Блок 01 T5)

## 5. Критерий готовности

- [ ] POST `/api/save` без `name` → 400 с информативным zod-сообщением.
- [ ] POST `/api/save` с `state` > 50 МБ → 400.
- [ ] 11-й запрос в минуту с одного IP → 429 + `Retry-After`.
- [ ] Prisma schema имеет индексы на `seed`, `updatedAt`, `name`.
- [ ] `bun run db:push` применяет миграцию без потери данных.
- [ ] `GameStateSchema.parse(invalidJson)` throws с понятной ошибкой.
- [ ] Тесты зелёные.

## 6. Риски

| Риск | Митигация |
|------|-----------|
| Zod-схема для `GameState` сложна (рекурсивные типы Planet/System) | Использовать `z.lazy()` для рекурсии; начать с валидации верхнего уровня, глубокую валидацию — на Etap 4. |
| Prisma миграция `version` поля ломает существующие сейвы | При `version = undefined` — считать `version = 1` и применить миграцию v1→v2 (на лету). |
| Rate limiting в memory не персистентно между инстансами | Для dev/тест — ок. Для production (Etap 4) — Redis backend. |
| State size limit 50 МБ может быть маловат для huge-галактик | Замерить реальный размер huge-галактики (500 систем × 127 гексов); при необходимости — увеличить лимит или компрессия. |

## 7. Порядок внедрения

```
3.1 (zod-схема save) ──► 3.2 (rate-limit) ──► 3.6 (тесты API)
                                                          │
3.4 (prisma schema) ──► 3.5 (state validation) ──► 3.6 (тесты сериализации)
                                                          │
                                                          ▼
                                                  (полная зелёность)
```

## 8. Связь с другими блоками

- **Блок 01 P2** (immutable store) — стабилизирует формат state перед сериализацией.
- **Блок 01 T5** (сериализация тест) — расширяем в Блоке 08.
- **Блок 06** (modular integration) — после него state-формат стабилен.

## Изменённые/созданные файлы
- `checkpoints/08_27_block_08_security_data.md` (этот файл)
