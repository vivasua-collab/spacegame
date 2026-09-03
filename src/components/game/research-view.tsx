'use client';

/**
 * Block 03 (R6): Research View — главное окно системы исследований.
 *
 * Layout (responsive):
 * - Left column (240px): 5 фундаментальных веток с текущим уровнем,
 *   RP-вложенным, кнопкой «+1 уровень» (открывает диалог подтверждения).
 * - Center (flex-1): 15 tech-карточек, сгруппированных по 5 веткам (P/M/W/C/B).
 *   Каждая карточка показывает цвет ветки, иконку, имя, текущий/макс уровень,
 *   прогресс-бар RP (если есть активный слот), статус (🟢/🔵/🟡/🔴/🔄),
 *   прекурсоры. Клик → модальное окно деталей с кнопкой «Начать исследование».
 * - Right column (320px): очередь исследований — активные слоты,
 *   ползунки аллокации (5..100%), RP/сек, ETA, кнопка «Распределить поровну».
 *
 * Все действия идут через useGameStore actions (startResearch, cancelResearch,
 * setAllocation, levelUpFundamental, autoAllocateSlots) — direct immer mutation
 * pattern (как cancelProduction в Phase 2.4 — MVP-упрощение, не требует
 * mediator round-trip). Tick processing (RP accumulation) — в Phase 3.7
 * ResearchModule через mediator + immer.produce.
 *
 * Цвета веток: BRANCH_COLORS из data/research/tech-tree.ts
 * (cyan для computing — design gaidlines избегают blue).
 *
 * Адаптив: при < 768px стек вертикально — fundamentals → tree → queue.
 */

import { useState, useMemo } from 'react';
import { useGameStore } from '@/stores/game-store';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import {
  FlaskConical,
  Atom,
  Wrench,
  Dna,
  Swords,
  ChevronUp,
  X,
  Plus,
  Scale,
  TrendingUp,
  Lock,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  TECH_TREE,
  TECH_MAP,
  BRANCH_COLORS,
} from '@/data/research/tech-tree';
import { FUNDAMENTAL_BRANCHES_MVP, FUNDAMENTAL_BRANCH_MAP } from '@/data/research/fundamental-branches';
import {
  getTechCost,
  getCumulativeCost,
  getTechStatus,
  getEffectiveMaxLevel,
  getPartialBonus,
  getMaxResearchSlots,
  countLaboratories,
  getTotalRPPerSec,
  getEffectiveRPPerSec,
  getAvailableRP,
  areAllFundamentalsMaxed,
  getResearchInflowSplit,
  type TechStatus,
} from '@/research/engine';
import { resolveBonuses } from '@/research/bonus-resolver';
import type {
  Technology,
  FundamentalBranchId,
  SpecializedBranchId,
  ResearchState,
  ResearchSlot,
} from '@/core/types';

// ============ Фундаментальные ветки — иконки ============

const FUNDAMENTAL_ICONS: Record<FundamentalBranchId, React.ReactNode> = {
  chemistry: <FlaskConical className="size-4 text-orange-400" />,
  physics: <Atom className="size-4 text-red-400" />,
  engineering: <Wrench className="size-4 text-amber-400" />,
  biology_fund: <Dna className="size-4 text-green-400" />,
  military_science: <Swords className="size-4 text-yellow-400" />,
  xenoarchaeology: <FlaskConical className="size-4 text-purple-400" />,
};

const FUNDAMENTAL_COLORS: Record<FundamentalBranchId, string> = {
  chemistry: 'text-orange-400',
  physics: 'text-red-400',
  engineering: 'text-amber-400',
  biology_fund: 'text-green-400',
  military_science: 'text-yellow-400',
  xenoarchaeology: 'text-purple-400',
};

// ============ Главный компонент ============

