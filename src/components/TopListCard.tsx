/**
 * Cover card for one top list.
 *
 * The profile used to render every list as its own titled, horizontally
 * scrolling rail — eleven headers, eleven strips, stacked down the page,
 * with a duplicate category rail beside them on desktop. Nothing was
 * scannable and nothing was a destination. Each list is now a single tile
 * that says what it is, how big it is, how good it is, and who's on top,
 * and opens the full ranking when you press it.
 *
 * Image-forward on purpose: the #1 place's photo is the cover, so a wall of
 * lists reads as a shelf of covers rather than a wall of text. Lists whose
 * leader has no photo fall back to a tint keyed off the list name, so the
 * grid still looks deliberate instead of half-empty.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreBadgeBg } from '../lib/score';
import { topListKindLabel, type TopList } from '../lib/topLists';

/** Deterministic tint for a coverless list — same list, same colour, every
 *  render, so the grid doesn't reshuffle its own palette on each visit. */
const TINTS = [
  'from-amber-100 via-orange-50 to-rose-50',
  'from-emerald-100 via-teal-50 to-sky-50',
  'from-violet-100 via-purple-50 to-fuchsia-50',
  'from-sky-100 via-blue-50 to-indigo-50',
  'from-rose-100 via-pink-50 to-orange-50',
  'from-lime-100 via-green-50 to-emerald-50',
];
function tintFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export const TopListCard: React.FC<{
  list: TopList;
  /** Hide the numbers when the user hasn't unlocked their own scores. */
  scoresUnlocked: boolean;
}> = ({ list, scoresUnlocked }) => {
  const leader = list.all[0];
  const cover = list.all.find((r) => r.image)?.image;
  return (
    <Link
      to={`/profile/top/${encodeURIComponent(list.key)}`}
      className="group relative flex aspect-[4/5] flex-col overflow-hidden rounded-3xl bg-on-surface/[0.04] ring-1 ring-on-surface/[0.06] transition-shadow hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.45)]"
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className={cn('absolute inset-0 bg-gradient-to-br', tintFor(list.key))} />
      )}
      {/* Scrim: heavy at the foot where the type sits, barely there up top
          so the photo still reads as a photo. */}
      <div className={cn(
        'absolute inset-0',
        cover
          ? 'bg-gradient-to-t from-black/85 via-black/45 to-black/10'
          : 'bg-gradient-to-t from-black/70 via-black/25 to-transparent',
      )} />

      {scoresUnlocked && (
        <span className={cn(
          'absolute right-3 top-3 z-10 rounded-full border px-2 py-1 text-[12px] font-bold tabular-nums shadow-sm',
          scoreBadgeBg(list.avg), scoreColor(list.avg),
        )}>
          {list.avg.toFixed(1)}
        </span>
      )}

      <div className="relative z-10 mt-auto p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
          {topListKindLabel(list.config)}
        </p>
        <h3 className="mt-1 font-serif text-[19px] font-bold leading-[1.15] text-white line-clamp-2">
          {list.label}
        </h3>
        <p className="mt-1 text-[12px] font-medium text-white/65 tabular-nums">
          {list.total} place{list.total === 1 ? '' : 's'}
        </p>
        {leader && (
          <p className="mt-2.5 flex items-center gap-1.5 border-t border-white/20 pt-2.5 text-[12.5px] text-white/85">
            <span className="font-bold text-white/50">1</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{leader.name}</span>
            <ChevronRight size={14} className="flex-shrink-0 text-white/50 transition-transform group-hover:translate-x-0.5" />
          </p>
        )}
      </div>
    </Link>
  );
};
