import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';

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
 */
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
}> = ({
  value, onChange, placeholder = 'Search',
  variant = 'plain', autoFocus, inputRef, onSubmit, onFocus, onBlur,
  className, 'aria-label': ariaLabel, readOnly, onPress,
}) => (
  <label
    className={cn('ios-search', variant === 'floating' && 'is-floating', readOnly && 'is-button', className)}
    onClick={readOnly ? onPress : undefined}
  >
    {/* Heavier than lucide's default hairline so it reads at SF Symbols
        weight beside 17px text. */}
    <Search className="ios-search-icon" size={17} strokeWidth={2.4} aria-hidden />
    <input
      ref={inputRef}
      type="text"
      inputMode="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      // Blur before navigating so the keyboard never flashes up on the
      // page you are leaving.
      onFocus={readOnly ? (e) => { e.currentTarget.blur(); onPress?.(); } : onFocus}
      onBlur={onBlur}
      onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) { e.preventDefault(); onSubmit(); } }}
      placeholder={placeholder}
      aria-label={ariaLabel || placeholder}
      autoFocus={autoFocus}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      className="ios-search-input"
    />
    {value && !readOnly && (
      /* Filled, not outlined — the system's clear glyph is a solid disc,
         and an outlined × at this size reads as a close button for the
         thing behind the field. */
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
