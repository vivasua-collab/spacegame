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
 *  10. R-SYNERGY v2 (Задача 24): типовые правила Синергии (synergy.json) —
 *      все sourceTypes/neighborTypes ∈ допустимые типы (generator/extractor/
 *      processor/research/storage/production/colony/military/consumer или "*"),
 *      bonusTarget ∈ {research_rate, processing_speed, energy_consumption,
 *      energy_generation, mining_speed}, value ∈ (−1, 1), stackDecay ∈ (0, 1].
 *
 * Run: `cd /home/z/my-project && bun run validate:buildings`
 */

import { BUILDINGS, BUILDING_MAP } from '@/data/buildings';
import { SYNERGY_RULES, SYNERGY_BUILDING_TYPES } from '@/data/buildings/synergy';
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

// ─── R-SYNERGY v2 (Задача 24): правила Синергии (synergy.json) ──────────
console.log('  Synergy rules v2 — типовые (R-SYNERGY, docs/40-buildings.md §5):');
const VALID_SYNERGY_TARGETS = [
  'research_rate', 'processing_speed', 'energy_consumption',
  'energy_generation', 'mining_speed',
];
const seenRuleIds = new Set<string>();
console.log(`    Total rules: ${SYNERGY_RULES.length}`);
for (const rule of SYNERGY_RULES) {
  const ctx = `Synergy rule '${rule.id}'`;
  if (!rule.id) errors.push(`${ctx}: empty id`);
  if (seenRuleIds.has(rule.id)) errors.push(`${ctx}: duplicate id`);
  seenRuleIds.add(rule.id);
  if (!rule.description) warnings.push(`${ctx}: empty description`);

  // sourceTypes / neighborTypes ∈ допустимые типы ('*' = любой)
  for (const [i, type] of rule.sourceTypes.entries()) {
    if (type !== '*' && !SYNERGY_BUILDING_TYPES.includes(type)) {
      errors.push(`${ctx}: sourceTypes[${i}] references unknown type '${type}' (valid: ${SYNERGY_BUILDING_TYPES.join(', ')})`);
    }
  }
  if (rule.sourceTypes.length === 0) errors.push(`${ctx}: empty sourceTypes`);
  for (const [i, type] of rule.neighborTypes.entries()) {
    if (type !== '*' && !SYNERGY_BUILDING_TYPES.includes(type)) {
      errors.push(`${ctx}: neighborTypes[${i}] references unknown type '${type}' (valid: ${SYNERGY_BUILDING_TYPES.join(', ')})`);
    }
  }
  if (rule.neighborTypes.length === 0) errors.push(`${ctx}: empty neighborTypes`);

  // bonusTarget
  if (!VALID_SYNERGY_TARGETS.includes(rule.bonusTarget)) {
    errors.push(`${ctx}: invalid bonusTarget '${rule.bonusTarget}' (valid: ${VALID_SYNERGY_TARGETS.join(', ')})`);
  }

  // value range: для research/processing/generation/mining — (0, 1);
  // для energy_consumption — (−1, 0)
  if (rule.bonusTarget === 'energy_consumption') {
    if (rule.value >= 0 || rule.value <= -1) {
      errors.push(`${ctx}: energy_consumption value must be in (−1, 0), got ${rule.value}`);
    }
  } else if (rule.value <= 0 || rule.value >= 1) {
    errors.push(`${ctx}: ${rule.bonusTarget} value must be in (0, 1), got ${rule.value}`);
  }

  // stackDecay in (0, 1]
  if (rule.stackDecay <= 0 || rule.stackDecay > 1) {
    errors.push(`${ctx}: stackDecay must be in (0, 1], got ${rule.stackDecay}`);
  }

  const sources = rule.sourceTypes.includes('*')
    ? 'любой'
    : rule.sourceTypes.join(', ');
  console.log(
    `    ${rule.id.padEnd(22)} ${sources} ← ${rule.neighborTypes.join(', ')}${rule.sameSubtypeOnly ? ' (same subtype)' : ''}: `.padEnd(64) +
    `${(rule.value * 100).toFixed(0)}% (decay ${rule.stackDecay}) → ${rule.bonusTarget}`,
  );
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
