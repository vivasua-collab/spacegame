/**
 * Galaxy Generator Audit Script
 * ==============================
 * Verifies star type distribution, planet diversity, sizes, and gravity ranges.
 * Run: cd /home/z/my-project && bun run scripts/audit-generator.ts
 */

import { generateGalaxy } from '@/galaxy/generator';
import { STAR_TYPES, STAR_WEIGHTS } from '@/data/star-types';
import { PLANET_TYPES, SIZE_HEX_COUNT } from '@/data/planet-types';
import type { StarType, PlanetType, PlanetSize, Galaxy, StarSystem, Planet } from '@/core/types';

// ─── Configuration ───
const SEED = 42;
const SYSTEM_COUNT = 500;

// ─── Run Generator ───
console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║         GALAXY GENERATOR AUDIT — Seed 42, 500 Systems          ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log();

const galaxy: Galaxy = generateGalaxy({ seed: SEED, systemCount: SYSTEM_COUNT });
console.log(`Generated ${galaxy.systems.length} systems\n`);

// ─── 1. Star Type Distribution ───
console.log('═══════════════════════════════════════════════════════════════');
console.log('  1. STAR TYPE DISTRIBUTION vs STAR_WEIGHTS');
console.log('═══════════════════════════════════════════════════════════════');

const totalWeight = STAR_WEIGHTS.reduce((a, b) => a + b, 0);
const starCounts = new Map<StarType, number>();
for (const st of STAR_TYPES) starCounts.set(st.type, 0);

// Count primary stars only (stars[0]) for distribution check
for (const sys of galaxy.systems) {
  const primaryType = sys.stars[0]?.type;
  if (primaryType) {
    starCounts.set(primaryType, (starCounts.get(primaryType) ?? 0) + 1);
  }
}

// Also count all stars
const allStarCounts = new Map<StarType, number>();
for (const st of STAR_TYPES) allStarCounts.set(st.type, 0);
for (const sys of galaxy.systems) {
  for (const star of sys.stars) {
    allStarCounts.set(star.type, (allStarCounts.get(star.type) ?? 0) + 1);
  }
}

const totalPrimaryStars = galaxy.systems.length;
const totalAllStars = galaxy.systems.reduce((s, sys) => s + sys.stars.length, 0);

console.log(`\nPrimary star distribution (${totalPrimaryStars} primary stars):\n`);
printf('  %-20s  %5s  %7s  %7s  %7s  %s\n',
  'Star Type', 'Count', 'Actual%', 'Expect%', 'Delta%', 'Status');
console.log('  ' + '-'.repeat(75));

let starIssues = 0;
const missingStarTypes: StarType[] = [];

for (const stDef of STAR_TYPES) {
  const count = starCounts.get(stDef.type) ?? 0;
  const actualPct = (count / totalPrimaryStars) * 100;
  const expectedPct = (stDef.weight / totalWeight) * 100;
  const delta = actualPct - expectedPct;
  const status = count === 0 ? '❌ MISSING' : Math.abs(delta) > expectedPct * 0.5 ? '⚠️  OFF' : '✅ OK';

  if (count === 0) {
    missingStarTypes.push(stDef.type);
    starIssues++;
  }
  if (Math.abs(delta) > expectedPct * 0.5 && count > 0) starIssues++;

  printf('  %-20s  %5d  %6.2f%%  %6.2f%%  %+6.2f%%  %s\n',
    stDef.type, count, actualPct, expectedPct, delta, status);
}

console.log(`\n  All stars (including companions): ${totalAllStars} total`);
for (const stDef of STAR_TYPES) {
  const count = allStarCounts.get(stDef.type) ?? 0;
  if (count > 0) {
    console.log(`    ${stDef.type}: ${count}`);
  }
}

if (missingStarTypes.length > 0) {
  console.log(`\n  ⚠️  Missing star types in primary stars: ${missingStarTypes.join(', ')}`);
}

