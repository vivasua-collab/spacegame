/**
 * Генерация позиций звёздных систем в спиральной структуре галактики.
 *
 * Модель по docs/10-galaxy.md §1.1 (Task 35, находка G-03 — исправление):
 * - Ядро (bulge): 2D-гауссиана с центром (0, 0), σ = bulgeRadius (§1.1 п.4,
 *   §5.1 #9). ДО фикса: равномерный диск радиуса 0.1·R без параметра.
 * - Диск: равномерное распределение ПО ПЛОЩАДИ в пределах galaxy_radius
 *   (§1.1 п.5): r = R·sqrt(U). ДО фикса: r = U·R → сгущение к центру
 *   (плотность ∝ 1/r, у центра вдвое выше средней по площади).
 * - Рукава: сохранена прежняя параметризация (радиус → угол; осознанное
 *   отклонение G-20 из docs/galaxy-generation-audit.md §11.2 — архимедова
 *   спираль вместо логарифмической, гауссово смещение по углу; см. отчёт
 *   Task 35, архитектурный вопрос).
 * - Ореол: редкие точки ЗА пределами основного диска, сгруппированные в
 *   глобулярные скопления (§1.1 п.6). ДО фикта: равномерно ВНУТРИ того же
 *   радиуса без кластеризации.
 *
 * Доли компонентов берутся из параметров конфига (§1.3): bulgeDensity,
 * diskFraction, haloFraction (ДО фикта bulge/disk были захардкожены
 * константами 0.15/0.20 и параметры игнорировались).
 */

import type { Vec2 } from '@/core/types';
import type { Xoshiro128StarStar } from '@/core/prng';

export interface PositionsConfig {
  systemCount: number;
  radius: number;
  arms: number;
  spread: number;
  /** Плотность ядра (§1.3: 0.5–3.0, умолчание 1.5) — множитель к ДОЛЕ ядра. */
  bulgeDensity: number;
  /** σ ядра в парсеках (§5.1 #9 bulge_radius: 1.0–5.0 кпк, умолчание 3000 пк). */
  bulgeRadius: number;
  armWidth: number;
  armTwist: number;
  /** Доля диска (§1.3: 0.1–0.4) — доля звёзд вне рукавов, но внутри диска. */
  diskFraction: number;
  /** Доля ореола (§1.3: 0.0–0.15). */
  haloFraction: number;
}

/**
 * Доля ядра при bulgeDensity = 1.5 (норма §1.3). Семантика bulgeDensity
 * («множитель плотности в ядре относительно нормы», §1.3/§5.1 #8) в модели
 * фиксированного числа систем: доля ядра = 0.15 × bulgeDensity / 1.5, т.е.
 * 1.5 → документированные ~15% (§1.1), 3.0 → 30%, 0.5 → 5%.
 * (Зафиксировано аудитом Task 35; вынесено в архитектурные вопросы для
 * подтверждения владельцем.)
 */
const BASE_BULGE_SHARE = 0.15;
const NORM_BULGE_DENSITY = 1.5;
// 0.1 = BASE_BULGE_SHARE / NORM_BULGE_DENSITY; отдельная константа — чтобы
// float-умножение шло по одному шагу (0.1×d) и не накапливало погрешность
// (0.15×(d/1.5) даёт 24.999… вместо 25 при d=0.5, n=500).
const BULGE_SHARE_PER_DENSITY = BASE_BULGE_SHARE / NORM_BULGE_DENSITY;

/** Не-рукавные доли в сумме не могут вытеснить рукава полностью. */
const MAX_NON_ARM_SHARE = 0.95;

/** Доли компонентов (с clamp и нормализацией). */
export function computeComponentShares(cfg: PositionsConfig): {
  bulge: number; disk: number; halo: number; arm: number;
} {
  const clamp01 = (x: number, max: number): number =>
    Number.isFinite(x) ? Math.min(Math.max(x, 0), max) : 0;
  let bulge = clamp01(BULGE_SHARE_PER_DENSITY * cfg.bulgeDensity, 0.85);
  let disk = clamp01(cfg.diskFraction, 0.85);
  let halo = clamp01(cfg.haloFraction, 0.85);
  const sum = bulge + disk + halo;
  if (sum > MAX_NON_ARM_SHARE) {
    // Вне-диапазонные значения (docs §1.3: bulgeDensity 0.5–3.0, disk 0.1–0.4,
    // halo 0–0.15 → сумма ≤ 0.85) пропорционально нормализуем, рукава ≥ 5%.
    const scale = MAX_NON_ARM_SHARE / sum;
    bulge *= scale; disk *= scale; halo *= scale;
  }
  return { bulge, disk, halo, arm: 1 - bulge - disk - halo };
}

/**
 * Число систем каждого компонента (bulgeCount + diskCount + armCount +
 * haloCount = systemCount всегда). Экспортировано для регрессионных тестов
 * G-03 (влияние параметров на доли).
 */
export function computeComponentCounts(cfg: PositionsConfig): {
  bulgeCount: number; diskCount: number; armCount: number; haloCount: number;
} {
  const shares = computeComponentShares(cfg);
  const n = Number.isFinite(cfg.systemCount) ? Math.max(0, Math.floor(cfg.systemCount)) : 0;
  // Эпсилон-гард от float-погрешности долей: 0.15×(0.5/1.5)×500 даёт
  // 24.999999999999996 → без него floor занижал бы документированные доли.
  const EPS = 1e-9;
  const bulgeCount = Math.floor(n * shares.bulge + EPS);
  const diskCount = Math.floor(n * shares.disk + EPS);
  const haloCount = Math.floor(n * shares.halo + EPS);
  const armCount = n - bulgeCount - diskCount - haloCount;
  return { bulgeCount, diskCount, armCount, haloCount };
}

