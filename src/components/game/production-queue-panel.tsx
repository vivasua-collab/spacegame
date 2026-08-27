'use client';

import { useMemo, useState } from 'react';
import { useGameStore } from '@/stores/game-store';
import { RECIPES } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { getCraftedMaterial } from '@/data/crafted-materials';
import { getCurrentLookups, findResourceDisplay } from '@/data/baked-lookups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, RotateCw, Search } from 'lucide-react';
import type { EntityId, RecipeDef } from '@/core/types';

/**
 * ProductionQueuePanel — список доступных рецептов для здания + кнопки
 * «Добавить в очередь» / «Добавить с автоповтором». (Block 01 P4)
 *
 * Принимает `buildingId` (фильтр рецептов по зданию) и `planetId`
 * (для вызова `useGameStore.enqueueProduction`).
 *
 * UI:
 * - Поиск/фильтр рецептов по имени ресурса.
 * - Каждый рецепт — карточка с inputs/outputs + 2 кнопки.
 * - Подсветка недоступных рецептов (не хватает ресурсов) — кнопка disabled.
 */
interface ProductionQueuePanelProps {
  planetId: EntityId;
  buildingId: string;
}

export function ProductionQueuePanel({ planetId, buildingId }: ProductionQueuePanelProps) {
  const enqueueProduction = useGameStore((s) => s.enqueueProduction);
  const gameState = useGameStore((s) => s.gameState);
  const [filter, setFilter] = useState('');

  // Find the planet (so we can check resource availability for each recipe)
  const planet = useMemo(() => {
    if (!gameState) return null;
    for (const sys of gameState.galaxy.systems) {
      const p = sys.planets.find((p) => p.id === planetId);
      if (p) return p;
    }
    return null;
  }, [gameState, planetId]);

  // Recipes for this building, filtered by name search
  const recipesForBuilding = useMemo(() => {
    const list = RECIPES.filter((r) => r.buildingId === buildingId);
    if (!filter.trim()) return list;
    const q = filter.trim().toLowerCase();
    return list.filter((r) => {
      const hay = r.name.toLowerCase() + ' ' + r.id.toLowerCase();
      if (hay.includes(q)) return true;
      // Also search in inputs/outputs resource IDs/names
      const inIds = Object.keys(r.inputs).some((id) => id.toLowerCase().includes(q) || getResourceName(id).toLowerCase().includes(q));
      const outIds = Object.keys(r.outputs).some((id) => id.toLowerCase().includes(q) || getResourceName(id).toLowerCase().includes(q));
      return inIds || outIds;
    });
  }, [buildingId, filter]);

  if (recipesForBuilding.length === 0) {
    return (
      <div className="text-[10px] text-slate-500 italic py-1 px-1">
        Нет рецептов для этого здания.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">
          Рецепты ({recipesForBuilding.length})
        </span>
        <div className="relative flex-1 min-w-0">
          <Search className="size-3 text-slate-600 absolute left-1.5 top-1/2 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Фильтр по имени..."
            className="h-6 text-[11px] pl-6 bg-white/5 border-white/10 text-white placeholder:text-slate-600"
            aria-label="Фильтр рецептов"
          />
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
        {recipesForBuilding.map((recipe) => {
          const canAfford = planet ? canAffordRecipe(planet.resources, recipe) : false;
          return (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              canAfford={canAfford}
              onEnqueue={(repeat) => {
                enqueueProduction(planetId, recipe.id, repeat);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ============ Recipe Card ============

function RecipeCard({
  recipe,
  canAfford,
  onEnqueue,
}: {
  recipe: RecipeDef;
  canAfford: boolean;
  onEnqueue: (repeat: boolean) => void;
}) {
  return (
    <div
      className={`rounded-md border p-2 space-y-1.5 transition-colors ${
        canAfford
          ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
          : 'border-white/5 bg-white/[0.01] opacity-60'
      }`}
    >
      {/* Header: name + time */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-200 font-medium flex-1 truncate" title={recipe.name}>
          {recipe.name}
        </span>
        <Badge variant="outline" className="text-[9px] h-4 px-1 text-slate-400">
          {recipe.time} тиков
        </Badge>
        {recipe.energyCost > 0 && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 text-orange-400">
            -{recipe.energyCost} энергии
          </Badge>
        )}
      </div>

      {/* Inputs → Outputs */}
      <div className="flex flex-wrap items-center gap-1 text-[9px] text-slate-500">
        <span className="text-red-500/80">вход:</span>
        {Object.entries(recipe.inputs).map(([id, qty]) => {
          const name = getResourceName(id);
          return (
            <span key={id} className="font-mono text-red-400/90">
              {name}×{qty}
            </span>
          );
        })}
        <span className="text-emerald-500/80 mx-1">→</span>
        <span className="text-emerald-500/80">выход:</span>
        {Object.entries(recipe.outputs).map(([id, qty]) => {
          const name = getResourceName(id);
          return (
            <span key={id} className="font-mono text-emerald-400/90">
              {name}×{qty}
            </span>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 pt-1">
        <Button
          size="sm"
          variant="default"
          className="h-6 text-[10px] px-2"
          disabled={!canAfford}
          onClick={() => onEnqueue(false)}
          aria-label={`Добавить в очередь: ${recipe.name}`}
        >
          <Plus className="size-3" />
          В очередь
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] px-2"
          disabled={!canAfford}
          onClick={() => onEnqueue(true)}
          aria-label={`Добавить с автоповтором: ${recipe.name}`}
          title="Добавить с автоповтором"
        >
          <RotateCw className="size-3" />
          Автоповтор
        </Button>
      </div>
    </div>
  );
}

// ============ Helpers ============

function canAffordRecipe(resources: Record<string, number>, recipe: RecipeDef): boolean {
  for (const [id, qty] of Object.entries(recipe.inputs)) {
    if ((resources[id] ?? 0) < qty) return false;
  }
  return true;
}

/**
 * Получить человеко-читаемое имя ресурса.
 */
function getResourceName(id: string): string {
  // 1. Чистый элемент
  const elDef = ELEMENT_MAP.get(id);
  if (elDef) return elDef.symbol;

  // 2. Крафтовый материал
  const crafted = getCraftedMaterial(id);
  if (crafted) return crafted.symbol;

  // 3. Руда / атмосферное / ледяное
  try {
    const lookups = getCurrentLookups();
    const info = findResourceDisplay(lookups, id);
    if (info?.name) return info.name;
  } catch {
    // getCurrentLookups throws if no galaxy baked yet — fall through.
  }

  return id;
}
