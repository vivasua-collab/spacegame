# Чекпоинт: Блок 4 — AI-фракция MVP

**Дата:** 2026-08-27
**Фаза:** Etap 3.5
**Статус:** `pending`
**Зависимости:**
- Блок 1 (стабилизация P1–P7 + тесты) — без него ИИ-агент не сможет верифицировать изменения тестами.
- Блок 2 (флот MVP) — военный AI опирается на корабли, корпуса, модули, приказы флота (`Fleet`, `FleetOrder`, `Ship`).
- Блок 3 (исследования MVP) — научный AI и `tech_advantage_bonus` Ордена требуют `TechBranch`/`ResearchProject`.

> **Ссылки:**
> - [08_27_audit_summary.md](./08_27_audit_summary.md) §2.6, §3.1, §4.2
> - [08_27_highlevel_plan.md](./08_27_highlevel_plan.md) — Этап 3.5
> - [08_27_doc_fixes.md](./08_27_doc_fixes.md) §пункт 1 — решение владельца: **5 базовых AI-фракций, расширяемо** (по умолчанию в партии 3 из 5)
> - `docs/70-ai.md` — основная спецификация (~2350 строк), источник истины
> - `docs/00-ARCHITECTURE.md` §1.2/§1.4 (после правок из `08_27_doc_fixes.md`): «**5 базовых AI-фракций (расширяемо)**»
> - `docs/architecture/modular-bus.md` — паттерн модулей

---

## 1. Цель блока

Один функциональный блок — **AI-фракция MVP**: в игре присутствуют **5 базовых AI-фракций** (Конфедерация, Хегемония, Синдикат, Орден, Рой; расширяемо). По умолчанию в партии действует 3 из 5 (настраивается при старте). Каждая фракция:
- владеет звёздными системами, планетами, постройками;
- добывает ресурсы и строит здания (экономический AI);
- колонизирует пригодные системы (экспансионистский AI);
- формирует флоты и оценивает угрозы (военный AI, зависит от Блока 2);
- ведёт дипломатию: отношения в диапазоне −100…+100, торговля, союзы, войны, ультиматумы (дипломатический AI);
- принимает решения через **гибрид Utility AI + GOAP** (§1.3.3 `70-ai.md`).

MVP закрывает элементы «MVP (Этап 3: одна AI-фракция)» и частично «V1.0 (Этап 4: все фракции)» из чеклиста в `70-ai.md` §приложение D — с явным указанием тех пунктов, которые остаются на Etap 4.

**Ключевое правило** (`70-ai.md` §1.1): AI работает на тех же правилах, что и игрок. У AI нет доступа к скрытой информации, нет бесплатных ресурсов, нет мгновенного строительства. Исключение — стартовые бонусы на высоких уровнях сложности (`70-ai.md` §7).

---

## 2. Спецификация

Подробная спецификация: **`docs/70-ai.md`** (источник истины, 2350 строк).

| Раздел 70-ai.md | Покрывает | Подзадача |
|---|---|---|
| §1.1 Фундаментальные принципы | AI = «империя», те же правила что у игрока | A1 |
| §1.2 Архитектурная схема | Perception → WorldModel → GoalQueue → DecisionEngine → ActionExecutor | A1, A6 |
| §1.3.1 GOAP | формальная модель `GOAPAction { id, preconditions, effects, cost, execute }` | A6 |
| §1.3.2 Utility AI | формула `utility = need × urgency × feasibility` | A2, A6 |
| §1.3.3 Гибридная архитектура | `utility_with_plan = base_utility × (1 + plan_alignment_bonus)`; бонусы целей GOAP | A6 |
| §1.4 Цикл обновления | стратегический 100 тиков, тактический 10, реактивный 1, дипломатический 50 | A7 |
| §2 Типы фракций | 5 базовых: Конфедерация/Хегемония/Синдикат/Орден/Рой; по умолчанию 3 из 5 | A1, §6 ниже |
| §3 Экономический AI | оценки потребностей, приоритеты строительства, торговля, бюджетирование | A2 |
| §4 Военный AI | оценка угроз, формирование флотов, решение об атаке/отступлении, выбор целей | A4 |
| §5 Дипломатический AI | шкала −100..+100, начальная матрица отношений, факторы влияния, дипломатические действия | A5 |
| §6 Экспансионистский AI | формула `colonization_score`, скорость колонизации, максимум одновременных | A3 |
| §7 Уровни сложности | Easy/Normal/Hard/Insane (модификаторы и поведение) | A1 |
| §8 Оптимизация | зоны обновления ACTIVE/VISIBLE/DISTANT/REMOTE, упрощённая модель, ленивое вычисление, кэш, пакетная обработка | A7 |
| Приложение A | структура данных `AIFaction` | A1 |
| Приложение B | формулы-сводка | A2–A6 |
| Приложение C | `AI_CONSTANTS` (пороги атак, отступления, частоты, кэш, зоны, торговля, колонизация) | A1, A7 |
| Приложение D | чеклист MVP/V1.0/V1.5 | §10 Критерии готовности |

---

## 3. Текущее состояние кода

### 3.1 Что есть (по результатам аудита §2.6, §3.1)

- `src/core/typed-event-bus.ts`, `src/core/module-registry.ts`, `src/core/game-mediator.ts` — модульная шина и реестр с топосортом зависимостей (✅ Блок 1 архитектуры завершён предыдущим агентом).
- `src/core/events.ts` — каталог 60+ типизированных событий, **включая секцию `AIEvents`** с тремя событиями:
  ```ts
  // src/core/events.ts:115-121
  export interface AIEvents {
    'ai:decision': { factionId: EntityId; action: string; targetId?: EntityId };
    'ai:colony-founded': { factionId: EntityId; planetId: EntityId };
    'ai:fleet-sent': { factionId: EntityId; fleetId: EntityId; purpose: string };
  }
  ```
  Эти три события слишком укрупнены для полноценной дипломатии/торговли — нужны дополнительные (см. §5).
- `src/core/module-types.ts` — контракт `IGameModule`, `ModuleId` уже содержит `'ai'` (`module-types.ts:15-25`), `PRIORITY.REACTION = 30` зарезервирован для AIModule (строка 145 — «AIModule анализирует тик»).
- `src/core/types.ts`:
  - **нет** `FactionType`, `AIFaction`, `GOAPAction`, `GOAPGoal`, `WorldState`, `AIState`, `DifficultyLevel`, `BudgetAllocation`, `DiplomaticAgreement`, `FactionRelation`.
  - есть `Ship`, `Fleet`, `FleetOrder` (строки 432–455) — готовы к использованию военным AI.
  - есть `Planet.owner: EntityId | null` (строка 317) и `StarSystem.owner: EntityId | null` (строка 420) — для владений AI.
  - есть `GameState.playerFactionId: EntityId` (строка 477) — но **нет** `aiFactions: AIFaction[]`, **нет** `difficulty: DifficultyLevel`, **нет** `activeFactionIds: EntityId[]`.
- `src/stores/game-store.ts` — Zustand-стор инициализирует только `EconomyModule` и `GalaxyModule` (`game-store.ts:101-108`). AIModule **не подключён**. Также в `game-store.ts:233-251` `tick()` обрабатывает только экономику колонизированных планет игрока — **AI-планеты не тикают**.
- `src/economy/engine.ts` — `processEconomyTick`, `buildOnHex`, `colonizePlanet` и т.д. — функции, которые AI должен вызывать для своих планет (через шину `economy:build`, `economy:colonize`, `economy:enqueue`).

### 3.2 Чего нет (определяет объём блока)

- ❌ Каталога фракций: нет `src/ai/` каталога, нет `src/data/factions.ts`.
- ❌ Типов `FactionType`, `AIFaction`, `GOAPAction`/`GOAPGoal`/`WorldState`, `AIState`, `DifficultyLevel`/`DifficultyModifiers`, `BudgetAllocation`, `DiplomaticAgreement`, `FactionRelationMatrix`.
- ❌ Реализации Utility AI, GOAP-планировщика, Perception/WorldModel.
- ❌ Экономического/военного/дипломатического/экспансионистского AI.
- ❌ Оптимизации: зон обновления, упрощённой модели прироста, кэша решений, ленивого выбора, пакетной обработки.
- ❌ Интеграции в `game-store.ts` и регистрации `AIModule` в медиаторе.
- ❌ UI: нет `faction-panel.tsx`, нет `diplomacy-view.tsx`, нет `faction-relations-matrix.tsx`, нет режима выбора фракций при старте.
- ❌ Событий: `ai:war-declared`, `ai:relation-changed`, `ai:trade-offered`, `ai:strategic-plan-updated`, `ai:budget-reallocated`, `ai:colonization-launched`, `ai:ultimatum-issued` и др.

---

## 4. Подзадачи (детально)

> Каждая подзадача содержит: цель, файлы для изменения/создания, ключевые функции/типы, оценку времени, ссылку на раздел `70-ai.md`. Оценки — в идеальных днях (1 день ≈ 6–8 ч фокус-работы ИИ-агента).

---

### A1. Модель AI-фракции (ресурсы, территории, цели, стратегия) — 5 фракций