/**
 * Генерация позиций систем в спиральной структуре.
 * Возвращает массив Vec2 координат (в парсеках) в порядке:
 * ядро, диск, рукава, ореол (срезы стабильны — см. тесты локальности).
 */
export function generateSpiralPositions(
  cfg: PositionsConfig,
  armRng: Xoshiro128StarStar,
  bulgeRng: Xoshiro128StarStar,
  diskRng: Xoshiro128StarStar,
  haloRng: Xoshiro128StarStar,
): Vec2[] {
  const positions: Vec2[] = [];

  // R-35 (P2 аудита): ВСЕ числовые параметры нормализуются ОДИН раз здесь,
  // и дальше используется ТОЛЬКО нормализованные значения. ДО фикса разброс
  // рукавов и радиальный шум считались от сырого `cfg.radius` — при
  // NaN/Infinity в конфиге защитная проверка radius не гарантировала
  // конечные координаты (spread = gauss(0, NaN·…) → NaN-углы).
  const radius = Number.isFinite(cfg.radius) ? Math.max(0, cfg.radius) : 0;
  const spread = Number.isFinite(cfg.spread) ? Math.max(0, cfg.spread) : 0;
  const armWidth = Number.isFinite(cfg.armWidth) ? Math.max(0, cfg.armWidth) : 0;
  const armTwist = Number.isFinite(cfg.armTwist) ? cfg.armTwist : 0;
  // R-36 (аудит R-35): arms = ±Infinity/NaN → 1. Прежняя форма
  // `Math.max(1, Math.floor(cfg.arms) || 1)` пропускала +Infinity
  // (floor(+Inf)=+Inf, `+Inf || 1`=+Inf): armAngleStep = 2π/+Inf = 0, а
  // nextInt(0, +Inf) давал бесконечные индексы рукава → нечисловые углы и
  // NaN/±Inf-координаты. Нормализация гарантирует конечный armAngleStep и
  // конечные координаты при любом входе (тест galaxy-positions).
  const arms = Number.isFinite(cfg.arms) ? Math.max(1, Math.floor(cfg.arms)) : 1;

  const { bulgeCount, diskCount, armCount, haloCount } = computeComponentCounts(cfg);

  // Ядро (bulge) — 2D-гауссиана σ = bulgeRadius (docs §1.1 п.4).
  const bulgeSigma = Number.isFinite(cfg.bulgeRadius) ? Math.max(0, cfg.bulgeRadius) : 0;
  for (let i = 0; i < bulgeCount; i++) {
    positions.push({
      x: bulgeRng.nextGaussian(0, bulgeSigma),
      y: bulgeRng.nextGaussian(0, bulgeSigma),
    });
  }

  // Диск (inter-arm space) — равномерно ПО ПЛОЩАДИ в пределах radius
  // (docs §1.1 п.5): r = R·sqrt(U); U·R давал бы плотность ∝ 1/r.
  for (let i = 0; i < diskCount; i++) {
    const angle = diskRng.nextFloat() * Math.PI * 2;
    const dist = radius * Math.sqrt(diskRng.nextFloat());
    positions.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
    });
  }

  // Спиральные рукава — прежняя параметризация (осознанное отклонение G-20,
  // docs/galaxy-generation-audit.md §11.2): радиус → угол + гауссово
  // смещение. Guards: arms ≥ 1 (arms = 0 давал armAngleStep = 2π/0 = Infinity
  // и NaN-координаты); radius = 0 → t = 0. R-35: разброс и шум — от
  // НОРМАЛИЗОВАННОГО radius (не cfg.radius), см. блок нормализации выше.
  const armAngleStep = (2 * Math.PI) / arms;
  for (let i = 0; i < armCount; i++) {
    const arm = armRng.nextInt(0, arms - 1);
    const armAngle = arm * armAngleStep;
    const dist = armRng.nextFloat() * radius;
    const t = radius > 0 ? dist / radius : 0;
    const spiralAngle = armAngle + t * Math.PI * armTwist * 2;
    const armSpread = armRng.nextGaussian(0, spread * radius * armWidth * 0.3);

    const angle = spiralAngle + (armSpread / (radius > 0 ? radius : 1));
    const r = dist + armRng.nextGaussian(0, radius * 0.05);

    positions.push({
      x: Math.cos(angle) * Math.max(0, r),
      y: Math.sin(angle) * Math.max(0, r),
    });
  }

  // Ореол (halo) — глобулярные скопления ЗА пределами основного диска
  // (docs §1.1 п.6): центр скопления равномерно по углу и в кольце
  // [1.2R, 1.5R]; точки — 2D-гауссиана σ = 0.03R вокруг центра.
  // Число скоплений ≈ haloCount/10 (минимум 1 при haloCount > 0).
  if (haloCount > 0) {
    const clusterCount = Math.max(1, Math.round(haloCount / 10));
    const base = Math.floor(haloCount / clusterCount);
    const extra = haloCount % clusterCount;
    const sigma = radius * 0.03;
    let placed = 0;
    for (let c = 0; c < clusterCount; c++) {
      const size = base + (c < extra ? 1 : 0);
      const angle = haloRng.nextFloat() * Math.PI * 2;
      const centerDist = radius * (1.2 + 0.3 * haloRng.nextFloat());
      const cx = Math.cos(angle) * centerDist;
      const cy = Math.sin(angle) * centerDist;
      for (let i = 0; i < size && placed < haloCount; i++) {
        positions.push({
          x: cx + haloRng.nextGaussian(0, sigma),
          y: cy + haloRng.nextGaussian(0, sigma),
        });
        placed++;
      }
    }
  }

  return positions;
}
