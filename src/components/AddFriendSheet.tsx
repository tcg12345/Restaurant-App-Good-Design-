import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, UserPlus, Check, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import {
  searchUsersByUsername, sendFriendRequest, getFriends, getSentRequestIds,
  getPendingRequests, getFollowerIds, acceptFriendRequest, followPublicAccount,
  type UserProfile,
} from '../lib/supabase-community';

const AVATAR_PALETTE = [
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-sky-100', text: 'text-sky-700' },
  { bg: 'bg-violet-100', text: 'text-violet-700' },
  { bg: 'bg-teal-100', text: 'text-teal-700' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
];
const avatarColor = (uid: string) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};
const initialOf = (name: string) => (name || 'U').trim().charAt(0).toUpperCase() || 'U';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Directional relationship per user, drives the trailing control:
//   following  → I follow them              → "Following"
//   requested  → I sent them a pending req  → "Requested"
//   incoming   → they sent ME a pending req → "Accept"
//   followback → they follow me, I don't    → "Follow back"
//   (absent)   → no edge                    → "Add"
type Relationship = 'following' | 'requested' | 'incoming' | 'followback';

export const AddFriendSheet: React.FC<Props> = ({ open, onClose }) => {
  const { user, refreshPendingRequests } = useAuth();
  const { phoneMode } = useSettings();
  const navigate = useNavigate();
  const userId = user?.id ?? null;
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, listScrollRef);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Relationship per user id, loaded on open and updated as actions happen.
  const [relationships, setRelationships] = useState<Record<string, Relationship>>({});
  // Incoming request id per requester, so "Accept" can resolve their request.
  const [incomingReqIds, setIncomingReqIds] = useState<Record<string, string>>({});

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults([]); setPending(new Set());
    const t = setTimeout(() => inputRef.current?.focus(), phoneMode ? 280 : 200);
    return () => clearTimeout(t);
  }, [open, phoneMode]);

  // Load all directional edges when the sheet opens so each result shows the
  // right state. Precedence: I follow them > I requested them > they requested
  // me (Accept) > they follow me (Follow back).
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      const [following, sentIds, incoming, followerIds] = await Promise.all([
        getFriends(userId),
        getSentRequestIds(userId),
        getPendingRequests(userId),
        getFollowerIds(userId),
      ]);
      if (cancelled) return;
      const map: Record<string, Relationship> = {};
      following.forEach((f) => { map[f.friend_id] = 'following'; });
      sentIds.forEach((id) => { if (!map[id]) map[id] = 'requested'; });
      const inc: Record<string, string> = {};
      incoming.forEach((r) => { if (!map[r.user_id]) map[r.user_id] = 'incoming'; inc[r.user_id] = r.id; });
      followerIds.forEach((id) => { if (!map[id]) map[id] = 'followback'; });
      setRelationships(map);
      setIncomingReqIds(inc);
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  // Debounced search — fires 300ms after the user stops typing. Empty
  // query lists "suggested" users (the function returns the first 20
  // profiles excluding the current user).
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      const res = await searchUsersByUsername(query, userId);
      if (!cancelled) {
        setResults(res);
        setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); setLoading(false); };
  }, [query, open, userId]);

  // Follow someone — the "Add" / "Follow back" action. Respects their privacy:
  // public/expert accounts follow immediately; private accounts get a pending
  // request they must approve.
  const followUser = useCallback(async (target: UserProfile) => {
    if (!userId || pending.has(target.user_id)) return;
    const rel = relationships[target.user_id];
    if (rel === 'following' || rel === 'requested') return;
    setPending((prev) => new Set(prev).add(target.user_id));
    const immediate = !!(target.is_public || target.is_verified);
    const ok = immediate
      ? await followPublicAccount(userId, target.user_id)
      : await sendFriendRequest(userId, target.user_id);
    setPending((prev) => { const next = new Set(prev); next.delete(target.user_id); return next; });
    if (ok) {
      setRelationships((prev) => ({ ...prev, [target.user_id]: immediate ? 'following' : 'requested' }));
    } else {
      alert("Couldn't send that request. Try again.");
    }
  }, [userId, pending, relationships]);

  // Accept an incoming request (one-directional): they now follow you, and the
  // control becomes "Follow back" so you can make it mutual.
  const handleAccept = useCallback(async (target: UserProfile) => {
    const reqId = incomingReqIds[target.user_id];
    if (!userId || !reqId || pending.has(target.user_id)) return;
    setPending((prev) => new Set(prev).add(target.user_id));
    const ok = await acceptFriendRequest(reqId);
    setPending((prev) => { const next = new Set(prev); next.delete(target.user_id); return next; });
    if (ok) {
      setRelationships((prev) => ({ ...prev, [target.user_id]: 'followback' }));
      void refreshPendingRequests();
    } else {
      alert("Couldn't accept that request. Try again.");
    }
  }, [userId, incomingReqIds, pending, refreshPendingRequests]);

  // Tapping a result's avatar/name opens that user's profile.
  const openProfile = useCallback((target: UserProfile) => {
    if (!target.username) return;
    onClose();
    navigate(`/user/${target.username}`);
  }, [navigate, onClose]);

  const hasQuery = query.trim().length > 0;
  const emptyCopy = useMemo(() => {
    if (loading) return null;
    if (results.length > 0) return null;
    if (hasQuery) return 'No one matches that handle.';
    return 'Start typing a username to find someone.';
  }, [loading, results.length, hasQuery]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-[60]',
            phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md',
            !phoneMode && 'flex items-start justify-center pt-[12vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            ref={phoneMode ? (sheetRef as React.RefObject<HTMLDivElement>) : undefined}
            {...(phoneMode
              ? {
                  initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' },
                  transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const },
                  ...dragProps,
                }
              : {
                  initial: { opacity: 0, scale: 0.96, y: -8 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.97, y: -6 },
                  transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex flex-col overflow-hidden bg-surface',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl h-[88vh]'
                : 'w-full max-w-md rounded-3xl max-h-[70vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {phoneMode && (
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}
            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-2 pb-3' : 'px-5 pt-5 pb-3',
            )}>
              <h3 className="font-serif text-[20px] font-bold text-on-surface">Add a friend</h3>
              <button
                type="button"
                onClick={onClose}
                className="hit-44 w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/[0.10] transition-colors"
                aria-label="Close"
              >
                <X size={15} className="text-on-surface/60" />
              </button>
            </div>

            <div className="px-5 pb-3 flex-shrink-0">
              <div className="relative">
                <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by username…"
                  className="w-full h-11 pl-10 pr-9 rounded-2xl bg-on-surface/[0.05] text-[14px] placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-on-surface/[0.08]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-on-surface/[0.08] flex items-center justify-center text-on-surface/55 hover:bg-on-surface/[0.12]"
                    aria-label="Clear"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            <div ref={listScrollRef} className="flex-1 overflow-y-auto px-5 pb-5">
              {loading && results.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-on-surface/40 text-sm">
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Searching…
                </div>
              ) : emptyCopy ? (
                <p className="text-center text-[13px] text-on-surface/45 py-10">{emptyCopy}</p>
              ) : (
                <ul className="space-y-1">
                  {results.map((p) => {
                    const color = avatarColor(p.user_id);
                    const initial = initialOf(p.display_name || p.username);
                    const isPending = pending.has(p.user_id);
                    const status = relationships[p.user_id];
                    return (
                      <li key={p.user_id} className="flex items-center gap-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => openProfile(p)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left group"
                        >
                          <div className={cn('w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}>
                            <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initial}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-bold text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
                              {p.display_name || p.username || 'User'}
                            </p>
                            <p className="text-[12px] text-on-surface/55 truncate mt-0.5">@{p.username}</p>
                          </div>
                        </button>
                        {status === 'following' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55 flex-shrink-0">
                            <Check size={13} /> Following
                          </span>
                        ) : status === 'requested' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55 flex-shrink-0">
                            <Check size={13} /> Requested
                          </span>
                        ) : status === 'incoming' ? (
                          <button
                            type="button"
                            onClick={() => handleAccept(p)}
                            disabled={isPending}
                            className="hit-44-y inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-on-primary text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
                          >
                            {isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} strokeWidth={2.6} />}
                            Accept
                          </button>
                        ) : status === 'followback' ? (
                          <button
                            type="button"
                            onClick={() => followUser(p)}
                            disabled={isPending}
                            className="hit-44-y inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-on-primary text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
                          >
                            {isPending ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />}
                            Follow back
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => followUser(p)}
                            disabled={isPending}
                            className="hit-44-y inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-on-primary text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0"
                          >
                            {isPending ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />}
                            Add
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
