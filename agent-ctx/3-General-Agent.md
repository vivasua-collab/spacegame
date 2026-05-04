# Task 3 — Update docs/03-planets.md Based on Scientific Data

## Summary
Updated docs/03-planets.md to match actual generator code (planet-types.ts, generate-planets.ts) and scientific reference (planet-generation-science.md).

## Changes Made
1. **§1.1 Summary table**: Updated all 7 radius ranges (km + R⊕)
2. **§1.2.1–1.2.7**: Updated Радиус row in each subsection
3. **§2.1**: Updated overall range from 500–80 000 to 640–90 000
4. **§2.2 Density table**: Updated avg/range for all 7 types (Пустынная unchanged)
5. **§2.3 Temperature formula**: Replaced old simplified formula with proper 3-component model:
   - Equilibrium temperature with Bond albedo
   - Greenhouse effect scaled by atmospheric pressure
   - Type modifiers (volcanic, ice, gas giant, desert)
   - Earth verification: 14.6°C ✓
6. **Added scientific basis note** at top referencing planet-generation-science.md
7. **Updated version** from 1.0 to 1.1

## Files Modified
- docs/03-planets.md (documentation only, no code changes)

## Verification
- `bun run lint` — 0 errors
