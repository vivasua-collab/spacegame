/**
 * Block 03 (R1): Фундаментальные ветки исследований.
 *
 * Источник: docs/00-ARCHITECTURE.md §3.2.1 + plan §2.3.
 *
 * В MVP включаем 5 фундаментальных веток (Ксеноархеология — Etap 4):
 *   - chemistry            → primary materials, partial computing
 *   - physics             → primary power
 *   - engineering          → secondary materials, partial weapons
 *   - biology_fund        → primary biology
 *   - military_science    → primary weapons
 *
 * Каждая ветка имеет базовую стоимость 200 RP и макс. уровень 10
 * (увеличивает потолок и partial-бонус для связанных специализированных).
 *
 * `xenoarchaeology` добавлена как «призрак» (disabled в UI MVP), чтобы
 * полный тип FundamentalBranchId был стабильным для будущего Etap 4.
 */

import type { FundamentalBranch, FundamentalBranchId } from '@/core/types';

export const FUNDAMENTAL_BRANCHES: FundamentalBranch[] = [
  {
    id: 'chemistry',
    name: 'Химия',
    nameEn: 'Chemistry',
    description: 'Основа материаловедения и вычислительной техники. Поднимает потолок ветки «Материалы» и даёт partial-бонус «Вычислениям».',
    baseCost: 200,
    maxLevel: 10,
  },
  {
    id: 'physics',
    name: 'Физика',
    nameEn: 'Physics',
    description: 'Основа энергетики. Поднимает потолок специализированной ветки «Энергия».',
    baseCost: 200,
    maxLevel: 10,
  },
  {
    id: 'engineering',
    name: 'Инженерия',
    nameEn: 'Engineering',
    description: 'Вторичный потолок для «Материалов» (×1.5) и partial-бонус для «Оружия».',
    baseCost: 200,
    maxLevel: 10,
  },
  {
    id: 'biology_fund',
    name: 'Биология (фундаментал)',
    nameEn: 'Biology (fundamental)',
    description: 'Поднимает потолок специализированной ветки «Биология» (гидропоника, терраформирование).',
    baseCost: 200,
    maxLevel: 10,
  },
  {
    id: 'military_science',
    name: 'Военные науки',
    nameEn: 'Military science',
    description: 'Поднимает потолок специализированной ветки «Оружие».',
    baseCost: 200,
    maxLevel: 10,
  },
  // «Призрак» для Etap 4 (Ксеноархеология). В UI MVP не отображается —
  // см. FUNDAMENTAL_BRANCHES_MVP ниже.
  {
    id: 'xenoarchaeology',
    name: 'Ксеноархеология',
    nameEn: 'Xenoarchaeology',
    description: 'Исследование древних артефактов и руин. Требует C2 short_range_sensors + B3. Активируется в Etap 4.',
    baseCost: 200,
    maxLevel: 10,
  },
];

/**
 * 5 фундаментальных веток MVP (без xenoarchaeology).
 * UI и engine работают только с этим списком — призрак не отображается.
 */
export const FUNDAMENTAL_BRANCHES_MVP: FundamentalBranch[] = FUNDAMENTAL_BRANCHES.filter(
  (b) => b.id !== 'xenoarchaeology',
);

export const FUNDAMENTAL_BRANCH_MAP: Map<FundamentalBranchId, FundamentalBranch> = new Map(
  FUNDAMENTAL_BRANCHES.map((b) => [b.id, b]),
);
