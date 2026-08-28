/**
 * R-SHIPS-DATA: Ships validator — проверяет целостность data-driven
 * каталога кораблей (src/data/ships/{hulls,modules,fuel-map}.json).
 *
 * Проверки:
 *  Hulls:
 *   1. Все hull IDs уникальны.
 *   2. Все значения size ∈ HullSize.
 *   3. Все значения armorOptions ∈ HullArmorThickness.
 *   4. totalHS, baseHP, baseMass, slots, baseCost > 0.
 *   5. requiredEngineeringLevel, requiredShipyardLevel >= 1.
 *
 *  Modules:
 *   6. Все module IDs уникальны.
 *   7. category ∈ ModuleCategory.
 *   8. slotRestriction (если задан) ∈ SlotType.
 *   9. controlType (если задан) ∈ {'cpu','navigation','tactical','communication'}.
 *  10. weaponType (если задан) ∈ {laser,plasma,missile,gauss,ion,torpedo,fighter_bay}.
 *  11. damageType (если задан) ∈ DamageType.
 *  12. defenseType (если задан) ∈ {shield,stealth,emi_shield,armor}.
 *  13. auxiliaryType (если задан) ∈ {cargo,fuel_tank,scanner,sensor_array,
 *      repair,mining,colony,jump_drive,reactor}.
 *  14. fuelType (если задан) ∈ FuelType.
 *  15. minHull (если задан) ∈ HullSize.
 *  16. requiredTechs[] (если есть) — ссылки на TECH_MAP.
 *  17. bonuses (если есть) — target непустой, operation ∈ {add,multiply,threshold},
 *      sourceTech (если задан) ∈ TECH_MAP.
 *
 *  Fuel-map:
 *  18. allFuelTypes совпадает с записями в fuelToElement и fuelElementCostPerUnit.
 *  19. Все значения FuelType ∈ {'chemical','xenon','hydrogen','antimatter'}.
 *
 * Run: `cd /home/z/my-project && bun run validate:ships`
 */

import { HULLS, HULL_MAP, SHIP_MODULES, MODULE_MAP, ALL_FUEL_TYPES, FUEL_TO_ELEMENT, FUEL_ELEMENT_COST_PER_UNIT } from '@/data/ships';
import { TECH_MAP } from '@/data/research/tech-tree';
import type {
  HullSize,
  HullArmorThickness,
  ModuleCategory,
  SlotType,
  FuelType,
  DamageType,
} from '@/core/types';

const VALID_HULL_SIZES: HullSize[] = ['scout', 'fighter', 'frigate', 'cruiser', 'battleship', 'transport', 'flagship'];
const VALID_ARMOR: HullArmorThickness[] = ['light', 'standard', 'thick', 'heavy'];
const VALID_CATEGORIES: ModuleCategory[] = ['engine', 'control', 'life_support', 'weapon', 'defense', 'auxiliary'];
const VALID_SLOT_TYPES: SlotType[] = ['any', 'weapon', 'engine', 'system', 'defense'];
const VALID_CONTROL_TYPES = ['cpu', 'navigation', 'tactical', 'communication'];
const VALID_WEAPON_TYPES = ['laser', 'plasma', 'missile', 'gauss', 'ion', 'torpedo', 'fighter_bay'];
const VALID_DAMAGE_TYPES: DamageType[] = ['energy', 'kinetic', 'ion', 'plasma', 'missile', 'torpedo'];
const VALID_DEFENSE_TYPES = ['shield', 'stealth', 'emi_shield', 'armor'];
const VALID_AUX_TYPES = ['cargo', 'fuel_tank', 'scanner', 'sensor_array', 'repair', 'mining', 'colony', 'jump_drive', 'reactor'];
const VALID_FUEL_TYPES: FuelType[] = ['chemical', 'xenon', 'hydrogen', 'antimatter'];
const VALID_OPS = ['add', 'multiply', 'threshold'];

