/**
 * Экспорты модуля галактики.
 */

export { generateGalaxy, DEFAULT_CONFIG } from './generator';
export type { GalaxyGenConfig } from './generator';
export { generateHexGrid, hexDistance, hexNeighbors, axialToPixel, pixelToAxial } from './hex-grid';
