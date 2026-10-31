/**
 * CORE-SAVE-REPRO-01 (Issue #27) — дедупликация POST /api/save по
 * клиентскому `x-save-request-id`.
 *
 * Проблема (§6 Issue #27, воспроизведено 2026-10-31 raw-TCP-пробой): сервер
 * может УСПЕШНО создать запись (201, commit), а ответ потерять на пути к
 * клиенту (обрыв соединения, таймаут клиентского AbortController, сбой
 * прокси). Клиент не получает { id } и не устанавливает currentSaveId —
 * повторное нажатие Save создаёт ВТОРУЮ запись (дубль «Galaxy #seed»).
 *
 * Решение (узкое, без изменения схемы БД): клиент шлёт UUID в
 * `x-save-request-id`; ID переживает неудачную попытку в рамках той же
 * игровой сессии (см. game-store). Сервер помнит (requestId → saveId) и на
 * повтор возвращает УЖЕ СОЗДАННУЮ запись. Хранение — in-memory процесса:
 *
 *   - Гарантия скоупится одним экземпляром сервера (наш deployment — один
 *     Next.js процесс; рестарт сервера между попыткой и повтором сбрасывает
 *     карту → в этом редком окне дубль возможен, гарантия честно сужена).
 *   - TTL 10 минут: повтор спустя часы — это уже осознанное новое
 *     сохранение, а не retry; старые записи вытесняются.
 *   - Cap 500 + eviction старейшего (Map хранит порядок вставки) — память
 *     ограничена даже при аномальном наплыве.
 *
 * Безопасность: client-provided ID используется ТОЛЬКО для корреляции
 * (§4 Issue #27) и дедупа собственной операции; это НЕ токен авторизации и
 * не влияет на доступ к чужим записям (id в ответе — тот, что сервер сам
 * создал под этим requestId).
 */

/** TTL записи дедуп-карты. Повтор позже — осознанное новое сохранение. */
export const SAVE_REQUEST_DEDUP_TTL_MS = 10 * 60_000;

/** Максимальный размер карты (защита памяти; eviction старейшего). */
export const SAVE_REQUEST_DEDUP_MAX_ENTRIES = 500;

/** Синтаксис requestId: 8–64 символа [A-Za-z0-9_-] (UUID проходит). */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

interface DedupEntry {
  saveId: string;
  createdAt: number;
}

const entries = new Map<string, DedupEntry>();

/**
 * Валиден ли requestId как ключ дедупа. Кривые значения молча игнорируются
 * (запрос обрабатывается как без requestId — обычное создание).
 */
export function isPlausibleSaveRequestId(
  value: string | null | undefined,
): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Вернуть saveId, уже созданный под этим requestId (или null — не был).
 * Истёкшие записи удаляются лениво при обращении.
 */
export function checkSaveRequestDuplicate(
  requestId: string,
  nowMs: number = Date.now(),
): string | null {
  const entry = entries.get(requestId);
  if (!entry) return null;
  if (nowMs - entry.createdAt > SAVE_REQUEST_DEDUP_TTL_MS) {
    entries.delete(requestId);
    return null;
  }
  return entry.saveId;
}

/**
 * Запомнить, что под requestId создана запись saveId. При переполнении
 * вытесняет старейшую запись (Map хранит порядок вставки).
 */
export function rememberSaveRequest(
  requestId: string,
  saveId: string,
  nowMs: number = Date.now(),
): void {
  if (!entries.has(requestId) && entries.size >= SAVE_REQUEST_DEDUP_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(requestId, { saveId, createdAt: nowMs });
}

/** Тест-only: полная очистка карты (паттерн __resetRateLimitBucketsForTesting). */
export function __resetSaveRequestDedupForTesting(): void {
  entries.clear();
}
