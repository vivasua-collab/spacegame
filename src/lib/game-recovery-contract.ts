/**
 * GAME-RECOVERY-01 (Issue #22): контракт recovery-checkpoint — типы,
 * маркер версии схемы и ошибка. Изолирован в модуль БЕЗ зависимостей,
 * чтобы game-store и game-recovery импортировали контракт, не импортируя
 * друг друга (требование Issue #22: «не создавая циклические импорты»).
 */

/** Версия схемы checkpoint-записи. Несовпадение → честный отказ восстановления. */
export const RECOVERY_SCHEMA_VERSION = 1;

/** Checkpoint-запись (одна актуальная). */
export interface RecoveryCheckpoint {
  schemaVersion: number;
  /** Epoch ms записи. */
  savedAt: number;
  seed: number;
  tick: number;
  encoding: 'gzip-base64' | 'json';
  /** Сериализованное (и, возможно, сжатое) состояние — формат сейвов v3. */
  payload: string;
}

/** Причина отказа recovery-операции (для честных сообщений UI). */
export type RecoveryFailureReason =
  | 'storage-unavailable' // нет IndexedDB / SSR
  | 'quota' // переполнение квоты
  | 'serialize' // сериализация/сжатие упали
  | 'write' // прочая ошибка записи
  | 'read' // чтение упало
  | 'bad-version' // чужой schemaVersion
  | 'corrupted'; // payload не декодируется/не десериализуется

export class RecoveryError extends Error {
  constructor(public readonly reason: RecoveryFailureReason, cause?: unknown) {
    super(`Recovery failure (${reason}): ${cause instanceof Error ? cause.message : String(cause ?? '')}`);
    this.name = 'RecoveryError';
  }
}

/** Человеческие сообщения по причинам отказа (для UI). */
export const RECOVERY_ERROR_MESSAGES: Record<RecoveryFailureReason, string> = {
  'storage-unavailable': 'Локальное хранилище восстановления недоступно в этом браузере.',
  quota: 'Не хватает места для локального checkpoint (квота). Прошлый checkpoint сохранён.',
  serialize: 'Не удалось сериализовать состояние для checkpoint.',
  write: 'Не удалось записать локальный checkpoint.',
  read: 'Не удалось прочитать локальный checkpoint.',
  'bad-version': 'Checkpoint создан другой версией игры и несовместим.',
  corrupted: 'Checkpoint повреждён и не может быть восстановлен.',
};
