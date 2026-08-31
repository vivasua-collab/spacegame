/**
 * R-SYNERGY v2 (Задача 24): движок Синергии — ТИПОВЫЕ бонусы соседства.
 *
 * Реализует docs/40-buildings.md §5 (data-driven из src/data/buildings/synergy.json):
 *   - Смежные здания (соседние гексы, axial-координаты) дают бонусы соседства.
 *   - Матчинг по ТИПАМ зданий (generator/extractor/processor/research/storage/
 *     production/colony/military + псевдо-роль consumer = energyConsumption > 0).
 *   - ПОДТИП = buildingId; флаг sameSubtypeOnly запрещает бонусы между
 *     разными подтипами одного типа (solar_plant ↔ nuclear_reactor — нет).
 *   - Стекинг с убывающей отдачей (§5.2): n-й подходящий сосед даёт
 *     value × stackDecay^(n-1). Пример: переработчик окружён 3 шахтами →
 *     0.15 + 0.15×0.5 + 0.15×0.25 = 0.2625 (+26.25%).
 *   - Синергия действует ТОЛЬКО на гексах поверхности: атмосферные и
 *     орбитальные слоты не имеют пространственной смежности (упрощение MVP;
 *     см. docs §5.3 — «оба здания построены»; строительства-во-времени и
 *     отключения-по-энергии в engine нет, все построенные здания считаются
 *     активными).
 *
 * Все функции ЧИСТЫЕ — читают planet.hexes, не мутируют состояние.
 *
 * Точки интеграции:
 *   - research/bonus-resolver.ts: research_rate (кластеры лабораторий §5.1).
 *   - economy/engine.ts recalcEnergyBalance: energy_consumption (потребители
 *     у электростанций) + energy_generation (power_boost: электростанция
 *     получает +выработку за смежных потребителей).
 *   - economy/engine.ts processExtraction: mining_speed (mining_cluster:
 *     экстракторы одного подтипа ускоряют добычу друг друга).
 *   - economy/engine.ts processProductionQueue: processing_speed (кросс-
 *     типовые правила отложены, Задача 24).
 */

import type { Planet, SynergyRule, HexCell } from '@/core/types';
import {
  SYNERGY_RULES,
  getSynergyBuildingType,
  isEnergyConsumer,
} from '@/data/buildings/synergy';

/** 6 направлений соседства axial-координат (docs/40-buildings.md §4). */
const HEX_DIRECTIONS: ReadonlyArray<{ q: number; r: number }> = [
  { q: +1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: +1 },
  { q: 0, r: -1 },
  { q: +1, r: -1 },
  { q: -1, r: +1 },
];

/** Ключ axial-координаты для Map. */
function coordKey(q: number, r: number): string {
  return `${q},${r}`;
}

/**
 * Индексы гексов, смежных с данным (по axial-координатам).
 * Соседство симметрично: если B сосед A, то A сосед B.
 */
export function getNeighborIndices(planet: Planet, hexIndex: number): number[] {
  const hex = planet.hexes[hexIndex];
  if (!hex) return [];
  const indexByCoord = new Map<string, number>();
  planet.hexes.forEach((h, i) => {
    indexByCoord.set(coordKey(h.coord.q, h.coord.r), i);
  });
  const result: number[] = [];
  for (const dir of HEX_DIRECTIONS) {
    const idx = indexByCoord.get(coordKey(hex.coord.q + dir.q, hex.coord.r + dir.r));
    if (idx !== undefined) result.push(idx);
  }
  return result;
}

/** Здание считается «построенным» (docs §5.3.2): id есть и уровень ≥ 1. */
function isBuilt(cell: { buildingId: string | null; buildingLevel: number }): boolean {
  return cell.buildingId !== null && cell.buildingLevel > 0;
}

/**
 * Подходит ли здание под список ТИПОВ (Задача 24 — матчинг по типам):
 *   - 'consumer' — псевдо-тип-роль: любое здание с energyConsumption > 0
 *     (генераторы не потребляют → solar/nuclear не матчатся друг с другом);
 *   - 'generator' | 'extractor' | 'processor' | 'research' | 'storage' |
 *     'production' | 'colony' | 'military' — тип от category каталога;
 *   - '*' — любой тип.
 */
