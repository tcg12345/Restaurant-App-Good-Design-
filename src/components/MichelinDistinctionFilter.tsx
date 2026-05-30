import { Star, Soup } from 'lucide-react';
import { cn } from '../lib/utils';
import { MICHELIN_DISTINCTIONS, type MichelinDistinction } from '../lib/michelin';

const MICHELIN_RED = '#a2191f';

interface MichelinDistinctionFilterProps {
  /** Currently-selected distinction keys (multi-select, OR semantics). */
  selected: string[];
  /** Toggle a single distinction on/off. */
  onToggle: (value: MichelinDistinction) => void;
  className?: string;
}

// Visual for a single option: filled stars for the star tiers, a bib/soup glyph
// for Bib Gourmand.
function OptionMark({ value }: { value: MichelinDistinction }) {
  if (value === 'Bib Gourmand') {
    return <Soup size={13} color={MICHELIN_RED} strokeWidth={2.2} className="shrink-0" />;
  }
  const n = value === '3 Stars' ? 3 : value === '2 Stars' ? 2 : 1;
  return (
    <span className="inline-flex items-center shrink-0">
      {Array.from({ length: n }).map((_, i) => (
        <Star key={i} size={12} fill={MICHELIN_RED} color={MICHELIN_RED} strokeWidth={0} />
      ))}
    </span>
  );
}

/**
 * Multi-select control for filtering restaurants by Michelin distinction
 * (3 Stars / 2 Stars / 1 Star / Bib Gourmand). Shared by the Pantry, Location,
 * Map, and public-profile filter UIs so the control looks and behaves the same
 * everywhere. Renders as a row of toggle pills.
 */
export function MichelinDistinctionFilter({ selected, onToggle, className }: MichelinDistinctionFilterProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {MICHELIN_DISTINCTIONS.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
              active
                ? 'border-transparent text-white'
                : 'border-on-surface/15 text-on-surface/70 hover:border-on-surface/30',
            )}
            style={active ? { backgroundColor: MICHELIN_RED } : undefined}
          >
            {!active && <OptionMark value={opt} />}
            <span>{opt}</span>
          </button>
        );
      })}
    </div>
  );
}
