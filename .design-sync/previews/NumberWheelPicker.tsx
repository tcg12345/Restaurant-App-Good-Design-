import React from 'react';
import { NumberWheelPicker } from 'goodeats';

/**
 * One iOS wheel over the app's shared picker sheet, for a single integer:
 * servings, party size, a count of anything. The range is `min`..`max`
 * (defaults 1..24) and the wheel is 160px wide inside the sheet, centered,
 * with `unitLabel` as the small caps line above it.
 *
 * It is an OVERLAY — `fixed inset-0`, a 55% scrim, the sheet sliding up from
 * the bottom — so each cell gives it a sized stage to fill. `isOpen` is
 * pinned true; closed, it renders nothing at all.
 *
 * The value is real state here: `onConfirm` writes it back and it returns as
 * `initialValue`, which is what the wheel scrolls itself to on open.
 */

// The sheet's entry animation (motion/react) never settles under the capture
// harness: it pins the page clock, which skews motion's WAAPI startTime into
// the future, so the sheet holds its `initial` y of 100% (parked below the
// stage) and the scrim its opacity of 0. Important-author declarations outrank
// animations in the cascade, so this pins the settled state — which is what a
// still frame of an open sheet should show anyway.
const SETTLED = '.ds-picker-stage > .fixed{opacity:1!important}'
  + '.ds-picker-stage > .fixed > .bg-surface{transform:none!important}';

/** The stage the overlay fills: `transform` makes this the containing block
 *  for the sheet's `fixed` layers, so it is framed inside the cell instead of
 *  escaping to the page. */
const Stage: React.FC<{ children: React.ReactNode; title: string; label: string; value: string }> = ({
  children, title, label, value,
}) => (
  <div
    className="ds-picker-stage"
    style={{
      position: 'relative',
      transform: 'translateZ(0)',
      height: 540,
      width: 620,
      overflow: 'hidden',
      borderRadius: 24,
      background: 'var(--color-cream)',
      boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-on-surface) 10%, transparent)',
    }}
  >
    <style>{SETTLED}</style>
    <div className="p-4">
      <p className="font-serif font-bold text-[17px] text-on-surface">{title}</p>
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-on-surface/[0.04] px-4 py-3">
        <span className="text-[14px] font-semibold text-on-surface/70">{label}</span>
        <span className="text-[14px] font-semibold text-primary">{value}</span>
      </div>
    </div>
    {children}
  </div>
);

/** The default range (1–24), which is what a recipe's serving count uses. */
export const Servings = () => {
  const [servings, setServings] = React.useState(4);
  return (
    <Stage title="Cacio e pepe" label="Servings" value={`${servings}`}>
      <NumberWheelPicker
        isOpen
        onClose={() => {}}
        onConfirm={setServings}
        initialValue={servings}
        title="Servings"
        unitLabel="Servings"
      />
    </Stage>
  );
};

/** A narrowed range. `min`/`max` set the wheel's extent, so a party of two
 *  sits near the top of a short list with the end fade close by. */
export const PartySize = () => {
  const [guests, setGuests] = React.useState(2);
  return (
    <Stage title="Carbone · Thu 8:15 PM" label="Party size" value={`${guests} guests`}>
      <NumberWheelPicker
        isOpen
        onClose={() => {}}
        onConfirm={setGuests}
        initialValue={guests}
        min={1}
        max={12}
        title="Party size"
        unitLabel="Guests"
      />
    </Stage>
  );
};

/** A long range starting at 0 — the wheel scrolls itself deep into the list
 *  on open, and `unitLabel` carries the unit so the numerals stay bare. */
export const LongRange = () => {
  const [minutes, setMinutes] = React.useState(45);
  return (
    <Stage title="Sourdough focaccia" label="Bulk ferment" value={`${minutes} min`}>
      <NumberWheelPicker
        isOpen
        onClose={() => {}}
        onConfirm={setMinutes}
        initialValue={minutes}
        min={0}
        max={180}
        title="Bulk ferment"
        unitLabel="Minutes"
      />
    </Stage>
  );
};
