/**
 * Block 03 (R1) — R-RES refactor: Фундаментальные ветки исследований (data-driven JSON).
 *
 * Фундаменталы теперь хранятся во внешнем data-файле `fundamentals.json`.
 * Этот файл — тонкий loader: импортирует JSON и экспортирует
 * типизированные объекты + хелперы (FUNDAMENTAL_BRANCH_MAP,
 * FUNDAMENTAL_BRANCHES_MVP).
 *
 * Источник истины: src/data/research/fundamentals.json
 */

import type { FundamentalBranch, FundamentalBranchId } from '@/core/types';
import fundamentalsData from './fundamentals.json';

export const FUNDAMENTAL_BRANCHES: FundamentalBranch[] = fundamentalsData as FundamentalBranch[];

/**
 * 5 фундаментальных веток MVP (без xenoarchaeology — Etap 4 «призрак»).
 * UI и engine работают только с этим списком — призрак не отображается.
 */
export const FUNDAMENTAL_BRANCHES_MVP: FundamentalBranch[] = FUNDAMENTAL_BRANCHES.filter(
  (b) => b.id !== 'xenoarchaeology',
);

export const FUNDAMENTAL_BRANCH_MAP: Map<FundamentalBranchId, FundamentalBranch> = new Map(
  FUNDAMENTAL_BRANCHES.map((b) => [b.id, b]),
);
