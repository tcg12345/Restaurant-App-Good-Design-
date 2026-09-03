/**
 * Nutrition (entitlements 'nutrition') — per-serving numbers on a recipe.
 *
 * Every value is PER SERVING: kcal for calories, grams for the macros,
 * milligrams for sodium. `source` says where the numbers came from: the
 * AI builder's estimate, the source page of an import, or an estimate
 * asked for on the recipe page. All estimates; the panel says so.
 *
 * Pure: no React, no network.
 */
export type NutritionSource = 'ai' | 'import' | 'manual';

export interface RecipeNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  source: NutritionSource;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

/** Accept whatever the model / a source page / a stored row holds and
 *  return a clean record, or null when the essentials are missing. */
export function normalizeNutrition(raw: unknown, source: NutritionSource = 'ai'): RecipeNutrition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const calories = num(r.calories);
  const protein = num(r.protein);
  const carbs = num(r.carbs ?? r.carbohydrates);
  const fat = num(r.fat);
  if (calories === undefined || protein === undefined || carbs === undefined || fat === undefined) return null;
  if (calories === 0 && protein === 0 && carbs === 0 && fat === 0) return null;
  const src = r.source === 'import' || r.source === 'manual' || r.source === 'ai' ? (r.source as NutritionSource) : source;
  const out: RecipeNutrition = { calories, protein, carbs, fat, source: src };
  const fiber = num(r.fiber); if (fiber !== undefined) out.fiber = fiber;
  const sugar = num(r.sugar); if (sugar !== undefined) out.sugar = sugar;
  const sodium = num(r.sodium); if (sodium !== undefined) out.sodium = sodium;
  return out;
}

/** The numbers without provenance — what goes back to the model. */
export function nutritionForModel(n: RecipeNutrition | undefined): Omit<RecipeNutrition, 'source'> | undefined {
  if (!n) return undefined;
  const { source: _source, ...rest } = n;
  return rest;
}

/** One line: "420 kcal · 18g protein · 52g carbs · 14g fat". */
export function nutritionLine(n: RecipeNutrition): string {
  return `${n.calories} kcal · ${n.protein}g protein · ${n.carbs}g carbs · ${n.fat}g fat`;
}

export function nutritionSourceLabel(n: RecipeNutrition): string {
  return n.source === 'import' ? 'From the source recipe, per serving' : 'Estimated by AI, per serving';
}
