/// <reference types="bun-types" />
/**
 * Block 05 (категорийная модель — ОСТАЛАСЬ только для refinery/synthesizer)
 * + PROC-WORKSHOPS-01 (множители выхода цехов).
 *
 * Специализация ЦЕХОВ processor/construction_materials_plant (необратимая,
 * по recipeId) тестируется в tests/economy/workshops.test.ts; здесь —
 * формулы выхода:
 *  - calculateProcessorOutputMultiplier (legacy: universal/specialized
 *    ветки категорийной модели — потребитель: карусель refinery/synthesizer);
 *  - calculateWorkshopOutputMultiplier (цеха: специалист на профильном
 *    рецепте / обычный и fallback без второго штрафа);
 *  - категории рецептов (resolveProcessorCategory) — для категорийных
 *    зданий; базовые 6 рецептов R-27 переехали на завод (пул стройматериалов).
 *
 * Run: bun test tests/economy/processors.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { calculateProcessorOutputMultiplier } from '@/economy/engine';
import { calculateWorkshopOutputMultiplier } from '@/economy/workshop-scheduler';
import { BUILDING_MAP, BUILDINGS } from '@/data/buildings';
import { RECIPES, RECIPE_MAP } from '@/data/recipes';
import { resolveProcessorCategory } from '@/data/processor-recipe-categories';
import { BASE_CONSTRUCTION_RECIPE_IDS } from '@/data/auto-processing';
import type {
  Planet,
  HexCell,
  ProcessorType,
  ProcessorRecipeCategory,
  BuildingDef,
  RecipeDef,
  GameTime,
  GameState,
  WorkshopState,
} from '@/core/types';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeProcessorInstance(
  processorType: ProcessorType,
  specializationLevel = 0,
  specialization?: ProcessorRecipeCategory,
  activeRecipes: string[] = [],
): { processorType: ProcessorType; specialization?: ProcessorRecipeCategory; specializationLevel: number; activeRecipes: string[] } {
  return { processorType, specialization, specializationLevel, activeRecipes };
}

function makePlanet(): Planet {
  return {
    id: 'test_planet',
    systemId: 'test_system',
    name: 'Test Planet',
    type: 'rocky',
    size: 'medium',
    radiusKm: 6371,
    density: 5.51,
    gravity: 1.0,
    temperature: 20,
    atmosphere: { type: 'standard', pressure: 1, composition: [] },
    life: { level: 'none', biodiversity: 0, compatibleWithColonists: false, hazardLevel: 0 },
    orbitNumber: 1,
    orbitalRadius: 1,
    orbitalPeriod: 365,
    hexes: [],
    atmosphericSlots: [],
    orbitSlots: [],
    resourceDeposits: [],
    orePools: [],
    resources: {},
    energyBalance: 1000,
    owner: 'player',
  } as unknown as Planet;
}

function makeHex(buildingId: string, level: number): HexCell {
  return {
    coord: { q: 0, r: 0 },
    terrain: 'plains',
    buildingId,
    buildingLevel: level,
  };
}

// ─── T5.1: Universal мульти-рецептный штраф (legacy-карусель) ───────────

describe('Block 05 T5.1 — универсальный множитель (legacy: refinery/synthesizer карусель)', () => {
  const processorDef = BUILDING_MAP.get('processor')!;
  const refineryDef = BUILDING_MAP.get('refinery')!;

  test('Universal with 1 active recipe → no penalty (yieldMult = baseYield × 1.0)', () => {
    const result = calculateProcessorOutputMultiplier(processorDef, makeProcessorInstance('universal', 0, undefined, ['smelt_cr']));
    expect(result.yieldMult).toBeCloseTo(0.75, 5);
    expect(result.purity).toBeCloseTo(0.78, 5);
  });

  test('Universal with 3 active recipes → penalty 1/sqrt(3) ≈ 0.577', () => {
    const result = calculateProcessorOutputMultiplier(processorDef, makeProcessorInstance('universal', 0, undefined, ['a', 'b', 'c']));
    expect(result.yieldMult).toBeCloseTo(0.75 / Math.sqrt(3), 5);
  });

  test('Refinery (specialized L1): yieldMult = 1.0, purity = 0.92', () => {
    const result = calculateProcessorOutputMultiplier(refineryDef, makeProcessorInstance('specialized', 1, 'metal_smelting'));
    expect(result.yieldMult).toBeCloseTo(1.0, 5);
    expect(result.purity).toBeCloseTo(0.92, 5);
  });

  test('Refinery L5: yieldMult = 1.08, purity = 0.99', () => {
    const result = calculateProcessorOutputMultiplier(refineryDef, makeProcessorInstance('specialized', 5, 'metal_smelting'));
    expect(result.yieldMult).toBeCloseTo(1.08, 5);
    expect(result.purity).toBeCloseTo(0.99, 5);
  });
});

// ─── PROC-WORKSHOPS-01: множители выхода цехов ──────────────────────────

describe('PROC-WORKSHOPS-01 — calculateWorkshopOutputMultiplier', () => {
  const plantDef = BUILDING_MAP.get('construction_materials_plant')!;
  const processorDef = BUILDING_MAP.get('processor')!;

  test('Обычный цех: ×0.75 / 0.78 (одна партия — штрафа мультирецепта нет)', () => {
    const ws: WorkshopState = {};
    const out = calculateWorkshopOutputMultiplier(plantDef, ws, 'smelt_fe');
    expect(out.yieldMult).toBeCloseTo(0.75, 5);
    expect(out.purity).toBeCloseTo(0.78, 5);
  });

  test('Специалист на ПРОФИЛЬНОМ рецепте: ×1.0 / 0.92 (L1)', () => {
    const ws: WorkshopState = { specializationRecipeId: 'smelt_fe', specializationLevel: 1 };
    const out = calculateWorkshopOutputMultiplier(plantDef, ws, 'smelt_fe');
    expect(out.yieldMult).toBeCloseTo(1.0, 5);
    expect(out.purity).toBeCloseTo(0.92, 5);
  });

  test('Специалист на НЕпрофильном рецепте (fallback): ×0.75 / 0.78 — БЕЗ второго штрафа', () => {
    const ws: WorkshopState = { specializationRecipeId: 'smelt_fe', specializationLevel: 5 };
    const out = calculateWorkshopOutputMultiplier(plantDef, ws, 'smelt_si');
    // Базовый коэффициент processor ×0.75; дополнительный штраф за
    // несовпадение НЕ перемножается (Issue #23 п.8).
    expect(out.yieldMult).toBeCloseTo(0.75, 5);
    expect(out.purity).toBeCloseTo(0.78, 5);
  });

  test('Специалист L1→L5 на профильном: монотонный рост yieldMult/purity', () => {
    let prevYield = 0;
    let prevPurity = 0;
    for (let lvl = 1; lvl <= 5; lvl++) {
      const ws: WorkshopState = { specializationRecipeId: 'smelt_fe', specializationLevel: lvl };
      const out = calculateWorkshopOutputMultiplier(plantDef, ws, 'smelt_fe');
      expect(out.yieldMult).toBeGreaterThan(prevYield);
      expect(out.purity).toBeGreaterThan(prevPurity);
      prevYield = out.yieldMult;
      prevPurity = out.purity;
    }
    expect(prevYield).toBeCloseTo(1.08, 5);
    expect(prevPurity).toBeCloseTo(0.99, 5);
  });

  test('Processor-цех: те же формулы (общий компонент обоих пулов)', () => {
    const ws: WorkshopState = { specializationRecipeId: 'smelt_cr', specializationLevel: 3 };
    const out = calculateWorkshopOutputMultiplier(processorDef, ws, 'smelt_cr');
    expect(out.yieldMult).toBeCloseTo(1.04, 5);
    expect(out.purity).toBeCloseTo(0.955, 5);
  });
});

// ─── T5.8: категории рецептов (категорийная модель refinery/synthesizer) ──

describe('Block 05 T5.8 — категории рецептов (категорийные здания)', () => {
  test('Every refinery/synthesizer recipe has a valid processorCategory', () => {
    const categoryBuildings = new Set(['refinery', 'synthesizer']);
    const recipes = RECIPES.filter((r) => categoryBuildings.has(r.buildingId));
    expect(recipes.length).toBeGreaterThan(0);
    for (const recipe of recipes) {
      const assignment = resolveProcessorCategory(recipe.id, recipe.buildingId);
      expect(assignment).toBeDefined();
    }
  });

  test('Shipyard recipes do NOT have processorCategory', () => {
    const shipyardRecipes = RECIPES.filter((r) => r.buildingId === 'shipyard');
    expect(shipyardRecipes.length).toBeGreaterThan(0);
    for (const recipe of shipyardRecipes) {
      expect(resolveProcessorCategory(recipe.id, 'shipyard')).toBeUndefined();
    }
  });

  test('PROC-WORKSHOPS-01: 6 базовых рецептов R-27 принадлежат заводу стройматериалов', () => {
    for (const recipeId of BASE_CONSTRUCTION_RECIPE_IDS) {
      const recipe = RECIPE_MAP.get(recipeId);
      expect(recipe).toBeDefined();
      expect(recipe!.buildingId).toBe('construction_materials_plant');
    }
  });

  test('PROC-WORKSHOPS-01: ни один рецепт processor не входит в базовый список R-27', () => {
    const processorRecipes = RECIPES.filter((r) => r.buildingId === 'processor');
    expect(processorRecipes.length).toBeGreaterThan(0);
    for (const recipe of processorRecipes) {
      expect(BASE_CONSTRUCTION_RECIPE_IDS).not.toContain(recipe.id);
    }
  });

  test('Цеховые здания помечены usesWorkshops; refinery/synthesizer — нет', () => {
    expect(BUILDING_MAP.get('processor')!.usesWorkshops).toBe(true);
    expect(BUILDING_MAP.get('construction_materials_plant')!.usesWorkshops).toBe(true);
    expect(BUILDING_MAP.get('refinery')!.usesWorkshops ?? false).toBe(false);
    expect(BUILDING_MAP.get('synthesizer')!.usesWorkshops ?? false).toBe(false);
  });

  test('Каталог специализаций цехов: 6 строительных + прочие processor-рецепты', () => {
    // Проверяется через getWorkshopSpecializationsForBuilding.
    const { getWorkshopSpecializationsForBuilding } = require('@/data/workshop-specializations');
    const construction = getWorkshopSpecializationsForBuilding('construction_materials_plant');
    const advanced = getWorkshopSpecializationsForBuilding('processor');
    expect(construction.length).toBe(6);
    expect(construction.map((s: { id: string }) => s.id).sort()).toEqual([...BASE_CONSTRUCTION_RECIPE_IDS].sort());
    expect(advanced.length).toBeGreaterThan(0);
    // Продвинутый пул НЕ содержит базовые рецепты.
    for (const spec of advanced) {
      expect(BASE_CONSTRUCTION_RECIPE_IDS).not.toContain(spec.id);
    }
  });
});

// ─── Чистота: порог 0.9 (электроника) — цеховая модель ──────────────────

describe('Чистота продукции (цеховая модель)', () => {
  const plantDef = BUILDING_MAP.get('construction_materials_plant')!;

  test('Обычный цех: чистота 0.78 < 0.9 (техническая)', () => {
    const out = calculateWorkshopOutputMultiplier(plantDef, {}, 'smelt_si');
    expect(out.purity).toBeLessThan(0.9);
  });

  test('Специалист (профиль): чистота 0.92+ ≥ 0.9 (высшая)', () => {
    const ws: WorkshopState = { specializationRecipeId: 'smelt_si', specializationLevel: 1 };
    const out = calculateWorkshopOutputMultiplier(plantDef, ws, 'smelt_si');
    expect(out.purity).toBeGreaterThanOrEqual(0.9);
  });
});

// ─── Утилита: makeHex совместимость типов (компиляция) ──────────────────

describe('Типы данных', () => {
  test('BuildingDef: поля цеховой модели присутствуют у обоих зданий', () => {
    const defs: BuildingDef[] = [
      BUILDING_MAP.get('processor')!,
      BUILDING_MAP.get('construction_materials_plant')!,
    ];
    for (const def of defs) {
      expect(def.baseYield).toBeCloseTo(0.75, 5);
      expect(def.basePurity).toBeCloseTo(0.78, 5);
      expect(def.specializeCost).toBeDefined();
      expect(def.upgradeSpecializationCost).toBeDefined();
      expect(def.usesWorkshops).toBe(true);
    }
  });

  test('Здания каталога: ровно 2 usesWorkshops-здания', () => {
    const workshopBuildings = BUILDINGS.filter((b) => b.usesWorkshops);
    expect(workshopBuildings.map((b) => b.id).sort()).toEqual(
      ['construction_materials_plant', 'processor'],
    );
  });
});
