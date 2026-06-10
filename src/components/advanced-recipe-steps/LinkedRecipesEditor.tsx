// Shared "Linked recipes" block rendered at the bottom of both the
// Ingredients and Method steps. Linking is one list on the recipe —
// the same rows appear on both steps — but each ref carries placement
// flags (inIngredients / inMethod) deciding where it surfaces on the
// published recipe page. Adding from the Ingredients step defaults the
// link into ingredients; adding from the Method step into the method.

import React, { useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import type { LinkedRecipeRef } from '../../contexts/ListsContext';
import { RecipeLinkPicker, type PickedRecipe } from '../RecipeLinkPicker';
import { cn } from '../../lib/utils';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
  /** Which placement a newly linked recipe gets by default. */
  defaultPlacement: 'ingredients' | 'method';
  /** Id of the meal being edited so the picker can exclude it. */
  excludeId?: string | null;
}

export const LinkedRecipesEditor: React.FC<Props> = ({ state, dispatch, defaultPlacement, excludeId }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const linked = state.linkedRecipes;

  const handlePick = (recipe: PickedRecipe) => {
    dispatch({
      type: 'ADD_LINKED_RECIPE',
      recipe: {
        ...recipe,
        inIngredients: defaultPlacement === 'ingredients',
        inMethod: defaultPlacement === 'method',
      },
    });
  };

  const togglePlacement = (ref: LinkedRecipeRef, field: 'inIngredients' | 'inMethod') => {
    dispatch({ type: 'TOGGLE_LINKED_PLACEMENT', id: ref.id, field });
  };

  return (
    <div className="arb-section-card arb-linked-card">
      <div className="arb-linked-head">
        <span className="arb-linked-head-icon"><Link2 size={15} /></span>
        <div>
          <h3 className="arb-linked-head-title">Linked recipes</h3>
          <p className="arb-linked-head-sub">
            Attach a component recipe — a sauce, dough, or side — and choose
            whether it shows with the ingredients, the method, or both.
          </p>
        </div>
      </div>

      {linked.map((ref) => (
        <div key={ref.id} className="arb-linked-row">
          {ref.coverPhoto && (
            <div className="arb-linked-thumb">
              <img
                src={ref.coverPhoto}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
              />
            </div>
          )}
          <div className="arb-linked-row-main">
            <div className="arb-linked-row-title">{ref.title || 'Untitled recipe'}</div>
            <div className="arb-linked-row-by">by {ref.authorName || 'unknown'}</div>
            <div className="arb-linked-row-toggles">
              <button
                type="button"
                className={cn('arb-linked-toggle', ref.inIngredients && 'is-on')}
                onClick={() => togglePlacement(ref, 'inIngredients')}
                aria-pressed={ref.inIngredients}
              >
                Ingredients
              </button>
              <button
                type="button"
                className={cn('arb-linked-toggle', ref.inMethod && 'is-on')}
                onClick={() => togglePlacement(ref, 'inMethod')}
                aria-pressed={ref.inMethod}
              >
                Method
              </button>
            </div>
          </div>
          <button
            type="button"
            className="arb-linked-remove"
            onClick={() => dispatch({ type: 'REMOVE_LINKED_RECIPE', id: ref.id })}
            aria-label={`Unlink ${ref.title}`}
          >
            <X size={15} />
          </button>
        </div>
      ))}

      <button type="button" className="arb-add-row" onClick={() => setPickerOpen(true)}>
        <Plus size={14} /> Link a recipe
      </button>

      <RecipeLinkPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
        linkedIds={linked.map((r) => r.id)}
        excludeId={excludeId}
      />
    </div>
  );
};
