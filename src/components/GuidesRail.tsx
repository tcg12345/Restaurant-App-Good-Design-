import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Guide } from '../lib/supabase-guides';
import type { UserProfile } from '../lib/supabase-community';

/**
 * "Guides for you" — the horizontal guides rail that slides INTO the feed
 * (via SocialFeed's `inlineSlot`) instead of stacking above it.
 *
 * The card used to be a bordered surface with the photograph on top and the
 * title, the author and the stats stacked underneath in three separate
 * rows — a small page, four elements tall, for what is one thing. It is one
 * thing now: the photograph *is* the card, and the title and byline sit
 * inside it over a gradient, with the count as a chip in the corner.
 */

interface GuidesRailProps {
  guides: Guide[];
  authors: Record<string, UserProfile>;
  onBrowseAll: () => void;
  onCreate: () => void;
}

/** The dashed tile that starts a guide of your own. */
const BuildYourOwn: React.FC<{ onCreate: () => void; wide?: boolean }> = ({ onCreate, wide }) => (
  <button
    type="button"
    onClick={onCreate}
    className={cn(
      'flex-none h-[116px] rounded-[22px] border border-dashed border-on-surface/25 flex flex-col items-start justify-end gap-2 p-3.5 text-left active:bg-on-surface/[0.05] transition-colors',
      wide ? 'w-[172px]' : 'w-[150px]',
    )}
  >
    <span className="w-[30px] h-[30px] rounded-full bg-primary/10 text-primary flex items-center justify-center">
      <Plus size={15} strokeWidth={2.1} />
    </span>
    <span className="text-on-surface" style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.025em' }}>
      Build your own
    </span>
  </button>
);

export const GuidesRail: React.FC<GuidesRailProps> = ({ guides, authors, onBrowseAll, onCreate }) => (
  <section>
    <div className="px-5 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>
          Guides for you
        </h2>
        <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '12.5px', lineHeight: 1.35 }}>
          Short lists from people whose taste matches yours.
        </p>
      </div>
      <button
        type="button"
        onClick={onBrowseAll}
        className="flex-none inline-flex items-center gap-1 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2 active:opacity-70 transition-opacity"
        style={{ fontSize: '11.5px', fontWeight: 700 }}
      >
        All
        <ChevronRight size={12} />
      </button>
    </div>

    <div className="mt-4 flex gap-2.5 overflow-x-auto no-scrollbar snap-x scroll-px-5 px-5">
      {guides.length === 0 && <BuildYourOwn onCreate={onCreate} wide />}

      {guides.map((g) => {
        const author = authors[g.userId];
        const authorName = author?.display_name || author?.username || 'someone';
        const byline = [
          `by ${authorName}`,
          g.avgScore != null ? `avg ${g.avgScore.toFixed(1)}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <Link key={g.id} to={`/guides/${g.id}`} className="flex-none w-[172px] snap-start active:opacity-75 transition-opacity">
            <div className="relative h-[116px] rounded-[22px] overflow-hidden bg-on-surface/[0.06]">
              {g.coverPhoto ? (
                <img src={g.coverPhoto} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-on-surface/20">
                  <BookOpen size={30} strokeWidth={1.5} />
                </span>
              )}
              <span
                className="absolute inset-0"
                style={{ background: 'linear-gradient(to top, rgba(18,15,14,0.66), rgba(18,15,14,0.04))' }}
              />
              <span
                className="absolute top-2.5 left-2.5 rounded-full bg-black/50 backdrop-blur-md text-white px-[9px] py-1.5"
                style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                Guide · {g.entries.length} {g.type === 'recipes' ? 'recipes' : 'spots'}
              </span>
              <span className="absolute left-3.5 right-3.5 bottom-3">
                <span className="block line-clamp-2 text-white" style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.028em' }}>
                  {g.title}
                </span>
                <span className="mt-1.5 block truncate text-white/75" style={{ fontSize: '11.5px', lineHeight: 1 }}>
                  {byline}
                </span>
              </span>
            </div>
          </Link>
        );
      })}

      {guides.length > 0 && <BuildYourOwn onCreate={onCreate} />}
    </div>
  </section>
);
