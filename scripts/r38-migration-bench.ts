/**
 * R-38 (2026-10-27): измерение времени загрузки и размера сохранения
 * до/после миграции свод-пулов материализованных тел (задание R-38 §5.9).
 *
 * Сценарий (репрезентативный сейв):
 *   - галактика MVP-размера (200 систем);
 *   - 3 колонизированные планеты с материализованными залежами, частично
 *     истощёнными в «геймплее» + склад + постройки;
 *   - сейв состарен до «до R-36/R-37» (без dv/sv, свод старой семантики).
 *
 * Метрики:
 *   1. время deserializeGameState СТАРОГО сейва (миграция 3 тел);
 *   2. время deserializeGameState МИГРИРОВАННОГО сейва (sv=1 — миграция
 *      не срабатывает, «чистый» рантрип);
 *   3. размер сейва до и после миграции (байты + gzip-транспорт);
 *   4. доля времени миграции в загрузке (профиль: census-only vs migrate).
 *
 * Run: DATABASE_URL=file:./db/custom.db bun run scripts/r38-migration-bench.ts
 */

import '@/core/immer-setup';
import { generateGalaxy } from '@/galaxy';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import { colonizePlanet } from '@/economy/engine';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState, Planet } from '@/core/types';

function buildFreshState(seed: number, systemCount: number): GameState {
  const galaxy = generateGalaxy({ seed, systemCount });
  return {
    time: { tick: 100500, dayInYear: 42, year: 3 },
    speed: 1,
    phase: 'playing',
    galaxy,
    productionQueues: new Map(),
    fleets: [],
    playerFactionId: 'player',
    shipDesigns: new Map(),
    shipyardQueues: new Map(),
    ships: new Map(),
    researchState: createDefaultResearchState(),
  };
}

/** Состарить сейв: снос dv/sv + порча свода материализованных тел (R-36-стиль). */
function ageSave(json: string): string {
  const raw = JSON.parse(json) as {
    galaxy: { systems: Array<{ planets: Array<Record<string, unknown>> }> };
  };
  const age = (b: Record<string, unknown>): void => {
    delete b.dv;
    delete b.sv;
    if (b.dm === 1 && Array.isArray(b.resourceDeposits)) {
      for (const t of b.resourceDeposits as unknown[][]) {
        t[1] = (t[1] as number) * 3; // устаревший тотал
      }
    }
  };
  for (const sys of raw.galaxy.systems) {
    for (const p of sys.planets) {
      age(p);
      for (const m of (p.moons as Array<Record<string, unknown>> | undefined) ?? []) age(m);
    }
  }
  return JSON.stringify(raw);
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} МБ` : `${(n / 1024).toFixed(1)} КБ`;
}

// ── Подготовка репрезентативного сейва ──────────────────────────────────────
const SYSTEMS = 200;
const state = buildFreshState(42, SYSTEMS);
const colonized: Planet[] = [];
for (const sys of state.galaxy.systems) {
  for (const p of sys.planets) {
    if (colonized.length >= 3) break;
    if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0 && colonizePlanet(p)) {
      const dep = p.hexes.flatMap(h => h.deposits).find(d => d.quantity > 10);
      if (dep) dep.quantity = Math.ceil(dep.quantity / 2); // частичная выработка
      p.resources['Fe-ore'] = 1234.5;
      colonized.push(p);
    }
  }
  if (colonized.length >= 3) break;
}
if (colonized.length < 3) throw new Error('не удалось колонизировать 3 планеты');

const jsonModern = serializeGameState(state);
const jsonOld = ageSave(jsonModern);

// ── Замеры ──────────────────────────────────────────────────────────────────
const ROUNDS = 5;
const loadOldMs: number[] = [];
const loadMigratedMs: number[] = [];
let jsonMigrated = '';

for (let i = 0; i < ROUNDS; i++) {
  // (1) загрузка СТАРОГО сейва — миграция 3 материализованных тел
  let t0 = performance.now();
  const r1 = deserializeGameState(jsonOld);
  loadOldMs.push(performance.now() - t0);
  if (i === 0) jsonMigrated = serializeGameState(r1);

  // (2) загрузка МИГРИРОВАННОГО сейва — миграция не срабатывает (sv=1)
  t0 = performance.now();
  deserializeGameState(jsonMigrated);
  loadMigratedMs.push(performance.now() - t0);
}

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

const gzOld = Bun.gzipSync(new TextEncoder().encode(jsonOld)).length;
const gzMigrated = Bun.gzipSync(new TextEncoder().encode(jsonMigrated)).length;

// Перепись: сколько тел вообще материализовано в сейве
let dmCount = 0;
let bodyCount = 0;
for (const sys of (JSON.parse(jsonOld) as typeof jsonOldRaw).galaxy.systems) {
  for (const p of sys.planets) {
    bodyCount++;
    if (p.dm === 1) dmCount++;
    for (const m of (p.moons as Array<Record<string, unknown>>) ?? []) {
      bodyCount++;
      if (m.dm === 1) dmCount++;
    }
  }
}
const jsonOldRaw: { galaxy: { systems: Array<{ planets: Array<Record<string, unknown>> }> } } = JSON.parse(jsonOld);

console.log('═'.repeat(72));
console.log(`R-38 бенчмарк миграции: галактика ${SYSTEMS} систем, тел ${bodyCount}, материализовано ${dmCount}`);
console.log('═'.repeat(72));
console.log(`Размер сейва ДО миграции   (plain): ${fmtBytes(jsonOld.length)} (${jsonOld.length} Б)`);
console.log(`Размер сейва ПОСЛЕ миграции (plain): ${fmtBytes(jsonMigrated.length)} (${jsonMigrated.length} Б)`);
console.log(`Дельта plain: ${jsonMigrated.length - jsonOld.length >= 0 ? '+' : ''}${jsonMigrated.length - jsonOld.length} Б`);
console.log(`Размер gzip-транспорта ДО:    ${fmtBytes(gzOld)}`);
console.log(`Размер gzip-транспорта ПОСЛЕ: ${fmtBytes(gzMigrated)} (дельта ${gzMigrated - gzOld} Б)`);
console.log('─'.repeat(72));
console.log(`Загрузка СТАРОГО сейва (миграция ${dmCount} тел):    avg ${avg(loadOldMs).toFixed(1)} мс [${loadOldMs.map(x => x.toFixed(0)).join(', ')}]`);
console.log(`Загрузка МИГРИРОВАННОГО (миграция не нужна): avg ${avg(loadMigratedMs).toFixed(1)} мс [${loadMigratedMs.map(x => x.toFixed(0)).join(', ')}]`);
console.log(`Накладные расходы миграции: ~${(avg(loadOldMs) - avg(loadMigratedMs)).toFixed(1)} мс на ${dmCount} тел (${((avg(loadOldMs) - avg(loadMigratedMs)) / dmCount).toFixed(2)} мс/тело)`);
console.log('═'.repeat(72));
