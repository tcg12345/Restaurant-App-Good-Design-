import React, { createContext, useCallback, useContext, useState } from 'react';

/**
 * Lets a page override the desktop quick-add action. Pages register what
 * the action should say + do based on their current view; the Sidebar's
 * Create menu reads the override and renders the right label/handler.
 * When the override is null, the action reverts to its default behavior
 * (routing to /search/main to pick and rate a new restaurant).
 *
 * Used by Pantry to swap the button between:
 *   - "Add Rating" → opens a SearchPopup to pick + rate a place
 *   - "Add Rating" (on a custom list) → SearchPopup with rated section,
 *     picking adds to that list (and rates if new)
 *   - "Add Recipe" → opens the recipe modal scoped to the current view
 */
export interface PageAddAction {
  /** Button label. Defaults to "Add Rating" when no override is set. */
  label: string;
  /** Click handler — typically opens a popup or modal. */
  onClick: () => void;
  /** When true, the desktop header hides the button entirely. */
  hidden?: boolean;
}

interface PageAddActionContextValue {
  override: PageAddAction | null;
  setOverride: (a: PageAddAction | null) => void;
}

const PageAddActionContext = createContext<PageAddActionContextValue | null>(null);

export const PageAddActionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [override, setOverrideState] = useState<PageAddAction | null>(null);
  const setOverride = useCallback((a: PageAddAction | null) => setOverrideState(a), []);
  return (
    <PageAddActionContext.Provider value={{ override, setOverride }}>
      {children}
    </PageAddActionContext.Provider>
  );
};

export function usePageAddAction(): PageAddActionContextValue {
  const ctx = useContext(PageAddActionContext);
  if (!ctx) throw new Error('usePageAddAction must be used inside PageAddActionProvider');
  return ctx;
}