**Цель:** Завести типы и каталог 5 базовых AI-фракций; интегрировать `aiFactions: AIFaction[]` в `GameState`; обеспечить создание 3 из 5 (по умолчанию) при `newGame`.

**Файлы:**
- 🆕 `src/ai/faction-types.ts` — все типы AI (см. ниже).
- 🆕 `src/ai/faction-definitions.ts` — данные 5 фракций (стартовые параметры, бюджеты, пороги, приоритеты строительства) — перенос таблиц `70-ai.md` §2.2–§2.6 в код.
- 🆕 `src/ai/ai-constants.ts` — `AI_CONSTANTS` из Приложения C `70-ai.md` (пороги атак, отступления, частоты циклов, кэш, зоны, торговля, колонизация).
- 📝 `src/core/types.ts` — расширить `GameState`:
  ```ts
  // Новые поля GameState:
  aiFactions: AIFaction[];          // все 5 фракций (даже если часть не active)
  activeFactionIds: EntityId[];    // подмножество, активно в текущей партии
  difficulty: DifficultyLevel;      // Easy|Normal|Hard|Insane
  ```
  Импортировать типы из `@/ai/faction-types`.
- 📝 `src/core/game-mediator.ts` — в `newGame()` инициализировать `aiFactions` (создать 5, но `activeFactionIds` = первые 3 по умолчанию; в конфиге `GalaxyGenConfig` добавить опциональное поле `aiFactionCount?: 1..5` и `aiFactionTypes?: FactionType[]`).
- 📝 `src/stores/game-store.ts` — `GameStore.newGame()` принимает `aiFactionTypes?`/`aiFactionCount?`/`difficulty?`; `serializeGameState`/`deserializeGameState` корректно сериализуют `aiFactions`/`activeFactionIds`/`difficulty`.

**Ключевые типы (в `src/ai/faction-types.ts`):**
```ts
// 70-ai.md §2.1
export type FactionType = 'CONFEDERATION' | 'HEGEMONY' | 'SYNDICATE' | 'ORDER' | 'SWARM';

export type FactionArchetype =
  | 'balanced'      // Конфедерация
  | 'military'      // Хегемония
  | 'trade'         // Синдикат
  | 'science'       // Орден
  | 'xeno_swarm';   // Рой

// 70-ai.md §1.3.1 — GOAP
export interface WorldState {
  [key: string]: number | boolean;
}
export interface GOAPAction {
  id: string;
  preconditions: Partial<WorldState>;
  effects: Partial<WorldState>;
  cost: number;
  execute: (faction: AIFaction) => ActionResult;
}
export interface GOAPGoal {
  id: string;
  targetState: Partial<WorldState>;
  priority: number;
  alignBonus: number; // для utility_with_plan (70-ai.md §1.3.3)
}
export interface ActionResult {
  success: boolean;
  emittedEvents: EventName[];
}

// 70-ai.md §7 — сложность
export type DifficultyLevel = 'easy' | 'normal' | 'hard' | 'insane';
export interface DifficultyModifiers {
  production: number;       // ×1.0 на normal
  research: number;
  trade: number;
  startingResources: number;
  attackThresholdMul: number;
  retreatThresholdMul: number;
  tacticalCycleTicks: number; // 20/10/5/1 (70-ai.md §7.1)
  strategicPlanning: boolean;
  fleetCoordination: boolean;
  economicWarfare: boolean;
  deception: boolean;
  adaptation: boolean;
  decisionNoise: number; // 0.5 на easy (top-50%), 0 — best
}

// 70-ai.md Приложение A
export interface AIFaction {
  id: EntityId;
  type: FactionType;
  archetype: FactionArchetype;
  name: string;
  color: string; // для UI

  // Владения
  ownedSystemIds: EntityId[];
  capitalSystemId: EntityId;

  // Ресурсы (планетные ресурсы живут в Planet.resources; тут агрегаты для fast access)
  resourceIncome: Map<string, number>;
  resourceConsumption: Map<string, number>;

  // Флот — ссылки на gameState.fleets через owner
  fleetIds: EntityId[];

  // Технологии — depends on Block 3
  researchedTechs: Map<string, number>; // techId → level
  currentResearchId: string | null;

  // Дипломатия
  relations: Map<EntityId, number>;          // factionId → [-100..100]
  activeAgreements: DiplomaticAgreement[];

  // AI-состояние
  activeGoals: GOAPGoal[];
  decisionCache: Map<DecisionType, DecisionCache>;
  lastStrategicTick: number;
  lastTacticalTick: number;
  lastDiplomaticTick: number;
  lastExpansionTick: number;

  // Бюджет
  budgetAllocation: BudgetAllocation;
  militaryReadiness: number;  // 0..1
  threatLevel: number;        // 0..1
  economicStability: number;  // 0..1

  // Сложность
  difficulty: DifficultyLevel;
  difficultyModifiers: DifficultyModifiers;

  // Зона обновления — A7
  updateZone: UpdateZone;
}

export type DecisionType = 'economy' | 'military' | 'diplomacy' | 'expansion';

export interface DecisionCache {
  lastEvaluationTick: number;
  situationHash: string;
  decision: { actionId: string; utility: number; payload?: unknown };
}

export interface BudgetAllocation {
  economy: number;
  military: number;
  science: number;
  trade: number;
  reserve: number;
}

export interface DiplomaticAgreement {
  id: EntityId;
  type: 'trade' | 'non_aggression' | 'alliance' | 'ceasefire' | 'embargo' | 'tech_exchange';
  parties: [EntityId, EntityId];
  startTick: number;
  endTick?: number;
  terms?: Record<string, unknown>;
}

export type UpdateZone = 'active' | 'visible' | 'distant' | 'remote';
```

**Ключевые функции:**
- `createAIFaction(type: FactionType, difficulty: DifficultyLevel, startSystemIds: EntityId[]): AIFaction` — фабрика (использует `faction-definitions.ts`).
- `initFactionsForNewGame(config): AIFaction[]` — создаёт 5 фракций, размещает стартовые системы (для фракций с `startSystems=2..4` выделить свободные `StarSystem` в галактике и установить `system.owner = faction.id`, пометить планеты как колонизированные через `colonizePlanet()`).
- `getInitialRelations(factions: AIFaction[]): Map<string, number>` — строит матрицу из §5.1 `70-ai.md`.
- `getFaction(id: EntityId, state: GameState): AIFaction | undefined`.

**Оценка:** 3–4 дня.
**Ссылка:** `70-ai.md` §1.1, §1.2, §2.1–§2.7, §7, Приложения A, C.

---

### A2. Экономический AI (приоритеты строительства, управление ресурсами)

**Цель:** Реализовать Utility AI для экономических решений: что строить, что производить, что торговать, как распределять бюджет — по формулам §3 `70-ai.md`.

**Файлы:**
- 🆕 `src/ai/economy-ai.ts` — основной модуль экономики AI.
- 🆕 `src/ai/utility.ts` — общие функции `need()`, `urgency()`, `feasibility()` и `utility()` (используется также военным/дипломатическим AI).
- 🆕 `src/ai/world-model.ts` — `WorldModel` (агрегированное состояние мира, которое AI строит из `GameState` для быстрого доступа: доходы/расходы по ресурсам, текущие угрозы, свободные слоты зданий и т.д.).

**Ключевые функции:**
- `evaluateEconomyNeeds(faction: AIFaction, state: GameState): Map<string, number>` — реализация `need_score(R) = deficit(R) × weight(R)` из §3.1 `70-ai.md`, с матрицей весов по фракциям (Конфедерация: 1.0, Хегемония: компоненты × 2.0/научные × 0.5, Синдикат: редкие × 2.0, Орден: научные × 2.5, Рой: базовые × 1.5).
- `selectNextBuilding(faction, planet): BuildingDef | null` — реализация `selectNextBuilding()` из §3.2: цикл по `BUILDING_MAP`, фильтр по слотам, расчёт `utility(building) = need × urgency × feasibility` (§3.2 формулы). Использует `BUILDING_MAP` из `src/data/buildings.ts` и `BuildingDef` из `src/core/types.ts`.
- `desiredBuildingCount(planet, buildingType, faction): number` — из §3.2 формулы `desiredCount()`.
- `allocateBudget(faction, state): BudgetAllocation` — §3.4 `allocateBudget()` с модификаторами по угрозе/кризису/миру/угрозе столице.
- `generateTradeProposals(faction, state): TradeProposal[]` — §3.3 `generateTradeProposals()`; emit `ai:trade-offered` для каждого предложения.
- `evaluateTradeProposal(proposal, faction): 'ACCEPT' | 'COUNTER_OFFER' | 'REJECT'` — §3.3 `evaluateTradeProposal()`.
- `calculateSellPrice`/`calculateBuyPrice` — §3.3 формулы цен с `rarity_factor` (1.0/3.0/10.0/50.0).

**Интеграция:** На тактическом цикле (каждые 10 тиков) AI вызывает `selectNextBuilding` и для выбранного здания emit `economy:build` (payload: `{ planetId, hexIndex: pickFreeHex(planet), buildingId }`) — экономический модуль обрабатывает заявку как обычную. Для производства — emit `economy:enqueue`. Для колонизации — emit `economy:colonize`.

**Оценка:** 4–5 дней.
**Ссылка:** `70-ai.md` §3.1–§3.5, §1.3.2, Приложение B.

