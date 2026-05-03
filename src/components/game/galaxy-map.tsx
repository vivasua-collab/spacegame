'use client';

import { useCallback, useMemo, useState } from 'react';
import { useGameStore } from '@/stores/game-store';
import type { StarSystem } from '@/core/types';

export function GalaxyMap() {
  const gameState = useGameStore((s) => s.gameState);
  const selectSystem = useGameStore((s) => s.selectSystem);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);

  const [hoveredSystemId, setHoveredSystemId] = useState<string | null>(null);

  const systems = gameState?.galaxy.systems ?? [];

  // Compute viewport bounds and transform
  const { offsetX, offsetY, scale } = useMemo(() => {
    if (systems.length === 0) return { offsetX: 0, offsetY: 0, scale: 1 };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const sys of systems) {
      minX = Math.min(minX, sys.position.x);
      maxX = Math.max(maxX, sys.position.x);
      minY = Math.min(minY, sys.position.y);
      maxY = Math.max(maxY, sys.position.y);
    }

    const padding = 60;
    const dataWidth = maxX - minX || 1;
    const dataHeight = maxY - minY || 1;
    const svgWidth = 900;
    const svgHeight = 600;

    const scaleX = (svgWidth - padding * 2) / dataWidth;
    const scaleY = (svgHeight - padding * 2) / dataHeight;
    const s = Math.min(scaleX, scaleY);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    return {
      offsetX: svgWidth / 2 - cx * s,
      offsetY: svgHeight / 2 - cy * s,
      scale: s,
    };
  }, [systems]);

  // Build jump point lines (deduplicated)
  const jumpLines = useMemo(() => {
    const seen = new Set<string>();
    const lines: { x1: number; y1: number; x2: number; y2: number; stabilized: boolean }[] = [];

    for (const sys of systems) {
      for (const jp of sys.jumpPoints) {
        const key = [jp.fromSystemId, jp.toSystemId].sort().join('-');
        if (seen.has(key)) continue;
        seen.add(key);

        const from = systems.find((s) => s.id === jp.fromSystemId);
        const to = systems.find((s) => s.id === jp.toSystemId);
        if (!from || !to) continue;

        lines.push({
          x1: from.position.x * scale + offsetX,
          y1: from.position.y * scale + offsetY,
          x2: to.position.x * scale + offsetX,
          y2: to.position.y * scale + offsetY,
          stabilized: jp.stabilized,
        });
      }
    }
    return lines;
  }, [systems, scale, offsetX, offsetY]);

  const handleSystemClick = useCallback(
    (system: StarSystem) => {
      selectSystem(system.id);
    },
    [selectSystem],
  );

  if (systems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No star systems generated
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Background stars */}
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 80 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: Math.random() < 0.1 ? 2 : 1,
              height: Math.random() < 0.1 ? 2 : 1,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: 0.15 + Math.random() * 0.35,
            }}
          />
        ))}
      </div>

      <svg
        viewBox="0 0 900 600"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Jump point lines */}
        {jumpLines.map((line, i) => (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={line.stabilized ? 'rgba(100,180,255,0.3)' : 'rgba(255,255,255,0.1)'}
            strokeWidth={line.stabilized ? 1.5 : 0.8}
            strokeDasharray={line.stabilized ? undefined : '4,4'}
          />
        ))}

        {/* Star systems */}
        {systems.map((sys) => {
          const cx = sys.position.x * scale + offsetX;
          const cy = sys.position.y * scale + offsetY;
          const isSelected = sys.id === selectedSystemId;
          const isHovered = sys.id === hoveredSystemId;
          const dotRadius = isSelected ? 6 : isHovered ? 5 : 4;

          return (
            <g
              key={sys.id}
              onClick={() => handleSystemClick(sys)}
              onMouseEnter={() => setHoveredSystemId(sys.id)}
              onMouseLeave={() => setHoveredSystemId(null)}
              className="cursor-pointer"
            >
              {/* Glow */}
              <circle
                cx={cx}
                cy={cy}
                r={dotRadius + 6}
                fill={sys.star.color}
                opacity={isSelected ? 0.3 : isHovered ? 0.2 : 0.08}
              />

              {/* Star dot */}
              <circle
                cx={cx}
                cy={cy}
                r={dotRadius}
                fill={sys.star.color}
                stroke={isSelected ? '#fff' : 'transparent'}
                strokeWidth={isSelected ? 1.5 : 0}
                className="transition-all duration-150"
              />

              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={dotRadius + 3}
                  fill="none"
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
              )}

              {/* Name label (always shown for discovered, on hover for others) */}
              {(sys.discovered || isHovered || isSelected) && (
                <text
                  x={cx}
                  y={cy + dotRadius + 12}
                  textAnchor="middle"
                  fill={isSelected ? '#fff' : 'rgba(255,255,255,0.6)'}
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {sys.name}
                </text>
              )}

              {/* Planet count indicator */}
              {sys.planets.length > 0 && (
                <text
                  x={cx}
                  y={cy - dotRadius - 5}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.3)"
                  fontSize="7"
                  fontFamily="monospace"
                >
                  {sys.planets.length}P
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-black/60 rounded-lg px-3 py-2 text-[10px] text-slate-400 backdrop-blur-sm border border-white/5">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-white/10" style={{ borderTop: '1px dashed rgba(255,255,255,0.3)' }} />
            Unstabilized JP
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ borderTop: '1px solid rgba(100,180,255,0.5)' }} />
            Stabilized JP
          </span>
        </div>
      </div>
    </div>
  );
}
