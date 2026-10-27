# План: R-44 — Этап 3б.1: постоянное состояние AI-фракций + save/load контракт

Дата: 2026-10-27 · Источник: владелец — «следующий план работ
plans/2026-10-27-r43-stage3b-roadmap.md» (ссылка на план срезов 3б = явный допуск на 3б.1;
условия старта среза выполнены: R-42 PASS/Issue #6 closed, 3а принята/Issue #5 closed,
предыдущий срез R-43 принят/Issue #7 closed).

**Границы среза 3б.1 (из roadmap R-43, Фазы 3–4):**

- ДЕЛАЕМ: типизированная сущность AI-фракции (stable EntityId, archetype docs/70 §2, config из
  AIConfig 3а, AI-only состояние: цели/бюджет/пороги — форма из реального GameState и Приложения A,
  НЕ дословно); расширение GameState (`aiFactions`-реестр) + расширение v3-схемы с версией;
  старые сейвы без AI-полей → предсказуемый дефолт; save→load→save→load; детерминированный
  setup/lifecycle (расстановка фракций по seed; повторная регистрация — явный отказ); тесты ДО кода.
- НЕ ДЕЛАЕМ: любые автоматические действия AI (экономика/наука/дипломатия/война — 3б.3+);
  per-faction perception (3б.2); Utility/executor (3б.3); GOAP/экспансия/военный/торговля
  (3б.4+); копии владений/ресурсов/флотов/технологий во фракции (referential-контракт);
  стартовые бонусы (только поле конфигурации); изменение поведения существующих систем;
  ms-бюджет §8.8/Web Worker; авто-создание фракций в newGame (меняло бы поведение существующей
  системы и ломало якоря sha256 R-39/R-41 — setup даётся явным API, подключение к newGame —
  отдельное решение владельца).

## Фактическая база (проверено при старте)

- Branch `main`, HEAD = `51e0b581e9e4135ef345fb2f955630a90f5854b1` == origin/main; дерево чисто.
- Issues по GitHub API: #1–#8 ВСЕ closed (#1/#2 duplicate, #3–#8 completed) — открытых нет.
- Ключевые факты кода: `GameState` без реестра фракций (types.ts:982–1000); owner-поля —
  StarSystem.owner/Planet.owner/Ship.owner/Fleet.owner + playerFactionId; сейв-путь
  serializeGameState (game-store.ts:392) → compactSaveV3 → JSON; deserializeGameState (:547) →
  expandSaveV3 → zod SerializedGameStateSchema (passthrough, raw используется как есть — дефолты
  схемы НЕ прокидываются) → rebuild Maps; AIModule — accessor без mutator, контроллеры = кэш,
  reset при game-created/game-loaded; r39-det-check строит GameState ЛИТЕРАЛОМ → новое ОБЯЗАТЕЛЬНОЕ
  поле сломало бы tsc-базу (86/71) → `aiFactions` ТОЛЬКО опциональным; serialize пустого/отсутствующего
  реестра НЕ должен писать ключей (якоря sha256 R-39/R-40/R-42/R-41 сохраняются побайтно).
- zod v4 (`z.record(k,v)`, `z.strictObject`); immer produce в сторе; PRNG — Xoshiro128StarStar
  с derive(name) (FNV-хеши имени + XOR состояния).

## Дизайн (свёртка решений)

1. `src/ai/factions.ts` (новый): `AI_FACTION_STATE_VERSION=1`; `AIArchetype`
   (CONFEDERATION|HEGEMONY|SYNDICATE|ORDER|SWARM — docs/70 §2.1–2.6); `AIBudgetAllocation`
   {economy,military,research,trade,diplomacy} — веса [0..1], сумма ≈1 (±1e-6);
   `AIFactionThresholds` {attack, colonization, maxColonizations} — из Приложения C
   (ATTACK_THRESHOLD / COLONIZATION_THRESHOLD / MAX_COLONIZATIONS; RETREAT_THRESHOLD с Infinity
   в персистентное состояние НЕ входит — Infinity не JSON-сериализуемо, представление решит 3б.4);
   `AIFactionGoal` {id, kind: AIIntentAction, createdAtTick} — в 3б.1 всегда [];
   `AIFactionState` {id, archetype, config: AIConfig, createdAtTick, budget, thresholds, goals} —
   БЕЗ полей владений/ресурсов/флотов/технологий (типо-уровневая гарантия + strict-схема на загрузке).
2. `createAIFactionRoster(seed, {count, difficulties, createdAtTick})` — детерминированный реестр:
   Xoshiro128StarStar(seed).derive('ai:setup:factions'), перемешивание архетипов (без повторов при
   N≤5), выбор сложности; ids `ai_faction_01..NN` (нуль-пад до 2 цифр → лексика == числовой порядок,
   cap count 1..8); вставка ключей в отсортированном порядке.
3. `withAIFactions(state, roster)` — чистая: отказ, если реестр уже непуст (дубликат-регистрация
   — явный отказ), без мутации входа; `validateAIFactionState`/`validateAIFactionRegistry`;
   `checkOwnershipIntegrity(state)` — каждый owner≠null разрешается в playerFactionId или ключ
   реестра (нарушения списком с путями).
4. `GameState.aiFactions?: Record<EntityId, AIFactionState>` (types.ts, type-only import из
   ai/factions — цикл только типовой, runtime-цикла нет: prng ни от чего не зависит).
5. Схема (game-state-schema.ts): `AIFactionStateSchema` (z.strictObject + refine суммы бюджета),
   реестр `z.record(z.string(), …)`, корень: `aiFactions?`, `aiFactionsV?` (int).
6. serializeGameState: aiFactions ВЫРЕЗАЕТСЯ из spread всегда; пишется обратно ТОЛЬКО при
   непустом реестре вместе с `aiFactionsV: 1` (ключи в конце, порядок детерминирован) —
   AI-less состояния сериализуются побайтно как прежде.
7. deserializeGameState: при наличии aiFactions — `aiFactionsV` обязан быть === 1 (иначе явная
   ошибка, как fmt≠3); маркер `aiFactionsV` из состояния удаляется (транспортный, не состояние);
   отсутствие полей → отсутствие aiFactions в GameState (предсказуемый дефолт — пустой реестр).
8. Store action `setupAIFactions(options?)`: отказ без gameState / при непустом реестре;
   roster по seed галактики, createdAtTick = текущий тик; commit через mediator.commitState
   (Pattern A-проводка, без нового mutator у AI-модуля).
9. AIModule.tick: `syncControllersFromState(state)` — отсортированные ключи реестра →
   attach (конфиг из faction.config) / идемпотентное обновление конфига; БЕЗ удаления
   контроллеров (ручные/тестовые сохраняются; удаление фракций — за пределами 3б.1);
   подписки НЕ растут (синхронизация тиковая, event-подписки прежние).

## Чеклист

- [x] Фаза 0: preflight (base SHA, issues, факты кода) — зафиксирован выше
- [x] Тесты ДО кода: tests/ai/factions.test.ts (валидация/IDs/roster-детерминизм/withAIFactions
      отказ-дубликата/integrity/round-trip ×2 побайтно/старый сейв/битая AI-секция/lifecycle/
      инертность при фракциях/синхронизация контроллеров) — прогон ДО реализации (красные:
      Cannot find module '@/ai/factions' — подтверждено), после реализации 36/36
- [x] Реализация: src/ai/factions.ts; GameState.aiFactions?; schema; serialize/deserialize;
      store action setupAIFactions; AIModule.syncControllersFromState (v0.2.0)
- [x] Гейты: bun test 900/900 (56 файлов, exit 0); lint 0 errors/38 warnings (Δ0);
      tsc exit 1 — 86/71 baseline Δ0, в файлах R-44 — 0 (НЕ именуется PASS); validate:all 4/4
- [x] Детерминизм ×3 ОТДЕЛЬНЫХ процесса: scripts/r44-factions-det-check.ts — roster 4bbf006e…87e2d,
      ai-snapshot 28f6069e…89b7, gamestate 011e2110…dd3e == ×3; регресс якорей == базам:
      r39 eaed801144…1cd0 ×3, r41 45c41c3c…fbd39 / 52fdea9e…ccd6 ×3
- [x] Браузерный smoke (schema-изменение сейва): New Galaxy 424242 → колонизация Xi Ursae I →
      тики → Save (БД tick 177) → reload → Load (177) → resume (→180) → 0 ошибок консоли;
      сейв удалён, GET /api/save = []
- [x] Документация: README.md, docs/STATUS.md, checkpoints/ROADMAP.md, docs/70-ai.md (только
      статус-заголовок), чекпоинт checkpoints/10_27_r44_ai_stage3b1_factions.md, этот план
- [x] worklog.md — append-only запись Task 50
- [x] git diff --check (whitespace OK)/--stat/полный diff/clean status; отдельный commit + push
      без force; отчёт владельцу (base/new SHA, файлы, гейты, ссылка на чекпоинт); приёмка — за владельцем

## Открытые вопросы

- Авто-создание фракций при newGame (и их количество/архетипы) — решение владельца; в 3б.1
  setup только явным API (см. границы). → Решение: НЕ менять newGame (якоря sha256 целы).
- Представление RETREAT_THRESHOLD (Infinity «никогда» не JSON-сериализуемо) — решение 3б.4
  (военный AI); в персистентном состоянии 3б.1 отсутствует. → Зафиксировано в чекпоинте.
- Бюджетные веса по архетипам — в docs/70 констант НЕТ (Приложение A задаёт только форму);
  в 3б.1 — документированные плейсхолдеры (конфигурационное поле, никем не читается в 3б.1);
  баланс — решение владельца при 3б.3.

## Результат

- Статус: done (в границах среза 3б.1; игровые действия — НЕТ, их не было в срезе)
- Реализация: src/ai/factions.ts (новый) + GameState.aiFactions? (опционально) + v3-секция
  aiFactions/aiFactionsV (strict-схема + версионный маркер) + setupAIFactions + AIModule
  syncControllersFromState (манифест 0.2.0, подписки прежние).
- Совместимость: старые сейвы/state — побайтно (serialize без инъекции ключей; дефолт
  «реестра нет»); битая AI-секция — явный отказ загрузки (версия/лишние поля/бюджет).
- Гейты: 900/900 тестов; lint 0/38; tsc 86/71 Δ0 (в R-44 — 0; НЕ PASS); validate:all 4/4;
  детерминизм ×3 процессов (roster/ai-snapshot/gamestate == ×3) + якоря r39/r41 == базам;
  браузерный smoke 0 ошибок, БД 0 сейвов. CI нет — не заявляется.
- Чекпоинт: checkpoints/10_27_r44_ai_stage3b1_factions.md; worklog Task 50.
- Приёмка 3б.1 — за владельцем; 3б.2–3б.4 и этап 4 не начинались.
