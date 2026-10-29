/**
 * PROC-WORKSHOPS-01 — симуляция цехового планировщика (наследник R-26
 * carousel-simulation; категорийная карусель processor упразднена).
 *
 * Сценарий A: 1 завод стройматериалов L2 (2 цеха) + 2 автоповтора →
 * обе партии прогрессируют ОДНОВРЕМЕННО.
 *
 * Сценарий B (пропускная способность): 1 завод L2 (2 цеха) + 3 задачи →
 * одновременно работают 2 партии, третья ждёт; после завершения первой —
 * карусель продолжается на освободившийся цех.
 *
 * Сценарий C (специалист-приоритет): цех №1 специализирован под smelt_fe,
 * очередь [smelt_si, smelt_fe] → специалист берёт smelt_fe вне порядка
 * FIFO, обычный цех №2 — smelt_si.
 *
 * Запуск: bun run scripts/carousel-simulation.ts
 */

import type { Planet, HexCell, HexTerrain, ProductionQueue } from '@/core/types';
import { buildOnHex, enqueueProduction, processEconomyTick, specializeWorkshop } from '@/economy/engine';
import { findWorkshopExecutor } from '@/economy/workshop-scheduler';

function makeHex(i: number): HexCell {
  return {
    coord: { q: i, r: 0 },
    terrain: 'plains' as HexTerrain,
    buildingId: null,
    buildingLevel: 0,
  };
}

function makePlanet(nHexes: number): Planet {
  const hexes = Array.from({ length: nHexes }, (_, i) => makeHex(i));
  return {
    id: 'planet_1',
    systemId: 'sys_1',
    name: 'Test',
    type: 'rocky',
    size: 'medium',
    hexes,
    moons: [],
    atmosphericSlots: [],
    orbitSlots: [],
    resources: { 'Fe-ore': 1000, 'Si-ore': 1000, 'Al-ore': 1000, Fe: 500, Si: 300, Al: 300, C: 200, Ti: 100, Cu: 100, U: 50 },
    resourceDeposits: [],
    atmosphere: { type: 'none', pressure: 0 },
    gravity: 1,
    temperature: 0,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    owner: 'player',
    energyBalance: 100,
    life: { level: 'none', biodiversity: 0 },
  } as unknown as Planet;
}

const queues = new Map<string, ProductionQueue>();

