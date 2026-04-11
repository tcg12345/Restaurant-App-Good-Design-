/**
 * Shared helpers + components for rendering the editorial home meal / recipe
 * detail layout. Used by both the Pantry (author's own recipes) and the new
 * MealRecipePage (friends' public recipes opened from the Explore feed).
 *
 * Kept display-only: no helper here writes back to storage or mutates a
 * HomeMeal. Servings scaling, checkbox state, and step timers are all local
 * UI concerns and do NOT change the user's saved data.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './utils';

/** Formats a minute total as a short "X hr Y min" string. */
export const formatDuration = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours} hr`;
  return `${hours} hr ${remMinutes} min`;
};

/** Compact duration for tight stat cells ("2h 45m" / "45m" / "1h"). */
export const formatDurationCompact = (minutes: number): string => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
};

/**
 * Canonical cover photo URL for a home meal. Always prefer the explicit
 * coverPhoto, fall back to the first uploaded photo, then empty string.
 * Used by every card / hero / page header so we don't accidentally show a
 * different image in different places for the same recipe.
 */
export const getMealCoverUrl = (
  meal: { coverPhoto?: string; photos?: { url: string }[] } | null | undefined,
): string => {
  if (!meal) return '';
  if (meal.coverPhoto) return meal.coverPhoto;
  return meal.photos?.[0]?.url || '';
};

/**
 * Parses an ingredient amount string ("2", "1/2", "1 1/2", "0.5") into a
 * number. Returns null when the string isn't a recognisable quantity (e.g.
 * "a pinch"); callers fall back to leaving the original string alone.
 */
export const parseQuantity = (str: string): number | null => {
  const trimmed = str.trim();
  if (!trimmed) return null;
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const d = parseInt(mixed[3], 10);
    return d ? parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d : null;
  }
  const frac = trimmed.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const d = parseInt(frac[2], 10);
    return d ? parseInt(frac[1], 10) / d : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  return null;
};

/** Converts a decimal back to a cooking-friendly fraction ("1/2", "1 1/2"). */
export const formatQuantity = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value === 0) return '0';
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.02) return String(whole);
  const candidates: [number, string][] = [
    [1 / 8, '1/8'], [1 / 6, '1/6'], [1 / 5, '1/5'], [1 / 4, '1/4'], [1 / 3, '1/3'],
    [3 / 8, '3/8'], [2 / 5, '2/5'], [1 / 2, '1/2'], [3 / 5, '3/5'], [5 / 8, '5/8'],
    [2 / 3, '2/3'], [3 / 4, '3/4'], [4 / 5, '4/5'], [5 / 6, '5/6'], [7 / 8, '7/8'],
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(frac - best[0]);
  for (const c of candidates) {
    const d = Math.abs(frac - c[0]);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  if (Math.abs(1 - frac) < bestDiff) return String(whole + 1);
  if (whole === 0) return best[1];
  return `${whole} ${best[1]}`;
};

/**
 * Scales an ingredient amount string by a ratio. Non-numeric amounts are
 * passed through unchanged so values like "pinch" survive.
 */
export const scaleQuantity = (raw: string, ratio: number): string => {
  const parsed = parseQuantity(raw);
  if (parsed === null) return raw;
  return formatQuantity(parsed * ratio);
};

/**
 * Finds the first time reference in a direction step and returns the total
 * minutes. Used for surfacing an inline timer button next to that step.
 */
export const extractStepMinutes = (text: string): number | null => {
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  const minMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  const secMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  let total = 0;
  let matched = false;
  if (hourMatch) { total += parseFloat(hourMatch[1]) * 60; matched = true; }
  if (minMatch) { total += parseFloat(minMatch[1]); matched = true; }
  if (secMatch) { total += parseFloat(secMatch[1]) / 60; matched = true; }
  if (!matched) return null;
  const minutes = Math.max(1, Math.round(total));
  return minutes > 0 ? minutes : null;
};

/**
 * Inline timer shown next to a direction step. Click to start → counts down
 * and flashes when it hits zero. Click again to reset.
 */
export const StepTimer: React.FC<{ minutes: number }> = ({ minutes }) => {
  const totalSeconds = minutes * 60;
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) return;
    if (remaining <= 0) {
      setRunning(false);
      setDone(true);
      return;
    }
    const id = window.setTimeout(() => setRemaining((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [running, remaining]);

  const mm = Math.floor(Math.max(0, remaining) / 60);
  const ss = Math.max(0, remaining) % 60;

  const onClick = () => {
    if (done) { setRemaining(totalSeconds); setDone(false); return; }
    if (running) { setRunning(false); return; }
    if (remaining <= 0) setRemaining(totalSeconds);
    setRunning(true);
  };

  const label = done
    ? 'Done!'
    : running || remaining !== totalSeconds
      ? `${mm}:${String(ss).padStart(2, '0')}`
      : formatDuration(minutes);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors flex-shrink-0",
        done
          ? "bg-amber-100 text-amber-700 animate-pulse"
          : running
            ? "bg-emerald-100 text-emerald-700"
            : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
      )}
      aria-label={running ? 'Pause timer' : done ? 'Reset timer' : 'Start timer'}
    >
      <Clock size={11} />
      {label}
    </button>
  );
};

/** Simple swipeable photo lightbox for home meal views. */
export const PhotoLightbox: React.FC<{
  photos: { url: string; caption: string }[];
  index: number | null;
  onClose: () => void;
  onChange: (idx: number | null) => void;
}> = ({ photos, index, onClose, onChange }) => {
  useEffect(() => {
    if (index === null) return;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < photos.length - 1) onChange(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onChange(index - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', handleKey); };
  }, [index, photos.length, onChange, onClose]);

  if (index === null || !photos[index]) return null;
  const photo = photos[index];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/95 flex flex-col"
        onClick={onClose}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
          <span className="text-sm text-white/60 font-medium tabular-nums">{index + 1} / {photos.length}</span>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-2 -mr-2 text-white/70 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Photo */}
        <div className="flex-1 flex items-center justify-center px-4 min-h-0" onClick={(e) => e.stopPropagation()}>
          <motion.img
            key={photo.url}
            src={photo.url}
            alt={photo.caption || `Photo ${index + 1}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        </div>

        {/* Caption + nav */}
        <div className="flex-shrink-0 px-5 py-4" onClick={(e) => e.stopPropagation()}>
          {photo.caption && (
            <p className="text-sm text-white/80 text-center mb-3 leading-relaxed">{photo.caption}</p>
          )}
          {photos.length > 1 && (
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => index > 0 && onChange(index - 1)} disabled={index === 0}
                className="p-2 rounded-full bg-white/10 text-white disabled:opacity-30 transition-opacity">
                <ChevronLeft size={20} />
              </button>
              <button onClick={() => index < photos.length - 1 && onChange(index + 1)} disabled={index === photos.length - 1}
                className="p-2 rounded-full bg-white/10 text-white disabled:opacity-30 transition-opacity">
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
