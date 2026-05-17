/**
 * Capacitor keyboard integration: hide the iOS input accessory bar at
 * launch, and surface keyboard show/hide events so UI chrome (the bottom
 * nav, primarily) can react.
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

export async function configureNativeKeyboard(
  options: NativeKeyboardOptions = {},
): Promise<NativeKeyboardHandle> {
  const noop: NativeKeyboardHandle = { destroy() {} };
  if (!Capacitor.isNativePlatform()) return noop;

  // Hide the iOS input accessory view (the bar with up/down chevrons and
  // a check button that sits between the keyboard and the page). Has no
  // effect on Android, where the plugin's implementation is a no-op.
  try {
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
  } catch (err) {
    // Log but don't throw — the rest of the app shouldn't care if the
    // plugin happens to be missing on this build.
    console.warn('[native-keyboard] setAccessoryBarVisible failed:', err);
  }

  const handles = await Promise.all([
    Keyboard.addListener('keyboardWillShow', () => options.onKeyboardChange?.(true)),
    Keyboard.addListener('keyboardDidHide', () => options.onKeyboardChange?.(false)),
  ]);

  return {
    destroy() {
      handles.forEach((h) => h.remove());
    },
  };
}
