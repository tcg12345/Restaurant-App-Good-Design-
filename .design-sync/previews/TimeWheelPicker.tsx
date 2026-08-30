import React from 'react';
import { TimeWheelPicker } from 'goodeats';

/**
 * Two iOS wheels — hours 0–12, minutes in steps of 5 — in the app's shared
 * picker sheet. It is an OVERLAY: `fixed inset-0`, a 55% scrim, and the
 * sheet itself sliding up from the bottom edge, so every cell here gives it
 * a sized stage to fill rather than letting it collapse to nothing.
 *
 * `isOpen` is pinned true in these previews (a closed picker renders
 * nothing at all). The value is real state: `onConfirm` writes it back and
 * it returns as `initialHours` / `initialMinutes`, which is how the wheels
 * know where to sit — 44px rows, five visible, the center one selected under
 * a soft pill, with a gradient mask fading the ends off.
 *
 * Drag-to-dismiss is handle-only here on purpose: the wheels below own
 * vertical touch themselves, and a drag-anywhere sheet would fight them.
 */

// The sheet's entry animation (motion/react) never settles under the capture
// harness: it pins the page clock, which skews motion's WAAPI startTime into
// the future, so the sheet holds its `initial` y of 100% (parked below the
// stage) and the scrim its opacity of 0. Important-author declarations outrank
// animations in the cascade, so this pins the settled state — which is what a
// still frame of an open sheet should show anyway.
const SETTLED = '.ds-picker-stage > .fixed{opacity:1!important}'
  + '.ds-picker-stage > .fixed > .bg-surface{transform:none!important}';

/** The stage the overlay fills: the sheet is `position: fixed`, so it needs
 *  a sized ancestor to be seen against. */
const Stage: React.FC<{ children: React.ReactNode; label: string; value: string }> = ({ children, label, value }) => (
  /* `transform` makes this the containing block for the sheet's `fixed`
     layers, so the overlay is staged inside the cell instead of escaping to
     the page. Nothing about the component changes — only where "the screen"
     is. */
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
      <p className="font-serif font-bold text-[17px] text-on-surface">Roast chicken, two ways</p>
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-on-surface/[0.04] px-4 py-3">
        <span className="text-[14px] font-semibold text-on-surface/70">{label}</span>
        <span className="text-[14px] font-semibold text-primary">{value}</span>
      </div>
    </div>
    {children}
  </div>
);

const fmt = (h: number, m: number) =>
  h ? `${h} hr ${m ? `${m} min` : ''}`.trim() : `${m} min`;

/** Prep time — under an hour, so the hours wheel sits on 0 and the minutes
 *  wheel carries the value. */
export const PrepTime = () => {
  const [time, setTime] = React.useState({ h: 0, m: 25 });
  return (
    <Stage label="Prep time" value={fmt(time.h, time.m)}>
      <TimeWheelPicker
        isOpen
        onClose={() => {}}
        onConfirm={(h, m) => setTime({ h, m })}
        initialHours={time.h}
        initialMinutes={time.m}
        title="Prep time"
      />
    </Stage>
  );
};

/** Cook time — both wheels off zero, which is where the two-column layout
 *  and the tabular serif numerals earn their keep. */
export const CookTime = () => {
  const [time, setTime] = React.useState({ h: 1, m: 45 });
  return (
    <Stage label="Cook time" value={fmt(time.h, time.m)}>
      <TimeWheelPicker
        isOpen
        onClose={() => {}}
        onConfirm={(h, m) => setTime({ h, m })}
        initialHours={time.h}
        initialMinutes={time.m}
        title="Cook time"
      />
    </Stage>
  );
};

/** Minutes are snapped to the nearest 5 on the way in — pass 38 and the
 *  wheel opens on 40. Nothing off-grid can be selected. */
export const SnapsToFive = () => {
  const [time, setTime] = React.useState({ h: 8, m: 38 });
  return (
    <Stage label="Rest overnight" value={fmt(time.h, time.m)}>
      <TimeWheelPicker
        isOpen
        onClose={() => {}}
        onConfirm={(h, m) => setTime({ h, m })}
        initialHours={time.h}
        initialMinutes={time.m}
        title="Resting time"
      />
    </Stage>
  );
};
