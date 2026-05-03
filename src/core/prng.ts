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
   * Использует FNV-1a хеш для качественного распределения
   * даже для похожих строк (system_0, system_1, ...).
   * Результат комбинируется со всеми 4 словами состояния
   * через SplitMix64 для гарантии независимости.
   */
  derive(name: string): Xoshiro256 {
    // FNV-1a хеш имени — качественное распределение
    let h1 = 0x811c9dc5 >>> 0; // FNV offset basis (32-bit)
    let h2 = 0x9e3779b9 >>> 0; // Второй хеш для diversity
    for (let i = 0; i < name.length; i++) {
      h1 ^= name.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0; // FNV prime
      h2 ^= name.charCodeAt(i) + i;
      h2 = Math.imul(h2, 0x9e3779b9) >>> 0;
    }
    // Комбинируем ВСЕ 4 слова состояния с хешем имени
    const combined = (this.state[0] ^ h1 ^ (this.state[1] >>> 16)) >>> 0;
    const extra = (this.state[2] ^ h2 ^ (this.state[3] >>> 16)) >>> 0;
    // Двойной SplitMix64 для максимально независимого seed
    let z = (combined + 0x9e3779b97f4a7c15) | 0;
    z = Math.imul(z ^ (z >>> 30), 0xbf58476d1ce4e5b9);
    z = Math.imul(z ^ (z >>> 27), 0x94d049bb133111eb);
    z = z ^ (z >>> 31);
    let w = (extra + 0x9e3779b97f4a7c15) | 0;
    w = Math.imul(w ^ (w >>> 30), 0xbf58476d1ce4e5b9);
    w = Math.imul(w ^ (w >>> 27), 0x94d049bb133111eb);
    w = w ^ (w >>> 31);
    return new Xoshiro256(z ^ w);
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
