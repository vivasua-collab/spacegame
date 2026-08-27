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
  type TechStatus,
} from '@/research/engine';
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
    return {
      labCount: count,
      totalRPPerSec: getTotalRPPerSec(planets),
    };
  }, [gameState]);

  const maxSlots = getMaxResearchSlots(labCount);

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
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {FUNDAMENTAL_BRANCHES_MVP.map((branch) => (
                <FundamentalBranchCard
                  key={branch.id}
                  branchId={branch.id}
                  researchState={researchState}
                  totalRpGenerated={researchState.totalRpGenerated}
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
              <ScrollArea className="max-h-[calc(100vh-220px)] pr-2">
                <div className="space-y-4">
                  {(['power', 'materials', 'weapons', 'computing', 'biology'] as SpecializedBranchId[]).map((branch) => (
                    <TechBranchGroup
                      key={branch}
                      branchId={branch}
                      researchState={researchState}
                      onSelectTech={setSelectedTechId}
                    />
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </main>

        {/* Right: Research queue */}
        <aside className="lg:w-80 shrink-0">
          <ResearchQueuePanel
            researchState={researchState}
            totalRPPerSec={totalRPPerSec}
            maxSlots={maxSlots}
            onCancelSlot={cancelResearch}
            onSetAllocation={setAllocation}
            onAutoAllocate={autoAllocateSlots}
          />
        </aside>
      </div>

      {/* Detail dialog */}
      {selectedTechId && (
        <ResearchDetailDialog
          techId={selectedTechId}
          researchState={researchState}
          totalRPPerSec={totalRPPerSec}
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
                description: `${tech?.name}: проверьте прекурсоры / потолок / свободный слот.`,
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
        <span className="text-slate-500">RP/сек:</span>
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
      <div className="flex items-center gap-1.5">
        <span className="text-slate-500">RP всего:</span>
        <span className="font-mono text-amber-300">
          {researchState.totalRpGenerated.toFixed(0)}
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
  totalRpGenerated,
  onLevelUp,
}: {
  branchId: FundamentalBranchId;
  researchState: ResearchState;
  totalRpGenerated: number;
  onLevelUp: (id: FundamentalBranchId) => void;
}) {
  const branch = FUNDAMENTAL_BRANCH_MAP.get(branchId)!;
  const currentLevel = researchState.fundamentalLevels[branchId] ?? 0;
  const invested = researchState.fundamentalRpInvested[branchId] ?? 0;
  const isMax = currentLevel >= branch.maxLevel;
  const cost = getTechCost(branch.baseCost, currentLevel + 1);
  const totalInvested = Object.values(researchState.fundamentalRpInvested).reduce(
    (a, v) => a + (v ?? 0), 0
  );
  const availableRp = totalRpGenerated - totalInvested;
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

// ============ Tech branch group ============

const BRANCH_LABELS: Record<SpecializedBranchId, string> = {
  power: 'Энергия',
  materials: 'Материалы',
  weapons: 'Оружие',
  computing: 'Вычисления',
  biology: 'Биология',
  xenoarch: 'Ксеноархеология',
};

function TechBranchGroup({
  branchId,
  researchState,
  onSelectTech,
}: {
  branchId: SpecializedBranchId;
  researchState: ResearchState;
  onSelectTech: (techId: string) => void;
}) {
  const techs = TECH_TREE.filter((t) => t.branch === branchId).sort((a, b) => a.sortOrder - b.sortOrder);
  const color = BRANCH_COLORS[branchId];
  const label = BRANCH_LABELS[branchId];

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs uppercase tracking-wider font-medium" style={{ color }}>
          {label}
        </span>
        <span className="text-[10px] text-slate-600">({techs.length} техн.)</span>
        <div className="flex-1 h-px bg-white/5 ml-2" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {techs.map((tech) => (
          <TechCard
            key={tech.id}
            tech={tech}
            researchState={researchState}
            branchColor={color}
            onClick={() => onSelectTech(tech.id)}
          />
        ))}
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
      className="text-left rounded-lg border p-2 transition-all hover:bg-white/5"
      style={{ borderColor }}
    >
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate" style={{ color: branchColor }}>
            {tech.name}
          </span>
        </div>
        <span style={{ color: statusColor }}>{statusIcon}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1">
        <span>Ур. {currentLevel}/{tech.maxLevel}</span>
        {ceiling !== Infinity && ceiling < tech.maxLevel && (
          <span className="text-amber-500/70">↑≤{ceiling}</span>
        )}
      </div>
      {activeSlot && (
        <div className="space-y-0.5 mb-1">
          <Progress value={progress} className="h-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }} />
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>{invested.toFixed(0)}/{cost}</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
        </div>
      )}
      {tech.prerequisites.length > 0 && (
        <div className="text-[10px] text-slate-600">
          Прекурсоры: {tech.prerequisites.map((p) => `${p.techId}≥${p.minLevel}`).join(', ')}
        </div>
      )}
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
  totalRPPerSec,
  maxSlots,
  onCancelSlot,
  onSetAllocation,
  onAutoAllocate,
}: {
  researchState: ResearchState;
  totalRPPerSec: number;
  maxSlots: number;
  onCancelSlot: (slotId: string) => boolean;
  onSetAllocation: (slotId: string, percent: number) => boolean;
  onAutoAllocate: () => void;
}) {
  const activeSlots = researchState.activeSlots;
  const activeSlotsCount = activeSlots.length;
  const focusBonus = activeSlotsCount === 1 && activeSlots[0]?.allocationPercent === 100;

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
          <span>RP/сек: {totalRPPerSec.toFixed(1)}</span>
          {focusBonus && (
            <Badge className="ml-1 text-[9px] h-3.5 px-1 bg-cyan-900/50 text-cyan-300 border-cyan-800">
              Фокус ×1.2
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex-1 min-h-0">
        {activeSlots.length === 0 ? (
          <div className="text-center text-xs text-slate-600 py-8 italic">
            Нет активных исследований.
            <br />
            Выберите технологию в дереве и нажмите «Начать».
          </div>
        ) : (
          <ScrollArea className="max-h-[calc(100vh-260px)] pr-2">
            <div className="space-y-2">
              {activeSlots.map((slot) => (
                <ResearchSlotRow
                  key={slot.slotId}
                  slot={slot}
                  researchState={researchState}
                  totalRPPerSec={totalRPPerSec}
                  activeSlotsCount={activeSlotsCount}
                  onCancel={onCancelSlot}
                  onSetAllocation={onSetAllocation}
                />
              ))}
            </div>
          </ScrollArea>
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
      </CardContent>
    </Card>
  );
}

function ResearchSlotRow({
  slot,
  researchState,
  totalRPPerSec,
  activeSlotsCount,
  onCancel,
  onSetAllocation,
}: {
  slot: ResearchSlot;
  researchState: ResearchState;
  totalRPPerSec: number;
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
    totalRPPerSec,
    slot.allocationPercent,
    activeSlotsCount,
  ) * partialBonus;
  const etaSec = effectiveRP > 0 ? remaining / effectiveRP : Infinity;
  const etaText = etaSec === Infinity ? '∞' : `${etaSec.toFixed(0)}с`;

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
  totalRPPerSec,
  maxSlots,
  onClose,
  onStartResearch,
}: {
  techId: string;
  researchState: ResearchState;
  totalRPPerSec: number;
  maxSlots: number;
  onClose: () => void;
  onStartResearch: (techId: string, targetLevel: number) => void;
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
  const ceilingBlocked = !isMaxed && ceiling < targetLevel;
  const activeSlotsCount = researchState.activeSlots.length;
  const noFreeSlot = activeSlotsCount >= maxSlots;

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

  const effectiveRP = getEffectiveRPPerSec(totalRPPerSec, 100, 1) * partialBonus;
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
            {canStart && effectiveRP > 0 && (
              <div className="text-xs text-slate-300">
                <span className="text-slate-500">ETA на 100% аллокации:</span>{' '}
                <span className="text-cyan-300 font-mono">
                  {etaSec === Infinity ? '∞' : `${etaSec.toFixed(0)} сек`}
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
            {!canStart && (
              <div className="rounded border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-300 space-y-1">
                <div className="font-medium flex items-center gap-1">
                  <AlertTriangle className="size-3" />
                  Нельзя начать:
                </div>
                {isMaxed && <div>• Достигнут максимальный уровень ({tech.maxLevel}).</div>}
                {ceilingBlocked && (
                  <div>
                    • Потолок фундаментала = {ceiling}. Повысьте{' '}
                    {getBranchFundamentalName(tech.branch)} для продолжения.
                  </div>
                )}
                {!allPrereqMet && <div>• Не выполнены все прекурсоры.</div>}
                {noFreeSlot && (
                  <div>• Нет свободного слота. Постройте больше лабораторий (1 слот на 10 лаб).</div>
                )}
                {status === 'in_progress' && <div>• Уже в очереди.</div>}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            Закрыть
          </Button>
          {canStart && (
            <Button
              className="flex-1"
              onClick={() => onStartResearch(tech.id, targetLevel)}
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
