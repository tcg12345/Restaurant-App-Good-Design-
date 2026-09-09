# Home Reels + Friends tab experiment

Temporary, enabled locally for review. One switch owns the experiment:
`src/lib/home-reels-experiment.ts` → `HOME_REELS_EXPERIMENT`.

Set it to `false` to restore the original Reels tab in both browser and UIKit,
restore the sidebar Reels entry, remove the Home rail and feed insertions,
and restore the original fixed-height Home layout and gestures. Rebuild and
run `npx cap sync ios` to apply the rollback to installed iOS builds.
No migrations, account changes, deleted routes, or removed reel data.

Friends & Messages takes the center tab. Create sits at the top left,
Calendar and Notifications share one glass capsule at the top right, and
location has its own row beneath the controls. Conversation routes cover the
navbar; both social inbox tabs retain it. Home has a horizontal poster rail, and up to three playable reels
are spaced among feed rows. Posters avoid autoplay/network/video decoders
while browsing. A tap opens the existing focused full-screen viewer; Watch
all opens the full viewer with a Back button. Feed audience and Saved filters
apply; Highly rated remains reserved for scored posts. Empty/error/loading
states do not invent reel content.

Home scrolls beneath compact header controls. Search and location share a row,
followed by quick actions, the next-meal/getting-started card, Reels, and Guides.
Explore feed stays in a separate dock above the navbar, outside the scroll area.
A deliberate upward pull at the bottom opens the feed; a downward pull at the
Home top opens Search. A continuing touch scroll can reach an edge and then
pull another 64px to navigate. Each transition gives one haptic, respecting
the device preference. Wheel momentum cannot chain multiple transitions.
The feed retains its Back to Home button and downward return gesture.
Horizontal rails and normal scrolling through Guides keep working.

Design fixture: `/scripts/home-preview.html` uses explicitly fictional preview
reels with local images, never uploaded or added to real accounts.

Latest gesture validation: 12 focused Home component and gesture checks pass,
including edge thresholds, native-scroll pass-through, continued edge pulls,
search/feed callbacks, haptic counts, cancellation, and wheel momentum.
Physical-iPhone gesture and tactile review remains separate.

Feed navigation now uses Feed / Reels / Saved plus one filter button. Reels
opens the existing full-screen viewer; Feed and Saved switch the local lens.
A draft filter sheet groups audience (Your circle, Verified, Cooking) and
ordering (Latest, Highly rated), applies them together, and preserves Saved
when the audience changes. Cooking cannot select a score-based order. The
original two rows remain available when the experiment is disabled. Sixteen
focused feed/filter/gesture checks passed, with mobile toolbar and filter-panel
interaction also checked in the browser fixture.
