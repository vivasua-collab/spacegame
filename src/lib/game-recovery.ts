/**
 * GAME-RECOVERY-01 (Issue #22, 2026-10-28): локальный recovery checkpoint
 * игровой сессии в браузере — ОТДЕЛЬНО от ручных серверных сейвов.
 *
 * Зачем: владелец использует F5 как сброс игры (до #21 не было выхода в
 * меню); после перезагрузки страницы Zustand/in-memory прогресс исчезает.
 * Recovery-checkpoint пишется периодически (≈30 с) в IndexedDB и
 * предлагается на стартовом экране карточкой «Восстановить последнюю игру».
 *
 * Требования задачи (Issue #22), реализованные здесь:
 *  - один актуальный checkpoint; поля: маркер версии схемы, timestamp,
 *    seed, tick, кодировка, payload;
 *  - ключ НЕ конфликтует с серверными сейвами (отдельная БД/стор);
 *  - атомарность: новая запись не уничтожает предыдущую пригодную до
 *    успешного завершения (IDB-транзакция на put; сбой сериализации/квоты
 *    оставляет старую запись);
 *  - недоступность IndexedDB / SSR / quota — честные ошибки, не ломают
 *    симуляцию, не дают ложного успеха;
 *  - НЕТ localStorage/sessionStorage для полного состояния (десятки МБ);
 *  - переиспользуются существующие serializeGameState/gzipBase64 — второй
 *    сериализатор не пишется, контракт сейвов не меняется;
 *  - правило параллельных записей: если предыдущая запись ещё идёт —
 *    ровно один свежий снимок ставится в очередь (pendingOnce), остальные
 *    пропускаются (следующий тик таймера напишет свежее).
 *
 * Тестируемость: бэкенд-интерфейс RecoveryStorageBackend — IndexedDB
 * реализация подменяется in-memory моком в тестах (новая библиотека ради
 * теста не вводится).
 */

import type { GameState } from '@/core/types';
import { serializeGameState } from '@/stores/game-store';
import { gzipBase64, gunzipBase64, isBrowserCodecAvailable } from '@/lib/save-codec-browser';
import {
  RECOVERY_SCHEMA_VERSION,
  type RecoveryCheckpoint,
  RecoveryError,
} from '@/lib/game-recovery-contract';

// Ре-экспорт контракта для удобства (единая точка входа recovery).
export { RECOVERY_SCHEMA_VERSION, RecoveryError } from '@/lib/game-recovery-contract';
export type { RecoveryCheckpoint, RecoveryFailureReason } from '@/lib/game-recovery-contract';


/** Имя IndexedDB (отдельная от всего — не конфликтует ни с чем). */
const RECOVERY_DB_NAME = 'spacegame-recovery';
const RECOVERY_STORE_NAME = 'checkpoint';
/** Ключ единственной записи. */
const RECOVERY_KEY = 'current-session';

/** Интервал периодических checkpoint'ов активной сессии (мс). */
export const RECOVERY_INTERVAL_MS = 30_000;

// ============ Бэкенд: интерфейс + реализации ============

/**
 * Изолированный бэкенд хранения одного checkpoint'а. IndexedDB-реализация
 * продакшн; in-memory — тесты (подмена без новой библиотеки).
 */
export interface RecoveryStorageBackend {
  get(): Promise<RecoveryCheckpoint | null>;
  put(cp: RecoveryCheckpoint): Promise<void>;
  clear(): Promise<void>;
}

