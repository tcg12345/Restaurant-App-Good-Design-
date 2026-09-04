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
import { cn } from './utils';

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
  /** `chip` is a filter capsule in a scrolling row: it takes its glyph size
   *  and insets from the page's chip box rather than from the capsule's
   *  height, and it grows from its centre when the system's font sets its
   *  label wider than the page's did. */
  role?: 'button' | 'chip';
  /** Selected. Glass has no fill to darken, so a chosen capsule switches to
   *  the system's PROMINENT glass — the tinted lens — rather than being
   *  painted over. `tint` picks the fill: `primary` for the accent, `label`
   *  for the app's ink. */
  prominent?: boolean;
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
type GlassGroupKind = 'actions' | 'selector' | 'chips';

/** The live state of a native search field. One mutable object per field,
 *  read by the sampler every frame — mutated in place rather than
 *  re-registered, because a keystroke must not tear the native editor down.
 *
 *  Text and focus each carry a *generation*, and the native side applies
 *  them only when the generation advances. Without that, the round trip
 *  eats keystrokes: the user types "pizza", the page's state catches up to
 *  "piz", the next payload pushes "piz" back, and the field loses two
 *  letters. The page bumps the generation only when it decides the value
 *  itself — clearing on close, a suggestion tapped — so an echo of native
 *  typing is never re-applied. */
interface GlassFieldState {
  text: string;
  textGen: number;
  focused: boolean;
  focusGen: number;
  editable: boolean;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
}

