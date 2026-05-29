// Step 5 — equipment, tags, and typed notes.
//
// Equipment + tags both use the shared ChipComboInput combobox so the
// user can pick from long pre-seeded catalogues (see lib/recipe-vocab)
// OR type custom values. Notes stay as labeled cards (Chef's Tip,
// Make Ahead, etc.) — each is its own removable textarea.

import React from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { RecipeNote } from '../../contexts/ListsContext';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';
import { ChipComboInput } from './ChipComboInput';
import { DEFAULT_RECIPE_TAGS, DEFAULT_EQUIPMENT } from '../../lib/recipe-vocab';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

const NOTE_TYPES: Array<{ type: RecipeNote['type']; label: string }> = [
  { type: 'tip', label: "Chef's tip" },
  { type: 'makeAhead', label: 'Make ahead' },
  { type: 'substitution', label: 'Substitution' },
  { type: 'general', label: 'General note' },
];

function noteLabel(t: RecipeNote['type']): string {
  return NOTE_TYPES.find((n) => n.type === t)?.label || 'Note';
}

export const StepEquipmentNotes: React.FC<Props> = ({ state, dispatch }) => {
  return (
    <>
      <div className="arb-field">
        <label className="arb-label">
          Equipment <span className="opt">optional</span>
        </label>
        <ChipComboInput
          value={state.equipment}
          onChange={(next) => dispatch({ type: 'SET_FIELD', field: 'equipment', value: next })}
          suggestions={DEFAULT_EQUIPMENT}
          placeholder='Cast iron skillet, microplane, tongs…'
          ariaLabel="Equipment"
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Tags <span className="opt">optional</span>
        </label>
        <ChipComboInput
          value={state.tags}
          onChange={(next) => dispatch({ type: 'SET_FIELD', field: 'tags', value: next })}
          suggestions={DEFAULT_RECIPE_TAGS}
          placeholder="pasta, spring, vegetarian…"
          chipPrefix="#"
          ariaLabel="Tags"
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Notes & callouts <span className="opt">optional</span>
        </label>

        {state.notes.map((note, i) => (
          <div key={i} className="arb-note-card">
            <div className="arb-note-head">
              <span className="arb-note-type" data-type={note.type}>
                {noteLabel(note.type)}
              </span>
              <button
                type="button"
                className="arb-note-delete"
                onClick={() => dispatch({ type: 'REMOVE_NOTE', index: i })}
                aria-label="Delete note"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <textarea
              className="arb-note-body"
              value={note.text}
              onChange={(e) => dispatch({ type: 'UPDATE_NOTE', index: i, note: { ...note, text: e.target.value } })}
              placeholder="Write your note. Be specific — this is where the real craft lives."
              rows={3}
            />
          </div>
        ))}

        <div className="arb-add-note-row">
          {NOTE_TYPES.map((n) => (
            <button
              key={n.type}
              type="button"
              className="arb-add-row"
              onClick={() => dispatch({ type: 'ADD_NOTE', noteType: n.type })}
            >
              <Plus size={13} /> {n.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