/** Браузерная реализация на IndexedDB. Одна запись, транзакционные put. */
class IndexedDbRecoveryBackend implements RecoveryStorageBackend {
  private db: IDBDatabase | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(RECOVERY_DB_NAME, 1);
      req.onupgradeneeded = () => {
        // Версия 1: единственный object store с одной записью по ключу.
        if (!req.result.objectStoreNames.contains(RECOVERY_STORE_NAME)) {
          req.result.createObjectStore(RECOVERY_STORE_NAME);
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onclose = () => { this.db = null; }; // соединение потеряно — откроем заново
        resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(RECOVERY_STORE_NAME, mode);
      const req = run(tx.objectStore(RECOVERY_STORE_NAME));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => {
        const err = tx.error;
        // Квота: IDB поднимает QuotaExceededError на транзакции записи.
        if (err && err.name === 'QuotaExceededError') reject(err);
        else reject(err ?? new Error('IndexedDB transaction aborted'));
      };
    });
  }

  get(): Promise<RecoveryCheckpoint | null> {
    return this.tx<RecoveryCheckpoint | null>('readonly', (s) => s.get(RECOVERY_KEY));
  }

  put(cp: RecoveryCheckpoint): Promise<void> {
    // Атомарная замена единственной записи: IDB-транзакция — либо новая
    // запись целиком, либо старая остаётся нетронутой.
    return this.tx<IDBValidKey>('readwrite', (s) => s.put(cp, RECOVERY_KEY)).then(() => undefined);
  }

  clear(): Promise<void> {
    return this.tx<undefined>('readwrite', (s) => s.clear()).then(() => undefined);
  }
}

/** In-memory бэкенд для тестов (в т.ч. симуляция отказов). */
export class InMemoryRecoveryBackend implements RecoveryStorageBackend {
  record: RecoveryCheckpoint | null = null;
  failPut: Error | null = null;
  failGet: Error | null = null;
  putCalls = 0;

  async get(): Promise<RecoveryCheckpoint | null> {
    if (this.failGet) throw this.failGet;
    return this.record;
  }

  async put(cp: RecoveryCheckpoint): Promise<void> {
    this.putCalls++;
    if (this.failPut) throw this.failPut;
    this.record = cp;
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}

/**
 * Получить продакшн-бэкенд или null, когда хранилище недоступно
 * (SSR, нет indexedDB, приватный режим с отключённым IDB и т.п.).
 * Сбои соединения НЕ детектятся здесь — они честно всплывают из операций.
 */
export function getRecoveryBackend(): RecoveryStorageBackend | null {
  if (typeof window === 'undefined') return null; // SSR — никогда
  if (typeof indexedDB === 'undefined') return null;
  try {
    return new IndexedDbRecoveryBackend();
  } catch {
    return null;
  }
}

// ============ Сервис: orchestration записи/чтения/декодирования ============

/**
 * Сервис recovery-checkpoint'ов. Единственная точка записи; гарантирует:
 *  - не более одной активной полной сериализации/записи;
 *  - при пропуске из-за in-flight — ровно ОДИН свежий снимок в очередь
 *    (pendingOnce): после завершения текущей записи сразу пишется новый;
 *  - snapshot играющей сессии сериализуется как paused/speed=0 (семантика
 *    saveGame: восстановление НЕ должно молча стартовать игровой цикл —
 *    Issue #22: «не должно... немедленно стартовать игровой цикл»).
 */
export class RecoveryService {
  private inFlight = false;
  /** Ровно один отложенный свежий снимок (последний из пропущенных). */
  private pendingState: GameState | null = null;

  constructor(private readonly backend: RecoveryStorageBackend | null) {}

  get available(): boolean {
    return this.backend !== null;
  }

  /**
   * Записать checkpoint текущего состояния.
   *
   * Правило параллельности (Issue #22): если предыдущая запись ещё идёт —
   * новый вызов не стартует вторую сериализацию; РОВНО ОДИН свежий снимок
   * (последний) ставится в очередь и пишется сразу после завершения
   * текущей. Очередной вызов резолвится сразу (best-effort, результат
   * повтора — в console.warn); ошибки ПЕРВОЙ записи бросаются вызывающему.
   */
  async writeCheckpoint(state: GameState): Promise<void> {
    if (!this.backend) {
      throw new RecoveryError('storage-unavailable');
    }
    if (this.inFlight) {
      this.pendingState = state;
      return;
    }
    this.inFlight = true;
    try {
      await this.writeNow(state);
    } finally {
      this.inFlight = false;
      const pending = this.pendingState;
      this.pendingState = null;
      if (pending) {
        // Повтор с последним свежим снимком — не в текущем стеке. Ошибки
        // повтора не роняют таймер/симуляцию: логируем; следующий тик
        // периодической записи напишет снова.
        void this.writeCheckpoint(pending).catch((e) => {
          console.warn('[recovery] отложенная запись не удалась:', e instanceof Error ? e.message : e);
        });
      }
    }
  }

