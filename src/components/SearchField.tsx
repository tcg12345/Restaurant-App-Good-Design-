import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useGlassField } from '../lib/glass-buttons';

/**
 * The app's search field.
 *
 * There were forty-nine search inputs across twenty-five files and no
 * shared component — six heights, five text sizes, five icon sizes, four
 * radii, three fill tokens, one with a 2px border, one with a focus ring
 * and most with none. The variation wasn't expressing anything; it was
 * drift.
 *
 * The look is iOS, not Material: a translucent *material* layered over
 * whatever is behind it, never an opaque fill on a drop shadow. Two
 * variants, because two contexts genuinely differ —
 *
 *  - `plain` sits in a list on the page's own ground, so it can be nearly
 *    transparent (12% / 24% of the system grey) and let the ground read
 *    through it.
 *  - `floating` sits over the map, where 12% of anything is illegible over
 *    a satellite tile, so the material carries its own near-opaque base.
 *
 * 17px is not a style choice: under 16px iOS zooms the viewport on focus.
 *
 * With a `glassId`, on iOS 26 the field stops being CSS at all: the native
 * layer draws a real `UIGlassEffect` capsule with a real `UITextField` on it
 * over this element's box, and this markup becomes the layout it is measured
 * from plus the fallback everywhere else — the same handover every glass
 * button makes, extended to typing. See `useGlassField`.
 */
/** Width for a read-only field worn as a CHIP (the location chips): glyph
 *  gutter (40) + the label at the field's 17px type + trailing inset (15)
 *  and a hair of slack. Measured on a canvas in the system stack — the
 *  native field sets SF at 17, and `-apple-system` IS SF in WebKit — so
 *  the box hugs the label instead of guessing. DOM rulers were tried and
 *  lied twice: a block span measures its container, and the fallback
 *  input's intrinsic ~20ch width inflates any shrink-to-fit wrapper. */
let chipCtx: CanvasRenderingContext2D | null = null;
export function searchFieldChipWidth(label: string): number {
  if (!chipCtx) {
    chipCtx = document.createElement('canvas').getContext('2d');
    if (chipCtx) chipCtx.font = '17px -apple-system, BlinkMacSystemFont, Manrope, sans-serif';
  }
  const text = chipCtx ? chipCtx.measureText(label).width : label.length * 8.6;
  return Math.ceil(40 + text + 17);
}

export const SearchField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** `plain` in a list, `floating` over the map. */
  variant?: 'plain' | 'floating';
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Enter submits — the Search tab runs a query rather than filtering. */
  onSubmit?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  'aria-label'?: string;
  /** A field that is really a button: tapping it goes somewhere that has a
   *  real one. Keeps the material and the metrics so the two read as the
   *  same object across the transition. */
  readOnly?: boolean;
  onPress?: () => void;
  /** Set to let the native glass layer take the field over on iOS 26. */
  glassId?: string;
  /** A touch taller — the map chrome's primary field. */
  tall?: boolean;
  /** SF Symbol for the native field's leading glyph (default magnifier). */
  glassSymbol?: string;
  /** Web leading icon to match `glassSymbol` (default the magnifier). */
  leadingIcon?: React.ReactNode;
}> = ({
  value, onChange, placeholder = 'Search',
  variant = 'plain', autoFocus, inputRef, onSubmit, onFocus, onBlur,
  className, 'aria-label': ariaLabel, readOnly, onPress, glassId, tall,
  glassSymbol, leadingIcon,
}) => {
  const glass = useGlassField({
    id: glassId,
    value,
    placeholder,
    editable: !readOnly,
    label: ariaLabel || placeholder,
    onChange,
    onSubmit,
    onPress,
    autoFocus,
    symbol: glassSymbol,
  });
  const native = glass.active;
  return (
    <label
      ref={glass.ref}
      className={cn('ios-search', variant === 'floating' && 'is-floating', readOnly && 'is-button', tall && 'is-tall', className)}
      onClick={readOnly && !native ? onPress : undefined}
      // While native owns the field, the CSS material must go — the glass
      // samples the page through itself, and a translucent grey fill left
      // under it reads as a smudge inside the lens. The box stays: it is
      // what the native mirror measures.
      style={native ? {
        backgroundColor: 'transparent',
        boxShadow: 'none',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
      } : undefined}
    >
      {/* Heavier than lucide's default hairline so it reads at SF Symbols
          weight beside 17px text. */}
      {leadingIcon ? (
        <span className={cn('ios-search-icon', native && 'opacity-0')} aria-hidden>{leadingIcon}</span>
      ) : (
        <Search className={cn('ios-search-icon', native && 'opacity-0')} size={17} strokeWidth={2.4} aria-hidden />
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Read-only while native owns it too: the UIKit field above takes
        // every touch, but if a focus ever lands here anyway it must not
        // raise a second, WebView keyboard under the native one.
        readOnly={readOnly || native}
        // Blur before navigating so the keyboard never flashes up on the
        // page you are leaving.
        onFocus={readOnly && !native ? (e) => { e.currentTarget.blur(); onPress?.(); } : onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(); } }}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        aria-hidden={native || undefined}
        tabIndex={native ? -1 : undefined}
        autoFocus={autoFocus && !native}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className={cn('ios-search-input', native && 'opacity-0')}
      />
      {value && !readOnly && !native && (
        /* Filled, not outlined — the system's clear glyph is a solid disc,
           and an outlined × at this size reads as a close button for the
           thing behind the field. The native field draws the system's own. */
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="ios-search-clear"
        >
          <X size={11} strokeWidth={3} />
        </button>
      )}
    </label>
  );
};
