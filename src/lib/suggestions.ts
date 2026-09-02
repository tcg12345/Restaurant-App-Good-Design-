/**
 * Who to put in front of a viewer whose feed is empty, and what to say
 * about them.
 *
 * Pure on purpose: the ordering here decides what a brand-new user's first
 * impression of the community is, which makes it worth testing directly
 * rather than through a Supabase mock.
 */

export interface RankableProfile {
  user_id: string;
  is_verified: boolean;
  /** Community ratings published by this person. */
  ratingCount: number;
  followerCount: number;
  /** 0..1, how alike this candidate's taste looks to the viewer's — see
   *  {@link tasteMatchScore}. Absent (or 0) when neither side has enough
   *  signal to compare, which is common for a brand-new candidate. */
  matchScore?: number;
  /** This person is in the viewer's address book (migration 079). */
  contactMatch?: boolean;
  /** They already follow the viewer (migration 080). */
  followsYou?: boolean;
  /** People the viewer follows who also follow this candidate. */
  mutualCount?: number;
  /** Restaurants both have rated, and how many they scored alike. */
  coRatedCount?: number;
  coRatedAgreement?: number;
}

/**
 * Weights for the blended score. Ordered by how strongly each answers the
 * question the rail is actually asking — "do you know this person, or
 * would you want to?" — rather than "is this a good account".
 *
 * Contacts and follows-you dominate because they are near-certainties:
 * one means you have their number, the other means they already chose
 * you. Mutual friends is the classic PYMK signal and the strongest of
 * the inferred ones. Agreement (rating the same places AND scoring them
 * alike) beats taste similarity, because it is demonstrated rather than
 * stated. The old ranking's terms survive at the bottom as tiebreakers:
 * they answer "is this account worth following at all", which only
 * matters once nothing better distinguishes two candidates.
 */
export const SUGGESTION_WEIGHTS = {
  contact: 6,
  followsYou: 4,
  mutual: 3,
  // 2.5, not 2: saturation means agreement can only ever REACH its weight
  // asymptotically, so at 2.0 five agreed-on restaurants (× 5/7 ≈ 1.43)
  // lost to a perfect stated-taste score (1.5 × 1) — the exact opposite
  // of the principle above. 2.5 keeps demonstrated evidence ahead of
  // stated similarity from about four agreements up.
  agreement: 2.5,
  taste: 1.5,
  verified: 0.5,
} as const;

/** Small counts must saturate, not scale linearly — the same reasoning as
 *  the evidence shrinkage in recommendations.ts. Five mutual friends is
 *  much stronger than one but nowhere near five times stronger, and
 *  without this a single hub account with 40 mutuals would bury everyone. */
const saturate = (n: number, k: number): number => (n > 0 ? n / (n + k) : 0);

/** The blended score. Exported so a test can assert on it directly rather
 *  than inferring weights from sort order. */
export function suggestionScore(p: RankableProfile): number {
  const W = SUGGESTION_WEIGHTS;
  return (
    (p.contactMatch ? W.contact : 0)
    + (p.followsYou ? W.followsYou : 0)
    + W.mutual * saturate(p.mutualCount ?? 0, 2)
    + W.agreement * saturate(p.coRatedAgreement ?? 0, 2)
    + W.taste * (p.matchScore ?? 0)
    + (p.is_verified ? W.verified : 0)
  );
}

/**
 * Rank by how likely the viewer is to know — or want to know — someone,
 * not by how impressive their account is.
 *
 * The blend is a weighted sum rather than the lexicographic sort this
 * used to be, because these signals genuinely trade off: two mutual
 * friends plus strong taste agreement should beat one mutual friend
 * alone, which a strict cascade can never express.
 *
 * Volume of published ratings and followers stay as pure tiebreakers
 * below the score. They are a property of the account, not of the
 * relationship, so they should only speak when nothing about the
 * relationship does — which is also exactly today's behaviour for a
 * viewer with no graph, keeping the cold-start case unchanged.
 *
 * The final tiebreak is the user id so the rail doesn't reshuffle
 * between reloads on whatever order the database happened to return.
 */
