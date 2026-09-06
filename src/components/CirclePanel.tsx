/** Friends and discovery share one People page on mobile and desktop. */
import { usePageBack } from '../lib/usePageBack';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, MotionConfig } from 'motion/react';
import { X, ArrowLeft, Check, Loader2, UserPlus, MessageCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { VerifiedBadge } from './VerifiedBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  getFriends, getProfilesByIds, getExpertProfiles,
  getExpertStats, followPublicAccount, removeFriend,
  getPendingRequests, acceptFriendRequest, declineFriendRequest,
  getFollowerIds, getSentRequestIds, sendFriendRequest, searchUsersByUsername,
  getSuggestedProfiles,
  type FriendInfo, type FriendRequest, type UserProfile, type SuggestedProfile,
} from '../lib/supabase-community';
import { Avatar } from './Avatar';
import { avatarHue } from '../lib/avatar';
import { Collapse } from './Collapse';
import { SearchField } from './SearchField';
import { SuggestedPeople } from './SuggestedPeople';
import { ContactsSync } from './ContactsSync';
import { openAppSettings } from '../lib/native-settings';
import { GlassButton } from '../lib/glass-buttons';
import { readViewCache, writeViewCache } from '../lib/view-cache';
import { homeHaptic } from '../lib/haptics';
import './social/SocialDesign.css';
import { SKELETON_PULSE } from './LoadingSkeleton';

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
const CIRCLE_CACHE = 'circle';

interface CircleSnapshot {
  friends: FriendInfo[];
  profiles: Record<string, UserProfile>;
  followedIds: string[];
  followerIds: string[];
}

