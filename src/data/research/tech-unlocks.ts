/**
 * Block 03 (R5): TECH_UNLOCKS — таблица соответствий «технология → разблокировки».
 *
 * При завершении уровня N технологии для каждой записи в `TECH_UNLOCKS[techId]`
 * с `level ≤ N` эмитится tech:unlocked с конкретными типами:
 *   - 'recipe'   — разблокировать рецепт (добавить в RECIPES через флаг unlocked)
 *   - 'module'   — разблокировать модуль корабля (для ship designer)
 *   - 'building' — разблокировать здание (для BuildingDialog)
 *   - 'ship_hull' — разблокировать корпус (Etap 4)
 *
 * Idempotent: повторный emit с тем же (techId, level) не дублирует эффект —
 * applyTechUnlock проверяет `researched[techId] >= N` перед записью в
 * `unlockedRecipes`/`unlockedModules` etc.
 *
 * Источник: plan §4 R5 + docs/60-research.md §6.
 */

export interface TechUnlock {
  level: number;
  type: 'building' | 'recipe' | 'module' | 'ship_hull';
  id: string;
}

export const TECH_UNLOCKS: Record<string, TechUnlock[]> = {
  // ─── Power (P) ─────────────────────────────────────
  fusion_reactor: [
    { level: 1, type: 'building', id: 'fusion_reactor' },
  ],
  ion_engine: [
    { level: 1, type: 'module', id: 'ion_engine' },
  ],
  // power_systems — пока без unlocks (Etap 4)

  // ─── Materials (M) ─────────────────────────────────
  steel_processing: [
    { level: 1, type: 'recipe', id: 'make_steel' },
  ],
  light_alloys: [
    { level: 1, type: 'recipe', id: 'make_titanium_alloy' },
  ],
  composites: [
    { level: 1, type: 'recipe', id: 'make_composite_plate' },
  ],
  superconductors: [
    { level: 1, type: 'recipe', id: 'make_superconductor' },
  ],

  // ─── Weapons (W) ───────────────────────────────────
  ballistic_weapons: [
    { level: 1, type: 'module', id: 'ballistic_turret' },
  ],
  laser_weapons: [
    { level: 1, type: 'module', id: 'laser_cannon' },
  ],
  // fleet_tactics — эффект +5% бой (Etap 4), без unlock

  // ─── Computing (C) ─────────────────────────────────
  microelectronics: [
    { level: 1, type: 'recipe', id: 'make_microchip' },
  ],
  // short_range_sensors / communication_systems — Etap 4 unlocks

  // ─── Biology (B) ───────────────────────────────────
  // hydroponics / ecological_adaptation — заглушки эффектов (Etap 4)
};
