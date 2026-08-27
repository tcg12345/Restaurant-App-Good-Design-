import React from 'react';
import { FilterOptionList } from 'gourmet-canvas';

/**
 * The body of a filter's own sub-page: a search field on a hairline, then one
 * `FilterCheckRow` per option. It owns exactly one piece of state — the
 * search query — and filters `options` by a case-insensitive substring of
 * `label`. Selection is the caller's: pass `selected` and `onToggle`.
 *
 * `options` are `{ value, label, meta? }`. `meta` is the small grey line
 * under the label and is where the app puts evidence — "18 places" — so a
 * filter can be chosen on what it would actually keep.
 *
 * `searchable` (default true) shows the field; `searchPlaceholder` labels it.
 * A typed query gets a round clear button on the right, and a query that
 * matches nothing swaps the rows for "Nothing matches that."
 *
 * `multiple` is accepted but does NOT change what this renders. In
 * `FilterDrillSection` it only picks the sub-page subtitle ("Pick as many as
 * you like" vs "One choice"); enforcing single-select is the caller's job
 * inside `onToggle`.
 *
 * In the product this is portalled into the sliding sub-page layer by
 * `FilterDrillRow`. Rendered directly, as here, it is the same markup — so
 * this is where to look at the page body itself.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** Cuisines with counts, three on. The counts are what `FilterDrillSection`
 *  generates from its `counts` map, formatted into `meta`. */
export const Cuisines = () => {
  const [selected, setSelected] = React.useState(['Italian', 'Japanese', 'Korean']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterOptionList
        options={[
          { value: 'Italian', label: 'Italian', meta: '24 places' },
          { value: 'Japanese', label: 'Japanese', meta: '18 places' },
          { value: 'Korean', label: 'Korean', meta: '9 places' },
          { value: 'Mexican', label: 'Mexican', meta: '7 places' },
          { value: 'Thai', label: 'Thai', meta: '5 places' },
          { value: 'Vietnamese', label: 'Vietnamese', meta: '1 place' },
        ]}
        selected={selected}
        onToggle={toggle}
        searchPlaceholder="Search cuisines"
      />
    </div>
  );
};

/** Cities, one on. Same page, longer labels — the row label is 15px/700 and
 *  wraps rather than truncating. */
export const Cities = () => {
  const [selected, setSelected] = React.useState(['New York City']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterOptionList
        options={[
          { value: 'New York City', label: 'New York City', meta: '31 places' },
          { value: 'San Francisco', label: 'San Francisco', meta: '12 places' },
          { value: 'Los Angeles', label: 'Los Angeles', meta: '8 places' },
          { value: 'Tokyo', label: 'Tokyo', meta: '6 places' },
          { value: 'Mexico City', label: 'Mexico City', meta: '3 places' },
        ]}
        selected={selected}
        onToggle={toggle}
        searchPlaceholder="Search locations"
      />
    </div>
  );
};

/** `searchable={false}` — a fixed, short, ORDERED list where a search field
 *  would be noise. The Michelin distinctions are the app's case, and their
 *  `meta` is the Guide's own definition of each tier. */
export const NoSearchBox = () => {
  const [selected, setSelected] = React.useState(['2 Stars']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterOptionList
        searchable={false}
        options={[
          { value: '3 Stars', label: '3 Stars', meta: 'Worth a special journey' },
          { value: '2 Stars', label: '2 Stars', meta: 'Worth a detour' },
          { value: '1 Star', label: '1 Star', meta: 'High-quality cooking' },
          { value: 'Bib Gourmand', label: 'Bib Gourmand', meta: 'Good quality, good value' },
          { value: 'Selected', label: 'Selected', meta: 'In the Guide' },
        ]}
        selected={selected}
        onToggle={toggle}
      />
    </div>
  );
};

/** No `meta` on any option and nothing selected — the plainest form the page
 *  takes, and the one to avoid when a count is available. */
export const WithoutMeta = () => {
  const [selected, setSelected] = React.useState<string[]>([]);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterOptionList
        options={[
          { value: 'Nadia Rahman', label: 'Nadia Rahman' },
          { value: 'Marcus Vale', label: 'Marcus Vale' },
          { value: 'Priya Anand', label: 'Priya Anand' },
          { value: 'Theo Brandt', label: 'Theo Brandt' },
        ]}
        selected={selected}
        onToggle={toggle}
        searchPlaceholder="Search friends"
      />
    </div>
  );
};
