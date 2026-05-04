# Bug Fix Report: G-01 and G-02

## Bug G-02: Temperature bug for hot stars

### Root Cause
The orbital radius scale in `generatePlanet()` was capped at 5.0 AU via `Math.min(hzCenter, 5.0)`. For high-luminosity stars (O/B/A class), the habitable zone center (`hzCenter`) is much larger than 5 AU:

| Star Type | Luminosity (L☉) | hzCenter (AU) | Capped Scale (AU) |
|-----------|-----------------|---------------|-------------------|
| STAR_O    | 200,000         | ~500          | 5.0               |
| STAR_B    | 500             | ~25           | 5.0               |
| STAR_A    | 12              | ~3.9          | 3.9 (uncapped)    |

This forced ALL planets around O/B stars to orbit at ~5 AU or less, while the habitable zone is at 25-500 AU. Planets this close to a luminous star receive enormous irradiance, producing temperatures of 1000-2500+°C.

### Fix
Removed the `Math.min(hzCenter, 5.0)` cap. The habitable zone center is the physically correct scale for orbital distances. Using `hzCenter` directly ensures planets are placed at distances appropriate for their star's luminosity.

**Verification (B-type star, L=500):**
- Before: orbitalScale=5.0, orbit1≈4.75AU → T_eq≈662K (389°C) — unrealistically hot
- After: orbitalScale=25.0, orbit1≈23.75AU → T_eq≈256K (-17°C) — habitable zone

### Also Fixed
The code comment had a wrong formula: `((1-A)/r²)^(1/2)` instead of the correct `(1-A)^(1/4) × (1/r_AU)^(1/2)` from §2.3. The actual code was correct; only the comment was wrong.

## Bug G-01: lifeChance not used

### Root Cause
The `lifeChance` field in `PlanetDef` was defined but **never referenced** in `generateLife()`. Instead, the function used `LIFE_LEVEL_WEIGHTS` to roll a life level including "none", completely bypassing `lifeChance`. This meant:
1. The documented probability of life per planet type (§1.2) was not used
2. Environmental conditions didn't modify the probability of life — only the level
3. An icy planet at -200°C could roll "plants" from weights and only get downgraded to "microbes", even though such extreme conditions should make life extremely unlikely

### Fix
Rewrote `generateLife()` to use `lifeChance` as the primary probability gate:
1. Start with `planetDef.lifeChance` as the base probability
2. Modify by conditions:
   - Temperature outside −20…+80°C → `lifeChance × 0.1` (only extremophiles)
   - Toxic atmosphere → `lifeChance × 0.2`
3. Roll for life existence using the condition-modified chance
4. If life exists, determine level from `LIFE_LEVEL_WEIGHTS` (excluding the "none" weight)
5. Apply condition-based level restrictions (same as before)

**Example (volcanic planet at 500°C with toxic atmosphere):**
- Before: Rolled from weights [95,5,0,0,0] → 5% chance of microbes regardless of conditions
- After: lifeChance=0.05, ×0.1 (temp) ×0.2 (toxic) = 0.001 → 0.1% chance of microbes

## Files Modified
- `src/galaxy/generate-planets.ts`: Both fixes applied
