/**
 * FollowList — full-page follower / following (and own rated) lists,
 * Instagram-style: back header with the username, count tabs, a search
 * field, and rows with a contextual action button. Replaces the old
 * Profile stat bottom-sheet, whose bottom the phone nav bar covered.
 *
 * Routes:
 *   /user/:username/followers
 *   /user/:username/following
 *   /user/:username/rated      (own profile only — other people's ratings
 *                               already live on their profile page)
 *
 * Anyone's lists are viewable when the viewer can view the profile at all
 * (public account, own profile, or accepted follow). The get_follow_list
 * RPC (migration 062) enforces the same rule server-side, so a blocked
 * viewer's request returns no ids — this page's lock screen is cosmetic.
 *
 * Row actions mirror Instagram:
 *   · my followers list  → "Remove" (revokes their follow of me)
 *   · anyone I follow    → "Following" (tap to unfollow)
 *   · pending request    → "Requested" (disabled)
 *   · everyone else      → "Follow" (instant for public/verified accounts,
 *                          request for private ones; sign-in gated)
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Heart, Loader2, Lock, MapPin, Search, Star, UserCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { ScoreBadge } from '../components/ScoreBadge';
import {
  getProfileByUsername, canViewProfile, getFollowCounts, getFollowListIds,
  getProfilesByIds, getFriends, getSentRequestIds, followPublicAccount,
  sendFriendRequest, removeFriend, removeFollower,
  type UserProfile as UserProfileType,
} from '../lib/supabase-community';

type Tab = 'rated' | 'followers' | 'following';

/** Other pages (the keep-alive Profile tab especially) listen for this to
 *  refetch follow counts after an action taken here changes them. */
const emitFollowsChanged = () => window.dispatchEvent(new Event('follows:changed'));