// ─── 2. Planet Type Diversity per Star Type ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  2. PLANET TYPE DIVERSITY PER STAR TYPE');
console.log('═══════════════════════════════════════════════════════════════');

// Group planets by primary star type
const planetsByStarType = new Map<StarType, Planet[]>();
for (const st of STAR_TYPES) planetsByStarType.set(st.type, []);

for (const sys of galaxy.systems) {
  const primaryType = sys.stars[0]?.type;
  if (primaryType) {
    const list = planetsByStarType.get(primaryType) ?? [];
    list.push(...sys.planets);
    planetsByStarType.set(primaryType, list);
  }
}

let lowDiversityIssues = 0;
const samePlanetTypeIssues: { starType: StarType; planetTypes: Set<string>; count: number }[] = [];

for (const stDef of STAR_TYPES) {
  const planets = planetsByStarType.get(stDef.type) ?? [];
  if (planets.length === 0) {
    console.log(`\n  ${stDef.type}: 0 planets (minPlanets=${stDef.minPlanets}, maxPlanets=${stDef.maxPlanets})`);
    continue;
  }

  const typeSet = new Map<PlanetType, number>();
  for (const p of planets) {
    typeSet.set(p.type, (typeSet.get(p.type) ?? 0) + 1);
  }

  const uniqueTypes = typeSet.size;
  const totalPlanetTypes = PLANET_TYPES.length;
  const diversityStatus = uniqueTypes === 1 ? '❌ NO VARIETY' :
    uniqueTypes <= 2 ? '⚠️  LOW' :
    uniqueTypes <= 4 ? '🟡 MODERATE' : '✅ GOOD';

  if (uniqueTypes <= 2 && planets.length >= 5) {
    lowDiversityIssues++;
    samePlanetTypeIssues.push({ starType: stDef.type, planetTypes: new Set(typeSet.keys()), count: planets.length });
  }

  console.log(`\n  ${stDef.type}: ${planets.length} planets, ${uniqueTypes}/${totalPlanetTypes} types ${diversityStatus}`);
  const sorted = [...typeSet.entries()].sort((a, b) => b[1] - a[1]);
  for (const [pt, cnt] of sorted) {
    const bar = '█'.repeat(Math.round((cnt / planets.length) * 30));
    console.log(`    ${pt.padEnd(12)} ${String(cnt).padStart(4)} (${((cnt / planets.length) * 100).toFixed(1).padStart(5)}%) ${bar}`);
  }
}

// ─── 3. Per-System Planet Type Diversity ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  3. PER-SYSTEM PLANET TYPE DIVERSITY (Do same stars = same planets?)');
console.log('═══════════════════════════════════════════════════════════════');

// For each star type with enough systems, check if individual systems
// all have the same planet type composition
for (const stDef of STAR_TYPES) {
  const systemsWithStar = galaxy.systems.filter(sys => sys.stars[0]?.type === stDef.type && sys.planets.length > 0);
  if (systemsWithStar.length < 3) continue;

  // For each system, collect set of planet types
  const systemPlanetSets = systemsWithStar.map(sys => {
    const types = new Set(sys.planets.map(p => p.type));
    return { name: sys.name, types, planetCount: sys.planets.length, typeList: [...types].sort().join(',') };
  });

  // Check if all systems with this star type have the same planet type set
  const uniqueSets = new Set(systemPlanetSets.map(s => s.typeList));
  const isUniform = uniqueSets.size === 1;

  if (isUniform && systemsWithStar.length >= 5) {
    console.log(`\n  ❌ ${stDef.type}: ALL ${systemsWithStar.length} systems have IDENTICAL planet type set: "${systemPlanetSets[0].typeList}"`);
    // Show a few examples
    for (const s of systemPlanetSets.slice(0, 3)) {
      console.log(`     ${s.name}: ${s.planetCount} planets → ${s.typeList}`);
    }
  } else if (uniqueSets.size <= 3 && systemsWithStar.length >= 5) {
    console.log(`\n  ⚠️  ${stDef.type}: Only ${uniqueSets.size} distinct planet type combinations across ${systemsWithStar.length} systems:`);
    for (const set of uniqueSets) {
      const count = systemPlanetSets.filter(s => s.typeList === set).length;
      console.log(`     "${set}" — ${count} systems`);
    }
  } else {
    console.log(`\n  ✅ ${stDef.type}: ${uniqueSets.size} distinct planet type combinations across ${systemsWithStar.length} systems`);
  }
}