function matchesTypeList(buildingId: string | null, types: string[]): boolean {
  if (!buildingId) return false;
  for (const type of types) {
    if (type === '*') return true;
    if (type === 'consumer') {
      if (isEnergyConsumer(buildingId)) return true;
      continue;
    }
    if (getSynergyBuildingType(buildingId) === type) return true;
  }
  return false;
}

/**
 * Сколько соседей гекса дают бонус по правилу.
 *
 * §5.3.2: сосед должен быть ПОСТРОЕН (buildingLevel ≥ 1).
 * sameSubtypeOnly: сосед должен быть ТОГО ЖЕ подтипа (buildingId), что и
 * получатель — «подтипы не дают бонусов друг другу» (Задача 24).
 */
export function countSynergyNeighbors(planet: Planet, hexIndex: number, rule: SynergyRule): number {
  const hex = planet.hexes[hexIndex];
  let count = 0;
  for (const idx of getNeighborIndices(planet, hexIndex)) {
    const neighbor = planet.hexes[idx];
    if (!neighbor || !isBuilt(neighbor)) continue;
    if (!matchesTypeList(neighbor.buildingId, rule.neighborTypes)) continue;
    if (rule.sameSubtypeOnly && hex && neighbor.buildingId !== hex.buildingId) continue;
    count++;
  }
  return count;
}

/**
 * Величина бонуса по правилу для гекса (стекинг с убывающей отдачей §5.2):
 *   bonus = value × Σ_{i=0..n-1} stackDecay^i  (n = число подходящих соседей).
 *
 * Пример (docs §5.2): 3 смежные шахты у переработчика, value=0.15, decay=0.5:
 *   0.15 × (1 + 0.5 + 0.25) = 0.2625 → +26.25%.
 */
export function getSynergyBonusValue(planet: Planet, hexIndex: number, rule: SynergyRule): number {
  const n = countSynergyNeighbors(planet, hexIndex, rule);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.pow(rule.stackDecay, i);
  }
  return rule.value * sum;
}

/**
 * Суммарный вклад Синергии для гекса по целевой метрике (все правила
 * с данным bonusTarget, где гекс подходит под sourceTypes).
 *
 * Для research_rate / processing_speed / energy_generation / mining_speed —
 * положительный вклад (доля); для energy_consumption — отрицательный
 * (снижение потребления).
 */
export function getSynergyContribution(planet: Planet, hexIndex: number, target: string): number {
  const hex = planet.hexes[hexIndex];
  if (!hex || !isBuilt(hex)) return 0;
  let total = 0;
  for (const rule of SYNERGY_RULES) {
    if (rule.bonusTarget !== target) continue;
    if (!matchesTypeList(hex.buildingId, rule.sourceTypes)) continue;
    total += getSynergyBonusValue(planet, hexIndex, rule);
  }
  return total;
}

/**
 * R-SYNERGY §processing: множитель скорости производства для здания-гекса.
 *
 * 1 + Σ processing_speed-вкладов. Применяется в processProductionQueue
 * к скорости прогресса очереди. (Активные правила с этой метрикой
 * отложены как кросс-типовые — Задача 24; хелпер сохранён для будущего.)
 */
export function getProcessingSpeedMultiplier(planet: Planet, hexIndex: number): number {
  return 1 + getSynergyContribution(planet, hexIndex, 'processing_speed');
}

/**
 * R-SYNERGY §power: множитель энергопотребления здания-гекса.
 *
 * 1 + Σ energy_consumption-вкладов (value отрицательный → множитель < 1).
 * Пример: лаборатория смежна с 2 электростанциями:
 *   1 + (−0.05 + −0.05×0.5) = 1 − 0.075 = 0.925 → −7.5% энергопотребления.
 * Ограничен снизу нулём (энергия не может стать отрицательной).
 */
export function getEnergyConsumptionMultiplier(planet: Planet, hexIndex: number): number {
  const mult = 1 + getSynergyContribution(planet, hexIndex, 'energy_consumption');
  return Math.max(0, mult);
}

/**
 * R-SYNERGY v2 §generation (Задача 24, power_boost): множитель выработки
 * энергии генератора-гекса.
 *
 * 1 + Σ energy_generation-вкладов (электростанция получает +5% выработки
 * за каждого смежного потребителя, стекинг ×0.5^(n-1)).
 * Пример: солнечная станция смежна с 2 потребителями:
 *   1 + 0.05 + 0.05×0.5 = 1.075 → +7.5% выработки.
 */
