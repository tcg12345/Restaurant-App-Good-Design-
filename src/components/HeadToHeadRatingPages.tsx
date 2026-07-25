import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Sparkles, RotateCcw, SkipForward, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient, SCORE_TIER_HEX } from '../lib/score';
import { ratingsToUnlock, SCORE_UNLOCK_THRESHOLD } from '../lib/scoreUnlock';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  type H2HState,
  type Tier,
  type H2HCandidate,
  type CandidateMetaResolver,
  TIER_LABELS,
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
  placementOrder,
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

/** Rank of `score` among `ratings` (1 = best), excluding `excludeId`.
 *  Counts `>=` so an equal-scored incumbent ranks ABOVE the new arrival —
 *  the same rule the settle pass applies to a just-rated row without an
 *  explicit H2H order (slider saves), so the displayed rank matches what
 *  actually persists. */
export function rankAmong(ratings: RestaurantRating[], score: number, excludeId?: string): { rank: number; total: number } {
  const others = ratings.filter((r) => r.restaurantId !== excludeId);
  const rank = 1 + others.filter((r) => r.score >= score).length;
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
    // `>=`: an equal-scored incumbent sits ABOVE the new pick — the settle
    // pass places a just-rated row below its equal on slider saves, and the
    // preview must agree with what will persist.
    if (r.score >= score) {
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
  item: { name: string; cuisine?: string; score: number } | null;
  fallback: string;
  /** Hide the numeric score (locked mode — own scores aren't revealed yet). */
  hideScore?: boolean;
}> = ({ direction, item, fallback, hideScore }) => (
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
        {!hideScore && (
          <span className={cn("text-[12.5px] font-serif font-bold tabular-nums flex-shrink-0", scoreColor(item.score))}>
            {item.score.toFixed(1)}
          </span>
        )}
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
  /** Eyebrow + question rendered as the sentiment step's own headline, so
   *  the step reads as one composed cluster instead of a stranded title. */
  heading?: { eyebrow: string; title: string };
}> = ({ ratings, excludeId, newRestaurant, state, setState, onComplete, onCancelFromStart, skipTierSelect, skipResult, resolveMeta, settlePreview, onChooseOwnScore, scoresUnlocked = true, heading }) => {
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
        heading={heading}
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

/** Single restrained tier signal — a small colored dot from the shared
 *  score palette. No emoji, no tinted washes. */
const TIER_DOT_HEX: Record<Tier, string> = {
  loved: SCORE_TIER_HEX.high,
  fine: SCORE_TIER_HEX.mid,
  disliked: SCORE_TIER_HEX.low,
};

const SentimentSelect: React.FC<{
  onPick: (tier: Tier) => void;
  onChooseOwnScore?: () => void;
  heading?: { eyebrow: string; title: string };
}> = ({ onPick, onChooseOwnScore, heading }) => (
  <motion.div key="sentiment" {...stepMotion} className="flex-1 flex flex-col justify-center">
    {heading && (
      <div className="text-center mb-8 px-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary/70 mb-2.5">{heading.eyebrow}</p>
        <h2 className="font-serif font-bold text-[28px] leading-[1.12] tracking-[-0.015em] text-on-surface">
          {heading.title}
        </h2>
      </div>
    )}
    <div className="space-y-3.5 w-full max-w-md mx-auto">
      {TIER_ORDER.map((tier, idx) => (
        <motion.button
          key={tier}
          type="button"
          onClick={() => onPick(tier)}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 + idx * 0.05, type: 'spring', stiffness: 400, damping: 30 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-between gap-4 px-6 py-5 rounded-[20px] bg-surface border border-on-surface/[0.05] text-left shadow-[0_10px_28px_-14px_rgba(28,24,22,0.18),0_2px_6px_-2px_rgba(28,24,22,0.06)] hover:shadow-[0_16px_38px_-16px_rgba(28,24,22,0.24),0_2px_6px_-2px_rgba(28,24,22,0.06)] transition-shadow"
        >
          <span className="font-serif font-bold text-[19px] tracking-[-0.01em] text-on-surface">
            {TIER_LABELS[tier]}
          </span>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TIER_DOT_HEX[tier] }} />
        </motion.button>
      ))}
    </div>
    {onChooseOwnScore && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mt-8 text-center"
      >
        <button
          type="button"
          onClick={onChooseOwnScore}
          className="text-[12px] font-semibold text-on-surface/40 hover:text-on-surface/65 underline underline-offset-4 decoration-on-surface/20 transition-colors"
        >
          Choose my own score instead
        </button>
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
    <motion.div key="inline-compare" {...stepMotion} className="flex-1 flex flex-col justify-center">
      <div className="relative w-full max-w-md mx-auto">
        <button
          type="button"
          onClick={onBack}
          className="absolute -top-1.5 left-0 w-9 h-9 -ml-2 rounded-full grid place-items-center text-on-surface/40 hover:text-on-surface hover:bg-on-surface/5 transition-colors"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="text-center mb-6 px-10">
          <h2 className="font-serif font-bold text-[24px] leading-[1.15] tracking-[-0.015em] text-on-surface">
            Which did you enjoy more?
          </h2>
          <div className="mt-3 flex items-center justify-center gap-2.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-on-surface/35 tabular-nums">
              {done + 1} of {total || done + 1}
            </span>
            <span className="relative w-16 h-[3px] rounded-full bg-on-surface/[0.08] overflow-hidden">
              <motion.span
                className="absolute inset-y-0 left-0 bg-primary/70 rounded-full"
                initial={false}
                animate={{ width: `${progress * 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 28 }}
              />
            </span>
          </div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={comparison.restaurantId + ':' + state.history.length}
            initial={{ opacity: 0, x: 26 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -26 }}
            transition={{ type: 'tween', duration: 0.24, ease: EASE }}
          >
            <CompareCard
              label="Rating now"
              labelTone="primary"
              name={newRestaurant.name}
              cuisine={newRestaurant.cuisine}
              price={newRestaurant.price}
              address={newRestaurant.address}
              onPick={() => onPick(true)}
            />
            <div className="flex items-center justify-center my-2.5">
              <span className="w-8 h-8 rounded-full bg-surface shadow-[0_4px_12px_-4px_rgba(28,24,22,0.18)] ring-1 ring-on-surface/[0.06] grid place-items-center text-[9.5px] font-bold uppercase tracking-[0.14em] text-on-surface/45">
                or
              </span>
            </div>
            <CompareCard
              label="Already rated"
              labelTone="neutral"
              name={comparison.name}
              cuisine={comparison.cuisine}
              price={comparison.price}
              address={comparison.address}
              notes={comparison.notes}
              onPick={() => onPick(false)}
            />
            {hint && (
              <p className="mt-3.5 text-center text-[11px] font-medium text-on-surface/35">{hint}</p>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            onClick={onTie}
            className="flex-1 py-3 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.08] text-on-surface/70 hover:text-on-surface font-semibold text-[13px] transition-colors active:scale-[0.98]"
          >
            Too close to call
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-full text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/[0.05] font-semibold text-[13px] transition-colors active:scale-[0.98]"
            aria-label="Skip this comparison"
          >
            <SkipForward size={14} />
            Skip
          </button>
        </div>
      </div>
    </motion.div>
  );
};

/** Trim a full street address down to its city part ("Wildersgade 10B,
 *  1408 København, Denmark" → "København, Denmark"). The street line is
 *  noise in a which-was-better question. */
function cityLine(address: string): string {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return address;
  const rest = parts.slice(1).map((p) => p.replace(/^\d{3,}\s+/, ''));
  return rest.slice(0, 2).join(', ');
}

/* Comparison card — no photos, no scores. A clean editorial block: the
   name carries the card; a visible number would bias the pick (and leak
   digits to locked users). */
const CompareCard: React.FC<{
  label: string;
  labelTone: 'primary' | 'neutral';
  name: string;
  cuisine: string;
  price: string;
  address: string;
  notes?: string;
  onPick: () => void;
}> = ({ label, labelTone, name, cuisine, price, address, notes, onPick }) => {
  const meta = [cuisine, price, address ? cityLine(address) : ''].filter(Boolean).join('  ·  ');
  const trimmedNotes = (notes || '').trim();
  return (
    <motion.button
      type="button"
      onClick={onPick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
      className="group w-full rounded-[20px] bg-surface border border-on-surface/[0.05] shadow-[0_10px_28px_-14px_rgba(28,24,22,0.18),0_2px_6px_-2px_rgba(28,24,22,0.06)] hover:shadow-[0_16px_38px_-16px_rgba(28,24,22,0.24),0_2px_6px_-2px_rgba(28,24,22,0.06)] transition-shadow text-left px-6 py-5"
    >
      <p className={cn(
        'text-[10px] font-bold uppercase tracking-[0.16em] mb-1.5',
        labelTone === 'primary' ? 'text-primary/80' : 'text-on-surface/35',
      )}>
        {label}
      </p>
      <h3 className="font-serif font-bold text-[21px] leading-[1.15] tracking-[-0.01em] text-on-surface">
        {name}
      </h3>
      {meta && <p className="text-[12.5px] font-medium text-on-surface/50 mt-1.5 truncate">{meta}</p>}
      {trimmedNotes && (
        <p className="text-[12px] italic text-on-surface/40 mt-1.5 line-clamp-1">“{trimmedNotes}”</p>
      )}
    </motion.button>
  );
};

const InlineResult: React.FC<{
  state: H2HState;
  ratings: RestaurantRating[];
  excludeId: string;
  scoresUnlocked: boolean;
  /** What the score becomes after the tier settles (may differ from the raw
   *  H2H midpoint — e.g. a score that collides with a neighbor settles one
   *  display step away). When provided, the dial shows this saved-to-list
   *  value. */
  settledScore?: number;
  onUse: () => void;
  onRedo: () => void;
}> = ({ state, ratings, excludeId, scoresUnlocked, settledScore, onUse, onRedo }) => {
  const raw = computeFinalScore(state);
  const target = settledScore ?? raw;
  const rebalanced = settledScore !== undefined && settledScore !== raw;
  // Rank + bracketing neighbors from a comparator that mirrors the settle
  // pass EXACTLY (score desc → the search's explicit placement order for a
  // score collision → the just-rated row yields below an equal it wasn't
  // explicitly ordered against → id). rankAmong can't do this: a search that
  // BEAT into a collision ranks the new item ABOVE its equal, which only the
  // placement order knows. Sorted with the RAW score — the same value the
  // save-time settle sorts with.
  const { rank, total, above, below } = useMemo(() => {
    const order = placementOrder(state, excludeId, raw);
    const orderIndex = new Map(order.map((id, i) => [id, i]));
    const rows = [
      { id: excludeId, name: '', cuisine: '', score: raw },
      ...ratings
        .filter((r) => r.restaurantId !== excludeId)
        .map((r) => ({ id: r.restaurantId, name: r.name, cuisine: r.cuisine, score: r.score })),
    ];
    rows.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const ai = orderIndex.get(a.id);
      const bi = orderIndex.get(b.id);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (a.id === excludeId) return 1;
      if (b.id === excludeId) return -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const selfAt = rows.findIndex((r) => r.id === excludeId);
    return {
      rank: selfAt + 1,
      total: rows.length,
      above: selfAt > 0 ? rows[selfAt - 1] : null,
      below: selfAt >= 0 && selfAt < rows.length - 1 ? rows[selfAt + 1] : null,
    };
  }, [state, ratings, excludeId, raw]);
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
    <motion.div key="inline-result" {...stepMotion} className="flex-1 flex flex-col items-center justify-center">
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
          <div className="font-serif font-bold text-[26px] leading-tight">
            #{rank} <span className="text-on-surface/40 text-[18px] font-semibold">of {total}</span>
          </div>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIER_DOT_HEX[state.tier] }} />
            <span className="text-[11.5px] font-semibold text-on-surface/50">{TIER_LABELS[state.tier]}</span>
          </div>
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

      {/* Bracketing neighbors — the placement's direct context, so the user
          can verify it before saving (and hit Redo if it looks wrong). */}
      {!firstEver && (above || below) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.35, ease: EASE }}
          className="w-full max-w-[300px] rounded-2xl bg-white border border-on-surface/[0.08] divide-y divide-on-surface/[0.06] overflow-hidden mt-4"
        >
          {/* Neighbor scores are the CURRENT values — when the save is about
              to rebalance the tier they'd disagree with the settled dial, so
              show names-only in that case (and in locked mode). */}
          <NeighborRow direction="up" item={above} fallback="Top of your list" hideScore={!scoresUnlocked || rebalanced} />
          <NeighborRow direction="down" item={below} fallback="Bottom of your list" hideScore={!scoresUnlocked || rebalanced} />
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
