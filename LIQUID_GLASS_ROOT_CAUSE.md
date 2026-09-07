# The glass backdrop is sampling the wrong part of the page

Paste everything below the line into Claude Code.

---

## The finding

Stop tuning the material. The bar has never felt like glass because **its backdrop is not the content behind it.**

Proof, from a single frame (frame 300) of the 60fps screen recording of the current build:

- At the **top** of the screen sits a feed row: a green "JG" avatar, "Jenifer Gorin", "Posted · 3 weeks ago". It is at roughly y=540 in device pixels.
- At the **bottom** of the screen, inside the tab bar at roughly y=2400 in the *same frame*, that same row is visible through the glass — the green avatar, "Jenifer Gorin", and "Posted · 3 weeks ago".
- "Posted · 3 weeks ago" renders **vertically mirrored** inside the bar.
- The green avatar ghost bleeds **outside** the capsule's rounded left edge, so it isn't even clipped to the bar's shape.
- What's actually behind the bar at that moment is the bottom of a white "FEATURED PLACE / Falsled Kro" card. None of it appears in the bar.

A backdrop that is offset by ~1,860 pixels, partially flipped, and unclipped is not refraction and not a stale scroll position. `UIVisualEffectView` is sampling the `WKWebView`'s remote-hosted layer in the wrong coordinate space.

This is why every round of parameter work has failed to move the needle. Corner configuration, tint alpha, spring damping, stretch amplitude, container effects, scroll edge effects — all of it is downstream of an input that is wrong. Liquid Glass is a material defined entirely by what it does to the content behind it. Feed it the wrong content and it can only ever read as a printed sticker, no matter how correct the code above it is.

A neighbouring symptom is already filed with Apple: **FB20655398 / Developer Forums thread 803917 — "UIScrollEdgeElementContainerInteraction uses wrong mix-in color over WKWebView on iOS 26.1"**, where a glass-family effect reads the wrong colour from web content. Same family of bug, same cause: WKWebView composites out of process.

## Step 1 — confirm it in ten minutes before changing anything

Temporarily insert a plain native view between the WebView and the bar, filled with something the eye can track — a diagonal red/blue gradient, or a `CAGradientLayer` animating its colours:

```swift
// TEMPORARY DIAGNOSTIC — delete after
let probe = UIView(frame: host.bounds)
probe.backgroundColor = .systemPink
host.insertSubview(probe, belowSubview: wrapper)
```

Then look at the bar.

- **Bar turns pink and refracts the probe's edges** → the material is fine; the problem is specifically WKWebView sampling. Go to Step 2.
- **Bar still shows stale web ghosts, or stays white** → something in the view hierarchy is breaking the effect view itself. Audit for alpha < 1 on `wrapper` or any ancestor, `masksToBounds`/`clipsToBounds` on an ancestor, any `transform`, any `snapshotView`, and any `drawViewHierarchyInRect`. Apple: "Setting the alpha to less than 1 on the visual effect view or any of its superviews causes many effects to look incorrect or not show up at all."

Report which one you get before writing any fix.

## Step 2 — pick an architecture

Assuming the probe confirms it, overlaying glass on a WKWebView is the wrong shape for this problem and no amount of work inside `GlassTabBar` will fix it. Two real options:

### A. Host the WebView inside a real `UITabBarController` (recommended)

Let the system own the tab bar. Then the glass is system chrome sampling content the system composited itself, and you inherit — free and permanently correct — the material, the selection morph, the drag-to-scrub, `tabBarMinimizeBehavior = .onScrollDown`, the scroll edge effect, the haptics, Reduce Transparency and Reduce Motion handling, and every future iOS revision of all of it. Roughly 1,600 of the 2,000 lines in `MainViewController.swift` become deletable.

**`@capgo/capacitor-native-navigation` already does exactly this** — "Capacitor plugin for Liquid glass native navigation tabs", built on a real `UITabBarController` hosting one full-screen WebView, with a `contentInsetMode: 'css'` option that publishes `--cap-native-navigation-bottom` so web content can scroll behind the bar. Evaluate adopting it directly first; if it doesn't fit the routing model, copy its architecture rather than reinventing it.

