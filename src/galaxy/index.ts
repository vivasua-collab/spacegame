/**
 * Экспорты модуля галактики.
 *
 * Структура модуля:
 * - generator.ts      — ОРКЕСТРАТОР (generateGalaxy, GalaxyGenConfig)
 * - gen-context.ts    — общий контекст (genId, usedNames, resetGenContext)
 * - generate-positions.ts — позиции систем (спираль, ядро, диск, ореол)
 * - generate-systems.ts   — звёздные системы (звёзды, компаньоны, имена)
 * - generate-planets.ts   — планеты (тип, атмосфера, температура, жизнь)
 * - generate-resources.ts — ресурсы (deposits, ultra-rare)
 * - generate-jump-points.ts — Jump Points + связность
 * - hex-grid.ts           — гексагональная сетка
 */

export { generateGalaxy, DEFAULT_CONFIG } from './generator';
export type { GalaxyGenConfig } from './generator';
export { generateHexGrid, hexDistance, hexNeighbors, axialToPixel, pixelToAxial } from './hex-grid';