  /**
   * Внутренняя запись: сериализация → сжатие → put. Сериализуется snapshot
   * с phase='paused'/speed=0 для играющей сессии (без мутации живого
   * состояния — поверхностная копия с переопределёнными полями).
   */
  private async writeNow(state: GameState): Promise<void> {
    let payload: string;
    let encoding: RecoveryCheckpoint['encoding'] = 'json';
    try {
      const snapshot: GameState = state.phase === 'playing'
        ? { ...state, phase: 'paused', speed: 0 }
        : state;
      payload = serializeGameState(snapshot);
    } catch (e) {
      throw new RecoveryError('serialize', e);
    }
    // Сжатие транспорта: те же хелперы, что у сейвов (десятки МБ в IDB
    // строкой — допустимо, но gzip+base64 в разы меньше; фолбэк — json).
    if (payload.length > 512 * 1024 && isBrowserCodecAvailable()) {
      try {
        payload = await gzipBase64(payload);
        encoding = 'gzip-base64';
      } catch {
        // Фолбэк: не сжалось — пишем как есть (encoding остаётся json).
      }
    }
    const cp: RecoveryCheckpoint = {
      schemaVersion: RECOVERY_SCHEMA_VERSION,
      savedAt: Date.now(),
      seed: state.galaxy.seed,
      tick: state.time.tick,
      encoding,
      payload,
    };
    try {
      await this.backend!.put(cp);
    } catch (e) {
      // Атомарность: старая пригодная запись НЕ тронута (IDB-транзакция
      // либо применила новую целиком, либо откатилась).
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        throw new RecoveryError('quota', e);
      }
      throw new RecoveryError('write', e);
    }
  }

  /** Прочитать checkpoint (null — записи нет). */
  async readCheckpoint(): Promise<RecoveryCheckpoint | null> {
    if (!this.backend) throw new RecoveryError('storage-unavailable');
    try {
      return await this.backend.get();
    } catch (e) {
      throw new RecoveryError('read', e);
    }
  }

  /** Удалить checkpoint (явный выбор пользователя). */
  async clearCheckpoint(): Promise<void> {
    if (!this.backend) throw new RecoveryError('storage-unavailable');
    try {
      await this.backend.clear();
    } catch (e) {
      throw new RecoveryError('write', e);
    }
  }

  /**
   * Декодировать payload checkpoint'а в JSON-строку состояния (путь тот же,
   * что у загрузки сейвов: gunzipBase64 для gzip-base64, plain для json).
   */
  async decodeCheckpointPayload(cp: RecoveryCheckpoint): Promise<string> {
    if (cp.schemaVersion !== RECOVERY_SCHEMA_VERSION) {
      throw new RecoveryError('bad-version');
    }
    if (cp.encoding === 'gzip-base64') {
      try {
        return await gunzipBase64(cp.payload);
      } catch (e) {
        throw new RecoveryError('corrupted', e);
      }
    }
    return cp.payload;
  }
}

/** Синглтон сервиса на продакшн-бэкенде (или null-бэкенде вне браузера). */
let serviceSingleton: RecoveryService | null = null;

export function getRecoveryService(): RecoveryService {
  if (!serviceSingleton) {
    serviceSingleton = new RecoveryService(getRecoveryBackend());
  }
  return serviceSingleton;
}

/** Только для тестов: подменить синглтон. */
export function __setRecoveryServiceForTesting(s: RecoveryService | null): void {
  serviceSingleton = s;
}
