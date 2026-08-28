# Audit Pass 6 (2026-08-28): Research System Redesign + Reference Menu + Planet/UI Fixes

## User requests addressed
1. Planet descriptions black-on-black → fixed globally (Badge `outline` variant).
2. "Zeta Velorum III — Океаническая (Океаническая) (Огромная)" duplicate type → resolved by Badge fix (badge text now visible, no "phantom" duplicate).
3. Reference/legend menu near Save with tabbed subsystems → created `reference-dialog.tsx` (5 tabs: Планеты/Исследования/Экономика/Флот/Здания) + hex-count legend.
4. "Primary resource processing" building unavailable at start → fixed `processor` size list (added `tiny`/`huge`).
5. Research: RP only increases in display → fixed (show "Доступно" available RP + "Всего" lifetime).
6. "RP/сек:5.0" should be "RP/День:5.0" → all labels changed (1 tick = 1 day).
7. Cannot research 2nd level of basic techs → ROOT CAUSE: fundamental ceiling deadlock. `getEffectiveMaxLevel` returned `min(primary, floor(secondary×1.5))` = 0 when fundamentals at 0. FIXED: `getTechCeiling → tech.maxLevel` always (fundamentals only give partial bonus now).
8. Detailed audit of research coefficients → completed (ceiling removed, partial bonus preserved, RP rate formula documented).
9. Tech tree in external data files → moved to JSON: `techs.json`, `fundamentals.json`, `branch-links.json`, `tech-unlocks.json`, `bonuses.json`. `.ts` files are thin loaders.
10. "Infinite" research scheme → data-driven: adding a tech to `techs.json` makes it appear in the tree UI automatically.
11. Dependencies in data files + auto-scaling window → prerequisites in JSON; `TechTreeGraph` canvas computed from tech count (no hardcoded 1264px min).
12. Bonus specification in objects/buildings/parts → `bonuses?: Bonus[]` field on `BuildingDef` + `ShipModule`; `bonus-resolver.ts` `resolveBonuses(state, target)`.
13. Active research + queue → `researchQueue: string[]` on ResearchState; `advanceQueue()` auto-starts next tech when current finishes; 4 store actions + UI with reorder/remove.

## Files created
- `src/components/game/reference-dialog.tsx` — 5-tab help/reference dialog
- `src/data/research/techs.json` — 15 technologies (data-driven)
- `src/data/research/fundamentals.json` — 6 fundamental branches
- `src/data/research/branch-links.json` — 8 branch links
- `src/data/research/tech-unlocks.json` — unlock table
- `src/data/research/bonuses.json` — bonus registry stub
- `src/research/bonus-resolver.ts` — `resolveBonuses(state, target)` pure function
- `tests/research/queue-and-rp.test.ts` — 15 tests (queue, available RP)
- `tests/research/bonus-resolver.test.ts` — 12 tests (bonus resolution)
- `checkpoints/audit_2026_08_28_06_research_redesign.md` (this file)

## Files modified
- `src/components/ui/badge.tsx` — `outline` variant: `text-foreground` → `text-slate-200 border-white/20 bg-white/5` (fixes black-on-black globally)
- `src/components/game/game-layout.tsx` — added `ReferenceButton` next to `SaveButton`
- `src/data/buildings.ts` — `processor.size` extended to all sizes; `laboratory.bonuses` demo
- `src/data/ships/modules.ts` — `engine_ion_mk1.bonuses` demo
- `src/core/types.ts` — `ResearchState.researchQueue`, `BuildingDef.bonuses`, `ShipModule.bonuses`, `Bonus` interface
- `src/core/events.ts` — 3 new queue events (`tech:queue-advanced`, `tech:queue-added`, `tech:queue-removed`)
- `src/research/engine.ts` — `getTechCeiling → tech.maxLevel`; `advanceQueue()`; `getAvailableRP()`; `getTotalRPPerSec(planets, mult)`
- `src/research/research-module.ts` — `resolveBonuses` call, queue-advanced emit
- `src/research/index.ts` — barrel exports updated
- `src/stores/game-store.ts` — 4 queue actions (`addToResearchQueue`, `removeFromResearchQueue`, `reorderResearchQueue`, `clearResearchQueue`); migrate `researchQueue`
- `src/components/game/research-view.tsx` — RP/День labels, queue UI (add/reorder/remove), "В очередь" button, auto-scaling canvas, `getAvailableRP` display, `resolveBonuses` applied
- `src/data/research/{tech-tree,fundamental-branches,branch-links,tech-unlocks}.ts` — thin JSON loaders
- `tests/research/branch-ceilings.test.ts` — updated for new ceiling behavior
- `tests/research/process-tick.test.ts` — updated
- `tests/ships/fleet-engine.test.ts` — added `researchQueue` fixture field

