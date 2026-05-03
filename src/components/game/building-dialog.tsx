'use client';

import { useGameStore } from '@/stores/game-store';
import { BUILDINGS, BUILDING_MAP, CATEGORY_NAMES } from '@/data/buildings';
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
import { Hammer, Zap, ArrowUp } from 'lucide-react';
import type { Planet, HexTerrain, PlanetSize } from '@/core/types';

interface BuildingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet | undefined;
  hexIndex: number | null;
  terrain: HexTerrain | null;
}

export function BuildingDialog({ open, onOpenChange, planet, hexIndex, terrain }: BuildingDialogProps) {
  const buildOnHex = useGameStore((s) => s.buildOnHex);
  const upgradeBuildingOnHex = useGameStore((s) => s.upgradeBuildingOnHex);

  if (!planet || hexIndex === null || hexIndex < 0 || hexIndex >= planet.hexes.length) {
    return null;
  }

  const hex = planet.hexes[hexIndex];
  const existingBuilding = hex.buildingId ? BUILDING_MAP.get(hex.buildingId) : null;

  // Upgrade mode
  if (existingBuilding && hex.buildingId) {
    const canAffordUpgrade = canAffordBuildingUpgrade(planet, hex.buildingLevel, existingBuilding);
    const isMaxLevel = hex.buildingLevel >= existingBuilding.levels;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hammer className="size-4 text-amber-400" />
              {existingBuilding.name} — Level {hex.buildingLevel}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {existingBuilding.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm text-slate-300">
              <span className="text-slate-500">Category:</span>{' '}
              {CATEGORY_NAMES[existingBuilding.category] ?? existingBuilding.category}
            </div>

            {existingBuilding.energyConsumption > 0 && (
              <div className="text-sm text-orange-400 flex items-center gap-1">
                <Zap className="size-3" />
                Energy: -{existingBuilding.energyConsumption}/tick
              </div>
            )}
            {existingBuilding.category === 'energy' && (
              <div className="text-sm text-green-400 flex items-center gap-1">
                <Zap className="size-3" />
                Energy: +10/tick
              </div>
            )}

            {terrain && existingBuilding.terrainBonus[terrain] && (
              <div className="text-sm text-emerald-400">
                Terrain bonus: x{existingBuilding.terrainBonus[terrain]}
              </div>
            )}

            <Separator className="bg-white/10" />

            {isMaxLevel ? (
              <div className="text-center text-slate-500 text-sm py-2">
                Maximum level reached
              </div>
            ) : (
              <>
                <div className="text-sm text-slate-300 mb-2">Upgrade to Level {hex.buildingLevel + 1}:</div>
                <div className="space-y-1">
                  {Object.entries(existingBuilding.costPerLevel).map(([resourceId, baseAmount]) => {
                    const cost = baseAmount * hex.buildingLevel;
                    const current = planet.resources[resourceId] ?? 0;
                    const enough = current >= cost;
                    const elDef = ELEMENT_MAP.get(resourceId);
                    const name = elDef?.symbol ?? resourceId;
                    return (
                      <div key={resourceId} className={`flex justify-between text-xs ${enough ? 'text-slate-300' : 'text-red-400'}`}>
                        <span>{name}</span>
                        <span className="font-mono">
                          {cost} / {Math.floor(current)}
                          {!enough && ' (!)'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <Button
                  className="w-full mt-2"
                  disabled={!canAffordUpgrade}
                  onClick={() => {
                    upgradeBuildingOnHex(planet.id, hexIndex);
                    onOpenChange(false);
                  }}
                >
                  <ArrowUp className="size-4 mr-1" />
                  Upgrade
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Build mode
  const availableBuildings = BUILDINGS.filter((b) => b.size.includes(planet.size));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-amber-400" />
            Construct Building
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Terrain: {terrain ?? 'Unknown'} — Select a building to construct
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-2">
          <div className="space-y-3">
            {availableBuildings.map((building) => {
              const canAfford = canAffordBuilding(planet, building);
              const terrainBonus = terrain && building.terrainBonus[terrain];

              return (
                <div
                  key={building.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    canAfford
                      ? 'border-white/10 hover:border-white/20 hover:bg-white/5 cursor-pointer'
                      : 'border-white/5 opacity-50'
                  }`}
                  onClick={() => {
                    if (!canAfford) return;
                    buildOnHex(planet.id, hexIndex, building.id);
                    onOpenChange(false);
                  }}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{building.name}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {CATEGORY_NAMES[building.category] ?? building.category}
                      </Badge>
                    </div>
                    {terrainBonus && (
                      <Badge className="text-[10px] h-4 px-1 bg-emerald-900/50 text-emerald-400 border-emerald-800">
                        x{terrainBonus}
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-slate-500 mb-2">{building.description}</p>

                  <div className="flex items-center gap-3 text-xs mb-2">
                    {building.energyConsumption > 0 ? (
                      <span className="text-orange-400 flex items-center gap-1">
                        <Zap className="size-3" />
                        -{building.energyConsumption}
                      </span>
                    ) : building.category === 'energy' ? (
                      <span className="text-green-400 flex items-center gap-1">
                        <Zap className="size-3" />
                        +10
                      </span>
                    ) : null}
                    <span className="text-slate-500">Max level: {building.levels}</span>
                  </div>

                  <div className="space-y-0.5">
                    {Object.entries(building.costPerLevel).map(([resourceId, amount]) => {
                      const current = planet.resources[resourceId] ?? 0;
                      const enough = current >= amount;
                      const elDef = ELEMENT_MAP.get(resourceId);
                      const name = elDef?.symbol ?? resourceId;
                      return (
                        <div key={resourceId} className={`flex justify-between text-xs ${enough ? 'text-slate-400' : 'text-red-400'}`}>
                          <span>{name}</span>
                          <span className="font-mono">
                            {amount} / {Math.floor(current)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function canAffordBuilding(planet: Planet, building: typeof BUILDINGS[0]): boolean {
  for (const [resourceId, amount] of Object.entries(building.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }
  return true;
}

function canAffordBuildingUpgrade(
  planet: Planet,
  currentLevel: number,
  building: typeof BUILDINGS[0],
): boolean {
  for (const [resourceId, baseAmount] of Object.entries(building.costPerLevel)) {
    const cost = baseAmount * currentLevel;
    if ((planet.resources[resourceId] ?? 0) < cost) return false;
  }
  return true;
}
