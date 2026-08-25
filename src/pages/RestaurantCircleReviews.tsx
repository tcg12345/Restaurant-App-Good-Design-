import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useHeaderFade } from '../lib/useHeaderFade';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { getPlaceName } from '../lib/places';
import { FriendReviewSheet, FriendAvatar } from '../components/FriendReviewSheet';
import {
  countsForCommunity,
  getFriendsStats,
  getExpertRecommendations,
  getProfilesByIds,
  getCommunityPhotos,
  type CommunityRating,
  type CommunityPhoto,
  type ExpertRecommendation,
  type UserProfile,
} from '../lib/supabase-community';

/** Short relative time label — mirrors the helper in RestaurantDetailMobile. */
function timeAgo(date: string): string {
  if (!date) return '';
  const d = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return 'today';
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 14) return 'last week';
  if (days < 45) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 75) return 'last month';
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Soft tier-tinted score pill — the same palette every score on the app wears. */
const softChip = (s: number) =>
  s >= 8 ? 'bg-score-high-tint text-score-high-ink'
  : s >= 5 ? 'bg-score-mid-tint text-score-mid-ink'
  : 'bg-score-low-tint text-score-low-ink';

type Entry = {
  key: string;
  kind: 'friend' | 'expert';
  userId: string;
  username?: string;
  displayName: string;
  score: number;
  notes: string;
  /** "2 months ago" — bare, no "Visited" prefix; the column says which. */
  when: string;
  /** Sortable recency for the Recent filter. */
  at: number;
  /** Dishes they named. */
  dishes: string[];
  /** The row's own review — friends only; what the sheet reads. */
  rating?: CommunityRating;
  /** Slider-entered score — shown, but marked as not counting toward averages. */
  selfScored?: boolean;
};

type Filter = 'Recent' | 'Top rated' | 'With photos';

/**
 * Everyone in your circle who has rated one restaurant.
 *
 * The friends' average leads, then the list — unboxed rows on the page,
 * divided by hairlines, the same shape the detail page shows three of. A
 * row opens the review as a sheet over this screen; experts, who have a
 * recommendation rather than a review, still go to their profile.
 */
