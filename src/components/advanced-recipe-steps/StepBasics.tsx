// Step 1 of the Advanced Recipe Builder — "The basics".
// Name (serif underline), one-line summary, and the Time & servings
// card: prep + cook as separate HRS (0–12) / MIN (0–59) sliders with a
// live per-field label, a serves stepper row, and a running total.
// The longer intro paragraph moved to the Extras section on Review.

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

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

/** One time field: label + serif value, then HRS / MIN slider rows. */
const TimeSliders: React.FC<{
  label: string;
  totalMin: number;
  onChange: (totalMin: number) => void;
}> = ({ label, totalMin, onChange }) => {
  const hours = Math.min(12, Math.floor(totalMin / 60));
  const minutes = totalMin % 60;
  return (
    <div className="rcx-time-block">
      <div className="rcx-time-head">
        <span className="rcx-time-name">{label}</span>
        <span className={`rcx-time-value${totalMin ? '' : ' is-empty'}`}>{fmtTime(totalMin)}</span>
      </div>
      <div className="rcx-slider-row">
        <span className="rcx-slider-unit">HRS</span>
        <input
          type="range"
          min={0}
          max={12}
          step={1}
          value={hours}
          onChange={(e) => onChange(parseInt(e.target.value, 10) * 60 + minutes)}
          aria-label={`${label} hours`}
        />
        <span className="rcx-slider-num">{hours}</span>
      </div>
      <div className="rcx-slider-row">
        <span className="rcx-slider-unit">MIN</span>
        <input
          type="range"
          min={0}
          max={59}
          step={1}
          value={minutes}
          onChange={(e) => onChange(hours * 60 + parseInt(e.target.value, 10))}
          aria-label={`${label} minutes`}
        />
        <span className="rcx-slider-num">{minutes}</span>
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
          <TimeSliders
            label="Prep"
            totalMin={state.prepTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'prepTime', value: v })}
          />
          <TimeSliders
            label="Cook"
            totalMin={state.cookTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'cookTime', value: v })}
          />
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
