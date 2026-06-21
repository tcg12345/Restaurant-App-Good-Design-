import React from 'react';
import { ImageOff } from 'lucide-react';
import { cn, safeImage } from '../../lib/utils';

/**
 * Cover photo or a tidy "no photos yet" placeholder — the one place every card
 * renders a restaurant/recipe image. Routes the URL through `safeImage` so a
 * cached Google Places photo URL (billed per fetch) can never be requested, and
 * always sets `referrerPolicy="no-referrer"`.
 *
 * The app intentionally stopped fetching Google photos, so many restaurants
 * have no image — the placeholder is the common case, not the exception.
 */
export type CardMediaAspect = 'square' | '4/3' | '4/5' | 'thumb';

function aspectClass(a: CardMediaAspect): string {
  return a === 'square' ? 'aspect-square'
    : a === '4/3' ? 'aspect-[4/3]'
    : a === '4/5' ? 'aspect-[4/5]'
    : ''; // 'thumb' — caller fixes width/height via className
}

export const NoPhotoPlaceholder: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-on-surface/30">
    <ImageOff size={size === 'sm' ? 14 : size === 'lg' ? 22 : 18} />
    {size !== 'sm' && (
      <span className="px-1 text-center text-[9px] font-bold uppercase leading-tight tracking-[0.1em] text-on-surface/40">
        No photos yet
      </span>
    )}
  </div>
);

interface CardMediaProps {
  src?: string | null;
  alt: string;
  aspect?: CardMediaAspect;
  rounded?: 'lg' | 'xl' | '2xl' | 'none';
  className?: string;
  imgClassName?: string;
  /** Replace the default ImageOff placeholder (recipes pass a ChefHat tile). */
  placeholder?: React.ReactNode;
  placeholderSize?: 'sm' | 'md' | 'lg';
  /** Subtle zoom on parent `group` hover (desktop). */
  zoomOnHover?: boolean;
  /** Absolutely-positioned children over the photo (score badge, heart, pill). */
  overlay?: React.ReactNode;
}

export const CardMedia: React.FC<CardMediaProps> = ({
  src,
  alt,
  aspect = '4/3',
  rounded = 'none',
  className,
  imgClassName,
  placeholder,
  placeholderSize = 'md',
  zoomOnHover = false,
  overlay,
}) => {
  const safe = safeImage(src);
  const roundedClass =
    rounded === 'none' ? '' : rounded === 'lg' ? 'rounded-lg' : rounded === 'xl' ? 'rounded-xl' : 'rounded-2xl';
  return (
    <div className={cn('relative overflow-hidden bg-on-surface/5', aspectClass(aspect as CardMediaAspect), roundedClass, className)}>
      {safe ? (
        <img
          src={safe}
          alt={alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          className={cn(
            'h-full w-full object-cover',
            zoomOnHover && 'transition-transform duration-700 group-hover:scale-[1.03]',
            imgClassName,
          )}
        />
      ) : (
        placeholder ?? <NoPhotoPlaceholder size={placeholderSize} />
      )}
      {overlay}
    </div>
  );
};
