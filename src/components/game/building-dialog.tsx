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
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Hammer, Zap, ArrowUp } from 'lucide-react';
import type { Planet, HexTerrain, BuildingLayer, BuildingDef } from '@/core/types';

/**
 * Target — what the user clicked to open the dialog.
 *
 * Block 01 P3: BuildingDialog теперь поддерживает строительство на
 * atmospheric/orbit слотах, не только на гексах поверхности.
 *
 * - `{ kind: 'hex'; hexIndex }` — гекс поверхности (поведение по умолчанию,
 *   backward-compat). Если на гексе уже есть здание — режим апгрейда.
 * - `{ kind: 'atmosphere'; slotIndex }` — атмосферный слот (газовые гиганты).
 * - `{ kind: 'orbit'; slotIndex }` — орбитальный слот.
 *
 * Начальная активная вкладка Tabs соответствует `target.kind`.
 */
export type BuildingDialogTarget =
  | { kind: 'hex'; hexIndex: number }
  | { kind: 'atmosphere'; slotIndex: number }
  | { kind: 'orbit'; slotIndex: number };

interface BuildingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet | undefined;
  target: BuildingDialogTarget | null;
}

const LAYER_LABELS: Record<BuildingLayer, string> = {
  surface: 'Поверхность',
  atmosphere: 'Атмосфера',
  orbit: 'Орбита',
};

/** true если газовый гигант (нет гексов поверхности — только атмосферные/орбитальные слоты). */
function isGasGiant(planet: Planet): boolean {
  return planet.type === 'gas_giant' || planet.hexes.length === 0;
}