const PeopleSkeleton = () => <div aria-hidden="true">{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-3 py-3"><div className={cn(SKELETON_PULSE, 'w-11 h-11 rounded-full')} /><div className={cn(SKELETON_PULSE, 'h-3 w-32 rounded-full')} /></div>)}</div>;

interface CirclePanelProps {
  variant: 'overlay' | 'page';
  onClose?: () => void;
}

const CirclePanelContent: React.FC<CirclePanelProps> = ({ variant, onClose }) => {
  const navigate = useNavigate();
  const goBack = usePageBack('/');
  const { user, profile, refreshPendingRequests } = useAuth();
  const userId = user?.id ?? null;
  const [actionError, setActionError] = useState('');
  const [socialRefresh, setSocialRefresh] = useState(0);
  useEffect(() => {
    const refresh = () => setSocialRefresh(value => value + 1);
    window.addEventListener('follows:changed', refresh);
    return () => window.removeEventListener('follows:changed', refresh);
  }, []);

  const [requestsOpen, setRequestsOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [allFriends, setAllFriends] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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
  const [loading, setLoading] = useState(true);

  // Global people search — finds ANY user on the app (not just friends /
  // experts), shown as a "People" section with a follow button.
  const [peopleResults, setPeopleResults] = useState<UserProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleBusy, setPeopleBusy] = useState<Set<string>>(new Set());
  // Who follows me (their accepted edge → me) — drives "Follow back".
  const [followerIds, setFollowerIds] = useState<Set<string>>(new Set());

  // Taste-matched discovery alongside your existing friends.
  const [suggestedPeople, setSuggestedPeople] = useState<SuggestedProfile[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const [experts, setExperts] = useState<UserProfile[]>([]);
  const [expertRatingCounts, setExpertRatingCounts] = useState<Record<string, number>>({});
  const [expertFollowerCounts, setExpertFollowerCounts] = useState<Record<string, number>>({});
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [expertsLoading, setExpertsLoading] = useState(false);

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
    setFollowedIds(new Set(snap.followedIds || []));
    setFollowerIds(new Set(snap.followerIds || []));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
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
      const profs = ids.length > 0 ? await getProfilesByIds(ids) : {};
      if (cancelled) return;
      setFriendProfiles(profs);
      writeViewCache(CIRCLE_CACHE, userId, {
        friends: mutual,
        profiles: profs,
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
  }, [userId, socialRefresh]);

  useEffect(() => {
    if (!userId || loading) return;
    let cancelled = false;
    setSuggestionsLoading(true);
    getSuggestedProfiles({ viewerId: userId, limit: 12 }).then((people) => {
      if (!cancelled) setSuggestedPeople(people);
    }).finally(() => { if (!cancelled) setSuggestionsLoading(false); });
    return () => { cancelled = true; };
  }, [userId, loading, socialRefresh]);

  // Expert discovery now loads on the main page.
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

  const handleUnfollow = useCallback(async (expertId: string) => {
    if (!userId || peopleBusy.has(expertId)) return;
    setActionError('');
    setPeopleBusy(prev => new Set(prev).add(expertId));
    const ok = await removeFriend(userId, expertId);
    setPeopleBusy(prev => { const next = new Set(prev); next.delete(expertId); return next; });
    if (!ok) { setActionError("Couldn’t unfollow. Please try again."); return; }
    setFollowedIds(prev => { const next = new Set(prev); next.delete(expertId); return next; });
    setFriends(prev => prev.filter(friend => friend.friend_id !== expertId));
    setExpertFollowerCounts(prev => ({ ...prev, [expertId]: Math.max(0, (prev[expertId] || 0) - 1) }));
    window.dispatchEvent(new Event('follows:changed'));
  }, [userId, peopleBusy]);

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
      setFollowerIds(prev => new Set(prev).add(req.user_id));
      window.dispatchEvent(new Event('follows:changed'));
      void refreshPendingRequests();
    } else {
      setActionError("Couldn't accept that request. Try again.");
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
      setActionError("Couldn't follow back. Try again.");
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
      setActionError("Couldn't decline that request. Try again.");
    }
    setRequestBusy((prev) => { const next = new Set(prev); next.delete(req.id); return next; });
  }, [userId, requestBusy, refreshPendingRequests]);

  // ── Global people search ──────────────────────────────────────────────
  // Debounced lookup of ANY user by username/name once there's a query.
  useEffect(() => {
    if (!userId) { setPeopleResults([]); setPeopleLoading(false); return; }
    const query = searchQuery.trim();
    if (!query) { setPeopleResults([]); setPeopleLoading(false); return; }
    let cancelled = false;
    setPeopleLoading(true);
    setPeopleResults([]);
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
      setActionError("Couldn't follow. Try again.");
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
      setActionError("Couldn't accept. Try again.");
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

  const requestsPending = requests.filter((r) => !acceptedReqIds.has(r.id));

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
            <span className="truncate font-sans font-bold text-[15px] leading-[1.2] tracking-[-0.02em] text-on-surface">{name}</span>
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
              className="hit-44-y inline-flex items-center justify-center gap-1 px-4 h-9 rounded-full bg-primary text-on-primary text-[12.5px] font-bold active:opacity-85 transition-opacity disabled:opacity-60"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              Accept
            </button>
            <button
              type="button"
              onClick={() => handleDeclineRequest(r)}
              disabled={busy}
              className="hit-44-y inline-flex items-center justify-center px-4 h-9 rounded-full border border-on-surface/[0.15] text-[12.5px] font-bold text-on-surface active:bg-on-surface/[0.05] transition-colors disabled:opacity-60"
            >
              Decline
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
            className="hit-44-y flex-shrink-0 inline-flex items-center gap-1 px-3.5 h-9 rounded-full bg-primary text-on-primary text-[12.5px] font-bold active:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} strokeWidth={2.6} />}
            Follow back
          </button>
        )}
      </li>
    );
  };

  /* Friends stay visible alongside discovery results. */
  const renderFriendResults = () => {
    if (friendsFiltered.length === 0) return null;
    return (
      <div>
        <h4 className="px-5 pt-3.5 pb-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/45">Friends</h4>
        <ul>
          {(q || allFriends ? friendsFiltered : friendsFiltered.slice(0, 6)).map((f) => {
            const fp = friendProfiles[f.friend_id];
            const fname = fp?.display_name || fp?.username || 'Friend';
            const fhue = avatarHue(f.friend_id);
            return (
              <li key={f.friend_id} className="social-person-row">
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
                      <span className="truncate font-sans font-bold text-[14.5px] leading-[1.2] tracking-[-0.02em] text-on-surface">{fname}</span>
                      {fp?.is_verified && <VerifiedBadge size={13} className="flex-none" />}
                    </span>
                    {fp?.username && <span className="block mt-[3px] text-[11.5px] leading-[1.2] text-on-surface/50 truncate">@{fp.username}</span>}
                  </span>

                </Link>
                <button className="social-person-message" aria-label={`Message ${fname}`} onClick={() => { onClose?.(); navigate('/messages', { state: { openUserId: f.friend_id } }); }}><MessageCircle size={19} /></button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  // Shared follow controls for search, contacts, and expert discovery.
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
          <Avatar src={p.avatar_url} name={p.display_name || p.username} size={44} />
          {p.is_verified && (
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-surface grid place-items-center ring-1 ring-surface"><VerifiedBadge size={14} /></span>
          )}
        </Link>
        <Link to={`/user/${p.username || ''}`} onClick={() => onClose?.()} className="flex-1 min-w-0 block">
          <span className="block font-sans font-bold text-[14.5px] leading-[1.2] tracking-[-0.02em] text-on-surface truncate">{p.display_name || p.username || 'User'}</span>
          <span className="block mt-[4px] text-[11.5px] leading-[1.2] text-on-surface/50 truncate">{meta}</span>
        </Link>
        {status === 'following' ? (
          <button type="button" onClick={() => handleUnfollow(p.user_id)} disabled={busy} className={quietPill}><Check size={13} /> Following</button>
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

  const discoveryResults = peopleResults.filter(person => !friendsFiltered.some(friend => friend.friend_id === person.user_id));
  const suggestions = suggestedPeople.filter(person => !followedIds.has(person.user_id) && !sentRequestIds.has(person.user_id));
  const requestRows = [...requestsPending, ...requests.filter(request => acceptedReqIds.has(request.id))];
  const body = (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
      <header className="social-circle-header social-people-header flex-shrink-0">
        <div className="flex items-center gap-2">
          {variant === 'page' && <GlassButton id="circle-back" symbol="chevron.left" label="Back" onClick={goBack} className="hit-44 flex-none w-11 h-11 -ml-1 rounded-full grid place-items-center"><ArrowLeft size={19} /></GlassButton>}
          <h2 className="flex-1">Friends</h2>
          {variant === 'overlay' && <GlassButton id="circle-close" symbol="xmark" label="Close panel" onClick={onClose} className="w-11 h-11 rounded-full grid place-items-center"><X size={20} /></GlassButton>}
        </div>
        <div className="pt-3"><SearchField value={searchQuery} onChange={setSearchQuery} placeholder="Names or @usernames" aria-label="Search people" glassId="circle-search-field" /></div>
      </header>
      <div className="social-people-scroll flex-1 min-h-0 overflow-y-auto pb-safe-6">
        {!q && <>
          <div className="social-people-links">
            {profile?.username && <><button onClick={() => { onClose?.(); navigate(`/user/${profile.username}/following`); }}>Following <span>{followedIds.size}</span><ChevronRight size={14} /></button><button onClick={() => { onClose?.(); navigate(`/user/${profile.username}/followers`); }}>Followers <span>{followerIds.size}</span><ChevronRight size={14} /></button></>}
            <button aria-expanded={requestsOpen} aria-controls="circle-requests" onClick={() => { homeHaptic(); setRequestsOpen(value => !value); }}>Requests <span>{requestsPending.length}</span><ChevronDown size={14} /></button>
          </div>
          <div id="circle-requests"><Collapse open={requestsOpen}><section className="social-people-section" aria-label="Follow requests">
            <h3>Follow requests</h3>
            {requestRows.length ? <ul>{requestRows.map(renderRequestRow)}</ul> : <p className="social-people-note">No requests right now.</p>}
          </section></Collapse></div>
          <section className="social-contacts-inline">
            <button className="social-contacts-toggle" aria-expanded={contactsOpen} aria-controls="circle-contacts" onClick={() => { homeHaptic(); setContactsOpen(value => !value); }}><span className="social-contact-symbol"><UserPlus size={20} /></span><span>Find friends from contacts</span><ChevronDown size={16} /></button>
            <div id="circle-contacts"><Collapse open={contactsOpen}>{contactsOpen && <ContactsSync mode="primer" renderPerson={personRow} lacksPhone={!user?.phone} onAddPhone={() => { onClose?.(); navigate('/settings/phone'); }} onOpenSettings={() => { void openAppSettings(); }} />}</Collapse></div>
          </section>
        </>}
        {loading ? <div className="px-5 py-4" aria-label="Loading friends"><PeopleSkeleton /></div> : renderFriendResults()}
        {!q && friends.length > 6 && <button className="social-people-more" onClick={() => setAllFriends(value => !value)}>{allFriends ? 'Show fewer' : `See all ${friends.length} friends`}<ChevronDown size={14} /></button>}
        {q ? <section className="social-people-section" aria-label="People search results">
          {discoveryResults.length > 0 && <><h3>People on GoodEats</h3><ul>{discoveryResults.map((person, index) => personRow(person, person.username ? `@${person.username}` : '', index))}</ul></>}
          {peopleLoading && <div className="social-people-note flex items-center gap-2" role="status"><Loader2 size={16} className="motion-safe:animate-spin" />Searching people…</div>}
          {!peopleLoading && !discoveryResults.length && !friendsFiltered.length && <p className="social-people-note" role="status">No people found. Try another name.</p>}
        </section> : <>
          {!loading && !friends.length && <p className="social-people-note px-5">Find your friends by name or explore people below.</p>}
          {(suggestionsLoading || suggestions.length > 0) && <section className="social-people-section"><h3>Suggested for you</h3><SuggestedPeople people={suggestions} userId={userId} loading={suggestionsLoading} layout="list" bare onFollowed={() => window.dispatchEvent(new Event('follows:changed'))} /></section>}
          {(expertsLoading || experts.length > 0) && <section className="social-people-section"><h3>Verified experts</h3>{expertsLoading && !experts.length ? <PeopleSkeleton /> : <ul>{experts.filter(person => person.user_id !== userId).map((person, index) => personRow(person, [person.username ? `@${person.username}` : '', `${expertRatingCounts[person.user_id] || 0} reviews`, `${formatCount(expertFollowerCounts[person.user_id] || 0)} followers`].filter(Boolean).join(' · '), index))}</ul>}</section>}
        </>}
      </div>
      {actionError && <div className="social-error" role="alert"><span>{actionError}</span><button aria-label="Dismiss error" onClick={() => setActionError('')}><X size={18} /></button></div>}
    </div>
  );

  // ── Variant wrappers ───────────────────────────────────────────────
  if (variant === 'page') {
    return (
      <div className="social-design social-circle flex flex-col h-[100dvh] bg-surface">
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
      className="social-design social-circle fixed top-0 bottom-0 left-0 z-50 bg-surface border-r border-on-surface/[0.08] shadow-2xl flex flex-col"
      style={{ width: 'min(480px, 92vw)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {body}
    </motion.aside>
  );
};


export const CirclePanel: React.FC<CirclePanelProps> = props => <MotionConfig reducedMotion="user"><CirclePanelContent {...props} /></MotionConfig>;
