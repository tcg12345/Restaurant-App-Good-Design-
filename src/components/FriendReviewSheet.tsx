import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { mergeRefs, useBottomSheet } from '../lib/useBottomSheet';
import {
  getLikesForRatings, getCommentCounts, toggleLike,
  type CommunityRating, type CommunityPhoto,
} from '../lib/supabase-community';
import { tierOfScore } from '../lib/settleScores';
import { TIER_LABELS } from '../lib/headToHeadRating';

/**
 * Deterministic monogram tint. Shared by every surface that draws a friend
 * avatar for a restaurant — the row on the detail page, the row on the
 * see-all screen, and the sheet's own header — so the same person is the
 * same colour wherever you meet them.
 */
const AVATAR_TINTS = ['#B98A7A', '#6E8B6B', '#9C4A4A', '#7C6BAE', '#5B6B4A', '#A6371D', '#3F6F8F'];
export const friendAvatarColor = (name: string): string =>
  AVATAR_TINTS[(name || 'F').charCodeAt(0) % AVATAR_TINTS.length];

export const FriendAvatar: React.FC<{ name: string; size?: number }> = ({ name, size = 40 }) => (
  <div
    className="rounded-full flex items-center justify-center flex-shrink-0 text-white"
    style={{ width: size, height: size, background: friendAvatarColor(name) }}
  >
    <span style={{ fontSize: size * 0.37, fontWeight: 700 }}>
      {name.trim().charAt(0).toUpperCase() || 'F'}
    </span>
  </div>
);

export interface FriendReviewSheetProps {
  /** The review being read. `null` closes the sheet. */
  rating: CommunityRating | null;
  name: string;
  username?: string;
  /** Relative recency — "2 months ago". */
  when: string;
  restaurantName: string;
  /** This friend's photos of this restaurant. */
  photos: CommunityPhoto[];
  onClose: () => void;
}

/**
 * A friend's review, read in place.
 *
 * The row used to push `/review/:id` — a whole screen for one paragraph and
 * a score, with the page you were reading torn down behind it. A review is
 * a glance, so it opens as a sheet over the restaurant you were already
 * looking at: score, verdict, the note in full, the dishes they named, their
 * photos, and the two things you can do about it. The comment button is the
 * one thing that still earns a page — that's where the thread lives.
 */
