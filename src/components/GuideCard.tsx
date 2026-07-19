/**
 * GuideCard — thumbnail card for a guide. Used on Discover, profile,
 * and inside the GuideCreator's review screen. Matches the editorial
 * mock: portrait photo with serif title overlay and a "Guide" pill.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChefHat } from 'lucide-react';
import { cn } from '../lib/utils';

export interface GuideCardData {
  id: string;
  title: string;
  authorName?: string;
  coverPhoto: string;
  entryCount: number;
  type: 'restaurants' | 'recipes';
  avgScore?: number | null;
  readMinutes?: number | null;
}

export const GuideCard: React.FC<{
  guide: GuideCardData;
  size?: 'sm' | 'md';
  className?: string;
  /** When true, render as a non-link button — caller wires up onClick. */
  asButton?: boolean;
  onClick?: () => void;
}> = ({ guide, size = 'sm', className, asButton, onClick }) => {
  const widthCls = size === 'md' ? 'w-[180px]' : 'w-[148px]';
  const inner = (
    <div className={cn(
      'relative aspect-[4/5] rounded-2xl overflow-hidden bg-on-surface/[0.05] border border-on-surface/[0.06] group-hover:shadow-[0_8px_24px_-10px_rgba(0,0,0,0.18)] transition-all',
      widthCls,
    )}>
      {guide.coverPhoto ? (
        <img
          src={guide.coverPhoto}
          alt={guide.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center">
          {guide.type === 'recipes' ? (
            <ChefHat size={28} className="text-white/40" />
          ) : (
            <BookOpen size={28} className="text-white/40" />
          )}
        </div>
      )}
      <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/45 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/45 to-transparent pointer-events-none" />
      <span className="absolute top-2 left-2 inline-flex items-center gap-0.5 rounded-full bg-white/90 backdrop-blur px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.14em] text-on-surface/70">
        {guide.type === 'recipes' ? <ChefHat size={8} /> : <BookOpen size={8} />}
        Guide
      </span>
      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <p className="text-white text-[11.5px] font-serif font-bold leading-tight drop-shadow-sm line-clamp-2">
          {guide.title}
        </p>
        <p className="text-white/75 text-[9.5px] font-medium mt-0.5 truncate">
          {guide.authorName ? `by ${guide.authorName} · ` : ''}{guide.entryCount} {guide.type === 'recipes' ? 'recipes' : 'spots'}
        </p>
        {(guide.readMinutes != null || guide.avgScore != null) && (
          <p className="text-white/60 text-[9.5px] font-medium mt-0.5 truncate tabular-nums">
            {[
              guide.readMinutes != null && guide.readMinutes > 0 ? `~${guide.readMinutes} min` : null,
              guide.avgScore != null ? `avg ${guide.avgScore.toFixed(1)}` : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );

  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={cn('flex-shrink-0 snap-start group text-left', className)}>
        {inner}
      </button>
    );
  }

  return (
    <Link to={`/guides/${guide.id}`} className={cn('flex-shrink-0 snap-start group text-left', className)}>
      {inner}
    </Link>
  );
};
