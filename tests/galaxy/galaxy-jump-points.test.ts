/// <reference types="bun-types" />
/**
 * Task 35 (B3, находка G-02): Jump Points и граф систем.
 *
 * Контракт docs/10-galaxy.md:
 *   §4.2 — JP создаётся при d(A,B) ≤ max_jp_distance; связность обеспечивается
 *          мостами между компонентами (кратчайшие рёбра). Правило мостов
 *          (зафиксировано аудитом Task 35): превышение max_jp_distance допустимо
 *          ТОЛЬКО для мостов связности, и каждый такой JP является мостом графа
 *          (удаление разъединяет компоненты). Лимит max_jp_per_system
 *          соблюдается, когда есть кандидат со свободной ёмкостью; связность
 *          приоритетнее (docs §5.3, шаг 6).
 *   §2.4.1 — парность: каждый JP имеет парный JP в другой системе (взаимность).
 *   §4.4 — максимум JP на систему = max_jp_per_system (6 по умолчанию).
 *
 * ДО фикса (аудит Task 35, замеры на 100 seed × 200 систем): ensureConnectivity
 * не проверял ни лимит степени (maxDegree=10 при maxJP=6), ни дистанцию
 * (JP длиной до 15104 при maxDist=5000), ни дубли (10600 дублей A→B —
 * мост вешался на уже связанную пару), присоединяя каждую изолированную
 * систему по-отдельности вместо компонент.
 *
 * Run: bun test tests/galaxy/galaxy-jump-points.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { Xoshiro128StarStar } from '@/core/prng';
import { generateSpiralPositions } from '@/galaxy/generate-positions';
import { generateJumpPoints, ensureConnectivity } from '@/galaxy/generate-jump-points';
import { DEFAULT_CONFIG } from '@/galaxy';
import type { GalaxyGenConfig } from '@/galaxy';
import type { StarSystem, EntityId } from '@/core/types';

interface JPCfg {
  maxJumpDistance: number;
  maxJumpPointsPerSystem: number;
}

/** Скелеты систем на реальных позициях generateSpiralPositions (без планет — изоляция модуля). */
function makeSystems(seed: number, systemCount: number, over: Partial<GalaxyGenConfig> = {}): StarSystem[] {
  const cfg = { ...DEFAULT_CONFIG, ...over, systemCount };
  const main = new Xoshiro128StarStar(seed);
  const pos = generateSpiralPositions(
    cfg,
    main.derive('arms'),
    main.derive('bulge'),
    main.derive('disk'),
    main.derive('halo'),
  );
  return pos.map((p, i) => ({
    id: `sys_${i + 1}` as EntityId,
    name: `S${i}`,
    position: p,
    binaryType: 'BINARY_NONE' as const,
    stars: [],
    planets: [],
    asteroidFields: 0,
    jumpPoints: [],
    discovered: false,
    owner: null,
  }));
}

function runJP(systems: StarSystem[], seed: number, cfg: JPCfg): void {
  const main = new Xoshiro128StarStar(seed);
  generateJumpPoints(systems, main.derive('jump_points'), cfg);
  ensureConnectivity(systems, main.derive('jump_points'), cfg);
}

interface Violations {
  disconnected: boolean;
  dangling: number;
  dupSameDirection: number;
  asymmetric: number;
  overDegree: number;
  maxDegree: number;
  overDistance: number;
  maxDistance: number;
  overDistanceNotCutEdge: number;
}

function dist(a: StarSystem, b: StarSystem): number {
  return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
}

