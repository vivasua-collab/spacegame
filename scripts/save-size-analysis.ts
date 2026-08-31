/**
 * R-28 (2026-08-31): анализ размера сейва.
 *
 * Запрос владельца: «Расчет размера сейва, почему он такой большой?
 * Определить какие данные сохраняются для пустой или условно пустой
 * галактики… Продумать схему оптимизации. Возможно часть полей излишние.»
 *
 * Что делает:
 *   1. Генерирует эталонную галактику (seed 42, 200 систем — конфиг newGame)
 *      и собирает GameState «свежей игры» (без зданий/складов).
 *   2. Сериализует двумя способами:
 *      - v1 — объектная форма (как до R-28) — базлайн;
 *      - v2 — текущий кодек serializeGameState (кортежи, без coord,
 *        округления) — фактический размер сейва.
 *   3. Разлагает v1-JSON по полям каждой сущности (system/star/planet/moon/
 *      hex/deposit/slot/jumpPoint/…): байты значений + байты имён ключей —
 *      диагностика «где сидят байты» для будущих оптимизаций.
 *   4. Считает объекты: системы, планеты, луны, гексы, залежи, слоты.
 *   5. gzip-замеры (транспорт R-26) обеих форм.
 *
 * Run: bun run save:size
 */

import '@/core/immer-setup'; // enableMapSet + setAutoFreeze(false) — нужен сериализатору
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateGalaxy } from '@/galaxy';
import { serializeGameState } from '@/stores/game-store';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState } from '@/core/types';

// ============ Утилиты агрегации ============

interface FieldStat {
  count: number;
  valueBytes: number;
  keyBytes: number;
  numSamples: number;
  numLen: number;
}

type Agg = Map<string, FieldStat>;

function keyOverhead(k: string): number {
  // `"key":` + запятая/фигурная скобка ≈ k.length + 5
  return k.length + 5;
}

function addEntity(agg: Agg, prefix: string, obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    const stat = agg.get(`${prefix}.${k}`) ?? { count: 0, valueBytes: 0, keyBytes: 0, numSamples: 0, numLen: 0 };
    const str = JSON.stringify(v) ?? 'null';
    stat.count++;
    stat.valueBytes += str.length;
    stat.keyBytes += keyOverhead(k);
    if (typeof v === 'number') {
      stat.numSamples++;
      stat.numLen += str.length;
    }
    agg.set(`${prefix}.${k}`, stat);
  }
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(2);
}

// ============ Основной анализ ============

