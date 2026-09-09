# Navigation gestures

The shared route container now follows presentation direction: pushed pages
return rightward, Create returns leftward, and `/guides` plus public-profile
follower/following/rated collections dismiss downward. Sheet content scrolls
normally when it is away from the top; its header can dismiss at any position.

Explicit native/web tab-bar and sidebar selections mark their history entry as
a tab switch. A tab destination opened from another page can still return to
its presenter. Home itself retains its feed/search gestures. Maps, Reels and
interactive intro screens reserve the return edge, while voting cards, fields,
sliders and horizontal media regions keep their own gestures. Overlays prevent
navigation of the page underneath them.

Invisible retained-route transforms no longer disable the current route's
back gesture. Create and sheet routes have an explicit viewport-height wrapper,
so their absolute children do not collapse inside the retained stack. Gesture
motion, settle, cancellation, re-grabbing and destination reveal share the same
engine in all three directions. Back buttons use the same history resolver.

Create and Decide Together's local setup steps intercept Back before the route
is dismissed, preserving their in-memory work in the same way as their existing
header buttons. Existing sheet/editor close handlers and discard checks remain
in charge. This does not introduce a new universal autosave policy.

## Collections and return paths

Mobile Guides entry points on Home, Discover and Location open `/guides`.
Location/Discover pass their actual collection context through router state.
Opening a reader pushes it above that retained collection, preserving filters
and scroll on return. The collection then returns to the actual presenter.
Mobile Pantry recommendations likewise use their existing routed screen.
Desktop contextual collections retain their popup presentation.

The reusable full-screen collection popup supports swipe-down, hard scroll
locking, reduced motion and gesture ownership through its exit animation.
Home's Search takeover also supports swipe-down. Shared bottom sheets ignore
canceled gestures, upward releases and drags that started in nested scrolled
content. Guide editor dismissal now pops/replaces rather than pushing another
reader entry; unknown routes offer a visible recovery screen.

## Verification

Automated coverage includes the route-family matrix, all return directions,
cancellation, hidden retained pages, protected content, scrolled collections,
local-step interception, guide-reader opening and existing photo/share sheets.
The isolated `/scripts/navigation-preview.html` harness exercises the real
route gesture engine, retained stack and Guides UI without account requests.
Browser checks at 393×852 verify pushed returns, Create's local-step return,
leftward dismissal, guide-to-collection scroll retention, and downward close.
These are browser simulations, not physical-iPhone gesture measurements.

Authentication/onboarding gates retain their own step controls; desktop
sidebar navigation and intentional tab switches do not acquire phone swipe
transitions. No production services or database changes are required.

## Back completion edge polish

The outgoing snapshot previously had a permanent blurred box shadow. Parking
it exactly one viewport offscreen left that blur inside the final 32–64 pixels
of the destination until asynchronous route/glass handoff removed the snapshot.
That produced the right-edge dark-to-light pop at the end of Back.

The shadow now has its own viewport-clipped layer and animates only transform
and opacity, following the same distance/easing as the page. It fades to zero
over the final 64 pixels. Completion pins both layers before cancelling their
Web Animations, hides the departing preview immediately at the edge, and hides
it before resetting transforms during cleanup. This applies to rightward Back,
leftward Create dismissal, downward sheet dismissal, and cancellation/re-grab.

Thirty navigation/glass/handoff checks passed. At 393×852, the isolated browser
harness sampled 16 parked end frames for both tapped Back and simulated swipe
Back with no residual shadow. The production build and iOS simulator build
passed. Browser frame sampling does not replace physical-iPhone verification.
Use the harness's “Test Back button” or “Simulate return swipe” controls to
repeat the end-frame check without changing account data.

## Persistent phone tab bar

The phone shell mounts `BottomNav` once across routes. Route visibility is passed as a prop; there is no `AnimatePresence` exit delay or spring entrance. The browser bar stays in the DOM, becoming hidden and inert in the route commit. Only visible bars carry the snapshot marker.

On iOS, the UIKit bar stays installed while covered. Layout effects send visibility without animation, and installation includes initial visibility in the same native transaction. Avatar updates retain the hidden state. Immediate native visibility updates cancel any pending visibility animation. Pro routes use the shell route predicate instead of a mount-effect hide flag.

Regression coverage in `BottomNav.test.tsx` checks repeated hide/return cycles without native reinstall, hidden deep-link startup/avatar updates, keyboard/overlay precedence, and retained/inert browser markup.

The native bar also participates in the saved page reveal. Snapshots carry invisible tab geometry and selection; the glass sampler sends their translation and visible viewport region in the same bridge batch as header controls. UIKit clips and moves the existing bar beneath the outgoing page, then restores normal interaction after handoff without rebuilding its items or material. Cancellation restores the covered route's visibility. Plain Reels/map previews retain tab geometry too. Tests cover partial swipes, all return directions, cancellation, native snapshot capture, and the bridge handoff.
