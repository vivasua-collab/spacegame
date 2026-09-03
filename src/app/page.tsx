'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useGameStore, type SaveInfo } from '@/stores/game-store';
import { GameLayout } from '@/components/game/game-layout';
import { Button } from '@/components/ui/button';
import { Rocket, Save, Trash2, Loader2, FolderOpen, Dices } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { getGameMediator } from '@/core/game-mediator';
import { toast } from '@/hooks/use-toast';

/**
 * Deterministic pseudo-random number generator (simple LCG).
 * Used only for the decorative star field on the main menu — NOT for galaxy
 * generation. Galaxy generation uses Xoshiro256 from the seed (see
 * src/galaxy/generator.ts); the seed itself lives in the Zustand store
 * (`galaxySeed`) so it does not change on every page re-mount.
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
  const loadGame = useGameStore((s) => s.loadGame);
  const loadSaveList = useGameStore((s) => s.loadSaveList);
  const deleteSave = useGameStore((s) => s.deleteSave);
  // Audit 2026-08-28: seed живёт в Zustand store (а не в локальном useState).
  // Прежний `useState(() => Math.random()...)` перевычислялся при каждом
  // перемонтировании Home (выход в главное меню и обратно), из-за чего seed
  // «прыгал» раз в 20-30 секунд при активной игре. Store-поле стабильно.
  const galaxySeed = useGameStore((s) => s.galaxySeed);
  const rollGalaxySeed = useGameStore((s) => s.rollGalaxySeed);

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

  // Game loop lifecycle — управляется медиатором (Block 06 §3.4).
  // Mediator.start() запускает registry.startAll() (модули → 'started') + loop.start() (setInterval).
  // Mediator.stop() очищает интервал при размонтировании компонента.
  // Подписка на `core:state-changed` (в game-store.getMediatorWithModules)
  // обновляет Zustand-state после каждого тика.
  useEffect(() => {
    const mediator = getGameMediator();
    mediator.start();
    return () => {
      mediator.stop();
    };
  }, [isInitialized]);

  // Load saves — async callback, setState only in .then() (not sync in effect)
  useEffect(() => {
    let active = true;
    loadSaveList().then((list) => {
      if (active) setSaves(list);
    });
    return () => { active = false; };
  }, [loadSaveList]);

  // Handle load
  // R-30: отказ загрузки — видимый тост (например, сейв старого формата:
  // deserializeGameState отклоняет fmt≠3 явной ошибкой).
  const handleLoad = useCallback(async (id: string) => {
    setLoadingSaveId(id);
    const ok = await loadGame(id);
    setLoadingSaveId(null);
    if (!ok) {
      toast({
        title: 'Не удалось загрузить сейв',
        description: 'Сейв повреждён или записан в старом формате (v1/v2 не поддерживаются). Подробности — в консоли.',
        variant: 'destructive',
      });
    }
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

  // Format tick to year/day (1 tick = 1 day)
  const formatTick = (tick: number) => {
    const year = Math.floor(tick / 365) + 1;
    const dayInYear = tick % 365 + 1;
    return `Y${year} D${dayInYear}`;
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
              <label className="text-xs text-slate-400 block">
                Galaxy Seed
                <span className="ml-1.5 text-slate-600">(по умолчанию случайный)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={galaxySeed}
                  onChange={(e) => {
                    // Ввод пользователем — пытаемся сохранить как число в store.
                    // Поскольку galaxySeed в store только читается через селектор,
                    // используем простой трюк: парсим и вызываем rollGalaxySeed
                    // только когда введено валидное число (иначе откатываемся).
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v > 0) {
                      // Прямое изменение через внутренний set-store. Используем
                      // новое API состояния Zustand: setState напрямую.
                      useGameStore.setState({ galaxySeed: v });
                    }
                  }}
                  className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-600/50 focus:ring-1 focus:ring-cyan-600/30"
                  placeholder="Enter seed number"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  // Audit 2026-08-28: variant="outline" давал белый фон
                  // (bg-background в светлой теме = белый). Заменено на
                  // variant="ghost" + явные классы: прозрачный фон, светлая
                  // граница, cyan-акцент при наведении.
                  className="shrink-0 bg-black/40 border border-white/10 text-cyan-300 hover:bg-cyan-500/10 hover:border-cyan-500/40 hover:text-cyan-200"
                  onClick={rollGalaxySeed}
                  aria-label="Случайный seed"
                  title="Сгенерировать случайный seed галактики"
                >
                  <Dices className="size-4" />
                </Button>
              </div>
              <p className="text-[10px] text-slate-600">
                Случайный seed по умолчанию. Тот же seed — та же галактика.
                Нажмите на иконку кубика, чтобы перебросить seed.
              </p>
            </div>

            <Button
              className="w-full"
              onClick={() => {
                // Используем стабильный galaxySeed из store (а не
                // локальный seed, который раньше прыгал).
                if (galaxySeed > 0) newGame({ seed: galaxySeed });
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
                    <DeleteSaveButton
                      saveId={save.id}
                      saveName={save.name}
                      disabled={deletingSaveId === save.id}
                      onDelete={() => handleDelete(save.id)}
                    />
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

/**
 * R-27-sec (инцидент 2026-08-31): подтверждение удаления сейва.
 *
 * Во время верификации R-27 все 3 сейва были удалены из БД серией из 3
 * «одновременных» DELETE-запросов (паттерн dev.log: DELETE × 3 → GET × 3;
 * источник не установлен однозначно — внешний клиент через шлюз / серия
 * кликов). Кнопка «мусорка» без подтверждения = потеря прогресса одним
 * кликом. Теперь удаление требует явного подтверждения (AlertDialog,
 * паттерн C9 — как «Начать новую игру» в game-layout).
 */
function DeleteSaveButton({
  saveId,
  saveName,
  disabled,
  onDelete,
}: {
  saveId: string;
  saveName: string;
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-red-400/60 hover:text-red-400 hover:bg-red-400/10 shrink-0"
          disabled={disabled}
          aria-label={`Удалить сейв ${saveName}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Удалить сохранение?
            <span className="sr-only">Сейв {saveId}</span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            «{saveName}» будет удалён безвозвратно. Прогресс этой галактики
            будет потерян (файл дампа не создаётся).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-500"
            onClick={onDelete}
          >
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
