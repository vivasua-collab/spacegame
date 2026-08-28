/**
 * R-RES §E: bonus-resolver — агрегирует все активные бонусы из researched
 * techs + построенных зданий (и опционально модулей кораблей) в единый
 * множитель для целевой метрики.
 *
 * Источники бонусов (data-driven):
 *   1. Technologies — `effects[]` поле (см. `src/core/types.ts` `Technology`).
 *      Для каждого эффекта, если researched[techId] >= effect.thresholdLevel (или
 *      >= 1 если не указан), применяется `value × currentLevel` для perLevel=true.
 *   2. Buildings — `bonuses[]` поле на `BuildingDef`. Сканируем все планеты
 *      игрока: hexes + atmosphericSlots + orbitSlots, для каждого здания с
 *      id+level смотрим def.bonuses, для каждого эффекта с perLevel=true
 *      умножаем value на buildingLevel.
 *   3. Ship parts (TODO Etap 4) — для статов флотов; сейчас stub.
 *
 * Семантика операций:
 *   - 'add'       → contrib = value × (perLevel ? level : 1). Суммируем.
 *   - 'multiply'  → contrib = value ^ (perLevel ? level : 1). Произведение.
 *   - 'threshold' → если level >= value, multiply by 1 (no-op для now);
 *      в будущем — gate для других эффектов.
 *
 * Итог: (1 + sum(add bonuses)) × product(multiply bonuses).
 *   - no bonuses → 1.0 (нейтральный множитель).
 *   - add bonuses only → 1 + sum.
 *   - multiply bonuses only → product.
 *
 * Пример для research_rate:
 *   Лаборатория L3 с bonus { target: 'research_rate', operation: 'add',
 *                            value: 0.02, perLevel: true, source: 'laboratory' }
 *     → contrib = 0.02 × 3 = 0.06
 *   Лаборатория L5
 *     → contrib = 0.02 × 5 = 0.10
 *   Итоговый множитель = (1 + 0.06 + 0.10) = 1.16 (+16% к research_rate)
 *
 * Применяется в engine.ts `getTotalRPPerSec` (через `getResearchRate`).
 *
 * ВАЖНО: функция PURE — не мутирует state. Сканирует planets[] (только
 * для player-owned, игнорируя AI-планеты) и возвращает number.
 */

import type { GameState, Planet, Bonus, Technology } from '@/core/types';
import { TECH_MAP } from '@/data/research/tech-tree';
import { BUILDING_MAP } from '@/data/buildings';

/**
 * Compute the bonus multiplier for a given target key (e.g. 'research_rate',
 * 'energy_output', 'ship_thrust').
 *
 * @param state  — current GameState (for researched techs + planets)
 * @param target — metric key to resolve (must match `Bonus.target`)
 * @returns number — multiplier (1.0 = no bonus). Always > 0.
 */