// ─── 4. Planet Size Distribution ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  4. PLANET SIZE DISTRIBUTION');
console.log('═══════════════════════════════════════════════════════════════');

const allPlanets: Planet[] = [];
for (const sys of galaxy.systems) {
  allPlanets.push(...sys.planets);
}

const sizeCounts = new Map<PlanetSize, number>();
const sizes: PlanetSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];
for (const s of sizes) sizeCounts.set(s, 0);
for (const p of allPlanets) {
  sizeCounts.set(p.size, (sizeCounts.get(p.size) ?? 0) + 1);
}

console.log(`\n  Total planets: ${allPlanets.length}`);
console.log();
const missingSizes: PlanetSize[] = [];
for (const s of sizes) {
  const count = sizeCounts.get(s) ?? 0;
  const pct = allPlanets.length > 0 ? (count / allPlanets.length) * 100 : 0;
  const bar = '█'.repeat(Math.round(pct));
  const status = count === 0 ? ' ❌ MISSING' : '';
  if (count === 0) missingSizes.push(s);
  console.log(`  ${s.padEnd(8)} ${String(count).padStart(5)} (${pct.toFixed(1).padStart(5)}%) ${bar}${status}`);
}

// Size distribution per planet type
console.log('\n  Size distribution per planet type:');
for (const ptDef of PLANET_TYPES) {
  const planets = allPlanets.filter(p => p.type === ptDef.type);
  if (planets.length === 0) continue;
  const sizeDist = new Map<PlanetSize, number>();
  for (const s of sizes) sizeDist.set(s, 0);
  for (const p of planets) sizeDist.set(p.size, (sizeDist.get(p.size) ?? 0) + 1);
  const parts: string[] = [];
  for (const s of sizes) {
    const c = sizeDist.get(s) ?? 0;
    if (c > 0) parts.push(`${s}=${c}`);
  }
  console.log(`  ${ptDef.type.padEnd(12)} (${planets.length} planets): ${parts.join(', ')}`);
}

// ─── 5. Gravity Ranges per Planet Type ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  5. PLANET GRAVITY RANGES PER TYPE (documented vs actual)');
console.log('═══════════════════════════════════════════════════════════════');

// Documented gravity ranges from planet-types.ts (baseGravity with ±20% variation)
console.log('\n  Gravity formula: baseGravity × (0.8..1.2)\n');

for (const ptDef of PLANET_TYPES) {
  const planets = allPlanets.filter(p => p.type === ptDef.type);
  if (planets.length === 0) {
    console.log(`  ${ptDef.type}: 0 planets — no data`);
    continue;
  }

  const gravities = planets.map(p => p.gravity);
  const minG = Math.min(...gravities);
  const maxG = Math.max(...gravities);
  const avgG = gravities.reduce((a, b) => a + b, 0) / gravities.length;
  const docMin = ptDef.baseGravity * 0.8;
  const docMax = ptDef.baseGravity * 1.2;

  const inRange = gravities.every(g => g >= docMin * 0.95 && g <= docMax * 1.05); // 5% tolerance
  const status = inRange ? '✅' : '⚠️';

  console.log(`  ${ptDef.type.padEnd(12)} doc: [${docMin.toFixed(2)}..${docMax.toFixed(2)}]g  actual: [${minG.toFixed(2)}..${maxG.toFixed(2)}]g  avg: ${avgG.toFixed(2)}g  ${status}`);
}

// ─── 6. Temperature Range Check ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  6. PLANET TEMPERATURE RANGES PER TYPE (documented vs actual)');
console.log('═══════════════════════════════════════════════════════════════');

