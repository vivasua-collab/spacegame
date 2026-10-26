/// <reference types="bun-types" />
/**
 * R-36: регрессионные тесты классификации `rarity` (elements.ts).
 *
 * Контекст (аудит R-35/R-36, «третий несогласованный источник»): семантика
 * rarity = БАЗОВАЯ категория распространённости элемента (docs/31-resources.md
 * §2/§3) — НЕ планетарный пул генерации (RARE_ELEMENTS / ULTRA_RARE_ELEMENTS
 * в planet-types.ts, guard-тесты в tests/galaxy/deposits.test.ts D4).
 *
 * Таблица соответствия R-36 (5 расхождений с docs/31 §2 устранены,
 * остальные 55 значений не менялись — правило аудитора «без молчаливой
 * смены 24 значений»):
 *   Pt: ultra_rare → rare;  Au: ultra_rare → rare;  U: ultra_rare → rare;
 *   Be: ultra_rare → rare;  Zr: rare → ultra_rare.
 *
 * Снапшот распределения заморожен: любое изменение rarity теперь обязано
 * пройти через этот тест (осознанное изменение + обновление снапшота),
 * молчаливый сдвиг невозможен.
 *
 * Run: bun test tests/elements-rarity.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { ELEMENTS, ELEMENT_MAP } from '@/data/elements';
import { RARITY_MODIFIER } from '@/data/chemistry/ore-generator';
import type { ElementRarity } from '@/core/types';

/** Замороженное распределение rarity по 60 элементам (R-36). */
const FROZEN_DISTRIBUTION: Record<ElementRarity, number> = {
  abundant: 14,
  common: 12,
  rare: 13,
  ultra_rare: 21,
};

/** 40 элементов, поимённо классифицированных в docs/31 §2 (примеры-перечни). */
const DOCS31_CLASSIFIED: Record<ElementRarity, string[]> = {
  abundant: ['H', 'C', 'O', 'Si', 'Fe', 'Al', 'Ca', 'Na', 'K', 'Mg'],
  common: ['Ti', 'Cr', 'Mn', 'Ni', 'Cu', 'Zn', 'Sn', 'Pb', 'S', 'P'],
  rare: ['Co', 'W', 'Mo', 'V', 'Ag', 'Pt', 'Au', 'U', 'Li', 'Be'],
  ultra_rare: ['Ir', 'Os', 'Re', 'Ru', 'Rh', 'Pd', 'Hf', 'Ta', 'Nb', 'Zr'],
};

/** Таблица соответствия R-36: элементы, чей rarity изменился этим проходом. */
const R36_CHANGES: Array<[string, ElementRarity]> = [
  ['Pt', 'rare'],
  ['Au', 'rare'],
  ['U', 'rare'],
  ['Be', 'rare'],
  ['Zr', 'ultra_rare'],
];

describe('R-36: классификация rarity — снапшот и соответствие docs/31 §2', () => {
  test('1. Всего 60 элементов; каждый имеет валидный rarity', () => {
    expect(ELEMENTS.length).toBe(60);
    const valid: ElementRarity[] = ['abundant', 'common', 'rare', 'ultra_rare'];
    for (const e of ELEMENTS) {
      expect(valid.includes(e.rarity), `${e.id}: rarity=${e.rarity}`).toBe(true);
    }
  });

  test('2. Снапшот распределения заморожен (14 / 12 / 13 / 21)', () => {
    const counts: Record<ElementRarity, number> = { abundant: 0, common: 0, rare: 0, ultra_rare: 0 };
    for (const e of ELEMENTS) counts[e.rarity]++;
    expect(counts).toEqual(FROZEN_DISTRIBUTION);
  });

  test('3. Все 40 элементов классификации docs/31 §2 совпадают поимённо', () => {
    for (const [rarity, ids] of Object.entries(DOCS31_CLASSIFIED) as Array<[ElementRarity, string[]]>) {
      for (const id of ids) {
        expect(ELEMENT_MAP.get(id)?.rarity, `${id}: docs/31 §2 ${rarity}`).toBe(rarity);
      }
    }
    // полнота перечней: ровно 10 в каждой категории спеки
    expect(DOCS31_CLASSIFIED.abundant.length).toBe(10);
    expect(DOCS31_CLASSIFIED.common.length).toBe(10);
    expect(DOCS31_CLASSIFIED.rare.length).toBe(10);
    expect(DOCS31_CLASSIFIED.ultra_rare.length).toBe(10);
  });

  test('4. Таблица соответствия R-36 применена (5 позиций, направление фиксации)', () => {
    for (const [id, expected] of R36_CHANGES) {
      expect(ELEMENT_MAP.get(id)?.rarity, `${id} (R-36 mapping)`).toBe(expected);
    }
  });

  test('5. Потребитель rarity (RARITY_MODIFIER химии) полон по 4 категориям', () => {
    // fallback-правила генерации руд используют rarity; справочник обязан
    // покрывать все категории, иначе элемент без ORE_SPECS упадёт в NaN.
    for (const rarity of ['abundant', 'common', 'rare', 'ultra_rare'] as ElementRarity[]) {
      expect(RARITY_MODIFIER[rarity], `RARITY_MODIFIER.${rarity}`).toBeGreaterThan(0);
    }
    // все rarity таблицы элементов имеют модификатор
    for (const e of ELEMENTS) {
      expect(RARITY_MODIFIER[e.rarity], `${e.id}`).toBeDefined();
    }
  });
});
