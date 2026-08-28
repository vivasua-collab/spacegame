/**
 * R-BLD-MOD: Buildings validator — проверяет целостность data-driven
 * каталога построек (src/data/buildings/{surface,orbit,space}.json).
 *
 * Проверки:
 *   1. Все building IDs уникальны (нет дублей между файлами).
 *   2. Все значения layer ∈ {surface, atmosphere, orbit, space}.
 *   3. Все значения category ∈ BuildingCategory.
 *   4. Все значения size ∈ PlanetSize.
 *   5. Все ключи terrainBonus ∈ HexTerrain.
 *   6. Все requiresTechs[].techId существуют в TECH_MAP.
 *   7. Все bonuses[].sourceTech (если задан) существует в TECH_MAP.
 *   8. Все bonuses[].target непустые; operation ∈ {add, multiply, threshold}.
 *   9. minTechLevel >= 1 если задан (для sourceTech-бонусов).
 *
 * Run: `cd /home/z/my-project && bun run validate:buildings`
 */

import { BUILDINGS, BUILDING_MAP } from '@/data/buildings';
import { TECH_MAP } from '@/data/research/tech-tree';
import type { BuildingLayer, BuildingCategory, PlanetSize, HexTerrain } from '@/core/types';

const VALID_LAYERS: BuildingLayer[] = ['surface', 'atmosphere', 'orbit', 'space'];
const VALID_CATEGORIES: BuildingCategory[] = [
  'colonization', 'extraction', 'processing', 'production',
  'energy', 'military', 'research', 'logistics',
];
const VALID_SIZES: PlanetSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];
const VALID_TERRAINS: HexTerrain[] = [
  'plains', 'mountains', 'desert', 'ice', 'ocean', 'volcano', 'jungle',
];
const VALID_OPS = ['add', 'multiply', 'threshold'];

const errors: string[] = [];
const warnings: string[] = [];
const seenIds = new Set<string>();

for (const b of BUILDINGS) {
  // 1. Unique ID
  if (seenIds.has(b.id)) {
    errors.push(`Duplicate building id: '${b.id}'`);
  }
  seenIds.add(b.id);

  // Required scalar fields
  if (!b.id) errors.push(`Building has empty id`);
  if (!b.name) errors.push(`Building '${b.id}': empty name`);
  if (!b.description) errors.push(`Building '${b.id}': empty description`);
  if (b.levels < 1) errors.push(`Building '${b.id}': levels < 1 (${b.levels})`);
  if (b.energyConsumption < 0) warnings.push(`Building '${b.id}': negative energyConsumption (${b.energyConsumption})`);

  // 2. Layer
  if (!Array.isArray(b.layer) || b.layer.length === 0) {
    errors.push(`Building '${b.id}': layer array is empty or missing`);
  } else {
    for (const layer of b.layer) {
      if (!VALID_LAYERS.includes(layer)) {
        errors.push(`Building '${b.id}': invalid layer '${layer}' (valid: ${VALID_LAYERS.join(', ')})`);
      }
    }
  }

  // 3. Category
  if (!VALID_CATEGORIES.includes(b.category)) {
    errors.push(`Building '${b.id}': invalid category '${b.category}'`);
  }

  // 4. Size
  if (!Array.isArray(b.size) || b.size.length === 0) {
    errors.push(`Building '${b.id}': size array is empty or missing`);
  } else {
    for (const sz of b.size) {
      if (!VALID_SIZES.includes(sz)) {
        errors.push(`Building '${b.id}': invalid size '${sz}'`);
      }
    }
  }

  // 5. terrainBonus keys
  for (const terrain of Object.keys(b.terrainBonus)) {
    if (!VALID_TERRAINS.includes(terrain as HexTerrain)) {
      errors.push(`Building '${b.id}': invalid terrainBonus key '${terrain}'`);
    }
  }

  // costPerLevel element IDs — we don't validate against ELEMENT_MAP here
  // (the recipe validator covers resource IDs; buildings reference element
  // symbols which are checked at build-time). Just warn if empty.
  if (Object.keys(b.costPerLevel).length === 0 && b.id !== 'colony_hub') {
    warnings.push(`Building '${b.id}': empty costPerLevel`);
  }

  // 6. requiresTechs
  if (b.requiresTechs) {
    for (const req of b.requiresTechs) {
      if (!TECH_MAP.has(req.techId)) {
        errors.push(`Building '${b.id}': requiresTechs references unknown techId '${req.techId}'`);
      }
      if (req.minLevel < 1) {
        warnings.push(`Building '${b.id}': requiresTechs '${req.techId}' minLevel < 1 (${req.minLevel})`);
      }
    }
  }

  // 7-9. bonuses
  if (b.bonuses) {
    for (const [i, bonus] of b.bonuses.entries()) {
      const ctx = `Building '${b.id}' bonus[${i}]`;
      if (!bonus.target) errors.push(`${ctx}: empty target`);
      if (!VALID_OPS.includes(bonus.operation)) {
        errors.push(`${ctx}: invalid operation '${bonus.operation}'`);
      }
      if (bonus.sourceTech) {
        if (!TECH_MAP.has(bonus.sourceTech)) {
          errors.push(`${ctx}: sourceTech '${bonus.sourceTech}' not in TECH_MAP`);
        }
        if (bonus.minTechLevel !== undefined && bonus.minTechLevel < 1) {
          warnings.push(`${ctx}: minTechLevel < 1 (${bonus.minTechLevel})`);
        }
        // sourceTech + perLevel is redundant/confusing; warn.
        if (bonus.perLevel) {
          warnings.push(`${ctx}: sourceTech bonus also has perLevel (ignored for tech-sourced; use perTechLevel)`);
        }
      }
    }
  }
}

