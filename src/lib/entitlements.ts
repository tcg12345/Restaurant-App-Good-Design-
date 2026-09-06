/**
 * GoodEats Pro — what the plan is made of, in one place.
 *
 * The server holds the allowances (plan_limits, migration 087) and decides
 * what a request may do; this file holds the WORDS: which feature a gate
 * belongs to, what the paywall says about it, and the plans on offer. The
 * copy rules from the plan apply: sentence case, say the number, say the
 * reset, never a star or a crown.
 *
 * Pure: no React, no network.
 */

export type FeatureKey =
  | 'assistant'          // messages per hour (A1)
  | 'assistant-opus'     // Opus in the picker (A2)
  | 'recipe-generate'    // AI recipe builds (R1)
  | 'recipe-ideas'       // ideas grid (R2)
  | 'recipe-image'       // hero image (R3)
  | 'recipe-combine'     // combine two recipes (R4)
  | 'recipe-import-link' // R5
  | 'recipe-import-text' // R6 text
  | 'recipe-import-photo'// R6 photo
  | 'recipe-photo'       // recreate a dish from a photo
  | 'nutrition'          // R9
  | 'taste-depth'        // T1
  | 'taste-compare'      // T2
  | 'taste-twins'        // T3
  | 'precise-scores'     // T6
  | 'score-history'      // T7
  | 'mood-search'        // A6
  | 'group-recs'         // D5
  | 'export'             // L7
  | 'shared-lists'       // L5 (owner side)
  | 'post-items'         // S2
  | 'early-access';      // I3

export interface Feature {
  key: FeatureKey;
  /** Short name, sentence case. */
  label: string;
  /** One line for the paywall's benefit list. */
  blurb: string;
  /** The edge-function endpoint whose allowance this feature draws from,
   *  when it has one (quota meters look it up). */
  endpoint?: string;
  /** Which of the five paywall benefits this feature belongs to. */
  benefit: BenefitKey;
}

export type BenefitKey = 'assistant' | 'recipes' | 'taste' | 'together' | 'account';

export interface Benefit {
  key: BenefitKey;
  title: string;
  sub: string;
}

/** The five rows on the sheet, in the order they appear (decided bundle). */
export const BENEFITS: Benefit[] = [
  { key: 'assistant', title: 'Assistant on Opus', sub: '120 messages an hour, deepest model' },
  { key: 'recipes', title: 'Unlimited AI recipes', sub: 'Generate, combine, import photos, picture them' },
  { key: 'taste', title: 'Your full taste profile', sub: 'Comparisons, trends, taste twins, score history' },
  { key: 'together', title: 'Plan together', sub: 'Group picks for five, shared lists, mood search' },
  { key: 'account', title: 'Your account', sub: 'Export your data, early access to new features' },
];

