/**
 * Экспорты модуля галактики.
 */

// Генерация
export { generateGalaxy, DEFAULT_CONFIG } from './generator';
export type { GalaxyGenConfig } from './generator';

// Утилиты
export { generateHexGrid, hexDistance, hexNeighbors, axialToPixel, pixelToAxial } from './hex-grid';

// Модуль (для регистрации в ModuleRegistry)
export { GalaxyModule } from './galaxy-module';