export function getEnergyGenerationMultiplier(planet: Planet, hexIndex: number): number {
  return 1 + getSynergyContribution(planet, hexIndex, 'energy_generation');
}

/**
 * R-SYNERGY v2 §mining (Задача 24, mining_cluster): множитель скорости
 * добычи экстрактора-гекса.
 *
 * 1 + Σ mining_speed-вкладов (шахты одного подтипа ускоряют добычу друг
 * друга: +10% за смежную, стекинг ×0.5^(n-1)).
 * Пример: шахта смежна с 2 шахтами:
 *   1 + 0.1 + 0.1×0.5 = 1.15 → +15% скорости добычи.
 */
export function getMiningSpeedMultiplier(planet: Planet, hexIndex: number): number {
  return 1 + getSynergyContribution(planet, hexIndex, 'mining_speed');
}

/**
 * R-SYNERGY §research: агрегат кластеров лабораторий (по всем гексам планеты).
 *
 * Семантика docs §5.1/§5.4 — ПОВЕРХ лаборатории: «каждая лаборатория
 * получает +10% от каждого смежного коллеги (стекинг ×0.5^(n-1))».
 * Возврат — ПАРА для агрегации по империи в bonus-resolver:
 *   - boostSum  — Σ вкладов лабораторий поверхности (каждая считает
 *                 СВОИХ смежных); слоты смежности не имеют → 0.
 *   - labCount  — ВСЕ лаборатории планеты (гексы + атмосферные + орбитальные
 *                 слоты) — знаменатель среднего.
 *
 * Агрегат = boostSum / labCount — средний буст лаборатории планеты.
 * НЕ суммировать по планетам напрямую (буст глобальный, а лаборатории
 * распределены по империи): resolver делит Σ boostSum на Σ labCount.
 *
 * Примеры (docs §5.4):
 *   - 2 смежные лаборатории (больше нет): 0.1+0.1 / 2 = +10% агрегат.
 *   - кластер 2×2 (угловые по 2 смежных): Σ = 4×0.15 = 0.6, /4 = +15%.
 *   - кластер + изолированные лаборатории: изолированные разбавляют среднее
 *     (их вклад 0, но они в знаменателе) — ровно как в «на каждую»-семантике.
 */
export function getLabClusterBoost(planet: Planet): { boostSum: number; labCount: number } {
  let boostSum = 0;
  let labCount = 0;
  planet.hexes.forEach((hex: HexCell, i) => {
    if (hex.buildingId !== 'laboratory' || hex.buildingLevel < 1) return;
    labCount++;
    boostSum += getSynergyContribution(planet, i, 'research_rate');
  });
  // Слот-лаборатории: смежности нет → вклад 0, но в знаменателе участвуют.
  for (const slot of planet.atmosphericSlots) {
    if (slot.buildingId === 'laboratory' && slot.buildingLevel > 0) labCount++;
  }
  for (const slot of planet.orbitSlots) {
    if (slot.buildingId === 'laboratory' && slot.buildingLevel > 0) labCount++;
  }
  return { boostSum, labCount };
}

/**
 * R-SYNERGY (UI): текстовое описание активных синергий гекса.
 * Возвращает список правил, дающих ненулевой бонус данному зданию
 * (для диалога здания — «Синергия: +26% переработка от 3 шахт»).
 */
export function getActiveSynergiesForHex(
  planet: Planet,
  hexIndex: number,
): Array<{ rule: SynergyRule; neighbors: number; bonus: number }> {
  const hex = planet.hexes[hexIndex];
  if (!hex || !isBuilt(hex)) return [];
  const result: Array<{ rule: SynergyRule; neighbors: number; bonus: number }> = [];
  for (const rule of SYNERGY_RULES) {
    if (!matchesTypeList(hex.buildingId, rule.sourceTypes)) continue;
    const neighbors = countSynergyNeighbors(planet, hexIndex, rule);
    if (neighbors === 0) continue;
    result.push({ rule, neighbors, bonus: getSynergyBonusValue(planet, hexIndex, rule) });
  }
  return result;
}
