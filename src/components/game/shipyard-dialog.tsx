'use client';

/**
 * Block 02 (F6): UI Очереди постройки кораблей на верфи.
 *
 * Открывается из BuildingDialog верфи (кнопка «Очередь верфи»).
 *
 * Layout:
 * - Список дизайнов игрока + кнопка «Построить» для каждого (с стоимостью)
 * - Текущая очередь постройки планеты (прогресс-бары, кнопка отмены)
 */

import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/game-store';
import { getShipBuildCostResources, getShipBuildTime, getShipBuildCostUER } from '@/data/ships/shipyard-queue';
import { calculateDesignStats } from '@/ships/designer';
import { getHull } from '@/data/ships/hulls';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import type { Planet } from '@/core/types';
import { Rocket, Hammer, X, Plus, Coins, Clock, Layers, Wrench } from 'lucide-react';

interface ShipyardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planet: Planet | undefined;
}

export function ShipyardDialog({ open, onOpenChange, planet }: ShipyardDialogProps) {
  const gameState = useGameStore((s) => s.gameState);
  const enqueueShipBuild = useGameStore((s) => s.enqueueShipBuild);
  const cancelShipyardItem = useGameStore((s) => s.cancelShipyardItem);
  const listShipDesigns = useGameStore((s) => s.listShipDesigns);
  const getShipyardQueue = useGameStore((s) => s.getShipyardQueue);
  const setView = useGameStore((s) => s.setView);
  const [shipNameInput, setShipNameInput] = useState<Record<string, string>>({});

  const designs = useMemo(() => listShipDesigns(), [listShipDesigns, gameState]);
  const queue = planet ? getShipyardQueue(planet.id) : undefined;

  const handleEnqueue = useCallback((designId: string) => {
    if (!planet) return;
    const design = designs.find(d => d.id === designId);
    if (!design) return;
    // Validate resources available
    const cost = getShipBuildCostResources(design);
    const steel = planet.resources['steel'] ?? 0;
    const microchip = planet.resources['microchip'] ?? 0;
    if (steel < cost.steel || microchip < cost.microchip) {
      toast({
        title: 'Недостаточно ресурсов',
        description: `Нужно: ${cost.steel} стали, ${cost.microchip} микрочипов`,
        variant: 'destructive',
      });
      return;
    }
    const name = shipNameInput[designId] || `${design.name}-${Date.now() % 1000}`;
    const itemId = enqueueShipBuild(planet.id, designId, name);
    if (itemId) {
      toast({
        title: 'Корабль в очереди',
        description: `${name} — ${getShipBuildTime(design)} тиков`,
      });
      setShipNameInput(prev => ({ ...prev, [designId]: '' }));
    }
  }, [planet, designs, shipNameInput, enqueueShipBuild]);

  if (!planet || !gameState) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hammer className="size-4 text-amber-400" />
            Верфь — {planet.name}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Стройте корабли из сохранённых дизайнов. Постройка занимает тики; ресурсы списываются по завершении.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <div className="space-y-4">
            {/* ─── Дизайны ───────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wider text-slate-400">
                  Дизайны кораблей ({designs.length})
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-cyan-300 hover:text-cyan-200"
                  onClick={() => {
                    onOpenChange(false);
                    setView('ship-designer');
                  }}
                >
                  <Wrench className="size-3 mr-1" />
                  Новый дизайн
                </Button>
              </div>

              {designs.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-4 border border-white/5 rounded">
                  Нет сохранённых дизайнов. Откройте конструктор, чтобы создать.
                </div>
              ) : (
                <div className="space-y-2">
                  {designs.map(design => {
                    const stats = calculateDesignStats(design);
                    const cost = getShipBuildCostResources(design);
                    const buildTime = getShipBuildTime(design);
                    const costUER = getShipBuildCostUER(design);
                    const hull = getHull(design.hullId);
                    const steel = planet.resources['steel'] ?? 0;
                    const microchip = planet.resources['microchip'] ?? 0;
                    const canAfford = steel >= cost.steel && microchip >= cost.microchip;
                    const name = shipNameInput[design.id] || '';

                    return (
                      <div key={design.id} className="rounded border border-white/10 bg-white/5 p-2">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Rocket className="size-3 text-cyan-400" />
                            <span className="text-sm font-medium">{design.name}</span>
                            <Badge variant="outline" className="text-[10px] px-1">
                              {hull?.name ?? design.hullId}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1">
                              {design.armor}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {design.moduleIds.length} мод.
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-1 text-[10px] mb-2">
                          <Stat icon={<Layers />} label="HS" value={`${stats.usedHS}/${stats.totalHS}`} />
                          <Stat icon={<Rocket />} label="Speed" value={`${stats.speed.toFixed(1)}`} />
                          <Stat icon={<Hammer />} label="HP" value={`${stats.totalHP}`} />
                          <Stat icon={<Coins />} label="Cost" value={`${costUER}у`} />
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-2">
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />
                            {buildTime} тиков
                          </span>
                          <span>•</span>
                          <span className={canAfford ? 'text-emerald-400' : 'text-red-400'}>
                            {cost.steel} стали / {planet.resources['steel'] ?? 0} (склад)
                          </span>
                          <span>•</span>
                          <span className={canAfford ? 'text-emerald-400' : 'text-red-400'}>
                            {cost.microchip} чипов / {planet.resources['microchip'] ?? 0}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Input
                            placeholder={`Имя (по умолчанию ${design.name}-001)`}
                            value={name}
                            onChange={(e) => setShipNameInput(prev => ({ ...prev, [design.id]: e.target.value }))}
                            className="h-7 text-xs flex-1"
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-cyan-500 hover:bg-cyan-400 text-white"
                            disabled={!canAfford || !stats.isValid}
                            onClick={() => handleEnqueue(design.id)}
                          >
                            <Plus className="size-3 mr-1" />
                            В очередь
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Separator className="bg-white/10" />

            {/* ─── Очередь постройки ────────────────────────────────── */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Очередь постройки ({queue?.items.length ?? 0})
              </Label>

              {!queue || queue.items.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-4 border border-white/5 rounded">
                  Очередь пуста
                </div>
              ) : (
                <div className="space-y-2">
                  {queue.items.map((item, idx) => (
                    <div key={item.id} className="rounded border border-white/10 bg-white/5 p-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {idx === 0 ? (
                            <Badge variant="default" className="text-[10px] px-1 bg-cyan-500/30 text-cyan-200 border-cyan-400/40">
                              В работе
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1">
                              Ожидает (#{idx + 1})
                            </Badge>
                          )}
                          <span className="text-sm">{item.shipName}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-5 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => cancelShipyardItem(planet.id, item.id)}
                          aria-label="Отменить"
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-1">
                        <span>{item.progressTicks}/{item.totalTicks} тиков</span>
                        <span>•</span>
                        <span>{item.totalTicks - item.progressTicks} осталось</span>
                      </div>
                      <Progress
                        value={(item.progressTicks / item.totalTicks) * 100}
                        className="h-1.5"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-1 rounded bg-white/5">
      <div className="flex items-center gap-1 text-slate-500 [&_svg]:size-2.5">
        {icon}
        <span className="text-[9px]">{label}</span>
      </div>
      <div className="font-mono text-slate-300">{value}</div>
    </div>
  );
}
