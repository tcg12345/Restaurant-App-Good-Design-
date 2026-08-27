# design-sync notes — gourmet-canvas

## What this repo is

An **application**, not a published component library: `private: true`, no
`main`/`module`/`exports`, no library build, and `dist/` is a built app (one
hashed JS bundle + `index.html`). There is no Storybook and no story files, so
this runs the **package** shape with authored previews.

## Setup that is NOT the converter's happy path

- **`.design-sync/entry.tsx` is the DS entry** and is committed. There is no
  `dist` entry to point `--entry` at, so this barrel names exactly the 31
  components that make up the visual system. It also fixes `PKG_DIR`: without
  `--entry` the converter looks for `node_modules/gourmet-canvas/package.json`,
  which never exists in a repo that isn't self-installed (the first run died
  there with ENOENT).
- **Build command:**
  ```sh
  node .ds-sync/package-build.mjs --config .design-sync/config.json \
    --node-modules ./node_modules --entry ./.design-sync/entry.tsx --out ./ds-bundle
  node .ds-sync/package-validate.mjs ./ds-bundle
  ```
  Run from the repo root. (The shell's cwd persists between commands — after
  `cd .ds-sync && npm i`, `cd` back or the next `node .ds-sync/...` resolves to
  `.ds-sync/.ds-sync/...`.)
- **`cfg.cssEntry` is `.design-sync/app.css`, which is generated and
  gitignored.** Tailwind v4 compiles at app-build time and Vite content-hashes
  the filename, so the real stylesheet is `dist/assets/index-<hash>.css` and the
  hash moves every build. Before each converter run:
  ```sh
  npm run build && cp "$(ls -t dist/assets/index-*.css | head -1)" .design-sync/app.css
  ```
  Point `cssEntry` at the hashed path directly and it rots on the next build.

## Why `dtsPropsFor` is hand-written for all 31

`@types/react` is **not installed in this repo at all** (React 19 with no types
package; the app still typechecks). Without it the converter's ts-morph pass
resolves every prop to `any` and emits `[key: string]: unknown` bodies — i.e. a
useless API contract for the design agent.

**Do not "fix" this by adding `@types/react` to the repo.** It was tried:
symlinking it in immediately broke `npx tsc --noEmit` with real errors
(`AppErrorBoundary cannot be used as a JSX component`, `SetStateAction<HomeMeal>`
mismatches) because the app has never been typechecked against real React types.
The symlink was reverted and the typecheck confirmed clean again.

Instead every prop body is written out in `cfg.dtsPropsFor`, extracted from the
component sources with their JSDoc, and with referenced types
(`GlassButtonSpec`, `MichelinInfo`, `DropdownOption`, `HoursFilter`,
`CardAction`, `LoadingSkeletonVariant`, the four `*Props` interfaces) **inlined**
so each emitted `.d.ts` stands alone. These are better contracts than
auto-extraction would have produced, but they are hand-maintained: **a prop
added to a component in `src/` will not appear in the DS until `dtsPropsFor` is
updated.** That is the main re-sync risk here.

## Known render warns (benign — triaged, do not re-chase)

- **`[TOKENS_MISSING]` `--gle-*` (11 properties)** — glass-effect tokens set at
  runtime as inline styles by `src/components/guide/GuideRender.tsx:141`. Its
  stylesheet rides along in the app-wide CSS, but `GuideRender` is not one of
  the 31 synced components, so nothing shipped reads them.
- **`[FONT_MISSING]` "Source Serif Pro"** — not actually missing. It is the
  second name in the fallback stack
  `'Source Serif 4', 'Source Serif Pro', Georgia, serif`
  (`RecipePage.css`, `LocationPage.css`, `RecipesForYou.css`,
  `AdvancedRecipeBuilder.css`). `Source Serif 4` is the primary and **does**
  ship. Nothing to fix.

## Scope decision