---

### A3. Экспансионистский AI (колонизация)

**Цель:** Реализовать выбор систем для колонизации по формуле `colonization_score` (§6.1) и цикл экспансии (§6.3) с учётом лимитов одновременных колонизаций по фракциям (Конфедерация: 2, Хегемония: 2, Синдикат: 1, Орден: 1, Рой: 4).

**Файлы:**
- 🆕 `src/ai/expansion-ai.ts`.

**Ключевые функции:**
- `colonizationScore(system: StarSystem, faction: AIFaction, state: GameState): number` — формула из §6.1:
  ```
  score = habitability_factor × 0.30
        + resource_factor × 0.25
        + proximity_factor × 0.20
        + strategic_factor × 0.15
        + threat_factor × 0.10
  ```
  С фракционными модификаторами: Синдикат `rare_count × 5` (вместо × 3); Рой `habitability_factor = 1.0`; Хегемония `threat_factor = 1 − factor` (ближе к врагам = лучше).
- `expansionCycle(faction, state, tick)` — §6.3: проверка `activeColonizations(faction) >= max`, получение кандидатов через BFS по `JumpPoint` от границ (≤ 5 прыжков), скоринг, фильтр по `COLONIZATION_THRESHOLD` (Конф: 0.4, Хег: 0.2, Синд: 0.6, Орден: 0.5, Рой: 0.1), выбор лучшего, emit `ai:colonization-launched`.
- `colonizationTime(system, faction)` — §6.2: `base_time(200) × faction_mod × (1 + dist_penalty) × habit_mod`. Используется для таймера завершения.
- `considerMilitaryExpansion(faction, state)` — fallback при отсутствии свободных систем (только для Хегемонии/Роя).

**Интеграция:** Запускается на цикле экспансии (каждые 100 тиков, см. §1.4). Emit `economy:colonize` (для запуска колонизации через существующий экономический модуль) и `ai:colonization-launched` для UI.

**Оценка:** 3–4 дня.
**Ссылка:** `70-ai.md` §6.1–§6.4, Приложения B, C.

---

### A4. Военный AI (формирование флотов, оценка угроз) — зависит от Блока 2

**Цель:** Реализовать оценку угроз (§4.1), формирование флотов по шаблонам (§4.2), решение об атаке (§4.3), решение об отступлении (§4.4), выбор целей (§4.5).

**Зависимости:** `Ship`, `Fleet`, `FleetOrder` из `src/core/types.ts` (есть). Требует от Блока 2: функции постройки/формирования флотов `src/ships/*` и `src/fleet/*`; `fleet:created`, `fleet:order-issued` события. Если Блок 2 не завершён — военный AI работает в стабе (заглушки для `getFleetPower`, `formFleet`), но это ограничит играбельность.

**Файлы:**
- 🆕 `src/ai/military-ai.ts`.

**Ключевые функции:**
- `assessThreats(faction, state): Threat[]` — §4.1 `assessThreats()`. Сканирует соседние флоты через `state.fleets` (в радиусе сканера планеты/системы), для каждого — `calculateThreatScore`.
- `calculateThreatScore(fleet, system, faction): number` — формула из §4.1: `power_ratio × 50 × relation_mod × capital_mod × value_mod`.
- `formFleet(faction, missionType, targetPower, state): Fleet | null` — §4.2. Использует `FLEET_TEMPLATES` (оборонительный/ударный/набеговый/патрульный/транспортный) с составами 30/40/30 и т.д. Создаёт `Fleet` через emit `fleet:created` (если Блок 2 готов) или прямую мутацию `state.fleets` через accessor.
- `shouldAttack(faction, targetSystem, state): AttackDecision` — §4.3. Базовое условие `myPower > enemyPower × attackThreshold` (Конфедерация: 1.5, Хегемония: 1.2, Синдикат: 3.0, Орден: 1.5, Рой: 1.0) с фракционными модификаторами (см. таблицу §4.3).
- `shouldRetreat(faction, fleet, enemyFleet): RetreatDecision` — §4.4. Пороги отступления (Конф: 1.5, Хег: 2.5, Синд: 1.2, Орден: 1.3, Рой: ∞).
- `selectAttackTargets(faction, targetSystem): Target[]` — §4.5. Приоритеты целей: столица → верфи → шахты редких → электростанции → заводы → слабозащищённые → оборонительные платформы.

**Шаблоны флотов** (по фракциям, §4.2): вынести в `src/ai/fleet-templates.ts` константой `FLEET_TEMPLATES: Record<FactionType, Record<MissionType, FleetComposition>>`.

**Интеграция:**
- На тактическом цикле (10 тиков) — `assessThreats` для систем в зоне `ACTIVE`/`VISIBLE`. При угрозе ≥ 30 (средняя) — формирование оборонительного флота.
- На реактивном цикле (каждый тик) — обработка событий `combat:engaged`, `combat:resolved`, `ships:damaged` (через подписки `AIEvents` + `CombatEvents`).
- При принятии решения об атаке — emit `ai:attack-ordered` и `fleet:order-issued` (type `attack`).

**Оценка:** 4–5 дней.
**Ссылка:** `70-ai.md` §4.1–§4.6, Приложения B, C.

---

### A5. Дипломатический AI (отношения -100..+100, предложения, торговля)

**Цель:** Реализовать систему отношений, факторы влияния, дерево дипломатических решений (§5.1–§5.6), дипломатические действия (объявление войны, предложение мира, торговое соглашение, военный союз, обмен технологиями, ультиматум).

**Файлы:**
- 🆕 `src/ai/diplomacy-ai.ts`.

**Ключевые функции:**
- `getRelationStatus(score: number): 'war' | 'hostile' | 'neutral' | 'friendly' | 'ally'` — §5.1 шкала и §5.6 пороги.
- `applyRelationModifier(factionA, factionB, delta, reason)` — emit `ai:relation-changed` (он же `diplomacy:relations-changed` — см. §5 ниже). Использует таблицу триггеров §5.5.
- `recomputePermanentFactors(faction, state)` — §5.2: сила армии, близость границ, торговый объём, идеологическая совместимость (`IDEOLOGY_MATRIX` из §5.2 матрицы). Вызывается каждые 100 тиков.
- `diplomaticCycle(faction, state, tick)` — §5.3 дерево решений. По состоянию отношений выбирает: продолжать войну/предложить мир/перемирие/торговлю/пакт/обмен техами/союз. Emit соответствующие события.
- `declareWar(faction, target)` — §5.4 `declareWar()`. Условия: relations ≤ −20, Синдикат не начинает войну при relations > −50, Рой всегда TRUE. Устанавливает `relations(target) = max(relations, −50)`, −20 ко всем союзникам цели. Emit `ai:war-declared`/`diplomacy:war-declared`.
- `proposePeace(faction, target)` — §5.4 `proposePeace()` + `generatePeaceTerms()` (white_peace / concession / territorial_concession).
- `proposeTradeAgreement(faction, target)` — §5.4 `proposeTradeAgreement()`: `utility = trade_benefit × (1 + relation_bonus)`; `utility > 0.4` → PROPOSE_TRADE.
- `proposeAlliance(faction, target)` — §5.4: relations ≥ 50, общий враг или relations ≥ 70.
- `proposeTechExchange(faction, target)` — §5.4: relations ≥ 20, поиск surplus_techs, равноценный обмен. **Зависит от Блока 3** (`getTechsNotKnownBy`).
- `issueUltimatum(faction, target)` — §5.4: только Хегемония/Конфедерация; сила > их × 1.5.
- `respondToProposal(faction, proposal)` — обработка входящих предложений от игрока/других AI (через подписку на `diplomacy:proposal`).

**Начальная матрица отношений** (из §5.1):
```
Конф/Хег: -10, Конф/Синд: +10, Конф/Орден: +20, Конф/Рой: -50
Хег/Синд: -20, Хег/Орден: -15
Синд/Орден: +5
Рой/все: -50
```
Матрица идеологической совместимости (§5.2) — в `src/ai/faction-definitions.ts` как `IDEOLOGY_MATRIX: Record<FactionType, Record<FactionType, number>>`.

**Интеграция:**
- Дипломатический цикл — каждые 50 тиков (§1.4).
- Подписки на события `combat:resolved` → `applyRelationModifier(attacker, defender, -30, 'attack')`; `trade:route-completed` → `+2` (с лимитом +10/100 тиков); `ships:destroyed` → `−15`.
- Рой не подписывается на дипломатические входящие (отношения всегда −50).

**Оценка:** 5–6 дней.
**Ссылка:** `70-ai.md` §5.1–§5.6, Приложения B, C.

---

### A6. Utility AI + GOAP (оценка полезности, планирование действий)

**Цель:** Реализовать гибридный Decision Engine: Utility AI для тактических решений (каждый 10 тиков) + GOAP-планировщик для стратегических цепочек (каждые 100 тиков); связать через формулу `utility_with_plan = base_utility × (1 + plan_alignment_bonus)` (§1.3.3).

