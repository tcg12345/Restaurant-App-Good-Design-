import { composeShareMessage } from '../lib/share-message';
/**
 * ShareDialog — single share popup used for reels, posts, restaurants,
 * recipes, and guides.
 *
 * A grid of tap-to-select avatar tiles (friends + existing group chats),
 * search, and a bottom action area that cross-fades between two layers:
 *   • idle — quick actions (Copy link, Message, Email, Add to list, More,
 *     Ask AI), shown while nothing is selected.
 *   • active — a message field + Send button, shown once ≥1 target is
 *     selected. Send delivers the payload as a rich card via
 *     ChatContext.shareToTargets — 1:1 chats are created on the fly for
 *     friends with none yet; existing group chats are sent to as-is.
 *
 * The caller passes a `payload` describing what's being shared; the header
 * derives its cover/title/subtitle from whichever `Shared*` field is set.
 * Ask AI pins the same payload to the AI assistant (see
 * lib/share-assistant-attachment.ts) so the user can ask about it — the
 * same mechanism RestaurantDetailMobile / RecipePage use for their own
 * "ask about this" buttons, just reached from the share sheet instead.
 *
 * Bottom sheet on phone, centered card on desktop — both share the same
 * grid/footer markup, just at different sizes.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, Users, Loader2, Check, Send, Link2, MessageCircle, Mail,
  ListPlus, MoreHorizontal, Sparkles, MapPin, ChefHat, Film, Image as ImageIcon, BookOpen,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useChat, type SharePayload } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useAskAssistantAbout } from '../contexts/AssistantContext';
import { getFriends, getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { useBottomSheet } from '../lib/useBottomSheet';
import { pickAvatarColor, initialsFor } from '../lib/avatar';
import { shareExternally, copyToClipboard } from '../lib/native-share';
import { buildAssistantAttachment } from '../lib/share-assistant-attachment';

/* ── Header — cover, title, subtitle, derived per payload kind ───────── */

function headerFor(payload: SharePayload): { cover: string | null; icon: React.ReactNode; title: string; subtitle: string } {
  if (payload.sharedReel) {
    const r = payload.sharedReel;
    return { cover: r.posterUrl || null, icon: <Film size={16} className="text-on-surface/35" />, title: r.attachedTitle || 'Reel', subtitle: `@${r.authorUsername}${r.caption ? ` · "${r.caption}"` : ''}` };
  }
  if (payload.sharedPost) {
    const p = payload.sharedPost;
    return { cover: p.coverMediaType === 'photo' ? p.coverUrl || null : null, icon: <ImageIcon size={16} className="text-on-surface/35" />, title: `@${p.authorUsername}`, subtitle: `${p.itemCount} item${p.itemCount === 1 ? '' : 's'}${p.caption ? ` · "${p.caption}"` : ''}` };
  }
  if (payload.sharedRestaurant) {
    const r = payload.sharedRestaurant;
    return { cover: r.image || null, icon: <MapPin size={16} className="text-on-surface/35" />, title: r.name, subtitle: [r.cuisine, r.price, r.isReview && r.score !== undefined ? `${r.score.toFixed(1)} / 10` : null].filter(Boolean).join(' · ') };
  }
  if (payload.sharedRecipe) {
    const r = payload.sharedRecipe;
    return { cover: r.image || null, icon: <ChefHat size={16} className="text-emerald-600" />, title: r.name, subtitle: `${r.authorName}'s recipe` };
  }
  if (payload.sharedGuide) {
    const g = payload.sharedGuide;
    return { cover: g.coverPhoto || null, icon: <BookOpen size={16} className="text-on-surface/35" />, title: g.title, subtitle: [g.authorName ? `by ${g.authorName}` : 'Guide', `${g.entryCount} ${g.type === 'recipes' ? 'recipes' : 'spots'}`].filter(Boolean).join(' · ') };
  }
  return { cover: null, icon: null, title: 'Share', subtitle: '' };
}

/* ── Targets — friends + group chats, deduped ─────────────────────────── */

interface FriendTarget {
  kind: 'friend';
  key: string;
  friendId: string;
  name: string;
  avatarColor: string;
  initials: string;
}
interface GroupTarget {
  kind: 'group';
  key: string;
  conversationId: string;
  name: string;
  participantCount: number;
  /** Up to two participant ids, for the overlapping-avatar stack. Colors
   *  are derived from the ids themselves (pickAvatarColor), so the stack
   *  never needs the participants' actual profiles loaded. */
  stackIds: string[];
}
type ShareTarget = FriendTarget | GroupTarget;

