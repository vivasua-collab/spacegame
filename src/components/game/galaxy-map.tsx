'use client';

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { useGameStore } from '@/stores/game-store';
import type { StarSystem } from '@/core/types';

/**
 * Deterministic LCG for star background — avoids hydration mismatch.
 */
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Minimum and maximum zoom levels */
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 15;
const ZOOM_STEP = 0.15; // 15% per scroll tick

export function GalaxyMap() {
  const gameState = useGameStore((s) => s.gameState);
  const selectSystem = useGameStore((s) => s.selectSystem);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);

  const [hoveredSystemId, setHoveredSystemId] = useState<string | null>(null);

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const systems = gameState?.galaxy.systems ?? [];

  // Compute base viewport bounds and transform (before user zoom/pan)
  const base = useMemo(() => {
    if (systems.length === 0) return { offsetX: 0, offsetY: 0, scale: 1, svgW: 900, svgH: 600 };

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
      svgW: svgWidth,
      svgH: svgHeight,
    };
  }, [systems]);

  // Effective transform = base + user zoom + user pan
  const effectiveScale = base.scale * zoom;
  const effectiveOffsetX = base.offsetX * zoom + pan.x + (base.svgW / 2) * (1 - zoom);
  const effectiveOffsetY = base.offsetY * zoom + pan.y + (base.svgH / 2) * (1 - zoom);

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
          x1: from.position.x * effectiveScale + effectiveOffsetX,
          y1: from.position.y * effectiveScale + effectiveOffsetY,
          x2: to.position.x * effectiveScale + effectiveOffsetX,
          y2: to.position.y * effectiveScale + effectiveOffsetY,
          stabilized: jp.stabilized,
        });
      }
    }
    return lines;
  }, [systems, effectiveScale, effectiveOffsetX, effectiveOffsetY]);

  // Deterministic background stars — no Math.random()
  const bgStars = useMemo(() => {
    const rng = seededRng(137);
    return Array.from({ length: 80 }, (_, i) => ({
      w: rng() < 0.1 ? 2 : 1,
      h: rng() < 0.1 ? 2 : 1,
      left: `${rng() * 100}%`,
      top: `${rng() * 100}%`,
      opacity: 0.15 + rng() * 0.35,
      key: i,
    }));
  }, []);

  // Mouse wheel zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = 1 + ZOOM_STEP * direction;
    setZoom((prev) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * factor)));
  }, []);

  // Pan: mouse down → start drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan with middle button, or left button on empty area
    if (e.button === 1 || (e.button === 0 && e.target === e.currentTarget || (e.target as Element).tagName === 'svg')) {
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
    }
  }, [pan]);

  // Pan: mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({
      x: dragStart.current.panX + dx,
      y: dragStart.current.panY + dy,
    });
  }, [isDragging]);

  // Pan: mouse up → stop drag
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Reset zoom & pan
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleSystemClick = useCallback(
    (system: StarSystem) => {
      selectSystem(system.id);
    },
    [selectSystem],
  );

  // Prevent default wheel on the container (for zoom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  if (systems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No star systems generated
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {/* Background stars — deterministic, no hydration mismatch */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {bgStars.map((s) => (
          <div
            key={s.key}
            className="absolute rounded-full bg-white"
            style={{
              width: s.w,
              height: s.h,
              left: s.left,
              top: s.top,
              opacity: s.opacity,
            }}
          />
        ))}
      </div>

      <svg
        viewBox={`0 0 ${base.svgW} ${base.svgH}`}
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
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
          const cx = sys.position.x * effectiveScale + effectiveOffsetX;
          const cy = sys.position.y * effectiveScale + effectiveOffsetY;
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
                fill={sys.stars[0]?.color ?? '#666'}
                opacity={isSelected ? 0.3 : isHovered ? 0.2 : 0.08}
              />

              {/* Star dot */}
              <circle
                cx={cx}
                cy={cy}
                r={dotRadius}
                fill={sys.stars[0]?.color ?? '#666'}
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

              {/* Name label (show when zoomed in enough, or on hover/select) */}
              {(sys.discovered || isHovered || isSelected || zoom > 2) && (
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
              {sys.planets.length > 0 && (zoom > 0.8 || isHovered || isSelected) && (
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

      {/* Zoom controls & info */}
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

      {/* Zoom indicator & reset */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        <div className="bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-400 backdrop-blur-sm border border-white/5 font-mono">
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={resetView}
          className="bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors"
          title="Reset view"
        >
          Reset
        </button>
      </div>

      {/* Zoom hint */}
      <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-500 backdrop-blur-sm border border-white/5">
        Scroll to zoom • Drag to pan
      </div>
    </div>
  );
}
