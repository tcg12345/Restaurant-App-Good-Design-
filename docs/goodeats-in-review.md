# GoodEats in Review

Weekly, monthly, and annual stories are available at **Settings → GoodEats in Review** (`/settings/reviews`). The archive has period filters and an automatic-reveal switch. New stories open over Home after account onboarding and cloud hydration finish, waiting for other overlays to close. An unseen annual story takes priority over a monthly or weekly story; automatic presentation is limited to one per day in a running session, and viewed IDs persist between launches.

## Calendar and account data

- Weeks run Monday through Sunday. Months and years follow the local calendar. Only completed periods with recorded activity produce a review. Missing historical periods are backfilled in batches with an event-loop yield between stories.
- Visits use their recorded visit date, including retained visit history. A place/day is deduplicated, while revisits on different days remain separate. Editing or importing an old visit does not count as new activity today.
- Reviews include places rated, logged visits, home meals, recipes authored, wishlist additions, cuisines, new cuisines, cities, return intentions, favorite places and meals, and tagged dining companions where available. A meal-linked recipe is excluded from recipe counts to avoid counting the same creation twice.
- Numeric ratings obey the existing score-unlock rule. Slider grades are excluded from score comparisons. A period needs at least three scored places for its average/baseline.
- Each snapshot reflects available account data when generated and is then immutable. It is not a historical audit log of previously deleted records. Cuisine/address metadata and the current Michelin dataset may differ from the visit year.
- New snapshots wait for successful restaurant and recipe hydration. Failed requests preserve cached stories and show a reconnect message instead of freezing an incomplete review. Switching accounts cancels generation and checks archive ownership.

## Taste comparisons

The existing taste model supplies the rating anchor, price distribution and concentration, Michelin shares, and premium/breadth index. The existing `get_taste_benchmarks` RPC supplies actual community statistics. Its benchmarks describe **all-time published history**, not a period-specific cohort; story copy identifies this and records the capture date. Percentiles are hidden below 20 ranked members. Missing comparisons show an honest empty state. The premium/breadth index describes behavior and is not presented as a measure of taste quality.

Annual stories have a distinct midnight/gold treatment, twelve-month activity chart, geographic and cooking chapters when relevant, and an additional price/baseline/peer breakdown. That extra chapter uses the existing `taste-depth` entitlement and Pro sheet. Core chapters and image sharing stay available without Pro. The existing billing rollout flag continues to determine whether gates are enabled.

## Storage and sharing

Private snapshots, viewed IDs, and the reveal preference use `restaurant_meta.__goodeats_in_review_v1__` through the existing account-scoped local/cloud metadata sync. Hydration unions device archives and viewed IDs, preserves the earliest snapshot for a period, and resolves preference changes by timestamp. No migration or public table is required. This inherits the existing metadata sync's offline and concurrent-write behavior.

Sharing renders an explicit 1080×1920 PNG preview. It includes aggregate counts and top cuisine by default; a checkbox optionally includes the standout restaurant. Names, friends, account identifiers, and visit locations are not included by default. On iOS, the card is written to the Capacitor cache, passed to the system Share sheet, and cleaned up afterward. Web supports file sharing when available and PNG download otherwise. Nothing posts automatically. `@capacitor/filesystem` and its required file-timestamp privacy reason are included in the native project.

## Interaction and verification

Stories support swipe, previous/next controls, direct chapter selection, keyboard arrows, pause, focus containment, safe areas, and reduced motion. Autoplay pauses while hidden, sharing, displaying Pro, or on a locked/final chapter. The native tab bar uses the existing overlay registry to disappear while the viewer is open.

`scripts/in-review-preview.html` is a development-only visual fixture, explicitly labelled with fictional data. It is not an app entry point and never writes to an account. Use `VITE_PLAN_PREVIEW=free` on a development server to inspect the optional Pro chapter.

Verified in the browser at 393×852 and 320×568: annual and weekly layouts, chapter navigation, pause, dismissal/focus restoration, Settings archive, PNG preview, and the free-plan Pro sheet opening/dismissal. Native compilation verifies the Filesystem/Share integration; live-account automatic delivery, two-device sync, and the physical iOS share destination still need device acceptance testing.

Automated validation: 995 tests across 69 files pass; TypeScript and the Vite production build pass. Capacitor iOS sync and an unsigned iOS Simulator Xcode build pass.
