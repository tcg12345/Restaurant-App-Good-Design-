/**
 * Friends panel — Instagram-style slide-out on desktop, full page on
 * mobile. Four tabs: All (friends + experts + activity), Friends,
 * Experts, and Alerts — the notification centre, which is where you find
 * out somebody liked your post or left a comment on a restaurant you
 * rated. (Those comments were previously invisible to their own author:
 * your rating shows up in your friends' feeds, never in yours.)
 *
 * Variants:
 *   - 'overlay'  → sticky-positioned panel anchored next to the desktop
 *                  sidebar with a slide-in animation + outside-click close.
 *   - 'page'     → renders inline as the body of the /circle route on
 *                  mobile, no animation, no close button.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Plus, ArrowLeft, Check, Loader2, UserPlus, Heart, MessageCircle, Bell, Utensils, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { isReviewNotification, type AppNotification } from '../lib/supabase-notifications';
import {
  getFriends, getProfilesByIds, getFriendActivity, getExpertProfiles,
  getExpertStats, followPublicAccount, removeFriend,
  getPendingRequests, acceptFriendRequest, declineFriendRequest,
  getFollowerIds, getSentRequestIds, sendFriendRequest, searchUsersByUsername,
  type FriendInfo, type FriendRequest, type UserProfile, type CommunityRating,
} from '../lib/supabase-community';
import { AddFriendSheet } from './AddFriendSheet';
import { Collapse } from './Collapse';
import { SearchField } from './SearchField';
import { GlassButton } from '../lib/glass-buttons';
import { scoreTintStyle } from '../lib/score';
import { displayCuisine } from '../lib/cuisine';
import { readViewCache, writeViewCache } from '../lib/view-cache';
import { SKELETON_PULSE } from './LoadingSkeleton';

type Tab = 'activity' | 'alerts';
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
// Notifications carry epoch millis rather than the ISO strings the rest
// of the panel's rows use.
const isoOf = (ms: number) => (ms ? new Date(ms).toISOString() : '');

/* ── First-paint snapshot ──
   Everything above the fold on the Activity tab, cached per user so a
   return visit paints the real rail and the real feed on frame one and
   refreshes underneath, instead of holding a skeleton for two round
   trips. `CIRCLE_CACHE` is the storage name; the shape is the payload. */
const CIRCLE_CACHE = 'circle';

interface CircleSnapshot {
  friends: FriendInfo[];
  profiles: Record<string, UserProfile>;
  activity: CommunityRating[];
  followedIds: string[];
  followerIds: string[];
}

/* The friends rail, drawn in pulse — same 14pt discs and caption widths
   the real rail lands on, so nothing shifts when it does. */
const RailSkeleton: React.FC = () => (
  <div className="flex items-start gap-4 pt-4 overflow-hidden" aria-hidden="true">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex flex-col items-center gap-1.5 flex-shrink-0">
        <div className={cn(SKELETON_PULSE, 'w-14 h-14 rounded-full')} />
        <div className={cn(SKELETON_PULSE, 'h-2 w-9 rounded-full')} />
      </div>
    ))}
  </div>
);

/* The activity feed's shape: the filter chips over a run of rows sized off
   renderActivityRow (9pt avatar, three stacked lines, trailing score ring).
   Line widths vary a little so it reads as a list of different places
   rather than a stack of identical bars. */
const ActivitySkeleton: React.FC = () => (
  <div aria-hidden="true">
    <div className="flex gap-1.5 pt-3.5">
      {[52, 68, 84].map((w) => (
        <div key={w} className={cn(SKELETON_PULSE, 'h-8 rounded-full flex-none')} style={{ width: w }} />
      ))}
    </div>
    <div className="pt-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={cn('flex items-start gap-3 py-3.5', i > 0 && 'border-t border-on-surface/[0.07]')}>
          <div className={cn(SKELETON_PULSE, 'w-9 h-9 rounded-full flex-shrink-0 mt-0.5')} />
          <div className="flex-1 min-w-0 space-y-2 pt-0.5">
            <div className={cn(SKELETON_PULSE, 'h-3.5 rounded-full')} style={{ width: `${58 + ((i * 13) % 30)}%` }} />
            <div className={cn(SKELETON_PULSE, 'h-2.5 w-2/5 rounded-full')} />
            <div className={cn(SKELETON_PULSE, 'h-2 w-1/4 rounded-full')} />
          </div>
          <div className={cn(SKELETON_PULSE, 'w-9 h-9 rounded-full flex-none')} />
        </div>
      ))}
    </div>
  </div>
);

interface CirclePanelProps {
  variant: 'overlay' | 'page';
  onClose?: () => void;
}

