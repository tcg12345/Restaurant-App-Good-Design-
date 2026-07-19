import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { Heart, Send, Loader2, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import {
  getRecipeComments,
  addRecipeComment,
  toggleRecipeCommentLike,
  deleteRecipeComment,
  type RecipeComment,
} from '../lib/supabase-recipes';
import { cn } from '../lib/utils';
import { avatarHue } from '../lib/avatar';

/**
 * Real comment thread for a recipe / home meal, keyed by `targetId` (the meal
 * or recipe id). Mirrors the restaurant rating comments — a list of comments
 * with per-comment likes and one level of nested replies, plus an "Add a
 * comment" composer. Reused on the recipe detail page (RecipePage) and in the
 * feed card's comment sheet.
 */

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7); if (w < 5) return `${w}w`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


interface Props {
  targetId: string;
  className?: string;
  /** 'inline' (default) for in-page sections; 'sheet' for a fixed-height popup
   *  where the list scrolls and the composer is pinned to the bottom. */
  variant?: 'inline' | 'sheet';
  /** Notified after comments load/change so callers can update a count. */
  onCountChange?: (count: number) => void;
}

export const RecipeCommentThread: FC<Props> = ({ targetId, className, variant = 'inline', onCountChange }) => {
  const { user, isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const [comments, setComments] = useState<RecipeComment[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Keep the latest onCountChange reachable without making it a dependency of
  // `load` — an inline parent callback would otherwise change every render and
  // re-fire the load effect forever (the "glitches out" infinite loop).
  const onCountRef = useRef(onCountChange);
  onCountRef.current = onCountChange;

  const load = useCallback(async () => {
    if (!targetId) return;
    const rows = await getRecipeComments(targetId, user?.id ?? null);
    setComments(rows);
    onCountRef.current?.(rows.length);
    const ids = [...new Set(rows.map((c) => c.user_id))];
    if (ids.length) {
      const profs = await getProfilesByIds(ids);
      setProfiles((prev) => ({ ...prev, ...profs }));
    }
    setLoading(false);
  }, [targetId, user?.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const submit = useCallback(async (body: string, parentId: string | null) => {
    if (!isSignedIn || !user?.id) { requireSignIn('Sign in to comment'); return false; }
    const t = body.trim();
    if (!t || posting) return false;
    setPosting(true);
    const ok = await addRecipeComment(user.id, targetId, t, parentId);
    setPosting(false);
    if (ok) load();
    return ok;
  }, [isSignedIn, user?.id, posting, targetId, load, requireSignIn]);

  const post = useCallback(async () => {
    if (await submit(text, null)) setText('');
  }, [submit, text]);

  const postReply = useCallback(async (parentId: string) => {
    if (await submit(replyText, parentId)) { setReplyText(''); setReplyingTo(null); }
  }, [submit, replyText]);

  const toggleLike = useCallback(async (c: RecipeComment) => {
    if (!isSignedIn || !user?.id) { requireSignIn('Sign in to like'); return; }
    setComments((prev) => prev.map((x) => x.id === c.id
      ? { ...x, liked_by_me: !x.liked_by_me, like_count: (x.like_count || 0) + (x.liked_by_me ? -1 : 1) }
      : x));
    await toggleRecipeCommentLike(user.id, c.id);
  }, [isSignedIn, user?.id, requireSignIn]);

  const topLevel = useMemo(() => {
    // Replies whose parent no longer exists (deleted before the cascade, or
    // RLS kept another user's reply) render as TOP-LEVEL comments — hiding
    // them made the thread show fewer comments than the count badge.
    const ids = new Set(comments.map((c) => c.id));
    return comments.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  }, [comments]);
  const repliesByParent = useMemo(() => {
    const map: Record<string, RecipeComment[]> = {};
    for (const c of comments) if (c.parent_id) (map[c.parent_id] ||= []).push(c);
    return map;
  }, [comments]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const handleDelete = useCallback(async (c: RecipeComment) => {
    if (!user?.id || c.user_id !== user.id || deletingId) return;
    const replyCount = (repliesByParent[c.id] || []).length;
    const ok = window.confirm(replyCount > 0
      ? `Delete this comment and its ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}?`
      : 'Delete this comment?');
    if (!ok) return;
    setDeletingId(c.id);
    const deleted = await deleteRecipeComment(c.id);
    setDeletingId(null);
    if (deleted) load();
  }, [user?.id, deletingId, repliesByParent, load]);

  const nameOf = (uid: string) => profiles[uid]?.display_name || profiles[uid]?.username || 'Someone';

  const renderComment = (c: RecipeComment, isReply = false) => (
    <div key={c.id} className={cn('flex gap-2.5', isReply && 'mt-2.5')}>
      <div
        className={cn('rounded-full grid place-items-center text-white font-bold flex-shrink-0',
          isReply ? 'w-7 h-7 text-[11px]' : 'w-8 h-8 text-[12px]')}
        style={{ background: `hsl(${avatarHue(c.user_id)} 50% 45%)` }}
      >
        {nameOf(c.user_id).charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-on-surface/[0.05] px-3.5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-on-surface truncate">{nameOf(c.user_id)}</span>
            <span className="text-[11.5px] text-on-surface/40 flex-shrink-0">· {timeAgo(c.created_at)}</span>
          </div>
          <p className="mt-0.5 text-[14px] leading-[1.45] text-on-surface/85 whitespace-pre-wrap break-words">{c.text}</p>
        </div>
        <div className="mt-1 flex items-center gap-4 pl-1">
          <button
            type="button"
            onClick={() => toggleLike(c)}
            className={cn('inline-flex items-center gap-1 text-[12px] font-semibold transition-colors',
              c.liked_by_me ? 'text-red-500' : 'text-on-surface/45 hover:text-on-surface/70')}
            aria-label={c.liked_by_me ? 'Unlike comment' : 'Like comment'}
          >
            <Heart size={13} className={c.liked_by_me ? 'fill-red-500' : ''} />
            {(c.like_count || 0) > 0 && <span className="tabular-nums">{c.like_count}</span>}
          </button>
          {!isReply && (
            <button
              type="button"
              onClick={() => {
                if (!isSignedIn) { requireSignIn('Sign in to reply'); return; }
                setReplyingTo((prev) => (prev === c.id ? null : c.id));
                setReplyText('');
              }}
              className="text-[12px] font-semibold text-on-surface/45 hover:text-on-surface/70 transition-colors"
            >
              Reply
            </button>
          )}
          {user?.id === c.user_id && (
            <button
              type="button"
              onClick={() => handleDelete(c)}
              disabled={deletingId === c.id}
              className="text-[12px] font-semibold text-on-surface/45 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              {deletingId === c.id ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>

        {!isReply && replyingTo === c.id && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postReply(c.id); } }}
              placeholder={`Reply to ${nameOf(c.user_id)}…`}
              autoFocus
              className="flex-1 h-9 rounded-full bg-on-surface/[0.05] border border-on-surface/8 px-3.5 text-[13px] text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40"
            />
            <button
              type="button"
              onClick={() => postReply(c.id)}
              disabled={!replyText.trim() || posting}
              className="grid h-9 w-9 place-items-center rounded-full bg-primary text-white disabled:opacity-40 flex-shrink-0"
              aria-label="Post reply"
            >
              {posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        )}

        {(repliesByParent[c.id] || []).length > 0 && (
          <div className="mt-2 space-y-0 border-l-2 border-on-surface/[0.06] pl-3">
            {(repliesByParent[c.id] || []).map((r) => renderComment(r, true))}
          </div>
        )}
      </div>
    </div>
  );

  const composer = (
    <div className="flex items-center gap-2.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } }}
        onFocus={() => { if (!isSignedIn) requireSignIn('Sign in to comment'); }}
        placeholder="Add a comment…"
        className="flex-1 h-11 rounded-full bg-on-surface/[0.05] border border-on-surface/8 px-4 text-[14px] text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 transition-colors"
      />
      <button
        type="button"
        onClick={post}
        disabled={!text.trim() || posting}
        className="grid h-11 w-11 place-items-center rounded-full bg-primary text-white disabled:opacity-40 transition-opacity flex-shrink-0"
        aria-label="Post comment"
      >
        {posting ? <Loader2 size={18} className="animate-spin" /> : <Send size={17} />}
      </button>
    </div>
  );

  const list = loading ? (
    <div className="flex justify-center py-6 text-on-surface/30"><Loader2 size={20} className="animate-spin" /></div>
  ) : topLevel.length === 0 ? (
    <div className="flex flex-col items-center gap-1.5 py-10 text-center">
      <MessageSquare size={22} className="text-on-surface/20" />
      <p className="text-[13.5px] text-on-surface/45">No comments yet — be the first.</p>
    </div>
  ) : (
    <div className="space-y-4">{topLevel.map((c) => renderComment(c))}</div>
  );

  // Sheet: list scrolls, composer pinned to the bottom (matches the post /
  // reel comment popup). Inline: composer on top, list flows below.
  if (variant === 'sheet') {
    return (
      <div className={cn('flex flex-1 min-h-0 flex-col', className)}>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{list}</div>
        <div className="flex-shrink-0 border-t border-on-surface/8 bg-paper px-4 py-3 pb-safe-3">{composer}</div>
      </div>
    );
  }

  return (
    <div className={className}>
      {composer}
      <div className="mt-4">{list}</div>
    </div>
  );
};
