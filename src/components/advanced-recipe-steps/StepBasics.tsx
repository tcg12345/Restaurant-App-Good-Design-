// Step 1 of the Advanced Recipe Builder.
// The writing: recipe name (req), one-line summary (req), and an optional
// longer intro paragraph. Cuisine / course / difficulty / hero image live
// on Step 2 (StepDetails) so neither step overflows the pane.

import React from 'react';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

export const StepBasics: React.FC<Props> = ({ state, dispatch }) => {
  return (
    <>
      <div className="arb-field">
        <label className="arb-label">
          Recipe name <span className="req">*</span>
        </label>
        <input
          type="text"
          className="arb-input is-title"
          value={state.name}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
          placeholder="Spring Pea Carbonara"
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          One-line summary <span className="req">*</span>
        </label>
        <textarea
          className="arb-textarea"
          value={state.summary}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'summary', value: e.target.value })}
          placeholder="Glossy, peppery, and brightened by sweet spring peas — a Roman classic that comes together in under an hour."
          rows={2}
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Intro paragraph <span className="opt">optional</span>
        </label>
        <textarea
          className="arb-textarea"
          value={state.introParagraph}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'introParagraph', value: e.target.value })}
          placeholder="A longer welcome for the top of the recipe page — the story, what makes it special. Leave blank to reuse your summary."
          rows={5}
        />
      </div>
    </>
  );
};
