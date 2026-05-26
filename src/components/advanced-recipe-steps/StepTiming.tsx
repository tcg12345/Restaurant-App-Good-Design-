// Step 2 — prep + cook time pickers (inline iOS-style wheels),
// servings stepper, free-text yield. Rest/chill removed per spec.

import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

/* ── Inline wheel picker ─────────────────────────────────────────
   Scroll-snap column. Five visible rows with a fade mask top + bottom.
   Center row is the selection — pill behind it makes it readable.
   Scroll position is the source of truth; an onScroll handler fires
   the parent's onChange when the snapped row changes. Reused for
   the hours + minutes columns inside each time card.
   ───────────────────────────────────────────────────────────── */

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PADDING = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT;
const WHEEL_MASK =
  'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.15) 14%, rgba(0,0,0,0.55) 32%, black 44%, black 56%, rgba(0,0,0,0.55) 68%, rgba(0,0,0,0.15) 86%, transparent 100%)';

interface InlineWheelProps {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel?: string;
}

const InlineWheel: React.FC<InlineWheelProps> = ({ values, value, onChange, format, ariaLabel }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Local "displayed" index drives the highlight tint. We update it
  // on every scroll event so the active row tints smoothly even while
  // a finger fling is mid-air.
  const idx = Math.max(0, values.indexOf(value));
  const [activeIdx, setActiveIdx] = useState(idx);

  // Sync scroll position when the controlled value changes externally
  // (initial mount, draft hydration, etc).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = idx * ITEM_HEIGHT;
    // Skip work when already aligned.
    if (Math.abs(el.scrollTop - target) < 1) return;
    el.scrollTop = target;
    setActiveIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const rawIdx = el.scrollTop / ITEM_HEIGHT;
    const snapped = Math.max(0, Math.min(values.length - 1, Math.round(rawIdx)));
    if (snapped !== activeIdx) {
      setActiveIdx(snapped);
      onChange(values[snapped]);
    }
  };

  const handleRowTap = (rowIdx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: rowIdx * ITEM_HEIGHT, behavior: 'smooth' });
    setActiveIdx(rowIdx);
    onChange(values[rowIdx]);
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="arb-wheel"
      style={{
        height: WHEEL_HEIGHT,
        WebkitMaskImage: WHEEL_MASK,
        maskImage: WHEEL_MASK,
      }}
      role="listbox"
      aria-label={ariaLabel}
    >
      {/* Center selection pill — sits behind the snapped row. */}
      <div className="arb-wheel-pill" style={{ height: ITEM_HEIGHT, top: `calc(50% - ${ITEM_HEIGHT / 2}px)` }} aria-hidden />
      <div style={{ height: PADDING }} aria-hidden />
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => handleRowTap(i)}
          className={`arb-wheel-row${i === activeIdx ? ' is-active' : ''}`}
          style={{ height: ITEM_HEIGHT }}
          tabIndex={-1}
        >
          {format ? format(v) : v}
        </button>
      ))}
      <div style={{ height: PADDING }} aria-hidden />
    </div>
  );
};

/* ── TimeCard ───────────────────────────────────────────────────
   One card per time field. Hours + minutes wheels side by side,
   with their unit captions underneath. Minutes step by 5 so the
   wheel stays scannable.
   ───────────────────────────────────────────────────────────── */
const HOURS_VALUES = Array.from({ length: 13 }, (_, i) => i);            // 0..12
const MINUTES_VALUES = Array.from({ length: 12 }, (_, i) => i * 5);      // 0, 5, 10 … 55

interface TimeCardProps {
  label: string;
  totalMin: number;
  onChange: (totalMin: number) => void;
}

const TimeCard: React.FC<TimeCardProps> = ({ label, totalMin, onChange }) => {
  const hours = Math.max(0, Math.min(12, Math.floor(totalMin / 60)));
  // Snap stored minutes to the nearest 5-min increment for the wheel.
  const rawMin = totalMin % 60;
  const minutes = Math.max(0, Math.min(55, Math.round(rawMin / 5) * 5));
  const setHours = (h: number) => onChange(h * 60 + minutes);
  const setMinutes = (m: number) => onChange(hours * 60 + m);
  return (
    <div className="arb-time-card">
      <div className="arb-time-card-label">{label}</div>
      <div className="arb-wheel-row-pair">
        <div className="arb-wheel-col">
          <InlineWheel
            values={HOURS_VALUES}
            value={hours}
            onChange={setHours}
            ariaLabel={`${label} hours`}
          />
          <div className="arb-wheel-unit">hours</div>
        </div>
        <div className="arb-wheel-sep" aria-hidden>:</div>
        <div className="arb-wheel-col">
          <InlineWheel
            values={MINUTES_VALUES}
            value={minutes}
            onChange={setMinutes}
            format={(v) => String(v).padStart(2, '0')}
            ariaLabel={`${label} minutes`}
          />
          <div className="arb-wheel-unit">minutes</div>
        </div>
      </div>
    </div>
  );
};

function formatTotal(min: number): string {
  if (!min) return '0 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export const StepTiming: React.FC<Props> = ({ state, dispatch }) => {
  // Rest/chill removed per spec — total = prep + cook only.
  const total = state.prepTime + state.cookTime;

  return (
    <>
      <div className="arb-field">
        <label className="arb-label">
          How long does it take? <span className="req">*</span>
        </label>
        <p className="arb-help">Spin the wheels — be honest, readers cross-check against the steps below.</p>
        <div className="arb-time-row">
          <TimeCard
            label="Prep Time"
            totalMin={state.prepTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'prepTime', value: v })}
          />
          <TimeCard
            label="Cook Time"
            totalMin={state.cookTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'cookTime', value: v })}
          />
        </div>

        {/* Total time — editorial pill. Label on the left, big serif
            value on the right, separated by a thin divider line. */}
        <div className="arb-total-pill" aria-live="polite">
          <div className="arb-total-pill-label">
            <span className="eyebrow">Total time</span>
            <span className="sub">Prep + cook</span>
          </div>
          <div className="arb-total-pill-value">{formatTotal(total)}</div>
        </div>
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Servings <span className="req">*</span>
        </label>
        <p className="arb-help">How many people will this feed at one sitting?</p>
        <div className="arb-stepper">
          <button
            type="button"
            className="arb-stepper-btn"
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'servings', value: Math.max(1, state.servings - 1) })}
            disabled={state.servings <= 1}
            aria-label="Decrease servings"
          >
            <Minus size={16} />
          </button>
          <span className="arb-stepper-value">{state.servings}</span>
          <button
            type="button"
            className="arb-stepper-btn"
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'servings', value: Math.min(99, state.servings + 1) })}
            disabled={state.servings >= 99}
            aria-label="Increase servings"
          >
            <Plus size={16} />
          </button>
          <span className="arb-stepper-label">Servings</span>
        </div>
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Yield description <span className="opt">Optional</span>
        </label>
        <p className="arb-help">e.g. "4 generous bowls", "12 cookies", "one 9-inch loaf"</p>
        <input
          type="text"
          className="arb-input"
          value={state.yieldDescription}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'yieldDescription', value: e.target.value })}
          placeholder="4 generous bowls"
        />
      </div>
    </>
  );
};
