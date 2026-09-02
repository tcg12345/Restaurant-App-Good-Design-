import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, ChevronRight } from 'lucide-react';
import { CardMedia } from './cards/CardMedia';
import type { Guide } from '../lib/supabase-guides';
import type { UserProfile } from '../lib/supabase-community';

/**
 * "Guides for you" — the horizontal guides rail that slides INTO the feed
 * (via SocialFeed's `inlineSlot`) instead of stacking above it.
 *
 * The title lives back on the photo (on request — square cover, name over
 * the image), but not the way an earlier version of this card did it: that
 * one gave the overlay a FIXED height, and a title long enough to need its
 * full two lines had the second line's tail (ellipsis included) sliced off
 * by that box's own overflow clip, not just truncated. This overlay has no
 * height of its own — it grows upward from `bottom-0` to fit exactly
 * whatever `line-clamp-2` decides to keep, which on a 148px-tall square
 * image never comes close to the top edge, so there is nothing left for
 * CardMedia's rounded-corner clip to cut into.
 */

interface GuidesRailProps {
  guides: Guide[];
  authors: Record<string, UserProfile>;
  onBrowseAll: () => void;
  onCreate: () => void;
}

/** The dashed tile that starts a guide of your own — the trailing card in a
 *  populated rail. Fixed at 148px, the same square the guide cards beside
 *  it are, since the byline underneath them is its own row and isn't part
 *  of the height this tile needs to match. */
const BuildYourOwn: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <button
    type="button"
    onClick={onCreate}
    className="flex-none w-[112px] h-[148px] rounded-[20px] border border-dashed border-on-surface/25 flex flex-col items-center justify-center gap-2 px-3 text-center active:bg-on-surface/[0.05] transition-colors"
  >
    <span className="w-[30px] h-[30px] rounded-full bg-primary/10 text-primary flex items-center justify-center">
      <Plus size={15} strokeWidth={2.1} />
    </span>
    <span className="text-on-surface" style={{ fontSize: '12.5px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
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
        return (
          <Link key={g.id} to={`/guides/${g.id}`} className="group flex-none w-[148px] snap-start active:opacity-80 transition-opacity">
            <CardMedia
              src={g.coverPhoto}
              alt=""
              aspect="square"
              rounded="2xl"
              zoomOnHover
              placeholder={
                <div className="flex h-full w-full items-center justify-center bg-primary/[0.07] text-primary/35">
                  <BookOpen size={26} strokeWidth={1.5} />
                </div>
              }
              overlay={
                <>
                  <span
                    className="absolute top-2.5 left-2.5 rounded-full bg-black/55 backdrop-blur-md text-white px-2 py-1"
                    style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}
                  >
                    {g.entries.length} {g.type === 'recipes' ? 'recipes' : 'spots'}
                  </span>
                  {/* No height of its own — grows from the bottom edge to
                      fit whatever line-clamp-2 keeps, so there's nothing
                      for CardMedia's own rounded clip to cut into. */}
                  <div
                    className="absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-8"
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.32) 55%, rgba(0,0,0,0) 100%)' }}
                  >
                    <h3
                      className="line-clamp-2 font-serif text-white"
                      style={{ fontSize: '13.5px', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.01em', textShadow: '0 1px 4px rgba(0,0,0,0.35)' }}
                    >
                      {g.title}
                    </h3>
                  </div>
                </>
              }
            />
            <p className="mt-1.5 truncate text-[11.5px] text-on-surface/45">
              by {authorName}
            </p>
          </Link>
        );
      })}

      <BuildYourOwn onCreate={onCreate} />
    </div>
    )}
  </section>
);