export function ResearchView() {
  const gameState = useGameStore((s) => s.gameState);
  const startResearch = useGameStore((s) => s.startResearch);
  const cancelResearch = useGameStore((s) => s.cancelResearch);
  const setAllocation = useGameStore((s) => s.setAllocation);
  const levelUpFundamental = useGameStore((s) => s.levelUpFundamental);
  const autoAllocateSlots = useGameStore((s) => s.autoAllocateSlots);
  const addToResearchQueue = useGameStore((s) => s.addToResearchQueue);
  const removeFromResearchQueue = useGameStore((s) => s.removeFromResearchQueue);
  const reorderResearchQueue = useGameStore((s) => s.reorderResearchQueue);
  const clearResearchQueue = useGameStore((s) => s.clearResearchQueue);

  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);

  const researchState = gameState?.researchState;

  // Подсчёт labs и totalRPPerSec — keyed на galaxy.systems (обновляется при
  // строительстве/апгрейде лабораторий).
  const { labCount, totalRPPerSec } = useMemo(() => {
    if (!gameState) return { labCount: 0, totalRPPerSec: 0 };
    const planets = gameState.galaxy.systems
      .flatMap((s) => s.planets)
      .filter((p) => p.owner != null);
    const { count } = countLaboratories(planets);
    // R-RES §E: применяем research_rate bonus (data-driven).
    const mult = resolveBonuses(gameState, 'research_rate');
    return {
      labCount: count,
      totalRPPerSec: getTotalRPPerSec(planets, mult),
    };
  }, [gameState]);

  const maxSlots = getMaxResearchSlots(labCount);

  // R-SPLIT (Задача 22): доля притока, идущая в дерево технологий
  // (слоты прогрессируют от неё; остаток — в аккумулятор фундаменталов).
  // ETA слотов и диалог старта считаются от techPerSec, не от полного притока.
  const { techPerSec } = researchState
    ? getResearchInflowSplit(researchState, totalRPPerSec)
    : { techPerSec: 0 };

  if (!gameState || !researchState) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        Игра не загружена.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3 p-2">
      {/* Top stats bar */}
      <ResearchStatsBar
        researchState={researchState}
        labCount={labCount}
        totalRPPerSec={totalRPPerSec}
        maxSlots={maxSlots}
        onAutoAllocate={autoAllocateSlots}
      />

      {/* Main 3-column layout */}
      <div className="flex flex-1 min-h-0 gap-3 flex-col lg:flex-row">
        {/* Left: Fundamental branches */}
        <aside className="lg:w-56 shrink-0">
          <Card className="bg-[#0d0d24] border-white/10 text-white">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wider">
                <Atom className="size-3.5" />
                Фундаменталы
              </div>
              {/* R-SPLIT: подсказка о разделении веток исследований. */}
              <div className="text-[10px] text-slate-600 leading-snug mt-1">
                {areAllFundamentalsMaxed(researchState)
                  ? 'Все фундаменталы изучены — 100% RP идёт в дерево технологий.'
                  : 'RP копятся в аккумуляторе; тратятся только сюда. Дерево технологий исследуется отдельно — напрямую от притока RP.'}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {FUNDAMENTAL_BRANCHES_MVP.map((branch) => (
                <FundamentalBranchCard
                  key={branch.id}
                  branchId={branch.id}
                  researchState={researchState}
                  onLevelUp={(id) => {
                    const ok = levelUpFundamental(id);
                    if (!ok) {
                      const b = FUNDAMENTAL_BRANCH_MAP.get(id);
                      const currentLevel = researchState.fundamentalLevels[id] ?? 0;
                      if (currentLevel >= (b?.maxLevel ?? 10)) {
                        toast({ title: 'Максимальный уровень', description: `${b?.name} уже на максимуме.` });
                      } else {
                        toast({
                          title: 'Недостаточно RP',
                          description: 'Постройте больше лабораторий для ускорения.',
                          variant: 'destructive',
                        });
                      }
                    } else {
                      toast({
                        title: 'Уровень повышен',
                        description: `${FUNDAMENTAL_BRANCH_MAP.get(id)?.name} → ур.${(researchState.fundamentalLevels[id] ?? 0) + 1}`,
                      });
                    }
                  }}
                />
              ))}
            </CardContent>
          </Card>
        </aside>

        {/* Center: Tech tree */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <Card className="bg-[#0d0d24] border-white/10 text-white h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wider">
                  <FlaskConical className="size-3.5" />
                  Дерево технологий (MVP: 15/72)
                </div>
                <div className="flex gap-1.5">
                  {(['power', 'materials', 'weapons', 'computing', 'biology'] as SpecializedBranchId[]).map((b) => (
                    <span
                      key={b}
                      className="inline-flex items-center gap-1 text-[10px] text-slate-400"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: BRANCH_COLORS[b] }}
                      />
                      {BRANCH_LABELS[b]}
                    </span>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <TechTreeGraph
                researchState={researchState}
                onSelectTech={setSelectedTechId}
              />
            </CardContent>
          </Card>
        </main>

        {/* Right: Research queue + queue list */}
        <aside className="lg:w-80 shrink-0">
          <ResearchQueuePanel
            researchState={researchState}
            techRPPerSec={techPerSec}
            maxSlots={maxSlots}
            onCancelSlot={cancelResearch}
            onSetAllocation={setAllocation}
            onAutoAllocate={autoAllocateSlots}
            onRemoveFromQueue={removeFromResearchQueue}
            onReorderQueue={reorderResearchQueue}
            onClearQueue={clearResearchQueue}
          />
        </aside>
      </div>

      {/* Detail dialog */}
      {selectedTechId && (
        <ResearchDetailDialog
          techId={selectedTechId}
          researchState={researchState}
          techRPPerSec={techPerSec}
          maxSlots={maxSlots}
          onClose={() => setSelectedTechId(null)}
          onStartResearch={(techId, targetLevel) => {
            const slotId = startResearch(techId, targetLevel);
            if (slotId) {
              const tech = TECH_MAP.get(techId);
              toast({
                title: 'Исследование запущено',
                description: `${tech?.name} → ур.${targetLevel}`,
              });
              setSelectedTechId(null);
            } else {
              const tech = TECH_MAP.get(techId);
              toast({
                title: 'Нельзя начать исследование',
                description: `${tech?.name}: проверьте прекурсоры / свободный слот.`,
                variant: 'destructive',
              });
            }
          }}
          onAddToQueue={(techId) => {
            const ok = addToResearchQueue(techId);
            const tech = TECH_MAP.get(techId);
            if (ok) {
              toast({
                title: 'Добавлено в очередь',
                description: `${tech?.name} поставлен в очередь исследований.`,
              });
              setSelectedTechId(null);
            } else {
              toast({
                title: 'Нельзя добавить в очередь',
                description: `${tech?.name}: уже в очереди / исследован / прекурсоры не готовы.`,
                variant: 'destructive',
              });
            }
          }}
        />
      )}
    </div>
  );
}

// ============ Stats bar ============

