import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface SettingsContextType {
  phoneMode: boolean;
  togglePhoneMode: () => void;
  setPhoneMode: (on: boolean) => void;
  /** True when the app is running inside a Capacitor native shell
   *  (iOS / Android). Surfaced so App.tsx can suppress the desktop
   *  "phone frame" preview wrapper without losing the mobile UI
   *  gates that page-level code reads from `phoneMode`. */
  isNative: boolean;
  hideBottomNav: boolean;
  setHideBottomNav: (hide: boolean) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (on: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  phoneMode: false,
  togglePhoneMode: () => {},
  setPhoneMode: () => {},
  isNative: false,
  hideBottomNav: false,
  setHideBottomNav: () => {},
  darkMode: false,
  toggleDarkMode: () => {},
  setDarkMode: () => {},
});

export const useSettings = () => useContext(SettingsContext);

const PHONE_MODE_KEY = 'gourmad-phone-mode';
const DARK_MODE_KEY = 'gourmad-dark-mode';

/** Detect a Capacitor-wrapped native runtime. Returns false on the
 *  plain web app and during SSR. */
function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!(cap?.isNativePlatform?.());
}

function loadPhoneMode(): boolean {
  // Real mobile device — always on. Skips the persisted toggle so a
  // stale '0' from desktop preview doesn't disable the mobile UI on
  // the user's phone.
  if (isNativePlatform()) return true;
  try {
    return localStorage.getItem(PHONE_MODE_KEY) === '1';
  } catch { return false; }
}

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
  // Lazy-init from localStorage so a refresh keeps the user's choice.
  const [phoneMode, setPhoneModeState] = useState<boolean>(() => loadPhoneMode());
  const [hideBottomNav, setHideBottomNav] = useState(false);
  const [darkMode, setDarkModeState] = useState<boolean>(() => loadDarkMode());

  // Persist whenever phoneMode changes. Skip on native — the flag is
  // always true there, and writing locks it in even if the build is
  // later loaded in a desktop browser for testing.
  useEffect(() => {
    if (isNative) return;
    try { localStorage.setItem(PHONE_MODE_KEY, phoneMode ? '1' : '0'); } catch {}
  }, [phoneMode, isNative]);

  // Apply the dark class to <html> so Tailwind's @custom-variant dark
  // selector matches everywhere, and persist the user's choice.
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem(DARK_MODE_KEY, darkMode ? '1' : '0'); } catch {}
  }, [darkMode]);

  const setPhoneMode = useCallback((on: boolean) => setPhoneModeState(on), []);
  const togglePhoneMode = useCallback(() => {
    setPhoneModeState((prev) => !prev);
  }, []);

  const setDarkMode = useCallback((on: boolean) => setDarkModeState(on), []);
  const toggleDarkMode = useCallback(() => {
    setDarkModeState((prev) => !prev);
  }, []);

  return (
    <SettingsContext.Provider value={{ phoneMode, togglePhoneMode, setPhoneMode, isNative, hideBottomNav, setHideBottomNav, darkMode, toggleDarkMode, setDarkMode }}>
      {children}
    </SettingsContext.Provider>
  );
};