**Файлы:**
- 🆕 `src/ai/goap-planner.ts` — A*-поиск в пространстве действий.
- 🆕 `src/ai/utility-engine.ts` — общая функция `evaluateActions(candidates, faction, activeGoals)` + `lazyDecision()` (§8.4).
- 🆕 `src/ai/actions/` — каталог GOAP-действий по категориям:
  - `src/ai/actions/economy-actions.ts` (build_mine, build_factory, build_power_plant, build_shipyard, build_lab, build_trade_hub, enqueue_recipe, ...).
  - `src/ai/actions/military-actions.ts` (form_fleet, attack_system, raid, retreat, patrol, defend_capital).
  - `src/ai/actions/diplomacy-actions.ts` (declare_war, propose_peace, propose_trade, propose_alliance, tech_exchange, ultimatum).
  - `src/ai/actions/expansion-actions.ts` (colonize, military_expansion, build_colonizer_ship).
  - `src/ai/actions/research-actions.ts` (start_research, switch_research — зависит от Блока 3).

**Ключевые функции (GOAP-планировщик):**
- `planGoals(faction, state): GOAPGoal[]` — стратегический цикл: формирует `activeGoals` из приоритетов фракции (§2.2–§2.6 списки «Стратегические цели GOAP»). Например, для Конфедерации:
  1. `ensure_economic_stability` (income > consumption по всем ключевым ресурсам).
  2. `maintain_defense` (флот ≥ паритет с соседями).
  3. `research_next_tier` (технологии уровня current + 1).
  4. `colonize_within_2_jumps`.
  5. `establish_trade_with_2_factions`.
- `goapPlan(goal, worldState, availableActions): GOAPAction[]` — A* поиск цепочки от `worldState` к `goal.targetState`. Эвристика: `h = sum(|goal[k] - state[k]|)`. Cost = сумма `action.cost` по цепочке.
- `applyPlanAlignmentBonus(action, activeGoals): number` — §1.3.3: если действие прямо способствует активной GOAP-цели — `0.5`, иначе `0.0`.

**Ключевые функции (Utility Engine):**
- `lazyDecision(faction, decisionType, state): Decision` — §8.4 `lazyDecision()`: предфильтрация кандидатов → грубая оценка `roughUtility(action) = need × 0.5` → топ-5 → точная `preciseUtility = need × urgency × feasibility` → лучшее.
- `preciseUtility(action, faction, state): number` — формула §3.5.
- `evaluateLongTermBenefit(action, faction, state): number` — для Hard/Insane (§7.4/§7.5): добавка к utility `× 0.3` (Hard) / `× 0.5` (Insane).
- `evaluateAntiPlayerBenefit(action, faction, state): number` — для Insane (§7.5): если игрок — сильнейший, фракции объединяются против него.
- `decisionNoise(candidates, level: DifficultyLevel): Decision` — Easy: `randomChoice(top_50_percent)`; Normal+: `candidates[0]`.

**Интеграция:**
- `AIModule.tick(time)` (см. A8) на каждом тике запускает реактивные обработчики (только при событиях); на тактическом цикле — `lazyDecision(faction, 'economy' | 'military')`; на стратегическом — `planGoals` + пересмотр `activeGoals`; на дипломатическом (50 тиков) — `diplomaticCycle`; на цикле экспансии (100 тиков) — `expansionCycle`.

**Оценка:** 6–8 дней (самая сложная подзадача).
**Ссылка:** `70-ai.md` §1.3, §1.4, §3.5, §8.4, §7.4–§7.5, Приложения A, B.

---

### A7. Оптимизация (не каждый тик — см. §8 `70-ai.md`)

**Цель:** При 5 AI-фракциях, каждая с 5–30 системами × 3–10 планет × десятки флотов, полный пересчёт каждый тик недопустим (~1834 операций/тик без оптимизации → цель ~200, §8.1). Реализовать 5 стратегий оптимизации из §8.

**Файлы:**
- 🆕 `src/ai/update-zones.ts` — зоны обновления ACTIVE/VISIBLE/DISTANT/REMOTE (§8.2).
- 🆕 `src/ai/simplified-growth.ts` — упрощённая модель прироста (§8.3).
- 🆕 `src/ai/decision-cache-impl.ts` — реализация `DecisionCache` и `getCachedDecision()` (§8.5).
- 🆕 `src/ai/batch-scheduler.ts` — пакетная обработка фракций по тикам (§8.6).
- 📝 `src/ai/utility-engine.ts` — `lazyDecision` уже в A6, но дополнительно лимиты кандидатов (§8.4 таблица): строительство 5/10 тик, производство 3/5, военное 3/1 или 10, дипломатия 2/50, экспансия 3/100.

**Ключевые функции:**
- `computeUpdateZone(faction, state): UpdateZone` — §8.2: `minDistance(owned_system, any_player_system)` → `active (≤2) | visible (3–5) | distant (6–10) | remote (>10)`. Обновление при изменении состава галактики или владений.
- `getUpdateFrequency(zone: UpdateZone, difficulty: DifficultyLevel): number` — таблица из §8.2 (1/5/10/50 тиков) с множителем сложности (Easy ×2, Insane ×1).
- `simplifiedGrowth(system, ticksElapsed, faction)` — §8.3 формула прироста ресурсов и упрощённое строительство (только для distant/remote зон). Используется вместо полного `processEconomyTick` для удалённых AI-систем.
- `getCachedDecision(faction, decisionType, currentTick): Decision | null` — §8.5: проверка возраста (`MAX_CACHE_AGE` — 10/5/25/50 для economy/military/diplomacy/expansion) и хеша ситуации.
- `computeSituationHash(faction, decisionType, state): string` — §8.5 `computeSituationHash()`: для economy — `hash(resources, buildingQueue, energyBalance)`; для military — `hash(fleetPower, threatLevel, activeWars)`; и т.д.
- `getFactionTickSlot(factionId, totalActiveFactions, cycleType): boolean` — §8.6: распределение фракций по тикам. Например, для 3 активных фракций: `tick % 3 === faction.slot`.

**Интеграция в `AIModule.tick(time)`:**
```
Каждый тик:
  ├─ Реактивные события (для ВСЕХ фракций) — обработчики подписок на combat/ships-destroyed/etc.
  │
  ├─ Тактический цикл (по слотам, §8.6):
  │   for faction in activeFactions where tickSlotMatches(faction, tick, 'tactical'):
  │     if computeZone(faction) in [active, visible]:
  │       runTacticalCycle(faction)  // экономика + строительство + движение флотов
  │     else:
  │       simplifiedGrowth(faction, ticksSinceLast)
  │
  ├─ Стратегический цикл (по слотам, реже):
  │   if tick % 100 === 0:
  │     for faction in activeFactions where tickSlotMatches(faction, tick, 'strategic'):
  │       planGoals(faction) + recomputePermanentFactors + allocateBudget
  │
  ├─ Дипломатический цикл (каждые 50 тиков):
  │   if tick % 50 === 0: diplomaticCycle(faction) для 1 фракции по слоту
  │
  └─ Цикл экспансии (каждые 100 тиков):
      if tick % 100 === 0: expansionCycle(faction) для 1 фракции по слоту
```

**Бюджет производительности** (§8.8): ≤20 мс/тик при x50 → 1000 мс/сек — реалистично для Web Worker. Измерять через `performance.now()` в `AIModule.tick` с ворнингом при превышении.

**Оценка:** 3 дня.
**Ссылка:** `70-ai.md` §1.4, §8.1–§8.8, Приложения C (константы `MAX_CACHE_AGE`, `ZONE_*_DISTANCE`, `ZONE_*_FREQUENCY`).

---

### A8. Интеграция в game-store + события typed-bus + новый AIModule

**Цель:** Создать `AIModule` (implements `IGameModule`), зарегистрировать его в `GameMediator` после `GalaxyModule` и `EconomyModule` (и после `ShipsModule`/`FleetModule`/`TechModule` когда Блоки 2/3 готовы), подключить подписки и emit-ы.

**Файлы:**
- 🆕 `src/ai/ai-module.ts` — `AIModule implements IGameModule`.
- 🆕 `src/ai/index.ts` — re-exports.
- 📝 `src/core/events.ts` — расширить `AIEvents` (см. §5 ниже).
- 📝 `src/stores/game-store.ts` — `getMediatorWithModules()`:
  ```ts
  const aiModule = new AIModule();
  aiModule.setGameStateAccessor(() => mediator.getGameState());
  mediator.registerAndInit([galaxyModule, economyModule, aiModule]);
  ```
- 📝 `src/core/game-mediator.ts` — `newGame()` принимает `aiFactionTypes?`, `aiFactionCount?`, `difficulty?` в `GalaxyGenConfig` (расширяется через `Partial<AIStartConfig>`); вызывает `initFactionsForNewGame()` и сохраняет в `state.aiFactions`, `state.activeFactionIds`, `state.difficulty`.
- 📝 `src/stores/game-store.ts`:
  - `tick()` — после `processEconomyTick` для планет игрока, вызвать `mediator.tick()` для обработки тиков модулей (включая AI). Сейчас `tick()` дублирует логику в сторе (строки 233-251) — refactor: делегировать в `mediator.tick()`.
  - `serializeGameState` / `deserializeGameState` — корректно сериализуют `aiFactions` (с `Map` → массивы пар; `decisionCache` можно не сериализовать полностью — оставить только `lastTick`-и).
