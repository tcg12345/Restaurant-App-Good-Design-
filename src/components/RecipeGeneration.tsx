import React from 'react';
import { ChefHat, Lightbulb, ScanLine, BookOpen, Sparkles } from 'lucide-react';
import './RecipeCreation.css';

type GenerationKind = 'recipe' | 'ideas' | 'combine' | 'link' | 'photo' | 'text';
const COPY: Record<GenerationKind, [string, string]> = {
  recipe: ['Creating something delicious.', 'Turning your ideas into ingredients, timings, and clear steps.'],
  ideas: ['A little inspiration is on its way.', 'Finding dishes to match your mood and preferences.'],
  combine: ['Bringing your ideas together.', 'Creating one recipe from the flavors you picked.'],
  link: ['Making room in your cookbook.', 'Reading the recipe and preparing an editable draft.'],
  photo: ['A new chapter for this recipe.', 'Reading your photos and organizing the recipe into a draft.'],
  text: ['Giving your recipe a little order.', 'Organizing your text into ingredients and cooking steps.'],
};
/** Decorative motion never claims completed work. The optional estimate comes from the existing generation telemetry. */
export const RecipeGeneration: React.FC<{
  kind: GenerationKind; elapsed: number; progress?: number; remainingMs?: number | null;
  onCancel: () => void; compact?: boolean;
}> = ({ kind, elapsed, progress, remainingMs, onCancel, compact = false }) => {
  const Icon = kind === 'ideas' ? Lightbulb : kind === 'photo' ? ScanLine : ['link', 'text'].includes(kind) ? BookOpen : ChefHat;
  const pct = progress === undefined ? null : Math.round(Math.max(0, Math.min(.99, progress)) * 100);
  return <div className={`recipe-generation${compact ? ' is-compact' : ''}`} aria-busy="true">
    <div className="recipe-generation-art" aria-hidden="true">
      <div className="recipe-generation-glow" />
      <div className="recipe-generation-orbit"><span /><i /></div>
      <div className="recipe-generation-paper is-back" />
      <div className="recipe-generation-paper"><span className="recipe-generation-emblem"><Icon size={30} strokeWidth={1.5} /></span><b /><i /><i /><i /><div className="recipe-generation-lines"><span /><span /><span /></div></div>
      <span className="recipe-generation-spark"><Sparkles size={20} strokeWidth={1.6} /></span>
    </div>
    <h3 role="status">{COPY[kind][0]}</h3>
    {!compact && <p>{elapsed >= 45 ? 'This is taking a little longer. You can keep waiting or cancel and try again.' : COPY[kind][1]}</p>}
    <div className="recipe-generation-progress" role="progressbar" aria-label={pct === null ? 'Preparing your recipe' : 'Estimated generation progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
      <span className={pct === null ? 'is-indeterminate' : ''} style={pct === null ? undefined : { width: `${pct}%` }} />
    </div>
    <div className="recipe-generation-status">{pct !== null ? `Estimated progress · ${pct}%` : 'Working on your draft'}{remainingMs != null && remainingMs > 0 && elapsed < 45 ? ` · about ${Math.max(1, Math.ceil(remainingMs / 1000))}s left` : elapsed >= 2 ? ` · ${elapsed}s` : ''}</div>
    <button className="recipe-generation-cancel" type="button" onClick={onCancel}>Cancel</button>
  </div>;
};

export const RecipeSourceIntro: React.FC<{ source: 'link' | 'photo' | 'text' }> = ({ source }) => {
  const Icon = source === 'link' ? BookOpen : source === 'photo' ? ScanLine : Sparkles;
  const titles = { link: 'From the web.\nInto your kitchen.', photo: 'A recipe worth keeping.', text: 'Your words.\nA recipe to come back to.' };
  const subtitles = { link: 'Save a recipe you found online, ready to make your own.', photo: 'Bring in a cookbook page, screenshot, or handwritten recipe.', text: 'Paste ingredients and instructions. We’ll organize the rest.' };
  return <div className="recipe-source-intro"><div className="recipe-source-symbol"><Icon size={27} strokeWidth={1.5} /></div><h3>{titles[source]}</h3><p>{subtitles[source]}</p></div>;
};
