import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Sparkles, RotateCcw, SkipForward, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { ratingsToUnlock, SCORE_UNLOCK_THRESHOLD } from '../lib/scoreUnlock';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  type H2HState,
  type Tier,
  type H2HCandidate,
  type CandidateMetaResolver,
  TIER_LABELS,
  TIER_EMOJI,
  initH2H,
  pickComparison,
  applyChoice,
  applyTie,
  applySkip,
  undoLastChoice,
  isComplete,
  computeFinalScore,
  comparisonsMade,
  totalEstimatedComparisons,
} from '../lib/headToHeadRating';
import { relevanceHint, type SimilarityInput } from '../lib/restaurantSimilarity';

/** The new restaurant being placed. Carries optional geo/locality/tags so the
 *  head-to-head engine can score relevance; only name/cuisine/price/address are
 *  required for display. */
export interface H2HNewRestaurant {
  name: string;
  cuisine: string;
  price: string;
  address: string;
  image?: string;
  lat?: number;
  lng?: number;
  neighborhood?: string;
  tags?: string[];
}

/** Rank of `score` among `ratings` (1 = best), excluding `excludeId`. */
export function rankAmong(ratings: RestaurantRating[], score: number, excludeId?: string): { rank: number; total: number } {
  const others = ratings.filter((r) => r.restaurantId !== excludeId);
  const rank = 1 + others.filter((r) => r.score > score).length;
  return { rank, total: others.length + 1 };
}

/* ── Shared motion vocabulary — one easing so the flow feels like a single
   piece of hardware, not a stack of pages. ── */
const EASE = [0.32, 0.72, 0, 1] as const;
const STEP_TRANSITION = { duration: 0.3, ease: EASE };
const stepMotion = {
  initial: { opacity: 0, x: 36 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -28 },
  transition: STEP_TRANSITION,
};

/* ── Ranking context (lives under the slider) ─────────────────────── */

export const RankingContext: React.FC<{
  score: number;
  ratings: RestaurantRating[];
  excludeId?: string;
}> = ({ score, ratings, excludeId }) => {
  const sorted = useMemo(
    () =>
      ratings
        .filter((r) => r.restaurantId !== excludeId)
        .sort((a, b) => b.score - a.score),
    [ratings, excludeId],
  );

  if (sorted.length === 0) return null;

  let above: RestaurantRating | null = null;
  let below: RestaurantRating | null = null;
  let rank = 1;
  for (const r of sorted) {
    if (r.score > score) {
      above = r;
      rank += 1;
    } else {
      below = r;
      break;
    }
  }
  const total = sorted.length + 1;

  return (
    <div className="w-full max-w-[300px] rounded-2xl bg-white border border-on-surface/[0.08] overflow-hidden">
      <NeighborRow direction="up" item={above} fallback="Top of your list" />
      <div className="px-3.5 py-1.5 flex items-center justify-between border-y border-dashed border-on-surface/[0.12] bg-on-surface/[0.02]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/45">
          Your pick · #{rank} of {total}
        </span>
        <span className={cn("text-[13px] font-serif font-bold tabular-nums", scoreColor(score))}>
          {score.toFixed(1)}
        </span>
      </div>
      <NeighborRow direction="down" item={below} fallback="Bottom of your list" />
    </div>
  );
};

const NeighborRow: React.FC<{
  direction: 'up' | 'down';
  item: RestaurantRating | null;
  fallback: string;
}> = ({ direction, item, fallback }) => (
  <div className="px-3.5 py-2 flex items-center gap-2.5">
    {direction === 'up'
      ? <ArrowUp size={12} className="text-on-surface/35 flex-shrink-0" />
      : <ArrowDown size={12} className="text-on-surface/35 flex-shrink-0" />}
    {item ? (
      <>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-on-surface/85 truncate leading-snug">{item.name}</div>
          {item.cuisine && (
            <div className="text-[10px] text-on-surface/40 truncate leading-snug">{item.cuisine}</div>
          )}
        </div>
        <span className={cn("text-[12.5px] font-serif font-bold tabular-nums flex-shrink-0", scoreColor(item.score))}>
          {item.score.toFixed(1)}
        </span>
      </>
    ) : (
      <span className="text-[11.5px] italic text-on-surface/40">{fallback}</span>
    )}
  </div>
);

/* ── The head-to-head flow (sentiment → comparisons → reveal) ─────────
   The app's PRIMARY rating method. The slider exists only behind the
   quiet "Choose my own score" link on the sentiment step. */