function buildFreshState(systemCount: number, seed: number): GameState {
  const galaxy = generateGalaxy({ seed, systemCount });
  return {
    time: { tick: 0, dayInYear: 0, year: 1 },
    speed: 0,
    phase: 'colonization',
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

interface Counts {
  systems: number;
  planets: number;
  moons: number;
  hexes: number;
  moonHexes: number;
  deposits: number;
  moonDeposits: number;
  orbitSlots: number;
  atmosSlots: number;
  builtSlots: number;
  planetsWithWarehouse: number;
  jumpPoints: number;
  stars: number;
  emptyOrbitSlots: number;
  planetsBySize: Record<string, number>;
}

function collectCounts(root: any): Counts {
  const c: Counts = {
    systems: 0, planets: 0, moons: 0, hexes: 0, moonHexes: 0, deposits: 0, moonDeposits: 0,
    orbitSlots: 0, atmosSlots: 0, builtSlots: 0, planetsWithWarehouse: 0, jumpPoints: 0,
    stars: 0, emptyOrbitSlots: 0, planetsBySize: {},
  };
  for (const sys of root.galaxy.systems) {
    c.systems++;
    c.stars += sys.stars.length;
    c.jumpPoints += sys.jumpPoints.length;
    for (const p of sys.planets) {
      c.planets++;
      c.hexes += p.hexes.length;
      c.deposits += p.hexes.reduce((n: number, h: any) => n + h.deposits.length, 0);
      c.orbitSlots += p.orbitSlots.length;
      c.atmosSlots += p.atmosphericSlots.length;
      c.builtSlots += p.orbitSlots.filter((s: any) => s.buildingId !== null).length;
      c.builtSlots += p.atmosphericSlots.filter((s: any) => s.buildingId !== null).length;
      c.emptyOrbitSlots += p.orbitSlots.filter((s: any) => s.buildingId === null).length;
      if (p.warehouse) c.planetsWithWarehouse++;
      c.planetsBySize[p.size] = (c.planetsBySize[p.size] ?? 0) + 1;
      for (const m of p.moons) {
        c.moons++;
        c.moonHexes += m.hexes.length;
        c.moonDeposits += m.hexes.reduce((n: number, h: any) => n + h.deposits.length, 0);
      }
    }
  }
  return c;
}

function analyze(root: any): { agg: Agg; counts: Counts } {
  const agg: Agg = new Map();
  addEntity(agg, 'state', root);
  addEntity(agg, 'galaxy', root.galaxy);
  for (const sys of root.galaxy.systems) {
    addEntity(agg, 'system', sys);
    for (const st of sys.stars) addEntity(agg, 'star', st);
    for (const jp of sys.jumpPoints) addEntity(agg, 'jumpPoint', jp);
    for (const p of sys.planets) {
      addEntity(agg, 'planet', p);
      addEntity(agg, 'atmosphere', p.atmosphere);
      for (const comp of p.atmosphere.composition) addEntity(agg, 'atmosComp', comp);
      addEntity(agg, 'life', p.life);
      for (const h of p.hexes) {
        addEntity(agg, 'hex', h);
        for (const d of h.deposits) addEntity(agg, 'deposit', d);
      }
      for (const s of p.orbitSlots) addEntity(agg, 'orbitSlot', s);
      for (const s of p.atmosphericSlots) addEntity(agg, 'atmosSlot', s);
      for (const rd of p.resourceDeposits) addEntity(agg, 'planetResDeposit', rd);
      if (p.warehouse) addEntity(agg, 'warehouse', p.warehouse);
      for (const m of p.moons) {
        addEntity(agg, 'moon', m);
        for (const h of m.hexes) {
          addEntity(agg, 'moonHex', h);
          for (const d of h.deposits) addEntity(agg, 'moonDeposit', d);
        }
        for (const rd of m.resourceDeposits) addEntity(agg, 'moonResDeposit', rd);
      }
    }
  }
  return { agg, counts: collectCounts(root) };
}

// ============ Отчёт ============

function main(): void {
  console.log('═════════════════════════════════════════════════════════════');
  console.log('  R-28: Анализ размера сейва (свежая галактика, без колоний)');
  console.log('═════════════════════════════════════════════════════════════');

  const state = buildFreshState(200, 42);

  // v2 — фактический сейв (кодек R-28)
  const v2json = serializeGameState(state);
  const v2gz = gzipSync(Buffer.from(v2json, 'utf8'));

  // v1-базлайн — объектная форма до R-28 (для диагностики полей)
  const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = state.galaxy;
  const v1json = JSON.stringify({
    ...state,
    galaxy: galaxyWithoutMap,
    productionQueues: [],
    shipDesigns: [],
    shipyardQueues: [],
    ships: [],
  });
  const v1gz = gzipSync(Buffer.from(v1json, 'utf8'));
  const reduction = ((1 - v2json.length / v1json.length) * 100).toFixed(1);

  // Поле-ориентированный разбор — на v1-форме
  const root = JSON.parse(v1json);
  const { agg, counts } = analyze(root);

  console.log(`  v1 (до R-28):   ${mb(v1json.length)} МБ plain · ${mb(v1gz.length)} МБ gzip`);
  console.log(`  v2 (кодек):     ${mb(v2json.length)} МБ plain · ${mb(v2gz.length)} МБ gzip`);
  console.log(`  Экономия:       −${reduction}% plain · gzip ${mb(v1gz.length)} → ${mb(v2gz.length)} МБ`);
  console.log(`  Объектов: ${counts.systems} систем · ${counts.stars} звёзд · ${counts.planets} планет · ${counts.moons} лун`);
  console.log(`  Гексов: ${counts.hexes} (планеты) + ${counts.moonHexes} (луны) · залежей: ${counts.deposits} + ${counts.moonDeposits}`);
  console.log(`  Слотов: орб ${counts.orbitSlots} (пустых ${counts.emptyOrbitSlots}) · атмос ${counts.atmosSlots} · с постройками ${counts.builtSlots}`);
  console.log(`  JP: ${counts.jumpPoints} · планет со складом: ${counts.planetsWithWarehouse}`);
  console.log(`  Планеты по размерам: ${Object.entries(counts.planetsBySize).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log('');

  const entityTotals = new Map<string, number>();
  for (const [k, s] of agg) {
    const entity = k.split('.')[0]!;
    entityTotals.set(entity, (entityTotals.get(entity) ?? 0) + s.valueBytes + s.keyBytes);
  }

  console.log('  ── Байты по сущностям (форма v1 — где сидят байты) ──');
  const lines: string[] = [];
  lines.push('# R-28: Анализ размера сейва', '');
  lines.push(`- Свежая игра: seed 42, 200 систем (конфиг newGame), tick 0`);
  lines.push(`- v1 (до R-28): **${mb(v1json.length)} МБ** plain · ${mb(v1gz.length)} МБ gzip`);
  lines.push(`- v2 (кодек R-28): **${mb(v2json.length)} МБ** plain · ${mb(v2gz.length)} МБ gzip (−${reduction}%)`);
  lines.push(`- ${counts.systems} систем · ${counts.planets} планет · ${counts.moons} лун · ${counts.hexes + counts.moonHexes} гексов · ${counts.deposits + counts.moonDeposits} залежей · ${counts.orbitSlots + counts.atmosSlots} слотов (${counts.builtSlots} застроенных)`);
  lines.push('');
  lines.push('## Байты по сущностям (форма v1 — где сидят байты)');
  lines.push('');
  lines.push('| Сущность | МБ |');
  lines.push('|---|---|');
  for (const [entity, total] of [...entityTotals.entries()].sort((a, b) => b[1] - a[1])) {
    if (total < 1000) continue;
    lines.push(`| ${entity} | ${mb(total)} |`);
    console.log(`  ${entity.padEnd(18)} ${mb(total).padStart(7)} МБ`);
  }
  console.log('');

  lines.push('', '## Детализация по полям (форма v1)');
  lines.push('');
  for (const [entity, label] of [
    ['planet', 'Планета'], ['hex', 'Гекс планеты'], ['deposit', 'Залежь (гекс)'],
    ['moon', 'Луна'], ['moonHex', 'Гекс луны'], ['orbitSlot', 'Орбитальный слот'],
    ['system', 'Система'], ['star', 'Звезда'], ['jumpPoint', 'Jump Point'],
    ['planetResDeposit', 'Агрегат залежей (планета)'],
    ['atmosphere', 'Атмосфера'], ['atmosComp', 'Компонент атмосферы'],
    ['life', 'Жизнь'], ['warehouse', 'Склад'],
  ] as const) {
    if (!entityTotals.has(entity)) continue;
    const fields = [...agg.keys()].filter((k) => k.startsWith(`${entity}.`))
      .sort((a, b) => (agg.get(b)!.valueBytes + agg.get(b)!.keyBytes) - (agg.get(a)!.valueBytes + agg.get(a)!.keyBytes));
    let entityBytes = 0;
    for (const k of fields) entityBytes += agg.get(k)!.valueBytes + agg.get(k)!.keyBytes;
    lines.push(`### ${label} — ${mb(entityBytes)} МБ`);
    lines.push('');
    lines.push('| Поле | Повторов | Знач. МБ | Ключи МБ | Ср. на экз. |');
    lines.push('|---|---|---|---|---|');
    for (const k of fields) {
      const s = agg.get(k)!;
      const fname = k.slice(entity.length + 1);
      const numInfo = s.numSamples > 0 ? ` · ср.число ${(s.numLen / Math.max(1, s.numSamples)).toFixed(1)} симв.` : '';
      lines.push(`| ${fname} | ${s.count} | ${mb(s.valueBytes)} | ${mb(s.keyBytes)} | ${(s.valueBytes / Math.max(1, s.count)).toFixed(0)} б${numInfo} |`);
    }
    lines.push('');
  }

  lines.push('## Кодек v2 (R-28) — что изменилось', '');
  lines.push('| Форма | Plain | gzip |');
  lines.push('|---|---|---|');
  lines.push(`| v1 (объекты, до R-28) | ${mb(v1json.length)} | ${mb(v1gz.length)} |`);
  lines.push(`| v2 (кортежи + округления + без coord/пустых полей) | ${mb(v2json.length)} | ${mb(v2gz.length)} |`);
  lines.push('', '- Залежи → кортежи `[elementId, availability(3 зн.), quantity, depth]` — убраны ~11 МБ имён ключей (×276 тыс.) и ~8 МБ хвостов availability (ср. 18.4 симв. → 5).');
  lines.push('- Свод resourceDeposits → кортежи `[elementId, total, avg, tierIdx, hexCount, max]` — RNG-контент агрегата (гарантированные элементы + ультраредкие) сохраняется полностью, меняется только форма.');
  lines.push('- Гексы: без `coord` (восстановление из сетки по индексу массива), без `buildingId:null`/`buildingLevel:0` и `deposits:[]` у пустых.');
  lines.push('- Звёзды: mass/luminosity/temperature/radius → 4 значащих цифры (хвосты float-арифметики).');
  lines.push('- Слоты НЕ сжимаются: 0.6% выгоды, а количество ГГ-слотов RNG-зависимо (нужно поле-счётчик) — слоп не стоит сложности.');
  lines.push('- ВНИМАНИЕ: агрегат resourceDeposits НЕ выводится из гексов — aggregateResourceDeposits() добавляет RNG-контент; дропнуть его нельзя.');
  lines.push('');

  mkdirSync('scripts/output', { recursive: true });
  writeFileSync('scripts/output/save-size-analysis.md', lines.join('\n'));
  console.log('  Отчёт: scripts/output/save-size-analysis.md');
  console.log('═════════════════════════════════════════════════════════════');
}

main();
