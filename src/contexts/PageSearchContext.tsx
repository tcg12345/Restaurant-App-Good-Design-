import React, { createContext, useCallback, useContext, useState } from 'react';

/**
 * Lets a page hijack the desktop header's search input as a list filter.
 * Pantry calls `setScopedSearch` when the user clicks a "Search this
 * list" button; DesktopHeader watches the context and, while a scope is
 * active, binds its input to the page's filter state, drops the global
 * Places dropdown, and shows a small chip with the list name + an X to
 * exit the scope. When the scope is null the header behaves normally —
 * the input is its own state and runs Google Places search.
 */

export interface ScopedSearch {
  /** Display name of the list/view being filtered. Shown on the chip
   *  inside the header so the user can see what they're searching. */
  scopeName: string;
  /** Placeholder for the desktop header input while this scope is on. */
  placeholder?: string;
  /** Current filter text — owned by the page. */
  query: string;
  /** Page-supplied setter; the header calls this on every keystroke. */
  setQuery: (q: string) => void;
  /** Called when the user clicks the chip's X (or hits ESC). The page
   *  typically clears its filter text and exits scoped mode. */
  onDismiss?: () => void;
}

interface PageSearchContextValue {
  scopedSearch: ScopedSearch | null;
  setScopedSearch: (s: ScopedSearch | null) => void;
  /** Tick incremented whenever a page wants the header's input focused
   *  (e.g. right after activating a scope). Header watches the value
   *  and focuses on every change. */
  focusBump: number;
  bumpFocus: () => void;
}

const PageSearchContext = createContext<PageSearchContextValue | null>(null);

export const PageSearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [scopedSearch, setScopedSearchState] = useState<ScopedSearch | null>(null);
  const [focusBump, setFocusBump] = useState(0);
  const setScopedSearch = useCallback((s: ScopedSearch | null) => setScopedSearchState(s), []);
  const bumpFocus = useCallback(() => setFocusBump((n) => n + 1), []);
  return (
    <PageSearchContext.Provider value={{ scopedSearch, setScopedSearch, focusBump, bumpFocus }}>
      {children}
    </PageSearchContext.Provider>
  );
};

export function usePageSearch(): PageSearchContextValue {
  const ctx = useContext(PageSearchContext);
  if (!ctx) throw new Error('usePageSearch must be used inside PageSearchProvider');
  return ctx;
}
