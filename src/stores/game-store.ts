/**
 * Основной Zustand-стор для игрового состояния.
 *
 * Версия 4.0 (Block 01 P2): обёрнут в immer-middleware.
 * Все set()-вызовы используют draft-мутации — immer создаёт новые
 * ссылки для изменённых путей, что позволяет `useMemo([gameState.galaxy.systems])`
 * корректно срабатывать после любой мутации.
 *
 * Версия 3.0: Работает через GameMediator.
 * Стор делегирует действия медиатору и модулям,
 * а сам отвечает за реактивность (React re-renders).
 *
 * Паттерн:
 * - Мутации → через модули/медиатор (движок) с immer produce()
 * - Реактивность → через Zustand set() (UI)
 * - События → через TypedEventBus (межмодульное взаимодействие)
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { produce } from 'immer';
import type { GameState, GameSpeed, StarSystem, Planet, EntityId, ProductionQueue, ColonyRole, WarehouseSpecialization, ResearchState } from '@/core/types';
import { findPlanet } from '@/core/find-planet';
import '@/core/immer-setup'; // Block 01 P2: enableMapSet + setAutoFreeze(false)
import { getGameMediator } from '@/core/game-mediator';
import { applyColonyRole, calculateWarehouseCapacity, calculateWarehouseCapacities, canStoreResource, getOrbitBufferUsed } from '@/data/warehouse';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { setCurrentLookups, getCurrentLookups } from '@/data/baked-lookups';
import type { BakedGalaxyModel } from '@/data/chemistry-generator'; // R-39: тип модели для защиты lookups при отказе загрузки
import type { GameMediator } from '@/core/game-mediator'; // R-39: тип для instance-tracking регистрации модулей
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { resetProductionItemCounter, restoreProductionItemCounter } from '@/economy/engine';
import { SerializedGameStateSchema } from '@/lib/schemas/game-state-schema'; // Block 08 gap-9: state validation on deserialize
import { compactSaveV3, expandSaveV3 } from '@/lib/save-format-v3'; // R-29: ленивые залежи + словарь; R-30: v3 — единственный формат
import { DEPOSIT_RNG_VERSION, migrateMaterializedBodySummary, needsSummaryMigration, type LazyDepositBody } from '@/galaxy/generate-resources'; // R-37: перепись тел, ожидающих версионную материализацию; R-38: миграция свода материализованных тел
import { gzipBase64, gunzipBase64, isBrowserCodecAvailable } from '@/lib/save-codec-browser'; // R-26: сжатый транспорт сейвов
import { enqueueShipBuild as enqueueShipBuildFn, cancelShipyardItem as cancelShipyardItemFn } from '@/data/ships/shipyard-queue'; // Block 02 F6
import { ShipsModule, resetShipCounter } from '@/ships/ships-module'; // Block 02 F5
import { FleetModule } from '@/ships/fleet-module'; // Block 02 F5
import { ResearchModule } from '@/research/research-module'; // Block 03 R7
import { AIModule } from '@/ai/ai-module'; // Этап 3а (R-41): каркас AI без игровых действий
import {
  AI_FACTION_STATE_VERSION,
  createAIFactionRoster,
  validateAIFactionRegistry,
  type AIFactionSetupOptions,
  type AIFactionState,
} from '@/ai/factions'; // Этап 3б.1 (R-44): постоянный реестр AI-фракций + v3-секция сейва
import {
  createFleet as createFleetFn,
  mergeFleets as mergeFleetsFn,
  splitFleet as splitFleetFn,
  getFleetById as getFleetByIdFn,
  getFleetsAt as getFleetsAtFn,
  getLooseShips as getLooseShipsFn,
} from '@/ships/fleet-engine'; // Block 02 F3
import { executeOrder as executeOrderFn } from '@/ships/orders'; // Block 02 F4
import {
  TECH_MAP as TECH_MAP_FN,
  createResearchSlot as createResearchSlotFn,
  canStartResearch as canStartResearchFn,
  arePrerequisitesMet as arePrerequisitesMetFn,
  advanceQueue as advanceQueueFn,
  levelUpFundamentalEngine as levelUpFundamentalEngineFn,
} from '@/research'; // Block 03 R6/R7 — research engine helpers
// Note: ResearchState type is already imported above from '@/core/types' (line 22).

/**
 * Block 03 (R7): детерминированный счётчик ID слотов исследований.
 * Аналог shipyardItemCounter из Phase 2.3 — без Math.random.
 */
let researchSlotCounter = 0;

// ============ Типы стора ============

export type GameView = 'galaxy' | 'system' | 'planet' | 'ship-designer' | 'fleet' | 'research';

/**
 * Block 02 (F2): детерминированный счётчик ID дизайнов кораблей.
 * Аналог productionItemCounter из engine.ts — без Math.random(),
 * для соблюдения детерминизма игры (Block 07 gap-3).
 */
let shipDesignCounter = 0;

/**
 * Block 02 (F6): детерминированный счётчик ID элементов очереди верфи.
 */
let shipyardItemCounter = 0;

/**
 * Block 02 (F3): детерминированный счётчик ID флотов.
 * Без Math.random — для детерминизма (Block 07 gap-3).
 * (shipCounter для ID построенных кораблей добавляется в Phase 2.6 — ShipsModule.)
 */
let fleetCounter = 0;

export interface SaveInfo {
  id: string;
  name: string;
  seed: number;
  tick: number;
  createdAt: string;
  updatedAt: string;
}

export interface GameStore {
  // === Состояние ===
  gameState: GameState | null;
  view: GameView;
  selectedSystemId: EntityId | null;
  selectedPlanetId: EntityId | null;
  /** Block 02 (F7): currently selected fleet (for galaxy-map right-click
   *  context menu — «Перебросить флот сюда» issues move order to this fleet). */
  selectedFleetId: EntityId | null;
  isInitialized: boolean;
  currentSaveId: string | null;
  isSaving: boolean;
  saveError: string | null;
  isLoading: boolean;
  /**
   * R-39: предупреждения последней УСПЕШНОЙ загрузки (наблюдаемость
   * миграций для пользователя — не только console.warn): сюда попадают
   * отказы миграции свода R-38 (тело сохраняет прежний свод) и перепись
   * тел, ожидающих версионной материализации R-37. Пустой массив —
   * чистая загрузка без замечаний. UI (page.tsx) показывает тост.
   */
  loadWarnings: string[];
  /**
   * Audit 2026-08-28: случайный seed галактики для нового меню.
   * Хранится в Zustand store (НЕ в локальном useState компонента page.tsx),
   * чтобы не «прыгал» при перерисовке/перемонтировании компонента. Если бы
   * seed хранился в useState, при каждом возврате в главное менюlazy
   * initializer `useState(() => Math.random()...)` вызывался бы заново и
   * пользователь получал новый seed — часто (раз в 20-30 секунд при активной
   * игре). Теперь seed стабилен до явного roll.
   */
  galaxySeed: number;

  // === Действия ===
  /** Сгенерировать новый случайный seed (для кнопки «кости» в главном меню). */
  rollGalaxySeed: () => void;
  newGame: (config?: Partial<import('@/galaxy').GalaxyGenConfig>) => void;
  setSpeed: (speed: GameSpeed) => void;
  togglePause: () => void;
  tick: () => void;

  // Навигация
  setView: (view: GameView) => void;
  selectSystem: (id: EntityId | null) => void;
  selectPlanet: (id: EntityId | null) => void;

  // Экономика
  buildOnHex: (planetId: EntityId, hexIndex: number, buildingId: string) => boolean;
  buildOnAtmosphereSlot: (planetId: EntityId, slotIndex: number, buildingId: string) => boolean;
  buildOnOrbitSlot: (planetId: EntityId, slotIndex: number, buildingId: string) => boolean;
  upgradeBuildingOnHex: (planetId: EntityId, hexIndex: number) => boolean;
  // R-DEMOLISH (Задача 22): понижение уровня и снос зданий.
  downgradeBuildingOnHex: (planetId: EntityId, hexIndex: number) => boolean;
  demolishBuildingOnHex: (planetId: EntityId, hexIndex: number) => boolean;
  downgradeBuildingOnSlot: (planetId: EntityId, layer: 'atmosphere' | 'orbit', slotIndex: number) => boolean;
  demolishBuildingOnSlot: (planetId: EntityId, layer: 'atmosphere' | 'orbit', slotIndex: number) => boolean;
  enqueueProduction: (planetId: EntityId, recipeId: string, repeat?: boolean) => boolean;
  cancelProduction: (planetId: EntityId, queueItemId: string) => boolean;
  // Block 05 PR7 — специализация переработчиков
  specializeBuildingOnHex: (
    planetId: EntityId,
    hexIndex: number,
    category: import('@/core/types').ProcessorRecipeCategory | 'universal',
  ) => boolean;
  upgradeSpecializationOnHex: (planetId: EntityId, hexIndex: number) => boolean;

  // Колонизация
  colonizePlanet: (planetId: EntityId) => boolean;

  // Этап 3б.1 (R-44): детерминированная расстановка AI-фракций по seed галактики.
  // Отказ (false): нет gameState / реестр уже непуст (дубликат-регистрация —
  // явный отказ по контракту среза) / невалидные опции. НЕ меняет поведение
  // существующих систем — только добавляет поле aiFactions в состояние.
  setupAIFactions: (options?: AIFactionSetupOptions) => boolean;

  // Склад
  setColonyRole: (planetId: EntityId, role: ColonyRole) => void;
  setReserveMinimum: (planetId: EntityId, resourceId: string, minimum: number) => void;
  setWarehouseSpecialization: (planetId: EntityId, spec: WarehouseSpecialization) => void;
  moveToOrbit: (planetId: EntityId, resourceId: string, amount: number) => boolean;
  moveFromOrbit: (planetId: EntityId, resourceId: string, amount: number) => boolean;

  // Сохранение/загрузка
  saveGame: (name?: string) => Promise<boolean>;
  loadGame: (id: string) => Promise<boolean>;
  loadSaveList: () => Promise<SaveInfo[]>;
  deleteSave: (id: string) => Promise<boolean>;

