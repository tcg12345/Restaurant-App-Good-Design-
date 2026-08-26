import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, ArrowLeft, Check, Search, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { saveTasteQuiz } from '../lib/taste-quiz';
import { searchPlacesByText, priceLevelToString, extractCityState, type PlaceResult } from '../lib/places';
import { cuisineLabel } from '../lib/cuisine';
import { getSuggestedProfiles, type SuggestedProfile } from '../lib/supabase-community';
import { SuggestedPeople } from '../components/SuggestedPeople';

/**
 * Post-signup onboarding: three taste questions, then two actions.
 *
 * Every page here must change what the app does afterwards — that's the
 * admission rule. The questions seed the recommendation engine's cold-start
 * priors (lib/recommendations.ts consumes all three: cuisines and price as
 * query-shaping priors, atmosphere as rating-tag priors that fade as real
 * ratings accumulate). The old flavor and frequency questions were cut for
 * failing exactly that rule: they were collected and consumed by nothing.
 *
 * The two action steps exist because a ranking app with an empty ladder and
 * an empty feed is an empty product: following people fills the feed on the
 * first open, and the first ratings light up the profile, the H2H ladder,
 * and the taste profile with real evidence instead of stated preference.
 */

type QuestionOption = { id: string; label: string; sub?: string; image?: string };
type Question = {
  key: 'cuisines' | 'prices' | 'atmosphere';
  type: 'image' | 'pill';
  multi?: boolean;
  question: string;
  options: QuestionOption[];
};

