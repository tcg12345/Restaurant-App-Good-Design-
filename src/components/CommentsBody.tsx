import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MessageCircle, Trash2, Loader2, X, ArrowUp, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { type Post } from '../contexts/PostsContext';
import { useToast } from '../contexts/ToastContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { parseCommentSegments, replyDraftFor } from '../lib/comment-text';
import { useAuth } from '../contexts/AuthContext';
import { pickAvatarColor, initialsFor } from '../lib/avatar';

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Comments body (shared between mobile sheet and desktop panel) ──── */

// Polymorphic comment shape — works for both reel and post comments
// (which have the same fields after row → object mapping).
export interface UnifiedComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
  /** Parent comment id when this is a reply; null/undefined for top-level. */
  parentId?: string | null;
  author?: { username: string; displayName?: string; avatarColor: string; initials: string; isExpert: boolean };
}

interface CommentsBodyProps {
  /** The id we operate against (a reel id or a post id depending on caller). */
  targetId: string;
  onClose: () => void;
  variant: 'sheet' | 'panel';
  /** Polymorphic adapters — caller picks reels or posts. Loaders resolve
   *  to null when the fetch failed (vs [] for "no comments"). */
  loadComments: (id: string) => Promise<UnifiedComment[] | null>;
  addComment: (id: string, body: string, parentId?: string | null) => Promise<UnifiedComment | null>;
  deleteComment: (id: string, commentId: string, removedCount?: number) => Promise<boolean>;
  currentUserId: string | null;
  /** 'sheet' variant only — the list's scroll container, so a hosting
   *  bottom sheet can tell drag-to-dismiss from list scrolling. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

/** One tap drops the emoji into the draft — the low-effort comment that
 *  makes the composer feel alive (same idea as Instagram's reaction row). */
const QUICK_EMOJI = ['❤️', '🙌', '🔥', '👏', '😍', '😂', '😮', '😢'];

/** State + composer + list. The wrapper (sheet/panel) decides chrome. */
export const CommentsBody: React.FC<CommentsBodyProps> = ({ targetId, onClose, variant, loadComments, addComment, deleteComment, currentUserId, scrollRef }) => {
  const { showToast } = useToast();
  const { requireSignIn } = useSignInModal();
  const { profile } = useAuth();
  const [comments, setComments] = useState<UnifiedComment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by "Try again" to re-run the load effect.
  const [retryTick, setRetryTick] = useState(0);
  const [posting, setPosting] = useState(false);
  /* ── Replies (one level deep, Instagram's model) ──
     There is no per-comment reply box any more. Tapping Reply anywhere in
     a thread points the ONE composer at that thread and seeds the draft
     with "@handle " — which is also what makes replying to a REPLY work:
     the row attaches to the same top-level parent (threads never nest
     deeper), and the @mention is what says who is being answered. */
  const [replyTarget, setReplyTarget] = useState<{ parentId: string; username: string } | null>(null);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const composerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    loadComments(targetId).then((list) => {
      if (cancelled) return;
      setComments(list ?? []);
      setLoadFailed(list === null);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setComments([]);
      setLoadFailed(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [targetId, loadComments, retryTick]);

  const onSubmit = async () => {
    if (!draft.trim() || posting) return;
    if (!currentUserId) {
      requireSignIn('Sign in to comment');
      return;
    }
    const parentId = replyTarget?.parentId ?? null;
    setPosting(true);
    const c = await addComment(targetId, draft, parentId);
    setPosting(false);
    if (!c) {
      showToast(parentId ? "Couldn't post reply" : "Couldn't post comment");
      return;
    }
    // A reply joins its thread (which opens so you can see it land); a new
    // comment goes to the top, where the newest-first list starts.
    setComments((prev) => (parentId ? [...prev, c] : [c, ...prev]));
    if (parentId) setExpandedThreads((prev) => new Set(prev).add(parentId));
    setDraft('');
    setReplyTarget(null);
  };

  /* Reply to anyone in a thread. `parentId` is the TOP-LEVEL comment even
     when replying to a reply — one level of nesting, and the @mention
     carries who is being answered. Focus moves in the same gesture, which
     is what lets iOS raise the keyboard. */
  const startReply = (parentId: string, username?: string) => {
    if (!currentUserId) { requireSignIn('Sign in to reply'); return; }
    setReplyTarget({ parentId, username: username || '' });
    setExpandedThreads((prev) => new Set(prev).add(parentId));
    const prefix = replyDraftFor(username);
    setDraft((prev) => (prev.trim() && prev.startsWith('@') ? prefix + prev.replace(/^@[A-Za-z0-9_]+\s*/, '') : prefix + prev));
    composerRef.current?.focus();
  };

  const cancelReply = () => {
    setReplyTarget(null);
    setDraft((prev) => prev.replace(/^@[A-Za-z0-9_]+\s*/, ''));
  };

  const toggleThread = (commentId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId); else next.add(commentId);
      return next;
    });
  };

