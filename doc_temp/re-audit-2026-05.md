# Galaxy Generator Re-Audit Report — 2026-05-03

**Date:** 2026-05-03  
**Auditor:** Re-audit Agent  
**Scope:** Comprehensive re-audit of galaxy generator after G-01 through G-23 fixes  
**Files audited:** `src/core/prng.ts`, `src/galaxy/generator.ts`, `src/data/star-types.ts`, `src/data/planet-types.ts`, `src/core/types.ts`, `scripts/audit-generator.ts`  
**Test scripts created:** `scripts/prng-test.ts`, `scripts/star-dist-test.ts`

---

## Executive Summary

The previous audit identified 23 issues (G-01 through G-23). Many were fixed, and the generator has improved significantly: all 7 planet types now appear, per-system planet diversity is good (14-28 distinct type combinations per star type), and the physics-based temperature/gravity models are in place. However, the re-audit reveals **1 new CRITICAL bug** (PRNG derive() produces collisions), **2 SIGNIFICANT design gaps** (no "large" planet size possible, oceanic planets too rare), and several MINOR issues. The audit script itself contains an outdated false positive.

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| SIGNIFICANT | 2 |
| MINOR | 3 |
| FALSE POSITIVE | 1 |
| BY DESIGN | 2 |

---

## 1. PRNG `derive()` Quality — CRITICAL

**Severity: CRITICAL**  
**New Issue ID: G-24**

### Finding

The `Xoshiro256.derive(name)` method produces severe collisions for sequential names like `system_0` through `system_999`. Test results:

| Test | Result |
|------|--------|
| Uniformity (χ², 10 bins) | ❌ FAIL — χ²=98.98 (critical 16.92) |
| Lag-1 correlation | ✅ PASS — r=-0.0004 |
| Bit distance (min ≥ 5) | ❌ FAIL — min=0 bits |
| Uniqueness (1000 names) | ❌ FAIL — 128/1000 unique (872 collisions!) |
| Name pattern independence | ❌ FAIL — `planet_1` collides with `deposits_0` |
| K-S uniformity (long sequence) | ✅ PASS |

### Root Cause

The `derive()` method combines the FNV-1a hash of the name with the main PRNG state using XOR, then passes through SplitMix64:

```typescript
const combined = (this.state[0] ^ h1 ^ (this.state[1] >>> 16)) >>> 0;
const extra = (this.state[2] ^ h2 ^ (this.state[3] >>> 16)) >>> 0;
// ... double SplitMix64 ...
return new Xoshiro256(z ^ w);
```

**Problem 1: State collapse.** The 4-word (128-bit) PRNG state is reduced to just 2 effective 32-bit values (`state[0] ^ (state[1] >>> 16)` and `state[2] ^ (state[3] >>> 16)`) before combining with the hash. Two different seeds that produce the same collapsed values will generate identical derived PRNGs for ALL names.

**Problem 2: Final XOR.** `z ^ w` is a single 32-bit seed. If two different `(combined, extra)` pairs produce the same `z ^ w`, the PRNGs are identical. This is easily triggered.

**Evidence from star-dist-test.ts:** Seeds 1777 & 2554 produce identical galaxies. Seeds 3331, 4108, & 4885 produce identical galaxies. This confirms state collapse.

**Evidence from star type distribution:** STAR_A (expected ~3 per run, P(0)=5%) is missing from ALL 10 test runs. The probability of this happening with a working PRNG is 0.05^10 ≈ 10^-13. STAR_WD (expected ~2, P(0)=13.5%) is missing from all 10 runs: probability 0.135^10 ≈ 2×10^-9. These impossibilities confirm the PRNG is not producing independent samples.

### Impact

- Some galaxy seeds produce identical or near-identical star type distributions
- STAR_A, STAR_B, STAR_WD are never generated as primary stars with seed 42
- STAR_NS and STAR_RG are overrepresented (bugs in weighted selection due to correlated PRNGs)
- Any code using `derive()` with sequential names is affected

### Recommended Fix

Replace the derive() method with a design that feeds all 4 state words independently into the child seed:

