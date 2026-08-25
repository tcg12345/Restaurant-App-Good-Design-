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

/** The dashed tile that starts a guide of your own — the trailing card in a
 *  populated rail. Centred, not bottom-aligned: the guide cards beside it
 *  push their text to the bottom because a photograph fills the space above
 *  it, and this one has no photograph, so the same alignment just read as a
 *  card whose image failed to load. */
const BuildYourOwn: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <button
    type="button"
    onClick={onCreate}
    className="flex-none w-[132px] h-[116px] rounded-[22px] border border-dashed border-on-surface/25 flex flex-col items-center justify-center gap-2 px-3 text-center active:bg-on-surface/[0.05] transition-colors"
  >
    <span className="w-[30px] h-[30px] rounded-full bg-primary/10 text-primary flex items-center justify-center">
      <Plus size={15} strokeWidth={2.1} />
    </span>
    <span className="text-on-surface" style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
      Build your own
    </span>
  </button>
);

/** No guides yet — a lone 172px dashed tile in a scroll rail reads as a
 *  card that failed to load, so the invitation takes the full column and
 *  says what a guide is instead. */
const GuidesEmpty: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <button
    type="button"
    onClick={onCreate}
    className="w-full flex items-center gap-3.5 rounded-[20px] border border-dashed border-on-surface/25 px-4 py-4 text-left active:bg-on-surface/[0.05] transition-colors"
  >
    <span className="flex-none w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
      <Plus size={19} strokeWidth={2.1} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-on-surface" style={{ fontSize: '14.5px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.022em' }}>
        Build your own
      </span>
      <span className="mt-1 block text-on-surface/45" style={{ fontSize: '12.5px', lineHeight: 1.35 }}>
        Collect a few favourites into a list worth sharing.
      </span>
    </span>
    <ChevronRight size={16} className="flex-none text-on-surface/30" />
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

    {guides.length === 0 ? (
      <div className="mt-4 px-5">
        <GuidesEmpty onCreate={onCreate} />
      </div>
    ) : (
    <div className="mt-4 flex gap-2.5 overflow-x-auto no-scrollbar snap-x scroll-px-5 px-5">
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

      <BuildYourOwn onCreate={onCreate} />
    </div>
    )}
  </section>
);
