import './FeedDiscovery.css';
import { PhotoGallery } from '../PhotoGallery';
import { homeHaptic } from '../../lib/haptics';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageSquare, Bookmark, MoreHorizontal, MapPin } from 'lucide-react';
import { ShareIcon } from '../icons/ShareIcon';
import { cn } from '../../lib/utils';
import { scoreTint } from '../../lib/score';

/** Shared photo-led post: identity, meal mosaic, reactions, and the author's notes. */

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
    onClick={() => { homeHaptic(); onClick(); }}
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
  media,
  like, comment, onShare, save, extraAction,
  title, titleHref, onTitleClick, body, tags,
  place, recipe, children, divider = true,
}) => {
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const shots = media.filter((m) => m.url && !failed.has(m.id));

  const Name = authorHref ? Link : 'span';
  const nameProps: any = authorHref ? { to: authorHref } : {};

  return (
    <article className="feed-post pt-7">
      {/* 1 — who, and what they did */}
      <div className="feed-post-author px-5 flex items-center gap-[11px]">
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
              className={cn('feed-post-kind flex-none rounded-full px-2 py-[5px]', KIND_CHIP[kind])}
              style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              {kind}
            </span>
          </div>
          <p className="mt-[5px] truncate text-on-surface/45" style={{ fontSize: '12px', lineHeight: 1.2 }}>{when}</p>
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

      {place && (
        <div className="px-5">
          <button
            type="button"
            onClick={place.onOpen}
            className="feed-post-place mt-4 w-full flex items-center gap-3 rounded-[18px] bg-on-surface/[0.05] px-3.5 py-[13px] text-left active:opacity-80 transition-opacity"
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

      {shots.length > 0 && (
        <div className="feed-mosaic" data-count={Math.min(shots.length, 3)}>
          {shots.slice(0, 3).map((shot, i) => (
            <button key={shot.id} type="button" aria-label={`View photo ${i + 1} of ${shots.length}${shot.caption ? `: ${shot.caption}` : ''}`} onClick={() => { homeHaptic(); setPhotoIndex(i); }}>
              <img src={shot.url} alt={shot.caption || `${authorName}'s ${kind === 'Cooked' ? 'cooking' : 'meal'}`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(prev => new Set(prev).add(shot.id))} />
              {shot.caption && <span className="feed-mosaic-caption">{shot.caption}</span>}
              {i === Math.min(shots.length, 3) - 1 && shots.length > 3 && <span className="feed-mosaic-more">+{shots.length - 3} photos</span>}
            </button>
          ))}
        </div>
      )}
      {photoIndex !== null && <PhotoGallery photos={shots.map(s => s.url)} communityPhotos={[]} name={place?.name || title || authorName} initialIndex={photoIndex} photoCaptions={Object.fromEntries(shots.map(s => [s.url, s.caption || '']))} startExpanded onClose={() => setPhotoIndex(null)} />}

      {/* 3 — one action row, and only one */}
      <div className="feed-post-actions px-5 pt-3.5 flex items-center gap-1.5">
        <CountPill active={like.liked} onClick={like.onToggle} label={like.liked ? 'Unlike' : 'Like'}>
          <Heart size={15} className={like.liked ? 'fill-primary' : ''} />
          {like.count > 0 && <span className="tabular-nums">{like.count}</span>}
        </CountPill>
        <CountPill onClick={comment.onOpen} label="Comments">
          <MessageSquare size={15} />
          <span className="tabular-nums">{comment.count > 0 ? comment.count : 'Reply'}</span>
        </CountPill>
        <div className="flex-1" />
        {onShare && (
          <button
            type="button" onClick={onShare} aria-label="Share"
            className="w-9 h-9 rounded-full bg-on-surface/[0.06] text-on-surface flex items-center justify-center active:opacity-75 transition-opacity"
          >
            <ShareIcon size={15} />
          </button>
        )}
        {extraAction}
        {save && (
          <button
            type="button" onClick={() => { homeHaptic(); save.onToggle(); }} aria-label={save.label || (save.saved ? 'Saved' : 'Save')}
            className={cn(
              'feed-save h-9 rounded-full flex items-center justify-center active:opacity-75 transition-opacity',
              save.saved ? 'bg-primary text-on-primary' : 'bg-on-surface/[0.06] text-on-surface',
            )}
          >
            <Bookmark size={15} className={save.saved ? 'fill-current' : ''} /><span>{save.saved ? 'Saved' : 'Save'}</span>
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
            <p className={cn('mt-[9px] text-on-surface/60', !bodyExpanded && body.length > 180 && 'line-clamp-3')} style={{ fontSize: '14px', lineHeight: 1.55, textWrap: 'pretty' } as React.CSSProperties}>{body}</p>
          )}
          {body && body.length > 180 && <button type="button" className="feed-body-toggle" aria-expanded={bodyExpanded} onClick={() => setBodyExpanded(v => !v)}>{bodyExpanded ? 'Less' : 'Read more'}</button>}
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

      {recipe && (
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
      {divider && <div className="feed-post-divider mx-5 mt-[26px] border-t border-on-surface/[0.14]" aria-hidden />}
    </article>
  );
};
