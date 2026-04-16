import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TopBar } from '../components/TopBar';
import { motion, AnimatePresence } from 'motion/react';
import { Star, Crown, Check, ArrowUpDown, ChevronDown, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { scoreColor, scoreDotBg } from '../lib/score';
import { useAuth } from '../contexts/AuthContext';
import {
  getExpertProfiles, getUserRatings, getFollowCounts, followPublicAccount, getFriends,
  type UserProfile, type CommunityRating,
} from '../lib/supabase-community';

interface ExpertData {
  profile: UserProfile;
  ratings: CommunityRating[];
  followers: number;
}

type ExpertSort = 'recent' | 'reviews' | 'name';

const SORT_LABELS: Record<ExpertSort, string> = {
  recent: 'Recent Activity',
  reviews: 'Most Reviews',
  name: 'A–Z',
};

export const Experts: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [experts, setExperts] = useState<ExpertData[]>([]);
  const [loading, setLoading] = useState(true);

  // Sort + filter
  const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ExpertSort>('recent');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Follow state
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());

  const loadExperts = useCallback(async () => {
    setLoading(true);
    const profiles = await getExpertProfiles();
    if (profiles.length === 0) { setExperts([]); setLoading(false); return; }

    const data = await Promise.all(
      profiles.map(async (p) => {
        const [ratings, counts] = await Promise.all([
          getUserRatings(p.user_id),
          getFollowCounts(p.user_id),
        ]);
        return { profile: p, ratings, followers: counts.followers };
      })
    );
    setExperts(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadExperts(); }, [loadExperts]);

  // Load which experts the current user already follows
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const friends = await getFriends(userId);
      setFollowedIds(new Set(friends.map((f) => f.friend_id)));
    })();
  }, [userId]);

  // Close sort menu on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    if (sortMenuOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortMenuOpen]);

  const handleFollow = async (expertId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!userId) return;
    const ok = await followPublicAccount(userId, expertId);
    if (ok) {
      setFollowedIds((prev) => new Set([...prev, expertId]));
      setExperts((prev) => prev.map((ex) =>
        ex.profile.user_id === expertId
          ? { ...ex, followers: ex.followers + 1 }
          : ex
      ));
    }
  };

  // All unique cuisines across experts (for filter pills)
  const allCuisines = useMemo(() => {
    const counts = new Map<string, number>();
    experts.forEach((e) => {
      e.ratings.forEach((r) => {
        if (r.cuisine) counts.set(r.cuisine, (counts.get(r.cuisine) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [experts]);

  // Filtered + sorted experts for the grid
  const displayExperts = useMemo(() => {
    let list = experts;
    if (cuisineFilter) {
      list = list.filter((e) => e.ratings.some((r) => r.cuisine === cuisineFilter));
    }
    const sorted = [...list];
    switch (sortBy) {
      case 'reviews':
        sorted.sort((a, b) => b.ratings.length - a.ratings.length);
        break;
      case 'name':
        sorted.sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));
        break;
      case 'recent':
      default: {
        sorted.sort((a, b) => {
          const aLatest = a.ratings[0]?.created_at ? new Date(a.ratings[0].created_at).getTime() : 0;
          const bLatest = b.ratings[0]?.created_at ? new Date(b.ratings[0].created_at).getTime() : 0;
          return bLatest - aLatest;
        });
        break;
      }
    }
    return sorted;
  }, [experts, cuisineFilter, sortBy]);

  // Collect all recent reviews across experts
  const recentReviews = experts
    .flatMap((e) => e.ratings.slice(0, 5).map((r) => ({ ...r, expertName: e.profile.display_name, expertUsername: e.profile.username })))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);


  const timeAgo = (date: string) => {
    if (!date) return '';
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  };

  const formatCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  if (loading) {
    return (
      <div className="pb-32">
        <TopBar title="Tastemakers" />
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (experts.length === 0) {
    return (
      <div className="pb-32">
        <TopBar title="Tastemakers" />
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <Crown size={32} className="text-on-surface/15 mb-3" />
          <p className="text-sm font-medium text-on-surface/40">No experts yet</p>
          <p className="text-xs text-on-surface/30 mt-1">Expert reviewers will appear here once they join</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <TopBar title="Tastemakers" />

      <main className="px-3">
        <section className="mb-10">
          <h2 className="text-2xl font-serif font-bold mb-5">Meet the Experts</h2>

          {/* ── Sort + cuisine specialty filters ── */}
          <div className="mb-5">
            {/* Sort dropdown + result count */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40">
                {displayExperts.length} {displayExperts.length === 1 ? 'expert' : 'experts'}
              </p>
              <div className="relative" ref={sortMenuRef}>
                <button
                  onClick={() => setSortMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-on-surface/[0.05] text-xs font-semibold text-on-surface/70 hover:bg-on-surface/[0.08] transition-colors"
                >
                  <ArrowUpDown size={12} />
                  <span>{SORT_LABELS[sortBy]}</span>
                  <ChevronDown size={12} className={cn("transition-transform", sortMenuOpen && "rotate-180")} />
                </button>
                <AnimatePresence>
                  {sortMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                      transition={{ duration: 0.12 }}
                      className="absolute top-full right-0 mt-1.5 w-48 bg-surface rounded-2xl shadow-lg border border-on-surface/[0.08] overflow-hidden z-20"
                    >
                      {(Object.keys(SORT_LABELS) as ExpertSort[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => { setSortBy(s); setSortMenuOpen(false); }}
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-left transition-colors",
                            sortBy === s ? "bg-primary/8 text-primary" : "text-on-surface/70 hover:bg-on-surface/[0.04]"
                          )}
                        >
                          <span>{SORT_LABELS[s]}</span>
                          {sortBy === s && <Check size={14} />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Cuisine specialty filter pills */}
            {allCuisines.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                <button
                  onClick={() => setCuisineFilter(null)}
                  className={cn(
                    "px-3.5 h-8 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-colors",
                    cuisineFilter === null
                      ? "bg-primary text-white"
                      : "bg-on-surface/[0.05] text-on-surface/60 hover:bg-on-surface/[0.08]"
                  )}
                >
                  All cuisines
                </button>
                {allCuisines.map((cuisine) => (
                  <button
                    key={cuisine}
                    onClick={() => setCuisineFilter(cuisineFilter === cuisine ? null : cuisine)}
                    className={cn(
                      "px-3.5 h-8 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-colors",
                      cuisineFilter === cuisine
                        ? "bg-primary text-white"
                        : "bg-on-surface/[0.05] text-on-surface/60 hover:bg-on-surface/[0.08]"
                    )}
                  >
                    {cuisine}
                  </button>
                ))}
              </div>
            )}
          </div>

          {displayExperts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Crown size={28} className="text-on-surface/15 mb-3" />
              <p className="text-sm font-medium text-on-surface/40">No experts match that cuisine</p>
              {cuisineFilter && (
                <button onClick={() => setCuisineFilter(null)} className="mt-2 text-xs font-semibold text-primary">
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {displayExperts.map((e) => {
                const isFollowed = followedIds.has(e.profile.user_id);
                return (
                  <Link key={e.profile.user_id} to={`/user/${e.profile.username}`}>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="relative aspect-square rounded-3xl overflow-hidden group cursor-pointer"
                    >
                      <div className="h-full w-full bg-gradient-to-br from-amber-100 to-primary/10 flex items-center justify-center">
                        <span className="text-5xl font-serif font-bold text-primary/30">{e.profile.display_name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                      {/* Bottom content area: name + stats on left, follow pill on right */}
                      <div className="absolute inset-x-5 bottom-5 text-white flex items-end justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Crown size={11} className="text-amber-400" />
                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">Expert</p>
                          </div>
                          <h3 className="font-serif text-xl font-bold leading-tight mb-1 truncate">{e.profile.display_name}</h3>
                          <p className="text-[12px] font-medium text-white/80 truncate">
                            {formatCount(e.ratings.length)} reviews · {formatCount(e.followers)} followers
                          </p>
                        </div>
                        {/* Follow pill — overlaid on gradient, bottom-right */}
                        {isFollowed ? (
                          <div className="flex-shrink-0 flex items-center gap-1 px-2.5 h-8 rounded-full bg-white/15 backdrop-blur-md border border-white/25">
                            <Check size={12} className="text-white/90" />
                            <span className="text-[11px] font-bold text-white/90">Following</span>
                          </div>
                        ) : (
                          <button
                            onClick={(evt) => handleFollow(e.profile.user_id, evt)}
                            className="flex-shrink-0 px-3.5 h-8 rounded-full bg-white text-on-surface text-[11px] font-bold shadow-sm hover:bg-white/95 active:scale-[0.97] transition-all"
                          >
                            Follow
                          </button>
                        )}
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent expert reviews — minimal timeline layout */}
        {displayExperts.map((e) => {
          const topRatings = e.ratings.slice(0, 4);
          if (topRatings.length === 0) return null;
          return (
            <section key={e.profile.user_id} className="mb-8">
              <Link to={`/user/${e.profile.username}`} className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center">
                  <span className="text-sm font-serif font-bold text-amber-700">{e.profile.display_name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold">{e.profile.display_name}</h3>
                    <Crown size={12} className="text-amber-500" />
                  </div>
                  <p className="text-[11px] text-on-surface/40">@{e.profile.username}</p>
                </div>
              </Link>
              {/* Timeline: colored dot → score → restaurant → date */}
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-on-surface/[0.08]" />
                {topRatings.map((r) => {
                  const score = Number(r.score);
                  return (
                    <Link
                      key={r.id}
                      to={`/restaurant/${r.restaurant_id}`}
                      className="relative block py-2.5 group"
                    >
                      {/* Dot */}
                      <div
                        className={cn(
                          "absolute -left-[18px] top-[14px] w-3.5 h-3.5 rounded-full ring-4 ring-surface",
                          scoreDotBg(score)
                        )}
                      />
                      <div className="flex items-baseline gap-2.5">
                        <span className={cn("font-serif font-bold text-base leading-none flex-shrink-0", scoreColor(score))}>
                          {score.toFixed(1)}
                        </span>
                        <h4 className="font-semibold text-sm text-on-surface truncate flex-1 min-w-0 leading-tight">
                          {r.restaurant_name}
                        </h4>
                        <span className="text-[11px] text-on-surface/35 flex-shrink-0 leading-none">
                          {timeAgo(r.created_at)}
                        </span>
                      </div>
                      {r.cuisine && (
                        <p className="text-[11px] text-on-surface/40 mt-1 uppercase tracking-wider font-semibold">
                          {r.cuisine}{r.price ? ` · ${r.price}` : ''}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}

        {recentReviews.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-serif font-bold mb-8">Latest Expert Reviews</h2>
            <ul className="divide-y divide-on-surface/[0.08]">
              {recentReviews.map((review) => (
                <li key={review.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="py-7"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <Link to={`/user/${review.expertUsername}`} className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                          <span className="text-sm font-serif font-bold text-amber-700">{review.expertName.charAt(0).toUpperCase()}</span>
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">{review.expertName}</h4>
                          <p className="text-[11px] text-on-surface/40 uppercase tracking-widest mt-0.5">{timeAgo(review.created_at)}</p>
                        </div>
                      </Link>
                      <div className="flex items-center gap-1 text-primary">
                        <Star size={14} className="fill-primary" />
                        <span className="text-sm font-bold">{Number(review.score).toFixed(1)}</span>
                      </div>
                    </div>

                    <Link to={`/restaurant/${review.restaurant_id}`} className="block group">
                      <h3 className="font-serif text-2xl font-bold mb-2 leading-tight">{review.restaurant_name}</h3>
                      {review.notes && (
                        <div className="relative pl-4">
                          <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-primary/40 rounded-full" />
                          <p className="text-[15px] text-on-surface/70 leading-relaxed italic">
                            "{review.notes}"
                          </p>
                        </div>
                      )}
                      <p className="mt-3 text-[11px] font-bold text-primary uppercase tracking-widest group-hover:text-primary/80 transition-colors">
                        View restaurant →
                      </p>
                    </Link>
                  </motion.div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
};
