/**
 * ARCH-BUS-MAP-01 (Issue #17) — генератор карты модульной шины SpaceGame.
 *
 * Read-only инструмент: парсит исходники (TypeScript Compiler API, синтаксический
 * анализ без type-checker) и генерирует машинно-читаемую инвентаризацию
 * ФАКТИЧЕСКОЙ реализации модульной шины: docs/architecture/module-bus-map.json.
 *
 * Принципы (по ТЗ Issue #17 + follow-up аудит 2026-10-28):
 * - проводкой события считается ТОЛЬКО вызов emit/on/once с первым аргументом —
 *   строковым литералом (или разрешаемой формой) и получателем из набора шины;
 *   текстовые вхождения имени события проводкой НЕ считаются;
 * - production (src/) анализируется ОТДЕЛЬНО от tests/ и scripts/ — test-only
 *   потребитель не маскирует отсутствие production-потребителя; query-регистрации
 *   из тестов также НЕ засчитываются как production (F1);
 * - атрибуция emits по владению: модуль — только файл объявления своего класса;
 *   engine/инфраструктурные emissions — в fileLevelEmits без утверждения владения (F2);
 * - registrationStatus — только ось регистрации; зрелость реализации машинно не выводится (F3);
 * - детерминированный вывод: отсортированные коллекции, никаких времён/HEAD;
 * - каждый факт несёт file:line;
 * - ограничения анализатора перечислены в выводе (analyzer.limitations).
 *
 * Использование (из корня репозитория):
 *   bun scripts/gen-module-bus-map.ts            # сгенерировать/обновить артефакт
 *   bun scripts/gen-module-bus-map.ts --check    # exit 1, если артефакт устарел
 *
 * Вывод — инвентаризация фактической реализации. Он НЕ заменяет канонические
 * контракты (docs/architecture/modular-bus.md, src/core/events.ts).
 * Схема полей и классификация статусов: docs/architecture/module-contracts.md.
 */

import * as ts from 'typescript';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

// ─── Публичные типы (используются тестами tests/arch/module-bus-map.test.ts) ───

export interface EmitFact {
  file: string;
  line: number;
  event: string;
  publisher: string;
  receiver: string;
}

export interface SubscribeFact {
  file: string;
  line: number;
  event: string;
  subscriber: string;
  receiver: string;
  priority?: string;
  label?: string;
  once?: boolean;
}

export interface RegisterFact {
  file: string;
  line: number;
  query: string;
  moduleContext: string;
}

export interface UnregisterFact {
  file: string;
  line: number;
  query: string;
}

export interface QueryCallFact {
  file: string;
  line: number;
  query: string;
  caller: string;
}

export interface UnresolvedForm {
  file: string;
  line: number;
  receiver: string;
  recognized: boolean;
  kind: 'emit' | 'on' | 'once' | 'query' | 'registerQuery';
  detail: string;
}

export interface EventDecl {
  name: string;
  line: number;
  payloadType: string;
  interfaceName: string;
}

export interface ManifestEmitDecl {
  name: string;
  line: number;
}

export interface ManifestSubDecl {
  event: string;
  priority?: string;
  once?: boolean;
  line: number;
}

export interface ManifestQueryDecl {
  queryName: string;
  description?: string;
  requestType?: string;
  responseType?: string;
  line: number;
}

export interface ModuleEntry {
  id: string;
  className: string | null;
  file: string | null;
  name: string | null;
  version: string | null;
  description: string | null;
  manifest: {
    dependencies: string[];
    emits: ManifestEmitDecl[];
    subscribes: ManifestSubDecl[];
    handlesQueries: ManifestQueryDecl[];
    requiresQueries: ManifestQueryDecl[];
  };
  observed: {
    /** emit-вызовы ТОЛЬКО в файле объявления класса модуля (модуль-own факты).
     *  Emissions из engine/инфраструктурных файлов НЕ атрибутируются модулю —
     *  они публикуются в топ-уровневой секции fileLevelEmits (без утверждения владения). */
    emits: EmitFact[];
    /** фактические bus-подписки, созданные в файле модуля. */
    subscriptions: SubscribeFact[];
    queriesRegistered: RegisterFact[];
    queriesUnregistered: UnregisterFact[];
    queriesCalled: QueryCallFact[];
  };
  registration: Array<{ file: string; line: number; order: number }>;
  tick: { positionInInitOrder: number | null };
  /** ТОЛЬКО ось регистрации (что статанализ доказал о регистрации в production).
   *  Зрелость реализации (partial/stub) машинно НЕ выводится и полем карты не является. */
  registrationStatus: 'active' | 'unregistered' | 'reserved';
}

export interface EventEntry {
  declared: { file: string; line: number; payloadType: string; interfaceName: string };
  manifestEmittedBy: Array<{ module: string; line: number }>;
  manifestSubscribedBy: Array<{ module: string; line: number; priority?: string }>;
  productionEmitters: EmitFact[];
  productionConsumers: SubscribeFact[];
  testEmitters: Array<{ file: string; lines: number[] }>;
  testConsumers: Array<{ file: string; lines: number[] }>;
  status: string;
}

export interface QueryEntry {
  declaredHandles: Array<{ module: string; line: number }>;
  declaredRequires: Array<{ module: string; line: number }>;
  /** фактические registerQuery ТОЛЬКО в production (src/). */
  registeredBy: RegisterFact[];
  /** фактические unregisterQuery ТОЛЬКО в production (src/). */
  unregisteredBy: UnregisterFact[];
  /** test-only регистрации (tests/, scripts/) — агрегированы по файлам,
   *  публикуются ОТДЕЛЬНО и НЕ влияют на production status (F1 follow-up). */
  testRegisteredBy: Array<{ file: string; lines: number[] }>;
  /** test-only снятия регистрации — аналогично testRegisteredBy. */
  testUnregisteredBy: Array<{ file: string; lines: number[] }>;
  productionCallers: QueryCallFact[];
  testCallers: Array<{ file: string; lines: number[] }>;
  status: string;
}

