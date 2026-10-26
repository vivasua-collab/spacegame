/// <reference types="bun-types" />
/**
 * Task 35 (B2, находка G-03): распределение позиций звёздных систем.
 *
 * Контракт docs/10-galaxy.md §1.1 (модель спиральной галактики):
 *   п.4. Ядро — 2D-гауссиана с центром (0, 0), σ = bulge_radius.
 *   п.5. Диск — равномерное распределение в пределах galaxy_radius
 *        (по ПЛОЩАДИ: r = R·sqrt(U), а не r = U·R).
 *   п.6. Ореол — редкие точки ЗА пределами основного диска,
 *        сгруппированные в глобулярные скопления.
 *   §1.1 таблица: ядро ~15%, рукава ~60%, диск ~20%, ореол ~5%
 *   (при умолчаниях §1.3: bulgeDensity=1.5, diskFraction=0.2, haloFraction=0.05).
 *
 * ДО фикса (аудит Task 35): доли ядра/диска были захардкожены (0.15/0.20),
 * параметры bulgeDensity/diskFraction игнорировались; радиус диска U·R
 * давал сгущение к центру; ореол размещался ВНУТРИ того же радиуса без
 * кластеризации; arms=0 давал NaN-координаты.
 *
 * Run: bun test tests/galaxy/galaxy-positions.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { Xoshiro128StarStar } from '@/core/prng';
import { generateSpiralPositions, computeComponentCounts } from '@/galaxy/generate-positions';
import { DEFAULT_CONFIG } from '@/galaxy';
import type { GalaxyGenConfig } from '@/galaxy';
import type { Vec2 } from '@/core/types';

/** Позиции для seed+оверрайда (зеркало цепочки generator.ts). */
function positionsFor(seed: number, over: Partial<GalaxyGenConfig> = {}): Vec2[] {
  const cfg = { ...DEFAULT_CONFIG, ...over };
  const main = new Xoshiro128StarStar(seed);
  return generateSpiralPositions(
    cfg,
    main.derive('arms'),
    main.derive('bulge'),
    main.derive('disk'),
    main.derive('halo'),
  );
}

const R = DEFAULT_CONFIG.radius; // 25000 пк

