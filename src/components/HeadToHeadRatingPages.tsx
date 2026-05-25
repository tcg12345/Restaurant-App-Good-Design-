import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Sliders, Swords, Sparkles, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import type { RestaurantRating } from '../contexts/ListsContext';
import {
  type H2HState,
  type Tier,
  type H2HCandidate,
  TIER_LABELS,
  TIER_BLURB,
  computeFinalScore,
  totalEstimatedComparisons,
} from '../lib/headToHeadRating';

/* ── Mode select ──────────────────────────────────────────────────── */

export const ModeSelectPage: React.FC<{
  restaurantName: string;
  isEdit: boolean;
  onClose: () => void;
  onPickSlider: () => void;
  onPickH2H: () => void;
}> = ({ restaurantName, isEdit, onClose, onPickSlider, onPickH2H }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0, x: -30 }}
    transition={{ duration: 0.18 }}
    className="flex flex-col h-full"
  >
    <div className="px-5 pt-safe-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
      <div className="min-w-0">
        <h2 className="font-serif font-bold text-lg truncate">{isEdit ? 'Update Rating' : 'Rate Restaurant'}</h2>
        <p className="text-xs text-on-surface/40 truncate">{restaurantName}</p>
      </div>
      <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
    </div>
    <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-6">
      <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/35 mb-4 text-center">Choose a way to rate</p>
      <div className="space-y-3 max-w-md mx-auto">
        <ModeOption
          icon={<Sliders size={20} />}
          title="Quick rate"
          subtitle="Pick a score from 1–10 with the slider"
          onClick={onPickSlider}
        />
        <ModeOption
          icon={<Swords size={20} />}
          title="Head-to-head"
          subtitle="Compare to restaurants you've already rated"
          onClick={onPickH2H}
        />
      </div>
      <p className="text-[11px] text-on-surface/35 text-center mt-6 leading-relaxed max-w-[280px] mx-auto">
        Head-to-head asks a few quick A-vs-B questions, then places this restaurant in the right spot on your list.
      </p>
    </div>
  </motion.div>
);

const ModeOption: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}> = ({ icon, title, subtitle, onClick }) => (
  <motion.button
    onClick={onClick}
    whileHover={{ y: -1 }}
    whileTap={{ scale: 0.98 }}
    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-on-surface/10 text-left shadow-sm hover:shadow-md hover:border-on-surface/20 transition-all"
  >
    <div className="w-10 h-10 rounded-xl bg-on-surface/5 flex items-center justify-center flex-shrink-0 text-on-surface/70">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-serif font-bold text-[16px] mb-0.5">{title}</div>
      <div className="text-[12px] text-on-surface/55">{subtitle}</div>
    </div>
    <ChevronRight size={18} className="text-on-surface/25 flex-shrink-0" />
  </motion.button>
);

/* ── Tier select ──────────────────────────────────────────────────── */

const TIER_ORDER: Tier[] = ['loved', 'fine', 'disliked'];

const TIER_DOT: Record<Tier, string> = {
  loved: 'bg-green-500',
  fine: 'bg-yellow-500',
  disliked: 'bg-red-500',
};

export const TierSelectPage: React.FC<{
  onBack: () => void;
  onPick: (tier: Tier) => void;
}> = ({ onBack, onPick }) => (
  <motion.div
    initial={{ x: '100%', opacity: 0.5 }}
    animate={{ x: 0, opacity: 1 }}
    exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col h-full"
  >
    <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
      <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
        <ChevronLeft size={22} />
      </button>
      <h2 className="font-serif font-bold text-lg flex-1">Head-to-head</h2>
    </div>
    <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-6">
      <p className="text-center text-[13px] text-on-surface/55 mb-5 leading-relaxed max-w-[280px] mx-auto">
        First, how did you feel overall?
      </p>
      <div className="space-y-2.5 max-w-md mx-auto">
        {TIER_ORDER.map((tier, idx) => (
          <motion.button
            key={tier}
            onClick={() => onPick(tier)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05, type: 'spring', stiffness: 400, damping: 26 }}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center gap-3.5 p-4 rounded-2xl bg-white border border-on-surface/10 text-left shadow-sm hover:shadow-md hover:border-on-surface/20 transition-all"
          >
            <span className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", TIER_DOT[tier])} />
            <div className="flex-1 min-w-0">
              <div className="font-serif font-bold text-[16px] mb-0.5">{TIER_LABELS[tier]}</div>
              <div className="text-[12px] text-on-surface/50">{TIER_BLURB[tier]}</div>
            </div>
            <ChevronRight size={18} className="text-on-surface/25 flex-shrink-0" />
          </motion.button>
        ))}
      </div>
    </div>
  </motion.div>
);

/* ── Compare ──────────────────────────────────────────────────────── */