export interface BusMap {
  note: string;
  tool: { script: string; regenerate: string; check: string };
  analyzer: {
    formsCovered: string[];
    busReceivers: string[];
    limitations: string[];
    unresolvedForms: UnresolvedForm[];
  };
  wiring: {
    busSingleton: Array<{ file: string; line: number; note: string }>;
    replayEnabled: Array<{ event: string; file: string; line: number }>;
    registrationOrder: string[];
    initOrder: string[];
    tickOrderNote: string;
  };
  /** Production emit-факты из файлов, НЕ являющихся файлом объявления модуля
   *  (engine, store, ядро-инфраструктура). File-level каталог БЕЗ утверждения
   *  владения модулем: два модуля в одном каталоге не получают чужие emissions
   *  (F2 follow-up). Event-level ссылки сохраняются в events.*.productionEmitters. */
  fileLevelEmits: EmitFact[];
  modules: Record<string, ModuleEntry>;
  events: Record<string, EventEntry>;
  queries: Record<string, QueryEntry>;
  summary: { events: Record<string, number>; modules: number; queries: number };
}

export interface AnalyzeOptions {
  /** Файл канонического каталога событий (src/core/events.ts или мини-фикстура). */
  eventsFile: string;
  /** Файл с union ModuleId (src/core/module-types.ts или мини-фикстура). */
  moduleTypesFile: string;
  /** Production-файлы (каталог src/, расширения .ts/.tsx) — факты, манифесты, регистрация. */
  productionFiles: string[];
  /** Non-production файлы (tests/, scripts/) — факты агрегируются отдельно. */
  nonProductionFiles?: string[];
  /** Корень для относительных путей (по умолчанию — process.cwd()). */
  rootDir?: string;
}

// ─── Константы анализа ──────────────────────────────────────────────────────

/** Получатели-выражения (после нормализации пробелов), считающиеся шиной. */
const BUS_RECEIVERS: ReadonlySet<string> = new Set([
  'this.bus',
  'bus',
  'gameBus',
  'loop.bus',
  'this.loop.bus',
  'registry.bus',
  'this.registry.bus',
]);
/** Получатели реестра запросов (включая формы *.registry, напр. mediator.registry). */
const REGISTRY_RECEIVERS: ReadonlySet<string> = new Set(['registry', 'this.registry']);
const isRegistryReceiver = (recv: string): boolean => REGISTRY_RECEIVERS.has(recv) || recv.endsWith('.registry');
/** Имена синглтонов шины, чьи import-алиасы разрешаются (import { gameBus as X }). */
const BUS_SINGLETON_NAMES: ReadonlySet<string> = new Set(['gameBus']);

const FORMS_COVERED: readonly string[] = [
  'emit/on/once с первым аргументом-строковым литералом и получателем из busReceivers',
  'условное выражение (тернарник) с двумя строковыми литералами в первом аргументе — разрешаются оба имени',
  'import-алиасы синглтона шины: import { gameBus as X } — X добавляется к получателям этого файла',
  'registerQuery/unregisterQuery/query с именем-литералом и получателем из registryReceivers',
  'манифесты: id/name/version/description (включая конкатенацию литералов), dependencies, emits, subscribes (event/priority/once), handlesQueries/requiresQueries',
  'регистрация модулей: new XxxModule(...) + registerAndInit([...]) / registerModule(...) с резолвом локальных переменных',
  'порядок init/tick воспроизводит ModuleRegistry.recalculateInitOrder (DFS по dependencies в порядке вставки)',
];

const LIMITATIONS: readonly string[] = [
  'проводкой считаются только вызовы со СТРОКОВЫМ ЛИТЕРАЛОМ (или тернарником литералов) в первом аргументе; переменные и вычисляемые имена фиксируются в analyzer.unresolvedForms и не создают фактов',
  'атрибуция emits: модуль владеет ТОЛЬКО emit-вызовами файла объявления своего класса; emissions из engine/инфраструктурных файлов (engine.ts, fleet-engine.ts, shipyard-queue.ts, game-store.ts, game-mediator.ts, game-loop.ts) публикуются в топ-уровневой секции fileLevelEmits как file-level факты БЕЗ утверждения владения — два модуля одного каталога не получают одинаковый список как подтверждённое владение',
  'query-статусы вычисляются ТОЛЬКО по production-фактам src/ (registerQuery/unregisterQuery/query); тестовые регистрации/снятия публикуются отдельно в testRegisteredBy/testUnregisteredBy и НЕ классифицируют запрос как зарегистрированный в production',
  'получатель вызова должен распознаваться как шина/реестр (см. busReceivers); иные .emit/.on (стриймы, UI-библиотеки) игнорируются по получателю; нераспознанный получатель с не-литеральным аргументом фиксируется как unresolved (recognized=false) — для прозрачности, статусы событий не меняет',
  'нераспознанные формы на РАСПОЗНАННОМ получателе (recognized=true) означают, что потенциальный издатель/потребитель события не доказуем: события без наблюдаемых production-фактов помечаются статусом dynamic_or_unresolved',
  'call-graph не строится: emit внутри GameMediator.commitState/emitStateChanged атрибутируется файлу медиатора, а не вызывающему модулю (см. module-contracts.md F-06)',
  'query-имена не типизированы (Map<string, QueryHandler>) — связь декларация↔регистрация↔вызов устанавливается по совпадению строк',
  'test-only потребители (tests/, scripts/) фиксируются отдельно и НЕ маскируют отсутствие production-потребителя',
  'регистрация модулей распознаётся по формам new XxxModule( + registerAndInit([...]) / registerModule(...); иные (будущие) способы потребуют расширения анализатора',
  'анализ синтаксический (без type-checker): типы payload записываются как текст декларации',
];

const TICK_ORDER_NOTE =
  "registry.tickAll() обходит initOrder и вызывает tick() каждого started-модуля — это действующий канал тиков; bus-подписки модулей на 'core:tick' — no-op (см. module-contracts.md F-01)";

