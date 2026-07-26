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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Plus, Filter, ArrowLeft, Check, Loader2, UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  getFriends, getProfilesByIds, getFriendActivity, getExpertProfiles,
  getExpertStats, followPublicAccount, removeFriend,
  getPendingRequests, acceptFriendRequest, declineFriendRequest,
  getFollowerIds, getSentRequestIds, sendFriendRequest, searchUsersByUsername,
  type FriendInfo, type FriendRequest, type UserProfile, type CommunityRating,
} from '../lib/supabase-community';
import { ScoreBadge } from './ScoreBadge';
import { AddFriendSheet } from './AddFriendSheet';

type Tab = 'all' | 'friends' | 'experts';
type TimeBucket = 'today' | 'week' | 'earlier';

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
const bucketOf = (iso: string): TimeBucket => {
  if (!iso) return 'earlier';
  const diff = Date.now() - new Date(iso).getTime();
  const days = diff / 86_400_000;
  if (days < 1) return 'today';
  if (days < 7) return 'week';
  return 'earlier';
};
const formatCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

interface CirclePanelProps {
  variant: 'overlay' | 'page';
  onClose?: () => void;
}

export const CirclePanel: React.FC<CirclePanelProps> = ({ variant, onClose }) => {
  const navigate = useNavigate();
  const { user, refreshPendingRequests } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  // Incoming friend requests (rows where the current user is the friend_id
  // and status is still 'pending'). Surfaced as a dedicated section so they
  // can be accepted/declined — previously there was no UI for this.
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [requestProfiles, setRequestProfiles] = useState<Record<string, UserProfile>>({});
  const [requestBusy, setRequestBusy] = useState<Set<string>>(new Set());
  // Follow-back flow: once you accept a request the row stays visible and its
  // button becomes "Follow back" (Instagram-style — mutual needs both sides).
  const [acceptedReqIds, setAcceptedReqIds] = useState<Set<string>>(new Set());
  // My follow status toward each requester (after a follow-back): 'pending'
  // (they're private, awaiting their approval) or 'accepted' (now mutual).
  const [followBackState, setFollowBackState] = useState<Record<string, 'pending' | 'accepted'>>({});
  // Users I've already sent a (still-pending) follow request to.
  const [sentRequestIds, setSentRequestIds] = useState<Set<string>>(new Set());

  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({});
  const [activity, setActivity] = useState<CommunityRating[]>([]);
  const [activityProfiles, setActivityProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  // Global people search — finds ANY user on the app (not just friends /
  // experts / activity), shown as a "People" section with a follow button.
  const [peopleResults, setPeopleResults] = useState<UserProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleBusy, setPeopleBusy] = useState<Set<string>>(new Set());
  // Who follows me (their accepted edge → me) — drives "Follow back".
  const [followerIds, setFollowerIds] = useState<Set<string>>(new Set());

  const [experts, setExperts] = useState<UserProfile[]>([]);
  const [expertRatingCounts, setExpertRatingCounts] = useState<Record<string, number>>({});
  const [expertFollowerCounts, setExpertFollowerCounts] = useState<Record<string, number>>({});
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [expertsLoading, setExpertsLoading] = useState(false);

  // Activity filter popover state
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterTime, setFilterTime] = useState<'all' | 'today' | 'week'>('all');
  const [filterFriendIds, setFilterFriendIds] = useState<Set<string>>(new Set());
  const filterBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      // "My friends" = MUTUAL friends (people I follow who also follow me).
      // `followedIds` stays = everyone I follow (one-directional), so the
      // Experts list still shows Follow/Following correctly.
      const [followingList, followerIds] = await Promise.all([
        getFriends(userId),
        getFollowerIds(userId),
      ]);
      if (cancelled) return;
      const followerSet = new Set(followerIds);
      const mutual = followingList.filter((f) => followerSet.has(f.friend_id));
      setFriends(mutual);
      setFollowedIds(new Set(followingList.map((f) => f.friend_id)));
      setFollowerIds(followerSet);

      if (mutual.length > 0) {
        const ids = mutual.map((f) => f.friend_id);
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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setExpertsLoading(true);
      const profiles = await getExpertProfiles();
      if (cancelled) return;
      setExperts(profiles);
      if (profiles.length > 0) {
        // One batched RPC — the per-expert getUserRatings/getFollowCounts
        // loop was 3 requests per expert just to display two counts.
        const stats = await getExpertStats(profiles.map((p) => p.user_id));
        if (cancelled) return;
        const rc: Record<string, number> = {};
        const fc: Record<string, number> = {};
        for (const [id, s] of Object.entries(stats)) { rc[id] = s.ratingCount; fc[id] = s.followerCount; }
        setExpertRatingCounts(rc);
        setExpertFollowerCounts(fc);
      }
      if (!cancelled) setExpertsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Close filter popover on outside click.
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterBtnRef.current && !filterBtnRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

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

  // ── Incoming friend requests ──────────────────────────────────────────
  const loadRequests = useCallback(async () => {
    if (!userId) { setRequests([]); return; }
    const [reqs, sentIds] = await Promise.all([
      getPendingRequests(userId),
      getSentRequestIds(userId),
    ]);
    setRequests(reqs);
    setSentRequestIds(new Set(sentIds));
    const ids = [...new Set(reqs.map((r) => r.user_id))];
    if (ids.length > 0) {
      const profs = await getProfilesByIds(ids);
      setRequestProfiles((prev) => ({ ...prev, ...profs }));
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await loadRequests(); })();
    return () => { cancelled = true; };
  }, [loadRequests]);

  // Accept is ONE-DIRECTIONAL: the requester now follows me. The row stays
  // visible and flips to "Follow back" so I can make it mutual.
  const handleAcceptRequest = useCallback(async (req: FriendRequest) => {
    if (!userId || requestBusy.has(req.id)) return;
    setRequestBusy((prev) => new Set(prev).add(req.id));
    const ok = await acceptFriendRequest(req.id);
    if (ok) {
      setAcceptedReqIds((prev) => new Set(prev).add(req.id));
      void refreshPendingRequests();
    } else {
      alert("Couldn't accept that request. Try again.");
    }
    setRequestBusy((prev) => { const next = new Set(prev); next.delete(req.id); return next; });
  }, [userId, requestBusy, refreshPendingRequests]);

  // Follow back the requester — respects their privacy (public/expert →
  // instant + now mutual; private → pending request they must approve).
  const handleFollowBackRequest = useCallback(async (req: FriendRequest) => {
    if (!userId || requestBusy.has(req.id)) return;
    const prof = requestProfiles[req.user_id];
    const immediate = !!(prof?.is_public || prof?.is_verified);
    setRequestBusy((prev) => new Set(prev).add(req.id));
    const ok = immediate
      ? await followPublicAccount(userId, req.user_id)
      : await sendFriendRequest(userId, req.user_id);
    if (ok) {
      if (immediate) {
        // Now mutual — reflect in followedIds + My friends.
        setFollowBackState((prev) => ({ ...prev, [req.user_id]: 'accepted' }));
        setFollowedIds((prev) => new Set(prev).add(req.user_id));
        setFriends((prev) => prev.some((f) => f.friend_id === req.user_id)
          ? prev
          : [...prev, { friend_id: req.user_id, status: 'accepted' }]);
        if (prof) setFriendProfiles((prev) => ({ ...prev, [req.user_id]: prof }));
      } else {
        setFollowBackState((prev) => ({ ...prev, [req.user_id]: 'pending' }));
      }
    } else {
      alert("Couldn't follow back. Try again.");
    }
    setRequestBusy((prev) => { const next = new Set(prev); next.delete(req.id); return next; });
  }, [userId, requestBusy, requestProfiles]);

  const handleDeclineRequest = useCallback(async (req: FriendRequest) => {
    if (!userId || requestBusy.has(req.id)) return;
    setRequestBusy((prev) => new Set(prev).add(req.id));
    const ok = await declineFriendRequest(req.id);
    if (ok) {
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      void refreshPendingRequests();
    } else {
      alert("Couldn't decline that request. Try again.");
    }
    setRequestBusy((prev) => { const next = new Set(prev); next.delete(req.id); return next; });
  }, [userId, requestBusy, refreshPendingRequests]);

  // ── Global people search ──────────────────────────────────────────────
  // Debounced lookup of ANY user by username/name once there's a query.
  useEffect(() => {
    if (!userId) { setPeopleResults([]); return; }
    const query = searchQuery.trim();
    if (!query) { setPeopleResults([]); setPeopleLoading(false); return; }
    let cancelled = false;
    setPeopleLoading(true);
    const handle = setTimeout(async () => {
      const res = await searchUsersByUsername(query, userId);
      if (!cancelled) { setPeopleResults(res); setPeopleLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery, userId]);

  // Incoming pending request id keyed by requester, so a search result that
  // already sent ME a request shows "Accept".
  const incomingByUser = useMemo(() => {
    const m: Record<string, string> = {};
    requests.forEach((r) => { m[r.user_id] = r.id; });
    return m;
  }, [requests]);

  // Follow a person from search — respects their privacy (public/expert →
  // instant; private → pending request). Becomes mutual immediately if they
  // already follow me.
  const followPerson = useCallback(async (p: UserProfile) => {
    if (!userId || peopleBusy.has(p.user_id)) return;
    if (followedIds.has(p.user_id) || sentRequestIds.has(p.user_id)) return;
    setPeopleBusy((prev) => new Set(prev).add(p.user_id));
    const immediate = !!(p.is_public || p.is_verified);
    const ok = immediate
      ? await followPublicAccount(userId, p.user_id)
      : await sendFriendRequest(userId, p.user_id);
    setPeopleBusy((prev) => { const next = new Set(prev); next.delete(p.user_id); return next; });
    if (ok) {
      if (immediate) {
        setFollowedIds((prev) => new Set(prev).add(p.user_id));
        if (followerIds.has(p.user_id)) {
          // They already follow me → now mutual.
          setFriends((prev) => prev.some((f) => f.friend_id === p.user_id)
            ? prev : [...prev, { friend_id: p.user_id, status: 'accepted' }]);
          setFriendProfiles((prev) => ({ ...prev, [p.user_id]: p }));
        }
      } else {
        setSentRequestIds((prev) => new Set(prev).add(p.user_id));
      }
    } else {
      alert("Couldn't follow. Try again.");
    }
  }, [userId, peopleBusy, followedIds, sentRequestIds, followerIds]);

  // Accept a request from a search result (they sent me one) — one-directional;
  // afterwards the row offers "Follow back".
  const acceptPerson = useCallback(async (p: UserProfile) => {
    const reqId = incomingByUser[p.user_id];
    if (!userId || !reqId || peopleBusy.has(p.user_id)) return;
    setPeopleBusy((prev) => new Set(prev).add(p.user_id));
    const ok = await acceptFriendRequest(reqId);
    setPeopleBusy((prev) => { const next = new Set(prev); next.delete(p.user_id); return next; });
    if (ok) {
      setAcceptedReqIds((prev) => new Set(prev).add(reqId));
      setFollowerIds((prev) => new Set(prev).add(p.user_id));
      void refreshPendingRequests();
    } else {
      alert("Couldn't accept. Try again.");
    }
  }, [userId, incomingByUser, peopleBusy, refreshPendingRequests]);

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
    let list = activity;
    if (filterTime !== 'all') {
      list = list.filter((a) => {
        const b = bucketOf(a.created_at);
        return filterTime === 'today' ? b === 'today' : (b === 'today' || b === 'week');
      });
    }
    if (filterFriendIds.size > 0) {
      list = list.filter((a) => filterFriendIds.has(a.user_id));
    }
    if (q) {
      list = list.filter((a) => {
        const prof = activityProfiles[a.user_id];
        const hay = `${a.restaurant_name} ${a.cuisine || ''} ${a.address || ''} ${prof?.display_name || ''} ${prof?.username || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [activity, activityProfiles, q, filterTime, filterFriendIds]);

  const activityBuckets = useMemo(() => {
    const today: CommunityRating[] = [];
    const week: CommunityRating[] = [];
    const earlier: CommunityRating[] = [];
    activityFiltered.forEach((a) => {
      const b = bucketOf(a.created_at);
      if (b === 'today') today.push(a);
      else if (b === 'week') week.push(a);
      else earlier.push(a);
    });
    return { today, week, earlier };
  }, [activityFiltered]);

  const activeFilterCount =
    (filterTime !== 'all' ? 1 : 0) +
    (filterFriendIds.size > 0 ? 1 : 0);

  const allCount = friends.length + experts.length;
  const friendsCount = friends.length;
  const expertsCount = experts.length;

  // ── Section renderers ─────────────────────────────────────────────
  // People search results — anyone on the app matching the query, each with a
  // follow control. Only rendered while there's a search query.
  const renderPeople = () => (
    <section>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/55 mb-3">
        People
      </h4>
      {peopleLoading && peopleResults.length === 0 ? (
        <ul className="space-y-3.5">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-on-surface/[0.05] animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded-full bg-on-surface/[0.05] animate-pulse" />
                <div className="h-2.5 w-24 rounded-full bg-on-surface/[0.05] animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      ) : peopleResults.length === 0 ? (
        <p className="text-[12.5px] text-on-surface/40">No people match &ldquo;{searchQuery.trim()}&rdquo;.</p>
      ) : (
        <ul className="space-y-3.5">
          {peopleResults.map((p) => {
            const color = avatarColor(p.user_id);
            const initial = initialOf(p.display_name || p.username);
            const busy = peopleBusy.has(p.user_id);
            const reqId = incomingByUser[p.user_id];
            const status: 'following' | 'requested' | 'incoming' | 'followback' | 'none' =
              followedIds.has(p.user_id) ? 'following'
              : sentRequestIds.has(p.user_id) ? 'requested'
              : (reqId && !acceptedReqIds.has(reqId)) ? 'incoming'
              : followerIds.has(p.user_id) ? 'followback'
              : 'none';
            const pillNeutral = 'hit-44-y inline-flex items-center gap-1.5 px-3 h-8 rounded-full border border-on-surface/15 text-[12px] font-semibold text-on-surface/70 flex-shrink-0';
            const pillPrimary = 'hit-44-y inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex-shrink-0';
            return (
              <li key={p.user_id} className="flex items-center gap-3">
                <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className="relative flex-shrink-0">
                  <div className={cn('w-11 h-11 rounded-full flex items-center justify-center', color.bg)}>
                    <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initial}</span>
                  </div>
                  {p.is_verified && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface flex items-center justify-center ring-1 ring-surface">
                      <VerifiedBadge size={14} />
                    </span>
                  )}
                </Link>
                <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className="flex-1 min-w-0 group">
                  <p className="text-[14px] font-bold text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
                    {p.display_name || p.username || 'User'}
                  </p>
                  <p className="text-[12px] text-on-surface/55 truncate mt-0.5">@{p.username}</p>
                </Link>
                {status === 'following' ? (
                  <span className={pillNeutral}><Check size={13} /> Following</span>
                ) : status === 'requested' ? (
                  <span className={pillNeutral}><Check size={13} /> Requested</span>
                ) : status === 'incoming' ? (
                  <button type="button" onClick={() => acceptPerson(p)} disabled={busy} className={pillPrimary}>
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} strokeWidth={2.6} />} Accept
                  </button>
                ) : status === 'followback' ? (
                  <button type="button" onClick={() => followPerson(p)} disabled={busy} className={pillPrimary}>
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />} Follow back
                  </button>
                ) : (
                  <button type="button" onClick={() => followPerson(p)} disabled={busy} className={pillPrimary}>
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />} Follow
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  // Incoming friend requests — a distinct, highlighted card so it's
  // obvious where to accept/decline. Hidden entirely when there are none.
  const renderRequests = () => {
    if (requests.length === 0) return null;
    return (
      <section className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-grid place-items-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[11px] font-bold tabular-nums">
            {requests.length}
          </span>
          <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/70">
            Friend request{requests.length === 1 ? '' : 's'}
          </h4>
        </div>
        <ul className="space-y-3">
          {requests.map((r) => {
            const p = requestProfiles[r.user_id];
            const name = p?.display_name || p?.username || 'Someone';
            const color = avatarColor(r.user_id);
            const initial = initialOf(name);
            const busy = requestBusy.has(r.id);
            const accepted = acceptedReqIds.has(r.id);
            // My follow status toward this requester (drives the post-accept
            // button): explicit follow-back state wins, else derive from what
            // I already follow / have requested.
            const myFollow: 'none' | 'pending' | 'accepted' =
              followBackState[r.user_id]
              ?? (followedIds.has(r.user_id) ? 'accepted'
                : sentRequestIds.has(r.user_id) ? 'pending'
                : 'none');
            return (
              <li key={r.id} className="flex items-center gap-3">
                <Link
                  to={`/user/${p?.username || ''}`}
                  onClick={() => onClose?.()}
                  className="flex-shrink-0"
                >
                  <div className={cn('w-11 h-11 rounded-full flex items-center justify-center', color.bg)}>
                    <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initial}</span>
                  </div>
                </Link>
                <Link
                  to={`/user/${p?.username || ''}`}
                  onClick={() => onClose?.()}
                  className="flex-1 min-w-0 group"
                >
                  <p className="text-[14px] font-bold text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
                    {name}
                  </p>
                  <p className="text-[12px] text-on-surface/55 truncate mt-0.5">
                    {p?.username ? `@${p.username}` : 'wants to be friends'}
                    {r.created_at && <span className="text-on-surface/30"> · {timeAgoShort(r.created_at)}</span>}
                  </p>
                </Link>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!accepted ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleAcceptRequest(r)}
                        disabled={busy}
                        className="hit-44-y inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} strokeWidth={2.6} />}
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeclineRequest(r)}
                        disabled={busy}
                        aria-label={`Decline request from ${name}`}
                        className="hit-44 w-8 h-8 rounded-full border border-on-surface/15 grid place-items-center text-on-surface/55 hover:bg-on-surface/[0.05] hover:text-on-surface transition-colors disabled:opacity-60"
                      >
                        <X size={15} />
                      </button>
                    </>
                  ) : myFollow === 'accepted' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55">
                      <Check size={13} /> Friends
                    </span>
                  ) : myFollow === 'pending' ? (
                    <span className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55">
                      <Check size={13} /> Requested
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleFollowBackRequest(r)}
                      disabled={busy}
                      className="hit-44-y inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors disabled:opacity-60"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} strokeWidth={2.6} />}
                      Follow back
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  const renderFriendsAvatars = () => (
    <section>
      <div className="flex items-center justify-between mb-3.5">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/55">
          My friends <span className="text-on-surface/30 ml-1">· {friendsCount}</span>
        </h4>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="text-[12px] font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1"
        >
          <Plus size={12} strokeWidth={2.6} />
          Invite
        </button>
      </div>
      {friendsFiltered.length === 0 && q ? (
        <p className="text-[12.5px] text-on-surface/40">No friends match this search.</p>
      ) : (
        <div className="flex items-start gap-4 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
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
            return (
              <Link
                key={f.friend_id}
                to={`/user/${p?.username || ''}`}
                onClick={() => onClose?.()}
                className="flex flex-col items-center gap-2 flex-shrink-0 group"
              >
                <div className={cn('w-16 h-16 rounded-full flex items-center justify-center transition-transform group-hover:scale-[1.03]', color.bg)}>
                  <span className={cn('text-[24px] font-serif font-bold', color.text)}>{initial}</span>
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
        <p className="text-[12.5px] text-on-surface/40">No verified users match this search.</p>
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
                <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className="relative flex-shrink-0">
                  <div className={cn('w-11 h-11 rounded-full flex items-center justify-center', color.bg)}>
                    <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initial}</span>
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface flex items-center justify-center ring-1 ring-surface">
                    <VerifiedBadge size={14} />
                  </span>
                </Link>
                <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className="flex-1 min-w-0 group">
                  <p className="text-[14px] font-bold text-on-surface truncate leading-tight group-hover:text-primary transition-colors">
                    {p.display_name || p.username || 'Verified user'}
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
                    className="hit-44-y inline-flex items-center gap-1 px-3 h-8 rounded-full border border-on-surface/15 text-[12px] font-semibold text-on-surface/70 hover:bg-on-surface/[0.04] transition-colors"
                  >
                    Following
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleFollow(p.user_id)}
                    className="hit-44-y px-3 h-8 rounded-full bg-primary text-white text-[12px] font-bold hover:bg-primary/90 transition-colors"
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

  const renderActivityRow = (a: CommunityRating) => {
    const prof = activityProfiles[a.user_id];
    const name = prof?.display_name || prof?.username || 'User';
    const username = prof?.username || '';
    const color = avatarColor(a.user_id);
    const initial = initialOf(name);
    const city = a.address?.split(',')[0]?.trim();
    const meta = [a.cuisine, a.price, city].filter(Boolean).join(' · ');

    return (
      <li key={a.id} className="relative">
        <Link
          to={`/restaurant/${a.restaurant_id}`}
          onClick={() => onClose?.()}
          className="flex items-start gap-3 py-2.5 group"
        >
          {/* Friend avatar — separate Link so tapping it goes to their profile
              instead of the restaurant. */}
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); } }}
            className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}
          >
            <span className={cn('text-[14px] font-serif font-bold', color.text)}>{initial}</span>
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] leading-snug text-on-surface/75">
              <span
                className="font-bold text-on-surface hover:text-primary"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); }}
              >
                {name}
              </span>
              <span className="font-normal"> rated </span>
              <span className="font-semibold text-on-surface group-hover:text-primary transition-colors">
                {a.restaurant_name}
              </span>
              {Number(a.score) > 0 && (
                <span className="font-bold text-on-surface"> — {Number(a.score).toFixed(1)}</span>
              )}
            </p>
            {(meta || a.created_at) && (
              <p className="text-[11.5px] text-on-surface/45 truncate mt-0.5">
                {meta}
                {meta && a.created_at && <span className="text-on-surface/25 mx-1.5">·</span>}
                {a.created_at && <span>{timeAgoShort(a.created_at)}</span>}
              </p>
            )}
            {a.notes && (
              <p className="text-[12.5px] italic text-on-surface/55 truncate mt-1">
                &ldquo;{a.notes}&rdquo;
              </p>
            )}
          </div>
        </Link>
      </li>
    );
  };

  const renderActivity = () => (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/55">
          Activity <span className="text-on-surface/30 ml-1">· {activity.length}</span>
        </h4>
        <div className="relative" ref={filterBtnRef}>
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className={cn(
              'inline-flex items-center gap-1 text-[12px] font-bold transition-colors',
              activeFilterCount > 0 || filterOpen ? 'text-primary' : 'text-on-surface/55 hover:text-on-surface',
            )}
          >
            <Filter size={12} />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-white text-[10px] font-bold grid place-items-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[260px] p-4 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-[0_18px_48px_-12px_rgba(0,0,0,0.28)]">
              <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface/45 mb-2">When</p>
                <div className="flex gap-1.5">
                  {([
                    ['all', 'All'],
                    ['today', 'Today'],
                    ['week', 'This week'],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFilterTime(k)}
                      className={cn(
                        'flex-1 h-8 rounded-full text-[12px] font-semibold transition-colors',
                        filterTime === k
                          ? 'bg-on-surface text-surface'
                          : 'bg-on-surface/[0.05] text-on-surface/65 hover:bg-on-surface/[0.08]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {friends.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface/45 mb-2">From</p>
                  <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto">
                    {friends.map((f) => {
                      const p = friendProfiles[f.friend_id];
                      const name = p?.display_name || p?.username || 'Friend';
                      const active = filterFriendIds.has(f.friend_id);
                      return (
                        <button
                          key={f.friend_id}
                          type="button"
                          onClick={() => {
                            setFilterFriendIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(f.friend_id)) next.delete(f.friend_id);
                              else next.add(f.friend_id);
                              return next;
                            });
                          }}
                          className={cn(
                            'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium border transition-colors',
                            active
                              ? 'bg-on-surface text-surface border-on-surface'
                              : 'bg-transparent text-on-surface/65 border-on-surface/15 hover:border-on-surface/35',
                          )}
                        >
                          {active && <Check size={11} />}
                          {name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setFilterTime('all'); setFilterFriendIds(new Set()); }}
                  className="mt-3 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {activityFiltered.length === 0 ? (
        <p className="text-[12.5px] text-on-surface/40 py-2">
          {q || activeFilterCount > 0 ? 'No activity matches.' : 'No friend activity yet.'}
        </p>
      ) : (
        <>
          {activityBuckets.today.length > 0 && (
            <>
              <BucketLabel>Today</BucketLabel>
              <ul className="divide-y divide-on-surface/[0.05] mb-2">
                {activityBuckets.today.map(renderActivityRow)}
              </ul>
            </>
          )}
          {activityBuckets.week.length > 0 && (
            <>
              <BucketLabel>This week</BucketLabel>
              <ul className="divide-y divide-on-surface/[0.05] mb-2">
                {activityBuckets.week.map(renderActivityRow)}
              </ul>
            </>
          )}
          {activityBuckets.earlier.length > 0 && (
            <>
              <BucketLabel>Earlier</BucketLabel>
              <ul className="divide-y divide-on-surface/[0.05]">
                {activityBuckets.earlier.map(renderActivityRow)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );

  // ── Body content ───────────────────────────────────────────────────
  const body = (
    <>
      {/* Header */}
      <div className="px-6 pt-safe-4 pb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          {variant === 'page' && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-9 h-9 -ml-2 rounded-full hover:bg-on-surface/[0.06] flex items-center justify-center text-on-surface/70 flex-shrink-0"
              aria-label="Back"
            >
              <ArrowLeft size={19} />
            </button>
          )}
          <h2 className="flex-1 font-serif text-[22px] font-bold leading-tight text-on-surface truncate">Friends</h2>
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
            placeholder="Search friends, places, activity…"
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
                  'relative pt-2.5 pb-3 inline-flex items-baseline gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] transition-colors',
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

      {/* Body — scrolls. Safe-area bottom padding: the page variant has no
          bottom nav, so the last rows must clear the iPhone home indicator. */}
      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-safe-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-on-surface/40 text-sm">Loading your circle…</div>
        ) : (
          <div className="space-y-7">
            {/* People search — anyone on the app — shown first whenever the
                search box has a query, across every tab. */}
            {q && renderPeople()}
            {tab === 'all' && (
              <>
                {renderRequests()}
                {renderFriendsAvatars()}
                {renderExpertsList(true)}
                {renderActivity()}
              </>
            )}
            {tab === 'friends' && (
              <>
                {renderRequests()}
                {renderFriendsAvatars()}
              </>
            )}
            {tab === 'experts' && renderExpertsList(false)}
          </div>
        )}
      </div>

      <AddFriendSheet open={addOpen} onClose={() => setAddOpen(false)} />
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

  return (
    <motion.aside
      initial={{ x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -40, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className="fixed top-0 bottom-0 left-0 z-50 bg-surface border-r border-on-surface/[0.08] shadow-2xl flex flex-col"
      style={{ width: 'min(480px, 92vw)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </motion.aside>
  );
};

const BucketLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h5 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-on-surface/40 mt-2 mb-1 first:mt-0">
    {children}
  </h5>
);
