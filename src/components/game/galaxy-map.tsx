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
const ZOOM_WHEEL_STEP = 1.15;
const ZOOM_BUTTON_STEP = 1.4;

/**
 * Rendering constants — all in SCREEN pixels (what the user sees).
 * These get divided by `zoom` to produce SVG coordinates,
 * so that CSS transform scale(zoom) renders them at the desired screen size.
 */
const DOT_BASE_SVG = 3;       // Star dot base radius in SVG coords (at zoom=1)
const DOT_MIN_SCREEN = 3;     // Minimum dot size on screen (px)
const DOT_MAX_SCREEN = 8;     // Maximum dot size on screen (px) — caps growth at high zoom
const FONT_SCREEN = 10;       // Label font size on screen (px)
const FONT_SMALL_SCREEN = 8;  // Planet count font on screen (px)
const TEXT_OFFSET_SCREEN = 10; // Label offset below dot on screen (px)
const HIT_SCREEN = 12;        // Click target radius on screen (px)
const SELECT_MARGIN = 2;      // Selection ring margin on screen (px)
const GLOW_MARGIN = 5;        // Glow margin on screen (px)
const STROKE_UNSTAB = 0.6;    // Unstabilized JP line width on screen (px)
const STROKE_STAB = 1.2;      // Stabilized JP line width on screen (px)

