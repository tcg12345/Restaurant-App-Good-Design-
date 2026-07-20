// Step 5 — "Review & publish".
//   - Dark preview card: cover photo (when set), kicker line
//     (cuisine · difficulty · total time), serif name, meta counts.
//   - Your private rating — the author's personal score. Surfaced on
//     the author's profile but never on the standalone recipe page.
//   - Visibility — Public needs a cover photo (enforced here and by
//     publish-time validation); Private keeps it on your pantry.
//   - Extras (collapsed): yield, equipment, tags, and typed notes —
//     everything optional lives here so the main review stays a
//     one-screen skim.
//
// The shell owns the Publish button and the validation panel; this step
// just collects the publish-time inputs.

import React, { useState } from 'react';
import { Globe, Lock, ChevronRight, Sparkles, FileText, Trash2, Plus } from 'lucide-react';
import { flattenIngredientGroups } from '../../lib/ingredient-parsing';
import { cn } from '../../lib/utils';
import type { RecipeNote } from '../../contexts/ListsContext';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';
import { ChipComboInput } from './ChipComboInput';
import { DEFAULT_RECIPE_TAGS, DEFAULT_EQUIPMENT } from '../../lib/recipe-vocab';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
  /** Set when this session is reviewing a freshly seeded draft — an AI
   *  generation or an import. Drives the banner copy. */
  draftKind?: 'ai' | 'import';
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