// ─── Вспомогательные ────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function relPath(root: string, file: string): string {
  const r = relative(root, file);
  const out = toPosix(r);
  return out === '' ? toPosix(file) : out;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function normReceiver(text: string): string {
  return text.replace(/\s+/g, '');
}

/** Ближайшее осмысленное имя-контекст: Class.method / функция / свойство. */
function enclosingName(sf: ts.SourceFile, node: ts.Node): string {
  const parts: string[] = [];
  let cur: ts.Node | undefined = node.parent;
  while (cur && parts.length < 2) {
    if (ts.isClassDeclaration(cur) && cur.name) {
      parts.unshift(cur.name.text);
      break;
    }
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) {
      parts.push(cur.name.text);
    } else if (ts.isConstructorDeclaration(cur)) {
      parts.push('constructor');
    } else if (ts.isFunctionDeclaration(cur) && cur.name) {
      parts.push(cur.name.text);
      break;
    } else if (ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)) {
      parts.push(cur.name.text);
      break;
    } else if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) {
      parts.push(cur.name.text);
      break;
    }
    cur = cur.parent;
  }
  return parts.length > 0 ? parts.join('.') : '<module scope>';
}

/** Вычислить строковый литерал: литерал / конкатенация литералов / undefined. */
function evalStringLiteral(sf: ts.SourceFile, node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node) && node.templateSpans.length === 0) return node.head.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = evalStringLiteral(sf, node.left);
    const r = evalStringLiteral(sf, node.right);
    if (l !== undefined && r !== undefined) return l + r;
  }
  return undefined;
}

// ─── Импорт-алиасы синглтона шины в файле ───────────────────────────────────

function busAliasesInFile(sf: ts.SourceFile): Set<string> {
  const set = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !st.importClause.namedBindings) continue;
    const nb = st.importClause.namedBindings;
    if (!ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) {
      if (!el.propertyName) continue;
      const imported = el.propertyName.text;
      if (BUS_SINGLETON_NAMES.has(imported)) {
        set.add(el.name.text);
      }
    }
  }
  return set;
}

// ─── Факты одного файла (имена событий/запросов — внутри фактов) ────────────

interface FileFacts {
  emits: EmitFact[];
  subscriptions: SubscribeFact[];
  queriesRegistered: RegisterFact[];
  queriesUnregistered: UnregisterFact[];
  queriesCalled: QueryCallFact[];
  unresolved: UnresolvedForm[];
  replay: Array<{ event: string; file: string; line: number }>;
  busSingleton: Array<{ file: string; line: number; note: string }>;
}

function emptyFacts(): FileFacts {
  return { emits: [], subscriptions: [], queriesRegistered: [], queriesUnregistered: [], queriesCalled: [], unresolved: [], replay: [], busSingleton: [] };
}

function collectFileFacts(sf: ts.SourceFile, displayFile: string, aliases: Set<string>): FileFacts {
  const facts = emptyFacts();

  const isBusReceiver = (recv: string): boolean => BUS_RECEIVERS.has(recv) || aliases.has(recv) || recv.endsWith('.getBus()');

  /** Разрешить имя из первого аргумента. Возвращает литеральные имена; при не-литерале — фиксирует unresolved. */
  const resolveName = (call: ts.CallExpression, kind: UnresolvedForm['kind'], recv: string, recognized: boolean): string[] => {
    const line = lineOf(sf, call);
    const arg = call.arguments[0];
    if (arg === undefined) {
      facts.unresolved.push({ file: displayFile, line, receiver: recv, recognized, kind, detail: 'вызов без аргументов' });
      return [];
    }
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
    if (ts.isConditionalExpression(arg)) {
      const w = evalStringLiteral(sf, arg.whenTrue);
      const t = evalStringLiteral(sf, arg.whenFalse);
      if (w !== undefined && t !== undefined) return [w, t];
    }
    facts.unresolved.push({
      file: displayFile,
      line,
      receiver: recv,
      recognized,
      kind,
      detail: `имя события/запроса не строковый литерал: ${arg.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`,
    });
    return [];
  };

  const optionsOf = (arg: ts.Expression | undefined): { priority?: string; label?: string; once?: boolean } => {
    if (!arg || !ts.isObjectLiteralExpression(arg)) return {};
    const out: { priority?: string; label?: string; once?: boolean } = {};
    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
      if (prop.name.text === 'priority') out.priority = prop.initializer.getText(sf).replace(/\s+/g, ' ');
      else if (prop.name.text === 'label') out.label = evalStringLiteral(sf, prop.initializer);
      else if (prop.name.text === 'once') out.once = prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
    }
    return out;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const recv = normReceiver(node.expression.expression.getText(sf));
      const method = node.expression.name.text;
      const line = lineOf(sf, node);
      const busRecv = isBusReceiver(recv);

      if (busRecv) {
        if (method === 'emit') {
          for (const name of resolveName(node, 'emit', recv, true)) {
            facts.emits.push({ file: displayFile, line, event: name, publisher: enclosingName(sf, node), receiver: recv });
          }
        } else if (method === 'on' || method === 'once') {
          const names = resolveName(node, method, recv, true);
          if (names.length === 1) {
            const o = optionsOf(node.arguments[1]);
            facts.subscriptions.push({
              file: displayFile,
              line,
              event: names[0]!,
              subscriber: enclosingName(sf, node),
              receiver: recv,
              priority: o.priority,
              label: o.label,
              once: method === 'once' ? true : o.once,
            });
          }
        } else if (method === 'enableReplay') {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) facts.replay.push({ event: arg.text, file: displayFile, line });
        }
      } else if (recv === 'this') {
        // Механизменные вызовы внутри самой шины (flush()-редиспатч и т.п.):
        // прозрачность без влияния на статусы (recognized=false).
        if (method === 'emit' || method === 'on' || method === 'once') {
          const arg = node.arguments[0];
          if (arg && !ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
            facts.unresolved.push({
              file: displayFile,
              line,
              receiver: recv,
              recognized: false,
              kind: method,
              detail: `механизменный вызов шины с не-литеральным именем: ${arg.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`,
            });
          }
        }
      }

      if (isRegistryReceiver(recv)) {
        if (method === 'registerQuery' || method === 'unregisterQuery') {
          const names = resolveName(node, 'registerQuery', recv, true);
          if (names.length === 1) {
            if (method === 'registerQuery') {
              facts.queriesRegistered.push({ file: displayFile, line, query: names[0]!, moduleContext: enclosingName(sf, node) });
            } else {
              facts.queriesUnregistered.push({ file: displayFile, line, query: names[0]! });
            }
          }
        } else if (method === 'query') {
          for (const name of resolveName(node, 'query', recv, true)) {
            facts.queriesCalled.push({ file: displayFile, line, query: name, caller: enclosingName(sf, node) });
          }
        }
      }
    }

    // Синглтон-объявление шины: export const gameBus = new TypedEventBus(...)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && BUS_SINGLETON_NAMES.has(node.name.text) && node.initializer && ts.isNewExpression(node.initializer)) {
      facts.busSingleton.push({
        file: displayFile,
        line: lineOf(sf, node),
        note: `объявление синглтона ${node.name.text} = new ${node.initializer.expression.getText(sf)}()`,
      });
    }
    // Привязка синглтона к медиатору: this.bus = gameBus
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && normReceiver(node.left.getText(sf)) === 'this.bus' && ts.isIdentifier(node.right) && BUS_SINGLETON_NAMES.has(node.right.text)) {
      facts.busSingleton.push({ file: displayFile, line: lineOf(sf, node), note: `this.bus = ${node.right.text} (единая шина, R-39)` });
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return facts;
}

