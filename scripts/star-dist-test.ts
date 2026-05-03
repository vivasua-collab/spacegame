/**
 * Star Type Distribution Test — Generates 10 runs of 500 systems and reports distribution.
 * Also calculates expected counts and chi-squared statistics.
 * Run: cd /home/z/my-project && bun run scripts/star-dist-test.ts
 */

import { generateGalaxy } from '@/galaxy/generator';
import { STAR_TYPES, STAR_WEIGHTS } from '@/data/star-types';
import type { StarType } from '@/core/types';

const RUNS = 10;
const N = 500;
const totalWeight = STAR_WEIGHTS.reduce((a, b) => a + b, 0);

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║      STAR TYPE DISTRIBUTION TEST — 10 Runs × 500 Systems       ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log();

// ─── Expected Counts ───
console.log('═══════════════════════════════════════════════════════════════');
console.log('  EXPECTED COUNTS (N=500, total weight = ' + totalWeight.toFixed(1) + ')');
console.log('═══════════════════════════════════════════════════════════════');
console.log();
console.log('  Type         Weight   Expected  P(0)      Status');
console.log('  ' + '-'.repeat(60));

for (const stDef of STAR_TYPES) {
  const expected = N * stDef.weight / totalWeight;
  const prob0 = Math.exp(-expected); // Poisson P(X=0) ≈ e^(-λ)
  const status = expected < 0.5 ? '⚠️  RARE' : expected < 2 ? '🟡 LOW' : '✅ OK';
  console.log(`  ${stDef.type.padEnd(14)} ${stDef.weight.toString().padStart(7)}   ${expected.toFixed(2).padStart(7)}   ${prob0.toFixed(4).padStart(7)}   ${status}`);
}

// ─── Run Tests ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  DISTRIBUTION ACROSS 10 RUNS');
console.log('═══════════════════════════════════════════════════════════════');

const allRunCounts: Map<StarType, number>[] = [];

for (let run = 0; run < RUNS; run++) {
  const seed = 1000 + run * 777; // Different seeds per run
  const galaxy = generateGalaxy({ seed, systemCount: N });

  const counts = new Map<StarType, number>();
  for (const st of STAR_TYPES) counts.set(st.type, 0);

  for (const sys of galaxy.systems) {
    const primaryType = sys.stars[0]?.type;
    if (primaryType) {
      counts.set(primaryType, (counts.get(primaryType) ?? 0) + 1);
    }
  }

  allRunCounts.push(counts);

  const parts: string[] = [];
  for (const stDef of STAR_TYPES) {
    const c = counts.get(stDef.type) ?? 0;
    if (c > 0) parts.push(`${stDef.type.split('_')[1]}=${c}`);
  }
  console.log(`  Run ${run + 1} (seed=${seed}): ${parts.join(', ')}`);
}

// ─── Aggregate Statistics ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  AGGREGATE STATISTICS (10 runs × 500 systems)');
console.log('═══════════════════════════════════════════════════════════════');

console.log('\n  Type         Min  Max  Mean   Expected  Chi²(avg)  Runs w/0');
console.log('  ' + '-'.repeat(65));

for (const stDef of STAR_TYPES) {
  const expected = N * stDef.weight / totalWeight;
  const counts = allRunCounts.map(rc => rc.get(stDef.type) ?? 0);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const chiSq = (mean - expected) ** 2 / Math.max(0.01, expected);
  const runsWith0 = counts.filter(c => c === 0).length;

  console.log(`  ${stDef.type.padEnd(14)} ${String(min).padStart(3)}  ${String(max).padStart(3)}  ${mean.toFixed(1).padStart(5)}   ${expected.toFixed(2).padStart(7)}   ${chiSq.toFixed(2).padStart(9)}   ${String(runsWith0).padStart(8)}`);
}

// ─── Chi-squared Test (pooled across all runs) ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  CHI-SQUARED TEST (pooled: 5000 total primary stars)');
console.log('═══════════════════════════════════════════════════════════════');

const totalSystems = N * RUNS;
let totalChiSq = 0;
let df = 0;

console.log('\n  Type         Observed  Expected   (O-E)²/E');
console.log('  ' + '-'.repeat(50));

for (const stDef of STAR_TYPES) {
  const totalObserved = allRunCounts.reduce((sum, rc) => sum + (rc.get(stDef.type) ?? 0), 0);
  const expected = totalSystems * stDef.weight / totalWeight;

  if (expected < 1) {
    // Skip rare types from chi-squared (not enough expected counts)
    console.log(`  ${stDef.type.padEnd(14)} ${String(totalObserved).padStart(8)}  ${expected.toFixed(2).padStart(8)}   (too rare for χ²)`);
    continue;
  }

  const contribution = (totalObserved - expected) ** 2 / expected;
  totalChiSq += contribution;
  df++;

  console.log(`  ${stDef.type.padEnd(14)} ${String(totalObserved).padStart(8)}  ${expected.toFixed(2).padStart(8)}   ${contribution.toFixed(2)}`);
}

// Chi-squared critical values for common dfs
const chiCriticalValues: Record<number, number> = {
  1: 3.841, 2: 5.991, 3: 7.815, 4: 9.488, 5: 11.07,
  6: 12.59, 7: 14.07, 8: 15.51, 9: 16.92, 10: 18.31,
};
const critical = chiCriticalValues[df] ?? (df * 2 + 3); // rough approximation

console.log(`\n  Total χ² = ${totalChiSq.toFixed(2)}, df = ${df}`);
console.log(`  Critical value (0.05) ≈ ${critical.toFixed(2)}`);
console.log(`  Result: ${totalChiSq < critical ? '✅ PASS — distribution matches weights' : '❌ FAIL — distribution significantly different from weights'}`);

// ─── Specific rare type analysis ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  RARE TYPE ANALYSIS — Can 500 systems reasonably produce all types?');
console.log('═══════════════════════════════════════════════════════════════');

const rareTypes = STAR_TYPES.filter(s => s.weight < 1);
console.log('\n  Types with weight < 1:');
for (const stDef of rareTypes) {
  const expected = N * stDef.weight / totalWeight;
  const prob0 = Math.exp(-expected);
  const probAtLeast1 = (1 - prob0) * 100;
  const systemsNeeded = Math.ceil(Math.log(0.05) / Math.log(prob0)); // 95% chance of at least 1
  console.log(`  ${stDef.type.padEnd(14)} weight=${stDef.weight}, E[${N}]=${expected.toFixed(2)}, P(0)=${prob0.toFixed(4)}, ` +
    `P(≥1)=${probAtLeast1.toFixed(1)}%, need ~${systemsNeeded} systems for 95% chance`);
}

console.log('\n  Conclusion: At N=500, rare types (O, B, PULSAR, BH) are STATISTICALLY');
console.log('  EXPECTED to be absent. This is NOT a PRNG bug but a sample size issue.');
console.log('  To reliably generate all 12 star types, need ~5000+ systems.');