export const FEATURES: Record<FeatureKey, Feature> = {
  'assistant':           { key: 'assistant', label: 'Assistant messages', blurb: '120 messages an hour instead of 10', endpoint: 'location-chat', benefit: 'assistant' },
  'assistant-opus':      { key: 'assistant-opus', label: 'Opus in the assistant', blurb: 'The deepest model, whenever you pick it', benefit: 'assistant' },
  'recipe-generate':     { key: 'recipe-generate', label: 'AI recipes', blurb: 'No weekly cap on AI recipe generations', endpoint: 'build-recipe', benefit: 'recipes' },
  'recipe-ideas':        { key: 'recipe-ideas', label: 'Recipe ideas', blurb: 'Brainstorm without a daily cap', endpoint: 'build-recipe-ideas', benefit: 'recipes' },
  'recipe-image':        { key: 'recipe-image', label: 'Recipe images', blurb: 'A hero photo for every recipe you make', endpoint: 'generate-recipe-image', benefit: 'recipes' },
  'recipe-combine':      { key: 'recipe-combine', label: 'Combine recipes', blurb: 'Two recipes into one, with AI', endpoint: 'build-recipe', benefit: 'recipes' },
  'recipe-import-link':  { key: 'recipe-import-link', label: 'Import from a link', blurb: 'Import recipes from links without a weekly cap', endpoint: 'import-recipe', benefit: 'recipes' },
  'recipe-import-text':  { key: 'recipe-import-text', label: 'Import from text', blurb: 'Paste any recipe, as often as you like', endpoint: 'import-recipe-text', benefit: 'recipes' },
  'recipe-import-photo': { key: 'recipe-import-photo', label: 'Import from a photo', blurb: 'Snap a cookbook page and get the recipe', endpoint: 'import-recipe-photo', benefit: 'recipes' },
  'recipe-photo':        { key: 'recipe-photo', label: 'Recreate a dish', blurb: 'Photograph a plate, get the recipe', endpoint: 'build-recipe-photo', benefit: 'recipes' },
  'nutrition':           { key: 'nutrition', label: 'Nutrition', blurb: 'Calories and macros on every recipe', endpoint: 'nutrition-estimate', benefit: 'recipes' },
  'taste-depth':         { key: 'taste-depth', label: 'Taste profile', blurb: 'Trends, habits and what you look for', benefit: 'taste' },
  'taste-compare':       { key: 'taste-compare', label: 'Comparisons', blurb: 'How you grade against everyone else', benefit: 'taste' },
  'taste-twins':         { key: 'taste-twins', label: 'Taste twins', blurb: 'The people who eat like you', benefit: 'taste' },
  'precise-scores':      { key: 'precise-scores', label: 'Precise scores', blurb: 'Two decimals on every score', benefit: 'taste' },
  'score-history':       { key: 'score-history', label: 'Score history', blurb: 'Every visit, charted', benefit: 'taste' },
  'mood-search':         { key: 'mood-search', label: 'Mood search', blurb: 'Find a place by how you feel', benefit: 'together' },
  'group-recs':          { key: 'group-recs', label: 'Group picks', blurb: 'Where all of you would like to eat, up to five', benefit: 'together' },
  'export':              { key: 'export', label: 'Export', blurb: 'Your ratings, lists and recipes as a file', benefit: 'account' },
  'shared-lists':        { key: 'shared-lists', label: 'Shared lists', blurb: 'Lists you keep with friends', benefit: 'together' },
  'post-items':          { key: 'post-items', label: 'Bigger posts', blurb: 'Up to 15 photos and videos in a post', benefit: 'account' },
  'early-access':        { key: 'early-access', label: 'Early access', blurb: 'New features first', benefit: 'account' },
};

export type PlanKey = 'monthly' | 'annual' | 'lifetime';

export interface PlanOffer {
  key: PlanKey;
  title: string;
  /** "$29.99 / year" — from the store on native, from the defaults on web. */
  priceLine: string;
  /** "$2.50 a month" for the annual plan; null otherwise. */
  perMonthLine: string | null;
  /** Free-trial length in days, 0 for none. */
  trialDays: number;
  /** Shown as the champagne tag. */
  tag: string | null;
}

/** The web's prices (Stripe shows the real number at checkout). Native
 *  replaces these with the store's localized prices. */
export const DEFAULT_OFFERS: PlanOffer[] = [
  { key: 'annual', title: 'Annual', priceLine: '$29.99 / year', perMonthLine: '$2.50 a month', trialDays: 7, tag: 'Best value' },
  { key: 'monthly', title: 'Monthly', priceLine: '$4.99 / month', perMonthLine: null, trialDays: 0, tag: null },
];

export const DEFAULT_PLAN: PlanKey = 'annual';

/** Benefits ordered so the one the person just reached for comes first. */
export function benefitsFor(feature: FeatureKey | null): Benefit[] {
  if (!feature) return BENEFITS;
  const first = FEATURES[feature].benefit;
  return [...BENEFITS.filter((b) => b.key === first), ...BENEFITS.filter((b) => b.key !== first)];
}

/** CTA wording per plan: a trial starts, a paid plan continues. */
export function ctaFor(offer: PlanOffer): string {
  return offer.trialDays > 0 ? `Start ${offer.trialDays}-day free trial` : 'Continue';
}

/** The line under the CTA: what happens after. */
export function finePrintFor(offer: PlanOffer): string {
  if (offer.key === 'lifetime') return `${offer.priceLine}, once. Yours for good.`;
  return offer.trialDays > 0
    ? `Then ${offer.priceLine}. Cancel anytime in Settings.`
    : `${offer.priceLine}. Cancel anytime in Settings.`;
}
