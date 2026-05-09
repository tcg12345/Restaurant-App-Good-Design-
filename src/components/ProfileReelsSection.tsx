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
import { Heart, Film, Lock, Globe, Trash2, ChevronRight, Layers } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Reel } from '../contexts/ReelsContext';
import type { Post } from '../contexts/PostsContext';

interface ProfileReelsSectionProps {
  reels: Reel[];
  /** When true, render owner-only controls (privacy toggle + delete). */
  isOwn?: boolean;
  /** Tile click destination — defaults to /reels?kind=<reel.kind>. */
  onTileClick?: (reel: Reel) => void;
  onDelete?: (reelId: string) => void;
  onToggleVisibility?: (reelId: string, nextIsPublic: boolean) => void;
  /** Optional — overrides the default "My Reels" / "Reels" title. */
  title?: string;
  /** Optional CTA shown next to the title (e.g. "Open feed"). */
  trailing?: React.ReactNode;
}

/* ── Posts grid (parallel to reels grid, same compact 3-up layout) ───── */

interface ProfilePostsSectionProps {
  posts: Post[];
  isOwn?: boolean;
  onTileClick?: (post: Post) => void;
  onDelete?: (postId: string) => void;
  onToggleVisibility?: (postId: string, nextIsPublic: boolean) => void;
  title?: string;
  trailing?: React.ReactNode;
}