function ResearchStatsBar({
  researchState,
  labCount,
  totalRPPerSec,
  maxSlots,
  onAutoAllocate,
}: {
  researchState: ResearchState;
  labCount: number;
  totalRPPerSec: number;
  maxSlots: number;
  onAutoAllocate: () => void;
}) {
  const activeSlots = researchState.activeSlots.length;
  const availableRP = getAvailableRP(researchState);
  // R-SPLIT: статус распределения притока RP между ветками.
  const fundamentalsMaxed = areAllFundamentalsMaxed(researchState);
  const techIdle = activeSlots === 0 && researchState.researchQueue.length === 0;
  const inflowStatus = fundamentalsMaxed
    ? '100% в дерево'
    : techIdle
      ? '100% в банк'
      : `50% банк / 50% дерево`;
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-[#0d0d24] border border-white/10 rounded-lg text-xs text-slate-300">
      <div className="flex items-center gap-1.5">
        <FlaskConical className="size-3.5 text-cyan-400" />
        <span className="text-slate-500">Лаб.:</span>
        <span className="font-mono text-white">{labCount}</span>
      </div>
      <Separator orientation="vertical" className="h-4 bg-white/10" />
      <div className="flex items-center gap-1.5">
        <TrendingUp className="size-3.5 text-green-400" />
        <span className="text-slate-500">RP/День:</span>
        <span className="font-mono text-cyan-300">{totalRPPerSec.toFixed(1)}</span>
      </div>
      <Separator orientation="vertical" className="h-4 bg-white/10" />
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">Слотов:</span>
        <span className="font-mono text-white">
          {activeSlots}/{maxSlots}
        </span>
      </div>
      <Separator orientation="vertical" className="h-4 bg-white/10" />
      {/* R-SPLIT (Задача 22): аккумулятор RP — единственный банк для
          фундаментальных исследований. Параметр «Всего» (lifetime-счётчик
          totalRpGenerated) удалён из UI как не имеющий логического смысла.
          Ветки разделены: слоты дерева прогрессируют от притока напрямую. */}
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">Аккумулятор:</span>
        <span className="font-mono text-amber-300 font-semibold">
          {availableRP.toFixed(0)} RP
        </span>
      </div>
      <Separator orientation="vertical" className="h-4 bg-white/10" />
      {/* R-SPLIT: статус распределения притока RP (50/50, 100% банк при
          простое дерева, 100% дерево при изученных фундаменталах). */}
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">Приток:</span>
        <span className="font-mono text-cyan-400">
          {inflowStatus}
        </span>
      </div>
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] border-white/10 hover:bg-white/5"
        onClick={onAutoAllocate}
        disabled={activeSlots === 0}
      >
        <Scale className="size-3 mr-1" />
        Распределить поровну
      </Button>
    </div>
  );
}

// ============ Fundamental branch card ============

function FundamentalBranchCard({
  branchId,
  researchState,
  onLevelUp,
}: {
  branchId: FundamentalBranchId;
  researchState: ResearchState;
  onLevelUp: (id: FundamentalBranchId) => void;
}) {
  const branch = FUNDAMENTAL_BRANCH_MAP.get(branchId)!;
  const currentLevel = researchState.fundamentalLevels[branchId] ?? 0;
  const invested = researchState.fundamentalRpInvested[branchId] ?? 0;
  const isMax = currentLevel >= branch.maxLevel;
  const cost = getTechCost(branch.baseCost, currentLevel + 1);
  // R-SPLIT: аккумулятор — единственный источник для фундаменталов
  // (раньше считалось totalRpGenerated − totalInvested, что конфликтовало
  // со слотами дерева — двойной учёт).
  const availableRp = getAvailableRP(researchState);
  const canAfford = availableRp >= cost;

  return (
    <div
      className="rounded-lg border border-white/10 p-2 hover:border-white/20 transition-colors"
      title={branch.description}
    >
      <div className="flex items-center gap-2 mb-1">
        {FUNDAMENTAL_ICONS[branchId]}
        <span className={`text-sm font-medium ${FUNDAMENTAL_COLORS[branchId]}`}>
          {branch.name}
        </span>
        <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">
          {currentLevel}/{branch.maxLevel}
        </Badge>
      </div>
      <div className="text-[10px] text-slate-500 mb-1.5 line-clamp-2">
        {branch.description}
      </div>
      {isMax ? (
        <div className="text-[10px] text-emerald-400 text-center py-1">Максимум</div>
      ) : (
        <>
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-slate-500">След. ур.:</span>
            <span className={`font-mono ${canAfford ? 'text-slate-300' : 'text-red-400'}`}>
              {cost} RP
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full h-6 text-[10px] border-white/10 hover:bg-white/5"
            onClick={() => onLevelUp(branchId)}
            disabled={!canAfford}
          >
            <ChevronUp className="size-3 mr-1" />
            Повысить
          </Button>
        </>
      )}
      {invested > 0 && (
        <div className="text-[10px] text-slate-600 text-center mt-1">
          Вложено: {invested.toFixed(0)} RP
        </div>
      )}
    </div>
  );
}

// ============ Tech tree graph (horizontal, scroll-right) ============

const BRANCH_LABELS: Record<SpecializedBranchId, string> = {
  power: 'Энергия',
  materials: 'Материалы',
  weapons: 'Оружие',
  computing: 'Вычисления',
  biology: 'Биология',
  xenoarch: 'Ксеноархеология',
};

// Layout constants — fixed node size lets us compute pixel coordinates
// for SVG bezier connectors without measuring DOM nodes.
const NODE_W = 200;
const NODE_H = 96;
const INTRA_GAP = 8;       // vertical gap between stacked nodes in same (branch, depth) cell
const COL_GAP = 88;        // horizontal gap between depth columns (room for bezier curves + arrowheads)
const BRANCH_GAP = 26;     // vertical gap between branch lanes
const LEFT_PAD = 64;       // left padding (room for branch lane labels)
const TOP_PAD = 24;        // top padding (room for tier headers)
const RIGHT_PAD = 28;
const BOTTOM_PAD = 14;

// R-RES §F: minimum canvas width — computed dynamically from tech count
// to auto-scale the tree window when new techs are added to techs.json.
// Formula: LEFT_PAD + (maxDepth + 1) × (NODE_W + COL_GAP) + RIGHT_PAD.
// The canvas grows naturally as more techs are added; on small trees we
// still enforce a minimum of 1 viewport of horizontal scroll so the
// "scroll right to discover" UX is visible. 1024 ≈ typical mobile/tablet
// landscape width; desktop will fit more columns without scroll.
const MIN_TREE_WIDTH_FLOOR = 1024;

// Colors for edge states (Task 4 spec: bright vs dim by prerequisite status).
// Met edges use the source branch color (bright); unmet edges use slate-600.
const EDGE_COLOR_UNMET = '#475569'; // slate-600 — visible but muted on #0d0d24

const TREE_BRANCHES: SpecializedBranchId[] = [
  'power', 'materials', 'weapons', 'computing', 'biology',
];

