import React from 'react';
import { FilterDrillRow, FilterOptionList } from 'goodeats';

/**
 * A choose-from-a-list filter rendered as a settings row: bold 13.5px label
 * on the left, the current-selection summary on the right, a chevron, and a
 * bottom hairline. `isSet` turns the summary from muted grey to the app
 * accent. When nothing is selected the row falls back to the literal string
 * "Any" — pass a `value` if you want different empty wording.
 *
 * IMPORTANT for previewing and for building with it: the row does not expand.
 * Tapping it asks `FilterSheetNavContext` to slide a sub-page in over the
 * sheet body, and `children` are PORTALLED into that sliding layer — they
 * render only while `nav.activeId === id` and `nav.container` exists. Outside
 * a `FilterSheet` the context falls back to its default (`activeId: null`,
 * `openPage` a no-op, `container: null`), so the row renders correctly and
 * the children never mount. That is why every cell here shows the ROW; the
 * sub-page body is previewed on `FilterOptionList`.
 *
 * `id` must be unique within one sheet — it is the sub-page's key.
 * `subtitle` prints under the sub-page title, and `onClear` puts a Clear
 * control in the sub-page header, so both are also invisible until it opens.
 *
 * Most callers never touch this directly: `FilterDrillSection` wires the row
 * to a searchable option list, and `MichelinDrillSection` wires it to the
 * distinction rows. Use `FilterDrillRow` when the sub-page is something else.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

const CUISINES = [
  { value: 'Italian', label: 'Italian' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Mexican', label: 'Mexican' },
  { value: 'Thai', label: 'Thai' },
];

/** Nothing chosen: grey summary, and the row's own "Any" fallback because
 *  no `value` was passed. */
export const Unset = () => (
  <div style={column}>
    <FilterDrillRow id="cuisine" label="Cuisine" subtitle="Pick as many as you like">
      <FilterOptionList options={CUISINES} selected={[]} onToggle={() => {}} searchPlaceholder="Search cuisines" />
    </FilterDrillRow>
  </div>
);

/** Three cuisines on. The summary convention is first label + "+N" for the
 *  rest, and `isSet` moves it to the accent. */
export const Set = () => {
  const [selected, setSelected] = React.useState(['Italian', 'Japanese', 'Korean']);
  const toggle = (v: string) =>
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  return (
    <div style={column}>
      <FilterDrillRow
        id="cuisine"
        label="Cuisine"
        value={`${selected[0]} +${selected.length - 1}`}
        isSet={selected.length > 0}
        subtitle="Pick as many as you like"
        onClear={() => setSelected([])}
      >
        <FilterOptionList
          options={CUISINES}
          selected={selected}
          onToggle={toggle}
          searchPlaceholder="Search cuisines"
        />
      </FilterDrillRow>
    </div>
  );
};

/** A summary too long for the row does not wrap and does not push anything:
 *  it is one nowrap line that ellipsises, so the label stays put and the
 *  chevron stays on the right edge. Shown at phone width (320px), which is
 *  where a city name actually runs out of room. */
export const TruncatedValue = () => (
  <div style={{ width: '100%', maxWidth: 320 }}>
    <FilterDrillRow
      id="city"
      label="City / Location"
      value="San Francisco Bay Area, California"
      isSet
      subtitle="Pick as many as you like"
    >
      <FilterOptionList options={[]} selected={[]} onToggle={() => {}} />
    </FilterDrillRow>
  </div>
);

/** Four rows stacked — the bottom of a real filter sheet. The hairlines come
 *  from the rows themselves, and the mix of set and unset summaries is what
 *  the user reads to know what is still on. */
export const RowStack = () => (
  <div style={column}>
    <FilterDrillRow id="hours" label="Hours" value="Open now, Lunch" isSet>
      <div />
    </FilterDrillRow>
    <FilterDrillRow id="cuisine" label="Cuisine" value="Italian +2" isSet>
      <div />
    </FilterDrillRow>
    <FilterDrillRow id="michelin" label="Michelin">
      <div />
    </FilterDrillRow>
    <FilterDrillRow id="city" label="City / Location" value="New York City" isSet>
      <div />
    </FilterDrillRow>
  </div>
);
