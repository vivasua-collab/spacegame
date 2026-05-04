'use client';

import { useCallback, useMemo, useState } from 'react';
import { useGameStore } from '@/stores/game-store';
import { axialToPixel } from '@/galaxy';
import { TERRAIN_COLORS, TERRAIN_NAMES, TYPE_NAMES, SIZE_NAMES } from '@/data/planet-types';
import { BUILDING_MAP } from '@/data/buildings';
import { ELEMENT_MAP, ELEMENTS } from '@/data/elements';
import { getUsedCapacity, getOrbitBufferUsed } from '@/data/warehouse';
import { BuildingDialog } from './building-dialog';
import { ResourcePanel } from './resource-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Globe2,
  Thermometer,
  Wind,
  Zap,
  ChevronLeft,
  Layers,
  Ruler,
  Clock,
  Orbit,
  Gem,
  Info,
  Weight,
  Warehouse,
} from 'lucide-react';
import type { Planet, HexCell, HexTerrain, AtmosphereType, LifeLevel, AtmosphericSlot, OrbitalSlot, PlanetResourceDeposit, ColonyRole, WarehouseSpecialization } from '@/core/types';

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

const CATEGORY_NAMES: Record<string, string> = {
  structural: 'Строительные',
  fuel: 'Топливные',
  alloy: 'Сплавы',
  electronics: 'Электроника',
  chemical: 'Химия',
  energy: 'Энергия',
  rare: 'Редкие',
  light: 'Лёгкие',
};

/** Форматирование орбитального периода */
function formatOrbitalPeriod(days: number): string {
  if (days < 1) return '<1 дня';
  if (days < 365) return `${days} дн.`;
  const years = days / 365.25;
  if (years < 10) return `${years.toFixed(1)} лет`;
  return `${Math.round(years)} лет`;
}

/** Форматирование количества ресурса */
function formatQuantity(q: number): string {
  if (q >= 1000000) return `${(q / 1000000).toFixed(1)}M`;
  if (q >= 1000) return `${(q / 1000).toFixed(1)}K`;
  return q.toString();
}

const HEX_SIZE = 24; // pixel size for hex rendering

type PlanetTab = 'overview' | 'resources';

