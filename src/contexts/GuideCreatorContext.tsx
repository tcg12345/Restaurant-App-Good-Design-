/**
 * GuideCreatorContext — global handle for opening the guide wizard from
 * anywhere in the app (sidebar Create menu, profile Create menu, the
 * "Create a guide" tile on Discover, the /create page).
 *
 * Mirrors the openAdd*Modal pattern used by PostsContext and ReelsContext.
 * The actual GuideCreatorSheet is mounted once at the app root and reacts
 * to context state.
 */
import React, { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Guide } from '../lib/supabase-guides';
import { useAuth } from './AuthContext';
import { useSignInModal } from './SignInModalContext';

interface GuideCreatorContextValue {
  isOpen: boolean;
  initialGuide: Guide | null;
  openGuideCreator: (initialGuide?: Guide | null) => void;
  closeGuideCreator: () => void;
}

const GuideCreatorContext = createContext<GuideCreatorContextValue | null>(null);

export const GuideCreatorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const [isOpen, setIsOpen] = useState(false);
  const [initialGuide, setInitialGuide] = useState<Guide | null>(null);

  const openGuideCreator = useCallback((g?: Guide | null) => {
    if (!isSignedIn) { requireSignIn('Sign in to create a guide'); return; }
    setInitialGuide(g ?? null);
    setIsOpen(true);
  }, [isSignedIn, requireSignIn]);

  const closeGuideCreator = useCallback(() => {
    setIsOpen(false);
    setInitialGuide(null);
  }, []);

  return (
    <GuideCreatorContext.Provider value={{ isOpen, initialGuide, openGuideCreator, closeGuideCreator }}>
      {children}
    </GuideCreatorContext.Provider>
  );
};

export function useGuideCreator(): GuideCreatorContextValue {
  const ctx = useContext(GuideCreatorContext);
  if (!ctx) throw new Error('useGuideCreator must be used within GuideCreatorProvider');
  return ctx;
}
