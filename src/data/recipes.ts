/**
 * Определения рецептов крафта — MVP.
 */

import type { RecipeDef } from '@/core/types';

export const RECIPES: RecipeDef[] = [
  // === Уровень 1: Сырьё → Материалы ===
  {
    id: 'smelt_fe',
    name: 'Плавка железа',
    category: 'raw_to_material',
    inputs: { 'Fe-ore': 10 },
    outputs: { Fe: 8 },
    energyCost: 2,
    time: 150,
    buildingId: 'smelter',
  },
  {
    id: 'smelt_si',
    name: 'Плавка кремния',
    category: 'raw_to_material',
    inputs: { 'Si-ore': 10 },
    outputs: { Si: 7 },
    energyCost: 2,
    time: 150,
    buildingId: 'smelter',
  },
  {
    id: 'smelt_ti',
    name: 'Плавка титана',
    category: 'raw_to_material',
    inputs: { 'Ti-ore': 10 },
    outputs: { Ti: 7 },
    energyCost: 3,
    time: 200,
    buildingId: 'smelter',
  },
  {
    id: 'smelt_cu',
    name: 'Плавка меди',
    category: 'raw_to_material',
    inputs: { 'Cu-ore': 10 },
    outputs: { Cu: 8 },
    energyCost: 2,
    time: 150,
    buildingId: 'smelter',
  },
  {
    id: 'make_steel',
    name: 'Стальной сплав',
    category: 'raw_to_material',
    inputs: { Fe: 10, C: 3 },
    outputs: { steel: 5 },
    energyCost: 5,
    time: 200,
    buildingId: 'smelter',
  },
  {
    id: 'make_titanium_alloy',
    name: 'Титановый сплав',
    category: 'raw_to_material',
    inputs: { Ti: 8, Al: 4 },
    outputs: { titanium_alloy: 4 },
    energyCost: 8,
    time: 250,
    buildingId: 'smelter',
  },
  {
    id: 'make_plastic',
    name: 'Пластик',
    category: 'raw_to_material',
    inputs: { C: 5, H: 8 },
    outputs: { plastic: 6 },
    energyCost: 2,
    time: 120,
    buildingId: 'chemical_plant',
  },
  {
    id: 'make_silicon_crystal',
    name: 'Кремниевый кристалл',
    category: 'raw_to_material',
    inputs: { Si: 6 },
    outputs: { silicon_crystal: 2 },
    energyCost: 10,
    time: 300,
    buildingId: 'chemical_plant',
  },
  {
    id: 'make_superconductor',
    name: 'Сверхпроводник',
    category: 'raw_to_material',
    inputs: { Cu: 2, O: 3 },
    outputs: { superconductor: 1 },
    energyCost: 15,
    time: 400,
    buildingId: 'chemical_plant',
  },

  // === Уровень 2: Материалы → Компоненты ===
  {
    id: 'make_microchip',
    name: 'Микрочип',
    category: 'material_to_component',
    inputs: { silicon_crystal: 1, Au: 1 },
    outputs: { microchip: 1 },
    energyCost: 5,
    time: 250,
    buildingId: 'chemical_plant',
  },
  {
    id: 'make_hull_element',
    name: 'Корпусной элемент',
    category: 'material_to_component',
    inputs: { steel: 5 },
    outputs: { hull_element: 1 },
    energyCost: 3,
    time: 180,
    buildingId: 'smelter',
  },
  {
    id: 'make_armor_plate',
    name: 'Бронеплита',
    category: 'material_to_component',
    inputs: { titanium_alloy: 3, W: 1 },
    outputs: { armor_plate: 1 },
    energyCost: 5,
    time: 220,
    buildingId: 'smelter',
  },
  {
    id: 'make_engine_section',
    name: 'Двигательная секция',
    category: 'material_to_component',
    inputs: { steel: 3, superconductor: 1 },
    outputs: { engine_section: 1 },
    energyCost: 10,
    time: 300,
    buildingId: 'chemical_plant',
  },

  // === Уровень 3: Компоненты → Модули ===
  {
    id: 'make_ion_engine',
    name: 'Ионный двигатель',
    category: 'component_to_module',
    inputs: { engine_section: 2, superconductor: 1 },
    outputs: { ion_engine: 1 },
    energyCost: 12,
    time: 400,
    buildingId: 'shipyard',
  },
  {
    id: 'make_laser',
    name: 'Лазерная установка',
    category: 'component_to_module',
    inputs: { microchip: 2, hull_element: 1 },
    outputs: { laser: 1 },
    energyCost: 8,
    time: 350,
    buildingId: 'shipyard',
  },
  {
    id: 'make_cargo_bay',
    name: 'Грузовой отсек',
    category: 'component_to_module',
    inputs: { hull_element: 3 },
    outputs: { cargo_bay: 1 },
    energyCost: 2,
    time: 200,
    buildingId: 'shipyard',
  },
  {
    id: 'make_scanner',
    name: 'Сканер',
    category: 'component_to_module',
    inputs: { microchip: 1 },
    outputs: { scanner: 1 },
    energyCost: 3,
    time: 150,
    buildingId: 'shipyard',
  },
];

export const RECIPE_MAP = new Map(RECIPES.map(r => [r.id, r]));

/** Сырьевые руды (добываются шахтой/карьером) */
export const RAW_ORES = ['Fe-ore', 'Si-ore', 'Ti-ore', 'Cu-ore', 'Al-ore', 'C-ore', 'Ni-ore', 'W-ore', 'U-ore', 'Co-ore', 'Au-ore', 'Pt-ore', 'Cr-ore', 'Li-ore', 'S-ore'];

/** Категории рецептов */
export const RECIPE_CATEGORY_NAMES: Record<string, string> = {
  raw_to_material: 'Сырьё → Материалы',
  material_to_component: 'Материалы → Компоненты',
  component_to_module: 'Компоненты → Модули',
  module_to_ship: 'Модули → Корабль',
};
