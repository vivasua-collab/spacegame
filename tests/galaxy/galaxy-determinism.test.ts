/// <reference types="bun-types" />
/**
 * Task 35 (B1): детерминизм и локальность этапов генерации галактики.
 *
 * Контракт docs/10-galaxy.md §1.2:
 *   - Воспроизводимость: один и тот же seed + параметры → идентичная галактика.
 *   - Пошаговая генерация: каждый этап использует свой под-seed
 *     (хеш seed + идентификатор этапа).
 *   - Локальность изменений: изменение параметров одного этапа не влияет
 *     на другие этапы (если основной seed не изменён).
 *
 * Дополнительно (дефекты, найденные аудитом Task 35):
 *   - nextGaussian при u1 === 0 возвращал ±Infinity (Box-Muller log(0));
 *   - инициализация splitMix64 в float64 схлопывала seed-пространство:
 *     блоки до 4096 подряд идущих seed давали ИДЕНТИЧНОЕ состояние PRNG
 *     (эмпирически: seed ∈ [0, 1e6) → всего 64 уникальных состояний;
 *     seed 7 и seed 42 порождали побайтно одну и ту же галактику).
 *
 * Run: bun test tests/galaxy/galaxy-determinism.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { Xoshiro128StarStar } from '@/core/prng';
import { generateGalaxy, DEFAULT_CONFIG } from '@/galaxy';
import type { GalaxyGenConfig } from '@/galaxy';
import { generateSpiralPositions } from '@/galaxy/generate-positions';

/** Конфиг позиции для прямого вызова generateSpiralPositions (зеркало generator.ts). */
function positionsFor(seed: number, over: Partial<GalaxyGenConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...over };
  const main = new Xoshiro128StarStar(seed);
  const pos = generateSpiralPositions(
    cfg,
    main.derive('arms'),
    main.derive('bulge'),
    main.derive('disk'),
    main.derive('halo'),
  );
  return { pos, cfg };
}

/** Канонический JSON галактики (как в tests/galaxy-snapshot.test.ts). */
function galaxyJSON(g: ReturnType<typeof generateGalaxy>): string {
  const { systemMap: _sm, bakedModel: _bm, ...rest } = g;
  return JSON.stringify(rest);
}

describe('Task 35 B1: детерминизм generateGalaxy', () => {
  const SEEDS = [1, 42, 12345, 999983, 2147483647];
  const CONFIGS: Array<Partial<GalaxyGenConfig>> = [
    { systemCount: 50 },                                  // нестандартный маленький
    { systemCount: 137, radius: 15000 },                  // нестандартные count+radius
    { systemCount: 7 },                                   // граничный (меньше «быстрого старта»)
    { systemCount: 200, arms: 5, armTwist: 1.2, bulgeDensity: 2.5, diskFraction: 0.3, haloFraction: 0.1 },
  ];

  // 40 генераций (планеты — доминанта, ~3.7 мс/система): ~15 с на этой
  // машине → явный таймаут (базовый bun-таймаут 5 с недостаточен).
  test('1. 5 seed × 4 конфига: два вызова с одинаковым seed+config → идентичный результат', () => {
    for (const seed of SEEDS) {
      for (const cfg of CONFIGS) {
        const a = generateGalaxy({ ...cfg, seed });
        const b = generateGalaxy({ ...cfg, seed });
        expect(galaxyJSON(a)).toBe(galaxyJSON(b));
      }
    }
  }, 60_000);

  test('2. Интерливинг генераций не протекает (нет глобального состояния между вызовами)', () => {
    const first = generateGalaxy({ seed: 42, systemCount: 60 });
    // Две «чужие» генерации между двумя идентичными вызовами:
    // gen-context (genId/usedNames) и setCurrentLookups должны сбрасываться.
    generateGalaxy({ seed: 7, systemCount: 80 });
    generateGalaxy({ seed: 999, systemCount: 30 });
    const second = generateGalaxy({ seed: 42, systemCount: 60 });
    expect(galaxyJSON(first)).toBe(galaxyJSON(second));
  });

  test('3. Позиции: тот же seed → идентичные позиции (прямой вызов модуля)', () => {
    const a = positionsFor(123).pos;
    const b = positionsFor(123).pos;
    expect(a).toEqual(b);
  });
});

