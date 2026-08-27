import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Search, Star } from 'lucide-react';
import { cn } from '../../lib/utils';
import * as OB from './OnboardingKit';
import { useAuth } from '../../contexts/AuthContext';
import { useLists } from '../../contexts/ListsContext';
import { searchPlacesByText, priceLevelToString, extractCityState, type PlaceResult } from '../../lib/places';
import { cuisineLabel } from '../../lib/cuisine';
import { getSuggestedProfiles, type SuggestedProfile } from '../../lib/supabase-community';
import { SuggestedPeople } from '../SuggestedPeople';

/**
 * The taste-and-first-actions steps of the signup wizard (ProfileSetup).
 *
 * These used to be a standalone /onboarding page; they're wizard steps now so
 * account setup reads as ONE flow — name to handle to city to taste to first
 * follows to first ratings — under a single progress bar.
 *
 * The admission rule for a question: it must change what the app does
 * afterwards. Every option set here is consumed by lib/recommendations.ts
 * (cuisines and price as cold-start query priors, atmosphere as rating-tag
 * priors, all fading as real ratings accumulate).
 */

/** Labels MUST match CUISINE_TYPES labels (lib/places.ts) — the rec engine
 *  credits them against rating cuisine tokens verbatim. */
export const TASTE_CUISINES = [
  'Italian', 'Japanese', 'Mexican', 'Thai', 'Indian', 'American',
  'French', 'Chinese', 'Korean', 'Mediterranean', 'Vietnamese', 'Greek',
  'Spanish', 'Middle Eastern', 'Seafood', 'Steakhouse', 'Sushi', 'BBQ',
];

/** ids are the Google price tiers 1–4 — they land in taste_profile.prices
 *  as numbers and drive the price prior + price-restricted queries. */
export const TASTE_PRICES: Array<{ tier: number; label: string; sub: string }> = [
  { tier: 1, label: '$', sub: 'Cheap eats' },
  { tier: 2, label: '$$', sub: 'Casual dinner' },
  { tier: 3, label: '$$$', sub: 'A nice night out' },
  { tier: 4, label: '$$$$', sub: 'Special occasions' },
];

/** Option ids map onto rating-tag priors — see ATMOSPHERE_TAG_PRIORS in
 *  lib/recommendations.ts before renaming any of them. */
