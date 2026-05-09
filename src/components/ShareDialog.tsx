/**
 * ShareDialog — single share popup used for reels, posts, restaurants,
 * and recipes.
 *
 * Behavior:
 *   • Lists every friend (via getFriends + user_profiles) and every
 *     existing group chat. Users no longer need a pre-existing 1:1
 *     conversation to share — selecting a friend without one will
 *     create the chat on send.
 *   • Multi-select with checkboxes. The footer button reads "Send to N".
 *   • Optional message input above the list.
 *   • A "Share via…" button at the bottom opens the OS share sheet
 *     (navigator.share) with a copy-link fallback.
 *   • Bottom sheet on phone, centered card on desktop.
 *
 * The caller passes a `payload` describing what's being shared. The
 * dialog shows a thumbnail/preview chip derived from it and feeds
 * ChatContext.shareToTargets the same payload on submit.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Search, MessageCircle, Users, ChevronRight, ExternalLink, Loader2, Check, MapPin, ChefHat, Film, Image as ImageIcon, Layers } from 'lucide-react';
import { cn } from '../lib/utils';
import { useChat, type SharePayload, type SharedReel, type SharedRecipe, type SharedRestaurant, type SharedPost } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';
import { getFriends, getProfilesByIds, type UserProfile } from '../lib/supabase-community';

/* ── Avatar palette — keeps friend chips visually consistent ─────────── */

const AVATAR_PALETTE = [
  'bg-emerald-700', 'bg-rose-700', 'bg-amber-600', 'bg-indigo-700',
  'bg-sky-700', 'bg-fuchsia-700', 'bg-orange-700', 'bg-teal-700',
];
function pickAvatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── Payload preview — small chip at the top of the dialog ───────────── */

const PreviewChip: React.FC<{ payload: SharePayload }> = ({ payload }) => {
  if (payload.sharedReel) return <ReelPreview reel={payload.sharedReel} />;
  if (payload.sharedPost) return <PostPreview post={payload.sharedPost} />;
  if (payload.sharedRestaurant) return <RestaurantPreview r={payload.sharedRestaurant} />;
  if (payload.sharedRecipe) return <RecipePreview r={payload.sharedRecipe} />;
  return null;
};