// Report
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BUILDINGS VALIDATION REPORT (R-BLD-MOD)');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total buildings:     ${BUILDINGS.length}`);
console.log(`  Unique IDs:         ${BUILDING_MAP.size}`);
console.log(`  Techs available:    ${TECH_MAP.size}`);
console.log('');

// Layer breakdown
const layerCounts: Record<string, number> = {};
for (const b of BUILDINGS) {
  for (const layer of b.layer) {
    layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
  }
}
console.log('  By layer (a building can span multiple):');
for (const layer of VALID_LAYERS) {
  console.log(`    ${layer.padEnd(10)} ${layerCounts[layer] ?? 0}`);
}
console.log('');

// Tech-gated count
const gated = BUILDINGS.filter((b) => (b.requiresTechs ?? []).length > 0);
console.log(`  Tech-gated buildings (requiresTechs): ${gated.length}`);
for (const b of gated) {
  const reqs = b.requiresTechs!.map((r) => `${r.techId}≥L${r.minLevel}`).join(', ');
  console.log(`    ${b.id.padEnd(22)} → ${reqs}`);
}
console.log('');

// Bonus count
const withBonuses = BUILDINGS.filter((b) => (b.bonuses ?? []).length > 0);
console.log(`  Buildings with bonuses: ${withBonuses.length}`);
for (const b of withBonuses) {
  const lines = b.bonuses!.map((bn) => {
    if (bn.sourceTech) {
      return `    ${bn.target} ${bn.operation} ${bn.value} ← tech:${bn.sourceTech}≥L${bn.minTechLevel ?? 1}${bn.perTechLevel ? ' /ур.тех.' : ''}`;
    }
    return `    ${bn.target} ${bn.operation} ${bn.value}${bn.perLevel ? ' /ур.зд.' : ''} ← ${bn.source ?? '—'}`;
  });
  console.log(`  ${b.id}:`);
  lines.forEach((l) => console.log(l));
}
console.log('');

if (errors.length > 0) {
  console.log(`❌ ERRORS: ${errors.length}`);
  for (const err of errors) console.log(`  - ${err}`);
  console.log('');
}
if (warnings.length > 0) {
  console.log(`⚠️  WARNINGS: ${warnings.length}`);
  for (const warn of warnings) console.log(`  - ${warn}`);
  console.log('');
}

if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ All buildings valid — modular JSON data is consistent.');
  process.exit(0);
} else if (errors.length === 0) {
  console.log(`✅ All buildings valid (with ${warnings.length} warnings).`);
  process.exit(0);
} else {
  console.log(`❌ Validation failed with ${errors.length} errors.`);
  process.exit(1);
}