for (const ptDef of PLANET_TYPES) {
  const planets = allPlanets.filter(p => p.type === ptDef.type);
  if (planets.length === 0) {
    console.log(`  ${ptDef.type}: 0 planets — no data`);
    continue;
  }

  const temps = planets.map(p => p.temperature);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const avgT = temps.reduce((a, b) => a + b, 0) / temps.length;
  const [docMin, docMax] = ptDef.temperatureRange;

  // Temperatures can be way outside doc range due to physics model (luminosity + greenhouse)
  // Just report, don't flag as error
  const outOfRange = temps.filter(t => t < docMin || t > docMax).length;
  const pct = ((outOfRange / temps.length) * 100).toFixed(1);
  const flag = outOfRange > temps.length * 0.5 ? '⚠️ MOST OUT OF RANGE' :
    outOfRange > 0 ? '🟡 some out of range' : '✅';

  console.log(`  ${ptDef.type.padEnd(12)} doc: [${docMin}..${docMax}]°C  actual: [${minT.toFixed(0)}..${maxT.toFixed(0)}]°C  avg: ${avgT.toFixed(0)}°C  out-of-range: ${outOfRange}/${temps.length} (${pct}%)  ${flag}`);
}

// ─── 7. Summary ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  7. SUMMARY OF ISSUES');
console.log('═══════════════════════════════════════════════════════════════');

const issues: string[] = [];

if (missingStarTypes.length > 0) {
  issues.push(`❌ CRITICAL: Star types not generated: ${missingStarTypes.join(', ')} — with 500 systems, all 12 types should appear`);
}

if (missingSizes.length > 0) {
  issues.push(`❌ CRITICAL: Planet sizes missing: ${missingSizes.join(', ')} — no variety in size`);
}

if (lowDiversityIssues > 0) {
  issues.push(`❌ CRITICAL: ${lowDiversityIssues} star type(s) have very low planet diversity (≤2 types with ≥5 planets)`);
  for (const item of samePlanetTypeIssues) {
    issues.push(`   → ${item.starType}: ${item.count} planets, only types: ${[...item.planetTypes].join(', ')}`);
  }
}

// Check if selectPlanetType is deterministic per orbit/star combo
console.log('\n  Checking planet type determinism (same star + same orbit → same planet type?):');

let determinismIssues = 0;
for (const stDef of STAR_TYPES) {
  const systemsWithStar = galaxy.systems.filter(sys => sys.stars[0]?.type === stDef.type);
  if (systemsWithStar.length < 3) continue;

  // Group by orbit number
  const byOrbit = new Map<number, PlanetType[]>();
  for (const sys of systemsWithStar) {
    for (const p of sys.planets) {
      if (!byOrbit.has(p.orbitNumber)) byOrbit.set(p.orbitNumber, []);
      byOrbit.get(p.orbitNumber)!.push(p.type);
    }
  }

  for (const [orbit, types] of byOrbit) {
    if (types.length < 3) continue;
    const uniqueTypes = new Set(types);
    if (uniqueTypes.size === 1) {
      console.log(`  ❌ ${stDef.type} orbit ${orbit}: always ${types[0]} (${types.length} samples)`);
      determinismIssues++;
    } else if (uniqueTypes.size <= 2 && types.length >= 5) {
      const dist = [...uniqueTypes].map(t => `${t}(${types.filter(x => x === t).length})`).join(', ');
      console.log(`  ⚠️  ${stDef.type} orbit ${orbit}: only ${uniqueTypes.size} types: ${dist}`);
      determinismIssues++;
    }
  }
}

if (determinismIssues > 0) {
  issues.push(`❌ CRITICAL: ${determinismIssues} orbit/star combos always produce the same planet type — selectPlanetType() is too deterministic`);
}

