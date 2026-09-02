/**
 * The card used for a run of ratings ("Also rated this week") in the feed.
 *
 * These are the ratings nobody photographed — all text: a name, a place, a
 * score. At full width they were near-identical rows that pushed the
 * photographs everyone came for off the screen. Here they read as a set: a
 * picture-shaped tile you scan rather than read, with the rater as a chip
 * in one corner, their score in the other, and the place named inside.
 *
 * When a cover does exist the tile is that photograph. When it doesn't —
 * which is the common case, since a photo would have earned the rating a
 * post of its own — the tile is a flat panel tinted by the score, and the
 * type turns from white to ink. Same shape either way, so a run of them
 * still reads as one row.
 *
 * Presentational only: it takes what to draw and what to call, so the feed
 * owns the data and this file owns the geometry (see `ratingStripGridClass`
 * for the run it sits in).
 */
import React, { useState } from 'react';
import { Heart, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreTint, scoreChipBg } from '../lib/score';

/** Geometry for a run of {@link RatingStripCard}s.
 *
 *  ONE ROW, always, on every viewport — a swipeable rail rather than a
 *  wrapping grid. A grid of these looked like several stacked sections:
 *  each row of bordered tiles read as its own block, so a run of seven
 *  ratings appeared to be three separate "Also rated" groups under one
 *  heading. A rail cannot be misread that way, and it costs the feed one
 *  row of height instead of three. */
export const ratingStripGridClass = (phoneMode: boolean): string => cn(
  'grid grid-flow-col gap-2.5 snap-x scroll-px-5 overflow-x-auto no-scrollbar',
  'auto-cols-[236px]',
  !phoneMode && 'sm:auto-cols-[236px]',
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
  /** Cover photograph, when the rating has one. */
  photo?: string | null;
  notes?: string;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  /** The tile itself — the rating's own page, not the restaurant's. */
  onOpen: () => void;
  /** The author chip. Omit and the chip is inert text (no username). */
  onOpenAuthor?: () => void;
  onLike: () => void;
  onComment: () => void;
}

export const RatingStripCard: React.FC<RatingStripCardProps> = ({
  name, initial, avatarBg, avatarText, when, place, meta, score, photo,
  liked, likeCount, commentCount, onOpen, onOpenAuthor, onLike, onComment,
}) => {
  const [failed, setFailed] = useState(false);
  const hasPhoto = !!photo && !failed;

  /* Who rated it — a chip, so it reads over a photograph too.
     A SIBLING of the tile button, not a child of it: the chip is its own
     destination (the author's profile) and a button inside a button is
     neither valid HTML nor separately clickable. It stays absolutely
     positioned against the same box, so the geometry is unchanged. */
  const chipInner = (
    <>
      <span className={cn('w-[21px] h-[21px] rounded-full flex items-center justify-center', avatarBg)}>
        <span className={cn('leading-none', avatarText)} style={{ fontSize: '10.5px', fontWeight: 700 }}>{initial}</span>
      </span>
      <span className="max-w-[96px] truncate" style={{ fontSize: '12px', fontWeight: 600 }}>{name}</span>
    </>
  );
  const chipClass = cn(
    'absolute top-[11px] left-[11px] z-10 flex items-center gap-1.5 rounded-full py-[5px] pl-[5px] pr-2.5',
    hasPhoto ? 'bg-black/45 backdrop-blur-md text-white' : 'bg-on-surface/[0.08] text-on-surface',
  );

  return (
    <div className="min-w-0">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            'relative block w-full overflow-hidden rounded-[24px] text-left active:opacity-80 transition-opacity',
            hasPhoto ? 'h-[164px]' : 'h-[136px]',
            !hasPhoto && scoreTint(score),
          )}
          aria-label={`Open ${name}'s review of ${place}`}
        >
          {hasPhoto && (
            <>
              <img
                src={photo!}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setFailed(true)}
                onLoad={(e) => { if (e.currentTarget.naturalWidth === 0) setFailed(true); }}
                className="absolute inset-0 h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
              <span
                className="absolute inset-0"
                style={{ background: 'linear-gradient(to top, rgba(18,15,14,0.72), rgba(18,15,14,0.02) 62%)' }}
              />
            </>
          )}

          <span
            className={cn(
              'absolute top-[11px] right-[11px] rounded-full px-[11px] py-2 tabular-nums',
              hasPhoto ? cn(scoreChipBg(score), 'text-white') : 'bg-surface/70 text-on-surface',
            )}
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {score.toFixed(1)}
          </span>

          <span className="absolute left-3.5 right-3.5 bottom-3">
            <span
              className={cn('block line-clamp-2', hasPhoto ? 'text-white' : 'text-on-surface')}
              style={{ fontSize: '17.5px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.03em' }}
            >
              {place}
            </span>
            {meta && (
              <span
                className={cn('mt-1.5 block truncate', hasPhoto ? 'text-white/75' : 'text-on-surface/50')}
                style={{ fontSize: '12.5px', lineHeight: 1.2 }}
              >
                {meta}
              </span>
            )}
          </span>
        </button>

        {onOpenAuthor ? (
          <button
            type="button"
            onClick={onOpenAuthor}
            className={cn(chipClass, 'active:opacity-70 transition-opacity')}
            aria-label={`${name}'s profile`}
          >
            {chipInner}
          </button>
        ) : (
          <span className={chipClass}>{chipInner}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-[11px] px-0.5">
        <button
          type="button"
          onClick={onLike}
          aria-label={liked ? `Unlike ${place}` : `Like ${place}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-[11px] py-[7px] active:opacity-75 transition-opacity',
            liked ? 'bg-primary/[0.12] text-primary' : 'bg-on-surface/[0.06] text-on-surface',
          )}
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          <Heart size={13} className={liked ? 'fill-primary' : ''} />
          <span className="tabular-nums">{likeCount}</span>
        </button>
        <button
          type="button"
          onClick={onComment}
          aria-label={`Comments on ${place}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] text-on-surface px-[11px] py-[7px] active:opacity-75 transition-opacity"
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          <MessageSquare size={13} />
          <span className="tabular-nums">{commentCount}</span>
        </button>
        <span className="flex-1" />
        <span className="flex-none text-on-surface/35" style={{ fontSize: '12px', lineHeight: 1.2 }}>{when}</span>
      </div>
    </div>
  );
};
