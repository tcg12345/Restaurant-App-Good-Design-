// Step 6 — final preview before publish + two publish-time controls:
//   1. Your private rating  — the author's personal score for the
//      recipe. Surfaced on the author's profile but never on the
//      standalone recipe page.
//   2. Visibility toggle  — Public makes the recipe discoverable by
//      friends / experts / the community search; Private keeps it
//      visible only on the author's own pantry.
//
// The shell still owns the Publish button in the footer; this step
// just collects the two extra inputs and surfaces validation gaps.

import React from 'react';
import { Globe, Lock } from 'lucide-react';
import { flattenIngredientGroups } from '../../lib/ingredient-parsing';
import { cn } from '../../lib/utils';
import type { AdvancedRecipeState, Action } from '../AdvancedRecipeBuilder';

interface ValidationResult {
  ok: boolean;
  errors: { step: number; message: string }[];
}

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
  validation: ValidationResult;
}

// Quick label for the rating slider's helper line. Mirrors the basic
// modal so users who've used both surfaces feel the same texture.
function ratingLabel(score: number): string {
  if (score === 0) return 'Slide to rate';
  if (score >= 9) return 'Exceptional!';
  if (score >= 8) return 'Excellent';
  if (score >= 7) return 'Very good';
  if (score >= 6) return 'Good';
  if (score >= 5) return 'Average';
  if (score >= 4) return 'Below average';
  if (score >= 3) return 'Poor';
  return 'Terrible';
}
function ratingColor(score: number): string {
  if (score === 0) return 'var(--muted-2, #B8AFA4)';
  if (score >= 8) return 'var(--green, #2E7D5C)';
  if (score >= 6) return 'var(--gold, #E8A33C)';
  if (score >= 4) return 'var(--accent-2, #C2543E)';
  return 'var(--accent, #A8392A)';
}

