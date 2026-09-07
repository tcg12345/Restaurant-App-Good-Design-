import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { applyNativeTheme } from '../lib/native-theme';

export type AppearanceMode = 'system' | 'light' | 'dark';

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
  appearance: AppearanceMode;
  setAppearance: (mode: AppearanceMode) => void;
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
  appearance: 'system',
  setAppearance: () => {},
  darkMode: false,
  toggleDarkMode: () => {},
  setDarkMode: () => {},
  twoDecimalScores: false,
  toggleTwoDecimalScores: () => {},
});

export const useSettings = () => useContext(SettingsContext);

const DARK_MODE_KEY = 'goodeats-dark-mode';
const SCORE_DECIMALS_KEY = 'goodeats-score-decimals';
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

/** Keep the existing key so explicit choices survive app updates. */
function storedAppearance(): AppearanceMode {
  try {
    const raw = localStorage.getItem(DARK_MODE_KEY);
    return raw === '1' ? 'dark' : raw === '0' ? 'light' : 'system';
  } catch { return 'system'; }
}

function systemPrefersDark(): boolean {
  try { return window.matchMedia(DARK_QUERY).matches; } catch { return false; }
}

/** A fresh install has no choice to honour, so it opens in whatever the
 *  system is set to; the app only overrides the OS once the user has
 *  picked a side. (index.html runs this same rule inline so <html> is
 *  already the right colour on the first paint — keep the two in step.) */
function loadDarkMode(): boolean {
  const mode = storedAppearance();
  return mode === 'system' ? systemPrefersDark() : mode === 'dark';
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
  const [appearance, setAppearanceState] = useState<AppearanceMode>(storedAppearance);
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    // System must clear the native window override; otherwise WebKit reports
    // the app's forced theme instead of subsequent device appearance changes.
    void applyNativeTheme(darkMode, appearance === 'system');
  }, [darkMode, appearance]);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      if (appearanceRef.current === 'system') setDarkModeState(e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setAppearance = useCallback((mode: AppearanceMode) => {
    appearanceRef.current = mode;
    try { localStorage.setItem(DARK_MODE_KEY, mode === 'system' ? 'system' : mode === 'dark' ? '1' : '0'); } catch { /* Keep the choice for this session if storage is unavailable. */ }
    setAppearanceState(mode);
    setDarkModeState(mode === 'system' ? systemPrefersDark() : mode === 'dark');
  }, []);
  const setDarkMode = useCallback((on: boolean) => setAppearance(on ? 'dark' : 'light'), [setAppearance]);
  const toggleDarkMode = useCallback(() => setDarkMode(!darkModeRef.current), [setDarkMode]);

  const [twoDecimalScores, setTwoDecimalScores] = useState<boolean>(() => loadTwoDecimalScores());
  useEffect(() => {
    try { localStorage.setItem(SCORE_DECIMALS_KEY, twoDecimalScores ? '2' : '1'); } catch {}
  }, [twoDecimalScores]);
  const toggleTwoDecimalScores = useCallback(() => {
    setTwoDecimalScores((prev) => !prev);
  }, []);

  return (
    <SettingsContext.Provider value={{ phoneMode, isNative, hideBottomNav, setHideBottomNav, keyboardOpen, setKeyboardOpen, appearance, setAppearance, darkMode, toggleDarkMode, setDarkMode, twoDecimalScores, toggleTwoDecimalScores }}>
      {children}
    </SettingsContext.Provider>
  );
};
