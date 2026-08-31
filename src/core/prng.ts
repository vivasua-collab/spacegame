/**
 * xoshiro256** — высококачественный PRNG для процедурной генерации.
 * Детерминированный: один и тот же seed даёт одинаковый результат.
 */

export class Xoshiro256 {
  private state: [number, number, number, number];

  constructor(seed: number) {
    this.state = this.splitMix64(seed);
  }

  private splitMix64(seed: number): [number, number, number, number] {
    const result: number[] = [];
    let z = seed | 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b97f4a7c15) | 0;
      let x = z;
      x = Math.imul(x ^ (x >>> 30), 0xbf58476d1ce4e5b9);
      x = Math.imul(x ^ (x >>> 27), 0x94d049bb133111eb);
      x = x ^ (x >>> 31);
      result.push(x);
    }
    return result as [number, number, number, number];
  }

  nextU32(): number {
    const [s0, s1, s2, s3] = this.state;

    // Output scrambling (Vigna xoshiro256** output function):
    //   result = rotl(s1 * 5, 7) * 9
    const result = Math.imul(this.rotl(Math.imul(s1, 5), 7), 9);

    // State update (Vigna reference, Blackman & Vigna 2018, ACM TOMS):
    //   const uint64_t t = s[1] << 17;
    //   s[2] ^= s[0];
    //   s[3] ^= s[1];
    //   s[1] ^= s[2];
    //   s[0] ^= s[3];
    //   s[2] ^= t;
    //   s[3] = rotl(s[3], 45);
    const t = s1 << 17;

    // In-place order matters — each step uses the result of the previous.
    const ns2 = (s2 ^ s0) >>> 0;          // s[2] ^= s[0]
    const ns3 = (s3 ^ s1) >>> 0;          // s[3] ^= s[1]   (uses original s1)
    const ns1 = (s1 ^ ns2) >>> 0;         // s[1] ^= s[2]   (uses new s2)
    const ns0 = (s0 ^ ns3) >>> 0;         // s[0] ^= s[3]   (uses new s3)
    const finalS2 = (ns2 ^ t) >>> 0;     // s[2] ^= t      (uses new s2 ^ t)
    const finalS3 = this.rotl(ns3, 45);   // s[3] = rotl(s[3], 45)

    this.state = [ns0, ns1, finalS2, finalS3];
    return result >>> 0;  // unsigned
  }

  /** 32-bit left-rotation: (x << k) | (x >>> (32 - k)) */
  private rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  nextFloat(): number {
    return this.nextU32() / 0x100000000;
  }

  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  nextChoice<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('nextChoice: array must not be empty');
    }
    const idx = Math.floor(this.nextFloat() * arr.length);
    // noUncheckedIndexedAccess — guard against undefined.
    const v = arr[idx];
    if (v === undefined) {
      throw new Error(`nextChoice: index ${idx} out of range [0, ${arr.length})`);
    }
    return v;
  }

  nextBool(probability = 0.5): boolean {
    return this.nextFloat() < probability;
  }

  childSeed(): number {
    return this.nextU32();
  }

  child(): Xoshiro256 {
    return new Xoshiro256(this.childSeed());
  }

  /**
   * R-29: снимок внутреннего состояния (4×uint32) — копия, не ссылка.
   * Используется для ленивой материализации залежей: состояние снимается
   * ДО прогона генерации, сохраняется в сейве (depositRngState), и позже
   * `Xoshiro256.fromState()` воспроизводит тот же поток бит-в-бит.
   */
  snapshotState(): [number, number, number, number] {
    return [this.state[0], this.state[1], this.state[2], this.state[3]];
  }

  /**
   * R-29: восстановление генератора из снимка состояния (мимо SplitMix64).
   * Единственное требование xoshiro256** — состояние не все нули; вход
   * валидируется (null/undefined/не-числа → 0), все-нулёвое состояние
   * заменяется на безопасное (как в derive()).
   */
  static fromState(state: readonly unknown[] | null | undefined): Xoshiro256 {
    const words = [0, 1, 2, 3].map((i) => {
      const w = state?.[i];
      return typeof w === 'number' && Number.isFinite(w) ? w | 0 : 0;
    }) as [number, number, number, number];
    if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0) {
      words[0] = 1;
    }
    const rng = Object.create(Xoshiro256.prototype) as Xoshiro256;
    (rng as unknown as { state: [number, number, number, number] }).state = words;
    return rng;
  }

  /**
   * P1-29: Именованный под-seed.
   * hash(main_seed, name) — воспроизводимый дочерний генератор
   * с уникальным именем. Изменение в одном под-seed'е
   * не влияет на другие.
   *
   * G-24 fix v2: Вычисляем 4 НЕЗАВИСИМЫХ хеша имени (разные offset basis
   * и prime), XOR с 4 словами состояния, и используем РЕЗУЛЬТАТ напрямую
   * как начальное состояние xoshiro256** (без коллапса через SplitMix64).
   * xoshiro256** требует только, чтобы состояние не было всеми нулями.
   *
   * 4 хеша:
   *   h0: FNV-1a (offset 0x811c9dc5, prime 0x01000193)
   *   h1: FNV-1a variant (offset 0x6a09e667, prime 0x5bd1e995 — Murmur2)
   *   h2: FNV-1a variant (offset 0xbb67ae85, prime 0xcc9e2d51 — Murmur3 c1)
   *   h3: FNV-1a variant (offset 0x3c6ef372, prime 0x1b873593 — Murmur3 c2)
   */
  derive(name: string): Xoshiro256 {
    // 4 независимых хеша имени — разные offset/prime для diversity
    let h0 = 0x811c9dc5 >>> 0; // FNV-1a offset
    let h1 = 0x6a09e667 >>> 0; // SHA-256 init (arbitrary different offset)
    let h2 = 0xbb67ae85 >>> 0; // SHA-256 init
    let h3 = 0x3c6ef372 >>> 0; // SHA-256 init
    for (let i = 0; i < name.length; i++) {
      const c = name.charCodeAt(i);
      // h0: standard FNV-1a
      h0 ^= c;
      h0 = Math.imul(h0, 0x01000193) >>> 0;
      // h1: Murmur2-style mixing
      h1 ^= c;
      h1 = Math.imul(h1, 0x5bd1e995) >>> 0;
      h1 ^= h1 >>> 15;
      // h2: Murmur3 c1-style mixing
      h2 ^= c;
      h2 = Math.imul(h2, 0xcc9e2d51) >>> 0;
      h2 ^= h2 >>> 17;
      // h3: Murmur3 c2-style mixing
      h3 ^= c;
      h3 = Math.imul(h3, 0x1b873593) >>> 0;
      h3 ^= h3 >>> 13;
    }

    // XOR с основным состоянием — включает seed в результат
    const s0 = (this.state[0] ^ h0) >>> 0;
    const s1 = (this.state[1] ^ h1) >>> 0;
    const s2 = (this.state[2] ^ h2) >>> 0;
    const s3 = (this.state[3] ^ h3) >>> 0;

    // Гарантируем, что состояние не все нули (единственное требование xoshiro256**)
    const state: [number, number, number, number] = [
      s0 === 0 && s1 === 0 && s2 === 0 && s3 === 0 ? 1 : s0,
      s1,
      s2,
      s3,
    ];

    const child = Object.create(Xoshiro256.prototype) as Xoshiro256;
    (child as unknown as { state: [number, number, number, number] }).state = state;
    return child;
  }

  weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) {
      throw new Error('weightedChoice: items array must not be empty');
    }
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      const w = weights[i];
      if (w !== undefined) r -= w;
      // Guard against the (rare) case where r <= 0 after subtracting weight i.
      if (r <= 0) {
        const v = items[i];
        if (v !== undefined) return v;
      }
    }
    // Fallback to last item — guarded against undefined (length checked above).
    const last = items[items.length - 1];
    if (last === undefined) {
      throw new Error('weightedChoice: last item undefined (empty array?)');
    }
    return last;
  }

  /** Gauss distribution (Box-Muller) */
  nextGaussian(mean = 0, stddev = 1): number {
    const u1 = this.nextFloat();
    const u2 = this.nextFloat();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }
}
