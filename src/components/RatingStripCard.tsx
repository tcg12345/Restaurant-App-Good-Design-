/**
 * The card used for a run of photoless ratings ("Also rated") in the feed.
 *
 * Those ratings are all text — a name, a place, a score — so at full width
 * they were near-identical rows that pushed the photos everyone came for
 * off the screen. Here they read as a set instead: a compact tile, the
 * author at the top, the place and its score under it, actions at the foot.
 *
 * The tile used to be a forced square with its content vertically centred,
 * and that was wrong. A square is ~320px tall while the content is ~150px,
 * so two thirds of every card was empty and the run read as a field of
 * blank boxes. Height now follows the content, and the grid's own
 * stretch keeps a row uniform — which is all the squareness was ever
 * buying. The one flexible gap sits above the action bar, so a rating with
 * a note and one without still line their footers up.
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
 *  ONE ROW, always, on every viewport — a swipeable rail rather than a
 *  wrapping grid. A grid of these looked like several stacked sections:
 *  each row of bordered tiles read as its own block, so a run of seven
 *  ratings appeared to be three separate "Also rated" groups under one
 *  heading. A rail cannot be misread that way, and it costs the feed one
 *  row of height instead of three.
 *
 *  The rail stays INSIDE the page gutter. It used to bleed 18px into the
 *  margins to sit flush with the screen edge, but the Discover column is
 *  padded 12px — so it hung 6px past the viewport, the parent's
 *  overflow-x-hidden sliced the first card, and the run opened already
 *  half off the page.
 *
 *  Card width: 78% of the viewport on a phone so the next tile peeks,
 *  which is the only thing telling you the rail scrolls; capped at 300px
 *  because phone mode is every viewport under 1024 (and any native
 *  tablet), where a bare 78% would have drawn a 700px card. A flat 290px
 *  on desktop puts two and a bit in the feed column at every width it
 *  actually renders at. */
export const ratingStripGridClass = (phoneMode: boolean): string => cn(
  'grid grid-flow-col gap-3 snap-x overflow-x-auto no-scrollbar',
  'auto-cols-[min(78%,300px)]',
  !phoneMode && 'sm:auto-cols-[290px]',
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
  <div className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-on-surface/[0.07] bg-paper px-3.5 pb-1.5 pt-3.5 transition-all hover:border-on-surface/15 hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.25)]">
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
        <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full', avatarBg)}>
          <span className={cn('text-[10px] font-serif font-bold', avatarText)}>{initial}</span>
        </span>
        <span className="min-w-0 truncate text-[11.5px] leading-tight">
          <span className="font-bold text-on-surface">{name}</span>
          <span className="text-on-surface/40"> · {when}</span>
        </span>
      </div>

      {/* Straight into the headline. The ring sits beside it rather than
          under it: a 44px disc next to two lines of serif is the same
          height as the text, so it costs the card nothing. */}
      <div className="mt-2.5 flex min-w-0 items-start justify-between gap-2.5">
        <h3 className="min-w-0 flex-1 font-serif text-[17.5px] font-semibold leading-[1.2] tracking-[-0.015em] text-on-surface line-clamp-2 transition-colors group-hover:text-primary">
          {place}
        </h3>
        <ScoreRing score={score} size={44} className="flex-shrink-0" />
      </div>
      {meta && (
        <p className="mt-1.5 truncate text-[11.5px] font-medium text-on-surface/50">{meta}</p>
      )}
      {notes && (
        <p className="mt-1.5 text-[12.5px] leading-[1.4] text-on-surface/70 line-clamp-2">{notes}</p>
      )}
      {/* The only flexible space in the card, and it is at the bottom —
          so cards of differing content still align their action bars
          instead of each carrying a void in a different place. */}
      <span className="min-h-[6px] flex-1" aria-hidden />
    </button>

    <div className="-ml-1.5 flex flex-shrink-0 items-center gap-1 border-t border-on-surface/[0.06] pt-0.5">
      <button
        type="button"
        onClick={onLike}
        aria-label={liked ? `Unlike ${place}` : `Like ${place}`}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full px-2 transition-colors',
          liked ? 'text-red-500' : 'text-on-surface/55 hover:bg-on-surface/[0.04] hover:text-red-500',
        )}
      >
        <Heart size={15} className={liked ? 'fill-red-500' : ''} />
        <span className="text-[11.5px] font-semibold tabular-nums">{likeCount}</span>
      </button>
      <button
        type="button"
        onClick={onComment}
        aria-label={`Comments on ${place}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-on-surface/55 transition-colors hover:bg-on-surface/[0.04] hover:text-primary"
      >
        <MessageSquare size={15} />
        <span className="text-[11.5px] font-semibold tabular-nums">{commentCount}</span>
      </button>
    </div>
  </div>
);
