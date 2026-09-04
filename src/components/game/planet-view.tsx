'use client';

import { useCallback, useMemo, useState } from 'react';
import { useGameStore } from '@/stores/game-store';
import { axialToPixel } from '@/galaxy';
import { TERRAIN_COLORS, TERRAIN_NAMES, TYPE_NAMES, SIZE_NAMES, SIZE_HEX_COUNT } from '@/data/planet-types';
import { BUILDING_MAP } from '@/data/buildings';
import { RECIPE_MAP } from '@/data/recipes';
import { ELEMENT_MAP } from '@/data/elements';
import { getCurrentLookups, findResourceDisplay } from '@/data/baked-lookups';
import { getCraftedMaterial } from '@/data/crafted-materials';
import { CATEGORY_LABELS } from '@/data/element-helpers';
import { getUsedCapacity, getUsedCapacityByType, calculateWarehouseCapacities, getOrbitBufferUsed, getResourceType } from '@/data/warehouse';
import { getBuildingEnergyOutput } from '@/economy/engine';
import { BuildingDialog, type BuildingDialogTarget } from './building-dialog';
import { ShipyardDialog } from './shipyard-dialog';
import { ProductionQueuePanel } from './production-queue-panel';
import { ProductionQueue } from './production-queue';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Globe2,
  Thermometer,
  Wind,
  Zap,
  ChevronLeft,
  Layers,
  Gem,
  Map,
  Warehouse,
  Factory,
  Rocket,
  Globe,
} from 'lucide-react';
import type { Planet, HexCell, AtmosphereType, LifeLevel, AtmosphericSlot, OrbitalSlot, PlanetResourceDeposit, ColonyRole, WarehouseSpecialization, BuildingLayer, StarSystem } from '@/core/types';

const ATMO_DISPLAY: Record<AtmosphereType, string> = {
  none: 'Нет', thin: 'Тонкая', standard: 'Стандартная', dense: 'Плотная',
  toxic: 'Токсичная', inert: 'Инертная', methane: 'Метановая', co2: 'CO₂',
};

const LIFE_DISPLAY: Record<LifeLevel, string> = {
  none: 'Нет', microbes: 'Микробы', plants: 'Растения', simple: 'Простая', complex: 'Сложная',
};

const TIER_DISPLAY: Record<PlanetResourceDeposit['tier'], { label: string; color: string; bgColor: string }> = {
  profile: { label: 'Профильный', color: 'text-emerald-400', bgColor: 'bg-emerald-900/30' },
  rare: { label: 'Редкий', color: 'text-amber-400', bgColor: 'bg-amber-900/30' },
  ultra_rare: { label: 'Ультраредкий', color: 'text-purple-400', bgColor: 'bg-purple-900/30' },
};

const CATEGORY_NAMES = CATEGORY_LABELS;

/** Форматирование количества ресурса */
function formatQuantity(q: number): string {
  if (q >= 1000000) return `${(q / 1000000).toFixed(1)}M`;
  if (q >= 1000) return `${(q / 1000).toFixed(1)}K`;
  return q.toString();
}

const HEX_SIZE = 24; // pixel size for hex rendering

type PlanetTab = 'map' | 'resources' | 'production';

