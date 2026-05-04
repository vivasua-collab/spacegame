# Task 5 — Implement the resource processing conveyor (конвейер переработки)

## Agent: General Agent

## Summary
Replaced old specialized buildings (smelter, chemical_plant) with universal processors (processor, synthesizer, refinery) and updated all recipe buildingId references accordingly.

## Files Modified
1. **src/data/buildings.ts** — Renamed smelter→processor, chemical_plant→synthesizer; added refinery building
2. **src/data/recipes.ts** — Updated all buildingId references; added 4 new recipes; reorganized section headers

## Files Verified Clean (no changes needed)
- src/economy/engine.ts — Uses BUILDING_MAP.get() dynamically, no hardcoded building IDs
- src/components/game/building-dialog.tsx — Uses BUILDING_MAP dynamically
- src/components/game/planet-view.tsx — Uses BUILDING_MAP dynamically

## Building Changes
| Old ID | New ID | New Name | New Description |
|--------|--------|----------|-----------------|
| smelter | processor | Переработчик | Универсальная переработка руды в чистые элементы. Выход: 70–85% чистоты. |
| chemical_plant | synthesizer | Синтезатор | Синтез сплавов, материалов и химических соединений из чистых элементов. |
| (new) | refinery | Очистительный комплекс | Глубокая очистка элементов. Выход: 95–99% чистоты, но 2× энергозатраты. |

## Recipe Changes
- Level 1 (smelt_*): buildingId 'smelter' → 'processor' (18 recipes)
- Level 1alt (refine_*): 3 NEW refinery recipes (refine_au, refine_pt, refine_u)
- Level 2 (make_steel, make_titanium_alloy, make_plastic, make_silicon_crystal, make_superconductor): → 'synthesizer'
- Level 2 NEW: make_synfuel (C+H+S → synfuel, buildingId='synthesizer')
- Level 3 (make_microchip, make_hull_element, make_armor_plate, make_engine_section, make_shield_generator): → 'synthesizer'
- Level 4: Unchanged (shipyard)

## Verification
- `bun run lint`: 0 errors
- Codebase search for 'smelter'/'chemical_plant': 0 remaining references in src/
- Dev server: compiling successfully
