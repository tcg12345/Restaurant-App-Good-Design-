/**
 * ShareReelDialog — popup for sharing a reel.
 *
 * Two ways to share, both reachable from the same dialog:
 *   1. In-app: tap a conversation to send the reel as a message.
 *   2. External: tap "Share via…" to invoke the native OS share sheet
 *      (`navigator.share`); falls back to copy-link when that's not
 *      available (most desktops outside macOS Safari).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Search, MessageCircle, Users, ChevronRight, Film, ExternalLink, Loader2, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { useChat, type SharedReel } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useSettings } from '../contexts/SettingsContext';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';

interface ShareReelDialogProps {
  open: boolean;
  reel: SharedReel | null;
  onClose: () => void;
}

export const ShareReelDialog: React.FC<ShareReelDialogProps> = ({ open, reel, onClose }) => {
  const { user } = useAuth();
  const { conversations, sendMessage } = useChat();
  const { showToast } = useToast();
  const { phoneMode } = useSettings();

  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [search, setSearch] = useState('');
  const [optionalText, setOptionalText] = useState('');
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  // Reset transient state whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setOptionalText('');
    setSentTo(new Set());
  }, [open]);

  // Load display-name profiles for the "other" participant of every direct
  // conversation so the picker shows real names instead of "Direct Message".
  useEffect(() => {
    if (!open || !user?.id) return;
    const otherIds = new Set<string>();
    for (const c of conversations) {
      if (!c.isGroup) {
        c.participantIds.forEach((p) => { if (p !== user.id) otherIds.add(p); });
      }
    }
    if (otherIds.size === 0) return;
    let cancelled = false;
    getProfilesByIds(Array.from(otherIds)).then((p) => {
      if (!cancelled) setProfiles(p);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, user?.id, conversations]);

  const conversationName = (convId: string): string => {
    const c = conversations.find((x) => x.id === convId);
    if (!c) return 'Chat';
    if (c.isGroup) return c.name || 'Group Chat';
    const otherId = c.participantIds.find((p) => p !== user?.id);
    if (!otherId) return 'Direct Message';
    return profiles[otherId]?.display_name || profiles[otherId]?.username || 'Direct Message';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => conversationName(c.id).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, profiles, user?.id, search]);

  const onSendTo = (convId: string) => {
    if (!reel || sentTo.has(convId)) return;
    sendMessage(convId, optionalText.trim(), undefined, undefined, reel);
    setSentTo((prev) => new Set(prev).add(convId));
    showToast('Reel shared');
  };

  const onShareExternally = async () => {
    if (!reel) return;
    const url = `${window.location.origin}/reels?kind=${reel.kind}#${reel.reelId}`;
    const shareData = {
      title: reel.attachedTitle ? `${reel.authorUsername}: ${reel.attachedTitle}` : "Check out this reel",
      text: reel.caption || undefined,
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
      // User cancelled the native sheet — silent. Anything else surfaces.
      if (err instanceof Error && err.name !== 'AbortError') {
        showToast("Couldn't open the share sheet");
      }
    }
  };

  return (
    <AnimatePresence>
      {open && reel && (
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
            <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 border-b border-on-surface/[0.06] flex-shrink-0">
              <div className="min-w-0">
                <h2 className="font-serif font-bold text-lg leading-tight">Share reel</h2>
                <p className="text-[12px] text-on-surface/45 truncate mt-0.5">
                  by @{reel.authorUsername}
                  {reel.attachedTitle && <span className="text-on-surface/30"> · {reel.attachedTitle}</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65 flex-shrink-0"
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {/* Reel preview chip */}
            <div className="px-5 pt-3 pb-1 flex-shrink-0">
              <div className="flex items-center gap-3 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] p-2">
                <div className={cn('w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br', reel.bgGradient || 'from-stone-800 to-stone-900')}>
                  {reel.videoUrl && (
                    <video
                      src={reel.videoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate">{reel.attachedTitle || 'Untitled'}</p>
                  {reel.caption && (
                    <p className="text-[11px] text-on-surface/50 truncate italic">"{reel.caption}"</p>
                  )}
                </div>
                <Film size={14} className="text-on-surface/30 flex-shrink-0 mr-1" />
              </div>
            </div>

            {/* Optional message */}
            <div className="px-5 pt-3 flex-shrink-0">
              <input
                value={optionalText}
                onChange={(e) => setOptionalText(e.target.value)}
                placeholder="Say something (optional)"
                maxLength={280}
                className="w-full h-10 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40"
              />
            </div>

            {/* Search */}
            <div className="px-5 pt-2 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-10">
                <Search size={14} className="text-on-surface/45 flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search chats…"
                  className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                />
              </div>
            </div>

            {/* Conversation list */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
              {filtered.length === 0 ? (
                <div className="text-center py-10 px-6">
                  <MessageCircle size={28} className="mx-auto text-on-surface/15 mb-2" />
                  <p className="text-sm text-on-surface/45">
                    {conversations.length === 0 ? 'No conversations yet.' : 'No matches.'}
                  </p>
                  {conversations.length === 0 && (
                    <p className="text-[12px] text-on-surface/30 mt-1">
                      Start a chat in Messages first, then share from here.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="space-y-1">
                  {filtered.map((conv) => {
                    const sent = sentTo.has(conv.id);
                    const name = conversationName(conv.id);
                    return (
                      <li key={conv.id}>
                        <button
                          type="button"
                          onClick={() => onSendTo(conv.id)}
                          disabled={sent}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                            sent ? 'bg-emerald-50' : 'hover:bg-on-surface/[0.05]',
                          )}
                        >
                          <div className={cn(
                            'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
                            conv.isGroup ? 'bg-primary/10 text-primary' : 'bg-on-surface/[0.07] text-on-surface',
                          )}>
                            {conv.isGroup ? <Users size={15} /> : name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{name}</p>
                            <p className="text-[11px] text-on-surface/40 truncate">
                              {conv.isGroup ? `${conv.participantIds.length} people` : 'Direct message'}
                            </p>
                          </div>
                          {sent ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 text-[12px] font-bold">
                              <Check size={14} />
                              Sent
                            </span>
                          ) : (
                            <Send size={14} className="text-on-surface/30 flex-shrink-0" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer — external share button */}
            <div className="border-t border-on-surface/[0.06] px-5 py-3 bg-surface flex-shrink-0">
              <button
                type="button"
                onClick={onShareExternally}
                className="w-full h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-on-surface/10 transition-colors"
              >
                <ExternalLink size={15} />
                Share via…
                <ChevronRight size={14} className="text-on-surface/40" />
              </button>
              <p className="text-[11px] text-on-surface/35 text-center mt-2">
                Opens the system share sheet (Messages, AirDrop, Mail, etc.) or copies the link.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
