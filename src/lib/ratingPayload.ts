/**
 * What gets written to `community_ratings` — and, more importantly, when
 * that write counts as activity.
 *
 * `updated_at` on a community rating is not really a row-modified stamp:
 * it is the ONLY thing the friends feed has. It orders the feed
 * (`getFriendActivity` sorts on it), it prints as "Rated · 2 minutes
 * ago", and the gap between it and `created_at` is what stamps a row
 * "edited". So any write that touches it republishes that rating to the
 * top of every friend's feed as brand-new activity.
 *
 * Three writers were doing exactly that with no user intent behind them:
 * the map's background geocoder patching coordinates onto old ratings,
 * the score settler nudging neighbours after an unrelated new rating,
 * and the boot sync re-uploading everything on a device whose local
 * fingerprint cache was empty. All three produced a wall of "rated 2
 * minutes ago · edited" for meals eaten months earlier.
 *
 * Hence: the stamp is opt-IN. Omitting `updated_at` from an upsert
 * leaves the stored value alone (Postgres only assigns the columns the
 * payload names), so a write that isn't news is invisible to the feed.
 * Only a first rating or a new visit asks for it.
 */

export interface RatingPayloadData {
  name: string;
  score: number;
  notes: string;
  cuisine: string;
  price: string;
  address: string;
  visitDate: string;
  tags: string[];
  wouldReturn: boolean;
  friendIds?: string[];
  lat?: number;
  lng?: number;
  photoUrl?: string;
  ratingMethod?: string;
}

/**
 * When this write should count as rating activity.
 *  - `'now'`     → the user just rated or re-visited; move it to the top.
 *  - a number    → epoch millis, for backfilling a known moment.
 *  - `undefined` → not activity. Leave the feed's ordering alone.
 */
export type ActivityStamp = 'now' | number | undefined;

export function buildRatingPayload(
  userId: string,
  restaurantId: string,
  data: RatingPayloadData,
  activityAt: ActivityStamp,
  now: () => number = Date.now,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    restaurant_id: restaurantId,
    restaurant_name: data.name,
    score: data.score,
    notes: data.notes,
    cuisine: data.cuisine,
    price: data.price,
    address: data.address,
    visit_date: data.visitDate,
    tags: data.tags,
    would_return: data.wouldReturn,
    friend_ids: data.friendIds || [],
  };
  if (data.lat != null) payload.lat = data.lat;
  if (data.lng != null) payload.lng = data.lng;
  if (data.photoUrl) payload.photo_url = data.photoUrl;
  // Only stamped when known — omitting the key on legacy rows leaves any
  // previously-published method untouched (upsert only writes present keys).
  if (data.ratingMethod) payload.rating_method = data.ratingMethod;

  // The key is ABSENT unless this write is activity. Present-but-stale
  // would be worse than absent: the upsert would write it.
  if (activityAt === 'now') {
    payload.updated_at = new Date(now()).toISOString();
  } else if (typeof activityAt === 'number' && Number.isFinite(activityAt)) {
    payload.updated_at = new Date(activityAt).toISOString();
  }
  return payload;
}
