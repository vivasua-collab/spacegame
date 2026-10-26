/**
 * Task 36 (аудит δ, C3): конвенция именования систем / планет / лун.
 *
 * Дефект G-08 (воспроизведён ДО правок, 300 seed × 60 систем):
 *   100% лун (35711/35711) получали ДВОЙНОЙ римский номер —
 *   «Lambda Draconis V V-a» вместо «Lambda Draconis V-a»:
 *   имя планеты уже содержит номер орбиты («… V — Газовый гигант»),
 *   а generateMoons добавлял toRoman(orbit) повторно.
 *
 * Конвенция после фикса (generate-planets.ts, Audit Task 36/C3):
 *   - система:  «<Greek> <Constellation>» (при коллизии «…-NNN»);
 *   - планета:  «<Система> <римский № орбиты> — <Тип>»;
 *   - луна:     «<Система> <римский № орбиты>-<буква a..g>» —
 *     римский номер орбиты планеты НЕ дублируется, типовой суффикс
 *     « — <Тип>» отбрасывается.
 *
 * Run: bun test tests/galaxy/moon-naming.test.ts
 */

import { test, expect, describe } from 'bun:test';
import '@/core/immer-setup';
import { generateGalaxy, DEFAULT_CONFIG } from '@/galaxy';
import { toRoman } from '@/galaxy/generate-planets';
import { TYPE_NAMES, GAS_GIANT_MOON_COUNT } from '@/data/planet-types';
import type { Galaxy, Planet, Moon } from '@/core/types';

const SEEDS = 50;
const SYSTEMS = 40;

/** Римские цифры 1..12 (максимум орбит в текущем каталоге звёзд). */
const ROMAN_RE = /^(?:X|IX|VIII|VII|VI|V|IV|III|II|I)$/;
/** Регрессия G-08: двойной римский номер в имени луны («… V V-a»). */
const DOUBLE_ROMAN_RE = / [IVXL]+ [IVXL]+-[a-z]$/;

interface NamingCorpus {
  galaxies: Galaxy[];
  systems: Array<{ name: string; planets: Planet[] }>;
  planets: Planet[];
  moons: Moon[];
  gasGiants: number;
}

function buildNamingCorpus(): NamingCorpus {
  const galaxies: Galaxy[] = [];
  const systems: NamingCorpus['systems'] = [];
  const planets: Planet[] = [];
  const moons: Moon[] = [];
  let gasGiants = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = generateGalaxy({ ...DEFAULT_CONFIG, seed, systemCount: SYSTEMS });
    galaxies.push(g);
    for (const sys of g.systems) {
      systems.push({ name: sys.name, planets: sys.planets });
      planets.push(...sys.planets);
      for (const p of sys.planets) {
        if (p.type === 'gas_giant') gasGiants++;
        moons.push(...p.moons);
      }
    }
  }
  return { galaxies, systems, planets, moons, gasGiants };
}

const corpus: NamingCorpus = buildNamingCorpus();

/** Найти систему-владельца планеты по имени (уникальны в пределах галактики). */
function systemNameOf(planet: Planet): string | undefined {
  return planet.name.split(` ${toRoman(planet.orbitNumber)} — `)[0];
}

describe('Task 36 C3: имена планет', () => {
  test('формат «<Система> <Римский №> — <Тип из каталога>»', () => {
    expect(corpus.planets.length).toBeGreaterThan(4000);
    for (const p of corpus.planets) {
      const typeName = TYPE_NAMES[p.type];
      expect(typeName, `тип ${p.type} есть в TYPE_NAMES`).toBeDefined();
      const expected = `${systemNameOf(p)} ${toRoman(p.orbitNumber)} — ${typeName}`;
      expect(p.name, `имя планеты: «${p.name}» ≠ «${expected}»`).toBe(expected);
      // римский номер валиден и равен номеру орбиты
      expect(toRoman(p.orbitNumber)).toMatch(ROMAN_RE);
      expect(p.orbitNumber).toBeGreaterThanOrEqual(1);
      expect(p.orbitNumber).toBeLessThanOrEqual(12);
    }
  });

  test('имена планет уникальны в каждой галактике', () => {
    // Планеты одной системы различаются номером орбиты, системы — именем
    // (usedNames + суффикс -NNN гарантируют уникальность имён систем).
    for (const g of corpus.galaxies) {
      const seen = new Set<string>();
      for (const sys of g.systems) {
        for (const p of sys.planets) {
          expect(seen.has(p.name), `дубль имени планеты «${p.name}»`).toBe(false);
          seen.add(p.name);
        }
      }
    }
  });
});

describe('Task 36 C3: имена лун (регрессия G-08 — двойной римский номер)', () => {
  test('формат «<Система> <Римский № планеты>-<буква>» без дубля номера', () => {
    expect(corpus.gasGiants).toBeGreaterThan(250);
    expect(corpus.moons.length).toBeGreaterThan(1500);
    for (const m of corpus.moons) {
      // жёсткая структура: <system> <roman>-<letter>
      expect(m.name, `луна ${m.id}: «${m.name}» не соответствует конвенции`)
        .toMatch(/^.* [IVXL]+-[a-g]$/);
      // регрессия G-08: двойного номера быть не должно
      expect(m.name, `луна ${m.id}: двойной римский номер «${m.name}»`)
        .not.toMatch(DOUBLE_ROMAN_RE);
    }
  });

  test('номер и буква соответствуют планете-владельцу; буквы a, b, c… по порядку', () => {
    for (const sys of corpus.systems) {
      for (const p of sys.planets) {
        const roman = toRoman(p.orbitNumber);
        for (let i = 0; i < p.moons.length; i++) {
          const m = p.moons[i]!;
          const expected = `${sys.name} ${roman}-${String.fromCharCode(97 + i)}`;
          expect(m.name, `луна ${m.id}: «${m.name}» ≠ «${expected}» (планета «${p.name}»)`)
            .toBe(expected);
        }
        if (p.type === 'gas_giant') {
          expect(p.moons.length, `${p.name}: лун ${p.moons.length}`)
            .toBeGreaterThanOrEqual(GAS_GIANT_MOON_COUNT.min);
        }
      }
    }
  });

  test('имена лун уникальны в каждой галактике', () => {
    for (const g of corpus.galaxies) {
      const seen = new Set<string>();
      for (const sys of g.systems) {
        for (const p of sys.planets) {
          for (const m of p.moons) {
            expect(seen.has(m.name), `дубль имени луны «${m.name}»`).toBe(false);
            seen.add(m.name);
          }
        }
      }
    }
  });
});
