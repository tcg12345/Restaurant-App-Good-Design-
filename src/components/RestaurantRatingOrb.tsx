import React from 'react';
import { formatScore, scoreHex } from '../lib/score';
import { useSettings } from '../contexts/SettingsContext';

/** A score and its audience form one compact, accessible unit. */
export function RestaurantRatingOrb({ label, score, meta, onClick }: {
  label: string;
  score: number | null;
  meta?: string;
  onClick?: () => void;
}) {
  const { twoDecimalScores } = useSettings();
  const value = score == null ? '—' : formatScore(score, twoDecimalScores);
  const style = score == null ? undefined : { '--orb-ink': scoreHex(score) } as React.CSSProperties;
  const contents = <>
    <span className="restaurant-orb" style={style}>
      <span className="restaurant-orb-value">{value}</span>
      <span className="restaurant-orb-label">{label}</span>
    </span>
    {meta && <span className="restaurant-orb-meta">{meta}</span>}
  </>;
  const accessible = `${label}: ${score == null ? 'No ratings yet' : `${value} out of 10`}${meta ? `, ${meta}` : ''}`;
  return onClick
    ? <button type="button" className="restaurant-orb-item" onClick={onClick} aria-label={accessible}>{contents}</button>
    : <span className="restaurant-orb-item" aria-label={accessible}>{contents}</span>;
}
