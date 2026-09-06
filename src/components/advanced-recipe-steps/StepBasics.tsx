// Recipe identity, direct time entry, and a bounded servings stepper.
import React from 'react';
import { Minus, Plus } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';
import { formatDuration } from '../../lib/duration-scale';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

export const StepBasics: React.FC<Props> = ({ state, dispatch }) => {
  const total = state.prepTime + state.cookTime;
  return (
    <div className="rcx-stack">
      <div>
        <div className="rcx-kicker">Recipe name</div>
        <input
          type="text"
          aria-label="Recipe name"
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
          aria-label="Recipe summary"
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
          {(['prepTime', 'cookTime'] as const).map(field => <label key={field} className="creator-time-field">
            <span>{field === 'prepTime' ? 'Prep' : 'Cook'}</span>
            <div><input type="number" inputMode="numeric" min={0} max={10080} aria-label={field === 'prepTime' ? 'Prep time in minutes' : 'Cook time in minutes'}
              value={state[field] || ''} placeholder="0" onChange={event => dispatch({ type: 'SET_FIELD', field, value: Math.max(0, Math.min(10080, Number(event.target.value) || 0)) })} /><small>min</small></div>
          </label>)}
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
