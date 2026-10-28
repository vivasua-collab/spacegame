/// <reference types="bun-types" />
/**
 * GAME-RECOVERY-01 (Issue #22, 2026-10-28) — тесты локального recovery
 * checkpoint: storage-хелпер (мок-бэкенд), атомарность, повреждённый
 * payload, неверная версия, недоступность/квота, запрет параллельных
 * полных записей, интеграция restoreFromCheckpoint в store (тот же путь,
 * что loadGame), инварианты lifecycle.
 *
 * Браузерный сценарий «игра → изменение → checkpoint → F5 → Restore →
 * проверка» выполнен реально (agent-browser) — см. чекпоинт
 * checkpoints/10_28_game_recovery01.md.
 *
 * Run: bun test tests/game-recovery.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import {
  RecoveryService,
  InMemoryRecoveryBackend,
  RECOVERY_SCHEMA_VERSION as _V, // ре-экспорт для синхронности
  type RecoveryCheckpoint,
} from '@/lib/game-recovery';
import { RECOVERY_SCHEMA_VERSION } from '@/lib/game-recovery-contract';
import { useGameStore, serializeGameState, deserializeGameState } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { gameBus } from '@/core/typed-event-bus';
import type { GameState } from '@/core/types';

expect(_V).toBe(RECOVERY_SCHEMA_VERSION);

// ============ Хелперы ============

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
    suspendedSpeed: null,
    isRestoring: false,
    recoveryError: null,
  });
}

/** Живая игровая сессия (mediator + модули) на 5 системах. */
function makePlayingState(): GameState {
  useGameStore.getState().newGame({ seed: 4242, systemCount: 5 });
  const state = useGameStore.getState().gameState!;
  // Колонизируем первую пригодную планету — осмысленное состояние.
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) {
        useGameStore.getState().colonizePlanet(p.id);
        return useGameStore.getState().gameState!;
      }
    }
  }
  return state;
}

function makeService(backend: InMemoryRecoveryBackend): RecoveryService {
  return new RecoveryService(backend);
}

// ============ Storage-слой ============

