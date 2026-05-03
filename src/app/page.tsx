'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/stores/game-store';
import { GameLayout } from '@/components/game/game-layout';
import { Button } from '@/components/ui/button';
import { Rocket } from 'lucide-react';

export default function Home() {
  const gameState = useGameStore((s) => s.gameState);
  const isInitialized = useGameStore((s) => s.isInitialized);
  const newGame = useGameStore((s) => s.newGame);
  const tick = useGameStore((s) => s.tick);

  const [seed, setSeed] = useState('42');

  // Game tick loop
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing' || gameState.speed === 0) return;

    const interval = setInterval(() => {
      tick();
    }, 200);

    return () => clearInterval(interval);
  }, [gameState?.phase, gameState?.speed, tick]);

  // Not initialized → show new game screen
  if (!isInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#060614] text-white p-4">
        {/* Background stars effect */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 120 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                width: Math.random() < 0.05 ? 2 : 1,
                height: Math.random() < 0.05 ? 2 : 1,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: 0.1 + Math.random() * 0.4,
                animationDelay: `${Math.random() * 3}s`,
              }}
            />
          ))}
        </div>

        <div className="relative z-10 flex flex-col items-center gap-8">
          {/* Title */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Rocket className="size-8 text-cyan-400" />
              <h1 className="text-4xl font-bold tracking-wider bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                SpaceGame
              </h1>
            </div>
            <p className="text-slate-500 text-sm">
              A 4X Space Strategy Game
            </p>
          </div>

          {/* New Game Form */}
          <div className="bg-[#0d0d24] border border-white/10 rounded-xl p-6 w-80 space-y-4">
            <h2 className="text-lg font-semibold text-center">New Game</h2>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">
                Galaxy Seed
              </label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-600/50 focus:ring-1 focus:ring-cyan-600/30"
                placeholder="Enter seed number"
              />
              <p className="text-[10px] text-slate-600">
                Same seed generates the same galaxy
              </p>
            </div>

            <Button
              className="w-full"
              onClick={() => {
                const seedNum = parseInt(seed, 10);
                if (isNaN(seedNum) || seedNum <= 0) return;
                newGame({ seed: seedNum });
              }}
            >
              <Rocket className="size-4 mr-2" />
              Launch Game
            </Button>
          </div>
        </div>

        {/* Sticky footer */}
        <footer className="mt-auto pt-4 text-[10px] text-slate-700">
          SpaceGame v0.1
        </footer>
      </div>
    );
  }

  // Game is initialized → show game layout
  return <GameLayout />;
}
