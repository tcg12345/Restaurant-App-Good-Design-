import React, { useState, useEffect, useCallback } from 'react';
import { TopBar } from '../components/TopBar';
import { motion } from 'motion/react';
import { Star, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import {
  getExpertProfiles, getUserRatings, getFollowCounts,
  type UserProfile, type CommunityRating,
} from '../lib/supabase-community';

interface ExpertData {
  profile: UserProfile;
  ratings: CommunityRating[];
  followers: number;
}

export const Experts: React.FC = () => {
  const [experts, setExperts] = useState<ExpertData[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Collect all recent reviews across experts
  const recentReviews = experts
    .flatMap((e) => e.ratings.slice(0, 5).map((r) => ({ ...r, expertName: e.profile.display_name, expertUsername: e.profile.username })))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  const scoreColor = (s: number) => s >= 8 ? 'text-green-600' : s >= 5 ? 'text-yellow-600' : 'text-red-500';

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
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
        <section className="mb-12">
          <h2 className="text-2xl font-serif font-bold mb-6">Meet the Experts</h2>

          <div className="grid grid-cols-2 gap-4">
            {experts.map((e) => (
              <Link key={e.profile.user_id} to={`/user/${e.profile.username}`}>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  className="relative aspect-square rounded-3xl overflow-hidden group cursor-pointer"
                >
                  <div className="h-full w-full bg-gradient-to-br from-amber-100 to-primary/10 flex items-center justify-center">
                    <span className="text-5xl font-serif font-bold text-primary/30">{e.profile.display_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  <div className="absolute bottom-6 left-6 right-6 text-white">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Crown size={11} className="text-amber-400" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">Expert</p>
                    </div>
                    <h3 className="font-serif text-2xl font-bold leading-tight mb-2">{e.profile.display_name}</h3>
                    <p className="text-xs font-medium text-white/80">
                      {formatCount(e.ratings.length)} Review{e.ratings.length !== 1 ? 's' : ''} · {formatCount(e.followers)} Follower{e.followers !== 1 ? 's' : ''}
                    </p>
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>
        </section>

        {/* Recent expert reviews with mini cards under each */}
        {experts.map((e) => {
          const topRatings = e.ratings.slice(0, 3);
          if (topRatings.length === 0) return null;
          return (
            <section key={e.profile.user_id} className="mb-8">
              <Link to={`/user/${e.profile.username}`} className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <span className="text-sm font-serif font-bold text-amber-700">{e.profile.display_name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold">{e.profile.display_name}</h3>
                    <Crown size={12} className="text-amber-500" />
                  </div>
                  <p className="text-[10px] text-on-surface/35">@{e.profile.username}</p>
                </div>
              </Link>
              <ul className="divide-y divide-on-surface/[0.06]">
                {topRatings.map((r) => (
                  <li key={r.id}>
                    <Link to={`/restaurant/${r.restaurant_id}`} className="block py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">{r.restaurant_name}</h4>
                          <p className="text-[10px] text-on-surface/45 uppercase tracking-wider mt-0.5 font-semibold">{r.cuisine}{r.price ? ` · ${r.price}` : ''}</p>
                        </div>
                        <span className={cn("text-lg font-serif font-bold flex-shrink-0", scoreColor(Number(r.score)))}>{Number(r.score).toFixed(1)}</span>
                      </div>
                      {r.notes && <p className="text-[11px] text-on-surface/45 italic mt-1.5 line-clamp-2">"{r.notes}"</p>}
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">{r.tags.slice(0, 3).map((t) => <span key={t} className="text-[9px] px-2 py-0.5 rounded-full bg-primary/8 text-primary/70 font-medium">{t}</span>)}</div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
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
                          <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">{timeAgo(review.created_at)}</p>
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
