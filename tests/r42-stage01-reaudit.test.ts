/// <reference types="bun-types" />
/**
 * R-42 (GitHub Issue #6) — повторный аудит этапов 0–1: архитектура, шина, lifecycle и время.
 *
 * База: main после R-40 (7258043). Источник находок — статический просмотр владельца:
 * - F-01 TypedEventBus: подписка { once: true } при включённом replay не снимается
 *   после немедленной replay-доставки → обработчик срабатывает на replay И ещё раз
 *   на следующем emit (нарушение контракта once).
 * - F-02 GameLoop: setSpeed(0) при playing меняет фазу на 'paused' и останавливает
 *   интервал, но НЕ эмитит core:paused — поведение неотличимое от pause() для
 *   подписчиков невозможно получить (GameSpeed = 0|1|5|15|50, ноль разрешён типом).
 * - F-03 ModuleRegistry: register() мутирует Map (при замене — destroy старого
 *   модуля) ДО recalculateInitOrder(), который бросает при циклической зависимости;
 *   после исключения реестр остаётся частично изменённым, последующие регистрации
 *   блокируются тем же циклом.
 *
 * Плюс фиксация контрактов этапа 1: приоритеты шины, отписка во время emit,
 * вложенный emit, defer/flush (включая повторный defer), replay-изоляция ошибок,
 * core:started/core:resumed, stop() teardown-семантика, граница года 364/365,
 * setTime без двойного применения времени, переякоривание catch-up, горячая
 * регистрация модулей, lifecycle query-обработчиков, медиатор без двойных событий.
 *
 * Run: bun test tests/r42-stage01-reaudit.test.ts
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { TypedEventBus } from '@/core/typed-event-bus';
import { ModuleRegistry } from '@/core/module-registry';
import { GameLoop } from '@/core/game-loop';
import type { IGameModule, ModuleId, ModulePhase } from '@/core/module-types';
import type { GameTime, GameSpeed } from '@/core/types';
import { getGameMediator, resetGameMediator } from '@/core';
import { GalaxyModule } from '@/galaxy/galaxy-module';
import { EconomyModule } from '@/economy/economy-module';

/** Подождать ms миллисекунд. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Игровое время для emit/defer в тестах шины. */
const T1: GameTime = { tick: 1, dayInYear: 1, year: 1 };

// ═══════════════════════════════════════════════════════════════════════
// Хелпер: минимальный фейковый модуль с отслеживанием lifecycle
// ═══════════════════════════════════════════════════════════════════════

interface FakeModule {
  mod: IGameModule;
  destroyCalls: () => number;
  ticks: () => number;
}

function makeModule(id: ModuleId, deps: ModuleId[] = []): FakeModule {
  let phase: ModulePhase = 'uninitialized';
  let destroyCount = 0;
  let tickCount = 0;
  const mod: IGameModule = {
    manifest: {
      id,
      name: `fake-${id}`,
      version: '1.0.0',
      description: 'R-42 fake module',
      dependencies: deps,
      emits: [],
      subscribes: [],
      handlesQueries: [],
      requiresQueries: [],
    },
    get phase() {
      return phase;
    },
    init() {
      phase = 'initialized';
    },
    start() {
      phase = 'started';
    },
    tick() {
      tickCount++;
    },
    stop() {
      phase = 'stopped';
    },
    destroy() {
      if (phase !== 'destroyed') {
        phase = 'destroyed';
        destroyCount++;
      }
    },
    serialize() {
      return {};
    },
    deserialize() {},
  };
  return { mod, destroyCalls: () => destroyCount, ticks: () => tickCount };
}

// ═══════════════════════════════════════════════════════════════════════
// F-01 — TypedEventBus: once + replay
// ═══════════════════════════════════════════════════════════════════════

