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
    if (!system) continue;
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

      const target = systems[distances[j]?.index ?? -1];
      if (!target) continue;

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
 * P1-23 + Task 35 (находка G-02): проверка связности графа систем.
 *
 * Контракт docs/10-galaxy.md §4.2 «Обеспечение связности»: найти компоненты
 * связности, для каждой пары соседних компонент найти ближайшие системы,
 * создать JP между ними, повторять до полной связности.
 *
 * Правило мостов (зафиксировано аудитом Task 35, см. docs §4.2):
 * 1. Мост — КРАТЧАЙШЕЕ ребро между компонентой и уже-связанной частью
 *    графа; каждая компонента получает ровно один мост (мост остаётся
 *    мостом графа: его удаление разъединяет компоненты).
 * 2. Превышение maxJumpDistance допустимо ТОЛЬКО для мостов связности —
 *    без него связность недостижима в разреженных конфигурациях
 *    (глобулярные скопления ореола, малый jumpRadius). Проверяется
 *    тестами: каждое сверхдистанционное ребро обязано быть мостом графа.
 * 3. Лимит степени maxJumpPointsPerSystem соблюдается и для мостов, когда
 *    существует хоть одна пара кандидатов со свободной ёмкостью (мост идёт
 *    по кратчайшей такой паре). Если ёмкости нет ни у одного кандидата,
 *    приоритет отдаётся связности (docs §5.3, шаг 6: «все системы
 *    доступны»), а нарушение лимита минимально: мост вешается между
 *    наименее загруженными системами (min по max(deg a, deg b),
 *    тай-брейк — дистанция). Без этого несколько компонент могли бы
 *    «навалиться» на геометрически ближайшую систему (замер ДО:
 *    maxDegree 6 при maxJP 1 на 200 систем).
 *
 * ДО фикса (аудит Task 35): мосты вешались на каждую изолированную систему
 * по-отдельности (без поиска компонент), без проверки дублей (10600 дублей
 * A→B на 100 seed × 200 систем), без лимита степени (maxDegree 10 при
 * maxJP 6) и без правила для дистанции (JP до 15104 пк при maxDist 5000).
 */
export function ensureConnectivity(systems: StarSystem[], _rng: Xoshiro256, cfg: JumpPointsConfig): void {
  if (systems.length < 2) return;

  const maxJP = cfg.maxJumpPointsPerSystem;
  const byId = new Map<EntityId, StarSystem>(systems.map(s => [s.id, s]));

  // ─── 1. Компоненты связности (BFS, в порядке первого появления) ───
  const compOf = new Map<EntityId, number>();
  const components: StarSystem[][] = [];
  for (const start of systems) {
    if (compOf.has(start.id)) continue;
    const compIndex = components.length;
    const comp: StarSystem[] = [start];
    compOf.set(start.id, compIndex);
    const queue: StarSystem[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const jp of cur.jumpPoints) {
        if (compOf.has(jp.toSystemId)) continue;
        const next = byId.get(jp.toSystemId);
        if (!next) continue; // dangling JP — не расширяет компоненту
        compOf.set(next.id, compIndex);
        comp.push(next);
        queue.push(next);
      }
    }
    components.push(comp);
  }
  if (components.length <= 1) return;

  // ─── 2. Главная (наибольшая) компонента — ядро связности ───
  // Сортировка JS стабильна: при равном размере сохраняется порядок
  // первого появления (индекс первой системы) — детерминированно.
  components.sort((a, b) => b.length - a.length);
  const connectedList: StarSystem[] = [...components[0]!];

  // ─── 3. Каждая прочая компонента — один кратчайший мост ───
  for (let ci = 1; ci < components.length; ci++) {
    const comp = components[ci]!;
    let bestCap: { a: StarSystem; b: StarSystem; d: number } | null = null; // кратчайшее с ёмкостью
    let bestLoad: { a: StarSystem; b: StarSystem; d: number; load: number } | null = null; // наименее загруженное
    for (const a of comp) {
      for (const b of connectedList) {
        const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        if ((!bestCap || d < bestCap.d) &&
            a.jumpPoints.length < maxJP && b.jumpPoints.length < maxJP) {
          bestCap = { a, b, d };
        }
        // Запасной вариант (ёмкости нет ни у одной пары): минимальное
        // нарушение лимита — наименее загруженная пара, тай-брейк дистанцией.
        const load = Math.max(a.jumpPoints.length, b.jumpPoints.length);
        if (!bestLoad || load < bestLoad.load || (load === bestLoad.load && d < bestLoad.d)) {
          bestLoad = { a, b, d, load };
        }
      }
    }
    // Ёмкость предпочтительнее; без ёмкости — связность важнее лимита
    // степени, но нарушение минимально (наименее загруженная пара).
    const chosen = bestCap ?? bestLoad;
    if (!chosen) continue;

    // Guard от дублей: компоненты по определению не связаны, но проверка
    // дешёвая и делает инвариант «нет A→B дважды» безусловным.
    if (!chosen.a.jumpPoints.some(jp => jp.toSystemId === chosen.b.id)) {
      const jp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: chosen.a.id,
        toSystemId: chosen.b.id,
        stabilized: false,
      };
      chosen.a.jumpPoints.push(jp);
      const reverseJp: JumpPoint = {
        id: genId('jp'),
        fromSystemId: chosen.b.id,
        toSystemId: chosen.a.id,
        stabilized: false,
      };
      chosen.b.jumpPoints.push(reverseJp);
    }
    for (const s of comp) connectedList.push(s);
  }
}
