/**
 * Task 36 (аудит δ, C2): физические и структурные инварианты планет и лун.
 *
 * Корпус: 100 seed × 40 систем (≈4000 систем, ≈11000 планет, ≈7700 лун),
 * генерируется один раз при загрузке модуля (~19 с); все проверки — по
 * кэшированному корпусу. Бюджет файла < 60 с.
 *
 * Источники ожиданий:
 *  - src/data/planet-types.ts (+ planets/grids.json — data-driven сетки);
 *  - docs/30-planets.md §2.1–§2.5 (радиус, гравитация, температура,
 *    атмосфера, жизнь) — таблицы продублированы в тесте как ожидания;
 *  - src/data/stars/types.json (веса каталога — распределение ПЕРВИЧНЫХ
 *    звёзд; компаньоны выбираются по правилу G-12 «тот же класс или на 1
 *    ниже», поэтому проверяются только первички).
 *
 * Игровые допущения (задокументированы, НЕ дефекты — см. финальный отчёт):
 *  - температура может выходить за диапазон типа §1.1: физическая модель
 *    §2.3 не клампирует (docs = код);
 *  - луны 2–7 / 250–3500 км / веса 35/45/20 vs §1.3 (2–12 / 200–2500 /
 *    30/40/30) — осознанное MVP-решение аудита 2026-08-28;
 *  - жизнь при экстремальной температуре возможна (микробы-экстремофилы,
 *    G-01/G-10: §1.2.2 вулканические 5% микробов при +200..+800 °C).
 *
 * Run: bun test tests/galaxy/planet-invariants.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy, DEFAULT_CONFIG } from '@/galaxy';
import {
  PLANET_TYPE_RADIUS,
  PLANET_DENSITY,
  SIZE_HEX_COUNT,
  MOON_SIZE_HEX_COUNT,
  MOON_DENSITY,
  MOON_RADIUS,
  MOON_ORBIT_RADIUS_KM,
  GAS_GIANT_MOON_COUNT,
  ORBIT_SLOTS_BY_SIZE,
  ORBIT_SLOTS,
  GAS_GIANT_ATMOSPHERE_SLOTS,
} from '@/data/planet-types';
import { STAR_TYPES, STAR_WEIGHTS, STAR_TYPE_MAP } from '@/data/stars';
import type { Galaxy, Planet, Moon } from '@/core/types';

// ============ Ожидания из docs/30-planets.md ============

/** §2.4: диапазоны давления (атм) по типу атмосферы. */
const DOCS_PRESSURE: Record<string, [number, number]> = {
  none: [0, 0],
  thin: [0.001, 0.5],
  standard: [0.5, 1.5],
  dense: [1.5, 5.0],
  toxic: [0.1, 5.0],
  inert: [0.01, 2.0],
  methane: [0.5, 3.0],
  co2: [0.5, 10.0],
};

/** §2.3: базовое ΔT парникового эффекта (K) по типу атмосферы. */
const DOCS_GREENHOUSE: Record<string, [number, number]> = {
  none: [0, 0],
  thin: [5, 20],
  standard: [25, 40],
  dense: [50, 130],
  co2: [80, 280],
  methane: [30, 90],
  toxic: [10, 35],
  inert: [5, 15],
};

/** §2.3: модификатор типа планеты ΔT_type (K). */
const DOCS_TYPE_MOD: Record<string, [number, number]> = {
  volcanic: [30, 100],
  ice: [-50, -20],
  gas_giant: [10, 30],
  desert: [-5, 10],
};

/** Граница tiny/small для лун (0.15 R⊕ в км) и допуск округления радиуса. */
const MOON_TINY_BOUNDARY_KM = 0.15 * 6371;
const RADIUS_ROUNDING_KM = 1; // radiusKm хранится округлённым до целого км

// ============ Корпус (генерируется один раз) ============

const SEEDS = 100;
const SYSTEMS = 40;

interface Corpus {
  galaxies: Galaxy[];
  planets: Planet[];
  moons: Moon[];
  /** (galaxyIndex, systemIndex, planets sorted by orbitalRadius) — SINGLE ≥4. */
  singleSystems: Planet[][];
  primaryStarTypes: string[];
  buildMs: number;
}

