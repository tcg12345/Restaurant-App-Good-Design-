import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Guide } from '../lib/supabase-guides';
import type { UserProfile } from '../lib/supabase-community';
import { avatarHue } from '../lib/avatar';

/**
 * "Guides for you" — the horizontal guides rail, extracted from the Discover
 * top so it can slide INTO the feed Instagram-style (via SocialFeed's
 * `inlineSlot`) instead of stacking above it. Square gradient/cover cards +
 * serif title + author chip; a create-a-guide tile leads when empty and
 * trails otherwise, so guide creation stays one tap away.
 */


interface GuidesRailProps {
  guides: Guide[];
  authors: Record<string, UserProfile>;
  onBrowseAll: () => void;
  onCreate: () => void;
}

export const GuidesRail: React.FC<GuidesRailProps> = ({ guides, authors, onBrowseAll, onCreate }) => (
  <section>
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="font-serif font-semibold text-on-surface text-[17px] leading-[1.1] tracking-[-0.015em]">
        Guides for you
      </h2>
      <button
        type="button"
        onClick={onBrowseAll}
        className="text-[13px] font-semibold text-primary active:opacity-70 transition-opacity"
      >
        Browse all
      </button>
    </div>
    <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar scroll-smooth snap-x -mx-3 pl-3 pr-3">
      {/* Empty state only — when there are no guides yet, lead with an
          inviting descriptive tile so the row isn't bare. */}
      {guides.length === 0 && (
        <button
          type="button"
          onClick={onCreate}
          className="flex-shrink-0 snap-start text-left group w-[160px]"
        >
          <div className="aspect-square rounded-2xl border-[1.5px] border-dashed border-primary/30 bg-primary/[0.05] p-4 flex flex-col justify-between transition-colors group-hover:border-primary group-hover:bg-primary/[0.08]">
            <div className="w-10 h-10 rounded-2xl bg-white shadow-sm grid place-items-center text-primary">
              <Plus size={18} />
            </div>
            <div>
              <h3 className="font-serif font-semibold text-[17px] text-on-surface tracking-[-0.015em] leading-tight">
                Create a guide
              </h3>
              <p className="mt-1 text-[12px] text-on-surface/65 leading-[1.4]">
                Bundle restaurants or recipes into a shareable list.
              </p>
            </div>
          </div>
        </button>
      )}
      {guides.map((g) => {
        const author = authors[g.userId];
        const authorName = author?.display_name || author?.username || 'someone';
        const authorInitial = authorName.charAt(0).toUpperCase();
        const authorHue = avatarHue(g.userId || authorName);
        return (
          <Link key={g.id} to={`/guides/${g.id}`} className="flex-shrink-0 snap-start group w-[160px]">
            <article className="card-surface card-surface-hover flex flex-col">
              <div className="relative aspect-[1/0.85] overflow-hidden bg-on-surface/[0.04]">
                {g.coverPhoto ? (
                  <img
                    src={g.coverPhoto}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-on-surface/[0.06] to-on-surface/[0.02]">
                    <BookOpen size={30} className="text-on-surface/20" strokeWidth={1.5} />
                  </div>
                )}
                <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-white/90 backdrop-blur-sm shadow-sm text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface">
                  <BookOpen size={11} className="text-primary" />
                  Guide · {g.entries.length} {g.type === 'recipes' ? 'recipes' : 'spots'}
                </span>
              </div>
              <div className="px-3.5 pt-3 pb-3.5">
                <h3 className="font-serif font-semibold text-on-surface text-[15px] tracking-[-0.01em] leading-[1.25] line-clamp-2">
                  {g.title}
                </h3>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-on-surface/55">
                  <span
                    className="w-[18px] h-[18px] rounded-full grid place-items-center text-white text-[9px] font-bold"
                    style={{ background: `hsl(${authorHue} 50% 45%)` }}
                  >
                    {authorInitial}
                  </span>
                  <span>by {authorName}</span>
                </div>
                {((g.readMinutes ?? 0) > 0 || g.avgScore != null) && (
                  <div className="mt-1 text-[10.5px] font-medium text-on-surface/45 tabular-nums">
                    {[
                      (g.readMinutes ?? 0) > 0 ? `~${g.readMinutes} min` : null,
                      g.avgScore != null ? `avg ${g.avgScore.toFixed(1)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </article>
          </Link>
        );
      })}
      {/* Minimalist create-a-guide tile — sits at the end of the row and
          stretches to match the guide cards' height. */}
      {guides.length > 0 && (
        <button type="button" onClick={onCreate} className="flex-shrink-0 snap-start group w-[160px]">
          <div className="h-full min-h-[140px] rounded-2xl border border-dashed border-on-surface/15 bg-on-surface/[0.03] flex flex-col items-center justify-center gap-2.5 px-4 py-7 text-center transition-colors group-hover:border-primary/40 group-hover:bg-on-surface/[0.06]">
            <span className="w-11 h-11 rounded-full bg-primary/10 text-primary grid place-items-center transition-colors group-hover:bg-primary/15">
              <Plus size={20} strokeWidth={2} />
            </span>
            <span className="font-serif font-semibold text-[15px] text-on-surface leading-[1.15]">
              Create a guide
            </span>
          </div>
        </button>
      )}
    </div>
  </section>
);
