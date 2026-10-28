'use client';

import { useGameStore } from '@/stores/game-store';
import { RECIPE_MAP } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { getCraftedMaterial } from '@/data/crafted-materials';
import { getCurrentLookups, findResourceDisplay } from '@/data/baked-lookups';
import { findWorkshopExecutor, getRecipeRunability } from '@/economy/workshop-scheduler';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { X, Repeat, Factory, Clock, AlertTriangle } from 'lucide-react';
import type { EntityId, Planet, ProductionItem } from '@/core/types';

/**
 * PROC-WORKSHOPS-01: бейдж исполнителя — lookup по цехам планеты
 * (workshops[].currentBatch.queueItemId). Это НЕ сохраняемая привязка:
 * планировщик её не читает; sticky-`assignedTo` удалён из модели.
 */
function describeExecutor(planet: Planet | null, itemId: EntityId): string | null {
  if (!planet) return null;
  const exec = findWorkshopExecutor(planet, itemId);
  if (!exec) return null;
  const place = exec.layer === 'surface'
    ? `гекс #${exec.instanceKey + 1}`
    : exec.layer === 'atmosphere'
      ? `атм. слот #${exec.instanceKey + 2}`
      : `орб. слот #${exec.instanceKey + 101}`;
  return `${place} · цех ${exec.workshopNumber}`;
}

/**
 * PROC-WORKSHOPS-01: статус элемента очереди цехового пула.
 * Выполняется (есть цех-исполнитель) / ожидает FIFO / пропущена
 * (нет входов / энергии / места под выходы — не блокирует другие).
 */
type ItemStatus =
  | { kind: 'executing'; executor: string }
  | { kind: 'waiting' }
  | { kind: 'skipped'; reason: string };

function getItemStatus(planet: Planet | null, item: ProductionItem): ItemStatus {
  const executor = describeExecutor(planet, item.id);
  if (executor) return { kind: 'executing', executor };
  const recipe = RECIPE_MAP.get(item.recipeId);
  if (recipe && planet) {
    const runability = getRecipeRunability(planet, item.recipeId);
    if (runability === 'no-inputs') return { kind: 'skipped', reason: 'нет входных ресурсов' };
    if (runability === 'no-energy') return { kind: 'skipped', reason: 'нет энергии' };
    if (runability === 'no-output-space') return { kind: 'skipped', reason: 'нет места на складе' };
  }
  return { kind: 'waiting' };
}

/**
 * ProductionQueue — список элементов очереди производства с прогресс-баром
 * и кнопкой «Отменить». (Block 01 P4; PROC-WORKSHOPS-01: статусы пула.)
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
  const gameState = useGameStore((s) => s.gameState);

  const planet = gameState
    ? (() => {
      for (const sys of gameState.galaxy.systems) {
        const p = sys.planets.find((p) => p.id === planetId);
        if (p) return p;
      }
      return null;
    })()
    : null;

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
          const status = getItemStatus(planet, item);

          return (
            <div
              key={item.id}
              className="rounded-md border border-white/10 bg-white/[0.03] p-2 space-y-1"
              data-testid={`production-queue-item-${idx}`}
            >
              {/* Header: name + executor/status + repeat icon + cancel button */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-200 font-medium truncate flex-1" title={recipeName}>
                  {recipeName}
                </span>
                {/* PROC-WORKSHOPS-01: фактический цех-исполнитель (не привязка). */}
                {status.kind === 'executing' && (
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 bg-amber-900/30 text-amber-300 border-amber-700/40 flex items-center gap-0.5"
                    title={`Исполнитель: ${status.executor}`}
                  >
                    <Factory className="size-2.5" />
                    {status.executor}
                  </Badge>
                )}
                {status.kind === 'waiting' && (
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 bg-slate-800/60 text-slate-400 border-slate-700/40 flex items-center gap-0.5"
                    title="В FIFO-очереди пула: ждёт свободный цех"
                  >
                    <Clock className="size-2.5" />
                    в очереди
                  </Badge>
                )}
                {status.kind === 'skipped' && (
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 bg-red-900/30 text-red-300 border-red-800/40 flex items-center gap-0.5"
                    title={`Пропущена планировщиком: ${status.reason} (не блокирует другие задачи)`}
                  >
                    <AlertTriangle className="size-2.5" />
                    {status.reason}
                  </Badge>
                )}
                {item.repeat && (
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1 bg-cyan-900/30 text-cyan-300 border-cyan-700/40 flex items-center gap-0.5"
                    title="Автоповтор: после партии — в хвост пула"
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