- 📝 `src/app/page.tsx` — добавить UI выбора фракций при старте (см. §7).

**AIModule манифест:**
```ts
// src/ai/ai-module.ts
export class AIModule implements IGameModule {
  readonly manifest: ModuleManifest = {
    id: 'ai',
    name: 'AI-фракции',
    version: '1.0.0',
    description: '5 базовых AI-фракций: GOAP + Utility AI (экономика/военное/дипломатия/экспансия)',
    dependencies: ['galaxy', 'economy'],  // + 'ships','fleet','tech' когда Блоки 2/3 готовы
    emits: [
      'ai:faction-created', 'ai:strategic-plan-updated', 'ai:budget-reallocated',
      'ai:building-queued', 'ai:production-queued', 'ai:colonization-launched',
      'ai:fleet-formed', 'ai:attack-ordered', 'ai:patrol-ordered',
      'ai:war-declared', 'ai:peace-proposed', 'ai:trade-offered',
      'ai:trade-accepted', 'ai:trade-rejected', 'ai:ultimatum-issued',
      'ai:alliance-formed', 'ai:tech-exchange-proposed', 'ai:relation-changed',
      'ai:decision', 'ai:colony-founded', 'ai:fleet-sent',  // legacy (существующие)
    ],
    subscribes: [
      { event: 'core:tick', priority: PRIORITY.REACTION },  // 30
      { event: 'core:game-created' },
      { event: 'combat:engaged' },
      { event: 'combat:resolved' },
      { event: 'ships:destroyed' },
      { event: 'ships:damaged' },
      { event: 'fleet:order-completed' },
      { event: 'economy:planet-colonized' },
      { event: 'economy:resource-depleted' },
      { event: 'tech:research-completed' },        // Блок 3
      { event: 'diplomacy:proposal' },            // входящие от игрока
    ],
    handlesQueries: [
      { queryName: 'ai:faction-by-id', description: 'Получить AI-фракцию по ID', requestType: 'EntityId', responseType: 'AIFaction | undefined' },
      { queryName: 'ai:active-factions', description: 'Список активных фракций', requestType: 'void', responseType: 'AIFaction[]' },
      { queryName: 'ai:relations', description: 'Матрица отношений', requestType: 'void', responseType: 'Record<string, number>' },
    ],
    requiresQueries: [
      { queryName: 'galaxy:system-by-id', requestType: 'EntityId', responseType: 'StarSystem | undefined' },
      { queryName: 'galaxy:colonized-planets', requestType: 'void', responseType: 'Planet[]' },
      { queryName: 'economy:planet-resources', requestType: 'EntityId', responseType: 'Record<string, number>' },
    ],
  };
  // ...
}
```

**AIModule.tick(time: GameTime):**
1. Если `state.phase !== 'playing'` — пропустить.
2. Получить `state.aiFactions`, отфильтровать по `activeFactionIds`.
3. Реактивные обработчики уже отработали через подписки (events).
4. Тактический цикл: для каждой фракции по слоту (§8.6) → `runTacticalCycle(faction, time.tick)`.
5. Если `tick % 50 === 0` — дипломатический цикл для 1 фракции по слоту.
6. Если `tick % 100 === 0` — стратегический цикл (план GOAP + бюджет + пересчёт постоянных факторов) для 1 фракции по слоту; цикл экспансии для 1 фракции по слоту.

**Оценка:** 3 дня.
**Ссылка:** `docs/architecture/modular-bus.md` (паттерн), `src/economy/economy-module.ts` (образец), `70-ai.md` §1.2, §1.4, §8.7.

---

## 5. События typed-bus (новые)

Расширить `AIEvents` в `src/core/events.ts` (сейчас 3 события → станет ~20). Существующие три (`ai:decision`, `ai:colony-founded`, `ai:fleet-sent`) оставить как есть (legacy-совместимость).

```ts
export interface AIEvents {
  // ─── Legacy (сохраняются) ─────────────────────────────
  'ai:decision': { factionId: EntityId; action: string; targetId?: EntityId };
  'ai:colony-founded': { factionId: EntityId; planetId: EntityId };
  'ai:fleet-sent': { factionId: EntityId; fleetId: EntityId; purpose: string };

  // ─── Новые: lifecycle ─────────────────────────────────
  'ai:faction-created': { factionId: EntityId; type: FactionType; archetype: FactionArchetype; capitalSystemId: EntityId };
  'ai:strategic-plan-updated': { factionId: EntityId; goals: { id: string; priority: number }[] };
  'ai:budget-reallocated': { factionId: EntityId; allocation: BudgetAllocation };

  // ─── Новые: экономика ──────────────────────────────────
  'ai:building-queued': { factionId: EntityId; planetId: EntityId; buildingId: string; hexIndex: number };
  'ai:production-queued': { factionId: EntityId; planetId: EntityId; recipeId: string; repeat: boolean };

  // ─── Новые: экспансия ─────────────────────────────────
  'ai:colonization-launched': { factionId: EntityId; systemId: EntityId; etaTick: number };

  // ─── Новые: военные ────────────────────────────────────
  'ai:fleet-formed': { factionId: EntityId; fleetId: EntityId; missionType: 'defensive' | 'strike' | 'raid' | 'patrol' | 'transport'; power: number };
  'ai:attack-ordered': { factionId: EntityId; fleetId: EntityId; targetSystemId: EntityId };
  'ai:patrol-ordered': { factionId: EntityId; fleetId: EntityId; targetSystemId: EntityId };
  'ai:retreat-ordered': { factionId: EntityId; fleetId: EntityId; reason: string };

  // ─── Новые: дипломатия ────────────────────────────────
  'ai:war-declared': { attackerFactionId: EntityId; defenderFactionId: EntityId; reason: string };
  'ai:peace-proposed': { fromFactionId: EntityId; toFactionId: EntityId; terms: Record<string, unknown> };
  'ai:trade-offered': { fromFactionId: EntityId; toFactionId: EntityId; resourceId: string; quantity: number; price: number; type: 'sell' | 'buy' };
  'ai:trade-accepted': { fromFactionId: EntityId; toFactionId: EntityId; offerId: EntityId };
  'ai:trade-rejected': { fromFactionId: EntityId; toFactionId: EntityId; offerId: EntityId };
  'ai:ultimatum-issued': { fromFactionId: EntityId; toFactionId: EntityId; demands: string[] };
  'ai:alliance-formed': { factionA: EntityId; factionB: EntityId };
  'ai:tech-exchange-proposed': { fromFactionId: EntityId; toFactionId: EntityId; offer: string[]; request: string[] };
  'ai:relation-changed': { factionA: EntityId; factionB: EntityId; delta: number; newScore: number; reason: string };

  // ─── Новые: сложность ─────────────────────────────────
  'ai:difficulty-set': { difficulty: DifficultyLevel };
}
```

> **Примечание по дипломатическим событиям:** существующие `diplomacy:*` события (`diplomacy:proposal`, `diplomacy:accepted`, `diplomacy:rejected`, `diplomacy:relations-changed`, `diplomacy:war-declared`, `diplomacy:peace-signed`) продолжают использоваться — `ai:*` версии несут ДЕТАЛИ (reason, terms, demands), а `diplomacy:*` — единый формат для UI и игрока. При emit `ai:war-declared` — также emit `diplomacy:war-declared` (sync).

---

## 6. 5 базовых AI-фракций

Из `70-ai.md` §2.1 — таблица фракций. **Расширяемо** (сверх 5 может быть добавлено в Etap 4 — см. `08_27_highlevel_plan.md` Этап 4 «Дополнительные AI-фракции (свыше 5)»).

| # | Фракция | FactionType | Архетип | Бонус | Штраф | Стартовые системы | Стратегия |
|---|---------|-------------|--------|------|-------|-------------------|-----------|
| 1 | **Конфедерация** | `CONFEDERATION` | `balanced` | +10% производство | нет | 3 | Равномерное развитие, активная дипломатия, оборонительная доктрина |
| 2 | **Хегемония** | `HEGEMONY` | `military` | +15% боевая мощь | −20% скорость исследований | 3 | Агрессия, экспансия силой, ультиматумы |
| 3 | **Синдикат** | `SYNDICATE` | `trade` | +20% торговые доходы | −10% боевая мощь | 2 | Торговля, наёмники, монополизация редких ресурсов |
| 4 | **Орден** | `ORDER` | `science` | +25% скорость исследований | −15% боевая мощь | 2 | Технологии, артефакты Странников, обмен знаниями |
| 5 | **Рой** | `SWARM` | `xeno_swarm` | +30% скорость колонизации | Нет дипломатии, −10% эффективность шахт | 4 | Быстрая экспансия, био-адаптации, война со всеми |

**Пороги атаки/отступления** (`70-ai.md` §2.7, Приложение C):
- Порог атаки (моя_сила / их_сила): Конфедерация 1.5, Хегемония 1.2, Синдикат 3.0 (или не атакует), Орден 1.5, Рой 1.0.
- Порог отступления (их_сила / моя_сила): Конфедерация 1.5, Хегемония 2.5, Синдикат 1.2, Орден 1.3, Рой ∞ (никогда).
- Потери для отступления (% флота): Конф 40%, Хег 60%, Синд 30%, Орден 35%, Рой 90%.

