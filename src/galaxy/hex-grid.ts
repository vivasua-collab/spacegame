/**
 * Гексагональная сетка (axial coordinates).
 */

import type { AxialCoord, HexCell, HexTerrain, PlanetSize } from '@/core/types';
import { Xoshiro256 } from '@/core/prng';
import { SIZE_HEX_COUNT, ALL_TERRAINS } from '@/data/planet-types';

/** Генерация гексов для планеты заданного размера */
export function generateHexGrid(size: PlanetSize, terrainWeights: Record<HexTerrain, number>, rng: Xoshiro256): HexCell[] {
  const hexCount = SIZE_HEX_COUNT[size];
  const coords = generateHexCoords(hexCount);
  const terrains = ALL_TERRAINS;
  const weights = terrains.map(t => terrainWeights[t] ?? 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  return coords.map(coord => {
    const terrain = totalWeight > 0
      ? rng.weightedChoice(terrains, weights)
      : 'plains';
    return {
      coord,
      terrain,
      buildingId: null,
      buildingLevel: 0,
      deposits: [],
    };
  });
}

/** Генерация координат гексов (центр + кольца) */
function generateHexCoords(count: number): AxialCoord[] {
  const result: AxialCoord[] = [{ q: 0, r: 0 }];

  let ring = 1;
  while (result.length < count) {
    // Количество гексов в кольце ring = 6 * ring
    const ringSize = 6 * ring;
    const needed = count - result.length;
    const toAdd = Math.min(ringSize, needed);

    // Начинаем с (ring, 0) и идём по 6 направлениям
    let q = ring;
    let r = 0;
    const directions: [number, number][] = [
      [0, -1], [-1, 0], [-1, 1], [0, 1], [1, 0], [1, -1],
    ];

    let added = 0;
    for (const [dq, dr] of directions) {
      if (added >= toAdd) break;
      const sideLen = ring;
      for (let i = 0; i < sideLen && added < toAdd; i++) {
        result.push({ q, r });
        q += dq;
        r += dr;
        added++;
      }
    }

    ring++;
  }

  return result.slice(0, count);
}

/** Расстояние между двумя гексами */
export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

/** Соседи гекса */
export function hexNeighbors(coord: AxialCoord): AxialCoord[] {
  const dirs: AxialCoord[] = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];
  return dirs.map(d => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

/** Конвертация axial → pixel (flat-top) */
export function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * (3 / 2 * q);
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

/** Конвертация pixel → axial (flat-top) */
export function pixelToAxial(x: number, y: number, size: number): AxialCoord {
  const q = (2 / 3 * x) / size;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / size;
  return axialRound(q, r);
}

function axialRound(q: number, r: number): AxialCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}
