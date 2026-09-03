/**
 * R-26 (2026-08-31): инспекция дампа (сейва) галактики — инструмент
 * анализа для агента/владельца.
 *
 * Запрос владельца: «Необходимо реализовать возможность чтения дампа
 * (сейва) галактики, для твоего анализа».
 *
 * Что делает:
 *   1. Читает сейв из SQLite (последний по updatedAt, или --id=<cuid>).
 *   2. Разворачивает state JSON → scripts/output/save-dump.json
 *      (полный дамп для ручного анализа).
 *   3. Печатает + пишет в scripts/output/save-summary.md сводку:
 *      - метасейва (имя, seed, tick, version, размер);
 *      - матрицу планет тип × размер (count, min/max гравитации и радиуса);
 *      - проверку гравитационной градации R-26: инверсии классов,
 *        монотонность по радиусу, согласованность формулы g = R×ρ/5.51;
 *      - метрики состояния (исследования, очереди, корабли).
 *
 * Run: bun run save:inspect [--id=<cuid>]
 */

import { db } from '@/lib/db';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PLANET_GRAVITY_BANDS } from '@/data/planet-types';
import type { PlanetType, PlanetSize } from '@/core/types';

const OUTPUT_DIR = 'scripts/output';
const SIZE_ORDER: PlanetSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];

interface DumpPlanet {
  type: PlanetType;
  size: PlanetSize;
  radiusKm: number;
  gravity: number;
  density: number;
}

