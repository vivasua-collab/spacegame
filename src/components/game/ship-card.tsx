'use client';

/**
 * Block 02 (F3): Compact Ship Card — переиспользуемая карточка корабля.
 *
 * Показывает: имя, корпус, дизайн, hp/maxHp, топливо, локацию.
 * Используется в:
 * - fleet-view.tsx (список кораблей в составе флота)
 * - fleet-view.tsx (список свободных кораблей для создания флота)
 * - planet-view.tsx (планируется Phase 2.7 — индикатор кораблей на орбите)
 *
 * Props:
 * - ship: Ship (runtime-объект из GameState.ships)
 * - selected?: boolean — подсветка выбранного корабля
 * - onClick?: () => void — клик по карточке (для выбора в списке)
 * - compact?: boolean — ультракомпактный режим (без имени дизайна, только ID)
 */

import { Badge } from '@/components/ui/badge';
import { HULL_MAP } from '@/data/ships/hulls';
import { ALL_FUEL_TYPES } from '@/data/ships/fuel-map';
import type { Ship } from '@/core/types';
import { Rocket, Heart, Fuel as FuelIcon, MapPin } from 'lucide-react';

interface ShipCardProps {
  ship: Ship;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

const FUEL_LABELS: Record<string, string> = {
  chemical: 'Хим',
  xenon: 'Xe',
  hydrogen: 'H₂',
  antimatter: 'AM',
};

export function ShipCard({ ship, selected, onClick, compact }: ShipCardProps) {
  const hull = HULL_MAP.get(ship.hullId);
  const totalFuel = ALL_FUEL_TYPES.reduce(
    (s, ft) => s + (ship.fuel[ft] ?? 0),
    0,
  );
  const hpPct = ship.maxHp > 0 ? (ship.hp / ship.maxHp) * 100 : 0;
  const hpColor = hpPct > 66 ? 'text-emerald-400' : hpPct > 33 ? 'text-amber-400' : 'text-red-400';

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full text-left rounded border p-2 transition-colors ${
        selected
          ? 'border-cyan-400/60 bg-cyan-500/10'
          : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
      } ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      aria-label={`Корабль ${ship.name}`}
    >
      {/* Header: name + design badge */}
      <div className="flex items-center gap-2 mb-1">
        <Rocket className="size-3 text-cyan-400 shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{ship.name}</span>
        {!compact && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
            {hull?.name ?? ship.hullId}
          </Badge>
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1" title={`HP: ${ship.hp}/${ship.maxHp}`}>
          <Heart className={`size-2.5 ${hpColor}`} />
          <span className={`font-mono ${hpColor}`}>{ship.hp}</span>
          <span className="text-slate-600">/{ship.maxHp}</span>
        </span>
        <span className="flex items-center gap-1" title={`Топливо: ${totalFuel}`}>
          <FuelIcon className="size-2.5 text-amber-400" />
          <span className="font-mono text-amber-300/80">{totalFuel}</span>
        </span>
        <span className="flex items-center gap-1 ml-auto" title="Локация">
          <MapPin className="size-2.5 text-slate-500" />
          <span className="font-mono text-slate-500 truncate max-w-[80px]">
            {ship.location.length > 12 ? `${ship.location.slice(0, 10)}…` : ship.location}
          </span>
        </span>
      </div>

      {/* Design name (non-compact mode) */}
      {!compact && ship.designName && ship.designName !== ship.name && (
        <div className="mt-1 text-[9px] text-slate-600 truncate">
          Дизайн: {ship.designName}
        </div>
      )}

      {/* Fuel breakdown (compact: hidden) */}
      {!compact && totalFuel > 0 && (
        <div className="mt-1 flex gap-2 text-[9px] text-slate-500">
          {ALL_FUEL_TYPES.map(ft => {
            const v = ship.fuel[ft] ?? 0;
            if (v <= 0) return null;
            return (
              <span key={ft} className="font-mono">
                {FUEL_LABELS[ft]}:{v}
              </span>
            );
          })}
        </div>
      )}
    </button>
  );
}
