/// <reference types="bun-types" />
/**
 * SAVE-V4-DOCS-UX-01 (Issue #26) — регрессия UX отказа старого сейва.
 *
 * Критерии аудита:
 *   1. Legacy fmt v1/v2/v3 → ЯВНОЕ UX-сообщение «миграции нет — начните
 *      новую игру» (версии из модуля формата, не литерал).
 *   2. Прочие причины (сеть, 404, битый JSON) НЕ маркируются как
 *      несовместимость формата; первопричина остаётся для диагностики.
 *   3. Типизированная классификация (не проверка статической строки):
 *      expandSaveV4 → IncompatibleSaveFormatError(legacy) →
 *      classifyLoadFailure → loadFailureToast; loadGame пишет
 *      store.loadFailure (integration со stub-fetch); recovery
 *      fmt≠4 → честная причина bad-version (не corrupted).
 *
 * Паттерн integration — как tests/game-recovery.test.ts (resetStore +
 * stubFetch + холодный restore).
 *
 * Run: bun test tests/save-v4-docs-ux.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import '@/core/immer-setup';
import {
  expandSaveV4,
  IncompatibleSaveFormatError,
  rejectedLegacyVersionsLabel,
  REJECTED_LEGACY_FORMAT_VERSIONS,
  SAVE_FORMAT_VERSION,
} from '@/lib/save-format-v4';
import {
  classifyLoadFailure,
  loadFailureToast,
} from '@/lib/save-load-ux';
import { deserializeGameState, useGameStore } from '@/stores/game-store';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { RECOVERY_ERROR_MESSAGES } from '@/lib/game-recovery-contract';
import type { RecoveryCheckpoint } from '@/lib/game-recovery';

// ============ Хелперы (паттерн game-recovery.test.ts) ============

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
    loadFailure: null, // Issue #26: поле классификации отказа
    suspendedSpeed: null,
    isRestoring: false,
    recoveryError: null,
    sessionVersion: 0,
  });
}

/** Заглушить globalThis.fetch (см. game-recovery.test.ts). */
function stubFetch(handler: (url: string) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) =>
    handler(String(url))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============ 1. Типизированный отказ expandSaveV4 ============