## Design decisions
- **Ceiling**: removed fundamental cap entirely for MVP. `getTechCeiling → tech.maxLevel`. Fundamentals still give partial RP-rate bonus (`getPartialBonus` preserved). Unblocks ALL starter techs immediately.
- **Queue**: `researchQueue: string[]` (ordered techIds). `advanceQueue()` is a pure draft-mutating fn called by `tickResearch` when `activeSlots.length === 0`. Slot IDs: `slot_q_<techId>_<targetLevel>` (deterministic, no Math.random). `addToResearchQueue` validates: tech exists, not maxed, not already queued/active, prereqs met.
- **RP display**: `getAvailableRP(state) = totalRpGenerated − sum(fundamentalRpInvested) − sum(activeSlots.rpInvested)`. UI: "Доступно: X RP" (prominent) + "Всего: Y RP" (secondary).
- **RP/День**: 1 tick = 1 day (already true per `formatTick` in page.tsx). Only label changed; value unchanged (5.0).
- **JSON data**: direct `techsData as Technology[]` cast in loaders. `STARTER_TECH_IDS` computed from `TECH_TREE.filter(t => t.prerequisites.length === 0)`. Barrel `index.ts` unchanged → all imports work. Adding a tech to `techs.json` → appears in tree automatically.
- **Bonus resolver**: `resolveBonuses(state, target) = (1 + Σ add bonuses) × Π multiply bonuses`. Sources: (1) researched techs' `effects[]` (perLevel scales by currentLevel), (2) built buildings' `bonuses[]` on player-owned planets (scan hexes + atmospheric + orbit slots, perLevel by buildingLevel). Ship parts stubbed for Etap 4. Applied: `resolveBonuses(state, 'research_rate')` → multiplier to `getTotalRPPerSec`.
- **Auto-scaling tree**: `canvasWidth = LEFT_PAD + (maxColumnIndex+1)×(NODE_W+COL_GAP) + RIGHT_PAD`; grows with tech count.
- **Badge fix**: global `outline` variant → `text-slate-200 border-white/20 bg-white/5`. Fixes ALL outline badges on dark `#0d0d24` backgrounds (planet type/size, research slots, etc.).

## Quality gates
- **lint**: 0 errors / 49 warnings (= baseline)
- **tsc**: 168 errors (= baseline; pre-existing `moons` test-fixture + `noUncheckedIndexedAccess` backlog; 0 new from this pass)
- **tests**: 369 pass / 0 fail (+29 new: queue-and-rp 15, bonus-resolver 12, updated 2)
- **recipes**: 75/75 valid
- **agent-browser**: ✓ RP/День label, ✓ steel_processing researchable (ceiling fix), ✓ "В очередь" button + queue list, ✓ reference dialog 5 tabs + hex legend, ✓ planet badges visible (Скалистая/Средняя/Пустынная text shows), ✓ no runtime errors in dev.log

## MVP scope
- Block 04 (AI/opponents) still deferred — not touched.
- No new `noUncheckedIndexedAccess` violations added.
