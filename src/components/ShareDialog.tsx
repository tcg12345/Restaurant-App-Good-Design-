import { trackRestaurant } from '../lib/analytics';
import { composeShareMessage } from '../lib/share-message';
/**
 * ShareDialog — single share popup used for reels, posts, restaurants,
 * recipes, and guides.
 *
 * Compact glass presentation with recipient selection, search, and an
 * optional message. ShareDialogSurface owns the accessible overlay;
 * this component keeps recipient lookup and existing share actions.
 *
 * The caller passes a `payload` describing what's being shared; the header
 * derives its cover/title/subtitle from whichever `Shared*` field is set.
 * Ask AI pins the same payload to the AI assistant (see
 * lib/share-assistant-attachment.ts) so the user can ask about it — the
 * same mechanism RestaurantDetailMobile / RecipePage use for their own
 * "ask about this" buttons, just reached from the share sheet instead.
 *
 * Bottom sheet on phone, centered card on desktop — both share the same
 * recipient and action controls.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShareDialogSurface } from './ShareDialogSurface';
import { AnimatePresence } from 'motion/react';
import {
  Link2, MessageCircle, Mail,
  ListPlus, MoreHorizontal, Sparkles, MapPin, ChefHat, Film, Image as ImageIcon, BookOpen,
} from 'lucide-react';
import { useChat, type SharePayload } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useAskAssistantAbout } from '../contexts/AssistantContext';
import { getFriends, getProfilesByIds } from '../lib/supabase-community';
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

export interface FriendTarget {
  kind: 'friend';
  key: string;
  friendId: string;
  name: string;
  avatarColor: string;
  avatarUrl?: string | null;
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
export type ShareTarget = FriendTarget | GroupTarget;

/* ── Quick-action row (idle layer) ────────────────────────────────────── */

export interface QuickAction {
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

  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sentTimer.current) clearTimeout(sentTimer.current); }, [open]);

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
              avatarUrl: p?.avatar_url,
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
      if (payload.sharedRestaurant) trackRestaurant('restaurant_shared', payload.sharedRestaurant.restaurantId, payload.sharedRestaurant.name, { outcome: 'queued', source: 'in_app' });
      sentTimer.current = window.setTimeout(() => onClose(), 900);
    } else {
      setPhase('idle');
      showToast("Couldn't send");
    }
  };

  /* ── Quick actions ────────────────────────────────────────────────── */

  const onCopyLink = async () => {
    const ok = await copyToClipboard(shareUrl);
    if (ok && payload?.sharedRestaurant) trackRestaurant('restaurant_shared', payload.sharedRestaurant.restaurantId, payload.sharedRestaurant.name, { outcome: 'copied' });
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
    if ((result === 'shared' || result === 'copied') && payload.sharedRestaurant) trackRestaurant('restaurant_shared', payload.sharedRestaurant.restaurantId, payload.sharedRestaurant.name, { outcome: result, source: 'external' });
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
    { key: 'more', label: 'Share…', icon: <MoreHorizontal size={19} />, onClick: onMore },
  ];

  return createPortal(<AnimatePresence>
    {open && payload && header && <ShareDialogSurface
      phoneMode={phoneMode} header={{ ...header, title: computedTitle }} targets={filtered}
      hasTargets={allTargets.length > 0} search={search} onSearch={setSearch}
      selected={selected} onToggle={toggle} message={message} onMessage={setMessage}
      phase={phase} onSend={onSend} onClose={onClose} actions={quickActions}
    />}
  </AnimatePresence>, document.body);
};
