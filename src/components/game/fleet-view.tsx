'use client';

/**
 * Block 02 (F3): Fleet View — экран менеджера флотов.
 *
 * Layout:
 * - Список всех флотов игрока (имя, кол-во кораблей, локация, текущий приказ)
 *   с раскрывающимся списком кораблей внутри флота (ship-card.tsx).
 * - Список «свободных» кораблей (не входящих во флоты) — для выбора при
 *   создании нового флота.
 * - Кнопки:
 *   - «+ Создать флот из выбранных» (свободные корабли)
 *   - «Объединить выбранные» (несколько флотов в одной системе)
 *   - «Разделить» (на выбранном флоте с выбранными кораблями)
 *   - «Переименовать» (на выбранном флоте)
 *
 * Все действия идут через useGameStore actions (createFleet, mergeFleets,
 * splitFleet, renameFleet) — direct immer mutation, no mediator round-trip
 * (MVP-упрощение; боевые/дипломатические события потребуют mediator).
 */

import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/game-store';
import { getFleetShips, getLooseShips } from '@/ships/fleet-engine';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { ShipCard } from './ship-card';
import { FleetOrdersPanel } from './fleet-orders-panel';
import type { EntityId } from '@/core/types';
import {
  Rocket,
  Plus,
  GitMerge,
  Split,
  Pencil,
  ChevronDown,
  ChevronRight,
  MapPin,
  Crosshair,
  Flag,
} from 'lucide-react';

