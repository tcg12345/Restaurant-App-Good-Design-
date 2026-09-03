/**
 * Nutrition panel on the recipe page (entitlements 'nutrition').
 *
 * Per-serving numbers: calories large, the three macros beside it, the
 * optional row (fiber, sugar, sodium) beneath when the source had them,
 * and a provenance line — every number here is an estimate and says so.
 *
 * Free sees the panel through a blur (real numbers when the recipe has
 * them, a plausible placeholder when it doesn't) and one tap opens the
 * paywall. The owner of a recipe without numbers gets "Estimate with
 * AI"; the parent runs the call and saves the result.
 */
import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { usePlan } from '../../contexts/PlanContext';
import { ProGate } from '../pro/ProGate';
import { ProTag } from '../pro/ProMark';
import { nutritionSourceLabel, type RecipeNutrition } from '../../lib/nutrition';

const PLACEHOLDER: RecipeNutrition = { calories: 420, protein: 18, carbs: 52, fat: 14, fiber: 6, sugar: 9, sodium: 640, source: 'ai' };

export const NutritionPanel: React.FC<{
  nutrition?: RecipeNutrition;
  /** Whether the viewer may ask for an estimate (the owner, signed in). */
  canEstimate: boolean;
  estimating: boolean;
  error: string | null;
  onEstimate: () => void;
}> = ({ nutrition, canEstimate, estimating, error, onEstimate }) => {
  const planCtx = usePlan();
  const locked = planCtx.checked && !planCtx.isPro;

  // Nothing to show and nobody who could add it: no section at all.
  if (!nutrition && !canEstimate && !locked) return null;

  const grid = (n: RecipeNutrition) => {
    const extras = [
      n.fiber !== undefined ? { label: 'Fiber', value: `${n.fiber}g` } : null,
      n.sugar !== undefined ? { label: 'Sugar', value: `${n.sugar}g` } : null,
      n.sodium !== undefined ? { label: 'Sodium', value: `${n.sodium}mg` } : null,
    ].filter((x): x is { label: string; value: string } => !!x);
    return (
      <div className="rd-nutri-card">
        <div className="rd-nutri-main">
          <div className="rd-nutri-cal">
            <span className="rd-nutri-cal-n">{n.calories}</span>
            <span className="rd-nutri-cal-u">kcal</span>
          </div>
          <div className="rd-nutri-macros">
            {[['Protein', n.protein], ['Carbs', n.carbs], ['Fat', n.fat]].map(([label, v]) => (
              <div key={label as string} className="rd-nutri-cell">
                <span className="rd-nutri-cell-n">{v as number}<em>g</em></span>
                <span className="rd-nutri-cell-l">{label as string}</span>
              </div>
            ))}
          </div>
        </div>
        {extras.length > 0 && (
          <div className="rd-nutri-extras">
            {extras.map((e) => <span key={e.label}><b>{e.value}</b> {e.label.toLowerCase()}</span>)}
          </div>
        )}
        <p className="rd-nutri-source">{nutritionSourceLabel(n)}</p>
      </div>
    );
  };

  return (
    <section className="rd-nutrition">
      <div className="rd-section-head">
        <h2 className="rd-section-title">Nutrition</h2>
        {locked && <ProTag size="md" />}
      </div>
      {locked ? (
        <ProGate feature="nutrition" variant="teaser" unlockLine="Unlock calories and macros with Pro">
          {grid(nutrition ?? PLACEHOLDER)}
        </ProGate>
      ) : nutrition ? (
        grid(nutrition)
      ) : (
        <div className="rd-nutri-empty">
          <p>No numbers yet. An estimate works from the ingredients and servings.</p>
          <button type="button" className="rd-nutri-cta" onClick={onEstimate} disabled={estimating}>
            {estimating ? <Loader2 size={14} className="rd-nutri-spin" /> : <Sparkles size={14} />}
            {estimating ? 'Estimating…' : 'Estimate with AI'}
          </button>
          {error && <p className="rd-nutri-error">{error}</p>}
        </div>
      )}
    </section>
  );
};
