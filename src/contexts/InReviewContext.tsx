import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useLists, readLocalVisitHistory } from './ListsContext';
import { useRecipes } from './RecipesContext';
import { getTasteBenchmarksCached } from '../lib/supabase-taste';
import { ensureMichelinIndex } from '../lib/michelin';
import { buildTasteProfile } from '../lib/recommendations';
import { isOverlayOpen } from '../lib/overlay-registry';
import { availableReviewPeriods, buildReview, dayKey, eligibleAutoReview, readReviewArchive, reviewEvents, REVIEW_META_KEY, type ReviewArchive, type ReviewSnapshot } from '../lib/in-review';
import { ReviewViewer } from '../components/in-review/ReviewViewer';

interface ReviewContextValue { reviews: ReviewSnapshot[]; loading: boolean; syncUnavailable: boolean; autoReveal: boolean; setAutoReveal: (on: boolean) => void; openReview: (review: ReviewSnapshot) => void }
const Context = createContext<ReviewContextValue | null>(null);
export const useInReview = () => { const ctx = useContext(Context); if (!ctx) throw new Error('InReviewProvider missing'); return ctx; };
export function InReviewProvider({ children }: { children: React.ReactNode }) {
  const { user, profileComplete } = useAuth();
  const { ratings, homeMeals, wishlist, restaurantMeta, stashMetaKey, cloudLoaded, cloudSyncReady, scoresUnlocked } = useLists();
  const { myRecipes, loading: recipesLoading, cloudSyncReady: recipesReady } = useRecipes();
  const route = useLocation();
  const [today, setToday] = useState(() => dayKey(new Date()));
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState<{ owner: string; review: ReviewSnapshot } | null>(null);
  const archive = useMemo(() => readReviewArchive(restaurantMeta[REVIEW_META_KEY], user?.id ?? ''), [restaurantMeta, user?.id]);
  const current = useRef(archive); current.current = archive;
  const owner = useRef(user?.id); owner.current = user?.id;
  const presented = useRef('');
  const attempted = useRef(new Set<string>());
  useEffect(() => { attempted.current.clear(); presented.current = ''; setSelected(null); setBuilding(false); }, [user?.id]);
  useEffect(() => { setSelected(null); }, [route.pathname]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') setToday(dayKey(new Date())); };
    const timer = window.setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const input = useMemo(() => ({ ratings, meals:homeMeals, recipes:myRecipes.filter(r => r.userId === user?.id), wishlist, scoresUnlocked,
    history:Object.fromEntries(ratings.map(r => [r.restaurantId, readLocalVisitHistory(r.restaurantId)])) }), [ratings, homeMeals, myRecipes, wishlist, scoresUnlocked, user?.id]);
  const periods = useMemo(() => availableReviewPeriods(input), [input, today]);
  const commit = (value: ReviewArchive) => { if (value.ownerId === owner.current) { current.current = value; stashMetaKey(REVIEW_META_KEY, value); } };
  // Use the existing private, account-scoped metadata sync. Closed-period
  // snapshots are immutable: later score edits cannot rewrite an old story.
  useEffect(() => {
    if (!user || !profileComplete || !cloudSyncReady || !recipesReady || recipesLoading) { setBuilding(false); return; }
    const uid = user.id;
    const missing = periods.filter(p => !archive.reviews.some(r => r.period.id === p.id) && !attempted.current.has(p.id)).slice(0, 24);
    if (!missing.length) { setBuilding(false); return; }
    let cancelled = false;
    setBuilding(true);
    void (async () => {
      const [benchmark] = await Promise.all([getTasteBenchmarksCached(uid), ensureMichelinIndex()]);
      const events = reviewEvents(input);
      const coordsById = new Map<string, {lat:number;lng:number}>(ratings.flatMap(r => { const m=restaurantMeta[r.restaurantId]; return typeof m?.lat === 'number' && typeof m?.lng === 'number' ? [[r.restaurantId,{lat:m.lat,lng:m.lng}] as const] : []; }));
      const batch: ReviewSnapshot[] = [];
      for (const period of missing) {
        if (cancelled || owner.current !== uid) return;
        const rows = [...new Map(events.filter(e => e.day >= period.start && e.day < period.end).map(e => [e.rating.restaurantId,e.rating])).values()].filter(r => r.ratingMethod !== 'slider');
        batch.push(buildReview(period, input, buildTasteProfile(rows,[],[],[],null,{coordsById}), benchmark?.benchmarks));
        // Yield between stories so large imported histories never freeze launch.
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
      if (!cancelled && owner.current === uid) {
        const old = current.current;
        const reviews = [...new Map([...batch,...old.reviews].map(r => [r.period.id,r])).values()].sort((a,b) => b.period.end.localeCompare(a.period.end));
        commit({...old,reviews});
      }
    })().catch(() => { if (!cancelled && owner.current === uid) for (const p of missing) attempted.current.add(p.id); }).finally(() => { if (!cancelled) setBuilding(false); });
    return () => { cancelled = true; };
  }, [user?.id, profileComplete, cloudSyncReady, recipesReady, recipesLoading, periods, archive.reviews, input]);
  const openReview = (review: ReviewSnapshot) => {
    if (!user || !cloudLoaded) return;
    commit({...current.current, seen:[...new Set([...current.current.seen, review.period.id])]});
    setSelected({owner:user.id,review});
  };
  useEffect(() => {
    if (!user || !profileComplete || !cloudLoaded || building || recipesLoading || route.pathname !== '/' || selected || !archive.autoReveal || presented.current === `${user.id}:${today}`) return;
    const candidate = eligibleAutoReview(archive.reviews,archive.seen);
    if (!candidate) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || isOverlayOpen()) return;
      presented.current = `${user.id}:${today}`;
      window.clearInterval(timer);
      openReview(candidate);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [user?.id, profileComplete, cloudLoaded, building, recipesLoading, route.pathname, selected, archive, today]);
  return <Context.Provider value={{reviews:archive.reviews, loading:!cloudLoaded || recipesLoading || building, syncUnavailable:cloudLoaded && (!cloudSyncReady || !recipesReady) && !recipesLoading, autoReveal:archive.autoReveal,
    setAutoReveal:on => commit({...current.current,autoReveal:on,preferenceUpdatedAt:Date.now()}), openReview}}>
    {children}
    {selected && selected.owner === user?.id && <ReviewViewer key={selected.review.period.id} review={selected.review} onClose={() => setSelected(null)} />}
  </Context.Provider>;
}
