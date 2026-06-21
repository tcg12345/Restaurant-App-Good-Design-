import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Secondary muted meta line under the cuisine line — location, distance, time,
 * etc. Data-agnostic: it just lays out whatever strings it's handed, joined by
 * the dotted separator. The *resolution* of those strings (Beli-style label,
 * haversine distance) stays in the caller / lifted hooks.
 */
interface MetaRowProps {
  items?: Array<string | false | null | undefined>;
  /** Optional leading icon (e.g. a MapPin). */
  icon?: React.ReactNode;
  className?: string;
}

export const MetaRow: React.FC<MetaRowProps> = ({ items = [], icon, className }) => {
  const parts = items.filter((x): x is string => !!x);
  if (parts.length === 0) return null;
  return (
    <p className={cn('flex items-center gap-1 text-[12.5px] font-medium text-on-surface/55', className)}>
      {icon}
      <span className="truncate">
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="mx-1.5 text-on-surface/25">·</span>}
            {part}
          </React.Fragment>
        ))}
      </span>
    </p>
  );
};