  const onDeleteOne = async (commentId: string) => {
    // The DB cascade removes a parent's replies with it, so the badge must
    // drop by parent + replies, not just 1.
    const removed = 1 + comments.filter((c) => c.parentId === commentId).length;
    const ok = await deleteComment(targetId, commentId, removed);
    // Drop the comment and (if it was a parent) any of its replies — mirror
    // the server-side cascade locally.
    if (ok) setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
  };

  // Split into top-level comments (kept in load order — newest first) and
  // replies grouped under their parent (shown oldest-first within a thread).
  const topLevel = comments.filter((c) => !c.parentId);
  const repliesByParent: Record<string, UnifiedComment[]> = {};
  for (const c of comments) {
    if (c.parentId) (repliesByParent[c.parentId] ||= []).push(c);
  }
  for (const k of Object.keys(repliesByParent)) {
    repliesByParent[k].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Mobile sheet uses light-gray pill chrome; desktop panel uses on-surface
  // tokens so it blends with the app's surface color (not a dark bg).
  // Both variants ride the app's surface tokens so the comments UI blends
  // with the surface color in light AND dark mode (the mobile sheet used to
  // hardcode a light stone palette, which broke in dark mode).
  const headerCls = 'border-b border-on-surface/[0.07]';
  const titleCls = 'font-semibold text-on-surface text-[18px] tracking-tight';
  const closeCls = 'w-11 h-11 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/[0.1] text-on-surface/65';
  const composerBorderCls = 'border-on-surface/[0.07]';
  const usernameCls = 'text-on-surface';
  const bodyTextCls = 'text-on-surface/85';
  const muteCls = 'text-on-surface/40';

  // Composer identity — your own avatar in front of the input, so the box
  // reads as "you, about to speak" instead of an anonymous form field.
  const myName = profile?.display_name || profile?.username || 'You';
  const myAvatarCls = currentUserId ? pickAvatarColor(currentUserId) : 'bg-on-surface/20';
  const myInitials = currentUserId ? initialsFor(myName) : 'U';

  /** Comment text with its @mentions lit up — the convention only reads as
   *  a convention if the handle looks like a link to a person. */
  const renderBody = (body: string) => parseCommentSegments(body).map((seg, i) =>
    seg.type === 'mention'
      ? <span key={i} className="font-semibold text-primary">{seg.value}</span>
      : <React.Fragment key={i}>{seg.value}</React.Fragment>,
  );

  /* One comment. Instagram's anatomy: avatar, then name and time on ONE
     line, the text under it, and a quiet action row under that — instead
     of the old stack where the handle, the time and the body each took a
     line of their own and every row looked like a paragraph.

     `parentId` is what a Reply from this row should attach to: a
     top-level comment replies to itself, a reply replies to its parent. */
  const renderRow = (c: UnifiedComment, isReply: boolean, parentId?: string): React.ReactNode => {
    const replies = !isReply ? (repliesByParent[c.id] || []) : [];
    const expanded = expandedThreads.has(c.id);
    const handle = c.author?.username || c.userId.slice(0, 8);
    const threadId = isReply ? (parentId as string) : c.id;
    const isTarget = replyTarget?.parentId === threadId;
    return (
      <div key={c.id} className={cn('flex items-start gap-3', isReply ? 'pt-3' : 'pt-4 first:pt-1')}>
        <div className={cn(
          'rounded-full flex items-center justify-center text-white font-bold flex-shrink-0',
          isReply ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-[12px]',
          c.author?.avatarColor || 'bg-stone-500',
        )}>
          {c.author?.initials || c.userId.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          {/* Name and time share the line; the body starts under them. */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn('truncate text-[13px] font-bold leading-tight', usernameCls)}>{handle}</span>
            {c.author?.isExpert && <VerifiedBadge size={12} className="flex-none" />}
            <span className={cn('flex-none text-[11.5px] leading-tight', muteCls)}>{formatRelativeTime(c.createdAt)}</span>
          </div>
          <p className={cn('selectable mt-[3px] text-[13.5px] leading-[1.45] whitespace-pre-wrap break-words', bodyTextCls)}>
            {renderBody(c.body)}
          </p>
          {/* Every row can be replied to — replying to a REPLY is the whole
              point of seeding the draft with their handle. */}
          <button
            type="button"
            onClick={() => startReply(threadId, c.author?.username)}
            className={cn(
              'mt-1.5 text-[12px] font-bold transition-colors',
              isTarget ? 'text-on-surface' : 'text-on-surface/45 active:text-on-surface/70',
            )}
          >
            Reply
          </button>

          {/* The thread. A rule then a count, Instagram's own shape — the
              line is what turns "View 2 replies" from a stray link into
              the head of a branch. */}
          {!isReply && replies.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => toggleThread(c.id)}
                className="mt-2 flex items-center gap-2.5 text-[12px] font-bold text-on-surface/50 active:text-on-surface/75 transition-colors"
              >
                <span className="w-6 h-px bg-on-surface/20" aria-hidden />
                {expanded ? 'Hide replies' : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
              </button>
              {expanded && <div>{replies.map((r) => renderRow(r, true, c.id))}</div>}
            </>
          )}
        </div>
        {c.userId === currentUserId && (
          <button
            type="button"
            onClick={() => onDeleteOne(c.id)}
            className={cn('hit-44 flex-none p-1 -mt-0.5 active:text-rose-500 transition-colors', muteCls)}
            aria-label="Delete comment"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Header — centered title, count as a quiet suffix */}
      <div className={cn('relative px-5 pt-2.5 pb-3 flex items-center justify-center flex-shrink-0', headerCls)}>
        <h3 className={titleCls}>
          Comments
          {comments.length > 0 && (
            <span className="ml-2 align-middle font-sans text-[12.5px] font-semibold text-on-surface/40 tabular-nums">
              {comments.length}
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className={cn('absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center transition-colors', closeCls)}
          aria-label="Close comments"
        >
          <X size={16} />
        </button>
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pt-1 pb-4">
        {loading ? (
          <div role="status" aria-label="Loading comments" className="space-y-5 py-4">
            {[0,1,2].map(i => <div key={i} aria-hidden="true" className="flex gap-3 animate-pulse motion-reduce:animate-none">
              <div className="h-9 w-9 rounded-full bg-on-surface/10" />
              <div className="flex-1 space-y-2"><div className="h-3 w-24 rounded bg-on-surface/10" /><div className="h-3 w-4/5 rounded bg-on-surface/10" /></div>
            </div>)}
          </div>
        ) : loadFailed ? (
          <div className="text-center py-8">
            <p className="text-sm text-on-surface/55">Couldn't load comments.</p>
            <button
              type="button"
              onClick={() => setRetryTick((t) => t + 1)}
              className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/[0.1] text-on-surface/75 text-xs font-bold transition-colors"
            >
              <RefreshCw size={13} />
              Try again
            </button>
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-on-surface/[0.05] flex items-center justify-center">
              <MessageCircle size={22} className="text-on-surface/30" />
            </div>
            <p className="mt-3 text-[14.5px] font-semibold text-on-surface/75">No comments yet</p>
            <p className={cn('mt-0.5 text-[12.5px]', muteCls)}>Start the conversation.</p>
          </div>
        ) : (
          topLevel.map((c) => renderRow(c, false))
        )}
      </div>

      {/* Composer — emoji quick-row, then your avatar + a pill with the
          send button embedded inside it (iMessage-style arrow). */}
      <div className={cn('border-t flex-shrink-0', composerBorderCls)}>
        {/* Which thread the composer is pointed at. Without it the only
            sign you were replying rather than commenting would be the
            "@handle" you could freely delete. */}
        {replyTarget && (
          <div className="flex items-center gap-2 px-5 py-2 bg-on-surface/[0.04] border-b border-on-surface/[0.06]">
            <span className="flex-1 min-w-0 truncate text-[12px] text-on-surface/55">
              Replying to <span className="font-semibold text-on-surface/80">@{replyTarget.username || 'this thread'}</span>
            </span>
            <button
              type="button"
              onClick={cancelReply}
              className="hit-44-y flex-none w-6 h-6 rounded-full grid place-items-center text-on-surface/45 active:text-on-surface transition-colors"
              aria-label="Cancel reply"
            >
              <X size={13} strokeWidth={2.4} />
            </button>
          </div>
        )}
        {currentUserId && (
          <div className="flex items-center justify-between px-5 pt-2.5">
            {QUICK_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setDraft((d) => (d + e).slice(0, 500))}
                disabled={posting}
                className="py-0.5 text-[22px] leading-none transition-transform active:scale-125"
                aria-label={`React with ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div className={cn('flex items-center gap-2.5 px-4 pt-2.5', variant === 'sheet' ? 'pb-safe-3' : 'pb-3')}>
          <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0', myAvatarCls)}>
            {myInitials}
          </div>
          <div className="flex-1 min-w-0 flex items-center h-11 rounded-full bg-on-surface/[0.05] pl-4 pr-1.5 transition-colors focus-within:bg-on-surface/[0.08] focus-within:ring-2 focus-within:ring-on-surface/10">
            <input
              ref={composerRef}
              aria-label={replyTarget ? 'Write a reply' : 'Add a comment'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
              // Guests can tap the box to be prompted to sign in (readOnly stops
              // typing); never a silent dead-end.
              onMouseDown={() => { if (!currentUserId) requireSignIn('Sign in to comment'); }}
              placeholder={!currentUserId ? 'Sign in to comment'
                : replyTarget ? `Reply to @${replyTarget.username || 'thread'}…`
                : 'Add a comment…'}
              readOnly={!currentUserId}
              disabled={posting}
              maxLength={500}
              className="flex-1 min-w-0 bg-transparent text-[14px] text-on-surface placeholder:text-on-surface/40 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={!currentUserId || !draft.trim() || posting}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200',
                draft.trim() && !posting && currentUserId
                  ? 'bg-primary text-on-primary scale-100'
                  : 'bg-on-surface/[0.07] text-on-surface/30 scale-90 cursor-not-allowed',
              )}
              aria-label={replyTarget ? 'Post reply' : 'Post comment'}
            >
              {posting ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} strokeWidth={2.6} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
