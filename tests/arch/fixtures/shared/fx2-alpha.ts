/**
 * F2-фикстура: первый из ДВУХ модулей в одной директории. Собственный emit
 * (own-file) + вызов общего engine (call-graph не строится — факта не создаёт).
 */
import { gameBus } from '../fx-bus';
import type { FxGameModule, FxManifest } from '../fx-registry';
import { runSharedEngine } from './fx2-engine';

export class AlphaModule implements FxGameModule {
  readonly manifest: FxManifest = {
    id: 'f2a',
    name: 'Alpha',
    version: '0.1.0',
    description: 'первый модуль общей директории',
    dependencies: [],
    emits: ['f2:own-a'],
    subscribes: [],
    handlesQueries: [],
    requiresQueries: [],
  };

  readonly phase = 'uninitialized';

  init(): void {
    gameBus.emit('f2:own-a', {});
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