```typescript
derive(name: string): Xoshiro256 {
  // Use each state word as a separate seed, hash name into each
  let s0 = this.state[0], s1 = this.state[1];
  let s2 = this.state[2], s3 = this.state[3];

  // FNV-1a hash of name
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  // Mix hash into each state word independently
  s0 = (s0 + h) | 0;
  s1 = (s1 + Math.imul(h, 0x9e3779b9)) | 0;
  s2 = (s2 + Math.imul(h, 0x85ebca6b)) | 0;
  s3 = (s3 + Math.imul(h, 0xc2b2ae35)) | 0;

  // Run each through SplitMix64 to produce 4 independent state words
  const result: number[] = [];
  for (const s of [s0, s1, s2, s3]) {
    let z = (s + 0x9e3779b97f4a7c15) | 0;
    z = Math.imul(z ^ (z >>> 30), 0xbf58476d1ce4e5b9);
    z = Math.imul(z ^ (z >>> 27), 0x94d049bb133111eb);
    z = z ^ (z >>> 31);
    result.push(z);
  }
  return new Xoshiro256(result[0] ^ result[1] ^ result[2] ^ result[3]);
}
```

Alternatively, use the `child()` method (which correctly advances the main PRNG state) and accept non-reproducible ordering, or use a proven hash-based KDF.

---

## 2. Star Type Distribution — SIGNIFICANT (partially PRNG, partially sample size)

**Severity: SIGNIFICANT**  
**Issues: G-24 (PRNG, see above) + sample size limitation**

### Statistical Analysis

With N=500 and total weight ~100:

| Type | Weight | E[N] | P(0) | Observed (seed 42) | Verdict |
|------|--------|------|------|---------------------|---------|
| STAR_O | 0.003 | 0.015 | 98.5% | 0 | Expected — too rare |
| STAR_B | 0.1 | 0.5 | 60.7% | 0 | PRNG bug (should appear ~40% of runs) |
| STAR_A | 0.6 | 3.0 | 5.0% | 0 | **PRNG bug** (should appear ~95% of runs) |
| STAR_F | 3 | 15 | ~0% | 16 | ✅ |
| STAR_G | 7.5 | 37.5 | ~0% | 39 | ✅ |
| STAR_K | 12 | 60 | ~0% | 53 | 🟡 slightly low |
| STAR_M | 76 | 380 | ~0% | 379 | ✅ |
| STAR_WD | 0.4 | 2.0 | 13.5% | 0 | **PRNG bug** (should appear ~87% of runs) |
| STAR_RG | 0.2 | 1.0 | 36.8% | 5 | Overrepresented (PRNG artifact) |
| STAR_NS | 0.1 | 0.5 | 60.7% | 8 | **Severely overrepresented** (PRNG artifact) |
| STAR_PULSAR | 0.05 | 0.25 | 77.9% | 0 | Expected — too rare |
| STAR_BH | 0.05 | 0.25 | 77.9% | 0 | Expected — too rare |

### Conclusions

1. **STAR_O, STAR_PULSAR, STAR_BH** being absent at N=500 is **statistically expected** (sample size issue, not a bug)
2. **STAR_A** and **STAR_WD** being absent is a **PRNG bug** (G-24)
3. **STAR_NS** being 16× overrepresented is a **PRNG bug** (G-24)
4. Fixing G-24 should resolve the abnormal distribution for mid-rarity types

### Recommendation for rare types

For gameplay, consider one of:
- **Guaranteed minimum:** Ensure at least 1 of each rare type per galaxy (forced placement)
- **Weight boost:** Increase weights for rare types to E[N] ≥ 3 at N=500 (O: 0.6, B: 0.6, PULSAR: 0.6, BH: 0.6)
- **Larger default galaxy:** Use 2000+ systems as default

---

## 3. Planet Size "large" Missing — SIGNIFICANT

**Severity: SIGNIFICANT**  
**New Issue ID: G-25**

### Finding

Zero "large" planets (1.3 ≤ R < 2.0 R⊕, i.e., 8282–12742 km) were generated out of 1419 planets. This is a **design gap**, not a PRNG or code bug.

### Analysis

The `getSizeFromRadius()` function correctly defines "large" as 1.3–2.0 R⊕:

```typescript
if (R < 1.3) return 'medium';
if (R < 2.0) return 'large';
return 'huge';
```

But no non-gas-giant planet type can produce a radius in the "large" range:

| Type | Radius range (km) | R⊕ range | Possible sizes |
|------|-------------------|----------|---------------|
| rocky | 2000–7000 | 0.31–1.10 | tiny–medium |
| volcanic | 2500–8000 | 0.39–1.26 | tiny–medium |
| ice | 1500–6000 | 0.24–0.94 | tiny–small |
| oceanic | 4000–8000 | 0.63–1.26 | small–medium |
| desert | 2000–6500 | 0.31–1.02 | tiny–medium |
| gas_giant | 25000–80000 | 3.93–12.56 | huge (hardcoded) |
| dwarf | 500–2000 | 0.08–0.31 | tiny |

**Maximum non-gas-giant radius:** oceanic at 8000 km = 1.26 R⊕, which is "medium". To reach "large" (1.3 R⊕ = 8282 km), no type's max radius suffices.

### Impact

- Size `large` (91 hex grid) is never generated — buildings that require large planets can never be built
- `ORBIT_SLOTS_BY_SIZE.large = 5` is dead code
- `SIZE_HEX_COUNT.large = 91` is dead code
- The size distribution has a gap between medium (61 hex) and huge (127 hex)

### Recommended Fix

**Option A — Expand existing radius ranges** (minimal change):
- oceanic: max 7000 → 10000 km (allows R up to 1.57 = "large")
- rocky: max 7000 → 9000 km (allows R up to 1.41 = "large")

**Option B — Add a "sub-giant" planet type** (more work, better design):
- New type `sub_giant` with radius 8000–15000 km (1.26–2.35 R⊕)
- Appears between inner zone and HZ for F/G/K stars
- Can have surface hexes (91 for large, 127 for huge)
- Fills the "super-Earth" / "mini-Neptune" gap

**Option C — Remove "large" from PlanetSize** (if not needed for gameplay):
- Simplify to 4 sizes: tiny, small, medium, huge
- Update all downstream code

---

## 4. Temperature Out-of-Range — MINOR (by design)

**Severity: MINOR**  
**Issue IDs: Related to original G-02, G-03 (now fixed)**

### Finding

| Type | Doc Range (°C) | Actual Range (°C) | % Out of Range |
|------|---------------|-------------------|----------------|
| rocky | [-50, 150] | [-207, 1267] | 59% |
| desert | [30, 250] | [-188, 1409] | 90% |
| oceanic | [-10, 60] | [-53, 205] | 50% |
| volcanic | [200, 800] | [64, 2499] | 46% |
| ice | [-230, -30] | [-271, -5] | 25% |
| gas_giant | [-180, 1000] | [-131, 325] | 0% |
| dwarf | [-230, 50] | [-225, 1915] | 1.5% |

### Analysis

The temperature is now calculated from a physics-based model:

```
T_eq = 278.5K × L^0.25 × r^(-0.5)   [equilibrium temperature]
T_final = T_eq + greenhouseK + typeModifierK - 273.15°C
```

For a **STAR_M** (L=0.02) with a **rocky planet at 0.8 AU**:
- T_eq = 278.5 × 0.02^0.25 × 0.8^(-0.5) = 278.5 × 0.376 × 1.118 = 117.2 K = -156°C
- With standard atmosphere (+30–60K greenhouse): -126 to -96°C → **below** rocky's [-50, 150] range
- With CO₂ atmosphere (+100–300K): -56 to +144°C → **can reach** rocky's range

The documented `temperatureRange` in `planet-types.ts` represents **typical** temperatures for that planet type, not hard limits. The physics model legitimately produces temperatures outside these ranges when:
1. Planet is in the "wrong" zone (e.g., rocky planet around M dwarf far from HZ)
2. Greenhouse effect is minimal (thin or no atmosphere)
3. Star luminosity is very low or very high

### Verdict

This is **BY DESIGN**. The physics model should produce out-of-range temperatures — that's what makes it realistic. The `temperatureRange` should be treated as "typical/expected" range, not a constraint.

### Recommendation

- **Relabel** `temperatureRange` to `typicalTemperatureRange` in the documentation
- **Remove** the audit script's out-of-range warning for temperatures
- **Optionally**: Add a `strictTemperatureRange` field if any gameplay mechanic needs hard limits

---

## 5. Gravity Ranges — MINOR (by design)

**Severity: MINOR**  
**Issue ID: Related to original G-04, G-06 (now fixed)**

### Finding

All planet types show gravity outside the documented `baseGravity × (0.8–1.2)` range. The audit script compares against this outdated range.

### Analysis

Gravity is now correctly calculated from the physical formula:
```
g = (radiusKm / 6371) × (density / 5.51)
```

