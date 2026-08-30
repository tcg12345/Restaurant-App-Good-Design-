import React from 'react';
import { FilterSection, Segment, SegmentItem } from 'goodeats';

/**
 * The track of the segmented control: a rounded 999px rail on `--fs-bg-2`
 * with a hairline border and 4px of inner padding. It renders NOTHING on its
 * own — it is a flex container whose only content is `SegmentItem`s, and
 * each item takes `flex: 1`, so the track divides itself into equal parts
 * however many you pass.
 *
 * Reach for it over `PillRow` when the choices are short, mutually
 * exclusive, and ordered — price tiers, radius steps, a two-way toggle.
 * Five items is the app's practical ceiling at sheet width.
 *
 * `tone="teal"` recolours the ACTIVE item's text to #0f766e (and #5eead4 in
 * dark); the raised white chip behind it is unchanged. It is reserved in the
 * stylesheet for Discover's hotels mode and no caller passes it today.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** Five price levels, the canonical use. "Any" leads so the control can be
 *  returned to neutral without a separate reset. */
export const PriceLevels = () => {
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

/** Two items — a plain either/or. The track still splits in equal halves,
 *  which is why this reads as a toggle rather than as two chips. */
export const TwoUp = () => {
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

/** An ordered numeric scale — the recommendation browser's search radius.
 *  Longer labels than the price tiers, same equal division. */
export const RadiusSteps = () => {
  const [radius, setRadius] = React.useState(8);
  return (
    <div style={column}>
      <FilterSection label="Distance" value={`${radius} mi`} isSet={radius !== 8}>
        <Segment>
          {[2, 5, 8, 15, 25].map((r) => (
            <SegmentItem key={r} active={r === radius} onClick={() => setRadius(r)}>
              {r} mi
            </SegmentItem>
          ))}
        </Segment>
      </FilterSection>
    </div>
  );
};

/** The teal tone above the default, both with the same item active, so the
 *  only difference on screen is the active label's colour. */
export const TealTone = () => {
  const [stars, setStars] = React.useState(4);
  const tiers = [3, 4, 5];
  return (
    <div style={{ ...column, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Segment>
        {tiers.map((s) => (
          <SegmentItem key={s} active={stars === s} onClick={() => setStars(s)}>
            {s} star
          </SegmentItem>
        ))}
      </Segment>
      <Segment tone="teal">
        {tiers.map((s) => (
          <SegmentItem key={s} active={stars === s} onClick={() => setStars(s)}>
            {s} star
          </SegmentItem>
        ))}
      </Segment>
    </div>
  );
};
