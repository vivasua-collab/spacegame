/**
 * F2-фикстура: мини-каталог событий (структурно повторяет src/core/events.ts).
 * Отдельный файл, чтобы не менять набор событий общей фикстуры fx-events.ts.
 */
export interface Fx2Events {
  'f2:own-a': void;
  'f2:own-b': void;
  'f2:shared': void;
}