export function rankSuggestedProfiles<T extends RankableProfile>(candidates: T[], limit: number): T[] {
  return [...candidates]
    .sort((a, b) =>
      suggestionScore(b) - suggestionScore(a)
      || Number(b.is_verified) - Number(a.is_verified)
      || b.ratingCount - a.ratingCount
      || b.followerCount - a.followerCount
      || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0),
    )
    .slice(0, Math.max(0, limit));
}

/** Which signal a row should explain itself with — the strongest one that
 *  applies, matching the weight order above. */
export type SuggestionReasonKind =
  | 'contact' | 'followsYou' | 'mutual' | 'agreement' | 'taste' | 'account';

export function suggestionReasonKind(p: RankableProfile): SuggestionReasonKind {
  if (p.contactMatch) return 'contact';
  if (p.followsYou) return 'followsYou';
  if ((p.mutualCount ?? 0) > 0) return 'mutual';
  if ((p.coRatedAgreement ?? 0) > 0) return 'agreement';
  if ((p.matchScore ?? 0) > 0) return 'taste';
  return 'account';
}

/**
 * Stop one signal from filling the whole rail.
 *
 * Without this, someone who just synced a large address book sees only
 * contacts and never learns the rail knows anything else — and a viewer
 * with one very connected friend sees ten variations of "3 mutual
 * friends". Caps each reason category at `maxShare` of the output while
 * preserving rank order within and across categories, then backfills
 * from whatever was held back so the caller always gets `limit` rows if
 * that many exist.
 */
export function diversifySuggestions<T extends RankableProfile>(
  ranked: T[],
  limit: number,
  maxShare = 0.5,
): T[] {
  if (limit <= 0) return [];
  const cap = Math.max(1, Math.floor(limit * maxShare));
  const used = new Map<SuggestionReasonKind, number>();
  const picked: T[] = [];
  const held: T[] = [];

  for (const p of ranked) {
    const kind = suggestionReasonKind(p);
    const n = used.get(kind) ?? 0;
    if (n < cap && picked.length < limit) {
      used.set(kind, n + 1);
      picked.push(p);
    } else {
      held.push(p);
    }
  }
  // Backfill in rank order — a capped category is better than a short list.
  for (const p of held) {
    if (picked.length >= limit) break;
    picked.push(p);
  }
  return picked;
}

/** The taste-quiz + home-base signal a profile carries, on either side of a
 *  match comparison. Everything optional — a brand-new account may have
 *  answered none of the taste quiz and never set a home base. */
export interface TasteSignal {
  /** Display-cased cuisine labels, e.g. "Italian" — the same tokens the
   *  taste quiz and rating cuisines both use. */
  cuisines?: string[];
  /** Google price tier 1–4 ("a normal night out"). */
  pricePrimary?: number;
  homeCity?: string | null;
  homeLat?: number | null;
  homeLng?: number | null;
}

const normalizeCuisine = (c: string): string => c.trim().toLowerCase();

const sameCity = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Great-circle distance in km — city-scale precision is all this needs. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * How alike two people's taste looks, 0..1. Built entirely from what the
 * signup taste quiz already asks — cuisines, a price comfort tier, a home
 * base — so a suggestion can reflect *something* real about a brand-new
 * account, before it has a single rating to recommend it.
 *
 * Not normalized by how many signals are available: a candidate who
 * overlaps on cuisine AND price AND location scores higher than one who
 * only overlaps on one, rather than the two tying because each maxed out
 * the one signal it had. Weights (cuisine 0.5, location 0.3, price 0.2)
 * favor cuisine because it's the most explicit, most differentiating
 * answer on the quiz; a shared price tier alone is common enough (most
 * people cluster at $$) to be weak evidence on its own.
 */
