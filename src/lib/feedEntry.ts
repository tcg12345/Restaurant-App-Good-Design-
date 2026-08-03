/**
 * One shape for everything that appears in the social feed.
 *
 * Posts and ratings were separate worlds: two tables, two composers, and —
 * because the home feed gated its sources per tab — two lists that never
 * showed a post and a rating together. Beta testers read that as duplicate
 * entries for one meal and couldn't tell which action actually counted as a
 * rating. This module is the single normalization point: whatever the
 * backing record, the feed sees one `FeedEntry`, renders one card, and shows
 * one meal exactly once.
 *
 * The rules encoded here:
 *  - A rating that was shared as a post appears ONCE (the post wins — it
 *    carries the photos and the per-photo captions), never as both.
 *  - `score != null` means "this is a scored review"; `media.length > 0`
 *    means "this has photos". Those two flags — not the source table —
 *    decide how every surface renders it.
 *  - Imported ratings never enter the feed. A Beli import lands hundreds of
 *    rows in one go and would bury everyone's friends.
 *
 * Timestamps deliberately keep their per-source meaning: a rating sorts by
 * `activityTimestamp()` (updated_at) so a NEW VISIT to a place someone
 * rated a year ago resurfaces — that's the "recent ratings from friends"
 * the feed is for — while a post sorts by its own creation. Once a share
 * carries a linked post, the post's time governs, which is the same thing.
 */

import type { CommunityRating } from './supabase-community';
import { activityTimestamp } from './supabase-community';
import type { PostRow, PostItemRow } from './supabase-posts';
import type { FriendHomeMeal } from './supabase-community';

export interface FeedMedia {
  kind: 'photo' | 'video';
  /** Display URL — signed for post media, plain for a rating's cover. */
  url: string;
  /** Poster frame for a video item ('' when none). */
  posterUrl?: string;
  /** Mux playback id when the video streams from Mux. */
  muxPlaybackId?: string;
  muxStatus?: string;
  /** Per-photo caption (posts only). */
  caption?: string;
}

export interface FeedRestaurantRef {
  id: string;
  name: string;
  cuisine?: string;
  price?: string;
  address?: string;
  image?: string;
}

export interface FeedEntry {
  /** Stable React key, unique across sources. */
  key: string;
  /** Which record backs this entry — decides the action handlers, not the
   *  visual language (that comes from `score` / `media`). */
  kind: 'post' | 'rating' | 'homeMeal';
  authorId: string;
  /** Milliseconds; the single sort key for the merged stream. */
  sortTime: number;
  /** Present ⇒ a scored review. Drives the score badge and detail routing. */
  score?: number;
  /** Score came from the slider, so it doesn't count toward community
   *  averages — surfaced as a "self-scored" marker. */
  selfScored?: boolean;
  /** Empty ⇒ compact card, and hidden from photo-grid surfaces (a
   *  photoless tile renders as an empty square). */
  media: FeedMedia[];
  /** Post caption or rating notes — the prose of the entry. */
  caption: string;
  tags: string[];
  restaurant?: FeedRestaurantRef;
  /** Set when a rating backs (or is linked to) this entry — the target for
   *  /review/:ratingId and the dedupe key. */
  ratingId?: string;
  postId?: string;
  /** True when the row was edited after creation (rating rows only). */
  edited?: boolean;
  /** The original records, for the renderers' existing action handlers. */
  source: { post?: PostRow; rating?: CommunityRating; homeMeal?: FriendHomeMeal };
}

/** Ratings created by a bulk import — never feed material. */
export function isImportedRating(r: Pick<CommunityRating, 'rating_method'>): boolean {
  return r.rating_method === 'import';
}

const parseTime = (iso: string | null | undefined): number => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** The restaurant a post is about: the first item carrying a restaurant
 *  attachment (items can attach a restaurant OR a recipe, per item). */
function postRestaurant(p: PostRow): FeedRestaurantRef | undefined {
  const withRest = p.items.find((i) => i.attachedKind === 'restaurant' && i.restaurant);
  const r = withRest?.restaurant;
  if (!r) return undefined;
  return { id: r.id, name: r.name, cuisine: r.cuisine, price: r.price, address: r.address, image: r.image };
}

function postMedia(items: PostItemRow[]): FeedMedia[] {
  return items
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      kind: i.mediaType,
      url: i.mediaUrl,
      posterUrl: i.posterUrl,
      muxPlaybackId: i.muxPlaybackId,
      muxStatus: i.muxStatus,
      caption: i.caption,
    }))
    // A Mux item that is still transcoding has neither a signed URL nor a
    // playback id — it would render as a broken tile until it's ready.
    .filter((m) => !!m.url || !!m.muxPlaybackId);
}

export function fromPost(p: PostRow): FeedEntry {
  return {
    key: `post-${p.id}`,
    kind: 'post',
    authorId: p.userId,
    sortTime: parseTime(p.createdAt),
    score: typeof p.score === 'number' ? p.score : undefined,
    media: postMedia(p.items),
    caption: p.caption || '',
    tags: [],
    restaurant: postRestaurant(p),
    ratingId: p.ratingId || undefined,
    postId: p.id,
    source: { post: p },
  };
}