export function PlanetView() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPlanetId = useGameStore((s) => s.selectedPlanetId);
  const selectPlanet = useGameStore((s) => s.selectPlanet);
  const setView = useGameStore((s) => s.setView);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<BuildingDialogTarget | null>(null);
  const [hoveredHexIndex, setHoveredHexIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<PlanetTab>('map');
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  // Block 02 (F7): shipyard dialog open state — opened from ShipyardIndicator
  // in the right sidebar (quick access without navigating through BuildingDialog).
  const [shipyardDialogOpen, setShipyardDialogOpen] = useState(false);

  if (!gameState || !selectedPlanetId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No planet selected
      </div>
    );
  }

  // Find the planet (и систему — для светимости звезды в HexInfoCard, R-31)
  let planet: Planet | undefined;
  let planetSystem: StarSystem | undefined;
  for (const sys of gameState.galaxy.systems) {
    const found = sys.planets.find((p) => p.id === selectedPlanetId);
    if (found) { planet = found; planetSystem = sys; break; }
  }

  if (!planet) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        Planet not found
      </div>
    );
  }

  const handleHexClick = (hexIndex: number) => {
    setDialogTarget({ kind: 'hex', hexIndex });
    setDialogOpen(true);
  };
  /** Открыть диалог постройки на атмосферном слоте. */
  const handleAtmosphereSlotClick = (slotIndex: number) => {
    setDialogTarget({ kind: 'atmosphere', slotIndex });
    setDialogOpen(true);
  };

  /** Открыть диалог постройки на орбитальном слоте. */
  const handleOrbitSlotClick = (slotIndex: number) => {
    setDialogTarget({ kind: 'orbit', slotIndex });
    setDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4">
      {/* Hex map area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Back button + title + tabs */}
        <div className="flex items-center gap-2 mb-2">
          <button
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
            onClick={() => { selectPlanet(null); setView('system'); }}
          >
            <ChevronLeft className="size-3" />
            ← Система
          </button>
          <Separator orientation="vertical" className="h-3 bg-white/10" />
          <span className="text-sm font-semibold text-white">{planet.name}</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1">
            {TYPE_NAMES[planet.type] ?? planet.type}
          </Badge>
          <Badge variant="outline" className="text-[9px] h-4 px-1">
            {SIZE_NAMES[planet.size] ?? planet.size}
          </Badge>
          <div className="flex-1" />
          {/* Tab buttons + Warehouse button */}
          <div className="flex gap-1 items-center" role="tablist" aria-label="Вкладки планеты">
            <button
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                activeTab === 'map' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setActiveTab('map')}
              role="tab"
              aria-selected={activeTab === 'map'}
              aria-controls="panel-map"
              id="tab-map"
            >
              <Map className="size-3 inline mr-0.5" />
              Карта
            </button>
            <button
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                activeTab === 'resources' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setActiveTab('resources')}
              role="tab"
              aria-selected={activeTab === 'resources'}
              aria-controls="panel-resources"
              id="tab-resources"
            >
              <Gem className="size-3 inline mr-0.5" />
              Ресурсы ({planet.resourceDeposits.length})
            </button>
            <button
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                activeTab === 'production' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setActiveTab('production')}
              role="tab"
              aria-selected={activeTab === 'production'}
              aria-controls="panel-production"
              id="tab-production"
            >
              <Factory className="size-3 inline mr-0.5" />
              Производство
            </button>
            <Separator orientation="vertical" className="h-3 bg-white/10 mx-0.5" />
            {/* Warehouse button → opens Sheet */}
            <Sheet open={warehouseOpen} onOpenChange={setWarehouseOpen}>
              <SheetTrigger asChild>
                <button
                  className="text-[10px] px-2 py-0.5 rounded transition-colors text-slate-500 hover:text-slate-300 hover:bg-white/10 flex items-center gap-0.5"
                >
                  <Warehouse className="size-3" />
                  Склад
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="bg-[#0d0d24] border-white/10 text-white w-80 sm:max-w-md">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-white">
                    <Warehouse className="size-4" />
                    Склад планеты
                  </SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-4 overflow-y-auto max-h-[calc(100vh-80px)]">
                  <WarehousePanel planet={planet} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Content area */}
        {activeTab === 'map' ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* R-29: ленивые залежи — до колонизации гексы «не разведаны» */}
            {!planet.owner && planet.type !== 'gas_giant' && (
              <div
                className="px-3 py-1.5 text-[11px] leading-snug text-amber-200/90 bg-amber-500/10 border-b border-amber-400/20"
                role="note"
              >
                Поверхность не разведана: залежи на гексах появятся после колонизации
                планеты (свод ресурсов — на вкладке «Ресурсы»)
              </div>
            )}
            <HexGrid
              hexes={planet.hexes}
              onHexClick={handleHexClick}
              onHexHover={setHoveredHexIndex}
              hoveredHexIndex={hoveredHexIndex}
            />
          </div>
        ) : activeTab === 'resources' ? (
          <div className="flex-1 min-h-0">
            <ResourcesTabContent planet={planet} />
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <ProductionTabContent planet={planet} />
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <div className="lg:w-72 shrink-0">
        <ScrollArea className="h-full max-h-[calc(100vh-100px)]">
          <div className="space-y-3 pr-1">
            {/* Compact planet info */}
            <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
              <CardContent className="px-4 py-0 space-y-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Планета
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Globe2 className="size-3" /> Гравитация</span>
                    <span className="font-mono">{planet.gravity.toFixed(2)}g</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Thermometer className="size-3" /> Температура</span>
                    <span className="font-mono">{planet.temperature > 0 ? '+' : ''}{planet.temperature}&deg;C</span>
                  </div>
                  {/* Audit 2026-08-28: добавлены орбитальный радиус, период,
                      количество гексов и луны (для газовых гигантов). */}
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Map className="size-3" /> Орбита</span>
                    <span className="font-mono">
                      {planet.orbitalRadius.toFixed(2)} а.е. • {planet.orbitalPeriod} дн.
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Layers className="size-3" /> Поверхность</span>
                    <span className="font-mono">
                      {planet.type === 'gas_giant'
                        ? 'Газовый гигант (без гексов)'
                        : `${planet.hexes.length} гексов (${SIZE_HEX_COUNT[planet.size]} на размер «${SIZE_NAMES[planet.size]}»)`}
                    </span>
                  </div>
                  {/* Луны газового гиганта */}
                  {planet.type === 'gas_giant' && planet.moons.length > 0 && (
                    <div className="space-y-1 pt-1 border-t border-white/5">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Globe className="size-3" />
                        Луны газового гиганта ({planet.moons.length})
                      </div>
                      {planet.moons.map((moon) => (
                        <div key={moon.id} className="text-[10px] flex justify-between text-slate-300">
                          <span className="truncate mr-2">{moon.name}</span>
                          <span className="font-mono text-slate-400 whitespace-nowrap">
                            {TYPE_NAMES[moon.type]} • {moon.radiusKm}км • {moon.gravity.toFixed(2)}g • {moon.hexes.length} гекс
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Wind className="size-3" /> Атмосфера</span>
                    <span>{ATMO_DISPLAY[planet.atmosphere.type] ?? planet.atmosphere.type}{planet.atmosphere.type !== 'none' ? ` (${planet.atmosphere.pressure.toFixed(1)} атм)` : ''}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Layers className="size-3" /> Жизнь</span>
                    <span>
                      {LIFE_DISPLAY[planet.life.level] ?? planet.life.level}
                      {planet.life.level !== 'none' ? ` (БИО ${planet.life.biodiversity.toFixed(2)})` : ''}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Zap className="size-3" /> Энергия</span>
                    <span className={`font-mono ${planet.energyBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {planet.energyBalance >= 0 ? '+' : ''}{planet.energyBalance.toFixed(1)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Hovered hex info */}
            {activeTab === 'map' && hoveredHexIndex !== null && planet.hexes[hoveredHexIndex] && (
              <HexInfoCard
                hex={planet.hexes[hoveredHexIndex]}
                starLuminosity={planetSystem?.stars[0]?.luminosity ?? 1.0}
                orbitalRadius={planet.orbitalRadius}
              />
            )}

            {/* Atmospheric Slots (gas giants) */}
            {planet.atmosphericSlots.length > 0 && (
              <SlotCard
                title="Атмосферные слоты"
                slots={planet.atmosphericSlots}
                layer="atmosphere"
                onSlotClick={handleAtmosphereSlotClick}
              />
            )}

            {/* Orbital Slots */}
            {planet.orbitSlots.length > 0 && (
              <SlotCard
                title="Орбитальные слоты"
                slots={planet.orbitSlots}
                layer="orbit"
                onSlotClick={handleOrbitSlotClick}
              />
            )}

            {/* Block 02 (F7): Shipyard indicator — quick access to shipyard queue */}
            <ShipyardIndicator planet={planet} onOpenShipyard={() => setShipyardDialogOpen(true)} />
          </div>
        </ScrollArea>
      </div>

      {/* Building dialog */}
      <BuildingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        planet={planet}
        target={dialogTarget}
      />

      {/* Block 02 (F7): Shipyard dialog — opened from ShipyardIndicator */}
      <ShipyardDialog
        open={shipyardDialogOpen}
        onOpenChange={setShipyardDialogOpen}
        planet={planet}
      />
    </div>
  );
}

// ============ Resources Tab ============

function ResourcesTabContent({ planet }: { planet: Planet }) {
  const deposits = planet.resourceDeposits;

  // Group by tier
  const profileDeposits = deposits.filter(d => d.tier === 'profile');
  const rareDeposits = deposits.filter(d => d.tier === 'rare');
  const ultraRareDeposits = deposits.filter(d => d.tier === 'ultra_rare');

  return (
    <ScrollArea className="h-full max-h-[calc(100vh-160px)]">
      <div className="p-2 space-y-4">
        {/* Hint about warehouse */}
        <div className="text-[10px] text-slate-600 italic px-1">
          Содержимое склада → кнопка «Склад» сверху
        </div>

        {/* Profile resources */}
        <ResourceSection
          title="Профильные ресурсы"
          subtitle="Значительные запасы — основа экономики планеты"
          deposits={profileDeposits}
          tierInfo={TIER_DISPLAY.profile}
        />

        {/* Rare resources */}
        <ResourceSection
          title="Редкие ресурсы"
          subtitle="Следовые количества — нужны для высоких технологий"
          deposits={rareDeposits}
          tierInfo={TIER_DISPLAY.rare}
        />

        {/* Ultra-rare resources */}
        <ResourceSection
          title="Ультраредкие ресурсы"
          subtitle="Уникальные находки — единичные экземпляры"
          deposits={ultraRareDeposits}
          tierInfo={TIER_DISPLAY.ultra_rare}
        />
      </div>
    </ScrollArea>
  );
}

function ResourceSection({
  title,
  subtitle,
  deposits,
  tierInfo,
}: {
  title: string;
  subtitle: string;
  deposits: PlanetResourceDeposit[];
  tierInfo: { label: string; color: string; bgColor: string };
}) {
  if (deposits.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Gem className={`size-4 ${tierInfo.color}`} />
        <span className="text-sm font-semibold text-white">{title}</span>
        <Badge className={`text-[9px] h-4 px-1 ${tierInfo.bgColor} ${tierInfo.color} border-0`}>
          {deposits.length}
        </Badge>
      </div>
      <div className="text-[10px] text-slate-500 mb-2">{subtitle}</div>
      <div className="space-y-1">
        {deposits.map((dep) => {
          const elDef = ELEMENT_MAP.get(dep.elementId);
          if (!elDef) return null;
          return (
            <div
              key={dep.elementId}
              className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
            >
              {/* Element symbol */}
              <div className={`w-8 h-8 rounded flex items-center justify-center text-xs font-bold ${tierInfo.bgColor} ${tierInfo.color} shrink-0`}>
                {elDef.symbol}
              </div>
              {/* Name and category */}
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-200 font-medium">{elDef.name}</div>
                <div className="text-[9px] text-slate-500">
                  {CATEGORY_NAMES[elDef.category] ?? elDef.category}
                  {dep.hexCount > 0 && ` • ${dep.hexCount} гексов`}
                </div>
              </div>
              {/* Quantity */}
              <div className="text-right shrink-0">
                <div className="text-xs font-mono text-slate-300">{formatQuantity(dep.totalQuantity)}</div>
                <div className="text-[9px] text-slate-500">
                  доступн. {(dep.avgAvailability * 100).toFixed(0)}%
                </div>
              </div>
              {/* Availability bar */}
              <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden shrink-0">
                <div
                  className={`h-full rounded-full ${
                    dep.avgAvailability > 0.4 ? 'bg-emerald-500' :
                    dep.avgAvailability > 0.15 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, dep.avgAvailability * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ Production Tab (Block 01 P4) ============

/** ID зданий, у которых есть очередь производства. */
const PRODUCTION_BUILDING_IDS = ['processor', 'synthesizer', 'refinery', 'shipyard'] as const;

/**
 * Найти все экземпляры здания (на поверхности / в атмосфере / на орбите).
 */
function findBuildingInstances(planet: Planet, buildingId: string): Array<{ layer: 'surface' | 'atmosphere' | 'orbit'; level: number; slotIndex: number }> {
  const instances: Array<{ layer: 'surface' | 'atmosphere' | 'orbit'; level: number; slotIndex: number }> = [];

  // Surface hexes
  planet.hexes.forEach((h, idx) => {
    if (h.buildingId === buildingId) {
      instances.push({ layer: 'surface', level: h.buildingLevel, slotIndex: idx });
    }
  });

  // Atmospheric slots
  planet.atmosphericSlots.forEach((s) => {
    if (s.buildingId === buildingId) {
      instances.push({ layer: 'atmosphere', level: s.buildingLevel, slotIndex: s.index });
    }
  });

  // Orbital slots
  planet.orbitSlots.forEach((s) => {
    if (s.buildingId === buildingId) {
      instances.push({ layer: 'orbit', level: s.buildingLevel, slotIndex: s.index });
    }
  });

  return instances;
}

function ProductionTabContent({ planet }: { planet: Planet }) {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  const planetQueue = gameState.productionQueues.get(planet.id);

  return (
    <ScrollArea className="h-full max-h-[calc(100vh-160px)]">
      <div className="p-2 space-y-4">
        <div className="text-[10px] text-slate-600 italic px-1">
          Очередь производства — по зданиям. Одновременно работает столько задач,
          сколько построено переработчиков; специализированные берут задачи своей
          категории в первую очередь, остальные идут по карусели.
        </div>

        {PRODUCTION_BUILDING_IDS.map((buildingId) => {
          const instances = findBuildingInstances(planet, buildingId);
          const buildingDef = BUILDING_MAP.get(buildingId);
          if (!buildingDef) return null;

          if (instances.length === 0) {
            return (
              <Card key={buildingId} className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3 opacity-60">
                <CardContent className="px-4 py-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Factory className="size-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-300">{buildingDef.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Постройте «{buildingDef.name}» для запуска производства.
                  </div>
                </CardContent>
              </Card>
            );
          }

          // Filter queue items by recipe.buildingId === buildingId
          const items = planetQueue?.items.filter((it) => {
            // Look up recipe to find its buildingId
            const recipe = RECIPE_MAP.get(it.recipeId);
            return recipe?.buildingId === buildingId;
          }) ?? [];

          return (
            <Card key={buildingId} className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
              <CardContent className="px-4 py-0 space-y-3">
                <div className="flex items-center gap-2">
                  <Factory className="size-4 text-amber-400" />
                  <span className="text-sm font-semibold text-white">{buildingDef.name}</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1">
                    {instances.length} шт.
                  </Badge>
                  <span className="text-[10px] text-slate-500 ml-auto">
                    Lvl {instances.map((i) => i.level).join(', ')}
                  </span>
                </div>

                {/* Current queue for this building */}
                <ProductionQueue planetId={planet.id} items={items} />

                {/* Recipe picker + add-to-queue buttons */}
                <ProductionQueuePanel planetId={planet.id} buildingId={buildingId} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ============ Hex Grid Component ============

interface HexGridProps {
  hexes: HexCell[];
  onHexClick: (hexIndex: number) => void;
  onHexHover: (hexIndex: number | null) => void;
  hoveredHexIndex: number | null;
}

function HexGrid({ hexes, onHexClick, onHexHover, hoveredHexIndex }: HexGridProps) {
  // Compute hex positions
  const hexPositions = useMemo(() => {
    return hexes.map((hex, i) => {
      const { x, y } = axialToPixel(hex.coord.q, hex.coord.r, HEX_SIZE);
      return { x, y, index: i };
    });
  }, [hexes]);

  // Compute bounds
  const { viewBox } = useMemo(() => {
    if (hexPositions.length === 0) {
      return { viewBox: '0 0 100 100' };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pos of hexPositions) {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }

    const padding = HEX_SIZE * 2;
    const vx = minX - padding;
    const vy = minY - padding;
    const vw = maxX - minX + padding * 2;
    const vh = maxY - minY + padding * 2;

    return { viewBox: `${vx} ${vy} ${vw} ${vh}` };
  }, [hexPositions]);

  // Hex corner points (flat-top)
  const getHexCorners = useCallback((cx: number, cy: number, size: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i);
      const px = cx + size * Math.cos(angle);
      const py = cy + size * Math.sin(angle);
      points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return points.join(' ');
  }, []);

  return (
    <svg
      viewBox={viewBox}
      className="w-full h-full"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Гекс-сетка планеты: ${hexes.length} гексов. Кликните на гекс для строительства.`}
    >
      {hexPositions.map((pos) => {
        const hex = hexes[pos.index];
        const isHovered = pos.index === hoveredHexIndex;
        const terrainColor = TERRAIN_COLORS[hex.terrain] ?? '#444';
        const buildingDef = hex.buildingId ? BUILDING_MAP.get(hex.buildingId) : null;

        const corners = getHexCorners(pos.x, pos.y, HEX_SIZE - 1);

        return (
          <g
            key={pos.index}
            onClick={() => onHexClick(pos.index)}
            onMouseEnter={() => onHexHover(pos.index)}
            onMouseLeave={() => onHexHover(null)}
            className="cursor-pointer"
          >
            {/* Hex shape */}
            <polygon
              points={corners}
              fill={terrainColor}
              stroke={isHovered ? '#fff' : 'rgba(255,255,255,0.15)'}
              strokeWidth={isHovered ? 1.5 : 0.5}
              opacity={hex.terrain === 'ocean' ? 0.6 : 0.8}
              className="transition-all duration-100"
            />

            {/* Building indicator */}
            {buildingDef && (
              <>
                {/* Building background circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={HEX_SIZE * 0.35}
                  fill="rgba(0,0,0,0.6)"
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth={0.5}
                />
                {/* Building first letter */}
                <text
                  x={pos.x}
                  y={pos.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={
                    buildingDef.category === 'energy' ? '#4ade80' :
                    buildingDef.id === 'colony_hub' ? '#22d3ee' :
                    '#fbbf24'
                  }
                  fontSize={HEX_SIZE * 0.4}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {buildingDef.name.charAt(0)}
                </text>
                {/* Level indicator */}
                {hex.buildingLevel > 1 && (
                  <text
                    x={pos.x + HEX_SIZE * 0.3}
                    y={pos.y - HEX_SIZE * 0.25}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={5}
                    fontFamily="monospace"
                    opacity={0.7}
                  >
                    {hex.buildingLevel}
                  </text>
                )}
              </>
            )}

            {/* Deposit indicators (small dots) */}
            {!hex.buildingId && hex.deposits.length > 0 && (
              <circle
                cx={pos.x + HEX_SIZE * 0.3}
                cy={pos.y + HEX_SIZE * 0.25}
                r={2}
                fill="#fbbf24"
                opacity={0.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ============ Hex Info Card ============

function HexInfoCard({ hex, starLuminosity, orbitalRadius }: {
  hex: HexCell;
  /** R-31: светимость звезды системы — реальная выработка солнечных станций (P1-26). */
  starLuminosity: number;
  /** R-31: орб. радиус планеты — дистанционный фактор P1-26. */
  orbitalRadius: number;
}) {
  const buildingDef = hex.buildingId ? BUILDING_MAP.get(hex.buildingId) : null;

  return (
    <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
      <CardContent className="px-4 py-0 space-y-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Информация о гексе
        </div>
        <div className="flex items-center gap-2">
          <div
            className="size-4 rounded-sm border border-white/20"
            style={{ backgroundColor: TERRAIN_COLORS[hex.terrain] }}
          />
          <span className="text-xs text-slate-300">
            {TERRAIN_NAMES[hex.terrain] ?? hex.terrain}
          </span>
          <span className="text-xs text-slate-600 font-mono">
            ({hex.coord.q},{hex.coord.r})
          </span>
        </div>

        {buildingDef && (
          <div className="space-y-1">
            <div className="text-xs font-medium" style={{ color: buildingDef.id === 'colony_hub' ? '#22d3ee' : '#fbbf24' }}>
              {buildingDef.name} (Lv.{hex.buildingLevel})
            </div>
            {buildingDef.energyConsumption > 0 && (
              <div className="text-xs text-orange-400 flex items-center gap-1">
                <Zap className="size-3" />-{buildingDef.energyConsumption}/tick
              </div>
            )}
            {(buildingDef.category === 'energy' || buildingDef.id === 'colony_hub') && (
              <div className={`text-xs flex items-center gap-1 ${buildingDef.id === 'colony_hub' ? 'text-cyan-400' : 'text-green-400'}`}>
                <Zap className="size-3" />+{getBuildingEnergyOutput(
                  buildingDef.id,
                  hex.buildingLevel,
                  'surface',
                  starLuminosity,
                  orbitalRadius,
                ).toFixed(1)}/tick{buildingDef.id === 'solar_plant' ? ` (L☉ ${starLuminosity.toFixed(2)}, R ${orbitalRadius.toFixed(1)})` : buildingDef.id === 'colony_hub' ? ' (базовая энергия)' : ''}
              </div>
            )}
          </div>
        )}

        {hex.deposits.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-slate-500 uppercase">Залежи</div>
            {hex.deposits.map((dep, i) => {
              // Ищем отображаемое название руды/соединения через BakedGalaxyModel
              const lookups = getCurrentLookups();
              const resourceInfo = findResourceDisplay(lookups, dep.elementId);
              const displayName = resourceInfo?.name
                ?? (() => {
                  // Fallback: strip '-ore' suffix, lookup element
                  const pureId = dep.elementId.replace('-ore', '');
                  const elDef = ELEMENT_MAP.get(pureId);
                  return elDef ? `${elDef.name} (руда)` : dep.elementId;
                })();
              // Показываем формулу руды если есть
              const formula = resourceInfo?.formula ?? '';

              // Ищем данные о цепочке переработки
              const oreDef = lookups.oreMap.get(dep.elementId);
              const atmoDef = lookups.atmosphericMap.get(dep.elementId);
              const iceDef = lookups.iceMap.get(dep.elementId);
              const contained = oreDef?.containedElements
                ?? atmoDef?.containedElements
                ?? iceDef?.containedElements
                ?? null;
              const processingBuilding = oreDef?.processingBuildingId
                ?? atmoDef?.processingBuildingId
                ?? iceDef?.processingBuildingId
                ?? null;
              const buildingNames: Record<string, string> = {
                processor: 'Переработчик',
                refinery: 'Очистительный комплекс',
              };

              return (
                <div key={i} className="space-y-0.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span className="truncate" title={formula ? `${displayName} (${formula})` : displayName}>
                      {displayName}
                    </span>
                    <span className="font-mono shrink-0 ml-2">{Math.floor(dep.quantity)}</span>
                  </div>
                  {/* Цепочка переработки */}
                  {contained && contained.length > 0 && (
                    <div className="text-[10px] text-slate-500 pl-2">
                      {processingBuilding && (
                        <span className="text-slate-600">→ {buildingNames[processingBuilding] ?? processingBuilding} → </span>
                      )}
                      {contained.map((ce, j) => {
                        const elName = ELEMENT_MAP.get(ce.elementId)?.name ?? ce.elementId;
                        return (
                          <span key={j}>
                            {j > 0 && <span className="text-slate-700"> + </span>}
                            <span className="text-emerald-600">{elName}</span>
                            <span className="text-slate-700">×{ce.yield}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ Slot Card (Atmosphere / Orbit) ============

function SlotCard({
  title,
  slots,
  layer,
  onSlotClick,
}: {
  title: string;
  slots: (AtmosphericSlot | OrbitalSlot)[];
  layer: BuildingLayer;
  onSlotClick: (slotIndex: number) => void;
}) {
  const filledCount = slots.filter((s) => s.buildingId !== null).length;

  return (
    <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
      <CardContent className="px-4 py-0 space-y-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {title} ({filledCount}/{slots.length})
        </div>
        <div className="space-y-1">
          {slots.map((slot) => {
            const buildingDef = slot.buildingId ? BUILDING_MAP.get(slot.buildingId) : null;
            const isOccupied = !!slot.buildingId;
            return (
              <div
                key={slot.index}
                className="flex items-center justify-between text-xs gap-1"
              >
                <span className="text-slate-500 font-mono shrink-0">#{slot.index + 1}</span>
                {buildingDef ? (
                  <button
                    type="button"
                    className="text-amber-400 cursor-pointer truncate text-left hover:text-amber-300 transition-colors"
                    title={`${buildingDef.name} — нажмите для просмотра`}
                    onClick={() => onSlotClick(slot.index)}
                    aria-label={`${buildingDef.name} — открыть диалог здания`}
                  >
                    {buildingDef.name} {slot.buildingLevel > 1 ? `(Lv.${slot.buildingLevel})` : ''}
                  </button>
                ) : (
                  <button
                    className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
                    onClick={() => onSlotClick(slot.index)}
                    aria-label={`Построить здание в слоте ${layer} #${slot.index + 1}`}
                  >
                    + Построить
                  </button>
                )}
                {/* Show "Построить" hint even on occupied slot — clicking it opens dialog
                    so user can switch tabs and build elsewhere on the same planet. */}
                {isOccupied && (
                  <span className="text-[9px] text-slate-600 italic shrink-0">
                    клик = открыть
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Warehouse Panel ============

const ROLE_NAMES: Record<ColonyRole, string> = {
  mining: 'Рудная',
  industrial: 'Промышленная',
  research: 'Научная',
  capital: 'Столица',
  custom: 'Своя',
};

const SPEC_NAMES: Record<WarehouseSpecialization, string> = {
  universal: 'Универсальный',
  ore: 'Рудный (+25%)',
  metal: 'Металлургический (+20%)',
  gas: 'Газовый (+20%)',
  component: 'Компонентный (+15%)',
};

function WarehousePanel({ planet }: { planet: Planet }) {
  const setColonyRole = useGameStore((s) => s.setColonyRole);
  const setWarehouseSpecialization = useGameStore((s) => s.setWarehouseSpecialization);
  const gameState = useGameStore((s) => s.gameState);

  // Block 02 (F7): compute fleet fuel summary (sum across all player fleets).
  // Each fuelStore entry per fleet is summed by type. Rendered компактно в
  // конце единого списка «Хранилище» (R-28) — стратегический обзор топлива
  // при проверке склада планеты.
  // NOTE: hooks must be called unconditionally — see Rules of Hooks.
  const fleetFuelSummary = useMemo(() => {
    if (!gameState) return [];
    const sums: Record<string, number> = {};
    for (const fleet of gameState.fleets) {
      if (fleet.owner !== gameState.playerFactionId) continue;
      for (const [fuelType, amount] of Object.entries(fleet.fuelStores)) {
        sums[fuelType] = (sums[fuelType] ?? 0) + (amount as number);
      }
    }
    return Object.entries(sums).map(([fuelType, amount]) => ({ fuelType, amount }));
  }, [gameState]);

  if (!planet.warehouse) {
    return (
      <div className="text-sm text-slate-500 text-center py-8">
        Склад ещё не построен
      </div>
    );
  }

  const wh = planet.warehouse;
  const used = getUsedCapacity(planet);
  // R-31 (audit): знаменатель — сумма живых caps ВСЕХ 4 складов (включая
  // газовый). Раньше брались wh.totalCapacity (в старых сейвах без газа),
  // при том что числитель used газ включал — бар мог показывать >100%.
  const liveCaps = calculateWarehouseCapacities(planet);
  const totalCapacity = liveCaps.ore + liveCaps.processed + liveCaps.highTech + liveCaps.gas;
  const pct = totalCapacity > 0 ? (used / totalCapacity) * 100 : 0;
  const orbitUsed = getOrbitBufferUsed(planet);
  const orbitPct = wh.orbitBuffer.capacity > 0 ? (orbitUsed / wh.orbitBuffer.capacity) * 100 : 0;

  // R-27 (v3.1): раздельные показатели по 4 складам (включая газовый).
  // calculateWarehouseCapacities считает газовый склад всегда (фолбэк базы
  // для старых сейвов без capacities.gas).
  const caps = calculateWarehouseCapacities(planet);
  const warehouseRows: Array<{ key: 'ore' | 'processed' | 'highTech' | 'gas'; label: string; icon: string; cap: number }> = [
    { key: 'ore', label: 'Рудный', icon: '⛏', cap: caps.ore },
    { key: 'processed', label: 'Элементы', icon: '⚙', cap: caps.processed },
    { key: 'highTech', label: 'Высокотех', icon: '🔬', cap: caps.highTech },
    { key: 'gas', label: 'Газовый', icon: '💨', cap: caps.gas },
  ];

  // Reserve entries sorted by priority (highest first)
  const reserveEntries = Object.values(wh.reserves).sort((a, b) => b.priority - a.priority);

  return (
    <div className="space-y-4">
      {/* Capacity bars: R-27 — раздельно по 4 складам + общий итог */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-slate-400">Вместимость (всего)</span>
          <span className="font-mono text-slate-300">{Math.floor(used)} / {totalCapacity}</span>
        </div>
        <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
          {warehouseRows.map(({ key, label, icon, cap }) => {
            const typeUsed = getUsedCapacityByType(planet, key);
            const typePct = cap > 0 ? (typeUsed / cap) * 100 : 0;
            return (
              <div key={key} className="space-y-0.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-500">{icon} {label}</span>
                  <span className="font-mono text-slate-400">{Math.floor(typeUsed)}/{cap}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      typePct > 90 ? 'bg-red-500' : typePct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, typePct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Colony role selector */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Роль колонии</span>
        <div className="flex gap-1 flex-wrap">
          {(['mining', 'industrial', 'research', 'capital', 'custom'] as ColonyRole[]).map(role => (
            <button
              key={role}
              onClick={() => setColonyRole(planet.id, role)}
              className={`text-[9px] px-2 py-1 rounded transition-colors ${
                wh.colonyRole === role
                  ? 'bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500/30'
                  : 'bg-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/10'
              }`}
            >
              {ROLE_NAMES[role]}
            </button>
          ))}
        </div>
      </div>

      {/* Specialization selector */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">Специализация</span>
        <div className="flex gap-1 flex-wrap">
          {(['universal', 'ore', 'metal', 'gas', 'component'] as WarehouseSpecialization[]).map(spec => (
            <button
              key={spec}
              onClick={() => setWarehouseSpecialization(planet.id, spec)}
              className={`text-[9px] px-2 py-1 rounded transition-colors ${
                wh.specialization === spec
                  ? 'bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/30'
                  : 'bg-white/5 text-slate-500 hover:text-slate-300 hover:bg-white/10'
              }`}
            >
              {SPEC_NAMES[spec]}
            </button>
          ))}
        </div>
      </div>

      {/* Orbit buffer */}
      {wh.orbitBuffer.capacity > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Орбитальный буфер</span>
            <span className="font-mono text-slate-300">{Math.floor(orbitUsed)} / {wh.orbitBuffer.capacity}</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-500"
              style={{ width: `${Math.min(100, orbitPct)}%` }}
            />
          </div>
        </div>
      )}

      {/* R-28: ЕДИНЫЙ список «количество / резерв» — объединение бывших
          раздельных секций «Резервы» и «Хранимые ресурсы» (запрос владельца:
          «можно объединить, вывод упростить: количество / резерв, ниже
          резерва — красный, выше — зелёный»). */}
      {(() => {
        const lookups = getCurrentLookups();
        // lucide-react экспортирует иконку Map — затеняет глобальный Map,
        // поэтому здесь простой Record вместо new Map()
        const reserveMap: Record<string, { resourceId: string; minimum: number; priority: number }> = {};
        for (const r of reserveEntries) reserveMap[r.resourceId] = r;
        // Союз: все ресурсы на складе (кол-во > 0) + все резервы (даже при 0)
        const ids = new Set<string>([
          ...Object.keys(planet.resources).filter((id) => (planet.resources[id] ?? 0) > 0),
          ...Object.keys(reserveMap),
        ]);
        const rows = [...ids].map((id) => {
          const amount = planet.resources[id] ?? 0;
          const reserve = reserveMap[id];
          const resourceInfo = findResourceDisplay(lookups, id);
          const elDef = ELEMENT_MAP.get(id);
          const crafted = getCraftedMaterial(id);
          const name = resourceInfo?.name ?? elDef?.name ?? crafted?.name ?? id.replace(/-/g, ' ');
          const resType = getResourceType(id);
          const badge = resType === 'ore' ? '⛏' : resType === 'atmospheric' ? '💨' : resType === 'ice' ? '❄' : '';
          return { id, name, badge, amount, reserve };
        });
        // Резервные — первыми (по приоритету), затем по количеству
        rows.sort((a, b) => {
          const ra = a.reserve !== undefined;
          const rb = b.reserve !== undefined;
          if (ra !== rb) return ra ? -1 : 1;
          if (ra && rb) return (b.reserve!.priority ?? 0) - (a.reserve!.priority ?? 0);
          return b.amount - a.amount;
        });
        const fuelEntries = fleetFuelSummary.filter((e) => e.amount > 0);
        if (rows.length === 0 && fuelEntries.length === 0) return null;
        return (
          <div className="space-y-1.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              Хранилище · количество / резерв
            </span>
            <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1 custom-scrollbar">
              {rows.map((row) => {
                const minimum = row.reserve?.minimum ?? 0;
                const hasReserve = row.reserve !== undefined && minimum > 0;
                const isBelow = hasReserve && row.amount < minimum;
                const amountColor = !hasReserve
                  ? 'text-slate-300'
                  : isBelow ? 'text-red-400' : 'text-emerald-400';
                return (
                  <div key={row.id} className="flex items-center justify-between text-[10px] py-0.5">
                    <span className={`${isBelow ? 'text-red-400' : 'text-slate-300'} truncate`} title={row.id}>
                      {row.badge && <span className="mr-0.5">{row.badge}</span>}
                      {row.name}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className={`font-mono ${amountColor}`}>{Math.floor(row.amount)}</span>
                      {hasReserve && (
                        <>
                          <span className="text-slate-500">/</span>
                          <span className="text-slate-400 font-mono">{minimum}</span>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
              {/* Block 02 (F7): топливо флотов — компактно, в конце списка */}
              {fuelEntries.map((entry) => (
                <div key={`fuel-${entry.fuelType}`} className="flex items-center justify-between text-[10px] py-0.5">
                  <span className="text-cyan-300 truncate" title={entry.fuelType}>🚀 {entry.fuelType}</span>
                  <span className="font-mono text-cyan-200">{Math.floor(entry.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Block 02 (F7): Shipyard indicator — compact card in planet-view right
 * sidebar showing shipyard presence + queue size. Click opens ShipyardDialog
 * for quick access (player doesn't have to navigate BuildingDialog →
 * shipyard → «Очередь верфи»).
 *
 * Hidden if the planet has no shipyard building instance. Uses the
 * shared `findBuildingInstances` helper to detect shipyard across all
 * building layers (surface hexes, atmospheric slots, orbital slots).
 */
function ShipyardIndicator({
  planet,
  onOpenShipyard,
}: {
  planet: Planet;
  onOpenShipyard: () => void;
}) {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  const shipyardInstances = findBuildingInstances(planet, 'shipyard');
  if (shipyardInstances.length === 0) return null;

  // Sum levels across all shipyard instances (each level adds build capacity
  // in the MVP — Etap 4 may parallelize queues per-instance).
  const totalLevels = shipyardInstances.reduce((sum, i) => sum + i.level, 0);
  // Read queue for this planet — may be undefined if no items enqueued yet.
  const queue = gameState.shipyardQueues.get(planet.id);
  const queueSize = queue?.items.length ?? 0;
  // Count items currently in progress (progressTicks < totalTicks)
  const inProgress = queue?.items.filter(i => i.progressTicks < i.totalTicks).length ?? 0;

  return (
    <Card className="bg-[#0d0d24] border-amber-600/30 text-white py-3 gap-3">
      <CardContent className="px-4 py-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Rocket className="size-3.5 text-amber-300" />
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              Верфь
            </span>
          </div>
          <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-600/40 text-amber-200">
            L{totalLevels}
          </Badge>
        </div>
        <div className="text-xs text-slate-300 space-y-0.5">
          <div className="flex justify-between">
            <span className="text-slate-500">В очереди</span>
            <span className="font-mono text-amber-200">{queueSize}</span>
          </div>
          {inProgress > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Строится</span>
              <span className="font-mono text-cyan-300">{inProgress}</span>
            </div>
          )}
        </div>
        <button
          onClick={onOpenShipyard}
          className="w-full mt-1 text-[10px] text-amber-300 hover:text-amber-100 hover:bg-amber-600/10 py-1 rounded transition-colors border border-amber-600/20 hover:border-amber-600/40"
          aria-label={`Открыть очередь верфи планеты ${planet.name}`}
        >
          Открыть очередь
        </button>
      </CardContent>
    </Card>
  );
}