describe('Task 35 B2: количество и конечность', () => {
  test('1. Итоговое число позиций = systemCount (включая граничные и вне-диапазонные доли)', () => {
    const counts = [0, 1, 2, 5, 7, 13, 137, 500];
    for (const systemCount of counts) {
      expect(positionsFor(42, { systemCount })).toHaveLength(systemCount);
    }
    // Вне-диапазонные доли (docs §1.3: disk 0.1–0.4, halo 0–0.15, bulgeDensity 0.5–3.0):
    // сумма не-рукавных долей нормализуется, рукава получают остаток ≥ 0.
    expect(positionsFor(42, { systemCount: 500, diskFraction: 0.9 })).toHaveLength(500);
    expect(positionsFor(42, { systemCount: 500, bulgeDensity: 10 })).toHaveLength(500);
    expect(positionsFor(42, { systemCount: 500, haloFraction: 0.9 })).toHaveLength(500);
    expect(positionsFor(42, { systemCount: 500, diskFraction: 0.9, bulgeDensity: 10, haloFraction: 0.9 })).toHaveLength(500);
  });

  test('2. Все координаты конечны на граничных параметрах', () => {
    const edgeOverrides: Array<Partial<GalaxyGenConfig>> = [
      { arms: 0 },          // ДО фикса: armAngleStep = 2π/0 = Infinity → NaN
      { arms: 1 },
      { arms: 6 },
      { radius: 1 },
      { radius: 0 },
      { armWidth: 0 },
      { armTwist: 0 },
      { spread: 0 },
      { haloFraction: 0 },
      { bulgeDensity: 0 },
      { bulgeRadius: 0 },
      { diskFraction: 0 },
    ];
    for (const over of edgeOverrides) {
      const pos = positionsFor(42, { systemCount: 200, ...over });
      expect(pos).toHaveLength(200);
      for (const p of pos) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});

describe('Task 35 B2: доли компонентов из параметров конфига (G-03)', () => {
  test('3. computeComponentCounts: умолчания → 15% ядро / 20% диск / 60% рукава / 5% ореол', () => {
    const c = computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500 });
    expect(c.bulgeCount).toBe(75);
    expect(c.diskCount).toBe(100);
    expect(c.armCount).toBe(300);
    expect(c.haloCount).toBe(25);
  });

  test('4. bulgeDensity влияет на долю ядра (docs §1.3: множитель относительно нормы 1.5)', () => {
    // 1.5 → 15%; 3.0 → 30%; 0.5 → 5%.
    expect(computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, bulgeDensity: 3.0 }).bulgeCount).toBe(150);
    expect(computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, bulgeDensity: 0.5 }).bulgeCount).toBe(25);
    // Рукава получают остаток.
    expect(computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, bulgeDensity: 3.0 }).armCount).toBe(225);
  });

  test('5. diskFraction и haloFraction влияют на свои доли', () => {
    expect(computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, diskFraction: 0.4 }).diskCount).toBe(200);
    expect(computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, haloFraction: 0.15 }).haloCount).toBe(75);
    expect(computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, haloFraction: 0 }).haloCount).toBe(0);
  });

  test('6. Экстремальные доли нормализуются: рукава ≥ 5% systemCount', () => {
    const c = computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 500, diskFraction: 0.9, bulgeDensity: 10, haloFraction: 0.9 });
    expect(c.bulgeCount + c.diskCount + c.armCount + c.haloCount).toBe(500);
    expect(c.armCount).toBeGreaterThanOrEqual(Math.floor(500 * 0.05));
  });

  test('7. Каждый параметр реально влияет на позиции (регрессия G-03: bulgeDensity/diskFraction игнорировались)', () => {
    const base = positionsFor(42, { systemCount: 200 });
    const variants: Array<[string, Partial<GalaxyGenConfig>]> = [
      ['bulgeDensity', { bulgeDensity: 3.0 }],
      ['diskFraction', { diskFraction: 0.4 }],
      ['haloFraction', { haloFraction: 0.15 }],
      ['radius', { radius: 15000 }],
      ['arms', { arms: 5 }],
      ['armWidth', { armWidth: 1.0 }],
      ['armTwist', { armTwist: 1.2 }],
      ['spread', { spread: 0.8 }],
    ];
    for (const [label, over] of variants) {
      const v = positionsFor(42, { systemCount: 200, ...over });
      expect(v).toHaveLength(200);
      let diff = 0;
      for (let i = 0; i < 200; i++) {
        if (v[i]!.x !== base[i]!.x || v[i]!.y !== base[i]!.y) diff++;
      }
      // До фикса bulgeDensity и diskFraction давали diff = 0.
      expect(diff, `параметр ${label} должен влиять на позиции`).toBeGreaterThan(0);
    }
  });
});

