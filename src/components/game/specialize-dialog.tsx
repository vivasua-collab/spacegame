'use client';

/**
 * Block 05 — PR6: SpecializeDialog.
 *
 * Отдельный диалог выбора специализации для универсального переработчика.
 *
 * Props: open, onOpenChange, planet, hexIndex.
 *
 * Содержимое: список `PROCESSOR_CATEGORIES` (фильтр по `minBuildingLevel ≤
 * hex.buildingLevel`), для каждой — карточка с именем, описанием,
 * `basePurity`, `bonusText`, эквивалентным зданием (refinery/synthesizer),
 * стоимостью specializeCost, кнопкой «Выбрать».
 *
 * При выборе вызывает `specializeBuildingOnHex(planet.id, hexIndex, category)`.
 * Предупреждение: «Это действие можно отменить за 50% возврата стоимости».
 */

import { useGameStore } from '@/stores/game-store';
import { BUILDING_MAP } from '@/data/buildings';
import { PROCESSOR_CATEGORIES } from '@/data/processor-categories';
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
import { Wrench, ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { Planet, ProcessorRecipeCategory } from '@/core/types';

interface SpecializeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet;
  hexIndex: number;
}

export function SpecializeDialog({ open, onOpenChange, planet, hexIndex }: SpecializeDialogProps) {
  const specializeBuildingOnHex = useGameStore((s) => s.specializeBuildingOnHex);

  const hex = planet.hexes[hexIndex];
  const buildingId = hex?.buildingId;
  if (!buildingId) return null;
  const buildingDef = BUILDING_MAP.get(buildingId);
  if (!buildingDef?.isUniversalProcessor) return null;
  // refinery/synthesizer уже specialized — не показываем диалог
  if (buildingDef.defaultProcessorType === 'specialized') return null;

  const buildingLevel = hex?.buildingLevel ?? 1;
  const specializeCost = buildingDef.specializeCost ?? {};

  // Фильтр категорий по minBuildingLevel ≤ hex.buildingLevel
  const availableCategories = Array.from(PROCESSOR_CATEGORIES.values()).filter(
    (cat) => buildingLevel >= cat.minBuildingLevel,
  );

  // Проверка доступности ресурсов для specializeCost
  function canAffordSpecialize(): boolean {
    for (const [resourceId, amount] of Object.entries(specializeCost)) {
      if ((planet.resources[resourceId] ?? 0) < (amount ?? 0)) return false;
    }
    return true;
  }
  const affordable = canAffordSpecialize();

  function handleSelect(category: ProcessorRecipeCategory) {
    if (!affordable) return;
    const success = specializeBuildingOnHex(planet.id, hexIndex, category);
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
            Специализация переработчика
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Выберите цепочку переработки для {buildingDef.name} (Lvl {buildingLevel}).
            Действие можно отменить за 50% возврата стоимости.
          </DialogDescription>
        </DialogHeader>

        {/* Плашка текущего коэф. universal */}
        <div className="rounded-md bg-white/5 p-3 text-xs text-slate-300 mb-2">
          <div className="flex justify-between items-center">
            <span className="text-slate-500">Текущая форма:</span>
            <Badge variant="outline" className="text-[10px] h-5 px-2 bg-slate-700/50">
              Универсальный
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
        </div>

        <Separator className="bg-white/10 my-2" />

        {availableCategories.length === 0 ? (
          <div className="text-center text-slate-500 text-sm py-4">
            Нет доступных категорий специализации на этом уровне здания.
            <br />
            Повысьте уровень здания до 3+, чтобы разблокировать специализацию.
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-2">
            <div className="space-y-3">
              {availableCategories.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  cat={cat}
                  specializeCost={specializeCost}
                  planet={planet}
                  affordable={affordable}
                  onSelect={() => handleSelect(cat.id)}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Стоимость + предупреждение */}
        <Separator className="bg-white/10 my-2" />
        <div className="text-[11px] text-slate-500 italic flex items-start gap-2">
          <CheckCircle2 className="size-3 text-emerald-500 mt-0.5 shrink-0" />
          <span>
            Специализация — необратимый переход, но можно вернуться к универсальной форме
            за 50% возврата стоимости. При переключении между категориями (например,
            metal_smelting → chemical_decomp) повторно списывается полная стоимость.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Карточка категории ───────────────────────────────────────────────

interface CategoryCardProps {
  cat: {
    id: ProcessorRecipeCategory;
    name: string;
    description: string;
    minBuildingLevel: number;
    basePurity: number;
    bonusText?: string;
    equivalentTo?: 'refinery' | 'synthesizer';
  };
  specializeCost: Partial<Record<string, number>>;
  planet: Planet;
  affordable: boolean;
  onSelect: () => void;
}

function CategoryCard({ cat, specializeCost, planet, affordable, onSelect }: CategoryCardProps) {
  const equivalentBuilding = cat.equivalentTo ? BUILDING_MAP.get(cat.equivalentTo) : null;

  return (
    <div className="rounded-lg border border-white/10 p-3 hover:border-white/20 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between mb-1">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{cat.name}</span>
          {equivalentBuilding && (
            <span className="text-[10px] text-slate-500 mt-0.5">
              ≈ {equivalentBuilding.name}
            </span>
          )}
        </div>
        <Badge variant="outline" className="text-[10px] h-5 px-2 bg-purple-900/30 text-purple-300 border-purple-700">
          Lvl {cat.minBuildingLevel}+
        </Badge>
      </div>

      <p className="text-xs text-slate-500 mb-2">{cat.description}</p>

      <div className="flex items-center gap-3 text-xs mb-2">
        <span className="text-slate-500">
          Чистота L1: <span className="font-mono text-emerald-400">{cat.basePurity.toFixed(2)}</span>
        </span>
        <span className="text-slate-500">→ L5: <span className="font-mono text-emerald-400">0.99</span></span>
      </div>

      {cat.bonusText && (
        <div className="text-xs text-amber-400 mb-2">⚡ {cat.bonusText}</div>
      )}

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

      <Button
        size="sm"
        className="w-full mt-1"
        disabled={!affordable}
        onClick={onSelect}
      >
        <Wrench className="size-3 mr-1" />
        Специализировать
      </Button>
    </div>
  );
}