export const ComparePage: React.FC<{
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
      initial={{ x: '100%', opacity: 0.5 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.5 }}
      transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="flex flex-col h-full"
    >
      <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
          <ChevronLeft size={22} />
        </button>
        <h2 className="font-serif font-bold text-lg flex-1">Head-to-head</h2>
        <span className="text-[11px] font-semibold text-on-surface/40 tabular-nums">{done + 1} / {total || done + 1}</span>
      </div>
      <div className="px-5 pb-3 flex-shrink-0">
        <div className="h-1 bg-on-surface/8 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={false}
            animate={{ width: `${progress * 100}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 28 }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-3 flex flex-col">
        <p className="text-center text-[15px] font-semibold text-on-surface/85 mt-1 mb-1">Which did you enjoy more?</p>
        <p className="text-center text-[11px] text-on-surface/40 mb-4">Tap your pick</p>
        <AnimatePresence mode="wait">
          <motion.div
            key={comparison.restaurantId + ':' + state.history.length}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="flex items-stretch gap-2.5"
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
            <div className="flex flex-col items-center justify-center text-on-surface/25 font-serif font-bold text-xs tracking-widest">VS</div>
            <CompareCard
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
      </div>
      <div className="px-5 pt-3 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
        <button
          onClick={onTie}
          className="w-full py-3 rounded-2xl bg-on-surface/[0.05] hover:bg-on-surface/[0.08] text-on-surface/70 hover:text-on-surface font-semibold text-sm transition-colors active:scale-[0.98]"
        >
          Too close to call
        </button>
      </div>
    </motion.div>
  );
};

const CompareCard: React.FC<{
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
  const topTags = (tags || []).slice(0, 3);
  return (
    <motion.button
      onClick={onPick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className="group relative flex-1 min-w-0 rounded-2xl bg-white border border-on-surface/10 shadow-sm hover:shadow-lg hover:border-on-surface/20 transition-all text-left p-3.5 flex flex-col"
    >
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
          labelTone === 'primary' ? "bg-primary text-white" : "bg-on-surface/[0.06] text-on-surface/55"
        )}>
          {label}
        </span>
        {typeof score === 'number' && (
          <span className={cn(
            "inline-flex items-center justify-center min-w-[36px] h-7 px-1.5 rounded-lg bg-on-surface/[0.04] text-[14px] font-serif font-bold tabular-nums leading-none",
            scoreColor(score)
          )}>
            {score.toFixed(1)}
          </span>
        )}
      </div>
      <h3 className="font-serif font-bold text-[15px] sm:text-[16px] leading-snug line-clamp-3 mb-1.5">{name}</h3>
      {meta && <p className="text-[11px] font-medium text-on-surface/55 leading-snug mb-1">{meta}</p>}
      {address && (
        <p className="text-[10.5px] text-on-surface/40 leading-snug line-clamp-2 mb-2">{address}</p>
      )}
      {topTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-auto pt-1.5">
          {topTags.map((t) => (
            <span key={t} className="inline-block px-1.5 py-0.5 rounded-full bg-on-surface/[0.04] text-[9.5px] font-semibold text-on-surface/55 leading-none whitespace-nowrap">
              {t}
            </span>
          ))}
        </div>
      )}
      {trimmedNotes && topTags.length === 0 && (
        <p className="mt-auto pt-1.5 text-[10.5px] italic text-on-surface/50 leading-snug line-clamp-3">
          “{trimmedNotes}”
        </p>
      )}
    </motion.button>
  );
};

/* ── Result ───────────────────────────────────────────────────────── */

export const ResultPage: React.FC<{
  state: H2HState;
  onRedo: () => void;
  onContinue: () => void;
}> = ({ state, onRedo, onContinue }) => {
  const target = computeFinalScore(state);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 800;
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
      initial={{ x: '100%', opacity: 0.5 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.5 }}
      transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="flex flex-col h-full"
    >
      <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0">
        <h2 className="font-serif font-bold text-lg flex-1">Your placement</h2>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-4"
        >
          <Sparkles size={11} />
          We ranked it at
        </motion.div>
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className={cn(
            "relative w-40 h-40 sm:w-44 sm:h-44 rounded-full flex items-center justify-center bg-gradient-to-b ring-4",
            scoreBg, scoreRing
          )}
        >
          <div className="text-center">
            <div className={cn("text-[64px] sm:text-[72px] leading-none font-serif font-bold tabular-nums", scoreClr)}>
              {display.toFixed(1)}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mt-1.5">out of 10</div>
          </div>
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center text-[13px] text-on-surface/55 mt-5 max-w-[280px] leading-relaxed"
        >
          {state.history.length === 0
            ? "We didn't have other restaurants to compare to — you can tweak the score next."
            : `Based on ${state.history.length} comparison${state.history.length === 1 ? '' : 's'}. You can fine-tune the score next.`}
        </motion.p>
        <button
          onClick={onRedo}
          className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-on-surface/50 hover:text-on-surface/80 transition-colors py-2 px-3"
        >
          <RotateCcw size={13} />
          Redo
        </button>
      </div>
      <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
        <button onClick={onContinue} className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
          Continue
        </button>
      </div>
    </motion.div>
  );
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