export const TASTE_ATMOSPHERES: Array<{ id: string; label: string; image: string }> = [
  { id: 'intimate', label: 'Intimate & Dimly Lit', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=400' },
  { id: 'vibrant', label: 'Vibrant & Social', image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=400' },
  { id: 'minimalist', label: 'Minimalist & Zen', image: 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&q=80&w=400' },
  { id: 'rustic', label: 'Rustic & Organic', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=400' },
];

/** Multi-select chip grid: quiet filled capsules that spring to the accent
 *  when chosen, with the check popping in. */
export const TastePillGrid: React.FC<{
  options: Array<{ id: string; label: string; sub?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}> = ({ options, selected, onToggle }) => (
  <div className="flex flex-wrap gap-2.5">
    {options.map((o, idx) => {
      const sel = selected.includes(o.id);
      return (
        <motion.button
          key={o.id}
          type="button"
          onClick={() => onToggle(o.id)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 + Math.min(idx, 12) * 0.022, ease: OB.EASE }}
          whileTap={{ scale: 0.94 }}
          className="inline-flex items-center gap-2 rounded-full border-none cursor-pointer"
          style={{
            minHeight: 44,
            padding: '0 17px',
            fontSize: 14,
            fontWeight: 600,
            background: sel ? OB.TERRA : 'var(--ob-pill-bg)',
            color: sel ? '#fff' : 'var(--ob-ink)',
            transition: 'background .18s var(--ease-out-strong), color .18s var(--ease-out-strong)',
          }}
        >
          {o.label}
          {o.sub && (
            <span style={{ fontSize: 12, fontWeight: 500, color: sel ? 'rgba(255,255,255,0.75)' : 'var(--ob-label)', transition: 'color .18s var(--ease-out-strong)' }}>
              {o.sub}
            </span>
          )}
          <AnimatePresence>
            {sel && (
              <motion.span
                className="inline-flex"
                initial={{ scale: 0, width: 0 }}
                animate={{ scale: 1, width: 14 }}
                exit={{ scale: 0, width: 0 }}
                transition={OB.SPRING_SOFT}
              >
                <Check size={14} strokeWidth={2.6} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      );
    })}
  </div>
);

/** Single-select photo grid for the atmosphere question. The label rides a
 *  liquid-glass capsule over the photo — glass over content, where it
 *  actually reads as a material. No auto-advance — the wizard's shared
 *  Continue button moves forward, so the answer is committed state by the
 *  time anything reads it. */
export const AtmosphereGrid: React.FC<{
  selected: string | null;
  onSelect: (id: string) => void;
}> = ({ selected, onSelect }) => (
  <div className="grid grid-cols-2 gap-3">
    {TASTE_ATMOSPHERES.map((o, idx) => (
      <motion.button
        key={o.id}
        type="button"
        onClick={() => onSelect(o.id)}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, delay: 0.12 + idx * 0.06, ease: OB.EASE }}
        whileTap={{ scale: 0.97 }}
        className={cn(
          'relative aspect-square rounded-3xl overflow-hidden border-none p-0 cursor-pointer transition-shadow duration-200',
          selected === o.id && 'ring-[2.5px] ring-offset-2',
        )}
        style={selected === o.id ? { ['--tw-ring-color' as string]: OB.TERRA, ['--tw-ring-offset-color' as string]: 'var(--ob-bg)' } : undefined}
      >
        <img src={o.image} alt={o.label} className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" />
        {/* Just enough shading for the glass capsule to sit on. */}
        <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.34), rgba(0,0,0,0.02) 55%)' }} />
        <span
          className="glass-control absolute left-2 right-2 bottom-2 rounded-full text-left"
          style={{ padding: '7px 11px' }}
        >
          <span className="block truncate font-semibold" style={{ fontSize: 11.5, lineHeight: 1.2, letterSpacing: '-0.01em', color: 'var(--ob-ink)' }}>
            {o.label}
          </span>
        </span>
        <AnimatePresence>
          {selected === o.id && (
            <motion.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={OB.SPRING_SOFT}
              className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg"
              style={{ background: OB.TERRA }}
            >
              <Check size={16} strokeWidth={2.6} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    ))}
  </div>
);

/** People-to-follow rail for the wizard. Fetches its own candidates; the
 *  SuggestedPeople cards handle the follow action inline. */
export const FollowRail: React.FC = () => {
  const { user } = useAuth();
  const [people, setPeople] = useState<SuggestedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getSuggestedProfiles({ viewerId: user?.id ?? null, limit: 12 }).then((p) => {
      if (cancelled) return;
      setPeople(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!loading && people.length === 0) {
    return (
      <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ob-label)' }}>
        No one to suggest just yet — you can find people any time from your Circle.
      </p>
    );
  }
  // The wizard page has its own horizontal padding; the rail manages
  // edge-to-edge scrolling itself, so unwrap it.
  return (
    <div style={{ margin: '0 -24px' }}>
      <SuggestedPeople bare people={people} userId={user?.id ?? null} loading={loading && people.length === 0} />
    </div>
  );
};

/**
 * First-ratings step: search a place, tap Rate, and land in the REAL rating
 * flow (AddRestaurantModal → H2H → settle → community publish). Never a
 * parallel quick-rate — that would put unranked scores into the ladder.
 *
 * The host wizard must have <AddRestaurantModal /> mounted: ProfileSetup
 * renders before App's main branch, so App's own instance isn't there.
 */
export const RatePlacesStep: React.FC = () => {
  const { profile } = useAuth();
  const { ratings, openAddRestaurantModal } = useLists();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const req = ++reqRef.current;
    debounceRef.current = setTimeout(async () => {
      // Bias to the home city they gave two steps ago; null coords fall back
      // to a global query-only search, right for "places I've been".
      const found = await searchPlacesByText(q, profile?.home_lat ?? null, profile?.home_lng ?? null)
        .catch(() => [] as PlaceResult[]);
      if (req !== reqRef.current) return;
      setResults(found.slice(0, 8));
      setSearching(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, profile?.home_lat, profile?.home_lng]);

  const ratedIds = new Set(ratings.filter((r) => r.score > 0).map((r) => r.restaurantId));

  return (
    <div className="flex flex-col" style={{ minHeight: 0 }}>
      <div className="relative" style={{ marginBottom: 14 }}>
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--ob-label)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a restaurant you know…"
          className="w-full rounded-2xl focus:outline-none focus:[box-shadow:0_0_0_3.5px_var(--ob-focus-ring)] transition-all"
          style={{
            padding: '14px 16px 14px 44px',
            fontSize: 16,
            fontWeight: 500,
            background: 'var(--ob-field)',
            border: 'none',
            color: 'var(--ob-ink)',
          }}
        />
      </div>
      {searching && results.length === 0 ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl" style={{ height: 62, background: 'var(--ob-divider)' }} />
          ))}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {results.map((place, idx) => {
            const rated = ratedIds.has(place.id);
            const priceStr = priceLevelToString(place.priceLevel);
            const sub = [cuisineLabel(place), priceStr, extractCityState(place.fullAddress, place.address)]
              .filter(Boolean).join(' · ');
            return (
              <motion.li
                key={place.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: Math.min(idx, 6) * 0.04, ease: OB.EASE }}
              >
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.985 }}
                  transition={OB.SPRING}
                  onClick={() => openAddRestaurantModal({
                    id: place.id,
                    name: place.name,
                    image: '',
                    cuisine: cuisineLabel(place),
                    price: priceStr,
                    address: place.fullAddress || place.address,
                  })}
                  className="w-full flex items-center gap-3 rounded-2xl text-left cursor-pointer"
                  style={{ padding: '12px 16px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)' }}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-serif font-bold" style={{ fontSize: 15, lineHeight: 1.2, color: 'var(--ob-ink)' }}>{place.name}</span>
                    <span className="block truncate" style={{ fontSize: 12, marginTop: 3, color: 'var(--ob-label)' }}>{sub}</span>
                  </span>
                  {rated ? (
                    <span className="flex-none inline-flex items-center gap-1" style={{ fontSize: 12, fontWeight: 700, color: OB.TERRA }}>
                      <Check size={13} strokeWidth={2.6} /> Rated
                    </span>
                  ) : (
                    <span className="flex-none inline-flex items-center gap-1 rounded-full text-white" style={{ padding: '0 14px', height: 32, fontSize: 12, fontWeight: 700, background: OB.TERRA }}>
                      <Star size={12} strokeWidth={2.6} /> Rate
                    </span>
                  )}
                </motion.button>
              </motion.li>
            );
          })}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-center" style={{ paddingTop: 20, fontSize: 14, color: 'var(--ob-label)' }}>
              Nothing found — try the restaurant's full name.
            </p>
          )}
        </ul>
      )}
    </div>
  );
};
