/**
 * Block 03 (R1): Дерево технологий MVP-slice (15 технологий).
 *
 * Источник: docs/60-research.md §6 + plan §2.3 таблица.
 *
 * 15 специализированных технологий по 5 веткам:
 *   P (power, 3):      fusion_reactor, ion_engine, power_systems
 *   M (materials, 4):  steel_processing, light_alloys, composites, superconductors
 *   W (weapons, 3):    ballistic_weapons, laser_weapons, fleet_tactics
 *   C (computing, 3):  microelectronics, short_range_sensors, communication_systems
 *   B (biology, 2):    hydroponics, ecological_adaptation
 *
 * Ксеноархеология (X1..X12) — Etap 4, не входит в MVP.
 *
 * Стоимость уровня N: floor(baseCost × 1.5^(N-1)) (§4.2).
 * Преквизиты: tech_id >= N (DAG, до 3 AND, без OR).
 *
 * Кросс-веточные преквизиты (для разнообразия DAG):
 *   M5 superconductors ← M1≥2, C1≥1 (computing)
 *   W2 laser_weapons   ← W1≥2, C1≥1 (computing)
 *
 * Effects — заглушки для UI (Etap 4 — реальные модификаторы).
 * В MVP effect-цепочки не вычисляются — важны лишь `unlocks`
 * (см. TECH_UNLOCKS в index.ts) для разблокировки рецептов/модулей.
 */

import type { Technology, SpecializedBranchId } from '@/core/types';

