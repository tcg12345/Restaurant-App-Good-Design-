import React, { createContext, useContext, useState, useCallback } from 'react';

interface SettingsContextType {
  phoneMode: boolean;
  togglePhoneMode: () => void;
}

const SettingsContext = createContext<SettingsContextType>({
  phoneMode: false,
  togglePhoneMode: () => {},
});

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phoneMode, setPhoneMode] = useState(false);

  const togglePhoneMode = useCallback(() => {
    setPhoneMode((prev) => !prev);
  }, []);

  return (
    <SettingsContext.Provider value={{ phoneMode, togglePhoneMode }}>
      {children}
    </SettingsContext.Provider>
  );
};