**Стартовые флоты** (`70-ai.md` §2.2–§2.6) — использует типы кораблей из Блока 2:
- Конфедерация: 2 истребителя, 1 транспорт, 1 разведчик.
- Хегемония: 4 истребителя, 2 крейсера, 1 транспорт.
- Синдикат: 1 истребитель, 3 транспорта, 2 разведчика.
- Орден: 1 истребитель, 1 транспорт, 1 разведчик.
- Рой: 6 био-истребителей, 2 био-транспорта, 1 матка-колонизатор.

**Особые ограничения:**
- **Рой** (`70-ai.md` §2.6): нет дипломатии (отношения всегда −50, авто-война со всеми), нет торговли, био-адаптации вместо обычных технологий, не отступает. В дипломатическом цикле Рой пропускается (только военные действия).
- **Орден** (`70-ai.md` §2.5): стартовые технологии Химия=2, Физика=2, Биология=2 (требует от Блока 3 поддержки стартовых уровней); технологическое превосходство в бою (`tech_advantage_bonus = Σ(tech_level_i − enemy_tech_i) × 0.05`).
- **Синдикат** (`70-ai.md` §2.4): наёмники — 500 кредитов за крейсер-эквивалент за 100 тиков, максимум 3 наёмных флота одновременно. В MVP — стаб-реализация: наёмные флоты создаются через `formFleet` с пометкой `mercenary: true`.

**Стратегические цели GOAP** — для каждой фракции списки из §2.2–§2.6 (по 5 целей). Вынести в `src/ai/faction-definitions.ts` константой `FACTION_GOAL_TEMPLATES: Record<FactionType, GOAPGoalTemplate[]>`.

**Каталог `src/ai/faction-definitions.ts`** содержит:
```ts
export interface FactionDefinition {
  type: FactionType;
  archetype: FactionArchetype;
  name: string;
  color: string;
  description: string;
  startSystems: number;
  startFleet: { hullId: string; count: number }[];
  startResourceMultiplier: number;
  bonus: { kind: 'production' | 'combat' | 'trade' | 'research' | 'colonization'; value: number };
  penalty: { kind: 'research' | 'combat' | 'mining' | 'none'; value: number };
  attackThreshold: number;       // Приложение C
  retreatThreshold: number;      // Infinity для Роя
  retreatLossThreshold: number;  // 0.40/0.60/0.30/0.35/0.90
  maxColonizations: number;      // 2/2/1/1/4
  colonizationThreshold: number; // 0.4/0.2/0.6/0.5/0.1
  colonizationModifier: number;  // 1.0/0.9/1.1/1.2/0.7
  budget: BudgetAllocation;      // из §2.2 бюджетов
  buildingPriorities: { buildingId: string; weight: number }[]; // §2.2 приоритеты
  goalTemplates: GOAPGoalTemplate[];                          // §2.2 стратегические цели
  hasDiplomacy: boolean;          // false для Роя
  hasTrade: boolean;              // false для Роя
  ideologyRow: Record<FactionType, number>; // §5.2 матрица
  startTechs?: Record<string, number>;       // только для Ордена
}

export const FACTION_DEFINITIONS: Record<FactionType, FactionDefinition> = { /* ... */ };
export const IDEOLOGY_MATRIX: Record<FactionType, Record<FactionType, number>> = { /* ... */ };
export const INITIAL_RELATIONS: Record<FactionType, Partial<Record<FactionType, number>>> = { /* ... */ };
```

---

## 7. UI-компоненты

Новые UI-компоненты в `src/components/game/`:

| Компонент | Назначение | Привязка событий |
|-----------|------------|------------------|
| 🆕 `faction-panel.tsx` | Боковая панель: список 5 фракций, активные/неактивные, текущий статус (война/нейтралитет/союз с игроком), столица, военная мощь, численность флота, технологии | `ai:faction-created`, `ai:relation-changed`, `combat:resolved` |
| 🆕 `diplomacy-view.tsx` | Экран дипломатии: матрица отношений 5×5 (или активные×все), кнопки «Предложить торговлю»/«Объявить войну»/«Предложить союз»/«Обмен технологиями» | `diplomacy:proposal`, `ai:war-declared`, `ai:peace-proposed`, `ai:trade-offered` |
| 🆕 `trade-proposal-dialog.tsx` | Модальное окно: входящие торговые предложения от AI с кнопками «Принять/Контрпредложение/Отклонить» | `ai:trade-offered`, `ai:trade-accepted`, `ai:trade-rejected` |
| 🆕 `ai-action-log.tsx` | Лента последних действий AI (последние 50): «Хегемония атаковала систему X», «Синдикат предложил торговлю», «Орден исследовал технологию Y» | `ai:war-declared`, `ai:colonization-launched`, `ai:tech-exchange-proposed`, `tech:research-completed` |
| 🆕 `new-game-faction-select.tsx` | Экран старта: выбор 3 из 5 (или 1–5) фракций для партии, выбор сложности (Easy/Normal/Hard/Insane) | `core:game-created` |
| 📝 `galaxy-map.tsx` | Расширение: подсветка систем по владельцу цветом фракции; показ границ | `ai:faction-created`, `economy:planet-colonized` |
| 📝 `resource-panel.tsx` | Расширение: показать доход от торговых соглашений с AI | `trade:route-established` |

**Цвета фракций** (для UI) — хранить в `faction-definitions.ts`:
- Конфедерация: `#4a90e2` (синий).
- Хегемония: `#d0021b` (красный).
- Синдикат: `#7ed321` (зелёный).
- Орден: `#9013fe` (фиолетовый).
- Рой: `#f5a623` (оранжевый).
- Игрок: `#ffffff` (белый, уже используется).

**Подписки UI** — через `useGameStore` selector + `gameBus.on(...)` в `useEffect` (как существующие компоненты). Для производительности — debounce на 100 мс.

---

## 8. Тесты

Тесты в `src/ai/__tests__/` (Vitest — после Блока 1).

### 8.1 Юнит-тесты (детерминированные)

| Тест | Что проверяет | Файл |
|------|---------------|------|
| `T4-01: faction-definitions.test.ts` | Все 5 фракций имеют валидные поля; `FACTION_DEFINITIONS` ключи совпадают с `FactionType`; сумма `budget_allocation` = 1.0 для каждой фракции | `faction-definitions.test.ts` |
| `T4-02: utility.test.ts` | `utility = need × urgency × feasibility` на стабах; `urgency` формула `1/(1 + ticks/100)`; `feasibility` 1.0/0.5/0.0 по порогам | `utility.test.ts` |
| `T4-03: economy-ai.test.ts` | `selectNextBuilding` для Конфедерации на планете с дефицитом Fe → возвращает `mine`; `allocateBudget` при угрозе 0.8 → `military × 1.5` | `economy-ai.test.ts` |
| `T4-04: expansion-ai.test.ts` | `colonizationScore` для системы с habitability=80, rare=2 → score > 0.5; Рой `habitability_factor=1.0` даже для habitability=0 | `expansion-ai.test.ts` |
| `T4-05: military-ai.test.ts` | `calculateThreatScore` для вражеского флота у столицы = ~2× от угрозы у периферии; `shouldAttack` Хегемония при myPower/theirPower=1.25 → YES, при 1.15 → NO; Рой при 1.0 → YES | `military-ai.test.ts` |
| `T4-06: diplomacy-ai.test.ts` | `getRelationStatus(-55)='war'`, `getRelationStatus(-30)='hostile'`, `getRelationStatus(20)='neutral'`, `getRelationStatus(45)='friendly'`, `getRelationStatus(70)='ally'`; `declareWar(Конф, цель)` при relations=0 → FALSE (нет повода); Рой → всегда TRUE | `diplomacy-ai.test.ts` |
| `T4-07: goap-planner.test.ts` | `goapPlan(goal=build_mine, worldState={credits:0}, actions=[build_mine, gather_credits])` → цепочка `[gather_credits, build_mine]`; A* возвращает путь минимальной стоимости | `goap-planner.test.ts` |
| `T4-08: decision-cache.test.ts` | `getCachedDecision` возвращает тот же объект если situation_hash не изменился и `tick - lastEval < MAX_CACHE_AGE`; возвращает `null` если ситуация изменилась | `decision-cache-impl.test.ts` |
| `T4-09: update-zones.test.ts` | `computeUpdateZone` для фракции на расстоянии 1 прыжка от игрока → `active`; 7 прыжков → `distant`; 15 прыжков → `remote` | `update-zones.test.ts` |
| `T4-10: simplified-growth.test.ts` | За 100 тиков в `remote` зоне ресурс растёт линейно по формуле; погрешность ±5% от полной симуляции | `simplified-growth.test.ts` |

### 8.2 Интеграционные тесты

