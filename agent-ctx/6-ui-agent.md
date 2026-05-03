# Task 6 - UI Agent

## Task
Create all UI components for SpaceGame 4X strategy game.

## Files Created
1. `src/components/game/time-controls.tsx` — Pause/Play + speed buttons
2. `src/components/game/resource-panel.tsx` — Scrollable resource list by category
3. `src/components/game/building-dialog.tsx` — Build/upgrade dialog using shadcn Dialog
4. `src/components/game/galaxy-map.tsx` — SVG galaxy map with stars and jump points
5. `src/components/game/system-view.tsx` — Star info + planet list + jump points
6. `src/components/game/planet-view.tsx` — SVG hex grid + planet info + resource panel
7. `src/components/game/game-layout.tsx` — Main layout with top bar, sidebar, content area, status bar
8. `src/app/page.tsx` — New Game screen + GameLayout + tick loop

## Key Decisions
- All rendering uses SVG (not Canvas) for the hex grid and galaxy map
- Flat-top hexagon corners computed with angles 0°, 60°, 120°, 180°, 240°, 300°
- Dark space theme: #060614 (base), #0a0a1a (sidebar/header), #0d0d24 (cards)
- Game tick loop runs at 200ms intervals, controlled by speed value
- Building dialog serves dual purpose: construction (empty hex) and upgrade (built hex)
- Resource panel groups by ElementCategory and handles unknown resources (ores, crafted materials)

## Integration Points
- All components import from `@/stores/game-store` (useGameStore)
- Types imported from `@/core/types`
- Data imported from `@/data/*`
- Hex utils imported from `@/galaxy`
- shadcn/ui components: Button, Card, Badge, Dialog, ScrollArea, Separator

## Verification
- `bun run lint` passes with zero errors
- Dev server compiles successfully
- Page renders correctly (New Game screen visible at /)