export const CirclePanel: React.FC<CirclePanelProps> = ({ variant, onClose }) => {
  const navigate = useNavigate();
  const { user, refreshPendingRequests } = useAuth();
  const userId = user?.id ?? null;

  const [tab, setTab] = useState<Tab>('activity');
  // Which grouped alerts are open (keyed by actor).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The Add page's own query — global people search lives there now.
  const [addQuery, setAddQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

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
  // One profile map for the whole panel. Activity is queried over the
  // mutual-friend ids, so every author it can return is already in this
  // map — the third round trip that re-fetched them was fetching rows we
  // had just asked for.
  const [friendProfiles, setFriendProfiles] = useState<Record<string, UserProfile>>({});
  const [activity, setActivity] = useState<CommunityRating[]>([]);
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

  // ── Notification centre ────────────────────────────────────────────
  const { notifications, actors: notifActors, unreadCount, markAllRead, clearAll: clearNotifications } = useNotifications();
  // Opening the tab clears the badge immediately, but the rows the user
  // arrived to see keep their "new" tint for the rest of the session —
  // otherwise the list visibly resets the instant it appears and there's
  // no way to tell which ones you hadn't seen.
  const [highlightedNotifs, setHighlightedNotifs] = useState<Set<string>>(new Set());

  // Activity filter popover state
  const [filterTime, setFilterTime] = useState<'all' | 'today' | 'week'>('all');
  const [filterFriendIds, setFilterFriendIds] = useState<Set<string>>(new Set());

  // Paint last visit's circle before the first frame. useLayoutEffect (not
  // useEffect) because an effect that runs after paint would still show a
  // frame of skeleton to someone whose data we already have on disk.
  const hydratedForRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!userId) { hydratedForRef.current = null; return; }
    if (hydratedForRef.current === userId) return;
    hydratedForRef.current = userId;
    const snap = readViewCache<CircleSnapshot>(CIRCLE_CACHE, userId);
    if (!snap) return;
    setFriends(snap.friends || []);
    setFriendProfiles(snap.profiles || {});
    setActivity(snap.activity || []);
    setFollowedIds(new Set(snap.followedIds || []));
    setFollowerIds(new Set(snap.followerIds || []));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // Two round trips, not three: the edges, then the profiles and the
      // activity together. Nothing below waits on anything it doesn't
      // actually need.
      //
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

      const ids = mutual.map((f) => f.friend_id);
      const [profs, act] = ids.length > 0
        ? await Promise.all([getProfilesByIds(ids), getFriendActivity(ids, 30)])
        : [{} as Record<string, UserProfile>, [] as CommunityRating[]];
      if (cancelled) return;
      setFriendProfiles(profs);
      setActivity(act);
      writeViewCache(CIRCLE_CACHE, userId, {
        friends: mutual,
        profiles: profs,
        activity: act,
        followedIds: followingList.map((f) => f.friend_id),
        followerIds: [...followerSet],
      } satisfies CircleSnapshot);
    })().finally(() => {
      // Whatever happened, stop pulsing. A skeleton that never resolves
      // reads as a hung app, where an empty circle at least reads as an
      // empty circle.
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId]);

  // Experts only ever render inside the Add page, so they load when it
  // opens rather than on every mount — two round trips (one of them a
  // whole-table profile scan) that the panel's own screen never spent.
  const expertsLoadedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !addOpen || expertsLoadedForRef.current === userId) return;
    expertsLoadedForRef.current = userId;
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
  }, [userId, addOpen]);

  // Landing on Alerts counts as reading them.
  useEffect(() => {
    if (tab !== 'alerts') return;
    const unread = notifications.filter((n) => n.readAt == null).map((n) => n.id);
    if (unread.length === 0) return;
    setHighlightedNotifs((prev) => {
      const next = new Set(prev);
      unread.forEach((id) => next.add(id));
      return next;
    });
    markAllRead();
    // `notifications` is deliberately absent: re-running on every arriving
    // row would mark things read the user hasn't looked at yet. New rows
    // while the tab is open stay unread until it's re-opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
    if (!userId || !addOpen) { setPeopleResults([]); return; }
    const query = addQuery.trim();
    if (!query) { setPeopleResults([]); setPeopleLoading(false); return; }
    let cancelled = false;
    setPeopleLoading(true);
    const handle = setTimeout(async () => {
      const res = await searchUsersByUsername(query, userId);
      if (!cancelled) { setPeopleResults(res); setPeopleLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [addQuery, addOpen, userId]);

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
        const prof = friendProfiles[a.user_id];
        const hay = `${a.restaurant_name} ${a.cuisine || ''} ${a.address || ''} ${prof?.display_name || ''} ${prof?.username || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [activity, friendProfiles, q, filterTime, filterFriendIds]);

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

  const notificationsFiltered = useMemo(() => {
    if (!q) return notifications;
    return notifications.filter((n) => {
      const p = notifActors[n.actorId];
      return [p?.display_name, p?.username, n.subjectLabel, n.preview]
        .some((s) => (s || '').toLowerCase().includes(q));
    });
  }, [notifications, notifActors, q]);

  const notificationBuckets = useMemo(() => {
    const today: AppNotification[] = [];
    const week: AppNotification[] = [];
    const earlier: AppNotification[] = [];
    notificationsFiltered.forEach((n) => {
      const b = bucketOf(isoOf(n.createdAt));
      if (b === 'today') today.push(n);
      else if (b === 'week') week.push(n);
      else earlier.push(n);
    });
    return { today, week, earlier };
  }, [notificationsFiltered]);

  // ── The reference's page ───────────────────────────────────────────
  // Two segments instead of four tabs, a compact friends strip, activity
  // rows that lead with the place and wear the score as a ring, alerts
  // that group repeated suggestions into one expandable row, and an Add
  // page that slides over for finding people (search + verified experts).

  // Where a notification lands. Review traffic goes to the queue; ratings
  // land on the restaurant page, where the comments now live.
  const notificationTarget = (n: AppNotification): string => {
    if (n.subjectType === 'cuisine') return '/admin/cuisine';
    if (n.subjectType === 'post') return `/r/post-${n.subjectId}`;
    if (n.subjectType === 'reel') return `/r/reel-${n.subjectId}`;
    return n.restaurantId ? `/restaurant/${n.restaurantId}` : `/review/${n.subjectId}`;
  };

  const requestsPending = requests.filter((r) => !acceptedReqIds.has(r.id));
  const alertBadge = unreadCount + requestsPending.length;

  const segTrack = (
    <div className="flex p-1 rounded-full bg-on-surface/[0.06]">
      {([['activity', 'Activity'], ['alerts', 'Alerts']] as const).map(([key, label]) => {
        const on = tab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={on}
            className={cn(
              'flex-1 h-9 rounded-full inline-flex items-center justify-center gap-1.5 text-[12.5px] font-bold transition-colors',
              on ? 'bg-surface dark:bg-on-surface/[0.14] text-on-surface shadow-[0_1px_6px_rgba(0,0,0,0.09)]' : 'text-on-surface/55 active:text-on-surface/80',
            )}
          >
            {label}
            {key === 'alerts' && alertBadge > 0 && (
              <span className="min-w-[17px] h-[17px] px-1 rounded-full bg-primary text-white text-[10px] font-bold grid place-items-center tabular-nums">{alertBadge}</span>
            )}
          </button>
        );
      })}
    </div>
  );

  const friendsRail = (
    <div className="flex items-start gap-4 pt-4 overflow-x-auto no-scrollbar">
      <button type="button" onClick={() => { setAddQuery(''); setAddOpen(true); }} className="flex flex-col items-center gap-1.5 flex-shrink-0">
        <span className="w-14 h-14 rounded-full border-[1.5px] border-dashed border-on-surface/30 grid place-items-center text-on-surface/60">
          <Plus size={18} strokeWidth={2.2} />
        </span>
        <span className="text-[11px] font-semibold text-on-surface/55">Add</span>
      </button>
      {friendsFiltered.map((f) => {
        const p = friendProfiles[f.friend_id];
        const name = p?.display_name || p?.username || 'Friend';
        const color = avatarColor(f.friend_id);
        return (
          <Link
            key={f.friend_id}
            to={`/user/${p?.username || ''}`}
            onClick={() => onClose?.()}
            className="flex flex-col items-center gap-1.5 flex-shrink-0"
          >
            <span className={cn('relative w-14 h-14 rounded-full flex items-center justify-center', color.bg)}>
              <span className={cn('text-[19px] font-serif font-bold', color.text)}>{initialOf(name)}</span>
              {p?.is_verified && (
                <span className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-surface grid place-items-center ring-1 ring-surface">
                  <VerifiedBadge size={15} />
                </span>
              )}
            </span>
            <span className="text-[11px] font-medium text-on-surface/75 truncate max-w-[60px]">{(name || '').split(' ')[0]}</span>
          </Link>
        );
      })}
    </div>
  );

  // ── Activity ────────────────────────────────────────────────────────
  const activityChips = (
    <div className="flex gap-1.5 pt-3.5 overflow-x-auto no-scrollbar">
      {([['all', 'All'], ['today', 'Today'], ['week', 'This week']] as const).map(([k, label]) => {
        const on = filterTime === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => setFilterTime(k)}
            className={cn(
              'flex-none h-8 px-3.5 rounded-full text-[12px] font-bold transition-colors',
              on ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface/65 active:bg-on-surface/[0.1]',
            )}
          >
            {label}
          </button>
        );
      })}
      {friends.map((f) => {
        const p = friendProfiles[f.friend_id];
        const name = (p?.display_name || p?.username || 'Friend').split(' ')[0];
        const on = filterFriendIds.has(f.friend_id);
        return (
          <button
            key={f.friend_id}
            type="button"
            onClick={() => setFilterFriendIds((prev) => {
              const next = new Set(prev);
              if (next.has(f.friend_id)) next.delete(f.friend_id); else next.add(f.friend_id);
              return next;
            })}
            className={cn(
              'flex-none h-8 px-3.5 rounded-full text-[12px] font-bold transition-colors inline-flex items-center gap-1',
              on ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface/65 active:bg-on-surface/[0.1]',
            )}
          >
            {on && <Check size={11} />}
            {name}
          </button>
        );
      })}
    </div>
  );

  const scoreRing = (score: number) => {
    const t = scoreTintStyle(score);
    return (
      <span
        className="flex-none w-9 h-9 rounded-full grid place-items-center font-serif font-bold text-[12.5px] tabular-nums"
        style={{ color: t.color, background: t.background, boxShadow: `inset 0 0 0 1.5px ${t.ring}` }}
      >
        {Number(score) >= 10 ? '10' : Number(score).toFixed(1)}
      </span>
    );
  };

  const renderActivityRow = (a: CommunityRating, i: number) => {
    const prof = friendProfiles[a.user_id];
    const name = prof?.display_name || prof?.username || 'Someone';
    const username = prof?.username || '';
    const color = avatarColor(a.user_id);
    const city = a.address?.split(',')[0]?.trim();
    const line = [`${name.split(' ')[0]} rated`, [displayCuisine(a.cuisine), a.price].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
    return (
      <li key={a.id} className={cn(i > 0 && 'border-t border-on-surface/[0.07]')}>
        <Link to={`/restaurant/${a.restaurant_id}`} onClick={() => onClose?.()} className="flex items-center gap-3 py-3.5 group">
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); } }}
            className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 self-start mt-0.5', color.bg)}
          >
            <span className={cn('text-[13px] font-serif font-bold', color.text)}>{initialOf(name)}</span>
          </span>
          <span className="flex-1 min-w-0 block">
            <span className="block font-serif font-bold text-[15px] leading-[1.2] tracking-[-0.02em] text-on-surface truncate group-hover:text-primary transition-colors">
              {a.restaurant_name}
            </span>
            <span className="block mt-[4px] text-[12px] leading-[1.25] text-on-surface/55 truncate">{line}</span>
            <span className="block mt-[3px] text-[11px] leading-[1.2] text-on-surface/40 truncate">
              {[city, timeAgoShort(a.created_at)].filter(Boolean).join(' · ')}
            </span>
            {a.notes && (
              <span className="block mt-1.5 text-[12.5px] italic leading-snug text-on-surface/60 line-clamp-2">&ldquo;{a.notes}&rdquo;</span>
            )}
          </span>
          {Number(a.score) > 0 && scoreRing(Number(a.score))}
        </Link>
      </li>
    );
  };

  const renderActivity = () => (
    <section>
      {activityChips}
      {searchOpen && q && (
        <p className="pt-3.5 text-[12px] font-medium text-on-surface/45">
          {activityFiltered.length} result{activityFiltered.length === 1 ? '' : 's'}
        </p>
      )}
      {activityFiltered.length === 0 ? (
        <div className="py-14">
          <p className="font-serif font-bold text-[17px] tracking-[-0.02em] text-on-surface">Nothing matches that</p>
          <p className="mt-1.5 text-[12.5px] text-on-surface/45">Try a friend&rsquo;s name, a place, or a cuisine.</p>
        </div>
      ) : (
        <>
          {([['Today', activityBuckets.today], ['This week', activityBuckets.week], ['Earlier', activityBuckets.earlier]] as const).map(([label, list]) =>
            list.length > 0 ? (
              <div key={label}>
                <BucketLabel>{label}</BucketLabel>
                <ul>{list.map(renderActivityRow)}</ul>
              </div>
            ) : null,
          )}
        </>
      )}
    </section>
  );

  // ── Alerts ──────────────────────────────────────────────────────────
  const renderRequestRow = (r: FriendRequest, i: number) => {
    const p = requestProfiles[r.user_id];
    const name = p?.display_name || p?.username || 'Someone';
    const color = avatarColor(r.user_id);
    const busy = requestBusy.has(r.id);
    const accepted = acceptedReqIds.has(r.id);
    const myFollow: 'none' | 'pending' | 'accepted' =
      followBackState[r.user_id]
      ?? (followedIds.has(r.user_id) ? 'accepted'
        : sentRequestIds.has(r.user_id) ? 'pending'
        : 'none');
    return (
      <li key={r.id} className={cn('flex items-center gap-3 py-3.5', i > 0 && 'border-t border-on-surface/[0.07]')}>
        <Link to={`/user/${p?.username || ''}`} onClick={() => onClose?.()} className={cn('w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}>
          <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initialOf(name)}</span>
        </Link>
        <Link to={`/user/${p?.username || ''}`} onClick={() => onClose?.()} className="flex-1 min-w-0 block">
          <span className="block font-serif font-bold text-[14.5px] leading-[1.2] tracking-[-0.02em] text-on-surface truncate">{name}</span>
          <span className="block mt-[4px] text-[11.5px] leading-[1.2] text-on-surface/50 truncate">
            {[p?.username ? `@${p.username}` : '', r.created_at ? timeAgoShort(r.created_at) : ''].filter(Boolean).join(' · ') || 'wants to follow you'}
          </span>
        </Link>
        {!accepted ? (
          <span className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => handleAcceptRequest(r)}
              disabled={busy}
              className="hit-44-y inline-flex items-center gap-1 px-4 h-9 rounded-full bg-on-surface text-surface text-[12.5px] font-bold active:opacity-85 transition-opacity disabled:opacity-60"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              Accept
            </button>
            <button
              type="button"
              onClick={() => handleDeclineRequest(r)}
              disabled={busy}
              className="hit-44-y text-[12.5px] font-semibold text-on-surface/50 active:text-on-surface transition-colors disabled:opacity-60"
            >
              Ignore
            </button>
          </span>
        ) : myFollow === 'accepted' ? (
          <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55"><Check size={13} /> Friends</span>
        ) : myFollow === 'pending' ? (
          <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55"><Check size={13} /> Requested</span>
        ) : (
          <button
            type="button"
            onClick={() => handleFollowBackRequest(r)}
            disabled={busy}
            className="hit-44-y flex-shrink-0 inline-flex items-center gap-1 px-3.5 h-9 rounded-full bg-primary text-white text-[12.5px] font-bold active:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />}
            Follow back
          </button>
        )}
      </li>
    );
  };

  // Repeated cuisine suggestions from one person collapse into a single
  // expandable row — nine near-identical alerts said the same thing nine
  // times. Grouping is per bucket, per actor.
  type AlertItem = { kind: 'single'; n: AppNotification } | { kind: 'group'; actorId: string; items: AppNotification[] };
  const groupAlerts = (list: AppNotification[]): AlertItem[] => {
    const out: AlertItem[] = [];
    const grouped = new Map<string, AppNotification[]>();
    for (const n of list) {
      if (isReviewNotification(n) && n.kind !== 'cuisine_auto') {
        const arr = grouped.get(n.actorId) || [];
        arr.push(n);
        grouped.set(n.actorId, arr);
      }
    }
    const claimed = new Set<string>();
    for (const [actorId, items] of grouped) {
      if (items.length >= 2) items.forEach((n) => claimed.add(n.id));
      else grouped.delete(actorId);
    }
    const emitted = new Set<string>();
    for (const n of list) {
      if (claimed.has(n.id)) {
        if (!emitted.has(n.actorId)) {
          emitted.add(n.actorId);
          out.push({ kind: 'group', actorId: n.actorId, items: grouped.get(n.actorId)! });
        }
      } else {
        out.push({ kind: 'single', n });
      }
    }
    return out;
  };

  const alertIcon = (n: AppNotification) => {
    const isAuto = n.kind === 'cuisine_auto';
    if (isReviewNotification(n)) return isAuto ? <Check size={15} strokeWidth={2.4} /> : <Utensils size={14} strokeWidth={2.2} />;
    if (n.kind === 'like') return <Heart size={14} strokeWidth={2.2} />;
    return <MessageCircle size={14} strokeWidth={2.2} />;
  };

  const alertSentence = (n: AppNotification): string => {
    const p = notifActors[n.actorId];
    const name = p?.display_name || p?.username || 'Someone';
    const place = n.subjectLabel.trim();
    const subject = n.subjectType === 'rating' ? 'rating' : n.subjectType;
    if (n.kind === 'cuisine_auto') return `A cuisine changed on ${place || 'a place'} — enough people agreed`;
    if (isReviewNotification(n)) return `${name} suggested a cuisine for ${place || 'a place'}`;
    if (n.kind === 'like') return `${name} liked your ${subject}${place ? ` of ${place}` : ''}`;
    return `${name} commented on your ${subject}${place ? ` · ${place}` : ''}`;
  };

  const renderAlertSingle = (n: AppNotification, i: number) => {
    const isNew = n.readAt == null || highlightedNotifs.has(n.id);
    return (
      <li key={n.id} className={cn(i > 0 && 'border-t border-on-surface/[0.07]')}>
        <Link
          to={notificationTarget(n)}
          state={n.subjectType === 'rating' ? { focusRatingComments: true } : undefined}
          onClick={() => onClose?.()}
          className="flex items-start gap-3 py-3.5"
        >
          <span className={cn(
            'flex-none w-9 h-9 rounded-full grid place-items-center border',
            isNew ? 'border-primary/35 bg-primary/[0.07] text-primary' : 'border-on-surface/[0.14] text-on-surface/55',
          )}>
            {alertIcon(n)}
          </span>
          <span className="flex-1 min-w-0 block">
            <span className={cn('block font-serif font-bold text-[14.5px] leading-[1.3] tracking-[-0.02em]', isNew ? 'text-on-surface' : 'text-on-surface/85')}>
              {alertSentence(n)}
            </span>
            {n.preview && (
              <span className="block mt-[5px] text-[12px] leading-[1.35] text-on-surface/55 line-clamp-2">&ldquo;{n.preview}&rdquo;</span>
            )}
          </span>
          <span className="flex-none flex items-center gap-2 mt-1">
            <span className="text-[11px] text-on-surface/40">{timeAgoShort(isoOf(n.createdAt))}</span>
            {isNew && <span className="w-2 h-2 rounded-full bg-primary" aria-label="New" />}
          </span>
        </Link>
      </li>
    );
  };

  const renderAlertGroup = (g: { actorId: string; items: AppNotification[] }, i: number) => {
    const p = notifActors[g.actorId];
    const name = p?.display_name || p?.username || 'Someone';
    const open = expandedGroups.has(g.actorId);
    const isNew = g.items.some((n) => n.readAt == null || highlightedNotifs.has(n.id));
    const newest = g.items[0];
    return (
      <li key={`group-${g.actorId}`} className={cn(i > 0 && 'border-t border-on-surface/[0.07]')}>
        <button
          type="button"
          onClick={() => setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(g.actorId)) next.delete(g.actorId); else next.add(g.actorId);
            return next;
          })}
          aria-expanded={open}
          className="w-full flex items-start gap-3 py-3.5 text-left"
        >
          <span className={cn(
            'flex-none w-9 h-9 rounded-full grid place-items-center border',
            isNew ? 'border-primary/35 bg-primary/[0.07] text-primary' : 'border-on-surface/[0.14] text-on-surface/55',
          )}>
            <Utensils size={14} strokeWidth={2.2} />
          </span>
          <span className="flex-1 min-w-0 block">
            <span className={cn('block font-serif font-bold text-[14.5px] leading-[1.3] tracking-[-0.02em]', isNew ? 'text-on-surface' : 'text-on-surface/85')}>
              {name} suggested cuisines for {g.items.length} places
            </span>
            <span className="block mt-[5px] text-[12px] leading-[1.3] text-on-surface/55">
              {open ? 'Tap a place to review it' : 'Review them together'}
            </span>
          </span>
          <span className="flex-none flex items-center gap-2 mt-1">
            <span className="text-[11px] text-on-surface/40">{timeAgoShort(isoOf(newest.createdAt))}</span>
            <ChevronDown size={14} className={cn('text-on-surface/40 transition-transform duration-300', open && 'rotate-180')} />
          </span>
        </button>
        <Collapse open={open}>
          <div className="pl-12 pb-3 flex flex-col gap-2.5">
            {g.items.map((n) => (
              <Link
                key={n.id}
                to={notificationTarget(n)}
                onClick={() => onClose?.()}
                className="flex items-center gap-2.5"
              >
                <span className="flex-1 min-w-0 block">
                  <span className="block text-[13px] font-semibold text-on-surface truncate">{n.subjectLabel.trim() || 'A place'}</span>
                  {n.preview && <span className="block mt-[3px] text-[11.5px] text-on-surface/50 truncate">{n.preview}</span>}
                </span>
                <span className="flex-none text-[12px] font-bold text-primary">Review</span>
              </Link>
            ))}
          </div>
        </Collapse>
      </li>
    );
  };

  const renderAlerts = () => {
    const buckets = ([['Today', notificationBuckets.today], ['This week', notificationBuckets.week], ['Earlier', notificationBuckets.earlier]] as const)
      .filter(([, list]) => list.length > 0);
    const empty = requestsPending.length === 0 && notificationsFiltered.length === 0;
    return (
      <section className="pt-1.5">
        {requestsPending.length > 0 && (
          <div className="pt-3">
            <h4 className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">Requests</h4>
            <ul>{requestsPending.map(renderRequestRow)}</ul>
          </div>
        )}
        {requests.some((r) => acceptedReqIds.has(r.id)) && (
          <ul>{requests.filter((r) => acceptedReqIds.has(r.id)).map((r, i) => renderRequestRow(r, requestsPending.length + i))}</ul>
        )}
        {buckets.map(([label, list], bi) => (
          <div key={label} className="pt-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">{label}</h4>
              {bi === 0 && notifications.length > 0 && (
                <button type="button" onClick={clearNotifications} className="text-[12px] font-bold text-on-surface/50 active:text-on-surface transition-colors">
                  Clear all
                </button>
              )}
            </div>
            <ul>
              {groupAlerts(list).map((item, i) =>
                item.kind === 'group' ? renderAlertGroup(item, i) : renderAlertSingle(item.n, i),
              )}
            </ul>
          </div>
        ))}
        {empty && (
          <div className="py-14 flex flex-col items-center text-center gap-2">
            <span className="w-11 h-11 rounded-full border border-on-surface/[0.14] grid place-items-center text-on-surface/35"><Bell size={17} /></span>
            <p className="font-serif font-bold text-[15px] tracking-[-0.02em] text-on-surface">All caught up</p>
            <p className="text-[12.5px] text-on-surface/45 max-w-[250px]">Requests, likes and comments on what you share land here.</p>
          </div>
        )}
      </section>
    );
  };

  // ── Add friends page — slides over the panel ────────────────────────
  const followStatusOf = (uid: string): 'following' | 'requested' | 'incoming' | 'followback' | 'none' => {
    const reqId = incomingByUser[uid];
    return followedIds.has(uid) ? 'following'
      : sentRequestIds.has(uid) ? 'requested'
      : (reqId && !acceptedReqIds.has(reqId)) ? 'incoming'
      : followerIds.has(uid) ? 'followback'
      : 'none';
  };

  const personRow = (p: UserProfile, meta: string, i: number) => {
    const color = avatarColor(p.user_id);
    const busy = peopleBusy.has(p.user_id);
    const status = followStatusOf(p.user_id);
    const inkPill = 'hit-44-y flex-shrink-0 inline-flex items-center gap-1 px-4 h-9 rounded-full bg-on-surface text-surface text-[12.5px] font-bold active:opacity-85 transition-opacity disabled:opacity-60';
    const quietPill = 'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-on-surface/[0.06] text-[12.5px] font-semibold text-on-surface/55';
    return (
      <li key={p.user_id} className={cn('flex items-center gap-3 py-3', i > 0 && 'border-t border-on-surface/[0.07]')}>
        <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className={cn('relative w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0', color.bg)}>
          <span className={cn('text-[15px] font-serif font-bold', color.text)}>{initialOf(p.display_name || p.username)}</span>
          {p.is_verified && (
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface grid place-items-center ring-1 ring-surface"><VerifiedBadge size={14} /></span>
          )}
        </Link>
        <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className="flex-1 min-w-0 block">
          <span className="block font-serif font-bold text-[14.5px] leading-[1.2] tracking-[-0.02em] text-on-surface truncate">{p.display_name || p.username || 'User'}</span>
          <span className="block mt-[4px] text-[11.5px] leading-[1.2] text-on-surface/50 truncate">{meta}</span>
        </Link>
        {status === 'following' ? (
          <button type="button" onClick={() => handleUnfollow(p.user_id)} className={quietPill}><Check size={13} /> Following</button>
        ) : status === 'requested' ? (
          <span className={quietPill}><Check size={13} /> Requested</span>
        ) : status === 'incoming' ? (
          <button type="button" onClick={() => acceptPerson(p)} disabled={busy} className={inkPill}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null} Accept
          </button>
        ) : (
          <button type="button" onClick={() => followPerson(p)} disabled={busy} className={inkPill}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {status === 'followback' ? 'Follow back' : 'Follow'}
          </button>
        )}
      </li>
    );
  };

  const addPage = (
    <div
      className={cn(
        'absolute inset-0 z-20 bg-surface flex flex-col transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
        addOpen ? 'translate-x-0' : 'translate-x-full',
      )}
      aria-hidden={!addOpen || undefined}
    >
      <div className="px-5 pt-safe-4 pb-3 flex items-center gap-2.5 border-b border-on-surface/[0.08] flex-shrink-0">
        <button
          type="button"
          onClick={() => setAddOpen(false)}
          aria-label="Back"
          className="w-9 h-9 -ml-1.5 rounded-full grid place-items-center text-on-surface/60 active:bg-on-surface/[0.07]"
        >
          <ArrowLeft size={19} />
        </button>
        <h3 className="flex-1 min-w-0 font-serif font-bold text-[19px] tracking-[-0.02em] truncate">Add friends</h3>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex-shrink-0 text-[12.5px] font-bold text-primary active:opacity-70"
        >
          Invite
        </button>
      </div>
      <div className="px-5 pt-3.5 flex-shrink-0">
        <SearchField
          value={addQuery}
          onChange={setAddQuery}
          placeholder="Names or @usernames"
          aria-label="Search people"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-safe-6">
        {addQuery.trim() ? (
          peopleLoading && peopleResults.length === 0 ? (
            <div className="flex justify-center py-10"><Loader2 size={16} className="animate-spin text-on-surface/30" /></div>
          ) : peopleResults.length === 0 ? (
            <p className="py-10 text-[13px] text-on-surface/45">No one by that name.</p>
          ) : (
            <ul>{peopleResults.map((p, i) => personRow(p, p.username ? `@${p.username}` : '', i))}</ul>
          )
        ) : (
          <>
            <h4 className="pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">
              Verified experts
            </h4>
            {expertsLoading && experts.length === 0 ? (
              <div className="flex justify-center py-10"><Loader2 size={16} className="animate-spin text-on-surface/30" /></div>
            ) : experts.length === 0 ? (
              <p className="py-6 text-[12.5px] text-on-surface/45">No verified accounts yet — search for people by name instead.</p>
            ) : (
              <ul>
                {experts.map((p, i) => personRow(
                  p,
                  [
                    p.username ? `@${p.username}` : '',
                    `${expertRatingCounts[p.user_id] || 0} review${(expertRatingCounts[p.user_id] || 0) === 1 ? '' : 's'}`,
                    `${formatCount(expertFollowerCounts[p.user_id] || 0)} follower${(expertFollowerCounts[p.user_id] || 0) === 1 ? '' : 's'}`,
                  ].filter(Boolean).join(' · '),
                  i,
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );

  // ── Body ────────────────────────────────────────────────────────────
  const body = (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      <div
        className={cn(
          'flex-1 min-h-0 flex flex-col transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
          addOpen && 'translate-x-[-20%] scale-[0.975] opacity-45 pointer-events-none',
        )}
      >
        {/* Header */}
        <div className="px-5 pt-safe-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {variant === 'page' && (
              <GlassButton
                id="circle-back"
                symbol="chevron.left"
                label="Back"
                onClick={() => navigate(-1)}
                className="hit-44 flex-none w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
              >
                <ArrowLeft size={18} />
              </GlassButton>
            )}
            <h2 className="flex-1 font-serif text-[22px] font-bold leading-tight tracking-[-0.02em] text-on-surface truncate">Friends</h2>
            <button
              type="button"
              onClick={() => { setSearchOpen((v) => { if (v) setSearchQuery(''); return !v; }); }}
              aria-label={searchOpen ? 'Close search' : 'Search'}
              aria-expanded={searchOpen}
              className={cn(
                'w-9 h-9 rounded-full grid place-items-center transition-colors flex-shrink-0',
                searchOpen ? 'bg-on-surface text-surface' : 'text-on-surface/60 active:bg-on-surface/[0.07]',
              )}
            >
              <Search size={17} />
            </button>
            <button
              type="button"
              onClick={() => { setAddQuery(''); setAddOpen(true); }}
              className="flex-shrink-0 h-9 px-4 rounded-full bg-on-surface text-surface text-[12.5px] font-bold inline-flex items-center gap-1.5 active:opacity-85 transition-opacity"
            >
              <Plus size={13} strokeWidth={2.6} />
              Add
            </button>
            {variant === 'overlay' && (
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full active:bg-on-surface/[0.07] flex items-center justify-center text-on-surface/60 flex-shrink-0"
                aria-label="Close panel"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Search — expands under the title, the reference's move. */}
          <div className={cn('overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]', searchOpen ? 'max-h-[64px] opacity-100' : 'max-h-0 opacity-0')}>
            <div className="pt-3">
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Friends, places, cuisines"
                aria-label="Search activity and alerts"
                autoFocus={searchOpen}
              />
            </div>
          </div>

          <div className="pt-3">{segTrack}</div>
        </div>

        {/* Scroll body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-safe-6">
          {/* Alerts come from the notifications + requests fetches, not the
              friends one, so only the rail and the activity feed go to
              skeleton — tapping Alerts during a cold load shows alerts. */}
          {loading ? <RailSkeleton /> : friendsRail}
          <div className="mt-4 border-t border-on-surface/[0.1]" />
          {tab === 'activity'
            ? (loading ? <ActivitySkeleton /> : renderActivity())
            : renderAlerts()}
        </div>
      </div>

      {addPage}
      <AddFriendSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );

  // ── Variant wrappers ───────────────────────────────────────────────
  if (variant === 'page') {
    return (
      <div className="flex flex-col h-[100dvh] bg-surface">
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
