# Чекпоинт: Блок 07 — Инженерное качество (TS strict + ESLint + PRNG port fix)

**Дата:** 2026-08-27
**Фаза:** Etap 2.5
**Статус:** `pending`
**Зависимости:** Блок 01 (T1 — тесты PRNG), желательно Блок 06 (modular integration)
**Оценка:** 2 дня

> 👉 Связанные:
> - [08_27_audit_summary.md](./08_27_audit_summary.md) §2.3 (PRNG port, ослабленные конфиги)
> - [08_27_gap_analysis.md](./08_27_gap_analysis.md) Gap-3, Gap-4
> - [08_27_block_01_stabilization.md](./08_27_block_01_stabilization.md) T7 (PRNG reference conformance test)
> - `src/core/prng.ts` (главный файл для правки порта)

---

## 1. Цель блока

Привести инженерное качество кода к production-стандарту:
1. **TypeScript strict mode** — `noImplicitAny: true`, `noUncheckedIndexedAccess: true`, `ignoreBuildErrors: false`.
2. **ESLint enforcement** — включить ключевые правила на `warn`-уровне (не блокировать, но видеть).
3. **PRNG port fix** — соответствие reference implementation Vigna `xoshiro256**`.

## 2. Контекст (audit §2.3)

### PRNG port — неверный
```typescript
// src/core/prng.ts:36-40 — ТЕКУЩИЙ (НЕВЕРНЫЙ) КОД:
const t = Math.imul(s1, 9);   // ← ДОЛЖНО БЫТЬ s1 << 17
this.state = [
  s0 ^ s3 ^ t,
  s0 ^ t,
  s2 ^ s0,   // ← ДОЛЖНО БЫТЬ s2 ^ s1 (по standard)
  s3 ^ s2,
];
```

Стандартный `xoshiro256**` (Vigna):
```typescript
// Reference (Vigna in Blackman/Vigna 2018):
const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9);
const t = s[1] << 17;
s[2] ^= s[0];
s[3] ^= s[1];
s[1] ^= s[2];
s[0] ^= s[3];
s[2] ^= t;
s[3] = rotl(s[3], 45);
return result;
```

### Конфиги намеренно ослаблены
- `next.config.ts:7` — `typescript: { ignoreBuildErrors: true }` (TS-ошибки не падают в билде)
- `tsconfig.json` — `noImplicitAny: false`, `noUncheckedIndexedAccess` не включён
- `eslint.config.mjs` — ВСЕ правила off

## 3. Задачи

### 3.1 TypeScript strict 🟢 (0.5 дня)

**Файлы:** `tsconfig.json`, `next.config.ts`

- `tsconfig.json`:
  - `noImplicitAny: true`
  - `noUncheckedIndexedAccess: true`
  - `strict: true` (если ещё не)
  - `noFallthroughCasesInSwitch: true`
  - `noImplicitReturns: true`
- `next.config.ts`:
  - `typescript: { ignoreBuildErrors: false }`

**После включения:** исправить выявленные TS-ошибки:
- Non-null assertions (`!`) — заменить на проверку `if (x === undefined) return`
- Implicit any в `function (x)` → `function (x: SomeType)`
- `noUncheckedIndexedAccess` выявит `array[i]` — нужны проверки `if (array[i] === undefined)`
- Известные pre-existing ошибки (см. `08_27_block_01_progress.md` §71):
  - `src/galaxy/generate-systems.ts:234, 244` — `Planet`/`never` тип → типизировать `Planet[]`

### 3.2 ESLint enforcement 🟢 (0.5 дня)

**Файл:** `eslint.config.mjs`

Включить правила на `warn` (не `error` — не блокировать, но видеть):
- `@typescript-eslint/no-explicit-any: warn`
- `@typescript-eslint/no-unused-vars: warn` (с `argsIgnorePattern: '^_'`)
- `react-hooks/exhaustive-deps: warn`
- `prefer-const: warn`
- `no-debugger: warn`
- `no-console: warn` (только для `console.log` в production-коде)

**В `package.json`:**
- `"lint": "next lint && eslint src/"`

### 3.3 PRNG port fix 🟢 (0.5 дня)

**Файл:** `src/core/prng.ts`

