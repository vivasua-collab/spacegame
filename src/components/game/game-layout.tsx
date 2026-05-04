'use client';

import { useState, useCallback } from 'react';
import { useGameStore, type GameView } from '@/stores/game-store';
import { GalaxyMap } from './galaxy-map';
import { SystemView } from './system-view';
import { PlanetView } from './planet-view';
import { TimeControls } from './time-controls';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TYPE_NAMES } from '@/data/planet-types';
import type { GameState, EntityId } from '@/core/types';
import { toast } from '@/hooks/use-toast';
import {
  Map,
  Sun,
  Globe2,
  Rocket,
  RotateCcw,
  Save,
  Loader2,
  Flag,
  Globe,
} from 'lucide-react';

export function GameLayout() {
  const gameState = useGameStore((s) => s.gameState);
  const view = useGameStore((s) => s.view);
  const setView = useGameStore((s) => s.setView);
  const newGame = useGameStore((s) => s.newGame);
  const selectedSystemId = useGameStore((s) => s.selectedSystemId);
  const selectedPlanetId = useGameStore((s) => s.selectedPlanetId);
  const selectSystem = useGameStore((s) => s.selectSystem);
  const selectPlanet = useGameStore((s) => s.selectPlanet);

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
          Day <span className="text-white">{time.dayInYear + 1}</span>
        </div>

        <Separator orientation="vertical" className="h-5 bg-white/10" />

        {/* Speed controls — скрыты при фазе colonization */}
        {gameState.phase !== 'colonization' && <TimeControls />}

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

      {/* Colonization banner */}
      {gameState.phase === 'colonization' && (
        <div className="bg-cyan-900/30 border-b border-cyan-600/30 px-4 py-2 flex items-center gap-3 shrink-0">
          <Flag className="size-4 text-cyan-400 shrink-0" />
          <span className="text-sm text-cyan-200 font-medium">
            Выберите планету для колонизации
          </span>
          <span className="text-xs text-cyan-400/60">
            Кликните на систему на карте галактики, затем нажмите «Колонизировать» на планете
          </span>
        </div>
      )}

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
          <div className="p-3 space-y-2 text-xs text-slate-500">
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

          <Separator className="bg-white/5" />

          {/* Colonies section */}
          <ColoniesSection
            gameState={gameState}
            selectedPlanetId={selectedPlanetId}
            selectSystem={selectSystem}
            selectPlanet={selectPlanet}
          />
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

function ColoniesSection({
  gameState,
  selectedPlanetId,
  selectSystem,
  selectPlanet,
}: {
  gameState: GameState;
  selectedPlanetId: EntityId | null;
  selectSystem: (id: EntityId | null) => void;
  selectPlanet: (id: EntityId | null) => void;
}) {
  // Вычисляем колонии напрямую — useMemo с [gameState.galaxy.systems] ломается,
  // т.к. при мутации planet.owner ссылка на systems не меняется.
  // Прямой расчёт достаточно дешёвый (~N систем × M планет).
  const colonies = gameState.galaxy.systems.flatMap((s) =>
    s.planets.filter((p) => p.owner != null).map((p) => ({ ...p, systemName: s.name }))
  );

  const handleNavigate = useCallback(
    (systemId: EntityId, planetId: EntityId) => {
      selectSystem(systemId);
      selectPlanet(planetId);
    },
    [selectSystem, selectPlanet]
  );

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Section header */}
      <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
        <Flag className="size-3 text-cyan-400/70" />
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
          Колонии
        </span>
        {colonies.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-600">{colonies.length}</span>
        )}
      </div>

      {colonies.length === 0 ? (
        <div className="px-3 py-2 text-[10px] text-slate-700 italic">Нет колоний</div>
      ) : (
        <div className="max-h-96 overflow-y-auto px-1.5 pb-1 space-y-0.5 scrollbar-thin">
          {colonies.map((planet) => {
            const isActive = planet.id === selectedPlanetId;
            return (
              <button
                key={planet.id}
                onClick={() => handleNavigate(planet.systemId, planet.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  isActive
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Globe
                  className={`size-3 shrink-0 ${
                    isActive ? 'text-cyan-400' : 'text-slate-500'
                  }`}
                />
                <div className="flex-1 min-w-0 text-left">
                  <div className="truncate">{planet.name}</div>
                  <div className="text-[10px] text-slate-600 truncate">
                    {planet.systemName} • {TYPE_NAMES[planet.type]}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
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
      setTimeout(() => setJustSaved(false), 2000);
      toast({
        title: 'Игра сохранена',
        description: currentSaveId ? 'Сохранение обновлено' : 'Создано новое сохранение',
      });
    } else {
      toast({
        title: 'Ошибка сохранения',
        description: 'Не удалось сохранить игру. Проверьте консоль для деталей.',
        variant: 'destructive',
      });
    }
  }, [saveGame, currentSaveId]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 text-xs transition-colors ${
        justSaved
          ? 'text-green-400'
          : isSaving
            ? 'text-amber-400'
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
      {isSaving ? 'Сохранение...' : justSaved ? 'Сохранено' : 'Save'}
    </Button>
  );
}