const errors: string[] = [];
const warnings: string[] = [];

// ─── Hulls validation ───────────────────────────────────────────────────
const seenHullIds = new Set<string>();
for (const h of HULLS) {
  // 1. Unique ID
  if (seenHullIds.has(h.id)) {
    errors.push(`Duplicate hull id: '${h.id}'`);
  }
  seenHullIds.add(h.id);

  if (!h.id) errors.push(`Hull has empty id`);
  if (!h.name) errors.push(`Hull '${h.id}': empty name`);

  // 2. Size
  if (!VALID_HULL_SIZES.includes(h.size)) {
    errors.push(`Hull '${h.id}': invalid size '${h.size}'`);
  }

  // 3. armorOptions
  if (!Array.isArray(h.armorOptions) || h.armorOptions.length === 0) {
    errors.push(`Hull '${h.id}': armorOptions array is empty or missing`);
  } else {
    for (const opt of h.armorOptions) {
      if (!VALID_ARMOR.includes(opt)) {
        errors.push(`Hull '${h.id}': invalid armorOption '${opt}'`);
      }
    }
  }

  // 4. Positive numeric fields
  if (h.totalHS <= 0) errors.push(`Hull '${h.id}': totalHS <= 0 (${h.totalHS})`);
  if (h.baseHP <= 0) errors.push(`Hull '${h.id}': baseHP <= 0 (${h.baseHP})`);
  if (h.baseMass <= 0) errors.push(`Hull '${h.id}': baseMass <= 0 (${h.baseMass})`);
  if (h.weaponSlots < 0) errors.push(`Hull '${h.id}': weaponSlots < 0 (${h.weaponSlots})`);
  if (h.engineSlots < 0) errors.push(`Hull '${h.id}': engineSlots < 0 (${h.engineSlots})`);
  if (h.systemSlots < 0) errors.push(`Hull '${h.id}': systemSlots < 0 (${h.systemSlots})`);
  if (h.defenseSlots < 0) errors.push(`Hull '${h.id}': defenseSlots < 0 (${h.defenseSlots})`);
  if (h.baseCost <= 0) errors.push(`Hull '${h.id}': baseCost <= 0 (${h.baseCost})`);

  // 5. Engineering/Shipyard levels
  if (h.requiredEngineeringLevel < 1) {
    warnings.push(`Hull '${h.id}': requiredEngineeringLevel < 1 (${h.requiredEngineeringLevel})`);
  }
  if (h.requiredShipyardLevel < 1) {
    warnings.push(`Hull '${h.id}': requiredShipyardLevel < 1 (${h.requiredShipyardLevel})`);
  }
}