export function FleetView() {
  const gameState = useGameStore((s) => s.gameState);
  const createFleet = useGameStore((s) => s.createFleet);
  const mergeFleets = useGameStore((s) => s.mergeFleets);
  const splitFleet = useGameStore((s) => s.splitFleet);
  const renameFleet = useGameStore((s) => s.renameFleet);
  const getSystem = useGameStore((s) => s.getSystem);

  // Local state for selection
  const [selectedFleetId, setSelectedFleetId] = useState<EntityId | null>(null);
  const [expandedFleetIds, setExpandedFleetIds] = useState<Set<EntityId>>(new Set());
  const [selectedLooseShips, setSelectedLooseShips] = useState<Set<EntityId>>(new Set());
  const [selectedFleetIdsForMerge, setSelectedFleetIdsForMerge] = useState<Set<EntityId>>(new Set());
  const [selectedShipsInFleet, setSelectedShipsInFleet] = useState<Set<EntityId>>(new Set());

  // Dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFleetName, setNewFleetName] = useState('');

  const playerFactionId = gameState?.playerFactionId ?? 'player';
  const playerFleets = useMemo(
    () => (gameState?.fleets ?? []).filter(f => f.owner === playerFactionId),
    [gameState?.fleets, playerFactionId],
  );

  // Loose ships: those not in any fleet
  const looseShips = useMemo(() => {
    if (!gameState) return [];
    return getLooseShips(gameState.ships, gameState.fleets, playerFactionId);
  }, [gameState, playerFactionId]);

  // Selected fleet
  const selectedFleet = useMemo(
    () => playerFleets.find(f => f.id === selectedFleetId) ?? null,
    [playerFleets, selectedFleetId],
  );

  // Toggle expand
  const toggleExpand = useCallback((fleetId: EntityId) => {
    setExpandedFleetIds(prev => {
      const next = new Set(prev);
      if (next.has(fleetId)) next.delete(fleetId);
      else next.add(fleetId);
      return next;
    });
  }, []);

  // Toggle selection
  const toggleInSet = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  // ===== Handlers =====

  const handleCreateFleetClick = useCallback(() => {
    if (selectedLooseShips.size === 0) {
      toast({
        title: 'Нет кораблей для флота',
        description: 'Выберите хотя бы один свободный корабль.',
        variant: 'destructive',
      });
      return;
    }
    setCreateDialogOpen(true);
  }, [selectedLooseShips.size]);

  const handleCreateFleet = useCallback(() => {
    if (!gameState) return;
    const shipIds = Array.from(selectedLooseShips);
    // Get the location of the first selected ship
    const firstShip = gameState.ships.get(shipIds[0]!);
    if (!firstShip) return;
    const location = firstShip.location;
    const name = newFleetName.trim() || `Флот ${shipIds.length}`;
    const newId = createFleet(name, shipIds, location);
    if (newId) {
      toast({
        title: 'Флот создан',
        description: `${name} — ${shipIds.length} кораблей в системе ${location}`,
      });
      setSelectedLooseShips(new Set());
      setNewFleetName('');
      setCreateDialogOpen(false);
      setSelectedFleetId(newId);
      setExpandedFleetIds(prev => new Set(prev).add(newId));
    } else {
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать флот. Все корабли должны быть в одной системе.',
        variant: 'destructive',
      });
    }
  }, [gameState, selectedLooseShips, newFleetName, createFleet]);

  const handleMerge = useCallback(() => {
    if (selectedFleetIdsForMerge.size < 2) {
      toast({
        title: 'Нужно выбрать ≥2 флотов',
        description: 'Выберите несколько флотов в одной системе для объединения.',
        variant: 'destructive',
      });
      return;
    }
    const fleetIds = Array.from(selectedFleetIdsForMerge);
    // Verify same location
    const locations = new Set(fleetIds.map(id => playerFleets.find(f => f.id === id)?.location));
    if (locations.size > 1) {
      toast({
        title: 'Разные системы',
        description: 'Все объединяемые флоты должны находиться в одной системе.',
        variant: 'destructive',
      });
      return;
    }
    const newId = mergeFleets(fleetIds);
    if (newId) {
      toast({
        title: 'Флоты объединены',
        description: `Новый флот: ${newId}`,
      });
      setSelectedFleetIdsForMerge(new Set());
      setSelectedFleetId(newId);
    } else {
      toast({
        title: 'Ошибка объединения',
        variant: 'destructive',
      });
    }
  }, [selectedFleetIdsForMerge, playerFleets, mergeFleets]);

  const handleSplit = useCallback(() => {
    if (!selectedFleet || selectedShipsInFleet.size === 0) {
      toast({
        title: 'Не выбраны корабли',
        description: 'Выберите корабли внутри флота для извлечения.',
        variant: 'destructive',
      });
      return;
    }
    if (selectedShipsInFleet.size >= selectedFleet.shipIds.length) {
      toast({
        title: 'Нельзя извлечь все корабли',
        description: 'В source-флоте должен остаться хотя бы один корабль.',
        variant: 'destructive',
      });
      return;
    }
    const shipIds = Array.from(selectedShipsInFleet);
    const newId = splitFleet(selectedFleet.id, shipIds);
    if (newId) {
      toast({
        title: 'Флот разделён',
        description: `Извлечено ${shipIds.length} кораблей в новый флот ${newId}`,
      });
      setSelectedShipsInFleet(new Set());
    } else {
      toast({
        title: 'Ошибка разделения',
        variant: 'destructive',
      });
    }
  }, [selectedFleet, selectedShipsInFleet, splitFleet]);

  const handleRename = useCallback(() => {
    if (!selectedFleet) return;
    setRenameValue(selectedFleet.name);
    setRenameDialogOpen(true);
  }, [selectedFleet]);

  const handleRenameConfirm = useCallback(() => {
    if (!selectedFleet) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      toast({
        title: 'Имя не может быть пустым',
        variant: 'destructive',
      });
      return;
    }
    const ok = renameFleet(selectedFleet.id, trimmed);
    if (ok) {
      toast({ title: 'Флот переименован', description: trimmed });
      setRenameDialogOpen(false);
    }
  }, [selectedFleet, renameValue, renameFleet]);

  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        Игра не загружена
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <Flag className="size-4 text-cyan-400" />
        <h2 className="text-sm font-semibold">Флоты</h2>
        <Badge variant="outline" className="text-[10px] h-4 px-1">
          {playerFleets.length}
        </Badge>
        <div className="flex-1" />
        <Button
          size="sm"
          className="h-7 text-xs bg-cyan-500 hover:bg-cyan-400 text-white"
          onClick={handleCreateFleetClick}
        >
          <Plus className="size-3 mr-1" />
          Создать флот
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs border-violet-400/30 hover:border-violet-400/60 text-violet-300"
          onClick={handleMerge}
          disabled={selectedFleetIdsForMerge.size < 2}
        >
          <GitMerge className="size-3 mr-1" />
          Объединить ({selectedFleetIdsForMerge.size})
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex gap-3">
        {/* Fleets list */}
        <Card className="flex-1 min-w-0 bg-[#0d0d24] border-white/10">
          <CardHeader className="py-2 px-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Флоты игрока ({playerFleets.length})
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[calc(100vh-200px)] px-2 pb-2">
              {playerFleets.length === 0 ? (
                <div className="text-center text-slate-500 text-xs py-8 border border-white/5 rounded m-2">
                  Нет флотов. Постройте корабли на верфи и создайте флот.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {playerFleets.map(fleet => {
                    const isExpanded = expandedFleetIds.has(fleet.id);
                    const isSelected = selectedFleetId === fleet.id;
                    const isSelectedForMerge = selectedFleetIdsForMerge.has(fleet.id);
                    const system = getSystem(fleet.location);
                    const shipCount = fleet.shipIds.length;
                    const currentOrder = fleet.orders[0];

                    return (
                      <div
                        key={fleet.id}
                        className={`rounded border transition-colors ${
                          isSelected
                            ? 'border-cyan-400/60 bg-cyan-500/5'
                            : isSelectedForMerge
                              ? 'border-violet-400/60 bg-violet-500/5'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        {/* Fleet row */}
                        <div className="flex items-center gap-1 p-2">
                          <button
                            onClick={() => toggleExpand(fleet.id)}
                            className="text-slate-500 hover:text-white shrink-0"
                            aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
                          >
                            {isExpanded
                              ? <ChevronDown className="size-3" />
                              : <ChevronRight className="size-3" />}
                          </button>
                          <button
                            onClick={() => setSelectedFleetId(isSelected ? null : fleet.id)}
                            className="flex-1 flex items-center gap-2 text-left min-w-0"
                          >
                            <Rocket className="size-3 text-cyan-400 shrink-0" />
                            <span className="text-xs font-medium truncate">{fleet.name}</span>
                            <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                              {shipCount} кор.
                            </Badge>
                          </button>
                          {/* Merge checkbox */}
                          <button
                            onClick={() => setSelectedFleetIdsForMerge(prev =>
                              toggleInSet(prev, fleet.id)
                            )}
                            className={`size-3.5 rounded border flex items-center justify-center shrink-0 ${
                              isSelectedForMerge
                                ? 'bg-violet-500 border-violet-400'
                                : 'border-white/30'
                            }`}
                            aria-label="Отметить для объединения"
                          />
                          {system && (
                            <span className="text-[9px] text-slate-500 flex items-center gap-0.5 shrink-0">
                              <MapPin className="size-2.5" />
                              {system.name}
                            </span>
                          )}
                        </div>

                        {/* Order indicator */}
                        {currentOrder && (
                          <div className="px-4 pb-1.5 flex items-center gap-1 text-[9px] text-amber-400/80">
                            <Crosshair className="size-2.5" />
                            <span className="uppercase">{currentOrder.type}</span>
                            <span className="text-slate-500">→ {currentOrder.targetId}</span>
                            {currentOrder.etaTick > 0 && (
                              <span className="text-slate-500 ml-auto">
                                ETA: тик {currentOrder.etaTick}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Expanded ships */}
                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-1">
                            <div className="text-[9px] uppercase tracking-wider text-slate-600 px-1 pt-1">
                              Корабли во флоте
                            </div>
                            {(() => {
                              const shipsInFleet = getFleetShips(fleet, gameState.ships);
                              if (shipsInFleet.length === 0) {
                                return (
                                  <div className="text-[10px] text-slate-600 italic px-1 py-1">
                                    Все корабли удалены (стейл-ссылки) — см. Etap 4
                                  </div>
                                );
                              }
                              return shipsInFleet.map(ship => {
                                const isSelectedInFleet = selectedShipsInFleet.has(ship.id);
                                return (
                                  <ShipCard
                                    key={ship.id}
                                    ship={ship}
                                    selected={isSelectedInFleet}
                                    compact
                                    onClick={() => {
                                      setSelectedFleetId(fleet.id);
                                      setSelectedShipsInFleet(prev =>
                                        toggleInSet(prev, ship.id)
                                      );
                                    }}
                                  />
                                );
                              });
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right panel: orders + selected fleet actions + loose ships */}
        <div className="w-72 shrink-0 flex flex-col gap-3">
          {/* Block 02 (F4): Orders panel — показывается когда флот выбран */}
          <FleetOrdersPanel fleet={selectedFleet} />

          {/* Selected fleet actions */}
          {selectedFleet && (
            <Card className="bg-[#0d0d24] border-white/10">
              <CardHeader className="py-2 px-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Действия с флотом
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <div className="text-xs text-slate-300 truncate">
                  {selectedFleet.name}
                </div>
                <div className="text-[10px] text-slate-500">
                  Выбрано кораблей: {selectedShipsInFleet.size} / {selectedFleet.shipIds.length}
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] border-amber-400/30 hover:border-amber-400/60 text-amber-300"
                    onClick={handleSplit}
                    disabled={selectedShipsInFleet.size === 0 ||
                              selectedShipsInFleet.size >= selectedFleet.shipIds.length}
                  >
                    <Split className="size-3 mr-1" />
                    Разделить ({selectedShipsInFleet.size})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px]"
                    onClick={handleRename}
                  >
                    <Pencil className="size-3 mr-1" />
                    Переименовать
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Loose ships */}
          <Card className="flex-1 min-h-0 bg-[#0d0d24] border-white/10">
            <CardHeader className="py-2 px-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Свободные корабли
                </div>
                <Badge variant="outline" className="text-[9px] h-4 px-1">
                  {looseShips.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[calc(100vh-320px)] px-2 pb-2">
                {looseShips.length === 0 ? (
                  <div className="text-center text-slate-500 text-[10px] py-6 border border-white/5 rounded m-2">
                    Нет свободных кораблей.
                    <br />
                    Постройте корабль на верфи.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {looseShips.map(ship => {
                      const isSelected = selectedLooseShips.has(ship.id);
                      return (
                        <ShipCard
                          key={ship.id}
                          ship={ship}
                          selected={isSelected}
                          compact
                          onClick={() => setSelectedLooseShips(prev =>
                            toggleInSet(prev, ship.id)
                          )}
                        />
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ===== Create Fleet Dialog ===== */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="size-4 text-cyan-400" />
              Создать флот
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedLooseShips.size} кораблей будет объединено в новый флот.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Имя флота</Label>
              <Input
                value={newFleetName}
                onChange={(e) => setNewFleetName(e.target.value)}
                placeholder="Например, Разведывательный флот"
                className="h-8 text-xs"
              />
            </div>
            <div className="text-[10px] text-slate-500">
              Все выбранные корабли должны находиться в одной системе.
              Флот появится в системе первого выбранного корабля.
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setCreateDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-cyan-500 hover:bg-cyan-400 text-white"
              onClick={handleCreateFleet}
            >
              <Plus className="size-3 mr-1" />
              Создать
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Rename Dialog ===== */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="bg-[#0d0d24] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4 text-cyan-400" />
              Переименовать флот
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {selectedFleet?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Новое имя</Label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="h-8 text-xs"
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setRenameDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-cyan-500 hover:bg-cyan-400 text-white"
              onClick={handleRenameConfirm}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
