# App-wide swipe-back gesture — audit & plan

Polish pass to take the existing phone swipe-back from "works but rough" to
production-grade (Instagram / native-iOS feel). This is a refinement of the
existing gesture, **not** a navigation rewrite.

## Audit of the original implementation

Original: `src/components/SwipeBackContainer.tsx`, wired in the phone layout of
`src/App.tsx` around the `routesBlock`.

- **Animation driver:** plain React state (`dragX`, `animating`) applied as an
  inline `transform: translateX()` with a CSS transition. `setDragX()` fired on
  **every** `touchmove`.
- **Activation:** left-edge only — `EDGE = 28`px; `touchstart` bailed if
  `clientX > 28`. After 6px it decided `horizontal = dx>0 && |dx|>|dy|`.
- **Commit:** distance > 32% width OR velocity > 0.4 px/ms, then a chained
  `setTimeout` choreography (210ms → `navigate(-1)` + park destination → rAF →
  slide in → 230ms) coupled to a 0.23s CSS transition.
- **Reveal:** none — the area behind the page was just the app surface; the
  destination only existed after `navigate(-1)` swapped it in, then slid in.

### Root causes

- **Choppiness:** per-frame `setState` keeps the drag on React's render path;
  the timeout-checkpointed commit drifts against the CSS transition; and
  `navigate(-1)` cold-mounts the destination *mid-animation*.
- **Finicky activation:** the hard `clientX > 28 → return` — no intent-based
  zone, so a clear rightward swipe starting anywhere but the left edge is ignored;
  no deference logic for horizontally-scrollable children.
- **Other gaps:** modals/sheets render as a sibling *outside* the container, so a
  back-swipe over an open sheet pops the route underneath; `prefers-reduced-motion`
  ignored. (WKWebView back-forward gesture is off by Capacitor default — no
  double-gesture conflict.)

## Confirmed plan

1. **Off-React drag engine** — direct `el.style.transform` writes via refs,
   coalesced in `requestAnimationFrame`; zero `setState` during drag. Settle via
   the Web Animations API (GPU-composited), no `setTimeout` choreography.
2. **Two-zone activation** — guaranteed always-back left edge **plus** an
   intent zone everywhere else (claim once horizontal travel > ~10px, angle
   within ~30° of horizontal, pointing right). Axis-locked once decided.
3. **Scroll deference** — defer to vertical scroll and to horizontally-scrollable
   ancestors that can still scroll right; only claim once back-intent is
   unambiguous.
4. **Velocity-aware commit** — distance (~40% width) OR velocity (~0.3–0.5 px/ms).
5. **Reveal — iOS snapshot parallax (confirmed):** capture an inert
   `cloneNode(true)` of each page as it's left, keyed by history index. During a
   back-swipe, render that snapshot underneath, offset ~20–30% with parallax
   factor ~0.3, a leading-edge shadow on the top page, and a scrim that lightens
   to 0. On commit the **real** `navigate(-1)` restores the live page with its
   preserved state; the snapshot unmounts after settle. **No remount during the
   gesture** → no double-mount, refetch, or map re-init.
   - **Fallback:** clones can't paint live WebGL/video, so **map and reels** as a
     back-*destination* fall back to the plain app-surface reveal (they're already
     excluded as gesture *sources*).
6. **Overlay gating (confirmed):** a ref-counted overlay registry; the page
   swipe-back stands down whenever a sheet/modal is open (sheets keep their own
   drag-to-dismiss).
7. **Reduced motion / edges:** respect `prefers-reduced-motion` (drop
   parallax/scrim/shadow); no gesture on root/no-history; cancel on multi-touch,
   `touchcancel`, and `visibilitychange`.

**Process:** separate commits per step; build & validate on **RestaurantDetail
(mobile)** first, then extend. Tune thresholds on a real device.

## Second polish pass (nav-stack + flash + smoothness)

Field testing surfaced three problems; each got a structural fix rather than
a tuned constant:

1. **Wrong back destinations** ("swipe on a pantry list lands somewhere
   random"). Root cause: the gesture blindly popped chronological history,
   and tab sub-views that live in query params (`/pantry?list=x`) were
   gated off entirely because the tab-root check only looked at pathname.
   Fix: `src/lib/nav-stack.ts` — a session record of what lives at each
   history index plus a table of logical parents (pantry sub-views →
   `/pantry`, `/activity/*` → `/activity`, `/restaurant/:id/circle` →
   `/restaurant/:id`, `/guides/:id/edit` → `/guides/:id`). The back target
   is a history **pop** when the previous entry is inside the same flow, and
   a **navigate-to-parent** otherwise (deep link, tab switch, reload) — so a
   pantry list always backs out to the pantry root, never sideways into
   whatever tab history holds. Pure tab roots stay unswipeable; sub-views of
   a tab are now swipeable.
2. **Destination flash after commit** (old page pops back for a split
   second). Two causes: the instant-transition lock raced React's render
   (it was set inside the settle's finish callback, one rAF before
   `navigate()`), and cleanup was a blind 3-rAF/140ms wait. Now the lock is
   engaged when the commit settle *starts* (React gets the whole ~200-300ms
   settle to flush it), and the snapshot stays on top until the destination
   is *verifiably* committed and at rest — the router location changed and
   the `[data-route-stack]` wrapper is untransformed (or unmounted, for
   keep-alive destinations) for two settled frames — with a hard timeout so
   it always completes.
3. **Choppiness.** The reveal (a full-page snapshot) was cloned into the DOM
   + styled + laid out synchronously inside the claiming `touchmove`; the
   full-page `box-shadow` and `will-change` flips forced repaints mid-drag;
   and the app-wide non-passive `touchmove` listener tied *every* scroll to
   the main thread. Now the snapshot is attached and laid out at idle right
   after each navigation (claiming just flips visibility), the shadow is a
   static edge-gradient strip riding the page, edge touches pre-promote the
   layer at `touchstart`, and the non-passive move listener is bound
   per-touch and dropped the instant a touch is ruled not-ours. Snapshots
   also skip the hidden keep-alive tab layers (they used to quadruple the
   clone). Feel: velocity is low-pass filtered, a leftward flick cancels
   even past the distance threshold, settle duration scales with remaining
   distance/velocity, and a cancel bounce can be re-grabbed mid-settle like
   iOS.

## Tunable constants (in SwipeBackContainer.tsx)

| Constant | Value | Meaning |
|---|---|---|
| `EDGE` | 28px | always-back left-edge zone |
| `SLOP` | 10px | travel before the axis is decided |
| `ANGLE_TAN` | tan(30°) | intent must be within 30° of horizontal |
| `COMMIT_RATIO` | 0.35 | distance fraction that commits |
| `FLICK_VELOCITY` | 0.35 px/ms | rightward velocity that commits a short drag |
| `CANCEL_VELOCITY` | −0.25 px/ms | leftward velocity that cancels past the ratio |
| `MIN_SETTLE_MS` / `MAX_SETTLE_MS` | 160 / 320ms | settle duration bounds (scaled by distance + velocity) |
| `PARALLAX` | 0.3 | destination travels at 30% of the page |
| `SCRIM_MAX` | 0.28 | darkest scrim over the destination |
| `FINALIZE_TIMEOUT_MS` | 450ms | max wait for the destination to paint on commit |

## Coverage & fallback

The gesture wraps every phone route (one `SwipeBackContainer` around the
routes), so it's "rolled out" by construction. Per-screen behaviour:

- **Live snapshot reveal:** any pop whose destination page was left while
  `snapshotable` (everything except map / reels / focused-reel).
- **App-surface fallback (no live content):** map, reels, focused reel as a
  *destination* — their clones can't paint live WebGL/video, so no snapshot is
  stored and the page slides over the plain surface. Navigate-to-parent
  commits (deep-linked sub-views) also use the plain surface: the parent was
  never left this session, so there is nothing truthful to preview.
- **No gesture (source):** screens with no back target (session root without
  a logical parent), pure tab roots (`/`, `/search/main`, `/pantry`,
  `/profile`, `/search` — tabs are switched via the nav bar, never by
  swiping), map, reels, focused reel, `/create`, `/onboarding`,
  `/location/map`, and while any sheet/modal is open.

## On-device verification checklist

Smooth/feel can only be judged on hardware — tune the constants above to taste.

1. **RestaurantDetail (primary):** edge swipe and mid-screen intent swipe both
   go back; the previous screen slides in live underneath with parallax + scrim;
   a quick flick commits a short drag; a slow short drag snaps back.
2. **Scroll coexistence:** vertical scroll still works; the photo rail and any
   filter rows still scroll horizontally (swipe on them ≠ back); pull-to-refresh
   still works.
3. **RecipePage / pages with in-content swipers:** confirm the back-swipe and
   the swipeable hero don't fight. (Synthetic testing surfaced a spurious
   `touchcancel` here that's almost certainly a headless-Chrome artifact — the
   setup is identical to RestaurantDetail, which is clean — but verify on
   device. If a real conflict appears, coordinate the axis-lock with
   PullToRefresh / the hero swiper.)
4. **Carousel-heavy pages (Discover):** rails scroll; an edge swipe still backs.
5. **Modal/sheet open:** a back-swipe does NOT pop the route underneath; the
   sheet's own drag-to-dismiss still closes it.
6. **Edge cases:** multi-touch cancels cleanly; backgrounding mid-swipe (lock
   screen / app switch) settles without leaving the page stuck off-screen; no
   gesture on the root tab.
7. **prefers-reduced-motion:** parallax/scrim/shadow drop to a plain slide.
8. **One back per swipe:** never skips two screens; no conflict with any
   WKWebView back gesture (Capacitor default keeps it off).
