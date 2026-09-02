import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isFeatureTourPending, markFeatureTourDone } from '../lib/feature-tour';
import { isOverlayOpen } from '../lib/overlay-registry';

/**
 * The post-onboarding feature tour: one small dark card at a time, each with
 * a caret pointing at a real control, walking a brand-new account through the
 * app's main surfaces. "Next" advances — navigating between tabs itself when
 * the next stop lives on another page — "Skip" (or finishing) burns the tour
 * for good.
 *
 * Two constraints shape everything here:
 *
 * - On iOS 26 the tab bar and the header buttons are REAL UIKit views above
 *   the WKWebView. A web layer cannot dim them, spotlight them, or block
 *   their touches — so the tour draws no scrim (cards sit beside the chrome
 *   and point at it; the DOM twins still measure correctly), and a native
 *   tab tap mid-tour is treated as "I'll explore myself": the tour stands
 *   down instead of fighting the navigation.
 *
 * - Keep-alive keeps every visited tab mounted but `visibility: hidden`, and
 *   TopBar mounts its condensed twin at opacity 0, so a bare querySelector
 *   routinely lands on an invisible copy of the thing being pointed at.
 *   Anchors are therefore resolved through findVisible(), never directly.
 *
 * - Most of the controls worth pointing at (GlassButton, GlassGroup,
 *   useGlassSegments — lib/glass-buttons.tsx) are themselves native Liquid
 *   Glass on iOS 26: the DOM twin the tour measures renders nothing by
 *   design, `aria-hidden="true"`, while UIKit paints the real thing on top
 *   of it out-of-band with no completion signal back to JS. findVisible()
 *   still finds these — the box is real, the layout is real — but the
 *   pixels under that box are only trustworthy once native has actually
 *   caught up, which routinely takes a beat longer than a fresh route's
 *   first paint. Pointing a card at one immediately is how the tour ends up
 *   captioning blank space. isNativeControlled() flags these, and the
 *   resolver holds them for NATIVE_SETTLE_MS before placing a card.
 */

interface TourStep {
  route: string;
  /** Selector for the element the caret points at; null centers the card. */
  find: string | null;
  title: string;
  body: string;
}

/**
 * Order and picks are deliberate, not just "walk the tabs":
 *
 * - Rank, then circle, come first and both live on `/` — no navigation
 *   between them, which is also the pair least likely to hit a native-glass
 *   settle race, since the tour's first two stops are the two moments
 *   least cushioned by an intervening page transition.
 * - Circle moved up from second-to-last to second overall. A brand-new
 *   account has no friends and an empty feed by construction — that's the
 *   single biggest reason someone bounces before ranking anything, and
 *   it's exactly the gap the taste-matched "People to follow" suggestions
 *   (lib/suggestions.ts) exist to close. Burying that behind search, lists,
 *   and a profile-stats step meant most people skipped the tour before
 *   ever seeing it.
 * - The old "Your feed" filter step (friends/verified/recipes toggle) is
 *   cut. It's real screen real estate teaching a control that, for an
 *   account with zero follows and zero ratings, has nothing different to
 *   show behind any of its three positions yet — a step that explains a
 *   distinction the viewer can't perceive.
 */
const STEPS: TourStep[] = [
  {
    route: '/',
    find: '.tour-create',
    title: 'Rank restaurants',
    body: 'The heart of the app. Tap + to rate a place you’ve been — a few quick head-to-head picks slot it into your ranked list with a score out of 10.',
  },
  {
    route: '/',
    find: '[aria-label="Your Circle"]',
    title: 'Build your circle',
    body: 'Your feed is empty until you follow people. Tap here for friend requests and people matched to your taste — cuisines, price, where you live.',
  },
  {
    route: '/search',
    find: '[data-tour="search-field"]',
    title: 'Search the map',
    body: 'The Search tab is a live map. Look up restaurants, dishes, or people, and narrow things down by cuisine, price, or open now.',
  },
  {
    route: '/pantry',
    find: '[data-tour="pantry-tabs"]',
    title: 'Your lists',
    body: 'Everything you rank or save lands here — your ranked list, wishlist, and collections. Switch to Recipes for the dishes you cook at home.',
  },
  {
    route: '/profile',
    find: '[data-tour="profile-stats"]',
    title: 'Your profile',
    body: 'Your ranked favorites, taste stats, and posts — this is the page friends see when they find you.',
  },
  {
    route: '/',
    find: null,
    title: 'That’s the tour',
    body: 'Check out Reels for short food videos, and start ranking — recommendations, and who we suggest following, get smarter with every restaurant you add.',
  },
];

