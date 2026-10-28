/**
 * Мини-каталог событий фикстуры (структурно повторяет src/core/events.ts:
 * интерфейсы с суффиксом Events, ключи-строковые литералы).
 */
export interface FxEvents {
  'fx:ping': { n: number };
  'fx:future': void;
  'fx:ternary': void;
  'fx:only-sub': { s: string };
  'fx:hidden': void;
}