export const ProfilePostsSection: React.FC<ProfilePostsSectionProps> = ({
  posts, isOwn = false, onTileClick, onDelete, onToggleVisibility, title, trailing,
}) => {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  if (posts.length === 0) return null;
  const VISIBLE_LIMIT = 6;
  const visible = showAll ? posts : posts.slice(0, VISIBLE_LIMIT);

  const handleClick = (p: Post) => {
    if (onTileClick) { onTileClick(p); return; }
    navigate('/reels?kind=post');
  };

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
          {title ?? (isOwn ? 'My Posts' : 'Posts')}
          <span className="text-on-surface/30 font-medium ml-1.5">{posts.length}</span>
        </h3>
        {trailing}
      </div>
      <div className="grid grid-cols-3 gap-1 max-w-md">
        {visible.map((p) => {
          const cover = p.items[0];
          // First item drives the tile preview.
          return (
            <div key={p.id} className="relative group">
              <button
                type="button"
                onClick={() => handleClick(p)}
                className="block w-full aspect-square rounded-xl overflow-hidden bg-on-surface/[0.05] relative"
                aria-label={p.caption || 'Open post'}
              >
                {cover?.mediaType === 'video' && cover.mediaUrl ? (
                  <video src={cover.mediaUrl} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
                ) : cover?.mediaUrl ? (
                  <img src={cover.mediaUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className={cn('absolute inset-0 bg-gradient-to-b', cover?.bgGradient || 'from-stone-800 to-stone-900')} />
                )}
                {/* Multi-item indicator (top-right corner) */}
                {p.items.length > 1 && (
                  <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-black/55 text-white">
                    <Layers size={11} />
                  </span>
                )}
                {/* Likes pill */}
                <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-black/45 backdrop-blur rounded-full px-1.5 h-5 text-white text-[9px] font-bold">
                  <Heart size={9} className="fill-white" />
                  <span className="tabular-nums">{p.likesCount}</span>
                </div>
                {/* Private chip */}
                {!p.isPublic && (
                  <div className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-0.5 bg-black/55 backdrop-blur rounded-full px-1.5 h-5 text-white text-[9px] font-bold">
                    <Lock size={8} />
                  </div>
                )}
              </button>
              {isOwn && (
                // Owner controls: always visible (no hover gate) so the
                // delete affordance is obvious. Shifts down on multi-item
                // posts so it doesn't collide with the Layers chip.
                <div className={cn(
                  'absolute right-1.5 flex items-center gap-1',
                  p.items.length > 1 ? 'top-7' : 'top-1.5',
                )}>
                  {onToggleVisibility && (
                    <button
                      type="button"
                      onClick={() => onToggleVisibility(p.id, !p.isPublic)}
                      className="w-6 h-6 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white hover:bg-black/70"
                      aria-label={p.isPublic ? 'Make private' : 'Make public'}
                      title={p.isPublic ? 'Public — tap to make followers-only' : 'Followers only — tap to make public'}
                    >
                      {p.isPublic ? <Globe size={11} /> : <Lock size={11} />}
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(p.id)}
                      className="w-6 h-6 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white hover:bg-rose-600 transition-colors"
                      aria-label="Delete post"
                      title="Delete post"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {posts.length > VISIBLE_LIMIT && (
        <div className="mt-2.5 max-w-md">
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
  onToggleVisibility,
  title,
  trailing,
}) => {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  if (reels.length === 0) return null;

  const visible = showAll ? reels : reels.slice(0, VISIBLE_LIMIT);
  const remaining = reels.length - visible.length;

  const handleClick = (r: Reel) => {
    if (onTileClick) { onTileClick(r); return; }
    navigate(`/reels?kind=${r.kind}`);
  };

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
          {title ?? (isOwn ? 'My Reels' : 'Reels')}
          <span className="text-on-surface/30 font-medium ml-1.5">{reels.length}</span>
        </h3>
        {trailing}
      </div>
      <div className="grid grid-cols-3 gap-1 max-w-md">
        {visible.map((r) => (
          <div key={r.id} className="relative group">
            <button
              type="button"
              onClick={() => handleClick(r)}
              className="block w-full aspect-[9/14] rounded-xl overflow-hidden bg-on-surface/[0.05] relative"
              aria-label={r.caption || 'Open reel'}
            >
              {r.videoUrl ? (
                <video
                  src={r.videoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className={cn('absolute inset-0 bg-gradient-to-b', r.bgGradient || 'from-stone-800 to-stone-900')} />
              )}
              {/* Bottom gradient + meta */}
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 p-1.5">
                <div className="flex items-center gap-0.5 text-white text-[8px] font-bold mb-0.5">
                  <Film size={8} />
                  <span className="uppercase tracking-wider">{r.kind === 'restaurant' ? 'Place' : 'Recipe'}</span>
                </div>
                <p className="text-white text-[10px] font-bold leading-tight line-clamp-2 drop-shadow-sm">
                  {r.kind === 'restaurant' ? r.restaurant?.name : r.recipe?.title}
                </p>
              </div>
              {/* Likes pill (top-left) */}
              <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 bg-black/45 backdrop-blur rounded-full px-1.5 h-5 text-white text-[9px] font-bold">
                <Heart size={9} className="fill-white" />
                <span className="tabular-nums">{r.likes}</span>
              </div>
              {/* Private chip (bottom-right). Only when followers-only. */}
              {!r.isPublic && (
                <div className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-0.5 bg-black/55 backdrop-blur rounded-full px-1.5 h-5 text-white text-[9px] font-bold">
                  <Lock size={8} />
                </div>
              )}
            </button>
            {/* Owner controls — privacy + delete. Always visible so the
                delete affordance is obvious on both touch and desktop. */}
            {isOwn && (
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                {onToggleVisibility && (
                  <button
                    type="button"
                    onClick={() => onToggleVisibility(r.id, !r.isPublic)}
                    className="w-6 h-6 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white hover:bg-black/70"
                    aria-label={r.isPublic ? 'Make private' : 'Make public'}
                    title={r.isPublic ? 'Public — tap to make followers-only' : 'Followers only — tap to make public'}
                  >
                    {r.isPublic ? <Globe size={11} /> : <Lock size={11} />}
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(r.id)}
                    className="w-6 h-6 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white hover:bg-rose-600"
                    aria-label="Delete reel"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Expand / collapse — only when there's something to expand. */}
      {reels.length > VISIBLE_LIMIT && (
        <div className="mt-2.5 max-w-md">
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
