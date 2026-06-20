import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { applyNativeTheme } from '../lib/native-theme';

interface SettingsContextType {
  /** True on a real phone — either the Capacitor native runtime or any
   *  browser viewport below the desktop-sidebar breakpoint (<1024px).
   *  Fully automatic: there is no manual toggle and no intermediate
   *  "tablet" layout — the value tracks live viewport resizes. */
  phoneMode: boolean;
  /** True when the app is running inside a Capacitor native shell
   *  (iOS / Android). Surfaced for native-only concerns (keyboard
   *  plugin wiring, etc.). */
  isNative: boolean;
  hideBottomNav: boolean;
  setHideBottomNav: (hide: boolean) => void;
  /** True while the on-screen keyboard is up on a native build. Driven
   *  by the Capacitor Keyboard plugin's show/hide events from App.tsx;
   *  always false on the web. Consumers (BottomNav, etc.) hide chrome
   *  while the user is typing. */
  keyboardOpen: boolean;
  setKeyboardOpen: (open: boolean) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (on: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  phoneMode: false,
  isNative: false,
  hideBottomNav: false,
  setHideBottomNav: () => {},
  keyboardOpen: false,
  setKeyboardOpen: () => {},
  darkMode: false,
  toggleDarkMode: () => {},
  setDarkMode: () => {},
});

export const useSettings = () => useContext(SettingsContext);

const DARK_MODE_KEY = 'gourmad-dark-mode';

/** Detect a Capacitor-wrapped native runtime. Returns false on the
 *  plain web app and during SSR. */
function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!(cap?.isNativePlatform?.());
}

/** Phone/narrow viewport breakpoint. Deliberately the exact inverse of the
 *  desktop-sidebar query in App.tsx (`min-width: 1024px`) so there is NO gap
 *  between the two: every viewport is either phone (this) or desktop-sidebar.
 *  Without this, 769–1023px fell through both and rendered a third "tablet"
 *  layout (floating pill navbar + title header) that should never exist.
 *  1023.98px (not 1023px) closes the sub-pixel seam on fractional widths. */
const NARROW_QUERY = '(max-width: 1023.98px)';

function loadDarkMode(): boolean {
  try {
    // Default to light mode unless the user explicitly opted into dark
    // via the Settings toggle. We deliberately ignore the OS-level
    // prefers-color-scheme so the app's first run is always the light
    // editorial palette.
    return localStorage.getItem(DARK_MODE_KEY) === '1';
  } catch { return false; }
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Capacitor flag is captured once on mount — it can't change for the
  // life of the app instance.
  const [isNative] = useState<boolean>(() => isNativePlatform());
  // Live viewport signal — phone mode follows the real window size, so
  // resizing across the breakpoint (or rotating a tablet) swaps layouts
  // without a reload.
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const phoneMode = isNative || isNarrowViewport;
  const [hideBottomNav, setHideBottomNav] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [darkMode, setDarkModeState] = useState<boolean>(() => loadDarkMode());

  // Apply the dark class to <html> so Tailwind's @custom-variant dark
  // selector matches everywhere, persist the user's choice, and mirror
  // the theme onto the native chrome (status-bar style + the window's
  // interface style) so it can never disagree with the page.
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem(DARK_MODE_KEY, darkMode ? '1' : '0'); } catch {}
    void applyNativeTheme(darkMode);
  }, [darkMode]);

  const setDarkMode = useCallback((on: boolean) => setDarkModeState(on), []);
  const toggleDarkMode = useCallback(() => {
    setDarkModeState((prev) => !prev);
  }, []);

  return (
    <SettingsContext.Provider value={{ phoneMode, isNative, hideBottomNav, setHideBottomNav, keyboardOpen, setKeyboardOpen, darkMode, toggleDarkMode, setDarkMode }}>
      {children}
    </SettingsContext.Provider>
  );
};
