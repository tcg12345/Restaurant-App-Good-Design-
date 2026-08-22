import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageSquare, Share2, Bookmark, MoreHorizontal, MapPin } from 'lucide-react';
import { cn } from '../../lib/utils';
import { scoreTint } from '../../lib/score';

/**
 * One post shape for the whole feed.
 *
 * The feed used to render three unrelated layouts — a photo post, a cooked
 * meal, a restaurant rating — each with its own header, its own caption
 * block, and its own action bar in its own place. Two of them put the
 * actions *below* the writing, one put them under the photo; the meal card
 * hung a star summary off the title while the rating card hung a score ring
 * off it. Reading the feed meant re-learning the layout every few hundred
 * pixels.
 *
 * There is one order now, and every kind of post uses it:
 *
 *   1. author line — avatar, name, what they did, when
 *   2. photo, full-bleed, with the dish named inside it
 *   3. one action row, directly under the photo
 *   4. title, then body, then tags
 *   5. the attachment — the place, or the recipe's numbers
 *
 * What differs between kinds is which slots are filled, not where they are.
 */

export type FeedPostKind = 'Dined' | 'Cooked' | 'Rated';

export interface FeedPostMedia {
  id: string;
  url: string;
  /** Burned into the bottom-left of the photo it belongs to. */
  caption?: string;
}

export interface FeedPostProps {
  authorName: string;
  authorInitial: string;
  authorHref?: string;
  /** Tailwind classes for the monogram disc — the feed's existing palette. */
  avatarClass: string;
  badge?: React.ReactNode;
  kind: FeedPostKind;
  when: string;
  onOverflow?: () => void;

  media: FeedPostMedia[];
  /** Design uses 300px for a place, 268px for a recipe. */
  mediaHeight?: number;
  /** Fallback for a post with no photograph at all. */
  onMediaClick?: () => void;

  like: { count: number; liked: boolean; onToggle: () => void };
  comment: { count: number; onOpen: () => void };
  onShare?: () => void;
  save?: { saved: boolean; onToggle: () => void; label?: string };
  /** Replaces the save control when a post's right-hand verb is different. */
  extraAction?: React.ReactNode;

  title?: string;
  titleHref?: string;
  onTitleClick?: () => void;
  body?: string;
  tags?: string[];

  /** The restaurant this post is about. */
  place?: { name: string; meta: string; score?: number | null; onOpen: () => void };
  /** The recipe's numbers, plus the verb that opens it. */
  recipe?: { facts: { icon: React.ReactNode; value: string }[]; actionLabel: string; onAction: () => void };

  children?: React.ReactNode;
  /** The rule that closes the post. Off for the last one in a run. */
  divider?: boolean;
}

const KIND_CHIP: Record<FeedPostKind, string> = {
  Cooked: 'bg-olive/[0.14] text-olive',
  Dined: 'bg-primary/10 text-primary',
  Rated: 'bg-primary/10 text-primary',
};

