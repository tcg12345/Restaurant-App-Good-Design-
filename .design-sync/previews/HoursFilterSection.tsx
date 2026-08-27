import React from 'react';
import { HoursFilterSection, FilterDrillSection } from 'gourmet-canvas';

/**
 * A drop-in "Hours" filter for any sheet. It is a `FilterDrillRow` with a
 * fixed `id` of `"hours"` — so there is at most one per sheet — whose
 * sub-page is four `FilterCheckRow`s: Open now, Breakfast, Lunch, Dinner,
 * each with a plain-language `meta` for the window it means ("Open around
 * midday"). The meal windows themselves live in `lib/hours.ts`.
 *
 * The caller owns the value: `{ openNow: boolean, meals: ('breakfast' |
 * 'lunch' | 'dinner')[] }`, replaced wholesale through `onChange`. `label`
 * defaults to "Hours". There is no partial update API — merge and pass the
 * whole object back.
 *
 * The row summary is derived, and it has three shapes: "Any" when nothing is
 * on; the parts joined with a comma when there are one or two ("Open now,
 * Lunch"); and first + "+N" from three parts up ("Open now +3"). Open now
 * always leads, then the meals in the order the caller's array holds them.
 * Anything on turns the summary the app accent, and puts Clear in the
 * sub-page header.
 *
 * As with every drill row, only the ROW renders outside a `FilterSheet` —
 * the sub-page portals into the sheet's sliding layer. The `HoursPage` cell
 * on `FilterCheckRow` shows the page body.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

type Meal = 'breakfast' | 'lunch' | 'dinner';
type Hours = { openNow: boolean; meals: Meal[] };

/** Nothing on: grey "Any", no Clear. */
export const Unset = () => {
  const [hours, setHours] = React.useState<Hours>({ openNow: false, meals: [] });
  return (
    <div style={column}>
      <HoursFilterSection value={hours} onChange={setHours} />
    </div>
  );
};

/** Two parts, so the summary joins them — and Open now always leads. */
export const OpenNowAndLunch = () => {
  const [hours, setHours] = React.useState<Hours>({ openNow: true, meals: ['lunch'] });
  return (
    <div style={column}>
      <HoursFilterSection value={hours} onChange={setHours} />
    </div>
  );
};

/** Meals without Open now — the same joined form, in the order the caller's
 *  array holds. */
export const MealsOnly = () => {
  const [hours, setHours] = React.useState<Hours>({ openNow: false, meals: ['lunch', 'dinner'] });
  return (
    <div style={column}>
      <HoursFilterSection value={hours} onChange={setHours} />
    </div>
  );
};

/** Four parts: past two the summary gives up on listing and counts instead.
 *  `label` is overridden here to show it is not fixed. */
export const CountedSummary = () => {
  const [hours, setHours] = React.useState<Hours>({
    openNow: true,
    meals: ['breakfast', 'lunch', 'dinner'],
  });
  return (
    <div style={column}>
      <HoursFilterSection value={hours} onChange={setHours} label="When it's open" />
    </div>
  );
};

/** In place, between the sheet's other drill rows — the Location page's
 *  order is Hours, then Cuisine, then Michelin. All three share one hairline
 *  rhythm because each row draws its own bottom border. */
export const InSheetContext = () => {
  const [hours, setHours] = React.useState<Hours>({ openNow: true, meals: ['dinner'] });
  const [cuisine, setCuisine] = React.useState(['Italian', 'Japanese', 'Korean']);
  const [michelin, setMichelin] = React.useState<string[]>([]);
  const tog = (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    set((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <HoursFilterSection value={hours} onChange={setHours} />
      <FilterDrillSection
        id="cuisine"
        label="Cuisine"
        options={['Italian', 'Japanese', 'Korean', 'Mexican', 'Thai']
          .map((c) => ({ value: c, label: c }))}
        selected={cuisine}
        onToggle={tog(setCuisine)}
        searchPlaceholder="Search cuisines"
        emptyLabel="All cuisines"
      />
      <FilterDrillSection
        id="michelin"
        label="Michelin"
        searchable={false}
        options={['3 Stars', '2 Stars', '1 Star', 'Bib Gourmand', 'Selected']
          .map((c) => ({ value: c, label: c }))}
        selected={michelin}
        onToggle={tog(setMichelin)}
      />
    </div>
  );
};
