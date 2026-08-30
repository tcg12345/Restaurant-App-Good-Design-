import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
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
  /** Show scores at their full two-decimal storage precision (8.37) in the
   *  PROMINENT score surfaces — hero discs, list rows, profile stats.
   *  Off (the default) rounds display to one decimal (8.4). Dense chrome
   *  (map markers, tiny chips) stays one-decimal regardless — see
   *  lib/score.formatScore. Ratings are STORED at two decimals either way
   *  (settleScores.MIN_GAP), so flipping this loses nothing. */
  twoDecimalScores: boolean;
  toggleTwoDecimalScores: () => void;
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
  twoDecimalScores: false,
  toggleTwoDecimalScores: () => {},
});

export const useSettings = () => useContext(SettingsContext);

const DARK_MODE_KEY = 'gourmad-dark-mode';
const SCORE_DECIMALS_KEY = 'gourmad-score-decimals';
const DARK_QUERY = '(prefers-color-scheme: dark)';

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

/** The side the user picked in Settings, or null if they never have.
 *  The null case is the whole point: "hasn't chosen" is what lets the app
 *  mirror the system, and it only survives because nothing is written to
 *  storage until the toggle is actually used. */
function storedDarkMode(): boolean | null {
  try {
    const raw = localStorage.getItem(DARK_MODE_KEY);
    return raw === null ? null : raw === '1';
  } catch { return null; }
}

function systemPrefersDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

/** A fresh install has no choice to honour, so it opens in whatever the
 *  system is set to; the app only overrides the OS once the user has
 *  picked a side. (index.html runs this same rule inline so <html> is
 *  already the right colour on the first paint — keep the two in step.) */
function loadDarkMode(): boolean {
  return storedDarkMode() ?? systemPrefersDark();
}

function loadTwoDecimalScores(): boolean {
  try {
    return localStorage.getItem(SCORE_DECIMALS_KEY) === '2';
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
  const darkModeRef = useRef(darkMode);
  darkModeRef.current = darkMode;
  // Whether the user has picked a side. This used to be written on mount,
  // which meant a first run recorded a "choice" nobody made — after one
  // launch there was no way to tell "never chose" from "chose light", and
  // the app could never defer to the system again.
  const themeChosenRef = useRef<boolean>(storedDarkMode() !== null);

  // Apply the dark class to <html> so Tailwind's @custom-variant dark
  // selector matches everywhere, and mirror the theme onto the native
  // chrome (status-bar style + the window's interface style) so it can
  // never disagree with the page. Persisting is NOT done here — only an
  // explicit choice is written (see setDarkMode).
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    void applyNativeTheme(darkMode);
  }, [darkMode]);

  // Follow the system for as long as the user hasn't picked a side, so a
  // phone that flips to dark at sunset takes the app with it.
  //
  // Native builds effectively only get this at launch: applyNativeTheme
  // pins the window's overrideUserInterfaceStyle, and from then on the web
  // view's prefers-color-scheme reports that override rather than the OS.
  // The window is never overridden before the web app asks for it, so a
  // cold launch still reads the real system setting — which is the case
  // that matters here.
  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      if (!themeChosenRef.current) setDarkModeState(e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setDarkMode = useCallback((on: boolean) => {
    themeChosenRef.current = true;
    try { localStorage.setItem(DARK_MODE_KEY, on ? '1' : '0'); } catch { /* private mode: the choice lasts the session */ }
    setDarkModeState(on);
  }, []);
  const toggleDarkMode = useCallback(() => setDarkMode(!darkModeRef.current), [setDarkMode]);

  const [twoDecimalScores, setTwoDecimalScores] = useState<boolean>(() => loadTwoDecimalScores());
  useEffect(() => {
    try { localStorage.setItem(SCORE_DECIMALS_KEY, twoDecimalScores ? '2' : '1'); } catch {}
  }, [twoDecimalScores]);
  const toggleTwoDecimalScores = useCallback(() => {
    setTwoDecimalScores((prev) => !prev);
  }, []);

  return (
    <SettingsContext.Provider value={{ phoneMode, isNative, hideBottomNav, setHideBottomNav, keyboardOpen, setKeyboardOpen, darkMode, toggleDarkMode, setDarkMode, twoDecimalScores, toggleTwoDecimalScores }}>
      {children}
    </SettingsContext.Provider>
  );
};
