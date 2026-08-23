/**
 * Native Liquid Glass for the app's circular chrome buttons — back, create,
 * messages, circle, save, share.
 *
 * Why this exists at all, given `.glass-control` already styles them: CSS
 * cannot refract. A probe put CSS circles in a WKWebView against real
 * `UIGlassEffect` circles over an identical backdrop, and the native ones
 * visibly bend what is behind them into a lens while `backdrop-filter` only
 * blurs and tints. There is no web API for the missing part, so on iOS 26 the
 * buttons stop being drawn by the page.
 *
 * Why the *whole* button moves native, not just the material: a UIKit view
 * always draws above the WKWebView, so glass placed behind a web icon would
 * cover it. Nothing puts web content back on top. So the native side draws
 * glass, glyph and badge, and the page keeps an element of the same size that
 * renders nothing — it still carries the layout, the hit area for the
 * fallback, and the route the tap leads to.
 *
 * Everywhere else — older iOS, Android, the browser, Reduce Transparency —
 * `useGlassButtonsActive()` is false and `<GlassButton>` renders exactly the
 * CSS button it always did.
 */

import React, { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { LiquidGlass } from './native-glass';
import { subscribeOverlay } from './overlay-registry';

/** Named rather than hex so the two sides can't drift on what the brand
 *  colour is — the native side owns the value. */
export type GlassTint = 'label' | 'primary' | 'white';

export interface GlassButtonSpec {
  /** SF Symbol drawn inside the glass. */
  symbol: string;
  /** Set to make it a pill with a word on it instead of a circle with a
   *  glyph in it — the recipe flow's "‹ New recipe" chip. The native side
   *  lays glyph and text out together when this is present. */
  title?: string;
  /** How the word on a pill is set. `chip` is the recipe flow's small
   *  semibold label; `field` is a search bar — 17pt regular, leading
   *  aligned, so the capsule reads as something you type into rather than
   *  as a button whose label happens to be long. */
  titleStyle?: 'chip' | 'field';
  /** Read by VoiceOver on the native control. */
  label: string;
  tint?: GlassTint;
  /** Count shown in the corner. Empty or undefined draws none. */
  badge?: string;
  badgeTone?: 'primary' | 'danger';
  /** Dimmed and inert, like the disabled attribute it mirrors. */
  disabled?: boolean;
}

/** What a group of segments is. The native side needs it told rather than
 *  guessed: a selector with nothing selected is still a selector, and the two
 *  kinds are different controls with opposite touch handling — an action row's
 *  regions are pressed one at a time, a selector's choice is dragged along the
 *  bar. */
type GlassGroupKind = 'actions' | 'selector';

interface Registration extends GlassButtonSpec {
  el: HTMLElement;
  onTap: () => void;
  /** Set for a shared capsule — see `GlassGroup`. Each entry gets its own
   *  region, glyph, badge and handler; the glass belongs to the capsule. */
  segments?: Array<GlassButtonSpec & { id: string; onTap: () => void; active?: boolean }>;
  kind?: GlassGroupKind;
}

/** Everything currently on screen, by id. Module-level rather than context so
 *  a button can register from anywhere without the tree having to carry a
 *  provider through every page that happens to own a header. */
const registry = new Map<string, Registration>();
/** What was last pushed across the bridge, so an unchanged frame costs
 *  nothing. */
let lastPayload = '';
let supported = false;
let listenersBound = false;
let frame = 0;
/** Frames left to keep sampling before going idle. Anything that can move a
 *  header re-arms it. */
let budget = 0;
const IDLE_FRAMES = 45;

const activeListeners = new Set<(active: boolean) => void>();

function setSupported(next: boolean): void {
  if (next === supported) return;
  supported = next;
  for (const fn of activeListeners) fn(next);
  if (!next) {
    lastPayload = '';
    void LiquidGlass.clearGlassButtons().catch(() => {});
  } else {
    wake();
  }
}

/** Is anything drawn on top of this button? A native view always draws above
 *  the whole page, so a button under a modal's scrim would float over it
 *  unless it stands down — and a button *on* the modal must not stand down.
 *  The old rule (any overlay open → hide everything) could not tell those
 *  apart, which mattered the moment modals grew glass close buttons of their
 *  own. Hit-testing the button's centre answers the real question — "is this
 *  element what the user actually sees at this spot?" — for scrims, nested
 *  sheets, toasts, and anything else, with no bookkeeping to drift. */
function occluded(el: HTMLElement, rect: DOMRect): boolean {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return true;
  const found = document.elementFromPoint(cx, cy);
  if (!found) return true;
  return !(el.contains(found) || found.contains(el));
}

/** Effective opacity, including every ancestor's — the mobile headers fade by
 *  animating a wrapper, so the button's own computed opacity is 1 the whole
 *  way down. */
function effectiveOpacity(el: HTMLElement): number {
  let opacity = 1;
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return 0;
    const own = parseFloat(style.opacity);
    if (!Number.isNaN(own)) opacity *= own;
    if (opacity <= 0.01) return 0;
    node = node.parentElement;
  }
  return opacity;
}

