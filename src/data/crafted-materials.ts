/**
 * Каталог синтезированных материалов (gap-10, P5 — audit §2.3).
 *
 * Раньше крафтовые материалы (steel, microchip, superconductor, ...) показывались в
 * ResourcePanel в категории «Прочие» с `name: id.replace(/-/g, ' ')` (английский ID
 * вместо русского названия). Теперь они описаны здесь с правильным русским названием,
 * символом, иконкой и категорией `crafted` (см. `08_27_block_01_stabilization.md` P5).
 *
 * Список синхронизирован с:
 * - `recipes.ts` (выходы `outputs: { steel: 5 }`, `outputs: { microchip: 1 }`, ...)
 * - `warehouse.ts` HIGH_TECH_MATERIALS (265-269)
 */

import type { ElementCategory } from '@/core/types';

export interface CraftedMaterialDef {
  /** ID материала — совпадает с ключом в `planet.resources` */
  id: string;
  /** Русское название */
  name: string;
  /** Символ/аббревиатура для UI */
  symbol: string;
  /** Категория (всегда 'crafted' для этого каталога) */
  category: ElementCategory;
  /** Краткое описание */
  description: string;
}

/**
 * Карта синтезированных материалов.
 * Ключ — ID материала (совпадает с ключом в `planet.resources`).
 */
export const CRAFTED_MATERIALS: Record<string, CraftedMaterialDef> = {
  // === Сплавы ===
  steel: {
    id: 'steel',
    name: 'Сталь',
    symbol: 'FeC',
    category: 'crafted',
    description: 'Базовый конструкционный сплав железа с углеродом',
  },
  titanium_alloy: {
    id: 'titanium_alloy',
    name: 'Титановый сплав',
    symbol: 'TiA',
    category: 'crafted',
    description: 'Лёгкий прочный сплав для авиакосмических конструкций',
  },
  superconductor: {
    id: 'superconductor',
    name: 'Сверхпроводник',
    symbol: 'SC',
    category: 'crafted',
    description: 'Материал с нулевым сопротивлением при криогенных температурах',
  },

  // === Электроника ===
  microchip: {
    id: 'microchip',
    name: 'Микрочип',
    symbol: 'MC',
    category: 'crafted',
    description: 'Интегральная схема — основа вычислительной техники',
  },
  silicon_crystal: {
    id: 'silicon_crystal',
    name: 'Кремниевый кристалл',
    symbol: 'SiX',
    category: 'crafted',
    description: 'Монокристалл кремния для полупроводников',
  },
  sensor_array: {
    id: 'sensor_array',
    name: 'Сенсорная решётка',
    symbol: 'SA',
    category: 'crafted',
    description: 'Комплекс датчиков для сканирования окружающей среды',
  },

  // === Корабельные компоненты ===
  shield_generator: {
    id: 'shield_generator',
    name: 'Генератор щита',
    symbol: 'SG',
    category: 'crafted',
    description: 'Устройство проецирования защитного энергетического поля',
  },
  engine_section: {
    id: 'engine_section',
    name: 'Секция двигателя',
    symbol: 'ES',
    category: 'crafted',
    description: 'Готовый к монтажу модуль корабельного двигателя',
  },
  ion_engine: {
    id: 'ion_engine',
    name: 'Ионный движитель',
    symbol: 'IE',
    category: 'crafted',
    description: 'Эффективный двигатель для крейсерских скоростей',
  },
  laser: {
    id: 'laser',
    name: 'Лазер',
    symbol: 'LS',
    category: 'crafted',
    description: 'Боевая лазерная установка',
  },
  cargo_bay: {
    id: 'cargo_bay',
    name: 'Грузовой отсек',
    symbol: 'CB',
    category: 'crafted',
    description: 'Модуль для перевозки грузов',
  },
  scanner: {
    id: 'scanner',
    name: 'Сканер',
    symbol: 'SC',
    category: 'crafted',
    description: 'Дальнобойный сенсорный комплекс',
  },

  // === Химические синтетические материалы ===
  // (добавлены после P1 validate-recipes.ts — см. commit)
  plastic: {
    id: 'plastic',
    name: 'Пластик',
    symbol: 'PL',
    category: 'crafted',
    description: 'Полимерный материал для корпусов, изоляции, упаковки',
  },
  synfuel: {
    id: 'synfuel',
    name: 'Синтетическое топливо',
    symbol: 'SF',
    category: 'crafted',
    description: 'Высокоплотное ракетное топливо искусственного происхождения',
  },
  hull_element: {
    id: 'hull_element',
    name: 'Корпусной элемент',
    symbol: 'HE',
    category: 'crafted',
    description: 'Готовая секция корпуса корабля',
  },
  armor_plate: {
    id: 'armor_plate',
    name: 'Бронеплита',
    symbol: 'AP',
    category: 'crafted',
    description: 'Слоистая броневая плита для защиты кораблей',
  },
};

/**
 * Lookup-функция для UI: если ресурс не найден в ELEMENT_MAP, проверить в CRAFTED_MATERIALS.
 * @returns CraftedMaterialDef или undefined (если ресурс не крафтовый)
 */
export function getCraftedMaterial(id: string): CraftedMaterialDef | undefined {
  return CRAFTED_MATERIALS[id];
}

/**
 * Проверка, является ли ресурс крафтовым материалом.
 */
export function isCraftedMaterial(id: string): boolean {
  return id in CRAFTED_MATERIALS;
}