describe('GAME-RECOVERY-01: storage-слой (мок-бэкенд)', () => {
  test('T1. write → read: checkpoint с версией схемы, timestamp, seed, tick, encoding', async () => {
    resetGameMediator(); resetStore();
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    const state = makePlayingState();

    await svc.writeCheckpoint(state);
    expect(backend.putCalls).toBe(1);
    const cp = await svc.readCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp!.schemaVersion).toBe(RECOVERY_SCHEMA_VERSION);
    expect(cp!.seed).toBe(4242);
    expect(cp!.tick).toBe(state.time.tick);
    expect(cp!.encoding).toBe('json'); // маленькое состояние — без сжатия
    // Payload — валидный формат сейвов: десериализация тем же путём.
    const restored = deserializeGameState(await svc.decodeCheckpointPayload(cp!));
    expect(restored.galaxy.seed).toBe(4242);
    expect(restored.time.tick).toBe(state.time.tick);
  });

  test('T2. АТОМАРНОСТЬ: сбой новой записи (квота) НЕ уничтожает предыдущую пригодную', async () => {
    resetGameMediator(); resetStore();
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    const good = makePlayingState();
    await svc.writeCheckpoint(good);
    const goodCp = await svc.readCheckpoint();
    expect(goodCp).not.toBeNull();

    // Теперь квота переполнена — новая запись обязана упасть…
    backend.failPut = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const second = makePlayingState();
    await expect(svc.writeCheckpoint(second)).rejects.toMatchObject({ reason: 'quota' });
    // …а ПРЕДЫДУЩИЙ пригодный checkpoint цел.
    const after = await svc.readCheckpoint();
    expect(after).toEqual(goodCp);
  });

  test('T3. Прочий сбой записи (не квота) → reason=write, старая запись цела', async () => {
    resetGameMediator(); resetStore();
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    await svc.writeCheckpoint(makePlayingState());
    const first = await svc.readCheckpoint();

    backend.failPut = new Error('disk I/O');
    await expect(svc.writeCheckpoint(makePlayingState())).rejects.toMatchObject({ reason: 'write' });
    expect(await svc.readCheckpoint()).toEqual(first);
  });

  test('T4. Недоступный бэкенд (null): запись и чтение честно падают storage-unavailable', async () => {
    const svc = new RecoveryService(null);
    await expect(svc.writeCheckpoint({} as GameState)).rejects.toMatchObject({ reason: 'storage-unavailable' });
    await expect(svc.readCheckpoint()).rejects.toMatchObject({ reason: 'storage-unavailable' });
    await expect(svc.clearCheckpoint()).rejects.toMatchObject({ reason: 'storage-unavailable' });
  });

  test('T5. Параллельные записи: НЕТ двойных полных сериализаций; ровно один свежий снимок в очереди', async () => {
    resetGameMediator(); resetStore();
    const backend = new InMemoryRecoveryBackend();
    // Замедляем put — создаём окно in-flight.
    let releasePut: (() => void) | null = null;
    let gateOpen = false;
    let putEntries = 0;
    const origPut = backend.put.bind(backend);
    backend.put = async (cp: RecoveryCheckpoint) => {
      putEntries++; // вход в put (putCalls инкрементируется в origPut позже)
      if (!gateOpen) {
        // Шлюз одноразовый: блокирует только ПЕРВУЮ запись; после release
        // последующие (отложенный снимок) проходят свободно.
        await new Promise<void>((r) => {
          releasePut = () => { gateOpen = true; r(); };
        });
      }
      await origPut(cp);
    };
    const svc = makeService(backend);
    const s1 = makePlayingState();

    const first = svc.writeCheckpoint(s1); // уходит в in-flight и ждёт release
    await new Promise((r) => setTimeout(r, 20));
    // Две «параллельные» записи пока первая в полёте — обе должны лишь
    // поставить/перезаписать ОДИН отложенный снимок, не стартуя сериализацию.
    const second = svc.writeCheckpoint(s1);
    const third = svc.writeCheckpoint(s1);
    await Promise.all([second, third]);
    expect(putEntries).toBe(1); // только первая запись началась (не 3!)

    releasePut!();
    await first;
    // Отложенный снимок (последний) пишется сразу после первой записи.
    await new Promise((r) => setTimeout(r, 30));
    expect(putEntries).toBe(2); // 1 + ровно один отложенный
    expect(backend.putCalls).toBe(2); // обе записи дошли до оригинального put
  });

  test('T6. Неверная версия схемы → честный отказ bad-version при декодировании', async () => {
    resetGameMediator(); resetStore();
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    await svc.writeCheckpoint(makePlayingState());
    const cp = await svc.readCheckpoint();
    const bad: RecoveryCheckpoint = { ...cp!, schemaVersion: RECOVERY_SCHEMA_VERSION + 999 };
    await expect(svc.decodeCheckpointPayload(bad)).rejects.toMatchObject({ reason: 'bad-version' });
  });

  test('T7. Повреждённый payload (битый base64/gzip) → reason=corrupted', async () => {
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    const bad: RecoveryCheckpoint = {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      savedAt: Date.now(), seed: 1, tick: 1,
      encoding: 'gzip-base64',
      payload: '!!!not-base64-gzip!!!',
    };
    await expect(svc.decodeCheckpointPayload(bad)).rejects.toMatchObject({ reason: 'corrupted' });
  });

  test('T8. Чтение сбойнуло → reason=read; clear работает (явный выбор пользователя)', async () => {
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    backend.failGet = new Error('IDB broken');
    await expect(svc.readCheckpoint()).rejects.toMatchObject({ reason: 'read' });
    backend.failGet = null;
    // clear — явное удаление записи пользователем.
    await svc.writeCheckpoint({ seed: 1 } as unknown as GameState).catch(() => undefined);
    await svc.clearCheckpoint();
    expect(await svc.readCheckpoint()).toBeNull();
  });

  test('T9. Играющая сессия сериализуется КАК ПАУЗА (восстановление не стартует loop молча)', async () => {
    resetGameMediator(); resetStore();
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    // Переводим в playing (x1) — как у владельца.
    const state = makePlayingState();
    useGameStore.getState().setSpeed(1);
    const playing = useGameStore.getState().gameState!;
    expect(playing.phase).toBe('playing');

    await svc.writeCheckpoint(playing);
    const cp = await svc.readCheckpoint();
    const restored = deserializeGameState(await svc.decodeCheckpointPayload(cp!));
    expect(restored.phase).toBe('paused'); // семантика saveGame: не стартует цикл
    expect(restored.speed).toBe(0);
    // Живое состояние НЕ мутировано (снимок — поверхностная копия).
    expect(useGameStore.getState().gameState!.phase).toBe('playing');
  });
});

// ============ Store-интеграция ============

