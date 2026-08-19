/**
 * ProfileReelsSection — compact reels grid used on both the signed-in
 * user's Profile page and other users' UserProfile pages.
 *
 *   • 3-column grid of small vertical thumbnails.
 *   • Capped at 6 by default with a "See all" expand button so the section
 *     stays small on profiles with lots of reels.
 *   • When the viewer owns the reels, each tile gets a privacy toggle
 *     (Globe ↔ Lock) and a delete pill on hover/touch.
 *   • Read-only mode (other people's profiles) just shows the tiles.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Globe, Trash2, ChevronRight, Layers, Pencil, BookOpen, ChefHat, MoreHorizontal, Play, Heart, MapPin, ArrowRight } from 'lucide-react';
import { cn, firstFrameSrc } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useCardLongPress, CardActionMenu, type CardAction } from './CardActionMenu';
import type { Reel } from '../contexts/ReelsContext';
import type { Post } from '../contexts/PostsContext';
import { isPublicGuide, type Guide } from '../lib/supabase-guides';

/** Compact engagement count: 12400 → "12.4k", 980 → "980". */
const formatCount = (n: number): string => {
  if (!n || n < 0) return '0';
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
};

/**
 * Hover "⋯" affordance shown on owner tiles in the desktop layouts — long-press
 * / right-click still work, but a visible button is the natural desktop gesture.
 * Opens the same CardActionMenu, anchored to the button.
 */
const OwnerMoreButton: React.FC<{ onOpen: (rect: DOMRect) => void; className?: string }> = ({ onOpen, className }) => (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpen(e.currentTarget.getBoundingClientRect()); }}
    className={cn(
      'absolute z-10 w-8 h-8 rounded-full grid place-items-center bg-black/50 backdrop-blur text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-opacity',
      className,
    )}
    aria-label="More actions"
  >
    <MoreHorizontal size={16} />
  </button>
);

/** Small translucent badge used over media (entry count, Draft/Private, etc.). */
const MediaBadge: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <span className={cn('inline-flex items-center gap-1 px-2 h-[22px] rounded-full bg-black/55 backdrop-blur text-white text-[10.5px] font-bold tabular-nums', className)}>
    {children}
  </span>
);

interface ProfileReelsSectionProps {
  reels: Reel[];
  /** When true, render owner-only controls (privacy toggle + delete). */
  isOwn?: boolean;
  /** Tile click destination — defaults to /reels?kind=<reel.kind>. */
  onTileClick?: (reel: Reel) => void;
  onDelete?: (reelId: string) => void;
  onEdit?: (reelId: string) => void;
  onToggleVisibility?: (reelId: string, nextIsPublic: boolean) => void;
  /** Optional — overrides the default "My Reels" / "Reels" title. */
  title?: string;
  /** When true, omit the section header (count + title) entirely.
   *  Used by the Profile page where the tab itself serves as the heading. */
  hideHeader?: boolean;
  /** Optional CTA shown next to the title (e.g. "Open feed"). */
  trailing?: React.ReactNode;
}

/* ── Posts grid (parallel to reels grid, same compact 3-up layout) ───── */

interface ProfilePostsSectionProps {
  posts: Post[];
  isOwn?: boolean;
  onTileClick?: (post: Post) => void;
  onDelete?: (postId: string) => void;
  onEdit?: (postId: string) => void;
  onToggleVisibility?: (postId: string, nextIsPublic: boolean) => void;
  title?: string;
  hideHeader?: boolean;
  trailing?: React.ReactNode;
}

