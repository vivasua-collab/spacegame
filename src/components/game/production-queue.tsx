'use client';

import { useGameStore } from '@/stores/game-store';
import { RECIPE_MAP } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { getCraftedMaterial } from '@/data/crafted-materials';
import { getCurrentLookups, findResourceDisplay } from '@/data/baked-lookups';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { X, Repeat, Factory } from 'lucide-react';
import type { EntityId, ProductionItem } from '@/core/types';

/**
 * R-26 (баги 3–4): декодировать ключ экземпляра-исполнителя в человеко-читаемый
 * бейдж. key: hexIndex (>= 0) — гекс поверхности; -1-i — атмосферный слот;
 * -100-i — орбитальный слот (та же конвенция, что в hexIndex-событиях).
 */
function describeAssignment(key: number | undefined): string | null {
  if (key === undefined) return null;
  if (key >= 0) return `гекс #${key + 1}`;
  if (key > -100) return `атм. слот #${-1 - key + 1}`;
  return `орб. слот #${-100 - key + 1}`;
}

/**
 * ProductionQueue — список элементов очереди производства с прогресс-баром
 * и кнопкой «Отменить». (Block 01 P4)
 *
 * Принимает `items` (уже отфильтрованные по зданию на вызывающей стороне)
 * и `planetId` — для вызова `useGameStore.cancelProduction`.
 *
 * Если очередь пуста — показывает «Очередь пуста».
 */
interface ProductionQueueProps {
  planetId: EntityId;
  items: ProductionItem[];
}

export function ProductionQueue({ planetId, items }: ProductionQueueProps) {
  const cancelProduction = useGameStore((s) => s.cancelProduction);

  if (items.length === 0) {
    return (
      <div className="text-[10px] text-slate-600 italic py-1 px-1">
        Очередь пуста — добавьте рецепт из списка ниже.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">
        Очередь ({items.length})
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
        {items.map((item, idx) => {
          const recipe = RECIPE_MAP.get(item.recipeId);
          const recipeName = recipe?.name ?? item.recipeId;
          // Progress: 1 - progress/total = fraction completed. progress is "ticks remaining".
          const totalTicks = item.total;
          const remainingTicks = item.progress;
          const completedFraction = totalTicks > 0
            ? Math.max(0, Math.min(1, (totalTicks - remainingTicks) / totalTicks))
            : 0;
          const percent = Math.round(completedFraction * 100);

          return (
            <div
              key={item.id}
              className="rounded-md border border-white/10 bg-white/[0.03] p-2 space-y-1"
              data-testid={`production-queue-item-${idx}`}
            >
              {/* Header: name + assignment + repeat icon + cancel button */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-200 font-medium truncate flex-1" title={recipeName}>
                  {recipeName}
                </span>
                {/* R-26 (баги 3–4): бейдж экземпляра-исполнителя (карусель). */}
                {(() => {
                  const assigned = describeAssignment(item.assignedTo);
                  return assigned ? (
                    <Badge
                      variant="outline"
                      className="text-[9px] h-4 px-1 bg-amber-900/30 text-amber-300 border-amber-700/40 flex items-center gap-0.5"
                      title={`Исполнитель: ${assigned}`}
                    >
                      <Factory className="size-2.5" />
                      {assigned}
                    </Badge>
                  ) : null;
                })()}
                {item.repeat && (
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 bg-cyan-900/30 text-cyan-300 border-cyan-700/40 flex items-center gap-0.5"
                    title="Автоповтор"
                  >
                    <Repeat className="size-2.5" />
                    автоповтор
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-6 p-0 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                  onClick={() => cancelProduction(planetId, item.id)}
                  aria-label={`Отменить: ${recipeName}`}
                >
                  <X className="size-3" />
                </Button>
              </div>

              {/* Progress bar */}
              <div className="space-y-0.5">
                <Progress
                  value={percent}
                  className="h-1.5 bg-white/5"
                />
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span className="font-mono">
                    {totalTicks - remainingTicks} / {totalTicks} тиков
                  </span>
                  <span className="font-mono">{percent}%</span>
                </div>
              </div>

              {/* Inputs / outputs summary */}
              {recipe && (
                <div className="flex flex-wrap gap-1 text-[9px] text-slate-500">
                  <span className="text-red-500/80">вход:</span>
                  {Object.entries(recipe.inputs).map(([id, qty]) => (
                    <span key={id} className="font-mono">
                      {getResourceName(id)}×{qty}
                    </span>
                  ))}
                  <span className="text-emerald-500/80 ml-1">→</span>
                  {Object.entries(recipe.outputs).map(([id, qty]) => (
                    <span key={id} className="font-mono">
                      {getResourceName(id)}×{qty}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Получить человеко-читаемое имя ресурса: элемент, руда (из baked-lookups)
 * или крафтовый материал. Fallback — ID.
 */
function getResourceName(id: string): string {
  // 1. Чистый элемент
  const elDef = ELEMENT_MAP.get(id);
  if (elDef) return elDef.symbol;

  // 2. Крафтовый материал
  const crafted = getCraftedMaterial(id);
  if (crafted) return crafted.symbol;

  // 3. Руда / атмосферное / ледяное — из baked-lookups
  try {
    const lookups = getCurrentLookups();
    const info = findResourceDisplay(lookups, id);
    if (info?.name) return info.name;
  } catch {
    // getCurrentLookups throws if no galaxy baked yet — fall through.
  }

  return id;
}
