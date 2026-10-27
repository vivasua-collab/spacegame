/**
 * Реестр модулей — управление жизненным циклом, зависимостями и запросами.
 *
 * Реестр:
 * - Хранит все зарегистрированные модули
 * - Разрешает зависимости через топологическую сортировку
 * - Управляет порядком инициализации и тиков
 * - Обеспечивает систему запросов (query) для межмодульного доступа к данным
 */

import type { IGameModule, ModuleId, ModuleManifest } from './module-types';
import type { TypedEventBus } from './typed-event-bus';
import type { GameTime } from './types';

type QueryHandler = (request: unknown) => unknown;

export class ModuleRegistry {
  private modules = new Map<ModuleId, IGameModule>();
  private initOrder: ModuleId[] = [];
  private queryHandlers = new Map<string, QueryHandler>();
  private bus: TypedEventBus;

  constructor(bus: TypedEventBus) {
    this.bus = bus;
  }

  // ─── Регистрация ──────────────────────────────────────

  /**
   * Зарегистрировать модуль в реестре.
   * Регистрация возможна в любой момент (горячее подключение).
   *
   * R-42 (F-03): регистрация АТОМАРНА. Прежде Map мутировалась (а при замене
   * ещё и destroy'ился старый модуль) ДО recalculateInitOrder(), который
   * бросает исключение при циклической зависимости. После исключения реестр
   * оставался частично изменённым: новый модуль — в Map, initOrder —
   * устаревший, а при замене старый модуль был уже уничтожен (откат
   * невозможен). Хуже того, цикл оставался в Map и БЛОКИРОВАЛ все последующие
   * register() — восстановление без пересоздания игры было невозможно.
   * Теперь порядок сначала вычисляется на «пробной» установке; при ошибке
   * Map откатывается к прежнему значению (старый модуль не тронут), и только
   * после успеха уничтожается заменённый модуль.
   */
  register(module: IGameModule): void {
    const id = module.manifest.id;
    const previous = this.modules.get(id) ?? null;

    this.modules.set(id, module);
    try {
      this.recalculateInitOrder();
    } catch (e) {
      // Откат: реестр ровно в прежнем состоянии (initOrder не менялся —
      // recalculateInitOrder присваивает его только после успешного обхода).
      if (previous === null) {
        this.modules.delete(id);
      } else {
        this.modules.set(id, previous);
      }
      throw e;
    }

    // Успех: только теперь уничтожаем заменённый модуль.
    if (previous !== null) {
      console.warn(`[Registry] Модуль "${id}" уже зарегистрирован — перезапись`);
      if (previous.phase !== 'destroyed') {
        previous.destroy();
      }
    }
  }

  /** Отменить регистрацию модуля */
  unregister(moduleId: ModuleId): void {
    const mod = this.modules.get(moduleId);
    if (mod) {
      if (mod.phase !== 'destroyed') {
        mod.destroy();
      }
      this.modules.delete(moduleId);
      this.recalculateInitOrder();
    }
  }

  // ─── Жизненный цикл ──────────────────────────────────

