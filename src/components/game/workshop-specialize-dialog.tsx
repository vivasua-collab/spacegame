'use client';

/**
 * PROC-WORKSHOPS-01 (Issue #23): WorkshopSpecializeDialog.
 *
 * Диалог выбора специализации ЦЕХА по конкретному recipeId (не категория!).
 * Открывается на обычном свободном цехе цехового здания
 * (processor / construction_materials_plant).
 *
 * Содержимое: список разрешённых рецептов пула здания (каталог
 * workshop-specializations) с входами/выходами; стоимость specializeCost;
 * ОБЯЗАТЕЛЬНОЕ предупреждение о необратимости (снять/сменить/понизить
 * нельзя; потеря при понижении уровня здания — безвозвратно).
 *
 * При выборе вызывает specializeWorkshopOnHex(planet.id, hexIndex,
 * workshopNumber, recipeId).
 */

import { useGameStore } from '@/stores/game-store';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { getWorkshopSpecializationsForBuilding } from '@/data/workshop-specializations';
import { ELEMENT_MAP } from '@/data/elements';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Wrench, AlertTriangle } from 'lucide-react';
import type { Planet } from '@/core/types';

interface WorkshopSpecializeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet;
  hexIndex: number;
  /** Номер цеха 1..buildingLevel */
  workshopNumber: number;
}

export function WorkshopSpecializeDialog({
  open,
  onOpenChange,
  planet,
  hexIndex,
  workshopNumber,
}: WorkshopSpecializeDialogProps) {
  const specializeWorkshopOnHex = useGameStore((s) => s.specializeWorkshopOnHex);

  const hex = planet.hexes[hexIndex];
  const buildingId = hex?.buildingId;
  if (!buildingId) return null;
  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef?.usesWorkshops) return null;

  const specializeCost = buildingDef.specializeCost ?? {};
  const catalog = getWorkshopSpecializationsForBuilding(buildingId);

  // Достаточно ресурсов для specializeCost?
  function canAfford(): boolean {
    for (const [resourceId, amount] of Object.entries(specializeCost)) {
      if ((planet.resources[resourceId] ?? 0) < (amount ?? 0)) return false;
    }
    return true;
  }
  const affordable = canAfford();

  function handleSelect(recipeId: string) {
    if (!affordable) return;
    const success = specializeWorkshopOnHex(planet.id, hexIndex, workshopNumber, recipeId);
    if (success) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4 text-amber-400" />
            Специализация цеха №{workshopNumber}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Выберите профиль-рецепт для цеха №{workshopNumber} здания «{buildingDef.name}».
            Специализация действует только на этом цехе.
          </DialogDescription>
        </DialogHeader>

        {/* Текущая форма цеха */}
        <div className="rounded-md bg-white/5 p-3 text-xs text-slate-300 mb-2">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Текущая форма:</span>
            <Badge variant="outline" className="text-[10px] h-5 px-2 bg-slate-700/50">
              Обычный цех
            </Badge>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-slate-500">Коэф. выхода:</span>
            <span className="font-mono">×{(buildingDef.baseYield ?? 0.75).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Чистота:</span>
            <span className="font-mono">{(buildingDef.basePurity ?? 0.78).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">После специализации (профиль):</span>
            <span className="font-mono text-emerald-400">×1.00 · 0.92 → ×1.08 · 0.99</span>
          </div>
        </div>

        <Separator className="bg-white/10 my-2" />

        <ScrollArea className="max-h-[45vh] pr-2">
          <div className="space-y-3">
            {catalog.map((spec) => {
              const recipe = RECIPE_MAP.get(spec.id);
              if (!recipe) return null;
              return (
                <div
                  key={spec.id}
                  className="rounded-lg border border-white/10 p-3 hover:border-white/20 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-sm font-medium">{recipe.name}</span>
                    <Badge variant="outline" className="text-[10px] h-5 px-2 bg-purple-900/30 text-purple-300 border-purple-700">
                      {spec.pool === 'construction' ? 'стройматериалы' : 'продвинутый'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 text-[9px] text-slate-500 mb-2">
                    <span className="text-red-500/80">вход:</span>
                    {Object.entries(recipe.inputs).map(([id, qty]) => (
                      <span key={id} className="font-mono">{resourceName(id)}×{qty}</span>
                    ))}
                    <span className="text-emerald-500/80 mx-1">→</span>
                    {Object.entries(recipe.outputs).map(([id, qty]) => (
                      <span key={id} className="font-mono">{resourceName(id)}×{qty}</span>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    className="w-full mt-1"
                    disabled={!affordable}
                    onClick={() => handleSelect(spec.id)}
                  >
                    <Wrench className="size-3 mr-1" />
                    Специализировать под этот рецепт
                  </Button>
                </div>
              );
            })}
            {catalog.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-4">
                Нет разрешённых рецептов для пула этого здания.
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Стоимость + ОБЯЗАТЕЛЬНОЕ предупреждение о необратимости */}
        <Separator className="bg-white/10 my-2" />
        {Object.keys(specializeCost).length > 0 && (
          <div className="space-y-0.5 mb-2">
            {Object.entries(specializeCost).map(([resourceId, amount]) => {
              const current = planet.resources[resourceId] ?? 0;
              const enough = current >= (amount ?? 0);
              const elDef = ELEMENT_MAP.get(resourceId);
              const name = elDef?.symbol ?? resourceId;
              return (
                <div
                  key={resourceId}
                  className={`flex justify-between text-xs ${enough ? 'text-slate-400' : 'text-red-400'}`}
                >
                  <span>{name}</span>
                  <span className="font-mono">
                    {amount} / {Math.floor(current)}
                    {!enough && ' (!)'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="text-[11px] text-amber-400/90 flex items-start gap-2">
          <AlertTriangle className="size-3 text-amber-500 mt-0.5 shrink-0" />
          <span>
            <strong>Необратимо.</strong> Снять специализацию, сменить рецепт или понизить
            уровень специализации нельзя. Понижение уровня здания удалит цех
            №{planet.hexes[hexIndex]?.buildingLevel ?? 1} вместе со специализацией и
            вложениями — без возврата. На несовпадающем рецепте цех работает с базовой
            эффективностью переработчика (×{(buildingDef.baseYield ?? 0.75).toFixed(2)}),
            без второго штрафа.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resourceName(id: string): string {
  const elDef = ELEMENT_MAP.get(id);
  return elDef?.symbol ?? id;
}