// Check specific concern: selectPlanetType uses estimatedR = 0.3 + orbit * 0.6
// which makes the zone (inner/HZ/outer) solely determined by orbit number and star luminosity
console.log('\n  Analyzing selectPlanetType zone assignment:');
for (const stDef of STAR_TYPES) {
  const L = Math.max(0.001, stDef.luminosity);
  const hzInner = Math.sqrt(L / 1.1);
  const hzOuter = Math.sqrt(L / 0.53);

  const zones: string[] = [];
  for (let orbit = 1; orbit <= 5; orbit++) {
    const estimatedR = 0.3 + orbit * 0.6;
    const zone = estimatedR < hzInner ? 'INNER' : estimatedR <= hzOuter ? 'HZ' : 'OUTER';
    zones.push(`orbit ${orbit} → ${zone} (r=${estimatedR.toFixed(1)}, HZ=[${hzInner.toFixed(1)}..${hzOuter.toFixed(1)}])`);
  }
  console.log(`  ${stDef.type}: ${zones.join(', ')}`);
}

// Final summary
if (issues.length === 0) {
  console.log('\n  ✅ No critical issues found!');
} else {
  console.log(`\n  Found ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.log(`  ${issue}`);
  }
}

// Root cause analysis
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  ROOT CAUSE ANALYSIS');
console.log('═══════════════════════════════════════════════════════════════');

console.log(`
  The selectPlanetType() function in generator.ts determines planet type
  based on the habitable zone (HZ) of the star:

  1. estimatedR = 0.3 + orbit * 0.6  (deterministic for a given orbit number)
  2. HZ inner edge = sqrt(L / 1.1)
  3. HZ outer edge = sqrt(L / 0.53)
  4. If estimatedR < hzInner → INNER zone (volcanic/rocky/dwarf)
  5. If hzInner ≤ estimatedR ≤ hzOuter → HABITABLE zone (rocky/oceanic/desert)
  6. If estimatedR > hzOuter → OUTER zone (gas_giant/ice/oceanic)

  PROBLEM: For a given star type with fixed luminosity, the zone is
  ENTIRELY determined by the orbit number. Since most star types have
  very narrow or very wide HZ, many orbits fall into the same zone,
  giving only 3 planet type choices per zone.

  Additionally:
  - The weightedChoice within each zone only offers 3 planet types
  - For stars with very small HZ (low luminosity like M dwarfs),
    orbits 2+ are all OUTER → only gas_giant/ice/oceanic
  - For stars with very large HZ (high luminosity like O/B),
    all orbits are INNER → only volcanic/rocky/dwarf
  - The actual orbital radius has randomness (0.3 + orbit * (0.5 + rng*0.3))
    but selectPlanetType uses a FIXED estimatedR = 0.3 + orbit * 0.6
    which ignores the actual generated radius!
`);

console.log('  SUGGESTED FIXES:');
console.log('  1. Use the ACTUAL orbital radius in selectPlanetType, not the fixed estimate');
console.log('  2. Add more planet type options per zone (e.g., dwarf in HZ, desert in outer)');
console.log('  3. Add randomness to zone boundaries (fuzzy edges)');
console.log('  4. Consider star-type-specific planet type weights');
console.log('  5. Allow "anomalous" planet types with small probability outside their zone');

// ─── printf polyfill ───
function printf(fmt: string, ...args: (string | number)[]): void {
  let i = 0;
  const result = fmt.replace(/%(-?\d+)?(?:\.(\d+))?([dfs])/g, (_match, widthStr?, _precStr?, spec?: string) => {
    const val = args[i++];
    if (val === undefined) return '';
    const width = widthStr ? parseInt(widthStr) : 0;
    const leftAlign = width < 0;
    const absWidth = Math.abs(width);
    let s: string;
    if (spec === 'd') {
      s = String(Math.floor(Number(val)));
    } else if (spec === 'f') {
      s = String(Number(val));
    } else {
      s = String(val);
    }
    if (absWidth > 0) {
      if (leftAlign) {
        s = s.padEnd(absWidth);
      } else {
        s = s.padStart(absWidth);
      }
    }
    return s;
  });
  process.stdout.write(result);
}
