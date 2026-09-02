import React from 'react';
import { PillRow, Pill } from 'goodeats';

/**
 * The filter sheet's toggle chip. Resting it is a 38px white capsule with a
 * hairline border and semibold 13px ink-2 label; `active` inverts it to
 * solid ink with the surface colour on top — no accent, no checkmark, just
 * the inversion. Hover darkens the border and the text.
 *
 * Props:
 * - `active` — the on state. `Pill` is presentational, so single-select vs
 *   multi-select is entirely the caller's `onClick`.
 * - `sm` — 32px tall, 12.5px text, tighter padding. The travel-time caps use
 *   it so a six-option row still reads as secondary to the sort row above.
 * - `tone="teal"` — swaps the active fill from ink to #0f766e. Reserved in
 *   the stylesheet for Discover's hotels mode; no caller passes it today, so
 *   treat it as an available accent rather than an established pattern.
 *
 * Always put pills inside `PillRow` — the pill itself sets no margin, and
 * the row owns the 8px gap and the wrapping.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** Resting beside active. One tap moves the inversion — the only visual
 *  difference between the two states. */
export const States = () => {
  const [sortBy, setSortBy] = React.useState('rating');
  const options = [
    { value: 'recommended', label: 'Recommended' },
    { value: 'rating', label: 'Highest Rated' },
    { value: 'popularity', label: 'Most Popular' },
  ];
  return (
    <div style={column}>
      <PillRow>
        {options.map((o) => (
          <Pill key={o.value} active={sortBy === o.value} onClick={() => setSortBy(o.value)}>
            {o.label}
          </Pill>
        ))}
      </PillRow>
    </div>
  );
};

/** `sm` — the same two states six pixels shorter. Use it when a row is a
 *  qualifier on the section above rather than the section's main choice. */
export const SmallStates = () => {
  const [walkMin, setWalkMin] = React.useState(20);
  return (
    <div style={column}>
      <PillRow>
        {[
          { value: 0, label: 'Any' },
          { value: 10, label: '10 min' },
          { value: 20, label: '20 min' },
          { value: 30, label: '30 min' },
          { value: 45, label: '45 min' },
        ].map((o) => (
          <Pill key={o.value} sm active={walkMin === o.value} onClick={() => setWalkMin(o.value)}>
            {o.label}
          </Pill>
        ))}
      </PillRow>
    </div>
  );
};

/** Multi-select price tiers — two on at once, which the pill supports and
 *  the segmented control does not. */
export const MultiSelect = () => {
  const [selected, setSelected] = React.useState<number[]>([2, 3]);
  const toggle = (t: number) =>
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  return (
    <div style={column}>
      <PillRow>
        {[1, 2, 3, 4].map((tier) => (
          <Pill key={tier} active={selected.includes(tier)} onClick={() => toggle(tier)}>
            {'$'.repeat(tier)}
          </Pill>
        ))}
      </PillRow>
    </div>
  );
};

/** The teal tone against the default ink one, both active, so the swap is
 *  legible. `tone` changes nothing while `active` is false. */
export const TealTone = () => {
  const [on, setOn] = React.useState(true);
  return (
    <div style={column}>
      <PillRow>
        <Pill active={on} onClick={() => setOn((v) => !v)}>Highest Rated</Pill>
        <Pill tone="teal" active={on} onClick={() => setOn((v) => !v)}>Hotels</Pill>
        <Pill tone="teal" onClick={() => {}}>Resting teal</Pill>
      </PillRow>
    </div>
  );
};
