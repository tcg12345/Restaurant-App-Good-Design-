import React from 'react';

/**
 * The app's one "share" glyph — a paper plane, not lucide's `Share2` network
 * icon. Kept as a standalone component (rather than a lucide export) so
 * every share trigger in the app draws the exact same mark; the native glass
 * buttons draw the same path natively (see `AppGlyph.paperPlane` in
 * MainViewController.swift) so the native lens and this CSS fallback match.
 */
export const ShareIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number | string }> = ({
  size = 24,
  strokeWidth = 2,
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M20.8 3.2 10.4 13.6" />
    <path d="M20.8 3.2 14.3 20.8 10.4 13.6 3.2 9.4Z" />
  </svg>
);
