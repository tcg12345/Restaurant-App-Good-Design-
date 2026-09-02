// Step 1 of the Advanced Recipe Builder — "The basics".
// Name (serif underline), an optional one-line summary, then two small
// sections: Time and Servings.
//
// Prep and cook are a pair of side-by-side LOOPING wheels — the Clock-app
// gesture: flick, and it never hits an end. Each is ONE wheel over the
// non-linear duration scale in lib/duration-scale (per-minute up to half
// an hour, coarsening to 30-minute strides out at the overnight end), so a
// flick covers the range recipes actually use without hour/minute pairs
// or a hundred rows of minutes, and the centre row IS the readout — no
// label to keep in sync. Servings stays a stepper: a small integer you
// nudge.

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';
import { DURATION_STEPS, minutesForStep, stepForMinutes, formatDuration } from '../../lib/duration-scale';
import { LoopWheel } from './LoopWheel';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

const WHEEL_COUNT = DURATION_STEPS + 1;
const formatStep = (step: number) => {
  const m = minutesForStep(step);
  return m ? formatDuration(m) : 'None';
};

/** One time column: eyebrow label over a looping wheel. */
const DurationWheel: React.FC<{
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
}> = ({ label, minutes, onChange }) => (
  <div className="rcx-time-col">
    <span className="rcx-time-col-label">{label}</span>
    <LoopWheel
      count={WHEEL_COUNT}
      value={stepForMinutes(minutes)}
      onChange={(step) => onChange(minutesForStep(step))}
      format={formatStep}
      ariaLabel={`${label} time`}
    />
  </div>
);

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
        <div className="rcx-kicker">One-line summary<span className="rcx-kicker-opt"> · optional</span></div>
        <textarea
          className="rcx-line-area"
          value={state.summary}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'summary', value: e.target.value })}
          placeholder="Glossy, peppery, brightened by sweet spring peas."
          rows={2}
        />
      </div>

      <div>
        <div className="rcx-kicker">
          Time
          {total > 0 && <span className="rcx-kicker-total">Total · {formatDuration(total)}</span>}
        </div>
        <div className="rcx-card rcx-time-card">
          <DurationWheel
            label="Prep"
            minutes={state.prepTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'prepTime', value: v })}
          />
          <DurationWheel
            label="Cook"
            minutes={state.cookTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'cookTime', value: v })}
          />
        </div>
      </div>

      <div>
        <div className="rcx-kicker">Servings</div>
        <div className="rcx-card rcx-serves-card">
          <span className="rcx-time-name">Serves</span>
          <div className="rcx-stepper">
            <button
              type="button"
              className="rcx-stepper-btn"
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'servings', value: Math.max(1, state.servings - 1) })}
              disabled={state.servings <= 1}
              aria-label="Decrease servings"
            >
              <Minus size={14} strokeWidth={2.4} />
            </button>
            <span className="rcx-stepper-value">{state.servings}</span>
            <button
              type="button"
              className="rcx-stepper-btn"
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'servings', value: Math.min(99, state.servings + 1) })}
              disabled={state.servings >= 99}
              aria-label="Increase servings"
            >
              <Plus size={14} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
