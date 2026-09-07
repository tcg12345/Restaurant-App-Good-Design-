# Make the Liquid Glass tab bar actually read as iOS 26

Paste everything below the line into Claude Code.

---

## Task

The native tab bar in `ios/App/App/MainViewController.swift` (`LiquidGlassPlugin` / `GlassTabBar` / `GlassTabBarContent` / `GlassTabItemView`, added in commit `65d2957`) renders, but it reads as "glass-ish" rather than as a real iOS 26 tab bar. Four symptoms, all with concrete causes in the code:

1. The icons look off.
2. It never collapses on scroll.
3. Once collapsed it doesn't expand again when tapped.
4. You can't smoothly slide between tabs, and there's no lensing/magnification while you do.

Fix all four. Do **not** rewrite the plugin architecture — the JS bridge (`src/lib/native-glass.ts`) and the web fallback (`src/components/BottomNav.tsx`) stay as they are, except where explicitly called out below.

Before writing Swift, read `MainViewController.swift` end to end. It has long comments explaining why several things are the way they are; keep that comment style and update the comments you invalidate.

---

## Diagnosis

### 1. The material is being clipped, and the selection pill isn't glass

`MainViewController.swift:412-414`

```swift
effectView.clipsToBounds = true
effectView.layer.cornerCurve = .continuous
effectView.layer.cornerRadius = variant == .capsule ? Metrics.expandedHeight / 2 : 0
```

On iOS 26, `UIVisualEffectView` backed by `UIGlassEffect` **ignores `layer.cornerRadius`** — the supported API is `UIVisualEffectView.cornerConfiguration` (`UICornerConfiguration`), added in beta 4. Worse, `clipsToBounds = true` hard-clips the material's outer specular rim and its ambient shadow, which is exactly the highlight that makes Liquid Glass read as a lens rather than a frosted rectangle. This is the single biggest reason the bar looks flat.

`MainViewController.swift:603, 622`

```swift
private let selection = UIView()
...
selection.backgroundColor = Self.primary.withAlphaComponent(0.13)
```

The selected-tab indicator is a plain `UIView` with a 13%-alpha brand fill. A plain view cannot refract, magnify, or morph — it is the flat pink blob visible behind the Search icon in the screenshot. There is no "liquid glass magnification" anywhere in this bar because there is no second glass element to do the magnifying.

`MainViewController.swift:579` — `effect.isInteractive = true` is set on the **whole bar**. `isInteractive` is meant for an individual glass *control*; on a full-width bar it means any touch anywhere makes the entire bar do the press highlight, which reads as a bug.

### 2. Icon and label metrics don't match a real tab bar

- `native-glass.ts:78-82`: `safari` / `safari.fill` for Home is literally the Safari app glyph — that's the odd compass in the screenshot. `film` / `film.fill` for Reels reads as a movie reel, not short-form video.
- `MainViewController.swift:849`: `SymbolConfiguration(pointSize: 21, weight: next ? .semibold : .regular)`. Apple's tab bar uses a constant `.regular` weight around 25pt and relies on **outline → fill** alone to signal selection. Flipping the weight makes the selected icon look chunkier and slightly blurrier than its neighbours — a big part of "the icons look a little weird".
- `MainViewController.swift:816, 859`: label is 10pt `.semibold`, going `.bold` when selected. Apple's is 10pt `.medium`, constant.
- `MainViewController.swift:828`: `icon.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -7)` — a magic offset instead of a real centred stack, so the icon+label block isn't optically centred and shifts when the label fades on collapse.
- `MainViewController.swift:861`: `UIView.transition(with: icon, .transitionCrossDissolve)` is a generic crossfade. iOS has a purpose-built symbol replace animation.

### 3. Collapse-on-scroll never fires on the two most-scrolled tabs

`MainViewController.swift:321-325`

```swift
scrollObservation = scrollView.observe(\.contentOffset, ...) // bridge?.webView?.scrollView
```

The commit message for `65d2957` asserts "every tab root scrolls the document". That is false for two of the five tabs:

| Route | Component | Scroll model |
|---|---|---|
| `/` Home | `src/pages/Discover.tsx` | **Inner container.** Root is `relative h-[100dvh] w-full overflow-hidden` (`Discover.tsx:4005`); the scroller is `homeScrollRef` → `flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none pb-32` (`Discover.tsx:4589-4592`) |
| `/search` Search | `src/pages/Search.tsx` | Document (`pb-32 min-h-screen`, `Search.tsx:14`) |
| `/reels` Reels | `src/pages/Reels.tsx` | **Inner container.** Root `relative h-dvh w-full bg-black overflow-hidden` (`Reels.tsx:2916`); pager is `h-full w-full overflow-y-auto snap-y snap-mandatory` (`Reels.tsx:2542`) |
| `/pantry` Lists | `src/pages/Pantry.tsx` | Document (`pb-32`, `Pantry.tsx:6059`) |
| `/profile` Profile | `src/pages/Profile.tsx` | Document (`pb-32 min-h-screen`, `Profile.tsx:989`) |

