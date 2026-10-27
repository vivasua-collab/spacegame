// R-39 детерминизм: генерация галактики seed 2026 в ОТДЕЛЬНОМ процессе,
// сериализация + повторная сериализация после deserialize — sha256.
import '@/core/immer-setup';
import { createHash } from 'crypto';
import { generateGalaxy } from '@/galaxy';
import { serializeGameState, deserializeGameState } from '@/stores/game-store';
import { createDefaultResearchState } from '@/research/engine';
import type { GameState } from '@/core/types';

const seed = 2026;
const galaxy = generateGalaxy({ seed, systemCount: 200 });
const state: GameState = {
  time: { tick: 1234, dayInYear: 123, year: 4 },
  speed: 5,
  phase: 'playing',
  galaxy,
  productionQueues: new Map(),
  fleets: [],
  playerFactionId: 'player',
  shipDesigns: new Map(),
  shipyardQueues: new Map(),
  ships: new Map(),
  researchState: createDefaultResearchState(),
};
const json1 = serializeGameState(state);
const restored = deserializeGameState(json1);
const json2 = serializeGameState(restored);
const h = (s: string) => createHash('sha256').update(s).digest('hex');
console.log(`sha256(gen)=${h(json1).slice(0, 16)}…${h(json1).slice(-4)}`);
console.log(`sha256(rt)=${h(json2).slice(0, 16)}…${h(json2).slice(-4)}`);
console.log(`bytes: gen=${json1.length} rt=${json2.length}`);
