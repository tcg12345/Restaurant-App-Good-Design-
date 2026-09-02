/**
 * Friends panel — Instagram-style slide-out on desktop, full page on
 * mobile.
 *
 * ONE feed, not tabs: friend activity ("Mei rated Ember & Oak") and
 * notifications ("Jonah commented on your rating") interleave into a
 * single time-sectioned stream — NEW / TODAY / THIS WEEK / EARLIER —
 * the way a notifications page reads on Instagram. Follow requests sit
 * above it as a collapsed card (stacked avatars, count, dot) that
 * expands in place, and a "Suggested for you" card band is embedded a
 * section into the feed rather than parked in an empty state.
 *
 * Search stays: the field filters the feed AND surfaces a "Friends"
 * section of your own friends by name — the rail this page used to
 * carry lives on as search results.
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
import { Search, X, Plus, ArrowLeft, Check, Loader2, UserPlus, Heart, MessageCircle, Bell, Utensils, ChevronDown, ChevronRight } from 'lucide-react';
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
  getSuggestedProfiles,
  type FriendInfo, type FriendRequest, type UserProfile, type CommunityRating, type SuggestedProfile,
} from '../lib/supabase-community';
import { Avatar } from './Avatar';
import { avatarHue } from '../lib/avatar';
import { Collapse } from './Collapse';
import { SearchField } from './SearchField';
import { SuggestedPeople } from './SuggestedPeople';
import { ContactsSync } from './ContactsSync';
import { openAppSettings } from '../lib/native-settings';
import { GlassButton } from '../lib/glass-buttons';
import { scoreTintStyle } from '../lib/score';
import { displayCuisine } from '../lib/cuisine';
import { readViewCache, writeViewCache } from '../lib/view-cache';
import { SKELETON_PULSE } from './LoadingSkeleton';

type TimeBucket = 'today' | 'week' | 'earlier';

/** The add-friends push, and the friends list receding under it — same
 *  spring family RestaurantPanel/RecipePanel/Sidebar use for a panel
 *  taking over the screen. */
const PUSH_SPRING = { type: 'spring' as const, damping: 30, stiffness: 300 };

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

/** The trailing end of a rating row: the place's photo with the score
 *  badged into its corner, or — when there's no photo, or the URL is dead —
 *  the score alone as a ring.
 *
 *  The fallback is not optional. Ratings carry photo URLs that can 404 (old
 *  imports, expired Places links), and an <img> that fails renders the
 *  browser's broken-image glyph, which is exactly what appeared on device
 *  where the seeded harness had only working URLs. Same error-latch shape
 *  as Avatar. */
