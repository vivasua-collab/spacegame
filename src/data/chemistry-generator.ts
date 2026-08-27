/**
 * Chemistry Generator — backward-compatible re-export shim.
 *
 * This file was historically the single 1704-line home of the "galaxy baking"
 * system. As part of Block 01 C5 (audit §2.3) it has been split into focused
 * modules under `./chemistry/`:
 *
 * - `chemistry/baked-types.ts`        — interfaces (BakedGalaxyModel, BakedOre, ...)
 * - `chemistry/ore-specs.ts`          — ORE_SPECS, SPECIAL_ORE_SPECS, REFINERY_ALTERNATIVES
 * - `chemistry/ore-generator.ts`      — bakeOreFromSpec, getDefaultFormula, helpers
 * - `chemistry/atmospheric-generator.ts` — generateAtmosphericCompounds
 * - `chemistry/ice-generator.ts`      — generateIceCompounds
 * - `chemistry/bake.ts`               — bakeGalaxyModel + getElementAtomicMass
 * - `chemistry/validate.ts`           — validateBakedModel
 *
 * All existing imports `from '@/data/chemistry-generator'` continue to work
 * unchanged — this file is a pure re-export. New code may import directly from
 * the focused modules for tree-shaking clarity.
 *
 * @see docs/galaxy-bake.md — concept document
 * @see docs/chemistry.md  — rules for chemical interactions and ore generation
 */

export * from './chemistry/baked-types';
export * from './chemistry/ore-specs';
export * from './chemistry/ore-generator';
export * from './chemistry/atmospheric-generator';
export * from './chemistry/ice-generator';
export * from './chemistry/bake';
export * from './chemistry/validate';