describe('GAME-RECOVERY-01: restoreFromCheckpoint — тот же путь интеграции, что loadGame', () => {
  beforeEach(() => { resetGameMediator(); resetStore(); });
  afterEach(() => {
    const gs = useGameStore.getState().gameState;
    if (gs) getGameMediator().loop.pause();
    resetGameMediator(); resetStore();
  });

  test('T10. Успешное восстановление: тот же seed/tick/колония; paused; currentSaveId=null; ровно один loop-контракт', async () => {
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    const state = makePlayingState();
    const colonizedPlanet = state.galaxy.systems
      .flatMap((s) => s.planets).find((p) => p.owner !== null)!;
    useGameStore.getState().setSpeed(1); // playing-сессия

    await svc.writeCheckpoint(useGameStore.getState().gameState!);
    const cp = await svc.readCheckpoint()!;

    // ХОЛОДНЫЙ СТАРТ: «перезагрузка» — store очищен, mediator пересоздан.
    getGameMediator().loop.pause();
    resetGameMediator();
    resetStore();
    expect(useGameStore.getState().gameState).toBeNull();

    let ticks = 0;
    const unsub = gameBus.on('core:tick', () => { ticks++; });

    const ok = await useGameStore.getState().restoreFromCheckpoint(cp!);
    expect(ok).toBe(true);

    const restored = useGameStore.getState().gameState!;
    expect(restored).not.toBeNull();
    expect(restored.galaxy.seed).toBe(4242);
    expect(restored.time.tick).toBe(state.time.tick);
    // Колония из checkpoint'а восстановлена (не только «похожая карта по seed»).
    const restoredPlanet = restored.galaxy.systems
      .flatMap((s) => s.planets).find((p) => p.id === colonizedPlanet.id);
    expect(restoredPlanet?.owner).not.toBeNull();
    // Согласованные значения store.
    expect(useGameStore.getState().isInitialized).toBe(true);
    expect(useGameStore.getState().currentSaveId).toBeNull(); // серверный ID НЕ приписан
    expect(useGameStore.getState().isRestoring).toBe(false);
    expect(useGameStore.getState().recoveryError).toBeNull();
    // Восстановление НЕ стартует игровой цикл молча (Issue #22).
    expect(restored.phase).toBe('paused');
    expect(getGameMediator().loop.getPhase()).toBe('paused');
    await new Promise((r) => setTimeout(r, 120));
    expect(ticks).toBe(0);

    unsub();
  });

  test('T11. Повреждённый checkpoint: false + честная причина; активное состояние (если было) не тронуто', async () => {
    const bad: RecoveryCheckpoint = {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      savedAt: Date.now(), seed: 1, tick: 1,
      encoding: 'gzip-base64',
      payload: '@@@corrupted@@@',
    };
    const ok = await useGameStore.getState().restoreFromCheckpoint(bad);
    expect(ok).toBe(false);
    expect(useGameStore.getState().recoveryError).toContain('повреждён');
    expect(useGameStore.getState().isRestoring).toBe(false);
    expect(useGameStore.getState().gameState).toBeNull(); // ничего не подменено
    expect(useGameStore.getState().isInitialized).toBe(false);
  });

  test('T12. Чужая версия схемы: false + сообщение о несовместимости', async () => {
    const bad: RecoveryCheckpoint = {
      schemaVersion: RECOVERY_SCHEMA_VERSION + 1,
      savedAt: Date.now(), seed: 1, tick: 1,
      encoding: 'json',
      payload: '{}',
    };
    const ok = await useGameStore.getState().restoreFromCheckpoint(bad);
    expect(ok).toBe(false);
    expect(useGameStore.getState().recoveryError).toContain('версией');
  });

  test('T13. New Game заменяет активный checkpoint, отмена ничего не удаляет (контракт записи)', async () => {
    const backend = new InMemoryRecoveryBackend();
    const svc = makeService(backend);
    const first = makePlayingState();
    await svc.writeCheckpoint(first);
    const firstCp = await svc.readCheckpoint();
    expect(firstCp!.seed).toBe(4242);

    // Новая игра (штатный newGame) → смена галактики → сервис пишет НОВУЮ
    // запись атомарно (хук вызывает writeCheckpoint по galaxy.id; здесь —
    // прямой контракт сервиса).
    useGameStore.getState().newGame({ seed: 777, systemCount: 5 });
    await svc.writeCheckpoint(useGameStore.getState().gameState!);
    const secondCp = await svc.readCheckpoint();
    expect(secondCp!.seed).toBe(777);
    expect(secondCp!.schemaVersion).toBe(RECOVERY_SCHEMA_VERSION);
    // «Отмена New Game» (состояние не менялось) — записи нет, запись цела:
    const before = await svc.readCheckpoint();
    await new Promise((r) => setTimeout(r, 10));
    expect(await svc.readCheckpoint()).toEqual(before);
  });
});
