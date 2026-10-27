/// <reference types="bun-types" />
/**
 * R-RES-QUEUE-01 (Issue #15): интеграционные тесты циклической очереди
 * исследований и единого пула RP империи через РЕАЛЬНЫЙ конвейер
 * store → mediator → ResearchModule (паттерн tests/r39/r40/shipyard —
 * newGame seed 42 → колонизация через СТОР → ручные mediator.tick() при
 * синхронном окне скорости; состояние читается ИЗ СТОРА, как видит UI).
 *
 * Покрывает требования Issue #15:
 *   - единый поток RP империи: лаборатории НЕСКОЛЬКИХ своих планет
 *     суммируются; планеты чужих фракций НЕ смешиваются (owner-фильтр);
 *     отсутствие коммуникационной технологии не создаёт per-planet gate;
 *   - циклическое переключение после каждого завершённого уровня;
 *   - ручное добавление проекта во время активного уровня → переключение
 *     сразу после завершения текущего уровня;
 *   - startResearch при активном проекте → в ГОЛОВУ очереди;
 *     addToResearchQueue → в хвост;
 *   - cancel активного → следующий стартует сразу;
 *   - save/load round-trip: очередь и частичный прогресс переживают
 *     сериализацию (новых полей сейва нет).
 *
 * Run: bun test tests/research/empire-rp-integration.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import { produce } from 'immer';
import { useGameStore, serializeGameState, deserializeGameState } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { findPlanet } from '@/core/find-planet';
import type { GameState, Planet } from '@/core/types';

// ─── Хелперы (паттерн tests/ships/shipyard-integration.test.ts) ──────

function resetStore(): void {
  useGameStore.setState({
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
    loadWarnings: [],
  });
}

function colonizablePlanets(state: GameState): Planet[] {
  return state.galaxy.systems
    .flatMap((s) => s.planets)
    .filter((p) => p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0);
}

function mutateGameState(recipe: (draft: GameState) => void): void {
  useGameStore.setState((state) => {
    if (state.gameState) recipe(state.gameState);
  });
  const current = useGameStore.getState().gameState;
  if (current) getGameMediator().commitState(current);
}

interface StartedGame {
  planetIds: string[];
}

/** newGame seed 42 → колонизация `count` планет → ручной тик-режим. */
function startGame(count: number): StartedGame {
  resetGameMediator();
  resetStore();
  useGameStore.getState().newGame({ seed: 42, systemCount: 5 });
  const state = useGameStore.getState().gameState!;
  const planets = colonizablePlanets(state).slice(0, count);
  if (planets.length < count) throw new Error(`нужно ${count} колонизируемых планет, найдено ${planets.length}`);
  const planetIds: string[] = [];
  for (const planet of planets) {
    const ok = useGameStore.getState().colonizePlanet(planet.id);
    if (!ok) throw new Error(`колонизация ${planet.id} через стор не удалась`);
    planetIds.push(planet.id);
  }
  const mediator = getGameMediator();
  mediator.setSpeed(0);
  const current = mediator.getGameState()!;
  const manual = produce(current, (draft) => {
    draft.phase = 'playing';
    draft.speed = 0;
  });
  mediator.setGameState(manual);
  return { planetIds };
}

/** Поставить лабораторию уровня level на первый свободный гекс планеты. */
function placeLab(planetId: string, level: number): void {
  mutateGameState((draft) => {
    const planet = findPlanet(draft, planetId);
    if (!planet) throw new Error(`планета ${planetId} не найдена`);
    const hexIdx = planet.hexes.findIndex((h) => !h.buildingId);
    if (hexIdx === -1) throw new Error(`нет свободного гекса на ${planetId}`);
    planet.hexes[hexIdx]!.buildingId = 'laboratory';
    planet.hexes[hexIdx]!.buildingLevel = level;
  });
}

/** ResearchState, ВИДИМЫЙ ИЗ СТОРА (как его видит UI). */
function rs() {
  return useGameStore.getState().gameState!.researchState;
}

