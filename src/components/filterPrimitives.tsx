import React, { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Search, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { MEAL_KEYS, MEAL_LABELS, type HoursFilter, type MealKey } from '../lib/hours';
import { FilterSheetNavContext } from './FilterSheet';

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

/* ── Segmented control (price, total-time) ── */
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
  // Keep at least one step between the thumbs. Letting them MEET deadlocked
  // the slider: only the thumbs are hit-testable and the max input renders
  // on top, so at [10,10] every grab landed on the max thumb, whose clamp
  // (never below the min value) pinned it at 10 forever — only Reset
  // recovered. A pointer-proximity z-swap can't fix this (hit-testing
  // happens before any handler runs, and touch has no hover), so the gap
  // is enforced in both clamps instead.
  const minCeil = Math.max(min, value[1] - step);
  const maxFloor = Math.min(max, value[0] + step);
  // Legacy pinned-together states (a persisted [10,10] from before the gap
  // existed) still need the RIGHT thumb grabbable: when the pair sits in
  // the upper half, raise the min input above the max one so the grab
  // lands on the thumb that can actually move away.
  const minOnTop = value[0] > (min + max) / 2;
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
        style={minOnTop ? { zIndex: 2 } : undefined}
        onChange={(e) => onChange([Math.min(Number(e.target.value), minCeil), value[1]])}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value[1]}
        aria-label={ariaLabelMax}
        onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), maxFloor)])}
      />
    </div>
  );
};

/* ── Drill rows (Beli-style sub-page filters) ──
   Option-list filters don't expand inline on the sheet: they render as a
   settings-style row (label · current value · chevron) that slides a
   dedicated sub-page in over the sheet body. The page mechanism lives in
   FilterSheet; rows reach it through FilterSheetNavContext and PORTAL
   their content into the sliding layer so it stays live as the caller's
   selection state changes. */
export const FilterDrillRow: React.FC<{
  /** Stable id for this filter's sub-page (unique within the sheet). */
  id: string;
  label: string;
  /** Current-selection summary shown on the right ("Italian +2"). */
  value?: string;
  isSet?: boolean;
  /** The sub-page content. */
  children: React.ReactNode;
}> = ({ id, label, value, isSet, children }) => {
  const nav = useContext(FilterSheetNavContext);
  return (
    <>
      <button type="button" className="fs-drill-row" onClick={() => nav.openPage(id, label)}>
        <span className="fs-drill-label">{label}</span>
        <span className={cn('fs-drill-value', isSet && 'is-set')}>{value || 'Any'}</span>
        <ChevronRight className="fs-drill-chev" />
      </button>
      {nav.activeId === id && nav.container
        ? createPortal(<div className="fs-subpage-content">{children}</div>, nav.container)
        : null}
    </>
  );
};

/* ── Full-page option list (the sub-page body for choose-from-a-list
   filters) — search box + check rows, the drill-in successor to the old
   inline FilterDropdown panel. */
export const FilterOptionList: React.FC<{
  options: DropdownOption[];
  selected: string[];
  onToggle: (value: string) => void;
  multiple?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}> = ({ options, selected, onToggle, multiple = true, searchable = true, searchPlaceholder = 'Search' }) => {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);
  return (
    <div className="fs-optionlist">
      {searchable && (
        <div className="fs-dropdown-search is-page">
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
      <div className="fs-optionlist-rows">
        {filtered.length === 0 ? (
          <div className="fs-dropdown-empty">No matches</div>
        ) : (
          filtered.map((o) => {
            const active = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className={cn('fs-dropdown-row is-page', active && 'is-active')}
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
  );
};

/** Summary text for a drill row: "Any" / the one label / "First +N". */
export function drillSummary(options: DropdownOption[], selected: string[], empty = 'Any'): string {
  if (selected.length === 0) return empty;
  const first = options.find((o) => o.value === selected[0]);
  const firstLabel = first?.label ?? selected[0];
  if (selected.length === 1) return firstLabel;
  return `${firstLabel} +${selected.length - 1}`;
}

/* ── Choose-from-a-list filter section as a drill row ──
   The one-liner most sheets use for cuisine / city / friends: a drill row
   whose sub-page is a searchable FilterOptionList. */
export const FilterDrillSection: React.FC<{
  id: string;
  label: string;
  options: DropdownOption[];
  selected: string[];
  onToggle: (value: string) => void;
  multiple?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Summary when nothing is selected. */
  emptyLabel?: string;
}> = ({ id, label, options, selected, onToggle, multiple = true, searchable = true, searchPlaceholder = 'Search', emptyLabel = 'Any' }) => (
  <FilterDrillRow
    id={id}
    label={label}
    value={drillSummary(options, selected, emptyLabel)}
    isSet={selected.length > 0}
  >
    <FilterOptionList
      options={options}
      selected={selected}
      onToggle={onToggle}
      multiple={multiple}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
    />
  </FilterDrillRow>
);

/* ── Hours / meal-time filter ──
   A drop-in "Hours" drill row for any filter sheet: its sub-page holds
   Open now + breakfast / lunch / dinner toggle pills. The caller owns the
   HoursFilter value and a setter; meal windows + matching live in
   lib/hours.ts. */
export function hoursFilterSummary(value: HoursFilter): string {
  const parts: string[] = [];
  if (value.openNow) parts.push('Open now');
  for (const m of value.meals) parts.push(MEAL_LABELS[m]);
  if (parts.length === 0) return 'Any';
  if (parts.length <= 2) return parts.join(', ');
  return `${parts[0]} +${parts.length - 1}`;
}

export const HoursFilterSection: React.FC<{
  value: HoursFilter;
  onChange: (next: HoursFilter) => void;
  label?: string;
}> = ({ value, onChange, label = 'Hours' }) => {
  const toggleMealKey = (m: MealKey) =>
    onChange({ ...value, meals: value.meals.includes(m) ? value.meals.filter((x) => x !== m) : [...value.meals, m] });
  const isSet = value.openNow || value.meals.length > 0;
  return (
    <FilterDrillRow id="hours" label={label} value={hoursFilterSummary(value)} isSet={isSet}>
      <p className="fs-sub" style={{ marginTop: 10 }}>Show places open for a meal.</p>
      <PillRow>
        <Pill active={value.openNow} onClick={() => onChange({ ...value, openNow: !value.openNow })}>
          Open now
        </Pill>
        {MEAL_KEYS.map((m) => (
          <Pill key={m} active={value.meals.includes(m)} onClick={() => toggleMealKey(m)}>
            {MEAL_LABELS[m]}
          </Pill>
        ))}
      </PillRow>
    </FilterDrillRow>
  );
};

/* ── Option shape shared by FilterOptionList / FilterDrillSection ── */
export interface DropdownOption {
  value: string;
  label: string;
}
