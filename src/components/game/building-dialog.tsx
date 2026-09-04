'use client';

import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useGameStore } from '@/stores/game-store';
import { BUILDINGS, BUILDING_MAP, CATEGORY_NAMES, areBuildingTechsMet } from '@/data/buildings';
import { ELEMENT_MAP } from '@/data/elements';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Hammer, Zap, ArrowUp, ArrowDown, Trash2, Wrench, RotateCcw, ArrowRight, FlaskConical, Sparkles } from 'lucide-react';
import type { Planet, HexTerrain, BuildingLayer, BuildingDef } from '@/core/types';
import {
  calculateProcessorOutputMultiplier,
  getBuildingEnergyOutput,
  getBuildingEnergyConsumption,
} from '@/economy/engine';
import {
  getActiveSynergiesForHex,
  getEnergyGenerationMultiplier,
  getEnergyConsumptionMultiplier,
} from '@/economy/adjacency';
import { PROCESSOR_CATEGORIES } from '@/data/processor-categories';
import { SpecializeDialog } from './specialize-dialog';
import { toast } from '@/hooks/use-toast';
import { ShipyardDialog } from './shipyard-dialog';
import { getResearchRate } from '@/research/engine'; // Block 03 R2: RP/sec для laboratory

/**
 * Target — what the user clicked to open the dialog.
 *
 * Block 01 P3: BuildingDialog поддерживает строительство на atmospheric/orbit
 * слотах, не только на гексах поверхности.
 *
 * - `{ kind: 'hex'; hexIndex }` — гекс поверхности. Если на гексе уже есть
 *   здание — режим апгрейда.
 * - `{ kind: 'atmosphere'; slotIndex }` — атмосферный слот (газовые гиганты).
 * - `{ kind: 'orbit'; slotIndex }` — орбитальный слот.
 *
 * R-26 (баги 1–2): меню постройки показывает ТОЛЬКО здания слоя выбранной
 * цели — единый плоский список без вкладок. Орбитальные объекты строятся
 * из меню орбитальных слотов, атмосферные — из меню атмосферных слотов,
 * газовый экстрактор доступен и в основном меню поверхности (его слой —
 * ['surface', 'atmosphere']). Деление списка по группам будет введено
 * на поздней стадии игры.
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
  space: 'Космос',
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
  // R-DEMOLISH (Задача 22): понижение уровня и снос.
  const downgradeBuildingOnHex = useGameStore((s) => s.downgradeBuildingOnHex);
  const demolishBuildingOnHex = useGameStore((s) => s.demolishBuildingOnHex);
  const downgradeBuildingOnSlot = useGameStore((s) => s.downgradeBuildingOnSlot);
  const demolishBuildingOnSlot = useGameStore((s) => s.demolishBuildingOnSlot);
  // R-BLD-MOD: карта исследованных технологий для фильтра requiresTechs в BuildList.
  const researched = useGameStore((s) => s.gameState?.researchState.researched ?? {});
  // R-24 (Задача 24): система планеты — светимость звезды для РЕАЛЬНОЙ
  // выработки солнечных станций (P1-26) в диалоге построенного здания.
  // Map.get возвращает стабильную ссылку → селектор не плодит ре-рендеры.
  const system = useGameStore((s) =>
    planet ? s.gameState?.galaxy.systemMap.get(planet.systemId) : undefined,
  );
  const starLuminosity = Math.max(0.0001, system?.stars[0]?.luminosity ?? 1.0);

  if (!planet || !target) return null;

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
          starLuminosity={starLuminosity}
          onUpgrade={() => {
            upgradeBuildingOnHex(planet.id, target.hexIndex);
            onOpenChange(false);
          }}
          onDowngrade={() => {
            // R-DEMOLISH: понижение на 1 (уровень 1 = снос, гекс освобождается).
            downgradeBuildingOnHex(planet.id, target.hexIndex);
            onOpenChange(false);
          }}
          onDemolish={() => {
            // R-DEMOLISH: снос с возвратом 50% вложенных ресурсов.
            demolishBuildingOnHex(planet.id, target.hexIndex);
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
    const existingBuilding = slot?.buildingId ? BUILDING_MAP.get(slot.buildingId) : null;
    const slotLevel = slot?.buildingLevel ?? 0;
    // If the slot is occupied, show a brief info card. Building elsewhere:
    // the player clicks another empty slot/hex, which opens the dialog anew
    // (R-26: вкладок слоёв больше нет — каждый слот открывает свой список).
    if (existingBuilding && slot?.buildingId) {
      const slotLayer: 'atmosphere' | 'orbit' = target.kind;
      // R-DEMOLISH (Задача 22)/R-24: понижение/снос слота — с подтверждением
      // (при уровне > 1 — дополнительный вопрос «здание выше 1-го уровня»).
      return (
        <SlotOccupiedView
          open={open}
          onOpenChange={onOpenChange}
          planet={planet}
          target={target}
          existingBuilding={existingBuilding}
          slotLevel={slotLevel}
          slotLayer={slotLayer}
          starLuminosity={starLuminosity}
          onDowngrade={() => {
            downgradeBuildingOnSlot(planet.id, target.kind, target.slotIndex);
            onOpenChange(false);
          }}
          onDemolish={() => {
            demolishBuildingOnSlot(planet.id, target.kind, target.slotIndex);
            onOpenChange(false);
          }}
        />
      );
    }
  }

  // ===== Build mode — единый список по слою цели (R-26, баги 1–2) =====
  // Вкладки слоёв (Поверхность/Атмосфера/Орбита) убраны: с клетки планеты
  // больше нельзя построить орбитальный объект или открыть «атмосферное»
  // меню — каждый слот открывает список зданий только своего слоя.
  const targetLayer: BuildingLayer = target.kind === 'hex' ? 'surface' : target.kind;

  const targetLabel = target.kind === 'hex'
    ? `Гекс поверхности #${target.hexIndex + 1}`
    : target.kind === 'atmosphere'
      ? `Атмосферный слот #${target.slotIndex + 1}`
      : `Орбитальный слот #${target.slotIndex + 1}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-amber-400" />
            Построить здание
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {targetLabel} · {LAYER_LABELS[targetLayer]}
          </DialogDescription>
        </DialogHeader>

        <BuildList
          planet={planet}
          layer={targetLayer}
          target={target}
          researched={researched}
          starLuminosity={starLuminosity}
          buildOnHex={buildOnHex}
          buildOnAtmosphereSlot={buildOnAtmosphereSlot}
          buildOnOrbitSlot={buildOnOrbitSlot}
          onClose={() => onOpenChange(false)}
        />
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
  starLuminosity,
  onUpgrade,
  onDowngrade,
  onDemolish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet;
  hexIndex: number;
  terrain: HexTerrain | null;
  existingBuilding: BuildingDef;
  existingLevel: number;
  /** R-24: светимость звезды системы — для реальной выработки (P1-26). */
  starLuminosity: number;
  onUpgrade: () => void;
  onDowngrade: () => void;
  onDemolish: () => void;
}) {
  const canAffordUpgrade = canAffordBuildingUpgrade(planet, existingLevel, existingBuilding);
  const isMaxLevel = existingLevel >= existingBuilding.levels;
  // R-DEMOLISH: колониальный хаб нельзя понижать/сносить (ядро колонии).
  const isProtected = existingBuilding.id === 'colony_hub';
  // R-SYNERGY: активные бонусы соседства этого здания.
  const activeSynergies = getActiveSynergiesForHex(planet, hexIndex);
  // R-24 (Задача 24): подтверждение сноса. 'downgrade1' — снос через
  // понижение на уровне 1; 'demolish' — прямая кнопка сноса (ур. > 1).
  // Шаги (общий вопрос → доп. вопрос при ур.>1) — внутри DemolishConfirmDialog.
  const [demolishFlow, setDemolishFlow] = useState<{
    action: 'downgrade1' | 'demolish';
  } | null>(null);
  // Block 05 PR6 — specialization state
  const specializeBuildingOnHex = useGameStore((s) => s.specializeBuildingOnHex);
  const upgradeSpecializationOnHex = useGameStore((s) => s.upgradeSpecializationOnHex);
  const [specializeDialogOpen, setSpecializeDialogOpen] = useState(false);
  // Block 02 F6 — shipyard queue dialog state
  const [shipyardDialogOpen, setShipyardDialogOpen] = useState(false);

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

          <div className="max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="space-y-3">
              <div className="text-sm text-slate-300">
                <span className="text-slate-500">Категория:</span>{' '}
                {CATEGORY_NAMES[existingBuilding.category] ?? existingBuilding.category}
              </div>

              {/* ─── R-24 (Задача 24): РЕАЛЬНЫЕ энерго-показатели (engine-формулы):
                    уровень × светимость (P1-26) × орб.бонус × синергия power_boost.
                    Раньше здесь был захардкоженный «+10/tick». ─── */}
              <EnergyStats
                planet={planet}
                building={existingBuilding}
                level={existingLevel}
                layer="surface"
                hexIndex={hexIndex}
                starLuminosity={starLuminosity}
              />
              {existingBuilding.id === 'laboratory' && (
                <div className="text-sm text-cyan-400 flex items-center gap-1">
                  <FlaskConical className="size-3" />
                  RP: +{getResearchRate(existingLevel).toFixed(1)}/сек
                  {!isMaxLevel && (
                    <span className="text-slate-500 text-[10px]">
                      → +{getResearchRate(existingLevel + 1).toFixed(1)}/сек (на ур.{existingLevel + 1})
                    </span>
                  )}
                </div>
              )}

              {terrain && existingBuilding.terrainBonus[terrain] && (
                <div className="text-sm text-emerald-400">
                  Бонус местности: x{existingBuilding.terrainBonus[terrain]}
                </div>
              )}

              {/* ─── R-SYNERGY: активные бонусы соседства (docs §5) — замещает
                   R-26-солнечную синергию: power_boost покрывает солнечные
                   станции общим механизмом (docs/40-buildings.md §5.1). ─── */}
              {activeSynergies.length > 0 && (
                <div className="rounded-md border border-violet-400/30 bg-violet-400/10 p-2 space-y-1">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-300">
                    <Sparkles className="size-3" />
                    Синергия
                  </div>
                  {activeSynergies.map((s) => (
                    <div key={s.rule.id} className="text-[10px] text-slate-400 leading-snug">
                      <span className="text-slate-300">{s.neighbors}</span>{' '}
                      смежн. →{' '}
                      <span className={s.bonus >= 0 ? 'text-emerald-300' : 'text-cyan-300'}>
                        {s.bonus >= 0 ? '+' : ''}
                        {(s.bonus * 100).toFixed(1)}%
                      </span>{' '}
                      ({SYNERGY_TARGET_LABELS[s.rule.bonusTarget] ?? s.rule.bonusTarget})
                      <span className="text-slate-500 text-[10px]">— {s.rule.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ─── Block 05 PR6 — панель специализации переработчика ─── */}
              {isProcessorBuilding && processorOutput && (
                <ProcessorSpecializationPanel
                  isLimitSpecializedForm={isLimitSpecializedForm}
                  isUniversalInstance={isUniversalInstance}
                  isSpecializedInstance={isSpecializedInstance}
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

              {/* ─── R-DEMOLISH (Задача 22): понижение уровня и снос ─── */}
              {!isProtected && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    Управление зданием
                  </div>
                  <Button
                    variant="outline"
                    className="w-full border-orange-400/30 hover:border-orange-400/60 text-orange-300"
                    // R-24: понижение ур.>1 — без подтверждения; на ур.1 это СНОС
                    // → сначала вопрос «Вы действительно хотите снести здание?»
                    onClick={() => {
                      if (existingLevel === 1) {
                        setDemolishFlow({ action: 'downgrade1' });
                      } else {
                        onDowngrade();
                      }
                    }}
                    title={existingLevel === 1
                      ? 'Уровень 1: здание будет снесено, гекс освободится'
                      : `Уровень ${existingLevel} → ${existingLevel - 1}; возврат 50% стоимости уровня`}
                  >
                    <ArrowDown className="size-4 mr-1" />
                    {existingLevel === 1 ? 'Снести (ур. 1)' : `Понизить до ур. ${existingLevel - 1}`}
                  </Button>
                  {existingLevel > 1 && (
                    <Button
                      variant="outline"
                      className="w-full border-red-400/30 hover:border-red-400/60 text-red-300"
                      // R-24: подтверждение сноса — общий вопрос, затем
                      // дополнительный «здание выше 1-го уровня»
                      onClick={() => setDemolishFlow({ action: 'demolish' })}
                      title={`Снос: гекс освобождается, возврат 50% вложенных ресурсов (~${Math.floor(demolishRefundEstimate(existingBuilding, existingLevel))} ед. суммарно)`}
                    >
                      <Trash2 className="size-4 mr-1" />
                      Снести здание
                    </Button>
                  )}
                </div>
              )}
              {isProtected && (
                <div className="text-[10px] text-slate-600 italic text-center mt-2">
                  Колониальный хаб — ядро колонии, понижение/снос запрещены.
                </div>
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
                  <Button
                    variant="outline"
                    className="w-full border-amber-400/30 hover:border-amber-400/60 text-amber-300"
                    onClick={() => setShipyardDialogOpen(true)}
                  >
                    <Hammer className="size-4 mr-2" />
                    Очередь верфи
                  </Button>
                </div>
              )}
            </div>
          </div>
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

      {/* Block 02 (F6): ShipyardDialog — открывается из shipyard UpgradeMode */}
      {existingBuilding.id === 'shipyard' && shipyardDialogOpen && (
        <ShipyardDialog
          open={shipyardDialogOpen}
          onOpenChange={setShipyardDialogOpen}
          planet={planet}
        />
      )}

      {/* R-24 (Задача 24): подтверждение сноса — «Вы действительно хотите снести
          здание?» + при уровне > 1 дополнительный вопрос «Здание выше 1-го
          уровня, вы действительно хотите его снести». */}
      <DemolishConfirmDialog
        flow={demolishFlow}
        buildingName={existingBuilding.name}
        level={existingLevel}
        refundEstimate={demolishRefundEstimate(existingBuilding, existingLevel)}
        slotLabel="гекс"
        onCancel={() => setDemolishFlow(null)}
        onFinalConfirm={(action) => {
          setDemolishFlow(null);
          if (action === 'demolish') {
            onDemolish();
          } else {
            onDowngrade();
          }
          onOpenChange(false);
        }}
      />
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
  researched,
  starLuminosity,
}: {
  planet: Planet;
  /** Слой вкладки (space в диалоге недоступен — только 3 таба). */
  layer: 'surface' | 'atmosphere' | 'orbit';
  target: BuildingDialogTarget;
  buildOnHex: (planetId: string, hexIndex: number, buildingId: string) => boolean;
  buildOnAtmosphereSlot: (planetId: string, slotIndex: number, buildingId: string) => boolean;
  buildOnOrbitSlot: (planetId: string, slotIndex: number, buildingId: string) => boolean;
  onClose: () => void;
  researched: Record<string, number>;
  /** R-24: светимость звезды — проекция выработки солнечных станций (ур. 1). */
  starLuminosity: number;
}) {
  // Filter buildings by layer + planet size + exclude colony_hub (auto-placed).
  // R-BLD-MOD: также скрываем здания, чьи requiresTechs не выполнены —
  // закрытые здания не видны в списке постройки (но видны в справочнике).
  const availableBuildings = BUILDINGS.filter((b) => {
    if (!b.layer.includes(layer)) return false;
    if (b.id === 'colony_hub') return false;
    // For surface buildings on non-gas-giant planets, also filter by planet size.
    if (layer === 'surface' && !isGasGiant(planet)) {
      if (!b.size.includes(planet.size)) return false;
    }
    // R-BLD-MOD: tech-gate — скрыть здания, требующие неизученные технологии.
    if (!areBuildingTechsMet(b, researched)) return false;
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
    // R-31 (audit): раньше boolean-результат engine игнорировался — при отказе
    // (нет атмосферы для газового экстрактора, неподходящая местность и т.п.)
    // диалог молча закрывался и ничего не строилось. Теперь — видимый тост
    // и диалог остаётся открытым.
    let ok = false;
    if (target.kind === 'hex') {
      ok = buildOnHex(planet.id, target.hexIndex, buildingId);
    } else if (target.kind === 'atmosphere') {
      ok = buildOnAtmosphereSlot(planet.id, target.slotIndex, buildingId);
    } else if (target.kind === 'orbit') {
      ok = buildOnOrbitSlot(planet.id, target.slotIndex, buildingId);
    }
    if (!ok) {
      const def = BUILDING_MAP.get(buildingId);
      const reason = def?.requiresAtmosphere && planet.atmosphere.type === 'none'
        ? ' — требуется атмосфера'
        : def?.terrainTypes?.length
          ? ' — неподходящая местность'
          : '';
      toast({
        title: 'Не удалось построить здание',
        description: `${def?.name ?? buildingId}${reason}`,
        variant: 'destructive',
      });
      return;
    }
    onClose();
  };

  return (
    <div className="max-h-[55vh] overflow-y-auto pr-2 custom-scrollbar">
      <div className="space-y-3">
        {availableBuildings.map((building) => {
          const canAfford = canAffordBuilding(planet, building);
          const terrain = target.kind === 'hex' ? planet.hexes[target.hexIndex].terrain : null;
          const terrainBonus = terrain && building.terrainBonus[terrain];
          // R-31 (audit): честное затемнение карточек, которые engine отвергнет —
          // раньше gas_extractor на безатмосферной планете выглядел доступным.
          const needsAtmosphere = building.requiresAtmosphere && planet.atmosphere.type === 'none';
          const wrongTerrain = !!(terrain && building.terrainTypes?.length
            && !building.terrainTypes.includes(terrain));
          const siteBlocked = needsAtmosphere || wrongTerrain;

          return (
            <div
              key={building.id}
              className={`rounded-lg border p-3 transition-colors ${
                canAfford && !siteBlocked
                  ? 'border-white/10 hover:border-white/20 hover:bg-white/5 cursor-pointer'
                  : 'border-white/5 opacity-50'
              }`}
              onClick={() => handleBuild(building.id, canAfford && !siteBlocked)}
            >
              {(needsAtmosphere || wrongTerrain) && (
                <div className="text-[10px] text-red-400 mb-1 flex items-center gap-1">
                  {needsAtmosphere ? 'Требуется атмосфера' : 'Неподходящая местность'}
                </div>
              )}
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
                {/* R-24: реальные показатели на ур.1 для ЭТОЙ планеты (светимость
                    P1-26, орб. радиус, орб. бонус ×1.2) — вместо «+10» из воздуха. */}
                {getBuildingEnergyConsumption(building.id, 1) > 0 ? (
                  <span className="text-orange-400 flex items-center gap-1">
                    <Zap className="size-3" />
                    -{getBuildingEnergyConsumption(building.id, 1).toFixed(1)}
                  </span>
                ) : getBuildingEnergyOutput(building.id, 1, layer, starLuminosity, planet.orbitalRadius) > 0 ? (
                  <span className="text-green-400 flex items-center gap-1">
                    <Zap className="size-3" />
                    +{getBuildingEnergyOutput(building.id, 1, layer, starLuminosity, planet.orbitalRadius).toFixed(1)}
                    <span className="text-slate-500 text-[10px]">
                      (ур. 1{building.id === 'solar_plant' ? `, L☉ ${starLuminosity.toFixed(2)}, R ${planet.orbitalRadius.toFixed(1)}${layer === 'orbit' ? ', ×1.2' : ''}` : ''})
                    </span>
                  </span>
                ) : null}
                {building.id === 'laboratory' && (
                  <span className="text-cyan-400 flex items-center gap-1">
                    <FlaskConical className="size-3" />
                    +{getResearchRate(1).toFixed(0)} RP/сек × ур.
                  </span>
                )}
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
    </div>
  );
}

function canAffordBuilding(planet: Planet, building: BuildingDef): boolean {
  for (const [resourceId, amount] of Object.entries(building.costPerLevel)) {
    if ((planet.resources[resourceId] ?? 0) < amount) return false;
  }
  return true;
}

// ─── R-SYNERGY: подписи целевых метрик Синергии для UI ──────────────────
const SYNERGY_TARGET_LABELS: Record<string, string> = {
  research_rate: 'скорость исследований',
  processing_speed: 'скорость производства',
  energy_consumption: 'энергопотребление',
  // R-24 (Задача 24): новые метрики типовых правил.
  energy_generation: 'генерация энергии',
  mining_speed: 'скорость добычи',
};

// ─── R-DEMOLISH: оценка суммарного возврата ресурсов при сносе (для тултипа) ──
// Модель стоимости (sym. upgradeBuilding): уровень 1 = base; уровень i = base × (i−1).
// Возврат = 50% × (1 + L(L−1)/2) × base — сумма по всем ресурсам.
function demolishRefundEstimate(building: BuildingDef, level: number): number {
  const totalInvestedMult = 1 + (level * (level - 1)) / 2;
  let total = 0;
  for (const amount of Object.values(building.costPerLevel)) {
    total += Math.floor((amount ?? 0) * totalInvestedMult * 0.5);
  }
  return total;
}

// ─── R-24 (Задача 24): РЕАЛЬНЫЕ энерго-показатели построенного здания ─────
//
// Владелец: «Солнечная станция — Lvl 1 … Энергия: +10/tick» — по факту
// генерируется меньше: выработка зависит от уровня (×(1+L×0.2)), светимости
// звезды (P1-26) и орбитального радиуса. Единая формула с движком:
//   производство — getBuildingEnergyOutput (+ синергия power_boost для
//   генераторов на гексах поверхности);
//   потребление  — getBuildingEnergyConsumption (+ синергия power_grid
//   для гексов поверхности). hexIndex = −1 → слот (смежности нет).

interface EnergyStatsProps {
  planet: Planet;
  building: BuildingDef;
  level: number;
  layer: 'surface' | 'atmosphere' | 'orbit';
  /** Индекс гекса (−1 = слот без смежности). */
  hexIndex: number;
  /** Светимость звезды (L☉); по умолчанию 1.0. */
  starLuminosity: number;
}

function EnergyStats({ planet, building, level, layer, hexIndex, starLuminosity }: EnergyStatsProps) {
  const isSurfaceHex = layer === 'surface' && hexIndex >= 0;
  const baseProduction = getBuildingEnergyOutput(
    building.id, level, layer, starLuminosity, planet.orbitalRadius,
  );
  // Синергия power_boost: +выработка генератора за смежных потребителей.
  const generationMult = building.category === 'energy' && isSurfaceHex
    ? getEnergyGenerationMultiplier(planet, hexIndex)
    : 1;
  const realProduction = baseProduction * generationMult;
  // Синергия power_grid: −потребление за смежные электростанции.
  const baseConsumption = getBuildingEnergyConsumption(building.id, level);
  const consumptionMult = isSurfaceHex
    ? getEnergyConsumptionMultiplier(planet, hexIndex)
    : 1;
  const realConsumption = baseConsumption * consumptionMult;

  if (realProduction <= 0 && realConsumption <= 0) return null;

  return (
    <>
      {realProduction > 0 && (
        <div className="text-sm text-green-400 flex items-center gap-1 flex-wrap">
          <Zap className="size-3" />
          Энергия: +{realProduction.toFixed(1)}/tick
          {building.id === 'solar_plant' && (
            <span className="text-slate-500 text-[10px]">
              (P1-26: L☉ {starLuminosity.toFixed(2)} / R {planet.orbitalRadius.toFixed(1)}
              {layer === 'orbit' ? ', орбита ×1.2' : ''})
            </span>
          )}
          {generationMult > 1 && (
            <span className="text-violet-300 text-[10px]">
              (синергия ×{generationMult.toFixed(2)})
            </span>
          )}
        </div>
      )}
      {realConsumption > 0 && (
        <div className="text-sm text-orange-400 flex items-center gap-1 flex-wrap">
          <Zap className="size-3" />
          Энергия: -{realConsumption.toFixed(1)}/tick
          <span className="text-slate-500 text-[10px]">
            (ур. {level})
          </span>
          {consumptionMult < 1 && (
            <span className="text-violet-300 text-[10px]">
              (синергия ×{consumptionMult.toFixed(3)})
            </span>
          )}
        </div>
      )}
    </>
  );
}

// ─── R-24 (Задача 24): подтверждение сноса (запрос владельца) ──────────────
//
// Поток: «Вы действительно хотите снести здание?» → при уровне > 1
// ДОПОЛНИТЕЛЬНЫЙ вопрос «Здание выше 1-го уровня, вы действительно хотите
// его снести» → финальное действие. Реализован одним AlertDialog с шагами.
//
// ВАЖНО (Radix): клик по AlertDialogAction закрывает диалог автоматически;
// переход к шагу 2 требует event.preventDefault() — иначе auto-close
// обнуляет состояние и второй вопрос не показывается.

interface DemolishFlowState {
  action: 'downgrade1' | 'demolish';
}

interface DemolishConfirmDialogProps {
  flow: DemolishFlowState | null;
  buildingName: string;
  level: number;
  refundEstimate: number;
  slotLabel: string;
  onCancel: () => void;
  /** Финальное подтверждение (после всех вопросов) — выполнить действие. */
  onFinalConfirm: (action: 'downgrade1' | 'demolish') => void;
}

function DemolishConfirmDialog({
  flow,
  buildingName,
  level,
  refundEstimate,
  slotLabel,
  onCancel,
  onFinalConfirm,
}: DemolishConfirmDialogProps) {
  const open = flow !== null;
  // Шаги: 'general' — общий вопрос; 'level' — доп. вопрос (ур. > 1).
  const [step, setStep] = useState<'general' | 'level'>('general');
  const isLevelStep = step === 'level';

  const handleActionClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (step === 'general' && level > 1) {
      // НЕ закрывать диалог — показать дополнительный вопрос (ур. > 1).
      e.preventDefault();
      setStep('level');
      return;
    }
    onFinalConfirm(flow?.action ?? 'demolish');
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setStep('general'); // сброс шага для следующего открытия
          onCancel();
        }
      }}
    >
      <AlertDialogContent className="bg-[#0d0d24] border-red-400/30 text-white max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-300">
            <Trash2 className="size-4" />
            {isLevelStep ? 'Здание выше 1-го уровня' : 'Снос здания'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-300">
            {isLevelStep ? (
              <>
                «{buildingName}» имеет уровень {level} &gt; 1. Вы действительно
                хотите его снести? Возврат ~{Math.floor(refundEstimate)} ед.
                ресурсов, {slotLabel} освободится.
              </>
            ) : (
              <>
                Вы действительно хотите снести здание «{buildingName}»? Возврат
                ~{Math.floor(refundEstimate)} ед. ресурсов, {slotLabel}
                {' '}освободится.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/20 text-slate-300 hover:bg-white/5">
            Отмена
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-700 hover:bg-red-600 text-white"
            onClick={handleActionClick}
          >
            {isLevelStep ? 'Да, снести' : 'Снести'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── R-24 (Задача 24): занятый атмосферный/орбитальный слот ────────────────
//
// Вынесен из тела BuildingDialog: реальные энерго-показатели (единая формула
// с engine) + подтверждение сноса (общий вопрос; при ур. > 1 — доп. вопрос).

interface SlotOccupiedViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet;
  target: { kind: 'atmosphere' | 'orbit'; slotIndex: number };
  existingBuilding: BuildingDef;
  slotLevel: number;
  slotLayer: 'atmosphere' | 'orbit';
  starLuminosity: number;
  onDowngrade: () => void;
  onDemolish: () => void;
}

function SlotOccupiedView({
  open,
  onOpenChange,
  planet,
  target,
  existingBuilding,
  slotLevel,
  slotLayer,
  starLuminosity,
  onDowngrade,
  onDemolish,
}: SlotOccupiedViewProps) {
  const [demolishFlow, setDemolishFlow] = useState<DemolishFlowState | null>(null);
  const slot = target.kind === 'atmosphere'
    ? planet.atmosphericSlots[target.slotIndex]
    : planet.orbitSlots[target.slotIndex];
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hammer className="size-4 text-amber-400" />
              {existingBuilding.name} — Lvl {slotLevel}
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
              Слот: {LAYER_LABELS[target.kind]}, #{(slot?.index ?? target.slotIndex) + 1}
            </div>
            {/* R-24: реальные энерго-показатели (слоты не имеют смежности →
                синергии нет; орбитальные солнечные — ×1.2). */}
            <EnergyStats
              planet={planet}
              building={existingBuilding}
              level={slotLevel}
              layer={slotLayer}
              hexIndex={-1}
              starLuminosity={starLuminosity}
            />
            {existingBuilding.id === 'laboratory' && (
              <div className="text-sm text-cyan-400 flex items-center gap-1">
                <FlaskConical className="size-3" />
                RP: +{getResearchRate(slotLevel).toFixed(1)}/сек
                <span className="text-slate-500 text-[10px]">
                  (ур.{slotLevel} × 5 × 1.0)
                </span>
              </div>
            )}
            <div className="text-[10px] text-slate-600 italic">
              Апгрейд атмосферных/орбитальных зданий пока не реализован в engine.
            </div>
            {/* ─── R-DEMOLISH: понижение и снос на атмосферных/орбитальных слотах ─── */}
            {existingBuilding.id !== 'colony_hub' && (
              <div className="pt-3 border-t border-white/10 space-y-2">
                <Button
                  variant="outline"
                  className="w-full border-orange-400/30 hover:border-orange-400/60 text-orange-300"
                  // R-24: понижение ур.>1 — без подтверждения; ур.1 = снос
                  // → вопрос «Вы действительно хотите снести здание?»
                  onClick={() => {
                    if (slotLevel === 1) {
                      setDemolishFlow({ action: 'downgrade1' });
                    } else {
                      onDowngrade();
                      onOpenChange(false);
                    }
                  }}
                  title={slotLevel === 1
                    ? 'Уровень 1: здание будет снесено, слот освободится'
                    : `Уровень ${slotLevel} → ${slotLevel - 1}; возврат 50% стоимости уровня`}
                >
                  <ArrowDown className="size-4 mr-1" />
                  {slotLevel === 1 ? 'Снести (ур. 1)' : `Понизить до ур. ${slotLevel - 1}`}
                </Button>
                {slotLevel > 1 && (
                  <Button
                    variant="outline"
                    className="w-full border-red-400/30 hover:border-red-400/60 text-red-300"
                    // R-24: подтверждение сноса (общий + доп. вопрос при ур. > 1)
                    onClick={() => setDemolishFlow({ action: 'demolish' })}
                  >
                    <Trash2 className="size-4 mr-1" />
                    Снести здание
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* R-24: подтверждение сноса слота (те же 2 шага). */}
      <DemolishConfirmDialog
        flow={demolishFlow}
        buildingName={existingBuilding.name}
        level={slotLevel}
        refundEstimate={demolishRefundEstimate(existingBuilding, slotLevel)}
        slotLabel="слот"
        onCancel={() => setDemolishFlow(null)}
        onFinalConfirm={(action) => {
          setDemolishFlow(null);
          if (action === 'demolish') {
            onDemolish();
          } else {
            onDowngrade();
          }
          onOpenChange(false);
        }}
      />
    </>
  );
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