function formatMin(m: number): string {
  if (!m) return '—';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

export const StepReview: React.FC<Props> = ({ state, dispatch, validation }) => {
  const totalMin = state.prepTime + state.cookTime + state.chillTime;
  const flatIngredients = flattenIngredientGroups(state.ingredientGroups).filter((i) => i.name.trim());
  const flatStepCount = state.steps.filter((s) => (s.body || s.title || '').trim()).length;

  return (
    <>
    <div className="arb-review">
      <div className="arb-review-eyebrow">
        {state.cuisine || 'Cuisine'} · {state.difficulty}
        {state.course.length > 0 ? ' · ' + state.course.join(', ') : ''}
      </div>
      <h3 className="arb-review-title">{state.name || 'Your recipe'}</h3>
      {state.summary && <p className="arb-review-summary">{state.summary}</p>}
      {state.introParagraph.trim() && (
        <div className="arb-review-section">
          <h4>Intro paragraph</h4>
          <p className="arb-review-intro">{state.introParagraph.trim()}</p>
        </div>
      )}

      <div className="arb-review-section">
        <h4>Timing & yield</h4>
        <div className="arb-review-stats">
          <span><span className="strong">Prep</span> {formatMin(state.prepTime)}</span>
          <span><span className="strong">Cook</span> {formatMin(state.cookTime)}</span>
          {state.chillTime > 0 && <span><span className="strong">Rest</span> {formatMin(state.chillTime)}</span>}
          <span><span className="strong">Total</span> {formatMin(totalMin)}</span>
          <span>
            <span className="strong">Serves</span> {state.servings}
            {state.yieldDescription ? ` · ${state.yieldDescription}` : ''}
          </span>
        </div>
      </div>

      {flatIngredients.length > 0 && (
        <div className="arb-review-section">
          <h4>Ingredients ({flatIngredients.length})</h4>
          {state.ingredientGroups.map((g, i) => {
            const items = g.ingredients.filter((ing) => ing.name.trim());
            if (items.length === 0) return null;
            return (
              <div key={i} style={{ marginBottom: 10 }}>
                {state.ingredientGroups.length > 1 && (
                  <div style={{
                    fontFamily: 'var(--serif, Georgia, serif)',
                    fontSize: 15,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}>{g.name}</div>
                )}
                <ul className="arb-review-list">
                  {items.map((ing, j) => (
                    <li key={j}>
                      {[ing.amount, ing.unit, ing.name].filter(Boolean).join(' ')}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {flatStepCount > 0 && (
        <div className="arb-review-section">
          <h4>Method ({flatStepCount} step{flatStepCount === 1 ? '' : 's'})</h4>
          <ol className="arb-review-list" style={{ counterReset: 'step', listStyle: 'none' }}>
            {state.steps.filter((s) => (s.body || s.title || '').trim()).map((s, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <strong>{i + 1}.</strong> {s.title || s.body.slice(0, 80)}
                {s.durationMin ? <span style={{ color: 'var(--accent, #A8392A)', marginLeft: 6 }}>· {s.durationMin}m</span> : null}
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.equipment.length > 0 && (
        <div className="arb-review-section">
          <h4>Equipment</h4>
          <ul className="arb-review-list">
            {state.equipment.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {state.notes.filter((n) => n.text.trim()).length > 0 && (
        <div className="arb-review-section">
          <h4>Notes</h4>
          {state.notes.filter((n) => n.text.trim()).map((n, i) => (
            <p key={i} style={{ fontSize: 14, color: 'var(--ink-2, #4A423C)', fontStyle: 'italic', margin: '4px 0' }}>
              <strong style={{ fontStyle: 'normal', color: 'var(--accent, #A8392A)', marginRight: 4 }}>
                {n.type === 'makeAhead' ? 'Make ahead:' : n.type === 'substitution' ? 'Sub:' : n.type === 'general' ? 'Note:' : 'Tip:'}
              </strong>
              {n.text}
            </p>
          ))}
        </div>
      )}

      {!validation.ok && (
        <div className="arb-review-validation">
          Before you can publish:
          <ul>
            {validation.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>

    {/* ── Your private rating ──────────────────────────────────
        Author's own score for the recipe. Saved on the meal so it
        shows up on the author's profile listings, but RecipePage
        deliberately doesn't surface it — that's the "private from
        the public recipe view" behavior the spec calls for. */}
    <div className="arb-publish-card">
      <div className="arb-publish-card-head">
        <span className="arb-publish-card-eyebrow">Your private rating</span>
        <span className="arb-publish-card-hint">
          For your eyes — not shown on the recipe page. Visible only on your own profile when other users browse your recipes.
        </span>
      </div>
      <div className="arb-rating">
        <div className="arb-rating-value" style={{ color: ratingColor(state.score) }}>
          {state.score > 0 ? state.score.toFixed(1) : '—'}
          <span className="arb-rating-denom"> / 10</span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          value={state.score}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'score', value: parseFloat(e.target.value) })}
          className="arb-rating-slider"
          aria-label="Your private rating"
        />
        <div className="arb-rating-label">{ratingLabel(state.score)}</div>
      </div>
    </div>

    {/* ── Visibility (public / private) ─────────────────────────
        Drives HomeMeal.isPublic. Public recipes surface in friends'
        / experts' / community feeds and the AI assistant's
        community-recipes search; private ones live only on the
        author's pantry + profile. */}
    <div className="arb-publish-card">
      <div className="arb-publish-card-head">
        <span className="arb-publish-card-eyebrow">Visibility</span>
        <span className="arb-publish-card-hint">
          Public recipes show up on your friends' feeds and the community search. Private ones stay on your pantry.
        </span>
      </div>
      <div className="arb-visibility-row">
        <button
          type="button"
          className={cn('arb-visibility-card', !state.isPublic && 'is-active')}
          onClick={() => dispatch({ type: 'SET_FIELD', field: 'isPublic', value: false })}
        >
          <Lock size={18} />
          <div>
            <div className="arb-visibility-title">Private</div>
            <div className="arb-visibility-sub">Only you</div>
          </div>
        </button>
        <button
          type="button"
          className={cn('arb-visibility-card', state.isPublic && 'is-active')}
          onClick={() => dispatch({ type: 'SET_FIELD', field: 'isPublic', value: true })}
        >
          <Globe size={18} />
          <div>
            <div className="arb-visibility-title">Public</div>
            <div className="arb-visibility-sub">Friends + community</div>
          </div>
        </button>
      </div>
    </div>
    </>
  );
};
