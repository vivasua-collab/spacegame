/**
 * ОРКЕСТРАТОР генерации галактики.
 *
 * Координирует 5 модулей:
 * 1. generate-positions — позиции систем в спиральной структуре
 * 2. generate-systems — звёзды, компаньоны, имена
 * 3. generate-planets — планеты (тип, атмосфера, температура, жизнь, ресурсы)
 * 4. generate-resources — ресурсные залежи
 * 5. generate-jump-points — Jump Points + связность
 *
 * Схема генерации:
 * 1. Задаётся количество звёзд (systemCount)
 * 2. Генерируются позиции согласно схеме галактики (ядро/рукава/диск/ореол)
 * 3. Для каждой позиции — генерация системы
 * 4. Генерация Jump Points
 * 5. Проверка связности
 */

import { Xoshiro256 } from '@/core/prng';
import type { Galaxy, StarSystem, EntityId } from '@/core/types';
import { resetGenContext, genId } from './gen-context';
import { generateSpiralPositions, type PositionsConfig } from './generate-positions';
import { generateSystem } from './generate-systems';
import { generateJumpPoints, ensureConnectivity, type JumpPointsConfig } from './generate-jump-points';
import { bakeGalaxyModel } from '@/data/chemistry-generator';
import { ELEMENTS } from '@/data/elements';
import { setCurrentLookups } from '@/data/baked-lookups';

// ============ Конфигурация ============

/** Настройки генерации галактики */
export interface GalaxyGenConfig {
  seed: number;
  systemCount: number;
  /** Радиус галактики в парсеках */
  radius: number;
  /** Количество спиральных рукавов */
  arms: number;
  /** Разброс от спиральной линии (0-1) */
  spread: number;
  /** Плотность ядра */
  bulgeDensity: number;
  /** Ширина рукава */
  armWidth: number;
  /** Закрутка рукава */
  armTwist: number;
  /** Доля диска */
  diskFraction: number;
  /** Доля ореола */
  haloFraction: number;
  /** Максимальное расстояние для JP (парсек) */
  maxJumpDistance: number;
  /** Максимальное количество JP на систему */
  maxJumpPointsPerSystem: number;
}

export const DEFAULT_CONFIG: GalaxyGenConfig = {
  seed: 42,
  systemCount: 500,
  radius: 25000,
  arms: 4,
  spread: 0.4,
  bulgeDensity: 1.5,
  armWidth: 0.5,
  armTwist: 0.6,
  diskFraction: 0.2,
  haloFraction: 0.05,
  maxJumpDistance: 5000,
  maxJumpPointsPerSystem: 6,
};

// ============ Оркестратор ============

/** Генерация галактики — главная точка входа */
export function generateGalaxy(config: Partial<GalaxyGenConfig> = {}): Galaxy {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const mainRng = new Xoshiro256(cfg.seed);

  // Сброс контекста для воспроизводимости
  resetGenContext();

  // P1-29: именованные под-seed'ы
  const armRng = mainRng.derive('arms');
  const bulgeRng = mainRng.derive('bulge');
  const diskRng = mainRng.derive('disk');
  const haloRng = mainRng.derive('halo');
  const jpRng = mainRng.derive('jump_points');

  const systems: StarSystem[] = [];
  const systemMap = new Map<EntityId, StarSystem>();

  // 1. Генерация позиций
  const positions = generateSpiralPositions(cfg, armRng, bulgeRng, diskRng, haloRng);

  // 2. Генерация систем
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const systemRng = mainRng.derive(`system_${i}`);
    const system = generateSystem(pos, i, systemRng, cfg);
    systems.push(system);
    systemMap.set(system.id, system);
  }

  // 3. Jump Points
  generateJumpPoints(systems, jpRng, cfg);

  // 4. Связность
  ensureConnectivity(systems, jpRng, cfg);

  // 5. Запекание модели химии (BakedGalaxyModel)
  const bakedModel = bakeGalaxyModel(cfg.seed, ELEMENTS);
  setCurrentLookups(bakedModel);

  // 6. Стартовая система открыта
  if (systems.length > 0) {
    systems[0].discovered = true;
  }

  return {
    id: genId('galaxy'),
    seed: cfg.seed,
    systems,
    systemMap,
    bakedModel,
  };
}
