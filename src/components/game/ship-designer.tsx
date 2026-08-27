'use client';

/**
 * Block 02 (F2): UI Конструктора кораблей — docs/50-ships.md §1.6 + §10.
 *
 * Экран запускается:
 * - Из BuildingDialog верфи (кнопка «Конструктор кораблей»)
 * - Из верхнего меню (кнопка 🔧 Дизайнер)
 *
 * Layout:
 * - Левая колонка: селектор корпуса (4 карточки), селектор обшивки (4 кнопки)
 * - Центр: список доступных модулей (по категориям) + список выбранных модулей
 *   с кнопками удаления
 * - Правая колонка: live DesignStats + кнопка «Сохранить дизайн»
 *
 * DnD опционален (R4 плана) — для простоты используем click-to-add/remove.
 * Drag&Drop можно добавить в Etap 4 если будет нужно.
 */

import { useState, useMemo, useCallback } from 'react';
import { useGameStore } from '@/stores/game-store';
import { calculateDesignStats, validateShip, armorMultiplier } from '@/ships/designer';
import type { DesignValidationCtx } from '@/ships/designer';
import { HULLS, getHull } from '@/data/ships/hulls';
import { MODULE_MAP, listModulesByCategory } from '@/data/ships/modules';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import type {
  HullArmorThickness,
  ShipDesign,
  ModuleCategory,
} from '@/core/types';
import {
  Rocket,
  Plus,
  X,
  Save,
  Wrench,
  Shield,
  Zap,
  Gauge,
  Weight,
  Coins,
  Satellite,
  Radar,
  Fuel,
} from 'lucide-react';

const ARMOR_OPTIONS: HullArmorThickness[] = ['light', 'standard', 'thick', 'heavy'];

const ARMOR_LABELS: Record<HullArmorThickness, string> = {
  light: 'Лёгкая',
  standard: 'Стандартная',
  thick: 'Утолщённая',
  heavy: 'Тяжёлая',
};

const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  engine: 'Двигатели',
  control: 'ЦПУ и связь',
  life_support: 'Жизнеобеспечение',
  weapon: 'Оружие',
  defense: 'Оборона',
  auxiliary: 'Вспомогательные',
};

const CATEGORY_ORDER: ModuleCategory[] = [
  'engine', 'control', 'life_support', 'weapon', 'defense', 'auxiliary',
];

const CATEGORY_ICONS: Record<ModuleCategory, React.ReactNode> = {
  engine: <Rocket className="size-3" />,
  control: <Wrench className="size-3" />,
  life_support: <Wrench className="size-3" />,
  weapon: <Zap className="size-3" />,
  defense: <Shield className="size-3" />,
  auxiliary: <Plus className="size-3" />,
};

export interface ShipDesignerProps {
  /**
   * Audit Pass 4 P1-1: реальный уровень верфи на выбранной планете игрока.
   * `0` = на планете нет верфи (тогда дизайны с requiredShipyardLevel > 0
   * не пройдут валидацию — UI показывает ошибку ещё до сохранения).
   * Если планета не выбрана — game-layout.tsx передаёт 0.
   */
  shipyardLevel: number;
}