  /**
   * Инициализировать все зарегистрированные модули
   * в порядке разрешения зависимостей.
   */
  initAll(): void {
    for (const moduleId of this.initOrder) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'uninitialized') {
        this.validateDependencies(mod.manifest);
        mod.init(this.bus, this);
      }
    }
  }

  /** Запустить все модули */
  startAll(): void {
    for (const moduleId of this.initOrder) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'initialized' || mod.phase === 'stopped') {
        mod.start();
      }
    }
  }

  /** Остановить все модули (в обратном порядке) */
  stopAll(): void {
    for (const moduleId of [...this.initOrder].reverse()) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'started') {
        mod.stop();
      }
    }
  }

  /** Уничтожить все модули (в обратном порядке) */
  destroyAll(): void {
    for (const moduleId of [...this.initOrder].reverse()) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase !== 'destroyed') {
        mod.destroy();
      }
    }
  }

  /**
   * Обработать тик для всех модулей в порядке инициализации.
   * Это обеспечивает детерминизм: Economy всегда тикает перед AI.
   */
  tickAll(time: GameTime): void {
    for (const moduleId of this.initOrder) {
      const mod = this.modules.get(moduleId)!;
      if (mod.phase === 'started') {
        mod.tick(time);
      }
    }

    // После всех тиков — обработать отложенные события
    this.bus.flush();
  }

  // ─── Запросы ──────────────────────────────────────────

  /** Зарегистрировать обработчик запроса */
  registerQuery(queryName: string, handler: QueryHandler): void {
    if (this.queryHandlers.has(queryName)) {
      console.warn(`[Registry] Запрос "${queryName}" уже зарегистрирован — перезапись`);
    }
    this.queryHandlers.set(queryName, handler);
  }

  /** Отменить регистрацию запроса */
  unregisterQuery(queryName: string): void {
    this.queryHandlers.delete(queryName);
  }

  /**
   * Выполнить запрос к другому модулю.
   * Это единственный способ межмодульного доступа к данным.
   */
  query<T = unknown>(queryName: string, request?: unknown): T | null {
    const handler = this.queryHandlers.get(queryName);
    if (!handler) {
      console.warn(`[Registry] Запрос "${queryName}" не зарегистрирован`);
      return null;
    }
    return handler(request) as T;
  }

  // ─── Утилиты ─────────────────────────────────────────

  /** Получить модуль по ID */
  getModule<T extends IGameModule = IGameModule>(moduleId: ModuleId): T | undefined {
    return this.modules.get(moduleId) as T | undefined;
  }

  /** Проверить, зарегистрирован ли модуль */
  hasModule(moduleId: ModuleId): boolean {
    return this.modules.has(moduleId);
  }

  /** Получить порядок инициализации (для отладки) */
  getInitOrder(): readonly ModuleId[] {
    return this.initOrder;
  }

  /** Сериализовать все модули */
  serializeAll(): Record<string, Record<string, unknown>> {
    const data: Record<string, Record<string, unknown>> = {};
    for (const [id, mod] of this.modules) {
      if (mod.phase !== 'destroyed') {
        data[id] = mod.serialize();
      }
    }
    return data;
  }

  /** Получить информацию о всех модулях (для отладки) */
  getModuleInfo(): Array<{ id: ModuleId; name: string; phase: string; version: string }> {
    return Array.from(this.modules.entries()).map(([id, mod]) => ({
      id,
      name: mod.manifest.name,
      phase: mod.phase,
      version: mod.manifest.version,
    }));
  }

  // ─── Внутренние методы ────────────────────────────────

  /**
   * Пересчитать порядок инициализации на основе зависимостей.
   * Используется топологическая сортировка (Kahn's algorithm).
   */
  private recalculateInitOrder(): void {
    const ids = Array.from(this.modules.keys());
    const visited = new Set<ModuleId>();
    const order: ModuleId[] = [];
    const visiting = new Set<ModuleId>();

    const visit = (id: ModuleId) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`[Registry] Циклическая зависимость обнаружена: ${id}`);
      }

      visiting.add(id);
      const mod = this.modules.get(id);
      if (mod) {
        for (const dep of mod.manifest.dependencies) {
          if (this.modules.has(dep)) {
            visit(dep);
          }
        }
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of ids) {
      visit(id);
    }

    this.initOrder = order;
  }

  /**
   * Проверить, что все зависимости модуля удовлетворены.
   */
  private validateDependencies(manifest: ModuleManifest): void {
    for (const dep of manifest.dependencies) {
      if (!this.modules.has(dep)) {
        throw new Error(
          `[Registry] Модуль "${manifest.id}" требует "${dep}", но тот не зарегистрирован`
        );
      }
      const depModule = this.modules.get(dep)!;
      if (depModule.phase === 'uninitialized') {
        throw new Error(
          `[Registry] Модуль "${manifest.id}" требует "${dep}", но тот ещё не инициализирован`
        );
      }
    }
  }
}
