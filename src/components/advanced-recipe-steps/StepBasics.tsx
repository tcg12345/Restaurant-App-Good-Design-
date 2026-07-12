// Step 1 of the Advanced Recipe Builder — "The basics".
// Name (serif underline), one-line summary, and the Time & servings
// card: Prep and Cook side by side, each as an inline pair of
// infinitely-looping hour/minute wheels (iPhone-clock style — spin,
// flick, tap a row, or scroll), plus a serves stepper row and a running
// total. Minutes are per-minute precise; nothing snaps to 5s anymore.
// The longer intro paragraph lives in the Extras section on Review.

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';
import { LoopWheel } from './LoopWheel';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

function fmtTime(min: number): string {
  if (!min) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const pad2 = (v: number) => String(v).padStart(2, '0');

/** One column of the time card: label, live value, and the h : mm
 *  looping wheel pair. Hours wrap 0–12, minutes 0–59. */
const TimeWheelsCol: React.FC<{
  label: string;
  totalMin: number;
  onChange: (totalMin: number) => void;
}> = ({ label, totalMin, onChange }) => {
  const hours = Math.min(12, Math.floor(totalMin / 60));
  const minutes = totalMin % 60;
  return (
    <div className="rcx-tw-col">
      <div className="rcx-tw-head">
        <span className="rcx-time-name">{label}</span>
        <span className={`rcx-tw-value${totalMin ? '' : ' is-empty'}`}>{fmtTime(totalMin)}</span>
      </div>
      <div className="rcx-tw-wheels">
        <LoopWheel
          count={13}
          value={hours}
          onChange={(h) => onChange(h * 60 + minutes)}
          ariaLabel={`${label} hours`}
        />
        <span className="rcx-tw-colon" aria-hidden>:</span>
        <LoopWheel
          count={60}
          value={minutes}
          onChange={(m) => onChange(hours * 60 + m)}
          format={pad2}
          ariaLabel={`${label} minutes`}
        />
      </div>
      <div className="rcx-tw-caps">
        <span>hrs</span>
        <span className="rcx-tw-caps-sep" aria-hidden />
        <span>min</span>
      </div>
    </div>
  );
};

export const StepBasics: React.FC<Props> = ({ state, dispatch }) => {
  const total = state.prepTime + state.cookTime;
  return (
    <div className="rcx-stack">
      <div>
        <div className="rcx-kicker">Recipe name</div>
        <input
          type="text"
          className="rcx-title-input"
          value={state.name}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
          placeholder="Spring Pea Carbonara"
          autoCapitalize="words"
        />
      </div>

      <div>
        <div className="rcx-kicker">One-line summary</div>
        <textarea
          className="rcx-line-area"
          value={state.summary}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'summary', value: e.target.value })}
          placeholder="Glossy, peppery, brightened by sweet spring peas."
          rows={2}
        />
      </div>

      <div>
        <div className="rcx-kicker">Time &amp; servings</div>
        <div className="rcx-card">
          <div className="rcx-tw-grid">
            <TimeWheelsCol
              label="Prep"
              totalMin={state.prepTime}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'prepTime', value: v })}
            />
            <div className="rcx-tw-divider" aria-hidden />
            <TimeWheelsCol
              label="Cook"
              totalMin={state.cookTime}
              onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'cookTime', value: v })}
            />
          </div>
          <div className="rcx-serves-row">
            <span className="rcx-time-name">Serves</span>
            <span className="rcx-serves-value">{state.servings}</span>
            <button
              type="button"
              className="rcx-round-btn"
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'servings', value: Math.max(1, state.servings - 1) })}
              disabled={state.servings <= 1}
              aria-label="Decrease servings"
            >
              <Minus size={13} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              className="rcx-round-btn"
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'servings', value: Math.min(99, state.servings + 1) })}
              disabled={state.servings >= 99}
              aria-label="Increase servings"
            >
              <Plus size={13} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className="rcx-total-line">
          Total · <strong>{fmtTime(total)}</strong>
        </div>
      </div>
    </div>
  );
};