interface NodePos { x: number; y: number; col: number; rowIdx: number; }
interface TreeLink {
  path: string;
  color: string;      // source-branch color (BRANCH_COLORS[fromTech.branch])
  met: boolean;       // whether `from` tech has reached the required minLevel
  fromBranch: SpecializedBranchId;
}
interface BranchRowInfo { branch: SpecializedBranchId; yOffset: number; height: number; }
interface TreeLayout {
  positions: Map<string, NodePos>;
  links: TreeLink[];
  branchRows: BranchRowInfo[];
  totalWidth: number;
  totalHeight: number;
  maxDepth: number;
}

// Depth (longest path from roots) — memoized once per tech.
// Tech tree is a DAG (no cycles by design), but we set a tentative 0
// before recursing to break any accidental cycle.
const depthMemo = new Map<string, number>();
function techDepth(techId: string): number {
  const cached = depthMemo.get(techId);
  if (cached !== undefined) return cached;
  const tech = TECH_MAP.get(techId);
  if (!tech) return 0;
  depthMemo.set(techId, 0); // cycle guard
  let d = 0;
  if (tech.prerequisites.length > 0) {
    let max = 0;
    for (const p of tech.prerequisites) {
      const pd = techDepth(p.techId);
      if (pd > max) max = pd;
    }
    d = max + 1;
  }
  depthMemo.set(techId, d);
  return d;
}

/**
 * Compute a static layout for the tech-tree graph.
 * - Rows = specialized branches (5 lanes, top→bottom).
 * - Columns = depth (longest prerequisite path). Roots at col 0, dependants
 *   open to the right → horizontal scroll reveals deeper tiers.
 * - Within a (branch, depth) cell, multiple techs stack vertically.
 * - Connectors are cubic-bezier S-curves from each prereq's right-center
 *   to its dependant's left-center. Cross-branch prereqs draw curves that
 *   span multiple lanes — visually showing the inter-branch dependency.
 *
 * Only `links[].met` depends on researchState; positions are topology-only.
 * For 15 MVP techs this is trivial to recompute on each state change.
 */
function buildTreeLayout(researchState: ResearchState): TreeLayout {
  // Group techs by (branch, depth). Skip xenoarch (Etape 4).
  const cells = new Map<string, Technology[]>();
  let maxDepth = 0;
  for (const tech of TECH_TREE) {
    if (tech.branch === 'xenoarch') continue;
    const d = techDepth(tech.id);
    if (d > maxDepth) maxDepth = d;
    const key = `${tech.branch}:${d}`;
    let arr = cells.get(key);
    if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(tech);
  }
  for (const arr of cells.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);

  // Branch lane: yOffset + height (height = tallest cell in that branch).
  const branchRows: BranchRowInfo[] = [];
  let yCursor = TOP_PAD;
  for (const branch of TREE_BRANCHES) {
    let maxCellCount = 1;
    for (let d = 0; d <= maxDepth; d++) {
      const arr = cells.get(`${branch}:${d}`);
      if (arr && arr.length > maxCellCount) maxCellCount = arr.length;
    }
    const height = maxCellCount * NODE_H + (maxCellCount - 1) * INTRA_GAP;
    branchRows.push({ branch, yOffset: yCursor, height });
    yCursor += height + BRANCH_GAP;
  }
  const totalHeight = yCursor - BRANCH_GAP + BOTTOM_PAD;

  // Node positions.
  const positions = new Map<string, NodePos>();
  for (const branch of TREE_BRANCHES) {
    const row = branchRows.find((r) => r.branch === branch);
    if (!row) continue;
    const rIdx = TREE_BRANCHES.indexOf(branch);
    for (let d = 0; d <= maxDepth; d++) {
      const arr = cells.get(`${branch}:${d}`);
      if (!arr) continue;
      arr.forEach((tech, i) => {
        const x = LEFT_PAD + d * (NODE_W + COL_GAP);
        const y = row.yOffset + i * (NODE_H + INTRA_GAP);
        positions.set(tech.id, { x, y, col: d, rowIdx: rIdx });
      });
    }
  }

  const totalWidth = LEFT_PAD + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP + RIGHT_PAD;

  // Bezier connectors — one per prerequisite edge.
  // Path: cubic-bezier S-curve from source's right-center to dest's left-center.
  // Color: source-branch color (BRANCH_COLORS[fromTech.branch]) per Task 4 spec.
  // met: whether source tech has reached the prerequisite's required minLevel.
  // Arrowhead (markerEnd) is added in the SVG render layer below.
  const links: TreeLink[] = [];
  for (const tech of TECH_TREE) {
    if (tech.branch === 'xenoarch') continue;
    const depPos = positions.get(tech.id);
    if (!depPos) continue;
    const dx = depPos.x;
    const dy = depPos.y + NODE_H / 2;
    for (const p of tech.prerequisites) {
      const pp = positions.get(p.techId);
      if (!pp) continue;
      const fromTech = TECH_MAP.get(p.techId);
      if (!fromTech) continue;
      const px = pp.x + NODE_W;
      const py = pp.y + NODE_H / 2;
      const midX = (px + dx) / 2;
      const path = `M ${px},${py} C ${midX},${py} ${midX},${dy} ${dx},${dy}`;
      const curLevel = researchState.researched[p.techId] ?? 0;
      const met = curLevel >= p.minLevel;
      links.push({
        path,
        color: BRANCH_COLORS[fromTech.branch],
        met,
        fromBranch: fromTech.branch,
      });
    }
  }

  return { positions, links, branchRows, totalWidth, totalHeight, maxDepth };
}

