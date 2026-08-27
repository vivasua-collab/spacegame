/**
 * Block 02 (F2): Конструктор кораблей — расчёт и валидация дизайна.
 *
 * MVP-реализация docs/50-ships.md §1.6 + Приложение B (validateShip).
 *
 * Функции:
 * - armorMultiplier(armor) — множители обшивки для HP/mass/cost (§2.3)
 * - validateShip(design, ctx) — проверить дизайн на правила Приложения B
 * - calculateDesignStats(design) — рассчитать DesignStats
 *
 * Логика чистая (без side-effects), тестируется unit-тестами.
 */

import type {
  HullArmorThickness,
  ShipDesign,
  ShipModule,
  SlotType,
  FuelType,
  EntityId,
} from '@/core/types';
import { HULL_MAP, getHull } from '@/data/ships/hulls';
import { MODULE_MAP } from '@/data/ships/modules';

/**
 * Множители обшивки — docs/50-ships.md §2.3.
 *
 * light    : { hpMult: 1.00, massMult: 1.00, costMult: 1.00 }
 * standard : { hpMult: 1.25, massMult: 1.10, costMult: 1.20 }
 * thick    : { hpMult: 1.50, massMult: 1.25, costMult: 1.50 }
 * heavy    : { hpMult: 2.00, massMult: 1.50, costMult: 2.00 }
 *
 * hpMult   — применён к hull.baseHP → итоговый HP корпуса
 * massMult — применён к hull.baseMass + модули (масса обшивки)
 * costMult — применён к hull.baseCost (модули не множатся — у каждого свой cost)
 */
export function armorMultiplier(armor: HullArmorThickness): {
  hpMult: number;
  massMult: number;
  costMult: number;
} {
  switch (armor) {
    case 'light':
      return { hpMult: 1.0, massMult: 1.0, costMult: 1.0 };
    case 'standard':
      return { hpMult: 1.25, massMult: 1.1, costMult: 1.2 };
    case 'thick':
      return { hpMult: 1.5, massMult: 1.25, costMult: 1.5 };
    case 'heavy':
      return { hpMult: 2.0, massMult: 1.5, costMult: 2.0 };
    default: {
      const _exhaustive: never = armor;
      void _exhaustive;
      return { hpMult: 1.0, massMult: 1.0, costMult: 1.0 };
    }
  }
}

/** Полный набор расчётных характеристик дизайна корабля. */
export interface DesignStats {
  /** hull.totalHS — полная вместимость корпуса (HS) */
  totalHS: number;
  /** сумма HS всех модулей (занятый объём) */
  usedHS: number;
  /** свободный HS = totalHS − usedHS */
  freeHS: number;
  /** масса (т) = (hull.baseMass + Σmodules.mass) × armorMult.massMult */
  mass: number;
  /** скорость (км/с) = thrust / mass × 10 (§3.1) — 0 если нет массы/тяги */
  speed: number;
  /** суммарная тяга двигателей (кН) */
  thrust: number;
  /** энергобаланс (МВт) = Σreactor.energyOutput − Σmodules.energyConsumption */
  energyBalance: number;
  /** итоговый HP корпуса = hull.baseHP × armorMult.hpMult + Σarmor.hpPerHS × armor.moduleHS */
  totalHP: number;
  /** суммарный HP щитов = Σshield.shieldHP */
  shieldHP: number;
  /** стоимость в у.е.р. = hull.baseCost × armorMult.costMult + Σmodules.cost */
  cost: number;
  /** грузоподъёмность (т) = Σcargo.capacity */
  cargoCapacity: number;
  /** вместимость топливных баков по типам топлива */
  fuelCapacity: Record<string, number>;
  /** мин. масса прыжка (т) = min(jump_drive.maxJumpMass) — 0 если нет прыжкового */
  jumpRangeMass: number;
  /** дальность связи (св. лет) = max(comm.communicationRange) */
  commRange: number;
  /** дальность сканирования (а.е.) = max(scanner.capacity) */
  scanRange: number;
  /** true если есть хотя бы 1 jump_drive или warp engine */
  canJump: boolean;
  /** true если дизайн прошёл validateShip */
  isValid: boolean;
  /** список ошибок валидации (пустой, если isValid) */
  errors: string[];
}

/** Пустой DesignStats — для удобства тестов. */
function emptyStats(): DesignStats {
  return {
    totalHS: 0,
    usedHS: 0,
    freeHS: 0,
    mass: 0,
    speed: 0,
    thrust: 0,
    energyBalance: 0,
    totalHP: 0,
    shieldHP: 0,
    cost: 0,
    cargoCapacity: 0,
    fuelCapacity: {},
    jumpRangeMass: 0,
    commRange: 0,
    scanRange: 0,
    canJump: false,
    isValid: false,
    errors: [],
  };
}