The work either way:

1. Make `MainViewController` (or a new container) a child of a `UITabBarController` with five lightweight child view controllers.
2. Keep **one** WebView. Move it between the child VCs on selection, or park it in the tab bar controller's view beneath the bar and let the children stay empty — whichever keeps Capacitor's bridge intact.
3. Bridge `UITabBarControllerDelegate.didSelect` → `notifyListeners("tabSelected")`, and `setActiveTab` → `selectedIndex`. Most of `native-glass.ts` survives unchanged.
4. Set `tabBar.items` from the same `GLASS_TAB_ITEMS` payload; keep the SF Symbol names and the avatar item.
5. Delete `GlassTabBar`, `GlassTabBarContent`, `GlassLensView`, `GlassSurfaceView`, `GlassShadowView` and the whole gesture/stretch/spring layer.

Check first whether `tabBarMinimizeBehavior` reacts to the WebView's scroll view; if not, keep the JS-driven `setMinimized` and map it to `UITabBarController.isTabBarHidden` / the minimize API.

### B. Put the bar back in the page

If A is too invasive right now, the honest fallback is to render the bar in the web layer with `backdrop-filter`, where WebKit composites the blur against live, correctly-registered content. It is not real Liquid Glass — no refraction, no specular rim, no motion response — but it is *correct*, and a correct frosted bar reads far better than a glass bar showing the wrong part of the page. `src/components/BottomNav.tsx` still has this path; it would need the capsule shape and the selection pill added.

Do **not** ship a third round of tuning on the current overlay.

## Secondary findings — real, but not the cause

Worth knowing so they don't get re-litigated:

1. **There is no glass on the selection any more.** Commit `0286146` made the pill a plain `UIView` with a flat fill (`GlassLensView`, white at 19%) and deleted `UIGlassContainerEffect`. The measurement that drove it — Instagram's pill reading 3.7× flatter than its slab — is real, but a plain fill and a *merged* glass element produce the same flatness measurement, and only one of them responds to touch and morphs. Apple's "prevent glass elements from overlapping other glass elements" is guidance about **uncontained** glass; `UIGlassContainerEffect` is the sanctioned way to have several glass elements, and per Apple's own docs it "will render all glass elements in one combined view" — one piece of glass, not the two stacked lensing layers the measurement caught. If option A is taken this is moot, since `UITabBar` draws its own indicator.

2. **Nothing in the bar is interactive glass.** `makeBarEffect` sets `isInteractive = false` and the pill is no longer an effect view, so `UIGlassEffect`'s touch response — the scale-and-highlight that is most of what makes the material feel alive — exists nowhere in the app.

3. **The page design gives the glass almost nothing to work with.** Instagram's bar sits over full-bleed dark video. This app is light mode over near-white pages, and every tab root ends in `pb-32` (128px), which is almost exactly the bar's height plus its offset — so at rest, content stops right where the bar begins and the bar floats over blank background. Once the backdrop is correct, reducing that padding so content genuinely runs under the bar, and keeping media full-bleed to the bottom edge, will do more for the look than any material parameter. The `setBarStyle({ dark })` hook added in `0246e32` is the right instinct; it needs the content underneath to be worth sampling.

## Constraints

- `IPHONEOS_DEPLOYMENT_TARGET` is 15.0; keep the pre-26 fallback compiling.
- Deleting the custom bar must not regress: JS-driven `setMinimized`, tab-owns-no-route (`activeTabPath` returning `''` for `/experts`, `/admin/*`), keyboard/modal hiding via `setVisible`, and the Reduce Transparency fallback to the web `BottomNav`.
- `npm run lint` must pass; `npm run ios:sync` after any JS change.
- Option A needs Xcode project edits (new files, embedding a tab bar controller). Say so explicitly rather than trying to keep everything in `MainViewController.swift`.