// ─── Modules validation ──────────────────────────────────────────────────
const seenModuleIds = new Set<string>();
for (const m of SHIP_MODULES) {
  // 6. Unique ID
  if (seenModuleIds.has(m.id)) {
    errors.push(`Duplicate module id: '${m.id}'`);
  }
  seenModuleIds.add(m.id);

  if (!m.id) errors.push(`Module has empty id`);
  if (!m.name) errors.push(`Module '${m.id}': empty name`);

  // 7. category
  if (!VALID_CATEGORIES.includes(m.category)) {
    errors.push(`Module '${m.id}': invalid category '${m.category}'`);
  }

  // size, mass, cost must be positive
  if (m.size <= 0) warnings.push(`Module '${m.id}': size <= 0 (${m.size})`);
  if (m.mass < 0) warnings.push(`Module '${m.id}': mass < 0 (${m.mass})`);
  if (m.cost < 0) warnings.push(`Module '${m.id}': cost < 0 (${m.cost})`);
  if (m.energyConsumption < 0) warnings.push(`Module '${m.id}': energyConsumption < 0 (${m.energyConsumption})`);

  // 8. slotRestriction
  if (m.slotRestriction !== undefined && !VALID_SLOT_TYPES.includes(m.slotRestriction)) {
    errors.push(`Module '${m.id}': invalid slotRestriction '${m.slotRestriction}'`);
  }

  // 9. controlType
  if (m.controlType !== undefined && !VALID_CONTROL_TYPES.includes(m.controlType)) {
    errors.push(`Module '${m.id}': invalid controlType '${m.controlType}'`);
  }

  // 10. weaponType
  if (m.weaponType !== undefined && !VALID_WEAPON_TYPES.includes(m.weaponType)) {
    errors.push(`Module '${m.id}': invalid weaponType '${m.weaponType}'`);
  }

  // 11. damageType
  if (m.damageType !== undefined && !VALID_DAMAGE_TYPES.includes(m.damageType)) {
    errors.push(`Module '${m.id}': invalid damageType '${m.damageType}'`);
  }

  // 12. defenseType
  if (m.defenseType !== undefined && !VALID_DEFENSE_TYPES.includes(m.defenseType)) {
    errors.push(`Module '${m.id}': invalid defenseType '${m.defenseType}'`);
  }

  // 13. auxiliaryType
  if (m.auxiliaryType !== undefined && !VALID_AUX_TYPES.includes(m.auxiliaryType)) {
    errors.push(`Module '${m.id}': invalid auxiliaryType '${m.auxiliaryType}'`);
  }

  // 14. fuelType
  if (m.fuelType !== undefined && !VALID_FUEL_TYPES.includes(m.fuelType)) {
    errors.push(`Module '${m.id}': invalid fuelType '${m.fuelType}'`);
  }

  // 15. minHull
  if (m.minHull !== undefined && !VALID_HULL_SIZES.includes(m.minHull)) {
    errors.push(`Module '${m.id}': invalid minHull '${m.minHull}'`);
  }

  // 16. requiredTechs
  if (m.requiredTechs) {
    for (const techId of m.requiredTechs) {
      if (!TECH_MAP.has(techId)) {
        errors.push(`Module '${m.id}': requiredTechs references unknown techId '${techId}'`);
      }
    }
  } else {
    // requiredTechs missing entirely — warn (MVP expects empty array, not undefined)
    warnings.push(`Module '${m.id}': requiredTechs is undefined (should be empty array for MVP)`);
  }

  // 17. bonuses
  if (m.bonuses) {
    for (const [i, bonus] of m.bonuses.entries()) {
      const ctx = `Module '${m.id}' bonus[${i}]`;
      if (!bonus.target) errors.push(`${ctx}: empty target`);
      if (!VALID_OPS.includes(bonus.operation)) {
        errors.push(`${ctx}: invalid operation '${bonus.operation}'`);
      }
      if (bonus.sourceTech) {
        if (!TECH_MAP.has(bonus.sourceTech)) {
          errors.push(`${ctx}: sourceTech '${bonus.sourceTech}' not in TECH_MAP`);
        }
      }
    }
  }

  // Cross-category sanity: control modules should have controlType; weapons should have damage; etc.
  if (m.category === 'engine' && (m.thrust === undefined || m.fuelType === undefined || m.fuelPerThrust === undefined)) {
    warnings.push(`Module '${m.id}' (engine): missing thrust/fuelType/fuelPerThrust`);
  }
  if (m.category === 'weapon' && (m.weaponType === undefined || m.damage === undefined)) {
    warnings.push(`Module '${m.id}' (weapon): missing weaponType/damage`);
  }
  if (m.category === 'defense' && m.defenseType === undefined) {
    warnings.push(`Module '${m.id}' (defense): missing defenseType`);
  }
  if (m.category === 'auxiliary' && m.auxiliaryType === undefined) {
    warnings.push(`Module '${m.id}' (auxiliary): missing auxiliaryType`);
  }
}

// ─── Fuel-map validation ─────────────────────────────────────────────────

