/**
 * Генерация ресурсов планеты.
 *
 * Философия: на каждой планете есть ВСЯ таблица элементов (как таблица Менделеева).
 * Профильные ресурсы (соответствующие типу планеты) — в ЗНАЧИТЕЛЬНОМ количестве.
 * Редкие — в следовых количествах (но всегда есть).
 * Ультраредкие — 1-2 уникальных для планеты.
 */

import type { Xoshiro256 } from '@/core/prng';
import type { HexCell, PlanetResourceDeposit } from '@/core/types';
import { PROFILE_ELEMENTS, RARE_ELEMENTS, ULTRA_RARE_ELEMENTS } from '@/data/planet-types';
import { ELEMENTS } from '@/data/elements';

// Множители количества по категории для каждого типа планеты
const CATEGORY_MULTIPLIERS: Record<string, Record<string, number>> = {
  rocky:    { structural: 2.5, fuel: 0.5, alloy: 1.5, electronics: 0.8, chemical: 0.6, energy: 0.5, rare: 0.3, light: 0.5 },
  volcanic: { structural: 1.8, fuel: 0.3, alloy: 2.5, electronics: 0.6, chemical: 1.2, energy: 2.0, rare: 0.8, light: 0.2 },
  ice:      { structural: 0.4, fuel: 2.0, alloy: 0.3, electronics: 0.2, chemical: 1.8, energy: 0.2, rare: 0.15, light: 1.0 },
  oceanic:  { structural: 0.7, fuel: 1.0, alloy: 0.5, electronics: 0.5, chemical: 1.8, energy: 0.3, rare: 0.2, light: 0.6 },
  desert:   { structural: 1.2, fuel: 0.2, alloy: 1.0, electronics: 0.6, chemical: 0.3, energy: 0.6, rare: 0.5, light: 0.3 },
  gas_giant:{ structural: 0.1, fuel: 3.0, alloy: 0.1, electronics: 0.1, chemical: 2.5, energy: 0.1, rare: 0.1, light: 1.5 },
  dwarf:    { structural: 0.6, fuel: 0.3, alloy: 0.4, electronics: 0.2, chemical: 0.3, energy: 0.2, rare: 0.15, light: 0.3 },
};

/**
 * Назначить ресурсные залежи на гексах.
 * Атмосферные элементы (H, He, O, N, C, S) добываются газовым экстрактором,
 * но их залежи в породе тоже присутствуют в меньших количествах.
 */
export function assignResourceDeposits(hexes: HexCell[], rng: Xoshiro256, planetType: string): void {
  if (hexes.length === 0) return;

  const nonOceanHexes = hexes.filter(h => h.terrain !== 'ocean');
  if (nonOceanHexes.length === 0) return;

  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  const catMult = CATEGORY_MULTIPLIERS[planetType] ?? CATEGORY_MULTIPLIERS.rocky;

  // Для КАЖДОГО элемента из таблицы — создаём залежи
  for (const element of ELEMENTS) {
    const cat = element.category;
    const mult = catMult[cat] ?? 0.3;
    const isProfile = profileSet.has(element.id);
    const isRare = rareSet.has(element.id);

    let baseQuantity: number;
    let hexFraction: number;
    let baseAvailability: number;

    if (isProfile) {
      baseQuantity = (200 + rng.nextFloat() * 800) * mult * 3.0;
      hexFraction = Math.min(0.6, 0.2 + mult * 0.3);
      baseAvailability = 0.3 + rng.nextFloat() * 0.5;
    } else if (isRare) {
      baseQuantity = (5 + rng.nextFloat() * 30) * mult * 0.15;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.1);
      baseAvailability = 0.02 + rng.nextFloat() * 0.12;
    } else if (element.isAtmospheric) {
      baseQuantity = (15 + rng.nextFloat() * 60) * mult;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.1);
      baseAvailability = 0.05 + rng.nextFloat() * 0.2;
    } else {
      baseQuantity = (20 + rng.nextFloat() * 120) * mult;
      hexFraction = Math.max(1 / nonOceanHexes.length, 0.05 + mult * 0.15);
      baseAvailability = 0.1 + rng.nextFloat() * 0.3;
    }

    const hexCount = Math.max(1, Math.min(
      nonOceanHexes.length,
      Math.ceil(hexFraction * nonOceanHexes.length),
    ));

    const shuffled = [...nonOceanHexes].sort(() => rng.nextFloat() - 0.5);
    for (let h = 0; h < hexCount && h < shuffled.length; h++) {
      const quantityVariance = 0.5 + rng.nextFloat();
      shuffled[h].deposits.push({
        elementId: `${element.id}-ore`,
        availability: Math.min(1, baseAvailability * (0.7 + rng.nextFloat() * 0.6)),
        quantity: Math.max(1, Math.round(baseQuantity * quantityVariance)),
        depth: isRare ? rng.nextInt(3, 5) : rng.nextInt(1, 4),
      });
    }
  }

  // Случайные богатые залежи профильных ресурсов на 15% гексов
  for (const hex of nonOceanHexes) {
    if (rng.nextBool(0.15)) {
      const profileElements = ELEMENTS.filter(e => profileSet.has(e.id));
      const element = profileElements.length > 0
        ? rng.nextChoice(profileElements)
        : rng.nextChoice(ELEMENTS.filter(e => !e.isAtmospheric));
      const cat = element.category;
      const mult = catMult[cat] ?? 0.3;
      hex.deposits.push({
        elementId: `${element.id}-ore`,
        availability: 0.5 + rng.nextFloat() * 0.5,
        quantity: Math.round((200 + rng.nextFloat() * 800) * mult * 2),
        depth: rng.nextInt(1, 3),
      });
    }
  }
}