export function ShipDesigner({ shipyardLevel }: ShipDesignerProps) {
  const gameState = useGameStore((s) => s.gameState);
  const saveShipDesign = useGameStore((s) => s.saveShipDesign);
  const setView = useGameStore((s) => s.setView);

  // Local state for the design being built
  const [hullId, setHullId] = useState<string>('hull_scout');
  const [armor, setArmor] = useState<HullArmorThickness>('light');
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [designName, setDesignName] = useState<string>('Новый дизайн');

  // Build ShipDesign for validation/stats (placeholder gameState/owner if null)
  const tick = gameState?.time.tick ?? 0;
  const owner = gameState?.playerFactionId ?? 'player';
  const design: ShipDesign = useMemo(() => ({
    id: 'draft',
    name: designName,
    hullId,
    armor,
    moduleIds,
    owner,
    createdAtTick: tick,
  }), [designName, hullId, armor, moduleIds, owner, tick]);

  // Audit Pass 4 P1-1: validation ctx теперь берёт реальный shipyardLevel
  // с выбранной планеты игрока (передаётся через prop). engineeringLevel и
  // researchedTechs остаются разрешающими — отдельных задач по engineering
  // gate / requiredTechs в MVP scope нет (requiredTechs = [] для всех
  // модулей/корпусов в MVP, см. риск R3 плана).
  const validationCtx: DesignValidationCtx = useMemo(() => ({
    shipyardLevel,
    engineeringLevel: 99,
    researchedTechs: ['all'],
  }), [shipyardLevel]);

  const stats = useMemo(() => calculateDesignStats(design, validationCtx), [design, validationCtx]);
  const validation = useMemo(() => validateShip(design, validationCtx), [design, validationCtx]);

  const handleAddModule = useCallback((moduleId: string) => {
    setModuleIds(prev => [...prev, moduleId]);
  }, []);

  const handleRemoveModule = useCallback((index: number) => {
    setModuleIds(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleArmorChange = useCallback((newArmor: HullArmorThickness) => {
    const hull = getHull(hullId);
    if (hull?.armorOptions.includes(newArmor)) {
      setArmor(newArmor);
    }
  }, [hullId]);

  const handleHullChange = useCallback((newHullId: string) => {
    const newHull = getHull(newHullId);
    if (!newHull) return;
    setHullId(newHullId);
    setArmor(prev => newHull.armorOptions.includes(prev) ? prev : 'light');
  }, []);

  const handleSave = useCallback(() => {
    if (!validation.valid) {
      toast({
        title: 'Дизайн невалиден',
        description: validation.errors[0] ?? 'Проверьте обязательные модули',
        variant: 'destructive',
      });
      return;
    }
    if (!gameState) return;
    const hull = getHull(hullId);
    const id = saveShipDesign({
      name: designName || `Дизайн ${hull?.name ?? ''}`,
      hullId,
      armor,
      moduleIds,
      owner: gameState.playerFactionId,
    });
    if (id) {
      toast({
        title: 'Дизайн сохранён',
        description: `${designName} (id: ${id.slice(0, 12)}…)`,
      });
    }
  }, [validation, saveShipDesign, designName, hullId, armor, moduleIds, gameState]);

  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        Игра не инициализирована
      </div>
    );
  }

  const hull = getHull(hullId);

  return (
    <div className="flex flex-col h-full p-3 bg-[#060614] text-white gap-3 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <Rocket className="size-5 text-cyan-400" />
        <h2 className="text-lg font-bold">Конструктор кораблей</h2>
        <Separator orientation="vertical" className="h-6 bg-white/10" />
        <Input
          value={designName}
          onChange={(e) => setDesignName(e.target.value)}
          placeholder="Имя дизайна"
          className="h-7 w-64 text-sm"
        />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setView('galaxy')}
          className="h-7 text-xs"
        >
          <X className="size-3 mr-1" /> Закрыть
        </Button>
      </div>

      {/* Main 3-column layout */}
      <div className="flex flex-1 min-h-0 gap-3">
        {/* Left: Hull + Armor selectors */}
        <aside className="w-64 shrink-0 flex flex-col gap-3 overflow-hidden">
          <Card className="bg-[#0a0a1a]/80 border-white/10">
            <CardContent className="p-3">
              <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2">Корпус</Label>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
                {HULLS.map(h => {
                  const isSelected = h.id === hullId;
                  return (
                    <button
                      key={h.id}
                      onClick={() => handleHullChange(h.id)}
                      className={`w-full text-left p-2 rounded border transition-colors ${
                        isSelected
                          ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300'
                          : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>{h.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1">
                          HS {h.totalHS}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        HP {h.baseHP} • М {h.baseMass}т • {h.baseCost}у.е.р.
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Слоты: W{h.weaponSlots}/E{h.engineSlots}/S{h.systemSlots}/D{h.defenseSlots}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0a0a1a]/80 border-white/10">
            <CardContent className="p-3">
              <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2">Обшивка</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {ARMOR_OPTIONS.map(a => {
                  const isAvailable = hull?.armorOptions.includes(a) ?? false;
                  const isSelected = armor === a;
                  const mult = armorMultiplier(a);
                  return (
                    <button
                      key={a}
                      onClick={() => isAvailable && handleArmorChange(a)}
                      disabled={!isAvailable}
                      className={`p-1.5 rounded border text-[10px] transition-colors ${
                        isSelected
                          ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300'
                          : isAvailable
                          ? 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
                          : 'bg-white/5 border-white/5 text-slate-700 cursor-not-allowed'
                      }`}
                    >
                      <div className="font-semibold">{ARMOR_LABELS[a]}</div>
                      <div className="text-slate-500">×{mult.hpMult} HP / ×{mult.costMult} cost</div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Center: Module catalog + selected modules */}
        <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
          <Card className="bg-[#0a0a1a]/80 border-white/10 flex-1 flex flex-col overflow-hidden">
            <CardContent className="p-3 flex-1 flex flex-col overflow-hidden">
              <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Каталог модулей — кликните, чтобы добавить
              </Label>
              <ScrollArea className="flex-1 min-h-0 pr-2">
                <div className="space-y-3">
                  {CATEGORY_ORDER.map(cat => {
                    const mods = listModulesByCategory(cat);
                    if (mods.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-1.5 mb-1 text-[11px] uppercase tracking-wider text-slate-500">
                          {CATEGORY_ICONS[cat]}
                          {CATEGORY_LABELS[cat]}
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
                          {mods.map(m => (
                            <button
                              key={m.id}
                              onClick={() => handleAddModule(m.id)}
                              className="text-left p-2 rounded border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-colors"
                            >
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="truncate">{m.name}</span>
                                <Plus className="size-3 shrink-0 text-cyan-400" />
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                HS {m.size} • {m.mass}т • {m.cost}у.е.р.
                              </div>
                              {m.energyConsumption > 0 && (
                                <div className="text-[10px] text-amber-400/70">−{m.energyConsumption} МВт</div>
                              )}
                              {m.energyOutput && m.energyOutput > 0 && (
                                <div className="text-[10px] text-emerald-400/80">+{m.energyOutput} МВт</div>
                              )}
                              {m.thrust && (
                                <div className="text-[10px] text-cyan-400/70">Thrust {m.thrust}</div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Selected modules */}
          <Card className="bg-[#0a0a1a]/80 border-white/10 max-h-64 flex flex-col overflow-hidden">
            <CardContent className="p-3 flex-1 flex flex-col overflow-hidden">
              <Label className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                Установленные модули ({moduleIds.length})
              </Label>
              {moduleIds.length === 0 ? (
                <div className="text-xs text-slate-600 italic py-2">Модули не выбраны</div>
              ) : (
                <ScrollArea className="flex-1 min-h-0">
                  <div className="space-y-1 pr-2">
                    {moduleIds.map((id, idx) => {
                      const m = MODULE_MAP.get(id);
                      if (!m) return null;
                      return (
                        <div key={`${id}-${idx}`} className="flex items-center gap-2 p-1.5 rounded bg-white/5 border border-white/5">
                          <Badge variant="outline" className="text-[9px] px-1">
                            {m.category.slice(0, 3).toUpperCase()}
                          </Badge>
                          <span className="text-xs flex-1 truncate">{m.name}</span>
                          <span className="text-[10px] text-slate-500">HS {m.size}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-5 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => handleRemoveModule(idx)}
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Design stats + Save button */}
        <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-hidden">
          <Card className="bg-[#0a0a1a]/80 border-white/10">
            <CardContent className="p-3 space-y-2">
              <Label className="text-xs uppercase tracking-wider text-slate-400">Характеристики</Label>
              <StatRow icon={<Weight className="size-3" />} label="Масса" value={`${stats.mass.toFixed(0)} т`} />
              <StatRow icon={<Gauge className="size-3" />} label="Скорость" value={`${stats.speed.toFixed(1)} км/с`} />
              <StatRow
                icon={<Zap className="size-3" />}
                label="Энергия"
                value={`${stats.energyBalance >= 0 ? '+' : ''}${stats.energyBalance} МВт`}
                valueClass={stats.energyBalance < 0 ? 'text-amber-400' : 'text-emerald-400'}
              />
              <StatRow icon={<Shield className="size-3" />} label="HP" value={`${stats.totalHP}`} />
              <StatRow icon={<Shield className="size-3" />} label="Щиты" value={`${stats.shieldHP}`} />
              <StatRow icon={<Coins className="size-3" />} label="Стоимость" value={`${stats.cost} у.е.р.`} />
              <Separator className="bg-white/5" />
              <StatRow
                icon={<Satellite className="size-3" />}
                label="HS (исп/своб)"
                value={`${stats.usedHS}/${stats.freeHS} (всего ${stats.totalHS})`}
              />
              <StatRow
                icon={<Radar className="size-3" />}
                label="Прыжок"
                value={stats.canJump ? `до ${stats.jumpRangeMass}т` : 'нет'}
                valueClass={stats.canJump ? 'text-emerald-400' : 'text-amber-400'}
              />
              <StatRow
                icon={<Satellite className="size-3" />}
                label="Связь"
                value={`${stats.commRange} св.л.`}
              />
              {Object.entries(stats.fuelCapacity).length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mb-0.5">
                    <Fuel className="size-3" /> Топливо
                  </div>
                  <div className="pl-4 space-y-0.5">
                    {Object.entries(stats.fuelCapacity).map(([ft, cap]) => (
                      <div key={ft} className="text-[11px] text-slate-300 flex justify-between">
                        <span>{ft}</span>
                        <span className="font-mono">{cap}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Validation status */}
          <Card className={`border ${validation.valid ? 'border-emerald-400/30' : 'border-red-400/30'} bg-[#0a0a1a]/80`}>
            <CardContent className="p-3 space-y-1">
              <div className={`text-xs font-semibold ${validation.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                {validation.valid ? '✓ Дизайн валиден' : '✗ Дизайн невалиден'}
              </div>
              {!validation.valid && (
                <ul className="text-[11px] text-red-300/80 space-y-0.5 list-disc pl-4 max-h-32 overflow-y-auto scrollbar-thin">
                  {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>

          <Button
            onClick={handleSave}
            disabled={!validation.valid}
            className="bg-cyan-500 hover:bg-cyan-400 text-white disabled:opacity-50"
          >
            <Save className="size-4 mr-2" />
            Сохранить дизайн
          </Button>
        </aside>
      </div>
    </div>
  );
}

function StatRow({ icon, label, value, valueClass }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-slate-500">{icon}</span>
      <span className="text-slate-400 flex-1">{label}</span>
      <span className={`font-mono text-slate-200 ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}