async function main(): Promise<void> {
  // ─── Аргументы: --id=<cuid> (иначе последний сейв) ─────────────────
  const idArg = process.argv.find((a) => a.startsWith('--id='));
  const save = idArg
    ? await db.gameSave.findUnique({ where: { id: idArg.slice(4) } })
    : await db.gameSave.findFirst({ orderBy: { updatedAt: 'desc' } });

  if (!save) {
    console.error('Сейв не найден. Создайте сохранение в игре или передайте --id=<cuid>.');
    process.exit(1);
  }

  console.log('═════════════════════════════════════════════════════════════');
  console.log('  R-26: Инспекция дампа галактики');
  console.log('═════════════════════════════════════════════════════════════');
  console.log(`  Save ID:     ${save.id}`);
  console.log(`  Имя:         ${save.name}`);
  console.log(`  Seed:        ${save.seed}`);
  console.log(`  Tick:        ${save.tick} · version: ${save.version}`);
  console.log(`  State:       ${(save.state.length / 1048576).toFixed(2)} МБ (plain JSON в БД)`);
  console.log('');

  // ─── Разбор состояния ────────────────────────────────────────────
  const state = JSON.parse(save.state) as {
    galaxy?: { systems?: Array<{ planets?: Array<DumpPlanet & { moons?: DumpPlanet[] }> }> };
    time?: { tick?: number };
    phase?: string;
    researchState?: { rpBank?: number; activeTechId?: string | null; queue?: unknown[] };
    productionQueues?: unknown[];
    ships?: unknown[];
    shipDesigns?: unknown[];
  };

  const systems = state.galaxy?.systems ?? [];
  const planets: DumpPlanet[] = [];
  const moons: DumpPlanet[] = [];
  for (const sys of systems) {
    for (const p of sys.planets ?? []) {
      planets.push(p);
      for (const m of p.moons ?? []) moons.push(m);
    }
  }

  console.log(`  Систем: ${systems.length} · планет: ${planets.length} · лун: ${moons.length}`);
  console.log(`  Phase: ${state.phase ?? '?'} · tick(state): ${state.time?.tick ?? '?'}`);
  console.log(`  Research: rpBank=${state.researchState?.rpBank ?? 0} · activeTech=${state.researchState?.activeTechId ?? '—'} · queue=${state.researchState?.queue?.length ?? 0}`);
  console.log(`  Очередей производства: ${state.productionQueues?.length ?? 0} · кораблей: ${state.ships?.length ?? 0} · дизайнов: ${state.shipDesigns?.length ?? 0}`);
  console.log('');

  // ─── Матрица тип × размер + метрики градации ─────────────────────
  const lines: string[] = [];
  lines.push('# R-26: Сводка дампа галактики', '');
  lines.push(`- Save: ${save.name} (id \`${save.id}\`, seed ${save.seed}, tick ${save.tick})`);
  lines.push(`- State: ${(save.state.length / 1048576).toFixed(2)} МБ · систем ${systems.length} · планет ${planets.length} · лун ${moons.length}`);
  lines.push('');

  lines.push('## Матрица планет: тип × размер (гравитация min–max)');
  lines.push('');
  lines.push('| Тип | Класс | Кол-во | g min | g max | R min (км) | R max (км) | Полоса R-26 |');
  lines.push('|---|---|---|---|---|---|---|---|');

  let classInversions = 0;
  let monotonicViolations = 0;
  let formulaViolations = 0;

  for (const type of Object.keys(PLANET_GRAVITY_BANDS) as PlanetType[]) {
    const of = planets.filter((p) => p.type === type);
    if (of.length === 0) continue;

    for (const size of SIZE_ORDER) {
      const inClass = of.filter((p) => p.size === size);
      const band = PLANET_GRAVITY_BANDS[type][size];
      if (inClass.length === 0 || !band) continue;
      const gMin = Math.min(...inClass.map((p) => p.gravity));
      const gMax = Math.max(...inClass.map((p) => p.gravity));
      const rMin = Math.min(...inClass.map((p) => p.radiusKm));
      const rMax = Math.max(...inClass.map((p) => p.radiusKm));
      lines.push(
        `| ${type} | ${size} | ${inClass.length} | ${gMin.toFixed(2)} | ${gMax.toFixed(2)} | ${rMin} | ${rMax} | [${band.min}, ${band.max}] |`,
      );
    }

    // Проверка 1: инверсии классов (max меньшего < min большего)
    const classes = SIZE_ORDER.filter((s) => of.some((p) => p.size === s));
    for (let i = 1; i < classes.length; i++) {
      const prev = of.filter((p) => p.size === classes[i - 1]).map((p) => p.gravity);
      const curr = of.filter((p) => p.size === classes[i]).map((p) => p.gravity);
      if (Math.max(...prev) >= Math.min(...curr)) classInversions++;
    }

    // Проверка 2: монотонность по радиусу (не убывание g)
    const sorted = [...of].sort((a, b) => a.radiusKm - b.radiusKm);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.gravity < sorted[i - 1]!.gravity) monotonicViolations++;
    }

    // Проверка 3: согласованность формулы g = R×ρ/5.51
    for (const p of of) {
      const gExpected = (p.radiusKm / 6371) * (p.density / 5.51);
      if (Math.abs(gExpected - p.gravity) > 0.05) formulaViolations++;
    }
  }

  lines.push('');
  lines.push('## Проверки гравитационной градации (R-26)');
  lines.push('');
  lines.push(`- Инверсии классов (max меньшего ≥ min большего): **${classInversions}**`);
  lines.push(`- Нарушения монотонности g по радиусу: **${monotonicViolations}**`);
  lines.push(`- Расхождения формулы g = R×ρ/5.51 (>0.05): **${formulaViolations}**`);
  lines.push('');
  lines.push(`_${classInversions === 0 && monotonicViolations === 0 ? '✅ Градация соблюдена' : '❌ ЕСТЬ НАРУШЕНИЯ — см. выше'}_`);

  const summary = lines.join('\n');
  console.log(summary);
  console.log('');

  // ─── Дамп на диск ────────────────────────────────────────────────
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const dumpPath = `${OUTPUT_DIR}/save-dump.json`;
  const summaryPath = `${OUTPUT_DIR}/save-summary.md`;
  writeFileSync(dumpPath, save.state);
  writeFileSync(summaryPath, summary);
  console.log(`  Дамп:       ${dumpPath}`);
  console.log(`  Сводка:     ${summaryPath}`);
  console.log('═════════════════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('inspect-save failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect ? db.$disconnect() : undefined);
