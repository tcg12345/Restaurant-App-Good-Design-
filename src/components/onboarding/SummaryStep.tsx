import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import * as OB from './OnboardingKit';
import { TASTE_PRICES, DIETARY_OPTIONS } from './TasteSteps';
import { TierEmblem } from '../profile/TierEmblem';
import { useTasteProfile } from '../../lib/useTasteProfile';
import { fetchTastePreview } from '../../lib/taste-preview';
import { cuisineLabel } from '../../lib/cuisine';
import { priceLevelToString } from '../../lib/places';
import type { ScoredPlace } from '../../lib/recommendations';
import type { HomeLocation } from '../HomeLocationBar';

/**
 * The wizard's last screen — the payoff the gate promised.
 *
 * "Save my taste profile" was the ask; until now nothing ever showed the
 * profile back. The wizard cut straight to the app and the coachmark tour
 * took over, so the thing they built stayed invisible until they found
 * the card on their own profile. This screen closes that loop: the tier
 * emblem they will climb, a first name for the palate in the same
 * vocabulary the full page uses once real ratings exist, the answers as
 * chips, and three places to start.
 */

/**
 * A palate name from the quiz alone. lib/taste-insights buildArchetype
 * needs five scored ratings and reads price and cuisine SHARES; a brand-new
 * account has neither, but it has stated the same things outright. Same
 * two-word shape and the same words — style × role — so the name on this
 * screen and the name on the profile page a month later read as one
 * thing maturing, not two features. Ratings replace it, never merge with
 * it: TasteProfileCard shows the real archetype the moment there is one.
 */
export function quizArchetype(cuisines: string[], pricePrimary?: number): string | null {
  if (cuisines.length === 0 && pricePrimary === undefined) return null;
  const style = pricePrimary === undefined ? 'Any-Table' : pricePrimary >= 3 ? 'Fine-Dining' : 'Value';
  const role = cuisines.length === 1
    ? `${cuisines[0]} Devotee`
    : cuisines.length >= 12 ? 'Explorer'
      : cuisines.length >= 6 ? 'Generalist'
        : 'Specialist';
  return `The ${style} ${role}`;
}

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    className="inline-flex items-center rounded-full"
    style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: 'var(--ob-ink)', background: 'var(--ob-card)', border: '1px solid var(--ob-border)' }}
  >
    {children}
  </span>
);

const PickRow: React.FC<{ place: ScoredPlace; index: number }> = ({ place, index }) => {
  const sub = [cuisineLabel(place), priceLevelToString(place.priceLevel)].filter(Boolean).join(' · ');
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 + index * 0.07, ease: OB.EASE }}
      className="flex items-center gap-3 rounded-2xl"
      style={{ padding: '11px 14px', background: 'var(--ob-card)', border: '1px solid var(--ob-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <span className="flex-1 min-w-0">
        <span className="block truncate font-serif font-bold" style={{ fontSize: 15, lineHeight: 1.2, color: 'var(--ob-ink)' }}>{place.name}</span>
        <span className="block truncate" style={{ fontSize: 12.5, marginTop: 2, color: 'var(--ob-label)' }}>{sub}</span>
      </span>
      {place.rating > 0 && (
        <span className="flex-none inline-flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ob-ink)' }}>
          <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: OB.TERRA }} />
          {place.rating.toFixed(1)}
        </span>
      )}
    </motion.li>
  );
};

