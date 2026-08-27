/**
 * Каталог атмосферных газов и элементов (gap-3, C3 — audit §2.3).
 *
 * Раньше эти карты были хардкодом внутри `engine.ts:152-169` и дублировались в
 * `chemistry-generator.ts:210-219, 1434-1436` — нарушение single-source-of-truth.
 *
 * Теперь единый источник правды — этот файл. Все потребители импортируют отсюда.
 *
 * Состав:
 * - `ATMOSPHERE_GAS_MAP` — тип атмосферы → список доступных газов для добычи
 *   (используется газовыми экстракторами).
 * - `DIRECT_GAS_MAP` — чистый газ → элемент (1:1 конверсия, переработка не нужна).
 *   Например, H2 → H, N2 → N.
 *
 * Источник данных:
 * - `docs/30-planets.md §2.4` — 8 типов атмосферы (none, thin, standard, dense, toxic, inert, methane, co2)
 * - `docs/33-chemistry.md §8` — атмосферные газы
 * - `docs/34-ores.md` — газовые соединения
 */

/**
 * Тип атмосферы → список газов, доступных для добычи газовым экстрактором.
 *
 * Состав синхронизирован с:
 * - `docs/30-planets.md` §2.4 (8 типов атмосферы)
 * - `docs/33-chemistry.md` §8 (атмосферные соединения)
 *
 * Газы:
 * - Чистые (одноатомные/двухатомные элементы): H2, He, Ne, Ar, N2, O2
 * - Сложные (требуют переработки через processor — см. recipes.ts P8):
 *   CO2, CH4, NH3, H2S, SO2
 */
export const ATMOSPHERE_GAS_MAP: Record<string, string[]> = {
  none: [],
  thin: ['N2', 'CO2'],
  standard: ['Ar', 'N2', 'CO2', 'O2'],
  dense: ['H2', 'He', 'Ar', 'N2', 'CO2', 'O2'],
  toxic: ['N2', 'CO2', 'NH3', 'H2S', 'SO2'],
  inert: ['He', 'Ne', 'Ar', 'N2'],
  methane: ['H2', 'CH4', 'NH3'],
  co2: ['N2', 'CO2'],
};

/**
 * Карта прямой конверсии чистых атмосферных газов в элементы (1:1).
 *
 * Сложные газы (CO2, CH4, NH3, H2S, SO2) НЕ входят в эту карту — они требуют
 * переработки через `processor` (см. `recipes.ts` P8 — process_CO2, process_CH4, ...).
 *
 * Эта карта используется для «лёгкой» конверсии, когда газ можно напрямую
 * превратить в элемент без реактора (например, H2 → H на orbital плазменном сепараторе).
 */
export const DIRECT_GAS_MAP: Record<string, string> = {
  'H2': 'H',
  'He': 'He',
  'Ne': 'Ne',
  'Ar': 'Ar',
  'N2': 'N',
  'O2': 'O',
};

/**
 * Обратная карта: элемент → чистый атмосферный газ (для генерации рудной модели).
 * Полезно для `chemistry-generator.ts` при создании BakedAtmospheric.
 */
export const GAS_ELEMENT_TO_ATMO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(DIRECT_GAS_MAP).map(([gasId, elementId]) => [elementId, gasId]),
);

/**
 * Получить список газов для типа атмосферы.
 * Возвращает пустой массив для неизвестных типов (включая 'none').
 */
export function getAtmosphericGasesForType(atmosphereType: string): string[] {
  return ATMOSPHERE_GAS_MAP[atmosphereType] ?? [];
}
