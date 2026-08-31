/**
 * R-SYNERGY v2 (Задача 24): тонкий loader правил Синергии + типизация.
 *
 * Источник истины: src/data/buildings/synergy.json
 * Спека: docs/40-buildings.md §5 (типовые бонусы, подтипы, стекинг
 * с убывающей отдачей ×0.5^(n-1)).
 *
 * ТИП здания — производная от category каталога (запрос владельца:
 * «разделить здания по типу — генерирующие, добывающие, перерабатывающие…»).
 * ПОДТИП = buildingId (solar_plant ≠ nuclear_reactor, mine ≠ quarry).
 *
 * Потребители:
 *   - src/economy/adjacency.ts — расчёт множителей по гексам (матчинг типов)
 *   - src/research/bonus-resolver.ts — research_rate (кластеры лабораторий)
 *   - src/economy/engine.ts — energy_generation / energy_consumption
 *     (recalcEnergyBalance), mining_speed (processExtraction)
 *   - scripts/validate-buildings.ts — валидация правил
 *
 * DATA-DRIVEN: добавление записи в rules[] автоматически включает новое
 * правило Синергии во всех точках интеграции. Публичный API:
 * SYNERGY_RULES, SYNERGY_RULES_BY_TARGET, SYNERGY_BUILDING_TYPES,
 * getSynergyBuildingType().
 */

import type { BuildingDef, SynergyRule } from '@/core/types';
import { BUILDING_MAP } from '@/data/buildings';
import synergyData from './synergy.json';

type SynergyFile = { comment?: string; rules: SynergyRule[] };

/** Все правила Синергии (data-driven из synergy.json). */
export const SYNERGY_RULES: SynergyRule[] = (synergyData as unknown as SynergyFile).rules;

/** Правила, сгруппированные по целевой метрике (O(1) выборка при интеграции). */
export const SYNERGY_RULES_BY_TARGET: Map<string, SynergyRule[]> = (() => {
  const map = new Map<string, SynergyRule[]>();
  for (const rule of SYNERGY_RULES) {
    const list = map.get(rule.bonusTarget);
    if (list) {
      list.push(rule);
    } else {
      map.set(rule.bonusTarget, [rule]);
    }
  }
  return map;
})();

// ─── Типы зданий для Синергии (Задача 24) ─────────────────────────────

/**
 * Категория каталога → тип Синергии. Типы — «функциональные роли» зданий:
 * генерирующие, добывающие, перерабатывающие и т.п.
 */
const CATEGORY_TO_TYPE: Record<string, string> = {
  energy: 'generator',      // генерирующие: solar_plant, nuclear_reactor
  extraction: 'extractor',  // добывающие: mine, quarry, gas_extractor, starlift_collector
  processing: 'processor',  // перерабатывающие: processor, synthesizer, refinery
  research: 'research',     // исследовательские: laboratory, deep_space_sensor
  logistics: 'storage',     // складские/логистика: warehouse, open_warehouse, spaceport
  production: 'production', // производственные: shipyard
  colonization: 'colony',   // колониальные: colony_hub
  military: 'military',     // военные (пока нет в каталоге)
};

/** Все допустимые типы в правилах Синергии. */
export const SYNERGY_BUILDING_TYPES: string[] = [
  ...Object.values(CATEGORY_TO_TYPE),
  'consumer', // псевдо-тип-роль: energyConsumption > 0 (заполняется динамически)
];

/**
 * Тип Синергии здания по buildingId (производная от category каталога).
 * @returns тип ('generator' | 'extractor' | …) или null — здание неизвестно.
 */
export function getSynergyBuildingType(buildingId: string | null): string | null {
  if (!buildingId) return null;
  const def: BuildingDef | undefined = BUILDING_MAP.get(buildingId);
  if (!def) return null;
  return CATEGORY_TO_TYPE[def.category] ?? null;
}

/**
 * true, если здание играет роль «потребителя энергии» (псевдо-тип 'consumer'):
 * energyConsumption > 0. Генераторы (solar/nuclear, eCon=0) не потребляют →
 * не матчатся → подтипы ЭС не дают бонусов друг другу (Задача 24).
 */
export function isEnergyConsumer(buildingId: string | null): boolean {
  if (!buildingId) return false;
  const def = BUILDING_MAP.get(buildingId);
  return def !== undefined && def.energyConsumption > 0;
}
