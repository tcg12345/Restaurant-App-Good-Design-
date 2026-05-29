import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChefHat, Star } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Guide } from '../../lib/supabase-guides';

export const ProfileGuideCard: React.FC<{ guide: Guide }> = ({ guide }) => {
  const navigate = useNavigate();
  const isRecipes = guide.type === 'recipes';
  const Icon = isRecipes ? ChefHat : BookOpen;
  const kindLabel = isRecipes ? 'RECIPES' : 'PLACES';
  const entryCount = guide.entries?.length ?? 0;

  return (
    <article
      onClick={() => navigate(`/guides/${guide.id}`)}
      className="group cursor-pointer rounded-2xl overflow-hidden hover:-translate-y-0.5 transition-transform"
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        {guide.coverPhoto ? (
          <img
            src={guide.coverPhoto}
            alt={guide.title}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className={cn(
            'absolute inset-0 grid place-items-center bg-gradient-to-br',
            isRecipes ? 'from-amber-700 to-stone-900' : 'from-stone-700 to-stone-900',
          )}>
            <Icon size={36} className="text-white/30" />
          </div>
        )}

        <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 h-[22px] rounded-md bg-black/45 backdrop-blur-md text-white text-[10px] font-bold tracking-[0.08em]">
          <Icon size={11} />
          GUIDE · {kindLabel}
        </span>

        <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 h-[22px] rounded-md bg-black/45 backdrop-blur-md text-white text-[11px] font-semibold tabular-nums">
          {entryCount} {isRecipes ? 'recipes' : 'spots'}
        </span>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 px-3.5 pb-3.5 pt-10">
          <h4 className="font-serif font-semibold text-white text-[16px] leading-tight line-clamp-2 mb-1 drop-shadow">
            {guide.title}
          </h4>
          {(guide.subtitle || guide.avgScore != null) && (
            <div className="flex items-center gap-2 text-[11px] font-semibold text-white/85">
              {guide.subtitle && <span className="truncate">{guide.subtitle}</span>}
              {guide.avgScore != null && (
                <span className="inline-flex items-center gap-1 ml-auto flex-shrink-0">
                  <Star size={11} className="fill-white" />
                  {guide.avgScore.toFixed(1)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
