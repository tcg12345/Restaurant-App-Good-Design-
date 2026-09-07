import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Search, Sparkles, Star, X, Plus, Heart, Moon, Wine, Coffee } from 'lucide-react';
import { cn } from '../../lib/utils';
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

/**
 * The spend question, asked the way lib/recommendations reads it: ONE
 * usual tier, plus an optional second for occasions. A single dominant
 * tier is what crosses priceDist's concentration bar and switches on the
 * price-restricted queries; the old multi-select silently took whichever
 * chip was tapped FIRST as that tier and never said so — someone who
 * tapped $$$$ then $$ told the engine they mostly eat at $$$$.
 */
export const PriceStep: React.FC<{
  primary?: number;
  secondary?: number;
  onChange: (primary: number | undefined, secondary: number | undefined) => void;
}> = ({ primary, secondary, onChange }) => {
  const [occasionOpen, setOccasionOpen] = useState(secondary !== undefined);
  return <div className="ob-budget">
    <div className="ob-choice-list" role="group" aria-label="Everyday budget">
      {TASTE_PRICES.map((t) => <motion.button type="button" key={t.tier}
        className="ob-budget-card" aria-pressed={primary === t.tier}
        whileTap={{ scale: .985 }} onClick={() => onChange(primary === t.tier ? undefined : t.tier, secondary)}>
        <span className="ob-price-symbol">{t.label}</span>
        <span><strong>{t.sub}</strong><small>{['Easy, everyday favorites', 'A relaxed meal out', 'Something a little special', 'The full dining experience'][t.tier - 1]}</small></span>
        <span className="ob-selection-indicator">{primary === t.tier && <Check size={14} />}</span>
      </motion.button>)}
    </div>
    <button type="button" className="ob-disclosure" aria-expanded={occasionOpen} onClick={() => setOccasionOpen(!occasionOpen)}>
      <Plus size={16} /><span>A different budget for celebrations?</span>
    </button>
    {occasionOpen && <div className="ob-occasion"><OB.FieldLabel>For special occasions · optional</OB.FieldLabel>
      <TastePillGrid options={TASTE_PRICES.map(t => ({ id: String(t.tier), label: t.label }))}
        selected={secondary ? [String(secondary)] : []}
        onToggle={id => onChange(primary, Number(id) === secondary ? undefined : Number(id))} />
    </div>}
    <p className="ob-hint">A starting point, never a limit. You can explore every price range.</p>
  </div>;
};

export const ATMOSPHERE_OPTIONS = [
  { id: 'intimate', title: 'Cozy & intimate', description: 'Good conversation, a table for two.', icon: Heart },
  { id: 'vibrant', title: 'Lively & social', description: 'A little buzz, a great night out.', icon: Wine },
  { id: 'minimalist', title: 'Calm & relaxed', description: 'Quiet corners and room to unwind.', icon: Moon },
  { id: 'rustic', title: 'Warm & welcoming', description: 'Neighborhood charm. Come as you are.', icon: Coffee },
];
export const AtmosphereStep: React.FC<{ selected?: string; onChange: (id: string | undefined) => void }> = ({ selected, onChange }) => (
  <div className="ob-vibe-grid" role="group" aria-label="Dining atmosphere">
    {ATMOSPHERE_OPTIONS.map(({ id, title, description, icon: Icon }) => <motion.button
      key={id} type="button" className="ob-vibe-card" aria-pressed={selected === id}
      whileTap={{ scale: .97 }} onClick={() => onChange(selected === id ? undefined : id)}>
      <span className="ob-vibe-icon"><Icon size={25} strokeWidth={1.4} /></span>
      <strong>{title}</strong><small>{description}</small>
      <span className="ob-selection-indicator">{selected === id && <Check size={14} />}</span>
    </motion.button>)}
  </div>
);