export const ProfilePostsSection: React.FC<ProfilePostsSectionProps> = ({
  posts, isOwn = false, onTileClick, onDelete, onEdit, onToggleVisibility, title, hideHeader = false, trailing,
}) => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const [showAll, setShowAll] = useState(false);
  // Long-press (or right-click) a tile to open its actions menu — owner only.
  const [menu, setMenu] = useState<{ id: string; isPublic: boolean; rect: DOMRect } | null>(null);
  const press = useCardLongPress<Post>((p, target) => {
    if (!isOwn) return;
    setMenu({ id: p.id, isPublic: p.isPublic, rect: target.getBoundingClientRect() });
  });
  // A share published from the rating flow with no photos is a real post
  // row, but it has nothing to put in a tile — it would render as an empty
  // square. Photo grids show only shares that actually carry media; the
  // score-only ones live in the feed and on the Rated tab.
  const withMedia = posts.filter((p) => p.items.length > 0);
  if (withMedia.length === 0) return null;
  const VISIBLE_LIMIT = 6;
  const visible = showAll ? withMedia : withMedia.slice(0, VISIBLE_LIMIT);

  const handleClick = (p: Post) => {
    if (onTileClick) { onTileClick(p); return; }
    navigate(`/r/post-${p.id}`);
  };

  const ownerMenu = menu && (
    <CardActionMenu
      rect={menu.rect}
      onClose={() => setMenu(null)}
      actions={[
        ...(onEdit ? [{ label: 'Edit', icon: <Pencil size={16} />, onClick: () => onEdit(menu.id) }] : []),
        ...(onToggleVisibility ? [{
          label: menu.isPublic ? 'Make followers-only' : 'Make public',
          icon: menu.isPublic ? <Lock size={16} /> : <Globe size={16} />,
          onClick: () => onToggleVisibility(menu.id, !menu.isPublic),
        }] : []),
        ...(onDelete ? [{ label: 'Delete', icon: <Trash2 size={16} />, onClick: () => onDelete(menu.id), danger: true }] : []),
      ] as CardAction[]}
    />
  );

  const seeAll = withMedia.length > VISIBLE_LIMIT && (
    <div className="mt-3.5">
      {showAll ? (
        <button type="button" onClick={() => setShowAll(false)} className="text-[12.5px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
      ) : (
        <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary/90 hover:text-primary">
          See all {withMedia.length} posts <ChevronRight size={13} />
        </button>
      )}
    </div>
  );

  // ── Desktop: editorial post tiles (cover + caption/likes/place overlay) ──
  if (!phoneMode) {
    return (
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-4)] mb-[18px]">
          {withMedia.length} {withMedia.length === 1 ? 'Post' : 'Posts'}
        </div>
        <div className="grid grid-cols-3 gap-3.5">
          {visible.map((p) => {
            const cover = p.items[0];
            const place = p.locationLabel?.trim();
            return (
              <div key={p.id} className="group relative">
                <button
                  type="button"
                  {...(isOwn ? press.getHandlers(p) : {})}
                  onClick={() => {
                    if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                    handleClick(p);
                  }}
                  className="relative block w-full aspect-square overflow-hidden rounded-[18px] bg-on-surface/[0.05] select-none"
                  aria-label={p.caption || 'Open post'}
                >
                  {/* Warm gradient base so the tile never reads as bare gray
                      while the media decodes. */}
                  <div className={cn('absolute inset-0 bg-gradient-to-b', cover?.bgGradient || 'from-stone-700 to-stone-900')} />
                  {cover?.mediaType === 'video' && cover.mediaUrl ? (
                    <video src={firstFrameSrc(cover.mediaUrl)} poster={cover.posterUrl || undefined} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                  ) : cover?.mediaUrl ? (
                    <img src={cover.mediaUrl} alt="" draggable={false} loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                  ) : null}
                  <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(22,13,8,0.80), rgba(22,13,8,0) 58%)' }} />
                  <div className="absolute inset-x-0 bottom-0 p-4 text-left">
                    <div className="font-serif font-bold text-white text-[16px] leading-[1.22] text-pretty line-clamp-2">{p.caption || 'Untitled'}</div>
                    <div className="flex items-center gap-3.5 mt-2.5 text-[12px] font-semibold text-white/[0.86]">
                      <span className="inline-flex items-center gap-1.5"><Heart size={13} className="fill-white" />{formatCount(p.likesCount)}</span>
                      {place && <span className="inline-flex items-center gap-1.5 min-w-0"><MapPin size={12} strokeWidth={2.4} className="flex-none" /><span className="truncate">{place}</span></span>}
                    </div>
                  </div>
                  {isOwn && !p.isPublic ? (
                    <div className="absolute top-3 left-3"><MediaBadge><Lock size={11} /> Followers</MediaBadge></div>
                  ) : p.items.length > 1 ? (
                    <Layers size={16} className="absolute top-3 left-3 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]" />
                  ) : null}
                </button>
                {isOwn && <OwnerMoreButton onOpen={(rect) => setMenu({ id: p.id, isPublic: p.isPublic, rect })} className="top-3 right-3" />}
              </div>
            );
          })}
        </div>
        {ownerMenu}
        {seeAll}
      </section>
    );
  }

  // ── Mobile: full-bleed 3-up tiles with caption / likes overlay ───────
  return (
    <section>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-4)] px-6 mb-3.5">
        {withMedia.length} {withMedia.length === 1 ? 'Post' : 'Posts'}
      </div>
      <div className="grid grid-cols-3">
        {visible.map((p) => {
          const cover = p.items[0];
          return (
            <button
              key={p.id}
              type="button"
              {...(isOwn ? press.getHandlers(p) : {})}
              onClick={() => {
                if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                handleClick(p);
              }}
              className="relative block w-full aspect-square overflow-hidden bg-on-surface/[0.05] select-none [-webkit-touch-callout:none]"
              aria-label={p.caption || 'Open post'}
            >
              <div className={cn('absolute inset-0 bg-gradient-to-b', cover?.bgGradient || 'from-stone-700 to-stone-900')} />
              {cover?.mediaType === 'video' && cover.mediaUrl ? (
                <video src={firstFrameSrc(cover.mediaUrl)} poster={cover.posterUrl || undefined} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 w-full h-full object-cover" />
              ) : cover?.mediaUrl ? (
                <img src={cover.mediaUrl} alt="" draggable={false} loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 w-full h-full object-cover" />
              ) : null}
              <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(22,13,8,0.78), rgba(22,13,8,0) 58%)' }} />
              <div className="absolute inset-x-0 bottom-0 p-2 text-left">
                <div className="font-serif font-bold text-white text-[11px] leading-[1.15] text-pretty line-clamp-2">{p.caption || 'Untitled'}</div>
                <div className="inline-flex items-center gap-1 mt-1 text-[9.5px] font-semibold text-white/[0.88]"><Heart size={10} className="fill-white" />{formatCount(p.likesCount)}</div>
              </div>
              {isOwn && !p.isPublic ? (
                <div className="absolute top-1.5 right-1.5 inline-flex items-center bg-black/55 backdrop-blur rounded-full p-1 text-white"><Lock size={10} /></div>
              ) : p.items.length > 1 ? (
                <Layers size={14} className="absolute top-1.5 right-1.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
              ) : null}
            </button>
          );
        })}
      </div>
      {ownerMenu}
      {withMedia.length > VISIBLE_LIMIT && (
        <div className="px-6 mt-3.5">
          {showAll ? (
            <button type="button" onClick={() => setShowAll(false)} className="text-[12.5px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
          ) : (
            <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary/90 hover:text-primary">
              See all {withMedia.length} posts <ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
    </section>
  );
};

const VISIBLE_LIMIT = 6;

export const ProfileReelsSection: React.FC<ProfileReelsSectionProps> = ({
  reels,
  isOwn = false,
  onTileClick,
  onDelete,
  onEdit,
  onToggleVisibility,
  title,
  hideHeader = false,
  trailing,
}) => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const [showAll, setShowAll] = useState(false);
  // Long-press (or right-click) a tile to open its actions menu — owner only.
  const [menu, setMenu] = useState<{ id: string; isPublic: boolean; rect: DOMRect } | null>(null);
  const press = useCardLongPress<Reel>((r, target) => {
    if (!isOwn) return;
    setMenu({ id: r.id, isPublic: r.isPublic, rect: target.getBoundingClientRect() });
  });
  if (reels.length === 0) return null;

  const visible = showAll ? reels : reels.slice(0, VISIBLE_LIMIT);

  const handleClick = (r: Reel) => {
    if (onTileClick) { onTileClick(r); return; }
    navigate(`/r/reel-${r.id}`);
  };

  const ownerMenu = menu && (
    <CardActionMenu
      rect={menu.rect}
      onClose={() => setMenu(null)}
      actions={[
        ...(onEdit ? [{ label: 'Edit', icon: <Pencil size={16} />, onClick: () => onEdit(menu.id) }] : []),
        ...(onToggleVisibility ? [{
          label: menu.isPublic ? 'Make followers-only' : 'Make public',
          icon: menu.isPublic ? <Lock size={16} /> : <Globe size={16} />,
          onClick: () => onToggleVisibility(menu.id, !menu.isPublic),
        }] : []),
        ...(onDelete ? [{ label: 'Delete', icon: <Trash2 size={16} />, onClick: () => onDelete(menu.id), danger: true }] : []),
      ] as CardAction[]}
    />
  );

  const seeAll = reels.length > VISIBLE_LIMIT && (
    <div className="mt-3.5">
      {showAll ? (
        <button type="button" onClick={() => setShowAll(false)} className="text-[12.5px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
      ) : (
        <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary/90 hover:text-primary">
          See all {reels.length} reels <ChevronRight size={13} />
        </button>
      )}
    </div>
  );

  // ── Desktop: editorial reel tiles (9:16, play badge + caption/views) ──
  if (!phoneMode) {
    return (
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-4)] mb-[18px]">
          {reels.length} {reels.length === 1 ? 'Reel' : 'Reels'}
        </div>
        <div className="grid grid-cols-3 gap-3.5">
          {visible.map((r) => {
            const heroTitle = r.caption?.trim() || (r.kind === 'restaurant' ? r.restaurant?.name : r.recipe?.title) || 'Untitled';
            return (
              <div key={r.id} className="group relative">
                <button
                  type="button"
                  {...(isOwn ? press.getHandlers(r) : {})}
                  onClick={() => {
                    if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                    handleClick(r);
                  }}
                  className="relative block w-full aspect-[9/16] overflow-hidden rounded-[18px] bg-on-surface/[0.05] select-none"
                  aria-label={r.caption || 'Open reel'}
                >
                  <div className={cn('absolute inset-0 bg-gradient-to-b', r.bgGradient || 'from-stone-700 to-stone-900')} />
                  {r.videoUrl && (
                    <video src={firstFrameSrc(r.videoUrl)} poster={r.posterUrl} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                  )}
                  <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(22,13,8,0.80), rgba(22,13,8,0) 52%)' }} />
                  {/* persistent play badge (top-right) */}
                  <div className="absolute top-[13px] right-[13px] w-[30px] h-[30px] rounded-full bg-black/[0.34] backdrop-blur grid place-items-center text-white">
                    <Play size={13} className="fill-white translate-x-px" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-[15px] text-left">
                    <p className="font-serif font-bold text-white text-[15px] leading-[1.2] text-pretty line-clamp-2">{heroTitle}</p>
                    <div className="flex items-center gap-2 mt-2 text-[11.5px] font-semibold text-white/[0.86]">
                      <span className="inline-flex items-center gap-1.5"><Heart size={12} className="fill-white" />{formatCount(r.likes)}</span>
                      {isOwn && !r.isPublic && <span className="inline-flex items-center gap-1"><Lock size={11} /> Followers</span>}
                    </div>
                  </div>
                </button>
                {isOwn && <OwnerMoreButton onOpen={(rect) => setMenu({ id: r.id, isPublic: r.isPublic, rect })} className="top-[13px] left-[13px]" />}
              </div>
            );
          })}
        </div>
        {ownerMenu}
        {seeAll}
      </section>
    );
  }

  // ── Mobile: full-bleed 3-up 9:16 tiles with play badge + caption ─────
  return (
    <section>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-4)] px-6 mb-3.5">
        {reels.length} {reels.length === 1 ? 'Reel' : 'Reels'}
      </div>
      <div className="grid grid-cols-3">
        {visible.map((r) => {
          const heroTitle = r.caption?.trim() || (r.kind === 'restaurant' ? r.restaurant?.name : r.recipe?.title) || 'Untitled';
          return (
            <button
              key={r.id}
              type="button"
              {...(isOwn ? press.getHandlers(r) : {})}
              onClick={() => {
                if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                handleClick(r);
              }}
              className="relative block w-full aspect-[9/16] overflow-hidden bg-on-surface/[0.05] select-none [-webkit-touch-callout:none]"
              aria-label={r.caption || 'Open reel'}
            >
              <div className={cn('absolute inset-0 bg-gradient-to-b', r.bgGradient || 'from-stone-700 to-stone-900')} />
              {r.videoUrl && (
                <video src={firstFrameSrc(r.videoUrl)} poster={r.posterUrl} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 w-full h-full object-cover" />
              )}
              <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(22,13,8,0.80), rgba(22,13,8,0) 52%)' }} />
              <div className="absolute top-2 right-2 w-[23px] h-[23px] rounded-full bg-black/[0.34] backdrop-blur grid place-items-center text-white">
                <Play size={10} className="fill-white translate-x-px" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-2 text-left">
                <p className="font-serif font-bold text-white text-[10.5px] leading-[1.14] text-pretty line-clamp-2">{heroTitle}</p>
                <div className="inline-flex items-center gap-1 mt-1 text-[9px] font-semibold text-white/[0.88]"><Heart size={9} className="fill-white" />{formatCount(r.likes)}</div>
              </div>
              {isOwn && !r.isPublic && (
                <div className="absolute top-2 left-2 inline-flex items-center bg-black/55 backdrop-blur rounded-full p-1 text-white"><Lock size={9} /></div>
              )}
            </button>
          );
        })}
      </div>
      {ownerMenu}
      {reels.length > VISIBLE_LIMIT && (
        <div className="px-6 mt-3.5">
          {showAll ? (
            <button type="button" onClick={() => setShowAll(false)} className="text-[12.5px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
          ) : (
            <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary/90 hover:text-primary">
              See all {reels.length} reels <ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
    </section>
  );
};

/* ── Guides grid (3-up, mirrors the Posts / Reels layouts) ─────────────── */

interface ProfileGuidesSectionProps {
  guides: Guide[];
  isOwn?: boolean;
  onTileClick?: (guide: Guide) => void;
  onDelete?: (guideId: string) => void;
  onEdit?: (guide: Guide) => void;
  onToggleVisibility?: (guideId: string, nextIsPublic: boolean) => void;
  title?: string;
  hideHeader?: boolean;
  trailing?: React.ReactNode;
}

export const ProfileGuidesSection: React.FC<ProfileGuidesSectionProps> = ({
  guides,
  isOwn = false,
  onTileClick,
  onDelete,
  onEdit,
  onToggleVisibility,
  title,
  hideHeader = false,
  trailing,
}) => {
  const navigate = useNavigate();
  const { phoneMode } = useSettings();
  const [showAll, setShowAll] = useState(false);
  // Long-press (or right-click) a tile to open its actions menu — owner only.
  const [menu, setMenu] = useState<{ guide: Guide; rect: DOMRect } | null>(null);
  const press = useCardLongPress<Guide>((g, target) => {
    if (!isOwn) return;
    setMenu({ guide: g, rect: target.getBoundingClientRect() });
  });
  if (guides.length === 0) return null;

  const visible = showAll ? guides : guides.slice(0, VISIBLE_LIMIT);

  const handleClick = (g: Guide) => {
    if (onTileClick) { onTileClick(g); return; }
    navigate(`/guides/${g.id}`);
  };

  // "Public" on the profile means published + public (isPublicGuide) — so the
  // toggle/label can't disagree with what the public profile actually shows.
  const ownerMenu = menu && (
    <CardActionMenu
      rect={menu.rect}
      onClose={() => setMenu(null)}
      actions={[
        ...(onEdit ? [{ label: 'Edit', icon: <Pencil size={16} />, onClick: () => onEdit(menu.guide) }] : []),
        ...(onToggleVisibility ? [{
          label: isPublicGuide(menu.guide) ? 'Make private' : 'Make public',
          icon: isPublicGuide(menu.guide) ? <Lock size={16} /> : <Globe size={16} />,
          onClick: () => onToggleVisibility(menu.guide.id, !isPublicGuide(menu.guide)),
        }] : []),
        ...(onDelete ? [{ label: 'Delete', icon: <Trash2 size={16} />, onClick: () => onDelete(menu.guide.id), danger: true }] : []),
      ] as CardAction[]}
    />
  );

  const seeAll = guides.length > VISIBLE_LIMIT && (
    <div className="mt-5">
      {showAll ? (
        <button type="button" onClick={() => setShowAll(false)} className="text-[12.5px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
      ) : (
        <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary/90 hover:text-primary">
          See all {guides.length} guides <ChevronRight size={13} />
        </button>
      )}
    </div>
  );

  // ── Desktop: full-width editorial guide banners (text overlaid left) ──
  if (!phoneMode) {
    return (
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-4)] mb-[18px]">
          {guides.length} {guides.length === 1 ? 'Guide' : 'Guides'} curated
        </div>
        <div className="flex flex-col gap-[18px]">
          {visible.map((g) => {
            const isRecipes = g.type === 'recipes';
            const Icon = isRecipes ? ChefHat : BookOpen;
            const entryCount = g.entries?.length ?? 0;
            const noun = isRecipes ? (entryCount === 1 ? 'recipe' : 'recipes') : (entryCount === 1 ? 'place' : 'places');
            const desc = (g.subtitle || g.intro || '').trim();
            // Owner-only state badge explaining why a guide isn't live.
            const stateBadge = isOwn ? (!g.isPublished ? 'Draft' : (g.visibility !== 'public' ? 'Private' : null)) : null;
            return (
              <div key={g.id} className="group relative">
                <button
                  type="button"
                  {...(isOwn ? press.getHandlers(g) : {})}
                  onClick={() => {
                    if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                    handleClick(g);
                  }}
                  className="relative block w-full h-[236px] overflow-hidden rounded-[24px] bg-on-surface/[0.08] text-left select-none"
                  aria-label={g.title || 'Open guide'}
                >
                  {g.coverPhoto ? (
                    <img src={g.coverPhoto} alt={g.title} referrerPolicy="no-referrer" draggable={false} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                  ) : (
                    <div className={cn('absolute inset-0 grid place-items-center bg-gradient-to-br', isRecipes ? 'from-amber-700 to-stone-900' : 'from-stone-700 to-stone-900')}>
                      <Icon size={40} className="text-white/25" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(100deg, rgba(20,12,8,0.90) 0%, rgba(20,12,8,0.62) 42%, rgba(20,12,8,0.12) 100%)' }} />
                  <div className="absolute inset-0 px-[34px] py-[30px] flex flex-col justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.15] backdrop-blur px-3.5 py-[7px] text-[10px] font-bold tracking-[0.16em] uppercase text-white">
                        <Layers size={12} strokeWidth={2.2} /> Guide · {entryCount} {noun}
                      </span>
                      {stateBadge && (
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded-full backdrop-blur px-2.5 py-[6px] text-[10px] font-bold tracking-[0.12em] uppercase text-white',
                          stateBadge === 'Draft' ? 'bg-amber-500/90' : 'bg-white/[0.15]',
                        )}>
                          {stateBadge === 'Private' && <Lock size={11} />}{stateBadge}
                        </span>
                      )}
                    </div>
                    <div className="max-w-[540px]">
                      <h3 className="font-serif font-bold text-white text-[30px] leading-[1.08] tracking-[-0.015em] text-pretty line-clamp-2">
                        {g.title || 'Untitled guide'}
                      </h3>
                      {desc && (
                        <p className="mt-[11px] max-w-[470px] text-[14.5px] font-medium leading-[1.5] text-white/[0.82] line-clamp-2">{desc}</p>
                      )}
                      <span className="inline-flex items-center gap-2 mt-[17px] text-[13px] font-bold text-white">
                        View guide <ArrowRight size={15} strokeWidth={2.4} />
                      </span>
                    </div>
                  </div>
                </button>
                {isOwn && <OwnerMoreButton onOpen={(rect) => setMenu({ guide: g, rect })} className="top-[18px] right-[18px]" />}
              </div>
            );
          })}
        </div>
        {ownerMenu}
        {seeAll}
      </section>
    );
  }

  // ── Mobile: full-bleed 2-up square tiles with overlaid guide banner ──
  return (
    <section>
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-4)] px-6 mb-3.5">
        {guides.length} {guides.length === 1 ? 'Guide' : 'Guides'} curated
      </div>
      <div className="grid grid-cols-2">
        {visible.map((g) => {
          const isRecipes = g.type === 'recipes';
          const Icon = isRecipes ? ChefHat : BookOpen;
          const entryCount = g.entries?.length ?? 0;
          const noun = isRecipes ? (entryCount === 1 ? 'recipe' : 'recipes') : (entryCount === 1 ? 'place' : 'places');
          const stateBadge = isOwn ? (!g.isPublished ? 'Draft' : (g.visibility !== 'public' ? 'Private' : null)) : null;
          return (
            <button
              key={g.id}
              type="button"
              {...(isOwn ? press.getHandlers(g) : {})}
              onClick={() => {
                if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                handleClick(g);
              }}
              className="relative block w-full aspect-square overflow-hidden bg-on-surface/[0.08] select-none [-webkit-touch-callout:none]"
              aria-label={g.title || 'Open guide'}
            >
              {g.coverPhoto ? (
                <img src={g.coverPhoto} alt={g.title} referrerPolicy="no-referrer" draggable={false} className="pointer-events-none absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className={cn('absolute inset-0 grid place-items-center bg-gradient-to-br', isRecipes ? 'from-amber-700 to-stone-900' : 'from-stone-700 to-stone-900')}>
                  <Icon size={30} className="text-white/25" />
                </div>
              )}
              <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(20,12,8,0.30) 0%, rgba(20,12,8,0.45) 45%, rgba(20,12,8,0.88) 100%)' }} />
              <div className="absolute inset-0 p-4 flex flex-col justify-between text-left">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.15] backdrop-blur px-2.5 py-[5px] text-[8px] font-bold tracking-[0.13em] uppercase text-white">
                    <Layers size={10} strokeWidth={2.2} /> Guide · {entryCount} {noun}
                  </span>
                  {stateBadge && (
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full backdrop-blur px-2 py-[5px] text-[8px] font-bold tracking-[0.1em] uppercase text-white',
                      stateBadge === 'Draft' ? 'bg-amber-500/90' : 'bg-white/[0.15]',
                    )}>
                      {stateBadge === 'Private' && <Lock size={9} />}{stateBadge}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-serif font-bold text-white text-[17px] leading-[1.1] tracking-[-0.015em] text-pretty line-clamp-3">
                    {g.title || 'Untitled guide'}
                  </h3>
                  <span className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold text-white">
                    View guide <ArrowRight size={13} strokeWidth={2.4} />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {ownerMenu}
      {guides.length > VISIBLE_LIMIT && (
        <div className="px-6 mt-3.5">
          {showAll ? (
            <button type="button" onClick={() => setShowAll(false)} className="text-[12.5px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
          ) : (
            <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary/90 hover:text-primary">
              See all {guides.length} guides <ChevronRight size={13} />
            </button>
          )}
        </div>
      )}
    </section>
  );
};
