// Step 5 — equipment (comma-separated), tags (comma-separated), and
// typed notes (Chef's Tip / Make Ahead / Substitution / General). Each
// note is its own labeled card with a removable textarea.

import React, { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import type { RecipeNote } from '../../contexts/ListsContext';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

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
  // Equipment + tags are stored as arrays but presented as one
  // comma-separated input each — keeps the UI clean and matches the
  // mockup. Local edit state buffers the raw string so commas can be
  // typed mid-word without the array re-splitting on every keystroke.
  const [equipDraft, setEquipDraft] = useState(state.equipment.join(', '));
  const [tagsDraft, setTagsDraft] = useState(state.tags.join(', '));

  const commitEquip = (raw: string) => {
    const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
    dispatch({ type: 'SET_FIELD', field: 'equipment', value: arr });
  };
  const commitTags = (raw: string) => {
    const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
    dispatch({ type: 'SET_FIELD', field: 'tags', value: arr });
  };

  return (
    <>
      <div className="arb-field">
        <label className="arb-label">
          Equipment <span className="opt">Optional</span>
        </label>
        <p className="arb-help">Tools and cookware readers should have ready before they start.</p>
        <input
          type="text"
          className="arb-input"
          value={equipDraft}
          onChange={(e) => setEquipDraft(e.target.value)}
          onBlur={(e) => commitEquip(e.target.value)}
          placeholder='12" cast-iron skillet, microplane, tongs…'
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Tags <span className="opt">Optional</span>
        </label>
        <p className="arb-help">Help people discover this — try the cuisine, dietary tags, season.</p>
        <input
          type="text"
          className="arb-input"
          value={tagsDraft}
          onChange={(e) => setTagsDraft(e.target.value)}
          onBlur={(e) => commitTags(e.target.value)}
          placeholder="pasta, spring, dinner, quick…"
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Notes & callouts <span className="opt">Optional</span>
        </label>
        <p className="arb-help">Tips, substitutions, make-ahead instructions — anything that didn't fit in a step.</p>

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
