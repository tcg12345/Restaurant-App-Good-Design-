import React from 'react';
import { FilterDrillSection } from 'gourmet-canvas';

/**
 * The one-liner most filter sheets use for cuisine / city / friends: a
 * `FilterDrillRow` whose sub-page is a searchable `FilterOptionList`, wired
 * together for you. Drop it between `FilterSection`s and it matches their
 * hairline rhythm.
 *
 * What it derives so the caller doesn't:
 * - the row summary — `emptyLabel` (default "Any") with nothing selected,
 *   the single label with one, `"Italian +2"` with three;
 * - `isSet`, from `selected.length`;
 * - the sub-page subtitle — "Pick as many as you like", or "One choice" when
 *   `multiple` is false. That subtitle is the ONLY thing `multiple` changes;
 *   single-select is enforced by the caller's `onToggle`;
 * - Clear in the sub-page header, only when something is selected;
 * - option `meta`, when `counts` is given: `counts[value]` becomes
 *   `"18 places"`, pluralised, with `countNoun` swapping the noun ("recipe"
 *   in the Pantry's recipe sheets).
 *
 * What renders here is the ROW. The sub-page slides in over the filter
 * sheet's body through `FilterSheetNavContext`, so outside a `FilterSheet`
 * the context default leaves `container` null and the page never mounts —
 * see `FilterOptionList` for what the page itself looks like.
 *
 * `id` must be unique within one sheet.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

const CUISINES = ['Italian', 'Japanese', 'Korean', 'Mexican', 'Thai', 'Vietnamese']
  .map((c) => ({ value: c, label: c }));

const CUISINE_COUNTS: Record<string, number> = {
  Italian: 24, Japanese: 18, Korean: 9, Mexican: 7, Thai: 5, Vietnamese: 1,
};

/** Three selected — the summary collapses to first + "+N" and moves to the
 *  accent. `counts` is passed, so the sub-page rows carry "24 places". */
export const Selected = () => {
  const [selected, setSelected] = React.useState(['Italian', 'Japanese', 'Korean']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterDrillSection
        id="cuisine"
        label="Cuisine"
        options={CUISINES}
        counts={CUISINE_COUNTS}
        selected={selected}
        onToggle={toggle}
        searchPlaceholder="Search cuisines"
        emptyLabel="Any"
      />
    </div>
  );
};

/** Exactly one selected: the summary is just that label, no "+N". */
export const OneSelected = () => {
  const [selected, setSelected] = React.useState(['New York City']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterDrillSection
        id="city"
        label="City / Location"
        options={['New York City', 'San Francisco', 'Los Angeles', 'Tokyo', 'Mexico City']
          .map((c) => ({ value: c, label: c }))}
        selected={selected}
        onToggle={toggle}
        searchPlaceholder="Search locations"
        emptyLabel="Any"
      />
    </div>
  );
};

/** Nothing selected, with `emptyLabel="All cuisines"` — the Location page's
 *  wording. Grey summary, `isSet` derived false, and no Clear on the page. */
export const EmptyLabel = () => (
  <div style={column}>
    <FilterDrillSection
      id="cuisine"
      label="Cuisine"
      options={CUISINES}
      selected={[]}
      onToggle={() => {}}
      searchPlaceholder="Search cuisines"
      emptyLabel="All cuisines"
    />
  </div>
);

/** Three of them stacked, as the Pantry sheet ends: one set, one set, one
 *  not. The hairlines are the rows' own, so no separator markup is needed. */
export const SheetTail = () => {
  const [cuisine, setCuisine] = React.useState(['Italian', 'Japanese', 'Korean']);
  const [city, setCity] = React.useState(['New York City']);
  const [friends, setFriends] = React.useState<string[]>([]);
  const tog = (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    set((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterDrillSection
        id="cuisine"
        label="Cuisine"
        options={CUISINES}
        counts={CUISINE_COUNTS}
        selected={cuisine}
        onToggle={tog(setCuisine)}
        searchPlaceholder="Search cuisines"
      />
      <FilterDrillSection
        id="city"
        label="City / Location"
        options={['New York City', 'San Francisco', 'Tokyo'].map((c) => ({ value: c, label: c }))}
        selected={city}
        onToggle={tog(setCity)}
        searchPlaceholder="Search locations"
      />
      <FilterDrillSection
        id="friends"
        label="Rated by"
        options={['Nadia Rahman', 'Marcus Vale', 'Priya Anand'].map((c) => ({ value: c, label: c }))}
        selected={friends}
        onToggle={tog(setFriends)}
        searchPlaceholder="Search friends"
      />
    </div>
  );
};