export function tasteMatchScore(viewer: TasteSignal, candidate: TasteSignal): number {
  let score = 0;

  const vCuisines = new Set((viewer.cuisines ?? []).map(normalizeCuisine));
  const cCuisines = new Set((candidate.cuisines ?? []).map(normalizeCuisine));
  if (vCuisines.size > 0 && cCuisines.size > 0) {
    let shared = 0;
    vCuisines.forEach((c) => { if (cCuisines.has(c)) shared += 1; });
    const union = new Set([...vCuisines, ...cCuisines]).size;
    score += 0.5 * (shared / union);
  }

  if (viewer.homeLat != null && viewer.homeLng != null && candidate.homeLat != null && candidate.homeLng != null) {
    const km = haversineKm(viewer.homeLat, viewer.homeLng, candidate.homeLat, candidate.homeLng);
    const proximity = km <= 5 ? 1 : km <= 25 ? 0.7 : km <= 100 ? 0.3 : 0;
    score += 0.3 * proximity;
  } else if (sameCity(viewer.homeCity, candidate.homeCity)) {
    score += 0.3;
  }

  if (viewer.pricePrimary && candidate.pricePrimary) {
    const diff = Math.abs(viewer.pricePrimary - candidate.pricePrimary);
    score += 0.2 * (1 - diff / 3);
  }

  return score;
}

/** The human-readable reason behind a match score — what makes someone
 *  worth naming as "not a random suggestion" in the UI. Null when there's
 *  no shared signal to point to (falls back to {@link suggestionSubtitle}'s
 *  rating/follower line instead). */
export function tasteMatchReason(viewer: TasteSignal, candidate: TasteSignal): string | null {
  const vCuisines = new Set((viewer.cuisines ?? []).map(normalizeCuisine));
  const shared = (candidate.cuisines ?? []).filter((c) => vCuisines.has(normalizeCuisine(c)));
  const cityMatch = sameCity(viewer.homeCity, candidate.homeCity);

  if (shared.length > 0) {
    const label = shared.slice(0, 2).join(' & ');
    return cityMatch && candidate.homeCity ? `Also loves ${label} · ${candidate.homeCity}` : `Also loves ${label}`;
  }
  if (cityMatch && candidate.homeCity) return `Also in ${candidate.homeCity}`;
  return null;
}

/**
 * The line under a suggested person's name — the strongest reason that
 * applies, in the same order as the weights that ranked them.
 *
 * Naming mutual friends is safe and is the most persuasive version of
 * this line: they are people the viewer already follows, so it reveals
 * nothing the viewer doesn't already know. `mutualNames` is optional
 * precisely because resolving those names costs a round trip the caller
 * may not want to spend; without it the line degrades to a count.
 *
 * Falls back to the account facts: ratings are the next most useful
 * thing to know in a taste app — "24 ratings" is a promise about what
 * will land in your feed — then followers, then an honest "New here"
 * rather than a "0" that reads as a reason not to follow.
 */
export function suggestionSubtitle(
  p: {
    ratingCount: number;
    followerCount: number;
    matchReason?: string | null;
    contactMatch?: boolean;
    /** Their name in the viewer's address book, when known. */
    contactName?: string | null;
    followsYou?: boolean;
    mutualCount?: number;
    mutualNames?: string[];
  },
): string {
  if (p.contactMatch) {
    return p.contactName ? `${p.contactName} · in your contacts` : 'In your contacts';
  }
  if (p.followsYou) return 'Follows you';

  const mutuals = p.mutualCount ?? 0;
  if (mutuals > 0) {
    const names = p.mutualNames ?? [];
    if (names.length > 0) {
      const rest = mutuals - names.length;
      const shown = names.slice(0, 2).join(', ');
      if (rest > 0) return `Followed by ${shown} + ${rest} more`;
      return `Followed by ${shown}`;
    }
    return `${mutuals} mutual friend${mutuals === 1 ? '' : 's'}`;
  }

  if (p.matchReason) return p.matchReason;
  if (p.ratingCount > 0) return `${p.ratingCount} ${p.ratingCount === 1 ? 'rating' : 'ratings'}`;
  if (p.followerCount > 0) return `${p.followerCount} ${p.followerCount === 1 ? 'follower' : 'followers'}`;
  return 'New here';
}
