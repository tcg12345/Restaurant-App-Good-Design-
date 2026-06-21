import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

/**
 * The single source of truth for a card's outer chrome. It decides nothing
 * about content — only the *surface* it sits on — so the same interior markup
 * can render boxed on desktop and box-less on mobile.
 *
 *  - 'boxed'      desktop tiles/rows: white (paper) surface, hairline border,
 *                 rounded-2xl, subtle hover-lift. Uses the .card-surface utility
 *                 so the exact border/shadow values live in one place.
 *  - 'flat-row'   mobile hairline-divided rows: NO box; the parent container
 *                 owns the `divide-y`. Just press feedback.
 *  - 'photo-tile' immersive photo-forward tile: NO outer box (the photo carries
 *                 its own radius); shell is pure layout.
 *  - 'bare'       no chrome — caller paints everything.
 *
 * `as` keeps the interactive element in the caller's hands: most cards are a
 * react-router <Link> (`as='a'` + `to`), map rows are a <button>/<div> with an
 * onClick, and Pantry wraps the shell in its own <motion.div>. The shell never
 * assumes one.
 */
export type CardSurface = 'boxed' | 'flat-row' | 'photo-tile' | 'bare';

function surfaceClasses(surface: CardSurface, interactive: boolean): string {
  switch (surface) {
    case 'boxed':
      return cn('card-surface', interactive && 'card-surface-hover');
    case 'flat-row':
      return interactive ? 'transition-colors active:bg-on-surface/[0.05]' : '';
    case 'photo-tile':
    case 'bare':
    default:
      return '';
  }
}

interface CardShellProps {
  surface: CardSurface;
  as?: 'a' | 'button' | 'div';
  to?: string;
  onClick?: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className?: string;
  /** Disable the hover-lift (e.g. while a swipe drag is active). Default true. */
  interactive?: boolean;
  role?: string;
  tabIndex?: number;
  'aria-label'?: string;
  children: React.ReactNode;
}

export const CardShell: React.FC<CardShellProps> = ({
  surface,
  as = 'a',
  to,
  onClick,
  onKeyDown,
  className,
  interactive = true,
  role,
  tabIndex,
  children,
  ...aria
}) => {
  const cls = cn('group block', surfaceClasses(surface, interactive), className);

  if (as === 'a' && to) {
    return (
      <Link to={to} onClick={onClick} onKeyDown={onKeyDown} className={cls} role={role} tabIndex={tabIndex} {...aria}>
        {children}
      </Link>
    );
  }
  if (as === 'button') {
    return (
      <button type="button" onClick={onClick} onKeyDown={onKeyDown} className={cn('w-full text-left', cls)} {...aria}>
        {children}
      </button>
    );
  }
  return (
    <div onClick={onClick} onKeyDown={onKeyDown} className={cls} role={role} tabIndex={tabIndex} {...aria}>
      {children}
    </div>
  );
};
