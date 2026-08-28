/**
 * Block 03 (R1) — R-RES refactor: BranchLinks (data-driven JSON).
 *
 * Связи фундаментал ↔ специализированная ветка теперь хранятся во внешнем
 * data-файле `branch-links.json`. Этот файл — тонкий loader.
 *
 * Источник истины: src/data/research/branch-links.json
 */

import type { BranchLink } from '@/core/types';
import branchLinksData from './branch-links.json';

export const BRANCH_LINKS: BranchLink[] = branchLinksData as BranchLink[];
