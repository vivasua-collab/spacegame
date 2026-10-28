/**
 * Тесты генератора карты модульной шины (ARCH-BUS-MAP-01, Issue #17).
 *
 * Два уровня:
 * 1. Фикстуры (tests/arch/fixtures/) — представительные формы: alias/import,
 *    прямой typed emit/on, метод-обработчик, reserved event, test-only
 *    потребитель, query register/lookup, неподдерживаемая форма (переменная),
 *    mismatch, топосорт регистрации, детерминизм, drift-check.
 * 2. Реальный репозиторий — артефакт docs/architecture/module-bus-map.json
 *    должен быть байт-в-бит равен свежему анализу (drift=0), а сводные числа —
 *    соответствовать module-contracts.md §4.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeBusMap, isDrifted, renderJson, type AnalyzeOptions } from '../../scripts/gen-module-bus-map';

const ROOT = process.cwd();
const FX = join(ROOT, 'tests/arch/fixtures');

function fxOptions(extraProduction: string[] = [], extraNonProduction: string[] = []): AnalyzeOptions {
  return {
    eventsFile: join(FX, 'fx-events.ts'),
    moduleTypesFile: join(FX, 'fx-module-types.ts'),
    productionFiles: [
      join(FX, 'fx-bus.ts'),
      join(FX, 'fx-module.ts'),
      join(FX, 'fx-other.ts'),
      join(FX, 'fx-ghost.ts'),
      join(FX, 'fx-wiring.ts'),
      ...extraProduction,
    ],
    nonProductionFiles: [join(FX, 'fx-nonprod-consumer.ts'), ...extraNonProduction],
    rootDir: ROOT,
  };
}

const fxMap = () => analyzeBusMap(fxOptions());

describe('ARCH-BUS-MAP-01: генератор карты шины — фикстуры', () => {
  test('каталог событий фикстуры извлечён с file:line и payload-типами', () => {
    const map = fxMap();
    expect(Object.keys(map.events).sort()).toEqual(['fx:future', 'fx:hidden', 'fx:only-sub', 'fx:ping', 'fx:ternary']);
    const ping = map.events['fx:ping']!;
    expect(ping.declared.line).toBeGreaterThan(0);
    expect(ping.declared.payloadType).toBe('{ n: number }');
    expect(ping.declared.interfaceName).toBe('FxEvents');
  });

  test('манифест извлечён: конкатенация description, emits с линиями, priority, queries', () => {
    const map = fxMap();
    const fx = map.modules['fx']!;
    expect(fx.status).toBe('active');
    expect(fx.className).toBe('FxModule');
    expect(fx.description).toBe('фикстурный модуль с конкатенацией');
    expect(fx.manifest.emits.map((e) => e.name)).toEqual(['fx:ping', 'fx:future']);
    expect(fx.manifest.emits.every((e) => e.line > 0)).toBe(true);
    expect(fx.manifest.subscribes[0]!.event).toBe('fx:only-sub');
    expect(fx.manifest.subscribes[0]!.priority).toBe('10');
    expect(fx.manifest.handlesQueries[0]!.queryName).toBe('fx:q');
  });

  test('прямой emit (this.bus) и emit через import-алиас — факты с file:line', () => {
    const map = fxMap();
    const emitters = map.events['fx:ping']!.productionEmitters;
    // this.bus.emit + bus2.emit (алиас gameBus) + тернарник → 3 факта
    expect(emitters.length).toBe(3);
    expect(emitters.every((e) => e.file === 'tests/arch/fixtures/fx-module.ts')).toBe(true);
    expect(emitters.every((e) => e.publisher.startsWith('FxModule'))).toBe(true);
    expect(emitters.some((e) => e.receiver === 'this.bus')).toBe(true);
    expect(emitters.some((e) => e.receiver === 'bus2')).toBe(true);
  });

  test('тернарник литералов разрешается в оба события одной строкой', () => {
    const map = fxMap();
    const ping = map.events['fx:ping']!.productionEmitters;
    const ternary = map.events['fx:ternary']!.productionEmitters;
    expect(ternary.length).toBe(1);
    expect(ping.some((e) => e.line === ternary[0]!.line)).toBe(true);
  });

  test('reserved-событие: декларация в манифесте без издателя — не баг, а статус 6', () => {
    const map = fxMap();
    expect(map.events['fx:future']!.status).toBe('declared_but_not_observed_published');
    expect(map.events['fx:future']!.manifestEmittedBy).toEqual([{ module: 'fx', line: expect.any(Number) }]);
  });

  test('test-only потребитель НЕ маскирует отсутствие production-потребителя', () => {
    const map = fxMap();
    const ping = map.events['fx:ping']!;
    expect(ping.status).toBe('published_without_observed_consumer');
    expect(ping.productionConsumers).toHaveLength(0);
    expect(ping.testConsumers).toEqual([
      { file: 'tests/arch/fixtures/fx-nonprod-consumer.ts', lines: [expect.any(Number)] },
    ]);
  });

  test('mismatch: runtime-подписка без декларации в манифесте', () => {
    const map = fxMap();
    const hidden = map.events['fx:hidden']!;
    expect(hidden.status).toBe('manifest_vs_runtime_mismatch');
    expect(hidden.productionConsumers).toHaveLength(1);
    expect(hidden.manifestSubscribedBy).toHaveLength(0);
  });

  test('consumer_without_observed_publisher: подписка есть, издателя нет', () => {
    const map = fxMap();
    expect(map.events['fx:only-sub']!.status).toBe('consumer_without_observed_publisher');
  });

  test('observed_but_not_declared: тернарное событие эмитится, но не заявлено', () => {
    const map = fxMap();
    const ternary = map.events['fx:ternary']!;
    expect(ternary.status).toBe('observed_but_not_declared');
    expect(ternary.manifestEmittedBy).toHaveLength(0);
    expect(ternary.manifestSubscribedBy).toHaveLength(0);
  });

  test('query: декларация/регистрация/вызовы различены; вызов без регистрации виден', () => {
    const map = fxMap();
    const q = map.queries['fx:q']!;
    expect(q.status).toBe('declared_and_registered');
    expect(q.declaredHandles.map((d) => d.module)).toEqual(['fx']);
    expect(q.declaredRequires.map((d) => d.module)).toEqual(['other']);
    expect(q.registeredBy.map((r) => r.file)).toEqual(['tests/arch/fixtures/fx-module.ts']);
    expect(q.productionCallers).toHaveLength(1);
    expect(q.productionCallers[0]!.caller).toBe('OtherModule.init');

    const ghostQ = map.queries['fx:ghost-q']!;
    expect(ghostQ.status).toBe('registered_not_declared');
    expect(ghostQ.registeredBy.map((r) => r.file)).toEqual(['tests/arch/fixtures/fx-ghost.ts']);
    expect(ghostQ.productionCallers).toHaveLength(1);
  });

  test('регистрация и топопорядок: [other, fx] с deps other→fx → initOrder [fx, other]', () => {
    const map = fxMap();
    expect(map.wiring.registrationOrder).toEqual(['other', 'fx']);
    expect(map.wiring.initOrder).toEqual(['fx', 'other']);
    expect(map.modules['fx']!.tick.positionInInitOrder).toBe(1);
    expect(map.modules['other']!.tick.positionInInitOrder).toBe(2);
    // класс без регистрации + идентификатор union без класса
    expect(map.modules['fxghost']!.status).toBe('unregistered');
    expect(map.modules['fxghost']!.className).toBe('GhostModule');
    expect(map.modules['pureghost']!.status).toBe('reserved');
    expect(map.modules['pureghost']!.className).toBeNull();
  });

  test('неподдерживаемая форма: переменная фиксируется (recognized) и понижает ТОЛЬКО события без production-издателей', () => {
    const map = analyzeBusMap(fxOptions([join(FX, 'fx-var-emit.ts')]));
    const unresolved = map.analyzer.unresolvedForms.filter((u) => u.file === 'tests/arch/fixtures/fx-var-emit.ts');
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]!.kind).toBe('emit');
    expect(unresolved[0]!.recognized).toBe(true);
    // fx:future не имеет наблюдаемого издателя → не доказуем → dynamic_or_unresolved
    expect(map.events['fx:future']!.status).toBe('dynamic_or_unresolved');
    // fx:ping имеет наблюдаемых издателей → статус не меняется
    expect(map.events['fx:ping']!.status).toBe('published_without_observed_consumer');
  });

  test('детерминизм: два анализа одного дерева — байт-в-бит', () => {
    const a = renderJson(analyzeBusMap(fxOptions()));
    const b = renderJson(analyzeBusMap(fxOptions()));
    expect(a).toBe(b);
  });

  test('drift-check: совпадение → не дрейф; изменение/отсутствие → дрейф', () => {
    const rendered = renderJson(fxMap());
    expect(isDrifted(rendered, rendered)).toBe(false);
    expect(isDrifted(rendered, rendered.replace('"fx"', '"fx-drift"'))).toBe(true);
    expect(isDrifted(rendered, null)).toBe(true);
  });
});

describe('ARCH-BUS-MAP-01: артефакт реального репозитория актуален', () => {
  const artifactPath = join(ROOT, 'docs/architecture/module-bus-map.json');

  function realOptions(): AnalyzeOptions {
    const prod: string[] = [];
    const nonProd: string[] = [];
    const walk = (dir: string, acc: string[]): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'fixtures') continue;
          walk(full, acc);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          acc.push(full);
        }
      }
    };
    walk(join(ROOT, 'src'), prod);
    walk(join(ROOT, 'tests'), nonProd);
    walk(join(ROOT, 'scripts'), nonProd);
    return {
      eventsFile: join(ROOT, 'src/core/events.ts'),
      moduleTypesFile: join(ROOT, 'src/core/module-types.ts'),
      productionFiles: prod.sort(),
      nonProductionFiles: nonProd.sort(),
      rootDir: ROOT,
    };
  }

  test('module-bus-map.json байт-в-бит равен свежему анализу (drift=0)', () => {
    expect(existsSync(artifactPath)).toBe(true);
    const rendered = renderJson(analyzeBusMap(realOptions()));
    const existing = readFileSync(artifactPath, 'utf8');
    expect(isDrifted(rendered, existing)).toBe(false);
  });

  test('сводные числа соответствуют module-contracts.md §4 (86 событий; 10/2/7/24/43)', () => {
    const map = analyzeBusMap(realOptions());
    expect(Object.keys(map.events)).toHaveLength(86);
    expect(map.summary.modules).toBe(10); // 6 active + core/combat/diplomacy/trade reserved
    expect(map.summary.queries).toBe(9);
    expect(map.summary.events).toEqual({
      declared_and_published: 10,
      declared_but_not_observed_published: 43,
      manifest_vs_runtime_mismatch: 2,
      observed_but_not_declared: 7,
      published_without_observed_consumer: 24,
    });
    expect(map.wiring.initOrder).toEqual(['galaxy', 'economy', 'tech', 'ships', 'fleet', 'ai']);
    // целевые точки: единственный производственный вызов query в src отсутствует
    for (const q of Object.values(map.queries)) expect(q.productionCallers).toHaveLength(0);
    // оба несоответствия манифесту — на месте
    expect(map.events['economy:downgrade']!.status).toBe('manifest_vs_runtime_mismatch');
    expect(map.events['economy:demolish']!.status).toBe('manifest_vs_runtime_mismatch');
  });
});
