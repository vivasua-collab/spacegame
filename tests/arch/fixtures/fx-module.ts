/**
 * Фикстурный модуль — покрывает формы: прямой typed emit (литерал), emit через
 * алиас импорта синглтона, тернарник литералов, подписка с priority/label,
 * СКРЫТАЯ подписка (runtime без декларации — mismatch), регистрация query.
 */
import { FxBus, gameBus as bus2 } from './fx-bus';
import { FxRegistry, type FxGameModule, type FxManifest } from './fx-registry';

export class FxModule implements FxGameModule {
  readonly manifest: FxManifest = {
    id: 'fx',
    name: 'Fx',
    version: '1.0.0',
    // конкатенация литералов — вычисляется анализатором
    description: 'фикстурный модуль ' + 'с конкатенацией',
    dependencies: [],
    emits: ['fx:ping', 'fx:future'],
    subscribes: [{ event: 'fx:only-sub', priority: 10 }],
    handlesQueries: [
      { queryName: 'fx:q', description: 'фикстурный запрос', requestType: 'void', responseType: 'string' },
    ],
    requiresQueries: [],
  };

  readonly phase = 'uninitialized';
  private bus = new FxBus();
  private registry = new FxRegistry();

  init(): void {
    // прямой emit литералом (this.bus)
    this.bus.emit('fx:ping', { n: 1 });
    // emit через алиас импорта синглтона
    bus2.emit('fx:ping', { n: 2 });
    // тернарник литералов — анализатор разрешает оба имени
    bus2.emit(Math.random() > 0.5 ? 'fx:ping' : 'fx:ternary');
    // заявленная подписка + СКРЫТАЯ (нет в manifest.subscribes → mismatch)
    this.bus.on('fx:only-sub', () => this.onSub(), { priority: 10, label: 'fx' });
    this.bus.on('fx:hidden', () => undefined);
    // регистрация запроса (init) и снятие (destroy)
    this.registry.registerQuery('fx:q', () => 'ok');
  }

  private onSub(): void {
    /* no-op */
  }

  start(): void {}
  tick(_time: number): void {}
  stop(): void {}
  destroy(): void {
    this.registry.unregisterQuery('fx:q');
  }
  serialize(): Record<string, unknown> {
    return {};
  }
  deserialize(_data: Record<string, unknown>): void {}
}
