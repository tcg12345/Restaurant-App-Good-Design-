import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Search, Sparkles, Star } from 'lucide-react';
import { cn } from '../../lib/utils';
import { GlassButton } from '../../lib/glass-buttons';
import { SearchField } from '../SearchField';
import * as OB from './OnboardingKit';
import { useAuth } from '../../contexts/AuthContext';
import { useLists } from '../../contexts/ListsContext';
import { searchPlacesByText, priceLevelToString, extractCityState, type PlaceResult } from '../../lib/places';
import { cuisineLabel, searchCuisines } from '../../lib/cuisine';
import { getSuggestedProfiles, type SuggestedProfile } from '../../lib/supabase-community';
import { SuggestedPeople } from '../SuggestedPeople';
import { fetchTastePreview } from '../../lib/taste-preview';
import type { ScoredPlace } from '../../lib/recommendations';
import type { HomeLocation } from '../HomeLocationBar';

/**
 * The taste-and-first-actions steps of the signup wizard (ProfileSetup).
 *
 * These used to be a standalone /onboarding page; they're wizard steps now so
 * account setup reads as ONE flow — name to handle to city to taste to first
 * follows to first ratings — under a single progress bar.
 *
 * The admission rule for a question: it must change what the app does
 * afterwards. Every option set here is consumed by lib/recommendations.ts
 * as cold-start query priors (cuisines and price), fading as real ratings
 * accumulate.
 */

/** Labels MUST match CUISINE_TYPES labels (lib/places.ts) — the rec engine
 *  credits them against rating cuisine tokens verbatim. Deliberately just
 *  the food-and-origin half of that list: venue formats ('Cafe', 'Bar',
 *  'Food Court') and dietary labels ('Halal', 'Kosher', 'Vegan' — the
 *  dietary quiz step already covers that ground) would answer a different
 *  question than "which cuisines do you love". */
export const TASTE_CUISINES = [
  'Italian', 'Japanese', 'Mexican', 'Thai', 'Indian', 'American',
  'French', 'Chinese', 'Korean', 'Mediterranean', 'Vietnamese', 'Greek',
  'Spanish', 'Middle Eastern', 'Seafood', 'Steakhouse', 'Sushi', 'BBQ',
  'Afghan', 'African', 'Asian Fusion', 'Brazilian', 'Burgers', 'Cajun',
  'Caribbean', 'Cuban', 'Dim Sum', 'Ethiopian', 'Filipino', 'Hawaiian',
  'Hot Pot', 'Indonesian', 'Irish', 'Kebab', 'Latin American', 'Lebanese',
  'Malaysian', 'Mongolian', 'Moroccan', 'Peruvian', 'Pizza', 'Polish',
  'Portuguese', 'Ramen', 'Russian', 'Soul Food', 'Southern', 'Taco',
  'Tapas', 'Tex-Mex', 'Turkish',
];

/** ids are the Google price tiers 1–4 — they land in taste_profile.prices
 *  as numbers and drive the price prior + price-restricted queries. */
export const TASTE_PRICES: Array<{ tier: number; label: string; sub: string }> = [
  { tier: 1, label: '$', sub: 'Cheap eats' },
  { tier: 2, label: '$$', sub: 'Casual dinner' },
  { tier: 3, label: '$$$', sub: 'A nice night out' },
  { tier: 4, label: '$$$$', sub: 'Special occasions' },
];

/** Multi-select chip grid: quiet filled capsules that spring to the accent
 *  when chosen, with the check popping in. `dense` shrinks the chips (for
 *  the cuisines grid, which has far more options to fit on one screen than
 *  a plain preference list does). */