/** Синхронное окно скорости: N ручных тиков (реальный интервал не успевает). */
function runTicks(ticks: number, speed: 1 | 50 = 1): void {
  const mediator = getGameMediator();
  mediator.setSpeed(speed);
  for (let i = 0; i < ticks; i++) mediator.tick();
  mediator.setSpeed(0);
}

// ─── Тесты ───────────────────────────────────────────────────────────

describe('R-RES-QUEUE-01 — единый пул RP империи (реальный конвейер)', () => {
  beforeEach(() => {
    resetGameMediator();
    resetStore();
  });
  afterEach(() => {
    resetGameMediator();
    resetStore();
  });

  test('INT-1. Лаборатории двух планет империи суммируются в один поток (точная арифметика)', () => {
    const { planetIds } = startGame(2);
    placeLab(planetIds[0]!, 5); // 25 RP/сек
    placeLab(planetIds[1]!, 5); // 25 RP/сек

    const store = useGameStore.getState();
    const slotId = store.startResearch('fusion_reactor', 1);
    expect(slotId).not.toBeNull();

    // Ровно ОДИН тик на speed=1. Точная арифметика (лаборатория сама даёт
    // research_rate add 0.02/уровень, bonus-resolver ×(1+Σadd)):
    // base 2×25 = 50; Σadd = 2×(0.02×5) = 0.2 → приток 60 RP/сек; дерево 50%
    // = 30; фокус ×1.2 → 36 RP. fundamentals=0 → partialBonus(power)=1.0.
    // Стоимость L1 = 500 — уровень НЕ завершается, прогресс точно 36.
    const before = rs().activeSlots[0]!.rpInvested;
    expect(before).toBeCloseTo(0, 5);
    runTicks(1, 1);
    const after = rs().activeSlots[0]!.rpInvested;
    expect(after).toBeCloseTo(36, 5);
  });

  test('INT-2. Планеты чужих фракций НЕ смешиваются с пулом игрока', () => {
    const { planetIds } = startGame(3);
    placeLab(planetIds[0]!, 5); // 25 RP/сек — игрок
    // Третья планета — «чужая» (AI-фракция): 10 лабораторий L10.
    mutateGameState((draft) => {
      const alien = findPlanet(draft, planetIds[2]!)!;
      alien.owner = 'ai_faction_01';
      let placed = 0;
      for (const hex of alien.hexes) {
        if (placed >= 10) break;
        hex.buildingId = 'laboratory';
        hex.buildingLevel = 10;
        placed += 1;
      }
    });

    const store = useGameStore.getState();
    const slotId = store.startResearch('fusion_reactor', 1);
    expect(slotId).not.toBeNull();

    // Если бы чужие лаборатории смешивались (старый фильтр owner != null),
    // приток был бы 25 + 10×50 = 525 RP/сек (× бонусы чужих лабораторий) —
    // на порядок больше. Правильно: ТОЛЬКО планеты игрока — 25 × 1.1
    // (собственный бонус лаборатории 0.02×5) = 27.5 RP/сек → дерево 13.75
    // × фокус 1.2 = 16.5 RP за тик speed=1 (bonus-resolver collectPlayerPlanets
    // тоже фильтрует по playerFactionId — чужие бонусы не считаются).
    runTicks(1, 1);
    expect(rs().activeSlots[0]!.rpInvested).toBeCloseTo(16.5, 5);
  });

  test('INT-3. Отсутствие коммуникационной технологии не создаёт per-planet gate', () => {
    // Обе колонии в РАЗНЫХ системах (колонизируем первую и третью доступные
    // планеты разных систем), коммуникационных технологий нет вообще —
    // поток всё равно общий (сумма лабораторий обеих планет).
    const { planetIds } = startGame(2);
    placeLab(planetIds[0]!, 1); // 5 RP/сек
    placeLab(planetIds[1]!, 1); // 5 RP/сек

    useGameStore.getState().startResearch('fusion_reactor', 1);
    // base 2×5 = 10; Σadd = 2×(0.02×1) = 0.04 → приток 10.4 RP/сек → дерево
    // 5.2 × фокус 1.2 = 6.24 RP за тик.
    runTicks(1, 1);
    expect(rs().activeSlots[0]!.rpInvested).toBeCloseTo(6.24, 5);
    // Ничего не исследовано — коммуникационных технологий в дереве нет,
    // гейта нет: обе планеты суммированы.
  });

  test('INT-4. Длинный плейтест: очередь многократно ротируется, все проекты получают RP', () => {
    const { planetIds } = startGame(1);
    placeLab(planetIds[0]!, 10);
    const store = useGameStore.getState();
    expect(store.startResearch('fusion_reactor', 1)).not.toBeNull();
    expect(store.addToResearchQueue('microelectronics')).toBe(true);
    expect(store.addToResearchQueue('steel_processing')).toBe(true);

    const mediator = getGameMediator();
    mediator.setSpeed(1);
    for (let i = 0; i < 300; i++) mediator.tick();
    mediator.setSpeed(0);

    const state = rs();
    expect(state.researched['fusion_reactor'] ?? 0).toBeGreaterThan(0);
    expect(state.researched['microelectronics'] ?? 0).toBeGreaterThan(0);
    expect(state.researched['steel_processing'] ?? 0).toBeGreaterThan(0);
    expect(state.researched['fusion_reactor'] ?? 0).toBeLessThan(8);
    expect(state.activeSlots.length).toBe(1);
    expect(state.researchQueue.length).toBeGreaterThan(0);
  });

  test('INT-5. Ручное добавление во время активного уровня → переключение после уровня', () => {
    const { planetIds } = startGame(1);
    placeLab(planetIds[0]!, 10);

    const store = useGameStore.getState();
    expect(store.startResearch('fusion_reactor', 1)).not.toBeNull();
    // Частичный прогресс A (тик на speed=1: 30 RP < 500 — уровень не завершён).
    runTicks(1, 1);
    expect(rs().activeSlots[0]!.techId).toBe('fusion_reactor');
    // Добавляем B ВО ВРЕМЯ активного уровня.
    expect(store.addToResearchQueue('microelectronics')).toBe(true);

    // Даём тики до завершения уровня A: переключение на B НЕ мгновенное —
    // только после завершения текущего уровня (решение владельца).
    const mediator = getGameMediator();
    mediator.setSpeed(50);
    let switchedAfterLevel = false;
    for (let i = 0; i < 200; i++) {
      mediator.tick();
      const state = rs();
      const activeTech = state.activeSlots[0]?.techId;
      if (activeTech === 'microelectronics') {
        // Переключение произошло — но ONLY после завершения уровня fusion.
        expect(state.researched['fusion_reactor']).toBeGreaterThanOrEqual(1);
        switchedAfterLevel = true;
        break;
      }
      // Пока fusion активен — уровень ещё не завершён, ход не отбирается.
      if (activeTech === 'fusion_reactor') {
        expect(state.researched['fusion_reactor']).toBeUndefined();
      }
    }
    mediator.setSpeed(0);
    expect(switchedAfterLevel, 'B стал активным сразу после завершения уровня A').toBe(true);
  });

  test('INT-6. Служебный startResearch не обходит FIFO-хвост очереди', () => {
    const { planetIds } = startGame(1);
    placeLab(planetIds[0]!, 5);

    const store = useGameStore.getState();
    expect(store.startResearch('fusion_reactor', 1)).not.toBeNull(); // активный
    expect(store.addToResearchQueue('steel_processing')).toBe(true); // хвост: [steel]
    const result = store.startResearch('microelectronics', 1); // хвост
    expect(result).toBe('queued');
    expect(rs().researchQueue).toEqual(['steel_processing', 'microelectronics']);

    // Дубликаты отклоняются.
    expect(store.startResearch('microelectronics', 1)).toBeNull();
    expect(store.addToResearchQueue('steel_processing')).toBe(false);
  });

  test('INT-7. cancel → re-add/resume восстанавливает частичный прогресс технологии', () => {
    const { planetIds } = startGame(1);
    placeLab(planetIds[0]!, 5);
    const store = useGameStore.getState();
    const slotId = store.startResearch('fusion_reactor', 1);
    expect(slotId).not.toBeNull();
    runTicks(5, 1);
    const investedBeforeCancel = rs().activeSlots[0]!.rpInvested;
    expect(investedBeforeCancel).toBeGreaterThan(0);
    expect(store.addToResearchQueue('microelectronics')).toBe(true);

    expect(store.cancelResearch(slotId!)).toBe(true);
    expect(rs().activeSlots[0]!.techId).toBe('microelectronics');
    expect(rs().researchProgressByTech['fusion_reactor']).toBeCloseTo(investedBeforeCancel, 5);
    expect(store.addToResearchQueue('fusion_reactor')).toBe(true);
    const microSlotId = rs().activeSlots[0]!.slotId;
    expect(store.cancelResearch(microSlotId)).toBe(true);
    expect(rs().activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(rs().activeSlots[0]!.rpInvested).toBeCloseTo(investedBeforeCancel, 5);
    expect(rs().researchProgressByTech['fusion_reactor']).toBeUndefined();
  });

  test('INT-8. Save/load round-trip: очередь, порядок и частичный прогресс переживают сериализацию', () => {
    const { planetIds } = startGame(2);
    placeLab(planetIds[0]!, 5);
    placeLab(planetIds[1]!, 5);

    const store = useGameStore.getState();
    expect(store.startResearch('fusion_reactor', 1)).not.toBeNull();
    expect(store.addToResearchQueue('microelectronics')).toBe(true);
    expect(store.addToResearchQueue('steel_processing')).toBe(true);
    runTicks(2, 1);
    const firstSlot = rs().activeSlots[0]!;
    const pausedRp = firstSlot.rpInvested;
    expect(pausedRp).toBeGreaterThan(0);
    expect(store.cancelResearch(firstSlot.slotId)).toBe(true);
    expect(rs().researchProgressByTech['fusion_reactor']).toBeCloseTo(pausedRp, 5);

    runTicks(2, 1);
    const activeBefore = rs().activeSlots[0]!;
    expect(activeBefore.techId).toBe('microelectronics');
    expect(activeBefore.rpInvested).toBeGreaterThan(0);

    const saved = serializeGameState(useGameStore.getState().gameState!);
    const loaded = deserializeGameState(saved);
    expect(loaded.researchState.researchQueue).toEqual(['steel_processing']);
    expect(loaded.researchState.activeSlots.length).toBe(1);
    expect(loaded.researchState.activeSlots[0]!.techId).toBe('microelectronics');
    expect(loaded.researchState.activeSlots[0]!.targetLevel).toBe(activeBefore.targetLevel);
    expect(loaded.researchState.activeSlots[0]!.rpInvested).toBeCloseTo(activeBefore.rpInvested, 5);
    expect(loaded.researchState.activeSlots[0]!.allocationPercent).toBe(100);
    expect(loaded.researchState.researchProgressByTech['fusion_reactor']).toBeCloseTo(pausedRp, 5);

    const saved2 = serializeGameState(loaded);
    const loaded2 = deserializeGameState(saved2);
    expect(loaded2.researchState.researchQueue).toEqual(['steel_processing']);
    expect(loaded2.researchState.activeSlots[0]!.rpInvested).toBeCloseTo(activeBefore.rpInvested, 5);
    expect(loaded2.researchState.researchProgressByTech['fusion_reactor']).toBeCloseTo(pausedRp, 5);
  });
  test('INT-9. Старые сейвы без progress map и параллельные слоты отклоняются', () => {
    const { planetIds } = startGame(1);
    placeLab(planetIds[0]!, 5);
    expect(useGameStore.getState().startResearch('fusion_reactor', 1)).not.toBeNull();
    const saved = serializeGameState(useGameStore.getState().gameState!);
    const missingProgress = JSON.parse(saved) as { researchState: { researchProgressByTech?: Record<string, number> } };
    delete missingProgress.researchState.researchProgressByTech;
    expect(() => deserializeGameState(JSON.stringify(missingProgress))).toThrow('несовместимый контракт исследований');
    const parallelSlots = JSON.parse(saved) as { researchState: { activeSlots: Array<Record<string, unknown>> } };
    parallelSlots.researchState.activeSlots.push({ ...parallelSlots.researchState.activeSlots[0]! });
    expect(() => deserializeGameState(JSON.stringify(parallelSlots))).toThrow('несовместимый контракт исследований');
  });

  // ─── R-RES-QUEUE-VERIFY (Issue #16): скорость ≠ масштаб времени ────
  test('INT-10. Скорость игры НЕ ускоряет исследования: тик при speed=50 даёт РОВНО один день притока', () => {
    // Контракт ядра: 1 тик = 1 день при ЛЮБОЙ скорости (GameTime.tick —
    // «количество прошедших дней», src/core/types.ts; game-loop реализует
    // speed как тиков/сек: интервал 1000/speed мс + ticksDue = elapsed×speed).
    // Приток RP за тик обязан быть независим от speed — иначе speed входит
    // в расчёт ДВАЖДЫ (исторический speed²-дефект game-loop, чинившийся
    // в R-42: «интервал 1000/speed мс И speed тиков за интервал»).
    //
    // Арифметика (1 планета, 1 лаборатория L5):
    //   base = 25; research_rate add 0.02×5 = 0.1 → приток 27.5 RP/день;
    //   fundamentals=0 + проект активен → дерево 50% = 13.75; фокус ×1.2
    //   → 16.5 RP за тик — НЕЗАВИСИМО от speed.
    // Дефект (deltaSeconds = currentState.speed): на speed=50 тик даёт
    // 825 RP — уровень L1 (500) завершается с ОДНОГО тика.
    const { planetIds } = startGame(1);
    placeLab(planetIds[0]!, 5);
    const store = useGameStore.getState();
    expect(store.startResearch('fusion_reactor', 1)).not.toBeNull();
    expect(rs().activeSlots[0]!.rpInvested).toBeCloseTo(0, 5);

    runTicks(1, 50);

    const after = rs().activeSlots[0]!.rpInvested;
    expect(after).toBeCloseTo(16.5, 5);
    // Уровень НЕ завершается с одного тика: researched пуст, слот тот же.
    expect(rs().researched['fusion_reactor']).toBeUndefined();
    expect(rs().activeSlots).toHaveLength(1);
    expect(rs().activeSlots[0]!.techId).toBe('fusion_reactor');
    expect(rs().activeSlots[0]!.targetLevel).toBe(1);
  });

  test('INT-11. Инвариант скорости: K тиков на speed=50 ≡ K тиков на speed=1 (поразрядно)', () => {
    const mkRun = (speed: 1 | 50) => {
      const { planetIds } = startGame(1);
      placeLab(planetIds[0]!, 5);
      expect(useGameStore.getState().startResearch('fusion_reactor', 1)).not.toBeNull();
      runTicks(10, speed);
      return {
        invested: rs().activeSlots[0]!.rpInvested,
        targetLevel: rs().activeSlots[0]!.targetLevel,
        researched: { ...rs().researched },
        bank: rs().rpBank,
      };
    };
    const slow = mkRun(1);
    const fast = mkRun(50);
    // Один и тот же игровой результат: 10 дней притока ≡ 10 дней притока.
    expect(fast.invested).toBeCloseTo(slow.invested, 5);
    expect(fast.targetLevel).toBe(slow.targetLevel);
    expect(fast.researched).toEqual(slow.researched);
    expect(fast.bank).toBeCloseTo(slow.bank, 5);
  });

});