describe('Task 35 B1: локальность этапов (docs §1.2 «локальность изменений»)', () => {
  test('4. Изменение параметров рукавов не меняет срезы ядра/диска/ореола', () => {
    const base = positionsFor(42);
    const varied = positionsFor(42, { armTwist: 1.2, armWidth: 1.0, spread: 0.8, arms: 5 });

    const haloCount = Math.floor(base.cfg.systemCount * base.cfg.haloFraction);
    const bulgeCount = Math.floor(base.cfg.systemCount * 0.15 * (base.cfg.bulgeDensity / 1.5));
    const diskCount = Math.floor(base.cfg.systemCount * base.cfg.diskFraction);

    // Срезы ядра/диска/орела берутся из СВОИХ под-seed потоков (bulge/disk/halo),
    // поэтому параметры рукавов на них не влияют.
    expect(varied.pos.slice(0, bulgeCount)).toEqual(base.pos.slice(0, bulgeCount));
    expect(varied.pos.slice(bulgeCount, bulgeCount + diskCount))
      .toEqual(base.pos.slice(bulgeCount, bulgeCount + diskCount));
    expect(varied.pos.slice(varied.pos.length - haloCount))
      .toEqual(base.pos.slice(base.pos.length - haloCount));
  });

  test('5. Изменение доли диска и плотности ядра не меняет срез ядра и первые точки рукавов', () => {
    const base = positionsFor(42);
    const variedDisk = positionsFor(42, { diskFraction: 0.35 });
    const variedBulge = positionsFor(42, { bulgeDensity: 3.0 });

    const bulgeCount = Math.floor(base.cfg.systemCount * 0.15 * (base.cfg.bulgeDensity / 1.5));
    const baseDisk = Math.floor(base.cfg.systemCount * base.cfg.diskFraction);
    const variedDiskCount = Math.floor(variedDisk.cfg.systemCount * variedDisk.cfg.diskFraction);
    const variedBulgeCount = Math.floor(variedBulge.cfg.systemCount * 0.15 * (variedBulge.cfg.bulgeDensity / 1.5));

    // Ядро — свой поток, не тронут (префикс среза ядра совпадает даже при
    // другой доле ядра: bulgeRng — отдельный поток, меняется только длина).
    expect(variedDisk.pos.slice(0, bulgeCount)).toEqual(base.pos.slice(0, bulgeCount));
    expect(variedBulge.pos.slice(0, bulgeCount)).toEqual(base.pos.slice(0, bulgeCount));
    // Поток рукавов не перемотан: первые 10 точек рукавов совпадают
    // (armRng потребляется одинаково на точку).
    const firstArms = base.pos.slice(bulgeCount + baseDisk, bulgeCount + baseDisk + 10);
    expect(variedDisk.pos.slice(bulgeCount + variedDiskCount, bulgeCount + variedDiskCount + 10))
      .toEqual(firstArms);
    expect(variedBulge.pos.slice(variedBulgeCount + baseDisk, variedBulgeCount + baseDisk + 10))
      .toEqual(firstArms);
  });

  test('6. Содержимое систем не зависит от позиционных параметров (system_i — свой под-seed)', () => {
    const a = generateGalaxy({ seed: 42, systemCount: 60, radius: 25000 });
    const b = generateGalaxy({ seed: 42, systemCount: 60, radius: 12000, armTwist: 1.0, haloFraction: 0.1 });
    expect(a.systems.length).toBe(b.systems.length);
    for (let i = 0; i < a.systems.length; i++) {
      expect(a.systems[i]!.name).toBe(b.systems[i]!.name);
      expect(a.systems[i]!.stars.map(s => s.type)).toEqual(b.systems[i]!.stars.map(s => s.type));
    }
  });
});

describe('Task 35 B1: PRNG (xoshiro128**, канонический с R-35)', () => {
  test('7. nextGaussian: u1 === 0 → конечный результат (guard Box-Muller log(0))', () => {
    // Состояние [s0, s1, s2, s3] с s1 = 0 → первый nextU32() = rotl(0*5,7)*9 = 0
    // → nextFloat() = 0 → u1 = 0. ДО фикса: log(0) = -Infinity → nextGaussian = ±Infinity.
    const rng = Xoshiro128StarStar.fromState([1, 0, 0, 0]);
    expect(rng.nextFloat()).toBe(0); // sanity: действительно попали в грань
    const rng2 = Xoshiro128StarStar.fromState([1, 0, 0, 0]);
    const g = rng2.nextGaussian();
    expect(Number.isFinite(g)).toBe(true);
  });

  test('8. Разные seed → разные состояния PRNG (нет коллизий seed-блоков)', () => {
    // ДО фикса splitMix64: seed 0..1024 — одно состояние; [0,1e6) → 64 состояния.
    const pairs: Array<[number, number]> = [[1, 2], [41, 42], [999, 1000], [7, 42], [12345, 12346]];
    for (const [a, b] of pairs) {
      expect(new Xoshiro128StarStar(a).nextU32()).not.toBe(new Xoshiro128StarStar(b).nextU32());
    }
    // Плотная проверка: 2001 подряд идущих seed — все состояния уникальны.
    const seen = new Set<number>();
    for (let s = 0; s <= 2000; s++) seen.add(new Xoshiro128StarStar(s).nextU32());
    expect(seen.size).toBe(2001);
  });

  test('9. Разные seed → разные галактики (positions отличаются)', () => {
    const a = positionsFor(7).pos;
    const b = positionsFor(42).pos;
    // ДО фикса: seed 7 и seed 42 лежали в одном блоке коллизий → позиции идентичны.
    expect(a).not.toEqual(b);
  });
});
