import React from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { SquarePen, ArrowRight, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CommunityRating, CommunityPhoto } from '../../lib/supabase-community';

interface Props {
  rating: CommunityRating;
  photos: CommunityPhoto[];
  expanded: boolean;
  onToggle: () => void;
  /** Owner's display name — used for the "{first name}'s note" eyebrow. */
  ownerName: string;
  /** Tighter sizing for the mobile profile (smaller name, score, padding). */
  compact?: boolean;
}

/** Score → semantic hex (emerald / amber / red), matching the design tokens. */
const scoreHex = (s: number): string => (s >= 8 ? '#10b981' : s >= 5 ? '#f59e0b' : '#ef4444');

/** Circular score badge with a soft tinted fill and an inset color ring. */
const RingScore: React.FC<{ score: number; size?: number }> = ({ score, size = 46 }) => {
  const c = scoreHex(score);
  return (
    <div
      className="grid place-items-center rounded-full font-serif font-bold tabular-nums flex-none"
      style={{
        width: size,
        height: size,
        background: `${c}14`,
        color: c,
        fontSize: Math.round(size * 0.34),
        boxShadow: `inset 0 0 0 1.5px ${c}40`,
      }}
      aria-label={`Score ${score.toFixed(1)}`}
    >
      {score.toFixed(1)}
    </div>
  );
};

/**
 * Minimal, editorial restaurant row — a clean divider-separated entry that
 * expands in place to reveal the full note, photos, tags and actions. Mirrors
 * the Gourmet Canvas reference: serif name, a one-line italic review snippet
 * when collapsed, and a soft reveal animation on expand. `compact` shrinks it
 * for the mobile profile.
 */
export const ProfileRestaurantRowMinimal: React.FC<Props> = ({
  rating, photos, expanded, onToggle, ownerName, compact = false,
}) => {
  const score = Number(rating.score);
  const hasReview = !!(rating.notes && rating.notes.trim());
  const firstName = (ownerName || '').trim().split(/\s+/)[0] || ownerName;

  const visit = rating.visit_date
    ? new Date(rating.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const parts = (rating.address || '').split(',').map((s) => s.trim()).filter(Boolean);
  const neighborhood = parts.length >= 2 ? parts[parts.length - 2] : '';
  const city = parts.length >= 1 ? parts[parts.length - 1].replace(/\d{5}.*/, '').trim() : '';
  const area = neighborhood && city ? `${neighborhood}, ${city}` : city;
  const meta = [rating.cuisine, area, visit, rating.price].filter(Boolean).join('  ·  ');

  const pad = compact ? '' : 'px-1';
  const hasExtras = hasReview || photos.length > 0 || !!(rating.tags && rating.tags.length > 0);

  return (
    <div className="border-b border-[var(--color-line)]">
      <button
        type="button"
        onClick={onToggle}
        className={cn('w-full flex items-center text-left group', pad, compact ? 'gap-3.5 py-[18px]' : 'gap-6 py-5')}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('font-serif font-bold leading-tight tracking-[-0.01em] text-on-surface truncate group-hover:text-primary transition-colors', compact ? 'text-[17px]' : 'text-[20px]')}>
              {rating.restaurant_name}
            </span>
            {hasReview && <SquarePen size={compact ? 13 : 14} strokeWidth={2.2} className="text-primary flex-none" />}
          </div>
          {meta && (
            <div className={cn('mt-1.5 font-medium text-[var(--color-ink-3)] truncate', compact ? 'text-[11.5px]' : 'text-[13px]')}>
              {meta}
            </div>
          )}
          {hasReview && !expanded && (
            <div className={cn('mt-2 font-serif italic leading-snug text-[var(--color-ink-2)] truncate', compact ? 'text-[13px]' : 'text-[14px]')}>
              &ldquo;{rating.notes}&rdquo;
            </div>
          )}
        </div>
        <RingScore score={score} size={compact ? 42 : 46} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className={cn(pad, compact ? 'pb-[18px]' : 'pb-7')}>
              {hasReview && (
                <>
                  <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-primary mb-2.5">
                    {firstName}&rsquo;s note
                  </div>
                  <p className={cn('font-sans font-normal leading-[1.6] tracking-[-0.005em] text-[var(--color-ink-2)] max-w-[580px]', compact ? 'text-[14px]' : 'text-[16px]')}>
                    {rating.notes}
                  </p>
                </>
              )}

              {photos.length > 0 && (
                <div className="grid grid-cols-4 md:grid-cols-6 gap-1.5 mt-5 max-w-[560px]">
                  {photos.slice(0, 6).map((p) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="aspect-square rounded-xl overflow-hidden bg-on-surface/[0.05] block hover:scale-[1.02] transition-transform"
                    >
                      <img src={p.url} alt={p.caption || ''} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {rating.tags && rating.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {rating.tags.map((t) => (
                    <span key={t} className="text-[11.5px] font-medium text-[var(--color-ink-2)] bg-on-surface/[0.05] px-2.5 py-1 rounded-full">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              <div className={cn(
                'flex items-center pt-4 border-t border-[var(--color-line)]',
                compact ? 'gap-5' : 'gap-7',
                hasExtras ? 'mt-5' : 'mt-1',
              )}>
                <Link
                  to={`/restaurant/${rating.restaurant_id}`}
                  className="inline-flex items-center gap-2 text-[13px] font-bold text-primary hover:gap-2.5 transition-all"
                >
                  View restaurant <ArrowRight size={14} strokeWidth={2.4} />
                </Link>
                <Link
                  to={`/restaurant/${rating.restaurant_id}`}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-ink-3)] hover:text-on-surface transition-colors"
                >
                  <Plus size={14} strokeWidth={2.2} /> Add to list
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