/** Multi-select chip grid. `dense` shrinks the chips (for the cuisines
 *  grid, which has far more options to fit on one screen than a plain
 *  preference list does).
 *
 *  Restyled from flat gray fills to bordered card capsules: on the plain
 *  onboarding background a gray fill read as disabled, and forty of them
 *  read as a wall. A hairline border + card surface gives each chip an
 *  edge to hold onto, and selection swaps the whole material — terracotta
 *  fill, matching border, a soft glow — instead of only recoloring, so
 *  picks are findable at a glance in a long grid. */
export const TastePillGrid: React.FC<{
  options: Array<{ id: string; label: string; sub?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  dense?: boolean;
}> = ({ options, selected, onToggle, dense }) => (
  <div className={cn('flex flex-wrap', dense ? 'gap-2' : 'gap-2.5')}>
    {options.map((o, idx) => {
      const sel = selected.includes(o.id);
      return (
        <motion.button
          key={o.id}
          type="button"
          onClick={() => onToggle(o.id)}
          aria-pressed={sel}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.3, delay: dense ? 0 : 0.12 + Math.min(idx, 12) * 0.022, ease: OB.EASE }}
          whileTap={{ scale: 0.95 }}
          className="inline-flex items-center gap-2 rounded-full cursor-pointer"
          style={{
            minHeight: 44,
            padding: dense ? '0 15px' : '0 18px',
            fontSize: dense ? 13.5 : 14.5,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            background: sel ? OB.TERRA : 'var(--ob-card)',
            // ON_TERRA, never a literal white: the selected fill is bone
            // on the dark theme, where white text vanished into it.
            color: sel ? OB.ON_TERRA : 'var(--ob-ink)',
            border: `1px solid ${sel ? OB.TERRA : 'var(--ob-border)'}`,
            boxShadow: sel
              ? '0 6px 16px -6px color-mix(in srgb, var(--ob-terra) 55%, transparent)'
              : '0 1px 2px rgba(0,0,0,0.04)',
            transition: 'background .18s var(--ease-out-strong), color .18s var(--ease-out-strong), border-color .18s var(--ease-out-strong), box-shadow .18s var(--ease-out-strong)',
          }}
        >
          {o.label}
          {o.sub && (
            <span style={{ fontSize: 12, fontWeight: 500, color: sel ? 'color-mix(in srgb, var(--ob-on-terra) 78%, transparent)' : 'var(--ob-label)', transition: 'color .18s var(--ease-out-strong)' }}>
              {o.sub}
            </span>
          )}
          <AnimatePresence>
            {sel && (
              <motion.span
                className="inline-flex"
                initial={{ scale: 0, width: 0 }}
                animate={{ scale: 1, width: dense ? 13 : 14 }}
                exit={{ scale: 0, width: 0 }}
                transition={OB.SPRING_SOFT}
              >
                <Check size={dense ? 13 : 14} strokeWidth={2.6} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      );
    })}
  </div>
);

/** Stable, always-visible search: no native overlay, focus handoff or
 * animated field replacement while the user is typing. */
export const CuisineGrid: React.FC<{
  options: string[]; selected: string[]; onToggle: (id: string) => void;
}> = ({ options, selected, onToggle }) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const searching = query.trim().length > 0;
  const filtered = searching ? searchCuisines(query, options)
    : options.filter((c, i) => expanded || i < 10 || selected.includes(c));
  return <div className="ob-cuisines">
    <OB.Field value={query} onChange={setQuery} placeholder="Find a cuisine" name="Search cuisines"
      icon={<Search size={19} />} autoCapitalize="off" autoComplete="off"
      rightSlot={query ? <button type="button" className="ob-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button> : undefined} />
    <div className="ob-selection-caption" aria-live="polite"><span>{searching ? `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}` : 'Pick a few favorites'}</span><span>{selected.length} selected</span></div>
    <div className="ob-cuisine-grid" role="group" aria-label="Favorite cuisines">
      {filtered.map(c => <motion.button type="button" key={c} className="ob-cuisine-card"
        aria-pressed={selected.includes(c)} whileTap={{ scale: .97 }} onClick={() => onToggle(c)}>
        <span>{c}</span><span className="ob-selection-indicator">{selected.includes(c) ? <Check size={13} /> : <Plus size={13} />}</span>
      </motion.button>)}
    </div>
    {filtered.length === 0 && <p className="ob-hint">No cuisines found. Try another name.</p>}
    {!searching && <button type="button" className="ob-disclosure" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      {expanded ? 'Show fewer cuisines' : `Explore all ${options.length} cuisines`}<span aria-hidden>↗</span>
    </button>}
  </div>;
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

/** One dense row, shared by the search results and the starter
 *  suggestions — same shape either way, so the list doesn't visibly change
 *  character the moment a search clears back to suggestions. Name and
 *  cuisine/price share a single line rather than stacking, so a screen
 *  that's meant to offer a lot of starting points can actually fit a lot
 *  of them without turning into a scroll of tall cards. */
const RatePlaceRow: React.FC<{
  id: string; name: string; sub: string; rated: boolean;
  index: number; onRate: () => void;
}> = ({ name, sub, rated, index, onRate }) => (
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
      style={{ padding: '9px 14px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)' }}
    >
      <span className="flex-1 min-w-0 truncate" style={{ fontSize: 13.5, lineHeight: 1.3 }}>
        <span className="font-serif font-bold" style={{ color: 'var(--ob-ink)' }}>{name}</span>
        <span style={{ color: 'var(--ob-label)' }}> · {sub}</span>
      </span>
      {rated ? (
        <span className="flex-none inline-flex items-center gap-1" style={{ fontSize: 12, fontWeight: 700, color: OB.TERRA }}>
          <Check size={13} strokeWidth={2.6} /> Rated
        </span>
      ) : (
        <span className="flex-none inline-flex items-center gap-1 rounded-full" style={{ padding: '0 14px', height: 30, fontSize: 12, fontWeight: 700, background: OB.TERRA, color: OB.ON_TERRA }}>
          <Star size={12} strokeWidth={2.6} /> Rate
        </span>
      )}
    </motion.button>
  </motion.li>
);

/**
 * First-ratings step: search a place, tap Rate, and land in the REAL rating
 * flow (RatingFlow → H2H → settle → community publish). Never a
 * parallel quick-rate — that would put unranked scores into the ladder.
 *
 * Below an empty search box, this always offers a starting point rather
 * than a blank page: real nearby places, run through the same cold-start
 * recommendation path as the pre-auth preview (lib/taste-preview), seeded
 * by the cuisines/prices this same wizard just asked and the home city from
 * two steps ago. A search takes over the list the moment there's a query;
 * clearing it returns to the suggestions.
 *
 * The host wizard must have <RatingFlow /> mounted: ProfileSetup
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
    fetchTastePreview({ cuisines, prices }, city, { limit: 20 })
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
      // Bias to the same city the suggestions use — the one picked earlier
      // in THIS wizard. This used to read profile.home_lat, which is null
      // for every new account until the wizard's final refreshProfile, so
      // the search that was meant to be "near you" was global for exactly
      // the people this step exists for. Null coords still fall back to a
      // query-only search, right for "places I've been" elsewhere.
      const found = await searchPlacesByText(q, city?.lat ?? null, city?.lng ?? null)
        .catch(() => [] as PlaceResult[]);
      if (req !== reqRef.current) return;
      setResults(found.slice(0, 8));
      setSearching(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, city?.lat, city?.lng]);

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
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl" style={{ height: 48, background: 'var(--ob-divider)' }} />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
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
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl" style={{ height: 48, background: 'var(--ob-divider)' }} />
              ))}
            </div>
          ) : suggestions && suggestions.length > 0 ? (
            <ul className="space-y-2">
              {suggestions.map((place, idx) => (
                <RatePlaceRow
                  key={place.id}
                  id={place.id}
                  name={place.name}
                  sub={[cuisineLabel(place), priceLevelToString(place.priceLevel)].filter(Boolean).join(' · ')}
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
