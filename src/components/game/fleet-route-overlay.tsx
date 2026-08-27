'use client';

/**
 * Block 02 (F5): FleetRouteOverlay — SVG overlay for galaxy-map.
 *
 * Renders inside the existing galaxy-map SVG (sharing its zoom/pan transform):
 *  - Dashed polyline for each player fleet's active order path (jump-point route)
 *  - Solid marker dot at fleet's current location
 *  - Pulsing ring around current location (in-transit indicator)
 *  - Dashed destination ring around the next system on the path
 *
 * Block 02 Phase 2.6: pure UI — reads gameState.fleets directly from store
 * (no state mutation, no engine calls). Player fleets only (owner filter).
 *
 * Coordinate space: same SVG coords as galaxy-map (systemPositions map
 * gives {sx, sy} in SVG units). All stroke widths and sizes are counter-
 * scaled by `invZ = 1 / zoom` so they remain constant screen size at any zoom.
 *
 * Animation: Tailwind `animate-pulse` on SVG <circle> (opacity oscillation).
 * Native SVG animation would also work, but animate-pulse is simpler and
 * already available in Tailwind 4.
 */

import { useGameStore } from '@/stores/game-store';

interface FleetRouteOverlayProps {
  /** System positions in SVG coords (from galaxy-map useMemo). */
  systemPositions: Map<string, { sx: number; sy: number }>;
  /** 1 / zoom — for counter-scaling strokes/sizes to constant screen size. */
  invZ: number;
}

export function FleetRouteOverlay({ systemPositions, invZ }: FleetRouteOverlayProps) {
  const gameState = useGameStore((s) => s.gameState);

  if (!gameState) return null;
  if (gameState.fleets.length === 0) return null;

  const playerFactionId = gameState.playerFactionId;
  const playerFleets = gameState.fleets.filter(
    (f) => f.owner === playerFactionId && f.orders.length > 0,
  );

  if (playerFleets.length === 0) return null;

  const routes: React.ReactNode[] = [];
  const markers: React.ReactNode[] = [];

  for (const fleet of playerFleets) {
    const order = fleet.orders[0]!;
    if (!order || order.path.length < 2) continue; // no movement to draw

    // Build polyline points string
    const points: string[] = [];
    for (const sysId of order.path) {
      const pos = systemPositions.get(sysId);
      if (!pos) break;
      points.push(`${pos.sx},${pos.sy}`);
    }
    if (points.length < 2) continue;

    // ─── Route polyline (dashed line through JP path) ───────────────
    routes.push(
      <polyline
        key={`route-${fleet.id}`}
        points={points.join(' ')}
        fill="none"
        stroke="rgba(110, 220, 255, 0.55)"
        strokeWidth={1.2 * invZ}
        strokeDasharray={`${4 * invZ},${3 * invZ}`}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label={`Маршрут флота ${fleet.name} до системы ${order.targetId}`}
      />,
    );

    // ─── Marker at fleet's current location ──────────────────────────
    const curPos = systemPositions.get(fleet.location);
    if (curPos) {
      // Solid dot — fleet is here
      markers.push(
        <circle
          key={`pos-${fleet.id}`}
          cx={curPos.sx}
          cy={curPos.sy}
          r={3 * invZ}
          fill="rgba(110, 220, 255, 0.95)"
          stroke="rgba(255, 255, 255, 0.85)"
          strokeWidth={0.6 * invZ}
        >
          <title>{`Флот «${fleet.name}» (здесь)`}</title>
        </circle>,
      );
      // Pulsing ring (in-transit animation)
      markers.push(
        <circle
          key={`pulse-${fleet.id}`}
          cx={curPos.sx}
          cy={curPos.sy}
          r={6 * invZ}
          fill="none"
          stroke="rgba(110, 220, 255, 0.6)"
          strokeWidth={1 * invZ}
          className="animate-pulse"
        />,
      );
    }

    // ─── Destination marker (next leg) ──────────────────────────────
    // If fleet is still in transit (not at final leg), draw a dashed ring
    // around the next system on the path (the next destination).
    if (order.currentLegIndex < order.path.length - 1) {
      const nextSysId = order.path[order.currentLegIndex + 1];
      if (nextSysId) {
        const destPos = systemPositions.get(nextSysId);
        if (destPos) {
          markers.push(
            <circle
              key={`dest-${fleet.id}`}
              cx={destPos.sx}
              cy={destPos.sy}
              r={4.5 * invZ}
              fill="none"
              stroke="rgba(255, 200, 100, 0.75)"
              strokeWidth={1 * invZ}
              strokeDasharray={`${2 * invZ},${2 * invZ}`}
            >
              <title>{`Следующая точка маршрута флота «${fleet.name}»`}</title>
            </circle>,
          );
        }
      }
    }
  }

  if (routes.length === 0 && markers.length === 0) return null;

  return (
    <g key="fleet-routes-overlay" role="presentation">
      {routes}
      {markers}
    </g>
  );
}
