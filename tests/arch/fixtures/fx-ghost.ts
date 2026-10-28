/**
 * Модуль-класс, который НИКТО не регистрирует (статус unregistered в карте,
 * при этом идентификатор 'fxghost' есть в ModuleId-union фикстуры).
 */
import { FxRegistry, type FxGameModule, type FxManifest } from './fx-registry';

export class GhostModule implements FxGameModule {
  readonly manifest: FxManifest = {
    id: 'fxghost',
    name: 'Ghost',
    version: '0.0.1',
    description: 'класс есть, регистрации нет',
    dependencies: [],
    emits: [],
    subscribes: [],
    handlesQueries: [],
    requiresQueries: [],
  };

  readonly phase = 'uninitialized';
  private registry = new FxRegistry();

  init(): void {
    this.registry.registerQuery('fx:ghost-q', () => null);
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
