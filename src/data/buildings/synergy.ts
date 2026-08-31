/**
 * R-SYNERGY: тонкий loader правил Синергии (бонусы соседства).
 *
 * Источник истины: src/data/buildings/synergy.json
 * Спека: docs/40-buildings.md §5 (таблица комбинаций + стекинг с убывающей
 * отдачей ×0.5^(n-1)).
 *
 * Потребители:
 *   - src/economy/adjacency.ts — расчёт множителей по гексам
 *   - src/research/bonus-resolver.ts — research_rate (кластеры лабораторий)
 *   - src/economy/engine.ts — processing_speed (очередь производства),
 *     energy_consumption (recalcEnergyBalance)
 *   - scripts/validate-buildings.ts — валидация ссылок на каталог зданий
 *
 * DATA-DRIVEN: добавление записи в rules[] автоматически включает новое
 * правило Синергии во всех точках интеграции. Публичный API:
 * SYNERGY_RULES (массив), SYNERGY_RULES_BY_TARGET (группировка по метрике).
 */

import type { SynergyRule } from '@/core/types';
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
