import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Sliders, Swords, Sparkles, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  type H2HState,
  type Tier,
  type H2HCandidate,
  TIER_LABELS,
  TIER_BLURB,
  initH2H,
  pickComparison,
  applyChoice,
  applyTie,
  undoLastChoice,
  isComplete,
  computeFinalScore,
  totalEstimatedComparisons,
} from '../lib/headToHeadRating';


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

/* ── Inline H2H (lives inside the rating page, swaps with the slider) ─ */

export const MethodChooser: React.FC<{
  onPick: (m: 'slider' | 'h2h') => void;
}> = ({ onPick }) => (
  <motion.div
    key="method-chooser"
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -4 }}
    transition={{ duration: 0.18 }}
    className="pt-2 pb-1"
  >
    <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-4 text-center">
      How do you want to rate?
    </p>
    <div className="space-y-2.5 max-w-md mx-auto">
      <ChooserCard
        icon={<Sliders size={22} />}
        title="Slider"
        subtitle="Pick a score from 1–10 yourself"
        onClick={() => onPick('slider')}
      />
      <ChooserCard
        icon={<Swords size={22} />}
        title="Head-to-Head"
        subtitle="Compare to restaurants you've already rated"
        onClick={() => onPick('h2h')}
      />
    </div>
  </motion.div>
);

const ChooserCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}> = ({ icon, title, subtitle, onClick }) => (
  <motion.button
    type="button"
    onClick={onClick}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.98 }}
    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-on-surface/10 text-left shadow-sm hover:shadow-md hover:border-on-surface/25 transition-all"
  >
    <div className="w-12 h-12 rounded-xl bg-on-surface/[0.05] flex items-center justify-center flex-shrink-0 text-on-surface/75">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-serif font-bold text-[17px] mb-0.5">{title}</div>
      <div className="text-[12px] text-on-surface/55 leading-snug">{subtitle}</div>
    </div>
    <ChevronRight size={18} className="text-on-surface/25 flex-shrink-0" />
  </motion.button>
);

export const MethodToggle: React.FC<{
  method: 'slider' | 'h2h';
  onChange: (m: 'slider' | 'h2h') => void;
}> = ({ method, onChange }) => (
  <div className="flex bg-on-surface/[0.05] rounded-xl p-0.5 max-w-[320px] mx-auto">
    <button
      type="button"
      onClick={() => onChange('slider')}
      className={cn(
        "flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
        method === 'slider' ? "bg-white shadow-sm text-on-surface/85" : "text-on-surface/45 hover:text-on-surface/65",
      )}
    >
      <Sliders size={13} /> Slider
    </button>
    <button
      type="button"
      onClick={() => onChange('h2h')}
      className={cn(
        "flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
        method === 'h2h' ? "bg-white shadow-sm text-on-surface/85" : "text-on-surface/45 hover:text-on-surface/65",
      )}
    >
      <Swords size={13} /> Head-to-Head
    </button>
  </div>
);

export const InlineH2H: React.FC<{
  ratings: RestaurantRating[];
  excludeId: string;
  newRestaurant: { name: string; cuisine: string; price: string; address: string };
  state: H2HState | null;
  setState: (s: H2HState | null) => void;
  onComplete: (finalScore: number) => void;
}> = ({ ratings, excludeId, newRestaurant, state, setState, onComplete }) => {
  // Tier select
  if (!state) {
    return (
      <InlineTierSelect
        onPick={(tier) => {
          const fresh = initH2H(ratings as never, tier, excludeId);
          if (isComplete(fresh)) {
            onComplete(computeFinalScore(fresh));
            return;
          }
          setState(fresh);
        }}
      />
    );
  }

  // Result
  if (isComplete(state)) {
    return (
      <InlineResult
        state={state}
        onUse={() => onComplete(computeFinalScore(state))}
        onRedo={() => setState(null)}
      />
    );
  }

  // Compare
  const comparison = pickComparison(state);
  if (!comparison) {
    // Defensive: shouldn't happen, but bail out cleanly.
    setTimeout(() => onComplete(computeFinalScore(state)), 0);
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
        } else {
          setState(null);
        }
      }}
      onPick={(pickedNew) => {
        const next = applyChoice(state, pickedNew);
        setState(next);
      }}
      onTie={() => setState(applyTie(state))}
    />
  );
};

const TIER_ORDER: Tier[] = ['loved', 'fine', 'disliked'];

const TIER_DOT: Record<Tier, string> = {
  loved: 'bg-green-500',
  fine: 'bg-yellow-500',
  disliked: 'bg-red-500',
};

const InlineTierSelect: React.FC<{
  onPick: (tier: Tier) => void;
}> = ({ onPick }) => (
  <motion.div
    key="inline-tier"
    initial={{ opacity: 0, y: 4 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -4 }}
    transition={{ duration: 0.18 }}
    className="pt-1"
  >
    <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-3 text-center">
      How did you feel overall?
    </p>
    <div className="space-y-2 max-w-md mx-auto">
      {TIER_ORDER.map((tier, idx) => (
        <motion.button
          key={tier}
          type="button"
          onClick={() => onPick(tier)}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.04, type: 'spring', stiffness: 400, damping: 26 }}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-on-surface/10 text-left shadow-sm hover:shadow-md hover:border-on-surface/20 transition-all"
        >
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", TIER_DOT[tier])} />
          <div className="flex-1 min-w-0">
            <div className="font-serif font-bold text-[15px] leading-snug">{TIER_LABELS[tier]}</div>
            <div className="text-[11px] text-on-surface/50 leading-snug">{TIER_BLURB[tier]}</div>
          </div>
          <ChevronRight size={16} className="text-on-surface/25 flex-shrink-0" />
        </motion.button>
      ))}
    </div>
  </motion.div>
);

