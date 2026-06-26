/**
 * PRNG Quality Test — Verify Xoshiro256 derive() produces independent, well-distributed seeds.
 * Run: cd /home/z/my-project && bun run scripts/prng-test.ts
 */

import { Xoshiro256 } from '@/core/prng';

const N = 1000;

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║            PRNG QUALITY TEST — Xoshiro256 derive()             ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log();

// ─── Test 1: Uniformity of derived PRNGs ───
console.log('═══════════════════════════════════════════════════════════════');
console.log('  TEST 1: Uniformity — First nextFloat() of 1000 derived PRNGs');
console.log('═══════════════════════════════════════════════════════════════');

const mainRng = new Xoshiro256(42);
const firstFloats: number[] = [];

for (let i = 0; i < N; i++) {
  const derived = mainRng.derive(`system_${i}`);
  firstFloats.push(derived.nextFloat());
}

// Bin into 10 buckets [0.0, 0.1), [0.1, 0.2), ..., [0.9, 1.0)
const BINS = 10;
const bins = new Array(BINS).fill(0);
for (const f of firstFloats) {
  const bin = Math.min(BINS - 1, Math.floor(f * BINS));
  bins[bin]++;
}

const expectedPerBin = N / BINS;
console.log(`\n  Expected per bin: ${expectedPerBin} (uniform)\n`);
console.log('  Bin       Count   Bar');
console.log('  ' + '-'.repeat(60));

let chiSquared = 0;
for (let i = 0; i < BINS; i++) {
  const pct = bins[i] / N;
  const bar = '█'.repeat(Math.round(pct * 50));
  console.log(`  [${(i/10).toFixed(1)}..${((i+1)/10).toFixed(1)})  ${String(bins[i]).padStart(5)}   ${bar}`);
  chiSquared += (bins[i] - expectedPerBin) ** 2 / expectedPerBin;
}

// Chi-squared critical value for 9 df at 0.05 = 16.919
const chiCritical = 16.919;
console.log(`\n  Chi-squared = ${chiSquared.toFixed(2)} (critical at 0.05 for 9df = ${chiCritical})`);
console.log(`  Uniformity: ${chiSquared < chiCritical ? '✅ PASS' : '❌ FAIL — distribution is not uniform'}`);

// ─── Test 2: Independence of consecutive seeds ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  TEST 2: Independence — Correlation between consecutive seeds');
console.log('═══════════════════════════════════════════════════════════════');

// Compute Pearson correlation between consecutive firstFloats
const n = firstFloats.length - 1;
let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
for (let i = 0; i < n; i++) {
  const x = firstFloats[i];
  const y = firstFloats[i + 1];
  sumX += x;
  sumY += y;
  sumXY += x * y;
  sumX2 += x * x;
  sumY2 += y * y;
}

const meanX = sumX / n;
const meanY = sumY / n;
const correlation = (sumXY - n * meanX * meanY) /
  Math.sqrt((sumX2 - n * meanX * meanX) * (sumY2 - n * meanY * meanY));

console.log(`\n  Pearson correlation (lag-1): ${correlation.toFixed(6)}`);
console.log(`  Expected for independent: ~0.0 (|r| < 0.062 at 0.05 significance for N=999)`);
const rCritical = 1.96 / Math.sqrt(n);
console.log(`  Critical |r| at 0.05: ${rCritical.toFixed(4)}`);
console.log(`  Independence: ${Math.abs(correlation) < rCritical ? '✅ PASS' : '❌ FAIL — consecutive outputs are correlated'}`);

// ─── Test 3: Seed distance analysis ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  TEST 3: Seed Distance — Do nearby names produce similar seeds?');
console.log('═══════════════════════════════════════════════════════════════');

const mainRng2 = new Xoshiro256(42);
const seeds: number[] = [];
for (let i = 0; i < N; i++) {
  const derived = mainRng2.derive(`system_${i}`);
  // We can't directly access the seed, but we can check the first output
  seeds.push(derived.nextU32());
}

// Check minimum Hamming distance between consecutive seeds' first outputs
let minBitDiff = 32;
let maxBitDiff = 0;
let totalBitDiff = 0;
for (let i = 0; i < N - 1; i++) {
  const xor = seeds[i] ^ seeds[i + 1];
  const bitDiff = popcount(xor);
  minBitDiff = Math.min(minBitDiff, bitDiff);
  maxBitDiff = Math.max(maxBitDiff, bitDiff);
  totalBitDiff += bitDiff;
}
const avgBitDiff = totalBitDiff / (N - 1);

console.log(`\n  Bit difference between consecutive first outputs (U32):`);
console.log(`  Min: ${minBitDiff} bits, Max: ${maxBitDiff} bits, Avg: ${avgBitDiff.toFixed(1)} bits`);
console.log(`  Expected for independent U32: ~16 bits (half of 32)`);
console.log(`  Bit independence: ${minBitDiff >= 5 ? '✅ PASS' : '❌ FAIL — seeds are too similar (min=' + minBitDiff + ' bits difference)'}`);

