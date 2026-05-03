'use client';

import { useGameStore } from '@/stores/game-store';
import { TYPE_NAMES, SIZE_NAMES } from '@/data/planet-types';
import { STAR_TYPE_MAP } from '@/data/star-types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sun,
  Globe2,
  Thermometer,
  Wind,
  Zap,
  ArrowLeftRight,
  ArrowRight,
  Orbit,
  Clock,
  Ruler,
  Flag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StarSystem, Planet, AtmosphereType, LifeLevel } from '@/core/types';

export function SystemView() {
  const gameState = useGameStore((s) => s.gameState);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);
  const selectPlanet = useGameStore((s) => s.selectPlanet);
  const selectSystem = useGameStore((s) => s.selectSystem);
  const selectedPlanetId = useGameStore((s) => s.selectedPlanetId);
  const colonizePlanetAction = useGameStore((s) => s.colonizePlanet);
  const isColonization = gameState?.phase === 'colonization';

  if (!gameState || !selectedSystemId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No system selected
      </div>
    );
  }

  const system = gameState.galaxy.systemMap.get(selectedSystemId);
  if (!system) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        System not found
      </div>
    );
  }

  const primaryStar = system.stars[0];
  const starDef = primaryStar ? STAR_TYPE_MAP.get(primaryStar.type) : undefined;

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4">
      {/* Star & System Info */}
      <div className="lg:w-72 shrink-0 space-y-3">
        {/* Star info card */}
        <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
          <CardContent className="px-4 py-0">
            {primaryStar ? (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="size-10 rounded-full shrink-0"
                    style={{
                      backgroundColor: primaryStar.color,
                      boxShadow: `0 0 20px ${primaryStar.color}60, 0 0 40px ${primaryStar.color}30`,
                    }}
                  />
                  <div>
                    <div className="font-semibold text-sm">{primaryStar.name}</div>
                    <div className="text-xs text-slate-400">{starDef?.name ?? primaryStar.type}</div>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Thermometer className="size-3" /> Temperature</span>
                    <span className="font-mono">{formatTemp(primaryStar.temperature)}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Sun className="size-3" /> Mass</span>
                    <span className="font-mono">{primaryStar.mass.toFixed(2)} M&#9737;</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="flex items-center gap-1 text-slate-500"><Zap className="size-3" /> Luminosity</span>
                    <span className="font-mono">{primaryStar.luminosity.toFixed(2)} L&#9737;</span>
                  </div>
                </div>

                {/* Secondary/tertiary stars */}
                {system.stars.length > 1 && (
                  <>
                    <Separator className="my-2 bg-white/10" />
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                      Companion Stars ({system.stars.length - 1})
                    </div>
                    {system.stars.slice(1).map((star) => {
                      const companionDef = STAR_TYPE_MAP.get(star.type);
                      return (
                        <div key={star.id} className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                          <div
                            className="size-3 rounded-full shrink-0"
                            style={{ backgroundColor: star.color }}
                          />
                          <span>{star.name}</span>
                          <span className="text-slate-600">{companionDef?.name ?? star.type}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500">No star data</div>
            )}
          </CardContent>
        </Card>

        {/* Jump Points */}
        {system.jumpPoints.length > 0 && (
          <Card className="bg-[#0d0d24] border-white/10 text-white py-3 gap-3">
            <CardContent className="px-4 py-0">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Jump Points
              </div>
              <div className="space-y-1.5">
                {system.jumpPoints.map((jp) => {
                  const targetSys = gameState.galaxy.systemMap.get(jp.toSystemId);
                  if (!targetSys) return null;
                  return (
                    <button
                      key={jp.id}
                      className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-white/5 transition-colors text-left"
                      onClick={() => selectSystem(jp.toSystemId)}
                    >
                      <ArrowLeftRight className="size-3 text-cyan-400 shrink-0" />
                      <span className="text-slate-300 flex-1">{targetSys.name}</span>
                      {jp.stabilized && (
                        <Badge className="text-[9px] h-4 px-1 bg-cyan-900/50 text-cyan-400 border-cyan-800">
                          Stable
                        </Badge>
                      )}
                      <ArrowRight className="size-3 text-slate-600" />
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Planets list */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
          Planets ({system.planets.length})
        </div>
        <ScrollArea className="h-full max-h-[calc(100vh-220px)]">
          <div className="space-y-2 pr-2">
            {system.planets.map((planet) => (
              <PlanetCard
                key={planet.id}
                planet={planet}
                isSelected={planet.id === selectedPlanetId}
                isColonization={isColonization}
                onClick={() => selectPlanet(planet.id)}
                onColonize={() => colonizePlanetAction(planet.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function PlanetCard({
  planet,
  isSelected,
  isColonization,
  onClick,
  onColonize,
}: {
  planet: Planet;
  isSelected: boolean;
  isColonization: boolean;
  onClick: () => void;
  onColonize: () => void;
}) {
  const typeColor = getTypeColor(planet.type);

  return (
    <Card
      className={`bg-[#0d0d24] text-white py-2 gap-2 cursor-pointer transition-all hover:bg-[#12122e] ${
        isSelected ? 'border-cyan-600/50 ring-1 ring-cyan-600/30' : 'border-white/10'
      }`}
      onClick={onClick}
    >
      <CardContent className="px-4 py-0">
        <div className="flex items-center gap-3">
          {/* Planet icon */}
          <div
            className="size-9 rounded-full shrink-0 border border-white/10"
            style={{
              backgroundColor: typeColor,
              boxShadow: `0 0 8px ${typeColor}40`,
            }}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-sm truncate">{planet.name}</span>
              <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                {TYPE_NAMES[planet.type] ?? planet.type}
              </Badge>
              <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                {SIZE_NAMES[planet.size] ?? planet.size}
              </Badge>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Ruler className="size-3" />
                {planet.orbitalRadius.toFixed(2)} AU
              </span>
              <span className="flex items-center gap-1">
                <Thermometer className="size-3" />
                {planet.temperature > 0 ? '+' : ''}{planet.temperature}&deg;C
              </span>
              <span className="flex items-center gap-1">
                <Wind className="size-3" />
                {ATMO_DISPLAY[planet.atmosphere.type] ?? planet.atmosphere.type}
              </span>
              <span className="flex items-center gap-1">
                <Globe2 className="size-3" />
                {planet.gravity.toFixed(1)}g
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
              <span className="flex items-center gap-1">
                <Orbit className="size-3" />
                Орбита {planet.orbitNumber}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatOrbitalPeriod(planet.orbitalPeriod)}
              </span>
            </div>
          </div>

          {planet.owner && (
            <Badge className="text-[9px] h-4 px-1 bg-emerald-900/50 text-emerald-400 border-emerald-800 shrink-0">
              Колония
            </Badge>
          )}
          {isColonization && !planet.owner && planet.type !== 'gas_giant' && (
            <Button
              size="sm"
              className="h-6 text-[10px] px-2 bg-cyan-600 hover:bg-cyan-500 text-white shrink-0"
              onClick={(e) => { e.stopPropagation(); onColonize(); }}
            >
              <Flag className="size-3 mr-1" />
              Колонизировать
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getTypeColor(type: Planet['type']): string {
  const colors: Record<string, string> = {
    rocky: '#8fbc8f',
    volcanic: '#cd5c5c',
    ice: '#b0d4e8',
    oceanic: '#4a90d9',
    desert: '#d2b48c',
    gas_giant: '#daa520',
    dwarf: '#b8a9c9',
  };
  return colors[type] ?? '#666';
}

const ATMO_DISPLAY: Record<AtmosphereType, string> = {
  none: 'Нет', thin: 'Тонкая', standard: 'Стандартная', dense: 'Плотная',
  toxic: 'Токсичная', inert: 'Инертная', methane: 'Метановая', co2: 'CO₂',
};

const LIFE_DISPLAY: Record<LifeLevel, string> = {
  none: 'Нет', microbes: 'Микробы', plants: 'Растения', simple: 'Простая', complex: 'Сложная',
};

function formatTemp(k: number): string {
  if (k >= 1_000_000) return `${(k / 1_000_000).toFixed(1)}MK`;
  if (k >= 1_000) return `${(k / 1_000).toFixed(0)}kK`;
  return `${k.toFixed(0)}K`;
}

/** Форматирование орбитального периода */
function formatOrbitalPeriod(days: number): string {
  if (days < 1) return '<1 дня';
  if (days < 365) return `${days} дн.`;
  const years = days / 365.25;
  if (years < 10) return `${years.toFixed(1)} лет`;
  return `${Math.round(years)} лет`;
}
