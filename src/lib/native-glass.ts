/**
 * Typed JS bridge for the LiquidGlass native plugin (see
 * ios/App/App/MainViewController.swift).
 *
 * On iOS 26 the phone tab bar stops being a DOM element and becomes a real
 * UIKit `UIGlassEffect` view layered over the WebView, so it refracts the
 * page scrolling underneath it the way system chrome does. Everywhere else —
 * older iOS, Android, the browser, or a device with Reduce Transparency on —
 * `useNativeGlassNav` reports inactive and the web `BottomNav` keeps
 * rendering exactly as before.
 */

import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { subscribeOverlay } from './overlay-registry';
import { isOffscreenScrollTarget } from './page-scroll';

export interface GlassTabItem {
  /** Route the tab navigates to — echoed back verbatim in `tabSelected`. */
  path: string;
  /** SF Symbol name. Picked to match the Lucide icon the web nav uses. */
  symbol: string;
  /** Filled counterpart drawn while the tab is selected — the thing that
   *  makes a tab bar read as native rather than as five outlines. Omit
   *  where the symbol has no `.fill` variant (magnifyingglass, list.bullet);
   *  the sliding pill carries those alone. A name that doesn't resolve
   *  falls back to `symbol` rather than blanking the tab. */
  selectedSymbol?: string;
  /** Shown under the icon, and read by VoiceOver. */
  label: string;
  /** Instagram draws the profile tab as *the user*, not a person glyph. This
   *  app's mark for the user is an initial in a tinted circle (the profile
   *  page draws the same), so the native cell renders that when set. */
  avatarInitial?: string;
  /** Honoured over the initial when the data model ever grows real avatar
   *  photos. Nothing populates it today. */
  avatarUrl?: string;
}

export type GlassUnsupportedReason = '' | 'requiresIOS26' | 'reduceTransparency' | 'notNative';