function fmtTime(min: number): string {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const StepReview: React.FC<Props> = ({ state, dispatch, draftKind }) => {
  // Extras opens automatically when any of its fields already has
  // content (editing an existing recipe shouldn't hide filled fields).
  const [extrasOpen, setExtrasOpen] = useState(
    () => !!(state.yieldDescription.trim()
      || state.equipment.length || state.tags.length || state.notes.length),
  );

  const totalMin = state.prepTime + state.cookTime;
  const ingCount = flattenIngredientGroups(state.ingredientGroups).filter((i) => i.name.trim()).length;
  const stepCount = state.stepGroups.reduce(
    (sum, g) => sum + g.steps.filter((s) => (s.body || s.title || '').trim()).length, 0);

  const kicker = [state.cuisine, state.difficulty, fmtTime(totalMin)]
    .filter(Boolean).join(' · ').toUpperCase() || 'NEW RECIPE';

  return (
    <div className="rcx-stack">
      {draftKind === 'ai' && (
        <div className="rcx-ai-banner">
          <Sparkles size={14} />
          <span><strong>AI draft ready.</strong> Step back through the builder to edit anything.</span>
        </div>
      )}
      {draftKind === 'import' && (
        <div className="rcx-ai-banner">
          <FileText size={14} />
          <span><strong>Recipe imported.</strong> Check it against the original — everything is editable.</span>
        </div>
      )}

      {/* Preview */}
      <div>
        <div className="rcx-kicker">Preview</div>
        <div className="rcx-preview">
          {state.coverPhoto && (
            <img className="rcx-preview-img" src={state.coverPhoto} alt="" referrerPolicy="no-referrer" />
          )}
          <div className="rcx-preview-body">
            <div className="rcx-preview-kicker">{kicker}</div>
            <div className="rcx-preview-name">{state.name.trim() || 'Untitled recipe'}</div>
            <div className="rcx-preview-meta">
              {ingCount} {ingCount === 1 ? 'ingredient' : 'ingredients'} · {stepCount} {stepCount === 1 ? 'step' : 'steps'} · serves {state.servings}
            </div>
          </div>
        </div>
      </div>

      {/* Private rating */}
      <div>
        <div className="rcx-kicker">
          Your private rating<span className="rcx-kicker-opt"> · only you see this</span>
        </div>
        <div className="rcx-rating-row">
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={state.score}
            onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'score', value: parseFloat(e.target.value) })}
            aria-label="Your private rating"
          />
          <span className={`rcx-rating-box${state.score > 0 ? ' is-set' : ''}`}>
            {state.score > 0 ? state.score.toFixed(1) : '—'}
          </span>
        </div>
      </div>

      {/* Visibility */}
      <div>
        <div className="rcx-kicker">Visibility</div>
        <div className="rcx-vis-grid">
          <button
            type="button"
            className={cn('rcx-vis-card', state.isPublic && !state.coverPhoto && 'is-blocked', state.isPublic && 'is-on')}
            disabled={!state.coverPhoto}
            onClick={() => { if (state.coverPhoto) dispatch({ type: 'SET_FIELD', field: 'isPublic', value: true }); }}
            title={state.coverPhoto ? undefined : 'Add a cover photo to publish publicly'}
          >
            <Globe size={15} />
            <span className="rcx-vis-label">Public</span>
            <span className="rcx-vis-sub">{state.coverPhoto ? "Friends' feeds & search" : 'Add a photo first'}</span>
          </button>
          <button
            type="button"
            className={cn('rcx-vis-card', !state.isPublic && 'is-on')}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'isPublic', value: false })}
          >
            <Lock size={15} />
            <span className="rcx-vis-label">Private</span>
            <span className="rcx-vis-sub">Just your pantry</span>
          </button>
        </div>
      </div>

      {/* Extras */}
      <div>
        <button
          type="button"
          className={`rcx-more-btn${extrasOpen ? ' is-open' : ''}`}
          onClick={() => setExtrasOpen((v) => !v)}
        >
          <ChevronRight size={14} className="rcx-more-chev" />
          Extras
          <span className="rcx-more-sub">yield · equipment · tags · notes</span>
        </button>

        {extrasOpen && (
          <div className="rcx-more-body">
            <div>
              <div className="rcx-kicker">
                Yield<span className="rcx-kicker-opt"> · optional</span>
              </div>
              <input
                type="text"
                className="rcx-line-input"
                value={state.yieldDescription}
                onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'yieldDescription', value: e.target.value })}
                placeholder="4 generous bowls"
              />
            </div>

            <div>
              <div className="rcx-kicker">
                Equipment<span className="rcx-kicker-opt"> · optional</span>
              </div>
              <ChipComboInput
                value={state.equipment}
                onChange={(next) => dispatch({ type: 'SET_FIELD', field: 'equipment', value: next })}
                suggestions={DEFAULT_EQUIPMENT}
                placeholder="Cast iron skillet, microplane, tongs…"
                ariaLabel="Equipment"
              />
            </div>

            <div>
              <div className="rcx-kicker">
                Tags<span className="rcx-kicker-opt"> · optional</span>
              </div>
              <ChipComboInput
                value={state.tags}
                onChange={(next) => dispatch({ type: 'SET_FIELD', field: 'tags', value: next })}
                suggestions={DEFAULT_RECIPE_TAGS}
                placeholder="pasta, spring, vegetarian…"
                chipPrefix="#"
                ariaLabel="Tags"
              />
            </div>

            <div>
              <div className="rcx-kicker">
                Notes &amp; callouts<span className="rcx-kicker-opt"> · optional</span>
              </div>
              {state.notes.map((note, i) => (
                <div key={i} className="rcx-note-card">
                  <div className="rcx-note-head">
                    <span className="rcx-note-type">{noteLabel(note.type)}</span>
                    <button
                      type="button"
                      className="rcx-ghost-delete"
                      onClick={() => dispatch({ type: 'REMOVE_NOTE', index: i })}
                      aria-label="Delete note"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <textarea
                    className="rcx-note-body"
                    value={note.text}
                    onChange={(e) => dispatch({ type: 'UPDATE_NOTE', index: i, note: { ...note, text: e.target.value } })}
                    placeholder="Write your note. Be specific — this is where the real craft lives."
                    rows={2}
                  />
                </div>
              ))}
              <div className="rcx-chips" style={{ marginTop: state.notes.length ? 10 : 0 }}>
                {NOTE_TYPES.map((n) => (
                  <button
                    key={n.type}
                    type="button"
                    className="rcx-chip-dash"
                    onClick={() => dispatch({ type: 'ADD_NOTE', noteType: n.type })}
                  >
                    <Plus size={11} strokeWidth={2.4} /> {n.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