export const FollowList: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { showToast } = useToast();
  const listsCtx = useLists();
  const userId = user?.id ?? null;

  // Active tab is the last path segment (/user/:username/<tab>).
  const rawTab = location.pathname.split('/').filter(Boolean).pop();
  const tab: Tab = rawTab === 'rated' || rawTab === 'following' ? rawTab : 'followers';

  const [profile, setProfile] = useState<UserProfileType | null>(null);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });

  // People lists cached per tab so switching back doesn't flash empty
  // (null = never loaded → spinner; a revisit revalidates behind the cache).
  const [listsByTab, setListsByTab] = useState<Partial<Record<'followers' | 'following', UserProfileType[]>>>({});

  // My relationship to every listed user — drives the row buttons.
  const [myFollowing, setMyFollowing] = useState<Set<string>>(new Set());
  const [myRequested, setMyRequested] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState('');

  const isOwnProfile = !!profile && userId === profile.user_id;
  const ratings = Array.isArray(listsCtx.ratings) ? listsCtx.ratings : [];

  // ── Profile + visibility + counts ──────────────────────────────────────
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const p = await getProfileByUsername(username);
      if (cancelled) return;
      setProfile(p);
      if (!p) { setLoading(false); return; }
      // canViewProfile already returns true for public accounts and self.
      const viewable = userId ? await canViewProfile(userId, p) : !!p.is_public;
      if (cancelled) return;
      setCanView(viewable);
      setLoading(false);
      getFollowCounts(p.user_id).then((c) => { if (!cancelled) setCounts(c); });
    })();
    return () => { cancelled = true; };
  }, [username, userId]);

  // The rated tab is own-profile only — bounce anyone else to followers.
  useEffect(() => {
    if (tab === 'rated' && profile && userId !== profile.user_id) {
      navigate(`/user/${encodeURIComponent(username || '')}/followers`, { replace: true });
    }
  }, [tab, profile, userId, username, navigate]);

  // ── The active tab's people list ───────────────────────────────────────
  useEffect(() => {
    if (!profile || !canView || (tab !== 'followers' && tab !== 'following')) return;
    let cancelled = false;
    (async () => {
      const ids = await getFollowListIds(profile.user_id, tab);
      if (cancelled) return;
      let list: UserProfileType[] = [];
      if (ids.length > 0) {
        const profMap = await getProfilesByIds(ids);
        if (cancelled) return;
        // Preserve id order — the RPC returns newest follows first.
        list = ids.map((id) => profMap[id]).filter(Boolean) as UserProfileType[];
      }
      setListsByTab((m) => ({ ...m, [tab]: list }));
    })();
    return () => { cancelled = true; };
  }, [profile, canView, tab]);

  // ── My follow graph (row button states) ────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [friends, sent] = await Promise.all([getFriends(userId), getSentRequestIds(userId)]);
      if (cancelled) return;
      setMyFollowing(new Set(friends.map((f) => f.friend_id)));
      setMyRequested(new Set(sent));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── Actions ────────────────────────────────────────────────────────────
  const withBusy = async (id: string, run: () => Promise<void>) => {
    if (busy.has(id)) return;
    setBusy((prev) => new Set(prev).add(id));
    try { await run(); } finally {
      setBusy((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  // Revoke someone's follow of ME (own followers tab).
  const handleRemoveFollower = (followerId: string) => withBusy(followerId, async () => {
    if (!userId) return;
    const ok = await removeFollower(userId, followerId);
    if (!ok) { showToast("Couldn't remove that follower. Try again."); return; }
    setListsByTab((m) => ({ ...m, followers: (m.followers || []).filter((p) => p.user_id !== followerId) }));
    setCounts((c) => ({ ...c, followers: Math.max(0, c.followers - 1) }));
    emitFollowsChanged();
  });

  // Unfollow — the row stays (button flips to Follow) so it's undoable.
  const handleUnfollow = (targetId: string) => withBusy(targetId, async () => {
    if (!userId) return;
    const ok = await removeFriend(userId, targetId);
    if (!ok) { showToast("Couldn't unfollow. Try again."); return; }
    setMyFollowing((prev) => { const n = new Set(prev); n.delete(targetId); return n; });
    if (isOwnProfile) setCounts((c) => ({ ...c, following: Math.max(0, c.following - 1) }));
    emitFollowsChanged();
  });

  const handleFollow = (p: UserProfileType) => {
    if (!userId) { requireSignIn('Sign in to follow'); return; }
    void withBusy(p.user_id, async () => {
      if (p.is_public || p.is_verified) {
        const ok = await followPublicAccount(userId, p.user_id);
        if (!ok) { showToast("Couldn't follow. Try again."); return; }
        setMyFollowing((prev) => new Set(prev).add(p.user_id));
        if (isOwnProfile) setCounts((c) => ({ ...c, following: c.following + 1 }));
      } else {
        const ok = await sendFriendRequest(userId, p.user_id);
        if (!ok) { showToast("Couldn't send that request. Try again."); return; }
        setMyRequested((prev) => new Set(prev).add(p.user_id));
      }
      emitFollowsChanged();
    });
  };

  // ── Filtered rows ──────────────────────────────────────────────────────
  const people = tab === 'rated' ? [] : (listsByTab[tab] ?? null);
  const q = query.trim().toLowerCase();
  const filteredPeople = useMemo(() => {
    if (!people) return null;
    if (!q) return people;
    return people.filter((p) =>
      (p.display_name || '').toLowerCase().includes(q) ||
      (p.username || '').toLowerCase().includes(q));
  }, [people, q]);

  const sortedRatings = useMemo(
    () => [...ratings].sort((a, b) => b.score - a.score),
    [ratings],
  );
  const filteredRatings = useMemo(() => {
    if (!q) return sortedRatings;
    return sortedRatings.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.cuisine || '').toLowerCase().includes(q) ||
      (r.address || '').toLowerCase().includes(q));
  }, [sortedRatings, q]);

  // ── Early screens ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-surface">
        <header className="sticky top-0 px-4 pt-safe-3 pb-3 bg-surface/70 backdrop-blur-md z-10 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-on-surface/50" aria-label="Back"><ArrowLeft size={20} /></button>
          <h1 className="font-serif font-bold text-lg">User Not Found</h1>
        </header>
        <div className="text-center py-16">
          <UserCircle size={48} className="mx-auto text-on-surface/15 mb-3" />
          <p className="text-sm text-on-surface/40">This user doesn't exist</p>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; count: number; label: string }[] = [
    ...(isOwnProfile ? [{ key: 'rated' as Tab, count: ratings.length, label: 'rated' }] : []),
    { key: 'followers', count: counts.followers, label: counts.followers === 1 ? 'follower' : 'followers' },
    { key: 'following', count: counts.following, label: 'following' },
  ];

  const rowButton = (p: UserProfileType): React.ReactNode => {
    if (userId && p.user_id === userId) return null; // that's me — no button
    const isBusy = busy.has(p.user_id);
    if (isOwnProfile && tab === 'followers') {
      return (
        <button
          type="button"
          onClick={() => void handleRemoveFollower(p.user_id)}
          disabled={isBusy}
          className="flex-none h-8 px-3.5 rounded-full border border-on-surface/15 text-[12.5px] font-semibold text-on-surface/70 hover:bg-on-surface/[0.06] disabled:opacity-50 transition-colors"
        >
          {isBusy ? 'Removing…' : 'Remove'}
        </button>
      );
    }
    if (userId && myFollowing.has(p.user_id)) {
      return (
        <button
          type="button"
          onClick={() => void handleUnfollow(p.user_id)}
          disabled={isBusy}
          className="flex-none h-8 px-3.5 rounded-full border border-on-surface/15 text-[12.5px] font-semibold text-on-surface/70 hover:bg-on-surface/[0.06] disabled:opacity-50 transition-colors"
        >
          Following
        </button>
      );
    }
    if (userId && myRequested.has(p.user_id)) {
      return (
        <button type="button" disabled className="flex-none h-8 px-3.5 rounded-full bg-on-surface/[0.06] text-[12.5px] font-semibold text-ink-3 cursor-default">
          Requested
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => handleFollow(p)}
        disabled={isBusy}
        className="flex-none h-8 px-4 rounded-full bg-on-surface text-surface text-[12.5px] font-bold hover:bg-primary disabled:opacity-50 transition-colors"
      >
        Follow
      </button>
    );
  };

  const emptyState = (title: string, message: string, icon: React.ReactNode) => (
    <div className="py-16 text-center px-8">
      <div className="w-14 h-14 mx-auto rounded-full bg-on-surface/[0.05] grid place-items-center text-on-surface/25 mb-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-on-surface/55">{title}</p>
      <p className="text-xs text-on-surface/35 mt-1">{message}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface pb-24">
      {/* header — back on the left, the profile's username centered */}
      <header className="sticky top-0 z-30 bg-surface/85 backdrop-blur-xl border-b border-line">
        <div className="mx-auto max-w-[560px] grid grid-cols-[44px_1fr_44px] items-center px-2 pt-safe-3 pb-2">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full grid place-items-center text-on-surface hover:bg-on-surface/[0.06] transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-[15.5px] font-bold text-on-surface text-center truncate">
            {profile.username}
          </h1>
        </div>

        {/* tabs — solid equal-width grid (no scroll, no drag) */}
        {canView && (
          <div className={cn('mx-auto max-w-[560px] grid', isOwnProfile ? 'grid-cols-3' : 'grid-cols-2')}>
            {tabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    if (t.key === tab) return;
                    setQuery('');
                    navigate(`/user/${encodeURIComponent(username || '')}/${t.key}`, { replace: true });
                  }}
                  className="relative py-3 text-center"
                >
                  <span className={cn(
                    'text-[13.5px] whitespace-nowrap',
                    active ? 'font-bold text-on-surface' : 'font-semibold text-ink-3',
                  )}>
                    <span className="tabular-nums">{t.count}</span> {t.label}
                  </span>
                  {active && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[2px] rounded-full bg-on-surface" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {!canView ? (
        // Private account the viewer doesn't follow — mirror UserProfile's
        // lock screen (the RPC returns nothing for them anyway).
        <section className="text-center pt-14 pb-20 px-8 mx-auto max-w-[560px]">
          <div className="w-16 h-16 mx-auto rounded-full bg-on-surface/[0.05] grid place-items-center mb-4">
            <Lock size={26} className="text-ink-3" />
          </div>
          <h3 className="font-serif text-[20px] font-bold text-on-surface mb-1.5">This account is private</h3>
          <p className="text-[13.5px] leading-relaxed text-ink-3">
            Follow {profile.display_name} to see who they follow and who follows them.
          </p>
        </section>
      ) : (
        <div className="mx-auto max-w-[560px]">
          {/* search */}
          <div className="px-4 pt-3 pb-1">
            <div className="relative flex items-center">
              <Search size={16} className="absolute left-3.5 text-ink-3 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full h-10 pl-10 pr-9 rounded-xl bg-on-surface/[0.05] focus:outline-none focus:ring-2 focus:ring-on-surface/10 text-[14px] font-medium text-on-surface placeholder:text-ink-3"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-3 text-ink-3 hover:text-on-surface" aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* ── Rated (own profile only) ── */}
          {tab === 'rated' ? (
            filteredRatings.length === 0 ? (
              q
                ? emptyState('No matches', 'Try a different restaurant, cuisine or city.', <Search size={24} strokeWidth={1.8} />)
                : emptyState('No rated restaurants yet', 'Rate places to see them here.', <Star size={24} strokeWidth={1.8} />)
            ) : (
              <ul className="divide-y divide-on-surface/[0.06] mt-1">
                {filteredRatings.map((r) => (
                  <li key={r.restaurantId}>
                    <Link
                      to={`/restaurant/${r.restaurantId}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-on-surface/[0.03] transition-colors"
                    >
                      <div className="w-11 h-11 rounded-xl bg-on-surface/[0.05] overflow-hidden flex-none flex items-center justify-center">
                        {r.image ? (
                          <img src={r.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <MapPin size={15} className="text-on-surface/30" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-serif font-bold text-on-surface truncate leading-tight">{r.name}</p>
                        <p className="text-[11.5px] text-on-surface/45 truncate mt-0.5">
                          {[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <ScoreBadge rating={r.score} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : (
            /* ── Followers / Following ── */
            // `people` is null until this tab's first fetch lands — spinner
            // (listLoading alone would flash the empty state pre-effect).
            !people ? (
              <div className="py-16 flex flex-col items-center text-center">
                <div className="w-6 h-6 rounded-full border-2 border-on-surface/15 border-t-primary animate-spin" />
                <p className="text-xs text-on-surface/45 mt-3">Loading…</p>
              </div>
            ) : !filteredPeople || filteredPeople.length === 0 ? (
              q
                ? emptyState('No matches', 'Try a different name or username.', <Search size={24} strokeWidth={1.8} />)
                : tab === 'followers'
                  ? emptyState(
                      isOwnProfile ? 'No followers yet' : `${profile.display_name} has no followers yet`,
                      isOwnProfile ? 'When people follow you, they’ll show up here.' : 'When people follow them, they’ll show up here.',
                      <Heart size={24} strokeWidth={1.8} />,
                    )
                  : emptyState(
                      isOwnProfile ? 'Not following anyone yet' : `${profile.display_name} isn’t following anyone yet`,
                      isOwnProfile ? 'Find friends and experts to follow from the Circle page.' : 'Accounts they follow will show up here.',
                      <Heart size={24} strokeWidth={1.8} />,
                    )
            ) : (
              <ul className="mt-1">
                {filteredPeople.map((p) => (
                  <li key={p.user_id} className="flex items-center gap-3 px-4 py-2 hover:bg-on-surface/[0.03] transition-colors">
                    <Link
                      to={`/user/${encodeURIComponent(p.username || '')}`}
                      className="flex items-center gap-3 flex-1 min-w-0 py-1"
                    >
                      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center flex-none">
                        <span className="text-[15px] font-serif font-bold text-primary">
                          {(p.display_name?.charAt(0) || p.username?.charAt(0) || '?').toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-on-surface truncate leading-tight inline-flex items-center gap-1.5 max-w-full">
                          <span className="truncate">{p.display_name || p.username || 'User'}</span>
                          {p.is_verified && <VerifiedBadge size={13} />}
                        </p>
                        <p className="text-[11.5px] text-on-surface/45 truncate mt-0.5">@{p.username || 'user'}</p>
                      </div>
                    </Link>
                    {rowButton(p)}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
};