/**
 * Агрегация ресурсных залежей из гексов в сводную таблицу планеты.
 * Также добавляет ультраредкие ресурсы (1-2 уникальных для планеты).
 */
export function aggregateResourceDeposits(
  hexes: HexCell[],
  planetType: string,
  rng: Xoshiro256,
): PlanetResourceDeposit[] {
  const profileSet = new Set(PROFILE_ELEMENTS[planetType as keyof typeof PROFILE_ELEMENTS] ?? []);
  const rareSet = new Set(RARE_ELEMENTS);
  const deposits = new Map<string, { totalQuantity: number; totalAvailability: number; hexCount: number; maxAvailability: number }>();

  // Агрегируем из гексов
  for (const hex of hexes) {
    for (const dep of hex.deposits) {
      const elId = dep.elementId.replace('-ore', '');
      const existing = deposits.get(elId);
      if (existing) {
        existing.totalQuantity += dep.quantity;
        existing.totalAvailability += dep.availability;
        existing.hexCount++;
        existing.maxAvailability = Math.max(existing.maxAvailability, dep.availability);
      } else {
        deposits.set(elId, {
          totalQuantity: dep.quantity,
          totalAvailability: dep.availability,
          hexCount: 1,
          maxAvailability: dep.availability,
        });
      }
    }
  }

  // Гарантируем ВСЕ элементы из таблицы
  for (const element of ELEMENTS) {
    if (!deposits.has(element.id)) {
      const isProfile = profileSet.has(element.id);
      const isRare = rareSet.has(element.id);
      const mult = planetType === 'gas_giant' ? (element.category === 'fuel' ? 3 : element.category === 'chemical' ? 2 : 0.2) : 0.3;
      const quantity = isProfile
        ? Math.round((300 + rng.nextFloat() * 1000) * mult)
        : isRare
          ? Math.round((3 + rng.nextFloat() * 15) * mult * 0.1)
          : Math.round((10 + rng.nextFloat() * 50) * mult);

      deposits.set(element.id, {
        totalQuantity: Math.max(1, quantity),
        totalAvailability: isProfile ? 0.4 + rng.nextFloat() * 0.4 : isRare ? 0.02 + rng.nextFloat() * 0.08 : 0.05 + rng.nextFloat() * 0.15,
        hexCount: 0,
        maxAvailability: isProfile ? 0.5 + rng.nextFloat() * 0.5 : 0.1 + rng.nextFloat() * 0.2,
      });
    }
  }

  // Ультраредкие элементы (1-2 уникальных для планеты)
  const ultraCount = rng.nextInt(1, 2);
  const availableUltra = ULTRA_RARE_ELEMENTS.filter(e => !profileSet.has(e));
  for (let i = 0; i < ultraCount && i < availableUltra.length; i++) {
    const elId = rng.nextChoice(availableUltra);
    if (!deposits.has(elId) || (deposits.get(elId)?.totalQuantity ?? 0) < 10) {
      deposits.set(elId, {
        totalQuantity: Math.max(1, Math.round(1 + rng.nextFloat() * 5)),
        totalAvailability: 0.01 + rng.nextFloat() * 0.04,
        hexCount: 1,
        maxAvailability: 0.05,
      });
    }
  }

  // Собираем результат
  const result: PlanetResourceDeposit[] = [];
  for (const [elementId, data] of deposits) {
    const isProfile = profileSet.has(elementId);
    const isRare = rareSet.has(elementId);
    const isUltra = !isProfile && !isRare && (data.totalQuantity < 20 || data.maxAvailability < 0.05);

    let tier: 'profile' | 'rare' | 'ultra_rare';
    if (isProfile) tier = 'profile';
    else if (isUltra) tier = 'ultra_rare';
    else if (isRare) tier = 'rare';
    else if (data.totalAvailability / Math.max(1, data.hexCount) < 0.1 && data.totalQuantity < 50) tier = 'ultra_rare';
    else tier = 'rare';

    result.push({
      elementId,
      totalQuantity: data.totalQuantity,
      avgAvailability: data.hexCount > 0 ? Math.round((data.totalAvailability / data.hexCount) * 1000) / 1000 : Math.round(data.totalAvailability * 1000) / 1000,
      tier,
      hexCount: data.hexCount,
      maxAvailability: Math.round(data.maxAvailability * 1000) / 1000,
    });
  }

  // Сортировка: профильные → редкие → ультраредкие
  const tierOrder = { profile: 0, rare: 1, ultra_rare: 2 };
  result.sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.totalQuantity - a.totalQuantity);

  return result;
}