export function PlanetView() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedPlanetId = useGameStore((s) => s.selectedPlanetId);
  const selectPlanet = useGameStore((s) => s.selectPlanet);
  const setView = useGameStore((s) => s.setView);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedHexIndex, setSelectedHexIndex] = useState<number | null>(null);
  const [hoveredHexIndex, setHoveredHexIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<PlanetTab>('overview');

  if (!gameState || !selectedPlanetId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No planet selected
      </div>
    );
  }

  // Find the planet
  let planet: Planet | undefined;
  for (const sys of gameState.galaxy.systems) {
    const found = sys.planets.find((p) => p.id === selectedPlanetId);
    if (found) { planet = found; break; }
  }

  if (!planet) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        Planet not found
      </div>
    );
  }

  const selectedHex = selectedHexIndex !== null ? planet.hexes[selectedHexIndex] : null;

  const handleHexClick = (hexIndex: number) => {
    setSelectedHexIndex(hexIndex);
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
          {/* Tab buttons */}
          <div className="flex gap-1">
            <button
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                activeTab === 'overview' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setActiveTab('overview')}
            >
              <Info className="size-3 inline mr-0.5" />
              Обзор
            </button>
            <button
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                activeTab === 'resources' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setActiveTab('resources')}
            >
              <Gem className="size-3 inline mr-0.5" />
              Ресурсы ({planet.resourceDeposits.length})
            </button>
          </div>
        </div>

        {/* Content area */}
        {activeTab === 'overview' ? (
          <div className="flex-1 min-h-0">
            <HexGrid
              hexes={planet.hexes}
              onHexClick={handleHexClick}
              onHexHover={setHoveredHexIndex}
              hoveredHexIndex={hoveredHexIndex}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <ResourcesTabContent planet={planet} />
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <div className="lg:w-72 shrink-0 space-y-3 overflow-hidden">
        {/* Planet info */}
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
                <span className="flex items-center gap-1 text-slate-500"><Weight className="size-3" /> Плотность</span>
                <span className="font-mono">{planet.density.toFixed(1)} г/см³</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="flex items-center gap-1 text-slate-500"><Ruler className="size-3" /> Радиус</span>
                <span className="font-mono">{planet.radiusKm.toLocaleString()} км</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="flex items-center gap-1 text-slate-500"><Thermometer className="size-3" /> Температура</span>
                <span className="font-mono">{planet.temperature > 0 ? '+' : ''}{planet.temperature}&deg;C</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="flex items-center gap-1 text-slate-500"><Ruler className="size-3" /> Расстояние</span>
                <span className="font-mono">{planet.orbitalRadius.toFixed(2)} AU</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="flex items-center gap-1 text-slate-500"><Orbit className="size-3" /> Орбита</span>
                <span className="font-mono">#{planet.orbitNumber}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="flex items-center gap-1 text-slate-500"><Clock className="size-3" /> Период</span>
                <span className="font-mono">{formatOrbitalPeriod(planet.orbitalPeriod)}</span>
              </div>
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
        {activeTab === 'overview' && hoveredHexIndex !== null && planet.hexes[hoveredHexIndex] && (
          <HexInfoCard hex={planet.hexes[hoveredHexIndex]} />
        )}

        {/* Atmosphere Composition */}
        {planet.atmosphere.type !== 'none' && planet.atmosphere.composition.length > 0 && (
          <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
            <CardContent className="px-4 py-0 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Состав атмосферы
              </div>
              <div className="space-y-0.5">
                {planet.atmosphere.composition.map((comp, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-300">
                    <span>{comp.element}</span>
                    <span className="font-mono">{comp.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Atmospheric Slots (gas giants) */}
        {planet.atmosphericSlots.length > 0 && (
          <SlotCard title="Атмосферные слоты" slots={planet.atmosphericSlots} />
        )}

        {/* Orbital Slots */}
        {planet.orbitSlots.length > 0 && (
          <SlotCard title="Орбитальные слоты" slots={planet.orbitSlots} />
        )}

        {/* Resources summary (in sidebar) */}
        <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
          <CardContent className="px-4 py-0">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Ресурсы
            </div>
            <ResourcePanel resources={planet.resources} className="h-48" />
          </CardContent>
        </Card>

        {/* Warehouse panel */}
        <WarehousePanel planet={planet} />
      </div>

      {/* Building dialog */}
      <BuildingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        planet={planet}
        hexIndex={selectedHexIndex}
        terrain={selectedHex?.terrain ?? null}
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
  const { viewBox, centerX, centerY } = useMemo(() => {
    if (hexPositions.length === 0) {
      return { viewBox: '0 0 100 100', centerX: 50, centerY: 50 };
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

    return {
      viewBox: `${vx} ${vy} ${vw} ${vh}`,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
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

function HexInfoCard({ hex }: { hex: HexCell }) {
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
            {buildingDef.category === 'energy' && (
              <div className="text-xs text-green-400 flex items-center gap-1">
                <Zap className="size-3" />+10/tick
              </div>
            )}
            {buildingDef.id === 'colony_hub' && (
              <div className="text-xs text-cyan-400 flex items-center gap-1">
                <Zap className="size-3" />+5/tick (базовая энергия)
              </div>
            )}
          </div>
        )}

        {hex.deposits.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-[10px] text-slate-500 uppercase">Залежи</div>
            {hex.deposits.map((dep, i) => {
              // M-04 fix: strip '-ore' suffix for ELEMENT_MAP lookup
              const pureId = dep.elementId.replace('-ore', '');
              const elDef = ELEMENT_MAP.get(pureId);
              return (
                <div key={i} className="flex justify-between text-xs text-slate-400">
                  <span>{elDef?.symbol ?? dep.elementId}</span>
                  <span className="font-mono">{Math.floor(dep.quantity)}</span>
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

function SlotCard({ title, slots }: { title: string; slots: (AtmosphericSlot | OrbitalSlot)[] }) {
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
            return (
              <div key={slot.index} className="flex items-center justify-between text-xs">
                <span className="text-slate-500 font-mono">#{slot.index + 1}</span>
                {buildingDef ? (
                  <span className="text-amber-400">
                    {buildingDef.name} {slot.buildingLevel > 1 ? `(Lv.${slot.buildingLevel})` : ''}
                  </span>
                ) : (
                  <span className="text-slate-600 italic">Пусто</span>
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
  ore: 'Рудный (+10%)',
  metal: 'Металлургический (+10%)',
  gas: 'Газовый (+10%)',
  component: 'Компонентный (+10%)',
};

function WarehousePanel({ planet }: { planet: Planet }) {
  const setColonyRole = useGameStore((s) => s.setColonyRole);
  const setWarehouseSpecialization = useGameStore((s) => s.setWarehouseSpecialization);

  if (!planet.warehouse) return null;

  const wh = planet.warehouse;
  const used = getUsedCapacity(planet);
  const pct = wh.totalCapacity > 0 ? (used / wh.totalCapacity) * 100 : 0;
  const orbitUsed = getOrbitBufferUsed(planet);
  const orbitPct = wh.orbitBuffer.capacity > 0 ? (orbitUsed / wh.orbitBuffer.capacity) * 100 : 0;

  // Reserve entries sorted by priority (highest first)
  const reserveEntries = Object.values(wh.reserves).sort((a, b) => b.priority - a.priority);

  return (
    <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
      <CardContent className="px-4 py-0 space-y-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Warehouse className="size-3.5" />
          Склад планеты
        </div>

        {/* Capacity bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Вместимость</span>
            <span className="font-mono">{Math.floor(used)} / {wh.totalCapacity}</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        {/* Colony role selector */}
        <div className="space-y-1">
          <span className="text-[10px] text-slate-500 uppercase">Роль колонии</span>
          <div className="flex gap-1 flex-wrap">
            {(['mining', 'industrial', 'research', 'capital', 'custom'] as ColonyRole[]).map(role => (
              <button
                key={role}
                onClick={() => setColonyRole(planet.id, role)}
                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                  wh.colonyRole === role
                    ? 'bg-cyan-600/30 text-cyan-300'
                    : 'bg-white/5 text-slate-500 hover:text-slate-300'
                }`}
              >
                {ROLE_NAMES[role]}
              </button>
            ))}
          </div>
        </div>

        {/* Specialization selector */}
        <div className="space-y-1">
          <span className="text-[10px] text-slate-500 uppercase">Специализация</span>
          <div className="flex gap-1 flex-wrap">
            {(['universal', 'ore', 'metal', 'gas', 'component'] as WarehouseSpecialization[]).map(spec => (
              <button
                key={spec}
                onClick={() => setWarehouseSpecialization(planet.id, spec)}
                className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
                  wh.specialization === spec
                    ? 'bg-purple-600/30 text-purple-300'
                    : 'bg-white/5 text-slate-500 hover:text-slate-300'
                }`}
              >
                {SPEC_NAMES[spec]}
              </button>
            ))}
          </div>
        </div>

        {/* Reserves list */}
        {reserveEntries.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-slate-500 uppercase">Резервы</span>
            <div className="max-h-32 overflow-y-auto space-y-0.5 pr-1 custom-scrollbar">
              {reserveEntries.map(reserve => {
                const current = planet.resources[reserve.resourceId] ?? 0;
                const isBelowMin = current < reserve.minimum;
                return (
                  <div key={reserve.resourceId} className="flex items-center justify-between text-[10px]">
                    <span className={`${isBelowMin ? 'text-red-400' : 'text-slate-400'} font-mono truncate`}>
                      {reserve.resourceId}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className={`font-mono ${isBelowMin ? 'text-red-400' : 'text-slate-500'}`}>
                        {Math.floor(current)}
                      </span>
                      <span className="text-slate-600">/</span>
                      <span className="text-slate-600 font-mono">{reserve.minimum}</span>
                      <span className="text-slate-700 ml-0.5">P{reserve.priority}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Orbit buffer */}
        {wh.orbitBuffer.capacity > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Орбитальный буфер</span>
              <span className="font-mono">{Math.floor(orbitUsed)} / {wh.orbitBuffer.capacity}</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-cyan-500"
                style={{ width: `${Math.min(100, orbitPct)}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
