// R-41 (этап 3а) детерминизм: полный headless-конвейер (медиатор + модули,
// включая AI) в ОТДЕЛЬНОМ процессе; фиксированный seed + последовательность
// тиков + контроллеры → канонический AI-снимок (world model + perceptions)
// и финальный GameState → sha256. Запуск: 3 независимых процесса, хеши
// обязаны совпасть (см. план R-41, фаза 5).
//
// Запуск: DATABASE_URL=file:./db/custom.db bun run scripts/r41-ai-det-check.ts
import '@/core/immer-setup';
import { createHash } from 'crypto';
import { produce } from 'immer';
import { getGameMediator, resetGameMediator } from '@/core/game-mediator';
import { serializeGameState } from '@/stores/game-store';
import { useGameStore } from '@/stores/game-store';
import { AIModule } from '@/ai/ai-module';
import type { GameState, Planet } from '@/core/types';

const SEED = 424242;
const SYSTEM_COUNT = 20;
const TICKS = 25;

function firstColonizable(state: GameState): Planet {
  for (const sys of state.galaxy.systems) {
    for (const p of sys.planets) {
      if (p.type !== 'gas_giant' && !p.owner && p.hexes.length > 0) return p;
    }
  }
  throw new Error('нет колонизируемых планет');
}

resetGameMediator();
const mediator = getGameMediator();

// Прод-проводка стора регистрирует все модули (включая AI последней).
const store = useGameStore.getState();
store.newGame({ seed: SEED, systemCount: SYSTEM_COUNT });
const st0 = useGameStore.getState().gameState!;
const planet = firstColonizable(st0);
if (!useGameStore.getState().colonizePlanet(planet.id)) {
  throw new Error('колонизация не удалась');
}

// Ручной тик-режим: phase=playing, speed=0 (без интервала — детерминизм).
mediator.setSpeed(0);
const cur = mediator.getGameState()!;
const manual = produce(cur, (draft) => {
  draft.phase = 'playing';
  draft.speed = 0;
});
mediator.setGameState(manual);

const ai = mediator.registry.getModule<AIModule>('ai');
if (!ai) throw new Error('AI-модуль не зарегистрирован');
ai.attachController('ai_confederation', 'normal');
ai.attachController('ai_hegemony', 'hard');
ai.attachController('ai_swarm', 'insane');

for (let i = 0; i < TICKS; i++) mediator.tick();

const snapshot = JSON.stringify({
  worldModel: ai.getWorldModel(),
  controllers: ai.getControllerSummaries(),
});
const stateJSON = serializeGameState(mediator.getGameState()!);

const h = (s: string) => createHash('sha256').update(s).digest('hex');
console.log(`sha256(ai-snapshot)=${h(snapshot)}`);
console.log(`sha256(gamestate)=${h(stateJSON).slice(0, 16)}…${h(stateJSON).slice(-4)}`);
console.log(`tick=${mediator.getGameState()!.time.tick} controllers=${ai.getControllerCount()}`);
resetGameMediator();
