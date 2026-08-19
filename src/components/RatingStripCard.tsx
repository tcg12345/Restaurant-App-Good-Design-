/**
 * The card used for a run of photoless ratings ("Also rated") in the feed.
 *
 * Those ratings are all text — a name, a place, a score — so at full width
 * they were near-identical rows that pushed the photos everyone came for
 * off the screen. Here they read as a set instead: a square tile, the
 * author at the top, the place and its score anchored at the bottom, and
 * the whitespace between them doing the work a photo would.
 *
 * Square is load-bearing. A content-height tile at 80% of a phone's width
 * came out long and thin — a full-width row with a gap beside it — and the
 * run stopped reading as a grid of things to scan. Fixing the ratio is
 * also what lets a screenful of them look like one set rather than a stack
 * of unrelated bars.
 *
 * Presentational only: it takes what to draw and what to call, so the feed
 * owns the data and this file owns the geometry (see `ratingStripGridClass`
 * for the run it sits in).
 */
import React from 'react';
import { Heart, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';
import { ScoreRing } from './cards/ScoreRing';

/** Geometry for a run of {@link RatingStripCard}s.
 *
 *  Phone: a swipeable rail of square tiles that stays INSIDE the page
 *  gutter. It used to bleed 18px into the margins to sit flush with the
 *  screen edge, but the Discover column is padded 12px — so the rail hung
 *  6px past the viewport, the parent's overflow-x-hidden sliced the first
 *  card, and the run opened already half off the page. Staying in the
 *  gutter costs nothing and can't be wrong by however much a caller's
 *  padding differs. 78% leaves the next tile peeking, which is the only
 *  thing telling you the rail scrolls; the 320px cap is because phone mode
 *  is every viewport under 1024 (and any native tablet), where a bare 78%
 *  would have drawn a 700px square.
 *
 *  Desktop: a fixed FOUR columns sized the card by the viewport, so the
 *  same tile was 147px beside a sidebar at 1024 and 277px at 1600 — small
 *  enough at the low end to clip its own text. Size the card instead and
 *  let the count follow: auto-fill holds every tile in a 265–320px band
 *  from 1024 up, which is bigger than four-up managed at any width the
 *  feed actually renders at. */
export const ratingStripGridClass = (phoneMode: boolean): string => cn(
  'grid gap-3 snap-x',
  'grid-flow-col auto-cols-[min(78%,320px)] overflow-x-auto no-scrollbar',
  !phoneMode && 'sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:overflow-x-visible',
);

export interface RatingStripCardProps {
  /** Author display name and the initial shown in the avatar disc. */
  name: string;
  initial: string;
  /** Tailwind classes for the author's deterministic avatar tint. */
  avatarBg: string;
  avatarText: string;
  /** Already-formatted relative time ("2 weeks ago"), plus any suffix. */
  when: string;
  place: string;
  /** Cuisine · price · street, pre-joined. */
  meta?: string;
  score: number;
  notes?: string;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onOpen: () => void;
  onLike: () => void;
  onComment: () => void;
}

export const RatingStripCard: React.FC<RatingStripCardProps> = ({
  name, initial, avatarBg, avatarText, when, place, meta, score, notes,
  liked, likeCount, commentCount, onOpen, onLike, onComment,
}) => (
  <div className="group flex aspect-square min-w-0 flex-col overflow-hidden rounded-2xl border border-on-surface/[0.07] bg-paper p-4 transition-all hover:border-on-surface/15 hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.25)]">
    {/* The card body is the tap target; the action bar below is
        deliberately outside it so a like isn't a navigate. */}
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 flex-1 flex-col overflow-hidden text-left focus-visible:outline-none"
    >
      {/* Author line gets the full width; sharing the row with the score
          ring truncated every name to "Jenifer …". */}
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full', avatarBg)}>
          <span className={cn('text-[11px] font-serif font-bold', avatarText)}>{initial}</span>
        </span>
        <span className="min-w-0 truncate text-[12px] leading-tight">
          <span className="font-bold text-on-surface">{name}</span>
          <span className="text-on-surface/40"> · {when}</span>
        </span>
      </div>

      {/* The place is the headline and it sits in the optical middle of the
          square, so a rating with no note and a rating with one read as the
          same object — the slack splits evenly above and below instead of
          pooling into a void under the author. Serif at this size is what
          fills a text-only tile; the ring anchors the opposite corner. */}
      <div className="flex min-w-0 flex-1 flex-col justify-center py-3">
        <div className="flex min-w-0 items-start justify-between gap-2.5">
          <h3 className="min-w-0 flex-1 font-serif text-[20px] font-semibold leading-[1.18] tracking-[-0.015em] text-on-surface line-clamp-2 transition-colors group-hover:text-primary">
            {place}
          </h3>
          <ScoreRing score={score} size={46} className="mt-0.5 flex-shrink-0" />
        </div>
        {meta && (
          <p className="mt-2 truncate text-[12px] font-medium text-on-surface/50">{meta}</p>
        )}
        {notes && (
          <p className="mt-2 text-[13px] leading-[1.45] text-on-surface/70 line-clamp-2">{notes}</p>
        )}
      </div>
    </button>

    <div className="flex flex-shrink-0 items-center gap-1 border-t border-on-surface/[0.06] pt-1 -ml-1.5">
      <button
        type="button"
        onClick={onLike}
        aria-label={liked ? `Unlike ${place}` : `Like ${place}`}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full px-2 transition-colors',
          liked ? 'text-red-500' : 'text-on-surface/55 hover:bg-on-surface/[0.04] hover:text-red-500',
        )}
      >
        <Heart size={17} className={liked ? 'fill-red-500' : ''} />
        <span className="text-[12px] font-semibold tabular-nums">{likeCount}</span>
      </button>
      <button
        type="button"
        onClick={onComment}
        aria-label={`Comments on ${place}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-2 text-on-surface/55 transition-colors hover:bg-on-surface/[0.04] hover:text-primary"
      >
        <MessageSquare size={17} />
        <span className="text-[12px] font-semibold tabular-nums">{commentCount}</span>
      </button>
    </div>
  </div>
);
