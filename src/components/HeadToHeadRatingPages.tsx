import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronLeft, ChevronRight, Image, Sliders, Swords, Sparkles, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import {
  type H2HState,
  type Tier,
  type H2HCandidate,
  TIER_LABELS,
  TIER_EMOJI,
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
        <motion.button
          onClick={onPickSlider}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-on-surface/8 text-left shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center flex-shrink-0 text-primary">
            <Sliders size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-serif font-bold text-[16px] mb-0.5">Quick rate</div>
            <div className="text-[12px] text-on-surface/55">Pick a score from 1–10 with the slider</div>
          </div>
          <ChevronRight size={18} className="text-on-surface/30 flex-shrink-0" />
        </motion.button>
        <motion.button
          onClick={onPickH2H}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-primary/8 to-primary/3 border border-primary/20 text-left shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center flex-shrink-0 text-white shadow-sm">
            <Swords size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-serif font-bold text-[16px]">Head-to-head</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary text-white">New</span>
            </div>
            <div className="text-[12px] text-on-surface/60">Compare to restaurants you've already rated</div>
          </div>
          <ChevronRight size={18} className="text-primary/50 flex-shrink-0" />
        </motion.button>
      </div>
      <p className="text-[11px] text-on-surface/35 text-center mt-6 leading-relaxed max-w-[280px] mx-auto">
        Head-to-head asks a few quick A-vs-B questions, then places this restaurant in the right spot on your list.
      </p>
    </div>
  </motion.div>
);

/* ── Tier select ──────────────────────────────────────────────────── */

const TIER_ORDER: Tier[] = ['loved', 'fine', 'disliked'];

const TIER_STYLES: Record<Tier, { gradient: string; ring: string; iconBg: string; text: string }> = {
  loved: {
    gradient: 'from-green-500/15 to-green-600/5',
    ring: 'ring-green-400/30',
    iconBg: 'bg-green-500/20',
    text: 'text-green-600',
  },
  fine: {
    gradient: 'from-yellow-500/15 to-yellow-600/5',
    ring: 'ring-yellow-400/30',
    iconBg: 'bg-yellow-500/20',
    text: 'text-yellow-600',
  },
  disliked: {
    gradient: 'from-red-500/15 to-red-600/5',
    ring: 'ring-red-400/30',
    iconBg: 'bg-red-500/20',
    text: 'text-red-500',
  },
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
        {TIER_ORDER.map((tier, idx) => {
          const s = TIER_STYLES[tier];
          return (
            <motion.button
              key={tier}
              onClick={() => onPick(tier)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, type: 'spring', stiffness: 400, damping: 26 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br border border-on-surface/8 ring-1 ring-inset text-left shadow-sm hover:shadow-md transition-shadow",
                s.gradient,
                s.ring,
              )}
            >
              <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0", s.iconBg)}>
                {TIER_EMOJI[tier]}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("font-serif font-bold text-[16px] mb-0.5", s.text)}>{TIER_LABELS[tier]}</div>
                <div className="text-[12px] text-on-surface/55">{TIER_BLURB[tier]}</div>
              </div>
              <ChevronRight size={18} className="text-on-surface/30 flex-shrink-0" />
            </motion.button>
          );
        })}
      </div>
    </div>
  </motion.div>
);

/* ── Compare ──────────────────────────────────────────────────────── */

export const ComparePage: React.FC<{
  state: H2HState;
  comparison: H2HCandidate;
  newRestaurant: { name: string; image: string; cuisine: string; price: string };
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
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-3 flex flex-col">
        <p className="text-center text-[15px] font-semibold text-on-surface/85 mt-2 mb-1">Which did you enjoy more?</p>
        <p className="text-center text-[11px] text-on-surface/40 mb-5">Tap your pick</p>
        <AnimatePresence mode="wait">
          <motion.div
            key={comparison.restaurantId + ':' + state.history.length}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 flex flex-col sm:flex-row items-stretch gap-3 sm:gap-4"
          >
            <CompareCard
              label="Rating now"
              labelTone="primary"
              name={newRestaurant.name}
              image={newRestaurant.image}
              cuisine={newRestaurant.cuisine}
              price={newRestaurant.price}
              onPick={() => onPick(true)}
            />
            <div className="hidden sm:flex flex-col items-center justify-center text-on-surface/30 font-serif font-bold text-sm tracking-widest">VS</div>
            <div className="sm:hidden flex items-center justify-center -my-1">
              <span className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-surface/35 bg-on-surface/5 rounded-full">VS</span>
            </div>
            <CompareCard
              label="Already rated"
              labelTone="neutral"
              name={comparison.name}
              image={comparison.image}
              cuisine={comparison.cuisine}
              price={comparison.price}
              score={comparison.score}
              onPick={() => onPick(false)}
            />
          </motion.div>
        </AnimatePresence>
        <button
          onClick={onTie}
          className="mt-4 self-center text-[12px] font-semibold text-on-surface/45 hover:text-on-surface/70 transition-colors py-2 px-4"
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
  image: string;
  cuisine: string;
  price: string;
  score?: number;
  onPick: () => void;
}> = ({ label, labelTone, name, image, cuisine, price, score, onPick }) => (
  <motion.button
    onClick={onPick}
    whileHover={{ y: -3 }}
    whileTap={{ scale: 0.97 }}
    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
    className="group relative flex-1 min-h-[140px] sm:min-h-0 rounded-2xl overflow-hidden bg-white border border-on-surface/8 shadow-sm hover:shadow-lg transition-shadow text-left"
  >
    <div className="relative h-32 sm:h-44 w-full bg-on-surface/5 overflow-hidden">
      {image ? (
        <img src={image} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-on-surface/20">
          <Image size={28} />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/0 to-black/0" />
      <div className="absolute top-2 left-2">
        <span className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm",
          labelTone === 'primary' ? "bg-primary text-white" : "bg-white/85 text-on-surface/75"
        )}>
          {label}
        </span>
      </div>
      {typeof score === 'number' && (
        <div className="absolute top-2 right-2">
          <span className={cn(
            "inline-flex items-center justify-center min-w-[34px] h-7 px-2 rounded-full bg-white shadow-sm text-[13px] font-serif font-bold tabular-nums",
            scoreColor(score)
          )}>
            {score.toFixed(1)}
          </span>
        </div>
      )}
    </div>
    <div className="px-3 py-2.5">
      <div className="font-serif font-bold text-[14px] leading-tight line-clamp-2">{name}</div>
      <div className="mt-1 text-[11px] text-on-surface/50 truncate">{cuisine}{price ? ` · ${price}` : ''}</div>
    </div>
  </motion.button>
);

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
