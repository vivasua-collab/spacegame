/**
 * Block 02 (F2): Конструктор кораблей — расчёт и валидация дизайна.
 *
 * MVP-реализация docs/50-ships.md §1.6 + Приложение B (validateShip).
 *
 * Функции:
 * - armorMultiplier(armor) — множители обшивки для HP/mass/cost (§2.3)
 * - validateShip(design, ctx) — проверить дизайн на 9 правил
 * - calculateDesignStats(design) — рассчитать DesignStats
 *
 * Логика чистая (без side-effects), тестируется unit-тестами.
 *
 * Phase 2.1 (stub): только armorMultiplier. Полная валидация и расчёт —
 * Phase 2.2 (F2).
 */

import type { HullArmorThickness, ShipDesign } from '@/core/types';

/**
 * Множители обшивки — docs/50-ships.md §2.3.
 *
 * light    : { hpMult: 1.00, massMult: 1.00, costMult: 1.00 }
 * standard : { hpMult: 1.25, massMult: 1.10, costMult: 1.20 }
 * thick    : { hpMult: 1.50, massMult: 1.25, costMult: 1.50 }
 * heavy    : { hpMult: 2.00, massMult: 1.50, costMult: 2.00 }
 *
 * hpMult   — применён к hull.baseHP → итоговый HP корпуса
 * massMult — применён к hull.baseMass + модули (масса обшивки)
 * costMult — применён к hull.baseCost (модули не множатся — у каждого свой cost)
 */
export function armorMultiplier(armor: HullArmorThickness): {
  hpMult: number;
  massMult: number;
  costMult: number;
} {
  switch (armor) {
    case 'light':
      return { hpMult: 1.0, massMult: 1.0, costMult: 1.0 };
    case 'standard':
      return { hpMult: 1.25, massMult: 1.1, costMult: 1.2 };
    case 'thick':
      return { hpMult: 1.5, massMult: 1.25, costMult: 1.5 };
    case 'heavy':
      return { hpMult: 2.0, massMult: 1.5, costMult: 2.0 };
    default: {
      // Defensive — impossible case (HullArmorThickness exhaustive above).
      const _exhaustive: never = armor;
      void _exhaustive;
      return { hpMult: 1.0, massMult: 1.0, costMult: 1.0 };
    }
  }
}

/**
 * Phase 2.1 placeholder: full validateShip + calculateDesignStats
 * added in Phase 2.2. Exposing the type here so other modules can reference it.
 */
export interface DesignStats {
  totalHS: number;
  usedHS: number;
  mass: number;
  speed: number;
  thrust: number;
  energyBalance: number;
  totalHP: number;
  shieldHP: number;
  cost: number;
  cargoCapacity: number;
  fuelCapacity: Record<string, number>;
  jumpRangeMass: number;
  commRange: number;
  scanRange: number;
  canJump: boolean;
  isValid: boolean;
  errors: string[];
}

/**
 * Phase 2.1 placeholder — реализация в Phase 2.2. Бросает, чтобы
 * предотвратить случайное использование до готовности.
 */
export function calculateDesignStats(_design: ShipDesign): DesignStats {
  throw new Error('calculateDesignStats not implemented — see Phase 2.2 (F2)');
}

/**
 * Phase 2.1 placeholder — реализация в Phase 2.2.
 */
export function validateShip(
  _design: ShipDesign,
  _ctx: { shipyardLevel: number; engineeringLevel: number; researchedTechs: string[] },
): { valid: boolean; errors: string[] } {
  throw new Error('validateShip not implemented — see Phase 2.2 (F2)');
}
