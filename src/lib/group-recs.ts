/**
 * Group recommendations — "where would all of us like to eat?"
 *
 * ── Why this can work here ────────────────────────────────────────────
 * Averaging ratings across people is meaningless: your 8 and mine are
 * different units. This engine avoids that because `scoreCandidates`
 * already predicts a score on EACH user's own 0–10 scale, anchored on
 * their own mean (see recommendations.ts). Predictions are personal-scale
 * normalized by construction, so they are directly comparable — that is
 * the whole basis for aggregating them.
 *
 * ── Why not just average ──────────────────────────────────────────────
 * A mean maximises total happiness and picks the beige middle: the place
 * nobody objects to and nobody wanted. Pure "least misery" (rank by the
 * unhappiest member) picks the safest thing on the list. The blend below
 * is the standard fix, and the fairness weight is what stops one person's
 * enthusiasm from dragging the group somewhere another person dreads.
 *
 * ── Hard vetoes are not low scores ────────────────────────────────────
 * A vegetarian at a steakhouse is not "a poor fit", it is a wrong answer.
 * Dietary conflicts and price tiers outside every member's range remove a
 * candidate from the list rather than demoting it, and the caller is told
 * which rule fired so the UI can say so instead of silently returning
 * less.
 */

import type { TasteProfile } from './recommendations';
import { preferredPriceTiers } from './recommendations';

/** How much the unhappiest member's score counts, versus the average.
 *  0 = pure average (bland), 1 = pure least-misery (safe and boring). */
export const FAIRNESS = 0.4;

/** Predicted score below which a place reads as "not for them". Sits just
 *  under the floor `scoreCandidates` clamps predictions to (5.0), so a
 *  member has to be genuinely poorly served to count as left out. */
export const NOT_FOR_THEM = 6.2;
/** At or above this, a member is enthusiastic rather than merely willing. */
export const LOVES_IT = 8.0;

export type MemberFit = 'loves' | 'fine' | 'poor';

export interface GroupMember {
  userId: string;
  /** Display name, for reason strings. */
  name: string;
  profile: TasteProfile;
  /** Dietary keys from their taste quiz ('vegetarian' | 'vegan' | …). */
  dietary?: string[];
  /** True when their history is too thin for a personalized profile —
   *  the caller should say so rather than let a cold member silently
   *  read as agreement. */
  cold?: boolean;
}

export interface GroupScore {
  /** The ranking value: mean blended with the minimum. */
  group: number;
  mean: number;
  min: number;
  /** max − min. High spread means the group disagrees about this place,
   *  which is worth showing even when the blend still ranks it well. */
  spread: number;
  /** Per member, in the order given. */
  fits: Array<{ userId: string; predicted: number; fit: MemberFit }>;
  /** Nobody is poorly served. */
  everyoneIn: boolean;
}

export const fitOf = (predicted: number): MemberFit =>
  predicted >= LOVES_IT ? 'loves' : predicted < NOT_FOR_THEM ? 'poor' : 'fine';

/** What a MISSING prediction counts as. Members are scored with their
 *  history kept, so everyone gets a number for anything the shared pool
 *  contains — a gap means that member's own price band excluded it, which
 *  is negative information, not an absence to average over. Just under the
 *  "not for them" line, so it also shows up in `everyoneIn`. */
const UNKNOWN_AS = NOT_FOR_THEM - 0.5;

/**
 * Blend the members' predicted scores into one ranking value.
 *
 * `predictions` must be in the same order as `members`. Averaging over a
 * gap is how a place only one person could be scored for ends up ranked
 * first, so gaps are filled (see UNKNOWN_AS) rather than skipped.
 */
export function aggregateGroup(
  members: GroupMember[],
  predictions: Array<number | undefined>,
  fairness = FAIRNESS,
): GroupScore {
  const anyKnown = predictions.some((p) => typeof p === 'number' && p > 0);
  if (!anyKnown) {
    return { group: 0, mean: 0, min: 0, spread: 0, fits: [], everyoneIn: false };
  }
  const filled = predictions.map((p) => (typeof p === 'number' && p > 0 ? p : UNKNOWN_AS));
  const min = Math.min(...filled);
  const mean = filled.reduce((a, b) => a + b, 0) / filled.length;
  const max = Math.max(...filled);
  const fits = members.map((m, i) => ({
    userId: m.userId,
    predicted: filled[i],
    fit: fitOf(filled[i]),
  }));
  return {
    group: (1 - fairness) * mean + fairness * min,
    mean,
    min,
    spread: max - min,
    fits,
    everyoneIn: fits.every((f) => f.fit !== 'poor'),
  };
}

