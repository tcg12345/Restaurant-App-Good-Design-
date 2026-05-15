import React, { createContext, useCallback, useContext, useState } from 'react';

/**
 * Controls the desktop slide-out Circle panel (Instagram-style).
 * Sidebar's Circle button toggles `open`; App.tsx renders the panel
 * conditionally. On mobile/phone-frame this context is unused — the
 * /circle route stays a regular page.
 */
interface CirclePanelContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const CirclePanelContext = createContext<CirclePanelContextValue | null>(null);

export const CirclePanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return (
    <CirclePanelContext.Provider value={{ open, setOpen, toggle }}>
      {children}
    </CirclePanelContext.Provider>
  );
};

export function useCirclePanel(): CirclePanelContextValue {
  const ctx = useContext(CirclePanelContext);
  // Allow null fallback so components rendered outside the desktop tree
  // (the mobile /circle page, etc.) can no-op safely.
  return ctx ?? { open: false, setOpen: () => {}, toggle: () => {} };
}
