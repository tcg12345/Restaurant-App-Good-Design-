import React from 'react';
import { FilterCheckRow } from 'goodeats';
import { Star, Soup, Utensils } from 'lucide-react';

/**
 * One row on a filter's own sub-page. It is deliberately page content, not a
 * menu item: a 15px/700 tightly-tracked label, an optional 12px grey `meta`
 * line under it, and a 24px round check on the right. Rows divide on a
 * hairline `border-top` and the first row drops it, so a group of them needs
 * no container chrome — the app just wraps them in a plain
 * `.fs-optionlist-rows` div, as these cells do.
 *
 * `active` does two things at once: the label turns the app accent and the
 * check fills with it and reveals a white tick. Off, the check is a 6%-ink
 * disc with a transparent glyph, so the control still occupies its space and
 * the rows never reflow when toggled. The whole row is the button and it
 * mirrors `active` to `aria-pressed`.
 *
 * `meta` is where the app earns the choice — "18 places", or the Guide's own
 * words for a Michelin tier. `leading` takes a glyph before the label; the
 * Michelin filter is the only caller and passes its star/bib marks.
 *
 * `FilterOptionList` renders these for you. Use `FilterCheckRow` directly
 * when the page's rows are a fixed set rather than a searchable list.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** On and off together, with counts as `meta`. Two rows are on — note the
 *  accent label travelling with the filled check. */
export const OnAndOff = () => {
  const [selected, setSelected] = React.useState(['Italian', 'Japanese']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const options = [
    { value: 'Italian', meta: '24 places' },
    { value: 'Japanese', meta: '18 places' },
    { value: 'Korean', meta: '9 places' },
    { value: 'Vietnamese', meta: '1 place' },
  ];
  return (
    <div style={column}>
      <div className="fs-optionlist-rows">
        {options.map((o) => (
          <FilterCheckRow
            key={o.value}
            label={o.value}
            meta={o.meta}
            active={selected.includes(o.value)}
            onToggle={() => toggle(o.value)}
          />
        ))}
      </div>
    </div>
  );
};

/** `leading` glyphs — the Michelin page. The marks are the app's own
 *  `fs-michelin-*` classes, which colour them Michelin red (#a2191f) and
 *  size the stars at 14px. */
export const WithLeadingGlyph = () => {
  const [selected, setSelected] = React.useState(['2 Stars', 'Bib Gourmand']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const mark = (n: number) => (
    <span className="fs-michelin-mark">
      <span className="fs-michelin-stars">
        {Array.from({ length: n }).map((_, i) => <Star key={i} />)}
      </span>
    </span>
  );
  const rows = [
    { value: '3 Stars', meta: 'Worth a special journey', leading: mark(3) },
    { value: '2 Stars', meta: 'Worth a detour', leading: mark(2) },
    { value: '1 Star', meta: 'High-quality cooking', leading: mark(1) },
    { value: 'Bib Gourmand', meta: 'Good quality, good value', leading: <span className="fs-michelin-mark"><Soup className="fs-michelin-glyph" /></span> },
    { value: 'Selected', meta: 'In the Guide', leading: <span className="fs-michelin-mark"><Utensils className="fs-michelin-glyph" /></span> },
  ];
  return (
    <div style={column}>
      <div className="fs-optionlist-rows">
        {rows.map((r) => (
          <FilterCheckRow
            key={r.value}
            label={r.value}
            meta={r.meta}
            leading={r.leading}
            active={selected.includes(r.value)}
            onToggle={() => toggle(r.value)}
          />
        ))}
      </div>
    </div>
  );
};

/** No `meta`: the rows collapse to a single line each and the list gets
 *  noticeably denser. Prefer the metered version when a count exists. */
export const LabelOnly = () => {
  const [selected, setSelected] = React.useState(['New York City']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <div className="fs-optionlist-rows">
        {['New York City', 'San Francisco', 'Los Angeles', 'Tokyo'].map((c) => (
          <FilterCheckRow
            key={c}
            label={c}
            active={selected.includes(c)}
            onToggle={() => toggle(c)}
          />
        ))}
      </div>
    </div>
  );
};

/** The Hours page, built from four of these — this is exactly what
 *  `HoursFilterSection` portals into its sub-page. The `meta` line is where
 *  each meal says what window it actually means. */
export const HoursPage = () => {
  const [openNow, setOpenNow] = React.useState(true);
  const [meals, setMeals] = React.useState<string[]>(['lunch']);
  const toggle = (m: string) =>
    setMeals((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  const rows = [
    { key: 'breakfast', label: 'Breakfast', meta: 'Open in the morning' },
    { key: 'lunch', label: 'Lunch', meta: 'Open around midday' },
    { key: 'dinner', label: 'Dinner', meta: 'Open in the evening' },
  ];
  return (
    <div style={column}>
      <div className="fs-optionlist-rows">
        <FilterCheckRow
          label="Open now"
          meta="Serving at this moment"
          active={openNow}
          onToggle={() => setOpenNow((v) => !v)}
        />
        {rows.map((r) => (
          <FilterCheckRow
            key={r.key}
            label={r.label}
            meta={r.meta}
            active={meals.includes(r.key)}
            onToggle={() => toggle(r.key)}
          />
        ))}
      </div>
    </div>
  );
};
