// LoopWheel — an inline, infinitely-looping iOS-clock-style wheel.
//
// Unlike the scroll-snap Wheel in WheelPicker.tsx (a bottom-sheet picker
// with hard ends), this one is pointer-driven with its own momentum, so
// it spins past the wrap point forever in either direction — exactly
// like the hours/minutes wheels in the iPhone Clock app — and it lives
// inline in a card rather than behind a tap.
//
// Input surface:
//   - touch / mouse drag with momentum + detent snap
//   - mouse scroll wheel (debounced snap)
//   - click a visible neighbor row to glide to it
//   - keyboard arrows when focused (role="spinbutton")
//
// The component is controlled: `value` in [0, count) comes in, `onChange`
// fires as the wheel passes each detent. External value changes (draft
// hydration, AI edit) sync the wheel only while it isn't being touched.

import React, { useEffect, useRef, useState } from 'react';

const IH = 34;               // row height (px)
const VISIBLE = 5;           // rows shown (odd — center row is selection)
const HEIGHT = IH * VISIBLE;
const RENDER_SPAN = 3;       // rows rendered above/below center

const WHEEL_MASK =
  'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.14) 16%, rgba(0,0,0,0.55) 34%, black 46%, black 54%, rgba(0,0,0,0.55) 66%, rgba(0,0,0,0.14) 84%, transparent 100%)';

const mod = (n: number, m: number) => ((n % m) + m) % m;

interface LoopWheelProps {
  /** Number of values: the wheel shows 0..count-1 and wraps. */
  count: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel?: string;
}

export const LoopWheel: React.FC<LoopWheelProps> = ({ count, value, onChange, format, ariaLabel }) => {
  // Continuous position in item units, unbounded (mod count = value).
  const [offset, setOffset] = useState<number>(value);
  const offsetRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const lastYRef = useRef(0);
  const movedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velRef = useRef(0); // items per (60fps) frame
  const lastReportedRef = useRef(value);
  const wheelSnapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLDivElement>(null);

  const setOff = (v: number) => {
    offsetRef.current = v;
    setOffset(v);
  };

  // Report through a ref so long-lived rAF loops (momentum, settle)
  // always see the latest onChange closure — otherwise a spin on one
  // wheel could clobber a concurrent change from its sibling wheel
  // via a stale parent closure.
  const reportRef = useRef<(off: number) => void>(() => {});
  reportRef.current = (off: number) => {
    const v = mod(Math.round(off), count);
    if (v !== lastReportedRef.current) {
      lastReportedRef.current = v;
      onChange(v);
    }
  };
  const report = (off: number) => reportRef.current(off);

  const stopAnim = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  /** Glide to the nearest (or a given) detent. */
  const settleTo = (target?: number) => {
    const t = target ?? Math.round(offsetRef.current);
    stopAnim();
    const step = () => {
      const diff = t - offsetRef.current;
      if (Math.abs(diff) < 0.004) {
        setOff(t);
        report(t);
        rafRef.current = null;
        return;
      }
      setOff(offsetRef.current + diff * 0.22);
      report(offsetRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  /** Post-fling momentum, decaying into a detent snap. */
  const momentum = () => {
    stopAnim();
    const step = () => {
      velRef.current *= 0.94;
      const next = offsetRef.current + velRef.current;
      setOff(next);
      report(next);
      if (Math.abs(velRef.current) < 0.02) {
        rafRef.current = null;
        settleTo();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // Sync from the controlled value when idle (hydration, AI edits) —
  // travel the short way around the loop to the new value.
  useEffect(() => {
    if (draggingRef.current || rafRef.current !== null) return;
    const cur = mod(Math.round(offsetRef.current), count);
    if (cur === value) return;
    const base = Math.round(offsetRef.current);
    let delta = mod(value - base, count);
    if (delta > count / 2) delta -= count;
    lastReportedRef.current = value;
    setOff(base + delta);
  }, [value, count]);

  // Mouse scroll wheel — needs a native non-passive listener so
  // preventDefault reliably stops the page from scrolling.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      const next = offsetRef.current + (e.deltaY / IH) * 0.35;
      setOff(next);
      report(next);
      if (wheelSnapTimerRef.current) clearTimeout(wheelSnapTimerRef.current);
      wheelSnapTimerRef.current = setTimeout(() => settleTo(), 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  // Cleanup any in-flight animation on unmount.
  useEffect(() => () => {
    stopAnim();
    if (wheelSnapTimerRef.current) clearTimeout(wheelSnapTimerRef.current);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    stopAnim();
    startYRef.current = e.clientY;
    lastYRef.current = e.clientY;
    movedRef.current = 0;
    velRef.current = 0;
    lastTimeRef.current = performance.now();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dy = e.clientY - lastYRef.current;
    lastYRef.current = e.clientY;
    movedRef.current += Math.abs(dy);
    const now = performance.now();
    const dt = Math.max(1, now - lastTimeRef.current);
    lastTimeRef.current = now;
    const dItems = -dy / IH;
    velRef.current = dItems * (16.7 / dt);
    const next = offsetRef.current + dItems;
    setOff(next);
    report(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // A press with almost no travel is a tap — glide to the tapped row.
    if (movedRef.current < 6) {
      const rect = e.currentTarget.getBoundingClientRect();
      const rowDelta = Math.round((e.clientY - (rect.top + rect.height / 2)) / IH);
      settleTo(Math.round(offsetRef.current) + rowDelta);
      return;
    }
    if (Math.abs(velRef.current) > 0.05) momentum();
    else settleTo();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    stopAnim();
    settleTo(Math.round(offsetRef.current) + (e.key === 'ArrowDown' ? 1 : -1));
  };

  // Rows around the current position. Values wrap via mod so the list
  // reads ...58, 59, 0, 1, 2... at the seam.
  const first = Math.floor(offset) - RENDER_SPAN;
  const rows: Array<{ k: number; v: number; d: number }> = [];
  for (let k = first; k <= first + RENDER_SPAN * 2 + 1; k++) {
    rows.push({ k, v: mod(k, count), d: k - offset });
  }

  return (
    <div
      ref={elRef}
      className="rcx-wheel"
      style={{ height: HEIGHT, WebkitMaskImage: WHEEL_MASK, maskImage: WHEEL_MASK }}
      role="spinbutton"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {rows.map(({ k, v, d }) => {
        const dist = Math.min(Math.abs(d), 2.6);
        return (
          <div
            key={k}
            className={`rcx-wheel-item${Math.abs(d) < 0.5 ? ' is-active' : ''}`}
            style={{
              transform: `translateY(${d * IH}px) scale(${1 - dist * 0.06})`,
              opacity: 1 - dist * 0.28,
            }}
            aria-hidden
          >
            {format ? format(v) : v}
          </div>
        );
      })}
    </div>
  );
};