// ─── Каталог событий ────────────────────────────────────────────────────────

function extractEventCatalog(eventsFile: string): EventDecl[] {
  const text = readFileSync(eventsFile, 'utf8');
  const sf = ts.createSourceFile(eventsFile, text, ts.ScriptTarget.ES2022, true);
  const catalog: EventDecl[] = [];
  for (const st of sf.statements) {
    if (!ts.isInterfaceDeclaration(st) || !st.name.text.endsWith('Events')) continue;
    for (const member of st.members) {
      if (!ts.isPropertySignature(member) || !member.name || !member.type) continue;
      if (ts.isStringLiteral(member.name)) {
        catalog.push({
          name: member.name.text,
          line: lineOf(sf, member),
          payloadType: member.type.getText(sf).replace(/\s+/g, ' '),
          interfaceName: st.name.text,
        });
      }
    }
  }
  catalog.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return catalog;
}

// ─── ModuleId union ─────────────────────────────────────────────────────────

function extractModuleIds(moduleTypesFile: string): Array<{ id: string; line: number }> {
  const text = readFileSync(moduleTypesFile, 'utf8');
  const sf = ts.createSourceFile(moduleTypesFile, text, ts.ScriptTarget.ES2022, true);
  const out: Array<{ id: string; line: number }> = [];
  const walk = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'ModuleId' && node.type && ts.isUnionTypeNode(node.type)) {
      for (const t of node.type.types) {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) {
          out.push({ id: t.literal.text, line: lineOf(sf, t) });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

// ─── Манифесты/классы модулей ───────────────────────────────────────────────

interface ClassInfo {
  className: string;
  file: string;
  id: string;
  name: string | null;
  version: string | null;
  description: string | null;
  dependencies: string[];
  emits: ManifestEmitDecl[];
  subscribes: ManifestSubDecl[];
  handlesQueries: ManifestQueryDecl[];
  requiresQueries: ManifestQueryDecl[];
}

function readSourceFile(file: string): ts.SourceFile | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, kind);
}