export const TastePillGrid: React.FC<{
  options: Array<{ id: string; label: string; sub?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  dense?: boolean;
}> = ({ options, selected, onToggle, dense }) => (
  <div className={cn('flex flex-wrap', dense ? 'gap-1.5' : 'gap-2.5')}>
    {options.map((o, idx) => {
      const sel = selected.includes(o.id);
      return (
        <motion.button
          key={o.id}
          type="button"
          onClick={() => onToggle(o.id)}
          layout="position"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.3, delay: dense ? 0 : 0.12 + Math.min(idx, 12) * 0.022, ease: OB.EASE }}
          whileTap={{ scale: 0.94 }}
          className="inline-flex items-center gap-2 rounded-full border-none cursor-pointer"
          style={{
            minHeight: dense ? 34 : 44,
            padding: dense ? '0 13px' : '0 17px',
            fontSize: dense ? 12.5 : 14,
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
                animate={{ scale: 1, width: dense ? 12 : 14 }}
                exit={{ scale: 0, width: 0 }}
                transition={OB.SPRING_SOFT}
              >
                <Check size={dense ? 12 : 14} strokeWidth={2.6} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      );
    })}
  </div>
);

/**
 * How many chips show before you search. The point of the browsable grid is
 * to fill the screen once, not to become a scrolling list — TASTE_CUISINES
 * is deliberately longer than this, and search is how you reach the tail.
 * The first entries in TASTE_CUISINES are the common ones, so the visible
 * set is the useful set.
 */
const CUISINE_VISIBLE_CAP = 30;

/** The cuisines question's own grid: TastePillGrid, dense, with a search
 *  trigger that morphs into a liquid-glass filter bar. The full list (far
 *  longer than a "pick a few" question usually has) is what makes typing
 *  three letters faster than scanning for it — the icon starts collapsed
 *  so the question still reads as approachable, not like a search page.
 *
 *  Anything already selected is always shown, even when it sits past the
 *  cap: a chip must never disappear because of where it happens to fall in
 *  the source list, or closing the search would look like it dropped a pick. */
export const CuisineGrid: React.FC<{
  options: string[];
  selected: string[];
  onToggle: (id: string) => void;
}> = ({ options, selected, onToggle }) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  // searchCuisines, not a bare `includes`: it ranks prefix matches first and
  // resolves the app's cuisine aliases, so "barbecue" finds BBQ and "med"
  // finds Mediterranean.
  const matches = searchCuisines(query, options);
  const searching = query.trim().length > 0;
  const filtered = searching
    ? matches
    : (() => {
        const head = options.slice(0, CUISINE_VISIBLE_CAP);
        const shown = new Set(head);
        // Keep source order so chips don't reshuffle as picks change.
        return options.filter((c) => shown.has(c) || selected.includes(c));
      })();
  const hiddenCount = searching ? 0 : options.length - filtered.length;

  return (
    <div>
      <div className="flex items-center justify-end" style={{ marginBottom: 12, minHeight: 44 }}>
        <AnimatePresence mode="wait" initial={false}>
          {searchOpen ? (
            <motion.div
              key="bar"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={OB.SPRING}
              className="flex items-center gap-2"
              style={{ width: '100%' }}
            >
              {/* The app's own field, handed to the native glass layer by
                  `glassId` — a real UIGlassEffect capsule on iOS 26, the
                  shared `.ios-search` material everywhere else. Hand-rolling
                  `.glass-control` here looked flat: that class is only the
                  fallback, and its backdrop-filter has nothing to refract
                  against a plain onboarding background. */}
              <SearchField
                className="flex-1 min-w-0"
                glassId="onboarding-cuisine-search"
                value={query}
                onChange={setQuery}
                placeholder="Search cuisines"
                aria-label="Search cuisines"
                leadingIcon={<Search size={20} strokeWidth={2.4} />}
                autoFocus
              />
              {/* Plain text, not a second glass capsule — glass beside glass
                  reads as two objects fighting, and iOS puts a flat Cancel
                  next to a search bar for exactly this reason. */}
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setQuery(''); }}
                className="bg-transparent border-none cursor-pointer flex-shrink-0 p-0"
                style={{ fontSize: 15, fontWeight: 600, color: OB.TERRA }}
              >
                Cancel
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={OB.SPRING}
            >
              <GlassButton
                id="cuisine-search-open"
                symbol="magnifyingglass"
                label="Search cuisines"
                onClick={() => setSearchOpen(true)}
                className="flex items-center justify-center rounded-full border-none cursor-pointer active:scale-90 transition-transform"
                // 44, the size the rest of the app's glass chrome uses: a
                // lens needs enough of itself for the material to read, and
                // it lands on the minimum touch target.
                style={{ width: 44, height: 44 }}
              >
                <Search size={20} strokeWidth={2.2} style={{ color: 'var(--ob-ink-soft)' }} />
              </GlassButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {filtered.length > 0 ? (
        <TastePillGrid
          dense
          options={filtered.map((c) => ({ id: c, label: c }))}
          selected={selected}
          onToggle={onToggle}
        />
      ) : (
        <p style={{ fontSize: 14, color: 'var(--ob-label)', padding: '8px 2px' }}>
          No cuisines match "{query.trim()}".
        </p>
      )}
      {hiddenCount > 0 && !searchOpen && (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="bg-transparent border-none cursor-pointer p-0"
          style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: OB.TERRA }}
        >
          + {hiddenCount} more — search to find yours
        </button>
      )}
    </div>
  );
};