/** Routes where the tour may begin. Arming happens in ProfileSetup, but the
 *  wizard's "verify me" fork can drop the user on /verify/apply — starting
 *  there would yank them out of that flow, so the tour waits for a root. */
const START_ROUTES = new Set(['/', '/search', '/pantry', '/profile', '/reels']);

/** The candidate that is actually on screen (see the header comment). */
function findVisible(selector: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    // `visibility` is inherited, so one read covers a hidden layer at any depth.
    if (getComputedStyle(el).visibility === 'hidden') continue;
    let node: HTMLElement | null = el;
    let ghost = false;
    while (node && node !== document.body) {
      if (parseFloat(getComputedStyle(node).opacity) < 0.05) { ghost = true; break; }
      node = node.parentElement;
    }
    if (!ghost) return el;
  }
  return null;
}

/** True when this element (or something inside it) has handed its visible
 *  content off to native Liquid Glass. GlassButton and a GlassGroup region
 *  set `aria-hidden="true"` directly on the anchor itself the instant
 *  native takes over; useGlassSegments (the pantry tabs wrapper) sets it on
 *  the fallback buttons a level down instead, so the check also looks
 *  inside. Either way, the flag means the same thing: what's drawn here now
 *  is native's job, not the DOM's, and native hasn't confirmed it's drawn
 *  it yet. */
export function isNativeControlled(el: HTMLElement): boolean {
  return el.getAttribute('aria-hidden') === 'true' || !!el.querySelector('[aria-hidden="true"]');
}

/** How long to hold a native-controlled anchor before trusting it's actually
 *  painted: one sampler tick (lib/glass-buttons.tsx's rAF loop) to notice
 *  the registration, a native round trip to create and position the real
 *  view, and a compositor commit — with margin for a cold-start route
 *  that's competing with everything else spinning up right after signup. */
const NATIVE_SETTLE_MS = 420;

/** `forStep` stamps which step a placement belongs to: on a cross-page
 *  "Next", the effects of the new step run in the same commit that still
 *  holds the OLD step's placement, and the walked-away check below must not
 *  read that stale pairing as the user leaving the tour. */
type Placement =
  | { kind: 'anchored'; forStep: number; top: number; bottom: number; left: number; right: number; cx: number }
  | { kind: 'center'; forStep: number };

const INK = '#221e1c';
const EDGE = '1px solid rgba(255,255,255,0.09)';