function buildCorpus(): Corpus {
  const t0 = Date.now();
  const galaxies: Galaxy[] = [];
  const planets: Planet[] = [];
  const moons: Moon[] = [];
  const singleSystems: Planet[][] = [];
  const primaryStarTypes: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = generateGalaxy({ ...DEFAULT_CONFIG, seed, systemCount: SYSTEMS });
    galaxies.push(g);
    for (const sys of g.systems) {
      primaryStarTypes.push(sys.stars[0]!.type);
      planets.push(...sys.planets);
      for (const p of sys.planets) moons.push(...p.moons);
      if (sys.binaryType === 'BINARY_NONE' && sys.planets.length >= 4) {
        singleSystems.push([...sys.planets].sort((a, b) => a.orbitalRadius - b.orbitalRadius));
      }
    }
  }
  return { galaxies, planets, moons, singleSystems, primaryStarTypes, buildMs: Date.now() - t0 };
}

const corpus: Corpus = buildCorpus();

// ============ Тесты ============

describe('Task 36 C2: физические параметры планет', () => {
  test(`корпус: 100 seed × 40 систем → достаточно планет/лун (${corpus.buildMs} мс сборки)`, () => {
    expect(corpus.planets.length).toBeGreaterThan(9000);
    expect(corpus.moons.length).toBeGreaterThan(5000);
    expect(corpus.singleSystems.length).toBeGreaterThan(700);
  });

  test('радиус — в диапазоне каталога типа (±1 км округление), все числа конечны', () => {
    for (const p of corpus.planets) {
      const range = PLANET_TYPE_RADIUS[p.type];
      expect(range, `тип ${p.type} есть в каталоге`).toBeDefined();
      expect(p.radiusKm, `${p.name}: R=${p.radiusKm} ∉ [${range.min}, ${range.max}]`).toBeGreaterThanOrEqual(range.min - 1);
      expect(p.radiusKm, `${p.name}: R=${p.radiusKm} ∉ [${range.min}, ${range.max}]`).toBeLessThanOrEqual(range.max + 1);
      for (const [field, value] of [
        ['radiusKm', p.radiusKm], ['density', p.density], ['gravity', p.gravity],
        ['temperature', p.temperature], ['pressure', p.atmosphere.pressure],
        ['orbitalRadius', p.orbitalRadius], ['orbitalPeriod', p.orbitalPeriod],
        ['biodiversity', p.life.biodiversity], ['hazardLevel', p.life.hazardLevel],
      ] as const) {
        expect(Number.isFinite(value), `${p.name}.${field} = ${value}`).toBe(true);
      }
    }
  });

  test('плотность — в диапазоне типа; согласована с (g, R): ρ = g×5.51×6371/R', () => {
    for (const p of corpus.planets) {
      const range = PLANET_DENSITY[p.type];
      // допуск: выводится из полосы R-26 + округления 2dp
      expect(p.density, `${p.name} (${p.type}): ρ=${p.density} ∉ [${range.min}, ${range.max}]`).toBeGreaterThanOrEqual(range.min - 0.05);
      expect(p.density, `${p.name} (${p.type}): ρ=${p.density} ∉ [${range.min}, ${range.max}]`).toBeLessThanOrEqual(range.max + 0.05);
      // согласованность (docs §2.2): допуск = вклад округления gravity 2dp
      const rhoFromGR = (p.gravity * 5.51 * 6371) / p.radiusKm;
      const tol = (0.005 * 5.51 * 6371) / p.radiusKm + 0.01;
      expect(Math.abs(p.density - rhoFromGR), `${p.name}: ρ=${p.density} vs g,R → ${rhoFromGR.toFixed(2)}`).toBeLessThanOrEqual(tol);
      expect(p.gravity, `${p.name}: g=${p.gravity}`).toBeGreaterThan(0);
    }
  });

  test('атмосфера: давление строго в диапазонах docs §2.4', () => {
    for (const p of corpus.planets) {
      const range = DOCS_PRESSURE[p.atmosphere.type];
      expect(range, `${p.name}: тип атмосферы ${p.atmosphere.type} есть в docs §2.4`).toBeDefined();
      expect(p.atmosphere.pressure, `${p.name} (${p.atmosphere.type}): P=${p.atmosphere.pressure}`).toBeGreaterThanOrEqual(range![0] - 1e-9);
      expect(p.atmosphere.pressure, `${p.name} (${p.atmosphere.type}): P=${p.atmosphere.pressure}`).toBeLessThanOrEqual(range![1] + 1e-9);
      if (p.atmosphere.type === 'none') {
        expect(p.atmosphere.pressure, `${p.name}: без атмосферы → P=0`).toBe(0);
      }
    }
  });

  test('температура — внутри конверта docs §2.3 при хранимых (L, r, атмосфера, тип)', () => {
    for (const galaxy of corpus.galaxies) {
      for (const sys of galaxy.systems) {
        const star = sys.stars[0]!;
        const L = Math.max(0.001, star.luminosity);
        for (const p of sys.planets) {
          // r хранится округлённым до 2dp → конверт расширяется на |dT/dr|×0.005
          const r = Math.max(0.05, p.orbitalRadius);
          const base = 278.5 * Math.pow(L, 0.25) * Math.pow(r, -0.5);
          const teqMaxAlbedo = base * Math.pow(0.15, 0.25); // A=0.85
          const [ghMin, ghMax] = DOCS_GREENHOUSE[p.atmosphere.type]!;
          const ps = p.atmosphere.pressure > 0
            ? Math.pow(Math.max(0.001, p.atmosphere.pressure), 0.25)
            : 0;
          const [tMin, tMax] = DOCS_TYPE_MOD[p.type] ?? [0, 0];
          const lo = teqMaxAlbedo + ghMin * ps + tMin - 273.15;
          const hi = base + ghMax * ps + tMax - 273.15;
          const tolR = (0.5 * base / r) * 0.005 + 1.5; // 2dp-квант r + round(T)
          expect(p.temperature,
            `${p.name} (${p.type}/${p.atmosphere.type}, L=${L.toFixed(4)}, r=${r}): T=${p.temperature} ∉ [${lo.toFixed(1)}, ${hi.toFixed(1)}]`)
            .toBeGreaterThanOrEqual(lo - tolR);
          expect(p.temperature,
            `${p.name} (${p.type}/${p.atmosphere.type}, L=${L.toFixed(4)}, r=${r}): T=${p.temperature} ∉ [${lo.toFixed(1)}, ${hi.toFixed(1)}]`)
            .toBeLessThanOrEqual(hi + tolR);
        }
      }
    }
  });

  test('температурный тренд: внутренняя половина SINGLE-системы горячее внешней (≥90%)', () => {
    expect(corpus.singleSystems.length).toBeGreaterThan(700);
    let hotter = 0;
    for (const ps of corpus.singleSystems) {
      const half = Math.floor(ps.length / 2);
      const innerT = ps.slice(0, half).reduce((s, p) => s + p.temperature, 0) / half;
      const outerT = ps.slice(half).reduce((s, p) => s + p.temperature, 0) / (ps.length - half);
      if (innerT > outerT) hotter++;
    }
    // Эмпирика фикса: 96.8% (1008/1041). Парниковые инверсии отдельных
    // планет (Венера>Меркурий) физически допустимы — тренд статистический.
    expect(hotter / corpus.singleSystems.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Task 36 C2: жизнь (docs §2.5 + G-01/G-09/G-10/G-11)', () => {
  test('жёсткие блоки и ограничения уровня жизни', () => {
    let withLife = 0;
    for (const p of corpus.planets) {
      const life = p.life.level;
      if (life !== 'none') withLife++;
      // ГГ без жизни (docs §1.2.6: нет 100%)
      if (p.type === 'gas_giant') {
        expect(life, `${p.name}: жизнь на газовом гиганте`).toBe('none');
      }
      // без атмосферы — без жизни (docs §2.5 усл.2 через G-01 hard block)
      if (p.atmosphere.type === 'none') {
        expect(life, `${p.name}: жизнь без атмосферы`).toBe('none');
      }
      // токсичная атмосфера → только микробы (G-11, docs §1.2)
      if (p.atmosphere.type === 'toxic' && life !== 'none') {
        expect(life, `${p.name}: ${life} при токсичной атмосфере`).toBe('microbes');
      }
      // экстремальная температура → только микробы (G-10, экстремофилы)
      if ((p.temperature < -20 || p.temperature > 80) && life !== 'none') {
        expect(life, `${p.name}: ${life} при T=${p.temperature}`).toBe('microbes');
      }
      // сложная/простая жизнь → standard/dense атмосфера (G-11, docs §2.5 усл.2)
      if (life === 'complex' || life === 'simple') {
        expect(p.atmosphere.type, `${p.name}: ${life} при ${p.atmosphere.type}`).toBeOneOf(['standard', 'dense']);
      }
      // консистентность полей
      if (life === 'none') {
        expect(p.life.biodiversity, `${p.name}: биоразнообразие без жизни`).toBe(0);
        expect(p.life.compatibleWithColonists, `${p.name}: совместимость без жизни`).toBe(false);
        expect(p.life.hazardLevel, `${p.name}: угроза без жизни`).toBe(0);
      } else {
        expect(p.life.biodiversity, `${p.name}: биоразнообразие ∈ [0,1]`).toBeGreaterThanOrEqual(0);
        expect(p.life.biodiversity, `${p.name}: биоразнообразие ∈ [0,1]`).toBeLessThanOrEqual(1);
        expect(p.life.hazardLevel, `${p.name}: угроза ∈ [0,3]`).toBeLessThanOrEqual(3);
      }
    }
    // санирование: жизнь реально генерируется (иначе тест вакуумный)
    expect(withLife).toBeGreaterThan(300);
  });
});

describe('Task 36 C2: гекс-сетки и слоты', () => {
  test('планеты: hexes.length = сетка размера (grids.json), ГГ = 0; ORE-POOLS — пулы без гекс-залежей', () => {
    for (const p of corpus.planets) {
      const expected = p.type === 'gas_giant' ? 0 : SIZE_HEX_COUNT[p.size];
      expect(p.hexes.length, `${p.name} (${p.size}): ${p.hexes.length} гексов ≠ ${expected}`).toBe(expected);
      // ORE-POOLS (docs/31 §10.4): пулы ⟺ есть поверхность (у ГГ коровых пулов нет);
      // пулы сгенерированы напрямую (remaining = initial), гекс-залежей не существует.
      expect(p.orePools.length > 0, `${p.name}: пулы при ${p.hexes.length} гексах`).toBe(p.hexes.length > 0);
      for (const pool of p.orePools) {
        expect(pool.remainingQuantity, `${p.name}/${pool.oreId}: remaining=initial при генерации`).toBe(pool.initialQuantity);
        expect(pool.availability, `${p.name}/${pool.oreId}: availability 0..1`).toBeGreaterThanOrEqual(0);
        expect(pool.availability, `${p.name}/${pool.oreId}: availability 0..1 (верх)`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('луны: малые сетки 7/19 (grids.json); планетарные пулы сгенерированы', () => {
    for (const m of corpus.moons) {
      const expected = MOON_SIZE_HEX_COUNT[m.size];
      expect(expected, `луна ${m.id}: размер ${m.size} — малая сетка`).toBeDefined();
      expect(m.hexes.length, `луна ${m.id} (${m.size}): ${m.hexes.length} ≠ ${expected}`).toBe(expected!);
      expect(m.orePools.length > 0, `луна ${m.id}: пулы сгенерированы`).toBe(true);
    }
  });

  test('слоты: атмосферные только у ГГ (6–12); орбитальные по размеру / 6–12 у ГГ', () => {
    for (const p of corpus.planets) {
      if (p.type === 'gas_giant') {
        expect(p.atmosphericSlots.length, `${p.name}: атмосферные слоты ГГ`).toBeGreaterThanOrEqual(GAS_GIANT_ATMOSPHERE_SLOTS.min);
        expect(p.atmosphericSlots.length, `${p.name}: атмосферные слоты ГГ`).toBeLessThanOrEqual(GAS_GIANT_ATMOSPHERE_SLOTS.max);
        expect(p.orbitSlots.length, `${p.name}: орбитальные слоты ГГ`).toBeGreaterThanOrEqual(ORBIT_SLOTS.gas_giant.min);
        expect(p.orbitSlots.length, `${p.name}: орбитальные слоты ГГ`).toBeLessThanOrEqual(ORBIT_SLOTS.gas_giant.max);
      } else {
        expect(p.atmosphericSlots.length, `${p.name}: атмосферные слоты не-ГГ`).toBe(0);
        expect(p.orbitSlots.length, `${p.name} (${p.size}): орбитальных ${p.orbitSlots.length} ≠ ${ORBIT_SLOTS_BY_SIZE[p.size]}`).toBe(ORBIT_SLOTS_BY_SIZE[p.size]);
      }
      for (const s of [...p.atmosphericSlots, ...p.orbitSlots]) {
        expect(s.buildingId, `${p.name}: слот занят при генерации`).toBeNull();
        expect(s.buildingLevel, `${p.name}: уровень слота при генерации`).toBe(0);
      }
    }
  });
});

describe('Task 36 C2: луны газовых гигантов', () => {
  test('только у ГГ; количество 2–7; параметры в диапазонах каталога', () => {
    let gasGiants = 0;
    for (const p of corpus.planets) {
      if (p.type === 'gas_giant') {
        gasGiants++;
        expect(p.moons.length, `${p.name}: лун ${p.moons.length}`).toBeGreaterThanOrEqual(GAS_GIANT_MOON_COUNT.min);
        expect(p.moons.length, `${p.name}: лун ${p.moons.length}`).toBeLessThanOrEqual(GAS_GIANT_MOON_COUNT.max);
      } else {
        expect(p.moons.length, `${p.name}: луны у не-газового гиганта`).toBe(0);
      }
    }
    expect(gasGiants).toBeGreaterThan(500);
    for (const m of corpus.moons) {
      expect(m.type, `луна ${m.id}: тип ${m.type}`).toBeOneOf(['rocky', 'ice', 'dwarf']);
      expect(m.radiusKm, `луна ${m.id}: R=${m.radiusKm}`).toBeGreaterThanOrEqual(MOON_RADIUS.min);
      expect(m.radiusKm, `луна ${m.id}: R=${m.radiusKm}`).toBeLessThanOrEqual(MOON_RADIUS.max);
      const dr = MOON_DENSITY[m.type as keyof typeof MOON_DENSITY]!;
      expect(m.density, `луна ${m.id} (${m.type}): ρ=${m.density} ∉ [${dr.min}, ${dr.max}]`).toBeGreaterThanOrEqual(dr.min - 0.05);
      expect(m.density, `луна ${m.id} (${m.type}): ρ=${m.density} ∉ [${dr.min}, ${dr.max}]`).toBeLessThanOrEqual(dr.max + 0.05);
      expect(m.gravity, `луна ${m.id}: g=${m.gravity}`).toBeGreaterThan(0);
      expect(m.orbitRadiusKm, `луна ${m.id}: a=${m.orbitRadiusKm}`).toBeGreaterThanOrEqual(MOON_ORBIT_RADIUS_KM.min);
      expect(m.orbitRadiusKm, `луна ${m.id}: a=${m.orbitRadiusKm}`).toBeLessThanOrEqual(MOON_ORBIT_RADIUS_KM.max);
      expect(Number.isFinite(m.orbitPeriodDays), `луна ${m.id}: период`).toBe(true);
      // размер ⟺ радиус (0.15 R⊕), с допуском округления radiusKm до целых
      const nearBoundary = Math.abs(m.radiusKm - MOON_TINY_BOUNDARY_KM) <= RADIUS_ROUNDING_KM;
      if (!nearBoundary) {
        expect(m.size, `луна ${m.id}: R=${m.radiusKm} → ${m.radiusKm < MOON_TINY_BOUNDARY_KM ? 'tiny' : 'small'}, а не ${m.size}`)
          .toBe(m.radiusKm < MOON_TINY_BOUNDARY_KM ? 'tiny' : 'small');
      }
    }
  });

  test('орбиты лун строго монотонны (радиус и период), как у планет', () => {
    for (const p of corpus.planets) {
      for (let i = 1; i < p.moons.length; i++) {
        const prev = p.moons[i - 1]!;
        const cur = p.moons[i]!;
        expect(cur.orbitRadiusKm, `${p.name}: луны ${i}/${i + 1}: a ${prev.orbitRadiusKm} → ${cur.orbitRadiusKm}`).toBeGreaterThan(prev.orbitRadiusKm);
        expect(cur.orbitPeriodDays, `${p.name}: луны ${i}/${i + 1}: P ${prev.orbitPeriodDays} → ${cur.orbitPeriodDays}`).toBeGreaterThan(prev.orbitPeriodDays);
      }
    }
  });
});

describe('Task 36 C2: идентификаторы, ссылки, структура систем', () => {
  test('ID систем/звёзд/планет/лун уникальны в каждой галактике; ссылки корректны; orbitNumber 1..n', () => {
    for (const g of corpus.galaxies) {
      const sysIds = new Set<string>();
      const starIds = new Set<string>();
      const planetIds = new Set<string>();
      const moonIds = new Set<string>();
      const sysNames = new Set<string>();
      for (const sys of g.systems) {
        expect(sysIds.has(sys.id), `дубль ID системы ${sys.id}`).toBe(false);
        sysIds.add(sys.id);
        expect(sysNames.has(sys.name), `дубль имени системы ${sys.name}`).toBe(false);
        sysNames.add(sys.name);
        for (const st of sys.stars) {
          expect(st.systemId, `звезда ${st.id}: systemId`).toBe(sys.id);
          expect(starIds.has(st.id), `дубль ID звезды ${st.id}`).toBe(false);
          starIds.add(st.id);
        }
        // orbitNumber — подряд 1..n (generate-systems: i+1)
        expect(sys.planets.map(p => p.orbitNumber).sort((a, b) => a - b))
          .toEqual(sys.planets.map((_, i) => i + 1));
        for (const p of sys.planets) {
          expect(p.systemId, `планета ${p.id}: systemId`).toBe(sys.id);
          expect(planetIds.has(p.id), `дубль ID планеты ${p.id}`).toBe(false);
          planetIds.add(p.id);
          // число планет ≤ потолок каталога первички (stability ≤ 1)
          const maxPlanets = STAR_TYPE_MAP.get(sys.stars[0]!.type)!.maxPlanets;
          expect(sys.planets.length, `${sys.name}: планет ${sys.planets.length} > maxPlanets(${maxPlanets}) ${sys.stars[0]!.type}`).toBeLessThanOrEqual(maxPlanets);
          for (const m of p.moons) {
            expect(m.planetId, `луна ${m.id}: planetId`).toBe(p.id);
            expect(m.systemId, `луна ${m.id}: systemId`).toBe(sys.id);
            expect(moonIds.has(m.id), `дубль ID луны ${m.id}`).toBe(false);
            moonIds.add(m.id);
          }
        }
      }
    }
  });
});

describe('Task 36 C2: распределения (грубая сверка с каталогами)', () => {
  test('ПЕРВИЧНЫЕ звёзды — доли соответствуют weights каталога (5σ)', () => {
    // Компаньоны исключены: G-12 выбирает их правилом «тот же класс или на 1
    // ниже», что смещает маргинальное распределение по дизайну.
    const totalWeight = STAR_WEIGHTS.reduce((a, b) => a + b, 0);
    const n = corpus.primaryStarTypes.length;
    expect(n).toBe(SEEDS * SYSTEMS);
    const counts = new Map<string, number>();
    for (const t of corpus.primaryStarTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const def of STAR_TYPES) {
      const p = def.weight / totalWeight;
      const expected = n * p;
      const observed = counts.get(def.type) ?? 0;
      const sigma = Math.sqrt(Math.max(expected, 1) * (1 - p));
      const slack = Math.max(5 * sigma, 2);
      expect(Math.abs(observed - expected),
        `${def.type}: obs=${observed}, exp=${expected.toFixed(1)} (5σ=${slack.toFixed(1)})`)
        .toBeLessThanOrEqual(slack);
    }
  });

  test('типы планет: все 7 представлены (≥3% каждый)', () => {
    const counts = new Map<string, number>();
    for (const p of corpus.planets) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    expect(counts.size).toBe(7);
    for (const [type, count] of counts) {
      expect(count / corpus.planets.length,
        `${type}: ${(100 * count / corpus.planets.length).toFixed(1)}% — вырожденное распределение`)
        .toBeGreaterThanOrEqual(0.03);
    }
  });
});
