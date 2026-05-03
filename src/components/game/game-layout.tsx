'use client';

import { useState, useCallback } from 'react';
import { useGameStore, type GameView } from '@/stores/game-store';
import { GalaxyMap } from './galaxy-map';
import { SystemView } from './system-view';
import { PlanetView } from './planet-view';
import { TimeControls } from './time-controls';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Map,
  Sun,
  Globe2,
  Rocket,
  RotateCcw,
  Save,
  Loader2,
} from 'lucide-react';

export function GameLayout() {
  const gameState = useGameStore((s) => s.gameState);
  const view = useGameStore((s) => s.view);
  const setView = useGameStore((s) => s.setView);
  const newGame = useGameStore((s) => s.newGame);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);
  const selectedPlanetId = useGameStore((s) => s.selectedPlanetId);

  if (!gameState) return null;

  const time = gameState.time;

  // Get current system/planet for display
  const selectedSystem = selectedSystemId
    ? gameState.galaxy.systemMap.get(selectedSystemId)
    : undefined;

  let selectedPlanetName: string | undefined;
  if (selectedPlanetId && selectedSystem) {
    const p = selectedSystem.planets.find((pl) => pl.id === selectedPlanetId);
    selectedPlanetName = p?.name;
  }

  return (
    <div className="flex flex-col h-screen bg-[#060614] text-white">
      {/* ===== Top Bar ===== */}
      <header className="h-11 bg-[#0a0a1a]/95 border-b border-white/10 flex items-center px-4 gap-4 shrink-0 backdrop-blur-sm">
        {/* Game title */}
        <div className="flex items-center gap-2">
          <Rocket className="size-4 text-cyan-400" />
          <span className="font-bold text-sm tracking-wide">SpaceGame</span>
        </div>

        <Separator orientation="vertical" className="h-5 bg-white/10" />

        {/* Time display */}
        <div className="font-mono text-xs text-slate-400">
          Year <span className="text-white">{time.year}</span>
          <span className="mx-1 text-slate-600">|</span>
          Day <span className="text-white">{time.day}</span>
        </div>

        <Separator orientation="vertical" className="h-5 bg-white/10" />

        {/* Speed controls */}
        <TimeControls />

        <div className="flex-1" />

        {/* Save button */}
        <SaveButton />

        {/* New game button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-slate-400 hover:text-white"
          onClick={() => {
            if (confirm('Start a new game? Current progress will be lost.')) {
              newGame();
            }
          }}
        >
          <RotateCcw className="size-3 mr-1" />
          New Game
        </Button>
      </header>

      {/* ===== Main Content ===== */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar */}
        <aside className="w-48 bg-[#0a0a1a]/80 border-r border-white/10 flex flex-col shrink-0">
          {/* Navigation */}
          <nav className="p-2 space-y-0.5">
            <NavButton
              active={view === 'galaxy'}
              onClick={() => setView('galaxy')}
              icon={<Map className="size-3.5" />}
              label="Galaxy Map"
            />
            <NavButton
              active={view === 'system'}
              onClick={() => setView('system')}
              icon={<Sun className="size-3.5" />}
              label="System"
              sublabel={selectedSystem?.name}
              disabled={!selectedSystemId}
            />
            <NavButton
              active={view === 'planet'}
              onClick={() => setView('planet')}
              icon={<Globe2 className="size-3.5" />}
              label="Planet"
              sublabel={selectedPlanetName}
              disabled={!selectedPlanetId}
            />
          </nav>

          <Separator className="bg-white/5" />

          {/* Quick info */}
          <div className="p-3 space-y-2 text-xs text-slate-500 flex-1 overflow-hidden">
            {selectedSystem && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">System</div>
                <div className="text-slate-300 font-medium truncate">{selectedSystem.name}</div>
                <div className="text-slate-500">
                  {selectedSystem.planets.length} planet{selectedSystem.planets.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}
            {selectedPlanetName && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Planet</div>
                <div className="text-slate-300 font-medium truncate">{selectedPlanetName}</div>
              </div>
            )}
          </div>
        </aside>

        {/* Main view area — keep GalaxyMap always mounted to preserve zoom/pan state */}
        <main className="flex-1 min-w-0 p-3 overflow-hidden">
          <div className={view === 'galaxy' ? 'w-full h-full' : 'hidden'}>
            <GalaxyMap />
          </div>
          {view === 'system' && <SystemView />}
          {view === 'planet' && <PlanetView />}
        </main>
      </div>

      {/* ===== Bottom Status Bar ===== */}
      <footer className="h-7 bg-[#0a0a1a] border-t border-white/10 flex items-center px-4 text-[10px] text-slate-600 shrink-0">
        <span>SpaceGame v0.1</span>
        <span className="mx-2">|</span>
        <span>Systems: {gameState.galaxy.systems.length}</span>
        <span className="mx-2">|</span>
        <span>Speed: {gameState.speed === 0 ? 'Paused' : `x${gameState.speed}`}</span>
        <span className="mx-2">|</span>
        <span>Phase: {gameState.phase}</span>
        <div className="flex-1" />
        <span className="font-mono">Tick: {time.tick}</span>
      </footer>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  sublabel,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : disabled
          ? 'text-slate-700 cursor-not-allowed'
          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }`}
    >
      {icon}
      <div className="flex-1 min-w-0 text-left">
        <div className="truncate">{label}</div>
        {sublabel && (
          <div className="text-[10px] text-slate-500 truncate">{sublabel}</div>
        )}
      </div>
    </button>
  );
}

function SaveButton() {
  const saveGame = useGameStore((s) => s.saveGame);
  const isSaving = useGameStore((s) => s.isSaving);
  const currentSaveId = useGameStore((s) => s.currentSaveId);
  const [justSaved, setJustSaved] = useState(false);

  const handleSave = useCallback(async () => {
    const ok = await saveGame();
    if (ok) {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    }
  }, [saveGame]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 text-xs transition-colors ${
        justSaved
          ? 'text-green-400'
          : 'text-slate-400 hover:text-white'
      }`}
      onClick={handleSave}
      disabled={isSaving}
    >
      {isSaving ? (
        <Loader2 className="size-3 mr-1 animate-spin" />
      ) : justSaved ? (
        <span className="text-green-400">✓</span>
      ) : (
        <Save className="size-3 mr-1" />
      )}
      {justSaved ? 'Saved' : currentSaveId ? 'Save' : 'Save'}
    </Button>
  );
}
