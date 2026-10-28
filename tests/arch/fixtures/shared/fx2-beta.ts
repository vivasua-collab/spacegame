/**
 * F2-фикстура: второй из ДВУХ модулей той же директории. Старая каталоговая
 * эвристика приписала бы ему emissions engine-файла соседа; новая логика — нет.
 */
import { gameBus } from '../fx-bus';
import type { FxGameModule, FxManifest } from '../fx-registry';
import { runSharedEngine } from './fx2-engine';

export class BetaModule implements FxGameModule {
  readonly manifest: FxManifest = {
    id: 'f2b',
    name: 'Beta',
    version: '0.1.0',
    description: 'второй модуль той же директории',
    dependencies: [],
    emits: ['f2:own-b'],
    subscribes: [],
    handlesQueries: [],
    requiresQueries: [],
  };

  readonly phase = 'uninitialized';

  init(): void {
    gameBus.emit('f2:own-b', {});
    runSharedEngine();
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