const ReelPreview: React.FC<{ reel: SharedReel }> = ({ reel }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] p-2">
    <div className={cn('w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br', reel.bgGradient || 'from-stone-800 to-stone-900')}>
      {reel.videoUrl && (
        <video src={reel.videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-bold truncate">{reel.attachedTitle || 'Untitled'}</p>
      <p className="text-[11px] text-on-surface/50 truncate">@{reel.authorUsername}{reel.caption && ` · "${reel.caption}"`}</p>
    </div>
    <Film size={14} className="text-on-surface/30 flex-shrink-0 mr-1" />
  </div>
);

const PostPreview: React.FC<{ post: SharedPost }> = ({ post }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] p-2">
    <div className={cn('relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br', post.bgGradient || 'from-stone-800 to-stone-900')}>
      {post.coverUrl && post.coverMediaType === 'video' && (
        <video src={post.coverUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
      )}
      {post.coverUrl && post.coverMediaType === 'photo' && (
        <img src={post.coverUrl} alt="" className="w-full h-full object-cover" />
      )}
      {post.itemCount > 1 && (
        <span className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-black/55 text-white">
          <Layers size={9} />
        </span>
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-bold truncate">@{post.authorUsername}</p>
      <p className="text-[11px] text-on-surface/50 truncate">
        {post.itemCount} item{post.itemCount === 1 ? '' : 's'}
        {post.caption && ` · "${post.caption}"`}
      </p>
    </div>
    <ImageIcon size={14} className="text-on-surface/30 flex-shrink-0 mr-1" />
  </div>
);

const RestaurantPreview: React.FC<{ r: SharedRestaurant }> = ({ r }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] p-2">
    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-on-surface/[0.06] flex items-center justify-center">
      {r.image ? (
        <img src={r.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <MapPin size={16} className="text-on-surface/35" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-bold truncate">{r.name}</p>
      <p className="text-[11px] text-on-surface/50 truncate">
        {[r.cuisine, r.price].filter(Boolean).join(' · ')}
        {r.isReview && r.score !== undefined && ` · ${r.score.toFixed(1)} / 10`}
      </p>
    </div>
    <MapPin size={14} className="text-on-surface/30 flex-shrink-0 mr-1" />
  </div>
);

const RecipePreview: React.FC<{ r: SharedRecipe }> = ({ r }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] p-2">
    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-emerald-50 flex items-center justify-center">
      {r.image ? (
        <img src={r.image} alt="" className="w-full h-full object-cover" />
      ) : (
        <ChefHat size={16} className="text-emerald-600" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-bold truncate">{r.name}</p>
      <p className="text-[11px] text-on-surface/50 truncate">{r.authorName}'s recipe</p>
    </div>
    <ChefHat size={14} className="text-on-surface/30 flex-shrink-0 mr-1" />
  </div>
);

/* ── Targets list — friends + group chats, deduped ──────────────────── */

interface FriendTarget {
  kind: 'friend';
  key: string;          // `friend-${friendId}`
  friendId: string;
  name: string;
  avatarColor: string;
  initials: string;
}
interface GroupTarget {
  kind: 'group';
  key: string;          // `conv-${id}`
  conversationId: string;
  name: string;
  participantCount: number;
}
type ShareTarget = FriendTarget | GroupTarget;

/* ── Dialog ─────────────────────────────────────────────────────────── */

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  payload: SharePayload | null;
  /** Optional title override. Defaults to "Share <kind>". */
  title?: string;
  /** Used to build the external share URL when the user taps "Share via…". */
  externalShareUrl?: string;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ open, onClose, payload, title, externalShareUrl }) => {
  const { user } = useAuth();
  const { conversations, shareToTargets } = useChat();
  const { showToast } = useToast();
  const { phoneMode } = useSettings();

  const [friends, setFriends] = useState<FriendTarget[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [search, setSearch] = useState('');
  const [optionalText, setOptionalText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sentMode, setSentMode] = useState(false);

  // Reset transient state on open.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setOptionalText('');
    setSelected(new Set());
    setSending(false);
    setSentMode(false);
  }, [open]);

  // Load the user's friends list once per open.
  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const fl = await getFriends(user.id);
        if (cancelled) return;
        const ids = fl.map((f) => f.friend_id);
        const profileMap = await getProfilesByIds(ids);
        if (cancelled) return;
        setProfiles(profileMap);
        const targets: FriendTarget[] = ids
          .map((id) => {
            const p = profileMap[id];
            const name = p?.display_name || p?.username || id.slice(0, 8);
            return {
              kind: 'friend' as const,
              key: `friend-${id}`,
              friendId: id,
              name,
              avatarColor: pickAvatarColor(id),
              initials: initialsFor(name),
            };
          })
          // Sort alphabetically by display name for predictable order.
          .sort((a, b) => a.name.localeCompare(b.name));
        setFriends(targets);
      } catch (err) {
        console.warn('[ShareDialog] friend fetch failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [open, user?.id]);

  // Group conversations only — direct chats are already represented by
  // their friend in the friends list.
  const groupTargets: GroupTarget[] = useMemo(() => {
    return conversations
      .filter((c) => c.isGroup)
      .map((c) => ({
        kind: 'group' as const,
        key: `conv-${c.id}`,
        conversationId: c.id,
        name: c.name || 'Group Chat',
        participantCount: c.participantIds.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  const allTargets: ShareTarget[] = useMemo(
    () => [...friends, ...groupTargets],
    [friends, groupTargets],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTargets;
    return allTargets.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTargets, search]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onSend = () => {
    if (!payload || selected.size === 0 || sending) return;
    const targets: { conversationId?: string; friendId?: string }[] = [];
    for (const t of allTargets) {
      if (!selected.has(t.key)) continue;
      if (t.kind === 'friend') targets.push({ friendId: t.friendId });
      else targets.push({ conversationId: t.conversationId });
    }
    if (targets.length === 0) return;
    setSending(true);
    const sentTo = shareToTargets(targets, { ...payload, text: optionalText.trim() });
    setSending(false);
    if (sentTo.length > 0) {
      setSentMode(true);
      showToast(`Sent to ${sentTo.length}`);
      // Auto-close after a short confirmation flash.
      window.setTimeout(() => onClose(), 700);
    } else {
      showToast("Couldn't send");
    }
  };

  const onShareExternally = async () => {
    if (!payload) return;
    const url = externalShareUrl || (typeof window !== 'undefined' ? window.location.href : '');
    const previewTitle = payload.sharedRestaurant?.name
      || payload.sharedRecipe?.name
      || payload.sharedReel?.attachedTitle
      || (payload.sharedPost ? `@${payload.sharedPost.authorUsername}` : 'Check this out');
    const shareData = {
      title: previewTitle,
      text: payload.sharedReel?.caption || payload.sharedPost?.caption || undefined,
      url,
    };
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share(shareData);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        showToast('Link copied');
      } else {
        showToast('Sharing not supported on this device');
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        showToast("Couldn't open the share sheet");
      }
    }
  };

  const computedTitle = title ?? (
    payload?.sharedReel ? 'Share reel'
    : payload?.sharedPost ? 'Share post'
    : payload?.sharedRecipe ? 'Share recipe'
    : payload?.sharedRestaurant ? 'Share restaurant'
    : 'Share'
  );

  return (
    <AnimatePresence>
      {open && payload && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/55 backdrop-blur-sm z-[110] flex justify-center',
            phoneMode ? 'items-end' : 'items-end sm:items-center',
          )}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface w-full overflow-hidden flex flex-col',
              phoneMode
                ? 'h-[88%] rounded-t-3xl'
                : 'h-[88%] sm:max-w-md sm:max-h-[80vh] sm:h-auto rounded-t-3xl sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 border-b border-on-surface/[0.06] flex-shrink-0">
              <h2 className="font-serif font-bold text-lg leading-tight truncate">{computedTitle}</h2>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65 flex-shrink-0"
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {/* Preview */}
            <div className="px-5 pt-3 pb-1 flex-shrink-0">
              <PreviewChip payload={payload} />
            </div>

            {/* Optional message */}
            <div className="px-5 pt-3 flex-shrink-0">
              <input
                value={optionalText}
                onChange={(e) => setOptionalText(e.target.value)}
                placeholder="Say something (optional)"
                maxLength={280}
                disabled={sending || sentMode}
                className="w-full h-10 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 disabled:opacity-50"
              />
            </div>

            {/* Search */}
            <div className="px-5 pt-2 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-10">
                <Search size={14} className="text-on-surface/45 flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search friends and chats…"
                  className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
              {allTargets.length === 0 ? (
                <div className="text-center py-10 px-6">
                  <MessageCircle size={28} className="mx-auto text-on-surface/15 mb-2" />
                  <p className="text-sm text-on-surface/45">No friends yet.</p>
                  <p className="text-[12px] text-on-surface/30 mt-1">
                    Find people to follow, then come back here to share.
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-sm text-on-surface/45">No matches.</div>
              ) : (
                <ul className="space-y-1">
                  {filtered.map((t) => {
                    const isSelected = selected.has(t.key);
                    return (
                      <li key={t.key}>
                        <button
                          type="button"
                          onClick={() => toggle(t.key)}
                          disabled={sending || sentMode}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                            isSelected ? 'bg-primary/[0.08]' : 'hover:bg-on-surface/[0.05]',
                          )}
                        >
                          {t.kind === 'friend' ? (
                            <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white', t.avatarColor)}>
                              {t.initials}
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
                              <Users size={15} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{t.name}</p>
                            <p className="text-[11px] text-on-surface/40 truncate">
                              {t.kind === 'friend' ? 'Friend' : `${t.participantCount} people`}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'inline-flex items-center justify-center w-5 h-5 rounded-full transition-colors flex-shrink-0',
                              isSelected ? 'bg-primary text-white' : 'border border-on-surface/20',
                            )}
                            aria-hidden
                          >
                            {isSelected && <Check size={12} strokeWidth={3} />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-on-surface/[0.06] px-5 py-3 bg-surface flex-shrink-0 space-y-2">
              <button
                type="button"
                onClick={onSend}
                disabled={selected.size === 0 || sending || sentMode}
                className={cn(
                  'w-full h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                  selected.size > 0 && !sending && !sentMode
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                )}
              >
                {sending ? <Loader2 size={15} className="animate-spin" /> : sentMode ? <Check size={15} /> : <Send size={15} />}
                {sentMode ? 'Sent' : sending ? 'Sending…' : selected.size > 0 ? `Send to ${selected.size}` : 'Pick someone to share with'}
              </button>
              <button
                type="button"
                onClick={onShareExternally}
                disabled={sentMode}
                className="w-full h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-on-surface/10 transition-colors disabled:opacity-40"
              >
                <ExternalLink size={15} />
                Share via…
                <ChevronRight size={14} className="text-on-surface/40" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
