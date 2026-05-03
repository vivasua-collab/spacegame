'use client';

import { useGameStore } from '@/stores/game-store';
import { Button } from '@/components/ui/button';
import { Pause, Play, FastForward } from 'lucide-react';
import type { GameSpeed } from '@/core/types';

const SPEEDS: { value: GameSpeed; label: string }[] = [
  { value: 1, label: 'x1' },
  { value: 5, label: 'x5' },
  { value: 15, label: 'x15' },
  { value: 50, label: 'x50' },
];

export function TimeControls() {
  const gameState = useGameStore((s) => s.gameState);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const togglePause = useGameStore((s) => s.togglePause);

  if (!gameState) return null;

  const isPaused = gameState.phase === 'paused' || gameState.speed === 0;
  const currentSpeed = gameState.speed;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={isPaused ? 'default' : 'outline'}
        size="sm"
        onClick={togglePause}
        className="h-7 w-7 p-0"
      >
        {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </Button>
      {SPEEDS.map((speed) => (
        <Button
          key={speed.value}
          variant={currentSpeed === speed.value ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSpeed(speed.value)}
          className="h-7 px-2 text-xs font-mono"
        >
          {speed.label}
        </Button>
      ))}
    </div>
  );
}