The `baseGravity` field in `PlanetDef` was used by the old code but is now **unused** — gravity is computed from radius and density. The actual gravity ranges are:

| Type | Actual Range (g) | baseGravity × (0.8–1.2) | Reasonable? |
|------|-------------------|------------------------|-------------|
| rocky | 0.29–1.11 | 0.64–0.96 | ✅ wider but reasonable |
| volcanic | 0.34–1.41 | 0.72–1.08 | ✅ |
| ice | 0.12–0.66 | 0.40–0.60 | ✅ |
| oceanic | 0.48–1.13 | 0.80–1.20 | ✅ |
| desert | 0.26–1.00 | 0.56–0.84 | ✅ |
| gas_giant | 0.69–5.53 | 2.00–3.00 | 🟡 wider range (0.69 is low) |
| dwarf | 0.05–0.24 | 0.16–0.24 | ✅ |

### Verdict

This is **BY DESIGN** — the physical calculation is correct and produces reasonable values. The `baseGravity` field is vestigial.

### Recommendation

1. **Remove** `baseGravity` from `PlanetDef` interface and `PLANET_TYPES` data (it's unused dead code)
2. **Update** the audit script to not compare against baseGravity
3. **Fix** gas_giant minimum gravity (0.69g is too low for a gas giant): increase `PLANET_DENSITY.gas_giant.min` from 0.8 to 1.2 (gives min gravity ~0.9g for smallest radius)
4. **Add** a `gravityRange` field to `PlanetDef` if gameplay needs documented ranges

---

## 6. Audit Script Bug — FALSE POSITIVE

**Severity: FALSE POSITIVE**  
**New Issue ID: G-26**

### Finding

The audit script's "Analyzing selectPlanetType zone assignment" section uses `estimatedR = 0.3 + orbit * 0.6` (a fixed estimate) and claims selectPlanetType is "too deterministic" because this fixed estimate means zone is entirely determined by orbit number and star luminosity.

### Verification

The **current** generator.ts code passes the **REAL** orbital radius (with randomness) to `selectPlanetType`:

```typescript
// generator.ts line 354
let orbitalRadius = 0.3 + orbit * (0.5 + rng.nextFloat() * 0.3);
// ...
const planetDef = selectPlanetType(orbitalRadius, primaryStar, rng);
```

The audit script's analysis section at lines 349-355 uses the outdated fixed formula:
```typescript
const estimatedR = 0.3 + orbit * 0.6;  // WRONG — this is not what the code uses
```

### Impact

The audit incorrectly reports that zone assignment is deterministic. In reality, the random orbital radius means:
- Two STAR_M systems with orbit 1 can have different radii (0.8–1.1 AU)
- Some planets at orbit 2 around STAR_G may fall in HZ (1.3–1.4 AU) while others are beyond
- The 10% anomalous planet chance adds further variety

The per-system diversity results in the audit confirm this: 14–28 distinct planet type combinations per star type — far from deterministic.

### Recommendation

- **Update** the audit script's zone analysis to use the real formula `0.3 + orbit * (0.5 + 0.15)` (midpoint estimate) or better, show the range `0.3 + orbit * 0.5` to `0.3 + orbit * 0.8`
- **Remove** the "selectPlanetType is too deterministic" conclusion

---

## 7. Missing Oceanic Planets — SIGNIFICANT

**Severity: SIGNIFICANT**  
**New Issue ID: G-27**

### Finding

Only 16 oceanic planets out of 1419 total (1.1%). Oceanic planets should be common in the habitable zone but are extremely rare.

### Root Cause Analysis

The selectPlanetType function assigns oceanic weight = 25 in the HZ (out of total ~95 = 26.3%). But for the two most common star types (88% of systems), planets rarely fall in the HZ:

**STAR_M (76% of systems):**
- HZ = [0.135, 0.194] AU — extremely narrow
- Snow line = 0.382 AU
- Minimum orbital radius (orbit 1) = 0.8 AU — already beyond snow line
- ALL planets are in the "beyond snow line" zone where oceanic weight = 1–3%
- Expected oceanic rate for M dwarf planets: ~2%

**STAR_K (12% of systems):**
- HZ = [0.52, 0.75] AU
- Snow line = 1.48 AU
- Orbit 1: r = 0.8–1.1 AU → between HZ and snow line → oceanic weight ≈ 2–5%
- Orbit 2+: beyond snow line → oceanic weight ≈ 1–3%
- Expected oceanic rate for K dwarf planets: ~3%

**Combined expected rate:** ~2% for 88% of systems = 1.8%, matching the observed 1.1%.

### The Fundamental Problem

The orbital radius formula `0.3 + orbit * (0.5 + rng*0.3)` starts at 0.8 AU for orbit 1. For M and K dwarfs (HZ at 0.1–0.8 AU), the innermost planet is already outside the HZ. This means **no planet can ever be in the HZ of an M or K dwarf**, making oceanic and other HZ-type planets impossible for 88% of star systems.

### Recommended Fix

**Option A — Scale orbital radii by star luminosity** (best physics):
```typescript
// Habitable-zone-scaled orbital radii
const hzCenter = Math.sqrt(star.luminosity / 0.8);  // center of HZ
const orbitalRadius = hzCenter * (0.3 + orbit * (0.5 + rng.nextFloat() * 0.3));
```
This ensures the first planet is near the HZ center, with subsequent planets spreading outward.

**Option B — Increase oceanic weight in non-HZ zones:**
- "Between HZ and snow line": oceanic weight 5 → 15 (Europa-like subsurface oceans)
- "Beyond snow line": oceanic weight 3 → 8 (icy moons with subsurface oceans)

**Option C — Add "subsurface ocean" variant:**
- Ice planets in the transition zone have a 20% chance of being reclassified as oceanic
- Represents Europa/Enceladus-type worlds

---

## 8. Original G-01 through G-23 Status

| ID | Description | Status |
|----|-------------|--------|
| G-01 | lifeChance doesn't match spec | ✅ FIXED — uses LIFE_LEVEL_WEIGHTS per type |
| G-02 | Greenhouse not coordinated with atmosphere | ✅ FIXED — atmosphere generated BEFORE temperature |
| G-03 | Temperature uses starDef not Star | ✅ FIXED — real Star object passed |
| G-04 | Size ±1 allows out-of-spec radii | ✅ FIXED — uses PLANET_TYPE_RADIUS + getSizeFromRadius |
| G-05 | Disk (inter-arm) not generated | ✅ FIXED — 20% disk fraction |
| G-06 | Grid size from baseSize, not R⊕ | ✅ FIXED — getSizeFromRadius(R⊕) |
| G-07 | Atmosphere probabilities approximate | ✅ FIXED — conditional probabilities match spec §2.4 |
| G-08 | Gas giant inert/toxic swapped | ✅ FIXED — inert=5%, toxic=4% |
| G-09 | Single life distribution | ✅ FIXED — per-type LIFE_LEVEL_WEIGHTS |
| G-10 | Life conditions not checked | ✅ FIXED — temperature, atmosphere checks |
| G-11 | Toxic blocks all life | ✅ FIXED — microbes allowed |
| G-12 | Companion can be special type | ✅ FIXED — main sequence only |
| G-13 | Orbital radius ignores binary | ✅ FIXED — BINARY_CLOSE min 1.0 AU, BINARY_WIDE max 30 AU |
| G-14 | Bulge 30% instead of 15% | ✅ FIXED — 15% bulge, 20% disk, 60% arms, 5% halo |
| G-15 | Orbit slots by type, not size | ✅ FIXED — ORBIT_SLOTS_BY_SIZE |
| G-16 | No snow line | ✅ FIXED — R_snow = 2.7 × sqrt(L) AU |
| G-17 | Asteroid bonuses missing | ✅ FIXED — gas giant +1, binary +1 |
| G-18 | 278 instead of 278.5 | ✅ FIXED — 278.5 |
| G-19 | Star ±20% variation | 🟢 ACCEPTABLE for MVP |
| G-20 | Spiral position algorithm differs | 🟢 ACCEPTABLE — functionally similar |
| G-21 | JP arm alignment not checked | 🟢 DEFERRED — post-MVP |
| G-22 | Atmosphere composition always [] | 🟢 DEFERRED — post-MVP |
| G-23 | Dwarf orbitSlots 2-4 instead of 3 | ✅ FIXED — uses ORBIT_SLOTS_BY_SIZE[tiny] = 3 |

---

## 9. New Issues Summary

| ID | Severity | Description | Fix Priority |
|----|----------|-------------|-------------|
| G-24 | CRITICAL | PRNG derive() produces collisions (128/1000 unique) | P0 — must fix |
| G-25 | SIGNIFICANT | No planet type can produce "large" size | P1 — design gap |
| G-26 | FALSE POSITIVE | Audit script uses outdated estimatedR formula | P2 — update audit |
| G-27 | SIGNIFICANT | Oceanic planets too rare (1.1%) for M/K dwarfs | P1 — needs orbital scaling |
| G-28 | MINOR | baseGravity is dead code in PlanetDef | P3 — cleanup |
| G-29 | MINOR | Gas giant min gravity 0.69g too low | P2 — increase density min |
| G-30 | MINOR | temperatureRange misleading (typical, not required) | P3 — rename/relabel |

---

## 10. Action Items (Prioritized)

### P0 — Must Fix
1. **Fix PRNG derive()** (G-24): Replace state-collapsing XOR with independent mixing of all 4 state words. This is the root cause of star type distribution anomalies and galaxy seed collisions.

### P1 — Should Fix
2. **Enable "large" planet size** (G-25): Expand oceanic and/or rocky max radius to reach ≥8282 km, or add sub_giant type.
3. **Fix oceanic planet rarity** (G-27): Scale orbital radii by star luminosity so M/K dwarf planets can fall in HZ.

### P2 — Should Fix
4. **Update audit script** (G-26): Replace `estimatedR = 0.3 + orbit * 0.6` with range-based analysis.
5. **Fix gas giant gravity** (G-29): Increase PLANET_DENSITY.gas_giant.min from 0.8 to 1.2.

### P3 — Cleanup
6. **Remove baseGravity** (G-28): Dead code in PlanetDef and PLANET_TYPES.
7. **Relabel temperatureRange** (G-30): Add "typical" qualifier in docs/code.

---

## Appendix A: Test Results Summary

### PRNG Test (scripts/prng-test.ts)
- 6 tests, 2 passed, 4 failed
- Critical: 872/1000 collisions for sequential derive() names
- Critical: 0-bit minimum difference between some consecutive outputs

### Star Distribution Test (scripts/star-dist-test.ts)
- 10 runs × 500 systems each
- STAR_A: 0/5000 (expected ~30) — PRNG bug confirmed
- STAR_WD: 0/5000 (expected ~20) — PRNG bug confirmed  
- STAR_NS: 72/5000 (expected ~5) — 14.4× overrepresented — PRNG bug
- Identical results from different seeds (e.g., 3331, 4108, 4885) — PRNG state collapse

### Audit Script (scripts/audit-generator.ts)
- 3 reported issues: missing star types, missing "large" size, determinism warning
- Missing star types: partially expected (rare), partially PRNG bug (A, WD)
- Missing "large": confirmed design gap
- Determinism warning: **false positive** — audit uses outdated estimatedR

---

## Appendix B: Planet Size Analysis

All non-gas-giant types max out at "medium" (R < 1.3 R⊕):

```
rocky:    2000-7000 km → R = 0.31-1.10 → tiny/medium
volcanic: 2500-8000 km → R = 0.39-1.26 → tiny/medium
ice:      1500-6000 km → R = 0.24-0.94 → tiny/small  
oceanic:  4000-8000 km → R = 0.63-1.26 → small/medium
desert:   2000-6500 km → R = 0.31-1.02 → tiny/medium
dwarf:    500-2000 km  → R = 0.08-0.31 → tiny

"large" requires R ≥ 1.3 (≥8282 km) — NO type reaches this
"huge" requires R ≥ 2.0 (≥12742 km) — only gas_giant (hardcoded)
```

---

## Appendix C: Temperature Calculation Example

STAR_M (L=0.02), rocky planet at various distances:

| Distance (AU) | T_eq (K) | T_eq (°C) | +standard GH | +CO₂ GH | In HZ? |
|---------------|----------|-----------|-------------|---------|--------|
| 0.15 | 270 | -3 | +27 to +57 | +97 to +297 | ✅ Yes |
| 0.5 | 148 | -125 | -95 to -65 | -25 to +175 | ❌ No |
| 0.8 | 117 | -156 | -126 to -96 | -56 to +144 | ❌ No |
| 1.5 | 85 | -188 | -158 to -128 | -88 to +112 | ❌ No |
| 3.0 | 60 | -213 | -183 to -153 | -113 to +87 | ❌ No |

Rocky planets around M dwarfs need to be at ~0.15 AU to have temperate temperatures. The current orbital formula starts at 0.8 AU, placing all M-dwarf planets in the deep freeze without strong greenhouse.
