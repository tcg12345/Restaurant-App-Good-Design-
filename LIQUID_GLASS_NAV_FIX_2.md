# Make the glass tab bar move like Instagram's

Paste everything below the line into Claude Code.

---

## Task

The native tab bar (`ios/App/App/MainViewController.swift`, `LiquidGlassPlugin` / `GlassTabBar` / `GlassTabBarContent` / `GlassTabItemView`) now renders real glass, but it still doesn't *move* like iOS 26. I recorded my bar and Instagram's side by side and measured both frame by frame at 60fps. The findings below are from those recordings — they are measurements, not opinions. Fix the causes.

Read `MainViewController.swift` end to end first. Keep the existing comment style and update the comments you invalidate.

## What the recordings actually show

**Instagram, Home → Reels (one transition, 60fps):**

- The pill **stretches**. It starts as a ~68×40pt capsule on Home, elongates until it spans *both* cells at the midpoint of the move, then contracts onto Reels. It is never a rigid rectangle sliding.
- The outgoing icon un-fills *before* the pill leaves; the incoming icon fills as it arrives.
- Total motion ≈ 0.30–0.35s, one continuous ease — no reversal, no flat spot.
- The pill is a **horizontal capsule**, ~68×40pt (clearly wider than tall), corner radius ≈ 20.
- The pill has **no hue at all**. It is a lighter draw of the bar's own material, and it visibly picks up colour from whatever is behind it.
- The bar is ~48pt tall, **icons only, no labels**, and inset well in from the screen edges.

**Mine, four transitions measured (lens centroid x, per frame):**

```
Home→Search   frames 40-51  (0.18s)   deltas: +15.5 +2.8 +6.7 +18.9 +27.1 +27.9 +29.2 +25.2 +24.3 +15.3 +8.9 +1.9
Search→Reels  frames 64-75  (0.20s)   deltas: +20.1 -12.3 +12.8 +24.9 +47.7 +26.9 +18.7 +23.2 +22.5 +17.9 +8.7 +2.4
Reels→Lists   frames 93-107 (0.25s)   deltas: +12.8 +3.8 +13.3 +23.2 +34.0 +26.5 +32.1 +22.2 +21.2 +14.3 +6.9 +2.0 …
Lists→Home    frames 112-122 (0.17s)  a 634px move in the same time as a 204px one
```

Three things are wrong in that data and all three are visible:

1. **Every transition starts with a stutter** — a jump, then a near-stall, then acceleration (`+15.5, +2.8, +6.7`).
2. **`Search→Reels` reverses direction mid-flight** (`+20.1` then `-12.3`).
3. **Duration is constant regardless of distance.** A four-cell move takes the same 0.17s as a one-cell move, so long moves read as a teleport.

And in one frame of my recording the lens is sitting over Reels **with no icon inside it at all** — the glyph has vanished mid-transition.

## Root causes

### 1. Two animations fight on every single tap — this is the stutter and the reversal

`beginDrag` (`MainViewController.swift:1168`) runs on `.began`, i.e. on touch-down of *every* tap:

```swift
rect.origin.x = centerX - rect.width / 2      // centerX = clampedCenterX(x) — the FINGER's x
UIView.animate(withDuration: 0.18, ...) { self.setLens(rect: rect) }
```

Then `.ended` → `endDrag` → `commit` → `applySelection` → `moveLens` (`:1066`) starts a *second*, 0.38s spring to the **cell centre**.

So a plain tap plays: 0.18s flight to wherever your finger happened to land inside the cell, then a 0.38s spring correcting to the cell centre. Your finger is almost never at the cell centre, so the two targets differ and the second animation yanks the lens back. That is exactly the `+20.1, -12.3` reversal, and the `+15.5, +2.8` stall is the handover between them.

**Fix:** `beginDrag` must not move the lens at all. Track a `hasMoved` flag and only start following the finger once the touch has travelled past a threshold (~6pt). A tap should produce exactly one animation: the settle spring, started on release.

### 2. Fixed duration, zero initial velocity

`moveLens` (`:1076`):

```swift
UIView.animate(withDuration: 0.38, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0, ...)
```

`initialSpringVelocity: 0` means every interruption restarts from a dead stop — the classic "chases you" feel. And a fixed `withDuration` means distance doesn't affect timing, which is why a four-cell move looks teleported.

