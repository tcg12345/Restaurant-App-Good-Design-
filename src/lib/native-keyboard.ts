/**
 * Capacitor keyboard integration. Makes the on-screen keyboard feel like
 * the standard iOS one and easy to dismiss:
 *
 *   - Keeps the bare native keyboard (no extra input-accessory toolbar) so it
 *     looks like the system keyboard — just the predictive-text bar and keys.
 *     The toolbar (prev/next chevrons + Done) rendered as a dark band above
 *     the keyboard that didn't match iOS and looked broken; tap-outside
 *     (below) is how the keyboard is dismissed instead.
 *   - Pairs with `resize: "none"` (capacitor.config.json): the web view is
 *     never shrunk, so the page is NOT pushed up and there's no black strip —
 *     the keyboard overlays the bottom of the full-screen, app-colored web
 *     view. iOS itself keeps position:fixed elements (the full-screen AI chat
 *     panel, bottom sheets) above the keyboard, so no manual lifting is needed;
 *     top-anchored search bars already sit above it.
 *   - Dismisses the keyboard when the user taps (or starts scrolling on)
 *     anything that isn't a text field, which is what people expect on
 *     iOS but a web view doesn't do on its own.
 *   - Surfaces keyboard show/hide events so UI chrome (the bottom nav,
 *     chat island, etc.) can react.
 *
 * Uses the typed @capacitor/keyboard API. The imports tree-shake to nothing
 * on the web — Capacitor's web stubs are tiny — and the
 * `Capacitor.isNativePlatform()` guard means the actual native calls only
 * run inside the iOS shell.
 */

import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

export interface NativeKeyboardHandle {
  /** Tear down the keyboard event listeners. Idempotent. */
  destroy(): void;
}

export interface NativeKeyboardOptions {
  /** Called every time the keyboard transitions show ↔ hide. */
  onKeyboardChange?: (open: boolean) => void;
}

