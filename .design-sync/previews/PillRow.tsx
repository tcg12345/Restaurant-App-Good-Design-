import React from 'react';
import { FilterSection, PillRow, Pill } from 'goodeats';

/**
 * The layout half of the pill control: a flex row with `flex-wrap` and an
 * 8px gap. It has no other job — no state, no scroll, no overflow shadow —
 * so a long set of pills wraps onto as many lines as it needs and the
 * section grows.
 *
 * It only ever wraps `Pill`s. Filter sheets reach for it when the choices
 * are word-shaped and variable in length (sort orders, list chips, travel
 * caps); when the choices are short and mutually exclusive they use
 * `Segment` / `SegmentItem` instead, which divides the row into equal parts.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** Single-select: the sort orders the Location page and Discover open with. */
export const SortOptions = () => {
  const [sortBy, setSortBy] = React.useState('rating');
  const options = [
    { value: 'recommended', label: 'Recommended' },
    { value: 'rating', label: 'Highest Rated' },
    { value: 'popularity', label: 'Most Popular' },
    { value: 'distance', label: 'Closest First' },
  ];
  return (
    <div style={column}>
      <FilterSection label="Sort by">
        <PillRow>
          {options.map((o) => (
            <Pill key={o.value} active={sortBy === o.value} onClick={() => setSortBy(o.value)}>
              {o.label}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
    </div>
  );
};

/** Multi-select: price tiers in the recommendations sheet, where more than
 *  one can be on at once. Nothing in `PillRow` enforces either mode — the
 *  caller's state does. */
export const PriceTiers = () => {
  const [selected, setSelected] = React.useState<number[]>([2, 3]);
  const toggle = (t: number) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  return (
    <div style={column}>
      <FilterSection label="Price">
        <PillRow>
          {[1, 2, 3, 4].map((tier) => (
            <Pill key={tier} active={selected.includes(tier)} onClick={() => toggle(tier)}>
              {'$'.repeat(tier)}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
    </div>
  );
};

/** The same row of `sm` pills — the travel-time caps. Six short pills still
 *  fit one line at sheet width; the row is what decides where they break. */
export const SmallPills = () => {
  const [driveMin, setDriveMin] = React.useState(30);
  const options = [
    { value: 0, label: 'Any' },
    { value: 10, label: '10 min' },
    { value: 20, label: '20 min' },
    { value: 30, label: '30 min' },
    { value: 45, label: '45 min' },
    { value: 60, label: '1 h' },
  ];
  return (
    <div style={column}>
      <FilterSection label="Drive time" value="30 min" isSet sub="From 210 Mulberry St, New York.">
        <PillRow>
          {options.map((o) => (
            <Pill key={o.value} sm active={driveMin === o.value} onClick={() => setDriveMin(o.value)}>
              {o.label}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
    </div>
  );
};

/** Wrapping is the point: the user's own lists are arbitrary-length names
 *  with an emoji in front, so this row runs to three lines and the section
 *  simply gets taller. */
export const Wrapping = () => {
  const [listId, setListId] = React.useState<string | null>('ramen');
  const lists = [
    { id: 'ramen', emoji: '🍜', name: 'Ramen crawl' },
    { id: 'omakase', emoji: '🍣', name: 'Omakase' },
    { id: 'date', emoji: '🕯️', name: 'Date night' },
    { id: 'pasta', emoji: '🍝', name: 'Pasta in Rome' },
    { id: 'bakery', emoji: '🥐', name: 'Bakeries' },
    { id: 'bbq', emoji: '🔥', name: 'Korean BBQ' },
  ];
  return (
    <div style={column}>
      <FilterSection label="List">
        <PillRow>
          <Pill active={!listId} onClick={() => setListId(null)}>All Ratings</Pill>
          {lists.map((l) => (
            <Pill
              key={l.id}
              active={listId === l.id}
              onClick={() => setListId(listId === l.id ? null : l.id)}
            >
              {l.emoji} {l.name}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
    </div>
  );
};
