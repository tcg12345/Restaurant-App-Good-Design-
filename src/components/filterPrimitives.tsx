import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ChevronRight, Search, Check, X, ArrowUpDown, Clock3, MapPin, Utensils, Award, Users, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { MEAL_KEYS, MEAL_LABELS, type HoursFilter, type MealKey } from '../lib/hours';

/** The window each meal actually means, said out loud on the Hours page —
 *  "Lunch" is a promise the filter should be willing to explain. */
const MEAL_WINDOW_LABELS: Record<MealKey, string> = {
  breakfast: 'Open in the morning',
  lunch: 'Open around midday',
  dinner: 'Open in the evening',
};
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
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, sm, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={!!active}
    className={cn('fs-pill', sm && 'is-sm', active && 'is-active')}
  >
    {children}
  </button>
);

/* ── Segmented control (price, total-time) ── */
export const Segment: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="fs-segment">{children}</div>
);

export const SegmentItem: React.FC<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button type="button" onClick={onClick} aria-pressed={!!active} className={cn('fs-segment-item', active && 'is-active')}>
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
  /** The rule, shown under the sub-page's title. */
  subtitle?: string;
  /** Clears this filter from the sub-page's own header. */
  onClear?: () => void;
}> = ({ id, label, value, isSet, subtitle, onClear, children }) => {
  const nav = useContext(FilterSheetNavContext);
  const clearRef = useRef(onClear);
  clearRef.current = onClear;
  const clear = useCallback(() => clearRef.current?.(), []);
  const canClear = !!onClear;
  useEffect(() => {
    if (nav.activeId === id) nav.openPage(id, label, { subtitle, onClear: canClear ? clear : undefined });
  }, [nav.activeId, nav.openPage, id, label, subtitle, canClear, clear]);
  const Icon = id === 'sort' ? ArrowUpDown : id === 'hours' ? Clock3 : /city|location/.test(id) ? MapPin
    : /cuisine/.test(id) ? Utensils : /michelin/.test(id) ? Award : /friend/.test(id) ? Users : SlidersHorizontal;
  return (
    <>
      <button type="button" className="fs-drill-row" data-filter-page={id} onClick={() => nav.openPage(id, label, { subtitle, onClear })}>
        <Icon size={19} strokeWidth={1.7} className="fs-drill-icon" aria-hidden />
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
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter((o) => normalize(o.label).includes(q));
  }, [options, query]);
  return (
    <div className="fs-optionlist">
      {searchable && (
        <div className="fs-page-search">
          <Search />
          <input
            type="text"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="fs-page-search-clear" aria-label="Clear search">
              <X size={11} strokeWidth={2.6} />
            </button>
          )}
        </div>
      )}
      {multiple && selected.length > 0 && (
        <div className="fs-selections" aria-label="Selected filters">
          {selected.map(value => <button type="button" key={value} onClick={() => onToggle(value)}
            aria-label={`Remove ${options.find(o => o.value === value)?.label ?? value}`}>
            {options.find(o => o.value === value)?.label ?? value}<X size={13} />
          </button>)}
        </div>
      )}
      <div className="fs-optionlist-rows">
        {filtered.length === 0 ? (
          <div className="fs-page-empty">Nothing matches that.</div>
        ) : (
          filtered.map((o) => (
            <FilterCheckRow
              key={o.value}
              label={o.label}
              meta={o.meta}
              active={selected.includes(o.value)}
              onToggle={() => onToggle(o.value)}
            />
          ))
        )}
      </div>
    </div>
  );
};

/* One row on a filter's own page: what it is, how many of your places it
   would keep, and whether it is on. The old row was a 14px label beside a
   small square checkbox on a rounded hover slab — a menu item. These are
   the page's content, so they get the page's type and divide on hairlines
   like every other list in the app. */
