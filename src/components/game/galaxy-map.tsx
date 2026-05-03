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

/** Zoom configuration */
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 80;
const ZOOM_WHEEL_STEP = 1.15; // multiplier per scroll tick (15% zoom per tick)
const ZOOM_BUTTON_STEP = 1.4; // multiplier per button click

export function GalaxyMap() {
  const gameState = useGameStore((s) => s.gameState);
  const selectSystem = useGameStore((s) => s.selectSystem);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);

  const [hoveredSystemId, setHoveredSystemId] = useState<string | null>(null);

  // Zoom & pan state — using CSS transform for simplicity and smoothness
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 900, h: 600 });
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  // Keep refs in sync
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const systems = gameState?.galaxy.systems ?? [];

  // Compute base viewport bounds (fit all systems in viewBox)
  const base = useMemo(() => {
    if (systems.length === 0) return { offsetX: 0, offsetY: 0, scale: 1, svgW: 900, svgH: 600 };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const sys of systems) {
      minX = Math.min(minX, sys.position.x);
      maxX = Math.max(maxX, sys.position.x);
      minY = Math.min(minY, sys.position.y);
      maxY = Math.max(maxY, sys.position.y);
    }

    const padding = 80;
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

  // Track container size for cursor-centered zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Convert system world position → SVG coordinates (base, no zoom)
  const toSvg = useCallback((x: number, y: number) => ({
    sx: x * base.scale + base.offsetX,
    sy: y * base.scale + base.offsetY,
  }), [base]);

  // All system SVG positions (base, no zoom/pan)
  const systemPositions = useMemo(() => {
    const map = new Map<string, { sx: number; sy: number }>();
    for (const sys of systems) {
      map.set(sys.id, toSvg(sys.position.x, sys.position.y));
    }
    return map;
  }, [systems, toSvg]);

  // Build jump point lines (base coordinates, no zoom)
  const jumpLines = useMemo(() => {
    const seen = new Set<string>();
    const lines: { x1: number; y1: number; x2: number; y2: number; stabilized: boolean }[] = [];

    for (const sys of systems) {
      for (const jp of sys.jumpPoints) {
        const key = [jp.fromSystemId, jp.toSystemId].sort().join('-');
        if (seen.has(key)) continue;
        seen.add(key);

        const from = systemPositions.get(jp.fromSystemId);
        const to = systemPositions.get(jp.toSystemId);
        if (!from || !to) continue;

        lines.push({
          x1: from.sx,
          y1: from.sy,
          x2: to.sx,
          y2: to.sy,
          stabilized: jp.stabilized,
        });
      }
    }
    return lines;
  }, [systems, systemPositions]);

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

  /**
   * Zoom centered on cursor position.
   * The key idea: the SVG point under the cursor should stay under the cursor after zoom.
   *
   * CSS transform: translate(panX, panY) scale(zoom)
   * SVG point under cursor = (mouseX - panX) / zoom  (in SVG coords)
   * After zoom change to newZoom, we need: mouseX - newPanX = svgPoint * newZoom
   * So: newPanX = mouseX - svgPoint * newZoom = mouseX - (mouseX - panX) / zoom * newZoom
   */
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = Math.pow(ZOOM_WHEEL_STEP, direction);
    const currentZoom = zoomRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * factor));

    if (newZoom === currentZoom) return;

    // Get mouse position relative to the container
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // SVG point under cursor before zoom
    const svgX = (mouseX - panRef.current.x) / currentZoom;
    const svgY = (mouseY - panRef.current.y) / currentZoom;

    // New pan so that same SVG point stays under cursor
    const newPanX = mouseX - svgX * newZoom;
    const newPanY = mouseY - svgY * newZoom;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, []);

  // Pan: mouse down → start drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Left button on empty area or middle button
    const tag = (e.target as Element).tagName;
    if (e.button === 1 || (e.button === 0 && (e.target === e.currentTarget || tag === 'svg' || tag === 'g' || tag === 'line'))) {
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

  // Reset zoom & pan to fit all
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Zoom buttons
  const zoomIn = useCallback(() => {
    const currentZoom = zoomRef.current;
    const newZoom = Math.min(ZOOM_MAX, currentZoom * ZOOM_BUTTON_STEP);
    // Zoom toward center of container
    const centerX = containerSize.w / 2;
    const centerY = containerSize.h / 2;
    const svgX = (centerX - panRef.current.x) / currentZoom;
    const svgY = (centerY - panRef.current.y) / currentZoom;
    setPan({
      x: centerX - svgX * newZoom,
      y: centerY - svgY * newZoom,
    });
    setZoom(newZoom);
  }, [containerSize]);

  const zoomOut = useCallback(() => {
    const currentZoom = zoomRef.current;
    const newZoom = Math.max(ZOOM_MIN, currentZoom / ZOOM_BUTTON_STEP);
    const centerX = containerSize.w / 2;
    const centerY = containerSize.h / 2;
    const svgX = (centerX - panRef.current.x) / currentZoom;
    const svgY = (centerY - panRef.current.y) / currentZoom;
    setPan({
      x: centerX - svgX * newZoom,
      y: centerY - svgY * newZoom,
    });
    setZoom(newZoom);
  }, [containerSize]);

  const handleSystemClick = useCallback(
    (system: StarSystem) => {
      selectSystem(system.id);
      // Zoom to the clicked system
      const pos = systemPositions.get(system.id);
      if (pos) {
        const targetZoom = 4;
        setZoom(targetZoom);
        setPan({
          x: containerSize.w / 2 - pos.sx * targetZoom,
          y: containerSize.h / 2 - pos.sy * targetZoom,
        });
      }
    },
    [selectSystem, systemPositions, containerSize],
  );

  // Prevent default wheel on the container (for zoom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);



  if (systems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No star systems generated
      </div>
    );
  }

  // Label visibility: at very low zoom, hide all; at medium zoom, show on hover/select; at high zoom, show all
  const showAllLabels = zoom > 1.5;
  const showPlanetCount = zoom > 0.8;

  // Counter-scale for text and dots so they remain readable at any zoom level
  const textScale = 1 / zoom;
  const dotBaseRadius = 4;
  const dotRadius = Math.max(2, Math.min(8, dotBaseRadius * Math.pow(zoom, -0.3)));
  const fontSize = Math.max(7, Math.min(11, 9 * Math.pow(zoom, -0.15)));

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
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

      {/* SVG map with CSS transform for zoom/pan */}
      <svg
        width={base.svgW}
        height={base.svgH}
        viewBox={`0 0 ${base.svgW} ${base.svgH}`}
        className="absolute"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          pointerEvents: isDragging ? 'none' : 'auto',
        }}
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
          const pos = systemPositions.get(sys.id);
          if (!pos) return null;
          const cx = pos.sx;
          const cy = pos.sy;
          const isSelected = sys.id === selectedSystemId;
          const isHovered = sys.id === hoveredSystemId;
          const r = isSelected ? dotRadius + 2 : isHovered ? dotRadius + 1 : dotRadius;
          const starColor = sys.stars[0]?.color ?? '#666';
          const isBlackHole = sys.stars[0]?.type === 'STAR_BH';
          const isPulsar = sys.stars[0]?.type === 'STAR_PULSAR';

          return (
            <g
              key={sys.id}
              onClick={() => handleSystemClick(sys)}
              onMouseEnter={() => setHoveredSystemId(sys.id)}
              onMouseLeave={() => setHoveredSystemId(null)}
              className="cursor-pointer"
            >
              {/* Glow — for black holes use a brighter purple accretion disk glow */}
              {isBlackHole ? (
                <>
                  <circle cx={cx} cy={cy} r={r + 12} fill="#5533aa" opacity={isSelected ? 0.4 : isHovered ? 0.3 : 0.15} />
                  <circle cx={cx} cy={cy} r={r + 6} fill="#7744cc" opacity={isSelected ? 0.3 : isHovered ? 0.2 : 0.1} />
                </>
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 8}
                  fill={starColor}
                  opacity={isSelected ? 0.3 : isHovered ? 0.2 : 0.08}
                />
              )}

              {/* Pulsar: rotating beam effect */}
              {isPulsar && (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={r + 10}
                  ry={r * 0.3}
                  fill="none"
                  stroke={starColor}
                  strokeWidth={1.2}
                  opacity={isSelected ? 0.6 : isHovered ? 0.4 : 0.2}
                />
              )}

              {/* Star dot */}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={starColor}
                stroke={isSelected ? '#fff' : isBlackHole ? '#7744cc' : 'transparent'}
                strokeWidth={isSelected ? 1.5 : isBlackHole ? 1 : 0}
                className="transition-all duration-150"
              />

              {/* Black hole: accretion disk ring */}
              {isBlackHole && (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={r + 5}
                  ry={r * 0.4}
                  fill="none"
                  stroke="#9966dd"
                  strokeWidth={1}
                  opacity={isSelected ? 0.7 : 0.4}
                />
              )}

              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 4}
                  fill="none"
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
              )}

              {/* Name label */}
              {(showAllLabels || sys.discovered || isHovered || isSelected) && (
                <text
                  x={cx}
                  y={cy + r + 10 * textScale + 4}
                  textAnchor="middle"
                  fill={isSelected ? '#fff' : 'rgba(255,255,255,0.6)'}
                  fontSize={fontSize}
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none' }}
                >
                  {sys.name}
                </text>
              )}

              {/* Planet count indicator */}
              {sys.planets.length > 0 && (showPlanetCount || isHovered || isSelected) && (
                <text
                  x={cx}
                  y={cy - r - 4 * textScale - 2}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.3)"
                  fontSize={fontSize * 0.8}
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none' }}
                >
                  {sys.planets.length}P
                </text>
              )}

              {/* Hit area (invisible, large click target) */}
              <circle
                cx={cx}
                cy={cy}
                r={Math.max(12, r + 6)}
                fill="transparent"
                stroke="none"
              />
            </g>
          );
        })}
      </svg>

      {/* Legend — star types & jump points */}
      <div className="absolute bottom-3 left-3 bg-black/60 rounded-lg px-3 py-2 text-[10px] text-slate-400 backdrop-blur-sm border border-white/5 space-y-1.5">
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
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#6e8eff' }} /> O</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#8ea4ff' }} /> B</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#c8d4ff' }} /> A</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#f5f0e8' }} /> F</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ffe8a0' }} /> G</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ffba6a' }} /> K</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ff6a3d' }} /> M</span>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            className="bg-black/60 rounded-lg w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors text-sm font-bold"
            title="Zoom out"
          >
            −
          </button>
          <div className="bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-400 backdrop-blur-sm border border-white/5 font-mono min-w-[48px] text-center">
            {zoom >= 10 ? `${Math.round(zoom)}x` : `${(zoom * 100).toFixed(0)}%`}
          </div>
          <button
            onClick={zoomIn}
            className="bg-black/60 rounded-lg w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors text-sm font-bold"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={resetView}
            className="bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors ml-1"
            title="Reset view"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Zoom hint */}
      <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-500 backdrop-blur-sm border border-white/5">
        Scroll to zoom • Drag to pan
      </div>

      {/* Minimap at high zoom levels */}
      {zoom > 3 && (
        <Minimap
          systems={systems}
          systemPositions={systemPositions}
          base={base}
          zoom={zoom}
          pan={pan}
          containerSize={containerSize}
          selectedSystemId={selectedSystemId}
          onNavigate={(newZoom, newPan) => {
            setZoom(newZoom);
            setPan(newPan);
          }}
        />
      )}
    </div>
  );
}

