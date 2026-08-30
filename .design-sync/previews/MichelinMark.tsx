import React from 'react';
import { MichelinMark } from 'goodeats';

type Mich = React.ComponentProps<typeof MichelinMark>['michelin'];

const mich = (over: Partial<Mich> & { name: string; city: string }): Mich => ({
  country: 'USA',
  stars: 0,
  bibGourmand: false,
  selected: false,
  ...over,
} as Mich);

const CASES: Array<[string, Mich]> = [
  ['3 stars', mich({ name: 'Le Bernardin', city: 'New York', stars: 3 })],
  ['2 stars', mich({ name: 'Atomix', city: 'New York', stars: 2 })],
  ['1 star', mich({ name: 'Cote', city: 'New York', stars: 1 })],
  ['Bib Gourmand', mich({ name: 'Nixta Taqueria', city: 'Austin', bibGourmand: true })],
  ['Selected', mich({ name: 'Odd Duck', city: 'Austin', selected: true })],
];

/** The label-less distinction mark for dense rows: red glyphs only, no
 *  wordmark. One filled star per award, a soup bowl for Bib Gourmand,
 *  utensils for Selected. The red is `var(--michelin-red)` (#a2191f light,
 *  lifted to #f0655b in dark mode) — never a hardcoded hex. For the full
 *  pill with the MICHELIN wordmark, use `MichelinBadge` instead. */
export const Distinctions = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {CASES.map(([label, m]) => (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 96, fontSize: 11.5, fontWeight: 600, opacity: 0.45 }}>{label}</span>
        <MichelinMark michelin={m} size={13} />
      </div>
    ))}
  </div>
);

/** `size` is the px box of one glyph. Call sites run 11–13: 11 on the
 *  discover grid's meta line, 12 on the standard cuisine line, 13 default. */
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
    {[11, 12, 13, 16].map((size) => (
      <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <MichelinMark michelin={CASES[0][1]} size={size} />
        <span style={{ fontSize: 10.5, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>{size}</span>
      </div>
    ))}
  </div>
);

/** Where it actually goes: trailing the "Cuisine · $$" line under a card
 *  name, at size 12, wrapped in `align-middle` so it sits on the text's
 *  optical center. The app only passes it while a Michelin filter is
 *  active — it is a filter confirmation, not a permanent card ornament. */
export const OnACuisineLine = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 320 }}>
    {[
      ['Seafood', '$$$$', CASES[0][1]],
      ['Korean', '$$$', CASES[2][1]],
      ['Mexican', '$$', CASES[3][1]],
    ].map(([cuisine, price, m], i) => (
      <p key={i} style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.62 }}>
        {cuisine as string}
        <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
        {price as string}
        <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
          <MichelinMark michelin={m as Mich} size={12} />
        </span>
      </p>
    ))}
  </div>
);

/** In the card list it was drawn for. At 12px the glyphs read as a texture on
 *  the meta line rather than competing with the restaurant name above them. */
export const InACardList = () => (
  <div style={{ display: 'flex', flexDirection: 'column', width: 340 }}>
    {[
      ['Le Bernardin', 'Seafood', '$$$$', CASES[0][1]],
      ['Atomix', 'Korean', '$$$$', CASES[1][1]],
      ['Nixta Taqueria', 'Mexican', '$$', CASES[3][1]],
      ['Odd Duck', 'American', '$$$', CASES[4][1]],
    ].map(([name, cuisine, price, m], i) => (
      <div
        key={name as string}
        style={{
          padding: '11px 4px',
          borderTop: i > 0 ? '1px solid color-mix(in srgb, var(--color-on-surface) 9%, transparent)' : undefined,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15 }}>{name as string}</div>
        <p style={{ fontSize: 12.5, fontWeight: 500, opacity: 0.62, marginTop: 3 }}>
          {cuisine as string}
          <span style={{ margin: '0 6px', opacity: 0.4 }}>·</span>
          {price as string}
          <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
            <MichelinMark michelin={m as Mich} size={12} />
          </span>
        </p>
      </div>
    ))}
  </div>
);
