import { usePageBack } from '../lib/usePageBack';
import '../components/social/SocialDesign.css';
/**
 * FollowList — the follower / following (and own rated) lists behind a
 * profile's stat row, presented as a SHEET: it rises from the bottom over
 * the profile, which stays behind it (App.tsx `isSheetRoute`). So it is
 * built like a sheet rather than a page — a grabber you can drag down to
 * dismiss, fixed chrome, and one internal scroll area, because the route
 * wrapper is a fixed-height box and the document itself does not scroll.
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
import { motion, useDragControls } from 'motion/react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Loader2, Lock, MapPin, Search, Star, UserCircle, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { Avatar } from '../components/Avatar';
import { ScoreBadge } from '../components/ScoreBadge';
import { SearchField } from '../components/SearchField';
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

/**
 * The sheet shell: a grabber you can drag down to dismiss, a title row,
 * optional fixed chrome (tabs + search), and ONE internal scroll area —
 * the route wrapper is a fixed-height box (App.tsx presents sheet routes
 * absolutely), so the document itself never scrolls here.
 *
 * Declared at module scope, not inside the page: a component defined in a
 * render body is a new type on every render, so React would tear the whole
 * subtree down and rebuild it — the search field would lose focus on every
 * keystroke.
 */
const Sheet: React.FC<{
  title: string;
  subtitle?: string;
  onDismiss: () => void;
  children: React.ReactNode;
  chrome?: React.ReactNode;
}> = ({ title, subtitle, onDismiss, children, chrome }) => {
  // The listener is off by default and started by hand from the grabber and
  // title row only — starting it from the whole header would swallow taps on
  // the tabs and the search field.
  const dragControls = useDragControls();
  return (
    <motion.div
      className="social-design social-follow-sheet absolute inset-0 flex flex-col bg-surface"
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        // A decisive pull or a fast flick dismisses; anything less springs back.
        if (info.offset.y > 110 || info.velocity.y > 700) onDismiss();
      }}
    >
      <div className="flex-none border-b border-on-surface/[0.07]">
        <div
          className="cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
          // The sheet covers the whole screen, status bar included, so the
          // grabber owns the inset rather than sitting under the clock.
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
        >
          <div className="mx-auto h-[5px] w-10 rounded-full bg-on-surface/20" aria-hidden />
          <div className="mx-auto flex max-w-[560px] items-center gap-3 px-5 pb-3 pt-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-on-surface" style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em' }}>{title}</h1>
              {subtitle && <p className="mt-1 truncate text-on-surface/45" style={{ fontSize: '12.5px' }}>{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-on-surface/[0.06] text-on-surface/70 transition-colors active:bg-on-surface/[0.12]"
            >
              <ChevronDown size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        {chrome}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        <div className="mx-auto max-w-[560px]">{children}</div>
      </div>
    </motion.div>
  );
};

