import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { getPlaceDetails } from '../lib/places';
import {
  getFriendsStats,
  getExpertRecommendations,
  getProfilesByIds,
  type CommunityRating,
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

type Entry = {
  key: string;
  kind: 'friend' | 'expert';
  userId: string;
  username?: string;
  displayName: string;
  score: number;
  notes: string;
  recencyLabel: string;
  /** Where tapping the row leads — review detail for friends, profile for experts. */
  href: string;
};

const scoreChipBg = (s: number) =>
  s >= 8 ? 'bg-olive' : s >= 5 ? 'bg-amber-600' : 'bg-clay';

export const RestaurantCircleReviews: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Fetch the place name (just for the header), the friend ratings,
      // and the expert recommendations in parallel. Friend ratings need
      // a logged-in user; experts are public per restaurant.
      const [placeRes, friendsRes, expertsRes] = await Promise.all([
        getPlaceDetails(id).catch(() => null),
        user?.id
          ? getFriendsStats(user.id, id).catch(() => ({ avgScore: 0, totalRatings: 0, ratings: [] as CommunityRating[] }))
          : Promise.resolve({ avgScore: 0, totalRatings: 0, ratings: [] as CommunityRating[] }),
        getExpertRecommendations(id).catch(() => [] as ExpertRecommendation[]),
      ]);
      if (cancelled) return;

      if (placeRes) setName(placeRes.name);

      // Friends rows — fetch their profiles so we can show display
      // names + initials. Experts come pre-joined with name+username.
      const friendIds = Array.from(new Set(friendsRes.ratings.map((r) => r.user_id)));
      const friendProfiles: Record<string, UserProfile> = friendIds.length > 0 ? await getProfilesByIds(friendIds) : {};
      if (cancelled) return;

      const friendEntries: Entry[] = friendsRes.ratings.map((r) => {
        const prof = friendProfiles[r.user_id];
        const recency = r.visit_date ? timeAgo(r.visit_date) : (r.created_at ? timeAgo(r.created_at) : '');
        return {
          key: `f-${r.id}`,
          kind: 'friend',
          userId: r.user_id,
          username: prof?.username,
          displayName: prof?.display_name || 'Friend',
          score: Number(r.score),
          notes: r.notes || '',
          recencyLabel: recency ? `Visited ${recency}` : '',
          href: `/review/${r.id}`,
        };
      });

      const expertEntries: Entry[] = expertsRes.map((rec) => {
        const recency = rec.updated_at ? timeAgo(rec.updated_at) : '';
        return {
          key: `e-${rec.id}`,
          kind: 'expert',
          userId: rec.user_id,
          username: rec.expert_username,
          displayName: rec.expert_name || 'Expert',
          score: Number(rec.rating),
          notes: rec.recommendation_text || '',
          recencyLabel: recency ? `Updated ${recency}` : '',
          href: rec.expert_username ? `/user/${rec.expert_username}` : '',
        };
      });

      // Sort highest score first across the combined list.
      const merged = [...friendEntries, ...expertEntries].sort((a, b) => b.score - a.score);
      setEntries(merged);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [id, user?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 size={32} className="animate-spin text-ink-3" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 bg-cream">
      {/* Top bar */}
      <header className="sticky top-0 z-10 backdrop-blur-md bg-cream/90">
        <div className="flex items-center gap-3 px-3 pt-safe-4 pb-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-10 h-10 rounded-full bg-paper border border-line flex items-center justify-center text-ink active:opacity-70 transition-opacity flex-shrink-0"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p
              className="uppercase text-ink-3"
              style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: '10px',
                letterSpacing: '0.14em',
              }}
            >
              Your circle
            </p>
            {name && (
              <h1
                className="text-ink truncate"
                style={{
                  fontFamily: '"Fraunces", "Noto Serif", serif',
                  fontSize: '20px',
                  fontWeight: 500,
                  letterSpacing: '-0.4px',
                  lineHeight: 1.15,
                }}
              >
                {name}
              </h1>
            )}
          </div>
        </div>
      </header>

      <main className="px-3 pt-2">
        {entries.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={26} className="mx-auto text-ink-4 mb-3" />
            <p className="text-ink-3" style={{ fontSize: '14px' }}>
              No one in your circle has reviewed this restaurant yet.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => {
              const initial = e.displayName.trim().charAt(0).toUpperCase() || (e.kind === 'expert' ? 'E' : 'F');
              const onClick = () => {
                if (!e.href) return;
                navigate(e.href);
              };
              return (
                <li key={e.key}>
                  <button
                    type="button"
                    onClick={onClick}
                    className="w-full py-4 first:pt-3 text-left active:opacity-70 transition-opacity"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-cream-2 flex items-center justify-center flex-shrink-0">
                        <span
                          className="text-ink"
                          style={{
                            fontFamily: '"Fraunces", "Noto Serif", serif',
                            fontSize: '15px',
                            fontWeight: 600,
                          }}
                        >
                          {initial}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-ink truncate" style={{ fontSize: '14px', fontWeight: 600 }}>
                            {e.displayName}
                          </p>
                          <span
                            className={cn(
                              'uppercase flex-shrink-0',
                              e.kind === 'expert' ? 'text-persimmon' : 'text-ink-3',
                            )}
                            style={{
                              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                              fontSize: '9px',
                              letterSpacing: '0.14em',
                            }}
                          >
                            {e.kind === 'expert' ? 'Expert' : 'Friend'}
                          </span>
                        </div>
                        {e.recencyLabel && (
                          <p className="text-ink-3" style={{ fontSize: '11px' }}>
                            {e.recencyLabel}
                          </p>
                        )}
                      </div>
                      <div className={cn(
                        'flex-shrink-0 w-11 h-7 rounded-md flex items-center justify-center',
                        scoreChipBg(e.score),
                      )}>
                        <span
                          className="text-white tabular-nums"
                          style={{
                            fontFamily: '"Fraunces", "Noto Serif", serif',
                            fontSize: '13px',
                            fontWeight: 600,
                          }}
                        >
                          {e.score.toFixed(1)}
                        </span>
                      </div>
                    </div>
                    {e.notes && (
                      <p
                        className="italic text-ink-2 mt-3"
                        style={{
                          fontFamily: '"Fraunces", "Noto Serif", serif',
                          fontSize: '14px',
                          lineHeight: 1.45,
                        }}
                      >
                        "{e.notes}"
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
};