/**
 * Внутренний helper: собрать список модулей из дизайна (пропуская неизвестные ID).
 */
function resolveModules(design: ShipDesign): ShipModule[] {
  const out: ShipModule[] = [];
  for (const id of design.moduleIds) {
    const m = MODULE_MAP.get(id);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Подсчитать кол-во модулей в каждой slot-категории.
 * Слоты корпуса: weaponSlots/engineSlots/systemSlots/defenseSlots.
 * Модуль с slotRestriction='any' НЕ занимает конкретный слот — он
 * использует только HS (общий объём корпуса). Это позволяет вспомогательным
 * модулям (cargo, fuel_tank, scanner, jump_drive, reactor, colony) не
 * конкурировать за системные слоты с ЦПУ/связью/навигатором.
 */
function countSlots(modules: ShipModule[]): {
  weapon: number;
  engine: number;
  system: number;
  defense: number;
} {
  let weapon = 0, engine = 0, system = 0, defense = 0;
  for (const m of modules) {
    const slot: SlotType = m.slotRestriction ?? 'any';
    switch (slot) {
      case 'weapon': weapon++; break;
      case 'engine': engine++; break;
      case 'system': system++; break;
      case 'defense': defense++; break;
      case 'any': /* не занимает конкретный слот — только HS */ break;
    }
  }
  return { weapon, engine, system, defense };
}

/**
 * Контекст валидации дизайна.
 * - shipyardLevel — уровень верфи на выбранной планете игрока (UI передаёт
 *   реальный; unit-тесты могут не указывать — по умолчанию 99 = «без гейта»).
 * - engineeringLevel — уровень фундаментальной ветки engineering.
 * - researchedTechs — список исследованных технологий; ['all'] отключает
 *   проверку requiredTechs (для тестов).
 */
export interface DesignValidationCtx {
  shipyardLevel: number;
  engineeringLevel: number;
  researchedTechs: string[];
}

/**
 * «Разрешающий всё» контекст по умолчанию — все гейты tech/level
 * дезактивированы. Удобен для unit-тестов и для расчёта характеристик
 * (calculateDesignStats), где валидность — производная, а не фильтр.
 *
 * Audit Pass 4 P1-1: раньше это была константа TEST_CTX в
 * `ship-designer.tsx`, и UI валидировал дизайны как валидные всегда.
 * Теперь UI передаёт реальный shipyardLevel с выбранной планеты;
 * engineeringLevel/res researchedTechs остаются разрешающими (нет
 * отдельной задачи «полировать engineering gate» в MVP scope).
 */
export const PERMISSIVE_CTX: DesignValidationCtx = {
  shipyardLevel: 99,
  engineeringLevel: 99,
  researchedTechs: ['all'],
};

/**
 * Рассчитать полные характеристики дизайна — docs/50-ships.md §1.6.
 *
 * Не требует ctx (только данные дизайна + каталог hulls/modules).
 * Возвращает DesignStats с заполненными полями; isValid/errors
 * проставляются из validateShip с дефолтным ctx (нет tech/level гейтов).
 *
 * @param ctx необязательный контекст валидации. По умолчанию PERMISSIVE_CTX
 *             (гейты отключены) — backward-compat с unit-тестами.
 */
export function calculateDesignStats(
  design: ShipDesign,
  ctx: DesignValidationCtx = PERMISSIVE_CTX,
): DesignStats {
  const hull = getHull(design.hullId);
  const stats = emptyStats();
  if (!hull) {
    stats.errors.push(`Неизвестный корпус: ${design.hullId}`);
    stats.isValid = false;
    return stats;
  }
  const armorMult = armorMultiplier(design.armor);
  const modules = resolveModules(design);

  // HS
  stats.totalHS = hull.totalHS;
  stats.usedHS = modules.reduce((s, m) => s + m.size, 0);
  stats.freeHS = stats.totalHS - stats.usedHS;

  // Масса = (hull.baseMass + Σmodules.mass) × massMult
  const modulesMass = modules.reduce((s, m) => s + m.mass, 0);
  stats.mass = (hull.baseMass + modulesMass) * armorMult.massMult;

  // Тяга
  stats.thrust = modules.reduce((s, m) => s + (m.thrust ?? 0), 0);

  // Скорость = thrust / mass × 10 (§3.1)
  stats.speed = stats.mass > 0 ? (stats.thrust / stats.mass) * 10 : 0;

  // Энергобаланс = Σ(reactor.energyOutput) − Σ(modules.energyConsumption)
  // Реакторы — это auxiliary с auxiliaryType='reactor' и energyOutput > 0.
  // Сам реактор не «потребляет» энергию (energyConsumption=0), но все остальные
  // модули потребляют. Двигатели тоже потребляют (ion engines ionize gas).
  let production = 0;
  let consumption = 0;
  for (const m of modules) {
    if (m.energyOutput && m.energyOutput > 0) production += m.energyOutput;
    consumption += m.energyConsumption;
  }
  stats.energyBalance = production - consumption;

  // HP корпуса = hull.baseHP × hpMult + Σ(armor.hpPerHS × armor.size)
  let armorHP = 0;
  for (const m of modules) {
    if (m.defenseType === 'armor' && m.hpPerHS !== undefined) {
      armorHP += m.hpPerHS * m.size;
    }
  }
  stats.totalHP = Math.round(hull.baseHP * armorMult.hpMult + armorHP);

  // Щиты
  stats.shieldHP = modules.reduce(
    (s, m) => s + (m.defenseType === 'shield' ? (m.shieldHP ?? 0) : 0),
    0,
  );

  // Стоимость = hull.baseCost × costMult + Σmodules.cost
  const modulesCost = modules.reduce((s, m) => s + m.cost, 0);
  stats.cost = Math.round(hull.baseCost * armorMult.costMult + modulesCost);

  // Грузоподъёмность
  stats.cargoCapacity = modules.reduce(
    (s, m) => s + (m.auxiliaryType === 'cargo' ? (m.capacity ?? 0) : 0),
    0,
  );

  // Топливные баки
  const fuelCap: Record<string, number> = {};
  for (const m of modules) {
    if (m.auxiliaryType === 'fuel_tank' && m.fuelType) {
      const ft: FuelType = m.fuelType;
      fuelCap[ft] = (fuelCap[ft] ?? 0) + (m.capacity ?? 0);
    }
  }
  stats.fuelCapacity = fuelCap;

  // Прыжковая масса = min(jump_drive.maxJumpMass) — самый слабый jump_drive ограничивает.
  const jumpMasses = modules
    .filter(m => m.auxiliaryType === 'jump_drive' && m.maxJumpMass !== undefined)
    .map(m => m.maxJumpMass as number);
  stats.jumpRangeMass = jumpMasses.length > 0 ? Math.min(...jumpMasses) : 0;
  stats.canJump = jumpMasses.length > 0;

  // Дальность связи = max(comm.communicationRange)
  const commRanges = modules
    .filter(m => m.controlType === 'communication' && m.communicationRange !== undefined)
    .map(m => m.communicationRange as number);
  stats.commRange = commRanges.length > 0 ? Math.max(...commRanges) : 0;

  // Дальность сканирования = max(scanner.capacity)
  const scanRanges = modules
    .filter(m => m.auxiliaryType === 'scanner' && m.capacity !== undefined)
    .map(m => m.capacity as number);
  stats.scanRange = scanRanges.length > 0 ? Math.max(...scanRanges) : 0;

  // Валидность — вызывает validateShip с ctx (по умолчанию PERMISSIVE_CTX).
  const validation = validateShip(design, ctx);
  stats.isValid = validation.valid;
  stats.errors = validation.errors;

  return stats;
}

/**
 * Проверить дизайн на правила Приложения B docs/50-ships.md.
 *
 * Правила (MVP-набор):
 * 1. Hull существует в каталоге.
 * 2. Все moduleId существуют в каталоге.
 * 3. ЦПУ присутствует (controlType === 'cpu').
 * 4. ≥1 двигатель (category === 'engine').
 * 5. Σmodules.size ≤ hull.totalHS.
 * 6. Кол-во модулей в каждом slot ≤ hull.*Slots.
 * 7. ЦПУ подходит для корпуса (minHull check — см. §4.2 таблицу).
 * 8. armor входит в hull.armorOptions.
 * 9. Все requiredTechs модулей + корпуса исследованы (если ctx.researchedTechs !== ['all']).
 * 10. shipyardLevel ≥ hull.requiredShipyardLevel.
 * 11. engineeringLevel ≥ hull.requiredEngineeringLevel.
 *
 * Энергобаланс НЕ входит в validity-check (это «стат», не «блокер»).
 * Игрок может спроектировать корабль с дефицитом энергии — он будет
 * медленнее/неэффективнее, но построить его можно.
 *
 * @returns { valid: boolean; errors: string[] } — errors[] пуст при valid
 */
export function validateShip(
  design: ShipDesign,
  ctx: DesignValidationCtx,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Hull существует
  const hull = HULL_MAP.get(design.hullId);
  if (!hull) {
    errors.push(`Неизвестный корпус: ${design.hullId}`);
    return { valid: false, errors };
  }

  // 2. Все moduleId существуют
  const modules: ShipModule[] = [];
  for (const id of design.moduleIds) {
    const m = MODULE_MAP.get(id);
    if (!m) {
      errors.push(`Неизвестный модуль: ${id}`);
    } else {
      modules.push(m);
    }
  }

  // 3. ЦПУ присутствует (controlType === 'cpu')
  const hasCpu = modules.some(m => m.controlType === 'cpu');
  if (!hasCpu) {
    errors.push('Отсутствует ЦПУ (модуль control с controlType=cpu)');
  }

  // 4. ≥1 двигатель (category === 'engine')
  const engineCount = modules.filter(m => m.category === 'engine').length;
  if (engineCount < 1) {
    errors.push('Нужен хотя бы 1 двигатель (category=engine)');
  }

  // 5. Σmodules.size ≤ hull.totalHS
  const usedHS = modules.reduce((s, m) => s + m.size, 0);
  if (usedHS > hull.totalHS) {
    errors.push(
      `Превышен объём корпуса: ${usedHS} HS > ${hull.totalHS} HS`,
    );
  }

  // 6. Кол-во модулей в каждом slot ≤ hull.*Slots
  const slots = countSlots(modules);
  if (slots.weapon > hull.weaponSlots) {
    errors.push(
      `Слишком много оружейных модулей: ${slots.weapon} > ${hull.weaponSlots}`,
    );
  }
  if (slots.engine > hull.engineSlots) {
    errors.push(
      `Слишком много двигателей: ${slots.engine} > ${hull.engineSlots}`,
    );
  }
  if (slots.system > hull.systemSlots) {
    errors.push(
      `Слишком много системных модулей: ${slots.system} > ${hull.systemSlots}`,
    );
  }
  if (slots.defense > hull.defenseSlots) {
    errors.push(
      `Слишком много оборонительных модулей: ${slots.defense} > ${hull.defenseSlots}`,
    );
  }

  // 7. ЦПУ подходит для корпуса (minHull check)
  // minHull: 'scout' | 'fighter' | 'frigate' | ... — ЦПУ нельзя ставить на корпус
  // меньшего размера. Например, ЦПУ-Лёгкий (minHull='fighter') нельзя ставить на Скаут.
  const hullSizeOrder: Record<string, number> = {
    scout: 1, fighter: 2, frigate: 3, cruiser: 4, battleship: 5, transport: 3, flagship: 6,
  };
  const hullSizeValue = hullSizeOrder[hull.size] ?? 0;
  for (const m of modules) {
    if (m.minHull) {
      const minHullValue = hullSizeOrder[m.minHull] ?? 0;
      if (hullSizeValue < minHullValue) {
        errors.push(
          `ЦПУ ${m.name} требует корпус ≥ ${m.minHull}; текущий: ${hull.size}`,
        );
      }
    }
  }

  // 8. armor входит в hull.armorOptions
  if (!hull.armorOptions.includes(design.armor)) {
    errors.push(
      `Обшивка ${design.armor} недоступна для корпуса ${hull.name} (доступно: ${hull.armorOptions.join(', ')})`,
    );
  }

  // 9. Все requiredTechs модулей + корпуса исследованы
  // Для MVP все requiredTechs = [] (см. risk R3 плана). Если ctx.researchedTechs
  // содержит 'all' — пропускаем проверку (для тестов).
  if (!ctx.researchedTechs.includes('all')) {
    for (const m of modules) {
      for (const tech of m.requiredTechs) {
        if (!ctx.researchedTechs.includes(tech)) {
          errors.push(`Не исследована технология: ${tech} (нужна для ${m.name})`);
        }
      }
    }
  }

  // 10. shipyardLevel ≥ hull.requiredShipyardLevel
  if (ctx.shipyardLevel < hull.requiredShipyardLevel) {
    errors.push(
      `Верфь слишком низкого уровня: ${ctx.shipyardLevel} < ${hull.requiredShipyardLevel}`,
    );
  }

  // 11. engineeringLevel ≥ hull.requiredEngineeringLevel
  if (ctx.engineeringLevel < hull.requiredEngineeringLevel) {
    errors.push(
      `Инженерия слишком низкого уровня: ${ctx.engineeringLevel} < ${hull.requiredEngineeringLevel}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Создать пустой дизайн-черновик с указанным корпусом и обшивкой.
 * Удобно для UI: пользователь выбирает корпус → получает пустой дизайн.
 */
export function createBlankDesign(
  hullId: string,
  armor: HullArmorThickness,
  owner: EntityId,
  designId: EntityId,
  name: string,
  createdAtTick: number,
): ShipDesign {
  return {
    id: designId,
    name,
    hullId,
    armor,
    moduleIds: [],
    owner,
    createdAtTick,
  };
}
