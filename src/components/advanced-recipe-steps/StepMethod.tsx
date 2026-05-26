// Step 4 — numbered method steps with optional duration chips and tip
// callouts. Each card has title, body, reorder arrows, delete, and
// the two add-chip buttons.

import React from 'react';
import { ArrowUp, ArrowDown, Trash2, Clock, Lightbulb, Plus, X } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

export const StepMethod: React.FC<Props> = ({ state, dispatch }) => {
  return (
    <>
      {state.steps.map((step, i) => (
        <div key={i} className="arb-step-card">
          <div className="arb-step-card-head">
            <span className="arb-step-card-num">{i + 1}</span>
            <input
              type="text"
              className="arb-step-card-title"
              value={step.title || ''}
              onChange={(e) => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, title: e.target.value } })}
              placeholder={`Step ${i + 1} title (e.g. "Render the guanciale")`}
            />
            <div className="arb-step-card-actions">
              <button
                type="button"
                className="arb-step-card-action"
                onClick={() => dispatch({ type: 'MOVE_STEP', index: i, direction: -1 })}
                disabled={i === 0}
                aria-label="Move up"
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="arb-step-card-action"
                onClick={() => dispatch({ type: 'MOVE_STEP', index: i, direction: 1 })}
                disabled={i === state.steps.length - 1}
                aria-label="Move down"
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="arb-step-card-action"
                onClick={() => dispatch({ type: 'REMOVE_STEP', index: i })}
                disabled={state.steps.length === 1}
                aria-label="Delete step"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          <textarea
            className="arb-step-card-body"
            value={step.body}
            onChange={(e) => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, body: e.target.value } })}
            placeholder="Describe what to do, in detail. Tell readers what to look for — sights, sounds, smells. Specifics are gold."
            rows={3}
          />

          <div className="arb-step-card-chips">
            {step.durationMin !== undefined ? (
              <span className="arb-step-time-chip">
                <Clock size={12} />
                <input
                  type="number"
                  min={0}
                  value={step.durationMin}
                  onChange={(e) =>
                    dispatch({
                      type: 'UPDATE_STEP',
                      index: i,
                      step: { ...step, durationMin: Math.max(0, parseInt(e.target.value || '0', 10)) },
                    })
                  }
                />
                <span>min</span>
                <X
                  size={12}
                  className="x"
                  onClick={() => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, durationMin: undefined } })}
                />
              </span>
            ) : (
              <button
                type="button"
                className="arb-step-add-chip"
                onClick={() => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, durationMin: 5 } })}
              >
                <Clock size={12} /> Add time
              </button>
            )}
            {step.tip === undefined && (
              <button
                type="button"
                className="arb-step-add-chip"
                onClick={() => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, tip: '' } })}
              >
                <Lightbulb size={12} /> Add tip
              </button>
            )}
          </div>

          {step.tip !== undefined && (
            <div className="arb-step-tip">
              <span className="arb-step-tip-label">Tip</span>
              <input
                type="text"
                className="arb-step-tip-input"
                value={step.tip}
                onChange={(e) => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, tip: e.target.value } })}
                placeholder="A pro tip readers will thank you for"
                autoFocus={!step.tip}
              />
              <button
                type="button"
                className="arb-step-tip-remove"
                onClick={() => dispatch({ type: 'UPDATE_STEP', index: i, step: { ...step, tip: undefined } })}
                aria-label="Remove tip"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ))}

      <button type="button" className="arb-add-step" onClick={() => dispatch({ type: 'ADD_STEP' })}>
        <Plus size={16} /> Add step
      </button>
    </>
  );
};
