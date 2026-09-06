import React from 'react';
import './ProfileDesign.css';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTasteProfile } from '../../lib/useTasteProfile';
import { TierEmblem } from './TierEmblem';
import { cn } from '../../lib/utils';
import type { TierStanding } from '../../lib/taste-tier';

/** Compact shared entry to the full taste profile, using the same derived
 * identity and level as the detail page. */
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
    : 'Highest level reached';
  // The palate's name leads. Before there is one, the tier is the only
  // name this thing has, and the meta line drops it rather than say it
  // twice.
  const title = archetype ?? standing.tier.name;
  const meta = archetype ? `${standing.tier.name} · ${points} pts` : `${points} pts`;
  return (
    <button type="button" onClick={onPress} data-tour="taste-profile"
      className={cn('profile-taste-card', className)}
      aria-label={ariaLabel ?? `${eyebrow}: ${standing.tier.name}, ${points} points`}>
      <span className="profile-taste-eyebrow">{eyebrow}{rank != null && ranked > 1 && <span>#{rank} of {ranked}</span>}</span>
      <span className="profile-taste-identity">
        <TierEmblem tier={standing.tier} progress={standing.progress} size={42} animate={false} ring={false} />
        <span><strong>{title}</strong><small>{meta}</small></span>
        <ChevronRight size={18} />
      </span>
      {chips.length > 0 ? <span className="profile-taste-traits">{chips.slice(0, 3).join(' · ')}</span> : lead && <span className="profile-taste-traits">{lead}</span>}
      <span className="profile-taste-footer"><span>View taste profile</span><span>{ladder}</span></span>
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