/** Is this node (or one of its ancestors) a text-editing field? */
function isEditableTarget(node: EventTarget | null): boolean {
  let el = node instanceof HTMLElement ? node : null;
  while (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

export async function configureNativeKeyboard(
  options: NativeKeyboardOptions = {},
): Promise<NativeKeyboardHandle> {
  const noop: NativeKeyboardHandle = { destroy() {} };
  if (!Capacitor.isNativePlatform()) return noop;

  // Hide the WebView input accessory bar (the dark toolbar with prev/next
  // chevrons + Done). It rendered as a black band above the keyboard that
  // looked nothing like the system keyboard; without it we get the bare
  // iOS keyboard (predictive bar + keys). Tap-outside (below) dismisses it.
  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
  } catch (err) {
    // Log but don't throw — the rest of the app shouldn't care if the
    // plugin happens to be missing on this build.
    console.warn('[native-keyboard] setAccessoryBarVisible failed:', err);
  }

  // Tap / scroll outside a field to dismiss the keyboard. A web view won't
  // blur the focused input when you tap a plain element, so the keyboard
  // gets "stuck"; this restores the native feel. Runs in the capture phase
  // so the field blurs before the tapped element's own handlers fire — a
  // tapped button still receives its click, the keyboard just slides away.
  const onPointerDown = (e: PointerEvent) => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    const activeIsField =
      active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
    if (!activeIsField) return;
    // Tapping another field: let focus move there instead of dismissing.
    if (isEditableTarget(e.target)) return;
    active.blur();
  };
  document.addEventListener('pointerdown', onPointerDown, true);

  // Publish two CSS variables so keyboard-aware panels can react:
  //   --app-vh    the visible viewport height (area above the keyboard)
  //   --kb-height the keyboard's height (0 when closed)
  // A full-screen panel can stay pinned to all four edges (so its opaque
  // background covers behind the translucent iOS keyboard) and simply pad
  // its content up by --kb-height; a panel that prefers to size itself can
  // use --app-vh instead.
  //
  // With Keyboard.resize:"none" the WKWebView is never resized, and its
  // VisualViewport does NOT shrink for the keyboard — so the keyboard
  // events (which report the exact keyboard height before the animation
  // starts) are the source of truth while it's open. A `kb-open` class on
  // <html> lets CSS drop bottom safe-area padding that would otherwise
  // leave a dead gap above the keyboard (the home indicator is covered).
  // The VisualViewport listener still handles non-keyboard size changes
  // (rotation, split view) while the keyboard is closed.
  const root = document.documentElement;
  const setAppVh = (h: number) => root.style.setProperty('--app-vh', `${Math.round(h)}px`);
  const setKbHeight = (h: number) => root.style.setProperty('--kb-height', `${Math.round(h)}px`);
  let keyboardHeight = 0;

  // Because the web view is never resized (resize:"none"), the keyboard
  // simply overlays the bottom of the page — a focused field low on the
  // screen ends up hidden behind it. Keyboard-aware panels pad their
  // scroll area by --kb-height, which creates the *room* to scroll clear,
  // but nothing scrolls automatically. Do that here: once the keyboard
  // (and the padding it triggers) is in, scroll the focused field into
  // the middle of its scroll container. Also re-run on focus moves while
  // the keyboard stays up (tabbing between fields doesn't re-fire
  // keyboardWillShow).
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  const revealActiveField = () => {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      if (keyboardHeight <= 0) return;
      const el = document.activeElement as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) return;
      // Fields above the keyboard already visible? Only nudge when the
      // field's bottom is at (or under) the keyboard's top edge.
      const kbTop = window.innerHeight - keyboardHeight;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= kbTop - 12 && rect.top >= 0) return;
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        el.scrollIntoView();
      }
    }, 250); // let the kb-height padding land first
  };
  const onFocusIn = () => revealActiveField();
  document.addEventListener('focusin', onFocusIn);
  const vv = window.visualViewport;
  const syncViewportHeight = () => {
    if (keyboardHeight > 0) {
      // Rotating with the keyboard up: the old early-return froze --app-vh
      // at the value computed at keyboardWillShow, leaving both vars wrong
      // until a hide/show cycle. Recompute from the CURRENT window height
      // minus the known keyboard height; iOS re-fires keyboardWillShow
      // with the new height after rotation, which refines it again.
      setAppVh(window.innerHeight - keyboardHeight);
      return;
    }
    setAppVh(vv?.height ?? window.innerHeight);
  };
  if (vv) {
    vv.addEventListener('resize', syncViewportHeight);
    vv.addEventListener('scroll', syncViewportHeight);
    syncViewportHeight();
  }
  setKbHeight(0);

  const handles = await Promise.all([
    Keyboard.addListener('keyboardWillShow', (info) => {
      keyboardHeight = info?.keyboardHeight ?? 0;
      // Only a real, bottom-docked keyboard counts as OPEN. A hardware
      // keyboard's shortcut bar and floating/undocked iPad keyboards report
      // ~0 height — the old unconditional onKeyboardChange(true) hid the
      // whole bottom nav for those with nothing actually covering the
      // screen. Zero-height frames are treated as closed instead.
      if (keyboardHeight > 0) {
        setAppVh(window.innerHeight - keyboardHeight);
        setKbHeight(keyboardHeight);
        root.classList.add('kb-open');
        revealActiveField();
      } else {
        root.classList.remove('kb-open');
        setKbHeight(0);
        setAppVh(vv?.height ?? window.innerHeight);
      }
      options.onKeyboardChange?.(keyboardHeight > 0);
    }),
    Keyboard.addListener('keyboardWillHide', () => {
      keyboardHeight = 0;
      root.classList.remove('kb-open');
      setKbHeight(0);
      setAppVh(vv?.height ?? window.innerHeight);
    }),
    Keyboard.addListener('keyboardDidHide', () => options.onKeyboardChange?.(false)),
  ]);

  return {
    destroy() {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
      clearTimeout(revealTimer);
      if (vv) {
        vv.removeEventListener('resize', syncViewportHeight);
        vv.removeEventListener('scroll', syncViewportHeight);
      }
      root.classList.remove('kb-open');
      handles.forEach((h) => h.remove());
    },
  };
}