/** Two overlapping colour-tile avatars for a group target — the reference
 *  design's construction: back tile offset up-left, front tile offset
 *  down-right, both ringed in the sheet's own surface colour so they read
 *  as stacked discs rather than a Venn diagram. No group-photo lookup
 *  needed — same id-derived tone system as a solo friend tile. */
const AvatarStack: React.FC<{ ids: string[]; size: number }> = ({ ids, size }) => {
  const back = ids[0] ?? 'group';
  const front = ids[1] ?? back;
  const stackSize = Math.round(size * 0.62);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className={cn('absolute rounded-full flex items-center justify-center text-white font-bold ring-2 ring-surface', pickAvatarColor(back))}
        style={{ width: stackSize, height: stackSize, left: 0, top: size * 0.06, fontSize: stackSize * 0.4 }}
      >
        {initialsFor(back)}
      </div>
      <div
        className={cn('absolute rounded-full flex items-center justify-center text-white font-bold ring-2 ring-surface', pickAvatarColor(front))}
        style={{ width: stackSize, height: stackSize, right: 0, bottom: 0, fontSize: stackSize * 0.4 }}
      >
        {initialsFor(front)}
      </div>
    </div>
  );
};

/* ── Quick-action row (idle layer) ────────────────────────────────────── */

interface QuickAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