export function resolveBonuses(state: GameState, target: string): number {
  const addSum = 0;
  const addContributions: number[] = [];
  const multiplyContributions: number[] = [];

  // ─── Source 1: researched tech effects ──────────────────────
  for (const techId of Object.keys(state.researchState.researched)) {
    const level = state.researchState.researched[techId] ?? 0;
    if (level < 1) continue;
    const tech: Technology | undefined = TECH_MAP.get(techId);
    if (!tech) continue;
    for (const effect of tech.effects) {
      if (effect.target !== target) continue;
      // Threshold check: effect applies if researched level >= thresholdLevel (default 1)
      const threshold = effect.thresholdLevel ?? 1;
      if (level < threshold) continue;
      const effectiveLevel = effect.perLevel ? level : 1;
      if (effect.operation === 'multiply') {
        // For multiply effects, value is the multiplier itself (e.g. 1.10 per level).
        // We multiply the base by value^effectiveLevel (compound interest).
        // For techs with perLevel=true and value=1.10, at level 3 → 1.10^3 = 1.331.
        const base = effect.value;
        multiplyContributions.push(Math.pow(base, effectiveLevel));
      } else if (effect.operation === 'add') {
        // For add effects, value is the additive contribution per level.
        addContributions.push(effect.value * effectiveLevel);
      } else if (effect.operation === 'unlock') {
        // unlock is a no-op for resolveBonuses (it's gated by UI/logic, not stat math).
      }
    }
  }

  // ─── Source 2: built buildings (scan player planets) ────────
  const playerPlanets = collectPlayerPlanets(state);
  const researched = state.researchState.researched;
  for (const planet of playerPlanets) {
    // Surface hexes
    for (const hex of planet.hexes) {
      if (!hex.buildingId || hex.buildingLevel < 1) continue;
      const def = BUILDING_MAP.get(hex.buildingId);
      if (!def?.bonuses) continue;
      applyBuildingBonuses(def.bonuses, hex.buildingLevel, researched, target, addContributions, multiplyContributions);
    }
    // Atmospheric slots
    for (const slot of planet.atmosphericSlots) {
      if (!slot.buildingId || slot.buildingLevel < 1) continue;
      const def = BUILDING_MAP.get(slot.buildingId);
      if (!def?.bonuses) continue;
      applyBuildingBonuses(def.bonuses, slot.buildingLevel, researched, target, addContributions, multiplyContributions);
    }
    // Orbit slots
    for (const slot of planet.orbitSlots) {
      if (!slot.buildingId || slot.buildingLevel < 1) continue;
      const def = BUILDING_MAP.get(slot.buildingId);
      if (!def?.bonuses) continue;
      applyBuildingBonuses(def.bonuses, slot.buildingLevel, researched, target, addContributions, multiplyContributions);
    }
  }

  // ─── Source 3: ship parts (TODO Etap 4) ───────────────────
  // Skipped for MVP — would scan fleets + designs and aggregate part bonuses.
  // The infrastructure (Bonus type + resolver) is in place; just need a
  // scanner for ships.

  // Compute final multiplier:
  //   (1 + sum(add)) × product(multiply)
  const addTotal = addContributions.reduce((a, b) => a + b, addSum);
  const multTotal = multiplyContributions.reduce((a, b) => a * b, 1);
  return (1 + addTotal) * multTotal;
}

function applyBuildingBonuses(
  bonuses: Bonus[],
  buildingLevel: number,
  researched: Record<string, number>,
  target: string,
  addContributions: number[],
  multiplyContributions: number[],
): void {
  for (const bonus of bonuses) {
    if (bonus.target !== target) continue;

    // ─── R-BLD-MOD: tech-sourced bonus (sourceTech) ─────────────
    // Бонус зависит от уровня технологии, а не от уровня здания.
    // Активируется только когда researched[sourceTech] >= minTechLevel.
    if (bonus.sourceTech) {
      const techLevel = researched[bonus.sourceTech] ?? 0;
      const minLevel = bonus.minTechLevel ?? 1;
      if (techLevel < minLevel) continue; // технология не достигла порога
      // effectiveTechLevels: сколько уровней «выше порога» (min = 1).
      const techLevels = bonus.perTechLevel ? (techLevel - minLevel + 1) : 1;
      if (bonus.operation === 'add') {
        addContributions.push(bonus.value * techLevels);
      } else if (bonus.operation === 'multiply') {
        multiplyContributions.push(Math.pow(bonus.value, techLevels));
      } else if (bonus.operation === 'threshold') {
        // no-op (gate)
      }
      continue;
    }

    // ─── Building-sourced bonus (существующая модель) ──────────
    // Бонус зависит от уровня самого здания (perLevel).
    const effectiveLevel = bonus.perLevel ? buildingLevel : 1;
    if (bonus.operation === 'add') {
      addContributions.push(bonus.value * effectiveLevel);
    } else if (bonus.operation === 'multiply') {
      multiplyContributions.push(Math.pow(bonus.value, effectiveLevel));
    } else if (bonus.operation === 'threshold') {
      // threshold — no-op for now (gate for future conditional bonuses)
    }
  }
}

/**
 * Collect all planets owned by the player (state.playerFactionId) across
 * all star systems. Used as the source set for bonus resolution.
 */
function collectPlayerPlanets(state: GameState): Planet[] {
  const result: Planet[] = [];
  const playerFactionId = state.playerFactionId;
  for (const system of state.galaxy.systems) {
    for (const planet of system.planets) {
      if (planet.owner != null && planet.owner === playerFactionId) {
        result.push(planet);
      }
    }
  }
  return result;
}
