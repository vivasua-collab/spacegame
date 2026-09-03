'use client';

/* eslint-disable react-hooks/refs --
 * Per-tick resource deltas use the well-known `usePrevious` pattern: we read
 * a ref holding the previous (tick, resources) snapshot inside a useMemo to
 * derive the net per-tick change. React-hooks v6 flags ref reads during
 * render, but this is the idiomatic way to display a measured delta (gain /
 * loss) for a value that the parent re-renders on every tick. Disabling only
 * here keeps the rule active project-wide. */

import { useEffect, useMemo, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ELEMENT_MAP } from '@/data/elements';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/data/element-helpers';
import { getCraftedMaterial } from '@/data/crafted-materials';
import { Rocket, ArrowUp, ArrowDown } from 'lucide-react';
import type { ElementCategory } from '@/core/types';

const CATEGORY_ORDER: ElementCategory[] = [
  'structural', 'fuel', 'chemical', 'alkali', 'alkaline_earth',
  'halogen', 'nonmetal', 'metal', 'transmetal', 'noble',
  'lanthanide', 'rare', 'transuranic', 'crafted',
];

interface ResourcePanelProps {
  resources: Record<string, number>;
  className?: string;
  /**
   * Block 02 (F7): summary of fuel across all player fleets (sum of fuelStores).
   * Each entry: { fuelType, amount }. Optional — if undefined, the
   * «Топливо флотов» section is not rendered.
   */
  fleetFuelSummary?: Array<{ fuelType: string; amount: number }>;
  /**
   * Audit-fix (remediation): current simulation tick. When provided, the
   * panel computes a per-tick delta for every resource by diffing the
   * `resources` snapshot against the previous render's snapshot and the
   * tick delta. The delta is shown as a coloured +/− badge next to the
   * amount, so the player can instantly see which resources are rising
   * or falling. Optional — omitted in static contexts (no tick).
   */
  tick?: number;
  /**
   * R-26: карта резервов (resourceId → минимум). При заданном значении
   * строка ресурса выводится в формате «количество / резерв»: ниже
   * резерва — красный текст, выше — зелёный. Ресурсы с резервом, но
   * нулевым запасом, включаются в список (0 / резерв, красным).
   */
  reserves?: Record<string, number>;
}

interface PanelEntry {
  id: string;
  name: string;
  symbol: string;
  amount: number;
}

/**
 * Threshold below which a delta is treated as "no change" (avoids
 * rendering +0.0 / -0.0 flicker from floating-point noise).
 */
const DELTA_EPSILON = 0.001;

