// Step 6 — final preview before publish. Shows the recipe in the same
// style as the detail page so the user knows exactly what'll go live.
// The shell renders the Publish button in the footer; this step just
// has to summarize the state and surface any validation gaps.

import React from 'react';
import { flattenIngredientGroups } from '../../lib/ingredient-parsing';
import type { AdvancedRecipeState } from '../AdvancedRecipeBuilder';

interface ValidationResult {
  ok: boolean;
  errors: { step: number; message: string }[];
}

interface Props {
  state: AdvancedRecipeState;
  validation: ValidationResult;
}

function formatMin(m: number): string {
  if (!m) return '—';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

export const StepReview: React.FC<Props> = ({ state, validation }) => {
  const totalMin = state.prepTime + state.cookTime + state.chillTime;
  const flatIngredients = flattenIngredientGroups(state.ingredientGroups).filter((i) => i.name.trim());
  const flatStepCount = state.steps.filter((s) => (s.body || s.title || '').trim()).length;

  return (
    <div className="arb-review">
      <div className="arb-review-eyebrow">
        {state.cuisine || 'Cuisine'} · {state.difficulty}
        {state.course.length > 0 ? ' · ' + state.course.join(', ') : ''}
      </div>
      <h3 className="arb-review-title">{state.name || 'Your recipe'}</h3>
      {state.summary && <p className="arb-review-summary">{state.summary}</p>}

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
  );
};
