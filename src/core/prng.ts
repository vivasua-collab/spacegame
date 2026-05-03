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
    const result = Math.imul(s1, 5);
    const rot = (result << 7) | (result >>> 25);
    const t = Math.imul(s1, 9);

    this.state = [
      s0 ^ s3 ^ t,
      s0 ^ t,
      s2 ^ s0,
      s3 ^ s2,
    ];
    return (rot * 9) >>> 0;
  }

  nextFloat(): number {
    return this.nextU32() / 0x100000000;
  }

  nextInt(min: number, max: number): number {
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  nextChoice<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.nextFloat() * arr.length)];
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
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Gauss distribution (Box-Muller) */
  nextGaussian(mean = 0, stddev = 1): number {
    const u1 = this.nextFloat();
    const u2 = this.nextFloat();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }
}