describe('Issue #26: типизированный отказ expandSaveV4 (IncompatibleSaveFormatError)', () => {
  test('1.1 Legacy fmt v1/v2/v3 → legacy=true; текст прежний («залежи на гексах», начать новую игру)', () => {
    for (const v of REJECTED_LEGACY_FORMAT_VERSIONS) {
      let err: unknown;
      try {
        expandSaveV4({ fmt: v, galaxy: { systems: [] } });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(IncompatibleSaveFormatError);
      const typed = err as IncompatibleSaveFormatError;
      expect(typed.legacy).toBe(true); // ← классификация для UI
      expect(typed.fmt).toBe(v);
      expect(typed.name).toBe('IncompatibleSaveFormatError');
      expect(typed.message).toContain(`fmt=${v}`);
      expect(typed.message).toContain(`ожидается ${SAVE_FORMAT_VERSION}`);
      expect(typed.message).toContain('залежи на гексах');
      expect(typed.message).toContain('начните новую игру');
    }
  });

  test('1.2 fmt «новее» сборки (5) → legacy=false: НЕ «старый формат», список v1/v2/v3 неприменим', () => {
    let err: unknown;
    try {
      expandSaveV4({ fmt: SAVE_FORMAT_VERSION + 1, galaxy: { systems: [] } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IncompatibleSaveFormatError);
    const typed = err as IncompatibleSaveFormatError;
    expect(typed.legacy).toBe(false);
    expect(typed.message).toContain(`fmt=${SAVE_FORMAT_VERSION + 1}`);
    expect(typed.message).not.toContain('залежи на гексах');
    expect(typed.message).toContain('начните новую игру');
  });

  test('1.3 Маркер fmt отсутствует → legacy=false + честное «маркер fmt отсутствует»', () => {
    let err: unknown;
    try {
      expandSaveV4({ galaxy: { systems: [] } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IncompatibleSaveFormatError);
    const typed = err as IncompatibleSaveFormatError;
    expect(typed.legacy).toBe(false);
    expect(typed.fmt).toBeUndefined();
    expect(typed.message).toContain('маркер fmt отсутствует');
  });

  test('1.4 deserializeGameState пробрасывает типизированную ошибку (integration)', () => {
    let err: unknown;
    try {
      deserializeGameState('{"fmt":3,"galaxy":{"systems":[]}}');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IncompatibleSaveFormatError);
    expect((err as IncompatibleSaveFormatError).legacy).toBe(true);
  });
});

// ============ 2. Классификация и тосты (чистая логика) ============

describe('Issue #26: classifyLoadFailure + loadFailureToast (не статические строки)', () => {
  test('2.1 Typed legacy error → kind=legacy-save-format, detail = первопричина', () => {
    let err: unknown;
    try {
      deserializeGameState('{"fmt":2,"galaxy":{"systems":[]}}');
    } catch (e) {
      err = e;
    }
    const failure = classifyLoadFailure(err);
    expect(failure.kind).toBe('legacy-save-format');
    expect(failure.detail).toContain('fmt=2');
  });

  test('2.2 Прочие ошибки → other-load-failure (сетевой текст, битый JSON, не-Error значение)', () => {
    // «Сетевая» ошибка loadGame
    const network = classifyLoadFailure(new Error('Failed to load save'));
    expect(network.kind).toBe('other-load-failure');
    expect(network.detail).toContain('Failed to load save');
    // Битый JSON (JSON.parse SyntaxError)
    let jsonErr: unknown;
    try {
      deserializeGameState('это вообще не json');
    } catch (e) {
      jsonErr = e;
    }
    expect(classifyLoadFailure(jsonErr).kind).toBe('other-load-failure');
    // Не-Error значение не падает
    expect(classifyLoadFailure('строка-причина').kind).toBe('other-load-failure');
    // Чужая несовместимость (fmt=5) — тоже other, НЕ legacy
    let newer: unknown;
    try {
      expandSaveV4({ fmt: SAVE_FORMAT_VERSION + 1 });
    } catch (e) {
      newer = e;
    }
    expect(classifyLoadFailure(newer).kind).toBe('other-load-failure');
  });

  test('2.3 Тост legacy: версии из модуля формата, «начните новую игру», без общего «повреждён»', () => {
    const toast = loadFailureToast({
      kind: 'legacy-save-format',
      detail: 'Несовместимый формат сейва: fmt=3 (ожидается 4)',
    });
    expect(toast.title).toContain('Не удалось загрузить сейв');
    // Список версий — производный от модуля формата, не литерал:
    expect(toast.description).toContain(rejectedLegacyVersionsLabel());
    expect(toast.description).toContain(`v${SAVE_FORMAT_VERSION}`);
    expect(toast.description).toContain('начните новую игру');
    expect(toast.description).toContain('миграция');
    // Legacy-тост не звучит как «сейв повреждён»:
    expect(toast.description).not.toContain('повреждён');
    // Согласованность с рекомендованной формулировкой аудита (по смыслу):
    expect(toast.description).toContain('неподдерживаемый старый формат');
  });

  test('2.4 Тост прочих причин: честное общее сообщение — БЕЗ формата и БЕЗ «начните новую игру»', () => {
    const toast = loadFailureToast({
      kind: 'other-load-failure',
      detail: 'Failed to load save',
    });
    expect(toast.description).not.toContain('старый формат');
    expect(toast.description).not.toContain(rejectedLegacyVersionsLabel());
    expect(toast.description).not.toContain('начните новую игру');
    expect(toast.description).toContain('консоли'); // диагностика остаётся доступной
  });
});

// ============ 3. loadGame integration: классификация в store ============

describe('Issue #26: loadGame пишет store.loadFailure (integration, stub-fetch)', () => {
  beforeEach(() => { resetGameMediator(); resetStore(); });
  afterEach(() => {
    const gs = useGameStore.getState().gameState;
    if (gs) getGameMediator().loop.pause();
    resetGameMediator(); resetStore();
  });

  test('3.1 Legacy-сейв (fmt:3 в state) → false + loadFailure.kind=legacy-save-format', async () => {
    const restore = stubFetch(async () =>
      jsonResponse({ id: 'legacy', state: '{"fmt":3,"galaxy":{"systems":[]}}' }));
    try {
      const ok = await useGameStore.getState().loadGame('legacy');
      expect(ok).toBe(false);
      const failure = useGameStore.getState().loadFailure;
      expect(failure).not.toBeNull();
      expect(failure!.kind).toBe('legacy-save-format');
      expect(failure!.detail).toContain('fmt=3');
      // Активное состояние не подменено (холодный старт — и так null).
      expect(useGameStore.getState().gameState).toBeNull();
      expect(useGameStore.getState().isLoading).toBe(false);
    } finally {
      restore();
    }
  });

  test('3.2 Сервер 500 → false + kind=other-load-failure (сеть ≠ старый формат)', async () => {
    const restore = stubFetch(async () => jsonResponse({ error: 'boom' }, 500));
    try {
      const ok = await useGameStore.getState().loadGame('broken');
      expect(ok).toBe(false);
      const failure = useGameStore.getState().loadFailure;
      expect(failure!.kind).toBe('other-load-failure');
      expect(failure!.detail).toContain('Failed to load save');
    } finally {
      restore();
    }
  });

  test('3.3 Битый JSON в state → kind=other-load-failure (НЕ legacy)', async () => {
    const restore = stubFetch(async () =>
      jsonResponse({ id: 'junk', state: 'это не json' }));
    try {
      const ok = await useGameStore.getState().loadGame('junk');
      expect(ok).toBe(false);
      expect(useGameStore.getState().loadFailure!.kind).toBe('other-load-failure');
    } finally {
      restore();
    }
  });

  test('3.4 Каждая новая попытка сбрасывает прежнюю классификацию (loadFailure: null на старте)', async () => {
    const restoreFail = stubFetch(async () => jsonResponse({ id: 'x', state: '{"fmt":1}' }));
    try {
      await useGameStore.getState().loadGame('x');
      expect(useGameStore.getState().loadFailure!.kind).toBe('legacy-save-format');
    } finally {
      restoreFail();
    }
    // Следующая попытка — сначала loadFailure сброшен, даже если она успешна/иная.
    const restore500 = stubFetch(async () => jsonResponse({ error: 'boom' }, 500));
    let resetObserved: unknown = 'not-observed';
    const restoreProbe = stubFetch(async (url) => {
      resetObserved = useGameStore.getState().loadFailure;
      return jsonResponse({ error: 'boom' }, 500);
    });
    try {
      await useGameStore.getState().loadGame('y');
      expect(resetObserved).toBeNull(); // сброс ДО fetch
      expect(useGameStore.getState().loadFailure!.kind).toBe('other-load-failure');
    } finally {
      restoreProbe();
      restore500();
    }
  });
});

// ============ 4. Recovery: fmt≠4 checkpoint → честный bad-version ============

describe('Issue #26: recovery классифицирует чужой fmt как bad-version (не corrupted)', () => {
  beforeEach(() => { resetGameMediator(); resetStore(); });
  afterEach(() => {
    const gs = useGameStore.getState().gameState;
    if (gs) getGameMediator().loop.pause();
    resetGameMediator(); resetStore();
  });

  test('4.1 Payload fmt:3 (валидная схема checkpoint) → bad-version, не «повреждён»', async () => {
    const bad: RecoveryCheckpoint = {
      schemaVersion: 1, // валидная версия СХЕМЫ checkpoint
      savedAt: Date.now(), seed: 1, tick: 1,
      encoding: 'json',
      payload: '{"fmt":3,"galaxy":{"systems":[]}}', // а сейв — чужой v3
    };
    const ok = await useGameStore.getState().restoreFromCheckpoint(bad);
    expect(ok).toBe(false);
    const err = useGameStore.getState().recoveryError;
    expect(err).toBe(RECOVERY_ERROR_MESSAGES['bad-version']);
    expect(err).toContain('версией'); // «Checkpoint создан другой версией игры…»
    expect(err).not.toBe(RECOVERY_ERROR_MESSAGES.corrupted);
  });

  test('4.2 Битый payload (не JSON) → corrupted как прежде (регрессия T11 не сломана)', async () => {
    const bad: RecoveryCheckpoint = {
      schemaVersion: 1,
      savedAt: Date.now(), seed: 1, tick: 1,
      encoding: 'json',
      payload: '@@@corrupted@@@',
    };
    const ok = await useGameStore.getState().restoreFromCheckpoint(bad);
    expect(ok).toBe(false);
    const err = useGameStore.getState().recoveryError;
    expect(err).toBe(RECOVERY_ERROR_MESSAGES.corrupted);
    expect(err).toContain('повреждён');
  });
});