| Тест | Что проверяет |
|------|---------------|
| `T4-11: ai-module.test.ts` | `AIModule.tick` запускает тактический цикл только для 1 фракции по слоту; после 100 тиков все 3 активные фракции отработали стратегический цикл |
| `T4-12: ai-economy-integration.test.ts` | На emit `ai:building-queued` → `EconomyModule` обрабатывает как обычный `economy:build`; строится здание на планете AI |
| `T4-13: ai-diplomacy-integration.test.ts` | Две AI-фракции: одна объявляет войну → `ai:war-declared` + `diplomacy:war-declared`; отношения устанавливаются −50; союзники защитника получают −20 |
| `T4-14: ai-new-game.test.ts` | `newGame({ aiFactionCount: 3, difficulty: 'normal' })` создаёт 5 фракций, 3 активных, корректные начальные отношения, столицы, стартовые флоты |
| `T4-15: ai-serialization.test.ts` | `serializeGameState` → `deserializeGameState` сохраняет `aiFactions`, `activeFactionIds`, `difficulty`, `relations` (Map → массив пар → Map) |

### 8.3 Performance-тесты

| Тест | Что проверяет |
|------|---------------|
| `T4-16: ai-perf.test.ts` | Запуск 1000 тиков с 3 активными фракциями (по 5 систем × 5 планет) — `tick()` ≤ 20 мс в среднем (P95 ≤ 30 мс). Измерение через `performance.now()` |

### 8.4 Критерии прохождения тестов

- T4-01…T4-10 — 100% pass (юнит).
- T4-11…T4-15 — 100% pass (интеграция).
- T4-16 — pass (performance).
- Lint: 0 ошибок (как сейчас).

---

## 9. Риски и зависимости

### 9.1 Высокая сложность — GOAP

GOAP-планировщик (A* в пространстве действий) — **самая сложная часть блока** (`70-ai.md` §1.3.1, §8.4):
- Риск экспоненциального взрыва состояний при большом `availableActions`. **Митигация**: ограничение глубины поиска (≤ 5 шагов), предфильтрация действий до 5 кандидатов (§8.4), кэширование планов (§8.5).
- Риск неожиданных планов. **Митигация**: подробное логирование через `ai:strategic-plan-updated` (для отладки и UI `ai-action-log`).
- Сложность определения `preconditions`/`effects` для каждого действия. **Митигация**: начать с минимального набора (10–15 действий в MVP), покрывать тестами `T4-07`.

### 9.2 Производительность при 5 фракциях

- При 5 активных фракциях (максимум), 5–30 систем каждая, dozens флотов — без оптимизации ~1834 операций/тик (§8.1). **Митигация**: все 5 стратегий §8 (зоны, упрощённая модель, кэш, ленивое вычисление, пакетная обработка). По умолчанию в партии 3 из 5 фракций — снижает базовую нагрузку на 40%.
- Web Worker: рассмотреть вынос AI-вычислений в Worker (после MVP, если P95 > 30 мс). Не блок в MVP.

### 9.3 Зависимость от Блока 2 (флот)

- Военный AI (A4) требует `Ship`/`Fleet`/`FleetOrder` (есть в `types.ts`) и реализации Блока 2 (функции `formFleet`, `shipPower`, события `fleet:created`, `fleet:order-issued`). **Если Блок 2 не готов**: A4 работает в стаб-режиме — `getFleetPower` возвращает 0, `formFleet` возвращает `null`, AI не атакует, но всё ещё может оценивать угрозы. Это позволяет выпускать Блок 4 с ограниченной военной функциональностью и подключать полную позже.

### 9.4 Зависимость от Блока 3 (исследования)

- Научный AI (часть A6 — `research-actions.ts`) требует от Блока 3: `TechBranch`/`ResearchProject` типы, `tech:research-started`/`completed` события, функцию `getTechsNotKnownBy(factionA, factionB)` (используется в `proposeTechExchange`, §5.4). **Если Блок 3 не готов**: `proposeTechExchange` всегда возвращает `FALSE` (нет технологий для обмена); Орден не получает `tech_advantage_bonus` в бою; `research-actions.ts` стаб → `start_research` no-op.

### 9.5 Состояние гонки в `game-store.ts`

- `tick()` в `game-store.ts` (строки 233–251) дублирует логику `mediator.tick()` — риск расхождения (экономика игрока тикает дважды или AI не тикает). **Митигация** (A8): refactor `tick()` — делегировать в `mediator.tick()`, убрать дублирование.

### 9.6 Сериализация `Map` и `decisionCache`

- `AIFaction.relations`, `resourceIncome`, `decisionCache` — `Map`. `JSON.stringify` теряет их. **Митигация** (A8): `serializeGameState` преобразует `Map → Array<[K, V]>` и обратно; `decisionCache` можно частично сбросить при сохранении (после загрузки AI пересчитает решения).

### 9.7 Дизайн-решение: Рой без дипломатии

- Рой не участвует в дипломатическом цикле (отношения всегда −50, авто-война). Это упрощает A5 (пропуск Роя в цикле), но требует явного skip в `diplomaticCycle(faction)` и обработку в UI (для Роя в `diplomacy-view.tsx` показывать «Дипломатия недоступна»).

### 9.8 Дизайн-решение: выбор 3 из 5 по умолчанию

- UI `new-game-faction-select.tsx` позволяет выбрать 1–5 фракций (по умолчанию 3). При < 3 — warning «Игра может быть слишком лёгкой». При 5 — warning «Высокая нагрузка на CPU».

---

## 10. Критерии готовности блока

Блок считается готовым, когда **все** следующие условия выполнены:

### 10.1 Функциональность (MVP — чеклист из `70-ai.md` §Приложение D)

- [ ] **A1** Базовая структура `AIFaction` с ресурсами и территорией — все 5 фракций определены в `FACTION_DEFINITIONS`.
- [ ] **A2** Utility AI для экономических решений (строительство, производство, торговля, бюджет).
- [ ] **A3** Экспансионистский AI — колонизация по формуле `colonization_score`, лимиты по фракциям.
- [ ] **A4** Упрощённая военная логика — оценка угроз, формирование флотов (если Блок 2 готов), пороги атаки/отступления по фракциям.
- [ ] **A5** Дипломатия — отношения −100..+100, шкала war/hostile/neutral/friendly/ally, объявление войны, предложение мира, торговля, ультиматумы, союзы (обмен технологиями — если Блок 3 готов).
- [ ] **A6** Гибрид Utility + GOAP — стратегические цели для каждой фракции, plan_alignment_bonus.
- [ ] **A7** Оптимизация — зоны обновления, кэш, ленивое вычисление, пакетная обработка (минимум 3 из 5 стратегий §8 в MVP; остальные в V1.0).
- [ ] **A8** `AIModule` зарегистрирован в `GameMediator`, `tick()` делегирован в медиатор.

### 10.2 5 фракций (явно)

- [ ] Конфедерация, Хегемония, Синдикат, Орден, Рой — все 5 реализованы с уникальными параметрами (бонус/штраф/бюджет/приоритеты/пороги/цели GOAP).
- [ ] По умолчанию в партии 3 из 5; пользователь может выбрать 1–5 в `new-game-faction-select.tsx`.
- [ ] Рой: нет дипломатии, нет торговли, авто-война со всеми.
- [ ] Орден: стартовые технологии (если Блок 3 готов), `tech_advantage_bonus` в бою.
- [ ] Синдикат: наёмники (стаб в MVP).
- [ ] Документация (`08_27_doc_fixes.md` пункт 1) — `00-ARCHITECTURE.md` уже исправлен на «5 базовых, расширяемо» (это задача doc-fixes, не этого блока).

### 10.3 Качество

- [ ] Lint: 0 ошибок.
- [ ] Все тесты T4-01…T4-16 pass.
- [ ] Performance: `tick()` ≤ 20 мс среднее при 3 фракциях.
- [ ] Сохранение/загрузка игры с AI работает (T4-15).
- [ ] `TypedEventBus` — все новые события из §5 добавлены в `events.ts`, манифест `AIModule` правильно декларирует `emits`/`subscribes`.

### 10.4 UI

- [ ] `faction-panel.tsx` показывает 5 фракций с корректными цветами и статусом.
- [ ] `diplomacy-view.tsx` позволяет игроку предлагать торговлю/войну/союз.
- [ ] `ai-action-log.tsx` показывает последние действия AI.
- [ ] `new-game-faction-select.tsx` позволяет выбрать фракции и сложность.

### 10.5 Явные «не в MVP» (переходят на Etap 4 / V1.0)

- ❌ Безумный уровень сложности (§7.5) — Insane.
- ❌ Координация флотов (Hard/Insane).
- ❌ Адаптивный AI (меняет стратегию при неудачах).
- ❌ Ложные цели (deception).
- ❌ Био-адаптации Роя как отдельное технологическое дерево (только штрафы/бонусы на уровне фракции).
- ❌ Артефакты Странников (требует макро-объектов галактики, Etap 4).
- ❌ Глобальная карта галактики с LOD (Etap 4).
- ❌ Дополнительные AI-фракции (свыше 5) — Etap 4.

---

## 11. Порядок внедрения внутри блока

```
A1 (модель + 5 фракций) ──► A2 (экономика) ──► A3 (экспансия) ──► A6 (Utility + GOAP)
                                                                              │
                                                                              ▼
                                                                            A4 (военный AI, требует Блок 2)
                                                                              │
                                                                              ▼
                                                                            A5 (дипломатия)
                                                                              │
                                                                              ▼
                                                                            A7 (оптимизация)
                                                                              │
                                                                              ▼
                                                                            A8 (интеграция в game-store + AIModule)
```

