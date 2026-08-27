/// <reference types="bun-types" />
/**
 * Block 03 — T-R5 — Prerequisites check.
 *
 * Tests per plan §7 T-R5:
 *   - arePrerequisitesMet(M5, {M1:2, C1:1}) → met:true
 *   - arePrerequisitesMet(M5, {M1:2}) → met:false, details содержит C1
 *   - arePrerequisitesMet(M5, {}) → met:false, both prereqs missing
 *   - arePrerequisitesMet(P1 fusion_reactor, {}) → met:true (no prereqs)
 *   - arePrerequisitesMet(P2 ion_engine, {fusion_reactor:0}) → met:false
 *   - arePrerequisitesMet(P2 ion_engine, {fusion_reactor:1}) → met:true
 *
 * Run: bun test tests/research/prerequisites.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { arePrerequisitesMet } from '@/research/engine';
import { TECH_MAP } from '@/data/research/tech-tree';

describe('Block 03 T-R5 — Prerequisites', () => {
  test('P1 fusion_reactor has no prerequisites → met:true with empty researched', () => {
    const tech = TECH_MAP.get('fusion_reactor')!;
    const result = arePrerequisitesMet(tech, {});
    expect(result.met).toBe(true);
    expect(result.details).toEqual([]);
  });

  test('P2 ion_engine requires P1≥1; met:false without fusion_reactor', () => {
    const tech = TECH_MAP.get('ion_engine')!;
    const result = arePrerequisitesMet(tech, {});
    expect(result.met).toBe(false);
    expect(result.details.length).toBe(1);
    expect(result.details[0]!.techId).toBe('fusion_reactor');
    expect(result.details[0]!.requiredLevel).toBe(1);
    expect(result.details[0]!.currentLevel).toBe(0);
    expect(result.details[0]!.met).toBe(false);
  });

  test('P2 ion_engine with fusion_reactor:1 → met:true', () => {
    const tech = TECH_MAP.get('ion_engine')!;
    const result = arePrerequisitesMet(tech, { fusion_reactor: 1 });
    expect(result.met).toBe(true);
  });

  test('M5 superconductors requires M1≥2 + C1≥1; met:true with both', () => {
    const tech = TECH_MAP.get('superconductors')!;
    const result = arePrerequisitesMet(tech, {
      steel_processing: 2,
      microelectronics: 1,
    });
    expect(result.met).toBe(true);
    expect(result.details.length).toBe(2);
  });

  test('M5 superconductors with only M1=2 → met:false, missing C1', () => {
    const tech = TECH_MAP.get('superconductors')!;
    const result = arePrerequisitesMet(tech, { steel_processing: 2 });
    expect(result.met).toBe(false);
    const missingC1 = result.details.find(d => d.techId === 'microelectronics');
    expect(missingC1).toBeDefined();
    expect(missingC1!.met).toBe(false);
  });

  test('M5 superconductors with empty researched → met:false, both missing', () => {
    const tech = TECH_MAP.get('superconductors')!;
    const result = arePrerequisitesMet(tech, {});
    expect(result.met).toBe(false);
    expect(result.details.length).toBe(2);
    expect(result.details.every(d => !d.met)).toBe(true);
  });

  test('M3 composites requires M1≥2 + M2≥1; met:false with M1=1', () => {
    const tech = TECH_MAP.get('composites')!;
    const result = arePrerequisitesMet(tech, {
      steel_processing: 1,
      light_alloys: 1,
    });
    expect(result.met).toBe(false);
    const m1detail = result.details.find(d => d.techId === 'steel_processing');
    expect(m1detail!.requiredLevel).toBe(2);
    expect(m1detail!.currentLevel).toBe(1);
    expect(m1detail!.met).toBe(false);
  });

  test('M3 composites with M1=2 + M2=1 → met:true', () => {
    const tech = TECH_MAP.get('composites')!;
    const result = arePrerequisitesMet(tech, {
      steel_processing: 2,
      light_alloys: 1,
    });
    expect(result.met).toBe(true);
  });

  test('W2 laser_weapons requires W1≥2 + C1≥1; met:false with W1=1', () => {
    const tech = TECH_MAP.get('laser_weapons')!;
    const result = arePrerequisitesMet(tech, {
      ballistic_weapons: 1,
      microelectronics: 1,
    });
    expect(result.met).toBe(false);
  });

  test('W2 laser_weapons with W1=2 + C1=1 → met:true', () => {
    const tech = TECH_MAP.get('laser_weapons')!;
    const result = arePrerequisitesMet(tech, {
      ballistic_weapons: 2,
      microelectronics: 1,
    });
    expect(result.met).toBe(true);
  });

  test('C1 microelectronics has no prerequisites → met:true', () => {
    const tech = TECH_MAP.get('microelectronics')!;
    const result = arePrerequisitesMet(tech, {});
    expect(result.met).toBe(true);
  });

  test('B2 ecological_adaptation requires B1≥1; met:false without hydroponics', () => {
    const tech = TECH_MAP.get('ecological_adaptation')!;
    const result = arePrerequisitesMet(tech, {});
    expect(result.met).toBe(false);
    expect(result.details[0]!.techId).toBe('hydroponics');
  });

  test('Prereq details always have requiredLevel, currentLevel, met fields', () => {
    const tech = TECH_MAP.get('superconductors')!;
    const result = arePrerequisitesMet(tech, {});
    for (const detail of result.details) {
      expect(detail).toHaveProperty('techId');
      expect(detail).toHaveProperty('requiredLevel');
      expect(detail).toHaveProperty('currentLevel');
      expect(detail).toHaveProperty('met');
      expect(typeof detail.met).toBe('boolean');
    }
  });
});
