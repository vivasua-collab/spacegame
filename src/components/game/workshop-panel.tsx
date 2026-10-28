'use client';

/**
 * PROC-WORKSHOPS-01 (Issue #23): WorkshopPanel.
 *
 * Панель цехов цехового здания (processor / construction_materials_plant):
 * карточки цехов 1..L — обычный/специализированный статус, профиль-рецепт и
 * уровень специализации, текущая партия и прогресс, действия:
 *  - обычный свободный цех: «Специализировать» (выбор recipeId, диалог);
 *  - специализированный: «Улучшить специализацию» (уровень 1–5, цена);
 *  - действий снятия/смены/понижения специализации НЕТ (необратимость).
 *
 * Также плачки: upgrade = +обычный цех №L+1; downgrade = −цех №L
 * (предупреждение о потере специализации — на вызывающей стороне).
 */

import { useState } from 'react';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { useGameStore } from '@/stores/game-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wrench, ArrowUpCircle, WrenchIcon, Clock } from 'lucide-react';
import type { Planet, WorkshopState } from '@/core/types';
import { WorkshopSpecializeDialog } from './workshop-specialize-dialog';

interface WorkshopPanelProps {
  planet: Planet;
  hexIndex: number;
}

export function WorkshopPanel({ planet, hexIndex }: WorkshopPanelProps) {
  const upgradeWorkshopSpecializationOnHex = useGameStore((s) => s.upgradeWorkshopSpecializationOnHex);
  const [specializeDialog, setSpecializeDialog] = useState<{ workshopNumber: number } | null>(null);

  const hex = planet.hexes[hexIndex];
  const buildingId = hex?.buildingId;
  if (!buildingId) return null;
  const def = BUILDING_MAP.get(buildingId);
  if (!def?.usesWorkshops) return null;

  const workshops = hex.workshops ?? [];
  const upgradeSpecCost = def.upgradeSpecializationCost ?? {};

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-2 space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
        <WrenchIcon className="size-3" />
        Цехи ({workshops.length}) — уровень здания = число цехов
      </div>

      <ScrollArea className="max-h-64 pr-1">
        <div className="space-y-1.5">
          {workshops.map((ws, i) => (
            <WorkshopCard
              key={i}
              planet={planet}
              hexIndex={hexIndex}
              workshopNumber={i + 1}
              workshop={ws}
              upgradeSpecCost={upgradeSpecCost}
              onOpenSpecialize={() => setSpecializeDialog({ workshopNumber: i + 1 })}
              onUpgradeSpec={() => upgradeWorkshopSpecializationOnHex(planet.id, hexIndex, i + 1)}
            />
          ))}
          {workshops.length === 0 && (
            <div className="text-[10px] text-slate-600 italic px-1">
              Цехи появятся при уровне здания ≥ 1.
            </div>
          )}
        </div>
      </ScrollArea>

      {specializeDialog && (
        <WorkshopSpecializeDialog
          open={specializeDialog !== null}
          onOpenChange={(open) => { if (!open) setSpecializeDialog(null); }}
          planet={planet}
          hexIndex={hexIndex}
          workshopNumber={specializeDialog.workshopNumber}
        />
      )}
    </div>
  );
}

// ─── Карточка цеха ──────────────────────────────────────────────────────

interface WorkshopCardProps {
  planet: Planet;
  hexIndex: number;
  workshopNumber: number;
  workshop: WorkshopState;
  upgradeSpecCost: Partial<Record<string, number>>;
  onOpenSpecialize: () => void;
  onUpgradeSpec: () => void;
}