const InlineCompare: React.FC<{
  state: H2HState;
  comparison: H2HCandidate;
  newRestaurant: { name: string; cuisine: string; price: string; address: string };
  onBack: () => void;
  onPick: (pickedNew: boolean) => void;
  onTie: () => void;
}> = ({ state, comparison, newRestaurant, onBack, onPick, onTie }) => {
  const total = totalEstimatedComparisons(state);
  const done = state.history.length;
  const progress = total === 0 ? 1 : Math.min(1, done / total);
  return (
    <motion.div
      key="inline-compare"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className="pt-1"
    >
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
      <AnimatePresence mode="wait">
        <motion.div
          key={comparison.restaurantId + ':' + state.history.length}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ type: 'tween', duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          className="flex items-stretch gap-2"
        >
          <InlineCompareCard
            label="Rating now"
            labelTone="primary"
            name={newRestaurant.name}
            cuisine={newRestaurant.cuisine}
            price={newRestaurant.price}
            address={newRestaurant.address}
            onPick={() => onPick(true)}
          />
          <div className="flex flex-col items-center justify-center text-on-surface/25 font-serif font-bold text-[11px] tracking-widest">VS</div>
          <InlineCompareCard
            label="Already rated"
            labelTone="neutral"
            name={comparison.name}
            cuisine={comparison.cuisine}
            price={comparison.price}
            address={comparison.address}
            notes={comparison.notes}
            tags={comparison.tags}
            score={comparison.score}
            onPick={() => onPick(false)}
          />
        </motion.div>
      </AnimatePresence>
      <button
        type="button"
        onClick={onTie}
        className="mt-3 w-full py-2.5 rounded-xl bg-on-surface/[0.05] hover:bg-on-surface/[0.08] text-on-surface/70 hover:text-on-surface font-semibold text-[13px] transition-colors active:scale-[0.98]"
      >
        Too close to call
      </button>
    </motion.div>
  );
};

const InlineCompareCard: React.FC<{
  label: string;
  labelTone: 'primary' | 'neutral';
  name: string;
  cuisine: string;
  price: string;
  address: string;
  notes?: string;
  tags?: string[];
  score?: number;
  onPick: () => void;
}> = ({ label, labelTone, name, cuisine, price, address, notes, tags, score, onPick }) => {
  const meta = [cuisine, price].filter(Boolean).join(' · ');
  const trimmedNotes = (notes || '').trim();
  const topTags = (tags || []).slice(0, 2);
  return (
    <motion.button
      type="button"
      onClick={onPick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className="group relative flex-1 min-w-0 rounded-2xl bg-white border border-on-surface/10 shadow-sm hover:shadow-lg hover:border-on-surface/20 transition-all text-left p-3 flex flex-col"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={cn(
          "inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
          labelTone === 'primary' ? "bg-primary text-white" : "bg-on-surface/[0.06] text-on-surface/55"
        )}>
          {label}
        </span>
        {typeof score === 'number' && (
          <span className={cn(
            "inline-flex items-center justify-center min-w-[32px] h-6 px-1 rounded-md bg-on-surface/[0.04] text-[12px] font-serif font-bold tabular-nums leading-none",
            scoreColor(score)
          )}>
            {score.toFixed(1)}
          </span>
        )}
      </div>
      <h3 className="font-serif font-bold text-[14px] leading-snug line-clamp-3 mb-1">{name}</h3>
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
        <p className="mt-auto pt-1 text-[10px] italic text-on-surface/50 leading-snug line-clamp-3">
          “{trimmedNotes}”
        </p>
      )}
    </motion.button>
  );
};

const InlineResult: React.FC<{
  state: H2HState;
  onUse: () => void;
  onRedo: () => void;
}> = ({ state, onUse, onRedo }) => {
  const target = computeFinalScore(state);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
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
  }, [target]);

  const scoreClr = scoreColorLight(target);
  const scoreBg = scoreBgGradient(target);
  const scoreRing = scoreRingColor(target);

  return (
    <motion.div
      key="inline-result"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className="pt-1 flex flex-col items-center"
    >
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-2"
      >
        <Sparkles size={11} />
        We ranked it at
      </motion.div>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
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
      <p className="text-center text-[11.5px] text-on-surface/55 mt-3 max-w-[260px] leading-relaxed">
        {state.history.length === 0
          ? "No others to compare to — fine-tune the score below if needed."
          : `Based on ${state.history.length} comparison${state.history.length === 1 ? '' : 's'}.`}
      </p>
      <div className="mt-3 flex items-center gap-2 w-full max-w-xs">
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
          Use this score
        </button>
      </div>
    </motion.div>
  );
};