const QUESTIONS: Question[] = [
  {
    key: 'cuisines',
    type: 'pill',
    multi: true,
    question: 'Which cuisines do you love?',
    // Labels MUST match CUISINE_TYPES labels (lib/places.ts) — the rec
    // engine credits them against rating cuisine tokens verbatim.
    options: [
      { id: 'italian', label: 'Italian' },
      { id: 'japanese', label: 'Japanese' },
      { id: 'mexican', label: 'Mexican' },
      { id: 'thai', label: 'Thai' },
      { id: 'indian', label: 'Indian' },
      { id: 'american', label: 'American' },
      { id: 'french', label: 'French' },
      { id: 'chinese', label: 'Chinese' },
      { id: 'korean', label: 'Korean' },
      { id: 'mediterranean', label: 'Mediterranean' },
      { id: 'vietnamese', label: 'Vietnamese' },
      { id: 'greek', label: 'Greek' },
      { id: 'spanish', label: 'Spanish' },
      { id: 'middle-eastern', label: 'Middle Eastern' },
      { id: 'seafood', label: 'Seafood' },
      { id: 'steakhouse', label: 'Steakhouse' },
      { id: 'sushi', label: 'Sushi' },
      { id: 'bbq', label: 'BBQ' },
    ],
  },
  {
    key: 'prices',
    type: 'pill',
    multi: true,
    question: 'What do you usually spend on a night out?',
    // ids are the Google price tiers — they land in taste_profile.prices as
    // numbers and drive the price prior + price-restricted queries.
    options: [
      { id: '1', label: '$', sub: 'Cheap eats' },
      { id: '2', label: '$$', sub: 'Casual dinner' },
      { id: '3', label: '$$$', sub: 'A nice night out' },
      { id: '4', label: '$$$$', sub: 'Special occasions' },
    ],
  },
  {
    key: 'atmosphere',
    type: 'image',
    question: "What's your ideal dining atmosphere?",
    // Option ids map onto rating-tag priors — see ATMOSPHERE_TAG_PRIORS in
    // lib/recommendations.ts before renaming any of them.
    options: [
      { id: 'intimate', label: 'Intimate & Dimly Lit', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=400' },
      { id: 'vibrant', label: 'Vibrant & Social', image: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&q=80&w=400' },
      { id: 'minimalist', label: 'Minimalist & Zen', image: 'https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?auto=format&fit=crop&q=80&w=400' },
      { id: 'rustic', label: 'Rustic & Organic', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=400' },
    ],
  },
];

/** Question pages + the follow page + the first-ratings page. */
const TOTAL_STEPS = QUESTIONS.length + 2;
const FOLLOW_STEP = QUESTIONS.length;
const RATE_STEP = QUESTIONS.length + 1;

const KICKER: Record<number, string> = {
  [FOLLOW_STEP]: 'Your circle',
  [RATE_STEP]: 'First ratings',
};

export const Onboarding: React.FC = () => {
  const [step, setStep] = useState(0);
  const [cuisineSel, setCuisineSel] = useState<string[]>([]);
  const [priceSel, setPriceSel] = useState<number[]>([]);
  const [atmosphere, setAtmosphere] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { ratings, openAddRestaurantModal } = useLists();

  // ── Follow step data ──
  const [people, setPeople] = useState<SuggestedProfile[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const peopleFetchedRef = useRef(false);
  useEffect(() => {
    if (step !== FOLLOW_STEP || peopleFetchedRef.current) return;
    peopleFetchedRef.current = true;
    setPeopleLoading(true);
    getSuggestedProfiles({ viewerId: user?.id ?? null, limit: 12 }).then((p) => {
      setPeople(p);
      setPeopleLoading(false);
    });
  }, [step, user?.id]);

  // ── Rate step data ──
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeReqRef = useRef(0);
  useEffect(() => {
    if (step !== RATE_STEP) return;
    if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current);
    const q = placeQuery.trim();
    if (q.length < 2) { setPlaceResults([]); setPlaceSearching(false); return; }
    setPlaceSearching(true);
    const req = ++placeReqRef.current;
    placeDebounceRef.current = setTimeout(async () => {
      // Bias to the home city they just gave us; null coords fall back to a
      // global query-only search, which is right for "places I've been".
      const found = await searchPlacesByText(q, profile?.home_lat ?? null, profile?.home_lng ?? null).catch(() => [] as PlaceResult[]);
      if (req !== placeReqRef.current) return;
      setPlaceResults(found.slice(0, 8));
      setPlaceSearching(false);
    }, 350);
    return () => { if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current); };
  }, [placeQuery, step, profile?.home_lat, profile?.home_lng]);

  const ratedIds = new Set(ratings.filter((r) => r.score > 0).map((r) => r.restaurantId));
  // Ratings that exist NOW but didn't when this page mounted — the measure
  // of what onboarding itself achieved, and what the footer count shows.
  const initialRatedRef = useRef<Set<string> | null>(null);
  if (initialRatedRef.current === null) initialRatedRef.current = new Set(ratedIds);
  const ratedHere = [...ratedIds].filter((id) => !initialRatedRef.current!.has(id)).length;

  /** Persist whatever's been answered. Runs when the question phase ends
   *  (forward or via Skip) — an upsert, so repeats just refresh the row. */
  /** `atmoJustPicked` exists because the atmosphere step saves from a
   *  setTimeout fired in the SAME render as the pick — reading the state
   *  there gets the pre-click value (verified: the row saved with no
   *  atmosphere at all). The fresh value rides in as an argument instead. */
  const persistAnswers = (atmoJustPicked?: string) => {
    const atmo = atmoJustPicked ?? atmosphere ?? undefined;
    if (cuisineSel.length === 0 && priceSel.length === 0 && !atmo) return;
    void saveTasteQuiz(user?.id, {
      cuisines: cuisineSel
        .map((id) => QUESTIONS[0].options.find((o) => o.id === id)?.label)
        .filter((l): l is string => !!l),
      prices: priceSel,
      atmosphere: atmo,
      completedAt: Date.now(),
    });
  };

  const advance = (atmoJustPicked?: string) => {
    if (step === QUESTIONS.length - 1) persistAnswers(atmoJustPicked);
    if (step < TOTAL_STEPS - 1) setStep(step + 1);
    else navigate('/');
  };

  const handleSkipAll = () => {
    persistAnswers();
    navigate('/');
  };

  const handleSelect = (optionId: string) => {
    const q = QUESTIONS[step];
    if (q.key === 'cuisines') {
      setCuisineSel((prev) => prev.includes(optionId) ? prev.filter((c) => c !== optionId) : [...prev, optionId]);
      return;
    }
    if (q.key === 'prices') {
      const tier = Number(optionId);
      setPriceSel((prev) => prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]);
      return;
    }
    // Atmosphere: single-select, auto-advance — the picked id is passed
    // through so the save doesn't read this render's stale state.
    setAtmosphere(optionId);
    setTimeout(() => advance(optionId), 300);
  };

  const question = step < QUESTIONS.length ? QUESTIONS[step] : null;
  const multiSel = question?.key === 'cuisines' ? cuisineSel : priceSel.map(String);
  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <div className="min-h-screen bg-surface flex flex-col px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
      <header className="flex items-center justify-between mb-10">
        <button
          onClick={() => step > 0 && setStep(step - 1)}
          className={cn('p-3 glass rounded-full text-on-surface transition-opacity', step === 0 && 'opacity-0 pointer-events-none')}
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1 mx-8 h-1.5 bg-on-surface/[0.1] rounded-full overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="h-full bg-primary" />
        </div>
        <button
          onClick={handleSkipAll}
          className="text-xs font-bold uppercase tracking-widest text-on-surface/40 hover:text-primary transition-colors"
        >
          Skip
        </button>
      </header>

      <main className="flex-1 flex flex-col">
        {/* Keyed motion.div WITHOUT AnimatePresence, deliberately. This page
            renders inside App's route stack, which is itself an
            AnimatePresence child — and a nested presence there never
            completes its exits, so the quiz froze on its first page while
            the step state advanced underneath (the original orphaned quiz
            had the same structure and could never have advanced either).
            The keyed div still plays the entrance on every step change. */}
        <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex-1 flex flex-col"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-2">
              {KICKER[step] ?? 'Palette Test'} • {step + 1}/{TOTAL_STEPS}
            </p>

            {/* ═══════════ Questions ═══════════ */}
            {question && (
              <>
                <h2 className="text-4xl font-serif font-bold mb-10 leading-tight">{question.question}</h2>

                {question.type === 'image' ? (
                  <div className="grid grid-cols-2 gap-4 flex-1">
                    {question.options.map((option) => (
                      <motion.button
                        key={option.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSelect(option.id)}
                        className={cn(
                          'relative aspect-[4/5] rounded-3xl overflow-hidden group transition-all duration-300',
                          atmosphere === option.id ? 'ring-4 ring-primary ring-offset-4 ring-offset-surface' : '',
                        )}
                      >
                        <img
                          src={option.image}
                          alt={option.label}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                        <div className="absolute bottom-6 left-6 right-6 text-left">
                          <h4 className="font-serif font-bold text-xl text-white leading-tight">{option.label}</h4>
                        </div>
                        {atmosphere === option.id && (
                          <div className="absolute top-6 right-6 w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white shadow-xl">
                            <Check size={20} />
                          </div>
                        )}
                      </motion.button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-3 content-start">
                      {question.options.map((option) => {
                        const isSelected = multiSel.includes(option.id);
                        return (
                          <motion.button
                            key={option.id}
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => handleSelect(option.id)}
                            className={cn(
                              'min-h-[44px] px-6 rounded-full font-medium text-sm transition-colors duration-200 inline-flex items-center gap-2',
                              isSelected
                                ? 'bg-primary text-white shadow-lg shadow-primary/25'
                                : 'bg-white/70 backdrop-blur-sm border border-black/5 text-on-surface hover:bg-white',
                            )}
                          >
                            <span className="font-semibold">{option.label}</span>
                            {option.sub && (
                              <span className={cn('text-xs', isSelected ? 'text-white/75' : 'text-on-surface/45')}>{option.sub}</span>
                            )}
                            {isSelected && <Check size={16} />}
                          </motion.button>
                        );
                      })}
                    </div>
                    <motion.button
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => advance()}
                      disabled={multiSel.length === 0}
                      className="mt-10 self-start inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-full font-semibold text-sm shadow-lg shadow-primary/25 disabled:opacity-50 disabled:shadow-none transition-opacity"
                    >
                      {multiSel.length > 0 ? `Continue with ${multiSel.length} pick${multiSel.length === 1 ? '' : 's'}` : 'Pick at least one'}
                      <ChevronRight size={16} />
                    </motion.button>
                  </>
                )}
              </>
            )}

            {/* ═══════════ Follow ═══════════ */}
            {step === FOLLOW_STEP && (
              <>
                <h2 className="text-4xl font-serif font-bold mb-3 leading-tight">Follow a few tastemakers</h2>
                <p className="text-sm text-on-surface/50 mb-8 leading-relaxed max-w-[300px]">
                  Their ratings, posts, and cooking fill your feed from day one.
                </p>
                <div className="-mx-5">
                  <SuggestedPeople
                    bare
                    people={people}
                    userId={user?.id ?? null}
                    loading={peopleLoading && people.length === 0}
                  />
                </div>
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => advance()}
                  className="mt-10 self-start inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-full font-semibold text-sm shadow-lg shadow-primary/25"
                >
                  Continue
                  <ChevronRight size={16} />
                </motion.button>
              </>
            )}

            {/* ═══════════ First ratings ═══════════ */}
            {step === RATE_STEP && (
              <>
                <h2 className="text-4xl font-serif font-bold mb-3 leading-tight">Rate places you've been</h2>
                <p className="text-sm text-on-surface/50 mb-6 leading-relaxed max-w-[310px]">
                  A few real ratings teach the app your taste better than any quiz — and start your ranked list.
                </p>
                <div className="relative mb-4">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
                  <input
                    type="text"
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                    placeholder="Search a restaurant you know…"
                    className="w-full bg-white/70 backdrop-blur-sm border border-black/5 rounded-2xl pl-11 pr-4 py-3.5 text-[15px] font-medium placeholder:text-on-surface/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="flex-1 min-h-0">
                  {placeSearching && placeResults.length === 0 ? (
                    <div className="space-y-2.5 pt-1">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-[62px] rounded-2xl bg-on-surface/[0.05] animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {placeResults.map((place) => {
                        const rated = ratedIds.has(place.id);
                        const priceStr = priceLevelToString(place.priceLevel);
                        const sub = [cuisineLabel(place), priceStr, extractCityState(place.fullAddress, place.address)]
                          .filter(Boolean).join(' · ');
                        return (
                          <li key={place.id}>
                            <button
                              type="button"
                              // The REAL rating flow — H2H comparisons, the
                              // settle, community publish — not a parallel
                              // quick-rate that would pollute the ladder.
                              onClick={() => openAddRestaurantModal({
                                id: place.id,
                                name: place.name,
                                image: '',
                                cuisine: cuisineLabel(place),
                                price: priceStr,
                                address: place.fullAddress || place.address,
                              })}
                              className="w-full flex items-center gap-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-black/5 px-4 py-3 text-left active:bg-white transition-colors"
                            >
                              <span className="flex-1 min-w-0">
                                <span className="block truncate font-serif font-bold text-[15px] text-on-surface leading-tight">{place.name}</span>
                                <span className="block truncate text-[12px] text-on-surface/45 mt-0.5">{sub}</span>
                              </span>
                              {rated ? (
                                <span className="flex-none inline-flex items-center gap-1 text-[12px] font-bold text-primary">
                                  <Check size={13} strokeWidth={2.6} /> Rated
                                </span>
                              ) : (
                                <span className="flex-none inline-flex items-center gap-1 px-3.5 h-8 rounded-full bg-primary text-white text-[12px] font-bold">
                                  <Star size={12} strokeWidth={2.6} /> Rate
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                      {placeQuery.trim().length >= 2 && !placeSearching && placeResults.length === 0 && (
                        <p className="text-center pt-6 text-sm text-on-surface/35">Nothing found — try the restaurant's full name.</p>
                      )}
                    </ul>
                  )}
                </div>
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate('/')}
                  className={cn(
                    'mt-6 self-start inline-flex items-center gap-2 px-8 py-3 rounded-full font-semibold text-sm transition-colors',
                    ratedHere > 0
                      ? 'bg-primary text-white shadow-lg shadow-primary/25'
                      : 'bg-on-surface/[0.06] text-on-surface/60',
                  )}
                >
                  {ratedHere > 0 ? `Finish — ${ratedHere} rated` : 'Skip for now'}
                  <ChevronRight size={16} />
                </motion.button>
              </>
            )}
          </motion.div>
      </main>

      <footer className="mt-10 flex justify-center">
        <p className="text-xs text-on-surface/40 font-medium italic">
          Your selections help us curate a taste profile that's uniquely yours.
        </p>
      </footer>
    </div>
  );
};
