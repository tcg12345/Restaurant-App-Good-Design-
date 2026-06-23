import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

interface PalateItem {
  name: string;
  count: number;
}

interface Props {
  items: PalateItem[];
  activeName?: string | null;
  onSelect?: (name: string) => void;
}

/**
 * "Palate" — the editorial cuisine-breakdown strip shown in the desktop
 * profile sidebar. Each cuisine the user has rated renders as a horizontal
 * bar proportional to its count (relative to the most-rated cuisine), with
 * a soft grow-in animation. Clicking a bar filters the restaurant list to
 * that cuisine, so it doubles as a quick navigation control.
 */
export const ProfilePalate: React.FC<Props> = ({ items, activeName, onSelect }) => {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <div>
      <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[var(--color-ink-4)] mb-4">
        Palate
      </div>
      <div className="flex flex-col gap-3.5">
        {items.map((item, i) => {
          const active = activeName === item.name;
          const pct = Math.round((item.count / max) * 100);
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onSelect?.(item.name)}
              className="group text-left w-full cursor-pointer"
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <span
                  className={cn(
                    'text-[14px] font-semibold transition-colors',
                    active ? 'text-primary' : 'text-on-surface group-hover:text-primary',
                  )}
                >
                  {item.name}
                </span>
                <span className="text-[12px] font-bold tabular-nums text-[var(--color-ink-4)]">
                  {item.count}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-on-surface/[0.06] overflow-hidden">
                <motion.div
                  className={cn(
                    'h-full rounded-full transition-colors',
                    active ? 'bg-primary' : 'bg-primary/80 group-hover:bg-primary',
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