interface Registration extends GlassButtonSpec {
  el: HTMLElement;
  onTap: () => void;
  /** Set for a search field — see `useGlassField`. */
  field?: GlassFieldState;
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

/** Layers that cover the page — a full-screen modal panel, the assistant's
 *  island. Every glass control whose centre falls inside one of these, and
 *  which does not itself ride on it, stands down.
 *
 *  This is a second answer to the same question `occluded` asks below, and
 *  it exists because the hit-test one is only as good as what the DOM
 *  reports at a point. A panel that covers the whole screen is a fact about
 *  the page that does not need discovering: it said so itself. Declaring it
 *  is exact where a probe is circumstantial, and it is the only thing that
 *  reaches a control the probe misses for any reason at all — a stacking
 *  context nobody meant to create, a `pointer-events` value on some wrapper
 *  in between, a hit that lands on a shared ancestor (which the containment
 *  test below reads as "not covered"). The chat island is the case that
 *  forced it: opened from a tab root, the page's own header capsule kept
 *  drawing over the panel, natively, above the WebView.
 *
 *  Geometry, not paint order: the rect has to actually contain the control's
 *  centre, so a small floating panel only stands down what is under IT. */
const occluders = new Set<HTMLElement>();

/** Returns a `ref` to put on the covering element. A ref rather than a
 *  boolean so registration follows the element's real life: an exit
 *  animation keeps it mounted after whatever opened it says it is closed,
 *  and standing the page's chrome back up while the panel is still 80%
 *  opaque is its own flicker. The opacity check at the point of use is what
 *  ends it, mid-fade, without anyone having to time it. */
export function useGlassOccluder(): (el: HTMLElement | null) => void {
  const held = useRef<HTMLElement | null>(null);
  return useCallback((el: HTMLElement | null) => {
    if (held.current === el) return;
    if (held.current) occluders.delete(held.current);
    held.current = el;
    if (el) occluders.add(el);
    wake();
  }, []);
}

const activeListeners = new Set<(active: boolean) => void>();
/** While a finger drives the page (the swipe-back gesture), the native
 *  mirror cannot keep up — it measures the DOM a bridge-hop late and the
 *  buttons visibly trail, then jump. So for the length of the gesture every
 *  button stands down to its CSS fallback, which rides the transform like
 *  any other pixel, and native takes over again once the page is at rest. */
let suspendedAll = false;
const isActive = (): boolean => supported && !suspendedAll;

function setSupported(next: boolean): void {
  if (next === supported) return;
  supported = next;
  for (const fn of activeListeners) fn(isActive());
  if (!next) {
    lastPayload = '';
    void LiquidGlass.clearGlassButtons().catch(() => {});
  } else {
    wake();
  }
}

/** Hand every glass button to its CSS fallback (true) or back to native
 *  (false). Idempotent; the swipe-back gesture calls it around its drag. */
export function setGlassSuspended(next: boolean): void {
  if (next === suspendedAll) return;
  suspendedAll = next;
  for (const fn of activeListeners) fn(isActive());
  if (next) {
    // Native goes first, in the same frame the fallbacks paint — the
    // registry empties as each button re-renders, but that is a render away.
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
 *  sheets, toasts, and anything else, with no bookkeeping to drift.
 *
 *  A closing sheet or an outgoing route is exactly the case a plain hit-test
 *  gets wrong: Framer Motion drives its exit by writing inline styles every
 *  frame, not a CSS transition/animation, so it fires neither
 *  `transitionend` nor `animationend` — `bindListeners` below has nothing to
 *  wake the sampler with once the fade finishes. A dismissed sheet's
 *  full-screen backdrop stays mounted and exactly as hit-testable at 1% of
 *  its exit as it was at 100% — only its OPACITY says it is really gone. Not
 *  checking that is what let a page's own header sit invisible for up to a
 *  couple of seconds after closing something over it: the found element
 *  still won the hit-test, `occluded` kept saying yes, and with the reading
 *  never changing there was nothing left to re-arm the sampler until some
 *  unrelated scroll or resize happened to. So: a hit that's part of THIS
 *  button wins as before, but a hit that has faded to nothing doesn't count
 *  as covering anything, and the sampler picks the real state back up on its
 *  own the next time it looks, however many frames that took. */
function occluded(el: HTMLElement, rect: DOMRect): boolean {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return true;
  for (const layer of occluders) {
    // A control ON the layer is not under it.
    if (layer === el || layer.contains(el)) continue;
    if (effectiveOpacity(layer) < 0.05) continue;
    const r = layer.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return true;
  }
  const found = document.elementFromPoint(cx, cy);
  if (!found) return true;
  if (el.contains(found) || found.contains(el)) return false;
  /* ANOTHER glass button on top covers this one, even though the hit-test
     lands on something transparent.
     A registered button renders its contents inside an `opacity: 0` span —
     the native control paints them, and a visible web copy underneath the
     glass would show through it. So a button that sits under another one
     hit-tests onto that invisible span, and the faded-hit rule below reads
     it as "nothing is there" and leaves the lower button on screen. That is
     exactly how the Create page's close button went on floating over the
     recipe builder's own back chip, which had covered it precisely.
     Ask the registry instead of the pixels: if the hit belongs to another
     live glass button, something IS painted there. */
  for (const other of registry.values()) {
    if (other.el !== el && other.el.contains(found)) return true;
  }
  // elementFromPoint's return type is the generic `Element` (it could in
  // principle land on an SVG node); effectiveOpacity only reads
  // style/parentElement, both of which every Element has, so the narrower
  // HTMLElement parameter type is stricter than the check needs.
  if (effectiveOpacity(found as HTMLElement) < 0.05) return false;
  return true;
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
      role: reg.role ?? 'button',
      prominent: reg.prominent ?? false,
      tint: reg.tint ?? 'label',
      alpha: Math.round(alpha * 100) / 100,
      badge: reg.badge ?? '',
      badgeTone: reg.badgeTone ?? 'primary',
      // Last, so a field's role wins over the default above.
      ...(reg.field ? {
        role: 'field',
        fieldText: reg.field.text,
        fieldTextGen: reg.field.textGen,
        fieldFocused: reg.field.focused,
        fieldFocusGen: reg.field.focusGen,
        fieldEditable: reg.field.editable,
      } : {}),
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

/** A keep-alive route flip hides a whole layer by toggling `visibility` in
 *  render — no transition, no scroll, no registry change, so none of the
 *  bound listeners fire and the layer's buttons would keep their last
 *  sampled frame, floating over the new page. The router calls this on
 *  every location change instead. */
export function wakeGlassButtons(): void {
  wake();
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
  void LiquidGlass.addListener('glassFieldChanged', ({ id, text }) => {
    registry.get(id)?.field?.onChangeText(text);
  }).catch(() => { /* older shell without glass fields — stay on CSS */ });
  void LiquidGlass.addListener('glassFieldSubmitted', ({ id }) => {
    registry.get(id)?.field?.onSubmit();
  }).catch(() => { /* older shell without glass fields — stay on CSS */ });
}

let started = false;

/** Whether the native layer has taken the buttons over. */
export function useGlassButtonsActive(): boolean {
  const [active, setActive] = useState(isActive());
  useEffect(() => {
    if (!started) { started = true; ensureStarted(); }
    activeListeners.add(setActive);
    setActive(isActive());
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
  /** Mirrored to `aria-pressed` on the web element — a toggle has to say so
   *  in the fallback, where there is no native control to announce it. */
  pressed?: boolean;
  /** Temporarily stand the native glass down and let the web fallback
   *  carry the look — for buttons riding a finger-driven transform (a
   *  dragged sheet), where the async native mirror visibly trails. */
  suspended?: boolean;
  children: React.ReactNode;
} & GlassButtonSpec> = ({ id, onClick, className, style, pressed, suspended, children, symbol, title, titleStyle, role, prominent, label, tint, badge, badgeTone, disabled }) => {
  const onGlass = useContext(OnGlass);
  const active = useGlassButtonsActive() && !onGlass && !suspended;
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
      role,
      prominent,
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
  }, [active, key, symbol, title, titleStyle, role, prominent, label, tint, badge, badgeTone, disabled]);

  const handle = useCallback(() => onClickRef.current(), []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={handle}
      aria-label={label}
      aria-pressed={pressed}
      // `aria-hidden` while native owns it: the UIKit control carries the
      // accessibility label, and two buttons for one action is worse than
      // either alone.
      aria-hidden={active || undefined}
      tabIndex={active ? -1 : undefined}
      disabled={disabled}
      // Marks a natively-owned button for the swipe-back snapshot, which
      // clones the page: the clone gets the CSS fallback in this spot, so
      // the destination preview isn't a page with holes where its glass was.
      data-glass-native={active ? '' : undefined}
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
 * A horizontally scrolling row of independent glass filter chips — the map
 * chrome's filter row.
 *
 * ONE registration for the whole strip, not one per chip, and the native
 * side owns the row completely: a real UIScrollView lays the capsules out
 * from their own intrinsic widths, scrolls them with native bounce, and
 * clips them at its edges. Mirroring chips one-per-box was tried first and
 * failed twice over — per-chip boxes drift from the system font's metrics
 * so capsules grew into their neighbours, and native buttons floating over
 * a web scroller ate every drag, so the row could not scroll at all.
 *
 * The web chips render as the fallback and keep the strip's height; while
 * native owns the row their contents go invisible and inert, and their
 * widths no longer matter, because nothing native aligns to them.
 */
export const GlassChipRow: React.FC<{
  id: string;
  className?: string;
  items: Array<{
    id: string;
    /** SF Symbol for the native capsule. Omit for text-only chips. */
    symbol?: string;
    title: string;
    /** Chosen — prominent (tinted) glass with white on it. */
    prominent?: boolean;
    label?: string;
    onClick: () => void;
    /** Web fallback icon. */
    icon?: React.ReactNode;
  }>;
}> = ({ id, className, items }) => {
  const onGlass = useContext(OnGlass);
  const active = useGlassButtonsActive() && !onGlass;
  const key = `${id}#${useId()}`;
  const ref = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const shape = JSON.stringify(items.map((i) => [i.id, i.symbol, i.title, i.prominent]));

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    registry.set(key, {
      el,
      symbol: '',
      label: '',
      kind: 'chips',
      onTap: () => {},
      segments: itemsRef.current.map((item) => ({
        id: `${key}/${item.id}`,
        symbol: item.symbol ?? '',
        title: item.title,
        active: item.prominent ?? false,
        // The chosen chip's fill. Selection is the brand's rust everywhere
        // else in the app, so it is here too.
        tint: 'primary' as const,
        label: item.label ?? item.title,
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
    <div ref={ref} className={className} role="group">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          aria-label={item.label ?? item.title}
          aria-pressed={item.prominent || undefined}
          aria-hidden={active || undefined}
          tabIndex={active ? -1 : undefined}
          className={cn('map-chip', !active && item.prominent && 'is-accent', active && 'opacity-0')}
        >
          {item.icon}
          {item.title}
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

/**
 * Register a web search field as a *native* one — a real `UITextField` on a
 * real `UIGlassEffect` capsule, drawn over the web element's box.
 *
 * The buttons moved native because CSS cannot refract; the field beside them
 * was the last CSS imposter, and against a genuine lens the difference shows.
 * A field is more entangled than a button — it has text, focus and a keyboard
 * — so ownership reverses while native is active: typing happens in UIKit and
 * is reported here, and the page's own value is only *applied* when the page
 * genuinely decides it (clearing on close, a suggestion tapped). That
 * decision is what the generations in `GlassFieldState` encode.
 *
 * Focus follows editability: a field that just stopped being read-only is a
 * field being opened, so the keyboard rises without the caller having to say
 * so twice — and a field going read-only takes the keyboard down with it.
 * Everywhere the native layer is inactive the caller's CSS field renders
 * untouched, exactly like `GlassButton`.
 */
export function useGlassField(options: {
  /** Omit to keep the field CSS everywhere — the hook still runs (rules of
   *  hooks) but registers nothing. */
  id?: string;
  value: string;
  placeholder: string;
  editable: boolean;
  label?: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  /** The read-only state's tap — a field that is really a button. */
  onPress?: () => void;
  /** Raise the keyboard as soon as the native field exists — for a field
   *  born editable inside an opening overlay, where there is no read-only →
   *  editable transition to carry the focus. */
  autoFocus?: boolean;
  /** The leading SF Symbol. The search fields wear the magnifier (default);
   *  the location field wears the compass arrow. */
  symbol?: string;
}): { ref: (el: HTMLElement | null) => void; active: boolean } {
  const { id, value, placeholder, editable, label, onChange, onSubmit, onPress, autoFocus, symbol } = options;
  const onGlass = useContext(OnGlass);
  const active = useGlassButtonsActive() && !onGlass && !!id;
  const key = `${id ?? 'field'}#${useId()}`;
  const elRef = useRef<HTMLElement | null>(null);
  // Latest handlers without re-registering — same pattern as GlassButton.
  const handlers = useRef({ onChange, onSubmit, onPress });
  handlers.current = { onChange, onSubmit, onPress };

  // What the native side last reported. Comparing the incoming `value`
  // against this is how a deliberate page-side set is told apart from the
  // echo of native typing.
  const lastNative = useRef(value);
  // One object for the field's whole life; the sampler reads it each frame.
  const state = useRef<GlassFieldState | null>(null);
  if (state.current === null) {
    state.current = {
      text: value,
      textGen: 0,
      focused: false,
      focusGen: 0,
      editable,
      onChangeText: (text) => {
        lastNative.current = text;
        handlers.current.onChange(text);
      },
      onSubmit: () => handlers.current.onSubmit?.(),
    };
  }

  useEffect(() => {
    const s = state.current;
    if (!s || s.text === value) return;
    s.text = value;
    if (value !== lastNative.current) {
      // The page decided this value itself — advance the generation so the
      // native side applies it.
      s.textGen += 1;
      lastNative.current = value;
    }
    wake();
  }, [value]);

  const prevEditable = useRef(editable);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.editable = editable;
    if (prevEditable.current !== editable) {
      prevEditable.current = editable;
      s.focused = editable;
      s.focusGen += 1;
    }
    wake();
  }, [editable]);

  const didAutoFocus = useRef(false);
  useEffect(() => {
    const el = elRef.current;
    const field = state.current;
    if (!active || !el || !field) return;
    if (autoFocus && field.editable && !didAutoFocus.current) {
      didAutoFocus.current = true;
      field.focused = true;
      field.focusGen += 1;
    }
    registry.set(key, {
      el,
      symbol: symbol ?? 'magnifyingglass',
      title: placeholder,
      titleStyle: 'field',
      label: label ?? placeholder,
      onTap: () => handlers.current.onPress?.(),
      field,
    });
    wake();
    return () => {
      registry.delete(key);
      wake();
    };
  }, [active, key, placeholder, label, symbol]);

  const ref = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);
  return { ref, active };
}
