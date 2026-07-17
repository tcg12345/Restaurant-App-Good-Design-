import React from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useMichelinMatch } from '../../lib/useMichelinMatch';
import { safeImage, cn } from '../../lib/utils';
import { ScoreBadge } from '../ScoreBadge';
import { CardShell, type CardSurface } from './CardShell';
import { CardMedia, NoPhotoPlaceholder } from './CardMedia';
import { SaveButton, AddButton } from './SaveButton';
import { CuisineLine } from './CuisineLine';
import { MetaRow } from './MetaRow';
import { ScoreOverlay } from './ScoreOverlay';

/**
 * The one restaurant card for browsing surfaces. It owns the desktop-vs-mobile
 * decision (boxed tiles/rows on desktop, immersive photo tiles + hairline rows
 * on mobile) and the Michelin cuisine/price override, but NOT any edit / delete
 * / swipe behavior — callers inject those via the `trailing` (in-flow controls)
 * and `overlay` (absolute layer) slots. Location/distance are pass-in strings so
 * the card stays pure; the Pantry hook resolves them.
 *
 * Old variant names ('card' / 'list-item') are accepted as aliases so existing
 * call sites keep working.
 */
export type RestaurantCardVariant = 'photo-tile' | 'row' | 'hero' | 'card' | 'list-item';

function normalizeVariant(v: RestaurantCardVariant): 'photo-tile' | 'row' | 'hero' {
  if (v === 'card') return 'photo-tile';
  if (v === 'list-item') return 'row';
  return v;
}

export interface RestaurantCardProps {
  id: string;
  name: string;
  image?: string | null;
  rating?: number;
  price?: string;
  cuisine?: string;
  /** Coordinates / address feed the Michelin override (cuisine + price). */
  lat?: number;
  lng?: number;
  address?: string;
  /** Pre-formatted strings — the card never computes these. */
  distance?: string;
  location?: string;
  isWishlisted?: boolean;
  onAdd?: () => void;
  /** Save-to-wishlist toggle (bookmark). */
  onSave?: () => void;
  /** Legacy props accepted for back-compat with old call sites (currently
   *  display-only metadata that the card doesn't render). */
  friendReviews?: number;
  expertReviews?: number;
  variant?: RestaurantCardVariant;
  /** Force the surface; defaults to the phoneMode-derived value. */
  surface?: CardSurface;
  /** Skip the Michelin lookup when the caller already resolved cuisine/price. */
  rawCuisine?: boolean;
  /** Navigation target; defaults to the detail route. */
  to?: string;
  onClick?: (e: React.MouseEvent) => void;
  as?: 'a' | 'button' | 'div';
  interactive?: boolean;
  /** Caller-injected in-flow controls (edit/more), in the right cluster. */
  trailing?: React.ReactNode;
  /** Caller-injected absolute overlay (delete-confirm, swipe layer). */
  overlay?: React.ReactNode;
  className?: string;
}

const HERO_GRADIENT =
  'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0.1) 80%, transparent 100%)';

