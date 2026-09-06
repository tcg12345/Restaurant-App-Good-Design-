import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { liftOverlayToTopLayer } from '../lib/useBottomSheet';

export interface CompletedRating { id: number; name: string; score: number; rank: number; showScore: boolean }

/** A non-blocking acknowledgement above the presenting page, not another step. */
export function RatingCompletion({ rating, onDismiss }: { rating: CompletedRating | null; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rating) return;
    liftOverlayToTopLayer(layer.current);
    const timer = setTimeout(onDismiss, 1900);
    return () => clearTimeout(timer);
  }, [rating, onDismiss]);
  return createPortal(<AnimatePresence>
    {rating && <motion.div key={rating.id} ref={layer} className="rf-completion-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? .1 : .28 }}>
      <motion.div className="rf-completion" initial={reduced ? false : { scale: .82, y: 16, filter: 'blur(6px)' }} animate={{ scale: 1, y: 0, filter: 'blur(0px)' }} exit={reduced ? {} : { scale: 1.04, y: -8, filter: 'blur(4px)' }} transition={{ type: 'spring', stiffness: 310, damping: 24 }}>
        <div className="rf-completion-orbit" aria-hidden="true">
          <svg viewBox="0 0 120 120"><circle className="rf-completion-track" cx="60" cy="60" r="54" /><motion.circle cx="60" cy="60" r="54" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: .65, ease: 'easeOut' }} /></svg>
          <span>{rating.showScore ? rating.score.toFixed(1) : `#${rating.rank}`}</span>
          <motion.i initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: reduced ? 0 : .38, type: 'spring', stiffness: 420, damping: 18 }}><svg viewBox="0 0 24 24"><motion.path d="m6 12 4 4 8-8" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ delay: reduced ? 0 : .48, duration: .25 }} /></svg></motion.i>
        </div>
        <strong>Rating saved</strong><p>{rating.name}</p>
        <span className="sr-only" role="status" aria-live="polite">Rating saved for {rating.name}. {rating.showScore ? `Your score is ${rating.score.toFixed(1)} out of 10.` : `Ranked number ${rating.rank}.`}</span>
      </motion.div>
    </motion.div>}
  </AnimatePresence>, document.body);
}
