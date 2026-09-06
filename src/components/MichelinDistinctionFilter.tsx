import { Star, Soup, Utensils } from 'lucide-react';
import { cn } from '../lib/utils';
import { MICHELIN_DISTINCTIONS, type MichelinDistinction } from '../lib/michelin';
import { FilterDrillRow, FilterCheckRow, useClearFilterSelection } from './filterPrimitives';

/** What the Guide's own words mean, said once on the page rather than
 *  assumed. */
const MICHELIN_META: Record<string, string> = {
  '3 Stars': 'Worth a special journey',
  '2 Stars': 'Worth a detour',
  '1 Star': 'High-quality cooking',
  'Bib Gourmand': 'Good quality, good value',
  'Selected': 'In the Guide',
};

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

/**
 * The Michelin filter as a FilterSheet drill row: "Michelin · <summary> ›"
 * pushing a sub-page with the distinction card grid. Drop-in replacement
 * for the old inline `<FilterSection label="Michelin">…</FilterSection>`
 * blocks so every sheet gets the same Beli-style page navigation.
 */
export function MichelinDrillSection({ selected, onToggle }: Omit<MichelinDistinctionFilterProps, 'className'>) {
  const clearSelection = useClearFilterSelection(selected, onToggle);
  const value = selected.length === 0
    ? 'Any'
    : selected.length === 1
      ? selected[0]
      : `${selected[0]} +${selected.length - 1}`;
  return (
    <FilterDrillRow
      id="michelin"
      label="Michelin"
      value={value}
      isSet={selected.length > 0}
      subtitle="Pick as many as you like"
      onClear={selected.length > 0 ? clearSelection : undefined}
    >
      {/* Rows, not a two-column card grid. Every other page in this flow
          is a list of rows with a check on the right; Michelin was the one
          that made you re-learn where the control was. The glyph that made
          the cards worth having stays, on the left of its own row. */}
      <div className="fs-optionlist-rows">
        {MICHELIN_DISTINCTIONS.map((opt) => (
          <FilterCheckRow
            key={opt}
            label={opt}
            meta={MICHELIN_META[opt] || undefined}
            active={selected.includes(opt)}
            onToggle={() => onToggle(opt)}
            leading={<span className="fs-michelin-mark"><OptionMark value={opt} /></span>}
          />
        ))}
      </div>
    </FilterDrillRow>
  );
}
