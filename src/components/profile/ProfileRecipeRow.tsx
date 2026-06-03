import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { ScoreBadge } from '../ScoreBadge';
import { formatDuration } from '../../lib/recipe-display';
import type { HomeMeal } from '../../contexts/ListsContext';

interface Props {
  meal: HomeMeal;
  idx: number;
  userId: string;
}

export const ProfileRecipeRow: React.FC<Props> = ({ meal, idx, userId }) => {
  const totalTime = (meal.prepTime ?? 0) + (meal.cookTime ?? 0);
  const ingredientPreview = (meal.ingredients ?? []).slice(0, 6).map((i) => i.name).filter(Boolean).join(', ');
  const overflow = (meal.ingredients?.length ?? 0) > 6 ? '…' : '';
  const diffClass = meal.difficulty?.toLowerCase();

  return (
    <li className="border-b border-[var(--color-line)] first:border-t hover:bg-[rgba(31,26,23,0.018)] transition-colors">
      <Link
        to={`/recipe/${encodeURIComponent(userId)}/${encodeURIComponent(meal.id)}`}
        className="grid grid-cols-[36px_1fr_auto] items-center gap-5 px-2 py-4"
      >
        <div className="font-serif text-[14px] font-medium text-[var(--color-ink-4)] text-center">
          {String(idx + 1).padStart(2, '0')}
        </div>

        <div className="min-w-0">
          <h3 className="font-serif text-[18px] font-semibold leading-tight text-on-surface tracking-[-0.01em] mb-1">
            {meal.name}
          </h3>

          <div className="text-[12.5px] text-[var(--color-ink-3)] flex items-center flex-wrap gap-1.5 mb-1">
            {meal.cuisine && <span className="text-[var(--color-ink-2)] font-medium">{meal.cuisine}</span>}
            {meal.cuisine && totalTime > 0 && <Sep />}
            {totalTime > 0 && <span>{formatDuration(totalTime)}</span>}
            {meal.difficulty && (
              <span className={cn(
                'ml-1 text-[10.5px] font-bold tracking-[0.08em] uppercase px-1.5 py-0.5 rounded',
                diffClass === 'easy' && 'bg-[var(--color-olive)]/15 text-[var(--color-olive)]',
                diffClass === 'medium' && 'bg-amber-500/15 text-amber-600',
                diffClass === 'hard' && 'bg-primary/15 text-primary',
                !['easy', 'medium', 'hard'].includes(diffClass || '') && 'bg-on-surface/[0.05] text-[var(--color-ink-2)]',
              )}>
                {meal.difficulty}
              </span>
            )}
          </div>

          {ingredientPreview && (
            <p className="text-[13px] text-[var(--color-ink-2)] line-clamp-1">
              {ingredientPreview}{overflow}
            </p>
          )}

          {(meal.sourceAuthorUsername || meal.sourceAuthorName) && (
            <p className="text-[12px] italic text-[var(--color-ink-3)] mt-1">
              by {meal.sourceAuthorUsername ? `@${meal.sourceAuthorUsername}` : meal.sourceAuthorName}
            </p>
          )}

          {meal.description && (
            <p className="font-serif italic text-[13.5px] leading-snug text-[var(--color-ink-2)] mt-2 pl-3 border-l-2 border-primary/30 max-w-3xl">
              {meal.description}
            </p>
          )}
        </div>

        {meal.score > 0 ? (
          <ScoreBadge rating={meal.score} size="lg" />
        ) : (
          <span className="text-[var(--color-ink-4)] font-serif text-lg font-semibold w-12 text-center">—</span>
        )}
      </Link>
    </li>
  );
};

const Sep: React.FC = () => (
  <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-ink-4)]" />
);
