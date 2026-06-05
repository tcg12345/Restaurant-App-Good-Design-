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
import { Heart, Film, Lock, Globe, Trash2, ChevronRight, Layers, Pencil, BookOpen, ChefHat, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCardLongPress, CardActionMenu, type CardAction } from './CardActionMenu';
import type { Reel } from '../contexts/ReelsContext';
import type { Post } from '../contexts/PostsContext';
import type { Guide } from '../lib/supabase-guides';

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
  const [showAll, setShowAll] = useState(false);
  if (posts.length === 0) return null;
  const VISIBLE_LIMIT = 6;
  const visible = showAll ? posts : posts.slice(0, VISIBLE_LIMIT);

  const handleClick = (p: Post) => {
    if (onTileClick) { onTileClick(p); return; }
    navigate(`/r/post-${p.id}`);
  };

  // Long-press (or right-click) a tile to open its actions menu — owner only.
  const [menu, setMenu] = useState<{ id: string; isPublic: boolean; rect: DOMRect } | null>(null);
  const press = useCardLongPress<Post>((p, target) => {
    if (!isOwn) return;
    setMenu({ id: p.id, isPublic: p.isPublic, rect: target.getBoundingClientRect() });
  });

  return (
    <section>
      {!hideHeader && (
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
            {title ?? (isOwn ? 'My Posts' : 'Posts')}
            <span className="text-on-surface/30 font-medium ml-1.5">{posts.length}</span>
          </h3>
          {trailing}
        </div>
      )}
      {/* Instagram-style grid: three flush square tiles per row. */}
      <div className="grid grid-cols-3 gap-px max-w-2xl">
        {visible.map((p) => {
          const cover = p.items[0];
          // First item drives the tile preview.
          return (
            <button
              key={p.id}
              type="button"
              {...(isOwn ? press.getHandlers(p) : {})}
              onClick={() => {
                if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                handleClick(p);
              }}
              className="group relative block w-full aspect-square overflow-hidden bg-on-surface/[0.05] select-none [-webkit-touch-callout:none]"
              aria-label={p.caption || 'Open post'}
            >
              {cover?.mediaType === 'video' && cover.mediaUrl ? (
                <video src={cover.mediaUrl} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 w-full h-full object-cover" />
              ) : cover?.mediaUrl ? (
                <img src={cover.mediaUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className={cn('absolute inset-0 bg-gradient-to-b', cover?.bgGradient || 'from-stone-800 to-stone-900')} />
              )}
              {/* Carousel marker (multi-item) */}
              {p.items.length > 1 && (
                <Layers size={16} className="absolute top-1.5 right-1.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
              )}
              {/* Followers-only indicator (owner sees which are private) */}
              {!p.isPublic && (
                <div className="absolute bottom-1.5 right-1.5 inline-flex items-center bg-black/55 backdrop-blur rounded-full p-1 text-white">
                  <Lock size={10} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {menu && (
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
      )}
      {posts.length > VISIBLE_LIMIT && (
        <div className="mt-3 max-w-2xl">
          {showAll ? (
            <button type="button" onClick={() => setShowAll(false)} className="text-[12px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
          ) : (
            <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary/90 hover:text-primary">
              See all {posts.length} posts
              <ChevronRight size={12} />
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
  const [showAll, setShowAll] = useState(false);
  if (reels.length === 0) return null;

  const visible = showAll ? reels : reels.slice(0, VISIBLE_LIMIT);
  const remaining = reels.length - visible.length;

  const handleClick = (r: Reel) => {
    if (onTileClick) { onTileClick(r); return; }
    navigate(`/r/reel-${r.id}`);
  };

  // Long-press (or right-click) a tile to open its actions menu — owner only.
  const [menu, setMenu] = useState<{ id: string; isPublic: boolean; rect: DOMRect } | null>(null);
  const press = useCardLongPress<Reel>((r, target) => {
    if (!isOwn) return;
    setMenu({ id: r.id, isPublic: r.isPublic, rect: target.getBoundingClientRect() });
  });

  return (
    <section>
      {!hideHeader && (
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
            {title ?? (isOwn ? 'My Reels' : 'Reels')}
            <span className="text-on-surface/30 font-medium ml-1.5">{reels.length}</span>
          </h3>
          {trailing}
        </div>
      )}
      {/* Instagram-style reels grid: three flush vertical tiles per row. */}
      <div className="grid grid-cols-3 gap-px max-w-2xl">
        {visible.map((r) => (
          <button
            key={r.id}
            type="button"
            {...(isOwn ? press.getHandlers(r) : {})}
            onClick={() => {
              if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
              handleClick(r);
            }}
            className="group relative block w-full aspect-[9/16] overflow-hidden bg-on-surface/[0.05] select-none [-webkit-touch-callout:none]"
            aria-label={r.caption || 'Open reel'}
          >
            {r.videoUrl ? (
              <video
                src={r.videoUrl}
                muted
                playsInline
                preload="metadata"
                className="pointer-events-none absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className={cn('absolute inset-0 bg-gradient-to-b', r.bgGradient || 'from-stone-800 to-stone-900')} />
            )}
            {/* Bottom gradient + place / recipe label */}
            <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 p-2">
              <div className="flex items-center gap-1 text-white/85 text-[9px] font-bold mb-0.5">
                <Film size={9} />
                <span className="uppercase tracking-wider">{r.kind === 'restaurant' ? 'Place' : 'Recipe'}</span>
              </div>
              <p className="font-serif font-bold text-white text-[12px] leading-[1.15] line-clamp-2 drop-shadow-sm">
                {r.kind === 'restaurant' ? r.restaurant?.name : r.recipe?.title}
              </p>
            </div>
            {/* Followers-only indicator */}
            {!r.isPublic && (
              <div className="absolute top-1.5 right-1.5 inline-flex items-center bg-black/55 backdrop-blur rounded-full p-1 text-white">
                <Lock size={10} />
              </div>
            )}
          </button>
        ))}
      </div>
      {menu && (
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
      )}
      {/* Expand / collapse — only when there's something to expand. */}
      {reels.length > VISIBLE_LIMIT && (
        <div className="mt-3 max-w-2xl">
          {showAll ? (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="text-[12px] font-semibold text-on-surface/45 hover:text-on-surface/65"
            >
              Show less
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary/90 hover:text-primary"
            >
              See all {reels.length} reels
              <ChevronRight size={12} />
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
  const [showAll, setShowAll] = useState(false);
  if (guides.length === 0) return null;

  const visible = showAll ? guides : guides.slice(0, VISIBLE_LIMIT);

  const handleClick = (g: Guide) => {
    if (onTileClick) { onTileClick(g); return; }
    navigate(`/guides/${g.id}`);
  };

  // Long-press (or right-click) a tile to open its actions menu — owner only.
  const [menu, setMenu] = useState<{ guide: Guide; rect: DOMRect } | null>(null);
  const press = useCardLongPress<Guide>((g, target) => {
    if (!isOwn) return;
    setMenu({ guide: g, rect: target.getBoundingClientRect() });
  });

  return (
    <section>
      {!hideHeader && (
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
            {title ?? (isOwn ? 'My Guides' : 'Guides')}
            <span className="text-on-surface/30 font-medium ml-1.5">{guides.length}</span>
          </h3>
          {trailing}
        </div>
      )}
      {/* Instagram-style grid: three flush tiles per row. */}
      <div className="grid grid-cols-3 gap-px max-w-2xl">
        {visible.map((g) => {
          const isRecipes = g.type === 'recipes';
          const Icon = isRecipes ? ChefHat : BookOpen;
          const entryCount = g.entries?.length ?? 0;
          const isPublic = g.visibility === 'public';
          return (
            <button
              key={g.id}
              type="button"
              {...(isOwn ? press.getHandlers(g) : {})}
              onClick={() => {
                if (isOwn && press.suppressClickRef.current) { press.suppressClickRef.current = false; return; }
                handleClick(g);
              }}
              className="group relative block w-full aspect-[4/5] overflow-hidden bg-on-surface/[0.05] select-none [-webkit-touch-callout:none]"
              aria-label={g.title || 'Open guide'}
            >
              {g.coverPhoto ? (
                <img
                  src={g.coverPhoto}
                  alt={g.title}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="pointer-events-none absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className={cn(
                  'absolute inset-0 grid place-items-center bg-gradient-to-br',
                  isRecipes ? 'from-amber-700 to-stone-900' : 'from-stone-700 to-stone-900',
                )}>
                  <Icon size={28} className="text-white/30" />
                </div>
              )}
              <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 h-[20px] rounded-full bg-black/50 backdrop-blur text-white text-[10px] font-bold tabular-nums">
                <Icon size={11} />
                {entryCount}
              </span>
              {/* Title + score overlay */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 px-2 pb-2 pt-6">
                <p className="font-serif font-bold text-white text-[12px] leading-tight line-clamp-2 drop-shadow">
                  {g.title || 'Untitled guide'}
                </p>
                {g.avgScore != null && (
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-white/85">
                    <Star size={10} className="fill-white" />
                    {g.avgScore.toFixed(1)}
                  </div>
                )}
              </div>
              {/* Private indicator */}
              {!isPublic && (
                <div className="absolute top-1.5 right-1.5 inline-flex items-center bg-black/55 backdrop-blur rounded-full p-1 text-white">
                  <Lock size={10} />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {menu && (
        <CardActionMenu
          rect={menu.rect}
          onClose={() => setMenu(null)}
          actions={[
            ...(onEdit ? [{ label: 'Edit', icon: <Pencil size={16} />, onClick: () => onEdit(menu.guide) }] : []),
            ...(onToggleVisibility ? [{
              label: menu.guide.visibility === 'public' ? 'Make private' : 'Make public',
              icon: menu.guide.visibility === 'public' ? <Lock size={16} /> : <Globe size={16} />,
              onClick: () => onToggleVisibility(menu.guide.id, menu.guide.visibility !== 'public'),
            }] : []),
            ...(onDelete ? [{ label: 'Delete', icon: <Trash2 size={16} />, onClick: () => onDelete(menu.guide.id), danger: true }] : []),
          ] as CardAction[]}
        />
      )}
      {guides.length > VISIBLE_LIMIT && (
        <div className="mt-3 max-w-2xl">
          {showAll ? (
            <button type="button" onClick={() => setShowAll(false)} className="text-[12px] font-semibold text-on-surface/45 hover:text-on-surface/65">Show less</button>
          ) : (
            <button type="button" onClick={() => setShowAll(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary/90 hover:text-primary">
              See all {guides.length} guides
              <ChevronRight size={12} />
            </button>
          )}
        </div>
      )}
    </section>
  );
};
