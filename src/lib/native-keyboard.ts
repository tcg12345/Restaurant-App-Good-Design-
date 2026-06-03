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
 *     the keyboard simply overlays the bottom of the (full-screen, app-colored)
 *     web view. We publish the keyboard height as `--keyboard-height` so the
 *     few bottom-anchored composers (AI chat, message/comment inputs) can lift
 *     their input above the keyboard; top-anchored search bars already sit
 *     above it and need nothing.
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

/** Publish (or clear) the keyboard height so CSS can lift bottom chrome. */
function setKeyboardHeightVar(px: number): void {
  document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, px)}px`);
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

  const handles = await Promise.all([
    Keyboard.addListener('keyboardWillShow', (info) => {
      setKeyboardHeightVar(info?.keyboardHeight ?? 0);
      options.onKeyboardChange?.(true);
    }),
    Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeightVar(0);
    }),
    Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeightVar(0);
      options.onKeyboardChange?.(false);
    }),
  ]);

  return {
    destroy() {
      document.removeEventListener('pointerdown', onPointerDown, true);
      setKeyboardHeightVar(0);
      handles.forEach((h) => h.remove());
    },
  };
}