export const RestaurantCard: React.FC<RestaurantCardProps> = ({
  id,
  name,
  image,
  rating,
  price: priceProp,
  cuisine: cuisineProp,
  lat,
  lng,
  address,
  distance,
  location,
  isWishlisted = false,
  onAdd,
  onSave,
  variant = 'photo-tile',
  surface,
  rawCuisine = false,
  to,
  onClick,
  as,
  interactive = true,
  trailing,
  overlay,
  className,
}) => {
  const { phoneMode } = useSettings();
  const v = normalizeVariant(variant as RestaurantCardVariant);

  // Michelin override: starred / Bib Gourmand restaurants show the Guide's
  // cuisine + price. No-op for unlisted places. The distinction mark
  // itself is never shown on browsing cards.
  const matched = useMichelinMatch(
    rawCuisine ? '' : name,
    lat,
    lng,
    address,
    cuisineProp ?? '',
    priceProp ?? '',
  );
  const cuisine = rawCuisine ? cuisineProp : matched.cuisine;
  const price = rawCuisine ? priceProp : matched.price;

  const href = to ?? `/restaurant/${id}`;
  const linkAs: 'a' | 'button' | 'div' = as ?? (onClick && !to ? 'div' : 'a');
  const hasSave = !!onSave;
  const hasAdd = !!onAdd;

  /* ── Hero — identical on both platforms (already immersive) ───────────── */
  if (v === 'hero') {
    const safe = safeImage(image);
    return (
      <CardShell
        as={linkAs}
        to={linkAs === 'a' ? href : undefined}
        onClick={onClick}
        surface="bare"
        className={cn('relative aspect-[4/3] overflow-hidden rounded-2xl bg-on-surface/5', className)}
      >
        {safe ? (
          <img
            src={safe}
            alt={name}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0">
            <NoPhotoPlaceholder size="lg" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3" style={{ background: HERO_GRADIENT }} />
        <div className="absolute inset-x-0 top-3 z-10 flex items-start justify-between gap-2 px-3">
          <div />
          <div className="flex items-center gap-2">
            {hasSave && <SaveButton filled={isWishlisted} onClick={onSave} />}
            {hasAdd && <AddButton onClick={onAdd} />}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-4">
          <div className="pointer-events-none min-w-0">
            <h3 className="line-clamp-2 font-serif text-lg font-bold leading-tight text-white drop-shadow-md">{name}</h3>
            <p className="mt-1 truncate text-xs font-medium text-white/85">
              {cuisine}
              {price ? <span className="mx-1.5 text-white/55">·</span> : null}
              {price}
            </p>
          </div>
          {rating ? <ScoreBadge rating={rating} size="lg" className="shadow-md shadow-black/20" /> : null}
        </div>
      </CardShell>
    );
  }

  /* ── Row — boxed on desktop, hairline-divided flat on mobile ─────────── */
  if (v === 'row') {
    const rowSurface = surface ?? (phoneMode ? 'flat-row' : 'boxed');
    return (
      <CardShell
        as={linkAs}
        to={linkAs === 'a' ? href : undefined}
        onClick={onClick}
        surface={rowSurface}
        interactive={interactive}
        className={cn('relative', className)}
      >
        <div className={cn('flex', phoneMode ? 'items-start gap-3 py-3' : 'items-center gap-4 px-4 py-3.5')}>
          {safeImage(image) && (
            <CardMedia
              src={image}
              alt={name}
              aspect="thumb"
              rounded="lg"
              className="h-14 w-14 flex-shrink-0"
              imgClassName="group-hover:scale-[1.04]"
              zoomOnHover
              placeholderSize="sm"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <h3 className={cn('truncate font-serif font-bold leading-tight', phoneMode ? 'text-[15px]' : 'text-[16px]')}>
              {name}
            </h3>
            <CuisineLine cuisine={cuisine} price={price} className="mt-0.5 text-[11px]" />
            <MetaRow items={[location, distance]} className="mt-1" />
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {rating ? <ScoreBadge rating={rating} size={phoneMode ? 'sm' : 'md'} /> : null}
            {hasSave && <SaveButton filled={isWishlisted} onClick={onSave} />}
            {hasAdd && <AddButton onClick={onAdd} />}
            {trailing}
          </div>
        </div>
        {overlay}
      </CardShell>
    );
  }

  /* ── Photo tile — boxed on desktop (framed, hover-lift, per the reference
        + the Discover rail), borderless & edge-to-edge on mobile (immersive,
        the photo is the frame). ───────────────────────────────────────── */
  const tileSurface = surface ?? (phoneMode ? 'photo-tile' : 'boxed');
  const isImmersive = tileSurface === 'photo-tile';
  const tileOverlay = (
    <>
      {(hasSave || hasAdd) && (
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
          {hasSave && <SaveButton filled={isWishlisted} onClick={onSave} />}
          {hasAdd && <AddButton onClick={onAdd} />}
        </div>
      )}
      <ScoreOverlay rating={rating} size="sm" position="bottom-left" />
    </>
  );

  return (
    <CardShell
      as={linkAs}
      to={linkAs === 'a' ? href : undefined}
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
        overlay={tileOverlay}
      />
      <div className={cn(isImmersive ? 'pt-2' : 'px-3 pb-3 pt-2.5')}>
        <h3 className="line-clamp-2 font-serif text-[15px] font-bold leading-snug text-on-surface sm:text-base">{name}</h3>
        <CuisineLine cuisine={cuisine} price={price} className="mt-1" />
        <MetaRow items={[location, distance]} className="mt-0.5" />
      </div>
      {overlay}
    </CardShell>
  );
};
