import React from 'react';
import { FilterSection, PillRow, Pill, Segment, SegmentItem, RangeSlider } from 'goodeats';
import { Footprints } from 'lucide-react';

/**
 * One block of a filter sheet: an 11px uppercase tracked label, an optional
 * right-aligned current-value summary, an optional blurb, then the control
 * itself as `children`. Sections divide on a bottom hairline; the last one
 * in a sheet drops it.
 *
 * The `value` slot has two looks and `isSet` picks between them — unset is
 * muted serif italic (16px), set is bold sans (13px) in the app accent
 * (`--fs-accent`: #9f3012 light, #d3623d dark). Pass both together so a
 * sheet you have not scrolled still says what is on.
 *
 * `label` is a ReactNode, not a string: the travel-time sections on the
 * Location page put a lucide glyph inline ahead of the word.
 *
 * This holds no filter logic. Every caller (Discover, Pantry, LocationPage,
 * RecommendationsBrowser) owns the state and passes values and handlers in.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

const SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'popularity', label: 'Most Popular' },
  { value: 'distance', label: 'Closest First' },
];

/** The plain form — label, then the control. No `value`, so the label sits
 *  on its own line. This is the "Sort by" section every sheet opens with. */
export const LabelOnly = () => {
  const [sortBy, setSortBy] = React.useState('rating');
  return (
    <div style={column}>
      <FilterSection label="Sort by">
        <PillRow>
          {SORT_OPTIONS.map((opt) => (
            <Pill key={opt.value} active={sortBy === opt.value} onClick={() => setSortBy(opt.value)}>
              {opt.label}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
    </div>
  );
};

/** `isSet` on: the summary moves to the accent in bold sans, so the section
 *  reads as narrowed at a glance. */
export const ValueSet = () => {
  const [range, setRange] = React.useState<[number, number]>([7.5, 10]);
  return (
    <div style={column}>
      <FilterSection
        label="Score"
        value={`${range[0]} – ${range[1]}`}
        isSet={range[0] > 0 || range[1] < 10}
      >
        <RangeSlider
          min={0}
          max={10}
          step={0.5}
          value={range}
          onChange={setRange}
          ariaLabelMin="Minimum score"
          ariaLabelMax="Maximum score"
        />
        <div className="fs-slider-range"><span>0</span><span>10</span></div>
      </FilterSection>
    </div>
  );
};

/** The same section untouched: `isSet` false leaves the summary in muted
 *  serif italic. The two cells together are the whole `isSet` axis. */
export const ValueUnset = () => {
  const [range, setRange] = React.useState<[number, number]>([0, 10]);
  return (
    <div style={column}>
      <FilterSection
        label="Score"
        value={`${range[0]} – ${range[1]}`}
        isSet={range[0] > 0 || range[1] < 10}
      >
        <RangeSlider
          min={0}
          max={10}
          step={0.5}
          value={range}
          onChange={setRange}
          ariaLabelMin="Minimum score"
          ariaLabelMax="Maximum score"
        />
        <div className="fs-slider-range"><span>0</span><span>10</span></div>
      </FilterSection>
    </div>
  );
};

/** `sub` carries the rule a filter needs stated — here the walk-time cap,
 *  which is measured from your saved address, not from the map centre. Note
 *  the glyph riding in the `label` node. */
export const WithSubtext = () => {
  const [walkMin, setWalkMin] = React.useState(20);
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
      <FilterSection
        label={(
          <>
            <Footprints size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 6 }} />
            Walk time
          </>
        )}
        value={walkMin === 0 ? 'Any' : options.find((o) => o.value === walkMin)?.label}
        isSet={walkMin > 0}
        sub="From 210 Mulberry St, New York."
      >
        <PillRow>
          {options.map((o) => (
            <Pill key={o.value} sm active={walkMin === o.value} onClick={() => setWalkMin(o.value)}>
              {o.label}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
    </div>
  );
};

/** Three stacked sections — the rhythm the component exists for. The
 *  hairline between them comes from the section itself, so a sheet body is
 *  literally a list of these with nothing in between. */
export const SheetBody = () => {
  const [sortBy, setSortBy] = React.useState('rating');
  const [price, setPrice] = React.useState(2);
  const [radius, setRadius] = React.useState(8);
  return (
    <div style={column}>
      <FilterSection label="Sort by">
        <PillRow>
          {SORT_OPTIONS.map((opt) => (
            <Pill key={opt.value} active={sortBy === opt.value} onClick={() => setSortBy(opt.value)}>
              {opt.label}
            </Pill>
          ))}
        </PillRow>
      </FilterSection>
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
