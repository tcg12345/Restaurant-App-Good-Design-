// Step 3 — grouped ingredient sections with smart per-row inputs.
//
// Each row keeps the same intelligence as before:
//   - Amount input live-parses on blur ("0.5" → "1/2", "1 1/2" stays,
//     "1.5" → "1 1/2"). Invalid amounts get an error tint without
//     overwriting what the user typed so they can fix it.
//   - Unit input is a combobox: focus opens a dropdown of every UNIT
//     label, typing filters it, click selects + closes. On blur with
//     unrecognized text, we run normalizeUnit so "tbls" or "tablespoon"
//     still snap to "tbsp".
//   - Name input auto-parses a full pasted line ("1 1/2 cups flour")
//     into the three columns when amount + unit are still empty.
//
// A lone default section renders as a flat list (no header); adding a
// section turns on the serif section-name rows. "Paste a list instead"
// parses free text through the shared parseIngredientLine helper.

import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ClipboardPaste, ChevronDown, ListPlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { RecipeIngredient } from '../../contexts/ListsContext';
import {
  parseIngredientLine,
  parseAmount,
  toFraction,
  displayAmount,
  normalizeUnit,
  UNITS,
} from '../../lib/ingredient-parsing';
import { LinkedRecipesEditor } from './LinkedRecipesEditor';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
  /** Id of the meal being edited (so the link picker excludes it). */
  existingId?: string | null;
}

interface RowProps {
  ingredient: RecipeIngredient;
  onChange: (next: RecipeIngredient) => void;
  onRemove: () => void;
}