  // ─── Block 02 (F2): Конструктор кораблей ────────────────
  /** Сохранить дизайн корабля в GameState.shipDesigns. Возвращает id или null. */
  saveShipDesign: (design: Omit<import('@/core/types').ShipDesign, 'id' | 'createdAtTick'> & { id?: string }) => string | null;
  /** Удалить дизайн корабля по id. */
  deleteShipDesign: (id: string) => boolean;
  /** Получить дизайн по id. */
  getShipDesign: (id: string) => import('@/core/types').ShipDesign | undefined;
  /** Список всех дизайнов игрока. */
  listShipDesigns: () => import('@/core/types').ShipDesign[];

  // ─── Block 02 (F6): Верфь — постройка кораблей ──────────
  /** Поставить дизайн в очередь постройки на верфи планеты. Возвращает itemId или null. */
  enqueueShipBuild: (planetId: string, designId: string, shipName?: string) => string | null;
  /** Отменить элемент очереди постройки. */
  cancelShipyardItem: (planetId: string, itemId: string) => boolean;
  /** Получить очередь постройки планеты. */
  getShipyardQueue: (planetId: string) => import('@/core/types').ShipyardQueue | undefined;

  // ─── Block 02 (F3): Флот-менеджер — create/merge/split ───
  /** Создать новый флот из выбранных кораблей. Возвращает id нового флота или null. */
  createFleet: (name: string, shipIds: string[], atSystemId: string) => string | null;
  /** Объединить несколько флотов в один. Возвращает id нового флота или null. */
  mergeFleets: (fleetIds: string[]) => string | null;
  /** Разделить флот на два: оставшийся + извлечённый. Возвращает id извлечённого флота или null. */
  splitFleet: (sourceFleetId: string, shipIdsToExtract: string[], newName?: string) => string | null;
  /** Переименовать флот. */
  renameFleet: (fleetId: string, newName: string) => boolean;
  /** Получить флот по id (sync lookup). */
  getFleet: (fleetId: string) => import('@/core/types').Fleet | undefined;
  /** Получить все флоты в указанной системе. */
  getFleetsAtSystem: (systemId: string) => import('@/core/types').Fleet[];
  /** Получить корабль по id. */
  getShip: (shipId: string) => import('@/core/types').Ship | undefined;
  /** Получить «свободные» корабли игрока на локации (planetId или systemId). */
  getLooseShips: (ownerId: string, location?: string) => import('@/core/types').Ship[];

  // ─── Block 02 (F4): Приказы флотов ─────────────────────
  /** Отдать приказ флоту. type — move/patrol/colonize/attack/defend. Возвращает true если успешно. */
  issueFleetOrder: (
    fleetId: string,
    type: import('@/core/types').FleetOrder['type'],
    targetId: string,
  ) => boolean;
  /** Отменить текущий приказ флота (снимает orders[0]). */
  cancelFleetOrder: (fleetId: string) => boolean;
  /** Block 02 (F7): выбрать флот (для контекстного меню galaxy-map). */
  selectFleet: (fleetId: EntityId | null) => void;

  // ─── Block 03 (R6/R7): Исследования ─────────────────────
  /** Поставить технологию в очередь исследований. Возвращает slotId или null. */
  startResearch: (techId: string, targetLevel: number) => string | null;
  /** Отменить слот исследований (списать rpInvested). */
  cancelResearch: (slotId: string) => boolean;
  /** Изменить аллокацию слота (5..100). */
  setAllocation: (slotId: string, percent: number) => boolean;
  /** Поднять фундаментальную ветку (если хватает RP в invested-пуле). */
  levelUpFundamental: (branchId: import('@/core/types').FundamentalBranchId) => boolean;
  /** Распределить аллокации поровну между всеми активными слотами. */
  autoAllocateSlots: () => void;
  /**
   * R-RES §B: добавить techId в очередь исследований. Если активных слотов
   * нет — сразу стартует; иначе кладёт в хвост очереди.
   * Возвращает true, если добавлено.
   */
  addToResearchQueue: (techId: string) => boolean;
  /** R-RES §B: убрать элемент из очереди по индексу. */
  removeFromResearchQueue: (index: number) => boolean;
  /** R-RES §B: переместить элемент очереди с индекса from на to. */
  reorderResearchQueue: (from: number, to: number) => boolean;
  /** R-RES §B: очистить очередь. */
  clearResearchQueue: () => void;
  /** Получить текущее ResearchState (sync lookup). */
  getResearchState: () => import('@/core/types').ResearchState | null;

  // Утилиты
  getSystem: (id: EntityId) => StarSystem | undefined;
  getPlanet: (id: EntityId) => Planet | undefined;
  getSelectedSystem: () => StarSystem | undefined;
  getSelectedPlanet: () => Planet | undefined;
}

// ============ Медиатор (инициализация) ============

/**
 * R-39 (P0-1): медиатор, на котором зарегистрированы модули стора.
 *
 * Прежде это был булев флаг `modulesRegistered`, который НЕ сбрасывался
 * при resetGameMediator(): после пересоздания синглтона стор продолжал
 * думать, что модули зарегистрированы, — новый медиатор оставался БЕЗ
 * модулей и БЕЗ подписки core:state-changed (тихий полный рассинхрон
 * стора и симуляции). Теперь отслеживаем ИНСТАНС: если синглтон
 * пересоздан (тесты/resetGameMediator) — модули и подписка
 * регистрируются заново на новом медиаторе.
 */
let modulesRegisteredOn: GameMediator | null = null;

/**
 * Получить медиатор с зарегистрированными модулями.
 * Также подписывается на `core:state-changed` один раз (на каждый инстанс
 * медиатора) — это позволяет модулям и медиатору синхронизировать
 * Zustand-store после любой мутации GameState (паттерн 3.6 из Block 06).
 */
function getMediatorWithModules(): GameMediator {
  const mediator = getGameMediator();

  if (modulesRegisteredOn !== mediator) {
    const economyModule = new EconomyModule();
    const galaxyModule = new GalaxyModule();
    // Block 02 (F5, F7): ships + fleet modules — shipyard queue processing
    // (priority SIMULATION+10, after economy) + fleet movement via JP
    // (priority SIMULATION+20, after ships). Both need GameState accessor +
    // mutator to commit immutable produced state (Block 01 P2 pattern).
    const shipsModule = new ShipsModule();
    const fleetModule = new FleetModule();
    // Block 03 (R7): research module — RP accumulation + unlocks.
    // priority SIMULATION+5 (after economy, before ships — research tick
    // is independent of ship construction, but goes after economy so
    // building/lab changes are visible).
    const researchModule = new ResearchModule();
    // Этап 3а (R-41, Issue #5): AI-модуль — детерминированный каркас
    // (world model + perception, инертная intent-очередь). Регистрируется
    // ПОСЛЕДНЕЙ → тикает последним (initOrder [...,'ai'], deps=['economy']).
    const aiModule = new AIModule();

    // Модули нуждаются в доступе к GameState — устанавливаем accessor.
    // Block 01 P2: also set a mutator so modules can commit new immutable state
    // (produced via immer.produce) back to the mediator.
    economyModule.setGameStateAccessor(() => mediator.getGameState());
    economyModule.setGameStateMutator((state) => mediator.commitState(state));
    galaxyModule.setGameStateAccessor(() => mediator.getGameState());
    galaxyModule.setGameStateMutator((state) => mediator.commitState(state));
    shipsModule.setGameStateAccessor(() => mediator.getGameState());
    shipsModule.setGameStateMutator((state) => mediator.commitState(state));
    fleetModule.setGameStateAccessor(() => mediator.getGameState());
    fleetModule.setGameStateMutator((state) => mediator.commitState(state));
    researchModule.setGameStateAccessor(() => mediator.getGameState());
    researchModule.setGameStateMutator((state) => mediator.commitState(state));
    aiModule.setGameStateAccessor(() => mediator.getGameState());
    // Этап 3а (R-41): mutator AI СОЗНАТЕЛЬНО НЕ устанавливается — AI не
    // может мутировать/коммитить GameState (коммит физически недоступен;
    // игровые действия появятся в 3б через существующие команды/шину).

    mediator.registerAndInit([
      galaxyModule,
      economyModule,
      researchModule,
      shipsModule,
      fleetModule,
      aiModule, // последний → тик AI после всех симуляционных модулей
    ]);

    // Block 01 P2: subscribe to core:state-changed — modules already produce
    // immutable state via immer.produce(), so we just assign the new reference.
    // No shallow clone needed — newState already has new refs for changed paths.
    mediator.getBus().on('core:state-changed', (newState) => {
      useGameStore.setState({ gameState: newState });
    });

    modulesRegisteredOn = mediator;

    // R-39 (D4): медиатор пересоздан (resetGameMediator в тестах / смена
    // инстанса) — у НОВОГО медиатора нет gameState, и первый Pattern A-экшен
    // (build/colonize/enqueue через шину) молча не сработал бы: модули читали
    // бы null. Восстанавливаем состояние стора в медиатор (lookups уже
    // актуальны — их resetGameMediator не трогает; loop приводится в
    // соответствие фазе). Холодный старт (gameState null) — пропуск.
    const currentGameState = useGameStore.getState().gameState;
    if (currentGameState) {
      mediator.setLoadedState(currentGameState);
    }
  }

  return mediator;
}

/**
 * Audit Pass 1 P0-1 (fix): sync Zustand-store state back to the GameMediator.
 *
 * The store subscription `core:state-changed → useGameStore.setState` is
 * one-directional (mediator → store). Actions that mutate `gameState`
 * directly through the immer middleware (`set((state) => { state.gameState... })`)
 * create a NEW state reference inside the store, but `mediator.gameState`
 * still points at the OLD reference. On the next `mediator.tick()` the
 * mediator reads its stale ref, processes it through `produce()` and
 * `commitState()` — silently overwriting the user's recent edits.
 *
 * Call this helper at the end of every direct-mutation store action to
 * propagate the new state reference back to the mediator.
 *
 * NOTE: This helper is defined OUTSIDE the zustand `create((set, get) => ...)`
 * closure, so it CANNOT use the closure's `get()` — that would throw
 * `ReferenceError: get is not defined` at runtime. Instead, it calls
 * `useGameStore.getState()` (the static accessor on the resulting hook).
 * This is the idiomatic way to read store state from outside an action.
 */