describe('Task 35 B2: форма распределений (docs §1.1)', () => {
  const SEEDS = 40;

  /** Срез позиций по компоненту (порядок генерации: ядро, диск, рукава, ореол). */
  function sliceFor(seed: number, component: 'bulge' | 'disk' | 'halo'): Vec2[] {
    const cfg = { ...DEFAULT_CONFIG };
    const counts = computeComponentCounts({ ...cfg, systemCount: cfg.systemCount });
    const pos = positionsFor(seed);
    if (component === 'bulge') return pos.slice(0, counts.bulgeCount);
    if (component === 'disk') return pos.slice(counts.bulgeCount, counts.bulgeCount + counts.diskCount);
    return pos.slice(pos.length - counts.haloCount);
  }

  test('8. Ядро — 2D-гауссиана σ=bulgeRadius: P(r≤σ)≈0.393, P(r≤2σ)≈0.865 (Рэлей)', () => {
    const sigma = DEFAULT_CONFIG.bulgeRadius; // 3000 пк
    let within1 = 0, within2 = 0, total = 0;
    for (let s = 1; s <= SEEDS; s++) {
      for (const p of sliceFor(s, 'bulge')) {
        const r = Math.hypot(p.x, p.y);
        if (r <= sigma) within1++;
        if (r <= 2 * sigma) within2++;
        total++;
      }
    }
    expect(total).toBe(SEEDS * 75);
    // Биномиальные допуски (n=3000, σ≈0.9%): ±3σ с запасом.
    expect(within1 / total).toBeGreaterThan(0.35);
    expect(within1 / total).toBeLessThan(0.44);
    expect(within2 / total).toBeGreaterThan(0.83);
    expect(within2 / total).toBeLessThan(0.90);
  });

  test('9. Диск — равномерность ПО ПЛОЩАДИ: доли колец ∝ (r₂²−r₁²)', () => {
    const RINGS = 10;
    const ringCounts = new Array(RINGS).fill(0);
    let total = 0;
    for (let s = 1; s <= SEEDS; s++) {
      for (const p of sliceFor(s, 'disk')) {
        const r = Math.hypot(p.x, p.y);
        const ring = Math.min(RINGS - 1, Math.floor((r / R) * RINGS));
        ringCounts[ring]++;
        total++;
      }
    }
    expect(total).toBe(SEEDS * 100);
    // Для равномерной площади доля кольца i = ((i+1)²−i²)/100.
    // ДО фикса (r = U·R) кольца давали ~0.10 flat — внешние кольца
    // завышались в ~1.9 раза.
    for (let i = 0; i < RINGS; i++) {
      const expected = ((i + 1) ** 2 - i ** 2) / (RINGS * RINGS);
      expect(ringCounts[i]! / total).toBeGreaterThan(expected - 0.03);
      expect(ringCounts[i]! / total).toBeLessThan(expected + 0.03);
    }
  });

  test('10. Ореол — ЗА пределами диска, глобулярные скопления', () => {
    let beyond = 0, clustered = 0, total = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const halo = sliceFor(s, 'halo');
      expect(halo).toHaveLength(25); // 5% от 500
      for (const p of halo) {
        const r = Math.hypot(p.x, p.y);
        if (r > R) beyond++;
        // Кластерность: есть сосед в том же скоплении ближе 0.15R.
        const hasMate = halo.some(q => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 0.15 * R);
        if (hasMate) clustered++;
        total++;
      }
    }
    // ДО фикса ореол был равномерен ВНУТРИ радиуса (beyond = 0).
    expect(beyond).toBe(total);
    // ≥ 75% точек ореола имеют соседа в своём скоплении (для равномерного
    // распределения по кольцу эта доля была бы ~35%).
    expect(clustered / total).toBeGreaterThan(0.75);
  });

  test('11. haloFraction=0 → точек ореола нет', () => {
    const cfg = { ...DEFAULT_CONFIG, systemCount: 200, haloFraction: 0 };
    const pos = positionsFor(42, { systemCount: 200, haloFraction: 0 });
    const counts = computeComponentCounts(cfg);
    expect(counts.haloCount).toBe(0);
    expect(pos).toHaveLength(200);
    // Ядро и диск (docs §1.1 п.4-5) — строго в пределах galaxy_radius.
    // (Рукава могут выступать за радиус до ~15% — радиальный гауссов
    // разброс 0.05R — осознанное отклонение G-20, см. отчёт Task 35.)
    const diskSlice = pos.slice(counts.bulgeCount, counts.bulgeCount + counts.diskCount);
    const bulgeSlice = pos.slice(0, counts.bulgeCount);
    for (const p of [...bulgeSlice, ...diskSlice]) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(R);
    }
  });
});