export function BuildingDialog({ open, onOpenChange, planet, target }: BuildingDialogProps) {
  const buildOnHex = useGameStore((s) => s.buildOnHex);
  const buildOnAtmosphereSlot = useGameStore((s) => s.buildOnAtmosphereSlot);
  const buildOnOrbitSlot = useGameStore((s) => s.buildOnOrbitSlot);
  const upgradeBuildingOnHex = useGameStore((s) => s.upgradeBuildingOnHex);

  if (!planet || !target) return null;

  // Gas giants have no surface hexes — surface tab is disabled.
  const planetIsGasGiant = isGasGiant(planet);

  // ===== Validate target =====
  if (target.kind === 'hex') {
    if (target.hexIndex < 0 || target.hexIndex >= planet.hexes.length) {
      return null;
    }
  } else if (target.kind === 'atmosphere') {
    if (target.slotIndex < 0 || target.slotIndex >= planet.atmosphericSlots.length) {
      return null;
    }
  } else if (target.kind === 'orbit') {
    if (target.slotIndex < 0 || target.slotIndex >= planet.orbitSlots.length) {
      return null;
    }
  }

  // ===== Upgrade mode — only for surface hexes with existing building =====
  if (target.kind === 'hex') {
    const hex = planet.hexes[target.hexIndex];
    const existingBuilding = hex.buildingId ? BUILDING_MAP.get(hex.buildingId) : null;
    if (existingBuilding && hex.buildingId) {
      const terrain: HexTerrain | null = hex.terrain;
      return (
        <UpgradeMode
          open={open}
          onOpenChange={onOpenChange}
          planet={planet}
          hexIndex={target.hexIndex}
          terrain={terrain}
          existingBuilding={existingBuilding}
          existingLevel={hex.buildingLevel}
          onUpgrade={() => {
            upgradeBuildingOnHex(planet.id, target.hexIndex);
            onOpenChange(false);
          }}
        />
      );
    }
  }

  // ===== Existing-building view for atmospheric/orbit slot =====
  if (target.kind === 'atmosphere' || target.kind === 'orbit') {
    const slot = target.kind === 'atmosphere'
      ? planet.atmosphericSlots[target.slotIndex]
      : planet.orbitSlots[target.slotIndex];
    const existingBuilding = slot.buildingId ? BUILDING_MAP.get(slot.buildingId) : null;
    // If the slot is occupied, show a brief info card; player can still switch tabs to
    // build elsewhere on the same planet via the Tabs (e.g. another empty slot — but
    // the dialog doesn't know about other slots, so we just show the occupied slot info).
    if (existingBuilding && slot.buildingId) {
      return (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Hammer className="size-4 text-amber-400" />
                {existingBuilding.name} — Lvl {slot.buildingLevel}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                {existingBuilding.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-sm text-slate-300">
                <span className="text-slate-500">Категория:</span>{' '}
                {CATEGORY_NAMES[existingBuilding.category] ?? existingBuilding.category}
              </div>
              <div className="text-sm text-slate-500">
                Слот: {LAYER_LABELS[target.kind]}, #{slot.index + 1}
              </div>
              {existingBuilding.energyConsumption > 0 && (
                <div className="text-sm text-orange-400 flex items-center gap-1">
                  <Zap className="size-3" />
                  Энергия: -{existingBuilding.energyConsumption}/tick
                </div>
              )}
              {existingBuilding.category === 'energy' && (
                <div className="text-sm text-green-400 flex items-center gap-1">
                  <Zap className="size-3" />
                  Энергия: +10/tick
                </div>
              )}
              <div className="text-[10px] text-slate-600 italic">
                Апгрейд атмосферных/орбитальных зданий пока не реализован в engine.
              </div>
            </div>
          </DialogContent>
        </Dialog>
      );
    }
  }

  // ===== Build mode — Tabs (Surface / Atmosphere / Orbit) =====
  const tabsToShow: BuildingLayer[] = planetIsGasGiant
    ? ['atmosphere', 'orbit']
    : ['surface', 'atmosphere', 'orbit'];

  // Compute the initial active tab from `target.kind`. Tabs is uncontrolled
  // (defaultValue + key) — when the user clicks a different slot/hex the dialog
  // is reopened with a new key, so the active tab resets to the target's layer.
  const targetLayer: BuildingLayer = target.kind === 'hex' ? 'surface' : target.kind;
  const initialLayer = tabsToShow.includes(targetLayer)
    ? targetLayer
    : tabsToShow[0];

  // Stable key per target — remounts the Tabs subtree when target changes,
  // so the defaultValue resets cleanly without useEffect.
  const tabsKey = target.kind === 'hex'
    ? `hex-${target.hexIndex}`
    : `${target.kind}-${target.slotIndex}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-amber-400" />
            Построить здание
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {planetIsGasGiant
              ? 'Газовый гигант — постройка возможна только в атмосфере и на орбите'
              : 'Выберите здание и слой для постройки'}
          </DialogDescription>
        </DialogHeader>

        <Tabs key={tabsKey} defaultValue={initialLayer}>
          <TabsList className="bg-white/5 grid grid-cols-3 w-full">
            {/* Surface — disabled on gas giants */}
            <TabsTrigger
              value="surface"
              disabled={planetIsGasGiant}
              className={planetIsGasGiant ? 'opacity-40 cursor-not-allowed' : ''}
            >
              {LAYER_LABELS.surface}
            </TabsTrigger>
            <TabsTrigger value="atmosphere">{LAYER_LABELS.atmosphere}</TabsTrigger>
            <TabsTrigger value="orbit">{LAYER_LABELS.orbit}</TabsTrigger>
          </TabsList>

          {tabsToShow.map((layer) => (
            <TabsContent key={layer} value={layer}>
              <BuildList
                planet={planet}
                layer={layer}
                target={target}
                buildOnHex={buildOnHex}
                buildOnAtmosphereSlot={buildOnAtmosphereSlot}
                buildOnOrbitSlot={buildOnOrbitSlot}
                onClose={() => onOpenChange(false)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ============ Upgrade Mode ============

function UpgradeMode({
  open,
  onOpenChange,
  planet,
  hexIndex,
  terrain,
  existingBuilding,
  existingLevel,
  onUpgrade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet;
  hexIndex: number;
  terrain: HexTerrain | null;
  existingBuilding: BuildingDef;
  existingLevel: number;
  onUpgrade: () => void;
}) {
  const canAffordUpgrade = canAffordBuildingUpgrade(planet, existingLevel, existingBuilding);
  const isMaxLevel = existingLevel >= existingBuilding.levels;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-amber-400" />
            {existingBuilding.name} — Lvl {existingLevel}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {existingBuilding.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-sm text-slate-300">
            <span className="text-slate-500">Категория:</span>{' '}
            {CATEGORY_NAMES[existingBuilding.category] ?? existingBuilding.category}
          </div>

          {existingBuilding.energyConsumption > 0 && (
            <div className="text-sm text-orange-400 flex items-center gap-1">
              <Zap className="size-3" />
              Энергия: -{existingBuilding.energyConsumption}/tick
            </div>
          )}
          {existingBuilding.category === 'energy' && (
            <div className="text-sm text-green-400 flex items-center gap-1">
              <Zap className="size-3" />
              Энергия: +10/tick
            </div>
          )}

          {terrain && existingBuilding.terrainBonus[terrain] && (
            <div className="text-sm text-emerald-400">
              Бонус местности: x{existingBuilding.terrainBonus[terrain]}
            </div>
          )}

          <Separator className="bg-white/10" />

          {isMaxLevel ? (
            <div className="text-center text-slate-500 text-sm py-2">
              Достигнут максимальный уровень
            </div>
          ) : (
            <>
              <div className="text-sm text-slate-300 mb-2">Апгрейд до Lvl {existingLevel + 1}:</div>
              <div className="space-y-1">
                {Object.entries(existingBuilding.costPerLevel).map(([resourceId, baseAmount]) => {
                  const cost = baseAmount * existingLevel;
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
                onClick={onUpgrade}
              >
                <ArrowUp className="size-4 mr-1" />
                Апгрейд
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ Build List (per-layer) ============

function BuildList({
  planet,
  layer,
  target,
  buildOnHex,
  buildOnAtmosphereSlot,
  buildOnOrbitSlot,
  onClose,
}: {
  planet: Planet;
  layer: BuildingLayer;
  target: BuildingDialogTarget;
  buildOnHex: (planetId: string, hexIndex: number, buildingId: string) => boolean;
  buildOnAtmosphereSlot: (planetId: string, slotIndex: number, buildingId: string) => boolean;
  buildOnOrbitSlot: (planetId: string, slotIndex: number, buildingId: string) => boolean;
  onClose: () => void;
}) {
  // Filter buildings by layer + planet size + exclude colony_hub (auto-placed).
  const availableBuildings = BUILDINGS.filter((b) => {
    if (!b.layer.includes(layer)) return false;
    if (b.id === 'colony_hub') return false;
    // For surface buildings on non-gas-giant planets, also filter by planet size.
    if (layer === 'surface' && !isGasGiant(planet)) {
      if (!b.size.includes(planet.size)) return false;
    }
    // Gas_extractor requiresAtmosphere — engine.buildOnAtmosphereSlot checks
    // planet.atmosphere.type === 'none' and returns false; we still SHOW the
    // building (greyed out if atmosphere is none) to inform the player.
    return true;
  });

  if (availableBuildings.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-4">
        Нет доступных зданий для этого слоя
      </div>
    );
  }

  const handleBuild = (buildingId: string, canAfford: boolean) => {
    if (!canAfford) return;
    if (target.kind === 'hex') {
      buildOnHex(planet.id, target.hexIndex, buildingId);
    } else if (target.kind === 'atmosphere') {
      buildOnAtmosphereSlot(planet.id, target.slotIndex, buildingId);
    } else if (target.kind === 'orbit') {
      buildOnOrbitSlot(planet.id, target.slotIndex, buildingId);
    }
    onClose();
  };

  return (
    <ScrollArea className="max-h-[55vh] pr-2">
      <div className="space-y-3">
        {availableBuildings.map((building) => {
          const canAfford = canAffordBuilding(planet, building);
          const terrain = target.kind === 'hex' ? planet.hexes[target.hexIndex].terrain : null;
          const terrainBonus = terrain && building.terrainBonus[terrain];

          return (
            <div
              key={building.id}
              className={`rounded-lg border p-3 transition-colors ${
                canAfford
                  ? 'border-white/10 hover:border-white/20 hover:bg-white/5 cursor-pointer'
                  : 'border-white/5 opacity-50'
              }`}
              onClick={() => handleBuild(building.id, canAfford)}
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
                <span className="text-slate-500">Макс. уровень: {building.levels}</span>
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
  );
}

function canAffordBuilding(planet: Planet, building: BuildingDef): boolean {
  for (const [resourceId, amount] of Object.entries(building.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }
  return true;
}

function canAffordBuildingUpgrade(
  planet: Planet,
  currentLevel: number,
  building: BuildingDef,
): boolean {
  for (const [resourceId, baseAmount] of Object.entries(building.costPerLevel)) {
    const cost = baseAmount * currentLevel;
    if ((planet.resources[resourceId] ?? 0) < cost) return false;
  }
  return true;
}