export const InlineH2H: React.FC<{
  ratings: RestaurantRating[];
  excludeId: string;
  newRestaurant: H2HNewRestaurant;
  state: H2HState | null;
  setState: (s: H2HState | null) => void;
  onComplete: (finalScore: number) => void;
  /** Called when the user taps back at the first comparison (no history).
   *  When provided, used instead of resetting to tier-select — lets the
   *  parent abort a tie-break or other externally-initiated H2H. */
  onCancelFromStart?: () => void;
  /** When true, the tier-select step is hidden (state must be supplied
   *  externally). Used by the slider tie-break flow. */
  skipTierSelect?: boolean;
  /** When true, the result step is bypassed and onComplete fires
   *  immediately after the last comparison resolves. Used by the tie-break
   *  flow so the modal saves straight after the search. */
  skipResult?: boolean;
  /** Resolves a rated restaurant's geo/locality meta so comparisons can be
   *  picked by relevance. Optional — without it, location simply degrades. */
  resolveMeta?: CandidateMetaResolver;
  /** Maps the raw H2H score to what will actually be saved once the tier
   *  settles around it (Beli-style rebalance). Shown on the result step so
   *  the dial matches the score that lands in the list. */
  settlePreview?: (rawScore: number) => number;
  /** Renders the quiet "Choose my own score" link on the sentiment step. */
  onChooseOwnScore?: () => void;
  /** Beli-style score lock: below the unlock threshold the reveal shows
   *  rank + sentiment instead of a number. */
  scoresUnlocked?: boolean;
}> = ({ ratings, excludeId, newRestaurant, state, setState, onComplete, onCancelFromStart, skipTierSelect, skipResult, resolveMeta, settlePreview, onChooseOwnScore, scoresUnlocked = true }) => {
  const complete = state !== null && state !== undefined && isComplete(state);
  // Comparison for the compare step (computed once per render — also feeds
  // the auto-complete check below).
  const comparison = state && !complete ? pickComparison(state) : null;
  // Auto-completion: skipResult bypasses the result step; a missing
  // comparison mid-search is the defensive bail-out.
  const shouldAutoComplete = !!state && (complete ? !!skipResult : !comparison);
  // Fire the parent's onComplete exactly ONCE per completed search, from an
  // effect. The old version scheduled setTimeout(onComplete) DURING RENDER:
  // once per render while complete — twice under StrictMode — so a parent
  // that re-rendered this component before unmounting saved/settled the
  // rating multiple times. The ref re-arms when a new search starts.
  const completionFiredRef = useRef(false);
  useEffect(() => {
    if (!shouldAutoComplete) { completionFiredRef.current = false; return; }
    if (completionFiredRef.current) return;
    completionFiredRef.current = true;
    onComplete(computeFinalScore(state!));
  }, [shouldAutoComplete, state, onComplete]);

  // Tier select (skipped when the caller supplies state externally)
  if (!state) {
    if (skipTierSelect) return null;
    return (
      <SentimentSelect
        onChooseOwnScore={onChooseOwnScore}
        onPick={(tier) => {
          const target: SimilarityInput = {
            cuisine: newRestaurant.cuisine,
            price: newRestaurant.price,
            address: newRestaurant.address,
            neighborhood: newRestaurant.neighborhood,
            lat: newRestaurant.lat,
            lng: newRestaurant.lng,
            tags: newRestaurant.tags,
          };
          const fresh = initH2H(ratings, tier, excludeId, target, resolveMeta);
          // Empty pool for this sentiment (or a first-ever rating): the
          // engine completes instantly at the band midpoint — go straight
          // to the reveal instead of a zero-question comparison step.
          setState(fresh);
        }}
      />
    );
  }

  // Result (skipped when the caller wants immediate completion — the
  // completion effect above fires onComplete once, post-render)
  if (complete) {
    if (skipResult) return null;
    return (
      <InlineResult
        state={state}
        ratings={ratings}
        excludeId={excludeId}
        scoresUnlocked={scoresUnlocked}
        settledScore={settlePreview ? settlePreview(computeFinalScore(state)) : undefined}
        onUse={() => onComplete(computeFinalScore(state))}
        onRedo={() => setState(null)}
      />
    );
  }

  // Compare
  if (!comparison) {
    // Defensive: shouldn't happen — the completion effect bails out for us.
    return null;
  }
  return (
    <InlineCompare
      state={state}
      comparison={comparison}
      newRestaurant={newRestaurant}
      onBack={() => {
        if (state.history.length > 0) {
          setState(undoLastChoice(state));
        } else if (onCancelFromStart) {
          onCancelFromStart();
        } else {
          setState(null);
        }
      }}
      onPick={(pickedNew) => {
        const next = applyChoice(state, pickedNew);
        setState(next);
      }}
      onTie={() => setState(applyTie(state))}
      onSkip={() => setState(applySkip(state))}
    />
  );
};