export function GalaxyMap() {
  const gameState = useGameStore((s) => s.gameState);
  const selectSystem = useGameStore((s) => s.selectSystem);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);

  const [hoveredSystemId, setHoveredSystemId] = useState<string | null>(null);

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 900, h: 600 });
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const systems = gameState?.galaxy.systems ?? [];

  // Base viewport calculation (fit all systems)
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

  // Track container size
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

  // System positions in SVG coords
  const toSvg = useCallback((x: number, y: number) => ({
    sx: x * base.scale + base.offsetX,
    sy: y * base.scale + base.offsetY,
  }), [base]);

  const systemPositions = useMemo(() => {
    const map = new Map<string, { sx: number; sy: number }>();
    for (const sys of systems) {
      map.set(sys.id, toSvg(sys.position.x, sys.position.y));
    }
    return map;
  }, [systems, toSvg]);

  // Jump point lines
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

        lines.push({ x1: from.sx, y1: from.sy, x2: to.sx, y2: to.sy, stabilized: jp.stabilized });
      }
    }
    return lines;
  }, [systems, systemPositions]);

  // Background stars
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

  // ─── Zoom / Pan handlers ────────────────────────────────

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = Math.pow(ZOOM_WHEEL_STEP, direction);
    const currentZoom = zoomRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * factor));
    if (newZoom === currentZoom) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const svgX = (mouseX - panRef.current.x) / currentZoom;
    const svgY = (mouseY - panRef.current.y) / currentZoom;

    setZoom(newZoom);
    setPan({ x: mouseX - svgX * newZoom, y: mouseY - svgY * newZoom });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as Element).tagName;
    if (e.button === 1 || (e.button === 0 && (e.target === e.currentTarget || tag === 'svg' || tag === 'g' || tag === 'line'))) {
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x),
      y: dragStart.current.panY + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomCenter = useCallback((factor: number) => {
    const currentZoom = zoomRef.current;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * factor));
    const centerX = containerSize.w / 2;
    const centerY = containerSize.h / 2;
    const svgX = (centerX - panRef.current.x) / currentZoom;
    const svgY = (centerY - panRef.current.y) / currentZoom;
    setPan({ x: centerX - svgX * newZoom, y: centerY - svgY * newZoom });
    setZoom(newZoom);
  }, [containerSize]);

  const handleSystemClick = useCallback(
    (system: StarSystem) => {
      selectSystem(system.id);
      // No auto-zoom — preserve current zoom/pan state
    },
    [selectSystem],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ─── Rendering calculations ──────────────────────────────

  if (systems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        No star systems generated
      </div>
    );
  }

  // Label visibility — depends on zoom level
  // At low zoom too many labels overlap, so hide most
  const showAllLabels = zoom > 2;
  const showDiscoveredLabels = zoom > 0.8;
  const showPlanetCount = zoom > 1.5;

  // ─── Convert screen-pixel constants to SVG coords ────────
  // CSS transform scale(zoom) multiplies SVG coords by zoom to get screen pixels.
  // To get X screen pixels on screen: SVG_value = X / zoom

  const invZ = 1 / zoom; // precompute

  // Dot: cap screen size between DOT_MIN_SCREEN and DOT_MAX_SCREEN
  // At zoom=1: base dot is DOT_BASE_SVG (3px). As zoom increases, it grows but caps.
  const dotScreenR = Math.min(DOT_MAX_SCREEN, Math.max(DOT_MIN_SCREEN, DOT_BASE_SVG * zoom));
  const dotR = dotScreenR * invZ;  // Convert desired screen size back to SVG coords

  // Glow margin: constant screen size (counter-scaled)
  const glowR = dotR + GLOW_MARGIN * invZ;

  // Text: counter-scaled → constant screen size
  const fontSize = FONT_SCREEN * invZ;
  const fontSmall = FONT_SMALL_SCREEN * invZ;
  const textOffset = TEXT_OFFSET_SCREEN * invZ;

  // Hit area: constant screen size (counter-scaled)
  const hitR = HIT_SCREEN * invZ;

  // Selection ring: dotR + constant screen margin
  const selectR = dotR + SELECT_MARGIN * invZ;
  const selectStroke = 1 * invZ;

  // JP line stroke widths: counter-scaled → constant screen width
  const jpStrokeUnstab = STROKE_UNSTAB * invZ;
  const jpStrokeStab = STROKE_STAB * invZ;

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
      {/* Background stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {bgStars.map((s) => (
          <div
            key={s.key}
            className="absolute rounded-full bg-white"
            style={{ width: s.w, height: s.h, left: s.left, top: s.top, opacity: s.opacity }}
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
        {/* Jump point lines — constant screen width */}
        {jumpLines.map((line, i) => (
          <line
            key={i}
            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
            stroke={line.stabilized ? 'rgba(100,180,255,0.3)' : 'rgba(255,255,255,0.1)'}
            strokeWidth={line.stabilized ? jpStrokeStab : jpStrokeUnstab}
            strokeDasharray={line.stabilized ? undefined : `${3 * invZ},${3 * invZ}`}
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
          const starColor = sys.stars[0]?.color ?? '#666';
          const isBlackHole = sys.stars[0]?.type === 'STAR_BH';
          const isPulsar = sys.stars[0]?.type === 'STAR_PULSAR';

          const isHighlighted = isSelected || isHovered;
          const r = isHighlighted ? dotR + 1 * invZ : dotR;

          // Should we show the label?
          const showLabel = showAllLabels || (showDiscoveredLabels && sys.discovered) || isHighlighted;

          return (
            <g
              key={sys.id}
              onClick={() => handleSystemClick(sys)}
              onMouseEnter={() => setHoveredSystemId(sys.id)}
              onMouseLeave={() => setHoveredSystemId(null)}
              className="cursor-pointer"
            >
              {/* Glow halo — constant screen margin */}
              {isBlackHole ? (
                <>
                  <circle cx={cx} cy={cy} r={r + glowR * 0.6} fill="#5533aa" opacity={isHighlighted ? 0.4 : 0.15} />
                  <circle cx={cx} cy={cy} r={r + glowR * 0.3} fill="#7744cc" opacity={isHighlighted ? 0.3 : 0.1} />
                </>
              ) : (
                <circle cx={cx} cy={cy} r={glowR} fill={starColor} opacity={isHighlighted ? 0.25 : 0.06} />
              )}

              {/* Pulsar beam */}
              {isPulsar && (
                <ellipse
                  cx={cx} cy={cy}
                  rx={r + glowR * 0.5} ry={r * 0.3}
                  fill="none" stroke={starColor}
                  strokeWidth={1 * invZ}
                  opacity={isHighlighted ? 0.5 : 0.2}
                />
              )}

              {/* Star dot — grows with zoom, capped at DOT_MAX_SCREEN */}
              <circle
                cx={cx} cy={cy} r={r}
                fill={starColor}
                stroke={isSelected ? '#fff' : isBlackHole ? '#7744cc' : 'transparent'}
                strokeWidth={isSelected ? 1.5 * invZ : isBlackHole ? 0.8 * invZ : 0}
              />

              {/* Black hole accretion disk */}
              {isBlackHole && (
                <ellipse
                  cx={cx} cy={cy}
                  rx={r + 3 * invZ} ry={(r + 3 * invZ) * 0.4}
                  fill="none" stroke="#9966dd"
                  strokeWidth={0.8 * invZ}
                  opacity={isHighlighted ? 0.7 : 0.4}
                />
              )}

              {/* Selection ring — constant screen margin */}
              {isSelected && (
                <circle
                  cx={cx} cy={cy} r={selectR}
                  fill="none" stroke="rgba(255,255,255,0.5)"
                  strokeWidth={selectStroke}
                  strokeDasharray={`${2 * invZ},${2 * invZ}`}
                />
              )}

              {/* Name label — constant screen size */}
              {showLabel && (
                <text
                  x={cx}
                  y={cy + r + textOffset}
                  textAnchor="middle"
                  fill={isSelected ? '#fff' : isHovered ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)'}
                  fontSize={fontSize}
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none' }}
                >
                  {sys.name}
                </text>
              )}

              {/* Planet count — constant screen size */}
              {sys.planets.length > 0 && (showPlanetCount || isHighlighted) && (
                <text
                  x={cx}
                  y={cy - r - 3 * invZ}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.3)"
                  fontSize={fontSmall}
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none' }}
                >
                  {sys.planets.length}P
                </text>
              )}

              {/* Hit area — constant screen size, just slightly larger than visible dot */}
              <circle cx={cx} cy={cy} r={hitR} fill="transparent" stroke="none" />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-black/60 rounded-lg px-3 py-2 text-[10px] text-slate-400 backdrop-blur-sm border border-white/5 space-y-1.5">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ borderTop: '1px dashed rgba(255,255,255,0.3)' }} />
            Unstabilized
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ borderTop: '1px solid rgba(100,180,255,0.5)' }} />
            Stabilized
          </span>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#6e8eff' }} />O</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#8ea4ff' }} />B</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#c8d4ff' }} />A</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#f5f0e8' }} />F</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ffe8a0' }} />G</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ffba6a' }} />K</span>
          <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#ff6a3d' }} />M</span>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button onClick={() => zoomCenter(1 / ZOOM_BUTTON_STEP)} className="bg-black/60 rounded-lg w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors text-sm font-bold" title="Zoom out">−</button>
        <div className="bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-400 backdrop-blur-sm border border-white/5 font-mono min-w-[48px] text-center">
          {zoom >= 10 ? `${Math.round(zoom)}x` : `${(zoom * 100).toFixed(0)}%`}
        </div>
        <button onClick={() => zoomCenter(ZOOM_BUTTON_STEP)} className="bg-black/60 rounded-lg w-7 h-7 flex items-center justify-center text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors text-sm font-bold" title="Zoom in">+</button>
        <button onClick={resetView} className="bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-400 hover:text-white backdrop-blur-sm border border-white/5 hover:border-white/20 transition-colors ml-1" title="Reset view">Fit</button>
      </div>

      {/* Zoom hint */}
      <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-2 py-1 text-[10px] text-slate-500 backdrop-blur-sm border border-white/5">
        Scroll to zoom • Drag to pan
      </div>

      {/* Minimap at high zoom */}
      {zoom > 3 && (
        <Minimap
          systems={systems}
          systemPositions={systemPositions}
          base={base}
          zoom={zoom}
          pan={pan}
          containerSize={containerSize}
          selectedSystemId={selectedSystemId}
          onNavigate={(newZoom, newPan) => { setZoom(newZoom); setPan(newPan); }}
        />
      )}
    </div>
  );
}

