/**
 * Общий контекст генератора галактики.
 * Содержит глобальное состояние (genId, usedNames), используемое всеми модулями.
 * Сбрасывается при каждой новой генерации через resetGenContext().
 */

import type { EntityId } from '@/core/types';

let nextId = 1;
export const usedNames = new Set<string>();

/** Генерация уникального ID с префиксом */
export function genId(prefix: string): EntityId {
  return `${prefix}_${nextId++}`;
}

/** Сброс контекста генерации для воспроизводимости */
export function resetGenContext(): void {
  nextId = 1;
  usedNames.clear();
}
