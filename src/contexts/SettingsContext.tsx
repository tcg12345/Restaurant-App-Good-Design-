import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface SettingsContextType {
  phoneMode: boolean;
  togglePhoneMode: () => void;
  setPhoneMode: (on: boolean) => void;
  hideBottomNav: boolean;
  setHideBottomNav: (hide: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType>({
  phoneMode: false,
  togglePhoneMode: () => {},
  setPhoneMode: () => {},
  hideBottomNav: false,
  setHideBottomNav: () => {},
});

export const useSettings = () => useContext(SettingsContext);

const PHONE_MODE_KEY = 'gourmad-phone-mode';

function loadPhoneMode(): boolean {
  try {
    return localStorage.getItem(PHONE_MODE_KEY) === '1';
  } catch { return false; }
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Lazy-init from localStorage so a refresh keeps the user's choice.
  const [phoneMode, setPhoneModeState] = useState<boolean>(() => loadPhoneMode());
  const [hideBottomNav, setHideBottomNav] = useState(false);

  // Persist whenever phoneMode changes.
  useEffect(() => {
    try { localStorage.setItem(PHONE_MODE_KEY, phoneMode ? '1' : '0'); } catch {}
  }, [phoneMode]);

  const setPhoneMode = useCallback((on: boolean) => setPhoneModeState(on), []);
  const togglePhoneMode = useCallback(() => {
    setPhoneModeState((prev) => !prev);
  }, []);

  return (
    <SettingsContext.Provider value={{ phoneMode, togglePhoneMode, setPhoneMode, hideBottomNav, setHideBottomNav }}>
      {children}
    </SettingsContext.Provider>
  );
};