/** People-to-follow list for the wizard: a full vertical stack (not a rail —
 *  this screen has nothing else on it to share space with), so the person
 *  scrolls a real list rather than swiping three-at-a-time. Fetches its own
 *  candidates; the SuggestedPeople rows handle the follow action inline. */
export const FollowRail: React.FC = () => {
  const { user } = useAuth();
  const [people, setPeople] = useState<SuggestedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getSuggestedProfiles({ viewerId: user?.id ?? null, limit: 20 }).then((p) => {
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
  return (
    <SuggestedPeople bare layout="list" people={people} userId={user?.id ?? null} loading={loading && people.length === 0} />
  );
};

/** One row, shared by the search results and the starter suggestions —
 *  same shape either way, so the list doesn't visibly change character the
 *  moment a search clears back to suggestions. */
const RatePlaceRow: React.FC<{
  id: string; name: string; sub: string; why?: string; rated: boolean;
  index: number; onRate: () => void;
}> = ({ name, sub, why, rated, index, onRate }) => (
  <motion.li
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.04, ease: OB.EASE }}
  >
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      transition={OB.SPRING}
      onClick={onRate}
      className="w-full flex items-center gap-3 rounded-2xl text-left cursor-pointer"
      style={{ padding: '12px 16px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)' }}
    >
      <span className="flex-1 min-w-0">
        <span className="block truncate font-serif font-bold" style={{ fontSize: 15, lineHeight: 1.2, color: 'var(--ob-ink)' }}>{name}</span>
        <span className="block truncate" style={{ fontSize: 12, marginTop: 3, color: 'var(--ob-label)' }}>{sub}</span>
        {why && (
          <span className="mt-1.5 inline-block rounded-full" style={{ padding: '3px 9px', fontSize: 10.5, fontWeight: 600, color: OB.TERRA, background: 'var(--ob-badge-bg)' }}>
            {why}
          </span>
        )}
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

/**
 * First-ratings step: search a place, tap Rate, and land in the REAL rating
 * flow (AddRestaurantModal → H2H → settle → community publish). Never a
 * parallel quick-rate — that would put unranked scores into the ladder.
 *
 * Below an empty search box, this always offers a starting point rather
 * than a blank page: real nearby places, run through the same cold-start
 * recommendation path as the pre-auth preview (lib/taste-preview), seeded
 * by the cuisines/prices this same wizard just asked and the home city from
 * two steps ago. A search takes over the list the moment there's a query;
 * clearing it returns to the suggestions.
 *
 * The host wizard must have <AddRestaurantModal /> mounted: ProfileSetup
 * renders before App's main branch, so App's own instance isn't there.
 */
export const RatePlacesStep: React.FC<{
  cuisines?: string[];
  prices?: number[];
  homeGeo?: HomeLocation | null;
}> = ({ cuisines = [], prices = [], homeGeo = null }) => {
  const { profile } = useAuth();
  const { ratings, openAddRestaurantModal } = useLists();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqRef = useRef(0);

  // The location to suggest around: the city picked earlier in THIS wizard
  // if it geocoded, else the account's existing home location. No city, no
  // location-biased suggestions — nothing to fall back to that wouldn't be
  // a guess.
  const city: HomeLocation | null = homeGeo
    ?? (profile?.home_city && typeof profile.home_lat === 'number' && typeof profile.home_lng === 'number'
      ? { label: profile.home_city, lat: profile.home_lat, lng: profile.home_lng }
      : null);

  const [suggestions, setSuggestions] = useState<ScoredPlace[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    if (!city || suggestions !== null) return;
    let cancelled = false;
    setSuggesting(true);
    fetchTastePreview({ cuisines, prices }, city, { limit: 8 })
      .then((places) => { if (!cancelled) setSuggestions(places); })
      .finally(() => { if (!cancelled) setSuggesting(false); });
    return () => { cancelled = true; };
    // Deliberately fires once: the wizard doesn't change city/taste answers
    // out from under this step while it's showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.lat, city?.lng]);

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
  const searchingActive = query.trim().length >= 2;

  const rate = (place: { id: string; name: string; fullAddress?: string; address?: string; priceLevel?: PlaceResult['priceLevel'] } & Partial<PlaceResult>) => {
    const priceStr = priceLevelToString(place.priceLevel);
    openAddRestaurantModal({
      id: place.id,
      name: place.name,
      image: '',
      cuisine: cuisineLabel(place as PlaceResult),
      price: priceStr,
      address: place.fullAddress || place.address || '',
    });
  };

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

      {searchingActive ? (
        searching && results.length === 0 ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl" style={{ height: 62, background: 'var(--ob-divider)' }} />
            ))}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {results.map((place, idx) => (
              <RatePlaceRow
                key={place.id}
                id={place.id}
                name={place.name}
                sub={[cuisineLabel(place), priceLevelToString(place.priceLevel), extractCityState(place.fullAddress, place.address)].filter(Boolean).join(' · ')}
                rated={ratedIds.has(place.id)}
                index={idx}
                onRate={() => rate(place)}
              />
            ))}
            {!searching && results.length === 0 && (
              <p className="text-center" style={{ paddingTop: 20, fontSize: 14, color: 'var(--ob-label)' }}>
                Nothing found — try the restaurant's full name.
              </p>
            )}
          </ul>
        )
      ) : (
        <div>
          {city && (suggesting || (suggestions?.length ?? 0) > 0) && (
            <div className="flex items-center gap-1.5" style={{ marginBottom: 10 }}>
              <Sparkles size={13} strokeWidth={2.4} style={{ color: OB.TERRA }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ob-label)' }}>
                Picked for you near {city.label.split(',')[0]}
              </span>
            </div>
          )}
          {suggesting ? (
            <div className="space-y-2.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl" style={{ height: 62, background: 'var(--ob-divider)' }} />
              ))}
            </div>
          ) : suggestions && suggestions.length > 0 ? (
            <ul className="space-y-2.5">
              {suggestions.map((place, idx) => (
                <RatePlaceRow
                  key={place.id}
                  id={place.id}
                  name={place.name}
                  sub={[cuisineLabel(place), priceLevelToString(place.priceLevel)].filter(Boolean).join(' · ')}
                  why={place.tasteReasons?.[0] ?? place.reasons?.[0]}
                  rated={ratedIds.has(place.id)}
                  index={idx}
                  onRate={() => rate(place)}
                />
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ob-label)' }}>
              Search for a restaurant above to add your first rating.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
