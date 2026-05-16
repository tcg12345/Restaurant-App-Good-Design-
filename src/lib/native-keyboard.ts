/**
 * One-shot configuration for the iOS keyboard on Capacitor builds.
 *
 * Two problems on iPhone the web app has no control over:
 *
 *  1. iOS WKWebView shows a system "input accessory view" above the
 *     keyboard — the white bar with up/down chevrons and a Done /
 *     check button. It's purely a native UI element; from JS the only
 *     way to hide it is via the Capacitor Keyboard plugin's
 *     setAccessoryBarVisible API.
 *
 *  2. When the keyboard opens, iOS shrinks the WKWebView so the focused
 *     input stays in view. By default the app's whole document height
 *     shrinks too, which lets the user scroll past the end of the page
 *     into empty space until the keyboard closes. The Keyboard plugin's
 *     `resize: 'none'` mode (configured natively in capacitor.config.json)
 *     keeps the webview full-height and lets iOS pan to the focused input
 *     instead — matching how native apps behave.
 *
 * This file handles #1 at JS runtime; #2 lives in capacitor.config.json.
 * Both are no-ops on the web (where `window.Capacitor` is undefined) so
 * dev / preview builds aren't affected.
 *
 * The plugin is accessed off `window.Capacitor.Plugins.Keyboard` rather
 * than imported, so the JS bundle has zero dependency on @capacitor/*
 * being in package.json — the call quietly no-ops until the plugin is
 * added to the iOS project (via SPM + `npx cap sync ios`).
 */

type KeyboardPlugin = {
  setAccessoryBarVisible?: (options: { isVisible: boolean }) => Promise<void>;
};

type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  Plugins?: { Keyboard?: KeyboardPlugin };
};

export async function configureNativeKeyboard(): Promise<void> {
  if (typeof window === 'undefined') return;
  const cap = (window as unknown as { Capacitor?: CapacitorRuntime }).Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  try {
    await cap.Plugins?.Keyboard?.setAccessoryBarVisible?.({ isVisible: false });
  } catch {
    // Plugin not installed natively yet — silently ignore. Once
    // @capacitor/keyboard is added in Xcode and synced, this starts
    // working without any further JS changes.
  }
}