describe('R-42 F-01: TypedEventBus — once + replay', () => {
  let bus: TypedEventBus;

  beforeEach(() => {
    bus = new TypedEventBus();
  });

  test('once + replay: обработчик вызывается РОВНО ОДИН раз (replay считается доставкой)', () => {
    bus.enableReplay('core:game-created');
    bus.emit('core:game-created', { galaxyId: 'g1', seed: 42 });

    let calls = 0;
    bus.once('core:game-created', () => {
      calls++;
    });
    // replay-доставка при подписке — это первый (и единственный) вызов
    expect(calls).toBe(1);

    // следующий emit НЕ должен вызвать обработчик повторно
    bus.emit('core:game-created', { galaxyId: 'g2', seed: 43 });
    expect(calls).toBe(1);
    expect(bus.listenerCount('core:game-created')).toBe(0);
  });

  test('once через опцию { once: true } — тот же контракт', () => {
    bus.enableReplay('core:game-created');
    bus.emit('core:game-created', { galaxyId: 'g1', seed: 1 });

    let calls = 0;
    bus.on('core:game-created', () => { calls++; }, { once: true });
    expect(calls).toBe(1);

    bus.emit('core:game-created', { galaxyId: 'g2', seed: 2 });
    expect(calls).toBe(1);
    expect(bus.listenerCount('core:game-created')).toBe(0);
  });

  test('once БЕЗ replay — контракт не изменился: один вызов на первом emit', () => {
    let calls = 0;
    bus.once('core:game-created', () => { calls++; });
    expect(calls).toBe(0);
    bus.emit('core:game-created', { galaxyId: 'g1', seed: 1 });
    expect(calls).toBe(1);
    bus.emit('core:game-created', { galaxyId: 'g2', seed: 2 });
    expect(calls).toBe(1);
    expect(bus.listenerCount('core:game-created')).toBe(0);
  });

  test('replay: ошибка обработчика изолирована — on() не бросает, шина жива', () => {
    bus.enableReplay('core:tick');
    bus.emit('core:tick', T1);

    // non-once обработчик, бросающий на replay-доставке: on() не выбрасывает,
    // подписка остаётся (ошибка будет изолироваться и на последующих emit)
    expect(() =>
      bus.on('core:tick', () => {
        throw new Error('boom');
      }),
    ).not.toThrow();
    expect(bus.listenerCount('core:tick')).toBe(1);

    let ok = 0;
    bus.on('core:tick', () => { ok++; }); // replay-доставка → ok=1 уже при подписке
    bus.emit('core:tick', T1); // ошибка первого изолирована, второй вызван → ok=2
    expect(ok).toBe(2);
    expect(bus.listenerCount('core:tick')).toBe(2); // шина жива, подписки на месте
  });

  test('replay: доставка только для включённых событий; clear() сбрасывает lastEvents', () => {
    bus.enableReplay('core:game-created');
    bus.emit('core:game-created', { galaxyId: 'g1', seed: 1 });
    bus.emit('core:tick', T1); // replay для core:tick НЕ включён

    let got: unknown = 'none';
    bus.on('core:tick', (p) => { got = p; });
    expect(got).toBe('none');

    let gotCreated: unknown = 'none';
    bus.on('core:game-created', (p) => { gotCreated = p; });
    expect(gotCreated).toEqual({ galaxyId: 'g1', seed: 1 });

    bus.clear();
    let afterClear: unknown = 'none';
    bus.on('core:game-created', (p) => { afterClear = p; });
    expect(afterClear).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Контракты шины: приоритеты, отписка в emit, вложенный emit, defer/flush
// ═══════════════════════════════════════════════════════════════════════

describe('R-42: TypedEventBus — приоритеты, emit-семантика, defer/flush', () => {
  let bus: TypedEventBus;

  beforeEach(() => {
    bus = new TypedEventBus();
  });

  test('приоритеты: 10 → 20 → 30; равный приоритет — порядок подписки (стабильная сортировка)', () => {
    const order: string[] = [];
    bus.on('core:tick', () => { order.push('p30'); }, { priority: 30 });
    bus.on('core:tick', () => { order.push('p10'); }, { priority: 10 });
    bus.on('core:tick', () => { order.push('p20b'); }, { priority: 20 }); // подписан раньше
    bus.on('core:tick', () => { order.push('p20a'); }, { priority: 20 });
    bus.emit('core:tick', T1);
    // Равный приоритет → порядок ПОДПИСКИ (p20b раньше p20a), стабильно
    expect(order).toEqual(['p10', 'p20b', 'p20a', 'p30']);
  });

  test('отписка во время emit: снапшот — в текущем emit выполняются все, со следующего отписанный исчезает', () => {
    const calls: string[] = [];
    const offA = bus.on('core:tick', () => {
      calls.push('A');
      offA();
    });
    bus.on('core:tick', () => { calls.push('B'); });

    bus.emit('core:tick', T1);
    expect(calls).toEqual(['A', 'B']);

    bus.emit('core:tick', T1);
    expect(calls).toEqual(['A', 'B', 'B']);
    expect(bus.listenerCount('core:tick')).toBe(1);
    offA(); // повторная отписка безопасна
  });

  test('once-подписчик, добавленный ВО ВРЕМЯ emit, не вызывается в текущем emit', () => {
    let aCalls = 0;
    let onceBCalls = 0;
    bus.on('core:tick', () => {
      aCalls++;
      if (aCalls === 1) {
        bus.once('core:tick', () => { onceBCalls++; });
      }
    });
    bus.emit('core:tick', T1); // снапшот: onceB добавлен после среза → не вызван
    expect(aCalls).toBe(1);
    expect(onceBCalls).toBe(0);
    bus.emit('core:tick', T1); // onceB вызван один раз и снялся
    expect(aCalls).toBe(2);
    expect(onceBCalls).toBe(1);
    bus.emit('core:tick', T1); // onceB больше не вызывается
    expect(aCalls).toBe(3);
    expect(onceBCalls).toBe(1);
  });

  test('вложенный emit: обработчик эмитит другое событие — вложенное выполняется синхронно', () => {
    const log: string[] = [];
    bus.on('core:tick', () => {
      log.push('tick-start');
      bus.emit('core:year', T1);
      log.push('tick-end');
    });
    bus.on('core:year', () => { log.push('year'); });
    bus.emit('core:tick', T1);
    expect(log).toEqual(['tick-start', 'year', 'tick-end']);
  });

  test('defer/flush: события обрабатываются пакетно в момент flush', () => {
    const log: string[] = [];
    bus.on('core:paused', () => { log.push('paused'); });
    bus.on('core:started', () => { log.push('started'); });
    bus.defer('core:paused', undefined);
    bus.defer('core:started', undefined);
    expect(log).toEqual([]);
    expect(bus.pendingCount).toBe(2);
    bus.flush();
    expect(log).toEqual(['paused', 'started']);
    expect(bus.pendingCount).toBe(0);
  });

  test('повторный defer внутри flush — обработка продолжается в следующем пакете того же flush', () => {
    let calls = 0;
    bus.on('core:paused', () => {
      calls++;
      if (calls === 1) {
        bus.defer('core:paused', undefined); // повторный defer — обработается
      }
    });
    bus.defer('core:paused', undefined);
    bus.flush();
    expect(calls).toBe(2);
    expect(bus.pendingCount).toBe(0);
  });

  // R-42: до исправления этот тест ЗАВИСАЛ (синхронный while в flush() не имел
  // лимита пакетов) — сам факт зависания при первичном прогоне подтверждает
  // отсутствие защиты от бесконечного повторного defer.
  test('бесконечный повторный defer терминируется защитным лимитом (flush не зависает)', () => {
    let calls = 0;
    bus.on('core:paused', () => {
      calls++;
      bus.defer('core:paused', undefined); // всегда defer → бесконечная цепочка
    });
    bus.defer('core:paused', undefined);
    // Без защитного лимита flush() не вернулся бы никогда.
    expect(() => bus.flush()).not.toThrow();
    expect(calls).toBeLessThanOrEqual(1000);
    expect(bus.pendingCount).toBe(0);
  });

  test('ошибка обработчика изолирована: остальные обработчики и шина продолжают работу', () => {
    const calls: string[] = [];
    bus.on('core:tick', () => { throw new Error('boom'); }, { priority: 10 });
    bus.on('core:tick', () => { calls.push('B'); }, { priority: 20 });
    expect(() => bus.emit('core:tick', T1)).not.toThrow();
    expect(calls).toEqual(['B']);
  });

  test('flush() реентерабельно защищён: вызов flush из обработчика не ломает очередь', () => {
    const log: string[] = [];
    bus.on('core:paused', () => {
      log.push('paused');
      bus.flush(); // вложенный flush — no-op (processing=true)
    });
    bus.on('core:started', () => { log.push('started'); });
    bus.defer('core:paused', undefined);
    bus.defer('core:started', undefined);
    bus.flush();
    expect(log).toEqual(['paused', 'started']);
    expect(bus.pendingCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-02 — GameLoop: setSpeed(0) при playing + контракты времени
// ═══════════════════════════════════════════════════════════════════════

describe('R-42 F-02: GameLoop — единый контракт паузы', () => {
  let bus: TypedEventBus;
  let registry: ModuleRegistry;
  let loop: GameLoop;
  let tickCount: number;
  let unsubscriber: () => void;

  beforeEach(() => {
    bus = new TypedEventBus();
    registry = new ModuleRegistry(bus);
    loop = new GameLoop(bus, registry);
    tickCount = 0;
    unsubscriber = bus.on('core:tick', () => { tickCount++; });
  });

  afterEach(() => {
    unsubscriber();
    loop.destroy();
  });

  test('setSpeed(0) при playing — неотличим от pause(): core:paused + фаза paused + интервал остановлен', async () => {
    loop.setSpeed(50);
    loop.start();
    await wait(80);
    expect(tickCount).toBeGreaterThan(0);

    const events: string[] = [];
    const offPaused = bus.on('core:paused', () => { events.push('core:paused'); });
    const offSpeed = bus.on('core:speed-changed', () => { events.push('core:speed-changed'); });

    loop.setSpeed(0);

    expect(loop.getPhase()).toBe('paused');
    expect(loop.getSpeed()).toBe(0);
    // ДЕФЕКТ F-02: прежде events оставался пустым — core:paused не эмитился
    expect(events).toEqual(['core:paused', 'core:speed-changed']);

    const c = tickCount;
    await wait(100);
    expect(tickCount).toBe(c); // интервал действительно остановлен

    offPaused();
    offSpeed();
  });

  test('pause() при playing — ровно один core:paused; повторный pause() — без события', () => {
    loop.setSpeed(5);
    loop.start();
    let pausedEvents = 0;
    const off = bus.on('core:paused', () => { pausedEvents++; });
    loop.pause();
    expect(pausedEvents).toBe(1);
    loop.pause();
    expect(pausedEvents).toBe(1); // guard
    off();
  });

  test('setSpeed(0) при уже paused — без повторного core:paused, но с core:speed-changed', () => {
    const pausedEvents: number[] = [];
    const speedChanges: GameSpeed[] = [];
    const offP = bus.on('core:paused', () => { pausedEvents.push(1); });
    const offS = bus.on('core:speed-changed', (s) => { speedChanges.push(s); });

    loop.setSpeed(0); // фаза уже paused (начальная) → guard pause()
    expect(loop.getPhase()).toBe('paused');
    expect(pausedEvents.length).toBe(0);
    expect(speedChanges).toEqual([0]);
    offP();
    offS();
  });

  test('возобновление после паузы по нулевой скорости: setSpeed(50) снова тикает', async () => {
    loop.setSpeed(50);
    loop.start();
    await wait(80);
    expect(tickCount).toBeGreaterThan(0);

    loop.setSpeed(0);
    const c = tickCount;
    await wait(60);
    expect(tickCount).toBe(c);

    loop.setSpeed(50); // фаза paused → интервал не перезапустится сам (setSpeed меняет только скорость)
    // Явный контракт: выход из паузы — start() (или mediator.setSpeed, который вызывает start)
    loop.start();
    await wait(120);
    expect(tickCount).toBeGreaterThan(c);
  });

  test('start() после pause() эмитит core:resumed; первый start() — core:started', () => {
    const started: number[] = [];
    const resumed: number[] = [];
    const offS = bus.on('core:started', () => { started.push(1); });
    const offR = bus.on('core:resumed', () => { resumed.push(1); });

    loop.setSpeed(50);
    loop.start(); // первый запуск
    expect(started.length).toBe(1);
    expect(resumed.length).toBe(0);

    loop.pause();
    loop.start(); // возобновление
    expect(started.length).toBe(1);
    expect(resumed.length).toBe(1);

    loop.pause();
    loop.start();
    expect(resumed.length).toBe(2);

    offS();
    offR();
  });

  test('stop() — teardown: фаза → paused, интервал остановлен, БЕЗ core:paused; start() после stop() возобновляет', async () => {
    loop.setSpeed(50);
    loop.start();
    await wait(80);
    expect(tickCount).toBeGreaterThan(0);

    let pausedEvents = 0;
    const off = bus.on('core:paused', () => { pausedEvents++; });

    loop.stop();
    expect(loop.getPhase()).toBe('paused');
    const c = tickCount;
    await wait(80);
    expect(tickCount).toBe(c);
    expect(pausedEvents).toBe(0); // teardown-путь без события (сознательный контракт)

    loop.start(); // сценарий remount: mediator.start() → loop.start()
    await wait(120);
    expect(tickCount).toBeGreaterThan(c);
    off();
  });

  test('start() при speed=0 — фаза playing, тиков нет; setSpeed(5) запускает поток тиков', async () => {
    loop.setSpeed(0);
    loop.start();
    expect(loop.getPhase()).toBe('playing');
    await wait(80);
    expect(tickCount).toBe(0);

    loop.setSpeed(50); // playing → интервал стартует немедленно (20 мс)
    await wait(120);
    expect(tickCount).toBeGreaterThan(0);
  });

  test('граница года: tick 364 → 365 эмитит core:year ровно один раз, year=2, dayInYear=0', () => {
    loop.setTime({ tick: 363, dayInYear: 363, year: 1 });
    const years: GameTime[] = [];
    const off = bus.on('core:year', (t) => { years.push({ ...t }); });

    loop.step(); // tick 364 — ещё год 1
    expect(years.length).toBe(0);

    loop.step(); // tick 365 — dayInYear = 0 → core:year
    expect(years.length).toBe(1);
    const y0 = years[0]!;
    expect(y0.tick).toBe(365);
    expect(y0.year).toBe(2);
    expect(y0.dayInYear).toBe(0);

    loop.step(); // tick 366 — без события
    expect(years.length).toBe(1);
    off();
  });

  test('setTime + ручной step: ровно один тик, время не применяется дважды', () => {
    loop.setTime({ tick: 999, dayInYear: 999 % 365, year: 3 });
    loop.step();
    const t = loop.getTime();
    expect(t.tick).toBe(1000);
    expect(t.dayInYear).toBe(1000 % 365);
    expect(t.year).toBe(Math.floor(1000 / 365) + 1);
  });

  test('catch-up: катастрофическое отставание — переякоривание без лавины тиков, цикл жив', async () => {
    const originalNow = performance.now.bind(performance);
    let fakeTime = originalNow();
    const perf = performance as unknown as { now: () => number };
    perf.now = () => fakeTime;
    try {
      loop.setSpeed(50);
      loop.start(); // anchor = fakeTime (реальное время в этот момент)

      // «Сон машины»: скачок фейковых часов на 60 с при живом интервале.
      // Без переякоривания следующий запуск попытался бы навёрстывать
      // ticksDue(60_000, 50) = 3000 тиков; с переякориванием — 0.
      fakeTime += 60_000;
      await wait(80);
      const afterJump = tickCount;
      expect(afterJump).toBeLessThanOrEqual(50); // НЕ 3000

      // Часы снова идут: +200 мс за шаг → по контракту ×50 это 10 тиков за шаг.
      for (let i = 0; i < 5; i++) {
        fakeTime += 200;
        await wait(30);
      }
      expect(tickCount).toBeGreaterThan(afterJump); // цикл жив
      expect(tickCount).toBeLessThanOrEqual(afterJump + 60); // без лавины (потолок пакета 50)
    } finally {
      perf.now = originalNow;
      loop.stop();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// F-03 — ModuleRegistry: атомарность регистрации
// ═══════════════════════════════════════════════════════════════════════

describe('R-42 F-03: ModuleRegistry — атомарность register()', () => {
  let bus: TypedEventBus;
  let registry: ModuleRegistry;

  beforeEach(() => {
    bus = new TypedEventBus();
    registry = new ModuleRegistry(bus);
  });

  test('регистрация при цикле бросает, но реестр остаётся В ПРЕЖНЕМ состоянии и работоспособен', () => {
    const A = makeModule('core', ['galaxy']); // hot: galaxy ещё нет — регистрация OK
    registry.register(A.mod);
    expect(registry.getInitOrder()).toEqual(['core']);

    // galaxy зависит от core, core (уже в реестре) зависит от galaxy → цикл
    const B = makeModule('galaxy', ['core']);
    expect(() => registry.register(B.mod)).toThrow(/Циклическая/);

    // ДЕФЕКТ F-03: прежде B оставался в Map → реестр «кирпичился»
    expect(registry.hasModule('galaxy')).toBe(false);
    expect(registry.hasModule('core')).toBe(true);
    expect(registry.getInitOrder()).toEqual(['core']);

    // Реестр работоспособен: следующая регистрация без цикла проходит
    const C = makeModule('economy', ['core']);
    expect(() => registry.register(C.mod)).not.toThrow();
    expect(registry.getInitOrder()).toEqual(['core', 'economy']);

    // A всё ещё «горяче» ждёт 'galaxy' — завершаем зависимость БЕЗ цикла
    // (galaxy без зависимости от core), после чего initAll проходит
    const G = makeModule('galaxy', []);
    registry.register(G.mod);
    registry.initAll();
    expect(A.mod.phase).toBe('initialized');
    expect(C.mod.phase).toBe('initialized');
    expect(G.mod.phase).toBe('initialized');
  });

  test('замена модуля при цикле — старый модуль НЕ уничтожен, реестр откатился', () => {
    const A1 = makeModule('core', []);
    const B = makeModule('galaxy', ['core']);
    registry.register(A1.mod);
    registry.register(B.mod);
    expect(A1.mod.phase).toBe('uninitialized');

    // Замена core на зависящий от galaxy → цикл core→galaxy→core
    const A2 = makeModule('core', ['galaxy']);
    expect(() => registry.register(A2.mod)).toThrow(/Циклическая/);

    // ДЕФЕКТ F-03: прежде A1 уничтожался ДО пересчёта порядка — откат невозможен
    expect(registry.getModule('core')).toBe(A1.mod);
    expect(A1.mod.phase).toBe('uninitialized');
    expect(A1.destroyCalls()).toBe(0);
    expect(registry.getModule('galaxy')).toBe(B.mod);

    // Реестр полностью работоспособен
    registry.initAll();
    expect(A1.mod.phase).toBe('initialized');
    expect(B.mod.phase).toBe('initialized');
  });

  test('замена модуля БЕЗ цикла — прежний контракт: новый в реестре, старый уничтожен', () => {
    const A1 = makeModule('core', []);
    registry.register(A1.mod);
    registry.initAll();
    expect(A1.mod.phase).toBe('initialized');

    const A2 = makeModule('core', []);
    expect(() => registry.register(A2.mod)).not.toThrow();
    expect(registry.getModule('core')).toBe(A2.mod);
    expect(A1.mod.phase).toBe('destroyed');
    expect(A1.destroyCalls()).toBe(1);

    registry.initAll(); // A2 инициализируется, A1 не трогается
    expect(A2.mod.phase).toBe('initialized');
  });

  test('отсутствующая зависимость: горячая регистрация OK, initAll бросает, после регистрации зависимости — init проходит', () => {
    const C = makeModule('ships', ['fleet']);
    registry.register(C.mod); // fleet ещё нет — hot registration разрешена
    expect(registry.hasModule('ships')).toBe(true);

    expect(() => registry.initAll()).toThrow(/требует "fleet"/);
    expect(C.mod.phase).toBe('uninitialized');

    const F = makeModule('fleet', []);
    registry.register(F.mod);
    registry.initAll();
    expect(F.mod.phase).toBe('initialized');
    expect(C.mod.phase).toBe('initialized');
    expect(registry.getInitOrder()).toEqual(['fleet', 'ships']);
  });

  test('горячая регистрация: подключённый после startAll модуль инициализируется, стартует и тикает', () => {
    const A = makeModule('core', []);
    registry.register(A.mod);
    registry.initAll();
    registry.startAll();
    expect(A.mod.phase).toBe('started');

    registry.tickAll(T1);
    expect(A.ticks()).toBe(1);

    const B = makeModule('galaxy', ['core']);
    registry.register(B.mod);
    registry.initAll(); // инициализирует только новый модуль
    registry.startAll();
    expect(B.mod.phase).toBe('started');
    expect(A.mod.phase).toBe('started'); // существующие не перезапускаются

    registry.tickAll({ tick: 2, dayInYear: 2, year: 1 });
    expect(A.ticks()).toBe(2);
    expect(B.ticks()).toBe(1);
    expect(registry.getInitOrder()).toEqual(['core', 'galaxy']);
  });

  test('unregister: модуль уничтожен, порядок пересчитан; повторная регистрация после unregister работает', () => {
    const A = makeModule('core', []);
    const B = makeModule('galaxy', ['core']);
    registry.register(A.mod);
    registry.register(B.mod);
    registry.initAll();
    registry.startAll();

    registry.unregister('galaxy');
    expect(B.mod.phase).toBe('destroyed');
    expect(registry.hasModule('galaxy')).toBe(false);
    expect(registry.getInitOrder()).toEqual(['core']);

    const B2 = makeModule('galaxy', ['core']);
    expect(() => registry.register(B2.mod)).not.toThrow();
    expect(registry.getInitOrder()).toEqual(['core', 'galaxy']);
  });

  test('query-обработчики: регистрация, перезапись, отмена, неизвестный запрос → null', () => {
    registry.registerQuery('galaxy:system-by-id', () => ({ id: 's1' }));
    expect(registry.query<{ id: string }>('galaxy:system-by-id')).toEqual({ id: 's1' });

    registry.registerQuery('galaxy:system-by-id', () => 'v2');
    expect(registry.query<string>('galaxy:system-by-id')).toBe('v2');

    registry.unregisterQuery('galaxy:system-by-id');
    expect(registry.query('galaxy:system-by-id')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Медиатор: единый контракт паузы без двойных событий
// ═══════════════════════════════════════════════════════════════════════

describe('R-42: медиатор — пауза через setSpeed(0) без двойных событий', () => {
  beforeEach(() => {
    resetGameMediator();
  });

  afterEach(() => {
    resetGameMediator();
  });

  test('mediator.setSpeed(0) при playing → ровно один core:paused, фаза paused в состоянии', () => {
    const mediator = getGameMediator();
    const economyModule = new EconomyModule();
    const galaxyModule = new GalaxyModule();
    economyModule.setGameStateAccessor(() => mediator.getGameState());
    economyModule.setGameStateMutator((s) => mediator.commitState(s));
    galaxyModule.setGameStateAccessor(() => mediator.getGameState());
    galaxyModule.setGameStateMutator((s) => mediator.commitState(s));
    mediator.registerAndInit([galaxyModule, economyModule]);
    mediator.newGame({ seed: 42, systemCount: 5 });

    mediator.setSpeed(5);
    expect(mediator.getGameState()!.phase).toBe('playing');

    let pausedEvents = 0;
    const off = mediator.getBus().on('core:paused', () => { pausedEvents++; });

    mediator.setSpeed(0);

    expect(pausedEvents).toBe(1); // loop.pause() внутри — без дублей
    expect(mediator.getGameState()!.phase).toBe('paused');
    expect(mediator.getGameState()!.speed).toBe(0);
    expect(mediator.loop.getPhase()).toBe('paused');

    // Возобновление через mediator.setSpeed(5) — модули живы, тик обрабатывается
    mediator.setSpeed(5);
    const tickBefore = mediator.getGameState()!.time.tick;
    mediator.tick();
    expect(mediator.getGameState()!.time.tick).toBe(tickBefore + 1);
    off();
  });
});
