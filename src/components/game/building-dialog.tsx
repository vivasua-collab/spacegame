'use client';

import { useState } from 'react';
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
import { Hammer, Zap, ArrowUp, Wrench, RotateCcw, ArrowRight } from 'lucide-react';
import type { Planet, HexTerrain, BuildingLayer, BuildingDef } from '@/core/types';
import { calculateProcessorOutputMultiplier } from '@/economy/engine';
import { PROCESSOR_CATEGORIES } from '@/data/processor-categories';
import { SpecializeDialog } from './specialize-dialog';

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
  // Block 05 PR6 — specialization state
  const specializeBuildingOnHex = useGameStore((s) => s.specializeBuildingOnHex);
  const upgradeSpecializationOnHex = useGameStore((s) => s.upgradeSpecializationOnHex);
  const [specializeDialogOpen, setSpecializeDialogOpen] = useState(false);

  const hex = planet.hexes[hexIndex];
  const processorType = hex?.processorType;
  const specialization = hex?.specialization;
  const specializationLevel = hex?.specializationLevel ?? 0;
  const activeRecipes = hex?.activeRecipes ?? [];

  // Показывать блок специализации только для зданий-переработчиков
  const isProcessorBuilding = existingBuilding.isUniversalProcessor === true;
  // Если building.defaultProcessorType === 'specialized' (refinery/synthesizer)
  // — это предельная форма, нельзя специализироваться дальше или откатиться.
  const isLimitSpecializedForm = existingBuilding.defaultProcessorType === 'specialized';
  const isUniversalInstance = processorType === 'universal' || processorType === undefined;
  const isSpecializedInstance = processorType === 'specialized';
  const canUpgradeSpecialization =
    isSpecializedInstance && specializationLevel < 5 && !isLimitSpecializedForm;

  // Расчёт текущего коэф. выхода и чистоты через calculateProcessorOutputMultiplier
  const processorOutput = isProcessorBuilding
    ? calculateProcessorOutputMultiplier(existingBuilding, {
        processorType,
        specialization,
        specializationLevel,
        activeRecipes,
      })
    : null;

  // Категория для отображения имени (если specialized)
  const categoryDef = specialization ? PROCESSOR_CATEGORIES.get(specialization) : null;

  // Проверка доступности ресурсов для upgradeSpecialization
  const upgradeSpecializationCost = existingBuilding.upgradeSpecializationCost ?? {};
  // Стоимость апгрейда специализации = upgradeSpecializationCost × specializationLevel
  function checkCanAffordSpecUpgrade(): boolean {
    if (!isSpecializedInstance) return false;
    for (const [resourceId, amount] of Object.entries(upgradeSpecializationCost)) {
      const required = (amount ?? 0) * specializationLevel;
      if ((planet.resources[resourceId] ?? 0) < required) return false;
    }
    return true;
  }
  const canUpgradeSpec = checkCanAffordSpecUpgrade();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hammer className="size-4 text-amber-400" />
              {existingBuilding.name} — Lvl {existingLevel}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {existingBuilding.description}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh] pr-2">
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

              {/* ─── Block 05 PR6 — панель специализации переработчика ─── */}
              {isProcessorBuilding && processorOutput && (
                <ProcessorSpecializationPanel
                  isLimitSpecializedForm={isLimitSpecializedForm}
                  isUniversalInstance={isUniversalInstance}
                  isSpecializedInstance={isSpecializedInstance}
                  specialization={specialization}
                  specializationLevel={specializationLevel}
                  categoryDefName={categoryDef?.name}
                  yieldMult={processorOutput.yieldMult}
                  purity={processorOutput.purity}
                  activeRecipesCount={activeRecipes.length}
                  canUpgradeSpecialization={canUpgradeSpecialization}
                  canUpgradeSpec={canUpgradeSpec}
                  upgradeSpecializationCost={upgradeSpecializationCost}
                  upgradeSpecializationLevel={specializationLevel}
                  planet={planet}
                  onOpenSpecializeDialog={() => setSpecializeDialogOpen(true)}
                  onUpgradeSpecialization={() => {
                    upgradeSpecializationOnHex(planet.id, hexIndex);
                  }}
                  onRevertToUniversal={() => {
                    specializeBuildingOnHex(planet.id, hexIndex, 'universal');
                  }}
                />
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

              {/* ─── Block 02 (F2): shipyard action buttons ───────────────── */}
              {existingBuilding.id === 'shipyard' && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    Верфь
                  </div>
                  <Button
                    variant="outline"
                    className="w-full border-cyan-400/30 hover:border-cyan-400/60 text-cyan-300"
                    onClick={() => {
                      // Close building dialog and navigate to ship designer
                      onOpenChange(false);
                      useGameStore.getState().setView('ship-designer');
                    }}
                  >
                    <Wrench className="size-4 mr-2" />
                    Конструктор кораблей
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* SpecializeDialog — открывается поверх UpgradeMode */}
      {isProcessorBuilding && specializeDialogOpen && (
        <SpecializeDialog
          open={specializeDialogOpen}
          onOpenChange={setSpecializeDialogOpen}
          planet={planet}
          hexIndex={hexIndex}
        />
      )}
    </>
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

// ============ Block 05 PR6 — Processor Specialization Panel ============

interface ProcessorSpecializationPanelProps {
  isLimitSpecializedForm: boolean;     // refinery/synthesizer (предельная форма)
  isUniversalInstance: boolean;
  isSpecializedInstance: boolean;
  specialization: import('@/core/types').ProcessorRecipeCategory | undefined;
  specializationLevel: number;
  categoryDefName?: string;
  yieldMult: number;
  purity: number;
  activeRecipesCount: number;
  canUpgradeSpecialization: boolean;   // < 5 и не предельная форма
  canUpgradeSpec: boolean;             // хватает ресурсов
  upgradeSpecializationCost: Partial<Record<string, number>>;
  upgradeSpecializationLevel: number;  // текущий уровень (для стоимости × level)
  planet: Planet;
  onOpenSpecializeDialog: () => void;
  onUpgradeSpecialization: () => void;
  onRevertToUniversal: () => void;
}

function ProcessorSpecializationPanel({
  isLimitSpecializedForm,
  isUniversalInstance,
  isSpecializedInstance,
  specialization,
  specializationLevel,
  categoryDefName,
  yieldMult,
  purity,
  activeRecipesCount,
  canUpgradeSpecialization,
  canUpgradeSpec,
  upgradeSpecializationCost,
  upgradeSpecializationLevel,
  planet,
  onOpenSpecializeDialog,
  onUpgradeSpecialization,
  onRevertToUniversal,
}: ProcessorSpecializationPanelProps) {
  return (
    <div className="rounded-md border border-purple-900/30 bg-purple-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Wrench className="size-3 text-purple-400" />
        <span className="text-xs text-purple-300 uppercase tracking-wider font-semibold">
          Переработчик
        </span>
      </div>

      {/* Тип переработчика */}
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-500">Тип:</span>
        {isUniversalInstance ? (
          <Badge variant="outline" className="text-[10px] h-5 px-2 bg-slate-700/50">
            Универсальный
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] h-5 px-2 bg-purple-900/40 text-purple-300 border-purple-700">
            Специализированный {categoryDefName ? `· ${categoryDefName}` : ''} · L{specializationLevel}
          </Badge>
        )}
      </div>

      {/* Коэф. выхода и чистота */}
      <div className="flex justify-between text-xs">
        <span className="text-slate-500">Коэф. выхода:</span>
        <span className="font-mono text-emerald-400">×{yieldMult.toFixed(3)}</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-slate-500">Чистота:</span>
        <span className="font-mono text-cyan-400">{(purity * 100).toFixed(1)}%</span>
      </div>

      {/* Для universal — штраф за мульти-рецепт */}
      {isUniversalInstance && (
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Активных рецептов:</span>
          <span className="font-mono text-amber-400">
            {activeRecipesCount} {activeRecipesCount > 1 && `(штраф ×${(1 / Math.sqrt(activeRecipesCount)).toFixed(3)})`}
          </span>
        </div>
      )}

      {/* Кнопки */}
      <div className="space-y-2 pt-1">
        {/* Universal → Specialized (только для processor, не refinery/synthesizer) */}
        {isUniversalInstance && !isLimitSpecializedForm && (
          <Button
            size="sm"
            variant="default"
            className="w-full bg-purple-700 hover:bg-purple-600"
            onClick={onOpenSpecializeDialog}
          >
            <Wrench className="size-3 mr-1" />
            Специализировать
          </Button>
        )}

        {/* Specialized → Upgrade specialization level (только для processor, не refinery/synthesizer) */}
        {isSpecializedInstance && canUpgradeSpecialization && !isLimitSpecializedForm && (
          <>
            <div className="text-[11px] text-slate-400 mt-1">
              Апгрейд специализации L{specializationLevel} → L{specializationLevel + 1}:
            </div>
            <div className="space-y-0.5">
              {Object.entries(upgradeSpecializationCost).map(([resourceId, amount]) => {
                const required = (amount ?? 0) * upgradeSpecializationLevel;
                const current = planet.resources[resourceId] ?? 0;
                const enough = current >= required;
                const elDef = ELEMENT_MAP.get(resourceId);
                const name = elDef?.symbol ?? resourceId;
                return (
                  <div
                    key={resourceId}
                    className={`flex justify-between text-xs ${enough ? 'text-slate-400' : 'text-red-400'}`}
                  >
                    <span>{name}</span>
                    <span className="font-mono">
                      {required} / {Math.floor(current)}
                      {!enough && ' (!)'}
                    </span>
                  </div>
                );
              })}
            </div>
            <Button
              size="sm"
              className="w-full bg-emerald-700 hover:bg-emerald-600"
              disabled={!canUpgradeSpec}
              onClick={onUpgradeSpecialization}
            >
              <ArrowUp className="size-3 mr-1" />
              Повысить спец-уровень (L{specializationLevel} → L{specializationLevel + 1})
            </Button>
          </>
        )}

        {/* Specialized → Revert to universal (только для processor, не refinery/synthesizer) */}
        {isSpecializedInstance && !isLimitSpecializedForm && (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-red-800/50 text-red-400 hover:bg-red-900/20"
            onClick={onRevertToUniversal}
          >
            <RotateCcw className="size-3 mr-1" />
            Вернуть к универсальному (50% возврата)
          </Button>
        )}

        {/* Для refinery/synthesizer — пометить как предельную форму */}
        {isLimitSpecializedForm && (
          <div className="text-[11px] text-slate-500 italic flex items-start gap-1.5 mt-1">
            <ArrowRight className="size-3 text-slate-500 mt-0.5 shrink-0" />
            <span>
              Предельная специализированная форма. Не подлежит переключению или откату.
            </span>
          </div>
        )}

        {/* Universal processor — подсказка про минимальный уровень */}
        {isUniversalInstance && !isLimitSpecializedForm && (
          <div className="text-[11px] text-slate-500 italic">
            Требуется уровень здания ≥ 3 для специализации. Глубинные руды (Y, Ba, Zr и др.) — ≥ 5.
          </div>
        )}
      </div>
    </div>
  );
}