function extractModuleClasses(files: string[], root: string): ClassInfo[] {
  const classes: ClassInfo[] = [];
  for (const file of [...files].sort()) {
    const sf = readSourceFile(file);
    if (!sf) continue;
    const display = relPath(root, file);
    const walk = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) && node.name) {
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name) || member.name.text !== 'manifest') continue;
          if (!member.initializer || !ts.isObjectLiteralExpression(member.initializer)) continue;
          const obj = member.initializer;
          let id: string | undefined;
          let name: string | null = null;
          let version: string | null = null;
          let description: string | null = null;
          const dependencies: string[] = [];
          const emits: ManifestEmitDecl[] = [];
          const subscribes: ManifestSubDecl[] = [];
          const handlesQueries: ManifestQueryDecl[] = [];
          const requiresQueries: ManifestQueryDecl[] = [];

          for (const prop of obj.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            const line = lineOf(sf, prop);
            switch (prop.name.text) {
              case 'id': {
                const v = evalStringLiteral(sf, prop.initializer);
                if (v !== undefined) id = v;
                break;
              }
              case 'name':
                name = evalStringLiteral(sf, prop.initializer) ?? null;
                break;
              case 'version':
                version = evalStringLiteral(sf, prop.initializer) ?? null;
                break;
              case 'description':
                description = evalStringLiteral(sf, prop.initializer) ?? prop.initializer.getText(sf).replace(/\s+/g, ' ');
                break;
              case 'dependencies':
                if (ts.isArrayLiteralExpression(prop.initializer)) {
                  for (const el of prop.initializer.elements) {
                    const v = evalStringLiteral(sf, el);
                    if (v !== undefined) dependencies.push(v);
                  }
                }
                break;
              case 'emits':
                if (ts.isArrayLiteralExpression(prop.initializer)) {
                  for (const el of prop.initializer.elements) {
                    const v = evalStringLiteral(sf, el);
                    if (v !== undefined) emits.push({ name: v, line: lineOf(sf, el) });
                  }
                }
                break;
              case 'subscribes':
                if (ts.isArrayLiteralExpression(prop.initializer)) {
                  for (const el of prop.initializer.elements) {
                    if (!ts.isObjectLiteralExpression(el)) continue;
                    let ev: string | undefined;
                    let priority: string | undefined;
                    let once: boolean | undefined;
                    for (const p of el.properties) {
                      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
                      if (p.name.text === 'event') ev = evalStringLiteral(sf, p.initializer);
                      else if (p.name.text === 'priority') priority = p.initializer.getText(sf).replace(/\s+/g, ' ');
                      else if (p.name.text === 'once') once = p.initializer.kind === ts.SyntaxKind.TrueKeyword ? true : undefined;
                    }
                    if (ev !== undefined) subscribes.push({ event: ev, priority, once, line: lineOf(sf, el) });
                  }
                }
                break;
              case 'handlesQueries':
              case 'requiresQueries': {
                if (ts.isArrayLiteralExpression(prop.initializer)) {
                  for (const el of prop.initializer.elements) {
                    if (!ts.isObjectLiteralExpression(el)) continue;
                    let queryName: string | undefined;
                    let description: string | undefined;
                    let requestType: string | undefined;
                    let responseType: string | undefined;
                    for (const p of el.properties) {
                      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
                      const v = evalStringLiteral(sf, p.initializer);
                      if (p.name.text === 'queryName') queryName = v;
                      else if (p.name.text === 'description') description = v;
                      else if (p.name.text === 'requestType') requestType = v;
                      else if (p.name.text === 'responseType') responseType = v;
                    }
                    if (queryName !== undefined) {
                      const decl: ManifestQueryDecl = { queryName, line: lineOf(sf, el) };
                      if (description !== undefined) decl.description = description;
                      if (requestType !== undefined) decl.requestType = requestType;
                      if (responseType !== undefined) decl.responseType = responseType;
                      if (prop.name.text === 'handlesQueries') handlesQueries.push(decl);
                      else requiresQueries.push(decl);
                    }
                  }
                }
                break;
              }
              default:
                break;
            }
          }

          if (id !== undefined) {
            classes.push({
              className: node.name.text,
              file: display,
              id,
              name,
              version,
              description,
              dependencies,
              emits,
              subscribes,
              handlesQueries,
              requiresQueries,
            });
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  classes.sort((a, b) => (a.className < b.className ? -1 : a.className > b.className ? 1 : 0));
  return classes;
}

// ─── Регистрация модулей ────────────────────────────────────────────────────

interface RegistrationInfo {
  order: string[];
  perModule: Map<string, Array<{ file: string; line: number; order: number }>>;
}

function extractRegistrations(files: string[], root: string, classByClassName: Map<string, ClassInfo>): RegistrationInfo {
  const order: string[] = [];
  const perModule = new Map<string, Array<{ file: string; line: number; order: number }>>();
  let counter = 0;

  const findVarNewClass = (sf: ts.SourceFile, varName: string): string | null => {
    let found: string | null = null;
    const walk = (node: ts.Node): void => {
      if (found) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === varName && node.initializer && ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)) {
        found = node.initializer.expression.text;
        return;
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
    return found;
  };

  const idOfArg = (sf: ts.SourceFile, expr: ts.Expression): string | null => {
    if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression)) {
      const ci = classByClassName.get(expr.expression.text);
      return ci ? ci.id : null;
    }
    if (ts.isIdentifier(expr)) {
      const cls = findVarNewClass(sf, expr.text);
      if (cls) {
        const ci = classByClassName.get(cls);
        if (ci) return ci.id;
      }
    }
    return null;
  };

  for (const file of [...files].sort()) {
    const sf = readSourceFile(file);
    if (!sf) continue;
    const display = relPath(root, file);
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const line = lineOf(sf, node);
        if ((method === 'registerAndInit' || method === 'registerModule') && node.arguments.length > 0) {
          const args: ts.Expression[] = method === 'registerAndInit' && ts.isArrayLiteralExpression(node.arguments[0]!) ? [...node.arguments[0]!.elements] : [node.arguments[0]!];
          for (const el of args) {
            const id = idOfArg(sf, el);
            if (id) {
              counter += 1;
              order.push(id);
              const arr = perModule.get(id) ?? [];
              arr.push({ file: display, line, order: counter });
              perModule.set(id, arr);
            }
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return { order, perModule };
}

/** Точная реплика ModuleRegistry.recalculateInitOrder (src/core/module-registry.ts:217-248). */
function replicateInitOrder(insertionOrder: string[], depsOf: (id: string) => string[]): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`[gen-module-bus-map] Циклическая зависимость обнаружена: ${id}`);
    }
    visiting.add(id);
    for (const dep of depsOf(id)) {
      if (insertionOrder.includes(dep)) visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of insertionOrder) visit(id);
  return order;
}

// ─── Агрегация test-фактов ───────────────────────────────────────────────────

function aggregateByFile(facts: Array<{ file: string; line: number }>): Array<{ file: string; lines: number[] }> {
  const byFile = new Map<string, number[]>();
  for (const f of facts) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f.line);
    byFile.set(f.file, arr);
  }
  return [...byFile.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([file, lines]) => ({ file, lines: [...lines].sort((x, y) => x - y) }));
}

// ─── Главная функция анализа ─────────────────────────────────────────────────

