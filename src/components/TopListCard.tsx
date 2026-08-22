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
    <Link to={`/profile/top/${encodeURIComponent(list.key)}`} className="block active:opacity-75 transition-opacity">
      {/* The cover is the card. What used to hang below it inside the same
          tall 4:5 frame — the kind label, the title, the count and the
          leader — was four stacked lines of white type over a photograph,
          which made the photograph a texture rather than a picture. The
          title and count sit in the image; the leader steps outside it,
          where it reads as the row it is. */}
      <div className="relative h-[112px] rounded-[22px] overflow-hidden bg-on-surface/[0.06]">
        {cover ? (
          <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className={cn('absolute inset-0 bg-gradient-to-br', tintFor(list.key))} />
        )}
        <span
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(18,15,14,0.62), rgba(18,15,14,0.05))' }}
        />
        {scoresUnlocked && (
          <span
            className="absolute top-2.5 right-2.5 rounded-full bg-black/50 backdrop-blur-md text-white px-2.5 py-[7px] tabular-nums"
            style={{ fontSize: '12px', fontWeight: 700 }}
          >
            {list.avg.toFixed(1)}
          </span>
        )}
        <span className="absolute left-3.5 right-3.5 bottom-3">
          <span className="block line-clamp-2 text-white" style={{ fontSize: '17px', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
            {list.label}
          </span>
          <span className="mt-1.5 block text-white/75" style={{ fontSize: '11.5px', lineHeight: 1 }}>
            {list.total} place{list.total === 1 ? '' : 's'} · {topListKindLabel(list.config)}
          </span>
        </span>
      </div>
      {leader && (
        <span className="flex items-center gap-2 pt-[11px] px-0.5">
          <span className="flex-none text-primary" style={{ fontSize: '11px', fontWeight: 700 }}>1</span>
          <span className="flex-1 min-w-0 truncate text-on-surface/60" style={{ fontSize: '12.5px', fontWeight: 500, lineHeight: 1.2 }}>{leader.name}</span>
          <ChevronRight size={13} className="flex-none text-on-surface/30" />
        </span>
      )}
    </Link>
  );
};