describe('R-35 (P2 аудита этапа 2): нормализация некорректного radius/arms', () => {
  // Замечание аудитора: нормализованный в начале generateSpiralPositions
  // radius НЕ применялся в расчёте разброса рукавов (cfg.spread * cfg.radius *
  // cfg.armWidth) и радиального шума (cfg.radius * 0.05) — при NaN/Infinity
  // в cfg.radius координаты становились NaN/Infinity. R-35: все параметры
  // нормализуются один раз, дальше используются только нормализованные.

  /** Все координаты конечны (и не NaN). */
  function allFinite(pos: Vec2[]): boolean {
    return pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  test('1. Отрицательный radius → нормализация в 0, все координаты конечны', () => {
    for (const radius of [-1, -25000, -1e12]) {
      const pos = positionsFor(42, { systemCount: 200, radius });
      expect(pos).toHaveLength(200);
      expect(allFinite(pos), `radius=${radius}`).toBe(true);
    }
  });

  test('2. NaN radius → нормализация в 0, все координаты конечны', () => {
    const pos = positionsFor(42, { systemCount: 200, radius: Number.NaN });
    expect(pos).toHaveLength(200);
    // ДО R-35: spread = gauss(0, NaN·…) → NaN-углы у всех рукавных точек.
    expect(allFinite(pos)).toBe(true);
  });

  test('3. ±Infinity radius → нормализация в 0, все координаты конечны', () => {
    for (const radius of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const pos = positionsFor(42, { systemCount: 200, radius });
      expect(pos).toHaveLength(200);
      // ДО R-35: gauss(0, Infinity) → ±Infinity → cos/sin(Infinity) → NaN.
      expect(allFinite(pos), `radius=${radius}`).toBe(true);
    }
  });

  test('4. radius = 0 → вырожденная, но конечная генерация', () => {
    const pos = positionsFor(42, { systemCount: 200, radius: 0 });
    expect(pos).toHaveLength(200);
    expect(allFinite(pos)).toBe(true);
    // Рукава/диск при radius=0 стягиваются в начало координат
    // (dist = 0, r = 0); ядро независимо (σ = bulgeRadius).
    // Math.abs: cos(π)·0 = −0, а Object.is(−0, 0) === false.
    const counts = computeComponentCounts({ ...DEFAULT_CONFIG, systemCount: 200, radius: 0 });
    const armSlice = pos.slice(counts.bulgeCount + counts.diskCount, pos.length - counts.haloCount);
    for (const p of armSlice) {
      expect(Math.abs(p.x)).toBe(0);
      expect(Math.abs(p.y)).toBe(0);
    }
  });

  test('5. arms = 0 / NaN / дробное / отрицательное → guard ≥ 1, конечные координаты', () => {
    for (const arms of [0, Number.NaN, -3, 2.7]) {
      const pos = positionsFor(42, { systemCount: 200, arms });
      expect(pos).toHaveLength(200);
      expect(allFinite(pos), `arms=${arms}`).toBe(true);
    }
  });

  test('6. NaN в производных параметрах рукава (spread/armWidth/armTwist) → конечные координаты', () => {
    // R-35: нормализуются не только radius — spread/armWidth/armTwist тоже
    // (NaN → 0; armTwist — любое конечное, в т.ч. отрицательное).
    const combos: Array<Partial<GalaxyGenConfig>> = [
      { spread: Number.NaN },
      { armWidth: Number.NaN },
      { armTwist: Number.NaN },
      { spread: Number.POSITIVE_INFINITY, armWidth: Number.POSITIVE_INFINITY },
      { armTwist: -0.6 }, // отрицательная закрутка — легитимна (зеркальная спираль)
    ];
    for (const over of combos) {
      const pos = positionsFor(42, { systemCount: 200, ...over });
      expect(pos).toHaveLength(200);
      expect(allFinite(pos), JSON.stringify(over)).toBe(true);
    }
  });

  test('7. Нормализация используется: NaN radius ≡ radius 0 (та же карта, а не NaN)', () => {
    // Если бы защита не применялась, NaN-радиус дал бы NaN-координаты, а не
    // карту, совпадающую с radius=0. Сравниваем полные массивы позиций.
    const nanPos = positionsFor(77, { systemCount: 150, radius: Number.NaN });
    const zeroPos = positionsFor(77, { systemCount: 150, radius: 0 });
    expect(nanPos).toEqual(zeroPos);
  });

  test('8. R-36: arms = +Infinity / -Infinity → guard 1, КОНЕЧНЫЕ координаты', () => {
    // Прямое требование аудитора R-35 (дожим P2): прежняя форма
    // `Math.max(1, Math.floor(cfg.arms) || 1)` пропускала +Infinity:
    // floor(+Inf)=+Inf → armAngleStep = 2π/+Inf = 0, а nextInt(0, +Inf)
    // давал бесконечный индекс рукава → нечисловые координаты у рукавных
    // систем. Нормализация обязана гарантировать конечность на краях.
    for (const arms of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const pos = positionsFor(42, { systemCount: 300, arms });
      expect(pos).toHaveLength(300);
      expect(allFinite(pos), `arms=${String(arms)}`).toBe(true);
      // Эквивалентность arms=+Inf и arms=1 (нормализованный guard): та же
      // карта, а не частично-бесконечная.
      const onePos = positionsFor(42, { systemCount: 300, arms: 1 });
      expect(pos).toEqual(onePos);
    }
  });

  test('9. R-36: ОГРОМНОЕ конечное arms (1e9) → конечные координаты (нет переполнения nextInt)', () => {
    // Соседний край: floor(1e9) конечен, но nextInt(0, 1e9−1) легитимен —
    // координаты всё равно конечны (угол произвольный, но конечный).
    const pos = positionsFor(42, { systemCount: 200, arms: 1e9 });
    expect(pos).toHaveLength(200);
    expect(allFinite(pos)).toBe(true);
  });
});
