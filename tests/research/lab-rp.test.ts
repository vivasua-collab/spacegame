/// <reference types="bun-types" />
/**
 * Block 03 — T-R3 — Laboratory building + RP/sec helpers.
 *
 * Tests:
 *   1. laboratory building exists in BUILDINGS / BUILDING_MAP
 *   2. laboratory has category='research', levels=10, layer=['surface']
 *   3. laboratory costPerLevel = { Fe: 30, Si: 20, Cu: 5 }
 *   4. getLabRPPerSec(1) === 5 (base level 1, no habitability)
 *   5. getLabRPPerSec(3, 5, 80) === 16.5 (per T-R3 spec)
 *   6. getLabRPPerSec(10) === 50 (max level, no habit)
 *   7. getMaxResearchSlots(0) === 1
 *   8. getMaxResearchSlots(10) === 2
 *   9. getMaxResearchSlots(100) === 10 (cap)
 *  10. getMaxResearchSlots(95) === 10 (cap, edge)
 *  11. getMaxResearchSlots(50) === 6
 *  12. getResearchRate(5) === 25 (helper used in BuildingDialog)
 *  13. countLaboratories returns 0 for planet without labs
 *  14. countLaboratories returns correct count + total level
 *  15. getTotalRPPerSec sums all labs across multiple planets
 *
 * Run: bun test tests/research/lab-rp.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { BUILDINGS, BUILDING_MAP } from '@/data/buildings';
import {
  getLabRPPerSec,
  getMaxResearchSlots,
  getResearchRate,
  countLaboratories,
  getTotalRPPerSec,
} from '@/research/engine';
import type { Planet, HexCell } from '@/core/types';

describe('Block 03 T-R3 — Laboratory + RP/sec', () => {
  describe('laboratory building definition', () => {
    test('laboratory exists in BUILDINGS and BUILDING_MAP', () => {
      const lab = BUILDINGS.find((b) => b.id === 'laboratory');
      expect(lab).toBeDefined();
      expect(BUILDING_MAP.has('laboratory')).toBe(true);
    });

    test('laboratory has correct properties', () => {
      const lab = BUILDING_MAP.get('laboratory')!;
      expect(lab.category).toBe('research');
      expect(lab.levels).toBe(10);
      expect(lab.layer).toContain('surface');
      expect(lab.size).toContain('small');
      expect(lab.size).toContain('medium');
      expect(lab.size).toContain('large');
      expect(lab.size).toContain('huge');
      expect(lab.energyConsumption).toBe(10);
      expect(lab.costPerLevel).toEqual({ Fe: 30, Si: 20, Cu: 5 });
      expect(lab.requiresAtmosphere).toBe(false);
    });
  });

  describe('getLabRPPerSec — formula tests', () => {
    test('getLabRPPerSec(1) === 5 (base level, no habitability)', () => {
      expect(getLabRPPerSec(1)).toBe(5);
    });

    test('getLabRPPerSec(3, 5, 80) === 16.5 (T-R3 spec)', () => {
      // 5 × 3 × (1 + 80/800) = 5 × 3 × 1.1 = 16.5
      expect(getLabRPPerSec(3, 5, 80)).toBe(16.5);
    });

    test('getLabRPPerSec(10) === 50 (max level, no habitability)', () => {
      expect(getLabRPPerSec(10)).toBe(50);
    });

    test('getLabRPPerSec(0) === 0 (no lab)', () => {
      expect(getLabRPPerSec(0)).toBe(0);
    });

    test('getLabRPPerSec(5, 5, 100) === 5 × 5 × 1.125 = 28.125', () => {
      // 5 × 5 × (1 + 100/800) = 5 × 5 × 1.125 = 28.125
      expect(getLabRPPerSec(5, 5, 100)).toBeCloseTo(28.125, 5);
    });
  });

  describe('getMaxResearchSlots — slot count formula', () => {
    test('getMaxResearchSlots(0) === 1 (base minimum)', () => {
      expect(getMaxResearchSlots(0)).toBe(1);
    });

    test('getMaxResearchSlots(10) === 2', () => {
      expect(getMaxResearchSlots(10)).toBe(2);
    });

    test('getMaxResearchSlots(100) === 10 (cap reached)', () => {
      expect(getMaxResearchSlots(100)).toBe(10);
    });

    test('getMaxResearchSlots(95) === 10 (cap edge)', () => {
      expect(getMaxResearchSlots(95)).toBe(10);
    });

    test('getMaxResearchSlots(50) === 6', () => {
      expect(getMaxResearchSlots(50)).toBe(6);
    });

    test('getMaxResearchSlots(9) === 1 (just below threshold)', () => {
      expect(getMaxResearchSlots(9)).toBe(1);
    });
  });

  describe('getResearchRate — BuildingDialog helper', () => {
    test('getResearchRate(1) === 5 (level 1 lab)', () => {
      expect(getResearchRate(1)).toBe(5);
    });

    test('getResearchRate(5) === 25', () => {
      expect(getResearchRate(5)).toBe(25);
    });

    test('getResearchRate(10) === 50 (max level)', () => {
      expect(getResearchRate(10)).toBe(50);
    });
  });

  describe('countLaboratories + getTotalRPPerSec', () => {
    function makePlanetWithLabs(levels: number[], owner: string | null = 'player'): Planet {
      const hexes: HexCell[] = levels.map((level, i) => ({
        coord: { q: i, r: 0 },
        terrain: 'plains',
        buildingId: 'laboratory',
        buildingLevel: level,
        deposits: [],
      }));
      // Pad with empty hexes
      while (hexes.length < 3) {
        hexes.push({
          coord: { q: hexes.length, r: 0 },
          terrain: 'plains',
          buildingId: null,
          buildingLevel: 0,
          deposits: [],
        });
      }
      return {
        id: `planet_test_${Math.random().toString(36).slice(2)}`,
        systemId: 'sys_test',
        name: 'Test',
        type: 'rocky',
        size: 'medium',
        radiusKm: 6371,
        density: 5.51,
        gravity: 1.0,
        temperature: 288,
        atmosphere: { type: 'oxygen', pressure: 1.0, composition: {} } as never,
        life: { biodiversity: 0, nativeSpecies: [] } as never,
        orbitNumber: 1,
        orbitalRadius: 1,
        orbitalPeriod: 365,
        hexes,
        atmosphericSlots: [],
        orbitSlots: [],
        resourceDeposits: [],
        resources: {},
        energyBalance: 0,
        owner,
      };
    }

    test('countLaboratories returns 0 for planet without labs', () => {
      const planet = makePlanetWithLabs([]);
      const result = countLaboratories([planet]);
      expect(result.count).toBe(0);
      expect(result.totalLevel).toBe(0);
    });

    test('countLaboratories returns correct count + total level', () => {
      const planet = makePlanetWithLabs([1, 3, 5]);
      const result = countLaboratories([planet]);
      expect(result.count).toBe(3);
      expect(result.totalLevel).toBe(9);
    });

    test('countLaboratories skips planets without owner', () => {
      const planet = makePlanetWithLabs([1, 2], null);
      const result = countLaboratories([planet]);
      expect(result.count).toBe(0);
    });

    test('getTotalRPPerSec sums all labs', () => {
      const planet = makePlanetWithLabs([1, 2, 3]); // 5 + 10 + 15 = 30
      const result = getTotalRPPerSec([planet]);
      expect(result).toBe(30);
    });

    test('getTotalRPPerSec sums across multiple planets', () => {
      const p1 = makePlanetWithLabs([1, 2]); // 5 + 10 = 15
      const p2 = makePlanetWithLabs([3, 4]); // 15 + 20 = 35
      const result = getTotalRPPerSec([p1, p2]);
      expect(result).toBe(50);
    });

    test('getTotalRPPerSec handles 0 labs', () => {
      const planet = makePlanetWithLabs([]);
      expect(getTotalRPPerSec([planet])).toBe(0);
    });
  });
});