// 18. allFuelTypes matches fuelToElement keys + fuelElementCostPerUnit keys
const fuelToElementKeys = Object.keys(FUEL_TO_ELEMENT).sort();
const fuelCostKeys = Object.keys(FUEL_ELEMENT_COST_PER_UNIT).sort();
const allFuels = [...ALL_FUEL_TYPES].sort();

if (JSON.stringify(fuelToElementKeys) !== JSON.stringify(allFuels)) {
  errors.push(
    `fuel-map: FUEL_TO_ELEMENT keys [${fuelToElementKeys.join(',')}] ≠ ALL_FUEL_TYPES [${allFuels.join(',')}]`,
  );
}
if (JSON.stringify(fuelCostKeys) !== JSON.stringify(allFuels)) {
  errors.push(
    `fuel-map: FUEL_ELEMENT_COST_PER_UNIT keys [${fuelCostKeys.join(',')}] ≠ ALL_FUEL_TYPES [${allFuels.join(',')}]`,
  );
}

// 19. All FuelType values valid
for (const ft of ALL_FUEL_TYPES) {
  if (!VALID_FUEL_TYPES.includes(ft)) {
    errors.push(`fuel-map: invalid FuelType '${ft}' in ALL_FUEL_TYPES`);
  }
}
for (const ft of Object.keys(FUEL_TO_ELEMENT)) {
  if (!VALID_FUEL_TYPES.includes(ft as FuelType)) {
    errors.push(`fuel-map: invalid FuelType '${ft}' in FUEL_TO_ELEMENT`);
  }
}

// ─── Report ─────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  SHIPS VALIDATION REPORT (R-SHIPS-DATA)');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total hulls:         ${HULLS.length}`);
console.log(`  Unique hull IDs:     ${HULL_MAP.size}`);
console.log(`  Total modules:       ${SHIP_MODULES.length}`);
console.log(`  Unique module IDs:   ${MODULE_MAP.size}`);
console.log(`  Fuel types:          ${ALL_FUEL_TYPES.length} [${ALL_FUEL_TYPES.join(', ')}]`);
console.log(`  Techs available:     ${TECH_MAP.size}`);
console.log('');

// Module category breakdown
const catCounts: Record<string, number> = {};
for (const m of SHIP_MODULES) {
  catCounts[m.category] = (catCounts[m.category] ?? 0) + 1;
}
console.log('  Modules by category:');
for (const cat of VALID_CATEGORIES) {
  console.log(`    ${cat.padEnd(14)} ${catCounts[cat] ?? 0}`);
}
console.log('');

// Tech-gated modules
const gated = SHIP_MODULES.filter((m) => (m.requiredTechs ?? []).length > 0);
console.log(`  Tech-gated modules (requiredTechs): ${gated.length}`);
for (const m of gated) {
  console.log(`    ${m.id.padEnd(28)} → ${m.requiredTechs!.join(', ')}`);
}
console.log('');

// Modules with bonuses
const withBonuses = SHIP_MODULES.filter((m) => (m.bonuses ?? []).length > 0);
console.log(`  Modules with bonuses: ${withBonuses.length}`);
for (const m of withBonuses) {
  const lines = m.bonuses!.map((bn) => {
    if (bn.sourceTech) {
      return `    ${bn.target} ${bn.operation} ${bn.value} ← tech:${bn.sourceTech}≥L${bn.minTechLevel ?? 1}${bn.perTechLevel ? ' /ур.тех.' : ''}`;
    }
    return `    ${bn.target} ${bn.operation} ${bn.value}${bn.perLevel ? ' /ур.зд.' : ''} ← ${bn.source ?? '—'}`;
  });
  console.log(`  ${m.id}:`);
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
  console.log('✅ All ships data valid — modular JSON catalog is consistent.');
  process.exit(0);
} else if (errors.length === 0) {
  console.log(`✅ All ships data valid (with ${warnings.length} warnings).`);
  process.exit(0);
} else {
  console.log(`❌ Validation failed with ${errors.length} errors.`);
  process.exit(1);
}