| Шаг | Подзадача | Зависимости | Оценка |
|------|-----------|-------------|--------|
| 1 | **A1** Модель AI-фракции | Блок 1 (типы); готово | 3–4 дня |
| 2 | **A2** Экономический AI | A1; использует `processEconomyTick`/`buildOnHex`/`enqueueProduction` из `src/economy/engine.ts` | 4–5 дней |
| 3 | **A3** Экспансионистский AI | A1; `economy:colonize` событие; `JumpPoint`/`generate-jump-points.ts` | 3–4 дня |
| 4 | **A6** Utility + GOAP | A1, A2, A3 (нужны действия для каталога) | 6–8 дней |
| 5 | **A4** Военный AI | A1, A6; **Блок 2** (флот) — стаб если не готов | 4–5 дней |
| 6 | **A5** Дипломатический AI | A1, A6; **Блок 3** (исследования) — частично | 5–6 дней |
| 7 | **A7** Оптимизация | A2–A6 (нужны все циклы для замеров) | 3 дня |
| 8 | **A8** Интеграция в game-store + AIModule | A1–A7 | 3 дня |

**Итого:** ~31–38 идеальных дней ≈ **3–4 недели** (соответствует оценке в `08_27_highlevel_plan.md` Этап 3.5: «Срок: ~3 недели»).

**Контрольные точки внутри блока:**
- После A1+A2+A3 — **MVP-1**: AI строит здания, колонизирует, без дипломатии и войны (тест T4-01…T4-04).
- После A6 — **MVP-2**: гибрид Utility + GOAP работает (тесты T4-07, T4-08).
- После A4+A5 — **MVP-3**: AI воюет и торгует (тесты T4-05, T4-06, T4-13).
- После A7+A8 — **MVP-Final**: оптимизация + интеграция, все тесты T4-01…T4-16 pass.

---

## Изменённые/созданные файлы

### Созданные (новые)

**`src/ai/` (новый каталог модуля):**
- `src/ai/faction-types.ts` — типы: `FactionType`, `FactionArchetype`, `AIFaction`, `GOAPAction`, `GOAPGoal`, `WorldState`, `DifficultyLevel`, `DifficultyModifiers`, `BudgetAllocation`, `DiplomaticAgreement`, `UpdateZone`, `DecisionType`, `DecisionCache`, `ActionResult`, `GOAPGoalTemplate`, `TradeProposal`.
- `src/ai/faction-definitions.ts` — `FactionDefinition`, `FACTION_DEFINITIONS` (5 фракций), `IDEOLOGY_MATRIX`, `INITIAL_RELATIONS`.
- `src/ai/ai-constants.ts` — `AI_CONSTANTS` (из Приложения C `70-ai.md`): пороги атак/отступления, частоты циклов, `MAX_CACHE_AGE`, `ZONE_*_DISTANCE`, `ZONE_*_FREQUENCY`, торговые пороги, колонизационные пороги.
- `src/ai/world-model.ts` — `WorldModel` агрегатор, `buildWorldModel(faction, state)`.
- `src/ai/utility.ts` — `need()`, `urgency()`, `feasibility()`, `utility()` (общие функции).
- `src/ai/utility-engine.ts` — `lazyDecision()`, `preciseUtility()`, `roughUtility()`, `evaluateLongTermBenefit()`, `evaluateAntiPlayerBenefit()`, `decisionNoise()`.
- `src/ai/goap-planner.ts` — `planGoals()`, `goapPlan()` (A* поиск), `applyPlanAlignmentBonus()`.
- `src/ai/economy-ai.ts` — `evaluateEconomyNeeds()`, `selectNextBuilding()`, `desiredBuildingCount()`, `allocateBudget()`, `generateTradeProposals()`, `evaluateTradeProposal()`, `calculateSellPrice()`, `calculateBuyPrice()`.
- `src/ai/military-ai.ts` — `assessThreats()`, `calculateThreatScore()`, `formFleet()`, `shouldAttack()`, `shouldRetreat()`, `selectAttackTargets()`.
- `src/ai/diplomacy-ai.ts` — `getRelationStatus()`, `applyRelationModifier()`, `recomputePermanentFactors()`, `diplomaticCycle()`, `declareWar()`, `proposePeace()`, `proposeTradeAgreement()`, `proposeAlliance()`, `proposeTechExchange()`, `issueUltimatum()`, `respondToProposal()`.
- `src/ai/expansion-ai.ts` — `colonizationScore()`, `expansionCycle()`, `colonizationTime()`, `considerMilitaryExpansion()`.
- `src/ai/fleet-templates.ts` — `FLEET_TEMPLATES` (5 фракций × 5 типов миссий).
- `src/ai/update-zones.ts` — `computeUpdateZone()`, `getUpdateFrequency()`.
- `src/ai/simplified-growth.ts` — `simplifiedGrowth()`.
- `src/ai/decision-cache-impl.ts` — `getCachedDecision()`, `computeSituationHash()`, `setCachedDecision()`.
- `src/ai/batch-scheduler.ts` — `getFactionTickSlot()`, `pickFactionsForCycle(tick, cycleType, factions)`.
- `src/ai/actions/economy-actions.ts` — `BUILD_MINE`, `BUILD_FACTORY`, `BUILD_POWER_PLANT`, `BUILD_SHIPYARD`, `BUILD_LAB`, `BUILD_TRADE_HUB`, `ENQUEUE_RECIPE` (GOAP-действия).
- `src/ai/actions/military-actions.ts` — `FORM_FLEET`, `ATTACK_SYSTEM`, `RAID`, `RETREAT`, `PATROL`, `DEFEND_CAPITAL`.
- `src/ai/actions/diplomacy-actions.ts` — `DECLARE_WAR`, `PROPOSE_PEACE`, `PROPOSE_TRADE`, `PROPOSE_ALLIANCE`, `TECH_EXCHANGE`, `ISSUE_ULTIMATUM`.
- `src/ai/actions/expansion-actions.ts` — `COLONIZE`, `MILITARY_EXPANSION`, `BUILD_COLONIZER_SHIP`.
- `src/ai/actions/research-actions.ts` — `START_RESEARCH`, `SWITCH_RESEARCH` (зависит от Блока 3; стаб если не готов).
- `src/ai/ai-module.ts` — `AIModule implements IGameModule`.
- `src/ai/index.ts` — re-exports публичных типов и `AIModule`.

**`src/ai/__tests__/` (новые тесты):**
- `faction-definitions.test.ts` (T4-01)
- `utility.test.ts` (T4-02)
- `economy-ai.test.ts` (T4-03)
- `expansion-ai.test.ts` (T4-04)
- `military-ai.test.ts` (T4-05)
- `diplomacy-ai.test.ts` (T4-06)
- `goap-planner.test.ts` (T4-07)
- `decision-cache-impl.test.ts` (T4-08)
- `update-zones.test.ts` (T4-09)
- `simplified-growth.test.ts` (T4-10)
- `ai-module.test.ts` (T4-11)
- `ai-economy-integration.test.ts` (T4-12)
- `ai-diplomacy-integration.test.ts` (T4-13)
- `ai-new-game.test.ts` (T4-14)
- `ai-serialization.test.ts` (T4-15)
- `ai-perf.test.ts` (T4-16)

**`src/components/game/` (новые UI-компоненты):**
- `faction-panel.tsx`
- `diplomacy-view.tsx`
- `trade-proposal-dialog.tsx`
- `ai-action-log.tsx`
- `new-game-faction-select.tsx`

### Изменённые (существующие)

- 📝 `src/core/types.ts` — расширить `GameState` полями `aiFactions`, `activeFactionIds`, `difficulty` (импорт из `@/ai/faction-types`).
- 📝 `src/core/events.ts` — расширить `AIEvents` ~17 новыми событиями (см. §5).
- 📝 `src/core/game-mediator.ts` — `newGame()` принимает `aiFactionTypes?`/`aiFactionCount?`/`difficulty?`; инициализирует `aiFactions`.
- 📝 `src/stores/game-store.ts` — `getMediatorWithModules()` регистрирует `AIModule`; `GameStore.newGame` пробрасывает параметры AI; `tick()` делегирует в `mediator.tick()` (refactor); `serializeGameState`/`deserializeGameState` корректно сериализуют `aiFactions` (Map → массив пар).
- 📝 `src/app/page.tsx` — добавить `new-game-faction-select` экран;挂 `faction-panel` в `game-layout`.
- 📝 `src/components/game/game-layout.tsx` — добавить `faction-panel` и `ai-action-log` в layout.
- 📝 `src/components/game/galaxy-map.tsx` — подсветка систем по владельцу цветом фракции.
- 📝 `src/components/game/resource-panel.tsx` — показ доходов от торговли с AI.

---

> **Итог по блоку:** План описывает внедрение 5 базовых AI-фракций (расширяемо) с гибридом Utility AI + GOAP, экономическим/военным/дипломатическим/экспансионистским AI, оптимизацией для 3–5 фракций и интеграцией в существующую модульную архитектуру. Чёткие критерии готовности (§10) и порядок внедрения (§11) позволяют делегировать отдельные подзадачи ИИ-агентам с ограниченным контекстом. Зависимости от Блоков 2 (флот) и 3 (исследования) обработаны через стаб-режим (§9.3, §9.4).
