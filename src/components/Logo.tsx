import React from 'react';

/**
 * The GoodEats mark — a bowl.
 *
 * A rim and a tapered vessel, which is also a smile: "Eats" and "Good" in
 * one shape. It replaced an italic serif "G" that only ever meant Gourmet
 * Canvas, and it is drawn rather than set in type so it survives the places
 * a font can't follow — a 16px favicon, a 1024px app icon, and the native
 * layer, none of which load the page's webfonts.
 *
 * Geometry lives here ONCE. Every other size is this same 100×100 viewBox
 * scaled, so the badge in the header, the icon on the home screen, and the
 * favicon can never drift apart. `public/logo.svg` and the app icons are
 * generated from the same path data (scripts/generate-icons.mjs).
 */

/** The mark itself, on a 100×100 viewBox. `on` is the colour it draws in. */
const bowl = (on: string) => (
  <>
    {/* The rim, floating just clear of the vessel — the gap is what keeps
        the two shapes reading as a bowl seen slightly from above rather
        than as one solid blob at small sizes. */}
    <rect x="23" y="40" width="54" height="6.5" rx="3.25" fill={on} />
    <path d="M28 52 Q50 75 72 52 Z" fill={on} />
  </>
);

export const Logo: React.FC<{
  /** Rendered box in px. */
  size?: number;
  /**
   * `badge` — the mark reversed out of a filled disc, which is the app's
   *   primary lockup (it inherits `currentColor`, so put `text-primary` on
   *   it and dark mode follows the token).
   * `tint` — the same disc at 12% and the bowl in full colour, for resting
   *   states where a saturated disc would shout: the profile-load error,
   *   empty states.
   * `mark` — just the bowl in `currentColor`, for when it already sits on
   *   a coloured ground and a second disc would be a disc on a disc.
   */
  variant?: 'badge' | 'tint' | 'mark';
  className?: string;
  /** For the callers that tint the disc with something other than
   *  `--color-primary` (onboarding runs on `--ob-terra`) or add a shadow. */
  style?: React.CSSProperties;
  /** Decorative by default: these sit beside a wordmark or a labelled
   *  control far more often than they stand in for one. */
  title?: string;
}> = ({ size = 40, variant = 'badge', className, style, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    className={className}
    style={style}
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    focusable="false"
  >
    {title && <title>{title}</title>}
    {variant === 'badge' && (
      <>
        <circle cx="50" cy="50" r="48" fill="currentColor" />
        {bowl('#fff')}
      </>
    )}
    {variant === 'tint' && (
      <>
        <circle cx="50" cy="50" r="48" fill="currentColor" opacity="0.12" />
        {bowl('currentColor')}
      </>
    )}
    {variant === 'mark' && bowl('currentColor')}
  </svg>
);

/**
 * The mark as a standalone markup string, for the two places that cannot
 * import a React component: the pre-mount crash screen (which runs before
 * the bundle is guaranteed) and the generated icon/asset files. Colours are
 * literal here on purpose — no tokens, no webfont, nothing to load.
 */
export const LOGO_SVG_MARKUP = (fill = '#9f3012'): string =>
  `<svg width="100%" height="100%" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`
  + `<circle cx="50" cy="50" r="48" fill="${fill}"/>`
  + `<rect x="23" y="40" width="54" height="6.5" rx="3.25" fill="#fff"/>`
  + `<path d="M28 52 Q50 75 72 52 Z" fill="#fff"/>`
  + `</svg>`;