const TIER_ORDER: Tier[] = ['loved', 'fine', 'disliked'];

/** Per-sentiment visual identity — tint, ring, and a one-line meaning so
 *  the choice reads instantly without explaining the score bands. */
const TIER_STYLE: Record<Tier, { tint: string; ring: string; sub: string }> = {
  loved: {
    tint: 'from-emerald-500/[0.10] to-emerald-500/[0.03]',
    ring: 'ring-emerald-600/15',
    sub: "I'd go back in a heartbeat",
  },
  fine: {
    tint: 'from-amber-500/[0.10] to-amber-500/[0.03]',
    ring: 'ring-amber-600/15',
    sub: 'Solid, but not memorable',
  },
  disliked: {
    tint: 'from-red-500/[0.09] to-red-500/[0.03]',
    ring: 'ring-red-600/15',
    sub: "I wouldn't return",
  },
};

const SentimentSelect: React.FC<{
  onPick: (tier: Tier) => void;
  onChooseOwnScore?: () => void;
}> = ({ onPick, onChooseOwnScore }) => (
  <motion.div key="sentiment" {...stepMotion} className="pt-1">
    <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-4 text-center">
      How did you feel overall?
    </p>
    <div className="space-y-3 max-w-md mx-auto">
      {TIER_ORDER.map((tier, idx) => (
        <motion.button
          key={tier}
          type="button"
          onClick={() => onPick(tier)}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 + idx * 0.06, type: 'spring', stiffness: 380, damping: 28 }}
          whileTap={{ scale: 0.97 }}
          className={cn(
            'w-full flex items-center gap-4 p-4.5 px-4 py-4 rounded-3xl bg-gradient-to-br border border-on-surface/[0.07] text-left shadow-sm hover:shadow-md ring-1 ring-inset transition-shadow',
            TIER_STYLE[tier].tint,
            TIER_STYLE[tier].ring,
          )}
        >
          <span className="w-12 h-12 rounded-2xl bg-white/70 shadow-sm ring-1 ring-black/[0.04] grid place-items-center text-[22px] flex-shrink-0">
            {TIER_EMOJI[tier]}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-serif font-bold text-[18px] leading-snug">{TIER_LABELS[tier]}</span>
            <span className="block text-[12px] text-on-surface/50 leading-snug mt-0.5">{TIER_STYLE[tier].sub}</span>
          </span>
          <ChevronRight size={17} className="text-on-surface/25 flex-shrink-0" />
        </motion.button>
      ))}
    </div>
    {onChooseOwnScore && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-5 text-center"
      >
        <button
          type="button"
          onClick={onChooseOwnScore}
          className="text-[12px] font-semibold text-on-surface/40 hover:text-on-surface/65 underline underline-offset-4 decoration-on-surface/20 transition-colors"
        >
          Choose my own score instead
        </button>
        <p className="mt-1.5 text-[10.5px] text-on-surface/30 max-w-[260px] mx-auto leading-snug">
          Hand-picked scores don't count toward community ratings.
        </p>
      </motion.div>
    )}
  </motion.div>
);

