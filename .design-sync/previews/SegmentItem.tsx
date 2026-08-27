import React from 'react';
import { FilterSection, Segment, SegmentItem } from 'gourmet-canvas';

/**
 * One choice inside a `Segment`. It MUST be a child of `Segment` — on its
 * own it is a transparent borderless button on whatever it lands on, because
 * the rail, the padding and the equal division all come from the parent.
 *
 * `active` raises it: the item fills with `--fs-surface` (white in light,
 * #38383c in dark) and takes a 1px ring plus a 1px shadow, so the selected
 * choice reads as a chip lifted off the rail. Resting items are ink-2 text
 * on nothing; hover darkens the text only.
 *
 * Each item is `flex: 1` and 38px tall, so labels should be short — "$$",
 * "8 mi", "Open now". Anything longer squeezes every sibling.
 *
 * There is no disabled state and no icon slot: pass a string.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** Active beside resting. The raised white chip is the whole state change. */
export const ActiveAndResting = () => {
  const [price, setPrice] = React.useState(2);
  return (
    <div style={column}>
      <FilterSection label="Price">
        <Segment>
          {[
            { value: 0, label: 'Any' },
            { value: 1, label: '$' },
            { value: 2, label: '$$' },
            { value: 3, label: '$$$' },
            { value: 4, label: '$$$$' },
          ].map((p) => (
            <SegmentItem key={p.value} active={price === p.value} onClick={() => setPrice(p.value)}>
              {p.label}
            </SegmentItem>
          ))}
        </Segment>
      </FilterSection>
    </div>
  );
};

/** Two items split the rail in half — the "Any time / Open now" toggle from
 *  the recommendations sheet. */
export const TwoItems = () => {
  const [openNow, setOpenNow] = React.useState(true);
  return (
    <div style={column}>
      <FilterSection label="Hours">
        <Segment>
          <SegmentItem active={!openNow} onClick={() => setOpenNow(false)}>Any time</SegmentItem>
          <SegmentItem active={openNow} onClick={() => setOpenNow(true)}>Open now</SegmentItem>
        </Segment>
      </FilterSection>
    </div>
  );
};

/** Nothing active. A legal state — Pantry's price segment starts here with
 *  "Any" selected instead, but a caller that maps null to no item at all
 *  gets a flat rail. Shown so the empty rail is not mistaken for a bug. */
export const NoneActive = () => (
  <div style={column}>
    <FilterSection label="Price" value="Any">
      <Segment>
        {['$', '$$', '$$$', '$$$$'].map((p) => (
          <SegmentItem key={p} onClick={() => {}}>{p}</SegmentItem>
        ))}
      </Segment>
    </FilterSection>
  </div>
);

/** Inside a teal-toned track the active item's LABEL turns #0f766e; the chip
 *  behind it stays surface-coloured. */
export const InTealTrack = () => {
  const [stars, setStars] = React.useState(4);
  return (
    <div style={column}>
      <Segment tone="teal">
        {[3, 4, 5].map((s) => (
          <SegmentItem key={s} active={stars === s} onClick={() => setStars(s)}>
            {s} star
          </SegmentItem>
        ))}
      </Segment>
    </div>
  );
};
