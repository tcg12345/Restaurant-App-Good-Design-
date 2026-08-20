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

export interface GlassTabItem {
  /** Route the tab navigates to — echoed back verbatim in `tabSelected`. */
  path: string;
  /** SF Symbol name. Picked to match the Lucide icon the web nav uses. */
  symbol: string;
  /** Filled counterpart drawn while the tab is selected — the thing that
   *  makes a tab bar read as native rather than as five outlines. Omit
   *  where the symbol has no `.fill` variant (magnifyingglass, list.bullet);
   *  the weight and tint change carry those. A name that doesn't resolve
   *  falls back to `symbol` rather than blanking the tab. */
  selectedSymbol?: string;
  /** Shown under the icon, and read by VoiceOver. */
  label: string;
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
  setVisible(options: { visible: boolean; animated?: boolean }): Promise<void>;
  removeTabBar(): Promise<void>;
  addListener(
    event: 'tabSelected',
    fn: (data: { path: string }) => void,
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
    async setVisible() { /* no-op */ },
    async removeTabBar() { /* no-op */ },
    addListener: noopListener,
  },
});

/** SF Symbols chosen to read as the same icons the web nav draws in Lucide.
 *  Order matters — it's the on-screen order. */
export const GLASS_TAB_ITEMS: GlassTabItem[] = [
  { path: '/', symbol: 'safari', selectedSymbol: 'safari.fill', label: 'Home' },
  { path: '/search', symbol: 'magnifyingglass', label: 'Search' },
  { path: '/reels', symbol: 'film', selectedSymbol: 'film.fill', label: 'Reels' },
  { path: '/pantry', symbol: 'list.bullet', label: 'Lists' },
  { path: '/profile', symbol: 'person', selectedSymbol: 'person.fill', label: 'Profile' },
];

/** Which tab owns a route. Longest-prefix match so `/pantry?list=x` and
 *  `/search/main` keep their tab lit; `/` only matches itself. */
export function activeTabPath(pathname: string): string {
  let best = '';
  for (const item of GLASS_TAB_ITEMS) {
    if (item.path === '/') continue;
    if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
      if (item.path.length > best.length) best = item.path;
    }
  }
  return best || '/';
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
  onSelect: (path: string) => void;
}): { active: boolean } {
  const { enabled, hidden, activePath, onSelect } = options;
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

  // Install / tear down.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let handle: PluginListenerHandle | null = null;
    void LiquidGlass.configureTabBar({
      items: GLASS_TAB_ITEMS,
      variant: 'capsule',
      activePath,
    }).catch(() => { /* install failed — the web nav is still mounted below */ });
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
    // `activePath` is the *initial* selection only; the effect below moves it
    // afterwards without reinstalling the bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    void LiquidGlass.setActiveTab({ path: activePath }).catch(() => {});
  }, [active, activePath]);

  useEffect(() => {
    if (!active) return;
    void LiquidGlass.setVisible({ visible: !hidden && !overlayOpen, animated: true }).catch(() => {});
  }, [active, hidden, overlayOpen]);

  return { active };
}