export type VetoReason = 'dietary' | 'price';

export interface GroupVeto {
  reason: VetoReason;
  /** Who it is for — so the UI can say "no vegetarian options for Dev"
   *  rather than a bare count. */
  userId: string;
}

/** Tags that satisfy a dietary key. Mirrors DIETARY_TAG_PRIORS in
 *  recommendations.ts — the same tokens raters actually apply. */
const DIETARY_SATISFIED_BY: Record<string, string[]> = {
  vegetarian: ['Good Vegetarian Options'],
  vegan: ['Good Vegetarian Options'],
};

/** Cuisines that cannot serve a strict vegetarian a real meal. Deliberately
 *  SHORT: a veto is a strong claim, and being wrong removes a place the
 *  group might have wanted. Anything not listed is judged on tags. */
const DIETARY_HOSTILE_CUISINES: Record<string, string[]> = {
  vegetarian: ['steakhouse', 'bbq', 'barbecue'],
  vegan: ['steakhouse', 'bbq', 'barbecue'],
};

/**
 * Whether a candidate is out for someone, and why.
 *
 * Dietary: only fires on a cuisine that genuinely cannot feed them, and
 * only when no community tag says otherwise — a steakhouse somebody has
 * tagged "Good Vegetarian Options" is not vetoed.
 *
 * Price: fires when the tier is outside EVERY member's demonstrated band.
 * A tier one person avoids is a low score for them (the scorer's job);
 * a tier nobody in the group spends in is a wrong answer.
 */
export function groupVeto(
  candidate: { cuisine?: string; priceLevel?: number; tags?: string[] },
  members: GroupMember[],
): GroupVeto | null {
  const cuisine = (candidate.cuisine || '').toLowerCase();
  const tags = candidate.tags || [];
  for (const m of members) {
    for (const key of m.dietary || []) {
      const hostile = DIETARY_HOSTILE_CUISINES[key];
      if (!hostile || !hostile.some((h) => cuisine.includes(h))) continue;
      const rescued = (DIETARY_SATISFIED_BY[key] || []).some((t) => tags.includes(t));
      if (!rescued) return { reason: 'dietary', userId: m.userId };
    }
  }
  const price = candidate.priceLevel ?? 0;
  if (price >= 1 && price <= 4) {
    const anyoneSpendsHere = members.some((m) => {
      const tiers = preferredPriceTiers(m.profile);
      // No demonstrated band yet (cold profile) → they veto nothing.
      return tiers.length === 0 || tiers.includes(price);
    });
    if (!anyoneSpendsHere) return { reason: 'price', userId: members[0]?.userId ?? '' };
  }
  return null;
}

/**
 * The fair meeting point: the centroid of everyone's home location.
 *
 * "Near me" is the wrong question for a group — someone always travels.
 * Members without coordinates are skipped rather than pulling the centroid
 * toward (0, 0). Returns null when nobody has one, and the caller keeps
 * whatever anchor it already had.
 */
export function groupCentroid(
  points: Array<{ lat?: number | null; lng?: number | null }>,
): { lat: number; lng: number } | null {
  const valid = points.filter(
    (p): p is { lat: number; lng: number } =>
      typeof p.lat === 'number' && typeof p.lng === 'number'
      && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  if (valid.length === 0) return null;
  const lat = valid.reduce((a, p) => a + p.lat, 0) / valid.length;
  const lng = valid.reduce((a, p) => a + p.lng, 0) / valid.length;
  return { lat, lng };
}

/**
 * One line naming how the group lands on a place. Leads with the honest
 * headline — everyone in, or who is not — because that is the question a
 * group ranking is actually answering.
 */
export function groupVerdict(
  score: GroupScore,
  nameOf: (userId: string) => string,
): string {
  if (score.fits.length === 0) return '';
  const poor = score.fits.filter((f) => f.fit === 'poor');
  if (poor.length === 0) {
    const loves = score.fits.filter((f) => f.fit === 'loves').length;
    if (loves === score.fits.length) return 'Everyone loves this';
    return 'Everyone’s in';
  }
  if (poor.length === 1) return `Not really ${nameOf(poor[0].userId)}’s thing`;
  return `Not for ${poor.length} of you`;
}
