/** Структурные типы фикстуры (аналоги module-types.ts) + фейковый реестр. */
import type { FxBus } from './fx-bus';

export interface FxQueryDecl {
  queryName: string;
  description: string;
  requestType: string;
  responseType: string;
}

export interface FxManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  emits: string[];
  subscribes: Array<{ event: string; priority?: number; once?: boolean }>;
  handlesQueries: FxQueryDecl[];
  requiresQueries: FxQueryDecl[];
}

export interface FxGameModule {
  readonly manifest: FxManifest;
  readonly phase: string;
  init(bus?: FxBus, registry?: FxRegistry): void;
  start(): void;
  tick(time: number): void;
  stop(): void;
  destroy(): void;
  serialize(): Record<string, unknown>;
  deserialize(data: Record<string, unknown>): void;
}

export class FxRegistry {
  registerQuery(_name: string, _handler: unknown): void {
    /* no-op */
  }

  unregisterQuery(_name: string): void {
    /* no-op */
  }

  query<T = unknown>(_name: string, _request?: unknown): T | null {
    return null;
  }
}