export const RestaurantCircleReviews: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { phoneMode, twoDecimalScores } = useSettings();
  // Mobile top bar dissolves with scroll, Discover-style.
  const headerFade = useHeaderFade({ enabled: phoneMode, windowScroll: true });

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [photos, setPhotos] = useState<CommunityPhoto[]>([]);
  const [filter, setFilter] = useState<Filter>('Recent');
  const [openReview, setOpenReview] = useState<Entry | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Fetch the place name (just for the header), the friend ratings,
      // and the expert recommendations in parallel. Friend ratings need
      // a logged-in user; experts are public per restaurant.
      const [placeRes, friendsRes, expertsRes] = await Promise.all([
        // Header name only — a Pro-tier field mask, not the Enterprise
        // details payload this page never reads.
        getPlaceName(id).catch(() => null),
        user?.id
          ? getFriendsStats(user.id, id).catch(() => ({ avgScore: 0, totalRatings: 0, ratings: [] as CommunityRating[] }))
          : Promise.resolve({ avgScore: 0, totalRatings: 0, ratings: [] as CommunityRating[] }),
        getExpertRecommendations(id).catch(() => [] as ExpertRecommendation[]),
      ]);
      if (cancelled) return;

      if (placeRes) setName(placeRes);

      // Friends rows — fetch their profiles so we can show display
      // names + initials. Experts come pre-joined with name+username.
      const friendIds = Array.from(new Set(friendsRes.ratings.map((r) => r.user_id)));
      const friendProfiles: Record<string, UserProfile> = friendIds.length > 0 ? await getProfilesByIds(friendIds) : {};
      if (cancelled) return;

      const friendEntries: Entry[] = friendsRes.ratings.map((r) => {
        const prof = friendProfiles[r.user_id];
        const stamp = r.visit_date || r.created_at || '';
        return {
          key: `f-${r.id}`,
          kind: 'friend',
          userId: r.user_id,
          username: prof?.username,
          displayName: prof?.display_name || 'Friend',
          score: Number(r.score),
          notes: r.notes || '',
          when: stamp ? timeAgo(stamp) : '',
          at: stamp ? new Date(stamp.length === 10 ? `${stamp}T12:00:00` : stamp).getTime() : 0,
          dishes: r.tags || [],
          rating: r,
          selfScored: !countsForCommunity(r),
        };
      });

      const expertEntries: Entry[] = expertsRes.map((rec) => ({
        key: `e-${rec.id}`,
        kind: 'expert',
        userId: rec.user_id,
        username: rec.expert_username,
        displayName: rec.expert_name || 'Expert',
        score: Number(rec.rating),
        notes: rec.recommendation_text || '',
        when: rec.updated_at ? timeAgo(rec.updated_at) : '',
        at: rec.updated_at ? new Date(rec.updated_at).getTime() : 0,
        dishes: rec.highlight_dishes || [],
      }));

      setEntries([...friendEntries, ...expertEntries]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [id, user?.id]);

  // Photos land after the list — they are large rows, and nothing above
  // the fold waits on them. The "With photos" filter appears once they do.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getCommunityPhotos(id).then((p) => { if (!cancelled) setPhotos(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  const withPhotos = useMemo(() => new Set(photos.map((p) => p.user_id)), [photos]);

  const friends = useMemo(() => entries.filter((e) => e.kind === 'friend'), [entries]);
  const friendsAvg = useMemo(() => {
    const counted = friends.filter((e) => !e.selfScored && e.score > 0);
    return counted.length ? counted.reduce((s, e) => s + e.score, 0) / counted.length : 0;
  }, [friends]);
  const above9 = friends.filter((e) => e.score >= 9).length;

  const shown = useMemo(() => {
    const list = filter === 'With photos' ? entries.filter((e) => withPhotos.has(e.userId)) : [...entries];
    return list.sort((a, b) => (filter === 'Top rated' ? b.score - a.score : b.at - a.at));
  }, [entries, filter, withPhotos]);

  const FILTERS: Filter[] = withPhotos.size > 0 ? ['Recent', 'Top rated', 'With photos'] : ['Recent', 'Top rated'];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 size={32} className="animate-spin text-on-surface/35" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-cream type-archivo">
      {/* Top bar — fades away with scroll, back near the top */}
      <motion.header ref={headerFade.headerRef} style={headerFade.headerStyle} className="sticky top-0 z-10 backdrop-blur-md bg-cream/90 border-b border-on-surface/[0.12]">
        <div className="flex items-center gap-3 px-3.5 pt-safe-4 pb-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="hit-44 w-9 h-9 rounded-full bg-on-surface/[0.06] flex items-center justify-center text-on-surface active:opacity-70 transition-opacity flex-shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-on-surface/45" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              Your circle
            </p>
            {name && (
              <h1
                className="text-on-surface truncate mt-1"
                style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}
              >
                {name}
              </h1>
            )}
          </div>
        </div>
      </motion.header>

      <main className="px-[22px]">
        {entries.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={26} className="mx-auto text-on-surface/25 mb-3" />
            <p className="text-on-surface/50" style={{ fontSize: '14px' }}>
              No one in your circle has reviewed this restaurant yet.
            </p>
          </div>
        ) : (
          <>
            {/* The number the page is about, then the sentence that reads it. */}
            {friends.length > 0 && (
              <div className="pt-[22px] flex items-end gap-3.5">
                <span className="text-primary" style={{ fontSize: '44px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.045em' }}>
                  {friendsAvg > 0 ? friendsAvg.toFixed(twoDecimalScores ? 2 : 1) : '—'}
                </span>
                <div className="pb-[5px] min-w-0">
                  <p className="text-on-surface/45" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    Friends average
                  </p>
                  <p className="mt-1.5 text-on-surface/55" style={{ fontSize: '13.5px' }}>
                    {friends.length} {friends.length === 1 ? 'friend' : 'friends'} rated it
                    {above9 > 0 && ` · ${above9} above 9`}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-5 -mx-[22px] px-[22px] flex gap-[7px] overflow-x-auto no-scrollbar">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex-none rounded-full border px-3.5 py-2.5 active:opacity-80 transition-colors',
                    filter === f
                      ? 'bg-on-surface border-on-surface text-cream'
                      : 'bg-transparent border-on-surface/20 text-on-surface',
                  )}
                  style={{ fontSize: '12px', fontWeight: 700 }}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="mt-3.5 flex flex-col">
              {shown.map((e, i) => (
                <button
                  key={e.key}
                  type="button"
                  onClick={() => {
                    if (e.rating) setOpenReview(e);
                    else if (e.username) navigate(`/user/${e.username}`);
                  }}
                  className={cn(
                    'flex items-start gap-3.5 py-[17px] text-left active:opacity-60 transition-opacity',
                    i > 0 && 'border-t border-on-surface/[0.09]',
                  )}
                >
                  <FriendAvatar name={e.displayName} size={42} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.022em' }}>
                        {e.displayName}
                      </span>
                      {e.when && <span className="flex-none text-on-surface/45" style={{ fontSize: '12px' }}>{e.when}</span>}
                      {e.kind === 'expert' && (
                        <span className="flex-none text-primary" style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                          Expert
                        </span>
                      )}
                    </div>
                    {e.notes ? (
                      <p className="mt-1.5 text-on-surface/60 line-clamp-2" style={{ fontSize: '13.5px', lineHeight: 1.45 }}>{e.notes}</p>
                    ) : (
                      <p className="mt-1.5 text-on-surface/35" style={{ fontSize: '13.5px' }}>Rated it — no note</p>
                    )}
                    {(e.dishes.length > 0 || e.selfScored) && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {e.dishes.slice(0, 3).map((d) => (
                          <span key={d} className="rounded-full bg-on-surface/[0.06] text-on-surface/60 px-2.5 py-1.5" style={{ fontSize: '11px', fontWeight: 600 }}>{d}</span>
                        ))}
                        {e.selfScored && (
                          <span
                            className="rounded-full bg-on-surface/[0.06] text-on-surface/40 px-2.5 py-1.5"
                            style={{ fontSize: '11px', fontWeight: 600 }}
                            title="Score picked by hand — not counted in averages"
                          >
                            Self-scored
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={cn('flex-none mt-0.5 rounded-full px-2.5 py-2 tabular-nums', softChip(e.score))} style={{ fontSize: '14px', fontWeight: 700 }}>
                    {e.score.toFixed(1)}
                  </span>
                </button>
              ))}
              {shown.length === 0 && (
                <p className="py-10 text-center text-on-surface/45" style={{ fontSize: '13.5px' }}>
                  Nobody here matches that filter.
                </p>
              )}
            </div>
          </>
        )}
      </main>

      <AnimatePresence>
        {openReview?.rating && (
          <FriendReviewSheet
            rating={openReview.rating}
            name={openReview.displayName}
            username={openReview.username}
            when={openReview.when}
            restaurantName={name}
            photos={photos.filter((p) => p.user_id === openReview.userId)}
            onClose={() => setOpenReview(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
