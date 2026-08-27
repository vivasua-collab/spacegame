'use client';

/**
 * Block 02 (F4): Fleet Orders Panel — UI для отдачи приказов флоту.
 *
 * Layout:
 * - Шапка с именем выбранного флота + кнопка «Отменить приказ» (если есть активный)
 * - Текущий приказ: type + targetId + path + ETA + progress
 * - Форма отдачи нового приказа:
 *   - Селектор типа приказа (move / patrol / colonize / attack / defend)
 *   - Селектор целевой системы (только достижимые через JP — listReachableSystems)
 *   - Кнопка «Отдать приказ»
 *   - Toast «Нет маршрута через Jump Points» если planRoute вернул null
 *
 * Все действия через useGameStore (issueFleetOrder, cancelFleetOrder).
 */

import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/game-store';
import {
  listReachableSystems,
  getCurrentOrder,
  planRoute,
  calculateTravelTime,
  calculateFleetStats,
} from '@/ships/orders';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import type { EntityId, Fleet, FleetOrder } from '@/core/types';
import {
  Crosshair,
  MapPin,
  Clock,
  Route as RouteIcon,
  X,
  Swords,
  Flag,
  Shield,
  Repeat,
  ArrowRight,
} from 'lucide-react';

interface FleetOrdersPanelProps {
  fleet: Fleet | null;
}

const ORDER_TYPES: Array<{ value: FleetOrder['type']; label: string; icon: React.ReactNode; description: string }> = [
  { value: 'move', label: 'Переместиться', icon: <ArrowRight className="size-3" />, description: 'Лететь в систему и остаться там' },
  { value: 'patrol', label: 'Патруль', icon: <Repeat className="size-3" />, description: 'Циклически между системами (loops)' },
  { value: 'colonize', label: 'Колонизировать', icon: <Flag className="size-3" />, description: 'Основать колонию на планете' },
  { value: 'attack', label: 'Атаковать', icon: <Swords className="size-3" />, description: 'Напасть на систему врага (Etap 4 — full combat)' },
  { value: 'defend', label: 'Защищать', icon: <Shield className="size-3" />, description: 'Удерживать текущую систему' },
];

