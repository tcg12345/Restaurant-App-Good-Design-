import React from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, NotebookPen, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ScoreBadge } from '../ScoreBadge';
import type { CommunityRating, CommunityPhoto } from '../../lib/supabase-community';

interface Props {
  rating: CommunityRating;
  photos: CommunityPhoto[];
  expanded: boolean;
  onToggle: () => void;
}

export const ProfileRestaurantRow: React.FC<Props> = ({ rating, photos, expanded, onToggle }) => {
  const hasReview = !!(rating.notes && rating.notes.trim());
  const visit = rating.visit_date
    ? new Date(rating.visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const addressParts = (rating.address || '').split(',').map((s) => s.trim()).filter(Boolean);
  const neighborhood = addressParts.length >= 2 ? addressParts[addressParts.length - 2] : '';
  const city = addressParts.length >= 1 ? addressParts[addressParts.length - 1].replace(/\d{5}.*/, '').trim() : '';

  return (
    <li
      className={cn(
        'border-b border-[var(--color-line)] transition-colors',
        expanded ? 'bg-[rgba(31,26,23,0.025)]' : 'hover:bg-[rgba(31,26,23,0.018)]',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-[1fr_auto_auto] items-center gap-4 px-2 py-4 text-left"
      >
        <div className="min-w-0">
          <h3 className="font-serif text-[19px] font-semibold leading-tight text-on-surface tracking-[-0.01em] flex items-center gap-2 flex-wrap">
            <span className="truncate">{rating.restaurant_name}</span>
            {hasReview && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10.5px] font-bold tracking-[0.04em]">
                <NotebookPen size={11} />
                Review
              </span>
            )}
          </h3>
          <div className="mt-1 text-[13px] text-[var(--color-ink-3)] flex items-center flex-wrap gap-1.5">
            {rating.cuisine && <span className="text-[var(--color-ink-2)] font-medium">{rating.cuisine}</span>}
            {rating.cuisine && (neighborhood || city) && <Sep />}
            {neighborhood && city && <span>{neighborhood}, {city}</span>}
            {!neighborhood && city && <span>{city}</span>}
            {visit && (
              <>
                <Sep />
                <span>{visit}</span>
              </>
            )}
            {rating.price && (
              <>
                <Sep />
                <span>{rating.price}</span>
              </>
            )}
          </div>
        </div>

        <ScoreBadge rating={Number(rating.score)} size="lg" />

        <div className={cn(
          'w-8 h-8 rounded-full grid place-items-center text-[var(--color-ink-3)] transition-transform',
          expanded && 'rotate-180 text-on-surface bg-[rgba(31,26,23,0.06)]',
        )}>
          <ChevronDown size={16} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-2 md:pl-10 pr-2 pb-6">
              {rating.notes && (
                <p className="font-serif italic text-[16.5px] leading-relaxed text-on-surface pl-3.5 border-l-2 border-primary mb-5 max-w-3xl">
                  {rating.notes}
                </p>
              )}

              {photos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-1.5 mb-5">
                  {photos.slice(0, 7).map((p) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="aspect-square rounded-lg overflow-hidden bg-on-surface/[0.05] block hover:scale-[1.02] transition-transform"
                    >
                      <img src={p.url} alt={p.caption || ''} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {rating.tags && rating.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {rating.tags.map((t) => (
                    <span key={t} className="text-[11.5px] font-medium text-[var(--color-ink-2)] bg-on-surface/[0.05] px-2.5 py-1 rounded-full">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/restaurant/${rating.restaurant_id}`}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary bg-primary/10 px-3.5 py-1.5 rounded-full hover:bg-primary/15 transition-colors"
                >
                  View restaurant <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
};

const Sep: React.FC = () => (
  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-ink-4)]" />
);