`src/components/onboarding/**` is **deliberately excluded** (user's call): the
cream/terracotta `OnboardingKit` is one flow's styling, not the app's design
language. That is 18 components plus `PreAuthFlow`/`TasteSteps`/`ImportStep`.
The app-wide stylesheet still carries the `--ob-*` tokens harmlessly.

Also excluded by construction: 56 of the 76 files in `src/components/` reach
into `ListsContext` / `AuthContext` / react-router / Supabase and cannot render
standalone.

`ScoreBadge` / `OwnScoreBadge` / `ScoreRing` **can** ship despite reading
`useSettings`, because `SettingsContext` is created with a complete default
value, so the hook returns defaults outside a provider instead of throwing.
(`useLists` **does** throw — anything importing it is out of scope. Note the
`useLists` mentions in `ScoreBadge.tsx` / `ScoreRing.tsx` are comments only.)

## Preview-authoring learnings (from the solo calibration set)

- **Preview JSDoc lands in `<Name>.prompt.md`, which the design agent reads as
  usage guidance — so it must be factually checked, not written from memory.**
  The first `ScoreBadge.tsx` claimed "terracotta / olive / clay" at 7+/4-6.9/<4.
  The real scale (`src/lib/score.ts`) is three tiers by hex:
  `high >= 8` green `#2E7D5C`, `mid >= 5` amber `#C28F3A`, `low < 5` red
  `#A8392A`. Verify any color/threshold claim against source before shipping it.
- **Glass components: most props are native-only and render NOTHING in a
  browser.** `GlassButton`'s web fallback (glass-buttons.tsx:392-421) emits only
  the caller's `className` plus its own `.glass-control` class and `children`.
  `symbol`, `title`, `titleStyle`, `prominent`, `tint`, `badge` go to the native
  registry and are invisible in previews — a first attempt at a `prominent` cell
  rendered an empty white pill (white text on untinted glass). Only
  `GlassChipRow` has a fallback accent class (`is-accent`, line 596).
  Corollary: **show glass over a colored ground**, never over white — the frost
  samples what's behind it, so on white it is nearly invisible.
- Realistic app content (real restaurant names, real empty-state copy) grades
  well and reads correctly in the picker. `lucide-react` icons resolve fine in
  previews; Tailwind utility classes AND inline styles both work.
- Import from `'gourmet-canvas'` in previews — the converter's story-import
  plugin maps it to `window.GourmetCanvas`.

## Preview-authoring learnings (from the four-batch wave, all 31 components)

- **The capture harness pins the page clock to 2024-05-15T12:00Z**
  (`package-capture.mjs` ~line 102, `page.clock.setFixedTime`). Two silent
  consequences — capture reports `0 errors` either way:
  1. **motion/react animations never settle.** `Date.now()` freezes while
     rAF advances, so WAAPI `startTime` lands in the future and every
     `motion` element photographs at its `initial` values (a sheet with
     `initial={{y:'100%'}}` shoots blank; a menu with `opacity: 0` shoots as
     just its scrim). It compounds across a run on the reused page.
     Preview workaround: a `<style>` block force-pinning the settled state
     with `!important` (important-author beats animations in the cascade —
     deterministic, no frame race). The real fix belongs in the harness:
     drop `setFixedTime`, or `document.getAnimations().forEach(a=>a.finish())`
     in `settle()`. Every future preview of a bottom sheet / modal /
     `AnimatePresence` consumer needs the pin until then. CSS-driven motion
     (`Collapse`'s grid-rows transition, `animate-pulse`) is unaffected.
  2. **"Today" is 2024-05-15** for anything date-gated. `Calendar` disables
     future days, so 2026 fixture dates rendered every day greyed out.
     Any now-gated fixture (dates, relative timestamps, open-now hours) must
     use values on or before 2024-05-15.
- **The prompt extractor keeps only text from the first `export const` onward**
  (`lib/docs.mjs:276`). File-header JSDoc, imports, and module-level consts
  are dropped from `<Name>.prompt.md` — so must-not-miss guidance goes as a
  comment INSIDE the first export's body, and examples must not reference
  module-level consts (the shipped snippet would cite undefined identifiers).
  A JSDoc block between two exports survives, but lands as trailing text in
  the PREVIOUS example's fence. Cleaner fix if ever touching `docs.mjs`:
  capture the header as a `## Notes` block.
- **Group comes from the source directory, not config**: `ScoreRing` (in
  `src/components/cards/`) emits to group `cards`, sheet
  `cards__ScoreRing.png`. Everything else is `general` today; any nested
  component added later will do the same.
- **Previews are esbuild-transpiled, never typechecked** — extra object
  properties beyond the `.d.ts` are fine at runtime (how `greenStar` got
  covered before the contract fix). But **only Tailwind classes already in
  the prebuilt `app.css` work** — Tailwind v4 scanned `src/` at app-build
  time and never saw `.design-sync/previews/`, so a novel arbitrary variant
  silently no-ops. Reuse app classes or inline styles.
- **Sheets render on a white ground** — near-white subjects (skeleton pulse,
  `.ios-search.is-floating`, glass, dark variants) need their own ground or
  a visible ring. The capture is offline: CSS gradients only, no remote
  images; `data:image/svg+xml` URIs work as image stand-ins.
- **`.ds-single` carries `transform: translateZ(0)`**, making the solo render
  a containing block for `position: fixed` — an overlay with no in-flow
  content collapses `#r0` to 0px, so overlay previews need a sized stage
  (the wheel-picker cells use a 620×540 stage with its own `translateZ(0)`).
  Portals to `document.body` escape it (why `CardActionMenu` is
  `cardMode: single`).
- **Row-shaped primitives photograph as short wide strips** — that's correct,
  not broken. Filter cells wrap in `{width:'100%', maxWidth:440}` (the real
  sheet column is 346–516px); pure wrappers (`Segment`) need children to
  show anything; stateful controls hold real `useState` and start selected.
- **`GlassGroup` takes its parent's width** — every real call site puts it in
  a flex row (`justify-between`/`justify-end`); previews and design-agent
  compositions need the same or it stretches into a broken-looking bar.

## Source facts worth not re-deriving (verified against src/ this sync)

- **Two tier systems on scores, deliberately**: numeric tint uses
  `lib/score.ts` (`high ≥8` / `mid ≥5` / `low <5`); the LOCKED sentiment dot
  in `OwnScoreBadge`/`ScoreRing` uses `settleScores.tierOfScore`
  (`≥6.995` / `≥3.995`). A 7.1 is amber unlocked, green locked. Both files
  duplicate `tierDotHex` verbatim; source JSDoc calling the locked state a
  "sentiment emoji" is stale (it's a colored dot).
- `FilterOptionList.multiple` is dead (destructured, never read);
  `FilterDrillSection.multiple` only picks the sub-page subtitle string.
  Single-select is entirely the caller's `onToggle`.
- `tone="teal"` on `Pill`/`Segment` has no call site in `src/` — CSS reserves
  it for Discover's hotels mode. Available accent, not an established pattern.
- The wheel pickers (`TimeWheelPicker`/`NumberWheelPicker`) have no call
  sites in `src/` today; their preview compositions are invented-but-plausible.
- Filter primitives render correctly OUTSIDE `.fs-overlay` (Tailwind
  preflight already resets buttons); caller-owned markup
  (`.fs-slider-range` captions, `.fs-optionlist-rows` padding) is part of
  the shipped look and previews include it.

## Entry-surface candidates for a future sync (not added this run)

- **`FilterSheetNavContext`** (`src/components/FilterSheet.tsx:76`) — not
  exported, so `FilterDrillRow`/`FilterDrillSection`/`HoursFilterSection`
  previews can only show the ROW; the portal'd sub-page needs a provider
  with a real `container`. Current previews work around it (the page BODY is
  shown on `FilterOptionList` / `FilterCheckRow.HoursPage`, and each
  affected JSDoc says where to look). Exporting it (or a `FilterSheetShell`)
  unlocks the true open state.
- **`MichelinDrillSection`** (`src/components/MichelinDistinctionFilter.tsx`)
  — the canonical drill composition, in every filter sheet, not in the DS.
- **`searchFieldChipWidth`** (exported from `SearchField.tsx`, not from the
  barrel) — the app's real location-chip measurement; previews hardcode 108px.
- A `.dark` wrapper cell for glass (`.dark .glass-control` / `.dark .map-chip`
  have real overrides nothing previews), and `prefers-reduced-transparency`.

## Card layout overrides (cfg.overrides) — why each exists

`package-validate.mjs` flags `[GRID_OVERFLOW]` when a story is wider than the
product card's `minmax(320px, 1fr)` grid track. 14 components carry an
override; **do not remove them without re-running validate**:

- `cardMode: "column"` (11) — ScoreRing, Avatar, Calendar, Collapse,
  LoadingSkeleton, LoadingSkeletonList, MichelinBadge, MichelinMark,
  OwnScoreBadge, SearchField, VerifiedBadge. Their in-context cells (a card
  row, a person row, running text) are legitimately wider than a grid track.
- `cardMode: "single"` (3) — CardActionMenu (portals to `document.body`),
  TimeWheelPicker, NumberWheelPicker (fixed overlays). These escape any grid
  by construction; `primaryStory` picks the cell the card shows.

The first full build after adding overrides must be `package-build.mjs` — a
targeted `preview-rebuild.mjs` refuses with `[CONFIG_STALE]` because the
full build is what re-stamps the grade keys.

## Re-sync risks

- **`dtsPropsFor` drift** (highest risk). Prop contracts are hand-written; they
  do not follow the source. On re-sync, diff each component's props against
  `src/` before trusting the emitted `.d.ts`.
- **`.design-sync/app.css` staleness.** Gitignored and regenerated from
  `dist/`. If `npm run build` is skipped, the DS ships the previous build's CSS
  with no warning.
- **`.design-sync/entry.tsx` is a manual allowlist.** New components added to
  the app do not appear in the DS until they are added there *and* to
  `componentSrcMap` *and* to `dtsPropsFor`.
- **Native glass.** `GlassButton`/`GlassGroup`/`GlassChipRow`/`GlassSurface`
  bridge to a native iOS 26 layer that does not exist in a browser; previews
  exercise the **web fallback** only. What the DS pane shows is not what the
  iOS build renders.
- **`conventions.md` is validated, not regenerated.** On re-sync, never
  rewrite it — re-check that every class, token, and prop it names still
  exists in the fresh build and report drift. It currently names:
  `bg-surface`/`bg-paper`/`bg-cream`/`bg-cream-2`/`bg-muted`,
  `text-on-surface`(+opacity)/`text-ink`/`text-primary`, `border-line`,
  `font-serif`/`font-display`/`font-sans`, the `--ease-*` and
  `--color-score-*` families, and the `ScoreBadge rating=` /
  `Avatar name+size` / full-`MichelinInfo` props in its snippet.
- **The capture clock is frozen at 2024-05-15** — see the wave learnings
  above. A component whose preview depends on "now" will silently shoot
  wrong, with no error.

## Upload facts (first sync, 2026-08-26)

- 205 content files + `_ds_sync.json` + `_ds_needs_recompile` = 207 remote.
  Deletes were empty (`upload.deletePaths: []`).
- **Exclude dot-prefixed root entries from the upload list.** A `find` that
  only filters `_screenshots/` still catches `.ds-bundle`, `.stories-map.json`,
  `.render-check.json` etc. Use `-not -path './.*'`.
- The server compiles `_ds_manifest.json` + `_adherence.oxlintrc.json`
  itself, on project open, triggered by the sentinel. Right after an upload
  the manifest can still show the PREVIOUS state (it showed `cards: 3` from
  the first batch while `components` already read 31) — that is the
  recompile pending, not a failed upload. Opening the project clears it.