function executorLabel(planet: Planet, itemId: string): string {
  const exec = findWorkshopExecutor(planet, itemId);
  if (!exec) return '—';
  return `гекс#${exec.instanceKey + 1} цех#${exec.workshopNumber}`;
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Сценарий A: завод L2 (2 цеха) + 2 автоповтора');
console.log('═══════════════════════════════════════════════════════════════');
{
  const planet = makePlanet(6);
  buildOnHex(planet, 1, 'construction_materials_plant');
  planet.hexes[1]!.buildingLevel = 2;
  planet.hexes[1]!.workshops = [{}, {}];
  buildOnHex(planet, 3, 'nuclear_reactor'); // источник энергии
  const queue: ProductionQueue = { planetId: planet.id, items: [] };
  queues.set(planet.id, queue);

  enqueueProduction(planet, queues, 'smelt_fe', true);   // автоповтор 1
  enqueueProduction(planet, queues, 'smelt_si', true);   // автоповтор 2

  for (let t = 0; t < 3; t++) {
    processEconomyTick([planet], queues);
    const [a, b] = queue.items;
    if (!a || !b) break;
    console.log(
      `  тик ${t + 1}: smelt_fe progress=${a.progress}/${a.total} (${executorLabel(planet, a.id)})` +
      ` | smelt_si progress=${b.progress}/${b.total} (${executorLabel(planet, b.id)})`,
    );
  }
  const [a, b] = queue.items;
  const bothProgress = !!a && !!b && a.progress < a.total && b.progress < b.total;
  console.log(bothProgress
    ? '  ✓ ОБЕ партии прогрессируют одновременно (2 цеха = 2 параллельные партии)'
    : '  ✗ FAIL: вторая партия не движется');
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Сценарий B (пропускная способность): завод L2 (2 цеха) + 3 задачи');
console.log('═══════════════════════════════════════════════════════════════');
{
  const planet = makePlanet(6);
  buildOnHex(planet, 1, 'construction_materials_plant');
  planet.hexes[1]!.buildingLevel = 2;
  planet.hexes[1]!.workshops = [{}, {}];
  buildOnHex(planet, 3, 'nuclear_reactor'); // источник энергии
  const queue: ProductionQueue = { planetId: planet.id, items: [] };
  queues.set(planet.id, queue);

  enqueueProduction(planet, queues, 'smelt_fe', false);
  enqueueProduction(planet, queues, 'smelt_si', false);
  enqueueProduction(planet, queues, 'smelt_al', false);

  processEconomyTick([planet], queues);
  console.log(`  тик 1: работают ${queue.items.filter(i => (i.total - i.progress) > 0).length} из ${queue.items.length}`);
  const thirdStarted = (queue.items[2]!.total - queue.items[2]!.progress) > 0;
  console.log(thirdStarted
    ? '  ✗ FAIL: третья задача начала работу при 2 цехах'
    : '  ✓ третья задача ждёт — лимит = число цехов (уровень здания)');

  // smelt_fe (5 тиков) завершится раньше — освободит цех для 3-й задачи
  for (let t = 0; t < 6; t++) processEconomyTick([planet], queues);
  const al = queue.items.find(i => i.recipeId === 'smelt_al');
  const feDone = !queue.items.some(i => i.recipeId === 'smelt_fe');
  const alStarted = al !== undefined && (al.total - al.progress) > 0;
  console.log(`  после 7 тиков: smelt_fe завершена=${feDone}, smelt_al начала=${alStarted} (цех освободился → FIFO продолжился)`);
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Сценарий C: специалист-приоритет (цех №1 = smelt_fe)');
console.log('═══════════════════════════════════════════════════════════════');
{
  const planet = makePlanet(6);
  buildOnHex(planet, 1, 'construction_materials_plant');
  planet.hexes[1]!.buildingLevel = 2;
  planet.hexes[1]!.workshops = [{}, {}];
  buildOnHex(planet, 3, 'nuclear_reactor'); // источник энергии
  // Специализируем цех №1 под smelt_fe (доступно с уровня здания 1).
  const spec = specializeWorkshop(planet, 1, 1, 'smelt_fe');
  console.log(`  специализация цеха №1 → smelt_fe: ${spec.success}`);

  const queue: ProductionQueue = { planetId: planet.id, items: [] };
  queues.set(planet.id, queue);
  // Очередь: СНАЧАЛА smelt_si, ПОТОМ smelt_fe
  enqueueProduction(planet, queues, 'smelt_si', false);
  enqueueProduction(planet, queues, 'smelt_fe', false);

  processEconomyTick([planet], queues);
  const si = queue.items.find(i => i.recipeId === 'smelt_si')!;
  const fe = queue.items.find(i => i.recipeId === 'smelt_fe')!;
  const siExec = findWorkshopExecutor(planet, si.id);
  const feExec = findWorkshopExecutor(planet, fe.id);
  console.log(`  smelt_si (1-я в очереди) → ${siExec ? `цех#${siExec.workshopNumber}` : '—'} (ожидался обычный цех №2)`);
  console.log(`  smelt_fe (2-я в очереди) → ${feExec ? `цех#${feExec.workshopNumber}` : '—'} (ожидался специалист цех №1)`);
  const ok = siExec?.workshopNumber === 2 && feExec?.workshopNumber === 1;
  console.log(ok
    ? '  ✓ специалист взял профильную задачу вне порядка FIFO (приоритет §3.0.5-2a)'
    : '  ✗ FAIL: назначение не соответствует приоритету специалиста');
}
console.log('═══════════════════════════════════════════════════════════════');