export const SummaryStep: React.FC<{
  name: string;
  cuisines: string[];
  pricePrimary?: number;
  priceSecondary?: number;
  dietary: string[];
  city: HomeLocation | null;
}> = ({ name, cuisines, pricePrimary, priceSecondary, dietary, city }) => {
  // The same hook the profile card and the full page run, so the points
  // and tier here are exactly what they will see next — ratings made on
  // the rate step, the photo, the cuisines they cover, all already
  // counted.
  const { points, standing, ratingCount } = useTasteProfile();
  const archetype = quizArchetype(cuisines, pricePrimary);
  const firstName = name.trim().split(/\s+/)[0] || '';

  const [picks, setPicks] = useState<ScoredPlace[] | null>(null);
  useEffect(() => {
    if (!city) return;
    let cancelled = false;
    fetchTastePreview({ cuisines, prices: [pricePrimary, priceSecondary].filter((n): n is number => n !== undefined) }, city, { limit: 6 })
      .then((places) => { if (!cancelled) setPicks(places); })
      .catch(() => { if (!cancelled) setPicks([]); });
    return () => { cancelled = true; };
    // Fires once: the answers can't change while this screen is showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.lat, city?.lng]);

  const spend = pricePrimary !== undefined ? TASTE_PRICES.find((t) => t.tier === pricePrimary) : undefined;
  const chips: string[] = [
    ...cuisines.slice(0, 4),
    ...(cuisines.length > 4 ? [`+${cuisines.length - 4} more`] : []),
    ...(spend ? [`${spend.sub} · ${spend.label}`] : []),
    ...dietary.map((d) => DIETARY_OPTIONS.find((o) => o.id === d)?.title ?? d),
    ...(city ? [city.label.split(',')[0]] : []),
  ];

  const standingLine = standing.next
    ? `${standing.tier.name} · ${points.total} pts — ${standing.next.name} at ${standing.next.min}`
    : `${standing.tier.name} · ${points.total} pts`;
  const recordLine = ratingCount > 0
    ? `${ratingCount} rating${ratingCount === 1 ? '' : 's'} already on the record. Every one you add sharpens this.`
    : 'Built from your answers. Your first rating starts the real thing.';

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-center text-center" style={{ marginTop: 22 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...OB.SPRING_SOFT, delay: 0.05 }}
        >
          <TierEmblem tier={standing.tier} progress={standing.progress} size={96} animate />
        </motion.div>
        <OB.Reveal i={1} style={{ marginTop: 18 }}>
          <OB.Eyebrow>{firstName ? `${firstName}, this is your taste profile` : 'Your taste profile'}</OB.Eyebrow>
        </OB.Reveal>
        <OB.Reveal blur i={2} style={{ marginTop: 10 }}>
          <OB.Title size={30}>{archetype ?? standing.tier.name}</OB.Title>
        </OB.Reveal>
        <OB.Reveal i={3} style={{ marginTop: 8 }}>
          <div className="tabular-nums" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ob-secondary)' }}>{standingLine}</div>
        </OB.Reveal>
        <OB.Reveal i={4} style={{ marginTop: 12, width: '100%', maxWidth: 240 }}>
          <div className="overflow-hidden" style={{ height: 4, borderRadius: 2, background: 'var(--ob-divider)' }} aria-hidden>
            <motion.div
              style={{ height: '100%', borderRadius: 2, background: OB.TERRA }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(4, standing.progress * 100)}%` }}
              transition={{ ...OB.SPRING_SOFT, delay: 0.4 }}
            />
          </div>
        </OB.Reveal>
        <OB.Reveal i={5} style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--ob-label)', maxWidth: 300, margin: 0 }}>{recordLine}</p>
        </OB.Reveal>
      </div>

      {chips.length > 0 && (
        <OB.Reveal i={6} style={{ marginTop: 22 }}>
          <div className="flex flex-wrap justify-center" style={{ gap: 8 }}>
            {chips.map((c) => <Chip key={c}>{c}</Chip>)}
          </div>
        </OB.Reveal>
      )}

      {city && picks?.length !== 0 && (
        <div style={{ marginTop: 30 }}>
          <OB.Reveal i={7}>
            <OB.Eyebrow>Where to start near {city.label.split(',')[0]}</OB.Eyebrow>
          </OB.Reveal>
          <ul className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
            {picks === null
              ? [0, 1, 2].map((i) => (
                <li key={i} className="animate-pulse rounded-2xl" style={{ height: 58, background: 'var(--ob-divider)' }} />
              ))
              : picks.slice(0, 3).map((p, i) => <PickRow key={p.id} place={p} index={i} />)}
          </ul>
        </div>
      )}
    </div>
  );
};
