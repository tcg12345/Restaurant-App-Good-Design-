// Step 4 — the method. Steps can be grouped into named sections (e.g.
// "For the duxelles", "For the crêpes", "Assembly") for multi-component
// dishes; a recipe with a single unnamed section just reads as a plain
// flat list. Each step card has title, body, reorder arrows, delete, and
// the two add-chip buttons (time + tip). Steps are numbered continuously
// across sections.

import React from 'react';
import { ArrowUp, ArrowDown, Trash2, Clock, Lightbulb, Plus, X } from 'lucide-react';
import type { RecipeStepDetail } from '../../contexts/ListsContext';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

interface StepCardProps {
  step: RecipeStepDetail;
  /** 1-based display number, continuous across sections. */
  number: number;
  groupIndex: number;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  dispatch: React.Dispatch<Action>;
}

const StepCard: React.FC<StepCardProps> = ({
  step, number, groupIndex, index, canMoveUp, canMoveDown, canDelete, dispatch,
}) => {
  const update = (next: RecipeStepDetail) =>
    dispatch({ type: 'UPDATE_STEP', groupIndex, index, step: next });

  return (
    <div className="arb-step-card">
      <div className="arb-step-card-head">
        <span className="arb-step-card-num">{number}</span>
        <input
          type="text"
          className="arb-step-card-title"
          value={step.title || ''}
          onChange={(e) => update({ ...step, title: e.target.value })}
          placeholder={`Step ${number} title (e.g. "Render the guanciale")`}
        />
        <div className="arb-step-card-actions">
          <button
            type="button"
            className="arb-step-card-action"
            onClick={() => dispatch({ type: 'MOVE_STEP', groupIndex, index, direction: -1 })}
            disabled={!canMoveUp}
            aria-label="Move up"
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className="arb-step-card-action"
            onClick={() => dispatch({ type: 'MOVE_STEP', groupIndex, index, direction: 1 })}
            disabled={!canMoveDown}
            aria-label="Move down"
          >
            <ArrowDown size={15} />
          </button>
          <button
            type="button"
            className="arb-step-card-action"
            onClick={() => dispatch({ type: 'REMOVE_STEP', groupIndex, index })}
            disabled={!canDelete}
            aria-label="Delete step"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <textarea
        className="arb-step-card-body"
        value={step.body}
        onChange={(e) => update({ ...step, body: e.target.value })}
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
              onChange={(e) => update({ ...step, durationMin: Math.max(0, parseInt(e.target.value || '0', 10)) })}
            />
            <span>min</span>
            <X
              size={12}
              className="x"
              onClick={() => update({ ...step, durationMin: undefined })}
            />
          </span>
        ) : (
          <button
            type="button"
            className="arb-step-add-chip"
            onClick={() => update({ ...step, durationMin: 5 })}
          >
            <Clock size={12} /> Add time
          </button>
        )}
        {step.tip === undefined && (
          <button
            type="button"
            className="arb-step-add-chip"
            onClick={() => update({ ...step, tip: '' })}
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
            onChange={(e) => update({ ...step, tip: e.target.value })}
            placeholder="A pro tip readers will thank you for"
            autoFocus={!step.tip}
          />
          <button
            type="button"
            className="arb-step-tip-remove"
            onClick={() => update({ ...step, tip: undefined })}
            aria-label="Remove tip"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export const StepMethod: React.FC<Props> = ({ state, dispatch }) => {
  // Section chrome (name + reorder + delete) appears once there's more
  // than one section. A lone section stays a clean flat list.
  const grouped = state.stepGroups.length > 1;
  // Running display number so steps count continuously across sections.
  let stepNumber = 0;

  return (
    <>
      {state.stepGroups.map((group, gi) => (
        <div key={gi} className={grouped ? 'arb-method-section' : undefined}>
          {grouped && (
            <div className="arb-method-section-head">
              <input
                type="text"
                className="arb-section-card-title"
                value={group.name}
                onChange={(e) => dispatch({ type: 'RENAME_STEP_GROUP', index: gi, name: e.target.value })}
                placeholder="Section name (e.g. For the duxelles)"
              />
              <div className="arb-method-section-actions">
                <button
                  type="button"
                  className="arb-step-card-action"
                  onClick={() => dispatch({ type: 'MOVE_STEP_GROUP', index: gi, direction: -1 })}
                  disabled={gi === 0}
                  aria-label="Move section up"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="arb-step-card-action"
                  onClick={() => dispatch({ type: 'MOVE_STEP_GROUP', index: gi, direction: 1 })}
                  disabled={gi === state.stepGroups.length - 1}
                  aria-label="Move section down"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="arb-section-card-delete"
                  onClick={() => dispatch({ type: 'REMOVE_STEP_GROUP', index: gi })}
                  aria-label="Delete section"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )}

          {group.steps.map((step, i) => {
            stepNumber += 1;
            return (
              <StepCard
                key={i}
                step={step}
                number={stepNumber}
                groupIndex={gi}
                index={i}
                canMoveUp={i > 0}
                canMoveDown={i < group.steps.length - 1}
                canDelete={!(state.stepGroups.length === 1 && group.steps.length === 1)}
                dispatch={dispatch}
              />
            );
          })}

          <button
            type="button"
            className="arb-add-step"
            onClick={() => dispatch({ type: 'ADD_STEP', groupIndex: gi })}
          >
            <Plus size={16} /> Add step
          </button>
        </div>
      ))}

      <button
        type="button"
        className="arb-add-section"
        onClick={() => dispatch({ type: 'ADD_STEP_GROUP' })}
      >
        <Plus size={16} /> Add a section
      </button>
    </>
  );
};