export const TECH_TREE: Technology[] = [
  // ─── Power (P) ─────────────────────────────────────────
  {
    id: 'fusion_reactor',
    name: 'Термоядерный реактор',
    nameEn: 'Fusion reactor',
    branch: 'power',
    baseCost: 500,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.10,
    prerequisites: [],
    effects: [
      { target: 'energy_output', operation: 'multiply', value: 1.10, perLevel: true },
    ],
    description: '+10% к выходу энергии на ур. Открывает здание «Термояд. реактор» (по §8.3 40-buildings).',
    icon: 'fusion',
    sortOrder: 1,
  },
  {
    id: 'ion_engine',
    name: 'Ионный двигатель',
    nameEn: 'Ion engine',
    branch: 'power',
    baseCost: 800,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.15,
    prerequisites: [
      { techId: 'fusion_reactor', minLevel: 1 },
    ],
    effects: [
      { target: 'ship_thrust', operation: 'multiply', value: 1.15, perLevel: true },
    ],
    description: '+15% к тяге двигателей на ур. Открывает модуль «Ионный двигатель» (для верфи).',
    icon: 'ion',
    sortOrder: 2,
  },
  {
    id: 'power_systems',
    name: 'Силовые системы',
    nameEn: 'Power systems',
    branch: 'power',
    baseCost: 600,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.08,
    prerequisites: [
      { techId: 'fusion_reactor', minLevel: 1 },
    ],
    effects: [
      { target: 'energy_storage', operation: 'multiply', value: 1.08, perLevel: true },
    ],
    description: '+8% к ёмкости накопителей энергии. Основа для P3-P12 (Etap 4).',
    icon: 'power',
    sortOrder: 3,
  },

  // ─── Materials (M) ─────────────────────────────────────
  {
    id: 'steel_processing',
    name: 'Обработка стали',
    nameEn: 'Steel processing',
    branch: 'materials',
    baseCost: 300,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.05,
    prerequisites: [],
    effects: [],
    description: 'Открывает рецепт «Стальной сплав» (steel) в синтезаторе. Базовая ветка материаловедения.',
    icon: 'steel',
    sortOrder: 11,
  },
  {
    id: 'light_alloys',
    name: 'Лёгкие сплавы',
    nameEn: 'Light alloys',
    branch: 'materials',
    baseCost: 500,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.05,
    prerequisites: [
      { techId: 'steel_processing', minLevel: 1 },
    ],
    effects: [],
    description: 'Открывает рецепт «Титановый сплав» (titanium_alloy). Снижает массу конструкций.',
    icon: 'alloy',
    sortOrder: 12,
  },
  {
    id: 'composites',
    name: 'Композиты',
    nameEn: 'Composites',
    branch: 'materials',
    baseCost: 800,
    maxLevel: 10,
    improvementType: 'progressive',
    improvementPerLevel: 0.07,
    prerequisites: [
      { techId: 'steel_processing', minLevel: 2 },
      { techId: 'light_alloys', minLevel: 1 },
    ],
    effects: [],
    description: 'Открывает рецепт «Композитная пластина» (composite_plate). Каскадный прекурсор для M5.',
    icon: 'composite',
    sortOrder: 13,
  },
  {
    id: 'superconductors',
    name: 'Сверхпроводники',
    nameEn: 'Superconductors',
    branch: 'materials',
    baseCost: 1500,
    maxLevel: 10,
    improvementType: 'threshold',
    improvementPerLevel: 0.10,
    prerequisites: [
      { techId: 'steel_processing', minLevel: 2 },
      { techId: 'microelectronics', minLevel: 1 },
    ],
    effects: [],
    description: 'Открывает рецепт «Сверхпроводник» (superconductor). Кросс-веточный преквизит (computing).',
    icon: 'super',
    sortOrder: 14,
  },

  // ─── Weapons (W) ──────────────────────────────────────
  {
    id: 'ballistic_weapons',
    name: 'Баллистическое оружие',
    nameEn: 'Ballistic weapons',
    branch: 'weapons',
    baseCost: 400,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.10,
    prerequisites: [],
    effects: [],
    description: 'Открывает модуль «Баллистическая турель» для кораблей.',
    icon: 'ballistic',
    sortOrder: 21,
  },
  {
    id: 'laser_weapons',
    name: 'Лазерное оружие',
    nameEn: 'Laser weapons',
    branch: 'weapons',
    baseCost: 700,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.12,
    prerequisites: [
      { techId: 'ballistic_weapons', minLevel: 2 },
      { techId: 'microelectronics', minLevel: 1 },
    ],
    effects: [],
    description: 'Открывает модуль «Лазерная пушка». Кросс-веточный преквизит (computing).',
    icon: 'laser',
    sortOrder: 22,
  },
  {
    id: 'fleet_tactics',
    name: 'Флотская тактика',
    nameEn: 'Fleet tactics',
    branch: 'weapons',
    baseCost: 600,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.05,
    prerequisites: [
      { techId: 'ballistic_weapons', minLevel: 1 },
    ],
    effects: [
      { target: 'fleet_combat_bonus', operation: 'add', value: 0.05, perLevel: true },
    ],
    description: '+5% к боевой эффективности флота на ур. Эффект применяется в Etap 4 (тактический бой).',
    icon: 'tactics',
    sortOrder: 23,
  },

  // ─── Computing (C) — свободная ветка, нет primary-потолка ────
  {
    id: 'microelectronics',
    name: 'Микроэлектроника',
    nameEn: 'Microelectronics',
    branch: 'computing',
    baseCost: 300,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.08,
    prerequisites: [],
    effects: [],
    description: 'Открывает рецепт «Микрочип» (microchip). Свободная ветка — потолка нет, только partial-бонус от Химии.',
    icon: 'chip',
    sortOrder: 31,
  },
  {
    id: 'short_range_sensors',
    name: 'Сенсоры ближнего радиуса',
    nameEn: 'Short-range sensors',
    branch: 'computing',
    baseCost: 500,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.10,
    prerequisites: [
      { techId: 'microelectronics', minLevel: 1 },
    ],
    effects: [],
    description: '+10% к дальности сканеров. Основа для C2-C12 (Etap 4).',
    icon: 'sensor',
    sortOrder: 32,
  },
  {
    id: 'communication_systems',
    name: 'Системы связи',
    nameEn: 'Communication systems',
    branch: 'computing',
    baseCost: 600,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.10,
    prerequisites: [
      { techId: 'microelectronics', minLevel: 1 },
    ],
    effects: [],
    description: '+10% к дальности связи флотов. Каскадный прекурсор для C3-C12.',
    icon: 'comm',
    sortOrder: 33,
  },

  // ─── Biology (B) ──────────────────────────────────────
  {
    id: 'hydroponics',
    name: 'Гидропоника',
    nameEn: 'Hydroponics',
    branch: 'biology',
    baseCost: 300,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.10,
    prerequisites: [],
    effects: [],
    description: '+10% к выходу еды (заглушка в MVP — эффект Etap 4 с терраформированием).',
    icon: 'hydro',
    sortOrder: 41,
  },
  {
    id: 'ecological_adaptation',
    name: 'Экологическая адаптация',
    nameEn: 'Ecological adaptation',
    branch: 'biology',
    baseCost: 500,
    maxLevel: 10,
    improvementType: 'linear',
    improvementPerLevel: 0.05,
    prerequisites: [
      { techId: 'hydroponics', minLevel: 1 },
    ],
    effects: [],
    description: '+5% к габитабельности планеты (заглушка в MVP).',
    icon: 'eco',
    sortOrder: 42,
  },
];

/** Map techId → Technology для O(1) lookup. */
export const TECH_MAP: Map<string, Technology> = new Map(
  TECH_TREE.map((t) => [t.id, t]),
);

/** Цвета специализированных веток для UI (60-research.md §2.1). */
export const BRANCH_COLORS: Record<SpecializedBranchId, string> = {
  power: '#ef4444',       // red-500
  materials: '#f97316',  // orange-500
  weapons: '#eab308',    // yellow-500
  computing: '#06b6d4',  // cyan-500 (изменено: blue запрещён дизайн-гайдлайнами)
  biology: '#22c55e',    // green-500
  xenoarch: '#a855f7',   // purple-500
};

/**
 * Стартовые технологии — доступны с самого начала (нет преквизитов).
 * По плану §2.3: 5 технологий без преквизитов:
 *   fusion_reactor (P1), steel_processing (M1), ballistic_weapons (W1),
 *   microelectronics (C1), hydroponics (B1).
 */
export const STARTER_TECH_IDS: string[] = [
  'fusion_reactor',
  'steel_processing',
  'ballistic_weapons',
  'microelectronics',
  'hydroponics',
];
