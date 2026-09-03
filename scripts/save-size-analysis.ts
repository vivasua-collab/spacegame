/**
 * R-28/R-29 (2026-08-31): анализ размера сейва.
 *
 * Запрос владельца (R-28): «Расчет размера сейва, почему он такой большой?
 * …какие данные сохраняются для пустой галактики…».
 * Запрос владельца (R-29): ленивые залежи — «в сейв не попадают мёртвые
 * (не разведанные) гексы, файл на начальном этапе меньше».
 *
 * Что делает:
 *   1. Генерирует эталонную галактику (seed 42, 200 систем — конфиг newGame)
 *      и собирает GameState «свежей игры» (без колоний; R-29: гексы без
 *      залежей — ленивые).
 *   2. Сериализует: v3-кодек (фактический формат сейва после R-29) для
 *      трёх сценариев: свежая игра / ранние колонии (5 колонизированы) /
 *      верхняя граница (ВСЕ тела материализованы).
 *   3. Разлагает объектную форму по полям сущностей — «где сидят байты».
 *   4. Считает объекты и gzip-замеры (транспорт R-26).
 *
 * Run: bun run save:size
 */

import '@/core/immer-setup'; // enableMapSet + setAutoFreeze(false) — нужен сериализатору
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateGalaxy } from '@/galaxy';
import { materializePlanetDeposits } from '@/galaxy/generate-resources';
import { colonizePlanet } from '@/economy/engine';
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
  console.log('  R-29: Анализ размера сейва (ленивые залежи, fmt v3)');
  console.log('═════════════════════════════════════════════════════════════');

  const state = buildFreshState(200, 42);

  // Сценарий А: свежая игра — гексы без залежей (ленивые, R-29)
  const freshJson = serializeGameState(state);
  const freshGz = gzipSync(Buffer.from(freshJson, 'utf8'));

  // Сценарий Б: ранние колонии — колонизируем 5 подходящих планет
  let colonized = 0;
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (colonized >= 5) break;
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length >= 37) {
        if (colonizePlanet(p)) colonized++;
      }
    }
    if (colonized >= 5) break;
  }
  const earlyJson = serializeGameState(state);
  const earlyGz = gzipSync(Buffer.from(earlyJson, 'utf8'));

  // Сценарий В: верхняя граница — материализуем ВСЕ тела (как до R-29)
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      materializePlanetDeposits(p);
      for (const m of p.moons) materializePlanetDeposits(m);
    }
  }
  const fullJson = serializeGameState(state);
  const fullGz = gzipSync(Buffer.from(fullJson, 'utf8'));

  // Объектная форма (для полевого разбора) — на СВЕЖЕМ ленивом состоянии
  const lazyState = buildFreshState(200, 42);
  const { systemMap: _sm, bakedModel: _bm, ...galaxyWithoutMap } = lazyState.galaxy;
  const plainJson = JSON.stringify({
    ...lazyState,
    galaxy: galaxyWithoutMap,
    productionQueues: [],
    shipDesigns: [],
    shipyardQueues: [],
    ships: [],
  });
  const root = JSON.parse(plainJson);
  const { agg, counts } = analyze(root);

  console.log('  ── Сценарии (fmt v3, кодек serializeGameState) ──');
  console.log(`  А. Свежая игра (лениво):   ${mb(freshJson.length)} МБ plain · ${mb(freshGz.length)} МБ gzip`);
  console.log(`  Б. 5 колоний:              ${mb(earlyJson.length)} МБ plain · ${mb(earlyGz.length)} МБ gzip`);
  console.log(`  В. ВСЁ материализовано:    ${mb(fullJson.length)} МБ plain · ${mb(fullGz.length)} МБ gzip (≈ до R-29)`);
  console.log(`  Объектов: ${counts.systems} систем · ${counts.stars} звёзд · ${counts.planets} планет · ${counts.moons} лун`);
  console.log(`  Гексов: ${counts.hexes} (планеты) + ${counts.moonHexes} (луны) · залежей в сейве А: 0 (лениво)`);
  console.log(`  Слотов: орб ${counts.orbitSlots} (пустых ${counts.emptyOrbitSlots}) · атмос ${counts.atmosSlots} · с постройками ${counts.builtSlots}`);
  console.log(`  JP: ${counts.jumpPoints} · планет со складом: ${counts.planetsWithWarehouse}`);
  console.log(`  Планеты по размерам: ${Object.entries(counts.planetsBySize).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log('');

  const entityTotals = new Map<string, number>();
  for (const [k, s] of agg) {
    const entity = k.split('.')[0]!;
    entityTotals.set(entity, (entityTotals.get(entity) ?? 0) + s.valueBytes + s.keyBytes);
  }

  console.log('  ── Байты по сущностям (объектная форма свежего состояния) ──');
  const lines: string[] = [];
  lines.push('# R-29: Анализ размера сейва (ленивые залежи)', '');
  lines.push(`- Свежая игра: seed 42, 200 систем (конфиг newGame), tick 0, fmt v3`);
  lines.push(`- А. Свежая игра (лениво): **${mb(freshJson.length)} МБ** plain · ${mb(freshGz.length)} МБ gzip`);
  lines.push(`- Б. 5 колоний: **${mb(earlyJson.length)} МБ** plain · ${mb(earlyGz.length)} МБ gzip`);
  lines.push(`- В. Все тела материализованы (верхняя граница, ≈ до R-29): **${mb(fullJson.length)} МБ** plain · ${mb(fullGz.length)} МБ gzip`);
  lines.push(`- ${counts.systems} систем · ${counts.planets} планет · ${counts.moons} лун · ${counts.hexes + counts.moonHexes} гексов (залежи — только у материализованных тел) · ${counts.orbitSlots + counts.atmosSlots} слотов (${counts.builtSlots} застроенных)`);
  lines.push('');
  lines.push('## Байты по сущностям (объектная форма)');
  lines.push('');
  lines.push('| Сущность | МБ |');
  lines.push('|---|---|');
  for (const [entity, total] of [...entityTotals.entries()].sort((a, b) => b[1] - a[1])) {
    if (total < 1000) continue;
    lines.push(`| ${entity} | ${mb(total)} |`);
    console.log(`  ${entity.padEnd(18)} ${mb(total).padStart(7)} МБ`);
  }
  console.log('');

  lines.push('', '## Детализация по полям (объектная форма)');
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

  lines.push('## Кодек v3 (R-29) — что изменилось относительно v2', '');
  lines.push('- Ленивые залежи: в сейв попадают только гексы материализованных (колонизированных) тел; свежая игра хранит лишь свод-пул + RNG-снимок `ds`.');
  lines.push('- Истощённые залежи (qty<=0) не пишутся; флаг `dm` исключает повторную материализацию.');
  lines.push('- Словарь `galaxy.dict`: кортежи залежей/свода пишут индекс id вместо строки.');
  lines.push('', '## Кодек v2 (R-28) — что изменился относительно v1', '');
  lines.push('| Форма | Plain | gzip |');
  lines.push('|---|---|---|');
  lines.push(`| v3 А (ленивая свежая, R-29) | ${mb(freshJson.length)} | ${mb(freshGz.length)} |`);
  lines.push(`| v3 В (все материализованы) | ${mb(fullJson.length)} | ${mb(fullGz.length)} |`);
  lines.push(`| Объектная форма (эталон полей) | ${mb(plainJson.length)} | — |`);
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
