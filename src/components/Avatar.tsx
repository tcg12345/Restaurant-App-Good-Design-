import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

/**
 * A user's avatar: their uploaded photo when they have one, otherwise the
 * generated monogram this app has always drawn — the first letter of the
 * display name over a tint.
 *
 * The fallback is not just a placeholder for the loading state. Most users
 * never upload a photo, so the monogram is the avatar for them, and it has
 * to look composed rather than like an image that failed. It also takes
 * over when a stored URL 404s (a deleted Storage object, an old row
 * pointing at a bucket that was cleared), which is why `broken` exists —
 * without it those rows would render as the browser's broken-image glyph.
 */
export const Avatar: React.FC<{
  /** Public URL of the profile photo; null/undefined → monogram. */
  src?: string | null;
  /** Display name — supplies the monogram letter. */
  name: string;
  /** Rendered size in px (square). */
  size: number;
  /** Font size for the monogram letter; defaults to ~40% of `size`. */
  letterSize?: number;
  className?: string;
  /** Tint classes for the monogram. Defaults to the app's primary wash. */
  fallbackClassName?: string;
  /** Inline tint for the monogram — for the hue-per-user monograms
   *  (lib/avatar.avatarHue) that classes can't express. */
  fallbackStyle?: React.CSSProperties;
}> = ({ src, name, size, letterSize, className, fallbackClassName, fallbackStyle }) => {
  const [broken, setBroken] = useState(false);
  // A fresh upload replaces the URL; clear the error latch so the new one
  // gets its own chance to load.
  useEffect(() => { setBroken(false); }, [src]);

  const showPhoto = !!src && !broken;

  return (
    <div
      className={cn(
        'rounded-full overflow-hidden flex items-center justify-center flex-none',
        !showPhoto && !fallbackStyle && (fallbackClassName || 'bg-primary/[0.12]'),
        className,
      )}
      style={{ width: size, height: size, ...(!showPhoto ? fallbackStyle : undefined) }}
    >
      {showPhoto ? (
        <img
          src={src!}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className={cn(!fallbackClassName && !fallbackStyle && 'text-primary')}
          style={{
            fontSize: letterSize ?? Math.round(size * 0.4),
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.03em',
          }}
        >
          {(name.trim().charAt(0) || 'U').toUpperCase()}
        </span>
      )}
    </div>
  );
};