function syncMediatorState(): void {
  const newState = useGameStore.getState().gameState;
  if (newState) {
    getMediatorWithModules().commitState(newState);
  }
}

// ============ Сериализация ============

/**
 * Сериализует GameState в JSON-строку.
 *
 * Exported for Block 01 T5 (serialization round-trip test) so test code can
 * exercise the same save/load pipeline used by `saveGame`/`loadGame`.
 */
export function serializeGameState(state: GameState): string {
  const { systemMap: _systemMap, bakedModel: _bakedModel, ...galaxyWithoutMap } = state.galaxy;
  // Этап 3б.1 (R-44): AI-реестр вырезается из spread ВСЕГДА; пишется обратно
  // ТОЛЬКО при непустом реестре (с маркером версии aiFactionsV, ключи — в
  // конце, порядок детерминирован). Состояния без AI-фракций (и с пустым
  // реестром) сериализуются побайтно как прежде — якоря sha256 R-39/R-40/
  // R-42/R-41 сохраняются, старые сейвы проходят рантрип без инъекции ключей.
  const { aiFactions, ...stateWithoutAI } = state;
  const serializable = {
    ...stateWithoutAI,
    galaxy: galaxyWithoutMap,
    productionQueues: Array.from(state.productionQueues.entries()),
    // Block 02 (F7): serialize shipDesigns + shipyardQueues + ships as entries arrays
    shipDesigns: Array.from(state.shipDesigns.entries()),
    shipyardQueues: Array.from(state.shipyardQueues.entries()),
    ships: Array.from(state.ships.entries()),
  };
  const hasAIFactions = !!aiFactions && Object.keys(aiFactions).length > 0;
  const payload = hasAIFactions
    ? { ...serializable, aiFactions, aiFactionsV: AI_FACTION_STATE_VERSION }
    : serializable;
  // R-29: формат v3 — ленивые залежи (только материализованные тела,
  // истощённые не пишутся) + словарь id (кортежи-индексы). Чистая функция:
  // живое state не мутируется (строятся новые объекты).
  return JSON.stringify(compactSaveV3(payload as unknown as Record<string, unknown>));
}

/**
 * Десериализует GameState из JSON-строки.
 *
 * Exported for Block 01 T5 (serialization round-trip test). The function is
 * pure with respect to input: it rebuilds `systemMap` from `galaxy.systems`
 * and regenerates `galaxy.bakedModel` from the galaxy seed when the field is
 * absent in the serialized JSON (always — `serializeGameState` strips it).
 *
 * Block 08 (audit §2.3, gap-9): top-level state structure is validated
 * against `SerializedGameStateSchema` (zod).
 *
 * R-26: слои совместимости со старыми форматами сейвов УДАЛЕНЫ
 * (старые сейвы потерты, миграции не нужны):
 *   - GameTimeV0 (`time.day`) больше не принимается — формат один;
 *   - миграции researchState / процессорных полей планет (migratePlanet /
 *     migrateProcessorInstance / migrateResearchState) убраны;
 *   - fallback на unvalidated parse при ошибке валидации заменён на throw —
 *     битый формат сейва это ошибка, а не «совместимость».
 *
 * NOTE: `bakeGalaxyModel` embeds `new Date().toISOString()` in `bakedModel.createdAt`,
 * so the deserialized state's `bakedModel.createdAt` will differ from the original
 * state's timestamp. This is a known non-determinism bug — see
 * `08_27_block_01_progress.md` (T5) and `docs/galaxy-bake.md` (todo: strip
 * `createdAt` from bakeGalaxyModel). Tests work around it by stripping the
 * `createdAt` field before deep-equal comparisons.
 */
/**
 * R-37 (Б1/Б2 аудита R-36): перепись тел, ожидающих версионной материализации.
 *
 * ЗАГРУЗКА НЕ МАТЕРИАЛИЗУЕТ ТЕЛА (версионная совместимая материализация):
 * прежде (R-36) deserializeGameState материализовал все тела с dv ≠ текущей
 * СРАЗУ при загрузке — это (а) вызывало getCurrentLookups() ДО инициализации
 * (краш холодного старта) или с моделью ПРЕДЫДУЩЕЙ игры (кросс-галактика),
 * (б) раздувало следующий сейв (все тела dm=true → залежи всех гексов
 * пишутся) — блокеры Б1/Б2. Теперь материализация — ТОЛЬКО при колонизации
 * (materializePlanetDeposits: replay + пересчёт сводного пула — дрейф
 * поглощается, пул следует за физикой), а на загрузке ведётся только
 * дешёвая перепись (O(тел), без lookups, без мутаций) для явного журнала.
 */
function needsDepositMigration(body: LazyDepositBody): boolean {
  return !body.depositsMaterialized
    && Array.isArray(body.depositRngState)
    && (body.depositRngVersion ?? 1) !== DEPOSIT_RNG_VERSION;
}

/** Число тел (планеты + луны), дождущихся версионной материализации при колонизации. */
function countPendingDepositMigrations(systems: Array<Record<string, unknown>> | undefined): number {
  if (!Array.isArray(systems)) return 0;
  let pending = 0;
  for (const sys of systems) {
    const planets = sys.planets as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(planets)) continue;
    for (const p of planets) {
      if (needsDepositMigration(p as unknown as LazyDepositBody)) pending++;
      const moons = p.moons as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(moons)) {
        for (const m of moons) {
          if (needsDepositMigration(m as unknown as LazyDepositBody)) pending++;
        }
      }
    }
  }
  return pending;
}

/**
 * R-38: миграция свод-пулов МАТЕРИАЛИЗОВАННЫХ тел старых сейвов.
 *
 * Непокрытый R-37 сценарий (аудит R-38 §2): тело уже колонизировано в старом
 * сейве — физические залежи записаны (dm=1), но свод-пул посчитан устаревшей
 * семантикой агрегации (выбранный уникальный ресурс перезаписывался
 * константами без согласования с физикой и т.п.). Версионная материализация
 * R-37 тут НЕ работает (dm=1 — replay невозможен, залежи уже физические) —
 * устаревший свод оставался навсегда.
 *
 * Стратегия (явная, документированная): ФИЗИКА СОХРАНЯЕТСЯ КАК ЕСТЬ
 * (deposits/buildings/owner/склад/прогресс добычи/истощение неприкосновенны),
 * а свод пересчитывается из фактических залежей текущим контрактом
 * «свод = физика» (migrateMaterializedBodySummary). dv НЕ поднимается —
 * версия физики остаётся честной; повторная загрузка идемпотентна (sv).
 * Молчаливой регенерации НЕТ: тело, материализованное старым кодом, НЕ
 * получает залежи новой генерации (следовые ultra/усиленная уникальная
 * залежь отсутствуют — задокументированное ограничение для владельца).
 *
 * Вызывается ПОСЛЕ setCurrentLookups (агрегации нужна модель загружаемой
 * галактики — порядок Б1 R-37 сохранён) и НЕ трогает ленивые тела (dm=0 —
 * ленивость и размер сейва R-37 сохранены). Атомарность на тело: отказ
 * миграции одного тела сохраняет его прежний свод и не блокирует загрузку.
 *
 * Подсчёт отказов: отказавшим считается тело, которому миграция БЫЛА НУЖНА
 * (needsSummaryMigration) но не состоялась (исключение/невалидный результат —
 * тело сохраняет прежний свод). Ленивые тела и тела с актуальным сводом
 * законно возвращают false (им миграция не нужна) — отказом НЕ считаются.
 */
function migrateStaleMaterializedSummaries(systems: Array<Record<string, unknown>> | undefined): { migrated: number; failed: number; failures: string[] } {
  if (!Array.isArray(systems)) return { migrated: 0, failed: 0, failures: [] };
  let migrated = 0;
  let failed = 0;
  const failures: string[] = [];
  const tryBody = (body: Record<string, unknown>): void => {
    const b = body as unknown as LazyDepositBody;
    if (migrateMaterializedBodySummary(b)) { migrated++; return; }
    if (needsSummaryMigration(b)) {
      failed++;
      // R-39: наблюдаемость отказа для пользователя (не только console):
      // тело сохраняет прежний (устаревший) свод — это видно в UI-тосте.
      failures.push(`тело ${typeof b.id === 'string' ? b.id : '?'}: миграция свода отказана, сохранён прежний свод`);
    }
  };
  for (const sys of systems) {
    const planets = sys.planets as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(planets)) continue;
    for (const p of planets) {
      tryBody(p);
      const moons = p.moons as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(moons)) {
        for (const m of moons) tryBody(m);
      }
    }
  }
  return { migrated, failed, failures };
}

/**
 * R-39: предупреждения последней десериализации (наблюдаемость миграций).
 * Сбрасывается в начале deserializeGameState; loadGame переносит в
 * store.loadWarnings для UI-тоста. Читается ТОЛЬКО сразу после успешного
 * deserializeGameState (канал одноразовый — consume-семантика).
 */
let lastDeserializeWarnings: string[] = [];

/** R-39: забрать (и очистить) предупреждения последней deserializeGameState. */
export function consumeDeserializeWarnings(): string[] {
  const out = lastDeserializeWarnings;
  lastDeserializeWarnings = [];
  return out;
}

