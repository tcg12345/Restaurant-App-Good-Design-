import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTasteProfile } from '../../lib/useTasteProfile';
import { TierEmblem } from './TierEmblem';
import { cn } from '../../lib/utils';
import type { TierStanding } from '../../lib/taste-tier';

/**
 * The taste-profile teaser, presentational.
 *
 * A SECTION of the page, not a box on it: no fill, no ring, no card
 * padding, so it sits in the same rhythm as the profile's other sections
 * and the page's own margin sets its width. Only the chevron and the
 * press-scale say it is tappable.
 *
 * Everything below the identity row runs the full width — the palate's
 * sentence, the ladder, the traits. The version before this one put the
 * emblem in a fixed left column and the chevron in a fixed right one, so
 * every line of prose was squeezed into the ~70% between them and a
 * one-line tagline wrapped to four.
 *
 * Used on your own profile (TasteProfileCard, below) and on other
 * people's (UserProfile), so the two read as the same object.
 */
export const TasteSummaryCard: React.FC<{
  standing: TierStanding;
  points: number;
  rank?: number | null;
  ranked?: number;
  archetype: string | null;
  lead: string;
  chips: string[];
  onPress: () => void;
  eyebrow?: string;
  ariaLabel?: string;
  className?: string;
}> = ({ standing, points, rank, ranked = 0, archetype, lead, chips, onPress, eyebrow = 'Taste profile', ariaLabel, className }) => {
  // The ladder in words. The emblem's ring says the same thing as a glyph;
  // this is the version you can read a number off.
  const ladder = standing.next
    ? `${standing.toNext} ${standing.toNext === 1 ? 'pt' : 'pts'} to ${standing.next.name}`
    : 'Top of the ladder';
  // The palate's name leads. Before there is one, the tier is the only
  // name this thing has, and the meta line drops it rather than say it
  // twice.
  const title = archetype ?? standing.tier.name;
  const meta = archetype ? `${standing.tier.name} · ${points} pts` : `${points} pts`;
  return (
    <button
      type="button"
      onClick={onPress}
      data-tour="taste-profile"
      className={cn('card-surface-press block w-full text-left', className)}
      aria-label={ariaLabel ?? `${eyebrow}: ${standing.tier.name}, ${points} points`}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className="truncate text-primary"
          style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}
        >
          {eyebrow}
        </span>
        {/* The rank rides the EYEBROW line, where there is room. Beside the
            palate name it stole width from the one line that has to hold a
            name, and "Explorer 212 pts" broke in half the moment the rank
            read "#14 of 326". */}
        {rank != null && ranked > 0 && (
          <span
            className="flex-none whitespace-nowrap text-on-surface/45 tabular-nums"
            style={{ fontSize: '11.5px', fontWeight: 600 }}
          >
            #{rank} of {ranked}
          </span>
        )}
      </span>

      <span className="mt-2.5 flex items-center gap-3">
        {/* No ring: the ladder below states the same progress in a form you
            can read, and a low fill renders as an arc floating off the disc. */}
        <TierEmblem tier={standing.tier} progress={standing.progress} size={44} animate={false} ring={false} />
        <span className="min-w-0 flex-1">
          {/* Wraps, never truncates: this is the name of the thing, and
              "The Fine-Dining Explor…" is worse than two lines. */}
          <span
            className="block font-serif text-on-surface"
            style={{ fontSize: '19px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', textWrap: 'balance' } as React.CSSProperties}
          >
            {title}
          </span>
          <span className="mt-[3px] block truncate text-on-surface/45 tabular-nums" style={{ fontSize: '12.5px', fontWeight: 600 }}>
            {meta}
          </span>
        </span>
        <ChevronRight size={17} className="flex-none text-on-surface/25" />
      </span>

      {lead && (
        <span
          className="mt-3 block text-on-surface/65"
          style={{ fontSize: '13.5px', lineHeight: 1.5, textWrap: 'pretty' } as React.CSSProperties}
        >
          {lead}
        </span>
      )}

      {/* The ladder: a full-width rule with its own caption on the same
          line, so the next rung is concrete without costing a block. */}
      <span className="mt-3.5 flex items-center gap-3">
        <span className="block h-1 flex-1 overflow-hidden rounded-full bg-on-surface/[0.09]" aria-hidden>
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.max(2, standing.progress * 100)}%` }}
          />
        </span>
        <span className="flex-none whitespace-nowrap text-on-surface/45" style={{ fontSize: '11.5px', fontWeight: 600 }}>
          {ladder}
        </span>
      </span>

      {chips.length > 0 && (
        <span className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-primary/[0.12] text-primary"
              style={{ padding: '5px 10px', fontSize: '11.5px', fontWeight: 600 }}
            >
              {chip}
            </span>
          ))}
        </span>
      )}
    </button>
  );
};

/** Your own card: the same hook the full page uses, so the line you tap
 *  on is the line the page leads with. */
export const TasteProfileCard: React.FC<{ className?: string }> = ({ className }) => {
  const navigate = useNavigate();
  const { insights, points, standing, benchmarks, ratingCount } = useTasteProfile();
  const archetype = ratingCount > 0 ? insights.palate.archetype : null;
  const lead = ratingCount === 0
    ? 'Rate a place and your palate starts going on the record.'
    : archetype
      ? (insights.palate.tagline ?? '')
      : insights.sentences[0]?.headline
      ?? (ratingCount < 5
        ? `${ratingCount} rating${ratingCount === 1 ? '' : 's'} in — insights unlock at five.`
        : `${insights.breadth.count} cuisine${insights.breadth.count === 1 ? '' : 's'} on the record so far.`);
  return (
    <TasteSummaryCard
      standing={standing}
      points={points.total}
      rank={benchmarks?.benchmarks.myRank ?? null}
      ranked={benchmarks?.benchmarks.rankedUsers ?? 0}
      archetype={archetype}
      lead={lead}
      chips={insights.chips}
      onPress={() => navigate('/profile/taste')}
      className={className}
    />
  );
};