export const FeatureTour: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [placed, setPlaced] = useState<Placement | null>(null);
  // Bumped on resize/rotation to re-resolve the current anchor.
  const [nonce, setNonce] = useState(0);
  // react-router hands out a NEW navigate identity on every location change.
  // The resolver effect must run once per step — with navigate in its deps,
  // its own navigation re-armed it (resetting the walked-away and fail-open
  // clocks), and an auth-gated route that redirects made that a ping-pong
  // loop: navigate(step) → redirect → new identity → navigate(step) → …
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // ── Begin, once the pending flag and a tab root line up ────────────────
  useEffect(() => {
    if (running || !isFeatureTourPending()) return;
    if (!START_ROUTES.has(location.pathname)) return;
    // A beat after landing: the tab bar's entrance spring and the page's
    // first paint settle before the first card measures anything. Longer
    // than it looks like it needs to be on purpose — this fires right after
    // signup, the single heaviest cold-start moment the app has (auth,
    // profile fetch, initial feed, every header's native glass registering
    // for the first time), all competing for the same main thread this
    // timer is also waiting on.
    const t = setTimeout(() => {
      if (!isOverlayOpen()) setRunning(true);
    }, 1100);
    return () => clearTimeout(t);
  }, [location.pathname, running]);

  // ── Resolve the current step's anchor (navigating there first) ─────────
  useEffect(() => {
    if (!running) return;
    const step = STEPS[stepIdx];
    let cancelled = false;
    let timer: number | undefined;
    setPlaced(null);
    if (window.location.pathname !== step.route) navigateRef.current(step.route);
    const started = Date.now();

    const finish = () => { markFeatureTourDone(); setRunning(false); };
    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setPlaced({ kind: 'anchored', forStep: stepIdx, top: r.top, bottom: r.bottom, left: r.left, right: r.right, cx: r.left + r.width / 2 });
    };
    const placeWhenInView = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        timer = window.setTimeout(() => { if (!cancelled) place(el); }, 80);
      } else place(el);
    };
    // When a found anchor is native-controlled, this is when it was FIRST
    // found — not when the step started — so the settle window measures
    // "how long has native had this specific registration," not "how long
    // has this step been resolving" (which would double-count time already
    // spent scanning for the anchor at all).
    let nativeFoundAt: number | null = null;
    const tick = () => {
      if (cancelled) return;
      if (window.location.pathname === step.route) {
        if (!step.find) { setPlaced({ kind: 'center', forStep: stepIdx }); return; }
        const el = findVisible(step.find);
        if (el) {
          if (!isNativeControlled(el)) { placeWhenInView(el); return; }
          if (nativeFoundAt === null) nativeFoundAt = Date.now();
          if (Date.now() - nativeFoundAt >= NATIVE_SETTLE_MS) { placeWhenInView(el); return; }
          // Found, but give native Liquid Glass more time to actually paint
          // over it before a card points here — falls through to the retry
          // tail below rather than placing early.
        } else {
          nativeFoundAt = null;
        }
      } else if (Date.now() - started > 700) {
        // A native tab-bar tap (unblockable from the web layer) carried the
        // user somewhere else mid-resolve. Their move — stand down.
        finish();
        return;
      }
      if (Date.now() - started > 3500) {
        // Anchor never surfaced (markup moved, feature absent for this
        // account): fail open to the next stop rather than wedging.
        if (stepIdx >= STEPS.length - 1) finish();
        else setStepIdx(stepIdx + 1);
        return;
      }
      timer = window.setTimeout(tick, 120);
    };
    timer = window.setTimeout(tick, 60);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [running, stepIdx, nonce]);

  // ── A placed card whose page walks away ends the tour quietly ──────────
  useEffect(() => {
    if (!running || !placed || placed.forStep !== stepIdx) return;
    if (location.pathname !== STEPS[stepIdx].route) {
      markFeatureTourDone();
      setRunning(false);
    }
  }, [location.pathname, running, placed, stepIdx]);

  useEffect(() => {
    if (!running) return;
    const onResize = () => setNonce((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [running]);

  // The blocker holds the page still under the card — but as one full-screen
  // div it used to sit over the very control being pointed at too, and the
  // native-glass occlusion sampler (lib/glass-buttons.tsx) reads THAT the
  // same way a real scrim reads: something opaque is on top, so tell native
  // this button's alpha is 0. Every anchored step was captioning a control
  // native had been told, for as long as the card stayed up, not to draw.
  // Splitting the blocker into up to four bands around a cutout at the
  // anchor's rect (see the `bands` geometry below) removes that div from
  // directly over the anchor, so native paints it normally, while every
  // other pixel is still covered exactly as before. Native taps on the
  // anchor were never blockable through the web layer anyway (see the
  // header comment), so the cutout gives up nothing there.
  //
  // Native listeners on each band itself, not React handlers: scroll/pull
  // chrome listens on window, and stopping propagation at the deepest
  // target is what keeps a drag on a band from reading as a pull-to-refresh
  // or a wheel scroll. A callback ref is enough — no separate effect —
  // because each band is a fresh element for its own placement; React
  // discards it, listeners and all, the moment the anchor moves or the step
  // changes.
  const bindBand = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    el.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  }, []);

  if (!running) return null;

  const step = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const end = () => { markFeatureTourDone(); setRunning(false); };
  const next = () => { if (isLast) end(); else setStepIdx(stepIdx + 1); };
  // A stale placement (the commit where stepIdx moved on but the resolver
  // hasn't cleared yet) must not paint the new step at the old spot.
  const shown = placed && placed.forStep === stepIdx ? placed : null;

  // ── Geometry ───────────────────────────────────────────────────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(330, vw - 32);
  const safeBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat-bottom')) || 0;
  let pos: React.CSSProperties = {};
  let arrow: { x: number; side: 'top' | 'bottom' } | null = null;
  if (shown?.kind === 'anchored') {
    const GAP = 13;
    const EST_H = 190;
    const left = Math.min(Math.max(shown.cx - cardW / 2, 12), vw - cardW - 12);
    const below = shown.bottom + GAP + EST_H < vh - (50 + safeBottom + 16);
    pos = below
      ? { left, top: shown.bottom + GAP }
      : { left, bottom: vh - shown.top + GAP };
    arrow = { x: Math.min(Math.max(shown.cx - left, 24), cardW - 24), side: below ? 'top' : 'bottom' };
  } else if (shown?.kind === 'center') {
    pos = { left: (vw - cardW) / 2, top: vh * 0.36 };
  }

  // Up to four bands framing a cutout at the anchor's rect — see the
  // bindBand comment for why the cutout exists at all. No anchor yet (still
  // resolving) or a centred step (no anchor at all): one band, the full
  // screen, same as before.
  const HOLE_PAD = 6;
  const bands: Array<{ left: number; top: number; width: number; height: number }> = [];
  if (shown?.kind === 'anchored') {
    const hole = {
      left: Math.max(0, shown.left - HOLE_PAD),
      top: Math.max(0, shown.top - HOLE_PAD),
      right: Math.min(vw, shown.right + HOLE_PAD),
      bottom: Math.min(vh, shown.bottom + HOLE_PAD),
    };
    if (hole.top > 0) bands.push({ left: 0, top: 0, width: vw, height: hole.top });
    if (hole.bottom < vh) bands.push({ left: 0, top: hole.bottom, width: vw, height: vh - hole.bottom });
    if (hole.left > 0) bands.push({ left: 0, top: hole.top, width: hole.left, height: hole.bottom - hole.top });
    if (hole.right < vw) bands.push({ left: hole.right, top: hole.top, width: vw - hole.right, height: hole.bottom - hole.top });
  } else {
    bands.push({ left: 0, top: 0, width: vw, height: vh });
  }

  return createPortal(
    <>
      {/* Above every web layer including the fallback tab bar (z-50) and the
          sheets/pickers band (z-[200]s); under the toast (z-[300]). Framed
          around the anchor's rect rather than one full-screen div — see the
          bindBand comment above. */}
      {bands.map((b, i) => (
        <div
          key={i}
          ref={bindBand}
          className="fixed z-[255]"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height, touchAction: 'none', overscrollBehavior: 'none' }}
          aria-hidden
        />
      ))}
      <div className="fixed inset-0 z-[260] pointer-events-none">
        <AnimatePresence mode="wait">
          {shown && (
            <motion.div
              key={stepIdx}
              role="dialog"
              aria-label={step.title}
              className="absolute pointer-events-auto rounded-2xl shadow-[0_24px_64px_-16px_rgba(0,0,0,0.5)]"
              style={{ ...pos, width: cardW, background: INK, border: EDGE }}
              initial={reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: arrow?.side === 'bottom' ? 7 : -7, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion
                ? { opacity: 0, transition: { duration: 0.12 } }
                : { opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              {arrow && (
                <div
                  aria-hidden
                  className="absolute w-3.5 h-3.5 rotate-45"
                  style={{
                    background: INK,
                    left: arrow.x - 7,
                    ...(arrow.side === 'top'
                      ? { top: -7, borderTop: EDGE, borderLeft: EDGE }
                      : { bottom: -7, borderBottom: EDGE, borderRight: EDGE }),
                  }}
                />
              )}
              <div className="px-4 pt-3.5 pb-3.5">
                <p className="text-[11px] font-bold tracking-[0.08em] uppercase text-white/40">
                  {stepIdx + 1} of {STEPS.length}
                </p>
                <h3 className="mt-1 text-[16px] font-bold text-white leading-snug">{step.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.5] text-white/70">{step.body}</p>
                <div className="mt-3.5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={end}
                    className="text-[13px] font-semibold text-white/45 active:text-white/75 transition-colors"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="h-9 px-4 rounded-full bg-primary text-on-primary text-[13.5px] font-bold active:scale-95 transition-transform"
                  >
                    {isLast ? 'Done' : 'Next'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>,
    document.body,
  );
};
