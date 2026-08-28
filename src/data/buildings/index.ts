/**
 * R-BLD-MOD: модульная data-driven система построек.
 *
 * Здания теперь хранятся во внешних JSON-файлах, организованных по
 * слою размещения:
 *   - surface.json — поверхность планеты (+ атмосфера газ. гигантов)
 *   - orbit.json   — орбитальные слоты вокруг планеты
 *   - space.json   — глубокий космос / вокруг звезды (post-MVP слой)
 *
 * Каждый файл — объект `{ "comment": "...", "buildings": BuildingDef[] }`.
 * Loader загружает все 3 файла, объединяет в единый BUILDINGS-массив и
 * строит BUILDING_MAP для O(1) поиска по id.
 *
 * DATA-DRIVEN: добавление записи в любой JSON-файл автоматически делает
 * здание доступным:
 *   - в UI постройки (если слой соответствует открытому слоту планеты/звезды)
 *   - в справочнике зданий (reference-dialog, вкладка «Здания»)
 *   - в bonus-resolver (если у здания есть поле bonuses)
 *   - в engine.buildOnHex/AtmosphereSlot/OrbitSlot (если layer подходит)
 *
 * Поля BuildingDef (см. src/core/types.ts):
 *   - id, name, description, category, layer[], size[], energyConsumption,
 *     baseProductionTime, levels, costPerLevel, terrainBonus, requiresAtmosphere
 *   - requiresTechs?: { techId, minLevel }[]  — технологии для ОТКРЫТИЯ постройки
 *   - terrainTypes?:  HexTerrain[]             — allowlist местности (иначе любая)
 *   - bonuses?: Bonus[]                        — бонусы (building-sourced ИЛИ
 *                                                 tech-sourced через sourceTech)
 *
 * Совместимость: публичный API (BUILDINGS, BUILDING_MAP, CATEGORY_NAMES,
 * CATEGORY_ICONS, LAYER_NAMES) сохранён — все 11 потребителей работают
 * без правок импортов.
 *
 * Источник истины: src/data/buildings/{surface,orbit,space}.json
 * Спека типов: src/core/types.ts (BuildingDef, Bonus, BuildingLayer)
 */

import type { BuildingDef, BuildingLayer } from '@/core/types';
import surfaceData from './surface.json';
import orbitData from './orbit.json';
import spaceData from './space.json';

type BuildingsFile = { comment?: string; buildings: BuildingDef[] };

const surfaceBuildings = (surfaceData as unknown as BuildingsFile).buildings;
const orbitBuildings = (orbitData as unknown as BuildingsFile).buildings;
const spaceBuildings = (spaceData as unknown as BuildingsFile).buildings;

/**
 * Единый каталог всех зданий (data-driven из 3 JSON-файлов).
 * Порядок: surface → orbit → space (сохраняется для предсказуемого UI).
 */
export const BUILDINGS: BuildingDef[] = [
  ...surfaceBuildings,
  ...orbitBuildings,
  ...spaceBuildings,
];

/** Map buildingId → BuildingDef для O(1) поиска. */
export const BUILDING_MAP = new Map<string, BuildingDef>(
  BUILDINGS.map((b) => [b.id, b]),
);

export const CATEGORY_NAMES: Record<string, string> = {
  colonization: 'Колонизация',
  extraction: 'Добыча',
  processing: 'Переработка',
  production: 'Производство',
  energy: 'Энергия',
  military: 'Военные',
  research: 'Исследования',
  logistics: 'Логистика',
};

export const CATEGORY_ICONS: Record<string, string> = {
  colonization: '🏠',
  extraction: '⛏️',
  processing: '🔥',
  production: '🏗️',
  energy: '⚡',
  military: '⚔️',
  research: '🔬',
  logistics: '🚚',
};

export const LAYER_NAMES: Record<BuildingLayer, string> = {
  surface: 'Поверхность',
  atmosphere: 'Атмосфера',
  orbit: 'Орбита',
  space: 'Космос',
};

// ─── Хелперы для requiresTechs-гейта ──────────────────────────────────

/**
 * Проверяет, выполнены ли все технологические требования для постройки здания.
 *
 * @param building   — определение здания (читаем requiresTechs)
 * @param researched — карта researchState.researched (techId → уровень)
 * @returns true если здание может быть построено (все requiresTechs met
 *          или поле отсутствует).
 *
 * Используется:
 *   - engine.buildOnHex/buildOnAtmosphereSlot/buildOnOrbitSlot (валидация)
 *   - building-dialog.tsx BuildList (UI-фильтр — скрыть недоступные здания)
 */
export function areBuildingTechsMet(
  building: BuildingDef,
  researched: Record<string, number>,
): boolean {
  if (!building.requiresTechs || building.requiresTechs.length === 0) return true;
  for (const req of building.requiresTechs) {
    const level = researched[req.techId] ?? 0;
    if (level < req.minLevel) return false;
  }
  return true;
}