export function analyzeBusMap(opts: AnalyzeOptions): BusMap {
  const root = opts.rootDir ? resolve(opts.rootDir) : process.cwd();
  const productionFiles = [...opts.productionFiles].sort();
  const nonProductionFiles = [...(opts.nonProductionFiles ?? [])].sort();

  const catalog = extractEventCatalog(opts.eventsFile);
  const moduleIds = extractModuleIds(opts.moduleTypesFile);

  const classes = extractModuleClasses(productionFiles, root);
  const classByClassName = new Map(classes.map((c) => [c.className, c]));
  const classById = new Map<string, ClassInfo>();
  for (const c of classes) if (!classById.has(c.id)) classById.set(c.id, c);
  // F2 (follow-up): файлы объявления модулей — граница между module-owned
  // и file-level emit-фактами.
  const moduleFileSet = new Set(classes.map((c) => c.file));

  // Факты: production и non-production отдельно.
  const prodFacts = new Map<string, FileFacts>();
  const testFacts = new Map<string, FileFacts>();
  const scan = (file: string, target: Map<string, FileFacts>): void => {
    const sf = readSourceFile(file);
    if (!sf) return;
    const display = relPath(root, file);
    target.set(display, collectFileFacts(sf, display, busAliasesInFile(sf)));
  };
  for (const f of productionFiles) scan(f, prodFacts);
  for (const f of nonProductionFiles) scan(f, testFacts);

  const collect = (maps: Array<Map<string, FileFacts>>): Omit<FileFacts, never> => {
    const out = emptyFacts();
    for (const m of maps) {
      for (const f of m.values()) {
        out.emits.push(...f.emits);
        out.subscriptions.push(...f.subscriptions);
        out.queriesRegistered.push(...f.queriesRegistered);
        out.queriesUnregistered.push(...f.queriesUnregistered);
        out.queriesCalled.push(...f.queriesCalled);
        out.unresolved.push(...f.unresolved);
        out.replay.push(...f.replay);
        out.busSingleton.push(...f.busSingleton);
      }
    }
    return out;
  };
  const prod = collect([prodFacts]);
  const everything = collect([prodFacts, testFacts]);

  const sortByFileLine = <T extends { file: string; line: number }>(arr: T[]): T[] =>
    [...arr].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  // Регистрация (production).
  const registration = extractRegistrations(productionFiles, root, classByClassName);
  const registeredIds = [...new Set(registration.order)];
  const depsOf = (id: string): string[] => classById.get(id)?.dependencies ?? [];
  const initOrder = replicateInitOrder(registeredIds, depsOf);

  // ─── Модули ───
  const modules: Record<string, ModuleEntry> = {};
  const buildEntry = (id: string, ci: ClassInfo | undefined, registrationStatus: ModuleEntry['registrationStatus']): ModuleEntry => {
    // F2 (follow-up): модуль-own факты — ТОЛЬКО emit-вызовы файла объявления
    // класса. Каталоговая эвристика «файл модуля ИЛИ любой файл его директории»
    // удалена: она приписывала один и тот же список engine-emissions обоим
    // модулям общей директории (ships/fleet). Emissions из прочих файлов —
    // в топ-уровневой секции fileLevelEmits без утверждения владения.
    const observedEmits = ci ? sortByFileLine(prod.emits.filter((e) => e.file === ci.file)) : [];
    const observedSubs = ci ? sortByFileLine(prod.subscriptions.filter((s) => s.file === ci.file)) : [];
    const qReg = ci ? sortByFileLine(prod.queriesRegistered.filter((q) => q.file === ci.file)) : [];
    const qUnreg = ci ? sortByFileLine(prod.queriesUnregistered.filter((q) => q.file === ci.file)) : [];
    const qCalled = ci ? sortByFileLine(prod.queriesCalled.filter((q) => q.file === ci.file)) : [];
    const reg = [...(registration.perModule.get(id) ?? [])].sort((a, b) => a.order - b.order);
    return {
      id,
      className: ci?.className ?? null,
      file: ci?.file ?? null,
      name: ci?.name ?? null,
      version: ci?.version ?? null,
      description: ci?.description ?? null,
      manifest: ci
        ? {
            dependencies: [...ci.dependencies],
            emits: [...ci.emits].sort((a, b) => a.line - b.line),
            subscribes: [...ci.subscribes].sort((a, b) => a.line - b.line),
            handlesQueries: [...ci.handlesQueries].sort((a, b) => a.line - b.line),
            requiresQueries: [...ci.requiresQueries].sort((a, b) => a.line - b.line),
          }
        : { dependencies: [], emits: [], subscribes: [], handlesQueries: [], requiresQueries: [] },
      observed: { emits: observedEmits, subscriptions: observedSubs, queriesRegistered: qReg, queriesUnregistered: qUnreg, queriesCalled: qCalled },
      registration: reg,
      tick: { positionInInitOrder: initOrder.includes(id) ? initOrder.indexOf(id) + 1 : null },
      registrationStatus,
    };
  };

  for (const id of registeredIds) {
    modules[id] = buildEntry(id, classById.get(id), 'active');
  }
  for (const c of classes) {
    if (!registeredIds.includes(c.id) && !modules[c.id]) {
      modules[c.id] = buildEntry(c.id, c, 'unregistered');
    }
  }
  const moduleTypesRel = relPath(root, opts.moduleTypesFile);
  for (const { id, line } of moduleIds) {
    if (!modules[id]) {
      modules[id] = {
        id,
        className: null,
        file: moduleTypesRel,
        name: null,
        version: null,
        description: `идентификатор объявлен в ModuleId (${moduleTypesRel}:${line}), класс не найден — зарезервирован`,
        manifest: { dependencies: [], emits: [], subscribes: [], handlesQueries: [], requiresQueries: [] },
        observed: { emits: [], subscriptions: [], queriesRegistered: [], queriesUnregistered: [], queriesCalled: [] },
        registration: [],
        tick: { positionInInitOrder: null },
        registrationStatus: 'reserved',
      };
    }
  }

  // ─── События ───
  // Понижение до dynamic_or_unresolved — только по НЕразрешённым формам в
  // PRODUCTION-коде (test-side переменные не являются производственной
  // неопределённостью; они фиксируются в analyzer.unresolvedForms для прозрачности).
  const recognizedUnresolvedEmit = prod.unresolved.some((u) => u.recognized && u.kind === 'emit');

  const events: Record<string, EventEntry> = {};
  for (const ev of catalog) {
    const name = ev.name;
    const prodEmitters = sortByFileLine(prod.emits.filter((f) => f.event === name));
    const prodConsumers = sortByFileLine(prod.subscriptions.filter((f) => f.event === name));
    const testEmitters = aggregateByFile(testFactsEmits(testFacts, name));
    const testConsumers = aggregateByFile(testFactsSubs(testFacts, name));

    const manifestEmittedBy = Object.values(modules)
      .filter((m) => m.manifest.emits.some((e) => e.name === name))
      .map((m) => ({ module: m.id, line: m.manifest.emits.find((e) => e.name === name)!.line }))
      .sort((a, b) => (a.module < b.module ? -1 : 1));
    const manifestSubscribedBy = Object.values(modules)
      .filter((m) => m.manifest.subscribes.some((s) => s.event === name))
      .map((m) => {
        const s = m.manifest.subscribes.find((x) => x.event === name)!;
        return { module: m.id, line: s.line, priority: s.priority };
      })
      .sort((a, b) => (a.module < b.module ? -1 : 1));

    // mismatch: подписочная сторона — по модулям (файл модуля ↔ фактические подписки).
    let mismatch = false;
    for (const m of Object.values(modules)) {
      if (m.registrationStatus === 'reserved' || !m.file) continue;
      const declared = m.manifest.subscribes.some((s) => s.event === name);
      const observed = prod.subscriptions.some((s) => s.event === name && s.file === m.file);
      if (declared !== observed) {
        mismatch = true;
        break;
      }
    }

    let status: string;
    if (recognizedUnresolvedEmit && prodEmitters.length === 0) {
      status = 'dynamic_or_unresolved';
    } else if (mismatch) {
      status = 'manifest_vs_runtime_mismatch';
    } else if (prodConsumers.length > 0 && prodEmitters.length === 0) {
      status = 'consumer_without_observed_publisher';
    } else if ((prodEmitters.length > 0 || prodConsumers.length > 0) && manifestEmittedBy.length === 0 && manifestSubscribedBy.length === 0) {
      status = 'observed_but_not_declared';
    } else if (prodEmitters.length > 0 && prodConsumers.length === 0) {
      status = 'published_without_observed_consumer';
    } else if (prodEmitters.length === 0) {
      status = 'declared_but_not_observed_published';
    } else {
      status = 'declared_and_published';
    }

    events[name] = {
      declared: { file: relPath(root, opts.eventsFile), line: ev.line, payloadType: ev.payloadType, interfaceName: ev.interfaceName },
      manifestEmittedBy,
      manifestSubscribedBy,
      productionEmitters: prodEmitters,
      productionConsumers: prodConsumers,
      testEmitters,
      testConsumers,
      status,
    };
  }

  // ─── Запросы ───
  const queryNames = new Set<string>();
  for (const m of Object.values(modules)) {
    for (const q of m.manifest.handlesQueries) queryNames.add(q.queryName);
    for (const q of m.manifest.requiresQueries) queryNames.add(q.queryName);
  }
  for (const q of everything.queriesRegistered) queryNames.add(q.query);
  for (const q of everything.queriesCalled) queryNames.add(q.query);
  for (const q of everything.queriesUnregistered) queryNames.add(q.query);

  const queries: Record<string, QueryEntry> = {};
  for (const name of [...queryNames].sort()) {
    const declaredHandles = Object.values(modules)
      .filter((m) => m.manifest.handlesQueries.some((q) => q.queryName === name))
      .map((m) => ({ module: m.id, line: m.manifest.handlesQueries.find((q) => q.queryName === name)!.line }))
      .sort((a, b) => (a.module < b.module ? -1 : 1));
    const declaredRequires = Object.values(modules)
      .filter((m) => m.manifest.requiresQueries.some((q) => q.queryName === name))
      .map((m) => ({ module: m.id, line: m.manifest.requiresQueries.find((q) => q.queryName === name)!.line }))
      .sort((a, b) => (a.module < b.module ? -1 : 1));
    // F1 (follow-up): production-регистрация/снятие — ТОЛЬКО факты из src/;
    // тестовые регистрации не классифицируют запрос как зарегистрированный.
    const registeredBy = sortByFileLine(prod.queriesRegistered.filter((r) => r.query === name));
    const unregisteredBy = sortByFileLine(prod.queriesUnregistered.filter((r) => r.query === name));
    const testRegisteredBy = aggregateByFile(testFactsQueryRegisters(testFacts, name));
    const testUnregisteredBy = aggregateByFile(testFactsQueryUnregisters(testFacts, name));
    const productionCallers = sortByFileLine(prod.queriesCalled.filter((c) => c.query === name));
    const testCallers = aggregateByFile(testFactsQueryCalls(testFacts, name));

    let status: string;
    if (registeredBy.length === 0 && productionCallers.length > 0) status = 'unregistered_call';
    else if (registeredBy.length > 0 && declaredHandles.length === 0) status = 'registered_not_declared';
    else if (registeredBy.length === 0 && declaredHandles.length > 0) status = 'declared_not_registered';
    else if (registeredBy.length > 0 && declaredHandles.length > 0) status = 'declared_and_registered';
    else status = 'unused';

    queries[name] = {
      declaredHandles,
      declaredRequires,
      registeredBy,
      unregisteredBy,
      testRegisteredBy,
      testUnregisteredBy,
      productionCallers,
      testCallers,
      status,
    };
  }

  const summaryEvents: Record<string, number> = {};
  for (const ev of Object.values(events)) summaryEvents[ev.status] = (summaryEvents[ev.status] ?? 0) + 1;

  const eventsRel = relPath(root, opts.eventsFile);
  return {
    note:
      'Инвентаризация ФАКТИЧЕСКОЙ реализации модульной шины SpaceGame. Сгенерировано scripts/gen-module-bus-map.ts; не редактировать вручную — перегенерация перезапишет. Инвентаризация НЕ заменяет канонические контракты (docs/architecture/modular-bus.md, src/core/events.ts). Схема полей и статусы: docs/architecture/module-contracts.md.',
    tool: { script: 'scripts/gen-module-bus-map.ts', regenerate: 'bun run audit:module-bus', check: 'bun run audit:module-bus --check' },
    analyzer: {
      formsCovered: [...FORMS_COVERED],
      busReceivers: [...BUS_RECEIVERS].sort().concat(['<import-алиасы gameBus>', '*.getBus()']),
      limitations: [...LIMITATIONS],
      unresolvedForms: sortByFileLine(everything.unresolved),
    },
    wiring: {
      busSingleton: sortByFileLine(everything.busSingleton),
      replayEnabled: sortByFileLine(everything.replay).map((r) => ({ event: r.event, file: r.file, line: r.line })),
      registrationOrder: registeredIds,
      initOrder,
      tickOrderNote: TICK_ORDER_NOTE,
    },
    // F2 (follow-up): file-level emissions — production-факты из файлов, которые
    // не являются файлом объявления ни одного модуля (engine/инфраструктура).
    // Каждый факт публикуется ровно один раз; владение модулем не утверждается.
    fileLevelEmits: sortByFileLine(prod.emits.filter((e) => !moduleFileSet.has(e.file))),
    modules,
    events,
    queries,
    summary: { events: summaryEvents, modules: Object.keys(modules).length, queries: Object.keys(queries).length },
  };

  // ── локальные помощники ──
  function testFactsEmits(maps: Map<string, FileFacts>, name: string): Array<{ file: string; line: number }> {
    const out: Array<{ file: string; line: number }> = [];
    for (const ff of maps.values()) for (const e of ff.emits) if (e.event === name) out.push({ file: e.file, line: e.line });
    return out;
  }
  function testFactsSubs(maps: Map<string, FileFacts>, name: string): Array<{ file: string; line: number }> {
    const out: Array<{ file: string; line: number }> = [];
    for (const ff of maps.values()) for (const s of ff.subscriptions) if (s.event === name) out.push({ file: s.file, line: s.line });
    return out;
  }
  function testFactsQueryCalls(maps: Map<string, FileFacts>, name: string): Array<{ file: string; line: number }> {
    const out: Array<{ file: string; line: number }> = [];
    for (const ff of maps.values()) for (const c of ff.queriesCalled) if (c.query === name) out.push({ file: c.file, line: c.line });
    return out;
  }
  function testFactsQueryRegisters(maps: Map<string, FileFacts>, name: string): Array<{ file: string; line: number }> {
    const out: Array<{ file: string; line: number }> = [];
    for (const ff of maps.values()) for (const r of ff.queriesRegistered) if (r.query === name) out.push({ file: r.file, line: r.line });
    return out;
  }
  function testFactsQueryUnregisters(maps: Map<string, FileFacts>, name: string): Array<{ file: string; line: number }> {
    const out: Array<{ file: string; line: number }> = [];
    for (const ff of maps.values()) for (const r of ff.queriesUnregistered) if (r.query === name) out.push({ file: r.file, line: r.line });
    return out;
  }
}

