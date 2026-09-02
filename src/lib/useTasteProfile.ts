/**
 * One hook behind both taste surfaces — the card on the profile and the
 * full /profile/taste page — so the two can never disagree about who you
 * are.
 *
 * It assembles: the engine's TasteProfile (lib/recommendations), the
 * insights read out of it (lib/taste-insights), the tier ladder
 * (lib/taste-tier), and the server benchmarks (lib/supabase-taste), and
 * re-derives everything the moment a rating changes. Both surfaces mount
 * at once (the card lives in the keep-alive profile tab), so the expensive
 * derivation is memoised module-wide on its inputs' identities rather
 * than per hook instance.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLists, readLocalVisitHistoryCounts, type RestaurantRating, type WishlistItem, type CustomList, type RestaurantMeta } from '../contexts/ListsContext';
import { buildTasteProfile, type TasteProfile } from './recommendations';
import { getTasteQuiz, type TasteQuizAnswers } from './taste-quiz';
import { buildTasteInsights, type MichelinHit, type TasteInsights } from './taste-insights';
import { statsFromRatings, tastePoints, tierFor, type TastePoints, type TasteStats, type TierStanding } from './taste-tier';
import { getTasteBenchmarksCached, peekTasteBenchmarks, type TasteBenchmarkResult } from './supabase-taste';
import { useMichelinIndexReady } from './useMichelinMatch';
import { findMichelinMatchSync } from './michelin';

export interface TasteProfileState {
  insights: TasteInsights;
  /** The ladder the tier and points are read from (server stats once
   *  they cover the local record, local stats until then). */
  stats: TasteStats;
  points: TastePoints;
  standing: TierStanding;
  /** Server truth, when migration 083 is applied and the user is signed in. */
  benchmarks: TasteBenchmarkResult | null;
  benchmarksLoading: boolean;
  ratingCount: number;
}

/* ── Shared derivation ────────────────────────────────────────────────── */

interface Derived {
  ratings: RestaurantRating[];
  wishlist: WishlistItem[];
  lists: CustomList[];
  quiz: TasteQuizAnswers | null;
  coordsKey: string;
  michelinReady: boolean;
  coordsById: Map<string, { lat: number; lng: number }>;
  profile: TasteProfile;
  michelinById: Map<string, MichelinHit> | undefined;
}
let lastDerived: Derived | null = null;

/** Coordinates for the rated places, plus a cheap fingerprint of them so
 *  the Michelin pass re-runs only when a coordinate actually appears —
 *  not on every unrelated restaurantMeta write. */
function coordsFor(ratings: RestaurantRating[], meta: Record<string, RestaurantMeta>) {
  const coordsById = new Map<string, { lat: number; lng: number }>();
  let key = '';
  for (const r of ratings) {
    const m = meta[r.restaurantId];
    if (typeof m?.lat === 'number' && typeof m?.lng === 'number') {
      coordsById.set(r.restaurantId, { lat: m.lat, lng: m.lng });
      key += `${r.restaurantId}:${m.lat.toFixed(4)},${m.lng.toFixed(4)};`;
    }
  }
  return { coordsById, coordsKey: key };
}

function derive(
  ratings: RestaurantRating[], wishlist: WishlistItem[], lists: CustomList[], quiz: TasteQuizAnswers | null,
  coords: { coordsById: Map<string, { lat: number; lng: number }>; coordsKey: string }, michelinReady: boolean,
): Derived {
  const d = lastDerived;
  if (d && d.ratings === ratings && d.wishlist === wishlist && d.lists === lists && d.quiz === quiz
      && d.coordsKey === coords.coordsKey && d.michelinReady === michelinReady) return d;
  const profile = buildTasteProfile(ratings, wishlist, lists, [], quiz, { coordsById: coords.coordsById });
  let michelinById: Map<string, MichelinHit> | undefined;
  if (michelinReady) {
    michelinById = new Map();
    for (const r of ratings) {
      const at = coords.coordsById.get(r.restaurantId);
      const info = findMichelinMatchSync(r.name, at?.lat, at?.lng, r.address);
      if (info) michelinById.set(r.restaurantId, { stars: info.stars, bibGourmand: info.bibGourmand });
    }
  }
  lastDerived = { ratings, wishlist, lists, quiz, coordsKey: coords.coordsKey, michelinReady, coordsById: coords.coordsById, profile, michelinById };
  return lastDerived;
}

/* ── The hook ─────────────────────────────────────────────────────────── */

export function useTasteProfile(opts: { refresh?: boolean } = {}): TasteProfileState {
  const { ratings, wishlist, lists, restaurantMeta } = useLists();
  const { profile: userProfile, user } = useAuth();
  const michelinReady = useMichelinIndexReady();
  const quiz = useMemo(() => getTasteQuiz(userProfile), [userProfile]);

  // A string fingerprint, so the memo below ignores restaurantMeta writes
  // that don't change a rated place's coordinates.
  const coords = useMemo(() => coordsFor(ratings, restaurantMeta), [ratings, restaurantMeta]);
  const coordsRef = useRef(coords);
  if (coords.coordsKey !== coordsRef.current.coordsKey) coordsRef.current = coords;
  const stable = coordsRef.current;

  const derived = useMemo(
    () => derive(ratings, wishlist, lists, quiz, stable, michelinReady),
    [ratings, wishlist, lists, quiz, stable, michelinReady],
  );
  // Visit history is written straight to localStorage by ListsContext;
  // a new visit always lands with a ratings change, so that is the cue.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extraVisits = useMemo(() => readLocalVisitHistoryCounts(), [ratings]);

  const [bench, setBench] = useState<TasteBenchmarkResult | null>(() => (user?.id ? peekTasteBenchmarks(user.id) : null));
  const [benchLoading, setBenchLoading] = useState(false);
  useEffect(() => {
    if (!user?.id) { setBench(null); return; }
    let cancelled = false;
    setBenchLoading(true);
    getTasteBenchmarksCached(user.id, !!opts.refresh).then((v) => {
      if (cancelled) return;
      setBench(v);
      setBenchLoading(false);
    });
    return () => { cancelled = true; };
    // Refetch when the rating count changes — a new rating may have moved
    // the rank once it syncs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, opts.refresh, ratings.length]);

  const insights = useMemo(
    () => buildTasteInsights(ratings, derived.profile, {
      quiz, benchmarks: bench?.benchmarks ?? null, extraVisits, michelinById: derived.michelinById,
    }),
    [ratings, derived, quiz, bench, extraVisits],
  );
  // The ladder the LEADERBOARD ranks on is the server's — what everyone
  // else sees — so it wins once it covers the local record. Until scores
  // unlock (10 ratings) nothing is published, and a publish can lag or
  // fail, so a server count BELOW the local one means "not synced yet":
  // the local stats stand in rather than dropping the tier on load.
  const localStats = useMemo(() => statsFromRatings(ratings), [ratings]);
  const serverStats = bench?.myStats ?? null;
  const stats = serverStats && serverStats.ratingCount >= localStats.ratingCount ? serverStats : localStats;
  const points = useMemo(() => tastePoints(stats), [stats]);
  const standing = useMemo(() => tierFor(points.total), [points.total]);

  return {
    insights, stats, points, standing,
    benchmarks: bench, benchmarksLoading: benchLoading, ratingCount: ratings.length,
  };
}