/* ── Dialog ─────────────────────────────────────────────────────────── */

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  payload: SharePayload | null;
  /** Optional title override. Defaults to the payload's own name/title. */
  title?: string;
  /** Used to build the external share URL for Copy link / Message / Email / More. */
  externalShareUrl?: string;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ open, onClose, payload, title, externalShareUrl }) => {
  const { user } = useAuth();
  const { conversations, shareToTargets } = useChat();
  const { showToast } = useToast();
  const { phoneMode } = useSettings();
  const { openAddToListModal } = useLists();
  const askAssistantAbout = useAskAssistantAbout();

  const [friends, setFriends] = useState<FriendTarget[]>([]);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle');

  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, sheetScrollRef);

  // Reset transient state on open.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setMessage('');
    setSelected(new Set());
    setPhase('idle');
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
        stackIds: c.participantIds.slice(0, 2),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  const allTargets: ShareTarget[] = useMemo(() => [...friends, ...groupTargets], [friends, groupTargets]);

  // Matches the target's OWN name only (friend's display name, or the
  // group's name) — not individual group members' names. Resolving every
  // group participant's profile just to make them searchable isn't a path
  // any code takes today; scoping search to target names is a deliberate
  // simplification, not an oversight.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTargets;
    return allTargets.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTargets, search]);

  const toggle = (key: string) => {
    if (phase !== 'idle') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const header = payload ? headerFor(payload) : null;
  const computedTitle = title ?? header?.title ?? 'Share';

  const shareUrl = externalShareUrl || (typeof window !== 'undefined' ? window.location.href : '');

  const onSend = () => {
    if (!payload || selected.size === 0 || phase !== 'idle') return;
    const targets: { conversationId?: string; friendId?: string }[] = [];
    for (const t of allTargets) {
      if (!selected.has(t.key)) continue;
      if (t.kind === 'friend') targets.push({ friendId: t.friendId });
      else targets.push({ conversationId: t.conversationId });
    }
    if (targets.length === 0) return;
    setPhase('sending');
    const sentTo = shareToTargets(targets, { ...payload, text: composeShareMessage(message, payload.text) });
    if (sentTo.length > 0) {
      setPhase('sent');
      window.setTimeout(() => onClose(), 900);
    } else {
      setPhase('idle');
      showToast("Couldn't send");
    }
  };

  /* ── Quick actions ────────────────────────────────────────────────── */

  const onCopyLink = async () => {
    const ok = await copyToClipboard(shareUrl);
    showToast(ok ? 'Link copied' : "Couldn't copy link");
  };

  const onMessage = () => {
    const body = encodeURIComponent([computedTitle, shareUrl].filter(Boolean).join(' — '));
    if (typeof window === 'undefined') return;
    // sms: has no standardised query syntax — `&body=` is what iOS Messages
    // honours; Android's Messages app accepts `?body=` instead. This app is
    // iOS-first (Capacitor/native-share.ts's whole reason for existing is
    // the WKWebView share quirks), so `&` is the primary target; `More`
    // (the OS share sheet) is the reliable fallback for anything this
    // doesn't handle right.
    window.location.href = `sms:&body=${body}`;
  };

  const onEmail = () => {
    const subject = encodeURIComponent(computedTitle);
    const body = encodeURIComponent(shareUrl);
    if (typeof window === 'undefined') return;
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const onAddToList = () => {
    if (!payload?.sharedRestaurant) return;
    const r = payload.sharedRestaurant;
    openAddToListModal(r.restaurantId, { id: r.restaurantId, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address });
    onClose();
  };

  const onMore = async () => {
    if (!payload) return;
    const text = payload.text || payload.sharedReel?.caption || payload.sharedPost?.caption || undefined;
    const result = await shareExternally({ title: computedTitle, text, url: shareUrl });
    if (result === 'copied') showToast('Link copied');
    else if (result === 'unsupported') showToast('Sharing not supported on this device');
  };

  const onAskAI = () => {
    const attachment = buildAssistantAttachment(payload);
    if (!attachment) return;
    askAssistantAbout(attachment);
    onClose();
  };

  const quickActions: QuickAction[] = [
    ...(payload && buildAssistantAttachment(payload) ? [{ key: 'ai', label: 'Ask AI', icon: <Sparkles size={19} />, onClick: onAskAI }] : []),
    { key: 'copy', label: 'Copy link', icon: <Link2 size={19} />, onClick: onCopyLink },
    { key: 'message', label: 'Message', icon: <MessageCircle size={19} />, onClick: onMessage },
    { key: 'email', label: 'Email', icon: <Mail size={19} />, onClick: onEmail },
    ...(payload?.sharedRestaurant ? [{ key: 'list', label: 'Add to list', icon: <ListPlus size={19} />, onClick: onAddToList }] : []),
    { key: 'more', label: 'More', icon: <MoreHorizontal size={19} />, onClick: onMore },
  ];

  const active = selected.size > 0;
  const done = phase === 'sent';

  return (
    <AnimatePresence>
      {open && payload && header && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/55 backdrop-blur-sm z-[110] flex justify-center',
            phoneMode ? 'items-end' : 'items-end sm:items-center',
          )}
          onClick={onClose}
        >
          <motion.div
            ref={sheetRef as React.RefObject<HTMLDivElement>}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface w-full overflow-hidden flex flex-col kb-pad',
              phoneMode
                // A share sheet is a short errand — pick someone, or tap a
                // way to send it. At 88% it stood nearly full-screen with a
                // long empty stretch between the search field and the row
                // of actions, which read as a page rather than a prompt.
                ? 'h-[62%] rounded-t-3xl'
                : 'h-[88%] sm:max-w-md sm:max-h-[80vh] sm:h-auto rounded-t-3xl sm:rounded-3xl',
            )}
          >
            {/* Header — cover + title + subtitle, one block (the old
                separate title-bar + preview chip collapse into this). */}
            <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-shrink-0">
              <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-on-surface/[0.06] flex items-center justify-center">
                {header.cover ? (
                  <img src={header.cover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : header.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-serif font-bold text-[16px] leading-tight truncate">{computedTitle}</h2>
                {header.subtitle && <p className="text-[12.5px] text-on-surface/50 truncate mt-0.5">{header.subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65 flex-shrink-0"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-10">
                <Search size={14} className="text-on-surface/45 flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people and groups"
                  className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                />
              </div>
            </div>

            {/* Target grid */}
            <div ref={sheetScrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
              {allTargets.length === 0 ? (
                <div className="text-center py-10 px-6">
                  <Users size={28} className="mx-auto text-on-surface/15 mb-2" />
                  <p className="text-sm text-on-surface/45">No friends yet.</p>
                  <p className="text-[12px] text-on-surface/30 mt-1">
                    Find people to follow, then come back here to share.
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 text-sm text-on-surface/45">No matches.</div>
              ) : (
                <>
                  <p className="px-1 pb-2.5 text-[10.5px] font-bold tracking-[0.09em] uppercase text-on-surface/40">
                    {search.trim() ? `${filtered.length} result${filtered.length === 1 ? '' : 's'}` : 'Suggested'}
                  </p>
                  <div className="grid grid-cols-4 gap-x-1.5 gap-y-4">
                    {filtered.map((t) => {
                      const isSelected = selected.has(t.key);
                      const isSent = done && isSelected;
                      const on = isSelected || isSent;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => toggle(t.key)}
                          disabled={phase !== 'idle'}
                          className="flex flex-col items-center gap-1.5 pt-0.5"
                        >
                          <span
                            className="relative rounded-full transition-transform"
                            style={{
                              boxShadow: on ? '0 0 0 2.5px var(--color-primary)' : '0 0 0 0 transparent',
                              transform: on ? 'scale(0.9)' : 'scale(1)',
                              transition: 'box-shadow 220ms var(--ease-out-strong), transform 260ms cubic-bezier(0.17,0.89,0.24,1)',
                            }}
                          >
                            {t.kind === 'friend' ? (
                              <div className={cn('w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-[17px]', t.avatarColor)}>
                                {t.initials}
                              </div>
                            ) : (
                              <AvatarStack ids={t.stackIds} size={56} />
                            )}
                            <span
                              className="absolute -right-0.5 -bottom-0.5 w-[21px] h-[21px] rounded-full bg-primary text-on-primary flex items-center justify-center ring-[2.5px] ring-surface transition-all"
                              style={{ opacity: on ? 1 : 0, transform: on ? 'scale(1)' : 'scale(0.3)' }}
                              aria-hidden
                            >
                              <Check size={12} strokeWidth={3.4} />
                            </span>
                          </span>
                          <span
                            className={cn('text-[12px] max-w-[80px] truncate', on ? 'font-bold text-primary' : 'font-semibold text-on-surface')}
                          >
                            {t.kind === 'friend' ? t.name.split(' ')[0] : t.name}
                          </span>
                          <span className={cn('text-[10.5px] font-semibold -mt-1 h-3 leading-3', isSent ? 'text-primary' : 'text-on-surface/40')}>
                            {isSent ? 'Sent' : t.kind === 'group' ? `${t.participantCount} people` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Bottom action area — idle quick-actions vs. active compose,
                cross-fading on selection like the reference design. */}
            <div className="relative flex-shrink-0 border-t border-on-surface/[0.06] bg-surface" style={{ height: 106 }}>
              <div
                className="absolute inset-0 flex items-center gap-5 px-5 overflow-x-auto no-scrollbar transition-[opacity,transform] duration-200"
                style={{
                  opacity: active ? 0 : 1,
                  transform: active ? 'translateY(14px)' : 'translateY(0)',
                  pointerEvents: active ? 'none' : 'auto',
                }}
                aria-hidden={active || undefined}
              >
                {quickActions.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={a.onClick}
                    className="flex flex-col items-center gap-1.5 flex-shrink-0 w-[58px] active:scale-95 transition-transform"
                  >
                    <span className="w-[46px] h-[46px] rounded-full bg-on-surface/[0.05] border border-on-surface/[0.07] text-on-surface/70 flex items-center justify-center">
                      {a.icon}
                    </span>
                    <span className="text-[10.5px] font-semibold text-on-surface/60 text-center leading-tight">{a.label}</span>
                  </button>
                ))}
              </div>

              <div
                className="absolute inset-0 flex items-center gap-2.5 px-5 transition-[opacity,transform] duration-200"
                style={{
                  opacity: active ? 1 : 0,
                  transform: active ? 'translateY(0)' : 'translateY(14px)',
                  pointerEvents: active ? 'auto' : 'none',
                }}
                aria-hidden={!active || undefined}
              >
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a message…"
                  maxLength={280}
                  disabled={phase !== 'idle'}
                  className="flex-1 min-w-0 h-11 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!active || phase === 'sending'}
                  className={cn(
                    'relative flex-shrink-0 h-11 px-5 rounded-full text-[14.5px] font-bold text-white inline-flex items-center justify-center gap-2 transition-colors',
                    done ? 'bg-emerald-600' : 'bg-primary',
                  )}
                >
                  {phase === 'sending' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : done ? (
                    <Check size={16} strokeWidth={3} />
                  ) : (
                    <Send size={15} />
                  )}
                  {done ? 'Sent' : phase === 'sending' ? 'Sending…' : selected.size > 1 ? `Send to ${selected.size}` : 'Send'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
