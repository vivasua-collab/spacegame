/**
 * R-26 — симуляция карусели производства (баги 3–4).
 *
 * Сценарий A (баг 3): 2 переработчика + 2 автоповтора → обе задачи
 * должны прогрессировать ОДНОВРЕМЕННО (раньше работал только items[0]).
 *
 * Сценарий B (карусель): 2 переработчика + 3 задачи → одновременно
 * работают 2, третья ждёт.
 *
 * Сценарий C (баг 4): 1 specialized (metal_smelting) + 1 universal,
 * очередь [nonmetal-задача, metal-задача] → specialized берёт metal-задачу
 * вне очереди (приоритет), universal — nonmetal.
 *
 * Запуск: bun run scripts/carousel-simulation.ts
 */

import type { Planet, HexCell, HexTerrain, ProductionQueue } from '@/core/types';
import { buildOnHex, enqueueProduction, processEconomyTick, specializeBuilding } from '@/economy/engine';

function makeHex(i: number): HexCell {
  return {
    coord: { q: i, r: 0 },
    terrain: 'plains' as HexTerrain,
    buildingId: null,
    buildingLevel: 0,
    deposits: [],
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

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Сценарий A (баг 3): 2 переработчика + 2 автоповтора');
console.log('═══════════════════════════════════════════════════════════════');
{
  const planet = makePlanet(6);
  buildOnHex(planet, 1, 'processor');
  buildOnHex(planet, 2, 'processor');
  buildOnHex(planet, 3, 'nuclear_reactor'); // источник энергии (иначе P3-02 блокирует)
  const queue: ProductionQueue = { planetId: planet.id, items: [] };
  queues.set(planet.id, queue);

  enqueueProduction(planet, queues, 'smelt_fe', true);   // автоповтор 1
  enqueueProduction(planet, queues, 'smelt_si', true);   // автоповтор 2

  for (let t = 0; t < 3; t++) {
    processEconomyTick([planet], queues);
    const [a, b] = queue.items;
    console.log(
      `  тик ${t + 1}: задача1(smelt_fe) progress=${a!.progress}/${a!.total} → гекс#${(a!.assignedTo ?? -1) + 1}` +
      ` | задача2(smelt_si) progress=${b!.progress}/${b!.total} → гекс#${(b!.assignedTo ?? -1) + 1}`,
    );
  }
  const [a, b] = queue.items;
  const bothProgress = a!.progress < a!.total && b!.progress < b!.total;
  console.log(bothProgress
    ? '  ✓ ОБЕ задачи прогрессируют одновременно — баг 3 исправлен'
    : '  ✗ FAIL: вторая задача не движется');
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Сценарий B (карусель): 2 переработчика + 3 задачи');
console.log('═══════════════════════════════════════════════════════════════');
{
  const planet = makePlanet(6);
  buildOnHex(planet, 1, 'processor');
  buildOnHex(planet, 2, 'processor');
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
    ? '  ✗ FAIL: третья задача начала работу при 2 переработчиках'
    : '  ✓ третья задача ждёт (слот занят) — лимит = число переработчиков');

  // smelt_fe (5 тиков) завершится раньше — освободит слот для 3-й задачи
  for (let t = 0; t < 6; t++) processEconomyTick([planet], queues);
  const al = queue.items.find(i => i.recipeId === 'smelt_al');
  const feDone = !queue.items.some(i => i.recipeId === 'smelt_fe');
  const alStarted = al !== undefined && (al.total - al.progress) > 0;
  console.log(`  после 7 тиков: smelt_fe завершена=${feDone}, smelt_al начала=${alStarted} (карусель продолжилась на освободившийся слот)`);
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Сценарий C (баг 4): приоритет специализации');
console.log('═══════════════════════════════════════════════════════════════');
{
  const planet = makePlanet(6);
  buildOnHex(planet, 1, 'processor');
  buildOnHex(planet, 2, 'processor');
  buildOnHex(planet, 3, 'nuclear_reactor'); // источник энергии
  // Специализируем первый под metal_smelting (нужен уровень 3)
  const hex1 = planet.hexes[1]!;
  hex1.buildingLevel = 3;
  const spec = specializeBuilding(planet, 1, 'metal_smelting');
  console.log(`  специализация гекс#2 → metal_smelting: ${spec.success}`);

  const queue: ProductionQueue = { planetId: planet.id, items: [] };
  queues.set(planet.id, queue);
  // Очередь: СНАЧАЛА nonmetal (smelt_si), ПОТОМ metal (smelt_fe)
  enqueueProduction(planet, queues, 'smelt_si', false);
  enqueueProduction(planet, queues, 'smelt_fe', false);

  processEconomyTick([planet], queues);
  const si = queue.items.find(i => i.recipeId === 'smelt_si')!;
  const fe = queue.items.find(i => i.recipeId === 'smelt_fe')!;
  console.log(`  smelt_si (nonmetal, 1-я в очереди) → гекс#${(si.assignedTo ?? -1) + 1} (ожидался universal гекс#3)`);
  console.log(`  smelt_fe (metal, 2-я в очереди)   → гекс#${(fe.assignedTo ?? -1) + 1} (ожидался specialized гекс#2)`);
  const ok = si.assignedTo === 2 && fe.assignedTo === 1;
  console.log(ok
    ? '  ✓ специализированный переработчик взял СВОЮ задачу вне очереди (правило карусели отменено)'
    : '  ✗ FAIL: назначение не соответствует приоритету специализации');
}
console.log('═══════════════════════════════════════════════════════════════');