/** Pill-shaped counter used by like and comment. */
const CountPill: React.FC<{
  active?: boolean; onClick: () => void; label: string; children: React.ReactNode;
}> = ({ active, onClick, label, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className={cn(
      'inline-flex items-center gap-[7px] rounded-full px-[13px] py-[9px] active:opacity-75 transition-opacity',
      active ? 'bg-primary/[0.12] text-primary' : 'bg-on-surface/[0.06] text-on-surface',
    )}
    style={{ fontSize: '12.5px', fontWeight: 700 }}
  >
    {children}
  </button>
);

export const FeedPost: React.FC<FeedPostProps> = ({
  authorName, authorInitial, authorHref, avatarClass, badge, kind, when, onOverflow,
  media, mediaHeight = 300, onMediaClick,
  like, comment, onShare, save, extraAction,
  title, titleHref, onTitleClick, body, tags,
  place, recipe, children, divider = true,
}) => {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const shots = media.filter((m) => m.url && !failed.has(m.id));

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== active) setActive(i);
  };

  const current = shots[active];
  const Name = authorHref ? Link : 'span';
  const nameProps: any = authorHref ? { to: authorHref } : {};

  return (
    <article className="pt-7">
      {/* 1 — who, and what they did */}
      <div className="px-5 flex items-center gap-[11px]">
        <Name {...nameProps} className="flex-none">
          <span className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white', avatarClass)} style={{ fontSize: '14px', fontWeight: 700 }}>
            {authorInitial}
          </span>
        </Name>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[7px]">
            <Name {...nameProps} className="truncate text-on-surface" style={{ fontSize: '14.5px', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.022em' }}>
              {authorName}
            </Name>
            {badge}
            <span
              className={cn('flex-none rounded-full px-2 py-[5px]', KIND_CHIP[kind])}
              style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {kind}
            </span>
          </div>
          <p className="mt-[5px] text-on-surface/45" style={{ fontSize: '12px', lineHeight: 1 }}>{when}</p>
        </div>
        {onOverflow && (
          <button
            type="button" onClick={onOverflow} aria-label="More"
            className="flex-none w-[30px] h-[30px] rounded-full flex items-center justify-center text-on-surface/45 active:bg-on-surface/[0.07] transition-colors"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>

      {/* 2 — the photograph, with the dish named inside it */}
      {shots.length > 0 && (
        <div className="relative mt-3.5 overflow-hidden lg:mx-auto lg:max-w-[460px] lg:rounded-2xl" style={{ height: mediaHeight }}>
          <div
            ref={trackRef}
            onScroll={onScroll}
            className="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar"
            style={{ scrollbarWidth: 'none' }}
          >
            {shots.map((m) => (
              <div key={m.id} className="relative w-full h-full flex-none snap-center bg-on-surface/[0.05]">
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setFailed((p) => new Set(p).add(m.id))}
                  onLoad={(e) => { if (e.currentTarget.naturalWidth === 0) setFailed((p) => new Set(p).add(m.id)); }}
                  onClick={onMediaClick}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
              </div>
            ))}
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
            style={{ background: 'linear-gradient(to top, rgba(18,15,14,0.5), transparent)' }}
          />
          {current?.caption && (
            <p
              className="pointer-events-none absolute left-5 bottom-4 right-20 truncate text-white"
              style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.2, textShadow: '0 1px 8px rgba(18,15,14,0.4)' }}
            >
              {current.caption}
            </p>
          )}
          {shots.length > 1 && (
            <>
              <span
                className="absolute top-3.5 right-3.5 rounded-full bg-black/50 backdrop-blur-md text-white px-[9px] py-1.5 tabular-nums"
                style={{ fontSize: '11px', fontWeight: 700 }}
              >
                {active + 1}/{shots.length}
              </span>
              <div className="absolute right-4 bottom-4 flex items-center gap-[5px]">
                {shots.map((m, i) => (
                  <span
                    key={m.id}
                    className={cn('h-[5px] rounded-full transition-[width,background-color] duration-[260ms] ease-[var(--ease-drawer)]', i === active ? 'bg-media-white' : 'bg-white/50')}
                    style={{ width: i === active ? 16 : 5 }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 3 — one action row, and only one */}
      <div className="px-5 pt-3.5 flex items-center gap-1.5">
        <CountPill active={like.liked} onClick={like.onToggle} label={like.liked ? 'Unlike' : 'Like'}>
          <Heart size={15} className={like.liked ? 'fill-primary' : ''} />
          <span className="tabular-nums">{like.count}</span>
        </CountPill>
        <CountPill onClick={comment.onOpen} label="Comments">
          <MessageSquare size={15} />
          <span className="tabular-nums">{comment.count}</span>
        </CountPill>
        <div className="flex-1" />
        {onShare && (
          <button
            type="button" onClick={onShare} aria-label="Share"
            className="w-9 h-9 rounded-full bg-on-surface/[0.06] text-on-surface flex items-center justify-center active:opacity-75 transition-opacity"
          >
            <Share2 size={15} />
          </button>
        )}
        {extraAction}
        {save && (
          <button
            type="button" onClick={save.onToggle} aria-label={save.label || (save.saved ? 'Saved' : 'Save')}
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center active:opacity-75 transition-opacity',
              save.saved ? 'bg-primary text-white' : 'bg-on-surface/[0.06] text-on-surface',
            )}
          >
            <Bookmark size={15} className={save.saved ? 'fill-current' : ''} />
          </button>
        )}
      </div>

      {/* 4 — what they said */}
      {(title || body || (tags && tags.length > 0)) && (
        <div className="px-5">
          {title && (() => {
            const inner = <h3 className="text-on-surface" style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.03em', textWrap: 'pretty' } as React.CSSProperties}>{title}</h3>;
            const cls = 'mt-[18px] block w-full text-left active:opacity-70 transition-opacity';
            if (titleHref) return <Link to={titleHref} className={cls}>{inner}</Link>;
            if (onTitleClick) return <button type="button" onClick={onTitleClick} className={cls}>{inner}</button>;
            return <div className="mt-[18px]">{inner}</div>;
          })()}
          {body && (
            <p className="mt-[9px] text-on-surface/60" style={{ fontSize: '14px', lineHeight: 1.55, textWrap: 'pretty' } as React.CSSProperties}>{body}</p>
          )}
          {tags && tags.length > 0 && (
            <div className="mt-[13px] flex flex-wrap gap-1.5">
              {tags.slice(0, 4).map((t) => (
                <span key={t} className="rounded-full bg-on-surface/[0.06] text-on-surface/60 px-[11px] py-[7px]" style={{ fontSize: '11.5px', fontWeight: 600 }}>{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5 — what it is about: the place, or the recipe's numbers */}
      {place && (
        <div className="px-5">
          <button
            type="button"
            onClick={place.onOpen}
            className="mt-4 w-full flex items-center gap-3 rounded-[18px] bg-on-surface/[0.05] px-3.5 py-[13px] text-left active:opacity-80 transition-opacity"
          >
            <MapPin size={15} className="flex-none text-primary" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-on-surface" style={{ fontSize: '14.5px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.025em' }}>{place.name}</p>
              {place.meta && <p className="mt-[5px] truncate text-on-surface/45" style={{ fontSize: '12px', lineHeight: 1.2 }}>{place.meta}</p>}
            </div>
            {place.score != null && place.score > 0 && (
              <span className={cn('flex-none rounded-full px-[11px] py-2 tabular-nums', scoreTint(place.score))} style={{ fontSize: '13px', fontWeight: 700 }}>
                {place.score.toFixed(1)}
              </span>
            )}
          </button>
        </div>
      )}

      {recipe && recipe.facts.length > 0 && (
        <div className="px-5">
          <div className="mt-4 pt-3.5 border-t border-on-surface/[0.12] flex items-center gap-4">
            {recipe.facts.map((f) => (
              <span key={f.value} className="flex items-center gap-[7px] text-on-surface/60" style={{ fontSize: '12.5px', fontWeight: 500 }}>
                <span className="text-on-surface/45">{f.icon}</span>
                {f.value}
              </span>
            ))}
            <span className="flex-1" />
            <button
              type="button" onClick={recipe.onAction}
              className="flex-none rounded-full bg-primary/10 text-primary px-[13px] py-[9px] active:opacity-75 transition-opacity"
              style={{ fontSize: '12px', fontWeight: 700 }}
            >
              {recipe.actionLabel}
            </button>
          </div>
        </div>
      )}

      {children}

      {/* The rule that ends a post. Inset to the gutter, not full-bleed:
          a line that runs to both edges reads as a page break, and there
          is one of these every screenful. */}
      {divider && <div className="mx-5 mt-[26px] border-t border-on-surface/[0.14]" aria-hidden />}
    </article>
  );
};