// ─── Рендер и проверка дрейфа ───────────────────────────────────────────────

export function renderJson(map: BusMap): string {
  return JSON.stringify(map, null, 2) + '\n';
}

export function isDrifted(currentRendered: string, existingContent: string | null): boolean {
  if (existingContent === null) return true;
  return currentRendered !== existingContent;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const DEFAULT_OUT = 'docs/architecture/module-bus-map.json';

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function collectFiles(root: string, dirs: string[], exts: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full);
      } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
        // Фикстуры анализатора — входные данные его тестов, а не тесты игры:
        // из скана реального репозитория исключаются.
        if (full.includes('tests/arch/fixtures')) continue;
        out.push(full);
      }
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.sort();
}

export async function main(argv: string[]): Promise<number> {
  const check = argv.includes('--check');
  const root = resolve(argValue(argv, '--root') ?? process.cwd());
  const outArg = argValue(argv, '--out');
  const outFile = isAbsolute(outArg ?? '') ? outArg! : join(root, outArg ?? DEFAULT_OUT);

  const productionFiles = collectFiles(root, ['src'], ['.ts', '.tsx']);
  const nonProductionFiles = collectFiles(root, ['tests', 'scripts'], ['.ts', '.tsx']);

  const map = analyzeBusMap({
    eventsFile: join(root, 'src/core/events.ts'),
    moduleTypesFile: join(root, 'src/core/module-types.ts'),
    productionFiles,
    nonProductionFiles,
    rootDir: root,
  });
  const rendered = renderJson(map);

  if (check) {
    const existing = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;
    if (!isDrifted(rendered, existing)) {
      console.log(`[audit:module-bus] OK — артефакт актуален (${outArg ?? DEFAULT_OUT})`);
      return 0;
    }
    console.error(`[audit:module-bus] DRIFT — артефакт устарел или отсутствует: ${outArg ?? DEFAULT_OUT}`);
    console.error('[audit:module-bus] Запустите: bun run audit:module-bus — и закоммитьте обновлённый артефакт.');
    if (existing) {
      const a = rendered.split('\n');
      const b = existing.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`[audit:module-bus] первое расхождение — строка ${i + 1}:`);
          console.error(`  ожидание (в артефакте): ${(b[i] ?? '<eof>').slice(0, 160)}`);
          console.error(`  факт (свежий анализ):   ${(a[i] ?? '<eof>').slice(0, 160)}`);
          break;
        }
      }
    }
    return 1;
  }

  writeFileSync(outFile, rendered, 'utf8');
  const counts = Object.entries(map.summary.events)
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  console.log(`[audit:module-bus] сгенерировано: ${outArg ?? DEFAULT_OUT}`);
  console.log(`[audit:module-bus] событий: ${Object.keys(map.events).length}; модулей: ${map.summary.modules}; запросов: ${map.summary.queries}`);
  console.log(`[audit:module-bus] статусы: ${counts}`);
  console.log(`[audit:module-bus] unresolved форм: ${map.analyzer.unresolvedForms.length}`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('gen-module-bus-map.ts')) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error('[audit:module-bus] ошибка:', err);
      process.exit(2);
    },
  );
}
