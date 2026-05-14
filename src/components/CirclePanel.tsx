/**
 * Friends panel — Instagram-style slide-out on desktop, full page on
 * mobile. Three tabs: All (friends + experts + activity), Friends, Experts.
 *
 * Variants:
 *   - 'overlay'  → sticky-positioned panel anchored next to the desktop
 *                  sidebar with a slide-in animation + outside-click close.
 *   - 'page'     → renders inline as the body of the /circle route on
 *                  mobile, no animation, no close button.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Crown, Plus, Filter, MapPin, ChefHat } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import {
  getFriends, getProfilesByIds, getFriendActivity, getExpertProfiles,
  getUserRatings, getFollowCounts, followPublicAccount, removeFriend,
  type FriendInfo, type UserProfile, type CommunityRating,
} from '../lib/supabase-community';
import { ScoreBadge } from './ScoreBadge';

type Tab = 'all' | 'friends' | 'experts';

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
const timeAgoShort = (date: string): string => {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
};
const formatCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

interface CirclePanelProps {
  variant: 'overlay' | 'page';
  onClose?: () => void;
}

export const CirclePanel: React.FC<CirclePanelProps> = ({ variant, onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({});
  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [activityProfiles, setActivityProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  // Experts data
  const [experts, setExperts] = useState<UserProfile[]>([]);
  const [expertRatingCounts, setExpertRatingCounts] = useState<Record<string, number>>({});
  const [expertFollowerCounts, setExpertFollowerCounts] = useState<Record<string, number>>({});
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [expertsLoading, setExpertsLoading] = useState(false);

  // Load friends + activity once on mount.
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const friendList = await getFriends(userId);
      if (cancelled) return;
      setFriends(friendList);
      setFollowedIds(new Set(friendList.map((f) => f.friend_id)));

      if (friendList.length > 0) {
        const ids = friendList.map((f) => f.friend_id);
        const [profs, act] = await Promise.all([
          getProfilesByIds(ids),
          getFriendActivity(ids, 30),
        ]);
        if (cancelled) return;
        setFriendProfiles(profs);
        setActivity(act);
        const actIds = [...new Set(act.map((a) => a.user_id))];
        if (actIds.length > 0) {
          const actProf = await getProfilesByIds(actIds);
          if (!cancelled) setActivityProfiles(actProf);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Load experts (lazily after friends so the first paint is fast).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setExpertsLoading(true);
      const profiles = await getExpertProfiles();
      if (cancelled) return;
      setExperts(profiles);
      if (profiles.length > 0) {
        const results = await Promise.all(profiles.map(async (p) => {
          const [ratings, counts] = await Promise.all([
            getUserRatings(p.user_id),
            getFollowCounts(p.user_id),
          ]);
          return { id: p.user_id, ratingCount: ratings.length, followers: counts.followers };
        }));
        if (cancelled) return;
        const rc: Record<string, number> = {};
        const fc: Record<string, number> = {};
        results.forEach((r) => { rc[r.id] = r.ratingCount; fc[r.id] = r.followers; });
        setExpertRatingCounts(rc);
        setExpertFollowerCounts(fc);
      }
      if (!cancelled) setExpertsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleFollow = useCallback(async (expertId: string) => {
    if (!userId) return;
    const ok = await followPublicAccount(userId, expertId);
    if (ok) {
      setFollowedIds((prev) => new Set(prev).add(expertId));
      setExpertFollowerCounts((prev) => ({ ...prev, [expertId]: (prev[expertId] || 0) + 1 }));
    }
  }, [userId]);

  const handleUnfollow = useCallback(async (expertId: string) => {
    if (!userId) return;
    await removeFriend(userId, expertId);
    setFollowedIds((prev) => {
      const next = new Set(prev);
      next.delete(expertId);
      return next;
    });
    setExpertFollowerCounts((prev) => ({ ...prev, [expertId]: Math.max(0, (prev[expertId] || 0) - 1) }));
  }, [userId]);

  // Filter pipeline keyed on the search query — friends, experts, and
  // activity all share the same query so the user can type once and see
  // every matching surface narrow down.
  const q = searchQuery.trim().toLowerCase();
  const friendsFiltered = useMemo(() => {
    if (!q) return friends;
    return friends.filter((f) => {
      const p = friendProfiles[f.friend_id];
      const hay = `${p?.display_name || ''} ${p?.username || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [friends, friendProfiles, q]);

  const expertsFiltered = useMemo(() => {
    if (!q) return experts;
    return experts.filter((p) => {
      const hay = `${p.display_name || ''} ${p.username || ''} ${p.bio || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [experts, q]);

  const activityFiltered = useMemo(() => {
    if (!q) return activity;
    return activity.filter((a) => {
      const prof = activityProfiles[a.user_id];
      const hay = `${a.restaurant_name} ${a.cuisine || ''} ${a.address || ''} ${prof?.display_name || ''} ${prof?.username || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activity, activityProfiles, q]);

  const allCount = friends.length + experts.length;
  const friendsCount = friends.length;
  const expertsCount = experts.length;

  // ── Section renderers ─────────────────────────────────────────────
  const renderFriendsAvatars = () => (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/55">
          My friends <span className="text-on-surface/30 ml-1">· {friendsCount}</span>
        </h4>
        <button
          type="button"
          onClick={() => navigate('/circle/add')}
          className="text-[12px] font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1"
        >
          <Plus size={12} strokeWidth={2.6} />
          Invite
        </button>
      </div>
      {friendsFiltered.length === 0 ? (
        <p className="text-[12.5px] text-on-surface/40">No friends match this search.</p>
      ) : (
        <div className="flex items-start gap-4 overflow-x-auto pb-1 no-scrollbar">
          {/* Add tile */}
          <button
            type="button"
            onClick={() => navigate('/circle/add')}
            className="flex flex-col items-center gap-2 flex-shrink-0 group"
          >
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-primary/40 group-hover:border-primary/70 flex items-center justify-center text-primary transition-colors">
              <Plus size={20} strokeWidth={2.4} />
            </div>
            <span className="text-[11.5px] font-semibold text-primary">Add</span>
          </button>
          {friendsFiltered.slice(0, 8).map((f) => {
            const p = friendProfiles[f.friend_id];
            const color = avatarColor(f.friend_id);
            const initial = initialOf(p?.display_name || p?.username || '');
            // Mock "new activity" badge — counted from activity rows.
            const newCount = activity.filter((a) => a.user_id === f.friend_id).length;
            return (
              <Link
                key={f.friend_id}
                to={`/user/${p?.username || ''}`}
                className="flex flex-col items-center gap-2 flex-shrink-0 group"
              >
                <div className="relative">
                  <div className={cn('w-16 h-16 rounded-full flex items-center justify-center transition-transform group-hover:scale-[1.03]', color.bg)}>
                    <span className={cn('text-[24px] font-serif font-bold', color.text)}>{initial}</span>
                  </div>
                  {newCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1 rounded-full bg-primary text-white text-[10.5px] font-bold flex items-center justify-center ring-2 ring-surface">
                      {newCount > 9 ? '9+' : newCount}
                    </span>
                  )}
                </div>
                <span className="text-[12.5px] font-medium text-on-surface truncate max-w-[72px]">
                  {p?.display_name || p?.username || 'User'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );

  const renderExpertsList = (limited: boolean) => (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/55">
          Experts <span className="text-on-surface/30 ml-1">· {expertsCount}</span>
        </h4>
        {limited && expertsCount > 3 && (
          <button
            type="button"
            onClick={() => setTab('experts')}
            className="text-[12px] font-bold text-primary hover:text-primary/80"
          >
            See all
          </button>
        )}
      </div>
      {expertsLoading && expertsFiltered.length === 0 ? (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-on-surface/[0.05] animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded-full bg-on-surface/[0.05] animate-pulse" />
                <div className="h-2.5 w-44 rounded-full bg-on-surface/[0.05] animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      ) : expertsFiltered.length === 0 ? (
        <p className="text-[12.5px] text-on-surface/40">No experts match this search.</p>
      ) : (
        <ul className="space-y-3.5">
          {(limited ? expertsFiltered.slice(0, 3) : expertsFiltered).map((p) => {
            const color = avatarColor(p.user_id);
            const initial = initialOf(p.display_name || p.username);
            const ratingCount = expertRatingCounts[p.user_id] || 0;
            const followers = expertFollowerCounts[p.user_id] || 0;
            const following = followedIds.has(p.user_id);
            return (
              <li key={p.user_id} className="flex items-center gap-3">
                <Link to={`/user/${p.username || ''}`} className="relative flex-shrink-0">
                  <div className={cn('w-11 h-11 rounded-full flex items-center justify-center', color.bg)}>
                    <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initial}</span>
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center ring-2 ring-surface">
                    <Crown size={9} className="text-white" strokeWidth={2.4} />
                  </span>
                </Link>
                <Link to={`/user/${p.username || ''}`} className="flex-1 min-w-0 group">
                  <p className="text-[14px] font-bold text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
                    {p.display_name || p.username || 'Expert'}
                  </p>
                  {p.bio && (
                    <p className="text-[12px] text-on-surface/55 truncate mt-0.5">
                      {p.bio}
                    </p>
                  )}
                  <p className="text-[11px] text-on-surface/40 truncate mt-0.5">
                    {ratingCount} review{ratingCount === 1 ? '' : 's'} · {formatCount(followers)} follower{followers === 1 ? '' : 's'}
                  </p>
                </Link>
                {following ? (
                  <button
                    type="button"
                    onClick={() => handleUnfollow(p.user_id)}
                    className="inline-flex items-center gap-1 px-3 h-8 rounded-full border border-on-surface/15 text-[12px] font-semibold text-on-surface/70 hover:bg-on-surface/[0.04] transition-colors"
                  >
                    Following
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleFollow(p.user_id)}
                    className="px-3 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors"
                  >
                    Follow
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const renderActivity = () => (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/55">
          Activity <span className="text-on-surface/30 ml-1">· {activity.length}</span>
        </h4>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:text-primary/80"
        >
          <Filter size={12} />
          Filter
        </button>
      </div>
      {activityFiltered.length === 0 ? (
        <p className="text-[12.5px] text-on-surface/40">No friend activity yet.</p>
      ) : (
        <ul className="space-y-5">
          {activityFiltered.map((a) => {
            const prof = activityProfiles[a.user_id];
            const name = prof?.display_name || prof?.username || 'User';
            const username = prof?.username || '';
            const color = avatarColor(a.user_id);
            const initial = initialOf(name);
            const verb = 'rated';
            return (
              <li key={a.id}>
                {/* Header: who + when */}
                <div className="flex items-center gap-2.5 mb-2.5">
                  <Link to={`/user/${username}`} className="flex-shrink-0">
                    <div className={cn('w-9 h-9 rounded-full flex items-center justify-center', color.bg)}>
                      <span className={cn('text-[13px] font-serif font-bold', color.text)}>{initial}</span>
                    </div>
                  </Link>
                  <p className="text-[13px] text-on-surface/70 leading-tight">
                    <Link to={`/user/${username}`} className="font-bold text-on-surface hover:text-primary">{name}</Link>
                    <span className="font-normal text-on-surface/55"> {verb}</span>
                    <span className="text-on-surface/30 mx-1.5">·</span>
                    <span className="text-on-surface/45">{timeAgoShort(a.created_at)}</span>
                  </p>
                </div>

                {/* Restaurant card */}
                <Link
                  to={`/restaurant/${a.restaurant_id}`}
                  onClick={() => onClose?.()}
                  className="flex items-center gap-3 group"
                >
                  <div className="w-[68px] h-[68px] rounded-2xl bg-gradient-to-br from-stone-300 to-stone-500 flex-shrink-0 overflow-hidden">
                    {a.photo_url && (
                      <img src={a.photo_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-[15px] font-bold text-on-surface leading-tight line-clamp-1 group-hover:text-primary transition-colors">
                      {a.restaurant_name}
                    </p>
                    {(a.cuisine || a.price || a.address) && (
                      <p className="text-[11.5px] text-on-surface/55 truncate mt-0.5">
                        {[a.cuisine, a.price, a.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <ScoreBadge rating={Number(a.score)} size="sm" />
                </Link>

                {/* Optional notes — italic with a soft left rule */}
                {a.notes && (
                  <p className="mt-2.5 ml-[80px] text-[13px] italic text-on-surface/65 leading-relaxed line-clamp-2 border-l-2 border-on-surface/10 pl-3">
                    &ldquo;{a.notes}&rdquo;
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  // ── Body content ───────────────────────────────────────────────────
  const body = (
    <>
      {/* Header */}
      <div className="px-6 pt-6 pb-2 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-serif text-[28px] font-bold leading-tight text-on-surface">Friends</h2>
            <p className="text-[13px] text-on-surface/45 mt-1">Your circle&apos;s latest, in one place.</p>
          </div>
          {variant === 'overlay' && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-on-surface/[0.06] flex items-center justify-center text-on-surface/65 flex-shrink-0"
              aria-label="Close panel"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-6 pt-3 pb-3 flex-shrink-0">
        <div className="relative">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/35" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends, places, lists…"
            className="w-full h-11 pl-10 pr-9 rounded-2xl bg-on-surface/[0.05] text-[14px] placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-on-surface/[0.08]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-on-surface/[0.08] flex items-center justify-center text-on-surface/55 hover:bg-on-surface/[0.12]"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 flex-shrink-0 border-b border-on-surface/[0.06]">
        <div className="flex items-center gap-6">
          {([
            { value: 'all' as Tab, label: 'All', count: allCount },
            { value: 'friends' as Tab, label: 'Friends', count: friendsCount },
            { value: 'experts' as Tab, label: 'Experts', count: expertsCount },
          ]).map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn(
                  'relative pt-3 pb-3.5 inline-flex items-baseline gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] transition-colors',
                  active ? 'text-on-surface' : 'text-on-surface/45 hover:text-on-surface/75',
                )}
              >
                {t.label}
                <span className={cn('text-[12px] font-bold tabular-nums', active ? 'text-on-surface/70' : 'text-on-surface/35')}>
                  {t.count}
                </span>
                {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-on-surface rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body — scrolls */}
      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-on-surface/40 text-sm">Loading your circle…</div>
        ) : tab === 'all' ? (
          <div className="space-y-8">
            {renderFriendsAvatars()}
            {renderExpertsList(true)}
            {renderActivity()}
          </div>
        ) : tab === 'friends' ? (
          <div className="space-y-8">
            {renderFriendsAvatars()}
          </div>
        ) : (
          <div className="space-y-8">
            {renderExpertsList(false)}
          </div>
        )}
      </div>
    </>
  );

  // ── Variant wrappers ───────────────────────────────────────────────
  if (variant === 'page') {
    return (
      <div className="flex flex-col h-full min-h-screen bg-surface">
        {body}
      </div>
    );
  }

  // Overlay variant — slide-out from the left edge of the viewport,
  // covering the desktop sidebar. The backdrop in App.tsx handles
  // outside-click dismissal (sidebar area + main content).
  return (
    <motion.aside
      initial={{ x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -40, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className="fixed top-0 bottom-0 left-0 z-50 bg-surface border-r border-on-surface/[0.08] shadow-2xl flex flex-col"
      style={{ width: 'min(420px, 92vw)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </motion.aside>
  );
};
