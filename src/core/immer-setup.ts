/**
 * Block 01 P2: immer configuration for SpaceGame.
 *
 * - enableMapSet(): GameState contains Map fields (systemMap, productionQueues).
 *   immer needs the MapSet plugin to draft them — without it, produce() throws
 *   "The plugin for 'MapSet' has not been loaded into Immer."
 * - setAutoFreeze(false): allow direct mutations outside produce() (existing
 *   tests + engine functions called from non-draft contexts). Immutability of
 *   references is still guaranteed by produce() / immer middleware for all
 *   store-driven mutations.
 *
 * Importing this module is a side-effect: it configures the global immer
 * state. Import it once at the top of any module that uses immer with
 * GameState-shaped data (game-store, economy-module, tests).
 *
 * Repeated imports are safe — immer's setAutoFreeze and enableMapSet are
 * idempotent.
 */

import { setAutoFreeze, enableMapSet } from 'immer';

enableMapSet();
setAutoFreeze(false);
