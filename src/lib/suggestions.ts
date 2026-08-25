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
}

/**
 * Rank by what makes someone worth following, not by recency.
 *
 * Verification first — it is the platform's own endorsement. Then volume of
 * published ratings, because following someone with forty ratings gives you
 * a feed and following someone with none gives you a blank page. Followers
 * break the remaining ties.
 *
 * Verification is a BOOST, not a gate. The rail this replaced listed only
 * verified accounts, so on a platform with none it showed nobody, every
 * time — the failure this ordering exists to avoid.
 *
 * The final tiebreak is the user id so the rail doesn't reshuffle between
 * reloads on whatever order the database happened to return.
 */
export function rankSuggestedProfiles<T extends RankableProfile>(candidates: T[], limit: number): T[] {
  return [...candidates]
    .sort((a, b) =>
      Number(b.is_verified) - Number(a.is_verified)
      || b.ratingCount - a.ratingCount
      || b.followerCount - a.followerCount
      || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0),
    )
    .slice(0, Math.max(0, limit));
}

/**
 * The line under a suggested person's name.
 *
 * Ratings are the thing worth knowing in a taste app — "24 ratings" is a
 * promise about what will land in your feed. Followers only speak up when
 * there are no ratings to report, and someone with neither gets an honest
 * label rather than a "0" that reads as a reason not to follow them.
 */
export function suggestionSubtitle(p: { ratingCount: number; followerCount: number }): string {
  if (p.ratingCount > 0) return `${p.ratingCount} ${p.ratingCount === 1 ? 'rating' : 'ratings'}`;
  if (p.followerCount > 0) return `${p.followerCount} ${p.followerCount === 1 ? 'follower' : 'followers'}`;
  return 'New here';
}