On `/` and `/reels` the WKWebView's `contentOffset` is pinned at 0 forever, so the KVO observer receives nothing. `MainViewController.swift:50-52` also sets `bounces = false` / `alwaysBounceVertical = false`, so there isn't even rubber-band noise to react to.

### 4. It gets stuck collapsed

`MainViewController.swift:752-756` — `handleTap` goes straight to `commit(index:)`. Nothing anywhere restores the expanded state on tap. `configureTabBar` does call `setCollapsed(false, animated: false)` (`:275`), but `useNativeGlassNav`'s install effect depends only on `[active]` (`native-glass.ts:158`), so a route change calls `setActiveTab`, never `configureTabBar` — the reset never runs on navigation. Combined with #3, once the bar collapses on Search it can stay collapsed on Home indefinitely.

### 5. The drag isn't a drag

`MainViewController.swift:644` uses a plain `UIPanGestureRecognizer`, which doesn't reach `.began` until roughly 10pt of movement — so the first third of a short drag does nothing and then the indicator jumps. `handlePan` (`:757`) then calls `moveSelection(to:animated: true)` (`:684`), a **0.38s spring per cell crossing**, so on a fast swipe the springs queue up behind the finger. The indicator never tracks the touch continuously, and because it isn't glass (#1) there is nothing to magnify even if it did.

---

## What to change

### A. Rebuild the material (`GlassTabBar.install`, `MainViewController.swift:405-465`)

Target structure — a glass **container** so the indicator and the bar merge and morph into each other as the indicator slides. That merge is the "liquid" part; per Apple's UIKit docs, "the glass container will render all glass elements in one combined view, behind the visual effect view's contentView."

```
host view
└─ shadowWrapper: UIView            (ambient shadow lives here — the effect views must not clip)
   └─ container: UIVisualEffectView(effect: UIGlassContainerEffect())   // spacing ~ 12
      └─ contentView
         ├─ barGlass: UIVisualEffectView(effect: UIGlassEffect())       // full bounds, capsule
         │   └─ contentView
         │      └─ GlassTabBarContent (stack of GlassTabItemView)
         └─ indicator: UIVisualEffectView(effect: UIGlassEffect())      // the sliding lens
```

Concretely:

1. **Delete** `effectView.clipsToBounds = true`, `layer.cornerCurve`, and both `layer.cornerRadius` assignments (`:412-414` and `:509`). Replace with `cornerConfiguration`:
   - capsule variant → `barGlass.cornerConfiguration = .capsule()`
   - bar variant → `barGlass.cornerConfiguration = .fixed(0)` (or leave unset)
   - indicator → `.capsule()`
   Verify the exact `UICornerConfiguration` factory names against the installed SDK before committing (`UICornerConfiguration.capsule()`, `.fixed(_:)`, `.containerConcentric(minimum:)`); if a name doesn't resolve, jump to definition in Xcode and use what's actually there rather than guessing.
2. `makeGlassEffect()` (`:573`) becomes two factories:
   - `makeBarEffect()` → `UIGlassEffect()` with **`isInteractive = false`**.
   - `makeIndicatorEffect()` → `UIGlassEffect()` with `isInteractive = true` and `tintColor = primary.withAlphaComponent(0.55)`. Tune the alpha on device; the point is that the brand colour arrives as a *tint on glass*, not as a flat fill.
   Keep both behind the existing single `#available(iOS 26.0, *)` guard, and keep the `UIBlurEffect(style: .systemChromeMaterial)` fallback path working (older OS gets a blurred bar with the current flat indicator — that's fine).
3. Add the ambient shadow on `shadowWrapper` (`shadowOpacity 0.12`, `shadowRadius 20`, `shadowOffset (0, 6)`, `shadowColor .black`). It could not exist before because `clipsToBounds` was on.
4. If `UIGlassContainerEffect` turns out to swallow the indicator entirely (fully-overlapping glass elements merge into one shape), fall back to nesting the indicator directly in `barGlass.contentView` **below** `GlassTabBarContent` and keep the container out of it. Put whichever you choose behind a single `private static let usesGlassContainer` flag with a comment, so it's a one-line switch after you see it on a device.

### B. Fix the icons (`native-glass.ts:78-82`, `GlassTabItemView` at `MainViewController.swift:800-870`)

New symbol set:

```ts
export const GLASS_TAB_ITEMS: GlassTabItem[] = [
  { path: '/',        symbol: 'house',              selectedSymbol: 'house.fill',              label: 'Home' },
  { path: '/search',  symbol: 'magnifyingglass',                                               label: 'Search' },
  { path: '/reels',   symbol: 'play.square.stack',  selectedSymbol: 'play.square.stack.fill',  label: 'Reels' },
  { path: '/pantry',  symbol: 'list.bullet',                                                   label: 'Lists' },
  { path: '/profile', symbol: 'person.crop.circle', selectedSymbol: 'person.crop.circle.fill', label: 'Profile' },
];
```

Verify every name resolves in SF Symbols before shipping — the existing nil-fallback chain at `:850-853` protects against a blank tab, but a silently-wrong fallback is still a bug. If `play.square.stack` doesn't fit visually, `play.rectangle.on.rectangle` is the other candidate.

In `GlassTabItemView`:

- `SymbolConfiguration(pointSize: 25, weight: .regular)` — constant weight, both states. Selection is carried by fill + tint only.
- Label: `.systemFont(ofSize: 10, weight: .medium)`, constant.
- Replace the icon/label constraints (`:825-833`) with a real centred `UIStackView(axis: .vertical, alignment: .center, spacing: 2)` pinned to the centre, so the block is optically centred and the icon settles cleanly when the label fades on collapse. Delete the `-7` magic constant.
- Replace the crossfade at `:861` with `icon.setSymbolImage(image, contentTransition: .replace.offUp)`.
- On commit (not on every `setSelected`), fire `icon.addSymbolEffect(.bounce.down, options: .nonRepeating)` — that little bounce is a strong native tell.

### C. Drive collapse from JS (`native-glass.ts` + plugin)

**Remove** `startObservingScroll` / `handleScroll` / `scrollObservation` from the plugin entirely (`MainViewController.swift:170-175, 276, 314, 321-341, 346`). One source of truth, and the native one can only ever see two of five tabs.

Add a plugin method:

```swift
CAPPluginMethod(name: "setMinimized", returnType: CAPPluginReturnPromise)
```

that forwards to `tabBar?.setCollapsed(minimized, animated: animated)` on the main queue.

On the JS side, add a `useGlassScrollMinimize` hook in `src/lib/native-glass.ts` that mirrors `useFabScrollHide` in `src/components/AppAssistant.tsx:128-202` — copy its structure, it already solves exactly this problem:

- capture-phase `document.addEventListener('scroll', onScroll, { capture: true, passive: true })`, which catches both the window and any nested `overflow-y: auto` container;
- the same `scrollTopOf(target)` normaliser (`document` / `window` / `documentElement` / `body` → `window.scrollY`, else `target.scrollTop`);
- rebase (don't diff) when the active scroll target changes — this is what makes it survive the keep-alive tab layers;
- `SHOW_NEAR_TOP = 80`, `DELTA_THRESHOLD = 8`;
- `requestAnimationFrame` throttle.

Two things that must be different from `useFabScrollHide`:

- **Only cross the bridge on a state transition.** Keep the boolean in a ref and call `LiquidGlass.setMinimized` only when it flips. A scroll gesture should cost one or two bridge calls, not one per frame.
- **Reset to expanded on route change** (`useEffect(..., [pathname])`, same as `AppAssistant.tsx:133-135`), and push `setMinimized(false)` when it does.

Wire it into `useNativeGlassNav` so `BottomNav.tsx` needs no change. Gate it on `active`.

Also expand whenever `setVisible(true)` runs, so a keyboard dismissal or a closing overlay never reveals a stuck-collapsed bar.

### D. Tap-to-expand, and better collapsed geometry (`GlassTabBar` / `GlassTabBarContent`)

- When collapsed, a touch on the bar **expands it and does not switch tabs** — that's the iOS 26 behaviour. Add a `isCollapsed` read-back from `GlassTabBar` into `GlassTabBarContent` (or a closure), and bail out of `commit` on the first touch while collapsed.
- Collapsed metrics (`:391-395`): keep `expandedHeight 64` → `collapsedHeight 48`, keep hiding the labels, but **stop pulling the edges in from 16 to 44** (`collapsedInset`). Squeezing five tabs into a 44pt-inset pill is what makes the collapsed state look cramped rather than tidy. Use `collapsedInset = 16`, or at most 28.
  - Optional stretch goal, closer to Apple: on minimize, collapse to a small pill containing *only* the selected tab's icon, and expand on touch. Only attempt this after the rest is working, and keep it behind a flag.

### E. Make the drag continuous (`GlassTabBarContent`, `MainViewController.swift:640-790`)

Replace the tap + pan pair (`:643-644`) with a **single `UILongPressGestureRecognizer` with `minimumPressDuration = 0`**. It fires `.began` on touch-down, which removes the ~10pt dead zone, and it handles the plain-tap case as began→ended at the same point, so you don't need a second recognizer fighting it.

Handler:

- `.began` — record the touch, set `draggingIndex` from `index(atX:)`, expand if collapsed (see D) and return. Prepare the feedback generator. Optionally scale the item under the finger to ~1.06.
- `.changed` — **set `indicator.center.x` directly to the touch x, clamped** to the first and last cell centres, with no animation. This is what makes it track the finger. Keep the existing `UISelectionFeedbackGenerator` tick when the finger crosses into a new cell (`:766-770` — that part is good), and update icon/label selected states as it crosses.
  - Optional "liquid" touch: apply a small horizontal scale to the indicator proportional to drag velocity (cap around `1.12`), relaxing to `1.0` on release. That plus the glass container is what produces the stretch-and-settle you see in Instagram.
- `.ended` — snap to the nearest cell centre with the existing spring (`0.38s`, damping `0.82`, `[.beginFromCurrentState, .allowUserInteraction]`), then `commit`.
- `.cancelled` / `.failed` — spring back to `activeIndex`.

Delete the per-crossing `moveSelection(to:animated: true)` call from the drag path — during a drag the indicator is positioned directly, and the spring is only used for the release snap and for programmatic `setActiveTab`.

Keep the existing coordinate handling: cell frames live in the stack view's space and must be converted with `view.convert(view.bounds, to: self)` before being used to position the indicator or resolve a touch (`:709-716`, `:744-751`). That off-by-`rowInset` bug was already fixed once — don't reintroduce it. Same for the `lastBounds` guard in `layoutSubviews` (`:723-735`), which stops `layoutIfNeeded()` inside `moveSelection` from pre-empting the spring.

---

## Constraints

- `IPHONEOS_DEPLOYMENT_TARGET` is 15.0 (`ios/App/App.xcodeproj/project.pbxproj:246`). Everything iOS 26 stays inside `#available(iOS 26.0, *)`, and the `UIBlurEffect` fallback path must still compile and run.
- `MainViewController.swift` is already a member of the App target and the plugin is registered explicitly in `capacitorDidLoad` (`:35`). No Xcode project edits should be needed. If you add a new Swift file, you *will* need a project edit — prefer keeping it in this file, or say so loudly.
- Don't touch the Reduce Transparency path (`supportReason`, `:184-190`) — falling back to the web `BottomNav` there is correct.
- `npm run lint` (`tsc --noEmit`) must pass. Run `npm run ios:sync` after the JS changes.

## Verification

Build to a physical iOS 26 device (the material does not render meaningfully in the simulator) and check:

1. **Edge highlight.** The bar has a bright specular rim and a soft shadow, not a hard-clipped edge. Scroll a colourful grid under it (Lists → Collections) and watch the tint move.
2. **Magnification.** Drag slowly across the bar. The indicator should visibly lens/magnify the content behind it and stretch toward the direction of travel, and merge into the bar's own glass rather than sitting on top as a coloured blob.
3. **Collapse on all five tabs.** Scroll down on Home *and* Reels (the inner-container ones) as well as Search / Lists / Profile. The bar drops its labels and shrinks on every one. Scroll back to the top and it restores.
4. **Tap to expand.** Collapse the bar, tap it — it expands without changing tab. Tap again — it switches.
5. **No stuck states.** Collapse on Search, navigate to Home: expanded. Open the keyboard and dismiss it: expanded. Open a modal and close it: expanded.
6. **Drag.** A 5pt drag moves the indicator immediately (no dead zone). A fast swipe from Home to Profile fires exactly one navigation, on release.
7. **Icons.** House, magnifier, play stack, list, person-circle — outline when unselected, filled when selected, identical weight and size across all five, with a bounce on selection.
8. **Reduce Transparency** on → the native bar disappears and the web `BottomNav` takes over, unchanged.

## Notes on the iOS 26 API

- `UIVisualEffectView.cornerConfiguration` is the supported corner API for glass; `layer.cornerRadius` was honoured in betas 1–2 and stopped working in beta 3, and `cornerConfiguration` landed in beta 4. See the Apple forum threads below.
- `UIGlassEffect` exposes `tintColor` and `isInteractive`. `UIGlassContainerEffect` exposes `spacing`, which is the distance at which nested glass elements begin to blend.
- Glass over `WKWebView` **does** sample the web content — that was verified on device already (see commit `65d2957`'s message). The material was never the problem, so don't go looking there.