export function fromRating(r: CommunityRating): FeedEntry {
  const cover = r.photo_url || '';
  return {
    key: `rating-${r.id}`,
    kind: 'rating',
    authorId: r.user_id,
    // updated_at, so a new visit to an old favourite resurfaces (see the
    // module note) — the fetch window orders by the same column.
    sortTime: parseTime(activityTimestamp(r)),
    score: Number(r.score) || 0,
    selfScored: r.rating_method === 'slider',
    media: cover ? [{ kind: 'photo', url: cover }] : [],
    caption: r.notes || '',
    tags: r.tags || [],
    restaurant: {
      id: r.restaurant_id,
      name: r.restaurant_name,
      cuisine: r.cuisine || undefined,
      price: r.price || undefined,
      address: r.address || undefined,
      image: cover || undefined,
    },
    ratingId: r.id,
    edited: !!(r.updated_at && r.created_at && Date.parse(r.updated_at) - Date.parse(r.created_at) > 60_000),
    source: { rating: r },
  };
}

export function fromHomeMeal(m: FriendHomeMeal): FeedEntry {
  return {
    key: `meal-${m.id}`,
    kind: 'homeMeal',
    authorId: m.userId,
    sortTime: m.createdAt || 0,
    media: [],
    caption: m.description || '',
    tags: m.tags || [],
    source: { homeMeal: m },
  };
}

export interface MergeFeedInput {
  posts?: PostRow[];
  ratings?: CommunityRating[];
  homeMeals?: FriendHomeMeal[];
}

/**
 * The one merged, deduped, time-sorted stream the feed renders.
 *
 * Dedupe: a post that links a rating (`post.ratingId`) IS that rating's
 * share, so the standalone rating row is dropped — one meal, one card. The
 * post wins because it carries the photos and per-photo captions.
 */
export function mergeFeed({ posts = [], ratings = [], homeMeals = [] }: MergeFeedInput): FeedEntry[] {
  const sharedRatingIds = new Set<string>();
  for (const p of posts) {
    if (p.ratingId) sharedRatingIds.add(p.ratingId);
  }

  const entries: FeedEntry[] = [];
  for (const p of posts) entries.push(fromPost(p));
  for (const r of ratings) {
    if (isImportedRating(r)) continue;
    if (sharedRatingIds.has(r.id)) continue; // already shown as its post
    entries.push(fromRating(r));
  }
  for (const m of homeMeals) entries.push(fromHomeMeal(m));

  // Newest first; ties break on key so the order is deterministic across
  // renders (two rows can share a timestamp after an import or a bulk sync).
  return entries.sort((a, b) => b.sortTime - a.sortTime || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Entries that can render in a photo grid (profile Posts tab, /activity,
 *  Reels explore). A photoless share would be an empty tile. */
export function hasMedia(e: FeedEntry): boolean {
  return e.media.length > 0;
}

/* ── Feed layout ── */

export type FeedLayoutRow =
  /** One entry, rendered at full width. */
  | { kind: 'full'; entry: FeedEntry }
  /** A horizontally scrolling batch of photoless ratings. */
  | { kind: 'strip'; entries: FeedEntry[] };

export interface LayoutFeedOptions {
  /** Full cards between one strip and the next. */
  stripEvery?: number;
  /** Most photoless ratings in a single strip. */
  stripSize?: number;
  /** False renders every entry full-width — the Verified tab, where
   *  nearly every rating is photoless and stripping them would leave a
   *  wall of tiles with no full cards to break it up. */
  enabled?: boolean;
}

/** Photoless ratings ride in strips; everything else is a full card. A
 *  post or a rating with photos has something to look at, so it earns the
 *  width. */
function isCompact(e: FeedEntry): boolean {
  return e.kind === 'rating' && !hasMedia(e);
}

/**
 * Turn the time-sorted stream into rows.
 *
 * A friend rating three places on their commute used to mean three
 * near-identical full-width cards — a name, a score, and nothing to look
 * at — pushing the photos everyone actually came for off the screen.
 * Those ratings still belong in the feed, just not at that size: they
 * collect into a small horizontal strip that lands after every
 * `stripEvery` full cards.
 *
 * Both sequences stay in time order and are consumed in parallel, so a
 * strip holds the photoless ratings from roughly the stretch of timeline
 * it sits in. When the full cards run out the remaining strips follow,
 * rather than being dropped — a quiet week of photoless ratings is still
 * the week's activity.
 */
export function layoutFeed(entries: FeedEntry[], options: LayoutFeedOptions = {}): FeedLayoutRow[] {
  const { stripEvery = 4, stripSize = 4, enabled = true } = options;
  if (!enabled || stripEvery < 1 || stripSize < 1) {
    return entries.map((entry) => ({ kind: 'full', entry }));
  }

  const full = entries.filter((e) => !isCompact(e));
  const compact = entries.filter(isCompact);
  if (compact.length === 0) return full.map((entry) => ({ kind: 'full', entry }));

  const rows: FeedLayoutRow[] = [];
  let next = 0;
  const flushStrip = () => {
    if (next >= compact.length) return;
    rows.push({ kind: 'strip', entries: compact.slice(next, next + stripSize) });
    next += stripSize;
  };

  full.forEach((entry, i) => {
    rows.push({ kind: 'full', entry });
    // After the 4th, 8th, 12th … full card — never leading with a strip,
    // so the feed opens on something worth looking at.
    if ((i + 1) % stripEvery === 0) flushStrip();
  });
  while (next < compact.length) flushStrip();

  return rows;
}
