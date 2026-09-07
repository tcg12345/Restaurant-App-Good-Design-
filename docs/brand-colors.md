# GoodEats brand colors

Selected September 6, 2026: Forest in light mode, Mint in dark mode.

| Role | Light | Dark |
| --- | --- | --- |
| Primary accent | Forest `#2E6651` | Mint `#A8D0B8` |
| Text on a filled accent | White `#FFFFFF` | Charcoal `#1E2228` |
| Soft selection fill | `#E9F1EC` | `#293B32` |
| Page | `#F8F8F8` | `#18191B` |
| Card | `#FFFFFF` | `#232629` |

`src/index.css` owns the endpoints (`--brand-forest`, `--brand-mint`) and active semantic tokens (`--brand-accent`, `--brand-on-accent`, `--brand-soft`). Tailwind's primary/accent/tint/recipe tokens and component-specific accent aliases all resolve to these values. Filled controls use the matching foreground, not an unconditional white label. Neutral secondary controls and navigation can remain neutral.

Home, onboarding, settings, taste preferences, restaurant/recipe discovery and details, creators, profile/social surfaces, group decisions, AI, and filters share this palette. Always-dark Pro, cooking, and review experiences use the Mint endpoint regardless of the surrounding theme. Review exports use the same Mint accent with their period-specific backgrounds and layouts.

Native iOS `GlassTabBar.primary` and `onPrimary` in `ios/App/App/MainViewController.swift` use the matching dynamic UIColor values. Tab glyphs retain their existing neutral treatment; selection is indicated by the native platter.

Score tiers, Michelin branding, destructive actions, warning/success states, and user-authored guide themes have their own meaning and are not brand accents. Photos and content artwork also retain their colors.

## Validation

- Filled-button text contrast: Forest/white 6.70:1; Mint/charcoal 9.42:1.
- Accent text on soft selections: light 5.82:1; dark 7.01:1.
- Home and taste settings inspected in both themes; Home checked at an iPhone-sized 393 × 852 viewport.
- TypeScript and production build passed; 1,013 tests across 70 test files passed.
- Native iOS Simulator build passed with signing disabled.
