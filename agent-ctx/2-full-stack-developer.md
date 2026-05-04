# Task 2 — full-stack-developer

## Task: Fix missing elements (Os, Ne, Ar) and deep ore yields

## Work Done:
- Added Ne (Неон) and Ar (Аргон) elements to elements.ts in new "Инертные газы (атмосферные)" section
- Os (Осмий) was already present — verified placement in noble metals section
- Updated header: 55 → 57 элементов, updated noble category description
- Fixed 4 deep ore yields in processing-chains.ts:
  - Y-ore: 3.0+2.0=5.0 → 4.8+1.7+3.5=10.0 (added P, fixed prototype/molarFormula/molarMass)
  - Ba-ore: 3.5+2.0+1.5=7.0 → 5.9+1.4+2.7=10.0
  - Zr-ore: 4.0+1.5+2.0=7.5 → 5.0+1.5+3.5=10.0
  - Be-ore: 1.0+2.0+3.5+3.5=10.0 → 0.5+1.0+3.1+5.4=10.0 (values corrected per docs)
- Lint: 0 errors

## Files Modified:
- src/data/elements.ts
- src/data/processing-chains.ts
- worklog.md (appended record)