function TechTreeGraph({
  researchState,
  onSelectTech,
}: {
  researchState: ResearchState;
  onSelectTech: (techId: string) => void;
}) {
  const layout = useMemo(() => buildTreeLayout(researchState), [researchState]);
  // R-RES §F: auto-scale canvas width from tech count + layout.
  // totalWidth is computed in buildTreeLayout from maxDepth × NODE_W + gaps,
  // so adding techs to techs.json automatically widens the canvas.
  // Floor at MIN_TREE_WIDTH_FLOOR to keep horizontal scroll on small trees.
  const canvasWidth = Math.max(layout.totalWidth, MIN_TREE_WIDTH_FLOOR);
  const canvasHeight = layout.totalHeight;

  return (
    <div className="overflow-x-auto overflow-y-auto custom-scrollbar max-h-[calc(100vh-220px)] rounded-md border border-white/5 bg-black/20">
      <div
        className="relative"
        style={{ width: canvasWidth, height: canvasHeight, minWidth: MIN_TREE_WIDTH_FLOOR }}
      >
        {/* SVG connector layer — drawn behind nodes */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={canvasWidth}
          height={canvasHeight}
          style={{ overflow: 'visible' }}
          aria-hidden="true"
        >
          {/* Arrowhead markers — one per edge state (met uses source color via
              context-stroke; unmet uses slate-600 via context-stroke). */}
          <defs>
            <marker
              id="tech-edge-arrow-met"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
            <marker
              id="tech-edge-arrow-unmet"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {layout.links.map((link, i) => {
            const stroke = link.met ? link.color : EDGE_COLOR_UNMET;
            return (
              <path
                key={i}
                d={link.path}
                stroke={stroke}
                strokeWidth={link.met ? 2.2 : 1.2}
                fill="none"
                strokeDasharray={link.met ? undefined : '5 4'}
                opacity={link.met ? 0.85 : 0.55}
                strokeLinecap="round"
                markerEnd={link.met ? 'url(#tech-edge-arrow-met)' : 'url(#tech-edge-arrow-unmet)'}
              />
            );
          })}
        </svg>

        {/* Tier (depth) column headers — top gutter */}
        {Array.from({ length: layout.maxDepth + 1 }, (_, d) => (
          <div
            key={d}
            className="absolute text-[9px] text-slate-600 select-none uppercase tracking-wider"
            style={{ left: LEFT_PAD + d * (NODE_W + COL_GAP), top: 4 }}
          >
            {d === 0 ? 'Tier I · базы' : d === 1 ? 'Tier II' : d === 2 ? 'Tier III' : `Tier ${d + 1}`}
          </div>
        ))}

        {/* Branch lane labels — left gutter */}
        {layout.branchRows.map((row) => (
          <div
            key={row.branch}
            className="absolute flex items-center gap-1 select-none"
            style={{ left: 6, top: row.yOffset + row.height / 2, transform: 'translateY(-50%)' }}
          >
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: BRANCH_COLORS[row.branch] }}
            />
            <span
              className="text-[9px] uppercase tracking-wider font-medium whitespace-nowrap"
              style={{ color: BRANCH_COLORS[row.branch] }}
            >
              {BRANCH_LABELS[row.branch]}
            </span>
          </div>
        ))}

        {/* Tech nodes */}
        {TECH_TREE.filter((t) => t.branch !== 'xenoarch').map((tech) => {
          const pos = layout.positions.get(tech.id);
          if (!pos) return null;
          return (
            <div
              key={tech.id}
              className="absolute"
              style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
            >
              <TechCard
                tech={tech}
                researchState={researchState}
                branchColor={BRANCH_COLORS[tech.branch]}
                onClick={() => onSelectTech(tech.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ Tech card ============

function TechCard({
  tech,
  researchState,
  branchColor,
  onClick,
}: {
  tech: Technology;
  researchState: ResearchState;
  branchColor: string;
  onClick: () => void;
}) {
  const { status, currentLevel, ceiling, inProgress } = getTechStatus(tech, researchState);
  const activeSlot = researchState.activeSlots.find((s) => s.techId === tech.id);
  const cost = getTechCost(tech.baseCost, currentLevel + 1);
  const invested = activeSlot?.rpInvested ?? 0;
  const progress = cost > 0 ? Math.min(100, (invested / cost) * 100) : 0;

  const statusIcon = getStatusIcon(status);
  const statusColor = getStatusColor(status);
  const borderColor = inProgress ? `${branchColor}` : 'rgba(255,255,255,0.1)';

  return (
    <button
      onClick={onClick}
      className="h-full w-full flex flex-col text-left rounded-lg border p-2 transition-all hover:bg-white/5 overflow-hidden"
      style={{ borderColor }}
    >
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <span className="text-xs font-medium truncate min-w-0" style={{ color: branchColor }} title={tech.name}>
          {tech.name}
        </span>
        <span style={{ color: statusColor }} className="shrink-0">{statusIcon}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span>Ур. {currentLevel}/{tech.maxLevel}</span>
        {ceiling !== Infinity && ceiling < tech.maxLevel && (
          <span className="text-amber-500/70">↑≤{ceiling}</span>
        )}
      </div>
      {activeSlot && (
        <div className="space-y-0.5 mt-1">
          <Progress value={progress} className="h-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>{invested.toFixed(0)}/{cost}</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
        </div>
      )}
      {tech.prerequisites.length > 0 && (() => {
        const metCount = tech.prerequisites.filter(
          (p) => (researchState.researched[p.techId] ?? 0) >= p.minLevel,
        ).length;
        const total = tech.prerequisites.length;
        const allMet = metCount === total;
        return (
          <div className={`text-[10px] mt-auto pt-0.5 ${allMet ? 'text-emerald-500/70' : 'text-slate-500'}`}>
            Прекурсоры: {metCount}/{total}{allMet ? ' ✓' : ''}
          </div>
        );
      })()}
    </button>
  );
}

function getStatusIcon(status: TechStatus): React.ReactNode {
  switch (status) {
    case 'researched':
      return <CheckCircle2 className="size-3.5" />;
    case 'in_progress':
      return <Loader2 className="size-3.5 animate-spin" />;
    case 'available':
      return <Circle className="size-3.5" />;
    case 'ceiling_reached':
      return <AlertTriangle className="size-3.5" />;
    case 'locked':
      return <Lock className="size-3.5" />;
  }
}

function getStatusColor(status: TechStatus): string {
  switch (status) {
    case 'researched':
      return '#22c55e'; // green-500
    case 'in_progress':
      return '#06b6d4'; // cyan-500
    case 'available':
      return '#64748b'; // slate-500
    case 'ceiling_reached':
      return '#eab308'; // yellow-500
    case 'locked':
      return '#ef4444'; // red-500
  }
}

// ============ Research queue panel ============

function ResearchQueuePanel({
  researchState,
  techRPPerSec,
  maxSlots,
  onCancelSlot,
  onSetAllocation,
  onAutoAllocate,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
}: {
  researchState: ResearchState;
  /** R-SPLIT: RP/сек, доступные ветке дерева (доля притока после split). */
  techRPPerSec: number;
  maxSlots: number;
  onCancelSlot: (slotId: string) => boolean;
  onSetAllocation: (slotId: string, percent: number) => boolean;
  onAutoAllocate: () => void;
  onRemoveFromQueue: (index: number) => boolean;
  onReorderQueue: (from: number, to: number) => boolean;
  onClearQueue: () => void;
}) {
  const activeSlots = researchState.activeSlots;
  const activeSlotsCount = activeSlots.length;
  const focusBonus = activeSlotsCount === 1 && activeSlots[0]?.allocationPercent === 100;
  const queue = researchState.researchQueue;

  return (
    <Card className="bg-[#0d0d24] border-white/10 text-white h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wider">
            <Loader2 className="size-3.5" />
            Очередь
          </div>
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {activeSlotsCount}/{maxSlots}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          {/* R-SPLIT: RP/день, доступные ветке ДЕРЕВА (не полный приток). */}
          <span title="Доля притока RP, идущая в дерево технологий (R-SPLIT)">
            RP/День → дерево: {techRPPerSec.toFixed(1)}
          </span>
          {focusBonus && (
            <Badge className="ml-1 text-[9px] h-3.5 px-1 bg-cyan-900/50 text-cyan-300 border-cyan-800">
              Фокус ×1.2
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar max-h-[calc(100vh-220px)]">
        {/* Active research (top) */}
        <div className="mb-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Активное исследование
          </div>
          {activeSlots.length === 0 ? (
            <div className="text-center text-xs text-slate-600 py-4 italic rounded border border-dashed border-white/10">
              Нет активного исследования.
              <br />
              Выберите технологию в дереве и нажмите «В очередь».
            </div>
          ) : (
            <div className="space-y-2">
              {activeSlots.map((slot) => (
                <ResearchSlotRow
                  key={slot.slotId}
                  slot={slot}
                  researchState={researchState}
                  techRPPerSec={techRPPerSec}
                  activeSlotsCount={activeSlotsCount}
                  onCancel={onCancelSlot}
                  onSetAllocation={onSetAllocation}
                />
              ))}
            </div>
          )}
          {activeSlots.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2 text-[10px] text-slate-500 hover:bg-white/5"
              onClick={onAutoAllocate}
            >
              <Scale className="size-3 mr-1" />
              Распределить поровну
            </Button>
          )}
        </div>

        {/* Queue (below) — R-RES §B */}
        <div className="border-t border-white/10 pt-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Очередь ({queue.length})
            </div>
            {queue.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] text-slate-500 hover:text-red-300 hover:bg-white/5 px-1"
                onClick={onClearQueue}
                title="Очистить очередь"
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
          {queue.length === 0 ? (
            <div className="text-center text-[11px] text-slate-600 py-3 italic">
              Очередь пуста.
            </div>
          ) : (
            <div className="space-y-1">
              {queue.map((techId, idx) => (
                <QueueRow
                  key={`${techId}_${idx}`}
                  techId={techId}
                  index={idx}
                  queueLength={queue.length}
                  researchState={researchState}
                  onRemove={onRemoveFromQueue}
                  onReorder={onReorderQueue}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function QueueRow({
  techId,
  index,
  queueLength,
  researchState,
  onRemove,
  onReorder,
}: {
  techId: string;
  index: number;
  queueLength: number;
  researchState: ResearchState;
  onRemove: (index: number) => boolean;
  onReorder: (from: number, to: number) => boolean;
}) {
  const tech = TECH_MAP.get(techId);
  if (!tech) {
    return (
      <div className="rounded border border-red-500/30 p-1.5 text-[11px] text-red-400 flex items-center justify-between">
        Неизв. {techId}
        <button onClick={() => onRemove(index)} className="text-slate-500 hover:text-red-400">
          <X className="size-3" />
        </button>
      </div>
    );
  }
  const currentLevel = researchState.researched[techId] ?? 0;
  const targetLevel = currentLevel + 1;
  return (
    <div
      className="rounded border bg-white/[0.02] p-1.5 flex items-center gap-1.5 hover:bg-white/5 transition-colors"
      style={{ borderColor: `${BRANCH_COLORS[tech.branch]}30` }}
    >
      <span className="text-[10px] font-mono text-slate-600 w-4 shrink-0">{index + 1}.</span>
      <span
        className="size-1.5 rounded-full shrink-0"
        style={{ backgroundColor: BRANCH_COLORS[tech.branch] }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] truncate" style={{ color: BRANCH_COLORS[tech.branch] }} title={tech.name}>
          {tech.name}
        </div>
        <div className="text-[10px] text-slate-600">
          цель ур. {targetLevel} (из {tech.maxLevel})
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={() => index > 0 && onReorder(index, index - 1)}
          disabled={index === 0}
          className="text-slate-500 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Переместить вверх"
          title="Переместить вверх"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          onClick={() => index < queueLength - 1 && onReorder(index, index + 1)}
          disabled={index === queueLength - 1}
          className="text-slate-500 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed rotate-180"
          aria-label="Переместить вниз"
          title="Переместить вниз"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          onClick={() => onRemove(index)}
          className="text-slate-500 hover:text-red-400"
          aria-label="Удалить из очереди"
          title="Удалить из очереди"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

function ResearchSlotRow({
  slot,
  researchState,
  techRPPerSec,
  activeSlotsCount,
  onCancel,
  onSetAllocation,
}: {
  slot: ResearchSlot;
  researchState: ResearchState;
  /** R-SPLIT: RP/сек ветки дерева (доля притока после split). */
  techRPPerSec: number;
  activeSlotsCount: number;
  onCancel: (slotId: string) => boolean;
  onSetAllocation: (slotId: string, percent: number) => boolean;
}) {
  const tech = TECH_MAP.get(slot.techId);
  if (!tech) {
    return (
      <div className="rounded border border-red-500/30 p-2 text-xs text-red-400">
        Неизвестная технология: {slot.techId}
      </div>
    );
  }

  const cost = getTechCost(tech.baseCost, slot.targetLevel);
  const invested = slot.rpInvested;
  const progress = cost > 0 ? Math.min(100, (invested / cost) * 100) : 0;
  const remaining = Math.max(0, cost - invested);
  const partialBonus = getPartialBonus(tech.branch, researchState.fundamentalLevels);
  const effectiveRP = getEffectiveRPPerSec(
    techRPPerSec,
    slot.allocationPercent,
    activeSlotsCount,
  ) * partialBonus;
  const etaSec = effectiveRP > 0 ? remaining / effectiveRP : Infinity;
  // R-RES §C: 1 tick = 1 day → ETA in days. Was "сек" before.
  const etaText = etaSec === Infinity ? '∞' : `${etaSec.toFixed(0)} дн`;

  return (
    <div
      className="rounded-lg border border-cyan-500/30 bg-cyan-950/10 p-2"
      style={{ borderColor: `${BRANCH_COLORS[tech.branch]}40` }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="size-1.5 rounded-full shrink-0"
            style={{ backgroundColor: BRANCH_COLORS[tech.branch] }}
          />
          <span className="text-xs font-medium truncate" style={{ color: BRANCH_COLORS[tech.branch] }}>
            {tech.name}
          </span>
        </div>
        <button
          onClick={() => onCancel(slot.slotId)}
          className="text-slate-500 hover:text-red-400 transition-colors"
          aria-label="Отменить"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span>Цель: ур. {slot.targetLevel}</span>
        <span>{etaText}</span>
      </div>
      <Progress value={progress} className="h-1.5 mb-1" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
      <div className="flex justify-between text-[10px] text-slate-500 mb-2">
        <span>{invested.toFixed(0)}/{cost} RP</span>
        <span>×{partialBonus.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-slate-500 w-10">Аллок:</span>
        <Slider
          value={[slot.allocationPercent]}
          min={5}
          max={100}
          step={5}
          onValueChange={(vals) => {
            const v = vals[0];
            if (v !== undefined) onSetAllocation(slot.slotId, v);
          }}
          className="flex-1"
        />
        <span className="text-cyan-300 w-8 text-right font-mono">
          {slot.allocationPercent}%
        </span>
      </div>
    </div>
  );
}

// ============ Research detail dialog ============

function ResearchDetailDialog({
  techId,
  researchState,
  techRPPerSec,
  maxSlots,
  onClose,
  onStartResearch,
  onAddToQueue,
}: {
  techId: string;
  researchState: ResearchState;
  /** R-SPLIT: RP/сек ветки дерева (доля притока после split). */
  techRPPerSec: number;
  maxSlots: number;
  onClose: () => void;
  onStartResearch: (techId: string, targetLevel: number) => void;
  onAddToQueue: (techId: string) => void;
}) {
  const tech = TECH_MAP.get(techId);
  if (!tech) return null;

  const { status, currentLevel, ceiling } = getTechStatus(tech, researchState);
  const targetLevel = currentLevel + 1;
  const cost = getTechCost(tech.baseCost, targetLevel);
  const cumulativeCost = getCumulativeCost(tech.baseCost, targetLevel);
  const branchCeiling = getEffectiveMaxLevel(tech.branch, researchState.fundamentalLevels);
  const partialBonus = getPartialBonus(tech.branch, researchState.fundamentalLevels);
  const isMaxed = currentLevel >= tech.maxLevel;
  // R-RES §A: ceiling is now always = tech.maxLevel, so this never blocks
  // for non-maxed techs. Kept for safety.
  const ceilingBlocked = !isMaxed && ceiling < targetLevel;
  const activeSlotsCount = researchState.activeSlots.length;
  const noFreeSlot = activeSlotsCount >= maxSlots;
  const alreadyInQueue = researchState.researchQueue.includes(techId);
  const hasActiveSlot = researchState.activeSlots.some((s) => s.techId === techId);

  // Проверка через canStartResearch — нужна totalLabCount, считаем её налету.
  // Для UI мы делаем упрощённую проверку: показываем reason tooltip если нельзя.
  const prereq = tech.prerequisites.map((p) => {
    const cur = researchState.researched[p.techId] ?? 0;
    return {
      techId: p.techId,
      required: p.minLevel,
      current: cur,
      met: cur >= p.minLevel,
    };
  });
  const allPrereqMet = prereq.every((p) => p.met);

  const canStart =
    !isMaxed &&
    !ceilingBlocked &&
    allPrereqMet &&
    !noFreeSlot &&
    status !== 'in_progress';

  // R-RES §B: queue eligibility — prerequisites must be met (or tech will
  // wait at the front of the queue until prerequisites are researched).
  // Disable button if tech is already maxed, already in queue, or has
  // an active slot.
  const canAddToQueue = !isMaxed && !alreadyInQueue && !hasActiveSlot && allPrereqMet;

  const effectiveRP = getEffectiveRPPerSec(techRPPerSec, 100, 1) * partialBonus;
  const etaSec = effectiveRP > 0 ? cost / effectiveRP : Infinity;

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: BRANCH_COLORS[tech.branch] }}
            />
            {tech.name}
            <Badge variant="outline" className="text-[10px] h-4 px-1 ml-2">
              {BRANCH_LABELS[tech.branch]}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {tech.description}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-3">
            {/* Status */}
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: getStatusColor(status) }}>{getStatusIcon(status)}</span>
              <span className="text-slate-300">
                {getStatusText(status, currentLevel, ceiling)}
              </span>
            </div>

            {/* Level + cost */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-white/10 p-2">
                <div className="text-slate-500 text-[10px] uppercase">Тек. уровень</div>
                <div className="text-white font-mono">
                  {currentLevel} / {tech.maxLevel}
                </div>
              </div>
              <div className="rounded border border-white/10 p-2">
                <div className="text-slate-500 text-[10px] uppercase">Стоимость ур.{targetLevel}</div>
                <div className="text-cyan-300 font-mono">
                  {cost} RP
                </div>
              </div>
              <div className="rounded border border-white/10 p-2">
                <div className="text-slate-500 text-[10px] uppercase">Кумулятивно</div>
                <div className="text-slate-300 font-mono">
                  {cumulativeCost} RP
                </div>
              </div>
              <div className="rounded border border-white/10 p-2">
                <div className="text-slate-500 text-[10px] uppercase">Потолок ветки</div>
                <div className="text-amber-300 font-mono">
                  {branchCeiling === Infinity ? '∞' : branchCeiling}
                </div>
              </div>
            </div>

            {/* Partial bonus */}
            <div className="text-xs text-slate-300">
              <span className="text-slate-500">Partial-бонус:</span>{' '}
              <span className="text-cyan-300 font-mono">×{partialBonus.toFixed(2)}</span>
              <span className="text-slate-500 ml-2">
                (1.0 + 0.05 × Σ partialFundLevels)
              </span>
            </div>

            {/* ETA */}
            {(canStart || canAddToQueue) && effectiveRP > 0 && (
              <div className="text-xs text-slate-300">
                <span className="text-slate-500">ETA на 100% аллокации:</span>{' '}
                <span className="text-cyan-300 font-mono">
                  {/* R-RES §C: 1 tick = 1 day → ETA in days */}
                  {etaSec === Infinity ? '∞' : `${etaSec.toFixed(0)} дн`}
                </span>
                <span className="text-slate-500 ml-2">
                  (×1.2 фокус-бонус на 1-м слоте)
                </span>
              </div>
            )}

            {/* Prerequisites */}
            {tech.prerequisites.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Прекурсоры
                </div>
                {prereq.map((p) => (
                  <div key={p.techId} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{TECH_MAP.get(p.techId)?.name ?? p.techId}</span>
                    <span className={p.met ? 'text-emerald-400' : 'text-red-400'}>
                      {p.current}/{p.required} {p.met ? '✓' : '✗'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Effects */}
            {tech.effects.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Эффекты
                </div>
                {tech.effects.map((e, i) => (
                  <div key={i} className="text-xs text-slate-300">
                    {e.operation === 'multiply' ? '×' : e.operation === 'add' ? '+' : 'unlock'}
                    {e.value} {e.target}
                    {e.perLevel ? ' /ур.' : ''}
                  </div>
                ))}
              </div>
            )}

            {/* Block reasons */}
            {!canStart && !canAddToQueue && (
              <div className="rounded border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-300 space-y-1">
                <div className="font-medium flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Нельзя начать / добавить в очередь:
                </div>
                {isMaxed && <div>• Достигнут максимальный уровень ({tech.maxLevel}).</div>}
                {ceilingBlocked && (
                  <div>
                    • Потолок фундаментала = {ceiling}. Повысьте{' '}
                    {getBranchFundamentalName(tech.branch)} для продолжения.
                  </div>
                )}
                {!allPrereqMet && <div>• Не выполнены все прекурсоры.</div>}
                {noFreeSlot && !alreadyInQueue && (
                  <div>• Нет свободного слота. Постройте больше лабораторий (1 слот на 10 лаб).</div>
                )}
                {status === 'in_progress' && <div>• Уже в активном слоте.</div>}
                {alreadyInQueue && <div>• Уже в очереди.</div>}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* R-RES §B: action buttons — prefer "Add to queue" (works without
            a free slot, queues up). "Начать" is immediate-start (needs a
            free active slot). Both close the dialog on success. */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            Закрыть
          </Button>
          {canAddToQueue && (
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => onAddToQueue(tech.id)}
              title="Поставить технологию в очередь. Если активного слота нет — начнётся немедленно."
            >
              <Plus className="size-4 mr-1" />
              В очередь
            </Button>
          )}
          {canStart && (
            <Button
              className="flex-1"
              onClick={() => onStartResearch(tech.id, targetLevel)}
              title="Начать немедленно (требуется свободный слот)"
            >
              <Plus className="size-4 mr-1" />
              Начать (ур. {targetLevel})
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getStatusText(status: TechStatus, currentLevel: number, ceiling: number): string {
  switch (status) {
    case 'researched':
      return `Изучена (${currentLevel}/${currentLevel})`;
    case 'in_progress':
      return 'В процессе...';
    case 'available':
      return 'Доступна к изучению';
    case 'ceiling_reached':
      return `Потолок ветки достигнут (${ceiling})`;
    case 'locked':
      return 'Заблокирована (нужны прекурсоры)';
  }
}

function getBranchFundamentalName(branch: SpecializedBranchId): string {
  switch (branch) {
    case 'power':
      return 'Физика';
    case 'materials':
      return 'Химия + Инженерия';
    case 'weapons':
      return 'Военные науки + Инженерия';
    case 'computing':
      return '(свободная ветка — потолка нет)';
    case 'biology':
      return 'Биология (фундаментал)';
    case 'xenoarch':
      return 'Ксеноархеология';
  }
}