interface LiquidGlassPlugin {
  isSupported(): Promise<{ supported: boolean; reason: GlassUnsupportedReason }>;
  configureTabBar(options: {
    items: GlassTabItem[];
    variant?: 'capsule' | 'bar';
    activePath?: string;
  }): Promise<void>;
  setActiveTab(options: { path: string }): Promise<void>;
  /** Shrink the bar out of the way (scrolling down) or restore it. Driven
   *  from `useGlassScrollMinimize` below — see the comment there for why the
   *  scroll signal cannot come from the native side. */
  setMinimized(options: { minimized: boolean; animated?: boolean }): Promise<void>;
  /** Force the bar's dark chrome. The material and icons resolve by *trait*
   *  (the app theme), not by what's behind them — so over the always-black
   *  Reels page a light-themed app got a light warm fog with charcoal icons
   *  that vanished against dark video. Instagram flips to near-black chrome
   *  with white icons there; this is that flip. `dark: false` follows the
   *  app theme again. */
  setBarStyle(options: { dark: boolean }): Promise<void>;
  setVisible(options: { visible: boolean; animated?: boolean }): Promise<void>;
  removeTabBar(): Promise<void>;
  addListener(
    event: 'tabSelected',
    fn: (data: { path: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'minimizedChanged',
    fn: (data: { minimized: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'supportChanged',
    fn: (data: { supported: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

const noopListener = async (): Promise<PluginListenerHandle> => ({ remove: async () => {} });

export const LiquidGlass = registerPlugin<LiquidGlassPlugin>('LiquidGlass', {
  // Web fallback: report unsupported and no-op everything, so callers never
  // have to branch on platform before calling.
  web: {
    async isSupported() {
      return { supported: false, reason: 'notNative' as const };
    },
    async configureTabBar() { /* no native bar off-device */ },
    async setActiveTab() { /* no-op */ },
    async setMinimized() { /* no-op */ },
    async setBarStyle() { /* no-op */ },
    async setVisible() { /* no-op */ },
    async removeTabBar() { /* no-op */ },
    addListener: noopListener,
  },
});

/** SF Symbols chosen to read as the same icons the web nav draws in Lucide,
 *  and to read as *tab bar* icons rather than as app glyphs: `safari` and
 *  `film` are literally the Safari and movie-reel app marks, which is why the
 *  first pass looked like someone else's icons pasted into this app.
 *  `play.rectangle` for Reels rather than `play.square.stack`, which renders
 *  at 25pt as an odd canister with a triangle in it.
 *  Order matters — it's the on-screen order. */
export const GLASS_TAB_ITEMS: GlassTabItem[] = [
  { path: '/', symbol: 'house', selectedSymbol: 'house.fill', label: 'Home' },
  { path: '/search', symbol: 'magnifyingglass', label: 'Search' },
  { path: '/reels', symbol: 'play.rectangle', selectedSymbol: 'play.rectangle.fill', label: 'Reels' },
  { path: '/pantry', symbol: 'list.bullet', label: 'Lists' },
  { path: '/profile', symbol: 'person.crop.circle', selectedSymbol: 'person.crop.circle.fill', label: 'Profile' },
];

/** Which tab owns a route. Longest-prefix match so `/pantry?list=x` and
 *  `/search/main` keep their tab lit; `/` only matches itself.
 *
 *  Returns `''` when no tab owns the route. Plenty of routes show a tab bar
 *  without belonging to a tab — `/experts`, `/import`, `/verify/apply`,
 *  `/admin/*` — and the old fallback to `'/'` lit Home on every one of them.
 *  The native bar understands the empty string and simply lights nothing. */
export function activeTabPath(pathname: string): string {
  if (pathname === '/') return '/';
  let best = '';
  for (const item of GLASS_TAB_ITEMS) {
    if (item.path === '/') continue;
    if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
      if (item.path.length > best.length) best = item.path;
    }
  }
  return best;
}

/* ── Shrink on scroll ──────────────────────────────────────────────────────
   The native side used to do this itself, with KVO on the WebView's own
   scroll view. That was wrong on two of the five tabs: Home and Reels scroll
   an inner `overflow-y: auto` container, so the document offset those
   observers watched sat at 0 for the whole session and the bar never
   collapsed there at all.

   This is `useFabScrollHide` (src/components/AppAssistant.tsx) applied to the
   native bar — same capture-phase listener on `document`, which catches the
   window and any nested scroller alike, same normaliser, same rebase when the
   active scroller changes, same thresholds. Four things differ, each for a
   reason:

     1. It only crosses the bridge on a transition. A scroll gesture should
        cost one or two plugin calls, not one per frame.
     2. It resets in two places, not one. `configureTabBar` expands the native
        bar on install and `setVisible(true)` expands it on return, so both
        have to be mirrored here or JS would believe it is collapsed while it
        is not, and swallow the next real collapse. A route change is the
        third case and the only one that has to *push*, because nothing native
        runs on a plain `setActiveTab`.
     3. It ignores scroll events from off-screen layers. Not hypothetical:
        `SwipeBackContainer` writes a real `scrollTop` onto its inert clone a
        few hundred milliseconds after every navigation, and the keep-alive
        tabs keep live scrollers while hidden.
     4. It stands down while the bar is hidden. The keyboard's own
        `scrollIntoView` would otherwise collapse a bar nobody can see, and
        reveal it collapsed on dismissal. */

/** Scroll offset below which the bar always returns to full height. */
const SHOW_NEAR_TOP = 80;
/** Movement needed before a scroll counts as having a direction. */
const DELTA_THRESHOLD = 8;

function scrollTopOf(target: EventTarget | null): number {
  if (
    !target
    || target === document
    || target === window
    || target === document.documentElement
    || target === document.body
  ) {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }
  return (target as HTMLElement).scrollTop ?? 0;
}

function useGlassScrollMinimize(options: {
  active: boolean;
  pathname: string;
  /** Bar is hidden (keyboard up, overlay open) — nothing to shrink. */
  suspended: boolean;
}): void {
  const { active, pathname, suspended } = options;
  // What the native side is believed to be doing. Kept in a ref rather than
  // state: nothing in React renders from it, and a re-render per scroll frame
  // is exactly what this is trying to avoid.
  const minimized = useRef(false);

  // The bar can also shrink or grow on its own — a touch on a collapsed bar
  // expands it, and so does coming back from hidden. Without this the ref
  // drifts out of agreement and starts swallowing real transitions.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let handle: PluginListenerHandle | null = null;
    void LiquidGlass.addListener('minimizedChanged', ({ minimized: next }) => {
      minimized.current = next;
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    }).catch(() => { /* older shell without the event — the resets below cover it */ });
    return () => { cancelled = true; void handle?.remove(); };
  }, [active]);

  // Install, and every edge in and out of hidden, leave the native bar
  // expanded. Mirror that without crossing the bridge.
  useEffect(() => {
    minimized.current = false;
  }, [active, suspended]);

  // A route change lands at the top of a fresh page, and nothing on the
  // native side notices — `setActiveTab` only moves the selection. This is
  // the push that stops a bar collapsed on Search from staying collapsed on
  // Home indefinitely.
  useEffect(() => {
    if (!active) return;
    minimized.current = false;
    void LiquidGlass.setMinimized({ minimized: false, animated: false }).catch(() => {});
  }, [active, pathname]);

  useEffect(() => {
    if (!active || suspended) return;

    let lastY = 0;
    let lastTarget: EventTarget | null = null;
    let pendingTarget: EventTarget | null = null;
    let raf = 0;
    // The off-screen verdict, cached per target: the steady 60Hz case is then
    // one reference compare instead of a style flush every frame.
    let judgedTarget: EventTarget | null = null;
    let judgedOffscreen = false;

    const push = (next: boolean) => {
      if (next === minimized.current) return;
      minimized.current = next;
      void LiquidGlass.setMinimized({ minimized: next, animated: true }).catch(() => {});
    };

    const handle = () => {
      raf = 0;
      const target = pendingTarget;
      const y = scrollTopOf(target);
      // New scroll container in focus — rebase rather than diffing against an
      // unrelated element's scrollTop.
      if (target !== lastTarget) {
        lastTarget = target;
        lastY = y;
        if (y < SHOW_NEAR_TOP) push(false);
        return;
      }
      const dy = y - lastY;
      if (y < SHOW_NEAR_TOP) push(false);
      else if (Math.abs(dy) > DELTA_THRESHOLD) push(dy > 0);
      lastY = y;
    };

    const onScroll = (e: Event) => {
      // Filtered here, before `pendingTarget` is written: a single-slot
      // pending target would otherwise let a hidden layer's event clobber a
      // real one arriving in the same frame, or poison the rebase.
      if (e.target !== judgedTarget) {
        judgedTarget = e.target;
        judgedOffscreen = isOffscreenScrollTarget(e.target);
      }
      if (judgedOffscreen) return;
      pendingTarget = e.target;
      if (raf) return;
      raf = requestAnimationFrame(handle);
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('scroll', onScroll, opts);
    return () => {
      document.removeEventListener('scroll', onScroll, opts);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, suspended, pathname]);
}

/**
 * Owns the native bar's whole lifecycle for the app shell.
 *
 * `enabled` is the same predicate that decides whether the web nav would
 * render at all (route allows it, phone layout). Returns whether the native
 * bar has taken over, so `BottomNav` can stand down.
 *
 * Visibility folds three signals together — the caller's `hidden` (keyboard
 * up, a page asked for it), and any open web overlay. That last one isn't
 * cosmetic: the bar is a UIKit view above the WebView, so a `z-[100]` modal
 * inside the page cannot paint over it. It has to be told to leave.
 */
export function useNativeGlassNav(options: {
  enabled: boolean;
  hidden: boolean;
  activePath: string;
  /** Full route, not just the owning tab: `/pantry` → `/pantry/recommended`
   *  is a new page that should un-shrink the bar, but `activePath` doesn't
   *  change across it. Passed in rather than read from `useLocation()` here
   *  because nothing else in `src/lib/` depends on react-router, and the
   *  caller already holds the location. */
  pathname: string;
  /** The page behind the bar is dark regardless of theme (Reels), so the bar
   *  should wear its dark chrome — near-black glass, white icons — the way
   *  Instagram's does over dark content. */
  darkPage?: boolean;
  /** First letter of the signed-in user's name; the Profile tab draws it as
   *  the app's initial-circle avatar, Instagram-style. */
  avatarInitial?: string;
  onSelect: (path: string) => void;
}): { active: boolean } {
  const { enabled, hidden, activePath, pathname, darkPage = false, avatarInitial, onSelect } = options;
  const [supported, setSupported] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Latest handler without re-subscribing the native listener on every
  // render (navigate() changes identity across route changes).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Probe once, then follow Reduce Transparency flips.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let handle: PluginListenerHandle | null = null;
    void LiquidGlass.isSupported()
      .then((res) => { if (!cancelled) setSupported(res.supported); })
      .catch(() => { if (!cancelled) setSupported(false); });
    void LiquidGlass.addListener('supportChanged', ({ supported: next }) => {
      if (!cancelled) setSupported(next);
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    }).catch(() => { /* older shell without the plugin — stay on the web nav */ });
    return () => { cancelled = true; void handle?.remove(); };
  }, []);

  useEffect(() => subscribeOverlay(setOverlayOpen), []);

  const active = supported && enabled;
  const suspended = hidden || overlayOpen;

  // Lifecycle: the listener and the teardown. Deliberately does NOT also
  // configure — that lives in the effect below, which re-runs when the
  // avatar initial arrives (the profile loads after boot), and folding the
  // two together would make that re-run tear the whole bar down
  // (`removeTabBar` is this effect's cleanup) just to change one cell.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let handle: PluginListenerHandle | null = null;
    void LiquidGlass.addListener('tabSelected', ({ path }) => {
      onSelectRef.current(path);
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    }).catch(() => {});
    return () => {
      cancelled = true;
      void handle?.remove();
      void LiquidGlass.removeTabBar().catch(() => {});
    };
  }, [active]);

  // Install, and reconfigure in place when the avatar initial changes —
  // `configureTabBar` on an installed bar rebuilds the cells without a
  // teardown, so the Profile tab upgrades from the person glyph to the
  // initial-circle without a blink.
  useEffect(() => {
    if (!active) return;
    const items = avatarInitial
      ? GLASS_TAB_ITEMS.map((item) => (item.path === '/profile' ? { ...item, avatarInitial } : item))
      : GLASS_TAB_ITEMS;
    void LiquidGlass.configureTabBar({
      items,
      variant: 'capsule',
      activePath,
    }).catch(() => { /* install failed — the web nav is still mounted below */ });
    // `activePath` is the *initial* selection only; the effect below moves it
    // afterwards without reinstalling the bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, avatarInitial]);

  // `pathname` is deliberately a dep even though only `activePath` is sent:
  // a screen recording caught the bar resting with Search lit on the Home
  // page — a desync whose origin isn't provable after the fact. Re-asserting
  // on *every* navigation (the native side applies same-path re-asserts too)
  // turns any such desync from permanent into gone-at-the-next-route-change.
  useEffect(() => {
    if (!active) return;
    void LiquidGlass.setActiveTab({ path: activePath }).catch(() => {});
  }, [active, activePath, pathname]);

  useEffect(() => {
    if (!active) return;
    void LiquidGlass.setBarStyle({ dark: darkPage }).catch(() => {});
  }, [active, darkPage]);

  useEffect(() => {
    if (!active) return;
    void LiquidGlass.setVisible({ visible: !suspended, animated: true }).catch(() => {});
  }, [active, suspended]);

  useGlassScrollMinimize({ active, pathname, suspended });

  return { active };
}
