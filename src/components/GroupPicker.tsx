/**
 * "Who's eating?" — the member picker behind group recommendations.
 *
 * Mutual friends only. The feature needs each person's rating history to
 * say anything about their taste, and a mutual follow is the app's own
 * line for "we can see each other" — inferring a stranger's dinner
 * opinion from a one-way follow is not a thing to do quietly.
 *
 * Capped at MAX_MEMBERS: past a handful the fairness term flattens (one
 * more person can only lower the minimum), the per-member fit strip stops
 * fitting on a row, and the honest answer stops being a restaurant.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Loader2, Users, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';
import { avatarHue } from '../lib/avatar';
import { useBottomSheet } from '../lib/useBottomSheet';
import { getFriends, getFollowerIds, getProfilesByIds, type UserProfile } from '../lib/supabase-community';

export const MAX_MEMBERS = 5; // plus you

export const GroupPicker: React.FC<{
  open: boolean;
  onClose: () => void;
  userId: string | null;
  /** Currently chosen friends (you are never in this list). */
  selected: UserProfile[];
  onDone: (people: UserProfile[]) => void;
}> = ({ open, onClose, userId, selected, onDone }) => {
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Record<string, UserProfile>>({});
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, scrollRef);

  // Re-seed from the caller every time it opens: closing without "Done"
  // should leave the group exactly as it was.
  useEffect(() => {
    if (!open) return;
    setPicked(Object.fromEntries(selected.map((p) => [p.user_id, p])));
  }, [open, selected]);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [following, followers] = await Promise.all([getFriends(userId), getFollowerIds(userId)]);
      if (cancelled) return;
      const followerSet = new Set(followers);
      const mutualIds = following.filter((f) => followerSet.has(f.friend_id)).map((f) => f.friend_id);
      const profs = mutualIds.length > 0 ? await getProfilesByIds(mutualIds) : {};
      if (cancelled) return;
      setFriends(Object.values(profs));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  const count = Object.keys(picked).length;
  const full = count >= MAX_MEMBERS;
  const sorted = useMemo(
    () => [...friends].sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username)),
    [friends],
  );

  const toggle = (p: UserProfile) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[p.user_id]) delete next[p.user_id];
      else if (!full) next[p.user_id] = p;
      return next;
    });
  };

  /* A real motion.div: useBottomSheet's dragProps are Framer drag props and
     are inert on a plain element — the sub-sheet could not be dragged and
     popped in with no motion. Same drawer curve as the sheet beneath it. */
  return (
    <AnimatePresence>
      {open && (
    <motion.div
      key="group-picker"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[220] flex items-end justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <motion.div
        ref={sheetRef as React.RefObject<HTMLDivElement>}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        {...dragProps}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[520px] flex-col rounded-t-[28px] bg-surface shadow-[0_-16px_48px_rgba(0,0,0,0.35)]"
        style={{ height: '72%', paddingBottom: 'var(--kb-height, 0px)' }}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="h-[5px] w-10 rounded-full bg-on-surface/20" />
        </div>
        <div className="flex items-center gap-3 px-5 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-[19px] font-bold tracking-[-0.02em] text-on-surface">Who&rsquo;s eating?</h3>
            <p className="mt-0.5 text-[12.5px] text-on-surface/50">
              {count > 0 ? `You + ${count}` : 'Pick the friends you’re going with'}
              {full && ' · that’s the max'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-on-surface/[0.06] text-on-surface/60"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5">
          {loading && friends.length === 0 ? (
            <div className="flex justify-center py-12"><Loader2 size={18} className="animate-spin text-on-surface/30" /></div>
          ) : sorted.length === 0 ? (
            <div className="py-12 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-on-surface/[0.05] text-on-surface/30"><Users size={20} /></span>
              <p className="mt-3 font-serif text-[16px] font-bold text-on-surface">No mutual friends yet</p>
              <p className="mx-auto mt-1.5 max-w-[280px] text-[12.5px] leading-snug text-on-surface/45">
                Group picks read everyone&rsquo;s ratings, so they need friends who follow you back.
              </p>
            </div>
          ) : (
            <ul>
              {sorted.map((p) => {
                const on = !!picked[p.user_id];
                const hue = avatarHue(p.user_id);
                const name = p.display_name || p.username || 'Friend';
                return (
                  <li key={p.user_id}>
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      disabled={!on && full}
                      className={cn(
                        'flex w-full items-center gap-3 py-2.5 text-left transition-opacity',
                        !on && full && 'opacity-40',
                      )}
                    >
                      <Avatar
                        src={p.avatar_url}
                        name={name}
                        size={44}
                        fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-[15px] font-bold leading-tight tracking-[-0.02em] text-on-surface">{name}</span>
                        {p.username && <span className="mt-[3px] block truncate text-[12px] text-on-surface/45">@{p.username}</span>}
                      </span>
                      <span className={cn(
                        'grid h-6 w-6 flex-none place-items-center rounded-full border transition-colors',
                        on ? 'border-primary bg-primary text-white' : 'border-on-surface/25 text-transparent',
                      )}>
                        <Check size={13} strokeWidth={3} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-on-surface/[0.07] px-5 pt-3 pb-safe-4">
          {count > 0 && (
            <button
              type="button"
              onClick={() => { onDone([]); onClose(); }}
              className="text-[13px] font-bold text-on-surface/50 active:text-on-surface"
            >
              Just me
            </button>
          )}
          <button
            type="button"
            onClick={() => { onDone(Object.values(picked)); onClose(); }}
            className="ml-auto h-11 flex-1 rounded-full bg-primary px-5 text-[14px] font-bold text-white active:opacity-90 disabled:opacity-50"
            disabled={count === 0}
          >
            {count === 0 ? 'Pick someone' : `Find a place for ${count + 1}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
};