const InlineCompare: React.FC<{
  state: H2HState;
  comparison: H2HCandidate;
  newRestaurant: H2HNewRestaurant;
  onBack: () => void;
  onPick: (pickedNew: boolean) => void;
  onTie: () => void;
  onSkip: () => void;
}> = ({ state, comparison, newRestaurant, onBack, onPick, onTie, onSkip }) => {
  const total = totalEstimatedComparisons(state);
  const done = comparisonsMade(state);
  const progress = total === 0 ? 1 : Math.min(1, done / total);
  const hint = useMemo(
    () =>
      state.target
        ? relevanceHint(state.target, {
            cuisine: comparison.cuisine,
            price: comparison.price,
            address: comparison.address,
            neighborhood: comparison.neighborhood,
            lat: comparison.lat,
            lng: comparison.lng,
            tags: comparison.tags,
          })
        : '',
    [state.target, comparison],
  );
  return (
    <motion.div key="inline-compare" {...stepMotion} className="pt-1">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1 -ml-1 rounded-full hover:bg-on-surface/5 text-on-surface/45 hover:text-on-surface transition-colors"
          aria-label="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/45">
          Which did you enjoy more?
        </p>
        <span className="text-[10.5px] font-semibold text-on-surface/40 tabular-nums w-9 text-right">
          {done + 1} / {total || done + 1}
        </span>
      </div>
      <div className="h-1 bg-on-surface/8 rounded-full overflow-hidden mb-3">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        />
      </div>
      {hint && (
        <div className="flex justify-center mb-2.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/[0.07] text-primary/80 text-[10px] font-semibold">
            <Sparkles size={10} />
            {hint}
          </span>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={comparison.restaurantId + ':' + state.history.length}
          initial={{ opacity: 0, x: 28, scale: 0.985 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -28, scale: 0.985 }}
          transition={{ type: 'tween', duration: 0.24, ease: EASE }}
          className="relative flex items-stretch gap-2.5"
        >
          <CompareCard
            label="Rating now"
            labelTone="primary"
            name={newRestaurant.name}
            image={newRestaurant.image}
            cuisine={newRestaurant.cuisine}
            price={newRestaurant.price}
            address={newRestaurant.address}
            onPick={() => onPick(true)}
          />
          <CompareCard
            label="Already rated"
            labelTone="neutral"
            name={comparison.name}
            image={comparison.image}
            cuisine={comparison.cuisine}
            price={comparison.price}
            address={comparison.address}
            notes={comparison.notes}
            tags={comparison.tags}
            onPick={() => onPick(false)}
          />
          {/* Floating VS medallion — anchored between the cards. */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-surface shadow-md ring-1 ring-on-surface/10 font-serif font-bold text-[11px] tracking-widest text-on-surface/60">
              VS
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onTie}
          className="flex-1 py-2.5 rounded-xl bg-on-surface/[0.05] hover:bg-on-surface/[0.08] text-on-surface/70 hover:text-on-surface font-semibold text-[13px] transition-colors active:scale-[0.98]"
        >
          Too close to call
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-on-surface/55 hover:text-on-surface/80 hover:bg-on-surface/[0.05] font-semibold text-[13px] transition-colors active:scale-[0.98]"
          aria-label="Skip this comparison"
        >
          <SkipForward size={14} />
          Skip
        </button>
      </div>
    </motion.div>
  );
};

/* Comparison card — image-led, no score shown. A visible number would bias
   the pick (and leak digits to locked users); the point is remembering the
   MEAL, not the math. */
const CompareCard: React.FC<{
  label: string;
  labelTone: 'primary' | 'neutral';
  name: string;
  image?: string;
  cuisine: string;
  price: string;
  address: string;
  notes?: string;
  tags?: string[];
  onPick: () => void;
}> = ({ label, labelTone, name, image, cuisine, price, address, notes, tags, onPick }) => {
  const meta = [cuisine, price].filter(Boolean).join(' · ');
  const trimmedNotes = (notes || '').trim();
  const topTags = (tags || []).slice(0, 2);
  return (
    <motion.button
      type="button"
      onClick={onPick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.965 }}
      transition={{ type: 'spring', stiffness: 400, damping: 24 }}
      className="group relative flex-1 min-w-0 rounded-2xl bg-white border border-on-surface/10 shadow-sm hover:shadow-lg hover:border-on-surface/20 transition-all text-left overflow-hidden flex flex-col"
    >
      <div className="relative h-[86px] w-full bg-on-surface/[0.05] overflow-hidden">
        {image ? (
          <img src={image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <span className="font-serif font-bold text-[26px] text-on-surface/15">{name.charAt(0)}</span>
          </div>
        )}
        <span className={cn(
          "absolute top-2 left-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm",
          labelTone === 'primary' ? "bg-primary/90 text-white" : "bg-black/45 text-white/90"
        )}>
          {label}
        </span>
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-serif font-bold text-[14px] leading-snug line-clamp-2 mb-1">{name}</h3>
        {meta && <p className="text-[10.5px] font-medium text-on-surface/55 leading-snug mb-0.5">{meta}</p>}
        {address && <p className="text-[10px] text-on-surface/40 leading-snug line-clamp-2 mb-1">{address}</p>}
        {topTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-1">
            {topTags.map((t) => (
              <span key={t} className="inline-block px-1.5 py-0.5 rounded-full bg-on-surface/[0.04] text-[9px] font-semibold text-on-surface/55 leading-none whitespace-nowrap">
                {t}
              </span>
            ))}
          </div>
        )}
        {trimmedNotes && topTags.length === 0 && (
          <p className="mt-auto pt-1 text-[10px] italic text-on-surface/50 leading-snug line-clamp-2">
            “{trimmedNotes}”
          </p>
        )}
      </div>
    </motion.button>
  );
};

const InlineResult: React.FC<{
  state: H2HState;
  ratings: RestaurantRating[];
  excludeId: string;
  scoresUnlocked: boolean;
  /** What the score becomes after the tier settles (may differ from the raw
   *  H2H midpoint — e.g. a "too close to call" lands one display step below
   *  the pivot). When provided, the dial shows this saved-to-list value. */
  settledScore?: number;
  onUse: () => void;
  onRedo: () => void;
}> = ({ state, ratings, excludeId, scoresUnlocked, settledScore, onUse, onRedo }) => {
  const raw = computeFinalScore(state);
  const target = settledScore ?? raw;
  const rebalanced = settledScore !== undefined && settledScore !== raw;
  const { rank, total } = rankAmong(ratings, target, excludeId);
  const firstEver = total === 1;
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!scoresUnlocked) return;
    const duration = 700;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, scoresUnlocked]);

  const scoreClr = scoreColorLight(target);
  const scoreBg = scoreBgGradient(target);
  const scoreRing = scoreRingColor(target);
  const toGo = ratingsToUnlock(total);

  return (
    <motion.div key="inline-result" {...stepMotion} className="pt-1 flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-3"
      >
        <Sparkles size={11} />
        {firstEver ? 'Great start' : scoresUnlocked ? 'We ranked it at' : 'Placed in your list'}
      </motion.div>

      {scoresUnlocked ? (
        <>
          <motion.div
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className={cn(
              "relative w-28 h-28 rounded-full flex items-center justify-center bg-gradient-to-b ring-4",
              scoreBg, scoreRing,
            )}
          >
            <div className="text-center">
              <div className={cn("text-[44px] leading-none font-serif font-bold tabular-nums", scoreClr)}>
                {display.toFixed(1)}
              </div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-on-surface/30 mt-1">out of 10</div>
            </div>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="text-[12px] font-semibold text-on-surface/60 mt-3"
          >
            #{rank} of {total} on your list
          </motion.p>
        </>
      ) : (
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 24 }}
          className="w-full max-w-[300px] rounded-3xl bg-white border border-on-surface/[0.08] shadow-sm px-6 py-6 text-center"
        >
          <div className="text-[15px] mb-1">{TIER_EMOJI[state.tier]}</div>
          <div className="font-serif font-bold text-[24px] leading-tight">
            #{rank} <span className="text-on-surface/40 text-[17px] font-semibold">of {total}</span>
          </div>
          <div className="text-[11.5px] font-semibold text-on-surface/50 mt-0.5">{TIER_LABELS[state.tier]}</div>
          <div className="mt-4 pt-3.5 border-t border-on-surface/[0.07]">
            <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-bold uppercase tracking-widest text-on-surface/40">
              <Lock size={11} />
              Scores unlock at {SCORE_UNLOCK_THRESHOLD}
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-on-surface/[0.07] overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (total / SCORE_UNLOCK_THRESHOLD) * 100)}%` }}
                transition={{ delay: 0.3, duration: 0.5, ease: EASE }}
              />
            </div>
            <p className="text-[10.5px] text-on-surface/40 mt-1.5">
              {toGo === 0 ? 'Unlocking…' : `${toGo} more rating${toGo === 1 ? '' : 's'} to go`}
            </p>
          </div>
        </motion.div>
      )}

      <p className="text-center text-[11.5px] text-on-surface/55 mt-3 max-w-[260px] leading-relaxed">
        {comparisonsMade(state) === 0
          ? (firstEver
              ? 'Your first rating anchors the list — every comparison from here sharpens it.'
              : 'Nothing else in this range to compare against yet.')
          : `Based on ${comparisonsMade(state)} comparison${comparisonsMade(state) === 1 ? '' : 's'}.`}
      </p>
      {rebalanced && scoresUnlocked && (
        <p className="text-center text-[10.5px] font-medium text-primary/80 mt-1.5 max-w-[260px] leading-relaxed">
          Your rankings were rebalanced to make room.
        </p>
      )}
      <div className="mt-4 flex items-center gap-2 w-full max-w-xs">
        <button
          type="button"
          onClick={onRedo}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[12.5px] font-semibold text-on-surface/65 hover:text-on-surface bg-on-surface/[0.04] hover:bg-on-surface/[0.08] transition-colors"
        >
          <RotateCcw size={13} />
          Redo
        </button>
        <button
          type="button"
          onClick={onUse}
          className="flex-1 py-2.5 bg-primary text-white rounded-xl font-semibold text-[13px] active:scale-[0.98] transition-transform"
        >
          Continue
        </button>
      </div>
    </motion.div>
  );
};