export function deserializeGameState(json: string): GameState {
  const raw = JSON.parse(json);
  // R-39: канал предупреждений для loadGame → store.loadWarnings (UI-тост).
  lastDeserializeWarnings = [];

  // ─── R-29/R-30: разворот компактного формата v3 ────────────────
  // Мутирует raw на месте (объект свежий из JSON.parse — владеем им):
  // кортежи залежей/свода → объекты, coord восстанавливается из сетки.
  // v3 — единственный формат: fmt≠3 отклоняется явной ошибкой
  // (декодеры v1/v2 удалены в R-30 — старые сейвы стёрты владельцем).
  expandSaveV3(raw);

  // R-RES-QUEUE-01 v1.2: incompatible research save contracts are not migrated.
  const savedResearchState = raw.researchState as {
    activeSlots?: unknown;
    researchProgressByTech?: unknown;
  } | undefined;
  const savedProgress = savedResearchState?.researchProgressByTech;
  const savedActiveSlots = savedResearchState?.activeSlots;
  const validProgressMap = typeof savedProgress === 'object' && savedProgress !== null &&
    !Array.isArray(savedProgress) && Object.values(savedProgress).every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    );
  const validActiveSlots = Array.isArray(savedActiveSlots) && savedActiveSlots.length <= 1;
  if (!validProgressMap || !validActiveSlots) {
    throw new Error(
      'deserializeGameState: несовместимый контракт исследований. ' +
      'Требуются researchProgressByTech и не более одного activeSlot. ' +
      'Сейвы предыдущих версий игры не поддерживаются — начните новую игру.',
    );
  }

  // ─── Block 08 gap-9: top-level schema validation ──────────────────
  // R-26: строгая проверка — невалидный формат сейва бросает ошибку
  // (fallback-ветка на unvalidated parse удалена как мёртвый слой
  // совместимости). ДО установки lookups: отклонённый сейв не должен
  // затирать модель активной игры.
  const validationResult = SerializedGameStateSchema.safeParse(raw);
  if (!validationResult.success) {
    const issues = validationResult.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`deserializeGameState: невалидный формат сейва — ${issues}`);
  }

  // ─── Этап 3б.1 (R-44): AI-секция сейва (версионированная) ──────────
  // Маркер aiFactionsV — ТРАНСПОРТНЫЙ (не состояние): при наличии реестра
  // обязан совпадать с AI_FACTION_STATE_VERSION (иначе явная ошибка — как
  // fmt≠3 в R-30: молчаливая интерпретация чужой версии портила бы
  // состояние), после проверки удаляется из raw. Отсутствие AI-полей —
  // совместимость: предсказуемый дефолт «реестра нет» (поле в GameState
  // не создаётся; читатели обязаны трактовать отсутствие как пустой реестр).
  if (raw.aiFactions !== undefined) {
    if (raw.aiFactionsV !== AI_FACTION_STATE_VERSION) {
      throw new Error(
        `deserializeGameState: версия AI-секции сейва aiFactionsV=${String(raw.aiFactionsV)} `
        + `не поддерживается (ожидается ${AI_FACTION_STATE_VERSION}). `
        + 'Сейв создан другой версией игры — начните новую игру.',
      );
    }
    delete raw.aiFactionsV;
  } else if (raw.aiFactionsV !== undefined) {
    // Маркер без реестра — пустой реестр: маркер снимаем, поле не создаём.
    delete raw.aiFactionsV;
  }

  // ─── R-37 (Б1): baked-model ИМЕННО загружаемой галактики → setCurrentLookups ──
  // Порядок требует аудитор: ЛЮБАЯ работа с залежами (материализация при
  // колонизации, добыча, UI) обязана видеть модель ЭТОЙ галактики. Прежде
  // (R-36) загрузочная миграция залежей шла ДО этой строки: на холодном
  // старте getCurrentLookups() бросал «не инициализированы», после активной
  // игры использовалась модель ПРЕДЫДУЩЕЙ галактики. Теперь на загрузке
  // работы с залежами нет вовсе (версионная совместимая материализация —
  // при колонизации), а lookups устанавливаются здесь — до возврата состояния.
  const bakedModel = raw.galaxy.bakedModel ?? bakeGalaxyModel(raw.galaxy.seed ?? 42, ELEMENTS);
  setCurrentLookups(bakedModel);

  // ─── R-38: миграция свод-пулов МАТЕРИАЛИЗОВАННЫХ тел старых сейвов ──
  // Единственная работа с залежами на загрузке: тела, уже колонизированные
  // старым кодом (dm=1, dv≠текущей), сохраняют ФИЗИКУ как есть (прогресс
  // добычи/истощение/здания/склад неприкосновенны), а устаревший свод
  // пересчитывается из фактических залежей контрактом «свод = физика»
  // (migrateStaleMaterializedSummaries → migrateMaterializedBodySummary).
  // ПОСЛЕ setCurrentLookups (агрегации нужна модель загружаемой галактики —
  // порядок Б1 R-37 сохранён); ленивые тела (dm=0) не затрагиваются.
  // Отказы не бросаются наружу: тело сохраняет прежний свод, загрузка
  // продолжается (аудит R-38 §2.3/§2.5 — предсказуемо, без тихой порчи).
  const summaryMigration = migrateStaleMaterializedSummaries(
    raw.galaxy?.systems as Array<Record<string, unknown>> | undefined,
  );
  if (summaryMigration.migrated > 0 || summaryMigration.failed > 0) {
    console.warn(
      `[save] R-38: миграция свод-пулов материализованных тел (свод = физика): `
      + `пересчитано ${summaryMigration.migrated}, отказов ${summaryMigration.failed}`
      + ' — физика/склад/прогресс добычи сохранены, dv тел не изменён',
    );
    // R-39: пользователь видит отказы миграции (тост), а не только консоль.
    if (summaryMigration.failed > 0) {
      lastDeserializeWarnings.push(
        `R-38: миграция свод-пулов — пересчитано ${summaryMigration.migrated}, отказов ${summaryMigration.failed}`,
        ...summaryMigration.failures,
      );
    }
  }

  // ─── R-37 (Б2): перепись тел, ожидающих версионной материализации ──
  // ЗАГРУЗКА НЕ МАТЕРИАЛИЗУЕТ (ленивость R-29 и размер сейва сохранены):
  // тела с dv ≠ DEPOSIT_RNG_VERSION (сейвы до R-37) остаются ленивыми —
  // их залежи воспроизводятся ТЕКУЩИМ кодом при колонизации, а свод-пул
  // пересчитывается из свежей физики (дрейф поглощается — см.
  // materializePlanetDeposits). Здесь — только явный журнал (без мутаций,
  // без lookups, O(тел)).
  const pendingMigrations = countPendingDepositMigrations(raw.galaxy?.systems as Array<Record<string, unknown>> | undefined);
  if (pendingMigrations > 0) {
    console.warn(
      `[save] R-37: тел, ожидающих версионной материализации залежей (dv → ${DEPOSIT_RNG_VERSION}): ${pendingMigrations}`
      + ' — материализация и пересчёт свод-пула при колонизации',
    );
    // R-39: информируем пользователя (информационное, не ошибка).
    lastDeserializeWarnings.push(
      `R-37: ${pendingMigrations} тел ждут версионной материализации залежей — применится при колонизации`,
    );
  }

  const systems: StarSystem[] = raw.galaxy.systems;
  const systemMap = new Map<string, StarSystem>();
  for (const sys of systems) {
    systemMap.set(sys.id, sys);
  }

  const productionQueues = new Map<string, ProductionQueue>(raw.productionQueues);

  return {
    ...raw,
    galaxy: {
      ...raw.galaxy,
      systemMap,
      systems,
      bakedModel,
    },
    productionQueues,
    fleets: raw.fleets ?? [],
    shipDesigns: new Map(raw.shipDesigns ?? []),
    shipyardQueues: new Map(raw.shipyardQueues ?? []),
    ships: new Map(raw.ships ?? []),
    researchState: raw.researchState,
    time: raw.time,
  };
}

// ============ Store ============

