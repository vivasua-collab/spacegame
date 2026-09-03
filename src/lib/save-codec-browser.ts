/**
 * R-26 (2026-08-31): браузерный кодек состояния сейва (Web APIs).
 *
 * Используется в src/stores/game-store.ts (saveGame/loadGame):
 *   - gzipBase64: state JSON → base64(gzip) для POST/PUT (шлюз 32 МБ);
 *   - gunzipBase64: ответ GET с stateEncoding='gzip-base64' → JSON.
 *
 * Требует CompressionStream/DecompressionStream (Chrome 80+, Firefox 113+,
 * Safari 16.4+, Bun 1.1+). При отсутствии API вызывающий код откатывается
 * на plain JSON (малые сейвы проходят под лимитом шлюза).
 *
 * Формат — RFC 1952 (тот же, что у node:zlib на сервере,
 * см. save-codec-server.ts): совместимость обеспечена стандартом.
 */

/** Размер чанка для конвертации Uint8Array → binary string (стек btoa). */
const BTOA_CHUNK = 0x8000;

/** JSON-строка → base64(gzip(json)). */
export async function gzipBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i += BTOA_CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + BTOA_CHUNK));
  }
  return btoa(binary);
}

/** base64(gzip(json)) → JSON-строка. */
export async function gunzipBase64(base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/** Доступность Web-кодека в текущем окружении. */
export function isBrowserCodecAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}
