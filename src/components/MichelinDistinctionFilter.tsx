import { Star, Soup, Utensils } from 'lucide-react';
import { cn } from '../lib/utils';
import { MICHELIN_DISTINCTIONS, type MichelinDistinction } from '../lib/michelin';

interface MichelinDistinctionFilterProps {
  /** Currently-selected distinction keys (multi-select, OR semantics). */
  selected: string[];
  /** Toggle a single distinction on/off. */
  onToggle: (value: MichelinDistinction) => void;
  className?: string;
}

// Visual for a single option: filled stars for the star tiers (1–3), a
// bib/soup glyph for Bib Gourmand, a utensils glyph for Selected. Colour and
// size come from the `fs-michelin-*` CSS so it matches the reference exactly.
function OptionMark({ value }: { value: MichelinDistinction }) {
  if (value === 'Bib Gourmand') {
    return <Soup className="fs-michelin-glyph" />;
  }
  if (value === 'Selected') {
    return <Utensils className="fs-michelin-glyph" />;
  }
  const n = value === '3 Stars' ? 3 : value === '2 Stars' ? 2 : 1;
  return (
    <span className="fs-michelin-stars">
      {Array.from({ length: n }).map((_, i) => (
        <Star key={i} />
      ))}
    </span>
  );
}

/**
 * Multi-select control for filtering restaurants by Michelin distinction
 * (3 Stars / 2 Stars / 1 Star / Bib Gourmand / Selected). Shared by the
 * Pantry, Discover, and public-profile filter sheets so the control looks and
 * behaves the same everywhere. Renders as a two-column card grid matching the
 * Location page's reference filter — the wide "Bib Gourmand" / "Selected"
 * labels get room to breathe, and the odd 5th card spans the full width.
 */
export function MichelinDistinctionFilter({ selected, onToggle, className }: MichelinDistinctionFilterProps) {
  return (
    <div className={cn('fs-michelin-grid', className)}>
      {MICHELIN_DISTINCTIONS.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={active}
            className={cn('fs-michelin-card', active && 'is-active')}
          >
            <span className="fs-michelin-mark">
              <OptionMark value={opt} />
            </span>
            <span className="fs-michelin-label">{opt}</span>
            <span className={cn('fs-michelin-check', active && 'is-on')} />
          </button>
        );
      })}
    </div>
  );
}