/** Minimap for navigation context at high zoom. */
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

  const viewLeft = -pan.x / zoom;
  const viewTop = -pan.y / zoom;
  const viewWidth = containerSize.w / zoom;
  const viewHeight = containerSize.h / zoom;

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * base.svgW;
    const clickY = ((e.clientY - rect.top) / rect.height) * base.svgH;
    onNavigate(zoom, { x: containerSize.w / 2 - clickX * zoom, y: containerSize.h / 2 - clickY * zoom });
  }, [base.svgW, base.svgH, containerSize, zoom, onNavigate]);

  return (
    <div className="absolute bottom-3 right-3 bg-black/70 rounded-lg p-1.5 backdrop-blur-sm border border-white/10">
      <svg width={minimapW} height={minimapH} viewBox={`0 0 ${minimapW} ${minimapH}`} className="cursor-pointer" onClick={handleClick}>
        {systems.map((sys) => {
          const pos = systemPositions.get(sys.id);
          if (!pos) return null;
          const isSel = sys.id === selectedSystemId;
          return <circle key={sys.id} cx={pos.sx * scaleX} cy={pos.sy * scaleY} r={isSel ? 2.5 : 1.5} fill={isSel ? '#fff' : sys.stars[0]?.color ?? '#666'} opacity={isSel ? 1 : 0.6} />;
        })}
        <rect x={viewLeft * scaleX} y={viewTop * scaleY} width={viewWidth * scaleX} height={viewHeight * scaleY} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
      </svg>
    </div>
  );
}
