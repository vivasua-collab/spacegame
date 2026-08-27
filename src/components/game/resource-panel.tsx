'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ELEMENT_MAP } from '@/data/elements';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/data/element-helpers';
import { CRAFTED_MATERIALS, getCraftedMaterial } from '@/data/crafted-materials';
import { Rocket } from 'lucide-react';
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
}

interface PanelEntry {
  id: string;
  name: string;
  symbol: string;
  amount: number;
}

export function ResourcePanel({ resources, className, fleetFuelSummary }: ResourcePanelProps) {
  const entries = Object.entries(resources).filter(([, amount]) => amount > 0);

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

  return (
    <ScrollArea className={className}>
      <div className="space-y-2 pr-2">
        {/* Block 02 (F7): Fleet fuel summary section (shown first — strategic resource) */}
        {fleetFuelEntries.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300 mb-1 flex items-center gap-1">
              <Rocket className="size-3" />
              Топливо флотов
            </div>
            <div className="space-y-0.5">
              {fleetFuelEntries.map((entry) => (
                <div key={entry.fuelType} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate mr-2">
                    <span className="text-cyan-400/70 font-mono mr-1">{entry.fuelType.slice(0, 3).toUpperCase()}</span>
                    {entry.fuelType}
                  </span>
                  <span className="font-mono text-cyan-200 whitespace-nowrap">
                    {formatAmount(entry.amount)}
                  </span>
                </div>
              ))}
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
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate mr-2">
                      {item.symbol && item.symbol !== item.id ? (
                        <span className="text-foreground/70 font-mono mr-1">{item.symbol}</span>
                      ) : null}
                      {item.name}
                    </span>
                    <span className="font-mono text-foreground/90 whitespace-nowrap">
                      {formatAmount(item.amount)}
                    </span>
                  </div>
                ))}
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
              {uncategorized.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground truncate mr-2">{item.name}</span>
                  <span className="font-mono text-foreground/90 whitespace-nowrap">
                    {formatAmount(item.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}
