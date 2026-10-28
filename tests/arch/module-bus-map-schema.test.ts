/**
 * F3 (follow-up Issue #17): проверка конформности схемы — поля и enum-значения
 * сгенерированной карты не должны расходиться с контрактом
 * docs/architecture/module-contracts.md (§1 схема, §2 классификация).
 *
 * Схема здесь — «узкий» контракт того, что генератор ДЕЙСТВИТЕЛЬНО доказывает:
 * - модуль: registrationStatus (только ось регистрации); поле status/implementationStatus
 *   отсутствует — зрелость реализации машинно не выводится;
 * - отсутствует observed.dependencies — зависимости только декларированные
 *   (manifest.dependencies), initOrder вычисляется ИЗ деклараций;
 * - tick содержит только positionInInitOrder (наличие tick()-тела и факт работы
 *   тика картой не утверждаются; подписки видны в observed.subscriptions);
 * - запросы: registeredBy/unregisteredBy — только production; test-only —
 *   в отдельных полях testRegisteredBy/testUnregisteredBy;
 * - топ-уровень: fileLevelEmits — emit-факты без утверждения владения модулю.
 *
 * Любое добавление/переименование/удаление поля генератором требует
 * синхронного обновления этого теста и module-contracts.md — иначе тест падает.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const artifactPath = join(ROOT, 'docs/architecture/module-bus-map.json');
const contractPath = join(ROOT, 'docs/architecture/module-contracts.md');

// ─── Узкий контракт схемы (module-contracts.md §1) ──────────────────────────

const BUS_MAP_TOP_KEYS = ['note', 'tool', 'analyzer', 'wiring', 'fileLevelEmits', 'modules', 'events', 'queries', 'summary'] as const;

const MODULE_KEYS = [
  'id',
  'className',
  'file',
  'name',
  'version',
  'description',
  'manifest',
  'observed',
  'registration',
  'tick',
  'registrationStatus',
] as const;

const OBSERVED_KEYS = ['emits', 'subscriptions', 'queriesRegistered', 'queriesUnregistered', 'queriesCalled'] as const;

const TICK_KEYS = ['positionInInitOrder'] as const;

const EVENT_KEYS = [
  'declared',
  'manifestEmittedBy',
  'manifestSubscribedBy',
  'productionEmitters',
  'productionConsumers',
  'testEmitters',
  'testConsumers',
  'status',
] as const;

const QUERY_KEYS = [
  'declaredHandles',
  'declaredRequires',
  'registeredBy',
  'unregisteredBy',
  'testRegisteredBy',
  'testUnregisteredBy',
  'productionCallers',
  'testCallers',
  'status',
] as const;

// enum-значения — ровно как задокументировано в module-contracts.md §1.1/§2.1/§2.2
const REGISTRATION_STATUSES = ['active', 'unregistered', 'reserved'] as const;
const EVENT_STATUSES = [
  'declared_and_published',
  'declared_but_not_observed_published',
  'published_without_observed_consumer',
  'consumer_without_observed_publisher',
  'observed_but_not_declared',
  'manifest_vs_runtime_mismatch',
  'dynamic_or_unresolved',
] as const;
const QUERY_STATUSES = ['declared_and_registered', 'registered_not_declared', 'declared_not_registered', 'unregistered_call', 'unused'] as const;

const sameKeys = (actual: Record<string, unknown>, expected: readonly string[]): string[] => {
  const a = Object.keys(actual).sort();
  const e = [...expected].sort();
  return a.length === e.length && a.every((k, i) => k === e[i]) ? [] : [...new Set([...a, ...e])].filter((k) => a.includes(k) !== e.includes(k)).sort();
};

describe('F3: схема артефакта соответствует module-contracts.md (без расхождений полей/enum)', () => {
  const raw = readFileSync(artifactPath, 'utf8');
  const map = JSON.parse(raw) as Record<string, unknown>;

  test('топ-уровень: ровно задокументированный набор секций (включая fileLevelEmits)', () => {
    expect(sameKeys(map, BUS_MAP_TOP_KEYS)).toEqual([]);
    expect(Array.isArray(map.fileLevelEmits)).toBe(true);
  });

  test('модули: registrationStatus ∈ {active,unregistered,reserved}; поля status/implementationStatus/observed.dependencies отсутствуют', () => {
    const modules = map.modules as Record<string, Record<string, unknown>>;
    const ids = Object.keys(modules);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const m = modules[id]!;
      expect(sameKeys(m, MODULE_KEYS)).toEqual([]);
      expect((REGISTRATION_STATUSES as readonly string[]).includes(m.registrationStatus as string)).toBe(true);
      // переименование status→registrationStatus и запрет оси зрелости
      expect(m.status).toBeUndefined();
      expect(m.implementationStatus).toBeUndefined();
      expect(sameKeys(m.observed as Record<string, unknown>, OBSERVED_KEYS)).toEqual([]);
      expect((m.observed as Record<string, unknown>).dependencies).toBeUndefined();
      // tick — только positionInInitOrder (без утверждений о tick()-теле/работе)
      expect(sameKeys(m.tick as Record<string, unknown>, TICK_KEYS)).toEqual([]);
    }
  });

  test('события: ровно 7 enum-статусов, ключи по §1.2', () => {
    const events = map.events as Record<string, Record<string, unknown>>;
    const names = Object.keys(events);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const e = events[name]!;
      expect(sameKeys(e, EVENT_KEYS)).toEqual([]);
      expect((EVENT_STATUSES as readonly string[]).includes(e.status as string)).toBe(true);
    }
  });

  test('запросы: registeredBy/unregisteredBy — production-only; test-only поля присутствуют; enum по §2.2', () => {
    const queries = map.queries as Record<string, Record<string, unknown>>;
    const names = Object.keys(queries);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const q = queries[name]!;
      expect(sameKeys(q, QUERY_KEYS)).toEqual([]);
      expect((QUERY_STATUSES as readonly string[]).includes(q.status as string)).toBe(true);
      // production-поля не содержат test-файлов; test-поля не содержат src/
      for (const r of q.registeredBy as Array<{ file: string }>) expect(r.file.startsWith('src/')).toBe(true);
      for (const r of q.unregisteredBy as Array<{ file: string }>) expect(r.file.startsWith('src/')).toBe(true);
      for (const r of [...(q.testRegisteredBy as Array<{ file: string }>), ...(q.testUnregisteredBy as Array<{ file: string }>)]) {
        expect(r.file.startsWith('tests/') || r.file.startsWith('scripts/')).toBe(true);
      }
    }
  });

  test('fileLevelEmits: факты из файлов, не являющихся файлом объявления ни одного модуля', () => {
    const modules = map.modules as Record<string, { file: string | null }>;
    const moduleFiles = new Set(Object.values(modules).map((m) => m.file).filter((f): f is string => f !== null));
    for (const fact of map.fileLevelEmits as Array<{ file: string }>) {
      expect(moduleFiles.has(fact.file)).toBe(false);
      expect(fact.file.startsWith('src/')).toBe(true);
    }
  });

  test('module-contracts.md синхронизирован: registrationStatus/fileLevelEmits заявлены, старые обещания удалены', () => {
    expect(existsSync(contractPath)).toBe(true);
    const doc = readFileSync(contractPath, 'utf8');
    // новые поля схемы задокументированы
    expect(doc).toContain('`registrationStatus`');
    expect(doc).toContain('`fileLevelEmits`');
    expect(doc).toContain('`testRegisteredBy`');
    expect(doc).toContain('`testUnregisteredBy`');
    // устранённые расхождения F3 не остались обещаниями контракта
    expect(doc).not.toContain('`observed.dependencies`');
    expect(doc).not.toContain('`active` / `partial` / `stub` / `reserved`');
  });
});
