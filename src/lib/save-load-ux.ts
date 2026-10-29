/**
 * SAVE-V4-DOCS-UX-01 (Issue #26): типизированная классификация отказа
 * загрузки сейва + тексты тостов.
 *
 * Принцип аудита: НЕ всякая неудачная загрузка — «старый формат». Только
 * legacy-версии (v1..v{SAVE_FORMAT_VERSION−1}, гекс-залежи) дают явное
 * сообщение «миграции нет — начните новую игру». Сетевые ошибки,
 * отсутствие сейва, битый JSON и прочие причины получают честное общее
 * сообщение — пользователя не отправляют начинать новую игру зря.
 *
 * Модуль без зависимостей от store/UI: чистая логика, пригодна для
 * регрессионных тестов вне клиентских компонентов.
 */

import {
  IncompatibleSaveFormatError,
  SAVE_FORMAT_VERSION,
  rejectedLegacyVersionsLabel,
} from '@/lib/save-format-v4';

/** Причина отказа загрузки (классификация loadGame). */
export type LoadFailureKind =
  | 'legacy-save-format' // fmt v1..v{N−1} — несовместимый СТАРЫЙ формат
  | 'other-load-failure'; // сеть, 404, битый JSON, zod, прочее

/** Классифицированный отказ загрузки (для UI + диагностики). */
export interface LoadFailure {
  kind: LoadFailureKind;
  /** Первопричина — полное сообщение исходной ошибки (диагностика). */
  detail?: string;
}

/**
 * Классификация исходной ошибки из deserializeGameState/fetch-пути.
 * Единственный источник «legacy-формата» — IncompatibleSaveFormatError
 * с legacy=true (выбрасывается expandSaveV4 при fmt v1..v{N−1}).
 * Всё остальное — 'other-load-failure' (в т.ч. IncompatibleSaveFormatError
 * с legacy=false: маркер отсутствует или fmt «новее» сборки — это НЕ
 * «старый формат» и список v1/v2/v3 к нему неприменим).
 */
export function classifyLoadFailure(e: unknown): LoadFailure {
  const detail = e instanceof Error ? e.message : String(e ?? 'unknown error');
  if (e instanceof IncompatibleSaveFormatError && e.legacy) {
    return { kind: 'legacy-save-format', detail };
  }
  return { kind: 'other-load-failure', detail };
}

/** Форма тоста отказа загрузки (title + description). */
export interface LoadFailureToast {
  title: string;
  description: string;
}

/**
 * Текст тоста по классификации. Версии — ТОЛЬКО из модуля формата
 * (rejectedLegacyVersionsLabel / SAVE_FORMAT_VERSION), не литералом:
 * при следующей смене версии текст обновится сам (урок Task 72).
 */
export function loadFailureToast(failure: LoadFailure): LoadFailureToast {
  if (failure.kind === 'legacy-save-format') {
    return {
      title: 'Не удалось загрузить сейв',
      description:
        `Этот сейв использует неподдерживаемый старый формат `
        + `(${rejectedLegacyVersionsLabel()}). Поддерживается только `
        + `v${SAVE_FORMAT_VERSION}; миграция старых сейвов не предусмотрена `
        + '— чтобы продолжить, начните новую игру.',
    };
  }
  return {
    title: 'Не удалось загрузить сейв',
    description:
      'Не удалось получить или прочитать сейв (сеть, сейв отсутствует '
      + 'или повреждён). Подробности — в консоли.',
  };
}