/** Проверка всех инвариантов. Ожидается violations = все нули / false. */
function checkInvariants(systems: StarSystem[], cfg: JPCfg): Violations {
  const v: Violations = {
    disconnected: false, dangling: 0, dupSameDirection: 0, asymmetric: 0,
    overDegree: 0, maxDegree: 0, overDistance: 0, maxDistance: 0, overDistanceNotCutEdge: 0,
  };
  const byId = new Map(systems.map(s => [s.id, s]));

  // Связность: BFS от первой системы достигает все.
  const start = systems[0]!;
  const visited = new Set<EntityId>([start.id]);
  const queue: EntityId[] = [start.id];
  while (queue.length > 0) {
    const cur = byId.get(queue.shift()!);
    if (!cur) continue;
    for (const jp of cur.jumpPoints) {
      if (!visited.has(jp.toSystemId)) { visited.add(jp.toSystemId); queue.push(jp.toSystemId); }
    }
  }
  v.disconnected = visited.size !== systems.length;

  for (const s of systems) {
    if (s.jumpPoints.length > v.maxDegree) v.maxDegree = s.jumpPoints.length;
    if (s.jumpPoints.length > cfg.maxJumpPointsPerSystem) v.overDegree++;
    const seen = new Set<EntityId>();
    for (const jp of s.jumpPoints) {
      if (!byId.has(jp.toSystemId)) v.dangling++;
      if (seen.has(jp.toSystemId)) v.dupSameDirection++;
      seen.add(jp.toSystemId);
      const t = byId.get(jp.toSystemId);
      if (t && !t.jumpPoints.some(r => r.toSystemId === s.id)) v.asymmetric++;
      if (t) {
        const d = dist(s, t);
        if (d > v.maxDistance) v.maxDistance = d;
        if (d > cfg.maxJumpDistance) v.overDistance++;
      }
    }
  }

  // Правило мостов: каждое сверхдистанционное ребро — мост графа
  // (его удаление разъединяет компоненты). Проверяем по неориентированным парам.
  const overPairs = new Set<string>();
  for (const s of systems) {
    for (const jp of s.jumpPoints) {
      const t = byId.get(jp.toSystemId);
      if (t && dist(s, t) > cfg.maxJumpDistance) {
        overPairs.add([s.id, jp.toSystemId].sort().join('→'));
      }
    }
  }
  for (const pairKey of overPairs) {
    const [aId, bId] = pairKey.split('→') as [EntityId, EntityId];
    const a = byId.get(aId)!;
    const b = byId.get(bId)!;
    // Убираем оба направления ребра и проверяем достижимость a→b.
    const seen = new Set<EntityId>([a.id]);
    const q: EntityId[] = [a.id];
    let reachable = false;
    while (q.length > 0 && !reachable) {
      const cur = byId.get(q.shift()!);
      if (!cur) continue;
      for (const jp of cur.jumpPoints) {
        const skipPair = (cur.id === a.id && jp.toSystemId === b.id) || (cur.id === b.id && jp.toSystemId === a.id);
        if (skipPair) continue;
        if (jp.toSystemId === b.id) { reachable = true; break; }
        if (!seen.has(jp.toSystemId)) { seen.add(jp.toSystemId); q.push(jp.toSystemId); }
      }
    }
    if (reachable) v.overDistanceNotCutEdge++;
  }
  return v;
}

function expectClean(v: Violations): void {
  expect(v.disconnected).toBe(false);
  expect(v.dangling).toBe(0);
  expect(v.dupSameDirection).toBe(0);
  expect(v.asymmetric).toBe(0);
}

