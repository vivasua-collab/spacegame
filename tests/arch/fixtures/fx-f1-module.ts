/**
 * F1-фикстура (follow-up Issue #17): production-модуль ОБЪЯВЛЯЕТ query
 * (handlesQueries), но НИГДЕ в production его не регистрирует.
 * Регистрация/вызов/снятие существуют только в тестовом файле
 * (fx-f1-nonprod-reg.ts, включается в nonProductionFiles).
 *
 * Ожидание: query НЕ классифицируется как зарегистрированный в production
 * (status=declared_not_registered); test-only факты публикуются отдельно в
 * testRegisteredBy/testUnregisteredBy/testCallers и на статус не влияют.
 */
import { FxRegistry, type FxGameModule, type FxManifest } from './fx-registry';

export class F1QueryModule implements FxGameModule {
  readonly manifest: FxManifest = {
    id: 'f1q',
    name: 'F1Query',
    version: '0.1.0',
    description: 'декларирует query, регистрация только в тестах',
    dependencies: [],
    emits: [],
    subscribes: [],
    handlesQueries: [
      { queryName: 'fx:f1-q', description: 'фикстурный query F1', requestType: 'void', responseType: 'string' },
    ],
    requiresQueries: [],
  };

  readonly phase = 'uninitialized';
  private registry = new FxRegistry();

  // ВАЖНО: регистрация query здесь ОТСУТСТВУЕТ — это суть фикстуры F1.
  init(): void {}

  start(): void {}
  tick(_time: number): void {}
  stop(): void {}
  destroy(): void {}
  serialize(): Record<string, unknown> {
    return {};
  }
  deserialize(_data: Record<string, unknown>): void {}
}
