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
import type { Guide, GuideType } from '../lib/supabase-guides';
import { useAuth } from './AuthContext';
import { useSignInModal } from './SignInModalContext';

/** Light prefill for a brand-new guide (from the Create page's embedded
 *  surface): the wizard opens on step 1 with these applied. */
export interface GuideSeed {
  type: GuideType;
  title: string;
}

interface GuideCreatorContextValue {
  isOpen: boolean;
  initialGuide: Guide | null;
  seed: GuideSeed | null;
  openGuideCreator: (initialGuide?: Guide | null, opts?: { seed?: GuideSeed }) => void;
  closeGuideCreator: () => void;
}

const GuideCreatorContext = createContext<GuideCreatorContextValue | null>(null);

export const GuideCreatorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();
  const [isOpen, setIsOpen] = useState(false);
  const [initialGuide, setInitialGuide] = useState<Guide | null>(null);
  const [seed, setSeed] = useState<GuideSeed | null>(null);

  const openGuideCreator = useCallback((g?: Guide | null, opts?: { seed?: GuideSeed }) => {
    if (!isSignedIn) { requireSignIn('Sign in to create a guide'); return; }
    setInitialGuide(g ?? null);
    setSeed(g ? null : (opts?.seed ?? null));
    setIsOpen(true);
  }, [isSignedIn, requireSignIn]);

  const closeGuideCreator = useCallback(() => {
    setIsOpen(false);
    setInitialGuide(null);
    setSeed(null);
  }, []);

  return (
    <GuideCreatorContext.Provider value={{ isOpen, initialGuide, seed, openGuideCreator, closeGuideCreator }}>
      {children}
    </GuideCreatorContext.Provider>
  );
};

export function useGuideCreator(): GuideCreatorContextValue {
  const ctx = useContext(GuideCreatorContext);
  if (!ctx) throw new Error('useGuideCreator must be used within GuideCreatorProvider');
  return ctx;
}