const Row: React.FC<RowProps> = ({ ingredient, onChange, onRemove }) => {
  const [amountError, setAmountError] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [unitSearch, setUnitSearch] = useState('');
  const unitInputRef = useRef<HTMLInputElement>(null);

  // Unit dropdown options — UNITS labels filtered by the typed search.
  // The leading '' option lets the user clear the unit field by picking
  // from the dropdown (mirrors the basic modal).
  const filteredUnits = useMemo<string[]>(() => {
    const q = unitSearch.trim().toLowerCase();
    const labels = UNITS.map((u) => u.label);
    if (!q) return ['', ...labels];
    return ['', ...labels.filter((l) => l.toLowerCase().includes(q))];
  }, [unitSearch]);

  const handleAmountChange = (raw: string) => {
    onChange({ ...ingredient, amount: raw });
    if (amountError) setAmountError(false);
  };

  // On blur, validate + normalize the amount. Empty is fine; an
  // unparseable value flags the field in red but keeps the typed
  // text so the user can correct it.
  const handleAmountBlur = () => {
    const raw = ingredient.amount.trim();
    if (!raw) {
      setAmountError(false);
      return;
    }
    const parsed = parseAmount(raw);
    if (parsed === null) {
      setAmountError(true);
      return;
    }
    setAmountError(false);
    const pretty = toFraction(parsed);
    if (pretty && pretty !== raw) onChange({ ...ingredient, amount: pretty });
  };

  const handleUnitFocus = () => {
    setUnitOpen(true);
    setUnitSearch('');
  };

  const handleUnitTyping = (raw: string) => {
    setUnitOpen(true);
    setUnitSearch(raw);
  };

  const pickUnit = (label: string) => {
    onChange({ ...ingredient, unit: label });
    setUnitOpen(false);
    setUnitSearch('');
    // Defer blur so the next field gets focus instead of the unit input.
    unitInputRef.current?.blur();
  };

  // When the dropdown closes via backdrop-click or escape, snap the
  // typed search to a canonical UNITS label if it normalizes.
  const closeUnitDropdown = () => {
    if (unitSearch.trim()) {
      const matched = normalizeUnit(unitSearch);
      if (matched) onChange({ ...ingredient, unit: matched });
    }
    setUnitOpen(false);
    setUnitSearch('');
  };

  // Name input auto-parses a full pasted line into three columns when
  // amount + unit are still empty (matches the prior Advanced behavior).
  const handleNameChange = (raw: string) => {
    if (!ingredient.amount && !ingredient.unit && /\s/.test(raw)) {
      const parsed = parseIngredientLine(raw);
      if (parsed && parsed.amount) {
        onChange({
          name: parsed.name,
          amount: displayAmount(parsed.amount),
          unit: parsed.unit,
        });
        return;
      }
    }
    onChange({ ...ingredient, name: raw });
  };

  return (
    <div className="rcx-ing-row">
      <input
        type="text"
        inputMode="decimal"
        aria-label="Amount"
        className={cn('rcx-ing-input rcx-ing-qty', amountError && 'is-error')}
        value={ingredient.amount}
        onChange={(e) => handleAmountChange(e.target.value)}
        onBlur={handleAmountBlur}
        placeholder="1½"
        title={amountError ? 'Not a valid number' : undefined}
      />
      <div className={cn('rcx-ing-unit-wrap', unitOpen && 'is-open')}>
        <input
          ref={unitInputRef}
          type="text"
          aria-label="Unit"
          className="rcx-ing-input rcx-ing-unit"
          value={unitOpen ? unitSearch : ingredient.unit}
          onFocus={handleUnitFocus}
          onChange={(e) => handleUnitTyping(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeUnitDropdown(); }
            else if (e.key === 'Enter' && filteredUnits.length > 0) {
              e.preventDefault();
              // Pick the top match (skip the empty placeholder if there's a real one).
              const target = filteredUnits.find((l) => l !== '') ?? '';
              pickUnit(target);
            }
          }}
          placeholder="cups"
        />
        <ChevronDown size={12} className="rcx-ing-unit-caret" />
        {unitOpen && (
          <>
            <div className="rcx-ing-unit-backdrop" onClick={closeUnitDropdown} />
            <div className="rcx-ing-unit-pop">
              {filteredUnits.length === 0 ? (
                <p className="rcx-ing-unit-empty">No matches</p>
              ) : (
                filteredUnits.map((label) => (
                  <button
                    key={label || '_none'}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickUnit(label)}
                    className={cn('rcx-ing-unit-item', ingredient.unit === label && 'is-active')}
                  >
                    {label || <span className="rcx-ing-unit-none">(no unit)</span>}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <input
        type="text"
        aria-label="Ingredient"
        className="rcx-ing-input rcx-ing-name"
        value={ingredient.name}
        onChange={(e) => handleNameChange(e.target.value)}
        placeholder="ingredient, note after a comma"
      />
      <button type="button" className="rcx-ghost-delete" onClick={onRemove} aria-label="Delete">
        <Trash2 size={13} />
      </button>
    </div>
  );
};

export const StepIngredients: React.FC<Props> = ({ state, dispatch, existingId }) => {
  const [bulkOpen, setBulkOpen] = useState<number | null>(null); // group index for bulk paste
  const [bulkText, setBulkText] = useState('');

  // A single default group reads as a flat list; section chrome appears
  // once there's more than one group (or the lone group was renamed).
  const showSections = state.ingredientGroups.length > 1
    || (state.ingredientGroups.length === 1 && state.ingredientGroups[0].name.trim() !== 'Ingredients' && state.ingredientGroups[0].name.trim() !== '');

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

  const lastGroup = state.ingredientGroups.length - 1;

  return (
    <div className="rcx-stack is-tight">
      {state.ingredientGroups.map((group, gi) => (
        <div key={gi} className="rcx-ing-group">
          {showSections && (
            <div className="rcx-section-head">
              <input
                type="text"
                className="rcx-section-name"
                value={group.name}
                onChange={(e) => dispatch({ type: 'RENAME_GROUP', index: gi, name: e.target.value })}
                placeholder="Section name (e.g. For the sauce)"
              />
              {state.ingredientGroups.length > 1 && (
                <button
                  type="button"
                  className="rcx-ghost-delete"
                  onClick={() => dispatch({ type: 'REMOVE_GROUP', index: gi })}
                  aria-label="Delete section"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}

          <div className="rcx-ing-rows">
            {group.ingredients.map((ing, ii) => (
              <Row
                key={ii}
                ingredient={ing}
                onChange={(next) => dispatch({ type: 'UPDATE_INGREDIENT', groupIndex: gi, index: ii, ingredient: next })}
                onRemove={() => dispatch({ type: 'REMOVE_INGREDIENT', groupIndex: gi, index: ii })}
              />
            ))}
            {group.ingredients.length === 0 && (
              <button
                type="button"
                className="rcx-ing-empty"
                onClick={() => dispatch({ type: 'ADD_INGREDIENT', groupIndex: gi })}
              >
                <Plus size={13} strokeWidth={2.2} /> Add the first ingredient
              </button>
            )}
          </div>

          {showSections && group.ingredients.length > 0 && (
            <button
              type="button"
              className="rcx-add-dash is-inline"
              onClick={() => dispatch({ type: 'ADD_INGREDIENT', groupIndex: gi })}
            >
              <Plus size={13} strokeWidth={2.2} /> Ingredient
            </button>
          )}

          {bulkOpen === gi && (
            <div className="rcx-paste">
              <textarea
                className="rcx-area"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`One ingredient per line:\n2 cups flour\n1/2 tsp salt\n3 eggs, room temperature`}
                rows={4}
                autoFocus
              />
              <div className="rcx-paste-actions">
                <button type="button" className="rcx-mini-primary" onClick={() => handleBulk(gi)}>
                  Add ingredients
                </button>
                <button type="button" className="rcx-mini-ghost" onClick={() => { setBulkOpen(null); setBulkText(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="rcx-add-pair">
        {!showSections && (
          <button
            type="button"
            className="rcx-add-dash"
            onClick={() => dispatch({ type: 'ADD_INGREDIENT', groupIndex: lastGroup })}
          >
            <Plus size={13} strokeWidth={2.2} /> Ingredient
          </button>
        )}
        <button
          type="button"
          className="rcx-add-dash"
          onClick={() => dispatch({ type: 'ADD_GROUP' })}
        >
          <ListPlus size={13} strokeWidth={2} /> Section
        </button>
      </div>

      {bulkOpen === null && (
        <button
          type="button"
          className="rcx-paste-link"
          onClick={() => setBulkOpen(lastGroup)}
        >
          <ClipboardPaste size={13} /> Paste a list instead
        </button>
      )}

      <LinkedRecipesEditor
        state={state}
        dispatch={dispatch}
        defaultPlacement="ingredients"
        excludeId={existingId}
      />
    </div>
  );
};
