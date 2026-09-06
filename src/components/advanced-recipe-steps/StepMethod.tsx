// Step 4 — the method. Steps can be grouped into named sections (e.g.
// "For the duxelles", "Assembly") for multi-component dishes; a recipe
// with a single unnamed section reads as a plain flat list. Each step
// card: ink number badge, title, description, and dashed Time / Tip
// chips that morph into an inline accent pill / callout. Steps are
// numbered continuously across sections.

import React from 'react';
import { ChevronUp, ChevronDown, Trash2, Clock, Lightbulb, Plus, X, ListPlus } from 'lucide-react';
import type { RecipeStepDetail } from '../../contexts/ListsContext';
import { LinkedRecipesEditor } from './LinkedRecipesEditor';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
  /** Id of the meal being edited (so the link picker excludes it). */
  existingId?: string | null;
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
    <div className="rcx-step-card">
      <div className="rcx-step-head">
        <span className="rcx-step-num">{number}</span>
        <input
          type="text"
          className="rcx-step-name"
          value={step.title || ''}
          onChange={(e) => update({ ...step, title: e.target.value })}
          placeholder="Step title (e.g. Render the guanciale)"
        />
        <span className="rcx-step-actions">
          <button
            type="button"
            className="rcx-ghost-move"
            onClick={() => dispatch({ type: 'MOVE_STEP', groupIndex, index, direction: -1 })}
            disabled={!canMoveUp}
            aria-label="Move up"
          >
            <ChevronUp size={13} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="rcx-ghost-move"
            onClick={() => dispatch({ type: 'MOVE_STEP', groupIndex, index, direction: 1 })}
            disabled={!canMoveDown}
            aria-label="Move down"
          >
            <ChevronDown size={13} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="rcx-ghost-delete"
            onClick={() => dispatch({ type: 'REMOVE_STEP', groupIndex, index })}
            disabled={!canDelete}
            aria-label="Delete step"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      <textarea
        aria-label={`Step ${number} instructions`}
        className="rcx-step-body"
        value={step.body}
        onChange={(e) => update({ ...step, body: e.target.value })}
        placeholder="Describe what to do. Tell readers what to look for — sights, sounds, smells."
        rows={2}
      />

      <div className="rcx-step-chips">
        {step.durationMin !== undefined ? (
          <span className="rcx-time-chip">
            <Clock size={11} strokeWidth={2.2} />
            <input
              type="number"
              min={0}
              value={step.durationMin}
              onChange={(e) => update({ ...step, durationMin: Math.max(0, parseInt(e.target.value || '0', 10)) })}
              aria-label="Step time in minutes"
            />
            <span>min</span>
            <button
              type="button"
              onClick={() => update({ ...step, durationMin: undefined })}
              aria-label="Remove time"
            >
              <X size={10} strokeWidth={2.6} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="rcx-chip-dash"
            onClick={() => update({ ...step, durationMin: 5 })}
          >
            <Clock size={11} strokeWidth={2.2} /> Time
          </button>
        )}
        {step.tip === undefined && (
          <button
            type="button"
            className="rcx-chip-dash"
            onClick={() => update({ ...step, tip: '' })}
          >
            <Lightbulb size={11} strokeWidth={2.2} /> Tip
          </button>
        )}
      </div>

      {step.tip !== undefined && (
        <div className="rcx-tip-callout">
          <span className="rcx-tip-label">TIP</span>
          <input
            type="text"
            value={step.tip}
            onChange={(e) => update({ ...step, tip: e.target.value })}
            placeholder="Keep the pan moving here."
            autoFocus={!step.tip}
          />
          <button
            type="button"
            onClick={() => update({ ...step, tip: undefined })}
            aria-label="Remove tip"
          >
            <X size={11} strokeWidth={2.4} />
          </button>
        </div>
      )}
    </div>
  );
};

export const StepMethod: React.FC<Props> = ({ state, dispatch, existingId }) => {
  // Section chrome (name + reorder + delete) appears once there's more
  // than one section. A lone section stays a clean flat list.
  const grouped = state.stepGroups.length > 1;
  // Running display number so steps count continuously across sections.
  let stepNumber = 0;

  return (
    <div className="rcx-stack is-tight">
      {state.stepGroups.map((group, gi) => (
        <div key={gi} className="rcx-step-group">
          {grouped && (
            <div className="rcx-section-head">
              <input
                type="text"
                className="rcx-section-name"
                value={group.name}
                onChange={(e) => dispatch({ type: 'RENAME_STEP_GROUP', index: gi, name: e.target.value })}
                placeholder="Section name (e.g. Make the sauce)"
              />
              <span className="rcx-step-actions">
                <button
                  type="button"
                  className="rcx-ghost-move"
                  onClick={() => dispatch({ type: 'MOVE_STEP_GROUP', index: gi, direction: -1 })}
                  disabled={gi === 0}
                  aria-label="Move section up"
                >
                  <ChevronUp size={13} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  className="rcx-ghost-move"
                  onClick={() => dispatch({ type: 'MOVE_STEP_GROUP', index: gi, direction: 1 })}
                  disabled={gi === state.stepGroups.length - 1}
                  aria-label="Move section down"
                >
                  <ChevronDown size={13} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  className="rcx-ghost-delete"
                  onClick={() => dispatch({ type: 'REMOVE_STEP_GROUP', index: gi })}
                  aria-label="Delete section"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          )}

          <div className="rcx-step-cards">
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
          </div>

          {grouped && (
            <button
              type="button"
              className="rcx-add-dash is-inline"
              onClick={() => dispatch({ type: 'ADD_STEP', groupIndex: gi })}
            >
              <Plus size={13} strokeWidth={2.2} /> Step
            </button>
          )}
        </div>
      ))}

      <div className="rcx-add-pair">
        {!grouped && (
          <button
            type="button"
            className="rcx-add-dash"
            onClick={() => dispatch({ type: 'ADD_STEP', groupIndex: state.stepGroups.length - 1 })}
          >
            <Plus size={13} strokeWidth={2.2} /> Step
          </button>
        )}
        <button
          type="button"
          className="rcx-add-dash"
          onClick={() => dispatch({ type: 'ADD_STEP_GROUP' })}
        >
          <ListPlus size={13} strokeWidth={2} /> Section
        </button>
      </div>

      <LinkedRecipesEditor
        state={state}
        dispatch={dispatch}
        defaultPlacement="method"
        excludeId={existingId}
      />
    </div>
  );
};
