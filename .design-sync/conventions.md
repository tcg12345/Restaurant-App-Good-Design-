# Building with Gourmet Canvas

These components come from a shipping restaurant/recipe app — warm editorial
look: serif display type, cream/terracotta palette, capsule-shaped controls.

## Setup — none

No provider or theme wrapper. Every component renders standalone; if something
looks unstyled, the cause is a missing class or token, never a missing
provider. Link `styles.css` (it `@import`s everything, including component
CSS) and use components from `window.GourmetCanvas`.

## Styling idiom: Tailwind utilities + CSS tokens

Layout glue is Tailwind v4 utility classes; the design language lives in CSS
custom properties. Use these real names (all verified in the shipped CSS):

| Concern | Vocabulary |
|---|---|
| Surfaces | `bg-surface` (white), `bg-paper`, `bg-cream`, `bg-cream-2`, `bg-muted` |
| Ink | `text-on-surface` (+ opacity variants like `text-on-surface/55`), `text-ink`, `text-primary` |
| Accent | `bg-primary` / `text-primary` — `--color-primary` is `#9f3012` terracotta (dark: `#d3623d`) |
| Lines | `border-line` |
| Type | `font-serif` (Noto Serif — headings), `font-display` (Fraunces — hero numerals), `font-sans` (Manrope — everything else) |
| Motion | `var(--ease-out)`, `var(--ease-out-strong)`, `var(--ease-drawer)` |
| Scores | `--color-score-high-*` / `-mid-*` / `-low-*` token families |

Idiom notes:
- Headings are serif; UI copy is Manrope with tight tracking. Primary actions
  are full-width terracotta capsules (`rounded-full bg-primary text-white`).
- There is no `text-muted` or `bg-danger` utility — muted text is
  `text-on-surface/55`-style opacity; danger is inline `#A8392A`-family reds.
- Score colors have hard meaning: green ≥ 8, amber ≥ 5, red < 5. Never remap.
- Glass components (`GlassButton`, `GlassGroup`, `GlassChipRow`) bridge to a
  native iOS layer. In the browser only `className`, `children`, and their
  `.glass-control` / `.map-chip` classes render — `symbol`, `title`,
  `prominent`, `tint`, `badge` are native-only (pass them anyway for device
  correctness). Always place glass over imagery or color, never plain white.
- Filter primitives (`Pill`, `Segment`, `FilterSection`, …) are controlled:
  hold selection state yourself and pass `onToggle`/`onSelect`. Sheet-style
  compositions read best at 346–516px content width.

## Where the truth lives

Read before styling: `styles.css` and its `@import`s (component CSS is in
`_ds_bundle.css`; tokens in `tokens/`). Per component:
`components/<group>/<Name>/<Name>.prompt.md` (usage + examples) and
`<Name>.d.ts` (the API). All components are in group `general` except
`ScoreRing` (group `cards`).

## An idiomatic composition

```jsx
const { ScoreBadge, MichelinMark, VerifiedBadge, Avatar } = window.GourmetCanvas;

<div className="bg-surface rounded-2xl border border-line p-4 flex items-center gap-3">
  <Avatar name="Tyler" size={40} />
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-1.5">
      <span className="font-serif text-[17px] font-bold text-on-surface truncate">Le Bernardin</span>
      <VerifiedBadge size={14} />
      <MichelinMark michelin={{ name: 'Le Bernardin', city: 'New York', country: 'USA',
        stars: 3, bibGourmand: false, selected: false, priceTier: 4,
        cuisine: 'Seafood', guideUrl: '#', greenStar: false, lat: 40.76, lng: -73.98 }} />
    </div>
    <div className="text-[13px] text-on-surface/55">Seafood · $$$$ · Midtown</div>
  </div>
  <ScoreBadge rating={9.2} size="lg" />
</div>
```
