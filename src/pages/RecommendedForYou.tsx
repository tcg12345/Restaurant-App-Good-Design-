// /pantry/recommended — the ranked "Recommended for you" list as a real
// route (phone layout). Being a page rather than a portal popup means
// restaurant taps PUSH the full detail page on top of it, and the standard
// edge swipe-back returns to the ranking — the same stack behavior as
// every other detail flow. Desktop keeps the spotlight-card popup opened
// from the Pantry toolbar.
//
// Also the landing point for the AI chat's "Find a place" shortcut, which
// arrives with a `recsPreset` in router state (who / where / mood).

import React from 'react';
import { usePageBack } from '../lib/usePageBack';
import { useLocation } from 'react-router-dom';
import { RecommendationsBrowser } from '../components/RecommendationsBrowser';

interface RecsPreset {
  people?: string[];
  cuisines?: string[];
  target?: { label: string; lat: number; lng: number } | null;
}

export const RecommendedForYou: React.FC = () => {
  const goBack = usePageBack('/pantry');
  const location = useLocation();
  const preset = (location.state as { recsPreset?: RecsPreset } | null)?.recsPreset ?? null;
  return (
    <RecommendationsBrowser
      // Keyed by the history entry: a NEW navigation here (the chat's
      // Find-a-place, fired while this page is already up) remounts with
      // its fresh preset — the browser applies presets once per mount, so
      // an in-place navigation used to be silently ignored. Returning via
      // back restores the same entry (same key), so nothing remounts and
      // the ranking comes back as left.
      key={location.key}
      open
      variant="page"
      isMobile
      onClose={goBack}
      preset={preset}
    />
  );
};