export const FilterCheckRow: React.FC<{
  label: string;
  meta?: string;
  active: boolean;
  onToggle: () => void;
  /** Optional glyph before the label (Michelin's stars / bib). */
  leading?: React.ReactNode;
}> = ({ label, meta, active, onToggle, leading }) => (
  <button type="button" className="fs-page-row" onClick={onToggle} aria-pressed={active}>
    {leading}
    <span className="fs-page-row-text">
      <span className={cn('fs-page-row-label', active && 'is-on')}>{label}</span>
      {meta && <span className="fs-page-row-meta">{meta}</span>}
    </span>
    <span className={cn('fs-page-check', active && 'is-on')}>
      <Check size={13} strokeWidth={2.8} />
    </span>
  </button>
);

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
  /** How many of your places each option would keep, by option value. */
  counts?: Record<string, number>;
  /** Noun for the count line — "place", "recipe". */
  countNoun?: string;
}> = ({ id, label, options, selected, onToggle, multiple = true, searchable = true, searchPlaceholder = 'Search', emptyLabel = 'Any', counts, countNoun = 'place' }) => {
  const clearSelection = useClearFilterSelection(selected, onToggle);
  return <FilterDrillRow
    id={id}
    label={label}
    value={drillSummary(options, selected, emptyLabel)}
    isSet={selected.length > 0}
    subtitle={multiple ? 'Pick as many as you like' : 'One choice'}
    onClear={selected.length > 0 ? clearSelection : undefined}
  >
    <FilterOptionList
      options={counts
        ? options.map((o) => {
            const n = counts[o.value];
            return n == null ? o : { ...o, meta: `${n} ${countNoun}${n === 1 ? '' : 's'}` };
          })
        : options}
      selected={selected}
      onToggle={onToggle}
      multiple={multiple}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
    />
  </FilterDrillRow>;
};

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
    <FilterDrillRow
      id="hours"
      label={label}
      value={hoursFilterSummary(value)}
      isSet={isSet}
      subtitle="Pick as many as you like"
      onClear={isSet ? () => onChange({ openNow: false, meals: [] }) : undefined}
    >
      {/* Rows, like every other filter page — these used to be a row of
          pills under a sentence, which made Hours the one page in the flow
          that looked like a different app. */}
      <div className="fs-optionlist-rows">
        <FilterCheckRow
          label="Open now"
          meta="Serving at this moment"
          active={value.openNow}
          onToggle={() => onChange({ ...value, openNow: !value.openNow })}
        />
        {MEAL_KEYS.map((m) => (
          <FilterCheckRow
            key={m}
            label={MEAL_LABELS[m]}
            meta={MEAL_WINDOW_LABELS[m]}
            active={value.meals.includes(m)}
            onToggle={() => toggleMealKey(m)}
          />
        ))}
      </div>
    </FilterDrillRow>
  );
};

/* ── Option shape shared by FilterOptionList / FilterDrillSection ── */
export interface DropdownOption {
  value: string;
  label: string;
  /** How many of your places this option would keep — shown under the
   *  label so a filter can be chosen on evidence rather than on hope. */
  meta?: string;
}

/** Callers include both functional setters and callbacks derived from current
 * selection props. Commit each removal before reading the next callback so a
 * batched clear cannot reintroduce an earlier selection. Only used on Clear. */
export function useClearFilterSelection<T extends string>(selected: string[], onToggle: (value: T) => void) {
  const latest = useRef(onToggle);
  latest.current = onToggle;
  return () => {
    for (const value of selected) flushSync(() => latest.current(value as T));
  };
}

/** A compact summary opens a focused sort list. Accepts the same PillRow or
 * Segment choices as the inline version, preserving each caller's sort logic. */
export function FilterSortSection({ children }: { children: React.ReactNode }) {
  const nav = useContext(FilterSheetNavContext);
  const choices: Array<{ active?: boolean; onClick: () => void; children: React.ReactNode }> = [];
  const collect = (nodes: React.ReactNode) => React.Children.forEach(nodes, node => {
    if (!React.isValidElement<{ active?: boolean; onClick: () => void; children: React.ReactNode }>(node)) return;
    if (node.type === Pill || node.type === SegmentItem) choices.push(node.props);
    else if (node.type === PillRow || node.type === Segment || node.type === React.Fragment) collect(node.props.children);
  });
  collect(children);
  const active = choices.find(choice => choice.active);
  return <div className="fs-sort-section"><FilterDrillRow id="sort" label="Sort by"
    value={typeof active?.children === 'string' ? active.children : 'Choose'}>
    <div className="fs-sort-options">{choices.map((choice, i) => <button key={i} type="button"
      className="fs-page-row" aria-pressed={!!choice.active}
      onClick={() => { choice.onClick(); nav.closePage(); }}>
      <span className="fs-page-row-text"><span className="fs-page-row-label">{choice.children}</span></span>
      <span className={cn('fs-page-check', choice.active && 'is-on')}><Check size={15} /></span>
    </button>)}</div>
  </FilterDrillRow></div>;
}
