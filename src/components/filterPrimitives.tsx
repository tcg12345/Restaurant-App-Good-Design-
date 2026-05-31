import React, { useMemo, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { cn } from '../lib/utils';

/* Shared presentational primitives for filter sheets. They render the
   `fs-*` classes from filterSheet.css so every filter popup matches the
   Location page's reference look. These hold no filter logic — callers own
   the state and pass values/handlers in. */

/* ── Section wrapper: uppercase label (+ optional right value) + blurb ── */
export const FilterSection: React.FC<{
  label: React.ReactNode;
  value?: React.ReactNode;
  isSet?: boolean;
  sub?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, value, isSet, sub, children }) => (
  <section className="fs-section">
    {value !== undefined ? (
      <div className="fs-label-row">
        <div className="fs-label">{label}</div>
        <div className={cn('fs-value', isSet && 'is-set')}>{value}</div>
      </div>
    ) : (
      <div className="fs-label">{label}</div>
    )}
    {sub && <p className="fs-sub">{sub}</p>}
    {children}
  </section>
);

/* ── Pills (sort, difficulty, list chips) ── */
export const PillRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="fs-pill-row">{children}</div>
);

export const Pill: React.FC<{
  active?: boolean;
  sm?: boolean;
  tone?: 'teal';
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, sm, tone, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn('fs-pill', sm && 'is-sm', tone === 'teal' && 'is-teal', active && 'is-active')}
  >
    {children}
  </button>
);

/* ── Segmented control (price, total-time, hotel star/price) ── */
export const Segment: React.FC<{ tone?: 'teal'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={cn('fs-segment', tone === 'teal' && 'is-teal')}>{children}</div>
);

export const SegmentItem: React.FC<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button type="button" onClick={onClick} className={cn('fs-segment-item', active && 'is-active')}>
    {children}
  </button>
);

/* ── Dual-thumb range slider (score 0–10) ── */
export const RangeSlider: React.FC<{
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  ariaLabelMin?: string;
  ariaLabelMax?: string;
}> = ({ min, max, step = 1, value, onChange, ariaLabelMin = 'Minimum', ariaLabelMax = 'Maximum' }) => {
  const span = max - min || 1;
  const left = ((value[0] - min) / span) * 100;
  const right = (1 - (value[1] - min) / span) * 100;
  return (
    <div className="fs-range">
      <div className="fs-range__track" />
      <div className="fs-range__fill" style={{ left: `${left}%`, right: `${right}%` }} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[0]}
        aria-label={ariaLabelMin}
        onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[1]}
        aria-label={ariaLabelMax}
        onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])}
      />
    </div>
  );
};

/* ── Searchable dropdown (cuisine / city / friends) ──
   Single source of truth for the reference's collapsible chooser. The
   caller supplies options + the selected list + a toggle handler; this
   component owns only the open/search UI state. `multiple` switches between
   a square checkbox (multi) and a round dot (single-select). */
export interface DropdownOption {
  value: string;
  label: string;
}

export const FilterDropdown: React.FC<{
  options: DropdownOption[];
  selected: string[];
  onToggle: (value: string) => void;
  multiple?: boolean;
  searchable?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}> = ({
  options,
  selected,
  onToggle,
  multiple = true,
  searchable = true,
  placeholder = 'All',
  searchPlaceholder = 'Search',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const triggerLabel = (() => {
    if (selected.length === 0) return placeholder;
    const first = options.find((o) => o.value === selected[0]);
    const firstLabel = first?.label ?? selected[0];
    if (selected.length === 1) return firstLabel;
    return `${firstLabel} + ${selected.length - 1} more`;
  })();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn('fs-dropdown-trigger', open && 'is-open', selected.length > 0 && 'is-set')}
        aria-expanded={open}
      >
        <span>{triggerLabel}</span>
        <ChevronDown className={cn('fs-dropdown-chev', open && 'is-open')} />
      </button>
      {open && (
        <div className="fs-dropdown-panel">
          {searchable && (
            <div className="fs-dropdown-search">
              <Search />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
          )}
          <div className="fs-dropdown-list">
            {filtered.length === 0 ? (
              <div className="fs-dropdown-empty">No matches</div>
            ) : (
              filtered.map((o) => {
                const active = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={cn('fs-dropdown-row', active && 'is-active')}
                    onClick={() => onToggle(o.value)}
                  >
                    <span className={cn('fs-checkbox', !multiple && 'is-radio', active && 'is-on')}>
                      {active && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span>{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
