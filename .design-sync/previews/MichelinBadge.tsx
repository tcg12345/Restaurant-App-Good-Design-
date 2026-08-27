import React from 'react';
import { MichelinBadge } from 'gourmet-canvas';

type Mich = React.ComponentProps<typeof MichelinBadge>['michelin'];

const mich = (over: Record<string, unknown> & { name: string; city: string }): Mich => ({
  country: 'USA',
  stars: 0,
  bibGourmand: false,
  selected: false,
  greenStar: false,
  guideUrl: 'https://guide.michelin.com/',
  ...over,
} as unknown as Mich);

const THREE = mich({ name: 'Le Bernardin', city: 'New York', stars: 3 });
const TWO = mich({ name: 'Atomix', city: 'New York', stars: 2 });
const ONE = mich({ name: 'Cote', city: 'New York', stars: 1 });
const BIB = mich({ name: 'Nixta Taqueria', city: 'Austin', bibGourmand: true });
const SELECTED = mich({ name: 'Odd Duck', city: 'Austin', selected: true });
const GREEN = mich({ name: 'Blue Hill at Stone Barns', city: 'Pocantico Hills', stars: 1, greenStar: true });

/** The full distinction pill: red glyph(s) plus the wordmark, in a rounded
 *  outline tinted from `var(--michelin-red)` (9% fill, 30% border). Stars get
 *  one filled star per award beside "MICHELIN"; Bib Gourmand gets a soup bowl
 *  beside "BIB GOURMAND"; Selected gets utensils beside "MICHELIN SELECTED".
 *  For the compact glyph-only mark on a dense card row, use `MichelinMark`. */
export const Distinctions = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
    {[THREE, TWO, ONE, BIB, SELECTED].map((m, i) => (
      <MichelinBadge key={i} michelin={m} size="sm" />
    ))}
  </div>
);

/** `sm` is the compact inline pill for the mobile restaurant header; `md` is
 *  the roomier desktop one — a larger glyph, a slightly larger wordmark and
 *  a wider gap. The pill's padding and radius do not change between them. */
export const Sizes = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    {(['sm', 'md'] as const).map((size) => (
      <div key={size} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 28, fontSize: 11.5, fontWeight: 600, opacity: 0.45 }}>{size}</span>
        <MichelinBadge michelin={THREE} size={size} />
        <MichelinBadge michelin={BIB} size={size} />
      </div>
    ))}
  </div>
);

/** With `href` the pill becomes an anchor to the restaurant's Michelin Guide
 *  page and grows a trailing external-link glyph at 60% red. Without it, it
 *  is a static label — which is what cards use, since the whole card is
 *  already a link and a nested anchor would be its own tap target. */
export const AsALink = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    {[
      ['static (no href)', undefined],
      ['linked (href set)', 'https://guide.michelin.com/'],
    ].map(([label, href]) => (
      <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 108, fontSize: 11.5, fontWeight: 600, opacity: 0.45 }}>{label as string}</span>
        <MichelinBadge michelin={ONE} size="md" href={href as string | undefined} />
      </div>
    ))}
  </div>
);

/** A Michelin Green Star (sustainability) appends a green leaf inside the
 *  same pill, after the wordmark and before the external-link glyph. It
 *  stacks on any distinction — most often a starred one. NOTE: `greenStar`
 *  is a real field on MichelinInfo and is rendered here, but it is missing
 *  from the design system's declared prop shape. */
export const GreenStar = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <MichelinBadge michelin={GREEN} size="md" />
    <MichelinBadge michelin={GREEN} size="md" href="https://guide.michelin.com/" />
  </div>
);

/** In the restaurant header it was drawn for — under the name, on the line
 *  that carries the place's credentials. */
export const InARestaurantHeader = () => (
  <div style={{ width: 360 }}>
    <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
      Le Bernardin
    </h3>
    <p style={{ fontSize: 13, opacity: 0.55, marginTop: 5 }}>Seafood · $$$$ · Midtown, New York</p>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
      <MichelinBadge michelin={THREE} size="sm" href="https://guide.michelin.com/" />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 9999,
          background: 'color-mix(in srgb, var(--color-on-surface) 6%, transparent)',
          opacity: 0.8,
        }}
      >
        Open until 10:30 PM
      </span>
    </div>
  </div>
);
