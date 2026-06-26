/**
 * Генерация позиций звёздных систем в спиральной структуре галактики.
 *
 * G-05/G-14 fix: Распределение по спецификации §1.1:
 * - Bulge (ядро): ~15%
 * - Disk (межрукавное пространство): ~20%
 * - Arms (спиральные рукава): ~60%
 * - Halo (ореол): ~5%
 */

import type { Vec2 } from '@/core/types';
import type { Xoshiro256 } from '@/core/prng';

export interface PositionsConfig {
  systemCount: number;
  radius: number;
  arms: number;
  spread: number;
  armWidth: number;
  armTwist: number;
  haloFraction: number;
}

/**
 * Генерация позиций систем в спиральной структуре.
 * Возвращает массив Vec2 координат (в парсеках).
 */
export function generateSpiralPositions(
  cfg: PositionsConfig,
  armRng: Xoshiro256,
  bulgeRng: Xoshiro256,
  diskRng: Xoshiro256,
  haloRng: Xoshiro256,
): Vec2[] {
  const positions: Vec2[] = [];
  const armAngleStep = (2 * Math.PI) / cfg.arms;

  // G-05/G-14 fix: Распределение систем строго по спецификации §1.1
  const bulgeFraction = 0.15;
  const diskFraction = 0.20;
  // armFraction = 0.60 (остаток)
  // haloFraction = 0.05 (from config)

  const haloCount = Math.floor(cfg.systemCount * cfg.haloFraction);
  const bulgeCount = Math.floor(cfg.systemCount * bulgeFraction);
  const diskCount = Math.floor(cfg.systemCount * diskFraction);
  const armCount = cfg.systemCount - bulgeCount - diskCount - haloCount;

  // Ядро (bulge) — ~15%
  for (let i = 0; i < bulgeCount; i++) {
    const angle = bulgeRng.nextFloat() * Math.PI * 2;
    const dist = bulgeRng.nextFloat() * cfg.radius * 0.1;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  // Диск (inter-arm space) — ~20%
  // Uniform random positions within the galaxy radius, NOT along arms
  for (let i = 0; i < diskCount; i++) {
    const angle = diskRng.nextFloat() * Math.PI * 2;
    const dist = diskRng.nextFloat() * cfg.radius;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  // Спиральные рукава — ~60%
  for (let i = 0; i < armCount; i++) {
    const arm = armRng.nextInt(0, cfg.arms - 1);
    const armAngle = arm * armAngleStep;
    const dist = armRng.nextFloat() * cfg.radius;
    const spiralAngle = armAngle + (dist / cfg.radius) * Math.PI * cfg.armTwist * 2;
    const spread = armRng.nextGaussian(0, cfg.spread * cfg.radius * cfg.armWidth * 0.3);

    const angle = spiralAngle + (spread / cfg.radius);
    const r = dist + armRng.nextGaussian(0, cfg.radius * 0.05);

    positions.push({
      x: Math.cos(angle) * Math.max(0, r),
      y: Math.sin(angle) * Math.max(0, r),
    });
  }

  // Ореол (halo) — ~5%
  for (let i = 0; i < haloCount; i++) {
    const angle = haloRng.nextFloat() * Math.PI * 2;
    const dist = haloRng.nextFloat() * cfg.radius;
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  return positions;
}
