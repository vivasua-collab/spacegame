/**
 * R-27: авто-переработка базовых строительных ресурсов.
 *
 * Жалоба владельца 2026-08-31 (№2/№3/№4): «при наличии 3-х переработчиков
 * не меняется количество кремния, железа» — переработка существовала только
 * через ручную очередь производства. Решение: переработчик в базовой
 * комплектации (universal) автоматически перерабатывает руды БАЗОВЫХ
 * строительных ресурсов; специализация (metal_smelting / nonmetal_smelting)
 * даёт буст в рамках тех же базовых рецептов; продвинутые ресурсы —
 * другие здания (refinery / synthesizer) через ручную очередь.
 *
 * Базовые строительные ресурсы определены по каталогу зданий
 * (costPerLevel всех зданий surface/orbit/space): Fe, Si, Al, C, Cu, Ti (+U
 * в одном здании — добывается вручную через smelt_u).
 *
 * Движок: src/economy/engine.ts → processAutoProcessing(planet).
 * Правила Синергии processing_speed (mine_processor +15%,
 * warehouse_production +20%) применяются к скорости авто-переработки.
 */

/**
 * Рецепты авто-переработки (базовые строительные ресурсы).
 * Порядок = приоритет переработки (Fe → Si → Al → C → Cu → Ti).
 * Все рецепты: buildingId 'processor', 10 ед. руды за партию.
 */
export const BASE_CONSTRUCTION_RECIPE_IDS: readonly string[] = [
  'smelt_fe',
  'smelt_si',
  'smelt_al',
  'smelt_c',
  'smelt_cu',
  'smelt_ti',
];

/**
 * Базовая скорость авто-переработки: сколько единиц ВХОДА переработчик
 * обрабатывает за recipe.time тиков. 10 ед. входа / time — та же скорость,
 * что у ручной очереди (одна партия рецепта за recipe.time тиков).
 * Пример smelt_fe (time=5): 2 ед. Fe-ore за тик за экземпляр.
 */
export const AUTO_PROCESSING_BATCH_SIZE = 10;

/**
 * Множитель скорости за уровень здания: L1 = ×1.0, каждый уровень +15%
 * (та же прогрессия, что у добычи: 1 + (L−1)×0.15).
 */
export const AUTO_PROCESSING_LEVEL_INCREMENT = 0.15;

/**
 * Минимальный объём входа для запуска рецепта за тик (анти-джиттер:
 * не оставлять «пыль» от плавающих остатков).
 */
export const AUTO_PROCESSING_MIN_INPUT = 0.001;

/**
 * Категории специализации, участвующие в авто-режиме базовых ресурсов
 * («специализация даёт буст только в рамках базовых ресурсов» — владелец).
 * metal_smelting: smelt_fe/ti/cu/al; nonmetal_smelting: smelt_si/c.
 * Прочие категории (chemical_decomp, ice_melting, gas_processing,
 * deep_ore_smelting, alloy_synthesis) — продвинутые цепочки, только ручная
 * очередь / специализированные здания.
 */
export const AUTO_SPECIALIZATIONS: readonly string[] = [
  'metal_smelting',
  'nonmetal_smelting',
];
