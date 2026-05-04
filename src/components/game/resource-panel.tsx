'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ELEMENT_MAP } from '@/data/elements';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/data/element-helpers';
import type { ElementCategory } from '@/core/types';

const CATEGORY_ORDER: ElementCategory[] = [
  'structural', 'fuel', 'chemical', 'alkali', 'alkaline_earth',
  'halogen', 'nonmetal', 'metal', 'transmetal', 'noble',
  'lanthanide', 'rare',
];

interface ResourcePanelProps {
  resources: Record<string, number>;
  className?: string;
}

export function ResourcePanel({ resources, className }: ResourcePanelProps) {
  const entries = Object.entries(resources).filter(([, amount]) => amount > 0);

  // Group by category
  const grouped = new Map<ElementCategory, { id: string; name: string; symbol: string; amount: number }[]>();
  for (const [id, amount] of entries) {
    const elDef = ELEMENT_MAP.get(id);
    const category = elDef?.category ?? 'structural';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push({
      id,
      name: elDef?.name ?? id,
      symbol: elDef?.symbol ?? id,
      amount,
    });
  }

  // Also add entries that might be ores or crafted materials not in ELEMENT_MAP
  const uncategorized: { id: string; name: string; amount: number }[] = [];
  for (const [id, amount] of entries) {
    if (!ELEMENT_MAP.has(id)) {
      uncategorized.push({ id, name: id.replace(/-/g, ' '), amount });
    }
  }

  return (
    <ScrollArea className={className}>
      <div className="space-y-2 pr-2">
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
