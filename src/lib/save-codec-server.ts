/**
 * R-26 (2026-08-31): серверный кодек состояния сейва (Node runtime).
 *
 * Проблема: сериализованное состояние 200-системной галактики — ~31 МБ
 * (500 систем — ~79 МБ), а шлюз ограничивает тело запроса 32 МБ
 * (EntityTooLarge 33554432). Владелец ловил 400 при сохранении.
 *
 * Решение: транспорт сжимается (gzip + base64), хранение остаётся
 * plain JSON (version 1 — совместимость с существующими сейвами и
 * простота инспекции). Коэффициенты (замер 2026-08-31, seed 20260831):
 *   - 200 систем: raw 30.7 МБ → gzip 5.2 МБ → base64 6.9 МБ ✓
 *   - 500 систем: raw 79.3 МБ → gzip 13.3 МБ → base64 17.7 МБ ✓
 *
 * Контракт API (POST/PUT):
 *   { ..., state: <plain JSON | base64(gzip(JSON))>, stateEncoding?: 'json' | 'gzip-base64' }
 * Сервер декодирует ДО валидации размера (реальный лимит — на raw, 50 МБ)
 * и кладёт в БД plain JSON.
 *
 * Контракт API (GET /api/save/[id]):
 *   state > STATE_ENCODING_THRESHOLD → { ..., state: base64(gzip), stateEncoding: 'gzip-base64' }
 *   иначе — прежний plain JSON (малые сейвы, обратная совместимость).
 *
 * Формат gzip одинаков у node:zlib (сервер) и Web CompressionStream
 * (браузер, см. save-codec-browser.ts) — RFC 1952.
 */

import { gunzipSync, gzipSync } from 'node:zlib';

export type StateEncoding = 'json' | 'gzip-base64';

/** Порог сжатия ответа GET (байты): меньше — отдаём plain JSON. */
export const STATE_ENCODING_THRESHOLD = 512 * 1024;

/** Максимальный размер base64-строки в запросе (защита до декодирования). */
export const MAX_ENCODED_STATE_CHARS = 100_000_000;

/** Декодировать поле state из тела запроса в plain JSON. */
export function decodeStatePayload(state: string, encoding: StateEncoding | undefined): string {
  if (encoding === 'gzip-base64') {
    return gunzipSync(Buffer.from(state, 'base64')).toString('utf-8');
  }
  return state;
}

/** Закодировать plain JSON для ответа GET (gzip + base64). */
export function encodeStatePayload(
  state: string,
): { state: string; stateEncoding: StateEncoding } {
  return {
    state: gzipSync(Buffer.from(state, 'utf-8')).toString('base64'),
    stateEncoding: 'gzip-base64',
  };
}