export const useGameStore = create<GameStore>()(immer((set, get) => {
  /** Создать начальное GameState */
  function createInitialState(config: Partial<import('@/galaxy').GalaxyGenConfig>): GameState {
    const mediator = getMediatorWithModules();
    const state = mediator.newGame(config);
    return state;
  }

  return {
    gameState: null,
    view: 'galaxy',
    selectedSystemId: null,
    selectedPlanetId: null,
    selectedFleetId: null,
    isInitialized: false,
    currentSaveId: null,
    isSaving: false,
    saveError: null,
    isLoading: false,
    // R-39: предупреждения последней загрузки (миграции сейвов) для UI.
    loadWarnings: [],
    // Audit 2026-08-28: стабильный seed в store (не прыгает при перемонтировании).
    // Ленивая инициализация один раз при загрузке страницы.
    galaxySeed: Math.floor(Math.random() * 1_000_000) + 1,

    rollGalaxySeed: () => {
      set({ galaxySeed: Math.floor(Math.random() * 1_000_000) + 1 });
    },

    newGame: (config = {}) => {
      // Audit Pass 4 §7.4: cap MVP galaxy at 200 systems. Default
      // GalaxyGenConfig.systemCount is 500 (used by snapshot tests), but at
      // 500 systems the serialized state exceeds the 50 MB save-API limit
      // and x50 tick processing freezes the UI. Override to 200 unless the
      // caller explicitly asks for more (e.g., stress tests).
      const MVP_SYSTEM_COUNT = 200;
      // Audit 2026-08-28: если seed не передан явно, используем стабильный
      // galaxySeed из store (а не DEFAULT_CONFIG.seed = 42 — это давало
      // одинаковую галактику при каждом «New Game» из game-layout).
      const seed = config.seed ?? get().galaxySeed;
      const mergedConfig = {
        ...config,
        seed,
        systemCount: config.systemCount ?? MVP_SYSTEM_COUNT,
      };
      const state = createInitialState(mergedConfig);
      // Сброс детерминированного счётчика ProductionItem IDs (gap-6, P9)
      // для согласованности с новым seed.
      resetProductionItemCounter();
      // Block 02 (F5): reset ship ID counter — new game starts at 0.
      resetShipCounter();
      set({
        gameState: state,
        view: 'galaxy',
        selectedSystemId: state.galaxy.systems[0]?.id ?? null,
        selectedPlanetId: null,
        selectedFleetId: null,
        isInitialized: true,
        currentSaveId: null,
      });
    },

    setSpeed: (speed) => {
      const mediator = getMediatorWithModules();
      const { gameState } = get();
      if (!gameState) return;
      // Делегируем медиатору: он обновит state + loop + эмитнет state-changed
      mediator.setSpeed(speed);
    },

    togglePause: () => {
      const mediator = getMediatorWithModules();
      const { gameState } = get();
      if (!gameState) return;
      // Делегируем медиатору: он переключит phase + loop + эмитнет state-changed
      mediator.togglePause();
    },

    tick: () => {
      const mediator = getMediatorWithModules();
      // Делегируем медиатору: он инкрементирует время и вызовет registry.tickAll,
      // что приведёт к EconomyModule.tick → processEconomyTick → emit state-changed
      mediator.tick();
    },

    setView: (view) => set({ view }),

    selectSystem: (id) => {
      set({ selectedSystemId: id, selectedPlanetId: null });
      if (id) set({ view: 'system' });
    },

    selectPlanet: (id) => {
      set({ selectedPlanetId: id });
      if (id) set({ view: 'planet' });
    },

    buildOnHex: (planetId, hexIndex, buildingId) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.buildingId;
      // Emit event — EconomyModule.onBuild wraps engine.buildOnHex in immer.produce(),
      // commits new immutable state via mediator.commitState() which emits
      // core:state-changed → our subscription updates the store.
      mediator.getBus().emit('economy:build', { planetId, hexIndex, buildingId });
      // Re-fetch state — after produce(), the old planet reference is stale.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.buildingId;
      return after === buildingId && before !== buildingId;
    },

    upgradeBuildingOnHex: (planetId, hexIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.buildingLevel ?? 0;
      mediator.getBus().emit('economy:upgrade', { planetId, hexIndex });
      // Re-fetch — produce() in EconomyModule created a new state reference.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.buildingLevel ?? 0;
      return after > before;
    },

    // ─── R-DEMOLISH (Задача 22): понижение уровня и снос зданий ────────
    downgradeBuildingOnHex: (planetId, hexIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const beforeHex = planet.hexes[hexIndex];
      const beforeLevel = beforeHex?.buildingLevel ?? 0;
      const beforeId = beforeHex?.buildingId ?? null;
      mediator.getBus().emit('economy:downgrade', { planetId, hexIndex, layer: 'surface' });
      // Re-fetch — produce() in EconomyModule created a new state reference.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const afterHex = newPlanet.hexes[hexIndex];
      // Уровень 1 → понижение = снос: гекс освобождён (buildingId → null).
      if (beforeLevel === 1) {
        return afterHex?.buildingId == null && beforeId != null;
      }
      return (afterHex?.buildingLevel ?? 0) < beforeLevel;
    },

    demolishBuildingOnHex: (planetId, hexIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const beforeId = planet.hexes[hexIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:demolish', { planetId, hexIndex, layer: 'surface' });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      return newPlanet.hexes[hexIndex]?.buildingId == null && beforeId != null;
    },

    downgradeBuildingOnSlot: (planetId, layer, slotIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const slots = layer === 'atmosphere' ? planet.atmosphericSlots : planet.orbitSlots;
      if (slotIndex < 0 || slotIndex >= slots.length) return false;
      const beforeLevel = slots[slotIndex]?.buildingLevel ?? 0;
      const beforeId = slots[slotIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:downgrade', { planetId, slotIndex, layer });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const newSlots = layer === 'atmosphere' ? newPlanet.atmosphericSlots : newPlanet.orbitSlots;
      if (beforeLevel === 1) {
        return newSlots[slotIndex]?.buildingId == null && beforeId != null;
      }
      return (newSlots[slotIndex]?.buildingLevel ?? 0) < beforeLevel;
    },

    demolishBuildingOnSlot: (planetId, layer, slotIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const slots = layer === 'atmosphere' ? planet.atmosphericSlots : planet.orbitSlots;
      if (slotIndex < 0 || slotIndex >= slots.length) return false;
      const beforeId = slots[slotIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:demolish', { planetId, slotIndex, layer });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const newSlots = layer === 'atmosphere' ? newPlanet.atmosphericSlots : newPlanet.orbitSlots;
      return newSlots[slotIndex]?.buildingId == null && beforeId != null;
    },

    buildOnAtmosphereSlot: (planetId, slotIndex, buildingId) => {
      // Block 01 P3 — emit economy:build with layer='atmosphere' + slotIndex.
      // EconomyModule.onBuild dispatches to engine.buildOnAtmosphereSlot.
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      if (slotIndex < 0 || slotIndex >= planet.atmosphericSlots.length) return false;
      const before = planet.atmosphericSlots[slotIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:build', {
        planetId,
        buildingId,
        slotIndex,
        layer: 'atmosphere',
      });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.atmosphericSlots[slotIndex]?.buildingId ?? null;
      return after === buildingId && before !== buildingId;
    },

    buildOnOrbitSlot: (planetId, slotIndex, buildingId) => {
      // Block 01 P3 — emit economy:build with layer='orbit' + slotIndex.
      // EconomyModule.onBuild dispatches to engine.buildOnOrbitSlot.
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      if (slotIndex < 0 || slotIndex >= planet.orbitSlots.length) return false;
      const before = planet.orbitSlots[slotIndex]?.buildingId ?? null;
      mediator.getBus().emit('economy:build', {
        planetId,
        buildingId,
        slotIndex,
        layer: 'orbit',
      });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.orbitSlots[slotIndex]?.buildingId ?? null;
      return after === buildingId && before !== buildingId;
    },

    enqueueProduction: (planetId, recipeId, repeat = false) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = gameState.productionQueues.get(planetId)?.items.length ?? 0;
      mediator.getBus().emit('economy:enqueue', { planetId, recipeId, repeat });
      // Re-fetch — produce() in EconomyModule created a new state reference.
      const newState = get().gameState;
      if (!newState) return false;
      const after = newState.productionQueues.get(planetId)?.items.length ?? 0;
      return after > before;
    },

    cancelProduction: (planetId, queueItemId) => {
      // Block 01 P4 — cancel a queued production item by ID.
      // Pattern: directly mutate the queue via immer draft (same as
      // setReserveMinimum / setColonyRole — no need to round-trip
      // through the mediator for a simple deletion).
      // Audit Pass 1 P0-1: call syncMediatorState() afterwards to propagate
      // the new state reference back to the mediator (otherwise the next
      // tick would silently re-add the cancelled item from the stale ref).
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet) return;
        const queue = state.gameState.productionQueues.get(planetId);
        if (!queue) return;
        const idx = queue.items.findIndex((it) => it.id === queueItemId);
        if (idx === -1) return;
        queue.items.splice(idx, 1);
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    // ─── Block 05 PR7 — специализация переработчиков ─────────────────
    // Pattern: emit event → EconomyModule.onSpecialize wraps engine
    // .specializeBuilding in immer.produce() and commits new state via
    // mediator.commitState() → core:state-changed → store subscription
    // syncs the new reference.
    specializeBuildingOnHex: (planetId, hexIndex, category) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.processorType;
      const beforeSpec = planet.hexes[hexIndex]?.specialization;
      mediator.getBus().emit('economy:specialize', { planetId, hexIndex, category });
      // Re-fetch — engine.specializeBuilding mutates hex; immer produces a
      // new state reference with the changed hex path.
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.processorType;
      const afterSpec = newPlanet.hexes[hexIndex]?.specialization;
      // Success criterion: either processorType changed OR (category === 'universal'
      // AND specialization was non-empty before, now undefined).
      if (category === 'universal') {
        return before === 'specialized' && after === 'universal' && beforeSpec !== undefined && afterSpec === undefined;
      }
      return after === 'specialized' && afterSpec === category;
    },

    upgradeSpecializationOnHex: (planetId, hexIndex) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;
      const before = planet.hexes[hexIndex]?.specializationLevel ?? 0;
      if (before === 0) return false; // не specialized
      mediator.getBus().emit('economy:upgrade-specialization', { planetId, hexIndex });
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const after = newPlanet.hexes[hexIndex]?.specializationLevel ?? 0;
      return after > before;
    },

    colonizePlanet: (planetId) => {
      const mediator = getMediatorWithModules();
      const gameState = get().gameState;
      if (!gameState) return false;
      const planet = findPlanet(gameState, planetId);
      if (!planet) return false;

      // Emit event — EconomyModule.onColonize wraps engine.colonizePlanet in
      // immer.produce() and commits the new state via mediator.commitState().
      mediator.getBus().emit('economy:colonize', { planetId });

      // Re-fetch state — planet reference is stale after produce().
      const newState = get().gameState;
      if (!newState) return false;
      const newPlanet = findPlanet(newState, planetId);
      if (!newPlanet) return false;
      const success = newPlanet.owner === 'player';
      if (success) {
        // Block 01 P2: use immer produce() to create a new state with
        // phase='playing' + speed=1 — keeps immutability invariant.
        // mediator.setGameState emits core:state-changed which syncs the
        // Zustand-state via our subscription.
        const currentState = mediator.getGameState();
        if (currentState) {
          const finalState = produce(currentState, (draft) => {
            draft.phase = 'playing';
            draft.speed = 1;
          });
          mediator.setGameState(finalState);
        }
        set({
          selectedSystemId: newPlanet.systemId,
          selectedPlanetId: planetId,
          view: 'planet',
        });
      }
      return success;
    },

    // ─── Этап 3б.1 (R-44): AI-фракции ─────────────────────
    // Детерминированная расстановка AI-фракций по seed галактики (канонический
    // PRNG derive — аудит R-43 №6). Контракт среза: НЕ меняет поведение
    // существующих систем (только добавляет поле aiFactions в GameState),
    // без стартовых бонусов; дубликат-регистрация — явный отказ (false).
    // Коммит — через существующий mediator.commitState (Pattern A-проводка;
    // у AI-модуля mutator по-прежнему отсутствует — состояние пишет СТОР,
    // не AI).
    setupAIFactions: (options = {}) => {
      const gameState = get().gameState;
      if (!gameState) return false;
      // Дубликат-регистрация — явный отказ (контракт 3б.1).
      if (gameState.aiFactions && Object.keys(gameState.aiFactions).length > 0) return false;
      let roster: Record<EntityId, AIFactionState>;
      try {
        roster = createAIFactionRoster(gameState.galaxy.seed, {
          ...options,
          createdAtTick: gameState.time.tick,
        });
      } catch {
        // Невалидные опции (программная ошибка) — отказ без броска
        // (контракт store-действий: boolean).
        return false;
      }
      const check = validateAIFactionRegistry(roster);
      if (!check.ok) return false;
      const next = produce(gameState, (draft) => {
        draft.aiFactions = roster;
      });
      // commitState эмитит core:state-changed — стор синхронизируется
      // существующей подпиской (порядок R-39 не нарушается).
      getMediatorWithModules().commitState(next);
      return true;
    },

    // ─── Склад ────────────────────────────────────────────
    // Block 01 P2: all warehouse mutations use immer draft via set((state) => ...).
    // immer creates new references for changed paths (galaxy.systems array,
    // planet, planet.warehouse) — useMemo on galaxy.systems now triggers.

    setColonyRole: (planetId, role) => {
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;
        planet.warehouse = applyColonyRole(planet.warehouse, role);
      });
      syncMediatorState(); // Audit Pass 1 P0-1
    },

    setReserveMinimum: (planetId, resourceId, minimum) => {
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;
        if (planet.warehouse.reserves[resourceId]) {
          planet.warehouse.reserves[resourceId].minimum = minimum;
        } else {
          planet.warehouse.reserves[resourceId] = { resourceId, minimum, priority: 5 };
        }
      });
      syncMediatorState(); // Audit Pass 1 P0-1
    },

    setWarehouseSpecialization: (planetId, spec) => {
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;
        planet.warehouse.specialization = spec;
        planet.warehouse.capacities = calculateWarehouseCapacities(planet);
        planet.warehouse.totalCapacity = calculateWarehouseCapacity(planet);
      });
      syncMediatorState(); // Audit Pass 1 P0-1
    },

    moveToOrbit: (planetId, resourceId, amount) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;

        const available = planet.resources[resourceId] ?? 0;
        const moveAmount = Math.min(amount, available);
        if (moveAmount <= 0) return;

        const orbitUsed = getOrbitBufferUsed(planet);
        const orbitCapacity = planet.warehouse.orbitBuffer.capacity;
        if (orbitUsed + moveAmount > orbitCapacity) return;

        planet.resources[resourceId] -= moveAmount;
        planet.warehouse.orbitBuffer.resources[resourceId] = (planet.warehouse.orbitBuffer.resources[resourceId] ?? 0) + moveAmount;
        ok = true;
      });
      syncMediatorState(); // Audit Pass 1 P0-1
      return ok;
    },

    moveFromOrbit: (planetId, resourceId, amount) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet || !planet.warehouse) return;

        const orbitAmount = planet.warehouse.orbitBuffer.resources[resourceId] ?? 0;
        const moveAmount = Math.min(amount, orbitAmount);
        if (moveAmount <= 0) return;

        const canStoreAmount = canStoreResource(planet, resourceId, moveAmount);
        if (canStoreAmount <= 0) return;

        const actualMove = Math.min(moveAmount, canStoreAmount);
        planet.warehouse.orbitBuffer.resources[resourceId] -= actualMove;
        planet.resources[resourceId] = (planet.resources[resourceId] ?? 0) + actualMove;
        ok = true;
      });
      syncMediatorState(); // Audit Pass 1 P0-1
      return ok;
    },

    // ─── Сохранение / Загрузка ─────────────────────────────

    saveGame: async (name?: string) => {
      const gameState = get().gameState;
      const currentSaveId = get().currentSaveId;
      if (!gameState) return false;

      const savedSpeed = gameState.speed;

      // ─── R-39 (race fix): стопорим САМ GameLoop на время сохранения ──
      // Прежде блок мутировал phase='paused' + syncMediatorState() и
      // КОММЕНТАРИЙ утверждал, что «loop.pause() takes effect» — но
      // loop.pause() никто не вызывал: интервал продолжал тикать всё
      // время сетевого запроса (секунды на x50), а EconomyModule.tick не
      // имел phase-guard — экономика обрабатывалась «в паузе», и сериализованное
      // состояние убегало вперёд от того, что видел игрок в момент клика Save.
      // Теперь: (1) loop.pause() — интервал реально остановлен; (2) phase
      // мутируем как прежде (семантика «playing-сейв загружается на паузе»
      // сохранена); (3) ФАЗА colonization НЕ мутируется — в ней интервал
      // и так не запущен, а сериализация честного phase='colonization'
      // восстанавливает баннер колонизации после загрузки (прежде такие
      // сейвы портились в 'paused' — баннер терялся навсегда).
      const mediator = getMediatorWithModules();
      const wasPlaying = gameState.phase === 'playing';
      if (gameState.phase === 'playing') {
        set((state) => {
          if (!state.gameState) return;
          state.gameState.phase = 'paused';
          state.gameState.speed = 0;
        });
        // Audit Pass 1 P0-1: sync mediator so the paused phase is visible to
        // the loop/mediator on the current state ref.
        syncMediatorState();
        // R-39: + остановить сам интервал — без этого тики продолжали
        // обрабатывать экономику во время сетевого запроса (race).
        mediator.loop.pause();
      }

      set({ isSaving: true, saveError: null });

      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      try {
        const currentGameState = get().gameState!;
        const saveName = name || `Galaxy #${currentGameState.galaxy.seed}`;
        const stateJson = serializeGameState(currentGameState);

        // ─── R-26 (2026-08-31): сжатый транспорт сохранений ────────────
        // Сериализованное состояние 200-системной галактики ~31 МБ — шлюз
        // ограничивает тело запроса 32 МБ (EntityTooLarge; жалоба владельца).
        // Сжимаем gzip+base64 (≈ 5-7 МБ для 200 систем). Фолбэк: plain JSON
        // (малые сейвы / нет CompressionStream) — сервер принимает оба.
        let stateBody = stateJson;
        let stateEncoding: 'gzip-base64' | undefined;
        if (stateJson.length > 512 * 1024 && isBrowserCodecAvailable()) {
          try {
            stateBody = await gzipBase64(stateJson);
            stateEncoding = 'gzip-base64';
          } catch {
            // Фолбэк: не сжалось — отправляем как есть
            stateBody = stateJson;
            stateEncoding = undefined;
          }
        }

        const fetchWithTimeout = async (url: string, options: RequestInit) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            return res;
          } finally {
            clearTimeout(timeoutId);
          }
        };

        if (currentSaveId) {
          const res = await fetchWithTimeout(`/api/save/${currentSaveId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: saveName, state: stateBody, stateEncoding, tick: currentGameState.time.tick }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to update save (${res.status}): ${errText}`);
          }
        } else {
          const res = await fetchWithTimeout('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: saveName,
              seed: currentGameState.galaxy.seed,
              state: stateBody,
              stateEncoding,
              tick: currentGameState.time.tick,
            }),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => 'Unknown error');
            throw new Error(`Failed to create save (${res.status}): ${errText}`);
          }
          const data = await res.json();
          set({ currentSaveId: data.id });
        }
        set({ saveError: null });
        return true;
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error('Save failed:', e);
        set({ saveError: errorMsg });
        return false;
      } finally {
        // Block 01 P2: restore phase via immer draft mutation.
        if (wasPlaying) {
          set((state) => {
            if (!state.gameState) return;
            state.gameState.phase = 'playing';
            state.gameState.speed = savedSpeed || 1;
          });
          // Audit Pass 1 P0-1: sync mediator so the GameLoop sees the
          // restored phase/speed and resumes ticking on the new state ref.
          syncMediatorState();
          // R-39: перезапустить интервал (он был остановлен выше). Фаза
          // colonization не трогается — её интервал и не запускался.
          mediator.loop.setSpeed(savedSpeed || 1);
          mediator.loop.start();
        }
        set({ isSaving: false });
      }
    },

    loadGame: async (id: string) => {
      set({ isLoading: true, loadWarnings: [] });
      // R-39: защита активной игры. deserializeGameState сам не мутирует
      // глобальное состояние ДО zod-валидации (отклонённый сейв бросает ДО
      // setCurrentLookups), но УСПЕШНАЯ десериализация переключает lookups
      // на модель загружаемой галактики. Если что-то падает ПОСЛЕ этого
      // (счётчики/setLoadedState) — lookups восстанавливаем на модель
      // АКТИВНОЙ игры, чтобы частичная порча не затрагивала текущую сессию.
      // Реф lookups фиксируем ДО десериализации: восстановление только если
      // они РЕАЛЬНО переключились (чистый отказ не перестраивает объект).
      let prevModel: BakedGalaxyModel | null = null;
      let lookupsAtStart: ReturnType<typeof getCurrentLookups> | null = null;
      try {
        const activeState = get().gameState;
        if (activeState?.galaxy.bakedModel) {
          prevModel = activeState.galaxy.bakedModel;
        }
        try {
          lookupsAtStart = getCurrentLookups();
        } catch {
          // lookups ещё не установлены (холодный старт) — нечего защищать.
        }
        const res = await fetch(`/api/save/${id}`);
        if (!res.ok) throw new Error('Failed to load save');
        const data = await res.json();

        // R-26: большие сейвы приходят сжатыми (stateEncoding='gzip-base64')
        const stateJson = data.stateEncoding === 'gzip-base64'
          ? await gunzipBase64(data.state)
          : data.state as string;

        const loadedState = deserializeGameState(stateJson);

        // R-39: забрать предупреждения миграций ДО любых следующих шагов
        // (канал одноразовый) — попадут в store.loadWarnings для UI-тоста.
        const warnings = consumeDeserializeWarnings();

        // R-31 (audit): восстановить счётчик ProductionItem IDs из загруженных
        // очередей (max суффикс + 1). Раньше счётчик сбрасывался в 0 — новые
        // ID коллидировали с существующими элементами из сейва (cancelProduction
        // удаляет по первому совпадению — отменялась не та задача).
        restoreProductionItemCounter(loadedState.productionQueues);
        // Block 02 (F5): reset ship ID counter — newly built ships get fresh IDs.
        resetShipCounter();

        // Audit Pass 1 P1-2: sync mediator with the loaded state. Without this
        // call, `mediator.gameState` stays on the OLD (or null) reference and
        // subsequent `mediator.tick()` calls either return early (phase check)
        // or process the OLD state — silently overwriting the loaded state on
        // the very next tick. `setLoadedState` updates `mediator.gameState`,
        // resets the GameLoop time, and emits `core:state-changed` (which our
        // store subscription then forwards back to Zustand).
        // R-39: setLoadedState также приводит GameLoop в соответствие фазе
        // загруженного сейва (playing → модули+интервал запущены; пауза/
        // колонизация → интервал предыдущей игры остановлен) — прежде модули
        // оставались остановленными после stopAll при загрузке в активной
        // сессии (заморозка симуляции).
        const mediator = getMediatorWithModules();
        mediator.setLoadedState(loadedState);

        set({
          gameState: loadedState,
          view: 'galaxy',
          selectedSystemId: loadedState.galaxy.systems[0]?.id ?? null,
          selectedPlanetId: null,
          selectedFleetId: null,
          isInitialized: true,
          currentSaveId: id,
          loadWarnings: warnings,
        });
        return true;
      } catch (e) {
        console.error('Load failed:', e);
        // R-39: откат lookups на модель активной игры — ТОЛЬКО если
        // десериализация успела их переключить (успешный deserialize с
        // последующим падением счётчиков/setLoadedState). Чистый отказ
        // (мусор/fmt≠3/zod) бросает ДО setCurrentLookups — lookups не
        // трогаем, ссылка сохранена.
        if (prevModel) {
          let lookupsNow: ReturnType<typeof getCurrentLookups> | null = null;
          try {
            lookupsNow = getCurrentLookups();
          } catch {
            // lookups сброшены — восстановим модель активной игры ниже.
          }
          if (lookupsNow !== lookupsAtStart) {
            setCurrentLookups(prevModel);
          }
        }
        return false;
      } finally {
        set({ isLoading: false });
      }
    },

    loadSaveList: async () => {
      try {
        const res = await fetch('/api/save');
        if (!res.ok) throw new Error('Failed to list saves');
        return await res.json() as SaveInfo[];
      } catch (e) {
        console.error('List saves failed:', e);
        return [];
      }
    },

    deleteSave: async (id) => {
      try {
        const res = await fetch(`/api/save/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete save');
        return true;
      } catch (e) {
        console.error('Delete save failed:', e);
        return false;
      }
    },

    // ─── Утилиты ───────────────────────────────────────────

    getSystem: (id) => {
      const { gameState } = get();
      return gameState?.galaxy.systemMap.get(id);
    },

    getPlanet: (id) => {
      const { gameState } = get();
      if (!gameState) return undefined;
      for (const system of gameState.galaxy.systems) {
        const planet = system.planets.find(p => p.id === id);
        if (planet) return planet;
      }
      return undefined;
    },

    getSelectedSystem: () => {
      const { gameState, selectedSystemId } = get();
      if (!gameState || !selectedSystemId) return undefined;
      return gameState.galaxy.systemMap.get(selectedSystemId);
    },

    getSelectedPlanet: () => {
      const { gameState, selectedPlanetId } = get();
      if (!gameState || !selectedPlanetId) return undefined;
      for (const system of gameState.galaxy.systems) {
        const planet = system.planets.find(p => p.id === selectedPlanetId);
        if (planet) return planet;
      }
      return undefined;
    },

    // ─── Block 02 (F2): Конструктор кораблей ─────────────────────
    // Direct immer mutation (no mediator round-trip needed — simple Map addition).
    // Audit Pass 1 P0-1: but syncMediatorState() is still required so the
    // next tick (e.g. shipyard processing) sees the new design Map.
    saveShipDesign: (design) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        // Block 02: deterministic ID (counter, no Math.random) per Block 07 gap-3.
        const id = design.id ?? `design_${state.gameState.time.tick}_${shipDesignCounter++}`;
        newId = id;
        const designRecord: import('@/core/types').ShipDesign = {
          id,
          name: design.name,
          hullId: design.hullId,
          armor: design.armor,
          moduleIds: design.moduleIds.slice(),
          owner: design.owner,
          createdAtTick: state.gameState.time.tick,
        };
        state.gameState.shipDesigns.set(id, designRecord);
      });
      syncMediatorState();
      return newId;
    },

    deleteShipDesign: (id) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        ok = state.gameState.shipDesigns.delete(id);
      });
      syncMediatorState();
      return ok;
    },

    getShipDesign: (id) => {
      const { gameState } = get();
      return gameState?.shipDesigns.get(id);
    },

    listShipDesigns: () => {
      const { gameState } = get();
      if (!gameState) return [];
      return Array.from(gameState.shipDesigns.values());
    },

    // ─── Block 02 (F6): Верфь — постройка кораблей ──────────────
    // Audit Pass 1 P0-1: direct immer mutation + syncMediatorState() so
    // ShipsModule.tick sees the new shipyard queue item on the next tick.
    enqueueShipBuild: (planetId, designId, shipName) => {
      let itemId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        const design = state.gameState.shipDesigns.get(designId);
        if (!design) return;
        const planet = findPlanet(state.gameState, planetId);
        if (!planet) return;
        const existingQueue = state.gameState.shipyardQueues.get(planetId);
        itemId = `ship_${state.gameState.time.tick}_${shipyardItemCounter++}`;
        const newQueue = enqueueShipBuildFn(planet, existingQueue, design, shipName ?? `${design.name}-${shipyardItemCounter}`, itemId);
        state.gameState.shipyardQueues.set(planetId, newQueue);
      });
      syncMediatorState();
      return itemId;
    },

    cancelShipyardItem: (planetId, itemId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const queue = state.gameState.shipyardQueues.get(planetId);
        if (!queue) return;
        const newQueue = cancelShipyardItemFn(queue, itemId);
        ok = newQueue.items.length < queue.items.length;
        state.gameState.shipyardQueues.set(planetId, newQueue);
      });
      syncMediatorState();
      return ok;
    },

    getShipyardQueue: (planetId) => {
      const { gameState } = get();
      return gameState?.shipyardQueues.get(planetId);
    },

    // ─── Block 02 (F3): Флот-менеджер ────────────────────────
    // Pattern: direct immer mutation. Engine functions (createFleet / mergeFleets /
    // splitFleet from src/ships/fleet-engine.ts) are pure — they return Fleet objects
    // without ids; store assigns deterministic ids (counter, no Math.random).
    // Audit Pass 1 P0-1: syncMediatorState() after each so FleetModule.tick sees
    // the new fleet / merge / split on the next tick.
    createFleet: (name, shipIds, atSystemId) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        if (shipIds.length === 0) return;
        // Validate: all ship IDs must exist in state.ships
        for (const id of shipIds) {
          if (!state.gameState.ships.has(id)) return;
        }
        const owner = state.gameState.playerFactionId;
        const draft = createFleetFn(shipIds, atSystemId, owner, name);
        newId = `fleet_${state.gameState.time.tick}_${fleetCounter++}`;
        const newFleet: import('@/core/types').Fleet = { ...draft, id: newId };
        state.gameState.fleets.push(newFleet);
      });
      syncMediatorState();
      return newId;
    },

    mergeFleets: (fleetIds) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        if (fleetIds.length < 2) return; // merge of 1 = no-op
        // Resolve fleets by id
        const fleetsToMerge: import('@/core/types').Fleet[] = [];
        for (const id of fleetIds) {
          const f = getFleetByIdFn(state.gameState.fleets, id);
          if (!f) return; // invalid id — abort
          fleetsToMerge.push(f);
        }
        // All fleets must be in same location
        const loc = fleetsToMerge[0]!.location;
        for (const f of fleetsToMerge) {
          if (f.location !== loc) return;
        }
        const draft = mergeFleetsFn(fleetsToMerge);
        newId = `fleet_${state.gameState.time.tick}_${fleetCounter++}`;
        const newFleet: import('@/core/types').Fleet = { ...draft, id: newId };
        // Remove old fleets, add new one
        const idSet = new Set(fleetIds);
        state.gameState.fleets = state.gameState.fleets.filter(f => !idSet.has(f.id));
        state.gameState.fleets.push(newFleet);
      });
      syncMediatorState();
      return newId;
    },

    splitFleet: (sourceFleetId, shipIdsToExtract, newName) => {
      let newId: string | null = null;
      set((state) => {
        if (!state.gameState) return;
        if (shipIdsToExtract.length === 0) return;
        const source = getFleetByIdFn(state.gameState.fleets, sourceFleetId);
        if (!source) return;
        // Validate: shipIdsToExtract must all be in the source fleet
        for (const id of shipIdsToExtract) {
          if (!source.shipIds.includes(id)) return;
        }
        // Validate: don't allow extracting all ships (would leave empty fleet)
        if (shipIdsToExtract.length >= source.shipIds.length) return;
        const { remaining, extracted } = splitFleetFn(source, shipIdsToExtract);
        newId = `fleet_${state.gameState.time.tick}_${fleetCounter++}`;
        const newFleet: import('@/core/types').Fleet = {
          ...extracted,
          id: newId,
          name: newName ?? extracted.name,
        };
        // Replace source with remaining (keep id), add extracted
        const idx = state.gameState.fleets.findIndex(f => f.id === sourceFleetId);
        if (idx === -1) return;
        state.gameState.fleets[idx] = remaining;
        state.gameState.fleets.push(newFleet);
      });
      syncMediatorState();
      return newId;
    },

    renameFleet: (fleetId, newName) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const f = getFleetByIdFn(state.gameState.fleets, fleetId);
        if (!f) return;
        f.name = newName;
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    getFleet: (fleetId) => {
      const { gameState } = get();
      if (!gameState) return undefined;
      return getFleetByIdFn(gameState.fleets, fleetId);
    },

    getFleetsAtSystem: (systemId) => {
      const { gameState } = get();
      if (!gameState) return [];
      return getFleetsAtFn(gameState.fleets, systemId);
    },

    getShip: (shipId) => {
      const { gameState } = get();
      return gameState?.ships.get(shipId);
    },

    getLooseShips: (ownerId, location) => {
      const { gameState } = get();
      if (!gameState) return [];
      return getLooseShipsFn(gameState.ships, gameState.fleets, ownerId, location);
    },

    // ─── Block 02 (F4): Приказы флотов ────────────────────
    // Pattern: pure engine function executeOrder returns { updatedFleet, ok } —
    // store applies via immer draft. Failure (no route / no jump drive) returns false;
    // UI shows toast error per failure reason.
    // Audit Pass 1 P0-1: syncMediatorState() afterwards so FleetModule.tick sees
    // the new order and starts processing the route on the next tick.
    issueFleetOrder: (fleetId, type, targetId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const fleet = getFleetByIdFn(state.gameState.fleets, fleetId);
        if (!fleet) return;
        const result = executeOrderFn(
          fleet,
          type,
          targetId,
          state.gameState.galaxy,
          state.gameState.ships,
          state.gameState.shipDesigns,
          state.gameState.time.tick,
        );
        if (!result.ok || !result.order) return;
        // Replace fleet in array
        const idx = state.gameState.fleets.findIndex(f => f.id === fleetId);
        if (idx === -1) return;
        state.gameState.fleets[idx] = result.updatedFleet;
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    cancelFleetOrder: (fleetId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const fleet = getFleetByIdFn(state.gameState.fleets, fleetId);
        if (!fleet) return;
        if (fleet.orders.length === 0) return;
        fleet.orders = fleet.orders.slice(1);
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    // Block 02 (F7): выбрать флот — синхронно устанавливает selectedFleetId.
    // Используется galaxy-map context menu для определения, какому флоту
    // отдать приказ перемещения при right-click на систему.
    selectFleet: (fleetId) => {
      set({ selectedFleetId: fleetId });
    },

    // ─── Block 03 (R6/R7): Исследования ─────────────────────────────
    // Pattern: direct immer mutation (как cancelProduction в Phase 2.4 —
    // простые mutations на game-state не требуют mediator round-trip).
    // Tick processing (RP accumulation) — в Phase 3.7 ResearchModule через
    // mediator + immer.produce (как EconomyModule).
    // Audit Pass 1 P0-1: syncMediatorState() afterwards so ResearchModule.tick
    // sees the new active slot / allocation / fundamental level.
    startResearch: (techId, targetLevel) => {
      let slotId: string | null = null;
      let queued = false;
      set((state) => {
        if (!state.gameState) return;
        const gs = state.gameState;
        const rs = gs.researchState;
        // R-RES-QUEUE-01 (docs/60 v1.2 §3.4): FIFO-очередь. Немедленный старт
        // возможен только при пустых activeSlots и researchQueue; иначе проект
        // добавляется в хвост без скрытого приоритета.
        const tech = TECH_MAP_FN.get(techId);
        if (!tech) return;
        const currentLevel = rs.researched[techId] ?? 0;
        const alreadyInQueue = rs.researchQueue.includes(techId);
        const hasActiveSlot = rs.activeSlots.some((s) => s.techId === techId);
        if (currentLevel >= tech.maxLevel || alreadyInQueue || hasActiveSlot) return;

        if (rs.activeSlots.length === 0 && rs.researchQueue.length === 0) {
          // Немедленный старт только при полностью пустой очереди.
          const planets = gs.galaxy.systems
            .flatMap((s) => s.planets)
            .filter((p) => p.owner === gs.playerFactionId);
          const labCount = planets.reduce((acc, p) => {
            let n = 0;
            for (const h of p.hexes) if (h.buildingId === 'laboratory') n++;
            for (const s of p.atmosphericSlots) if (s.buildingId === 'laboratory') n++;
            for (const s of p.orbitSlots) if (s.buildingId === 'laboratory') n++;
            return acc + n;
          }, 0);
          const check = canStartResearchFn(tech, targetLevel, rs, labCount);
          if (!check.ok) return;
          slotId = `slot_${gs.time.tick}_${researchSlotCounter++}`;
          const newSlot = createResearchSlotFn(slotId, techId, targetLevel, 100);
          newSlot.allocationPercent = 100;
          const suspendedProgress = rs.researchProgressByTech[techId];
          if (suspendedProgress !== undefined) {
            newSlot.rpInvested = Math.max(0, suspendedProgress);
            delete rs.researchProgressByTech[techId];
          }
          rs.activeSlots.push(newSlot);
        } else {
          const prereq = arePrerequisitesMetFn(tech, rs.researched);
          if (!prereq.met) return;
          rs.researchQueue.push(techId);
          queued = true;
        }
      });
      syncMediatorState();
      // Возвращаем 'queued', если проект добавлен в хвост очереди.
      if (queued) return 'queued';
      return slotId;
    },

    cancelResearch: (slotId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        const idx = rs.activeSlots.findIndex((s) => s.slotId === slotId);
        if (idx === -1) return;
        // R-RES-QUEUE-01 (docs/60 v1.2 §3.4): снятие проекта сохраняет
        // вложенные RP текущего уровня для последующего возобновления.
        const [cancelled] = rs.activeSlots.splice(idx, 1);
        if (cancelled && cancelled.rpInvested > 0) {
          rs.researchProgressByTech[cancelled.techId] = cancelled.rpInvested;
        }
        if (rs.activeSlots.length === 0) {
          advanceQueueFn(rs);
        }
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    setAllocation: (slotId, percent) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        const slot = rs.activeSlots.find((s) => s.slotId === slotId);
        if (!slot) return;
        // Clamp to [5, 100]
        slot.allocationPercent = Math.max(5, Math.min(100, percent));
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    levelUpFundamental: (branchId) => {
      let ok = false;
      let newLevel = 0;
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        // R-SPLIT (Задача 22): тратим ТОЛЬКО из аккумулятора (rpBank).
        // Дерево технологий больше не занимает/возвращает RP банка —
        // ветки полностью разделены (engine.levelUpFundamentalEngine:
        // миграция rpBank для старых сейвов выполняется внутри).
        ok = levelUpFundamentalEngineFn(rs, branchId);
        if (ok) {
          newLevel = rs.fundamentalLevels[branchId] ?? 0;
        }
      });
      syncMediatorState();
      // R-39 (P0-1): событие tech:fundamental-leveled ЗАЯВЛЕНО в манифесте
      // ResearchModule ('emits') и в карте событий (events.ts), но прежде
      // не эмитилось НИКТОМ (комментарий в research-module.ts ссылался на
      // этот экшен — событие отсутствовало). Публикуем пост-мутации на
      // шине медиатора (= единая gameBus): подписчики (UI/будущие модули)
      // видят повышение ветки.
      if (ok) {
        getMediatorWithModules().getBus().emit('tech:fundamental-leveled', {
          branchId,
          factionId: get().gameState?.playerFactionId ?? 'player',
          newLevel,
        });
      }
      return ok;
    },

    autoAllocateSlots: () => {
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        if (rs.activeSlots.length === 0) return;
        if (rs.activeSlots.length === 1) {
          rs.activeSlots[0]!.allocationPercent = 100;
          return;
        }
        const equal = Math.max(5, Math.floor(100 / rs.activeSlots.length));
        for (const s of rs.activeSlots) s.allocationPercent = equal;
        // Give the remainder to the last slot
        const sumSoFar = equal * rs.activeSlots.length;
        rs.activeSlots[rs.activeSlots.length - 1]!.allocationPercent += 100 - sumSoFar;
      });
      syncMediatorState();
    },

    // ─── R-RES §B: queue actions ────────────────────────────
    addToResearchQueue: (techId) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        const tech = TECH_MAP_FN.get(techId);
        if (!tech) return;
        // Don't add if already fully researched
        const currentLevel = rs.researched[techId] ?? 0;
        if (currentLevel >= tech.maxLevel) return;
        // Don't add if already in queue
        if (rs.researchQueue.includes(techId)) return;
        // Don't add if already has an active slot for this techId
        if (rs.activeSlots.some((s) => s.techId === techId)) return;
        // Prerequisites check — silently skip if not met (UI shows why).
        const prereq = arePrerequisitesMetFn(tech, rs.researched);
        if (!prereq.met) return;
        // If no active slots and queue is empty → start immediately
        if (rs.activeSlots.length === 0 && rs.researchQueue.length === 0) {
          const slotId = `slot_${state.gameState.time.tick}_${researchSlotCounter++}`;
          const newSlot = createResearchSlotFn(slotId, techId, currentLevel + 1, 100);
          const suspendedProgress = rs.researchProgressByTech[techId];
          if (suspendedProgress !== undefined) {
            newSlot.rpInvested = Math.max(0, suspendedProgress);
            delete rs.researchProgressByTech[techId];
          }
          rs.activeSlots.push(newSlot);
        } else {
          rs.researchQueue.push(techId);
        }
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    removeFromResearchQueue: (index) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        if (index < 0 || index >= rs.researchQueue.length) return;
        rs.researchQueue.splice(index, 1);
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    reorderResearchQueue: (from, to) => {
      let ok = false;
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        const q = rs.researchQueue;
        if (from < 0 || from >= q.length) return;
        if (to < 0 || to >= q.length) return;
        if (from === to) {
          ok = true;
          return;
        }
        const [moved] = q.splice(from, 1);
        if (moved === undefined) return;
        q.splice(to, 0, moved);
        ok = true;
      });
      syncMediatorState();
      return ok;
    },

    clearResearchQueue: () => {
      set((state) => {
        if (!state.gameState) return;
        const rs = state.gameState.researchState;
        rs.researchQueue = [];
      });
      syncMediatorState();
    },

    getResearchState: () => {
      const { gameState } = get();
      return gameState?.researchState ?? null;
    },
  };
}));

// Audit Pass 2 P3-3: previously had a local `findPlanet` helper here
// (lines 1491-1497 in pre-audit version), duplicating the same O(S×P)
// loop as in economy-module.ts and ships-module.ts. Removed — all call
// sites above now use the shared helper imported from `@/core/find-planet`.
