/**
 * R-26 — анализ размера сейва.
 *
 * Отвечает на вопрос «почему сейв такой большой при условно пустой галактике»:
 * генерирует галактику (как newGame: 200 систем), сериализует GameState
 * тем же пайплайном, что и saveGame, и раскладывает JSON по вкладу секций.
 *
 * Запуск:
 *   bun run scripts/save-size-analysis.ts
 *
 * Также считает «мёртвые» данные (гексы/залежи неколонизированных планет) —
 * вход для дизайна ленивой генерации (R-26).
 */

import { getGameMediator } from '@/core/game-mediator';
import { EconomyModule } from '@/economy/economy-module';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { ShipsModule, resetShipCounter } from '@/ships/ships-module';
import { FleetModule } from '@/ships/fleet-module';
import { ResearchModule } from '@/research/research-module';
import { serializeGameState } from '@/stores/game-store';

function human(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function main(): void {
  const mediator = getGameMediator();
  mediator.registerModule(new GalaxyModule());
  mediator.registerModule(new EconomyModule());
  mediator.registerModule(new ShipsModule());
  mediator.registerModule(new FleetModule());
  mediator.registerModule(new ResearchModule());
  resetShipCounter();

  // Как newGame в game-store: 200 систем (MVP cap), фиксированный seed.
  const state = mediator.newGame({ seed: 20260901, systemCount: 200 });

  const json = serializeGameState(state);
  const bytes = Buffer.byteLength(json, 'utf8');
  const parsed = JSON.parse(json) as Record<string, unknown>;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  R-26: Анализ размера сейва (200 систем, новая игра)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Всего (JSON, serialized): ${human(bytes)}  (${bytes} байт)`);
  console.log();

  // Вклад секций
  const sections = Object.entries(parsed).map(([key, value]) => ({
    key,
    bytes: Buffer.byteLength(JSON.stringify(value), 'utf8'),
  })).sort((a, b) => b.bytes - a.bytes);
  console.log('  Вклад секций (по убыванию):');
  for (const s of sections) {
    const pct = ((s.bytes / bytes) * 100).toFixed(1);
    console.log(`    ${s.key.padEnd(22)} ${human(s.bytes).padStart(10)}  (${pct}%)`);
  }
  console.log();

  // Подсчёт сущностей
  const systems = state.galaxy.systems;
  let planets = 0;
  let gasGiants = 0;
  let hexes = 0;
  let deposits = 0;
  let moonHexes = 0;
  let atmoSlots = 0;
  let orbitSlots = 0;
  let colonizedPlanets = 0;
  let colonizedHexes = 0;
  let colonizedDeposits = 0;

  for (const sys of systems) {
    planets += sys.planets.length;
    for (const p of sys.planets) {
      if (p.type === 'gas_giant') gasGiants++;
      hexes += p.hexes.length;
      deposits += p.hexes.reduce((n, h) => n + h.deposits.length, 0);
      moonHexes += p.moons.reduce((n, m) => n + m.hexes.length, 0);
      atmoSlots += p.atmosphericSlots.length;
      orbitSlots += p.orbitSlots.length;
      if (p.owner != null) {
        colonizedPlanets++;
        colonizedHexes += p.hexes.length;
        colonizedDeposits += p.hexes.reduce((n, h) => n + h.deposits.length, 0);
      }
    }
  }

  console.log('  Сущности:');
  console.log(`    систем:                ${systems.length}`);
  console.log(`    планет:                ${planets} (газовых гигантов: ${gasGiants})`);
  console.log(`    гексов поверхности:    ${hexes}`);
  console.log(`    залежей в гексах:      ${deposits} (≈${(deposits / Math.max(1, hexes)).toFixed(1)} на гекс)`);
  console.log(`    гексов лун:            ${moonHexes}`);
  console.log(`    атмосферных слотов:    ${atmoSlots}`);
  console.log(`    орбитальных слотов:    ${orbitSlots}`);
  console.log(`    колонизированных план: ${colonizedPlanets} (гексов ${colonizedHexes}, залежей ${colonizedDeposits})`);
  console.log();

  // Детализация секции galaxy: звёзды vs планеты vs гексы vs залежи
  const g = parsed.galaxy as Record<string, unknown>;
  const starsBytes = systems.reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s.stars), 'utf8'), 0);
  const planetsBytes = systems.reduce((n, s) => n + Buffer.byteLength(JSON.stringify(s.planets), 'utf8'), 0);
  // Гексы+залежи: пересобрать планеты без hexes/deposits/moons, разница = геометрия+залежи
  const planetsSlim = systems.flatMap((s) => s.planets.map((p) => {
    const { hexes: _h, moons: _m, ...rest } = p;
    return rest;
  }));
  const planetsSlimBytes = Buffer.byteLength(JSON.stringify(planetsSlim), 'utf8');
  const moonsBytes = systems.reduce(
    (n, s) => n + s.planets.reduce((m, p) => m + Buffer.byteLength(JSON.stringify(p.moons), 'utf8'), 0), 0);
  const galaxyOther = Object.entries(g)
    .filter(([k]) => k !== 'systems')
    .reduce((n, [, v]) => n + Buffer.byteLength(JSON.stringify(v), 'utf8'), 0);

  console.log('  Детализация galaxy:');
  console.log(`    звёзды всех систем:          ${human(starsBytes).padStart(10)}`);
  console.log(`    планеты ЦЕЛИКОМ (с гексами): ${human(planetsBytes).padStart(10)}`);
  console.log(`      из них шапки планет:       ${human(planetsSlimBytes).padStart(10)} (без гексов/залежей/лун)`);
  console.log(`      гексы + залежи планет:     ${human(planetsBytes - planetsSlimBytes - moonsBytes).padStart(10)}`);
  console.log(`      луны (гексы+залежи):       ${human(moonsBytes).padStart(10)}`);
  console.log(`    прочее galaxy (JP и т.п.):   ${human(galaxyOther).padStart(10)}`);
  console.log(`    байт на 1 гекс планеты:      ~${Math.round((planetsBytes - planetsSlimBytes - moonsBytes) / Math.max(1, hexes))}`);
  console.log();

  // Оценка ленивой генерации: сколько сейва занято неколонизированными данными
  const galaxyBytes = sections.find((s) => s.key === 'galaxy')?.bytes ?? 0;
  const deadFraction = planets > 0 ? (1 - colonizedPlanets / planets) : 0;
  console.log('  Оценка ленивой генерации (гексы только колонизированных планет):');
  console.log(`    доля неколонизированных планет: ${(deadFraction * 100).toFixed(2)}%`);
  console.log(`    секция galaxy занимает:          ${human(galaxyBytes)}`);
  console.log(`    гексы/залежи — основная масса galaxy; ленивая генерация могла бы`);
  console.log(`    сократить стартовый сейв до ~${human(Math.round(bytes * (0.15 + (1 - deadFraction) * 0.55)))} (оценка: шапки систем/планет + данные колоний)`);

  console.log();
  console.log(`  Место хранения: SQLite → db/custom.db (Prisma, model GameSave, колонка state)`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main();