/**
 * Minimap component shown at high zoom levels to provide context.
 */
function Minimap({
  systems,
  systemPositions,
  base,
  zoom,
  pan,
  containerSize,
  selectedSystemId,
  onNavigate,
}: {
  systems: StarSystem[];
  systemPositions: Map<string, { sx: number; sy: number }>;
  base: { svgW: number; svgH: number };
  zoom: number;
  pan: { x: number; y: number };
  containerSize: { w: number; h: number };
  selectedSystemId: string | null;
  onNavigate: (zoom: number, pan: { x: number; y: number }) => void;
}) {
  const minimapW = 140;
  const minimapH = Math.round((base.svgH / base.svgW) * minimapW);
  const scaleX = minimapW / base.svgW;
  const scaleY = minimapH / base.svgH;

  // Viewport rectangle
  const viewLeft = -pan.x / zoom;
  const viewTop = -pan.y / zoom;
  const viewWidth = containerSize.w / zoom;
  const viewHeight = containerSize.h / zoom;

  const rectX = viewLeft * scaleX;
  const rectY = viewTop * scaleY;
  const rectW = viewWidth * scaleX;
  const rectH = viewHeight * scaleY;

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * base.svgW;
    const clickY = ((e.clientY - rect.top) / rect.height) * base.svgH;

    // Center the view on the clicked point
    const newPan = {
      x: containerSize.w / 2 - clickX * zoom,
      y: containerSize.h / 2 - clickY * zoom,
    };
    onNavigate(zoom, newPan);
  }, [base.svgW, base.svgH, containerSize, zoom, onNavigate]);

  return (
    <div className="absolute bottom-3 right-3 bg-black/70 rounded-lg p-1.5 backdrop-blur-sm border border-white/10">
      <svg
        width={minimapW}
        height={minimapH}
        viewBox={`0 0 ${minimapW} ${minimapH}`}
        className="cursor-pointer"
        onClick={handleClick}
      >
        {/* Systems */}
        {systems.map((sys) => {
          const pos = systemPositions.get(sys.id);
          if (!pos) return null;
          const isSelected = sys.id === selectedSystemId;
          return (
            <circle
              key={sys.id}
              cx={pos.sx * scaleX}
              cy={pos.sy * scaleY}
              r={isSelected ? 2.5 : 1.5}
              fill={isSelected ? '#fff' : sys.stars[0]?.color ?? '#666'}
              opacity={isSelected ? 1 : 0.6}
            />
          );
        })}

        {/* Viewport rectangle */}
        <rect
          x={rectX}
          y={rectY}
          width={rectW}
          height={rectH}
          fill="rgba(255,255,255,0.05)"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
