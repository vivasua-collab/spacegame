/**
 * Фикстура шины для тестов генератора карты (tests/arch/module-bus-map.test.ts).
 * Локальный фейк — никаких импортов из src/, чтобы фикстуры были tsc-чистыми
 * и не зависели от реального EventName.
 */

export class FxBus {
  on(
    _event: string,
    _handler: (payload: unknown) => void,
    _options?: { priority?: number; label?: string; once?: boolean },
  ): () => void {
    return () => undefined;
  }

  once(_event: string, _handler: (payload: unknown) => void): () => void {
    return () => undefined;
  }

  emit(_event: string, _payload?: unknown): void {
    /* no-op */
  }
}

/** Синглтон с каноническим именем gameBus — алиасы импорта разрешаются анализатором. */
export const gameBus = new FxBus();
