import React from 'react';
import { FilterSection, RangeSlider } from 'gourmet-canvas';

/**
 * Dual-thumb range. Two transparent `<input type="range">` elements stack
 * over one shared 4px track; the span between the values is painted in the
 * accent (`--fs-accent`), and each thumb is an 18px surface circle ringed in
 * the accent with a soft terracotta shadow. Only the thumbs take pointer
 * events — the track itself is not clickable.
 *
 * `value` is a `[min, max]` tuple and the component is fully controlled:
 * `onChange` fires with the whole tuple, so callers keep it in one state
 * slot. `step` defaults to 1; the score sheets use 0.5.
 *
 * One behaviour worth knowing before you design around it: the thumbs are
 * clamped to stay at least ONE STEP apart and can never meet. Letting them
 * sit on the same value used to deadlock the control — the max input renders
 * on top, so every grab at [10,10] landed on the thumb that could not move.
 * For the same reason, when the pair sits in the upper half of the range the
 * min input is raised above the max one so the reachable thumb wins the hit
 * test.
 *
 * The component draws only the track. The "0 / 10" end captions under it are
 * the caller's own `.fs-slider-range` div, and the live "7.5 – 10" readout is
 * the enclosing `FilterSection`'s `value` — both are shown here because a
 * bare slider gives the user no numbers at all.
 */

const column: React.CSSProperties = { width: '100%', maxWidth: 440 };

/** Narrowed to the top of the scale — how the score filter looks once it is
 *  doing something. The fill is short and sits right. */
export const NarrowedHigh = () => {
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

/** Both ends pulled in — the fill floats in the middle and both thumbs are
 *  clear of the track ends. */
export const MidBand = () => {
  const [range, setRange] = React.useState<[number, number]>([4, 8.5]);
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

/** Wide open at [0, 10] — the reset state. The fill spans the whole track,
 *  both thumbs sit on the ends, and the section's summary stays unset. */
export const FullSpan = () => {
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

/** A step of 1 on a coarser scale, with the thumbs one step apart — the
 *  closest they are allowed to get. */
export const MinimumGap = () => {
  const [range, setRange] = React.useState<[number, number]>([6, 7]);
  return (
    <div style={column}>
      <FilterSection label="Score" value={`${range[0]} – ${range[1]}`} isSet>
        <RangeSlider
          min={0}
          max={10}
          step={1}
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