export function FleetOrdersPanel({ fleet }: FleetOrdersPanelProps) {
  const gameState = useGameStore((s) => s.gameState);
  const issueFleetOrder = useGameStore((s) => s.issueFleetOrder);
  const cancelFleetOrder = useGameStore((s) => s.cancelFleetOrder);
  const getSystem = useGameStore((s) => s.getSystem);

  const [selectedType, setSelectedType] = useState<FleetOrder['type']>('move');
  const [selectedTargetId, setSelectedTargetId] = useState<EntityId | ''>('');

  const currentOrder = useMemo(
    () => (fleet ? getCurrentOrder(fleet) : undefined),
    [fleet],
  );

  const reachableSystems = useMemo(() => {
    if (!gameState || !fleet) return [];
    return listReachableSystems(fleet.location, gameState.galaxy);
  }, [gameState, fleet]);

  // Превью маршрута для выбранной цели
  const routePreview = useMemo(() => {
    if (!gameState || !fleet || !selectedTargetId) return null;
    const path = planRoute(fleet.location, selectedTargetId, gameState.galaxy);
    if (!path) return { ok: false, reason: 'no_route' as const, path: null as EntityId[] | null, travelTime: 0 };
    const fleetStats = calculateFleetStats(fleet, gameState.ships, gameState.shipDesigns);
    const travelTime = calculateTravelTime(path, fleetStats, gameState.galaxy);
    if (travelTime === Infinity) return { ok: false, reason: 'no_jump_drive' as const, path, travelTime: 0 };
    return { ok: true, reason: null, path, travelTime };
  }, [gameState, fleet, selectedTargetId]);

  const handleIssue = useCallback(() => {
    if (!fleet) return;
    if (selectedType !== 'defend' && !selectedTargetId) {
      toast({
        title: 'Выберите цель',
        description: 'Укажите систему, в которую направить флот.',
        variant: 'destructive',
      });
      return;
    }
    const targetId = selectedType === 'defend' ? fleet.location : selectedTargetId;
    const ok = issueFleetOrder(fleet.id, selectedType, targetId);
    if (ok) {
      toast({
        title: 'Приказ отдан',
        description: `${ORDER_TYPES.find(o => o.value === selectedType)?.label} → ${targetId}`,
      });
      setSelectedTargetId('');
    } else {
      // Failure — show specific reason
      if (routePreview && !routePreview.ok) {
        if (routePreview.reason === 'no_route') {
          toast({
            title: 'Нет маршрута через Jump Points',
            description: 'Из текущей системы нет пути к цели.',
            variant: 'destructive',
          });
        } else if (routePreview.reason === 'no_jump_drive') {
          toast({
            title: 'Нет прыжкового двигателя',
            description: 'Ни один корабль флота не имеет jump_drive.',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Не удалось отдать приказ',
          variant: 'destructive',
        });
      }
    }
  }, [fleet, selectedType, selectedTargetId, issueFleetOrder, routePreview]);

  const handleCancel = useCallback(() => {
    if (!fleet) return;
    const ok = cancelFleetOrder(fleet.id);
    if (ok) {
      toast({ title: 'Приказ отменён' });
    }
  }, [fleet, cancelFleetOrder]);

  if (!gameState || !fleet) {
    return (
      <Card className="bg-[#0d0d24] border-white/10">
        <CardContent className="p-4 text-center text-xs text-slate-500">
          Выберите флот для отдачи приказов.
        </CardContent>
      </Card>
    );
  }

  const currentSystem = getSystem(fleet.location);
  const fleetStats = calculateFleetStats(fleet, gameState.ships, gameState.shipDesigns);

  return (
    <Card className="bg-[#0d0d24] border-white/10">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Приказы флота
          </div>
          {currentSystem && (
            <Badge variant="outline" className="text-[9px] h-4 px-1">
              <MapPin className="size-2.5 mr-0.5" />
              {currentSystem.name}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Fleet name + stats */}
        <div className="space-y-1">
          <div className="text-xs font-medium truncate">{fleet.name}</div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            <span title="Скорость флота">
              <Crosshair className="size-2.5 inline mr-0.5" />
              {fleetStats.speed.toFixed(1)} км/с
            </span>
            <span title="Масса флота">{fleetStats.mass.toFixed(0)} т</span>
            <span title="Прыжковый двигатель">
              {fleetStats.jumpDrivePresent
                ? <span className="text-cyan-400">Jump ✓</span>
                : <span className="text-red-400">Jump ✗</span>}
            </span>
          </div>
        </div>

        {/* Current order */}
        {currentOrder && (
          <div className="rounded border border-amber-400/30 bg-amber-500/5 p-2 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                <Crosshair className="size-3" />
                <span className="uppercase font-medium">{currentOrder.type}</span>
                {currentOrder.repeat && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-400/40 text-amber-300">
                    <Repeat className="size-2.5 mr-0.5" />
                    Loop
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={handleCancel}
                aria-label="Отменить приказ"
              >
                <X className="size-3 mr-0.5" />
                Отменить
              </Button>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <RouteIcon className="size-2.5" />
              <span className="font-mono truncate">
                {currentOrder.path.length > 1
                  ? `${currentOrder.path.length - 1} переход(ов)`
                  : 'без перемещения'}
              </span>
              {currentOrder.etaTick > 0 && (
                <span className="ml-auto flex items-center gap-0.5">
                  <Clock className="size-2.5" />
                  ETA: тик {currentOrder.etaTick}
                </span>
              )}
            </div>
            {currentOrder.path.length > 1 && (
              <div className="text-[9px] text-slate-500 font-mono truncate">
                {currentOrder.path.join(' → ')}
              </div>
            )}
          </div>
        )}

        {/* New order form */}
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Новый приказ
          </div>

          {/* Order type selector */}
          <div className="space-y-1">
            <Label className="text-[10px] text-slate-400">Тип приказа</Label>
            <Select
              value={selectedType}
              onValueChange={(v) => setSelectedType(v as FleetOrder['type'])}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d0d24] border-white/10 text-white">
                {ORDER_TYPES.map(({ value, label, icon }) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      {icon}
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[9px] text-slate-600">
              {ORDER_TYPES.find(o => o.value === selectedType)?.description}
            </div>
          </div>

          {/* Target system selector (hidden for defend) */}
          {selectedType !== 'defend' && (
            <div className="space-y-1">
              <Label className="text-[10px] text-slate-400">
                Целевая система ({reachableSystems.length} достижимо)
              </Label>
              <Select
                value={selectedTargetId}
                onValueChange={(v) => setSelectedTargetId(v)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Выберите систему..." />
                </SelectTrigger>
                <SelectContent className="bg-[#0d0d24] border-white/10 text-white max-h-60">
                  <ScrollArea className="max-h-48">
                    {reachableSystems.length === 0 ? (
                      <div className="text-[10px] text-slate-500 italic p-2">
                        Нет достижимых систем
                      </div>
                    ) : (
                      reachableSystems.map(sys => (
                        <SelectItem key={sys.id} value={sys.id} className="text-xs">
                          <span className="flex items-center gap-1.5">
                            <MapPin className="size-2.5" />
                            {sys.name}
                            {sys.planets.length > 0 && (
                              <span className="text-slate-500 text-[9px]">
                                ({sys.planets.length}P)
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Route preview */}
          {selectedType !== 'defend' && routePreview && selectedTargetId && (
            <div className="rounded border border-white/5 bg-white/5 p-2 text-[10px] space-y-1">
              {routePreview.ok && routePreview.path ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Маршрут</span>
                    <span className="font-mono text-cyan-300">
                      {routePreview.path.length - 1} переход(ов)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">ETA</span>
                    <span className="font-mono text-amber-300">
                      {routePreview.travelTime} тиков
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-500 font-mono truncate">
                    {routePreview.path.join(' → ')}
                  </div>
                </>
              ) : (
                <div className={`flex items-center gap-1 ${routePreview.reason === 'no_route' ? 'text-red-400' : 'text-amber-400'}`}>
                  <X className="size-3" />
                  <span>
                    {routePreview.reason === 'no_route'
                      ? 'Нет маршрута через Jump Points'
                      : 'Нет прыжкового двигателя'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Issue button */}
          <Button
            size="sm"
            className="w-full h-7 text-xs bg-cyan-500 hover:bg-cyan-400 text-white"
            onClick={handleIssue}
            disabled={selectedType !== 'defend' && !selectedTargetId}
          >
            <Crosshair className="size-3 mr-1" />
            Отдать приказ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
