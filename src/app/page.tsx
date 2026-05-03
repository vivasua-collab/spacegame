'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useGameStore, type SaveInfo } from '@/stores/game-store';
import { GameLayout } from '@/components/game/game-layout';
import { Button } from '@/components/ui/button';
import { Rocket, Save, Trash2, Loader2, FolderOpen } from 'lucide-react';

/**
 * Deterministic pseudo-random number generator (simple LCG).
 */
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export default function Home() {
  const gameState = useGameStore((s) => s.gameState);
  const isInitialized = useGameStore((s) => s.isInitialized);
  const newGame = useGameStore((s) => s.newGame);
  const tick = useGameStore((s) => s.tick);
  const loadGame = useGameStore((s) => s.loadGame);
  const loadSaveList = useGameStore((s) => s.loadSaveList);
  const deleteSave = useGameStore((s) => s.deleteSave);

  const [seed, setSeed] = useState('42');
  const [saves, setSaves] = useState<SaveInfo[]>([]);
  const [loadingSaveId, setLoadingSaveId] = useState<string | null>(null);
  const [deletingSaveId, setDeletingSaveId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'new' | 'load'>('new');

  // Deterministic star positions
  const stars = useMemo(() => {
    const rng = seededRng(42);
    return Array.from({ length: 120 }, (_, i) => ({
      w: rng() < 0.05 ? 2 : 1,
      h: rng() < 0.05 ? 2 : 1,
      left: `${rng() * 100}%`,
      top: `${rng() * 100}%`,
      opacity: 0.1 + rng() * 0.4,
      delay: `${rng() * 3}s`,
      key: i,
    }));
  }, []);

  // Game tick loop
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing' || gameState.speed === 0) return;
    const interval = setInterval(() => { tick(); }, 200);
    return () => clearInterval(interval);
  }, [gameState?.phase, gameState?.speed, tick]);

  // Load saves — async callback, setState only in .then() (not sync in effect)
  useEffect(() => {
    let active = true;
    loadSaveList().then((list) => {
      if (active) setSaves(list);
    });
    return () => { active = false; };
  }, [loadSaveList]);

  // Handle load
  const handleLoad = useCallback(async (id: string) => {
    setLoadingSaveId(id);
    await loadGame(id);
    setLoadingSaveId(null);
  }, [loadGame]);

  // Handle delete
  const handleDelete = useCallback(async (id: string) => {
    setDeletingSaveId(id);
    await deleteSave(id);
    setDeletingSaveId(null);
    // Refresh the save list
    const list = await loadSaveList();
    setSaves(list);
  }, [deleteSave, loadSaveList]);

  // Format tick to year/day
  const formatTick = (tick: number) => {
    const day = Math.floor(tick / 86400);
    const year = Math.floor(day / 365);
    return `Y${year} D${day % 365}`;
  };

  // Format date
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Game is initialized → show game layout
  if (isInitialized) {
    return <GameLayout />;
  }

  // Not initialized → show main menu
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#060614] text-white p-4">
      {/* Background stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {stars.map((s) => (
          <div
            key={s.key}
            className="absolute rounded-full bg-white animate-pulse"
            style={{
              width: s.w,
              height: s.h,
              left: s.left,
              top: s.top,
              opacity: s.opacity,
              animationDelay: s.delay,
              animationDuration: '3s',
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 w-full max-w-md">
        {/* Title */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Rocket className="size-8 text-cyan-400" />
            <h1 className="text-4xl font-bold tracking-wider bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              SpaceGame
            </h1>
          </div>
          <p className="text-slate-500 text-sm">A 4X Space Strategy Game</p>
        </div>

        {/* Tab switcher */}
        <div className="flex w-full bg-[#0d0d24] border border-white/10 rounded-xl overflow-hidden">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'new' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Rocket className="size-3.5 inline mr-1.5 -mt-0.5" />
            New Galaxy
          </button>
          <button
            onClick={() => setActiveTab('load')}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'load' ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <FolderOpen className="size-3.5 inline mr-1.5 -mt-0.5" />
            Load Game
            {saves.length > 0 && (
              <span className="ml-1.5 bg-cyan-500/20 text-cyan-400 text-[10px] px-1.5 py-0.5 rounded-full">
                {saves.length}
              </span>
            )}
          </button>
        </div>

        {/* New Game Tab */}
        {activeTab === 'new' && (
          <div className="bg-[#0d0d24] border border-white/10 rounded-xl p-6 w-full space-y-4">
            <h2 className="text-lg font-semibold text-center">Create New Galaxy</h2>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">Galaxy Seed</label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-600/50 focus:ring-1 focus:ring-cyan-600/30"
                placeholder="Enter seed number"
              />
              <p className="text-[10px] text-slate-600">Same seed generates the same galaxy</p>
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
        )}

        {/* Load Game Tab */}
        {activeTab === 'load' && (
          <div className="bg-[#0d0d24] border border-white/10 rounded-xl p-4 w-full">
            {saves.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-sm">
                <Save className="size-8 mx-auto mb-2 opacity-30" />
                No saved games found
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                {saves.map((save) => (
                  <div
                    key={save.id}
                    className="flex items-center gap-3 bg-black/30 border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{save.name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Seed: {save.seed} • {formatTick(save.tick)} • {formatDate(save.updatedAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10 shrink-0"
                      disabled={loadingSaveId === save.id}
                      onClick={() => handleLoad(save.id)}
                    >
                      {loadingSaveId === save.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        'Load'
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-400/10 shrink-0"
                      disabled={deletingSaveId === save.id}
                      onClick={() => handleDelete(save.id)}
                    >
                      {deletingSaveId === save.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto pt-4 text-[10px] text-slate-700">SpaceGame v0.1</footer>
    </div>
  );
}