/** Native reports the id it was given, which for a shared capsule is a
 *  segment's rather than the capsule's. */
function tapById(id: string): void {
  const direct = registry.get(id);
  if (direct) { direct.onTap(); return; }
  for (const reg of registry.values()) {
    const segment = reg.segments?.find((s) => s.id === id);
    if (segment) { segment.onTap(); return; }
  }
}

function sample(): void {
  const buttons: Array<Record<string, unknown>> = [];
  for (const [id, reg] of registry) {
    const rect = reg.el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const alpha = occluded(reg.el, rect) ? 0 : effectiveOpacity(reg.el) * (reg.disabled ? 0.4 : 1);
    buttons.push({
      id,
      x: Math.round(rect.left * 100) / 100,
      y: Math.round(rect.top * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
      symbol: reg.symbol,
      title: reg.title ?? '',
      titleStyle: reg.titleStyle ?? 'chip',
      label: reg.label,
      kind: reg.kind ?? '',
      segments: (reg.segments ?? []).map((seg) => ({
        id: seg.id,
        symbol: seg.symbol,
        title: seg.title ?? '',
        active: seg.active ?? false,
        label: seg.label,
        tint: seg.tint ?? 'label',
        badge: seg.badge ?? '',
        badgeTone: seg.badgeTone ?? 'primary',
      })),
      tint: reg.tint ?? 'label',
      alpha: Math.round(alpha * 100) / 100,
      badge: reg.badge ?? '',
      badgeTone: reg.badgeTone ?? 'primary',
    });
  }
  const payload = JSON.stringify(buttons);
  if (payload === lastPayload) return;
  lastPayload = payload;
  void LiquidGlass.setGlassButtons({ buttons }).catch(() => {});
}

function tick(): void {
  frame = 0;
  if (!supported) return;
  if (!document.hidden) {
    const before = lastPayload;
    sample();
    // Something moved, so keep watching — a fade or a slide runs for many
    // frames after the scroll event that started it.
    if (lastPayload !== before) budget = IDLE_FRAMES;
  }
  budget -= 1;
  if (budget > 0) frame = requestAnimationFrame(tick);
}

/** Re-arm the sampler. Called by anything that can move a header. */
function wake(): void {
  budget = IDLE_FRAMES;
  if (!frame && supported) frame = requestAnimationFrame(tick);
}

function bindListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  // Capture-phase scroll catches the window and every nested scroller alike;
  // the phone headers fade off one of those.
  document.addEventListener('scroll', wake, opts);
  document.addEventListener('touchmove', wake, opts);
  document.addEventListener('transitionend', wake, opts);
  document.addEventListener('animationend', wake, opts);
  window.addEventListener('resize', wake);
  window.addEventListener('orientationchange', wake);
  document.addEventListener('visibilitychange', wake);
  // Occlusion re-derives everything from the DOM; the registry is only a
  // wake signal, because a modal mounting fires neither scroll nor
  // transitionend and the sampler would otherwise sleep through it.
  subscribeOverlay(() => wake());
}

/** Probe once and follow Reduce Transparency, exactly as the tab bar does. */
function ensureStarted(): void {
  if (!Capacitor.isNativePlatform()) return;
  bindListeners();
  void LiquidGlass.isSupported()
    .then((res) => setSupported(res.supported))
    .catch(() => setSupported(false));
  void LiquidGlass.addListener('supportChanged', ({ supported: next }) => {
    setSupported(next);
  }).catch(() => { /* older shell without the plugin — stay on CSS */ });
  void LiquidGlass.addListener('glassButtonTapped', ({ id }) => {
    tapById(id);
  }).catch(() => { /* older shell without glass buttons — stay on CSS */ });
}

