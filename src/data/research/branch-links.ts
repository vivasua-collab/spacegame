/**
 * Block 03 (R1): BranchLinks — связи фундаментал ↔ специализированная ветка.
 *
 * Источник: docs/research-unification.md §7.2 + plan §2.3.
 *
 * 8 связей для MVP-среза:
 *   primary (5)  — fundamental «открывает» specialized (потолок ≤ fundamentalLevel)
 *   secondary (1) — fundamental ограничивает specialized сверху (×1.5)
 *   partial (2)   — fundamental даёт partial-бонус (+5%/ур.) без потолка
 *
 * Полная таблица (по §2.3 плана):
 *   | Fundamental       | Specialized | Type     |
 *   |-------------------|-------------|----------|
 *   | chemistry         | materials   | primary  |
 *   | chemistry         | computing   | partial  |
 *   | physics           | power       | primary  |
 *   | engineering       | materials   | secondary|
 *   | engineering       | weapons     | partial  |
 *   | biology_fund      | biology     | primary  |
 *   | military_science  | weapons     | primary  |
 *   | (xenoarchaeology) | xenoarch    | primary  | ← Etap 4
 *
 * Ксеноархеология не входит в MVP — даём 7 активных связей + 1 для будущего.
 */

import type { BranchLink } from '@/core/types';

export const BRANCH_LINKS: BranchLink[] = [
  // ─── Materials ──────────────────────────────────────────
  { fundamentalId: 'chemistry', specializedId: 'materials', linkType: 'primary' },
  { fundamentalId: 'engineering', specializedId: 'materials', linkType: 'secondary' },
  // ─── Power ─────────────────────────────────────────────
  { fundamentalId: 'physics', specializedId: 'power', linkType: 'primary' },
  // ─── Computing (свободная ветка — нет primary; partial от chemistry) ──
  { fundamentalId: 'chemistry', specializedId: 'computing', linkType: 'partial' },
  // ─── Weapons ───────────────────────────────────────────
  { fundamentalId: 'military_science', specializedId: 'weapons', linkType: 'primary' },
  { fundamentalId: 'engineering', specializedId: 'weapons', linkType: 'partial' },
  // ─── Biology ───────────────────────────────────────────
  { fundamentalId: 'biology_fund', specializedId: 'biology', linkType: 'primary' },
  // ─── Xenoarch (Etap 4 — ghost link) ────────────────────
  { fundamentalId: 'xenoarchaeology', specializedId: 'xenoarch', linkType: 'primary' },
];
