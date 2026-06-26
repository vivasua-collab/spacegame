/**
 * Генерация Jump Points и проверка связности.
 * P1-23: max 6 JP, distance limit, BFS connectivity.
 */

import type { Xoshiro256 } from '@/core/prng';
import type { StarSystem, JumpPoint, EntityId } from '@/core/types';
import { genId } from './gen-context';

export interface JumpPointsConfig {
  maxJumpDistance: number;
  maxJumpPointsPerSystem: number;
}

/**
 * Генерация Jump Points (P1-23: max 6, distance limit).
 */
export function generateJumpPoints(systems: StarSystem[], rng: Xoshiro256, cfg: JumpPointsConfig): void {
  if (systems.length < 2) return;

  const maxJP = cfg.maxJumpPointsPerSystem;
  const maxDist = cfg.maxJumpDistance;

  for (let i = 0; i < systems.length; i++) {
    const system = systems[i];
    if (system.jumpPoints.length >= maxJP) continue;

    const distances = systems.map((s, j) => ({
      index: j,
      dist: Math.sqrt(
        (s.position.x - system.position.x) ** 2 +
        (s.position.y - system.position.y) ** 2,
      ),
    })).filter(d => d.index !== i && d.dist <= maxDist)
      .sort((a, b) => a.dist - b.dist);

    const targetCount = Math.min(rng.nextInt(1, 3), distances.length, maxJP - system.jumpPoints.length);
    for (let j = 0; j < targetCount; j++) {
      if (system.jumpPoints.length >= maxJP) break;

      const target = systems[distances[j].index];

      const exists = system.jumpPoints.some(jp => jp.toSystemId === target.id) ||
                     target.jumpPoints.some(jp => jp.toSystemId === system.id);
      if (exists) continue;

      if (target.jumpPoints.length >= maxJP) continue;

      const jp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: system.id,
        toSystemId: target.id,
        stabilized: rng.nextBool(0.3),
      };
      system.jumpPoints.push(jp);

      const reverseJp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: target.id,
        toSystemId: system.id,
        stabilized: jp.stabilized,
      };
      target.jumpPoints.push(reverseJp);
    }
  }
}

/**
 * P1-23: Проверка связности графа систем.
 * Если есть изолированные компоненты, добавляем JP для обеспечения связности.
 */
export function ensureConnectivity(systems: StarSystem[], rng: Xoshiro256, cfg: JumpPointsConfig): void {
  if (systems.length < 2) return;

  const visited = new Set<EntityId>();
  const queue: EntityId[] = [systems[0].id];
  visited.add(systems[0].id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const system = systems.find(s => s.id === currentId);
    if (!system) continue;

    for (const jp of system.jumpPoints) {
      if (!visited.has(jp.toSystemId)) {
        visited.add(jp.toSystemId);
        queue.push(jp.toSystemId);
      }
    }
  }

  const unvisited = systems.filter(s => !visited.has(s.id));
  for (const isolated of unvisited) {
    let minDist = Infinity;
    let nearestVisited: StarSystem | null = null;

    for (const s of systems) {
      if (!visited.has(s.id)) continue;
      const dist = Math.sqrt(
        (s.position.x - isolated.position.x) ** 2 +
        (s.position.y - isolated.position.y) ** 2,
      );
      if (dist < minDist) {
        minDist = dist;
        nearestVisited = s;
      }
    }

    if (nearestVisited) {
      const jp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: isolated.id,
        toSystemId: nearestVisited.id,
        stabilized: false,
      };
      isolated.jumpPoints.push(jp);

      const reverseJp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: nearestVisited.id,
        toSystemId: isolated.id,
        stabilized: false,
      };
      nearestVisited.jumpPoints.push(reverseJp);

      visited.add(isolated.id);
    }
  }
}
