// Step 3 — grouped ingredient sections with per-row inputs and an
// optional bulk-paste mode that pipes through the shared parser in
// src/lib/ingredient-parsing.ts.

import React, { useState } from 'react';
import { Plus, Trash2, ClipboardPaste } from 'lucide-react';
import type { RecipeIngredient } from '../../contexts/ListsContext';
import { parseIngredientLine, displayAmount } from '../../lib/ingredient-parsing';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

/** Single ingredient row. Live-parses pasted text in the name field so
 *  "1 1/2 cups flour" auto-splits into amount/unit/name. The user can
 *  still type into any column directly. */
interface RowProps {
  ingredient: RecipeIngredient;
  onChange: (next: RecipeIngredient) => void;
  onRemove: () => void;
}

const Row: React.FC<RowProps> = ({ ingredient, onChange, onRemove }) => {
  const handleNameChange = (raw: string) => {
    // If the user pasted a full line and amount/unit are still empty,
    // try parsing it so they don't have to manually split.
    if (!ingredient.amount && !ingredient.unit && /\s/.test(raw)) {
      const parsed = parseIngredientLine(raw);
      if (parsed && parsed.amount) {
        onChange({ name: parsed.name, amount: displayAmount(parsed.amount), unit: parsed.unit });
        return;
      }
    }
    onChange({ ...ingredient, name: raw });
  };
  return (
    <div className="arb-ingr-row">
      <input
        type="text"
        className="arb-ingr-input"
        value={ingredient.amount}
        onChange={(e) => onChange({ ...ingredient, amount: e.target.value })}
        placeholder="1½"
      />
      <input
        type="text"
        className="arb-ingr-input"
        value={ingredient.unit}
        onChange={(e) => onChange({ ...ingredient, unit: e.target.value })}
        placeholder="cups"
      />
      <input
        type="text"
        className="arb-ingr-input"
        value={ingredient.name}
        onChange={(e) => handleNameChange(e.target.value)}
        placeholder="ingredient (try adding a note after a comma)"
      />
      <button type="button" className="arb-ingr-delete" onClick={onRemove} aria-label="Delete">
        <Trash2 size={15} />
      </button>
    </div>
  );
};

export const StepIngredients: React.FC<Props> = ({ state, dispatch }) => {
  const [bulkOpen, setBulkOpen] = useState<number | null>(null); // group index for bulk paste
  const [bulkText, setBulkText] = useState('');

  const handleBulk = (groupIndex: number) => {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed: RecipeIngredient[] = [];
    for (const line of lines) {
      const r = parseIngredientLine(line);
      if (!r) continue;
      parsed.push({
        name: r.name || line,
        amount: r.amount ? displayAmount(r.amount) : '',
        unit: r.unit || '',
      });
    }
    if (parsed.length > 0) {
      dispatch({ type: 'ADD_INGREDIENTS_BULK', groupIndex, ingredients: parsed });
    }
    setBulkText('');
    setBulkOpen(null);
  };

  return (
    <>
      {state.ingredientGroups.map((group, gi) => (
        <div className="arb-section-card" key={gi}>
          <div className="arb-section-card-head">
            <input
              type="text"
              className="arb-section-card-title"
              value={group.name}
              onChange={(e) => dispatch({ type: 'RENAME_GROUP', index: gi, name: e.target.value })}
              placeholder="Section name"
            />
            {state.ingredientGroups.length > 1 && (
              <button
                type="button"
                className="arb-section-card-delete"
                onClick={() => dispatch({ type: 'REMOVE_GROUP', index: gi })}
                aria-label="Delete section"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          {bulkOpen === gi ? (
            <div style={{ marginBottom: 12 }}>
              <textarea
                className="arb-textarea"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`Paste one ingredient per line:\n\n2 cups flour\n1/2 tsp salt\n3 eggs, room temperature`}
                rows={5}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="arb-add-row" onClick={() => handleBulk(gi)}>
                  <Plus size={14} /> Parse & add
                </button>
                <button type="button" className="arb-add-row" onClick={() => { setBulkOpen(null); setBulkText(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {group.ingredients.length === 0 ? (
                <div className="arb-ingr-row">
                  <input className="arb-ingr-input" placeholder="1½" disabled />
                  <input className="arb-ingr-input" placeholder="cups" disabled />
                  <input className="arb-ingr-input" placeholder="ingredient (try adding a note after a comma)" disabled />
                  <span style={{ width: 36 }} />
                </div>
              ) : (
                group.ingredients.map((ing, ii) => (
                  <Row
                    key={ii}
                    ingredient={ing}
                    onChange={(next) => dispatch({ type: 'UPDATE_INGREDIENT', groupIndex: gi, index: ii, ingredient: next })}
                    onRemove={() => dispatch({ type: 'REMOVE_INGREDIENT', groupIndex: gi, index: ii })}
                  />
                ))
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="arb-add-row"
                  onClick={() => dispatch({ type: 'ADD_INGREDIENT', groupIndex: gi })}
                >
                  <Plus size={14} /> Add ingredient
                </button>
                <button
                  type="button"
                  className="arb-bulk-toggle"
                  onClick={() => setBulkOpen(gi)}
                >
                  <ClipboardPaste size={13} /> Paste from a list
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      <button
        type="button"
        className="arb-add-section"
        onClick={() => dispatch({ type: 'ADD_GROUP' })}
      >
        <Plus size={16} /> Add another section
      </button>
    </>
  );
};
