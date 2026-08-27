# Чекпоинт: Gap-анализ — сверка находок аудита с планами

**Дата:** 2026-08-27
**Фаза:** Post-audit, post-doc-fixes
**Статус:** `complete` (gap-анализ выполнен; недостающие блоки созданы)

> 👉 Контекст: пользователь поручил убедиться, что ничего из найденного в первом выводе аудита
> не потерялось при втором проходе (при создании детальных планов) и попало в планы/корректировки.
> Этот файл — результат сверки.

---

## 1. Что было в аудите (ИТОГОВЫЙ ОТЧЁТ 2026-08-27)

Аудит (1180 строк) содержал:
- **ЧАСТЬ 1** — краткая сводка
- **ЧАСТЬ 2** — детальное ревью кода:
  - §2.1 — Архитектура: modular-bus обойдён store (КРИТИЧНО #1)
  - §2.2 — Подтверждение багов P1–P7, C1–C5 (17 задач)
  - §2.3 — 17 дополнительных проблем (включая: атмосферные соединения бесполезны, PRNG port неверный, warehouse.ts мёртвые сравнения, ProductionItem IDs недетерминированы, API без валидации, Prisma single-JSON, processProductionQueue silent loss, a11y, ослабленные конфиги)
  - §2.4 — оценка качества по файлам
  - §2.5 — Top-10 критичных проблем
- **ЧАСТЬ 3** — аудит соответствия кода документации (включая 5 противоречий в §3.4)
- **ЧАСТЬ 4** — чекпоинты: что сделано/не сделано
- **ЧАСТЬ 5** — укрупнённый план (43 блока A–AQ, сгруппированных по Etap 2.5/3.0/3.5/4/5)
- **ЧАСТЬ 6** — 12 детальных планов (Блоки A–M)
- **ЧАСТЬ 7** — рекомендации по процессу
- **ЧАСТЬ 8** — следующие шаги

---

## 2. Состояние планов после первого прохода (commit 6312bfe + 37b2ef7)

В репозитории зафиксированы чекпоинты:
- ✅ `08_27_audit_summary.md` — сводка аудита (соответствует ЧАСТИ 1, 3, 4)
- ✅ `08_27_highlevel_plan.md` — укрупнённый план (соответствует ЧАСТИ 5, но упрощён — без Etap 4/5)
- ✅ `08_27_doc_fixes.md` — правка 5 противоречий (соответствует ЧАСТИ 3 §3.4)
- ✅ `08_27_block_01_stabilization.md` — Блок 1: P1–P7 + C1–C5 + T1–T6 (объединяет Блоки B,C,D,E,F,G,H,I,J из аудита)
- ✅ `08_27_block_02_fleet.md` — флот (соответствует Блоку M аудита)
- ✅ `08_27_block_03_research.md` — исследования (соответствует Блоку R/S аудита)
- ✅ `08_27_block_04_ai_faction.md` — AI-фракция (соответствует Блокам U–Z аудита)
- ✅ `08_27_block_05_processors.md` — переработчики (соответствует правке пункта 4 §3.4)
- ✅ `08_27_block_01_progress.md` — ход выполнения Блока 1 (P6, P7 сделаны)

**Дополнительные правки документации (commit 37b2ef7):**
- 54 malformed markdown-ссылки исправлены в 9 файлах `docs/*.md` (gap закрыт).

---

## 3. Найденные пропуски (gap-анализ)

При сверке находок аудита с сохранёнными планами обнаружены **9 критичных пропусков** — находки аудита, не попавшие ни в один из сохранённых планов:

### Gap-1: Modular-bus интеграция (audit Блок A) — КРИТИЧНО #1 🔴

**Аудит (§2.1, §2.5, ЧАСТЬ 6 Блок A):** «1500+ строк modular-bus архитектуры — декоративны. store дёргает engine напрямую. EconomyModule.tick() никогда не вызывается. gameBus.emit('production:complete', ...) уходит в пустоту.»

**Что было в аудите (Блок A, 4–6 дней):**
- Рефакторинг `game-store.ts`: удалить прямой импорт `processEconomyTick/buildOnHex/...`; в `tick()` вызывать `mediator.tick()`; в actions эмитить события `economy:build`, `economy:upgrade`, `economy:enqueue`, `economy:colonize` через `mediator.getBus().emit(...)`.
- Доработка `EconomyModule`: в `onTick(time)` вызывать `processEconomyTick`; подписки на `economy:build` → `buildOnHex` → emit `economy:building-constructed`.
- Доработка `GameLoop`: `start()` с `setInterval`, `tick()` эмитит `core:tick`.
- Удалить `setInterval` из `page.tsx` — пусть `GameLoop.start()` управляет интервалом.
- Удалить `event-bus.ts` (после миграции).

**В сохранённом плане:** Блок 01_stabilization C1 описывает только удаление `event-bus.ts` и перевод `engine.ts` на TypedEventBus — **частичный фикс**. Полная интеграция (store → mediator, подписки модулей, `GameLoop.start()`) — **НЕ описана**.

**Решение:** Создан **Блок 06_modular_integration** (см. `08_27_block_06_modular_integration.md`).

---

### Gap-2: Complex gas recipes — рецепты CO₂/CH₄/NH₃/H₂S/SO₂ 🔴

**Аудит (§2.3, §2.5 #2, ЧАСТЬ 6 Блок B/D):** «Атмосферные соединения бесполезны — газовые экстракторы копят CO₂/CH₄/NH₃/H₂S/SO₂ без рецепта переработки.»

**Что было в аудите:**
- CO₂ → C (2.7) + O (7.3), processor, время 150, энергия 4
- CH₄ → C (2.5) + H (7.5), processor, время 150, энергия 4
- NH₃ → N (5.6) + H (4.4), processor, время 150, энергия 4
- H₂S → H (2.5) + S (7.5), processor, время 150, энергия 4
- SO₂ → S (5.0) + O (5.0), processor, время 150, энергия 4

**В сохранённом плане:** Блок 01 P1 описывает «унификацию ID руд» — замену хардкода `Fe-ore`/`Ti-ore` на динамический lookup из `BakedGalaxyModel`. **Рецепты сложных газов НЕ упомянуты.**

**Решение:** Блок 01 дополнен подзадачей **P8 — Complex gas recipes** (см. дополнение к `08_27_block_01_stabilization.md`).

---

### Gap-3: PRNG xoshiro256** port correctness 🟡

**Аудит (§2.3, ЧАСТЬ 6 Блок K):** «PRNG port неверный: `const t = Math.imul(s1, 9)` ДОЛЖНО БЫТЬ `s1 << 17`; обновление состояния в другом порядке. Стандартный xoshiro256** (Vigna) использует `t = s[1] << 17` и иной порядок обновления.»

**В сохранённом плане:** Блок 01 T1 описывает тест PRNG на детерминизм (seed → одинаковая последовательность), но **НЕ тест на соответствие reference implementation Vigna**.

**Решение:** Блок 01 дополнен подзадачей **T7 — PRNG reference conformance test**; полная правка порта вынесена в **Блок 07_engineering_quality** (см. §4 ниже).

---

### Gap-4: Engineering quality — TS strict + ESLint enforcement + ignoreBuildErrors 🟡

**Аудит (§2.3, ЧАСТЬ 6 Блок K):**
- `next.config.ts:7` — `typescript: { ignoreBuildErrors: true }` (TS-ошибки не падают в билде)
- `tsconfig.json` — `noImplicitAny: false` (должно быть true), `noUncheckedIndexedAccess` не включён
- `eslint.config.mjs` — ВСЕ правила off (`no-explicit-any`, `no-unused-vars`, `exhaustive-deps`, `prefer-const`, `no-debugger`)
- «Линтинг не enforcement. 0 lint-ошибок — meaningless метрика.»

**В сохранённом плане:** Не покрыто. Блок 01 упоминает «lint=0» как критерий готовности, но не описывает **включение** правил.

**Решение:** Создан **Блок 07_engineering_quality** (TS strict + ESLint warn-level enforcement + PRNG port fix).

---

### Gap-5: warehouse.ts мёртвые сравнения ElementCategory vs ChemicalCharacter 🟡

**Аудит (§2.3):** `warehouse.ts:275-279` сравнивает `category === 'platinoid' || category === 'rare_earth'` — это значения `ChemicalCharacter`, а не `ElementCategory`. Эти две проверки **всегда false** — мёртвый код. Влияния нет (Ru/Rh/Pd имеют `category: 'noble'`, Y/La — `category: 'lanthanide'`), но код вводит в заблуждение.

**В сохранённом плане:** Не покрыто.

**Решение:** Блок 01 дополнен подзадачей **C6 — warehouse.ts dead comparisons cleanup**.

---

### Gap-6: ProductionItem IDs недетерминированы 🟡

**Аудит (§2.3):** `engine.ts:532` — `id: \prod_{Date.now()}}_{Math.random().toString(36).slice(2, 6)}`. Нарушает принцип детерминизма игры.

**В сохранённом плане:** Не покрыто.

**Решение:** Блок 01 дополнен подзадачей **P9 — ProductionItem deterministic IDs**.

---

### Gap-7: processProductionQueue silent recipe loss 🟡

**Аудит (§2.3):** `engine.ts:243-268` — если не хватает ресурсов, элемент удаляется из очереди (или сбрасывается в начало для repeat) **без эмитта события и без предупреждения**. Рецепт «теряется» молча.

**В сохранённом плане:** Не покрыто.

**Решение:** Блок 01 дополнен подзадачей **C7 — processProductionQueue emit on cancellation**.

---

### Gap-8: API routes без валидации 🟡

**Аудит (§2.3):** `/api/save/route.ts` (POST) и `/api/save/[id]/route.ts` (PUT) — нет zod-схемы (хотя zod в package.json). `name`, `seed`, `state`, `tick` — любой тип. Можно положить `state > 1 ГБ` → DoS. Нет rate limiting. Нет аутентификации (next-auth в deps, но не настроен).

**В сохранённом плане:** Не покрыто.

**Решение:** Создан **Блок 08_security_data** (API validation + rate limiting + Prisma schema).

---

### Gap-9: Prisma schema — один JSON blob 🟡

**Аудит (§2.3):** `schema.prisma` — одна таблица `GameSave`, всё состояние в JSON `state`. Нет индексов на `seed`, `updatedAt`, `name`. Нет `version` для миграций. Невозможно SQL-запросом найти «все rocky планеты». `deserializeGameState` использует ad-hoc обратную совместимость — не масштабируется.

**В сохранённом плане:** Не покрыто.

**Решение:** Включено в **Блок 08_security_data**.

---

### Gap-10: a11y — accessibility 🟡

**Аудит (§2.3):**
- Кнопки без `aria-label` (zoom controls в `galaxy-map.tsx:458-463`)
- Tab buttons без `role="tab"`, `aria-selected`, `aria-controls` (`planet-view.tsx:132-149`)
- SVG без `role="img"` / `aria-label` (карта галактики, гекс-сетка)
- `confirm()` в `game-layout.tsx:86` — блокирующий native dialog вместо `AlertDialog` из shadcn/ui

**В сохранённом плане:** Не покрыто.

**Решение:** Блок 01 дополнен подзадачей **C9 — a11y improvements**.

---

### Gap-11: nuclear_reactor vs nuclear_plant rename 🟢

**Аудит (§3.2):** `nuclear_reactor` (40-buildings.md §10.1) vs `nuclear_plant` (buildings.ts:122). Переименовать в коде.

**В сохранённом плане:** Зафиксировано в `08_27_audit_summary.md` §3.2 как ID-N1, **но action item отсутствует**.

**Решение:** Блок 01 дополнен подзадачей **C8 — nuclear_reactor rename**.

---

## 4. Решения по новым блокам

| Gap | Решение | Где зафиксировано |
|-----|---------|-------------------|
| Gap-1 (modular-bus integration) | Новый Блок 06 | `08_27_block_06_modular_integration.md` |
| Gap-2 (complex gas recipes) | Подзадача P8 в Блок 01 | дополнение к `08_27_block_01_stabilization.md` |
| Gap-3 (PRNG port correctness) | Подзадача T7 + Блок 07 | Блок 01 + `08_27_block_07_engineering_quality.md` |
| Gap-4 (engineering quality) | Новый Блок 07 | `08_27_block_07_engineering_quality.md` |
| Gap-5 (warehouse dead comparisons) | Подзадача C6 в Блок 01 | дополнение к `08_27_block_01_stabilization.md` |
| Gap-6 (ProductionItem IDs) | Подзадача P9 в Блок 01 | дополнение к `08_27_block_01_stabilization.md` |
| Gap-7 (silent recipe loss) | Подзадача C7 в Блок 01 | дополнение к `08_27_block_01_stabilization.md` |
| Gap-8 (API validation) | Новый Блок 08 | `08_27_block_08_security_data.md` |
| Gap-9 (Prisma schema) | Включено в Блок 08 | `08_27_block_08_security_data.md` |
| Gap-10 (a11y) | Подзадача C9 в Блок 01 | дополнение к `08_27_block_01_stabilization.md` |
| Gap-11 (nuclear rename) | Подзадача C8 в Блок 01 | дополнение к `08_27_block_01_stabilization.md` |

---

## 5. Финальная карта блоков (обновлённая)

```
Этап 2.5 (стабилизация):
  Блок 01 (P1–P9, C1–C9, T1–T7) — все стабилизационные правки
  Блок 06 (modular-bus integration) — КРИТИЧНО #1
  Блок 07 (engineering quality: TS strict + ESLint + PRNG port)
  Блок 08 (security + data: API validation + Prisma redesign)

Этап 2.6 (новый):
  Блок 05 (переработчики — универсальный→специализированный)

Этап 3.0:
  Блок 02 (флот) + Блок 03 (исследования)

Этап 3.5:
  Блок 04 (AI-фракция MVP — 5 базовых)

Этап 4+:  будущие блоки (см. audit ЧАСТЬ 5.1: AB–AI, AJ–AQ)
```

## 6. Порядок внедрения (обновлённый)

```
Фаза 1 (последовательно):
  Блок 06 (modular integration) — критичный архитектурный долг #1
  ↓
Фаза 2 (часть Блока 01, параллельно с Блоком 06):
  P1 + P8 (recipe ID + complex gas recipes) + P5 + C2 + C3 + C6 + C8
  ↓
Фаза 3 (Блок 01 architecture, после Блока 06):
  P2 (immutable store) + C1 (delete deprecated bus — после Блока 06) + C4 + C5
  ↓
Фаза 4 (Блок 01 UI):
  P3 + P4 + P9 + C7 + C9
  ↓
Фаза 5 (Блок 01 тесты + Блок 07):
  T1–T7 (включая PRNG port conformance)
  Блок 07 (TS strict + ESLint + PRNG port fix)
  ↓
Фаза 6 (Блок 08 security/data):
  API validation + Prisma schema
  ↓
Фаза 7 (Etap 2.6 + Etap 3.0):
  Блок 05 (переработчики) + Блок 02 (флот) + Блок 03 (исследования)
  ↓
Фаза 8 (Etap 3.5):
  Блок 04 (AI-фракция MVP)
```

---

## Изменённые файлы
- `checkpoints/08_27_gap_analysis.md` (этот файл)
- `checkpoints/08_27_block_06_modular_integration.md` (новый)
- `checkpoints/08_27_block_07_engineering_quality.md` (новой)
- `checkpoints/08_27_block_08_security_data.md` (новый)
- `checkpoints/08_27_block_01_stabilization.md` (дополнение P8/P9/C6/C7/C8/C9/T7)
- `checkpoints/08_27_highlevel_plan.md` (обновление с Блоками 06–08)