let started = false;

/** Whether the native layer has taken the buttons over. */
export function useGlassButtonsActive(): boolean {
  const [active, setActive] = useState(supported);
  useEffect(() => {
    if (!started) { started = true; ensureStarted(); }
    activeListeners.add(setActive);
    setActive(supported);
    return () => { activeListeners.delete(setActive); };
  }, []);
  return active;
}

/** Marks a subtree as already sitting on a piece of glass.
 *
 *  Two things need it, and both are the same rule: one floating layer of
 *  glass, never two stacked. The condensed scroll headers are a glass pill
 *  with buttons inside them, so those buttons render plain — no native glass
 *  and no `.glass-control` either. It also keeps ids unique, because the
 *  condensed bar and the full header are both mounted while they crossfade
 *  and would otherwise register the same button twice. */
const OnGlass = React.createContext(false);

export const GlassSurface: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <OnGlass.Provider value={true}>{children}</OnGlass.Provider>
);

/**
 * A circular chrome button.
 *
 * `children` is the web icon and is what renders when the native layer is not
 * active. When it is, the element stays — same box, same place in the layout —
 * and draws nothing, while UIKit draws the real thing on top of it.
 */
export const GlassButton: React.FC<{
  /** Forwarded to the web element. The absolute-positioned modal buttons set
   *  their safe-area `top` through it, so dropping it silently would move
   *  them — and the native mirror measures the web element, so a misplaced
   *  web box means a misplaced glass button too. */
  style?: React.CSSProperties;
  /** Readability only — it is namespaced per instance before it reaches the
   *  registry, so it does not have to be unique. It had better not have to be:
   *  the tab roots stay mounted behind each other (see lib/keep-alive.ts), so
   *  Discover's header and Profile's header are both in the tree at once, both
   *  rendering a `TopBar`, both asking for a button called `topbar-messages`.
   *  Whichever registered last would win, and the first to unmount would take
   *  the shared entry with it. */
  id: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
} & GlassButtonSpec> = ({ id, onClick, className, style, children, symbol, title, titleStyle, label, tint, badge, badgeTone, disabled }) => {
  const onGlass = useContext(OnGlass);
  const active = useGlassButtonsActive() && !onGlass;
  // Stable for the life of this element, unique across every other one.
  const key = `${id}#${useId()}`;
  const ref = useRef<HTMLButtonElement | null>(null);
  // Latest handler without re-registering every render.
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    registry.set(key, {
      el,
      symbol,
      title,
      titleStyle,
      label,
      tint,
      badge,
      badgeTone,
      disabled,
      onTap: () => { if (!disabled) onClickRef.current(); },
    });
    wake();
    return () => {
      registry.delete(key);
      wake();
    };
  }, [active, key, symbol, title, titleStyle, label, tint, badge, badgeTone, disabled]);

  const handle = useCallback(() => onClickRef.current(), []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={handle}
      aria-label={label}
      // `aria-hidden` while native owns it: the UIKit control carries the
      // accessibility label, and two buttons for one action is worse than
      // either alone.
      aria-hidden={active || undefined}
      tabIndex={active ? -1 : undefined}
      disabled={disabled}
      // While native owns the button, any background the caller's classes
      // paint must go: the glass samples the page through itself, so a CSS
      // chip left under it reads as a gray disc inside the glass.
      style={active ? { ...style, backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none' } : style}
      // Still clickable while native owns it, deliberately. The native view
      // sits on top and takes every touch, so this never fires — but if a push
      // is ever in flight when a finger lands, the tap does the right thing
      // instead of nothing.
      className={[className, active || onGlass ? '' : 'glass-control'].filter(Boolean).join(' ')}
    >
      {/* The *contents* go invisible, not the button. `effectiveOpacity`
          walks up from this element to mirror a fading header, so putting
          `opacity: 0` on the element itself would make every native button
          compute an alpha of zero and never appear at all. */}
      {active ? <span className="opacity-0">{children}</span> : children}
    </button>
  );
};

/** The fallback's press. On iOS 26 the capsule itself is interactive glass:
 *  the system swells it under the finger, leans it as the finger moves, and
 *  settles it on release. CSS can't refract or lean, so the region dips
 *  instead — enough that a press is answered. It lives here rather than at
 *  the three call sites so they cannot drift on how a region answers a touch. */
const REGION_PRESS = 'transition-transform active:scale-90';

/**
 * Several actions sharing one capsule of glass — the header's Messages and
 * Circle pair.
 *
 * One surface with regions on it, not a row of separate glass circles: two
 * touching capsules read as two objects, and stacking glass beside glass is
 * the same mistake as stacking it on glass. The native side draws one
 * `UIGlassEffect` capsule and lays plain buttons across it.
 *
 * The fallback renders the same shape in CSS — one `.glass-control` capsule
 * with plain buttons inside — so the two layouts agree and the glyphs land
 * where the invisible web buttons are.
 */
export const GlassGroup: React.FC<{
  id: string;
  className?: string;
  itemClassName?: string;
  items: Array<GlassButtonSpec & { id: string; onClick: () => void; icon: React.ReactNode }>;
}> = ({ id, className, itemClassName, items }) => {
  const onGlass = useContext(OnGlass);
  const active = useGlassButtonsActive() && !onGlass;
  const key = `${id}#${useId()}`;
  const ref = useRef<HTMLDivElement | null>(null);
  // Latest handlers without re-registering on every render.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Only the shape of the group and what it draws — not the handlers — should
  // push a new registration.
  const shape = JSON.stringify(
    items.map((i) => [i.id, i.symbol, i.label, i.tint, i.badge, i.badgeTone]),
  );

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    registry.set(key, {
      el,
      symbol: '',
      label: '',
      kind: 'actions',
      onTap: () => {},
      segments: itemsRef.current.map((item) => ({
        ...item,
        // Namespaced like the button ids, and for the same reason: two headers
        // are mounted at once behind each other.
        id: `${key}/${item.id}`,
        onTap: () => {
          itemsRef.current.find((i) => i.id === item.id)?.onClick();
        },
      })),
    });
    wake();
    return () => {
      registry.delete(key);
      wake();
    };
  }, [active, key, shape]);

  return (
    <div
      ref={ref}
      className={[className, active || onGlass ? '' : 'glass-control'].filter(Boolean).join(' ')}
      style={active ? { backgroundColor: 'transparent', backgroundImage: 'none', boxShadow: 'none' } : undefined}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          aria-label={item.label}
          aria-hidden={active || undefined}
          tabIndex={active ? -1 : undefined}
          className={[itemClassName, active ? '' : REGION_PRESS].filter(Boolean).join(' ')}
        >
          {active ? <span className="opacity-0">{item.icon}</span> : item.icon}
        </button>
      ))}
    </div>
  );
};