const RatingThumb: React.FC<{ photo?: string; score: number }> = ({ photo, score }) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [photo]);
  const t = scoreTintStyle(score);
  const label = score >= 10 ? '10' : score.toFixed(1);
  if (!photo || broken) {
    if (!(score > 0)) return null;
    return (
      <span
        className="flex-none w-9 h-9 rounded-full grid place-items-center font-serif font-bold text-[12.5px] tabular-nums"
        style={{ color: t.color, background: t.background, boxShadow: `inset 0 0 0 1.5px ${t.ring}` }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className="relative flex-none">
      <img
        src={photo}
        alt=""
        onError={() => setBroken(true)}
        className="w-[52px] h-[52px] rounded-[14px] object-cover border border-on-surface/[0.08]"
        referrerPolicy="no-referrer"
      />
      {score > 0 && (
        <span
          className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full grid place-items-center font-serif font-bold text-[10px] tabular-nums ring-2 ring-surface"
          style={{ color: t.color, background: t.background, boxShadow: `inset 0 0 0 1.5px ${t.ring}` }}
        >
          {label}
        </span>
      )}
    </span>
  );
};

interface CirclePanelProps {
  variant: 'overlay' | 'page';
  onClose?: () => void;
}

export const CirclePanel: React.FC<CirclePanelProps> = ({ variant, onClose }) => {
  const navigate = useNavigate();
  const { user, refreshPendingRequests } = useAuth();
  const userId = user?.id ?? null;

  // The follow-requests page, pushed over the panel from the card above
  // the feed — requests deserve a screen of their own: confirming one is a
  // decision about a person, and the suggestions under it are the natural
  // next thing to do once the queue is empty.
  const [requestsPageOpen, setRequestsPageOpen] = useState(false);
  // Which grouped alerts are open (keyed by actor).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The Add page's own query — global people search lives there now.
  const [addQuery, setAddQuery] = useState('');

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

  // People to follow, algorithmically matched on taste-quiz cuisines/price
  // and home base (see lib/suggestions.ts#tasteMatchScore) — shown in place
  // of the Activity tab's dead-end empty state for an account with no
  // mutual friends yet, instead of leaving it at "nothing here".
  const [suggestedPeople, setSuggestedPeople] = useState<SuggestedProfile[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const [experts, setExperts] = useState<UserProfile[]>([]);
  const [expertRatingCounts, setExpertRatingCounts] = useState<Record<string, number>>({});
  const [expertFollowerCounts, setExpertFollowerCounts] = useState<Record<string, number>>({});
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [expertsLoading, setExpertsLoading] = useState(false);

  // ── Notification centre ────────────────────────────────────────────
  const { notifications, actors: notifActors, markAllRead } = useNotifications();
  // Opening the tab clears the badge immediately, but the rows the user
  // arrived to see keep their "new" tint for the rest of the session —
  // otherwise the list visibly resets the instant it appears and there's
  // no way to tell which ones you hadn't seen.
  const [highlightedNotifs, setHighlightedNotifs] = useState<Set<string>>(new Set());

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

  // Suggestions are part of the feed now (the embedded card band), so they
  // load for everyone — waiting on `loading` keeps the cold-start focused
  // on the feed itself.
  const suggestionsLoadedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || loading) return;
    if (suggestionsLoadedForRef.current === userId) return;
    suggestionsLoadedForRef.current = userId;
    let cancelled = false;
    setSuggestionsLoading(true);
    getSuggestedProfiles({ viewerId: userId, limit: 12 }).then((people) => {
      if (!cancelled) setSuggestedPeople(people);
    }).finally(() => { if (!cancelled) setSuggestionsLoading(false); });
    return () => { cancelled = true; };
  }, [userId, loading, friends.length]);

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

  // Landing on the page counts as reading — the feed IS the alerts now.
  // Once per mount, when the first batch arrives: the rows keep their NEW
  // section for the rest of the visit (highlightedNotifs), the badge
  // clears. Rows that arrive later stay unread until the next visit —
  // marking on every arrival would read things the user never saw.
  const markedReadRef = useRef(false);
  useEffect(() => {
    if (markedReadRef.current || notifications.length === 0) return;
    markedReadRef.current = true;
    const unread = notifications.filter((n) => n.readAt == null).map((n) => n.id);
    if (unread.length === 0) return;
    setHighlightedNotifs(new Set(unread));
    markAllRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications]);

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
    if (!q) return activity;
    return activity.filter((a) => {
      const prof = friendProfiles[a.user_id];
      const hay = `${a.restaurant_name} ${a.cuisine || ''} ${a.address || ''} ${prof?.display_name || ''} ${prof?.username || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activity, friendProfiles, q]);

  const notificationsFiltered = useMemo(() => {
    if (!q) return notifications;
    return notifications.filter((n) => {
      const p = notifActors[n.actorId];
      return [p?.display_name, p?.username, n.subjectLabel, n.preview]
        .some((s) => (s || '').toLowerCase().includes(q));
    });
  }, [notifications, notifActors, q]);

  /* ── The merged feed ──
     Notifications and friend activity interleave into one stream, newest
     first, sectioned NEW / TODAY / THIS WEEK / EARLIER. NEW is unread
     notifications (plus the ones read on this very visit, held there by
     highlightedNotifs so the section doesn't dissolve as it's looked at);
     activity rows are never "new" — a friend rating a place isn't
     addressed to you. Repeated cuisine suggestions from one actor still
     collapse into a single expandable row, grouped BEFORE sectioning so a
     group spanning a week doesn't split into two half-groups. */

  // Where a notification lands. Review traffic goes to the queue; ratings
  // land on the restaurant page, where the comments now live.
  const notificationTarget = (n: AppNotification): string => {
    if (n.subjectType === 'cuisine') return '/admin/cuisine';
    if (n.subjectType === 'post') return `/r/post-${n.subjectId}`;
    if (n.subjectType === 'reel') return `/r/reel-${n.subjectId}`;
    return n.restaurantId ? `/restaurant/${n.restaurantId}` : `/review/${n.subjectId}`;
  };

  const requestsPending = requests.filter((r) => !acceptedReqIds.has(r.id));

  // ── Feed rows ───────────────────────────────────────────────────────
  /* A friend's rating, said the way the reference says it: the ACTOR
     leads ("Mei rated Ember & Oak · 4h"), their note reads as a quote, and
     the place's photo — when there is one — rides on the right with the
     score badged into its corner. The old row led with the restaurant,
     which is a discover feed's voice, not a friends page's. */
  const renderRatingRow = (a: CommunityRating) => {
    const prof = friendProfiles[a.user_id];
    const name = prof?.display_name || prof?.username || 'Someone';
    const username = prof?.username || '';
    const hue = avatarHue(a.user_id);
    return (
      <li key={`rating-${a.id}`}>
        <Link to={`/restaurant/${a.restaurant_id}`} onClick={() => onClose?.()} className="flex items-center gap-3 px-5 py-2.5 active:bg-on-surface/[0.03] transition-colors">
          <span
            role="link"
            tabIndex={0}
            aria-label={`${name}'s profile`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onClose?.(); navigate(`/user/${username}`); } }}
            className="flex-none self-start mt-0.5"
          >
            <Avatar
              src={prof?.avatar_url}
              name={name}
              size={44}
              fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
            />
          </span>
          <span className="flex-1 min-w-0 block">
            <span className="block text-[13.5px] leading-[1.4] tracking-[-0.01em] text-on-surface" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              <span className="font-bold">{name.split(' ')[0]}</span>
              {' rated '}
              <span className="font-bold">{a.restaurant_name}</span>
              {'. '}
              <span className="text-on-surface/45">{timeAgoShort(a.created_at)}</span>
            </span>
            {a.notes ? (
              <span className="block mt-[3px] font-serif italic text-[13px] leading-snug text-on-surface/60 line-clamp-2">&ldquo;{a.notes}&rdquo;</span>
            ) : (
              <span className="block mt-[3px] text-[11.5px] leading-[1.2] text-on-surface/45 truncate">
                {[displayCuisine(a.cuisine), a.price, a.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          <RatingThumb photo={a.photo_url} score={Number(a.score)} />
        </Link>
      </li>
    );
  };

  // ── Alerts ──────────────────────────────────────────────────────────
  /* One request. Confirm / Delete, the platform's own words for this
     decision — "Accept / Ignore" described what the app does, not what
     the person is choosing. After Confirm the row stays put and offers
     Follow back, because accepting is one-directional here: they follow
     you, and mutual takes both sides. */
  const renderRequestRow = (r: FriendRequest) => {
    const p = requestProfiles[r.user_id];
    const name = p?.display_name || p?.username || 'Someone';
    const hue = avatarHue(r.user_id);
    const busy = requestBusy.has(r.id);
    const accepted = acceptedReqIds.has(r.id);
    const myFollow: 'none' | 'pending' | 'accepted' =
      followBackState[r.user_id]
      ?? (followedIds.has(r.user_id) ? 'accepted'
        : sentRequestIds.has(r.user_id) ? 'pending'
        : 'none');
    return (
      <li key={r.id} className="flex items-center gap-3 py-2.5">
        <Link to={`/user/${p?.username || ''}`} onClick={() => onClose?.()} className="flex-none active:opacity-75 transition-opacity">
          <Avatar
            src={p?.avatar_url}
            name={name}
            size={48}
            fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
          />
        </Link>
        <Link to={`/user/${p?.username || ''}`} onClick={() => onClose?.()} className="flex-1 min-w-0 block active:opacity-75 transition-opacity">
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate font-serif font-bold text-[15px] leading-[1.2] tracking-[-0.02em] text-on-surface">{name}</span>
            {p?.is_verified && <VerifiedBadge size={13} className="flex-none" />}
          </span>
          <span className="block mt-[3px] text-[12px] leading-[1.25] text-on-surface/50 truncate">
            {[p?.username ? `@${p.username}` : '', r.created_at ? timeAgoShort(r.created_at) : ''].filter(Boolean).join(' · ') || 'wants to follow you'}
          </span>
        </Link>
        {!accepted ? (
          <span className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => handleAcceptRequest(r)}
              disabled={busy}
              className="hit-44-y inline-flex items-center justify-center gap-1 px-4 h-9 rounded-full bg-primary text-white text-[12.5px] font-bold active:opacity-85 transition-opacity disabled:opacity-60"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              Confirm
            </button>
            <button
              type="button"
              onClick={() => handleDeclineRequest(r)}
              disabled={busy}
              className="hit-44-y inline-flex items-center justify-center px-4 h-9 rounded-full border border-on-surface/[0.15] text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.05] transition-colors disabled:opacity-60"
            >
              Delete
            </button>
          </span>
        ) : myFollow === 'accepted' ? (
          <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55"><Check size={13} /> Friends</span>
        ) : myFollow === 'pending' ? (
          <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/55"><Check size={13} /> Requested</span>
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

  /* The sentence AFTER the actor's name — the name itself renders bold,
     separately, the way the reference (and Instagram) sets these rows.
     cuisine_auto has no human actor, so it keeps a whole sentence and an
     icon disc instead of an avatar. */
  const alertAction = (n: AppNotification): string => {
    const place = n.subjectLabel.trim();
    const subject = n.subjectType === 'rating' ? 'rating' : n.subjectType;
    if (isReviewNotification(n)) return `suggested a cuisine for ${place || 'a place'}.`;
    if (n.kind === 'like') return `liked your ${place ? `${place} ` : ''}${subject}.`;
    return `commented on your ${place ? `${place} ` : ''}${subject}.`;
  };

  const renderAlertSingle = (n: AppNotification) => {
    const isNew = n.readAt == null || highlightedNotifs.has(n.id);
    const isAuto = n.kind === 'cuisine_auto';
    const p = notifActors[n.actorId];
    const name = p?.display_name || p?.username || 'Someone';
    const hue = avatarHue(n.actorId || n.id);
    return (
      <li key={n.id}>
        <Link
          to={notificationTarget(n)}
          state={n.subjectType === 'rating' ? { focusRatingComments: true } : undefined}
          onClick={() => onClose?.()}
          className="flex items-center gap-3 px-5 py-2.5 active:bg-on-surface/[0.03] transition-colors"
        >
          <span className="relative flex-none self-start mt-0.5">
            {isAuto ? (
              <span className="w-11 h-11 rounded-full grid place-items-center border border-on-surface/[0.14] text-on-surface/55">
                <Check size={15} strokeWidth={2.4} />
              </span>
            ) : (
              <Avatar
                src={p?.avatar_url}
                name={name}
                size={44}
                fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
              />
            )}
            {isNew && <span className="absolute -top-px -right-px w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-surface" aria-label="New" />}
          </span>
          <span className="flex-1 min-w-0 block">
            <span className="block text-[13.5px] leading-[1.4] tracking-[-0.01em] text-on-surface" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              {isAuto ? (
                <>A cuisine changed on <span className="font-bold">{n.subjectLabel.trim() || 'a place'}</span> — enough people agreed. </>
              ) : (
                <><span className="font-bold">{name}</span> {alertAction(n)} </>
              )}
              <span className="text-on-surface/45">{timeAgoShort(isoOf(n.createdAt))}</span>
            </span>
            {n.preview && (
              <span className="block mt-[3px] font-serif italic text-[13px] leading-snug text-on-surface/60 line-clamp-2">&ldquo;{n.preview}&rdquo;</span>
            )}
          </span>
          <span className="flex-none grid place-items-center w-7 h-7 rounded-full bg-on-surface/[0.05] text-on-surface/45">
            {alertIcon(n)}
          </span>
        </Link>
      </li>
    );
  };

  const renderAlertGroup = (g: { actorId: string; items: AppNotification[] }) => {
    const p = notifActors[g.actorId];
    const name = p?.display_name || p?.username || 'Someone';
    const open = expandedGroups.has(g.actorId);
    const isNew = g.items.some((n) => n.readAt == null || highlightedNotifs.has(n.id));
    const newest = g.items[0];
    const hue = avatarHue(g.actorId);
    return (
      <li key={`group-${g.actorId}`}>
        <button
          type="button"
          onClick={() => setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(g.actorId)) next.delete(g.actorId); else next.add(g.actorId);
            return next;
          })}
          aria-expanded={open}
          className="w-full flex items-center gap-3 px-5 py-2.5 text-left active:bg-on-surface/[0.03] transition-colors"
        >
          <span className="relative flex-none self-start mt-0.5">
            <Avatar
              src={p?.avatar_url}
              name={name}
              size={44}
              fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
            />
            {isNew && <span className="absolute -top-px -right-px w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-surface" aria-label="New" />}
          </span>
          <span className="flex-1 min-w-0 block">
            <span className="block text-[13.5px] leading-[1.4] tracking-[-0.01em] text-on-surface" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              <span className="font-bold">{name}</span> suggested cuisines for {g.items.length} places.{' '}
              <span className="text-on-surface/45">{timeAgoShort(isoOf(newest.createdAt))}</span>
            </span>
            <span className="block mt-[3px] text-[11.5px] leading-[1.2] text-on-surface/45">
              {open ? 'Tap a place to review it' : 'Review them together'}
            </span>
          </span>
          <ChevronDown size={14} className={cn('flex-none text-on-surface/40 transition-transform duration-300', open && 'rotate-180')} />
        </button>
        <Collapse open={open}>
          <div className="pl-[72px] pr-5 pb-3 flex flex-col gap-2.5">
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

  /* ── The merged feed, assembled ── */
  type FeedItem =
    | { kind: 'notif'; at: number; unread: boolean; n: AppNotification }
    | { kind: 'group'; at: number; unread: boolean; g: { actorId: string; items: AppNotification[] } }
    | { kind: 'rating'; at: number; unread: false; a: CommunityRating };

  const feedSections = useMemo(() => {
    const items: FeedItem[] = [];
    for (const item of groupAlerts(notificationsFiltered)) {
      if (item.kind === 'group') {
        items.push({
          kind: 'group',
          at: item.items[0]?.createdAt ?? 0,
          unread: item.items.some((n) => n.readAt == null || highlightedNotifs.has(n.id)),
          g: { actorId: item.actorId, items: item.items },
        });
      } else {
        items.push({
          kind: 'notif',
          at: item.n.createdAt,
          unread: item.n.readAt == null || highlightedNotifs.has(item.n.id),
          n: item.n,
        });
      }
    }
    for (const a of activityFiltered) {
      items.push({ kind: 'rating', at: new Date(a.created_at).getTime() || 0, unread: false, a });
    }
    items.sort((x, y) => y.at - x.at);
    const sections: Array<{ label: string; items: FeedItem[] }> = [
      { label: 'New', items: [] }, { label: 'Today', items: [] },
      { label: 'This week', items: [] }, { label: 'Earlier', items: [] },
    ];
    for (const it of items) {
      const idx = it.unread ? 0 : bucketOf(new Date(it.at).toISOString()) === 'today' ? 1
        : bucketOf(new Date(it.at).toISOString()) === 'week' ? 2 : 3;
      sections[idx].items.push(it);
    }
    return sections.filter((sec) => sec.items.length > 0);
    // groupAlerts/bucketOf are stable module-shaped helpers; the real
    // inputs are the three lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsFiltered, activityFiltered, highlightedNotifs]);

  const renderFeedItem = (it: FeedItem) =>
    it.kind === 'rating' ? renderRatingRow(it.a)
    : it.kind === 'group' ? renderAlertGroup(it.g)
    : renderAlertSingle(it.n);

  /* ── Follow requests — the collapsed card above the feed ── */
  const requestRowsAll = [...requestsPending, ...requests.filter((r) => acceptedReqIds.has(r.id))];
  const requestsCard = requestRowsAll.length > 0 && (
    <div className="mx-5 mb-2 rounded-[20px] border border-on-surface/[0.08] bg-on-surface/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={() => setRequestsPageOpen(true)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-on-surface/[0.03] transition-colors"
      >
        {/* Stacked requester avatars, the reference's move — the card
            shows WHO is waiting before it's even opened. */}
        <span className="flex flex-none">
          {requestRowsAll.slice(0, 3).map((r, i) => {
            const rp = requestProfiles[r.user_id];
            const rname = rp?.display_name || rp?.username || 'Someone';
            const rhue = avatarHue(r.user_id);
            return (
              <span key={r.id} className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ml-3.5')}>
                <Avatar
                  src={rp?.avatar_url}
                  name={rname}
                  size={36}
                  fallbackStyle={{ backgroundColor: `hsl(${rhue} 52% 92%)`, color: `hsl(${rhue} 45% 34%)` }}
                />
              </span>
            );
          })}
        </span>
        <span className="flex-1 min-w-0 block">
          <span className="block text-[14px] font-bold tracking-[-0.01em] text-on-surface">Follow requests</span>
          <span className="block mt-px text-[12px] text-on-surface/50 truncate">
            {(() => {
              const first = requestProfiles[requestRowsAll[0].user_id];
              const firstName = (first?.display_name || first?.username || 'Someone').split(' ')[0];
              const others = requestRowsAll.length - 1;
              return others > 0 ? `${firstName} + ${others} other${others === 1 ? '' : 's'}` : firstName;
            })()}
          </span>
        </span>
        {requestsPending.length > 0 && <span className="flex-none w-2 h-2 rounded-full bg-primary" aria-label="Pending requests" />}
        <ChevronRight size={15} className="flex-none text-on-surface/35" />
      </button>
    </div>
  );

  /* ── Suggested for you — the card band embedded in the feed ── */
  const suggestedBand = (suggestionsLoading || suggestedPeople.length > 0) && (
    <div className="my-2.5 py-3.5 border-y border-on-surface/[0.07] bg-on-surface/[0.02]">
      <div className="flex items-baseline justify-between px-5 pb-2.5">
        <span className="text-[13.5px] font-bold tracking-[-0.01em] text-on-surface">Suggested for you</span>
        <button
          type="button"
          onClick={() => { setAddQuery(''); setAddOpen(true); }}
          className="text-[12px] font-bold text-primary active:opacity-70 transition-opacity"
        >
          See all
        </button>
      </div>
      <SuggestedPeople people={suggestedPeople} userId={userId} loading={suggestionsLoading} bare layout="rail" />
    </div>
  );

  const renderFeed = () => {
    const empty = feedSections.length === 0;
    if (empty) {
      // A brand-new account has nothing to be notified about — that path
      // gets the contacts primer + suggestions rather than a shrug.
      if (friends.length === 0 && !q) {
        return (
          <div className="px-5 pt-2">
            {/* `primer`, not `auto`: nothing happens until the user taps,
                so opening this page never springs the one-shot iOS
                contacts dialog. Denied → the primer becomes the
                "Open Settings" route back in. No discoverability card
                here — the Add friends page owns that decision. */}
            <ContactsSync
              mode="primer"
              showDiscoverability={false}
              renderPerson={personRow}
              lacksPhone={!user?.phone}
              onAddPhone={() => { onClose?.(); navigate('/settings'); }}
              onOpenSettings={() => { void openAppSettings(); }}
            />
            {(suggestionsLoading || suggestedPeople.length > 0) && (
              <h4 className="pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">
                Suggested for you
              </h4>
            )}
            <SuggestedPeople people={suggestedPeople} userId={userId} loading={suggestionsLoading} layout="list" bare />
            {!suggestionsLoading && suggestedPeople.length === 0 && (
              <div className="py-14">
                <p className="font-serif font-bold text-[17px] tracking-[-0.02em] text-on-surface">No one to suggest yet</p>
                <p className="mt-1.5 text-[12.5px] text-on-surface/45">Search for friends by name to get started.</p>
              </div>
            )}
          </div>
        );
      }
      return (
        <>
          {q ? (
            <div className="px-5 py-10">
              <p className="font-serif font-bold text-[17px] tracking-[-0.02em] text-on-surface">Nothing matches that</p>
              <p className="mt-1.5 text-[12.5px] text-on-surface/45">Try a friend&rsquo;s name, a place, or a cuisine.</p>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center text-center gap-2">
              <span className="w-11 h-11 rounded-full border border-on-surface/[0.14] grid place-items-center text-on-surface/35"><Bell size={17} /></span>
              <p className="font-serif font-bold text-[15px] tracking-[-0.02em] text-on-surface">All caught up</p>
              <p className="text-[12.5px] text-on-surface/45 max-w-[250px]">Friends&rsquo; ratings, likes and comments on what you share land here.</p>
            </div>
          )}
          {!q && suggestedBand}
        </>
      );
    }
    return (
      <section>
        {feedSections.map((sec, si) => (
          <div key={sec.label}>
            <h4 className="px-5 pt-3.5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">{sec.label}</h4>
            <ul>{sec.items.map(renderFeedItem)}</ul>
            {/* The reference embeds Suggested a section into the feed —
                present without being the first thing, skipped entirely
                while searching. */}
            {si === 0 && !q && suggestedBand}
          </div>
        ))}
      </section>
    );
  };

  /* ── Search: friends by name, above the matching feed rows ── */
  const renderFriendResults = () => {
    if (friendsFiltered.length === 0) return null;
    return (
      <div>
        <h4 className="px-5 pt-3.5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">Friends</h4>
        <ul>
          {friendsFiltered.map((f) => {
            const fp = friendProfiles[f.friend_id];
            const fname = fp?.display_name || fp?.username || 'Friend';
            const fhue = avatarHue(f.friend_id);
            return (
              <li key={f.friend_id}>
                <Link
                  to={`/user/${fp?.username || ''}`}
                  onClick={() => onClose?.()}
                  className="flex items-center gap-3 px-5 py-2.5 active:bg-on-surface/[0.03] transition-colors"
                >
                  <Avatar
                    src={fp?.avatar_url}
                    name={fname}
                    size={44}
                    fallbackStyle={{ backgroundColor: `hsl(${fhue} 52% 92%)`, color: `hsl(${fhue} 45% 34%)` }}
                  />
                  <span className="flex-1 min-w-0 block">
                    <span className="flex items-center gap-1 min-w-0">
                      <span className="truncate font-serif font-bold text-[14.5px] leading-[1.2] tracking-[-0.02em] text-on-surface">{fname}</span>
                      {fp?.is_verified && <VerifiedBadge size={13} className="flex-none" />}
                    </span>
                    {fp?.username && <span className="block mt-[3px] text-[11.5px] leading-[1.2] text-on-surface/50 truncate">@{fp.username}</span>}
                  </span>
                  <span className="flex-none text-[12px] font-semibold text-on-surface/40">View</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
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

  // ── Requests page — pushed from the card above the feed ────────────
  const requestsPage = (
    <motion.div
      className="absolute inset-0 z-20 bg-surface flex flex-col"
      initial={false}
      animate={{ x: requestsPageOpen ? '0%' : '100%' }}
      transition={PUSH_SPRING}
      aria-hidden={!requestsPageOpen || undefined}
    >
      <div className="px-5 pt-safe-4 pb-3 flex items-center gap-2.5 border-b border-on-surface/[0.08] flex-shrink-0">
        <GlassButton
          id="requests-back"
          symbol="chevron.left"
          label="Back"
          onClick={() => setRequestsPageOpen(false)}
          // Native glass draws above the WebView, so a page that is merely
          // covered by CSS must still stand its own glass down — the same
          // rule the Add page's back button follows.
          suspended={!requestsPageOpen}
          className="hit-44 flex-none w-9 h-9 -ml-1.5 rounded-full grid place-items-center text-on-surface/60 active:scale-95 transition-transform"
        >
          <ArrowLeft size={19} />
        </GlassButton>
        <h3 className="flex-1 min-w-0 font-serif font-bold text-[19px] tracking-[-0.02em] truncate">Requests</h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-2 pb-safe-6">
        {requestRowsAll.length > 0 ? (
          <ul>{requestRowsAll.map(renderRequestRow)}</ul>
        ) : (
          <div className="py-12 flex flex-col items-center text-center gap-2">
            <span className="w-11 h-11 rounded-full border border-on-surface/[0.14] grid place-items-center text-on-surface/35"><UserPlus size={17} /></span>
            <p className="font-serif font-bold text-[15px] tracking-[-0.02em] text-on-surface">No requests right now</p>
            <p className="text-[12.5px] text-on-surface/45 max-w-[250px]">People asking to follow you show up here.</p>
          </div>
        )}
        {/* The natural next thing once the queue is dealt with — and the
            reason an empty requests screen isn't a dead end. */}
        {(suggestionsLoading || suggestedPeople.length > 0) && (
          <>
            <h4 className="pt-5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">
              Suggested for you
            </h4>
            <SuggestedPeople people={suggestedPeople} userId={userId} loading={suggestionsLoading} layout="list" bare />
          </>
        )}
      </div>
    </motion.div>
  );

  const addPage = (
    <motion.div
      className="absolute inset-0 z-20 bg-surface flex flex-col"
      initial={false}
      animate={{ x: addOpen ? '0%' : '100%' }}
      // A spring, not a fixed-duration ease: this is the same push the rest
      // of the app uses for a panel taking over the screen (RestaurantPanel,
      // RecipePanel, Sidebar all share this exact curve) — a tuned duration
      // reads as "a page objectively appeared"; a spring reads as "this
      // panel moved", which is the seam add-friends is supposed to have.
      transition={PUSH_SPRING}
      aria-hidden={!addOpen || undefined}
    >
      <div className="px-5 pt-safe-4 pb-3 flex items-center gap-2.5 border-b border-on-surface/[0.08] flex-shrink-0">
        <GlassButton
          id="add-friends-back"
          symbol="chevron.left"
          label="Back"
          onClick={() => setAddOpen(false)}
          // Suspended while this page is the one sliding OUT of view: native
          // glass is a layer drawn above the WebView, not inside its own
          // stacking context, so an opaque CSS div covering this page (the
          // Friends body, mid-close) can't hide a still-registered native
          // control the way it hides everything else. Both pages stay
          // mounted through the push — see PUSH_SPRING above — so only the
          // page actually on top may register native glass at any moment.
          suspended={!addOpen}
          className="hit-44 flex-none w-9 h-9 -ml-1.5 rounded-full grid place-items-center text-on-surface/60 active:scale-95 transition-transform"
        >
          <ArrowLeft size={19} />
        </GlassButton>
        <h3 className="flex-1 min-w-0 font-serif font-bold text-[19px] tracking-[-0.02em] truncate">Add friends</h3>
      </div>
      <div className="px-5 pt-3.5 flex-shrink-0">
        <SearchField
          value={addQuery}
          onChange={setAddQuery}
          placeholder="Names or @usernames"
          aria-label="Search people"
          // Same reasoning as the back button above, via the mechanism
          // `useGlassField` actually offers: an absent id registers nothing.
          glassId={addOpen ? 'add-friends-search' : undefined}
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
            {/* Contacts first: someone you already know beats any ranked
                stranger, and this is the highest-conversion thing on the
                page. It renders through `personRow`, so matched people
                inherit the same follow-state machine as every other row
                here rather than a second copy of it. */}
            <ContactsSync
              renderPerson={personRow}
              lacksPhone={!user?.phone}
              onAddPhone={() => { onClose?.(); navigate('/settings'); }}
              onOpenSettings={() => { void openAppSettings(); }}
            />

            <h4 className="pt-5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">
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
    </motion.div>
  );

  // ── Body ────────────────────────────────────────────────────────────
  const body = (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      <motion.div
        className={cn('flex-1 min-h-0 flex flex-col', (addOpen || requestsPageOpen) && 'pointer-events-none')}
        initial={false}
        // A real iOS push barely touches the outgoing screen — a small
        // parallax drift and a hair of dimming, no shrinking. The previous
        // version scaled this down to 97.5% and dropped it to 45% opacity,
        // which is a MODAL's "you left" cue, not a push's "this moved over"
        // one — on a panel whose own comment calls this "slides over" (a
        // push), that mismatch is a good part of why it read as leaving to
        // a different page rather than drilling into this one.
        animate={{ x: (addOpen || requestsPageOpen) ? '-22%' : '0%', opacity: (addOpen || requestsPageOpen) ? 0.92 : 1 }}
        transition={PUSH_SPRING}
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
                // See the matching note on "add-friends-back": while an
                // overlay page covers this one, this button's native glass
                // must stand down or it bleeds through the opaque page on
                // top of it — native glass draws above the WebView, so CSS
                // covering does nothing to it.
                suspended={addOpen || requestsPageOpen}
                className="hit-44 flex-none w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
              >
                <ArrowLeft size={18} />
              </GlassButton>
            )}
            <h2 className="flex-1 font-serif text-[22px] font-bold leading-tight tracking-[-0.02em] text-on-surface truncate">Friends</h2>
            <GlassButton
              id="circle-search-toggle"
              symbol="magnifyingglass"
              label={searchOpen ? 'Close search' : 'Search'}
              pressed={searchOpen}
              prominent={searchOpen}
              tint="label"
              suspended={addOpen || requestsPageOpen}
              onClick={() => { setSearchOpen((v) => { if (v) setSearchQuery(''); return !v; }); }}
              className={cn(
                'hit-44 flex-none w-9 h-9 rounded-full grid place-items-center transition-colors',
                searchOpen ? 'bg-on-surface text-surface' : 'text-on-surface/60 active:bg-on-surface/[0.07]',
              )}
            >
              <Search size={17} />
            </GlassButton>
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
                placeholder="Search friends"
                aria-label="Search friends and activity"
                autoFocus={searchOpen}
                glassId={(addOpen || requestsPageOpen) ? undefined : 'circle-search-field'}
              />
            </div>
          </div>

        </div>

        {/* Scroll body — full-bleed rows (they carry their own px-5), the
            requests card floats above the feed, and search prepends a
            Friends section to the filtered stream. */}
        <div className="flex-1 min-h-0 overflow-y-auto pt-3 pb-safe-6">
          {!q && requestsCard}
          {loading && activity.length === 0 && notifications.length === 0
            ? <div className="px-5"><ActivitySkeleton /></div>
            : (
              <>
                {q && renderFriendResults()}
                {renderFeed()}
              </>
            )}
        </div>
      </motion.div>

      {requestsPage}
      {addPage}
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