**Fix:** replace with a `UIViewPropertyAnimator` driven by `UISpringTimingParameters`, seeded with the live drag velocity:

```swift
let params = UISpringTimingParameters(duration: 0.45, bounce: 0.18, initialVelocity: CGVector(dx: normalizedVx, dy: 0))
let animator = UIViewPropertyAnimator(duration: 0.45, timingParameters: params)
```

Verify the initialiser against the installed SDK (`UISpringTimingParameters(duration:bounce:initialVelocity:)` is iOS 17+; `UISpringTimingParameters(mass:stiffness:damping:initialVelocity:)` is the older one — either is fine, but the velocity seed is not optional). Keep one `UIViewPropertyAnimator?` on `GlassTabBarContent`, `stopAnimation(true)` any in-flight one before starting the next, and carry its current velocity into the replacement so an interrupted move continues rather than restarting.

`normalizedVx` must be in units of *fraction of remaining distance per second* — `abs(pointsPerSecond / (target.midX - current.midX))` — not raw points/second, or the spring will launch off screen.

### 3. The lens is a circle; Instagram's is a horizontal capsule

`selectionFrame(for:)` (`:1094`):

```swift
return cell.insetBy(dx: min(6, cell.width * 0.08), dy: 6)
```

On a 64pt bar with 5 cells that yields roughly **62×52** — and `GlassSurfaceView.isCapsule` then rounds it to radius 26, i.e. a circle. That is the coloured blob in my recording. Instagram's is **68×40, radius 20**.

**Fix:** stop deriving the lens from the full cell height. Give it explicit metrics:

```swift
static let lensHeight: CGFloat = 40          // expanded
static let lensHeightCollapsed: CGFloat = 34
static let lensWidthRatio: CGFloat = 0.86    // of cell width
```

and centre it on the **icon**, not on the cell, so it stays a horizontal capsule whether or not labels are showing.

### 4. No stretch on a tap — only on a drag

`applyStretch` (`:1227`) is only called from `updateDrag`. Tapping a tab — the overwhelmingly common case — gets a rigid translate. Instagram stretches on *every* transition; the elongate-then-contract is most of what makes it read as liquid.

**Fix:** drive the stretch from the animator instead of from the drag. Add a `CADisplayLink` (or a `UIViewPropertyAnimator` `addAnimations` block with a second, offset timing curve) that scales the lens on X by a factor that peaks mid-flight and returns to 1.0 at the ends:

```swift
// s(t) = 1 + amplitude * sin(pi * t), t = animator.fractionComplete
// amplitude scales with distance: min(0.45, distance / cellWidth * 0.18)
```

Compensate on Y (`1 - (s - 1) * 0.4`) so the area stays roughly constant — that's what makes it look like a liquid volume rather than a widening box. Cap the amplitude; a four-cell move should stretch far more than a one-cell move but must not become a bar-wide smear.

### 5. `usesGlassContainer = false` — the merge is switched off

`MainViewController.swift:489`. With the container off, the lens is glass sitting *on* glass; it cannot blend into the bar as it moves. The blend is what turns a stretching capsule into a liquid one.

**Fix:** turn it on and make the container path work. Per Apple's UIKit docs: "When using UIGlassContainerEffect with a UIVisualEffectView you can add individual glass elements to the visual effect view's contentView by nesting UIVisualEffectViews configured with UIGlassEffect. In that configuration, the glass container will render all glass elements in one combined view, behind the visual effect view's contentView."

If nesting the bar slab *and* the lens in one container makes the lens disappear into the slab (fully-overlapping elements merge), the alternative is: container holds only the lens, and the bar slab stays a plain `UIGlassEffect` view beneath it. Try the full-container version first, keep the flag, and record which one you shipped in a comment.

### 6. The icon vanishes mid-transition

`highlight(index:animated:)` (`:1057`) calls `setSelected` on **all five** cells every time, and `setSelected` (`:1357`) has no "did anything change?" guard — so it restarts a symbol animation on all five. During a drag, `updateDrag` calls `highlight` on every boundary crossing, stacking `.replace.offUp` transitions on the same image view. `.replace.offUp` has a phase where the outgoing glyph has lifted and the incoming one hasn't landed; overlap two of them and you get an empty cell, which is the blank lens in my recording.

**Fix:** early-return at the top of `setSelected` when `next` matches the current state, and store that state on the item view. Then `highlight` becomes cheap and only the two cells that actually changed animate.

