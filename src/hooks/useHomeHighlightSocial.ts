import { useEffect, useState } from 'react';
import { getFriends, getProfilesByIds, getFriendActivity, getExpertProfiles, getFriendsPublicHomeMeals, getSuggestedProfiles } from '../lib/supabase-community';
import { suggestionScore } from '../lib/suggestions';
import type { HighlightSocial } from '../lib/home-highlights';
const EMPTY: HighlightSocial = { people: [], experts: [], places: [], recipes: [] };

/** Reuses the same permission-filtered reads as Friends and the feed.
 * Refresh on return, every five minutes, and after follows change; never block Home on social data. */
export function useHomeHighlightSocial(userId?: string, city = '') {
  const [state, setState] = useState<{ userId: string; data: HighlightSocial } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    const foreground = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(foreground, 5 * 60_000);
    window.addEventListener('follows:changed', refresh);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener('follows:changed', refresh);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, []);
  useEffect(() => {
    if (!userId) { setState(null); return; }
    let cancelled = false;
    async function load() {
      const [friends, experts, suggestions] = await Promise.all([getFriends(userId!).catch(() => []), getExpertProfiles().catch(() => []), getSuggestedProfiles({ viewerId: userId!, limit: 8 }).catch(() => [])]);
      if (cancelled) return;
      const followed = new Set(friends.map(f => f.friend_id).filter(id => id !== userId));
      // Followed experts first. Bound reads for larger networks.
      const priority = (p: typeof experts[number]) => (followed.has(p.user_id) ? 4 : 0) + (city && p.home_city?.toLowerCase().includes(city.toLowerCase()) ? 2 : 0);
      const chosenExperts = experts.filter(p => p.user_id !== userId && p.is_public).sort((a,b) => priority(b) - priority(a) || a.user_id.localeCompare(b.user_id)).slice(0, 12);
      const friendIds = [...followed].slice(0, 60);
      const ids = [...new Set([...friendIds, ...chosenExperts.map(p => p.user_id)])];
      const [profiles, activity, meals] = await Promise.all([getProfilesByIds(ids).catch(() => ({} as Awaited<ReturnType<typeof getProfilesByIds>>)), getFriendActivity(ids, 120).catch(() => []), getFriendsPublicHomeMeals(friendIds).catch(() => [])]);
      if (cancelled) return;
      const person = (p: typeof experts[number]) => ({ id: p.user_id, name: p.display_name || p.username, username: p.username, city: p.home_city || undefined, followed: followed.has(p.user_id) });
      setState({ userId: userId!, data: {
        people: friendIds.flatMap(id => profiles[id] ? [person(profiles[id])] : []),
        experts: chosenExperts.map(person),
        suggestions: suggestions.filter(p => p.user_id !== userId && !followed.has(p.user_id)).map(p => ({
          ...person(p), expert: !!p.is_verified, relevance: suggestionScore(p) * 3,
          reason: p.followsYou ? 'Follows you · get to know their taste.' : p.mutualCount ? `${p.mutualCount} mutual friend${p.mutualCount === 1 ? '' : 's'} · explore their favorites.` : p.matchReason || undefined,
        })),
        places: activity.flatMap(r => {
          const p = profiles[r.user_id];
          if (!p || r.user_id === userId || (!followed.has(r.user_id) && !chosenExperts.some(e => e.user_id === r.user_id))) return [];
          return [{ restaurantId: r.restaurant_id, name: r.restaurant_name, image: r.photo_url, cuisine: r.cuisine, address: r.address, score: r.score, wouldReturn: r.would_return, createdAt: Date.parse(r.created_at), visitDate: r.visit_date, authorId: r.user_id, authorName: p.display_name || p.username, expert: !!p.is_verified }];
        }),
        recipes: meals.filter(m => m.name?.trim() && (m.steps?.length || m.stepGroups?.length)).slice(0, 40).flatMap(m => {
          const p = m.userId !== userId && followed.has(m.userId) ? profiles[m.userId] : undefined;
          return p ? [{ id: `${m.userId}:${m.id}`, title: m.name, image: m.coverPhoto || m.photos?.[0]?.url, cuisine: m.cuisine, href: `/recipe/${encodeURIComponent(m.userId)}/${encodeURIComponent(m.id)}`, authorId: m.userId, createdAt: m.createdAt, visitDate: m.date, authorName: p.display_name || p.username, expert: !!p.is_verified }] : [];
        }),
      } });
    }
    void load().catch(() => { if (!cancelled) setState({ userId: userId!, data: EMPTY }); });
    return () => { cancelled = true; };
  }, [userId, city, revision]);
  // Account switches cannot render an earlier account's social data.
  return state?.userId === userId ? state.data : EMPTY;
}