export const FriendReviewSheet: React.FC<FriendReviewSheetProps> = ({
  rating, name, username, when, restaurantName, photos, onClose,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(!!rating, onClose, scrollRef);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);

  const ratingId = rating?.id;
  useEffect(() => {
    if (!ratingId) return;
    let cancelled = false;
    void (async () => {
      const [likes, counts] = await Promise.all([
        user?.id
          ? getLikesForRatings(user.id, [ratingId])
          : Promise.resolve({ likes: {} as Record<string, number>, userLiked: new Set<string>() }),
        getCommentCounts([ratingId]),
      ]);
      if (cancelled) return;
      setLikeCount(likes.likes[ratingId] || 0);
      setLiked(likes.userLiked.has(ratingId));
      setCommentCount(counts[ratingId] || 0);
    })();
    return () => { cancelled = true; };
  }, [ratingId, user?.id]);

  if (!rating) return null;

  const score = Number(rating.score);
  const verdict = rating.would_return ? 'Would return' : TIER_LABELS[tierOfScore(score)];
  const dishes = rating.tags || [];

  // Optimistic — the row flips under the finger and rolls back only if the
  // write disagrees.
  const onLike = async () => {
    if (!user?.id) return;
    const was = liked;
    setLiked(!was);
    setLikeCount((c) => Math.max(0, c + (was ? -1 : 1)));
    const res = await toggleLike(user.id, rating.id);
    if (!res.ok || res.liked === was) {
      setLiked(was);
      setLikeCount((c) => Math.max(0, c + (was ? 1 : -1)));
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.28 }}
        className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <motion.div
        ref={mergeRefs(sheetRef, scrollRef) as React.RefCallback<HTMLDivElement>}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        {...dragProps}
        className="fixed bottom-0 inset-x-0 z-50 bg-cream rounded-t-[28px] max-h-[82vh] overflow-y-auto overscroll-contain type-archivo"
        style={{ boxShadow: '0 -14px 44px rgba(18,15,14,0.26)', paddingLeft: 22, paddingRight: 22 }}
      >
        <div className="pt-3 pb-4 -mx-[22px] px-[22px]">
          <div className="w-[42px] h-[5px] rounded-full bg-on-surface/15 mx-auto" />
        </div>

        <div className="flex items-center gap-3">
          <FriendAvatar name={name} size={46} />
          <div className="flex-1 min-w-0">
            <p className="truncate text-on-surface" style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.025em' }}>{name}</p>
            <p className="mt-1 truncate text-on-surface/45" style={{ fontSize: '12.5px' }}>
              {when ? `${when} · ` : ''}{restaurantName}
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="hit-44 flex-shrink-0 w-9 h-9 rounded-full bg-on-surface/[0.06] flex items-center justify-center text-on-surface/70 active:opacity-70 transition-opacity"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 flex items-end gap-3">
          <span className="text-primary" style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.045em' }}>
            {score.toFixed(1)}
          </span>
          <span className="text-on-surface/45 pb-[5px]" style={{ fontSize: '13.5px' }}>out of 10</span>
          <span className="flex-1" />
          <span className="inline-flex items-center rounded-full bg-on-surface/[0.06] text-on-surface/70 px-3 py-2" style={{ fontSize: '11.5px', fontWeight: 600 }}>
            {verdict}
          </span>
        </div>

        {rating.notes && (
          <p className="mt-[18px] text-on-surface" style={{ fontSize: '14.5px', lineHeight: 1.6, textWrap: 'pretty' } as React.CSSProperties}>
            {rating.notes}
          </p>
        )}

        {dishes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-[7px]">
            {dishes.map((d) => (
              <span key={d} className="rounded-full bg-primary/10 text-primary px-3 py-2" style={{ fontSize: '11.5px', fontWeight: 600 }}>{d}</span>
            ))}
          </div>
        )}

        {photos.length > 0 && (
          <div className="mt-[18px] flex gap-2 overflow-x-auto no-scrollbar -mx-[22px] px-[22px] snap-x">
            {photos.map((p) => (
              <img
                key={p.id} src={p.url} alt=""
                referrerPolicy="no-referrer"
                className="flex-none w-[132px] h-[104px] rounded-[20px] object-cover snap-start bg-on-surface/[0.05]"
              />
            ))}
          </div>
        )}

        <div
          className="mt-5 pt-4 flex items-center gap-2 border-t border-on-surface/[0.09]"
          style={{ paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))' }}
        >
          <button
            type="button" onClick={onLike} disabled={!user?.id}
            className={cn(
              'inline-flex items-center gap-[7px] rounded-full px-[15px] py-[11px] active:opacity-75 transition-opacity',
              liked ? 'bg-primary/12 text-primary' : 'bg-on-surface/[0.06] text-on-surface',
            )}
            style={{ fontSize: '12.5px', fontWeight: 700 }}
          >
            <Heart size={15} className={liked ? 'fill-primary' : ''} />
            {likeCount}
          </button>
          <button
            type="button"
            onClick={() => { onClose(); navigate(`/review/${rating.id}`); }}
            className="inline-flex items-center gap-[7px] rounded-full bg-on-surface/[0.06] text-on-surface px-[15px] py-[11px] active:opacity-75 transition-opacity"
            style={{ fontSize: '12.5px', fontWeight: 700 }}
          >
            <MessageCircle size={15} />
            {commentCount}
          </button>
          <span className="flex-1" />
          {username && (
            <button
              type="button"
              onClick={() => { onClose(); navigate(`/user/${username}`); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-on-surface/20 text-on-surface px-[15px] py-[11px] active:opacity-75 transition-opacity"
              style={{ fontSize: '12.5px', fontWeight: 700 }}
            >
              Profile
            </button>
          )}
        </div>
      </motion.div>
    </>
  );
};