Сравнить с reference Vigna `xoshiro256**`. Исправить:
1. `const t = s1 << 17` (вместо `Math.imul(s1, 9)`)
2. Обновление состояния по стандарту Vigna (порядок операций).

```typescript
// Эталонная реализация (Blackman & Vigna, 2019):
nextU32(): number {
  const [s0, s1, s2, s3] = this.state;
  
  // Output function: xoshiro256** scrambling
  const result = Math.imul(this.rotl(Math.imul(s1, 5), 7), 9);
  
  // State update (Vigna reference)
  const t = s1 << 17;
  const newState = [
    s0 ^ s2,           // s[2] ^= s[0]; s[0] — это новое s[0]=s[2]^s[0]... 
    s1 ^ s2 ^ t,       // s[1] after both xor
    s2 ^ t,            // s[2] ^= t (после s[2]^=s[0] уже выполнено)
    this.rotl(s3, 45) ^ s3  // s[3] ^= s[1]; s[3] = rotl(s[3], 45)
  ];
  // Внимание: порядок обновления важен; свериться с reference C-кодом!
  
  this.state = newState;
  return result >>> 0;  // unsigned
}

private rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
```

**ВАЖНО:** Перед внедрением — найти эталонную C-реализацию Vigna (Blackman & Vigna, Scrambled Linear Pseudorandom Number Generators, 2018, ACM TOMS) и точно перенести порядок операций.

### 3.4 Статистический тест на равномерность 🟢 (0.5 дня)

**Файл:** `tests/prng-statistical.test.ts` (новый)

- Chi-square тест на равномерность распределения:
  - Сгенерировать 100 000 чисел в [0, 1).
  - Разбить на 100 корзин по 0.01.
  - Проверить chi-square < критического значения (α = 0.05).
- Тест на независимость 4-х `derive()` хешей:
  - Для каждого из 4-х derive (`arms`, `stars`, `planets`, `chemistry`): 10 000 чисел.
  - Корреляция Пирсона между сериями — < 0.05.
- Тест Birthday: вероятность совпадения в серии 65 536 чисел — близка к 1/65536 × 65536 = 1 (т.е. ровно одно ожидаемое совпадение).

## 4. Файлы

**Изменяемые:**
- `tsconfig.json` (3.1)
- `next.config.ts` (3.1)
- `eslint.config.mjs` (3.2)
- `package.json` (3.2)
- `src/core/prng.ts` (3.3)
- `src/galaxy/generate-systems.ts` (3.1 — исправить pre-existing TS errors)

**Создаваемые:**
- `tests/prng-statistical.test.ts` (3.4)

## 5. Критерий готовности

- [ ] `bun run build` — без TS-ошибок.
- [ ] `bun run lint` — без `error`-level; `warn` — допустимо.
- [ ] PRNG соответствует reference implementation Vigna (T7 тест зелёный).
- [ ] T1 (детерминизм) — остаётся зелёным.
- [ ] T7 (statistical uniformity) — зелёный.
- [ ] Pre-existing TS-ошибки в `generate-systems.ts` — исправлены.

## 6. Риски

| Риск | Митигация |
|------|-----------|
| Включение `noUncheckedIndexedAccess` ломает десятки файлов | Поэтапно: сначала включить в отдельных каталогах (tsconfig `include` с overrides), затем распространить. |
| `ignoreBuildErrors: false` выявляет десятки скрытых ошибок | Это нормально — фиксим по одной; правильно будет зафиксировать техдолг в чекпоинте для отдельных категорий. |
| PRNG port fix меняет выходные значения (другая последовательность для того же seed) | **КРИТИЧНО:** это сломает существующие сохранения, основанные на старом PRNG. Решение: либо bump version + миграция сохранений, либо оставить новый порт под feature-flag, либо принять, что все сейвы нужно регенерировать (новый seed). |

## 7. Связь с другими блоками

- **Блок 01 T1 + T7** — тесты PRNG (детерминизм + reference conformance) — выполняются в Блоке 01, зелёность проверяется в Блоке 07.
- **Блок 01 P1** (recipe ID unification) — детерминизм важен для валидации рецептов.
- **Блок 06** (modular integration) — после него можно безопасно менять PRNG, так как подписки обновляются через события.

## Изменённые/созданные файлы
- `checkpoints/08_27_block_07_engineering_quality.md` (этот файл)
