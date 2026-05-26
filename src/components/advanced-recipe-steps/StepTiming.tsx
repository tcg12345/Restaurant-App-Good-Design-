// Step 2 — prep / cook / rest dual h+m inputs, total time row,
// servings stepper, free-text yield description.

import React, { useState } from 'react';
import { Minus, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

interface TimeCardProps {
  label: string;
  totalMin: number;
  onChange: (totalMin: number) => void;
}

/** Splits a minutes total into h + m for the two-input row. Whichever
 *  field the user is typing in, the other re-derives from the new
 *  total so the displayed total stays consistent. */
const TimeCard: React.FC<TimeCardProps> = ({ label, totalMin, onChange }) => {
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  const setHours = (n: number) => onChange(Math.max(0, n) * 60 + minutes);
  const setMinutes = (n: number) => onChange(hours * 60 + Math.max(0, Math.min(59, n)));
  return (
    <div className="arb-time-card">
      <div className="arb-time-card-label">{label}</div>
      <div className="arb-time-card-row">
        <input
          type="number"
          className="arb-time-card-num"
          value={hours || ''}
          placeholder="0"
          min={0}
          onChange={(e) => setHours(parseInt(e.target.value || '0', 10))}
        />
        <span className="arb-time-card-unit">h</span>
        <input
          type="number"
          className="arb-time-card-num"
          value={minutes || ''}
          placeholder="0"
          min={0}
          max={59}
          onChange={(e) => setMinutes(parseInt(e.target.value || '0', 10))}
        />
        <span className="arb-time-card-unit">min</span>
      </div>
    </div>
  );
};

function formatTotal(min: number): string {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export const StepTiming: React.FC<Props> = ({ state, dispatch }) => {
  const [totalOpen, setTotalOpen] = useState(true);
  const total = state.prepTime + state.cookTime + state.chillTime;

  return (
    <>
      <div className="arb-field">
        <label className="arb-label">
          How long does it take? <span className="req">*</span>
        </label>
        <p className="arb-help">Be honest — readers cross-check against the steps below.</p>
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
          <TimeCard
            label="Rest / Chill"
            totalMin={state.chillTime}
            onChange={(v) => dispatch({ type: 'SET_FIELD', field: 'chillTime', value: v })}
          />
        </div>
        <button
          type="button"
          className="arb-total-row"
          onClick={() => setTotalOpen(!totalOpen)}
        >
          <span>Total time</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            {totalOpen && <span className="v">{formatTotal(total)}</span>}
            {totalOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>
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
