/**
 * Второй фикстурный модуль: зависит от fx (топосорт), объявляет requiresQueries
 * и делает production-вызовы query — зарегистрированного и незарегистрированного.
 */
import { FxRegistry, type FxGameModule, type FxManifest } from './fx-registry';

export class OtherModule implements FxGameModule {
  readonly manifest: FxManifest = {
    id: 'other',
    name: 'Other',
    version: '0.1.0',
    description: 'зависит от fx и вызывает query',
    dependencies: ['fx'],
    emits: [],
    subscribes: [],
    handlesQueries: [],
    requiresQueries: [
      { queryName: 'fx:q', description: 'требует фикстурный запрос', requestType: 'void', responseType: 'string' },
    ],
  };

  readonly phase = 'uninitialized';
  private registry = new FxRegistry();

  init(): void {
    // вызов ЗАРЕГИСТРИРОВАННОГО запроса (production caller)
    this.registry.query<string>('fx:q');
    // вызов НЕзарегистрированного запроса → unregistered_call
    this.registry.query<string>('fx:ghost-q');
  }

  start(): void {}
  tick(_time: number): void {}
  stop(): void {}
  destroy(): void {}
  serialize(): Record<string, unknown> {
    return {};
  }
  deserialize(_data: Record<string, unknown>): void {}
}