describe('Task 35 B3: инварианты графа JP (спиральная галактика)', () => {
  test('1. Дефолт-подобный конфиг: 40 seed × 200 систем — все инварианты', () => {
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 6 };
    for (let seed = 1; seed <= 40; seed++) {
      const systems = makeSystems(seed, 200);
      runJP(systems, seed, cfg);
      const v = checkInvariants(systems, cfg);
      expectClean(v);
      // Лимит степени соблюдается включая мосты (ёмкость предпочитается).
      expect(v.overDegree).toBe(0);
      expect(v.maxDegree).toBeLessThanOrEqual(6);
      // Сверхдистанционные JP — только мосты графа.
      expect(v.overDistanceNotCutEdge).toBe(0);
    }
  });

  test('2. Маленькие галактики (5 и 8 систем): 40 seed — связность без дублей', () => {
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 6 };
    for (const n of [5, 8]) {
      for (let seed = 1; seed <= 40; seed++) {
        const systems = makeSystems(seed, n);
        runJP(systems, seed, cfg);
        const v = checkInvariants(systems, cfg);
        expectClean(v);
        expect(v.overDegree).toBe(0);
        expect(v.overDistanceNotCutEdge).toBe(0);
      }
    }
  });

  test('3. Крошечная максимальная дистанция (300 пк): связность дороже дистанции', () => {
    const cfg: JPCfg = { maxJumpDistance: 300, maxJumpPointsPerSystem: 6 };
    for (let seed = 1; seed <= 25; seed++) {
      const systems = makeSystems(seed, 200);
      runJP(systems, seed, cfg);
      const v = checkInvariants(systems, cfg);
      expectClean(v);
      // Дистанция может превышаться — но только мостами графа.
      expect(v.overDistance).toBeGreaterThan(0);
      expect(v.overDistanceNotCutEdge).toBe(0);
    }
  });

  test('4. Экстремальный лимит степени (maxJP=1): связность приоритетнее, дубли запрещены', () => {
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 1 };
    for (let seed = 1; seed <= 25; seed++) {
      const systems = makeSystems(seed, 200);
      runJP(systems, seed, cfg);
      const v = checkInvariants(systems, cfg);
      expectClean(v);
      // Регулярные JP ≤ 1 на систему; мосты добавляют не более +1
      // (каждая компонента получает ровно один мост).
      expect(v.maxDegree).toBeLessThanOrEqual(2);
      // Каждая система имеет ≥ 1 JP (связность).
      for (const s of systems) expect(s.jumpPoints.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('5. Дистанция покрывает весь диаметр: превышений нет', () => {
    const cfg: JPCfg = { maxJumpDistance: 60000, maxJumpPointsPerSystem: 6 };
    for (let seed = 1; seed <= 15; seed++) {
      const systems = makeSystems(seed, 200);
      runJP(systems, seed, cfg);
      const v = checkInvariants(systems, cfg);
      expectClean(v);
      expect(v.overDegree).toBe(0);
      // Весь граф в пределах дальности — превышений дистанции быть не должно.
      expect(v.overDistance).toBe(0);
    }
  });
});

describe('Task 35 B3: generateJumpPoints — контракт в изоляции', () => {
  /** Линейная раскладка с известными расстояниями. */
  function lineSystems(xs: number[]): StarSystem[] {
    return xs.map((x, i) => ({
      id: `sys_${i + 1}` as EntityId,
      name: `S${i}`,
      position: { x, y: 0 },
      binaryType: 'BINARY_NONE' as const,
      stars: [], planets: [], asteroidFields: 0, jumpPoints: [], discovered: false, owner: null,
    }));
  }

  test('6. Линия из 4 систем: только рёбра ≤ maxDist, взаимность, без дублей и dangling', () => {
    const systems = lineSystems([0, 1000, 2000, 9000]);
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 6 };
    generateJumpPoints(systems, new Xoshiro128StarStar(1), cfg);
    const byId = new Map(systems.map(s => [s.id, s]));
    for (const s of systems) {
      expect(s.jumpPoints.length).toBeLessThanOrEqual(6);
      for (const jp of s.jumpPoints) {
        expect(byId.has(jp.toSystemId)).toBe(true);
        const t = byId.get(jp.toSystemId)!;
        expect(dist(s, t)).toBeLessThanOrEqual(5000);
        expect(t.jumpPoints.some(r => r.toSystemId === s.id)).toBe(true);
      }
    }
    // sys_4 (x=9000) не имеет соседей в пределах 5000 — регулярных JP нет.
    expect(systems[3]!.jumpPoints.length).toBe(0);
  });

  test('7. < 2 систем — no-op обоих функций', () => {
    const systems = lineSystems([0]);
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 6 };
    generateJumpPoints(systems, new Xoshiro128StarStar(1), cfg);
    ensureConnectivity(systems, new Xoshiro128StarStar(1), cfg);
    expect(systems[0]!.jumpPoints).toHaveLength(0);
  });

  test('8. Уже связный граф: ensureConnectivity не добавляет ни одного JP', () => {
    const systems = lineSystems([0, 1000, 2000]);
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 6 };
    generateJumpPoints(systems, new Xoshiro128StarStar(1), cfg);
    const before = systems.reduce((a, s) => a + s.jumpPoints.length, 0);
    expect(before).toBeGreaterThanOrEqual(4); // цепочка связна
    ensureConnectivity(systems, new Xoshiro128StarStar(1), cfg);
    const after = systems.reduce((a, s) => a + s.jumpPoints.length, 0);
    expect(after).toBe(before);
  });

  test('9. Две изолированные группы: один мост — кратчайшее межкомпонентное ребро', () => {
    // Группа A: x ∈ [0, 2000]; группа B: x ∈ [8000, 10000]. Регулярных
    // межгрупповых JP нет (все пары > 5000 кроме (2000, 8000) — ровно 6000 > 5000).
    const systems = lineSystems([0, 1000, 2000, 8000, 9000, 10000]);
    const cfg: JPCfg = { maxJumpDistance: 5000, maxJumpPointsPerSystem: 6 };
    generateJumpPoints(systems, new Xoshiro128StarStar(3), cfg);
    const before = systems.reduce((a, s) => a + s.jumpPoints.length, 0);
    ensureConnectivity(systems, new Xoshiro128StarStar(3), cfg);
    const after = systems.reduce((a, s) => a + s.jumpPoints.length, 0);
    // Ровно один мост (пара JP) между компонентами.
    expect(after - before).toBe(2);
    const v = checkInvariants(systems, cfg);
    expectClean(v);
    // Мост — кратчайшее межкомпонентное ребро: 2000↔8000 (6000).
    const bridged = systems[2]!.jumpPoints.some(jp => jp.toSystemId === 'sys_4')
      || systems[3]!.jumpPoints.some(jp => jp.toSystemId === 'sys_3');
    expect(bridged).toBe(true);
    // И это сверхдистанционный мост графа.
    expect(v.overDistance).toBe(2);
    expect(v.overDistanceNotCutEdge).toBe(0);
  });
});