export function ResourcePanel({ resources, className, fleetFuelSummary, tick, reserves }: ResourcePanelProps) {
  // ── Per-tick delta tracker (usePrevious pattern) ────────────────────────
  // Snapshot of (tick, resources) from the previous committed render. We
  // read it inside useMemo to derive deltas — delta[id] = (cur - prev) /
  // (tick - prevTick). The ref is written in a layout effect after render,
  // so on the NEXT render it holds the value from the render before →
  // delta = how much changed since the last tick(s). Net change captures
  // both gains (extraction / crafting output) and losses (consumption /
  // crafting input) — exactly what the player wants to see.
  const prevRef = useRef<{ tick: number; resources: Record<string, number> } | null>(null);

  const deltas = useMemo<Record<string, number>>(() => {
    const prev = prevRef.current;
    if (!prev || tick == null) return {};
    const dt = tick - prev.tick;
    if (dt <= 0) return {};
    const result: Record<string, number> = {};
    const allKeys = new Set<string>([
      ...Object.keys(resources),
      ...Object.keys(prev.resources),
    ]);
    for (const id of allKeys) {
      const cur = resources[id] ?? 0;
      const pa = prev.resources[id] ?? 0;
      const d = (cur - pa) / dt;
      if (Math.abs(d) > DELTA_EPSILON) result[id] = d;
    }
    return result;
  }, [resources, tick]);

  // Commit the snapshot after render so the next render sees it as prev.
  useEffect(() => {
    prevRef.current = { tick: tick ?? 0, resources: { ...resources } };
  }, [resources, tick]);

  const entries = Object.entries(resources).filter(([, amount]) => amount > 0);

  // R-26: включить ресурсы с резервом, но нулевым запасом — они попадают
  // в список как «0 / резерв» (красным), чтобы дефицит был виден сразу.
  if (reserves) {
    const known = new Set(entries.map(([id]) => id));
    for (const id of Object.keys(reserves)) {
      if (!known.has(id) && (resources[id] ?? 0) <= 0) {
        entries.push([id, 0]);
      }
    }
  }

  // Group by category
  const grouped = new Map<ElementCategory, PanelEntry[]>();
  const uncategorized: PanelEntry[] = [];

  for (const [id, amount] of entries) {
    // 1. Чистый элемент?
    const elDef = ELEMENT_MAP.get(id);
    if (elDef) {
      const category = elDef.category;
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push({ id, name: elDef.name, symbol: elDef.symbol, amount });
      continue;
    }

    // 2. Крафтовый материал? (gap-10, P5)
    const crafted = getCraftedMaterial(id);
    if (crafted) {
      const category: ElementCategory = 'crafted';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category)!.push({ id, name: crafted.name, symbol: crafted.symbol, amount });
      continue;
    }

    // 3. Руда, газ, лёд или неизвестный ресурс — в «Прочие»
    uncategorized.push({ id, name: id.replace(/-/g, ' '), symbol: id, amount });
  }

  // Block 02 (F7): filter fleet fuel summary to non-zero entries
  const fleetFuelEntries = (fleetFuelSummary ?? []).filter(e => e.amount > 0);

  // Has-deltas flag: if we have any delta at all, render the legend once.
  const hasDeltas = Object.keys(deltas).length > 0;

  return (
    <ScrollArea className={className}>
      <div className="space-y-2 pr-2">
        {/* Delta legend — only when deltas are being tracked */}
        {hasDeltas && (
          <div className="flex items-center gap-3 text-[9px] text-slate-500 mb-1">
            <span className="flex items-center gap-0.5">
              <ArrowUp className="size-2.5 text-emerald-400" />
              прирост
            </span>
            <span className="flex items-center gap-0.5">
              <ArrowDown className="size-2.5 text-red-400" />
              расход
            </span>
            <span className="text-slate-600">/ тик</span>
          </div>
        )}

        {/* Block 02 (F7): Fleet fuel summary section (shown first — strategic resource) */}
        {fleetFuelEntries.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-1 flex items-center gap-1">
              <Rocket className="size-3" />
              Топливо флотов
            </div>
            <div className="space-y-0.5">
              {fleetFuelEntries.map((entry) => {
                const d = deltas[entry.fuelType];
                return (
                  <div key={entry.fuelType} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 truncate mr-2">
                      <span className="text-cyan-300 font-mono mr-1">{entry.fuelType.slice(0, 3).toUpperCase()}</span>
                      {entry.fuelType}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {d !== undefined && <DeltaBadge delta={d} />}
                      <span className="font-mono text-cyan-200 whitespace-nowrap">
                        {formatAmount(entry.amount)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <Separator className="my-1.5 bg-cyan-500/15" />
          </div>
        )}

        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat);
          if (!items || items.length === 0) return null;
          return (
            <div key={cat}>
              <div className={`text-xs font-semibold uppercase tracking-wider ${CATEGORY_COLORS[cat]} mb-1`}>
                {CATEGORY_LABELS[cat]}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const d = deltas[item.id];
                  return (
                    <div key={item.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 truncate mr-2">
                        {item.symbol && item.symbol !== item.id ? (
                          <span className="text-slate-200 font-mono mr-1">{item.symbol}</span>
                        ) : null}
                        {item.name}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {d !== undefined && <DeltaBadge delta={d} />}
                        <AmountCell id={item.id} amount={item.amount} reserves={reserves} />
                      </span>
                    </div>
                  );
                })}
              </div>
              <Separator className="my-1.5 bg-white/5" />
            </div>
          );
        })}
        {uncategorized.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Прочие
            </div>
            <div className="space-y-0.5">
              {uncategorized.map((item) => {
                const d = deltas[item.id];
                return (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 truncate mr-2">{item.name}</span>
                    <span className="flex items-center gap-1.5">
                      {d !== undefined && <DeltaBadge delta={d} />}
                      <AmountCell id={item.id} amount={item.amount} reserves={reserves} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * R-26: AmountCell — количество с опциональным резервом.
 * Без резерва: «123.4» (нейтральный white).
 * С резервом: «количество / резерв» — красным, если количество ниже
 * резерва, зелёным — если резерв выполнен.
 */
function AmountCell({ id, amount, reserves }: { id: string; amount: number; reserves?: Record<string, number> }) {
  const reserve = reserves?.[id];
  if (reserve === undefined) {
    return <span className="font-mono text-white/95 whitespace-nowrap">{formatAmount(amount)}</span>;
  }
  const below = amount < reserve;
  return (
    <span
      className={`font-mono whitespace-nowrap ${below ? 'text-red-400' : 'text-emerald-400'}`}
      title={below ? 'Ниже резерва — расход заблокирован правилами склада' : 'Резерв выполнен'}
    >
      {formatAmount(amount)} / {formatAmount(reserve)}
    </span>
  );
}

/**
 * DeltaBadge — small inline badge showing per-tick change.
 * Green ▲ for gain, red ▼ for loss. Shows the absolute value with 1 decimal.
 */
function DeltaBadge({ delta }: { delta: number }) {
  const isGain = delta > 0;
  const color = isGain ? 'text-emerald-400' : 'text-red-400';
  const Icon = isGain ? ArrowUp : ArrowDown;
  const sign = isGain ? '+' : '−';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-mono ${color}`} title={`${isGain ? '+' : ''}${delta.toFixed(3)} за тик`}>
      <Icon className="size-2.5" />
      {sign}{Math.abs(delta).toFixed(delta >= 100 ? 0 : 1)}
    </span>
  );
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}