// ─── Test 4: Full-period uniqueness ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  TEST 4: Uniqueness — Do 1000 derived PRNGs produce unique first outputs?');
console.log('═══════════════════════════════════════════════════════════════');

const uniqueOutputs = new Set(seeds);
console.log(`\n  Unique first U32 outputs: ${uniqueOutputs.size} / ${N}`);
console.log(`  Uniqueness: ${uniqueOutputs.size === N ? '✅ PASS' : '❌ FAIL — ' + (N - uniqueOutputs.size) + ' collisions'}`);

// ─── Test 5: Different name patterns ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  TEST 5: Name Pattern Independence — Similar names = independent?');
console.log('═══════════════════════════════════════════════════════════════');

const mainRng3 = new Xoshiro256(42);
const nameOutputs = new Map<string, number>();
const names = ['planet_0', 'planet_1', 'planet_00', 'planet_01', 'planet_10',
               'system_0', 'system_1', 'star_0', 'hex_0', 'deposits_0'];
for (const name of names) {
  const derived = mainRng3.derive(name);
  nameOutputs.set(name, derived.nextU32());
}

console.log('\n  Name → first U32 output:');
let namePairsOk = true;
const nameEntries = [...nameOutputs.entries()];
for (let i = 0; i < nameEntries.length; i++) {
  for (let j = i + 1; j < nameEntries.length; j++) {
    const [name1, val1] = nameEntries[i];
    const [name2, val2] = nameEntries[j];
    if (val1 === val2) {
      console.log(`  ❌ COLLISION: ${name1} and ${name2} produce same output!`);
      namePairsOk = false;
    }
  }
  console.log(`  ${nameEntries[i][0].padEnd(15)} → ${nameEntries[i][1] >>> 0}`);
}
console.log(`\n  Name independence: ${namePairsOk ? '✅ PASS' : '❌ FAIL — name collisions detected'}`);

// ─── Test 6: Kolmogorov-Smirnov test ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  TEST 6: K-S Test — Uniformity of derived PRNG outputs');
console.log('═══════════════════════════════════════════════════════════════');

// Collect more samples: first 10 floats from each of 100 derived PRNGs
const mainRng4 = new Xoshiro256(42);
const allFloats: number[] = [];
for (let i = 0; i < 100; i++) {
  const derived = mainRng4.derive(`system_${i}`);
  for (let j = 0; j < 10; j++) {
    allFloats.push(derived.nextFloat());
  }
}

// Sort for K-S test
allFloats.sort((a, b) => a - b);
const sampleSize = allFloats.length;

// K-S statistic: max|F_empirical(x) - F_uniform(x)|
let ksStat = 0;
for (let i = 0; i < sampleSize; i++) {
  const empirical = (i + 1) / sampleSize;
  const uniform = allFloats[i];
  const diff = Math.abs(empirical - uniform);
  ksStat = Math.max(ksStat, diff);
}

// Critical value at 0.05 for K-S test: 1.36 / sqrt(N)
const ksCritical = 1.36 / Math.sqrt(sampleSize);
console.log(`\n  Sample size: ${sampleSize}`);
console.log(`  K-S statistic D: ${ksStat.toFixed(6)}`);
console.log(`  Critical value (0.05): ${ksCritical.toFixed(6)}`);
console.log(`  K-S test: ${ksStat < ksCritical ? '✅ PASS — distribution is uniform' : '❌ FAIL — distribution is not uniform'}`);

// ─── Summary ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
const results = [
  { test: 'Uniformity (Chi-squared)', pass: chiSquared < chiCritical },
  { test: 'Independence (lag-1 correlation)', pass: Math.abs(correlation) < rCritical },
  { test: 'Bit distance (min >= 5)', pass: minBitDiff >= 5 },
  { test: 'Uniqueness (no collisions)', pass: uniqueOutputs.size === N },
  { test: 'Name pattern independence', pass: namePairsOk },
  { test: 'K-S uniformity', pass: ksStat < ksCritical },
];

let allPass = true;
for (const r of results) {
  console.log(`  ${r.pass ? '✅' : '❌'} ${r.test}`);
  if (!r.pass) allPass = false;
}
console.log(`\n  Overall: ${allPass ? '✅ ALL TESTS PASSED — derive() produces independent, well-distributed seeds' : '❌ SOME TESTS FAILED — derive() has quality issues'}`);

// ─── Helper: Population count ───
function popcount(x: number): number {
  x = x >>> 0;
  let count = 0;
  while (x) {
    count += x & 1;
    x >>>= 1;
  }
  return count;
}