/**
 * Register an existing element as a segmented glass control — the Lists
 * page's Restaurants | Recipes bar. `GlassGroup` builds generic icon rows;
 * this is for a control that owns its own markup and only wants the material
 * and the native selection pill over it. The caller hides its contents while
 * `active` (native draws the whole control) and keeps them for the fallback.
 */
export function useGlassSegments(options: {
  id: string;
  items: Array<GlassButtonSpec & { id: string; active?: boolean; onClick: () => void }>;
}): { ref: (el: HTMLElement | null) => void; active: boolean } {
  const { id, items } = options;
  const onGlass = useContext(OnGlass);
  const active = useGlassButtonsActive() && !onGlass;
  const key = `${id}#${useId()}`;
  const elRef = useRef<HTMLElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const shape = JSON.stringify(
    items.map((i) => [i.id, i.symbol, i.title, i.label, i.tint, i.active]),
  );

  useEffect(() => {
    const el = elRef.current;
    if (!active || !el) return;
    registry.set(key, {
      el,
      symbol: '',
      label: '',
      kind: 'selector',
      onTap: () => {},
      segments: itemsRef.current.map((item) => ({
        ...item,
        id: `${key}/${item.id}`,
        onTap: () => {
          itemsRef.current.find((i) => i.id === item.id)?.onClick();
        },
      })),
    });
    wake();
    return () => {
      registry.delete(key);
      wake();
    };
  }, [active, key, shape]);

  const ref = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);
  return { ref, active };
}