export const FollowList: React.FC = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const goBack = usePageBack('/circle');
  const location = useLocation();
  const { user } = useAuth();
  const { requireSignIn } = useSignInModal();
  const { showToast } = useToast();
  const listsCtx = useLists();
  const userId = user?.id ?? null;
  /** Back where we came from; a deep link has nowhere to go back TO, so it
   *  falls through to the profile this list belongs to. */
  const dismiss = () => {
    const idx = typeof window.history.state?.idx === 'number' ? window.history.state.idx : 0;
    goBack();
  };

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
      <Sheet title=" " onDismiss={dismiss}>
        <div className="flex flex-col items-center py-20 text-on-surface/40">
          <Loader2 size={26} className="animate-spin" />
        </div>
      </Sheet>
    );
  }

  if (!profile) {
    return (
      <Sheet title="Not found" onDismiss={dismiss}>
        <div className="px-8 py-16 text-center">
          <UserCircle size={44} className="mx-auto mb-3 text-on-surface/15" />
          <p className="text-on-surface" style={{ fontSize: '15px', fontWeight: 700 }}>This person isn't here</p>
          <p className="mt-1 text-on-surface/45" style={{ fontSize: '13px' }}>The account was removed, or the link is wrong.</p>
        </div>
      </Sheet>
    );
  }

  const tabs: { key: Tab; count: number; label: string }[] = [
    ...(isOwnProfile ? [{ key: 'rated' as Tab, count: ratings.length, label: 'Rated' }] : []),
    { key: 'followers', count: counts.followers, label: 'Followers' },
    { key: 'following', count: counts.following, label: 'Following' },
  ];

  const rowButton = (p: UserProfileType): React.ReactNode => {
    if (userId && p.user_id === userId) return null; // that's me — no button
    const isBusy = busy.has(p.user_id);
    const quiet = 'flex-none h-9 px-4 rounded-full bg-on-surface/[0.06] text-on-surface/80 disabled:opacity-50 active:bg-on-surface/[0.12] transition-colors';
    if (isOwnProfile && tab === 'followers') {
      return (
        <button type="button" onClick={() => void handleRemoveFollower(p.user_id)} disabled={isBusy} className={quiet} style={{ fontSize: '12.5px', fontWeight: 700 }}>
          {isBusy ? 'Removing…' : 'Remove'}
        </button>
      );
    }
    if (userId && myFollowing.has(p.user_id)) {
      return (
        <button type="button" onClick={() => void handleUnfollow(p.user_id)} disabled={isBusy} className={quiet} style={{ fontSize: '12.5px', fontWeight: 700 }}>
          Following
        </button>
      );
    }
    if (userId && myRequested.has(p.user_id)) {
      return (
        <button type="button" disabled className="flex-none h-9 px-4 rounded-full bg-on-surface/[0.04] text-on-surface/40 cursor-default" style={{ fontSize: '12.5px', fontWeight: 700 }}>
          Requested
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => handleFollow(p)}
        disabled={isBusy}
        className="flex-none h-9 px-4 rounded-full bg-primary text-on-primary disabled:opacity-50 active:opacity-85 transition-opacity"
        style={{ fontSize: '12.5px', fontWeight: 700 }}
      >
        Follow
      </button>
    );
  };

  const emptyState = (title: string, message: string, icon: React.ReactNode) => (
    <div className="px-8 py-16 text-center">
      <div className="mx-auto mb-3.5 grid h-14 w-14 place-items-center rounded-full bg-on-surface/[0.05] text-on-surface/30">
        {icon}
      </div>
      <p className="text-on-surface" style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-on-surface/45" style={{ fontSize: '13px', lineHeight: 1.45 }}>{message}</p>
    </div>
  );

  const title = profile.display_name || profile.username || 'Profile';
  const subtitle = profile.username ? `@${profile.username}` : undefined;

  if (!canView) {
    return (
      <Sheet title={title} subtitle={subtitle} onDismiss={dismiss}>
        <div className="px-8 pb-16 pt-12 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-on-surface/[0.05]">
            <Lock size={24} className="text-on-surface/35" />
          </div>
          <p className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em' }}>This account is private</p>
          <p className="mx-auto mt-1.5 max-w-[280px] text-on-surface/50" style={{ fontSize: '13.5px', lineHeight: 1.5 }}>
            Follow {profile.display_name} to see who they follow and who follows them.
          </p>
        </div>
      </Sheet>
    );
  }

  const chrome = (
    <div className="mx-auto max-w-[560px] px-5 pb-3">
      {/* Segmented control — the same connected track the profile uses. */}
      <div className="flex rounded-full bg-on-surface/[0.05] p-1" role="tablist">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                if (t.key === tab) return;
                setQuery('');
                navigate(`/user/${encodeURIComponent(username || '')}/${t.key}`, { replace: true });
              }}
              className={cn(
                'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full py-2 transition-colors',
                on
                  ? 'bg-surface dark:bg-on-surface/[0.14] text-on-surface shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
                  : 'text-on-surface/55 active:text-on-surface',
              )}
              style={{ fontSize: '12.5px', fontWeight: 700 }}
            >
              <span className="tabular-nums">{t.count}</span>
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <SearchField
          glassId="follow-search"
          value={query}
          onChange={setQuery}
          placeholder={tab === 'rated' ? 'Search your ratings' : 'Search people'}
          aria-label={tab === 'rated' ? 'Search your ratings' : 'Search people'}
        />
      </div>
    </div>
  );

  return (
    <Sheet title={title} subtitle={subtitle} onDismiss={dismiss} chrome={chrome}>
      {tab === 'rated' ? (
        filteredRatings.length === 0 ? (
          q
            ? emptyState('No matches', 'Try a different restaurant, cuisine or city.', <Search size={22} strokeWidth={1.9} />)
            : emptyState('Nothing rated yet', 'Rate a place and it shows up here, best first.', <Star size={22} strokeWidth={1.9} />)
        ) : (
          <ol className="px-3 pt-1">
            {filteredRatings.map((r, i) => (
              <li key={r.restaurantId}>
                <Link
                  to={`/restaurant/${r.restaurantId}`}
                  className="flex items-center gap-3.5 rounded-[18px] px-2 py-2.5 active:bg-on-surface/[0.05] transition-colors"
                >
                  <span className="w-6 flex-none text-right font-sans text-[15px] font-bold leading-none tabular-nums text-on-surface/30">{i + 1}</span>
                  <div className="h-12 w-12 flex-none overflow-hidden rounded-[14px] bg-on-surface/[0.06] flex items-center justify-center">
                    {r.image ? (
                      <img src={r.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <MapPin size={16} className="text-on-surface/30" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.015em' }}>{r.name}</p>
                    <p className="mt-1 truncate text-on-surface/45" style={{ fontSize: '12px' }}>
                      {[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <ScoreBadge rating={r.score} size="sm" />
                </Link>
              </li>
            ))}
          </ol>
        )
      ) : (
        // `people` is null until this tab's first fetch lands — spinner
        // (listLoading alone would flash the empty state pre-effect).
        !people ? (
          <div className="flex flex-col items-center py-16 text-on-surface/40">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : !filteredPeople || filteredPeople.length === 0 ? (
          q
            ? emptyState('No matches', 'Try a different name or username.', <Search size={22} strokeWidth={1.9} />)
            : tab === 'followers'
              ? emptyState(
                  isOwnProfile ? 'No followers yet' : `${profile.display_name} has no followers yet`,
                  isOwnProfile ? 'When people follow you, they’ll show up here.' : 'When people follow them, they’ll show up here.',
                  <Users size={22} strokeWidth={1.9} />,
                )
              : emptyState(
                  isOwnProfile ? 'Not following anyone yet' : `${profile.display_name} isn’t following anyone yet`,
                  isOwnProfile ? 'Find friends and experts to follow from the Circle page.' : 'Accounts they follow will show up here.',
                  <Users size={22} strokeWidth={1.9} />,
                )
        ) : (
          <ul className="px-3 pt-1">
            {filteredPeople.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3 rounded-[18px] px-2 py-2 active:bg-on-surface/[0.05] transition-colors">
                <Link
                  to={`/user/${encodeURIComponent(p.username || '')}`}
                  className="flex min-w-0 flex-1 items-center gap-3.5 py-1"
                >
                  <Avatar src={p.avatar_url} name={p.display_name || p.username || 'User'} size={46} />
                  <div className="min-w-0 flex-1">
                    <p className="inline-flex max-w-full items-center gap-1.5 truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.015em' }}>
                      <span className="truncate">{p.display_name || p.username || 'User'}</span>
                      {p.is_verified && <VerifiedBadge size={13} />}
                    </p>
                    <p className="mt-1 truncate text-on-surface/45" style={{ fontSize: '12px' }}>@{p.username || 'user'}</p>
                  </div>
                </Link>
                {rowButton(p)}
              </li>
            ))}
          </ul>
        )
      )}
    </Sheet>
  );
};
