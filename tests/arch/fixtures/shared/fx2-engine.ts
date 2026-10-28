/**
 * F2-фикстура: ОБЩИЙ engine-файл двух модулей одной директории (аналог
 * src/ships/fleet-engine.ts). Эмитит событие, НЕ принадлежащее ни одному
 * модулю: emission должно попасть в fileLevelEmits ровно один раз, а НЕ в
 * observed.emits обоих модулей (F2 follow-up Issue #17).
 */
import { gameBus } from '../fx-bus';

export function runSharedEngine(): void {
  gameBus.emit('f2:shared', {});
}
