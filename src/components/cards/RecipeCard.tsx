import React from 'react';
import { ChefHat, Clock } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';
import { cn } from '../../lib/utils';
import { ScoreBadge } from '../ScoreBadge';
import { CardShell, type CardSurface } from './CardShell';
import { CardMedia } from './CardMedia';
import { ScoreOverlay } from './ScoreOverlay';

/**
 * The recipe sibling of RestaurantCard — same desktop/mobile surfaces and the
 * same slot model, just recipe metadata (cuisine · time · difficulty, an author
 * byline) and a ChefHat placeholder. Time is a pre-formatted string so the card
 * stays pure (callers format with recipe-display helpers).
 */
export type RecipeCardVariant = 'photo-tile' | 'row';

export interface RecipeCardProps {
  name: string;
  image?: string | null;
  score?: number;
  cuisine?: string;
  /** Pre-formatted total time, e.g. "35 min" / "1h 10m". */
  time?: string;
  difficulty?: string;
  /** Optional author line, e.g. "by Alex". */
  byline?: string;
  /** Optional ingredient/summary preview (row variant). */
  preview?: string;
  variant?: RecipeCardVariant;
  surface?: CardSurface;
  to?: string;
  onClick?: (e: React.MouseEvent) => void;
  as?: 'a' | 'button' | 'div';
  interactive?: boolean;
  /** In-flow trailing controls (row: right cluster; tile: over the photo top-right). */
  trailing?: React.ReactNode;
  /** Absolute overlay layer (delete-confirm, etc.). */
  overlay?: React.ReactNode;
  className?: string;
}

export const RecipePlaceholder: React.FC = () => (
  <div className="flex h-full w-full items-center justify-center bg-emerald-50">
    <ChefHat size={22} strokeWidth={1.6} className="text-emerald-600/40" />
  </div>
);

export const RecipeCard: React.FC<RecipeCardProps> = ({
  name,
  image,
  score,
  cuisine,
  time,
  difficulty,
  byline,
  preview,
  variant = 'photo-tile',
  surface,
  to,
  onClick,
  as,
  interactive = true,
  trailing,
  overlay,
  className,
}) => {
  const { phoneMode } = useSettings();
  const linkAs: 'a' | 'button' | 'div' = as ?? (to ? 'a' : 'button');

  // Recipe meta reads "Cuisine · 35 min · Easy" — render via CuisineLine for
  // the cuisine, then append time/difficulty inline so it matches the muted
  // normal-case treatment used across the app.
  const metaBits = [cuisine, time, difficulty].filter(Boolean) as string[];
  const metaLine = metaBits.length ? (
    <p className="mt-1 flex items-center gap-1 truncate text-[12.5px] font-medium text-on-surface/55">
      {time && <Clock size={12} className="flex-shrink-0 text-on-surface/40" />}
      <span className="truncate">{metaBits.join(' · ')}</span>
    </p>
  ) : null;

  /* ── Row — boxed desktop / hairline-divided mobile ───────────────────── */
  if (variant === 'row') {
    const rowSurface = surface ?? (phoneMode ? 'flat-row' : 'boxed');
    return (
      <CardShell
        as={linkAs}
        to={linkAs === 'a' ? to : undefined}
        onClick={onClick}
        surface={rowSurface}
        interactive={interactive}
        className={cn('relative', className)}
      >
        <div className={cn('flex', phoneMode ? 'items-center gap-3 py-3' : 'items-center gap-4 px-4 py-3.5')}>
          <CardMedia
            src={image}
            alt={name}
            aspect="thumb"
            rounded="xl"
            className={cn('flex-shrink-0', phoneMode ? 'h-14 w-14' : 'h-[68px] w-[68px]')}
            imgClassName="group-hover:scale-[1.04]"
            zoomOnHover
            placeholder={<RecipePlaceholder />}
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <h3 className={cn('truncate font-serif font-bold leading-tight', phoneMode ? 'text-[15px]' : 'text-[15.5px]')}>
              {name}
            </h3>
            {metaLine}
            {preview && <p className="mt-0.5 line-clamp-1 text-[12px] text-on-surface/45">{preview}</p>}
            {byline && <p className="mt-0.5 truncate text-[11.5px] italic text-on-surface/45">{byline}</p>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {score ? <ScoreBadge rating={score} size={phoneMode ? 'sm' : 'md'} /> : null}
            {trailing}
          </div>
        </div>
        {overlay}
      </CardShell>
    );
  }

  /* ── Photo tile — boxed on desktop, borderless/immersive on mobile. ── */
  const tileSurface = surface ?? (phoneMode ? 'photo-tile' : 'boxed');
  const isImmersive = tileSurface === 'photo-tile';
  return (
    <CardShell
      as={linkAs}
      to={linkAs === 'a' ? to : undefined}
      onClick={onClick}
      surface={tileSurface}
      interactive={interactive}
      className={cn('relative', className)}
    >
      <CardMedia
        src={image}
        alt={name}
        aspect={phoneMode ? '4/5' : '4/3'}
        rounded={isImmersive ? '2xl' : 'none'}
        zoomOnHover
        placeholder={<RecipePlaceholder />}
        overlay={
          <>
            {trailing && <div className="absolute right-2.5 top-2.5 z-10">{trailing}</div>}
            <ScoreOverlay rating={score} size="sm" position="bottom-left" />
          </>
        }
      />
      <div className={cn(isImmersive ? 'pt-2' : 'px-3 pb-3 pt-2.5')}>
        <h3 className="line-clamp-2 font-serif text-[15px] font-bold leading-snug text-on-surface sm:text-base">{name}</h3>
        {metaLine}
        {byline && <p className="mt-0.5 truncate text-[11.5px] italic text-on-surface/45">{byline}</p>}
      </div>
      {overlay}
    </CardShell>
  );
};
