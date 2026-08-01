/**
 * "What people said about your rating" — the reader's half of a
 * conversation the author of a rating could never see.
 *
 * A rating shows up in your friends' feeds, not your own, so likes and
 * comments left there had no surface anywhere in the app that faced the
 * person who wrote it. Notifications tell you it happened; this is where
 * you read it and reply, on the restaurant's own page.
 *
 * Renders nothing unless you have rated this place AND somebody has
 * actually engaged with it — an empty "0 comments" card would just be
 * noise on a page that already has plenty of sections.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Heart, Loader2, MessageSquare, Send } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import {
  getOwnRatingId, getComments, getLikeCount, addComment, getProfilesByIds,
  type ActivityComment, type UserProfile,
} from '../lib/supabase-community';

const PALETTE = [
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
];
const colorOf = (uid: string) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const initialOf = (name: string) => (name || 'U').trim().charAt(0).toUpperCase() || 'U';

const timeAgo = (iso: string): string => {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
};

interface Props {
  restaurantId: string;
  /** Chrome only — the thread itself is identical on both. */
  variant: 'mobile' | 'desktop';
  /** Rendered immediately before the section, and only when the section
   *  itself renders. The mobile page separates sections with a rule; a
   *  caller-side rule would strand a divider above nothing on the (very
   *  common) no-engagement path. */
  leading?: React.ReactNode;
  className?: string;
}

export const YourReviewComments: React.FC<Props> = ({ restaurantId, variant, leading, className }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const location = useLocation();
  const sectionRef = useRef<HTMLElement | null>(null);

  const [ratingId, setRatingId] = useState<string | null>(null);
  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [likeCount, setLikeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !restaurantId) { setLoading(false); return; }
    setLoading(true);
    const id = await getOwnRatingId(userId, restaurantId);
    setRatingId(id);
    if (!id) { setLoading(false); return; }
    const [rows, likes] = await Promise.all([getComments(id, userId), getLikeCount(id)]);
    setComments(rows);
    setLikeCount(likes);
    const ids = [...new Set(rows.map((c) => c.user_id))].filter((uid) => uid !== userId);
    if (ids.length > 0) setProfiles(await getProfilesByIds(ids));
    setLoading(false);
  }, [userId, restaurantId]);

  useEffect(() => { void load(); }, [load]);

  // Arriving from a notification: bring the thread into view rather than
  // dropping the user at the top of a long page to hunt for it.
  const focusRequested = (location.state as { focusRatingComments?: boolean } | null)?.focusRatingComments === true;
  useEffect(() => {
    if (!focusRequested || loading || comments.length === 0) return;
    const el = sectionRef.current;
    if (!el) return;
    const t = window.setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    return () => window.clearTimeout(t);
  }, [focusRequested, loading, comments.length]);

  const send = useCallback(async () => {
    const text = reply.trim();
    if (!userId || !ratingId || !text || sending) return;
    setSending(true);
    const ok = await addComment(userId, ratingId, text);
    if (ok) {
      setReply('');
      setComments(await getComments(ratingId, userId));
    }
    setSending(false);
  }, [reply, userId, ratingId, sending]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const parents = comments.filter((c) => !c.parent_id);
    const byParent: Record<string, ActivityComment[]> = {};
    comments.forEach((c) => { if (c.parent_id) (byParent[c.parent_id] ||= []).push(c); });
    return { topLevel: parents, repliesByParent: byParent };
  }, [comments]);

  // Nothing rated here, or nobody has said anything — stay out of the way.
  if (!userId || !ratingId || loading || (comments.length === 0 && likeCount === 0)) return null;

  const nameFor = (uid: string) =>
    uid === userId ? 'You' : (profiles[uid]?.display_name || profiles[uid]?.username || 'Someone');

  const row = (c: ActivityComment, isReply: boolean) => {
    const color = colorOf(c.user_id);
    const name = nameFor(c.user_id);
    const username = profiles[c.user_id]?.username || '';
    return (
      <div key={c.id} className={cn('flex gap-2.5', isReply && 'ml-9')}>
        <div className={cn('rounded-full flex items-center justify-center flex-shrink-0 mt-0.5', isReply ? 'w-6 h-6' : 'w-7 h-7', color.bg)}>
          <span className={cn('font-serif font-bold', isReply ? 'text-[10px]' : 'text-[11px]', color.text)}>{initialOf(name)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed">
            {username ? (
              <Link to={`/user/${username}`} className="font-semibold text-on-surface/80 hover:text-primary">{name}</Link>
            ) : (
              <span className="font-semibold text-on-surface/80">{name}</span>
            )}{' '}
            <span className="text-on-surface/65">{c.text}</span>
          </p>
          <p className="text-[11px] text-on-surface/35 mt-0.5">{timeAgo(c.created_at)}</p>
          {!isReply && (repliesByParent[c.id] || []).map((r) => (
            <div key={r.id} className="mt-2.5">{row(r, true)}</div>
          ))}
        </div>
      </div>
    );
  };

  const thread = (
    <>
      <div className="flex items-center gap-4 pb-3 mb-3 border-b border-on-surface/[0.07]">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface/60">
          <Heart size={15} className={likeCount > 0 ? 'fill-red-500 text-red-500' : ''} />
          <span className="tabular-nums">{likeCount}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface/60">
          <MessageSquare size={15} />
          <span className="tabular-nums">{comments.length}</span>
        </span>
      </div>

      {comments.length === 0 ? (
        <p className="text-[13px] text-on-surface/45">
          {likeCount === 1 ? 'One person' : `${likeCount} people`} liked this. No comments yet.
        </p>
      ) : (
        <div className="space-y-3">{topLevel.map((c) => row(c, false))}</div>
      )}

      <div className="flex gap-2 pt-3 mt-1">
        <input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply…"
          className="flex-1 bg-on-surface/[0.04] border border-on-surface/[0.07] rounded-full py-2.5 px-4 text-[13px] focus:outline-none focus:border-primary/40 focus:bg-white transition-colors"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(); }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!reply.trim() || sending}
          aria-label="Post reply"
          className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-primary disabled:text-on-surface/15 rounded-full hover:bg-primary/5 transition-colors"
        >
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </>
  );

  if (variant === 'mobile') {
    return (
      <>
        {leading}
        <section ref={sectionRef} className={cn('scroll-mt-4', className)}>
          <p className="uppercase text-primary mb-4" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em' }}>
            On your rating
          </p>
          <div className="rounded-[16px] bg-paper px-3.5 py-3.5" style={{ boxShadow: 'inset 0 0 0 1px var(--color-line)' }}>
            {thread}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {leading}
      <section ref={sectionRef} className={cn('scroll-mt-24', className)}>
        <h2 className="font-serif font-bold text-[22px] tracking-[-0.02em] text-on-surface mb-4">On your rating</h2>
        <div className="bg-white border border-on-surface/[0.07] rounded-2xl px-5 py-4">
          {thread}
        </div>
      </section>
    </>
  );
};