### 7. The haptics are wrong

`commit` (`:1268`):

```swift
UIImpactFeedbackGenerator(style: .light).impactOccurred()
```

**Neither Instagram's tab bar nor Apple's own `UITabBar` fires a haptic on tab selection.** This is the "weird haptics" — a thud on every tab tap that no other iOS app produces. Worse, ending a *drag* fires `selectionChanged()` at the last crossing and then this impact on release: a double tick.

**Fix:**

- Delete the `UIImpactFeedbackGenerator` from `commit` entirely.
- Keep `UISelectionFeedbackGenerator.selectionChanged()` for crossings **only**, and only once `hasMoved` is true (see #1) — a tap must produce no haptic at all.
- Move `dragFeedback.prepare()` out of `.began` and into the point where `hasMoved` first flips true, so a plain tap never spins up the Taptic Engine.

### 8. The icons

- **Labels.** Instagram has none; that's what lets its bar be 48pt and its lens a wide capsule. Mine are 64pt with labels, which is why the lens is nearly square. Add `static let showsLabels = false` on `GlassTabItemView` and default it **off**; drop `Metrics.expandedHeight` to 50 and `collapsedHeight` to 40 to match. Keep the flag so this is one line to reverse — Apple's own apps do label their tab bars, this is a deliberate Instagram-style choice.
- **Contrast.** Unselected icons are `.secondaryLabel` (`:1368`), which on a near-white glass bar reads as washed-out grey. Instagram's unselected icons are full-strength. Use `.label` at ~0.75 alpha, or `.secondaryLabel` with `.medium` symbol weight, and keep the weight **constant across states** as it is now.
- **`play.square.stack`** renders as an odd canister-with-a-triangle at 25pt. Use `play.rectangle` / `play.rectangle.fill`, or `play.square` / `play.square.fill`. Look at it at 25pt before committing.
- **The lens tint.** `makeLensEffect` (`:800`) sets `tintColor = primary.withAlphaComponent(0.55)`. At 0.55 the brand rust reads as an opaque painted blob, which is the single most un-iOS-26 thing in the bar — Apple's selection indicator is **neutral glass**, and the tint colour goes on the selected *icon*, not on the indicator. Drop the lens tint to neutral (no `tintColor` at all) and let the rust live on the selected glyph. If that reads as too plain on device, `primary.withAlphaComponent(0.15)` is the ceiling.
- Try `UIGlassEffect(style: .clear)` for the bar slab as well as the default `.regular` — in light mode `.regular` is close to opaque white and content barely shows through, where Instagram's clearly does. Verify the initialiser name against the SDK; keep whichever looks better and say which in a comment.

## Constraints

- `IPHONEOS_DEPLOYMENT_TARGET` is 15.0. Everything iOS 26 stays inside `#available(iOS 26.0, *)`; the `UIBlurEffect` fallback must still compile and run.
- Everything stays in `MainViewController.swift` — it's already a member of the App target and registered in `capacitorDidLoad`, so no Xcode project edits.
- Don't regress what's already correct: the `rowInset` coordinate conversion, the `lastBounds` guard in `layoutSubviews`, the `cornerConfiguration` shaping, tap-to-expand while collapsed, the JS-driven `setMinimized`, and the Reduce Transparency / Reduce Motion fallbacks.
- `npm run lint` must pass; run `npm run ios:sync` after any JS change.

## Verification

Build to a physical iOS 26 device, then record your own 60fps screen capture of four consecutive tab switches and check it frame by frame:

1. **No reversal.** The lens centroid must move monotonically toward the target. Any negative delta in a forward move is bug #1 still present.
2. **No start stutter.** The first three frames of a move should accelerate smoothly, not jump-stall-jump.
3. **Distance affects duration.** A four-cell move must visibly take longer than a one-cell move.
4. **It stretches on a tap**, not just on a drag, and spans both cells at the midpoint of a one-cell move.
5. **The lens is wider than it is tall** at rest, in both the expanded and collapsed states.
6. **No blank icon** in any frame of any transition, including a fast drag across all five tabs.
7. **No haptic on a plain tap.** A drag ticks once per boundary crossing and nothing on release.
8. **Reduce Motion** on → no stretch, no bounce, plain 0.2s crossfades. **Reduce Transparency** on → native bar gone, web `BottomNav` back.