function WorkshopCard({
  planet,
  hexIndex,
  workshopNumber,
  workshop,
  upgradeSpecCost,
  onOpenSpecialize,
  onUpgradeSpec,
}: WorkshopCardProps) {
  const hex = planet.hexes[hexIndex];
  const buildingDef = hex?.buildingId ? BUILDING_MAP.get(hex.buildingId) : null;
  if (!buildingDef) return null;

  const isSpecialized = workshop.specializationRecipeId !== undefined;
  const specLevel = workshop.specializationLevel ?? 1;
  const profileRecipe = isSpecialized ? RECIPE_MAP.get(workshop.specializationRecipeId!) : null;
  const batch = workshop.currentBatch;
  const batchRecipe = batch ? RECIPE_MAP.get(batch.recipeId) : null;
  const matchesProfile = !!(isSpecialized && batch && batch.recipeId === workshop.specializationRecipeId);

  // Стоимость улучшения = upgradeSpecializationCost × текущий уровень.
  const canAffordSpecUpgrade = Object.entries(upgradeSpecCost).every(([rid, amount]) => {
    const required = (amount ?? 0) * specLevel;
    return (planet.resources[rid] ?? 0) >= required;
  });

  // Прогресс партии.
  const percent = batch && batch.total > 0
    ? Math.round(Math.max(0, Math.min(1, (batch.total - batch.progress) / batch.total)) * 100)
    : 0;

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 space-y-1.5">
      {/* Заголовок: номер + статус */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold text-slate-200">Цех №{workshopNumber}</span>
        {isSpecialized ? (
          <Badge
            variant="outline"
            className="text-[9px] h-4 px-1 bg-purple-900/40 text-purple-300 border-purple-700/50"
            title={`Профиль: ${profileRecipe?.name ?? workshop.specializationRecipeId}`}
          >
            <Wrench className="size-2.5 mr-0.5" />
            {profileRecipe?.name ?? workshop.specializationRecipeId} · ур. {specLevel}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-slate-700/40 text-slate-300">
            обычный
          </Badge>
        )}
        {batch ? (
          <Badge
            variant="outline"
            className={`text-[9px] h-4 px-1 ${matchesProfile
              ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
              : 'bg-amber-900/30 text-amber-300 border-amber-700/40'}`}
            title={batch.queueItemId === null
              ? 'Системная авто-партия R-27'
              : matchesProfile
                ? 'Профильная партия: бонусы специализации'
                : 'Непрофильная партия: базовая эффективность переработчика'}
          >
            {batchRecipe?.name ?? batch.recipeId}
            {batch.queueItemId === null ? ' · авто' : ''}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-slate-800/60 text-slate-400 flex items-center gap-0.5">
            <Clock className="size-2.5" />
            свободен
          </Badge>
        )}
      </div>

      {/* Прогресс партии */}
      {batch && (
        <div className="space-y-0.5">
          <Progress value={percent} className="h-1.5 bg-white/5" />
          <div className="flex justify-between text-[9px] text-slate-500">
            <span className="font-mono">
              {batch.total - batch.progress} / {batch.total} тиков осталось
            </span>
            <span className="font-mono">{percent}%</span>
          </div>
        </div>
      )}

      {/* Действия: только специализация и её улучшение (необратимость) */}
      <div className="flex gap-1.5 pt-0.5">
        {!isSpecialized && !batch && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2 border-purple-400/30 hover:border-purple-400/60 text-purple-300"
            onClick={onOpenSpecialize}
            title="Выбрать профиль-рецепт (необратимо)"
          >
            <Wrench className="size-3 mr-1" />
            Специализировать
          </Button>
        )}
        {isSpecialized && specLevel < 5 && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2 border-emerald-400/30 hover:border-emerald-400/60 text-emerald-300"
            disabled={!canAffordSpecUpgrade}
            onClick={onUpgradeSpec}
            title={`Стоимость: ${Object.entries(upgradeSpecCost)
              .map(([rid, amount]) => `${rid}×${(amount ?? 0) * specLevel}`)
              .join(', ') || '—'} · +2% выхода, +0.0175 чистоты`}
          >
            <ArrowUpCircle className="size-3 mr-1" />
            Улучшить специализацию ({specLevel} → {specLevel + 1})
          </Button>
        )}
        {isSpecialized && specLevel >= 5 && (
          <span className="text-[9px] text-slate-500 italic">Специализация максимальна (ур. 5)</span>
        )}
      </div>
    </div>
  );
}
