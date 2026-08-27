/**
 * Block 08 (audit §2.3, gap-8) — In-memory token-bucket rate limiter.
 *
 * Closes audit gap-8: «нет rate limiting на /api/save — можно положить
 * `state > 1 ГБ` → DoS». Each IP gets a bucket of 10 tokens, refilled at
 * 10 tokens / minute (i.e. a sustained 10 req/min, with a burst of up to
 * 10 from cold-start).
 *
 * This is an in-process limiter — sufficient for the single-instance
 * dev/MVP deployment. For production (Etap 4 multi-instance) a Redis-backed
 * limiter is required (tracked as future work).
 *
 * Algorithm: classic token bucket.
 *   bucket.tokens += (elapsed_ms / 60_000_ms) * refillPerMinute
 *   bucket.tokens = min(bucket.tokens, maxTokens)
 *   if bucket.tokens < 1 → reject
 *   else bucket.tokens -= 1 → allow
 *
 * The Map is unbounded in principle; in practice the number of distinct IPs
 * hitting `/api/save` is small (single-player game, dev server). For
 * production, an LRU sweep or Redis migration is needed (tracked as future
 * work — not blocking for MVP).
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number; // Date.now() ms epoch
}

const buckets = new Map<string, TokenBucket>();

/** Default policy for `/api/save`: 10 requests per minute per IP. */
export const DEFAULT_MAX_TOKENS = 10;
export const DEFAULT_REFILL_PER_MINUTE = 10;

/**
 * Returns `true` if the request should be allowed, `false` if the bucket
 * is empty (caller should return 429 + `Retry-After`).
 *
 * Side-effects: mutates the bucket Map (refills tokens, decrements by 1).
 * Idempotent for the same `key` within the same ms window (after the first
 * `false`, subsequent calls stay `false` until refill catches up).
 *
 * @param key             Unique bucket key (e.g. `save:${ip}`).
 * @param maxTokens       Bucket capacity — also the cold-start burst limit.
 * @param refillPerMinute Steady-state allowed requests per minute.
 */
export function checkRateLimit(
  key: string,
  maxTokens: number = DEFAULT_MAX_TOKENS,
  refillPerMinute: number = DEFAULT_REFILL_PER_MINUTE,
): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  const bucket: TokenBucket = existing ?? { tokens: maxTokens, lastRefill: now };

  // Refill: add (elapsed_minutes * refillPerMinute) tokens, capped at maxTokens.
  if (existing) {
    const elapsedMs = now - bucket.lastRefill;
    const elapsedMinutes = elapsedMs / 60_000;
    const refilled = bucket.tokens + elapsedMinutes * refillPerMinute;
    bucket.tokens = Math.min(maxTokens, refilled);
  }
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

/**
 * Test-only helper: clears all buckets. Used by `tests/api-save.test.ts`
 * to ensure each test starts with a fresh rate-limit state.
 *
 * Marked as a dev/test utility — production code should not call this.
 */
export function __resetRateLimitBucketsForTesting(): void {
  buckets.clear();
}
