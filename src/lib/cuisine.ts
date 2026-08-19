/**
 * Resolving a restaurant's cuisine from a Google place.
 *
 * This was previously four near-identical helpers (`getCuisineLabel`,
 * `inferCuisineLabel` ×2, `cuisineFromTypes` ×2) that each scanned the
 * place's `types` array for something in CUISINE_TYPES and gave up
 * otherwise. Two problems, both worst in rural areas:
 *
 *   1. `types` is often just ['restaurant', 'point_of_interest',
 *      'establishment'] outside big cities, even when Google knows more.
 *      `primaryType` and `primaryTypeDisplayName` carry the answer and were
 *      never requested — see the field masks in lib/places.ts.
 *   2. The detail-page helper answered 'Restaurant' when it didn't know,
 *      which is indistinguishable from a place that genuinely is just a
 *      restaurant. It put a fake "Restaurant" cuisine on saved ratings,
 *      which then became a fake "Restaurant" category in profile top lists.
 *      Unknown is now null, and callers show nothing.
 *
 * Resolution order, most to least trustworthy:
 *   primaryType → types[] → primaryTypeDisplayName → null
 */
import { CUISINE_TYPES } from './places';

export interface CuisineSource {
  /** Google's unordered type array. */
  types?: string[];
  /** Google's single best type for the place. Preferred over `types`
   *  precisely because it is the one Google committed to. */
  primaryType?: string;
  /** Google's localized human label for `primaryType`, e.g. "Barbecue
   *  restaurant". Present for many places whose `primaryType` isn't in our
   *  taxonomy at all. */
  primaryTypeDisplayName?: string;
}

export interface ResolvedCuisine {
  label: string;
  /** True when `label` is one of CUISINE_TYPES' own labels, so it's safe to
   *  use as a filter facet or a top-list category. A verbatim Google display
   *  name is legitimate to SHOW but must not enter the taxonomy — it is
   *  localized and open-ended, so filtering on it would fragment the
   *  categories per user locale. */
  canonical: boolean;
  source: 'primaryType' | 'types' | 'displayName';
}

/** Google type → our label. */
const TYPE_TO_LABEL: Record<string, string> = {};
/** Our label, lowercased → our label. Lets a display name that already
 *  matches a taxonomy label ("Sushi") come back canonical. */
const LABEL_TO_LABEL: Record<string, string> = {};
for (const c of CUISINE_TYPES) {
  if (!c.type || c.label === 'All') continue;
  TYPE_TO_LABEL[c.type] = c.label;
  LABEL_TO_LABEL[c.label.toLowerCase()] = c.label;
}

/**
 * Types that say "this is a place that serves food" and nothing more.
 * They must not resolve to a cuisine — answering 'Restaurant' for these is
 * the bug this module exists to fix. Note `bar`, `cafe`, `bakery`, `pub`,
 * `diner` and `deli` are deliberately NOT here: those are real answers.
 */
const GENERIC = new Set([
  'restaurant', 'food', 'point_of_interest', 'establishment', 'store',
  'meal_takeaway', 'meal_delivery', 'food_store', 'grocery_store',
]);

/**
 * Google's display names are the type in sentence case — "Barbecue
 * restaurant" for `barbecue_restaurant`, "Steak house" for `steak_house`.
 * Reversing that mapping is what lets a display name land back in the
 * taxonomy instead of being kept as a one-off string.
 */
function typeFromDisplayName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Resolve a place's cuisine, or null when nothing usable is available. */
export function resolveCuisine(place: CuisineSource): ResolvedCuisine | null {
  const primary = place.primaryType?.trim();
  if (primary && !GENERIC.has(primary) && TYPE_TO_LABEL[primary]) {
    return { label: TYPE_TO_LABEL[primary], canonical: true, source: 'primaryType' };
  }

  for (const t of place.types ?? []) {
    if (!t || GENERIC.has(t)) continue;
    const label = TYPE_TO_LABEL[t];
    if (label) return { label, canonical: true, source: 'types' };
  }

  const display = place.primaryTypeDisplayName?.trim();
  if (display) {
    const asType = typeFromDisplayName(display);
    if (GENERIC.has(asType)) return null;
    const canonicalLabel = TYPE_TO_LABEL[asType] ?? LABEL_TO_LABEL[display.toLowerCase()];
    if (canonicalLabel) return { label: canonicalLabel, canonical: true, source: 'displayName' };
    // Not in our taxonomy, but still a real answer for a human to read.
    return { label: display, canonical: false, source: 'displayName' };
  }

  return null;
}

/**
 * The label to display, or '' when unknown.
 *
 * '' rather than 'Restaurant' on purpose: every meta line in the app builds
 * itself with `.filter(Boolean).join(' · ')`, so an empty cuisine simply
 * drops out of the line instead of asserting something we don't know.
 */
export function cuisineLabel(place: CuisineSource): string {
  return resolveCuisine(place)?.label ?? '';
}

/**
 * The label only when it belongs to the taxonomy — for anything that
 * groups, filters or counts by cuisine (search facets, profile top lists,
 * recommendation signals). Keeps open-ended Google display names out of
 * places where they'd fragment the categories.
 */
export function canonicalCuisineLabel(place: CuisineSource): string {
  const resolved = resolveCuisine(place);
  return resolved?.canonical ? resolved.label : '';
}

/**
 * The label for one Google place type, or '' if we don't map it.
 * For UI that already holds a type (filter chips, saved facets) rather than
 * a place — not a resolution path.
 */
export function labelForCuisineType(type: string | undefined): string {
  return (type && TYPE_TO_LABEL[type]) || '';
}

/** Convenience for the many call sites that only hold a `types` array. */
export function cuisineFromTypes(types: string[] | undefined): string {
  return cuisineLabel({ types });
}
